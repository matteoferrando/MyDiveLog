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

interface Plugin {
  getAdapterState(): Promise<'Unknown' | 'On' | 'Off'>;
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
 * Byte per scrittura, quando il sistema non dice l'MTU.
 *
 * Ventitré meno tre di intestazione ATT: è il minimo garantito dallo standard e
 * quello che si ha finché il collegamento non negozia di più. Partire da un
 * numero più grande «tanto quasi sempre funziona» significa un firmware che
 * riceve pacchetti troncati, e i computer subacquei non rispondono con un
 * errore: tacciono.
 */
const MTU_PRUDENTE = 20;

class TauriBleLink implements BleLink {
  private stream = new ByteStream();

  constructor(
    readonly mtu: number,
    private profile: BleServiceProfile,
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
    for (const pezzo of chunkForMtu(data, this.mtu)) {
      await this.api.send(
        this.profile.writeCharacteristic,
        Array.from(pezzo),
        this.profile.writeType,
        this.profile.service,
      );
    }
  }

  read(n: number, timeoutMs?: number): Promise<Uint8Array> {
    return this.stream.read(n, timeoutMs);
  }

  drain(): Uint8Array {
    return this.stream.drain();
  }

  async close(): Promise<void> {
    this.stream.close('chiuso da noi');
    // Nessuno dei due deve poter impedire l'altro: un `unsubscribe` fallito su
    // un dispositivo già sparito lascerebbe il collegamento aperto, e un
    // collegamento aperto tiene il computer sveglio finché ha batteria.
    await this.api
      .unsubscribe(this.profile.notifyCharacteristic, this.profile.service)
      .catch(() => undefined);
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
     * La ricerca si rilancia finché non la si annulla.
     *
     * Il plugin cerca per una durata fissa e poi si ferma. Un computer
     * subacqueo però annuncia solo quando è sveglio — e si sveglia quando lo
     * tocchi o quando entra in modalità trasferimento — quindi la finestra
     * utile spesso si apre DOPO che la ricerca è già finita. Il risultato
     * sarebbe «non lo trova», e chi legge conclude che l'app non funziona.
     */
    try {
      while (!signal.aborted) {
        await api.startScan((devs) => {
          if (signal.aborted) return;
          onUpdate(
            devs.map((d) => ({
              id: d.address,
              name: d.name ?? '',
              rssi: d.rssi,
              serviceUuids: (d.services ?? []).map((s) => s.toLowerCase()),
            })),
          );
        }, SCAN_ROUND_MS);
        await new Promise((r) => setTimeout(r, 200));
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
    await api.connect(deviceId, () => link?.onDisconnect());

    /*
     * L'MTU si chiede DOPO la connessione, mai prima.
     *
     * Prima non esiste: si negozia all'apertura del collegamento. E se la
     * richiesta fallisce si usa il minimo garantito invece di indovinare —
     * pacchetti troppo lunghi non danno errore, danno silenzio.
     */
    const mtu = await api.getMtu().catch(() => MTU_PRUDENTE);
    link = new TauriBleLink(Math.max(1, Math.min(mtu, 512)), profile, api);

    await api.subscribe(profile.notifyCharacteristic, profile.service, (data) => link?.feed(data));
    return link;
  }
}
