/**
 * Il Bluetooth vero, dietro l'interfaccia di `core/ble`.
 *
 * È l'unico file dell'applicazione che sa che sotto c'è un plugin di Tauri, ed
 * è volutamente sottile: tutta la logica — riassemblaggio, scadenze, ordine
 * delle operazioni, gestione degli errori — sta nel nucleo, dove si prova senza
 * hardware. Qui c'è solo la traduzione.
 *
 * SUL WEB NON C'È, E SI DICE. Un browser ha Web Bluetooth, ma non su Safari
 * (nessuna versione, né macOS né iOS) e comunque chiede all'utente di scegliere
 * il dispositivo da un pannello del browser che noi non controlliamo. Fingere
 * una capacità che non c'è, qui, significherebbe un pulsante «Scarica dal
 * computer» che gira in tondo: meglio dire che serve l'app.
 *
 * L'IMPORT È DINAMICO, come per il portachiavi: `@mnlphlp/plugin-blec` non
 * esiste nel bundle web, e un import statico lo trascinerebbe dentro rompendo
 * la build del browser.
 */

import { ByteStream, chunkForMtu } from '../core/ble/stream';
import type {
  BleFoundDevice,
  BleLink,
  BleServiceProfile,
  BleTransport,
  BleUnavailable,
} from '../core/ble/types';
import { isTauri } from './index';

/** La forma di ciò che il plugin restituisce. Ricopiata invece che importata: vedi sopra. */
interface PluginDevice {
  address: string;
  name: string;
  rssi: number;
  services: string[];
}

interface PluginCharacteristic {
  uuid: string;
  /** Bitmask GATT: 0x02 read, 0x04 write senza risposta, 0x08 write, 0x10 notify, 0x20 indicate. */
  properties: number;
}

interface PluginService {
  uuid: string;
  characteristics: PluginCharacteristic[];
}

interface Plugin {
  getAdapterState(): Promise<'Unknown' | 'On' | 'Off'>;
  listServices(address: string): Promise<PluginService[] | string>;
  checkPermissions(askIfDenied?: boolean): Promise<boolean>;
  startScan(handler: (devices: PluginDevice[]) => void, timeout: number): Promise<void>;
  stopScan(): Promise<void>;
  connect(address: string, onDisconnect: (() => void) | null): Promise<void>;
  disconnect(): Promise<void>;
  send(
    characteristic: string,
    data: number[],
    writeType?: 'withResponse' | 'withoutResponse',
    service?: string,
  ): Promise<void>;
  subscribe(characteristic: string, service: string | null, handler: (data: number[]) => void): Promise<void>;
  unsubscribe(characteristic: string, service?: string): Promise<void>;
  getMtu(): Promise<number>;
}

async function plugin(): Promise<Plugin> {
  return (await import('@mnlphlp/plugin-blec')) as unknown as Plugin;
}

/** Quanto dura una passata di ricerca prima di essere rilanciata. */
const SCAN_ROUND_MS = 10_000;

/**
 * Un'attesa che si può annullare.
 *
 * `setTimeout` da solo non basta: fermando la ricerca resterebbe appeso fino
 * alla fine del giro, e chi ha premuto «Ferma» aspetterebbe dieci secondi
 * guardando un pulsante che non fa niente.
 */
function attendi(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const fine = () => {
      clearTimeout(t);
      signal.removeEventListener('abort', fine);
      resolve();
    };
    const t = setTimeout(fine, ms);
    signal.addEventListener('abort', fine, { once: true });
  });
}

/**
 * Byte per scrittura, quando il sistema non dice l'MTU.
 *
 * Ventitré meno tre di intestazione ATT: è il minimo garantito dallo standard e
 * quello che si ha finché il collegamento non negozia di più. Partire da un
 * numero più grande «tanto quasi sempre funziona» significa un firmware che
 * riceve pacchetti troncati, e i computer subacquei non rispondono con un
 * errore: tacciono.
 */
const MTU_PRUDENTE = 20;

/** Le caratteristiche risolte: dal profilo se scritte, altrimenti scoperte. */
interface Canali {
  service: string;
  write: string;
  notify: string;
}

/*
 * I bit delle proprietà GATT che ci interessano.
 *
 * Sono standard e non dipendono dal plugin: 0x04 «write senza risposta», 0x08
 * «write», 0x10 «notify», 0x20 «indicate».
 */
const PROP_WRITE_NO_RESP = 0x04;
const PROP_WRITE = 0x08;
const PROP_NOTIFY = 0x10;
const PROP_INDICATE = 0x20;

/**
 * Trova su quale caratteristica si scrive e da quale si legge.
 *
 * Per proprietà e non per UUID. Gli UUID delle caratteristiche dentro un
 * servizio proprietario cambiano fra modelli e fra versioni di firmware; le
 * proprietà no, perché sono quelle che fanno funzionare il canale. È lo stesso
 * criterio di Subsurface, ed è il motivo per cui il loro elenco contiene i
 * servizi e non le caratteristiche.
 *
 * Se la scoperta non riesce si dice CHE COSA è stato trovato: «nessuna
 * caratteristica notify» e «il servizio non c'è» sono due guasti diversi con
 * due rimedi diversi, e un messaggio unico li confonde.
 */
export function resolveChannels(
  services: PluginService[],
  profile: BleServiceProfile,
): Canali | { error: string } {
  const cercato = profile.service.toLowerCase();
  const s = services.find((x) => x.uuid.toLowerCase() === cercato);
  if (!s) {
    const elenco = services.map((x) => x.uuid).join(', ') || 'nessuno';
    return {
      error: `Il dispositivo non espone il servizio ${profile.service}. Servizi trovati: ${elenco}. Di solito significa che non è il computer che pensavamo, o che è in modalità aggiornamento firmware invece che in modalità trasferimento.`,
    };
  }
  const write =
    profile.writeCharacteristic ??
    s.characteristics.find((c) => c.properties & (PROP_WRITE | PROP_WRITE_NO_RESP))?.uuid;
  const notify =
    profile.notifyCharacteristic ??
    s.characteristics.find((c) => c.properties & (PROP_NOTIFY | PROP_INDICATE))?.uuid;
  if (!write || !notify) {
    return {
      error: `Il servizio ${profile.service} non ha ${!write ? 'una caratteristica su cui scrivere' : 'una caratteristica che notifichi'}. Caratteristiche viste: ${s.characteristics.map((c) => `${c.uuid} (0x${c.properties.toString(16)})`).join(', ')}.`,
    };
  }
  return { service: s.uuid, write, notify };
}

class TauriBleLink implements BleLink {
  private stream = new ByteStream();

  constructor(
    readonly mtu: number,
    private canali: Canali,
    private writeType: BleServiceProfile['writeType'],
    private api: Plugin,
  ) {}

  /** Chiamata dal trasporto appena il canale delle notifiche è aperto. */
  feed(data: number[]): void {
    this.stream.push(Uint8Array.from(data));
  }

  onDisconnect(): void {
    this.stream.close('il dispositivo si è disconnesso');
  }

  async write(data: Uint8Array): Promise<void> {
    /*
     * Un pacchetto alla volta, in ordine, aspettando ognuno.
     *
     * `Promise.all` sui pezzi sarebbe più rapido e sbagliato: il plugin non
     * garantisce l'ordine di consegna fra scritture concorrenti, e un comando
     * i cui byte arrivano rimescolati non è un comando — è spazzatura che il
     * firmware scarta in silenzio.
     */
    for (const pezzo of chunkForMtu(data, this.mtu)) await this.writeFrame(pezzo);
  }

  async writeFrame(data: Uint8Array): Promise<void> {
    if (data.length > this.mtu) {
      throw new Error(
        `Notifica da ${data.length} byte su un MTU di ${this.mtu}: è il driver che deve spezzare.`,
      );
    }
    await this.api.send(this.canali.write, Array.from(data), this.writeType, this.canali.service);
  }

  read(n: number, timeoutMs?: number): Promise<Uint8Array> {
    return this.stream.read(n, timeoutMs);
  }

  readFrame(timeoutMs?: number): Promise<Uint8Array> {
    return this.stream.readFrame(timeoutMs);
  }

  describe(): string {
    return `servizio ${this.canali.service}, scrivo su ${this.canali.write} (${this.writeType}), ascolto ${this.canali.notify}`;
  }

  drain(): Uint8Array {
    return this.stream.drain();
  }

  async close(): Promise<void> {
    this.stream.close('chiuso da noi');
    // Nessuno dei due deve poter impedire l'altro: un `unsubscribe` fallito su
    // un dispositivo già sparito lascerebbe il collegamento aperto, e un
    // collegamento aperto tiene il computer sveglio finché ha batteria.
    await this.api.unsubscribe(this.canali.notify, this.canali.service).catch(() => undefined);
    await this.api.disconnect().catch(() => undefined);
  }
}

export class TauriBleTransport implements BleTransport {
  async available(): Promise<true | BleUnavailable> {
    if (!isTauri()) {
      return {
        reason: 'unsupported',
        detail:
          'Lo scarico dal computer subacqueo funziona solo nell’applicazione, non nel browser: Safari non ha il Bluetooth per le pagine web, e gli altri browser lo espongono in un modo che non permette di parlare con questi dispositivi.',
      };
    }
    try {
      const api = await plugin();
      const stato = await api.getAdapterState();
      if (stato === 'Off') {
        return {
          reason: 'off',
          detail: 'Il Bluetooth di questo dispositivo è spento. Accendilo e riprova.',
        };
      }
      /*
       * Il permesso si chiede QUI e non alla prima connessione.
       *
       * Su macOS e iOS il primo uso del Bluetooth fa comparire il pannello di
       * sistema. Se capitasse a metà di uno scarico, l'utente vedrebbe una
       * richiesta sopra una barra di avanzamento ferma e, negandola per
       * riflesso, si troverebbe con un errore incomprensibile. Chiederlo prima
       * di cercare vuol dire che la domanda arriva quando è ovvio il perché.
       */
      if (!(await api.checkPermissions(true))) {
        return {
          reason: 'denied',
          detail:
            'Il permesso di usare il Bluetooth è stato negato. Si concede in Impostazioni di Sistema, alla voce Privacy e sicurezza → Bluetooth.',
        };
      }
      return true;
    } catch (err) {
      // Una build senza il plugin, o una piattaforma dove non è compilato.
      return {
        reason: 'unsupported',
        detail: `Il Bluetooth non è disponibile in questa versione dell’applicazione: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  async scan(onUpdate: (devices: BleFoundDevice[]) => void, signal: AbortSignal): Promise<void> {
    const api = await plugin();
    /*
     * UN GIRO ALLA VOLTA, E SI ASPETTA CHE FINISCA.
     *
     * Qui c'era il difetto che ha fatto fallire il primo tentativo con un
     * Peregrine vero, e vale la pena scriverlo per intero perché è tutto
     * fuorché ovvio.
     *
     * `startScan` NON dura quanto il suo timeout: torna subito, perché dal lato
     * Rust avvia un compito in secondo piano e restituisce. Il ciclo che c'era
     * — «avvia, aspetta 200 ms, riavvia» — rilanciava quindi la ricerca cinque
     * volte al secondo. E la prima cosa che quel compito fa è SVUOTARE la mappa
     * dei dispositivi conosciuti (`self_devices.lock().await.clear()` in
     * `handler.rs`), che è la stessa mappa da cui `connect` prende il
     * dispositivo per indirizzo.
     *
     * Risultato: l'elenco a schermo si popolava — quindi sembrava funzionare —
     * ma al momento della connessione la mappa era appena stata azzerata da un
     * giro nuovo, e il plugin rispondeva «There is no peripheral with id: …».
     * Un errore che parla di un dispositivo inesistente mentre il suo nome è
     * scritto nella riga che si è appena premuta.
     *
     * Ora si aspetta che il giro finisca davvero prima di rilanciarlo. Il
     * rilancio serve comunque: un computer subacqueo annuncia solo quando è
     * sveglio, e la finestra utile spesso si apre dopo che la prima passata è
     * già finita.
     */
    const visti = new Map<string, BleFoundDevice>();
    try {
      while (!signal.aborted) {
        await api.startScan((devs) => {
          if (signal.aborted) return;
          for (const d of devs) {
            visti.set(d.address, {
              id: d.address,
              name: d.name ?? '',
              rssi: d.rssi,
              serviceUuids: (d.services ?? []).map((s) => s.toLowerCase()),
            });
          }
          // Accumulati fra un giro e l'altro: un computer che smette di
          // annunciare mentre si sceglie non deve sparire dalla riga che si sta
          // per premere. Se al momento della connessione il plugin non lo
          // conosce più, `open` rifà una passata e riprova — vedi sotto.
          onUpdate([...visti.values()]);
        }, SCAN_ROUND_MS);
        // Il giro dura quanto il suo timeout, più un margine per lo spegnimento.
        await attendi(SCAN_ROUND_MS + 400, signal);
      }
    } finally {
      await api.stopScan().catch(() => undefined);
    }
  }

  async open(deviceId: string, profile: BleServiceProfile, signal: AbortSignal): Promise<BleLink> {
    const api = await plugin();
    if (signal.aborted) throw new Error('annullato');
    // La ricerca va fermata prima di connettersi: su alcuni stack la
    // connessione fallisce con un errore generico se lo scan è ancora attivo,
    // e quell'errore generico è indistinguibile da «il computer non risponde».
    await api.stopScan().catch(() => undefined);

    /*
     * `let` e non `const`: il richiamo di disconnessione si registra PRIMA che
     * l'oggetto esista.
     *
     * `connect` vuole il richiamo al momento della chiamata, ma il collegamento
     * non si può costruire prima di conoscere l'MTU, che si legge solo a
     * connessione avvenuta. La freccia legge la variabile quando scatta, cioè
     * dopo: è l'unico ordine che permette di non perdere una disconnessione
     * avvenuta nei primi millisecondi, che è proprio quando capita se il
     * computer si sta riaddormentando.
     */
    // eslint-disable-next-line prefer-const
    let link: TauriBleLink | undefined;

    /*
     * SE IL PLUGIN NON LO CONOSCE PIÙ, SI RIFÀ UNA PASSATA E SI RIPROVA.
     *
     * La mappa dei dispositivi del plugin viene svuotata all'inizio di ogni
     * ricerca, mentre l'elenco a schermo accumula fra una passata e l'altra: le
     * due cose possono divergere, per esempio scegliendo un computer visto un
     * minuto prima. Il sintomo è un errore che dice «non esiste nessun
     * dispositivo con questo identificativo» mentre il suo nome è scritto nella
     * riga appena premuta — incomprensibile, e risolvibile in tre secondi
     * rifacendo una passata corta.
     *
     * Un tentativo solo: se non basta, il computer si è davvero addormentato, e
     * insistere allungherebbe l'attesa senza cambiare niente.
     */
    try {
      await api.connect(deviceId, () => link?.onDisconnect());
    } catch (err) {
      if (!/no peripheral with id/i.test(String(err))) throw err;
      await api.startScan(() => undefined, 3000);
      await attendi(3400, signal);
      await api.stopScan().catch(() => undefined);
      if (signal.aborted) throw new Error('annullato');
      await api.connect(deviceId, () => link?.onDisconnect());
    }

    /*
     * L'MTU si chiede DOPO la connessione, mai prima.
     *
     * Prima non esiste: si negozia all'apertura del collegamento. E se la
     * richiesta fallisce si usa il minimo garantito invece di indovinare —
     * pacchetti troppo lunghi non danno errore, danno silenzio.
     */
    const mtu = await api.getMtu().catch(() => MTU_PRUDENTE);

    /*
     * Le caratteristiche si scoprono DOPO la connessione.
     *
     * `listServices` su un dispositivo non connesso restituisce quello che il
     * sistema ha in cache — che può essere niente, o vecchio. Qui il
     * collegamento è già aperto, quindi il sistema ha appena fatto la scoperta
     * dei servizi e l'elenco è quello vero.
     */
    const elenco = await api.listServices(deviceId).catch((err: unknown) => String(err));
    if (typeof elenco === 'string') {
      await api.disconnect().catch(() => undefined);
      throw new Error(`Non si è potuto leggere l’elenco dei servizi del dispositivo: ${elenco}`);
    }
    const canali = resolveChannels(elenco, profile);
    if ('error' in canali) {
      await api.disconnect().catch(() => undefined);
      throw new Error(canali.error);
    }

    link = new TauriBleLink(Math.max(1, Math.min(mtu, 512)), canali, profile.writeType, api);
    await api.subscribe(canali.notify, canali.service, (data) => link?.feed(data));
    return link;
  }
}
