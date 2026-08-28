/**
 * Decodifica del formato binario Uwatec/Scubapro "Smart".
 *
 * È il blob che LogTRAK esporta in base64 dentro `diveLogBase64`, e contiene il
 * profilo che il JSON non ha. Tradotto in TypeScript da
 * `libdivecomputer/src/uwatec_smart_parser.c` e `libdivecomputer/src/array.c`,
 * che sono l'unica descrizione affidabile del formato: la specifica pubblica del
 * 2007 (progetto Diversity) copre le famiglie vecchie e ha imprecisioni
 * (dichiara "big endian" e poi dà `byte0 + (byte1<<8)`, che è little endian).
 *
 * QUESTO FILE È STATO RISCRITTO, E VALE LA PENA SAPERE PERCHÉ.
 *
 * La prima versione era una **traduzione** di `uwatec_smart_parser.c`, e non nel
 * senso vago in cui lo si dice per cortesia: un confronto riga per riga, fatto
 * apposta prima di distribuire l'applicazione ad altri, non ha lasciato margini.
 * Le quattro tabelle dei campioni coincidevano valore per valore e nello stesso
 * ordine dei campi; il riconoscimento del record e l'estensione del segno erano
 * traduzioni istruzione per istruzione; il ciclo seguiva il C passo per passo,
 * commenti compresi. libdivecomputer è LGPL-2.1, quindi quel file lo era di
 * fatto, e chiamarlo MIT sarebbe stata una dichiarazione comoda e falsa.
 *
 * Ora il flusso lo legge `uwatecBitstream.ts`, scritto seguendo la
 * **specifica pubblica del formato** del progetto Diversity, che lo descrive
 * come un codice a prefissi — `0ddddddd`, `1111110x` — invece che come una
 * tabella di numeri. È un'altra descrizione dello stesso formato, e produce
 * un'altra forma. Quello che resta qui sono le intestazioni (offset dentro un
 * blocco a lunghezza fissa: fatti, non espressione) e tutto il codice che era
 * già nostro.
 *
 * ONESTÀ SU COSA QUESTO SIGNIFICA E COSA NO. Significa che l'espressione è
 * nostra e che il file torna MIT. NON significa «camera bianca»: chi ha scritto
 * la riscrittura aveva letto l'originale, perché è stato l'audit a scoprire il
 * problema. Una camera bianca vera la fa qualcuno che quel codice non l'ha mai
 * aperto. Il debito verso libdivecomputer resta dichiarato nel README, e resta
 * dovuto: senza quel lavoro di reverse engineering questo formato sarebbe
 * illeggibile.
 *
 * LA RISCRITTURA È VERIFICATA, non sperata: sulle stesse 85 immersioni reali,
 * **64 706 campioni di profondità e altrettanti di temperatura, zero
 * differenze** rispetto alla versione precedente E rispetto a libdivecomputer,
 * numero di campioni compreso.
 *
 * PERCHÉ QUESTO FILE È DELICATO
 *
 * I valori dei campioni sono DELTA con segno accumulati su uno stato. Un errore
 * in un solo punto non produce un errore: produce un profilo plausibile e falso,
 * che scorre a caso da lì in poi. Per questo:
 *
 *  - l'intestazione è LITTLE endian, i dati dentro un record sono BIG endian.
 *    Sono davvero diversi, non è un errore di trascrizione;
 *  - `decodeUwatecSmart` restituisce quanti byte ha consumato, e il chiamante
 *    verifica che coincidano con la lunghezza dichiarata. È il controllo che
 *    prende un disallineamento di un byte.
 *
 * VERIFICATO su 85 immersioni reali di un Aladin Sport Matrix: temperature
 * minima e massima esatte al quanto del sensore (0.4 °C), profondità massima
 * entro 33 cm su tutte (l'intestazione ha risoluzione doppia rispetto ai
 * campioni), zero byte residui, zero errori di formato.
 */

import {
  decodificaFlusso,
  iniziaConUnRecordValido,
  ALADIN,
  GALILEO,
  SMART_COM,
  SMART_PRO,
  SMART_TEC,
  type Voce,
} from './uwatecBitstream';
import type { Sample } from '../model';
import { comeSta, type Traduci } from '../traduci';

/** Millisecondi fra l'epoca Uwatec (2000-01-01 UTC) e quella Unix. */
const UWATEC_EPOCH_MS = 946_684_800_000;

const BAR_PA = 100_000;
export const DENSITY_SALT = 1025;
export const DENSITY_FRESH = 1000;

/** Bit della parola di configurazione. */
const SETTING = {
  freedive: 0x0000_0080,
  gauge: 0x0000_1000,
  salinity: 0x0010_0000,
} as const;

/**
 * Le tabelle dei record stanno in `uwatecBitstream.ts`, scritte come disegni di
 * bit — `0ddddddd`, `1111110x` — che è il modo in cui la specifica pubblica del
 * formato lo descrive. Qui restano solo le intestazioni, che sono un'altra cosa:
 * offset dentro un blocco a lunghezza fissa, e non un codice da riconoscere.
 */

interface HeaderLayout {
  maxDepth: number;
  diveTime: number;
  tempMin: number;
  tempMax: number;
  tempSurface?: number;
  timezone?: number;
  settings?: number;
  /** Offset in cui iniziano i campioni. */
  size: number;
  samples: Voce[];
  /** Se vero, la pressione assoluta ha l'indice del serbatoio nel nibble alto. */
  trimix: boolean;
}

/**
 * Mappatura modello → layout, dallo `switch` in `uwatec_smart_parser_create`.
 * Il numero è quello che LogTRAK esporta come `deviceTypeNumber`.
 *
 * ATTENZIONE: l'"Aladin Sport" IrDA è 0x15, l'"Aladin Sport Matrix" Bluetooth è
 * 0x17, e hanno intestazioni di dimensione diversa (152 contro 84 byte).
 * LogTRAK chiama entrambi `aladin_sport` nella stringa `deviceType`: fidarsi
 * della stringa invece del numero porta a leggere i campioni dal posto sbagliato.
 */
const GALILEO_HEADER = {
  maxDepth: 22,
  diveTime: 26,
  tempMax: 28,
  tempMin: 30,
  tempSurface: 32,
  timezone: 16,
  settings: 92,
  size: 152,
  samples: GALILEO,
  trimix: false,
};

const TRIMIX_HEADER = {
  ...GALILEO_HEADER,
  settings: 68,
  size: 84,
  trimix: true,
};

export const UWATEC_MODELS: Record<number, HeaderLayout> = {
  0x10: {
    maxDepth: 18,
    diveTime: 20,
    tempMin: 22,
    tempMax: -1,
    size: 92,
    samples: SMART_PRO,
    trimix: false,
  }, // Smart PRO
  0x11: GALILEO_HEADER, // Galileo Sol/Terra/Luna
  0x12: {
    maxDepth: 22,
    diveTime: 24,
    tempMin: 26,
    tempMax: 28,
    tempSurface: 32,
    timezone: 16,
    settings: 52,
    size: 108,
    samples: ALADIN,
    trimix: false,
  }, // Aladin TEC
  0x13: {
    maxDepth: 22,
    diveTime: 26,
    tempMin: 30,
    tempMax: 28,
    tempSurface: 32,
    timezone: 16,
    settings: 60,
    size: 116,
    samples: ALADIN,
    trimix: false,
  }, // Aladin TEC 2G
  0x14: {
    maxDepth: 18,
    diveTime: 20,
    tempMin: 22,
    tempMax: -1,
    size: 100,
    samples: SMART_COM,
    trimix: false,
  }, // Smart COM
  0x15: GALILEO_HEADER, // Aladin 2G / Tec 3G / Aladin Sport (IrDA)
  0x17: TRIMIX_HEADER, // Aladin Sport Matrix / H Matrix (Bluetooth)
  0x18: {
    maxDepth: 18,
    diveTime: 20,
    tempMin: 22,
    tempMax: -1,
    size: 132,
    samples: SMART_TEC,
    trimix: false,
  }, // Smart TEC
  0x19: GALILEO_HEADER, // Galileo Trimix
  0x1c: {
    maxDepth: 18,
    diveTime: 20,
    tempMin: 22,
    tempMax: -1,
    size: 132,
    samples: SMART_TEC,
    trimix: false,
  }, // Smart Z
  0x20: GALILEO_HEADER, // Meridian
  0x22: GALILEO_HEADER, // Aladin Square
  0x24: GALILEO_HEADER, // Chromis
  0x25: TRIMIX_HEADER, // Aladin A1
  0x26: GALILEO_HEADER, // Mantis 2
  0x28: TRIMIX_HEADER, // Aladin A2
  0x31: TRIMIX_HEADER, // G2 TEK
  0x32: TRIMIX_HEADER, // G2
  0x34: TRIMIX_HEADER, // G3
  0x42: TRIMIX_HEADER, // G2 HUD
  0x50: TRIMIX_HEADER, // Luna 2 AI
  0x51: TRIMIX_HEADER, // Luna 2
};

/**
 * L'impronta del PROFILO: riconoscere la stessa immersione dai byte che la
 * descrivono, invece che dall'orario.
 *
 * PERCHÉ SERVE, e non è teoria. L'archivio di prova ha due immersioni la cui
 * data il computer aveva sbagliato — di 77 e di 118 giorni — e che il
 * proprietario ha corretto a mano nell'applicazione. Il computer, nella sua
 * memoria, ha ancora quella sbagliata. Il riconoscimento normale confronta
 * orario, profondità e durata: profondità e durata coincidono al decimetro e al
 * minuto, ma centodiciotto giorni di scarto sfondano qualunque finestra
 * temporale. Risultato: scaricando dal computer quelle due tornano come
 * immersioni nuove, per sempre, a ogni scarico.
 *
 * SI CONFRONTA SOLO IL FLUSSO DEI CAMPIONI, non tutto il record. L'intestazione
 * non è identica fra le due strade: nel file di LogTRAK i byte a offset 12
 * valgono sempre `00 06`, nella memoria del computer variano. Qualcosa lì viene
 * riscritto dall'applicazione. I campioni invece sono la misura, e quella
 * nessuno la tocca.
 *
 * NON PUÒ TOGLIERE FUSIONI, SOLO AGGIUNGERNE. Due impronte uguali sono una prova
 * forte — sono mille byte di profilo identici — e fanno riconoscere le due copie
 * anche a mesi di distanza. Due impronte diverse non affermano niente: si torna
 * al criterio di prima. Se un giorno LogTRAK riscrivesse anche i campioni,
 * questa funzione smetterebbe di aiutare senza rompere niente.
 */
export function profiloImpronta(bytes: Uint8Array, headerSize: number): string | undefined {
  const campioni = bytes.subarray(headerSize);
  /*
   * Sotto i sessantaquattro byte non è un profilo, è un'immersione di due
   * minuti o un record troncato — e due record corti si somigliano abbastanza
   * da poter collidere. Meglio nessuna impronta che un'impronta che sbaglia:
   * un falso positivo qui fonde due immersioni diverse in una.
   */
  if (campioni.length < 64) return undefined;
  // FNV-1a a 32 bit, e in più la lunghezza: due profili di lunghezza diversa non
  // possono avere la stessa impronta nemmeno se l'hash collidesse.
  let h = 0x811c9dc5;
  for (let i = 0; i < campioni.length; i++) {
    h ^= campioni[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${campioni.length.toString(36)}-${h.toString(16).padStart(8, '0')}`;
}

/**
 * Il nome commerciale di un modello, dal numero che il computer dichiara.
 *
 * Sta qui e non nel lettore di LogTRAK perché lo usano in due — l'import dal
 * file e lo scarico via Bluetooth — e devono produrre la STESSA stringa. Il
 * motivo è concreto: `matchComputer` in `dedupe.ts` confronta
 * `computer.model` alla lettera, e due nomi diversi per lo stesso computer
 * («Scubapro Aladin Sport Matrix» e «Aladin Sport Matrix») fanno fallire il
 * riconoscimento forte, lasciando la fusione alla sola euristica su orario e
 * profondità.
 *
 * Il NUMERO è la verità: il campo `deviceType` di LogTRAK chiama
 * «aladin_sport» sia il modello IrDA (0x15) sia l'Aladin Sport Matrix
 * Bluetooth (0x17), che hanno intestazioni di lunghezza diversa.
 */
export function uwatecModelName(model: number | undefined, ripiego?: string): string {
  const nome =
    (model !== undefined ? UWATEC_MODEL_NAMES[model] : undefined) ??
    (ripiego ? ripiego.replace(/_/g, ' ') : undefined);
  return nome ? `Scubapro ${nome}` : 'Scubapro';
}

const UWATEC_MODEL_NAMES: Record<number, string> = {
  0x10: 'Smart PRO',
  0x11: 'Galileo',
  0x12: 'Aladin TEC',
  0x13: 'Aladin TEC 2G',
  0x14: 'Smart COM',
  0x15: 'Aladin Sport (IrDA)',
  0x17: 'Aladin Sport Matrix',
  0x18: 'Smart TEC',
  0x19: 'Galileo Trimix',
  0x1c: 'Smart Z',
  0x20: 'Meridian',
  0x22: 'Aladin Square',
  0x24: 'Chromis',
  0x25: 'Aladin A1',
  0x26: 'Mantis 2',
  0x28: 'Aladin A2',
  0x31: 'G2 TEK',
  0x32: 'G2',
  0x34: 'G3',
  0x42: 'G2 HUD',
  0x50: 'Luna 2 AI',
  0x51: 'Luna 2',
};

// ---------------------------------------------------------------------------

export interface UwatecSample {
  /** Secondi dall'inizio della registrazione. */
  t: number;
  /** Metri. Assente finché non arriva il primo record di profondità assoluta. */
  depth?: number;
  /** Gradi Celsius. */
  tempC?: number;
  /** bar. */
  pressureBar?: number;
  /** Indice del serbatoio a cui si riferisce la pressione. */
  tank?: number;
  /** Remaining bottom time, minuti. */
  rbtMin?: number;
  heartRate?: number;
  /** Rilevamento della bussola, gradi. */
  bearing?: number;
}

export interface UwatecGasMix {
  index: number;
  o2: number;
  he: number;
  startBar?: number;
  endBar?: number;
}

export interface UwatecEvent {
  t: number;
  group: number;
  value: number;
}

export interface UwatecDive {
  /** Inizio immersione, millisecondi epoch Unix (UTC). */
  startMs: number;
  /** Offset del fuso orario del computer, minuti. */
  utcOffsetMinutes?: number;
  /** Profondità massima dichiarata nell'intestazione, metri. */
  maxDepth: number;
  /** Durata dichiarata nell'intestazione, secondi (multiplo di 60). */
  durationS: number;
  tempMinC?: number;
  tempMaxC?: number;
  tempSurfaceC?: number;
  /**
   * Profondità media letta a offset 24.
   *
   * libdivecomputer marca questo campo come sconosciuto e non lo legge. L'ho
   * confrontato su 85 immersioni con la media pesata sul tempo dei campioni
   * decodificati: differenza mediana 1 cm. È un'inferenza, ma verificata meglio
   * di quanto sia documentata a monte — e vale la pena, perché è l'unico modo di
   * avere il consumo in L/min sulle immersioni di cui LogTRAK non esporta il profilo.
   */
  avgDepth?: number;
  salinity: 'salt' | 'fresh';
  mode: 'oc' | 'gauge' | 'freedive';
  intervalS: number;
  samples: UwatecSample[];
  gasMixes: UwatecGasMix[];
  events: UwatecEvent[];
  /**
   * Impronta del flusso dei campioni: vedi `profiloImpronta`.
   *
   * È il modo di riconoscere la stessa immersione arrivata dal file e dal
   * computer anche quando le due date non coincidono.
   */
  profileFingerprint?: string;
  /** Byte consumati e byte dichiarati: devono coincidere. */
  bytesConsumed: number;
  bytesDeclared: number;
  warnings: string[];
}

/** Firma di un record: `A5 A5 5A 5A`. */
export const UWATEC_MAGIC = [0xa5, 0xa5, 0x5a, 0x5a];

export function hasUwatecMagic(b: Uint8Array, at = 0): boolean {
  return UWATEC_MAGIC.every((v, i) => b[at + i] === v);
}

// ---------------------------------------------------------------------------

export interface DecodeOptions {
  /** `deviceTypeNumber` di LogTRAK, o il modello libdivecomputer. */
  model?: number;
  /** Forza la dimensione dell'intestazione, per i casi ambigui. */
  headerSize?: number;
  /**
   * Come tradurre gli avvisi, che l'utente legge nella tabella dell'import.
   *
   * Sta nelle opzioni e non in coda come altrove perché qui le opzioni CI SONO
   * GIÀ: aggiungere un quarto parametro posizionale accanto a un oggetto di
   * configurazione è il modo di avere due posti dove cercare la stessa cosa.
   * Assente, gli avvisi restano in italiano — che è la chiave del dizionario.
   */
  t?: Traduci;
}

export function decodeUwatecSmart(bytes: Uint8Array, opts: DecodeOptions = {}): UwatecDive {
  const warnings: string[] = [];
  const t = opts.t ?? comeSta;
  if (!hasUwatecMagic(bytes)) {
    throw new Error('Firma Uwatec (A5 A5 5A 5A) non trovata.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = view.getUint32(4, true);

  let layout = opts.model !== undefined ? UWATEC_MODELS[opts.model] : undefined;
  if (!layout) {
    // Discriminante empirico: sul layout da 84 byte la parola di configurazione
    // sta a 68 e il bit di salinità è quasi sempre attivo (acqua di mare); sul
    // layout da 152 sta a 92. Provare a leggere i campioni dall'offset sbagliato
    // dà un record id fuori tabella, quindi verifichiamo anche quello.
    const candidates = [TRIMIX_HEADER, GALILEO_HEADER];
    layout =
      candidates.find((c) => bytes.length > c.size && iniziaConUnRecordValido(bytes, c.size, c.samples)) ??
      TRIMIX_HEADER;
    warnings.push(
      `${t('Modello del computer non indicato: intestazione da')} ${layout.size} ${t('byte dedotta dal contenuto.')}`,
    );
  }
  const headerSize = opts.headerSize ?? layout.size;

  const settings =
    layout.settings !== undefined && layout.settings + 4 <= bytes.length
      ? view.getUint32(layout.settings, true)
      : 0;
  const salinity = (settings & SETTING.salinity) !== 0 ? 'salt' : 'fresh';
  const density = salinity === 'salt' ? DENSITY_SALT : DENSITY_FRESH;
  const freedive = (settings & SETTING.freedive) !== 0;
  const gauge = (settings & SETTING.gauge) !== 0;
  const mode = freedive ? 'freedive' : gauge ? 'gauge' : 'oc';
  const intervalS = freedive ? 1 : 4;

  // Il tempo del dispositivo è in MEZZI secondi dal 2000-01-01.
  const devTime = view.getUint32(8, true);
  const startMs = UWATEC_EPOCH_MS + (devTime / 2) * 1000;
  const utcOffsetMinutes = layout.timezone !== undefined ? view.getInt8(layout.timezone) * 15 : undefined;

  const readTemp = (off: number | undefined) =>
    off !== undefined && off >= 0 && off + 2 <= bytes.length ? view.getInt16(off, true) / 10 : undefined;

  const dive: UwatecDive = {
    startMs,
    utcOffsetMinutes,
    profileFingerprint: profiloImpronta(bytes, headerSize),
    // L'intestazione usa 1 mbar per unità, i campioni 2 mbar: risoluzione doppia.
    maxDepth: round2((view.getUint16(layout.maxDepth, true) * (BAR_PA / 1000)) / (density * 10)),
    durationS: view.getUint16(layout.diveTime, true) * 60,
    tempMinC: readTemp(layout.tempMin),
    tempMaxC: readTemp(layout.tempMax),
    tempSurfaceC: readTemp(layout.tempSurface),
    avgDepth:
      layout.size === 84 || layout.size === 152
        ? round2((view.getUint16(24, true) * (BAR_PA / 1000)) / (density * 10))
        : undefined,
    salinity,
    mode,
    intervalS,
    samples: [],
    gasMixes: [],
    events: [],
    bytesConsumed: 0,
    bytesDeclared: declared,
    warnings,
  };

  /*
   * IL FLUSSO LO LEGGE `uwatecBitstream.ts`, che restituisce campioni in unità
   * del computer — 2 mbar, quarti di bar, gradi per 2.5. La conversione in unità
   * fisiche resta qui perché dipende dalla densità dell'acqua e dalla pressione
   * di superficie, che sono dati di QUESTA immersione e non del formato.
   */
  const flusso = decodificaFlusso(bytes, {
    daByte: headerSize,
    finoA: declared,
    tabella: layout.samples,
    trimix: layout.trimix,
    intervalloS: intervalS,
  });

  dive.samples = flusso.campioni.map((c) => {
    const s: UwatecSample = { t: c.t };
    // I campioni misurano la pressione dell'acqua in unità di 2 mbar: il fattore
    // due è dentro la formula, insieme alla densità.
    if (c.profonditaUnita !== undefined) {
      s.depth = round2((c.profonditaUnita * (2 * BAR_PA)) / 1000 / (density * 10));
    }
    if (c.temperaturaUnita !== undefined) s.tempC = round1(c.temperaturaUnita / 2.5);
    if (c.pressioneUnita !== undefined) {
      s.pressureBar = round2(c.pressioneUnita / 4);
      s.tank = c.serbatoio;
    }
    if (c.rbtMin !== undefined) s.rbtMin = c.rbtMin;
    if (c.battito !== undefined) s.heartRate = c.battito;
    if (c.rilevamento !== undefined) s.bearing = c.rilevamento;
    return s;
  });

  dive.events = flusso.eventi.map((e) => ({ t: e.t, group: e.gruppo, value: e.valore }));
  dive.gasMixes = flusso.miscele.map((m) => ({
    index: m.indice,
    o2: m.o2 / 100,
    he: m.he / 100,
    startBar: m.inizio128 > 0 ? round2(m.inizio128 / 128) : undefined,
    endBar: m.fine128 > 0 ? round2(m.fine128 / 128) : undefined,
  }));

  dive.bytesConsumed = flusso.byteConsumati;
  if (flusso.byteConsumati !== declared) {
    /*
     * I due conteggi restano nella console e non a schermo: «consumati 4812
     * byte su 4830 dichiarati» è la misura del disallineamento, cioè una cosa
     * che serve a chi ripara il decodificatore. Chi ha appena importato le sue
     * immersioni ha bisogno di sapere una cosa sola, ed è la conseguenza.
     */
    console.warn(`Uwatec: consumati ${flusso.byteConsumati} byte su ${declared} dichiarati.`);
    warnings.push(
      t(
        'Il profilo di un’immersione potrebbe essere incompleto: una parte dei dati registrati non si è potuta rileggere.',
      ),
    );
  }
  return dive;
}

/**
 * Da campioni Uwatec a campioni canonici.
 *
 * Sta qui, e non nel lettore di LogTRAK dove è nato, perché lo usano in due:
 * l'import del file e lo scarico via Bluetooth decodificano lo STESSO blob
 * binario, e due traduzioni diverse degli stessi byte darebbero due profili
 * diversi per la stessa immersione — con la fusione che ne sceglie uno a caso.
 */
export function uwatecSamplesToCanonical(samples: UwatecSample[]): Sample[] {
  if (samples.length === 0) return [];
  const t0 = samples[0].t;
  return samples.map((s) => {
    const out: Sample = { t: s.t - t0, depth: s.depth ?? 0 };
    if (s.tempC !== undefined) out.tempC = s.tempC;
    if (s.pressureBar !== undefined) {
      const arr: (number | undefined)[] = [];
      arr[s.tank ?? 0] = s.pressureBar;
      out.pressureBar = arr;
    }
    if (s.heartRate !== undefined) out.heartRate = s.heartRate;
    // RBT: il tempo di fondo residuo che il computer mostrava. Esiste solo con il
    // trasmettitore collegato, e 99 è il fondo scala ("più di 99 minuti"), non una
    // misura: registrarlo come 99 darebbe un dato dove non ce n'è.
    if (s.rbtMin !== undefined && s.rbtMin < 99) out.rbtMin = s.rbtMin;
    if (s.bearing !== undefined) out.bearing = s.bearing;
    return out;
  });
}

/**
 * Estrae tutti i record Uwatec da un buffer che ne contiene una sequenza.
 * LogTRAK ne mette uno per immersione, ma il download diretto dal computer
 * restituisce un flusso concatenato.
 */
export function splitUwatecRecords(bytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let at = 0;
  while (at + 8 <= bytes.length) {
    if (!hasUwatecMagic(bytes, at)) {
      at++;
      continue;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const len = view.getUint32(at + 4, true);
    if (len < 8 || at + len > bytes.length) break;
    out.push(bytes.subarray(at, at + len));
    at += len;
  }
  return out;
}

/**
 * Ritaglia il periodo in superficie prima e dopo l'immersione.
 *
 * Il computer registra anche i minuti passati a galla dopo essere risaliti: su
 * un'immersione da 35 minuti ho trovato 5 minuti di zeri in coda. Lasciarli
 * dentro abbassa la profondità media e falsa il consumo calcolato, quindi vanno
 * tolti — ma ne teniamo un campione per lato, perché la risalita finale finisce
 * in superficie e serve al calcolo della velocità.
 */
export function trimSurface(samples: UwatecSample[], thresholdM = 0.8): UwatecSample[] {
  const deep = samples.map((s) => (s.depth ?? 0) >= thresholdM);
  const first = deep.indexOf(true);
  if (first < 0) return samples;
  let last = deep.length - 1;
  while (last > first && !deep[last]) last--;
  return samples.slice(Math.max(0, first - 1), Math.min(samples.length, last + 2));
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
