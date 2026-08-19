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
    await new Promise<void>((risolvi) => signal.addEventListener('abort', () => risolvi(), { once: true }));
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
