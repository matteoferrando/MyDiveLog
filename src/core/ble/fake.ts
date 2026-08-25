/**
 * Un computer subacqueo che non esiste.
 *
 * Serve a scrivere e provare un protocollo senza il dispositivo, ed è la ragione
 * per cui questo strato è separato. Ma un finto dispositivo utile non è quello
 * che risponde bene: è quello che sbaglia come sbaglia il vero. Quindi qui
 * dentro ci sono, e sono accendibili uno per uno:
 *
 * - **MTU corta**: le risposte arrivano a pezzi di venti byte, mai allineati ai
 *   campi. È il caso normale, non l'eccezione.
 * - **Risposte incollate**: due risposte nella stessa notifica. Succede appena
 *   il firmware è più veloce dello stack BLE.
 * - **Silenzio**: un comando a cui non risponde niente. Deve produrre una
 *   scadenza leggibile, non un blocco.
 * - **Disconnessione a metà**: la cosa che capita davvero, in barca, quando il
 *   computer è sott'acqua a due metri dal telefono.
 * - **Spazzatura iniziale**: byte residui di una sessione precedente. È il
 *   motivo per cui i driver devono azzerare il flusso prima di ogni comando.
 *
 * Non è una simulazione di CoreBluetooth: è una simulazione dei MODI IN CUI
 * QUESTA COSA FALLISCE. Sono due obiettivi diversi e il secondo è quello utile.
 */

import { ByteStream, chunkForMtu } from './stream';
import type { BleFoundDevice, BleLink, BleServiceProfile, BleTransport, BleUnavailable } from './types';

/** Come si comporta il finto dispositivo. Tutto spento per difetto. */
export interface FakeQuirks {
  /** Byte per notifica. 20 è il valore reale di un collegamento non negoziato. */
  mtu?: number;
  /** Non risponde a nulla: serve a provare le scadenze. */
  mute?: boolean;
  /** Si disconnette dopo aver risposto a questo numero di comandi. */
  dropAfterCommands?: number;
  /** Byte già in coda all'apertura, come residuo di una sessione precedente. */
  garbageOnOpen?: Uint8Array;
  /** Millisecondi prima di rispondere. Con 0 la risposta è sincrona. */
  latencyMs?: number;
  /**
   * Consegna le notifiche UNA PER GIRO di coda, invece che tutte insieme.
   *
   * Il finto le metteva in coda tutte in un colpo: cento notifiche già lì
   * prima che il driver ne leggesse una. È comodo e rende i test più deboli di
   * quanto sembrino, perché il percorso vero — le notifiche che arrivano nel
   * tempo, mentre il driver legge — non veniva mai esercitato. Sono proprio le
   * condizioni in cui vivono le scadenze, l'annullamento e il costo della coda.
   */
  unaAllaVolta?: boolean;
}

/**
 * La macchina che risponde: un comando entra, dei byte escono.
 *
 * `undefined` significa «non rispondo», che è diverso da «rispondo vuoto»: il
 * primo caso deve far scadere una lettura, il secondo no.
 *
 * Un ELENCO di array significa «queste notifiche, esattamente così»: servono ai
 * protocolli che mettono un'intestazione dentro ogni notifica, dove
 * riassemblare e rispezzare all'MTU sposterebbe i confini e romperebbe i
 * contatori. Un array solo viene invece spezzato all'MTU, come fa un
 * collegamento vero con un messaggio lungo.
 */
export type FakeResponder = (command: Uint8Array, index: number) => Uint8Array | Uint8Array[] | undefined;

export class FakeBleLink implements BleLink {
  readonly mtu: number;
  private stream = new ByteStream();
  private comandi = 0;
  private chiusoDaNoi = false;

  /** Vero dopo `close()`. Pubblico perché i test devono poterlo asserire. */
  get chiuso(): boolean {
    return this.chiusoDaNoi;
  }
  /** Tutto quello che il driver ha scritto: è la cosa su cui si asserisce nei test. */
  readonly written: Uint8Array[] = [];

  constructor(
    private responder: FakeResponder,
    private quirks: FakeQuirks = {},
  ) {
    this.mtu = quirks.mtu ?? 20;
    if (quirks.garbageOnOpen?.length) this.stream.push(quirks.garbageOnOpen);
  }

  async writeFrame(data: Uint8Array): Promise<void> {
    if (data.length > this.mtu) {
      throw new Error(
        `Notifica da ${data.length} byte su un MTU di ${this.mtu}: è il driver che deve spezzare.`,
      );
    }
    return this.consegna(data);
  }

  async write(data: Uint8Array): Promise<void> {
    return this.consegna(data);
  }

  private async consegna(data: Uint8Array): Promise<void> {
    if (this.chiusoDaNoi) throw new Error('scrittura su un collegamento chiuso');
    this.written.push(data.slice());
    const n = this.comandi++;

    if (this.quirks.dropAfterCommands !== undefined && n >= this.quirks.dropAfterCommands) {
      this.stream.close('il dispositivo si è disconnesso');
      this.chiusoDaNoi = true;
      return;
    }
    if (this.quirks.mute) return;

    const risposta = this.responder(data, n);
    if (risposta === undefined) return;

    const pezzi = Array.isArray(risposta) ? risposta : chunkForMtu(risposta, this.mtu);
    const consegna = () => {
      // A pezzi di MTU, come il vero: è la condizione che rompe i driver
      // scritti come se una notifica fosse un messaggio.
      for (const pezzo of pezzi) this.stream.push(pezzo);
    };
    const consegnaLenta = () => {
      let i = 0;
      const passo = () => {
        if (this.chiusoDaNoi || i >= pezzi.length) return;
        this.stream.push(pezzi[i++]);
        setTimeout(passo, 0);
      };
      setTimeout(passo, 0);
    };
    const quale = this.quirks.unaAllaVolta ? consegnaLenta : consegna;
    if (this.quirks.latencyMs) setTimeout(quale, this.quirks.latencyMs);
    else quale();
  }

  read(n: number, timeoutMs?: number, signal?: AbortSignal): Promise<Uint8Array> {
    return this.stream.read(n, timeoutMs, signal);
  }

  readFrame(timeoutMs?: number, signal?: AbortSignal): Promise<Uint8Array> {
    return this.stream.readFrame(timeoutMs, signal);
  }

  drain(): Uint8Array {
    return this.stream.drain();
  }

  /** Il driver deve poter azzerare il flusso prima di un comando. */
  reset(): void {
    this.stream.reset();
  }

  /**
   * Come è stato aperto.
   *
   * Esiste perché il ramo `if (link.describe)` di `downloadFromComputer` — che
   * scrive nel diario servizio e caratteristiche, cioè la prima riga che si
   * guarda quando un protocollo non risponde — non veniva mai eseguito nei
   * test.
   */
  describe(): string {
    return `collegamento finto, MTU ${this.mtu}`;
  }

  async close(): Promise<void> {
    this.chiusoDaNoi = true;
    this.stream.close('chiuso da noi');
  }
}

/** Un trasporto finto con dentro dei dispositivi finti. */
export class FakeTransport implements BleTransport {
  constructor(
    private devices: { device: BleFoundDevice; responder: FakeResponder; quirks?: FakeQuirks }[],
    private stato: true | BleUnavailable = true,
  ) {}

  /** L'ultimo collegamento aperto, per poterci asserire sopra. */
  lastLink?: FakeBleLink;

  /**
   * TUTTI i collegamenti aperti, in ordine.
   *
   * Con la sola `lastLink` nessun test poteva verificare che una riapertura
   * avesse chiuso quello di prima — e un collegamento dimenticato tiene sveglio
   * il computer finché non finisce la batteria.
   */
  readonly links: FakeBleLink[] = [];

  async available(): Promise<true | BleUnavailable> {
    return this.stato;
  }

  async scan(onUpdate: (devices: BleFoundDevice[]) => void, signal: AbortSignal): Promise<void> {
    // Come il vero: l'elenco cresce un dispositivo alla volta, e la ricerca
    // finisce solo quando la si ANNULLA. Prima tornava da sé appena finito
    // l'elenco, contro il contratto in `types.ts` — e chi la chiama la aspetta:
    // un finto che torna subito faceva sembrare corretto un chiamante che si
    // sarebbe bloccato col trasporto vero.
    for (let i = 0; i < this.devices.length; i++) {
      if (signal.aborted) return;
      onUpdate(this.devices.slice(0, i + 1).map((d) => d.device));
    }
    if (signal.aborted) return;

    /*
     * ► IL SEGNALE TREMA, E DEVE TREMARE ANCHE QUI. ◄
     *
     * Un dispositivo BLE annuncia sé stesso più volte al secondo, e l'RSSI
     * cambia a ogni annuncio: una mano che si sposta, il corpo che passa
     * davanti, la batteria. È fisica, non rumore da filtrare.
     *
     * Il finto non lo faceva: emetteva i quattro dispositivi in un ciclo
     * sincrono e poi stava zitto. Risultato, un difetto arrivato fino
     * all'utente che NESSUNA prova poteva prendere — l'elenco riordinato per
     * segnale a ogni annuncio, cioè le righe che si scambiano di posto sotto
     * il dito mentre si cerca di toccarne una. Su iPhone, con la scheda del
     * catalogo aperta dentro una riga, diventa impossibile scegliere un
     * modello.
     *
     * Adesso l'aggiornamento continua finché la ricerca non viene annullata,
     * con l'RSSI che si muove di qualche dB come nella realtà. Chi guarda le
     * schermate vede il difetto se torna, invece di vedere un elenco fermo che
     * non esiste da nessuna parte.
     */
    let giro = 0;
    const tremolio = setInterval(() => {
      giro++;
      onUpdate(
        this.devices.map(({ device }, i) => ({
          ...device,
          // Un'oscillazione che NON è casuale: dev'essere ripetibile, o due
          // esecuzioni della stessa prova darebbero fotografie diverse e
          // nessuno saprebbe se è cambiato il codice o il caso.
          rssi: (device.rssi ?? -70) + Math.round(6 * Math.sin(giro * 1.1 + i * 2.3)),
        })),
      );
    }, 250);

    await new Promise<void>((risolvi) => signal.addEventListener('abort', () => risolvi(), { once: true }));
    clearInterval(tremolio);
  }

  async open(deviceId: string, _profile: BleServiceProfile, signal: AbortSignal): Promise<BleLink> {
    if (signal.aborted) throw new Error('annullato');
    const trovato = this.devices.find((d) => d.device.id === deviceId);
    if (!trovato) throw new Error(`nessun dispositivo con identificativo ${deviceId}`);
    const link = new FakeBleLink(trovato.responder, trovato.quirks);
    this.lastLink = link;
    this.links.push(link);
    return link;
  }
}

/** Scorciatoia per costruire un dispositivo trovato nei test. */
export function fakeDevice(over: Partial<BleFoundDevice> = {}): BleFoundDevice {
  return { id: 'dev-1', name: 'Peregrine', rssi: -55, serviceUuids: [], ...over };
}

// --------------------------------------------------- un Peregrine che risponde

const SLIP_END = 0xc0;
const SLIP_ESC = 0xdb;

/**
 * Un Peregrine che non esiste, scritto dall'altra parte del protocollo.
 *
 * Riceve notifiche, riassembla lo SLIP con un decodificatore proprio, e
 * risponde: identificazione, manifesto, immersioni compresse con lo stesso RLE
 * a nove bit e lo stesso XOR a blocchi di trentadue. Il carico è un log PNF
 * sintetico (vedi `logPnfSintetico`), così il giro arriva fino a `decodePnf` e
 * non si ferma ai byte.
 *
 * PERCHÉ STA QUI E NON NEL SUO TEST. Ci è nato dentro, in
 * `tests/shearwaterBle.test.ts`, ed è rimasto lì finché a chiederlo era solo
 * quello. Ora lo chiede anche il Bluetooth finto dell'interfaccia
 * (`src/ui/bluetoothFinto.ts`), che serve a fotografare le schermate dello
 * scarico — elenco, avanzamento, esito — le sole che nessun test può vedere
 * perché esistono unicamente quando una ricerca Bluetooth trova qualcosa.
 * Duplicarlo avrebbe prodotto due finti che divergono al primo ritocco del
 * driver, e il secondo — quello dell'interfaccia — nessuno lo eseguirebbe mai
 * abbastanza da accorgersene.
 *
 * RESTA SCRITTO GUARDANDO IL C, non il nostro TypeScript: usa codificatori
 * propri invece di riusare `slipFrames` e compagnia. Un finto che costruisce la
 * risposta con le stesse funzioni che dovranno leggerla non prova niente, e
 * questo vale anche adesso che vive in `src/`.
 *
 * IL SERIALE È UN PARAMETRO, e la ragione è stata trovata a caro prezzo: il
 * segnalibro dello scarico incrementale si ricorda SOTTO IL SERIALE. Due finti
 * con lo stesso seriale sono lo stesso computer per l'archivio, quindi appena
 * il primo ha finito, il secondo si sente rispondere «niente di nuovo» e non
 * scarica una riga — che è il comportamento giusto, applicato a due dispositivi
 * che nella realtà sono distinti.
 */
export function fintoPeregrine(logs: Uint8Array[], seriale = '988B023F'): FakeResponder {
  let inArrivo: number[] = [];
  let escaped = false;
  const daMandare: Uint8Array[] = [];

  /** L'inverso di quello che fa il driver, scritto a parte apposta. */
  const incapsula = (payload: number[]) => {
    const pacchetto = [0x01, 0xff, payload.length + 1, 0x00, ...payload];
    const esc: number[] = [];
    for (const c of pacchetto) {
      if (c === SLIP_END) esc.push(SLIP_ESC, 0xdc);
      else if (c === SLIP_ESC) esc.push(SLIP_ESC, 0xdd);
      else esc.push(c);
    }
    esc.push(SLIP_END);
    const n = Math.ceil(esc.length / 18);
    for (let i = 0; i < n; i++) {
      daMandare.push(Uint8Array.from([n, i, ...esc.slice(i * 18, (i + 1) * 18)]));
    }
  };

  const comprimi = (bytes: Uint8Array) => {
    // XOR prima (è il rovescio del disfacimento), poi RLE.
    const x = bytes.slice();
    for (let i = x.length - 1; i >= 32; i--) x[i] ^= x[i - 32];
    const bits: number[] = [];
    const spingi = (v: number) => {
      for (let i = 8; i >= 0; i--) bits.push((v >> i) & 1);
    };
    let i = 0;
    while (i < x.length) {
      if (x[i] === 0) {
        let run = 0;
        while (i < x.length && x[i] === 0 && run < 255) {
          run++;
          i++;
        }
        spingi(run);
      } else {
        spingi(0x100 | x[i]);
        i++;
      }
    }
    spingi(0);
    while (bits.length % 72 !== 0) spingi(0);
    const out = new Uint8Array(bits.length / 8);
    bits.forEach((b, k) => {
      if (b) out[k >> 3] |= 0x80 >> (k & 7);
    });
    return out;
  };

  const manifesto = () => {
    const p = new Uint8Array(0x600);
    logs.forEach((_, i) => {
      const o = i * 32;
      p[o] = 0xa5;
      p[o + 1] = 0xc4;
      p.set([0, 0, 0, i + 1], o + 4);
      p[o + 23] = (i + 1) * 0x40;
    });
    return p;
  };

  /** Il trasferimento in corso: cosa si sta mandando e a che blocco si è. */
  let corrente: Uint8Array | null = null;
  let compresso = false;

  const rispondi = (payload: number[]) => {
    const cmd = payload[0];

    if (cmd === 0x22) {
      const id = (payload[1] << 8) | payload[2];
      const dati =
        id === 0x8010
          ? // Il seriale è TESTO: otto caratteri ASCII col seriale scritto in
            // esadecimale, come risponde un Peregrine vero (verificato sul
            // diario di uno scarico reale). Il finto lo imita, perché un finto
            // che risponde con quattro byte binari avrebbe lasciato passare
            // l'errore di lettura che c'era.
            [...new TextEncoder().encode(seriale)]
          : id === 0x8011
            ? [...new TextEncoder().encode('V93')]
            : id === 0x8060
              ? [9] // Peregrine
              : id === 0x8021
                ? [0, 0x80, 0x00, 0x00, 0x00] // formato nuovo
                : null;
      if (!dati) return incapsula([0x7f, 0x22, 0x31]);
      return incapsula([0x62, payload[1], payload[2], ...dati]);
    }

    if (cmd === 0x35) {
      compresso = (payload[1] & 0x10) !== 0;
      const addr = ((payload[3] << 24) >>> 0) + (payload[4] << 16) + (payload[5] << 8) + payload[6];
      if (addr === 0xe0000000) corrente = manifesto();
      else {
        const i = (addr - 0x80000000) / 0x40 - 1;
        corrente = comprimi(logs[i]);
      }
      return incapsula([0x75, 0x10, 0x00, 0x02]);
    }

    if (cmd === 0x36) {
      const block = payload[1];
      if (!corrente) return incapsula([0x7f, 0x36, 0x22]);
      // Blocchi da 60 byte: piccoli apposta, così ogni risposta attraversa più
      // notifiche e il riassemblaggio viene esercitato davvero.
      const start = (block - 1) * 60;
      const pezzo = corrente.subarray(start, start + 60);
      if (pezzo.length === 0 && !compresso) return incapsula([0x76, block]);
      return incapsula([0x76, block, ...pezzo]);
    }

    if (cmd === 0x37) {
      corrente = null;
      return incapsula([0x77, 0x00]);
    }

    return incapsula([0x7f, cmd, 0x11]);
  };

  return (frame: Uint8Array): Uint8Array[] | undefined => {
    for (let i = 2; i < frame.length; i++) {
      const c = frame[i];
      if (c === SLIP_END) {
        if (inArrivo.length) {
          const p = inArrivo;
          inArrivo = [];
          // `FF 01 len 00 payload`
          rispondi(p.slice(4));
        }
        continue;
      }
      if (c === SLIP_ESC) {
        escaped = true;
        continue;
      }
      if (escaped) {
        escaped = false;
        inArrivo.push(c === 0xdc ? SLIP_END : c === 0xdd ? SLIP_ESC : c);
        continue;
      }
      inArrivo.push(c);
    }
    /*
     * Le notifiche di risposta escono TUTTE INSIEME, già inquadrate.
     *
     * È come si comporta un collegamento vero: il firmware risponde a un
     * comando completo mandando la sua raffica di notifiche, non una a ogni
     * scrittura ricevuta. E vanno consegnate così come sono, senza farle
     * rispezzare dall'MTU: i due byte di intestazione contano le notifiche, e
     * ritagliarle a venti byte sposterebbe i confini rendendo i contatori falsi.
     *
     * Una scrittura intermedia — quelle che compongono un comando lungo — non
     * produce niente, ed è giusto: il finto restituisce un elenco vuoto e il
     * driver continua a scrivere.
     */
    if (!daMandare.length) return undefined;
    return daMandare.splice(0, daMandare.length);
  };
}

/**
 * Un log PNF minimo ma vero: apertura, un campione, chiusura, finale.
 *
 * Costruito con gli stessi offset che `decodePnf` legge, così il giro completo
 * arriva a un'immersione con una data e una profondità invece che a dei byte.
 */
export function logPnfSintetico(startTimeS: number, depthDm: number): Uint8Array {
  const R = 32;
  const rec: number[][] = [];
  const apertura = new Array(R).fill(0);
  apertura[0] = 0x10;
  apertura[4] = 40; // GF basso
  apertura[5] = 85; // GF alto
  apertura[8] = 0; // metrico
  apertura[12] = (startTimeS >>> 24) & 0xff;
  apertura[13] = (startTimeS >>> 16) & 0xff;
  apertura[14] = (startTimeS >>> 8) & 0xff;
  apertura[15] = startTimeS & 0xff;
  apertura[20] = 21; // prima miscela: aria
  rec.push(apertura);

  const campione = new Array(R).fill(0);
  campione[0] = 0x01;
  campione[1] = (depthDm >> 8) & 0xff;
  campione[2] = depthDm & 0xff;
  rec.push(campione);

  const chiusura = new Array(R).fill(0);
  chiusura[0] = 0x20;
  rec.push(chiusura);

  const finale = new Array(R).fill(0);
  finale[0] = 0xff;
  rec.push(finale);

  return Uint8Array.from(rec.flat());
}
