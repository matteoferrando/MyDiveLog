/**
 * Il protocollo Shearwater: Petrel, Perdix, Teric, **Peregrine**, Tern.
 *
 * Riscritto da `libdivecomputer` (`shearwater_common.c`, `shearwater_petrel.c`),
 * che è l'unica descrizione pubblica esistente — Shearwater non documenta
 * niente. Ogni scelta strana qui sotto viene da lì e porta il riferimento.
 *
 * QUATTRO STRATI, uno dentro l'altro, e serve tenerli distinti perché ognuno
 * fallisce in un modo suo:
 *
 *  1. **Le notifiche BLE**, venti byte l'una. Su questo trasporto — e solo su
 *     questo — ogni notifica porta due byte di intestazione: quante notifiche
 *     compongono il messaggio, e questa che numero è.
 *  2. **SLIP** (RFC 1055): i pacchetti sono separati da `0xC0`, e i byte che
 *     valgono `0xC0` o `0xDB` dentro il pacchetto vengono sostituiti da due
 *     byte. Un pacchetto SLIP può attraversare più notifiche, e più pacchetti
 *     possono stare nella stessa notifica.
 *  3. **Il pacchetto di trasporto**: `FF 01 <len+1> 00 <payload>` in richiesta,
 *     `01 FF <len+1> 00 <payload>` in risposta. Sì, i primi due byte sono
 *     scambiati fra le due direzioni.
 *  4. **I comandi**, che sono di due famiglie: leggere un identificativo
 *     (`RDBI`, tipo Modbus) e scaricare un blocco di memoria (`UPLOAD`).
 *
 * L'ULTIMO STRATO È LA COMPRESSIONE, e va spiegata perché è insolita. Le
 * immersioni arrivano compresse con due passaggi in cascata: un RLE che lavora
 * su valori da NOVE bit — il nono dice se gli altri otto sono un byte o la
 * lunghezza di una sequenza di zeri — e sopra un XOR a blocchi di 32 byte con
 * il blocco precedente. Vanno disfatti nell'ordine inverso: prima si accumula
 * tutto il flusso RLE, poi si passa l'XOR su tutto quanto. Farlo blocco per
 * blocco darebbe dati plausibili e sbagliati.
 *
 * COSA RESTA DA VERIFICARE COL COMPUTER IN MANO: tutto. Questo file non ha mai
 * parlato con un Peregrine. Ha parlato con un finto Peregrine che rispetta le
 * stesse regole, che è una cosa diversa e più debole. I punti su cui scommetto
 * meno sono segnati con «⚠️».
 */

import type { GasMix, Sample } from '../../model';
import { decodePnf, type PnfLog } from '../../parsers/shearwaterPnf';
import { computeMetrics } from '../../analysis/metrics';
import { diveIdFor } from '../../dedupe';
import type { Cylinder, Dive, DiveMode, Salinity } from '../../model';
import { nameStartsWith } from '../registry';
import type { BleLink, DiveComputerDriver, DownloadedRecord } from '../types';

// --------------------------------------------------------------------- SLIP

const END = 0xc0;
const ESC = 0xdb;
const ESC_END = 0xdc;
const ESC_ESC = 0xdd;

/** Byte per notifica su questo trasporto. Fisso, non negoziato: vedi sotto. */
const FRAME = 20;

/*
 * VENTI BYTE FISSI, anche quando l'MTU è più grande.
 *
 * `shearwater_common_slip_write` usa `BLE_MTU_MIN` — cioè 20 — per la
 * dimensione dei frammenti, sempre, indipendentemente da quanto il
 * collegamento abbia negoziato. Non è una svista di libdivecomputer: il
 * contatore «di quante notifiche è fatto questo messaggio» che sta nel primo
 * byte viene calcolato su quella dimensione, e il firmware lo usa per sapere
 * quando ha finito di ricevere. Mandare frammenti più grandi farebbe tornare un
 * conto diverso dal suo.
 */

const RDBI_REQUEST = 0x22;
const RDBI_RESPONSE = 0x62;
const UPLOAD_INIT_REQUEST = 0x35;
const UPLOAD_INIT_RESPONSE = 0x75;
const UPLOAD_DATA_REQUEST = 0x36;
const UPLOAD_DATA_RESPONSE = 0x76;
const UPLOAD_EXIT_REQUEST = 0x37;
const UPLOAD_EXIT_RESPONSE = 0x77;
const NAK = 0x7f;

/** Gli identificativi leggibili con RDBI (`shearwater_common.h`). */
const ID_SERIAL = 0x8010;
const ID_FIRMWARE = 0x8011;
const ID_LOGUPLOAD = 0x8021;
const ID_MODEL = 0x8060;

const MANIFEST_ADDR = 0xe0000000;
const MANIFEST_SIZE = 0x600;
const RECORD_SIZE = 0x20;
const RECORD_COUNT = MANIFEST_SIZE / RECORD_SIZE;
/** Si chiede il massimo: è il computer a dire quando il flusso finisce. */
const DIVE_SIZE = 0xffffff;

/** I modelli, dal byte 0x8060 (`shearwater_common.h`). */
const MODELLI: Record<number, string> = {
  2: 'Shearwater Predator',
  3: 'Shearwater Petrel',
  4: 'Shearwater NERD',
  5: 'Shearwater Perdix',
  6: 'Shearwater Perdix AI',
  7: 'Shearwater NERD 2',
  8: 'Shearwater Teric',
  9: 'Shearwater Peregrine',
  10: 'Shearwater Petrel 3',
  11: 'Shearwater Perdix 2',
  12: 'Shearwater Tern',
  13: 'Shearwater Peregrine TX',
  14: 'Shearwater Perdix 3',
};

export class ShearwaterProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShearwaterProtocolError';
  }
}

// ---------------------------------------------------------------- il codificatore

/**
 * Da pacchetto a notifiche BLE, con l'intestazione di ogni notifica.
 *
 * L'intestazione è due byte: il PRIMO è il numero totale di notifiche di cui il
 * messaggio è fatto, il secondo è l'indice di questa. Il totale va quindi
 * calcolato prima di cominciare a scrivere, e su un flusso già SLIP-escaped —
 * perché l'escaping cambia la lunghezza, e con essa il numero di notifiche.
 *
 * Pura: si prova senza Bluetooth, ed è la funzione in cui è più facile
 * sbagliare di uno.
 */
export function slipFrames(payload: Uint8Array, frameSize = FRAME): Uint8Array[] {
  // Prima l'escaping, poi il conteggio: al contrario il totale sarebbe sbagliato
  // esattamente sui pacchetti che contengono un byte da escapare.
  const escaped: number[] = [];
  for (const c of payload) {
    if (c === END) escaped.push(ESC, ESC_END);
    else if (c === ESC) escaped.push(ESC, ESC_ESC);
    else escaped.push(c);
  }
  escaped.push(END);

  const utili = frameSize - 2;
  const nframes = Math.ceil(escaped.length / utili);
  const out: Uint8Array[] = [];
  for (let i = 0; i < nframes; i++) {
    const pezzo = escaped.slice(i * utili, (i + 1) * utili);
    out.push(Uint8Array.from([nframes, i, ...pezzo]));
  }
  return out;
}

/**
 * Da notifiche a pacchetti: toglie l'intestazione, disfa l'escaping, taglia sui
 * separatori.
 *
 * Accumula fra una notifica e l'altra perché un pacchetto può attraversarne
 * parecchie. I pacchetti VUOTI si scartano: il firmware manda separatori
 * ripetuti per accorgersi del rumore sulla linea, e passarli agli strati
 * superiori significherebbe farli inciampare su un pacchetto senza contenuto
 * ogni due comandi (`shearwater_common_slip_read`).
 */
export class SlipDecoder {
  private buf: number[] = [];
  private escaped = false;
  private pronti: Uint8Array[] = [];

  push(frame: Uint8Array): void {
    if (frame.length < 2) {
      throw new ShearwaterProtocolError(
        `Notifica da ${frame.length} byte: su questo trasporto ogni notifica ha due byte di intestazione.`,
      );
    }
    for (let i = 2; i < frame.length; i++) {
      const c = frame[i];
      if (c === END) {
        if (this.escaped) {
          throw new ShearwaterProtocolError('Separatore SLIP dentro una sequenza di escape.');
        }
        if (this.buf.length) {
          this.pronti.push(Uint8Array.from(this.buf));
          this.buf = [];
        }
        continue;
      }
      if (c === ESC) {
        if (this.escaped) {
          throw new ShearwaterProtocolError('Doppio escape SLIP.');
        }
        this.escaped = true;
        continue;
      }
      if (this.escaped) {
        this.escaped = false;
        this.buf.push(c === ESC_END ? END : c === ESC_ESC ? ESC : c);
        continue;
      }
      this.buf.push(c);
    }
  }

  /** Il prossimo pacchetto completo, o `undefined` se ne serve un'altra notifica. */
  next(): Uint8Array | undefined {
    return this.pronti.shift();
  }
}

// ---------------------------------------------------------------- decompressione

/**
 * Il primo passaggio: RLE su valori da nove bit.
 *
 * Il flusso va letto come una sequenza di gruppi da 9 bit, ignorando i confini
 * dei byte. Il bit più alto dice cosa sono gli altri otto: se è acceso, un byte
 * da copiare così com'è; se è spento, quanti zeri inserire. Un gruppo tutto a
 * zero significa che il flusso è finito, e va distinto dal semplice
 * esaurimento dei dati — il primo è la fine dell'immersione, il secondo è la
 * fine di UN BLOCCO e il computer ne manderà ancora.
 *
 * Traduzione di `shearwater_common_decompress_lre`.
 */
export function decompressLre(data: Uint8Array, out: number[]): { final: boolean } {
  const nbits = data.length * 8;
  if (nbits % 9 !== 0) {
    throw new ShearwaterProtocolError(
      `Blocco compresso di ${data.length} byte: non è un multiplo di nove bit, quindi non è il flusso che ci aspettiamo.`,
    );
  }
  for (let offset = 0; offset + 9 <= nbits; offset += 9) {
    const byte = offset >> 3;
    const bit = offset & 7;
    const shift = 16 - (bit + 9);
    const be16 = (data[byte] << 8) | (data[byte + 1] ?? 0);
    const value = (be16 >> shift) & 0x1ff;
    if (value & 0x100) out.push(value & 0xff);
    else if (value === 0) return { final: true };
    else for (let i = 0; i < value; i++) out.push(0);
  }
  return { final: false };
}

/**
 * Il secondo passaggio: XOR a blocchi di 32 byte col blocco precedente.
 *
 * **Su tutto il flusso, dopo averlo raccolto per intero.** Applicarlo blocco
 * per blocco durante lo scarico sembra equivalente e non lo è: il primo blocco
 * di ogni pezzo verrebbe lasciato intatto invece di essere messo in XOR con la
 * fine del pezzo prima, e il risultato sarebbero trentadue byte sbagliati ogni
 * blocco — cioè un log che si decodifica lo stesso, con dentro numeri finti.
 *
 * Traduzione di `shearwater_common_decompress_xor`.
 */
export function decompressXor(data: Uint8Array): Uint8Array {
  for (let i = 32; i < data.length; i++) data[i] ^= data[i - 32];
  return data;
}

// ------------------------------------------------------------------ trasporto

const u16be = (d: Uint8Array, i: number) => (d[i] << 8) | d[i + 1];
const u32be = (d: Uint8Array, i: number) =>
  ((d[i] << 24) >>> 0) + (d[i + 1] << 16) + (d[i + 2] << 8) + d[i + 3];

/**
 * Un comando e la sua risposta.
 *
 * Il pacchetto di richiesta comincia con `FF 01`, quello di risposta con
 * `01 FF`: i primi due byte sono scambiati fra le due direzioni, ed è la sola
 * cosa che distingue un'eco da una risposta.
 */
async function transfer(
  link: BleLink,
  decoder: SlipDecoder,
  input: Uint8Array,
  timeoutMs: number,
  trace?: (l: string) => void,
): Promise<Uint8Array> {
  const packet = Uint8Array.from([0xff, 0x01, input.length + 1, 0x00, ...input]);
  const frames = slipFrames(packet, Math.min(FRAME, link.mtu));
  trace?.(`→ ${esadecimale(input)}  (${frames.length} notifiche)`);
  for (const frame of frames) await link.writeFrame(frame);

  // Si legge finché non esce un pacchetto INTERO: uno SLIP può attraversare
  // parecchie notifiche, e ognuna ha la sua scadenza.
  let risposta = decoder.next();
  let notifiche = 0;
  while (!risposta) {
    const f = await link.readFrame(timeoutMs);
    notifiche++;
    // Le prime notifiche per intero: se l'inquadramento è sbagliato si vede
    // qui e da nessun'altra parte. Poi basta il conteggio.
    if (notifiche <= 3) trace?.(`←   notifica ${esadecimale(f)}`);
    decoder.push(f);
    risposta = decoder.next();
  }
  trace?.(
    `← ${esadecimale(risposta.subarray(0, 12))}${risposta.length > 12 ? `… (${risposta.length} byte)` : ''}`,
  );

  if (risposta.length < 4 || risposta[0] !== 0x01 || risposta[1] !== 0xff || risposta[3] !== 0x00) {
    throw new ShearwaterProtocolError(
      `Intestazione di risposta inattesa: ${[...risposta.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}.`,
    );
  }
  const length = risposta[2] - 1;
  if (length < 0 || length + 4 !== risposta.length) {
    throw new ShearwaterProtocolError(
      `Lunghezza dichiarata ${risposta[2] - 1} ma il pacchetto ne porta ${risposta.length - 4}.`,
    );
  }
  return risposta.subarray(4);
}

/** Legge un identificativo. `undefined` quando il computer risponde «non ce l'ho». */
async function rdbi(
  link: BleLink,
  decoder: SlipDecoder,
  id: number,
  timeoutMs: number,
  trace?: (l: string) => void,
): Promise<Uint8Array | undefined> {
  trace?.(`leggo 0x${id.toString(16)}`);
  const req = Uint8Array.from([RDBI_REQUEST, (id >> 8) & 0xff, id & 0xff]);
  const res = await transfer(link, decoder, req, timeoutMs, trace);
  if (res.length === 3 && res[0] === NAK && res[1] === RDBI_REQUEST) {
    trace?.(`  il computer dice che 0x${id.toString(16)} non ce l'ha (codice 0x${res[2].toString(16)})`);
    return undefined;
  }
  if (res.length < 3 || res[0] !== RDBI_RESPONSE || res[1] !== req[1] || res[2] !== req[2]) {
    throw new ShearwaterProtocolError(
      `Risposta inattesa alla lettura di 0x${id.toString(16)}: ${[...res.slice(0, 4)].join(',')}.`,
    );
  }
  return res.subarray(3);
}

/**
 * Scarica un blocco di memoria, opzionalmente compresso.
 *
 * Tre fasi: si annuncia indirizzo e dimensione, si chiedono i blocchi uno per
 * uno con un contatore che il computer riverifica, si chiude. La chiusura non è
 * una formalità: senza, il computer resta in modalità trasferimento e il
 * comando successivo non viene capito.
 *
 * Traduzione di `shearwater_common_download`.
 */
async function downloadRange(
  link: BleLink,
  decoder: SlipDecoder,
  address: number,
  size: number,
  compressed: boolean,
  timeoutMs: number,
  trace?: (l: string) => void,
): Promise<Uint8Array> {
  trace?.(
    `scarico 0x${address.toString(16)} (${size} byte max, ${compressed ? 'compresso' : 'non compresso'})`,
  );
  const init = Uint8Array.from([
    UPLOAD_INIT_REQUEST,
    compressed ? 0x10 : 0x00,
    0x34,
    (address >>> 24) & 0xff,
    (address >>> 16) & 0xff,
    (address >>> 8) & 0xff,
    address & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
  ]);
  const res = await transfer(link, decoder, init, timeoutMs, trace);
  if (res.length < 2 || res[0] !== UPLOAD_INIT_RESPONSE) {
    throw new ShearwaterProtocolError('Il computer non ha accettato la richiesta di trasferimento.');
  }

  const raccolto: number[] = [];
  let nbytes = 0;
  let block = 1;
  let done = false;
  /*
   * Un tetto al numero di giri.
   *
   * `DIVE_SIZE` è 0xFFFFFF perché è il computer a dire quando il flusso
   * finisce, ma se quel segnale non arriva mai — firmware inatteso, blocco
   * corrotto — questo ciclo non si ferma da solo. Ottomila blocchi sono molto
   * più di qualunque immersione reale e molto meno di un'attesa infinita.
   */
  let giri = 0;
  while (nbytes < size && !done && giri++ < 8000) {
    const req = Uint8Array.from([UPLOAD_DATA_REQUEST, block & 0xff]);
    const blk = await transfer(link, decoder, req, timeoutMs, block <= 2 ? trace : undefined);
    if (blk.length < 2 || blk[0] !== UPLOAD_DATA_RESPONSE || blk[1] !== (block & 0xff)) {
      throw new ShearwaterProtocolError(
        `Blocco ${block} fuori sequenza: il computer ha risposto con ${blk[1]}.`,
      );
    }
    const payload = blk.subarray(2);
    if (compressed) {
      done = decompressLre(payload, raccolto).final;
    } else {
      for (const b of payload) raccolto.push(b);
      if (payload.length === 0) done = true;
    }
    nbytes += payload.length;
    block++;
  }

  trace?.(`  ${block - 1} blocchi, ${nbytes} byte grezzi, ${raccolto.length} decompressi`);
  const quit = await transfer(link, decoder, Uint8Array.from([UPLOAD_EXIT_REQUEST]), timeoutMs, trace);
  if (quit.length !== 2 || quit[0] !== UPLOAD_EXIT_RESPONSE || quit[1] !== 0x00) {
    throw new ShearwaterProtocolError('Il computer non ha chiuso il trasferimento come previsto.');
  }

  const out = Uint8Array.from(raccolto);
  return compressed ? decompressXor(out) : out;
}

// ------------------------------------------------------------------- manifesto

export interface ManifestEntry {
  /** Indirizzo dell'immersione, relativo alla base del logbook. */
  address: number;
  /** I quattro byte che il computer usa come identità dell'immersione. */
  fingerprint: Uint8Array;
}

/**
 * Le immersioni elencate in una pagina di manifesto.
 *
 * Ogni voce è di 32 byte e comincia con `A5C4`. `5A23` marca un'immersione
 * cancellata: si salta ma si CONTA, perché il criterio per sapere se servono
 * altre pagine è «la pagina era piena», e una pagina piena di cancellate è
 * comunque piena. Qualunque altra intestazione significa che la pagina finisce
 * lì.
 */
export function parseManifest(page: Uint8Array): {
  entries: ManifestEntry[];
  deleted: number;
  full: boolean;
} {
  const entries: ManifestEntry[] = [];
  let deleted = 0;
  let offset = 0;
  while (offset + RECORD_SIZE <= page.length) {
    const header = u16be(page, offset);
    if (header === 0x5a23) {
      deleted++;
      offset += RECORD_SIZE;
      continue;
    }
    if (header !== 0xa5c4) break;
    entries.push({
      address: u32be(page, offset + 20),
      fingerprint: page.slice(offset + 4, offset + 8),
    });
    offset += RECORD_SIZE;
  }
  return { entries, deleted, full: entries.length + deleted === RECORD_COUNT };
}

/**
 * Dove comincia il logbook, dedotto dal tipo che il computer dichiara.
 *
 * Tre dei quattro valori possibili vogliono lo stesso indirizzo di ripiego: è
 * il «formato tipo Predator», che alcune versioni di firmware annunciano in tre
 * modi diversi. Un valore sconosciuto NON si tratta come uno di questi: sarebbe
 * leggere memoria a caso.
 */
export function logbookBase(rsp: Uint8Array): number {
  if (rsp.length < 5) {
    throw new ShearwaterProtocolError('Risposta troppo corta sul tipo di logbook.');
  }
  const addr = u32be(rsp, 1);
  if (addr === 0xdd000000 || addr === 0xc0000000 || addr === 0x90000000) return 0xc0000000;
  if (addr === 0x80000000) return 0x80000000;
  throw new ShearwaterProtocolError(
    `Formato di logbook sconosciuto (0x${addr.toString(16)}). Meglio fermarsi che leggere memoria a caso.`,
  );
}

// --------------------------------------------------------------------- driver

const esadecimale = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Quanto si aspetta una notifica. Generoso: il computer a volte pensa. */
const TIMEOUT_MS = 6000;

export const shearwaterDriver: DiveComputerDriver = {
  id: 'shearwater',
  label: 'Shearwater (Peregrine, Perdix, Petrel, Teric, Tern)',
  profile: {
    // `fe25c237-…` è il servizio della famiglia Peregrine/Perdix/Teric/Tern.
    // Il Perdix 3 ne usa un altro (`1aa44039-…`) E un protocollo diverso (V2):
    // non è supportato qui, e riconoscerlo sarebbe peggio che ignorarlo.
    service: 'fe25c237-0ece-443c-b0aa-e02033e7029d',
    // Le caratteristiche si scoprono: vedi `BleServiceProfile`.
    writeType: 'withoutResponse',
  },
  matches: nameStartsWith('peregrine', 'perdix', 'petrel', 'teric', 'tern', 'nerd', 'predator'),

  async download(link, { emit, signal, since, trace }) {
    const decoder = new SlipDecoder();

    /*
     * Prima di tutto si BUTTA quello che c'è in coda.
     *
     * Un collegamento appena aperto può portarsi dietro le notifiche di una
     * sessione precedente che il computer non aveva finito di mandare. Lette
     * come risposta al primo comando, danno un errore di intestazione — che è
     * il caso fortunato — oppure un numero plausibile.
     */
    const residui = link.drain();
    if (residui.length) trace(`in coda all'apertura, buttati: ${esadecimale(residui.subarray(0, 20))}`);

    const serial = await rdbi(link, decoder, ID_SERIAL, TIMEOUT_MS, trace);
    const firmware = await rdbi(link, decoder, ID_FIRMWARE, TIMEOUT_MS, trace);
    const model = await rdbi(link, decoder, ID_MODEL, TIMEOUT_MS, trace);
    const modelNumber = model?.[0];

    emit({
      kind: 'identified',
      model: (modelNumber !== undefined && MODELLI[modelNumber]) || 'Shearwater',
      serial: serial ? String(u32be(serial, 0)) : undefined,
      // ⚠️ Il firmware è testo ASCII, e libdivecomputer lo converte in numero
      // con una funzione sua. Qui si mostra la stringa: se arriva sporca si
      // vede subito, mentre un numero sbagliato passerebbe inosservato.
      firmware: firmware ? new TextDecoder().decode(firmware).replace(/\0+$/, '').trim() : undefined,
    });

    const tipo = await rdbi(link, decoder, ID_LOGUPLOAD, TIMEOUT_MS, trace);
    if (!tipo) throw new ShearwaterProtocolError('Il computer non dichiara il tipo di logbook.');
    const base = logbookBase(tipo);
    trace(`base del logbook: 0x${base.toString(16)}`);

    /*
     * Il manifesto, una pagina alla volta.
     *
     * Il computer restituisce SEMPRE lo stesso indirizzo e avanza da sé: si
     * continua a chiedere finché una pagina non torna incompleta. `since` è
     * l'impronta dell'ultima immersione già in archivio, e quando la si
     * incontra si smette — è il motivo per cui il secondo scarico dura secondi
     * invece di minuti.
     */
    const voci: ManifestEntry[] = [];
    let pagine = 0;
    let fermato = false;
    while (!fermato && pagine++ < 64) {
      if (signal.aborted) break;
      const page = await downloadRange(
        link,
        decoder,
        MANIFEST_ADDR,
        MANIFEST_SIZE,
        false,
        TIMEOUT_MS,
        pagine <= 1 ? trace : undefined,
      );
      const { entries, deleted, full } = parseManifest(page);
      trace(
        `manifesto ${pagine}: ${entries.length} voci, ${deleted} cancellate, ${full ? 'piena' : 'ultima'}`,
      );
      for (const e of entries) {
        if (since && esadecimale(e.fingerprint) === since) {
          fermato = true;
          break;
        }
        voci.push(e);
      }
      if (!full) break;
    }

    emit({ kind: 'counted', total: voci.length });

    const out: DownloadedRecord[] = [];
    for (let i = 0; i < voci.length; i++) {
      if (signal.aborted) break;
      const v = voci[i];
      const key = esadecimale(v.fingerprint);
      try {
        const bytes = await downloadRange(
          link,
          decoder,
          base + v.address,
          DIVE_SIZE,
          true,
          TIMEOUT_MS,
          // Solo la prima immersione nel diario per intero: le altre
          // ripeterebbero le stesse righe cento volte.
          i === 0 ? trace : undefined,
        );
        trace(`immersione ${key}: ${bytes.length} byte`);
        const record = { key, bytes };
        out.push(record);
        emit({ kind: 'record', done: i + 1, total: voci.length, record });
      } catch (err) {
        /*
         * Un'immersione illeggibile non ferma le altre — ma solo se è LEI a
         * essere illeggibile. Se il collegamento è caduto, insistere significa
         * generare novantanove errori identici e far sembrare rotto l'archivio
         * invece del Bluetooth.
         */
        const messaggio = err instanceof Error ? err.message : String(err);
        emit({ kind: 'skipped', key, reason: messaggio });
        if (!(err instanceof ShearwaterProtocolError)) throw err;
      }
    }
    return out;
  },

  decode(records) {
    const dives: Dive[] = [];
    const warnings: string[] = [];
    const importedAt = new Date().toISOString();
    for (const r of records) {
      try {
        dives.push(buildDive(decodePnf(r.bytes), r.key, importedAt, warnings));
      } catch (err) {
        warnings.push(
          `Immersione ${r.key} scaricata ma non decodificabile: ${err instanceof Error ? err.message : String(err)}.`,
        );
      }
    }
    return { dives, warnings };
  },
};

/**
 * Da log nativo a immersione.
 *
 * Molto più povera di quella che costruisce il parser di Shearwater Cloud, e la
 * ragione è che il computer NON HA quei dati: sito, compagno, note, zavorra,
 * muta sono campi dell'applicazione, non del logbook. Qui c'è solo quello che
 * il computer ha misurato — che è poi la parte che nessun altro può dare.
 *
 * L'identificativo è `diveIdFor`, lo stesso che usano gli import da file:
 * scaricare via Bluetooth un'immersione che si ha già da un file la FONDE
 * invece di duplicarla, e le note scritte a mano restano.
 */
function buildDive(log: PnfLog, key: string, importedAt: string, warnings: string[]): Dive {
  if (log.startTimeS === undefined) {
    throw new Error("il log non porta l'orario di inizio, quindi l'immersione non è collocabile nel tempo");
  }
  const startTime = new Date(log.startTimeS * 1000).toISOString();
  const samples: Sample[] = log.samples;

  /*
   * IL MASSIMO FRA IL BLOCCO DI CHIUSURA E I CAMPIONI, non l'uno o l'altro.
   *
   * Il blocco di chiusura porta la profondità che il computer ha visto
   * campionando al secondo, quindi è più preciso del massimo dei campioni
   * salvati ogni dieci — è il motivo per cui viene preferito. Ma su un log
   * troncato quel blocco può essere tutto a zero, e `?? ` non intercetta lo
   * zero: l'immersione entrava in archivio a ZERO METRI con un profilo che
   * arrivava a ventitré, e da lì in poi ogni statistica su quella immersione
   * era sbagliata senza un solo errore a schermo. Il test col log sintetico l'ha
   * trovato al primo giro.
   *
   * Il massimo dei due è giusto in entrambi i sensi: quando il blocco c'è vince
   * quasi sempre lui perché è più fine, quando manca vincono i campioni.
   */
  const daiCampioni = samples.length ? Math.max(...samples.map((s) => s.depth)) : 0;
  const maxDepth = Math.max(log.maxDepth ?? 0, daiCampioni);
  const durationS = Math.max(log.durationS ?? 0, samples.length ? samples[samples.length - 1].t : 0);

  const cylinders: Cylinder[] = log.gases.length
    ? log.gases.map((mix: GasMix, i) => ({
        mix,
        startBar: log.tanks[i]?.startBar,
        endBar: log.tanks[i]?.endBar,
      }))
    : [{ mix: { o2: 0.21, he: 0 } }];

  const mode: DiveMode =
    log.settings.mode && /ccr|closed/i.test(log.settings.mode)
      ? 'ccr'
      : log.settings.mode && /scr/i.test(log.settings.mode)
        ? 'scr'
        : log.settings.mode && /gauge/i.test(log.settings.mode)
          ? 'gauge'
          : 'oc';

  // Il computer dichiara la densità impostata, non la salinità dell'acqua vera:
  // sotto i 1010 kg/m³ è certamente acqua dolce, sopra è impostato «mare» — che
  // in lago è l'errore d'impostazione più comune, non una misura.
  const salinity: Salinity =
    log.settings.waterDensity !== undefined && log.settings.waterDensity < 1010 ? 'fresh' : 'salt';

  const base: Omit<Dive, 'id'> = {
    startTime,
    durationS,
    maxDepth,
    mode,
    cylinders,
    salinity,
    surfacePressureBar: log.settings.surfacePressureBar,
    computer: {
      model: log.computer.model,
      serial: log.computer.serial,
      firmware: log.computer.firmware,
      decoModel: log.settings.decoModel,
      gfLow: log.settings.gfLow,
      gfHigh: log.settings.gfHigh,
      conservatism: log.settings.conservatism,
      waterDensityKgM3: log.settings.waterDensity,
      sampleIntervalS: log.settings.sampleIntervalS,
      aiMode: log.settings.aiMode,
      computerMode: log.settings.mode,
    },
    /*
     * Il GPS del computer dà le coordinate, non il nome.
     *
     * `DiveSite` vuole un nome, e inventarne uno («Immersione del 14 giugno»)
     * riempirebbe la colonna «sito» del logbook di etichette che non sono siti
     * e che poi vanno cancellate a mano una per una. Un nome vuoto è più
     * onesto: le coordinate ci sono, la mappa le usa, e il nome lo mette chi
     * sa dov'era.
     */
    site: log.entry ? { name: '', lat: log.entry.lat, lon: log.entry.lon } : undefined,
    source: { format: 'shearwater-ble', file: `bluetooth:${key}`, importedAt },
    tags: [],
    events: log.bookmarks.length ? log.bookmarks.map((m) => ({ t: m.t, bearing: m.bearing })) : undefined,
    samples,
  };

  for (const n of log.notes) warnings.push(`${startTime.slice(0, 10)}: ${n}`);

  const dive: Dive = { ...base, id: diveIdFor(base) };
  dive.metrics = computeMetrics(dive);
  return dive;
}
