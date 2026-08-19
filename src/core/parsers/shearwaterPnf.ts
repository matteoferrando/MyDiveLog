/**
 * Log nativo dei computer Shearwater (formato "PNF": Petrel Native Format).
 *
 * COSA È E PERCHÉ CONTA. Dentro il database di Shearwater Cloud, ogni immersione
 * porta un blob compresso con gzip che è la copia esatta della memoria del
 * computer per quella immersione. Le colonne "leggibili" della tabella dei
 * dettagli sono quasi tutte vuote — Shearwater Cloud le riempie solo se le scrivi
 * a mano nell'app — mentre qui dentro c'è tutto quello che il computer ha
 * registrato: i gradient factor impostati, il modello decompressivo, il tetto di
 * decompressione e il TTS a ogni campione, il CNS, la PPO2, la pressione della
 * bombola dal trasmettitore, la bussola, e le coordinate GPS di ingresso e uscita.
 *
 * È esattamente ciò che il formato Uwatec dei computer Scubapro NON contiene:
 * per le immersioni fatte con entrambi i computer, questo file è la sola fonte di
 * dati decompressivi reali.
 *
 * DA DOVE VIENE LA STRUTTURA. Riscritto da `libdivecomputer`,
 * `src/shearwater_predator_parser.c` (LGPL, Jef Driesen), che è l'unica
 * descrizione pubblica affidabile del formato. Ogni scostamento dal codice
 * originale è annotato. Il formato è a record di 32 byte, il primo byte dice il
 * tipo: 0x01 campione, 0x10..0x19 blocchi di apertura, 0x20..0x29 di chiusura,
 * 0x30 eventi, 0xE1 pressioni aggiuntive, 0xFF blocco finale col modello e il
 * numero di serie. I record tutti a zero sono spazio non usato e si saltano.
 *
 * COSA NON VIENE LETTO, DI PROPOSITO. GF99 e SurfGF campione per campione non
 * stanno nel log: Shearwater Cloud li ricalcola dai campioni con la propria
 * implementazione di Bühlmann, e il valore all'uscita che l'app mostra viene da
 * lì (lo leggiamo da `calculated_values_from_samples`, non da qui). Ricalcolarli
 * per conto nostro darebbe una colonna che sembra letta dal computer e non lo è.
 */

import type { GasMix, Sample } from '../model';
import { gunzip } from './inflate';

const RECORD = 0x20;

const TYPE = {
  sample: 0x01,
  freediveSample: 0x02,
  aveloSample: 0x03,
  openingBase: 0x10,
  closingBase: 0x20,
  infoEvent: 0x30,
  sampleExt: 0xe1,
  final: 0xff,
} as const;

/** Modalità del computer, come le numera il log. */
const MODE = ['ccr', 'oc-tec', 'gauge', 'ppo2', 'scr', 'ccr2', 'oc-rec', 'freedive'] as const;

/** Numeri di modello, da `shearwater_common.h`. */
const MODELS: Record<number, string> = {
  2: 'Shearwater Predator',
  3: 'Shearwater Petrel',
  4: 'Shearwater Nerd',
  5: 'Shearwater Perdix',
  6: 'Shearwater Perdix AI',
  7: 'Shearwater Nerd 2',
  8: 'Shearwater Teric',
  9: 'Shearwater Peregrine',
  10: 'Shearwater Petrel 3',
  11: 'Shearwater Perdix 2',
  12: 'Shearwater Tern',
  13: 'Shearwater Peregrine TX',
  14: 'Shearwater Perdix 3',
};

const DECO_MODELS: Record<number, string> = {
  0: 'Bühlmann ZHL-16C + GF',
  1: 'VPM-B',
  2: 'VPM-B/GFS',
  3: 'DCIEM',
};

/** Impostazioni del computer per questa immersione, lette dal log. */
export interface PnfSettings {
  gfLow?: number;
  gfHigh?: number;
  decoModel?: string;
  /** Conservatorismo VPM-B (+0..+5). Solo con i modelli VPM. */
  conservatism?: number;
  /** Densità dell'acqua impostata, kg/m³ (1000 = dolce). */
  waterDensity?: number;
  /** Pressione atmosferica di superficie misurata dal computer, bar. */
  surfacePressureBar?: number;
  /** Passo di campionamento, secondi. */
  sampleIntervalS?: number;
  /** Sistema di unità impostato sul computer. */
  units?: 'metric' | 'imperial';
  logVersion?: number;
  /** Integrazione aria: spenta, uno o due trasmettitori, HP CCR. */
  aiMode?: string;
  mode?: string;
}

export interface PnfTank {
  /** Numero di serie del trasmettitore. */
  serial?: number;
  maxPressureBar?: number;
  reservePressureBar?: number;
  name?: string;
  startBar?: number;
  endBar?: number;
}

export interface PnfLog {
  computer: {
    model?: string;
    modelNumber?: number;
    serial?: string;
    firmware?: string;
  };
  settings: PnfSettings;
  /** Miscele configurate e attive, nell'ordine del computer. */
  gases: GasMix[];
  tanks: PnfTank[];
  samples: Sample[];
  /**
   * Istante di inizio, secondi Unix UTC, dal blocco di apertura.
   *
   * Non serviva finché i log arrivavano da Shearwater Cloud, che la data ce
   * l'ha in una colonna del database. Serve quando il log arriva DIRETTAMENTE
   * dal computer via Bluetooth: lì non c'è nessun database, e senza questo
   * campo l'immersione non ha un momento — cioè non ha un identificativo, non
   * si può deduplicare e non entra nella catena dei tessuti.
   */
  startTimeS?: number;
  /** Profondità massima dal blocco di chiusura, metri. */
  maxDepth?: number;
  /** Durata dal blocco di chiusura, secondi. */
  durationS?: number;
  /** Coordinate di ingresso e uscita, se il computer ha il GPS e ha agganciato. */
  entry?: { lat: number; lon: number };
  exit?: { lat: number; lon: number };
  /** Segnalibri e rilevamenti bussola, dagli eventi. */
  bookmarks: { t: number; bearing?: number; value?: number }[];
  /** Cose viste e non interpretate: servono a non far finta che il file sia tutto noto. */
  notes: string[];
}

/** Vero se il blob è un log PNF compresso (prefisso di 4 byte + gzip). */
export function isPnfBlob(bytes: Uint8Array): boolean {
  return bytes.length > 22 && bytes[4] === 0x1f && bytes[5] === 0x8b;
}

/**
 * Decodifica un blob `data_bytes_1` di Shearwater Cloud.
 *
 * I primi 4 byte sono la dimensione attesa in little-endian, poi comincia il gzip.
 * La dimensione viene verificata: se non torna, il blob è troncato e vale la pena
 * dirlo invece di restituire mezzo profilo.
 */
export function decodePnfBlob(blob: Uint8Array): PnfLog {
  if (!isPnfBlob(blob)) throw new Error('Non è un log Shearwater compresso.');
  // Little-endian: verificato su 38 log reali, dove coincide esattamente con la
  // lunghezza decompressa (13056, 13184, …). In big-endian darebbe milioni.
  const declared = blob[0] | (blob[1] << 8) | (blob[2] << 16) | (blob[3] << 24);
  const raw = gunzip(blob.subarray(4));
  if (declared && raw.length !== declared) {
    throw new Error(`Log incoerente: dichiarati ${declared} byte, decompressi ${raw.length}.`);
  }
  return decodePnf(raw);
}

export function decodePnf(data: Uint8Array): PnfLog {
  const notes: string[] = [];
  const opening: (number | undefined)[] = new Array(10).fill(undefined);
  const closing: (number | undefined)[] = new Array(10).fill(undefined);
  let final: number | undefined;

  // --- primo passaggio: trova i blocchi ------------------------------------
  // Serve prima dei campioni: il passo di campionamento, le unità e le miscele
  // stanno nei blocchi di apertura, e senza di quelli i campioni non si sanno
  // interpretare.
  for (let offset = 0; offset + RECORD <= data.length; offset += RECORD) {
    if (isZero(data, offset, RECORD)) continue;
    const type = data[offset];
    if (type >= TYPE.openingBase && type <= TYPE.openingBase + 9) {
      opening[type - TYPE.openingBase] = offset;
    } else if (type >= TYPE.closingBase && type <= TYPE.closingBase + 9) {
      closing[type - TYPE.closingBase] = offset;
    } else if (type === TYPE.final) {
      final = offset;
    }
  }

  if (opening[0] === undefined || closing[0] === undefined) {
    throw new Error('Log senza blocco di apertura o di chiusura: non è un log PNF valido.');
  }

  const o = (i: number, plus: number) => {
    const base = opening[i];
    return base === undefined ? undefined : base + plus;
  };

  // --- impostazioni --------------------------------------------------------
  const logVersion = at(data, o(4, 16));
  const units = at(data, o(0, 8)) === 1 ? 'imperial' : 'metric';
  const decoModelCode = at(data, o(2, 18));
  /*
   * L'orologio del computer, in secondi Unix.
   *
   * `opening[0] + 12`, big-endian a 32 bit, come in
   * `shearwater_predator_parser_get_datetime`. Zero significa «orologio mai
   * impostato» e non «1 gennaio 1970»: va trattato come assente, altrimenti
   * un'immersione finisce cinquant'anni indietro e trascina con sé la catena
   * dei tessuti di tutte le altre.
   */
  const ticks = u32(data, o(0, 12));
  const startTimeS = ticks && ticks > 946_684_800 ? ticks : undefined;
  if (ticks && !startTimeS) {
    notes.push(`Orologio del computer non plausibile (${ticks}): la data non è stata letta dal log.`);
  }

  const settings: PnfSettings = {
    gfLow: at(data, o(0, 4)),
    gfHigh: at(data, o(0, 5)),
    decoModel: decoModelCode !== undefined ? DECO_MODELS[decoModelCode] : undefined,
    conservatism: decoModelCode === 1 || decoModelCode === 2 ? at(data, o(2, 19)) : undefined,
    waterDensity: u16(data, o(3, 3)),
    surfacePressureBar: divide(u16(data, o(1, 16)), 1000),
    units,
    logVersion,
  };
  // I gradient factor esistono solo col modello di Bühlmann: con VPM-B i byte
  // contengono ancora qualcosa, e mostrarlo come "GF impostati" sarebbe falso.
  if (decoModelCode !== undefined && decoModelCode !== 0) {
    settings.gfLow = undefined;
    settings.gfHigh = undefined;
  }

  const modeCode = logVersion !== undefined && logVersion >= 8 ? at(data, o(4, 1)) : undefined;
  if (modeCode !== undefined) settings.mode = MODE[modeCode] ?? `codice ${modeCode}`;

  const aiCode = logVersion !== undefined && logVersion >= 7 ? at(data, o(4, 28)) : undefined;
  if (aiCode !== undefined) {
    settings.aiMode =
      aiCode === 0
        ? 'spenta'
        : aiCode === 1 || aiCode === 2
          ? `un trasmettitore (T${aiCode})`
          : aiCode === 3
            ? 'due trasmettitori'
            : aiCode === 4
              ? 'HP CCR'
              : aiCode === 5 || aiCode === 6
                ? 'accesa'
                : `codice ${aiCode}`;
  }

  // Passo di campionamento: nel log solo dalla versione 9 e solo se esiste il
  // blocco 5. Altrimenti è 10 s, che è il valore storico dei Petrel.
  let intervalS = 10;
  if (logVersion !== undefined && logVersion >= 9 && opening[5] !== undefined) {
    const ms = u16(data, o(5, 23));
    if (ms && ms >= 1000 && ms <= 60_000) intervalS = ms / 1000;
    else if (ms) notes.push(`Passo di campionamento inatteso (${ms} ms): uso 10 s.`);
  }
  settings.sampleIntervalS = intervalS;

  // --- miscele -------------------------------------------------------------
  const gasO2: number[] = [];
  const gasHe: number[] = [];
  for (let i = 0; i < 10; i++) gasO2.push(at(data, o(0, 20 + i)) ?? 0);
  gasHe.push(at(data, o(0, 30)) ?? 0, at(data, o(0, 31)) ?? 0);
  for (let i = 2; i < 10; i++) gasHe.push(at(data, o(1, 1 + i - 2)) ?? 0);
  const enabledMask = u16(data, o(4, 17)) ?? 0;

  // --- bombole -------------------------------------------------------------
  const tanks: PnfTank[] = [];
  if (logVersion !== undefined && logVersion >= 9 && opening[5] !== undefined) {
    tanks.push({
      serial: bcd(data, o(5, 1), 3),
      maxPressureBar: psi2ToBar(u16(data, o(5, 6))),
      reservePressureBar: psi2ToBar(u16(data, o(5, 8))),
    });
    tanks.push({
      serial: bcd(data, o(5, 10), 3),
      maxPressureBar: psi2ToBar(u16(data, o(5, 15))),
      reservePressureBar: psi2ToBar(u16(data, o(5, 17))),
    });
  }

  // --- secondo passaggio: campioni ----------------------------------------
  const samples: Sample[] = [];
  const bookmarks: PnfLog['bookmarks'] = [];
  const otherEvents = new Set<number>();
  const usedGases: number[] = [];
  const imperial = units === 'imperial';
  let t = 0;
  let sampleCount = 0;
  let lastGasIndex: number | undefined;
  let freediveSeen = false;

  for (let offset = 0; offset + RECORD <= data.length; offset += RECORD) {
    if (isZero(data, offset, RECORD)) continue;
    const type = data[offset];

    if (type === TYPE.sample || type === TYPE.aveloSample) {
      t += intervalS;
      sampleCount++;
      const b = offset + 1; // in PNF ogni campo è spostato di 1: il tipo sta davanti

      const depthRaw = u16(data, b) ?? 0;
      const depth = imperial ? (depthRaw / 10) * 0.3048 : depthRaw / 10;

      const sample: Sample = { t, depth };

      // Temperatura: intero con segno, e i valori negativi hanno una correzione
      // che viene da libdivecomputer (il computer scrive un complemento diverso
      // sotto zero). Il ramo negativo non è verificabile su questo archivio —
      // acqua ligure e maldiviana non ci arrivano — ma va riportato com'è.
      const tempRaw = int8(data, b + 13);
      if (tempRaw !== undefined) {
        let temp = tempRaw;
        if (temp < 0) {
          temp += 102;
          if (temp > 0) temp = 0;
        }
        sample.tempC = imperial ? ((temp - 32) * 5) / 9 : temp;
      }

      const status = at(data, b + 11) ?? 0;
      const ccr = (status & 0x10) === 0;

      // Tetto di decompressione e tempi. Quando il tetto è 0 il computer sta
      // dando l'NDL nello stesso byte in cui altrimenti dà la durata della
      // tappa: sono due significati sullo stesso campo, e vanno separati qui.
      const ceilingRaw = u16(data, b + 2) ?? 0;
      const minutes = at(data, b + 9) ?? 0;
      const ttsMin = u16(data, b + 4) ?? 0;
      if (ceilingRaw > 0) {
        const ceiling = imperial ? ceilingRaw * 0.3048 : ceilingRaw;
        sample.ceiling = ceiling;
        sample.stopDepth = ceiling;
        sample.stopTimeS = minutes * 60;
        sample.inDeco = true;
      } else {
        sample.ndlS = minutes * 60;
        sample.inDeco = false;
      }
      if (ttsMin) sample.ttsS = ttsMin * 60;

      // PPO2: nei circuiti chiusi è la lettura delle celle o il valore calcolato;
      // in circuito aperto il computer non la registra e non la inventiamo.
      if (ccr) {
        const ppo2 = at(data, b + 6);
        if (ppo2) sample.ppo2 = ppo2 / 100;
        const setpoint = at(data, b + 18);
        if (setpoint) sample.setpoint = setpoint / 100;
      }

      const cns = at(data, b + 22);
      if (cns !== undefined) sample.cns = cns;

      // Tempo di fondo residuo dal trasmettitore. Da 0xF0 in su sono codici di
      // stato — non accoppiato, nessuna comunicazione, non disponibile in deco —
      // e non minuti: registrarli come 250 minuti sarebbe grottesco.
      const rbt = at(data, b + 21);
      if (rbt !== undefined && rbt < 0xf0) sample.rbtMin = rbt;

      // Gas respirato: il log scrive O2 e He del gas attivo, non il suo indice.
      const o2 = at(data, b + 7) ?? 0;
      const he = at(data, b + 8) ?? 0;
      if (o2 || he) {
        let idx = usedGases.findIndex((g) => g === o2 * 100 + he);
        if (idx < 0) {
          usedGases.push(o2 * 100 + he);
          idx = usedGases.length - 1;
        }
        sample.gasIndex = idx;
        lastGasIndex = idx;
      } else if (lastGasIndex !== undefined) {
        sample.gasIndex = lastGasIndex;
      }

      // Pressione dai trasmettitori. I 4 bit alti sono lo stato della batteria
      // del trasmettitore, i 12 bassi la pressione in unità di 2 psi; da 0xFFF0
      // in su sono codici di errore e non pressioni.
      if (logVersion !== undefined && logVersion >= 7) {
        const pressures: (number | undefined)[] = [];
        for (const [i, idx] of [27, 19].entries()) {
          const rawP = u16(data, b + idx);
          if (rawP === undefined || rawP >= 0xfff0) {
            pressures[i] = undefined;
            continue;
          }
          const value = rawP & 0x0fff;
          pressures[i] = value ? psi2ToBar(value) : undefined;
        }
        if (pressures.some((p) => p !== undefined)) sample.pressureBar = pressures;
      }

      samples.push(sample);
    } else if (type === TYPE.sampleExt) {
      // Pressioni della terza e quarta bombola: il campione precedente le
      // completa, non ne aggiunge uno nuovo.
      if (logVersion !== undefined && logVersion >= 13 && samples.length) {
        const last = samples[samples.length - 1];
        const extra: (number | undefined)[] = [];
        for (let i = 0; i < 2; i++) {
          const rawP = u16(data, offset + 1 + i * 2);
          extra[i] =
            rawP !== undefined && rawP < 0xfff0 && rawP & 0x0fff ? psi2ToBar(rawP & 0x0fff) : undefined;
        }
        if (extra.some((p) => p !== undefined)) {
          last.pressureBar = [...(last.pressureBar ?? [undefined, undefined]), ...extra];
        }
      }
    } else if (type === TYPE.freediveSample) {
      freediveSeen = true;
    } else if (type === TYPE.infoEvent) {
      // Solo l'evento 38 è documentato: bussola e segnalibro.
      const event = at(data, offset + 1);
      if (event === 38) {
        const w1 = u32(data, offset + 8);
        const w2 = u32(data, offset + 12);
        bookmarks.push({
          t,
          bearing: w1 !== undefined && w1 !== 0xffffffff ? w1 : undefined,
          value: w2 === 0xffffffff ? undefined : w2,
        });
      } else if (event !== undefined) {
        // Gli altri eventi esistono ma la loro semantica non è documentata: li
        // contiamo per non far credere che il file sia tutto noto, senza
        // attribuire loro un significato inventato.
        otherEvents.add(event);
      }
    }
  }

  if (freediveSeen) {
    notes.push('Il log contiene campioni di apnea, che non vengono decodificati.');
  }
  if (otherEvents.size) {
    notes.push(
      `Eventi non documentati nel log, letti e non interpretati: codici ${[...otherEvents].join(', ')}.`,
    );
  }

  // --- miscele effettive ---------------------------------------------------
  const gases: GasMix[] = [];
  for (let i = 0; i < 10; i++) {
    const enabled = (enabledMask & (1 << i)) !== 0;
    const o2 = gasO2[i];
    const he = gasHe[i] ?? 0;
    if (!o2 && !he) continue;
    const used = usedGases.includes(o2 * 100 + he);
    if (!enabled && !used) continue;
    gases.push({ o2: o2 / 100, he: he / 100 });
  }
  // Le miscele respirate stanno nell'ordine in cui il profilo le nomina: è
  // quell'ordine che `Sample.gasIndex` indicizza.
  const ordered: GasMix[] = usedGases.map((code) => ({
    o2: Math.floor(code / 100) / 100,
    he: (code % 100) / 100,
  }));
  for (const g of gases) {
    if (!ordered.some((x) => x.o2 === g.o2 && x.he === g.he)) ordered.push(g);
  }

  // --- pressioni iniziali e finali per bombola ----------------------------
  for (let i = 0; i < Math.max(tanks.length, 2); i++) {
    const values = samples.map((s) => s.pressureBar?.[i]).filter((v): v is number => v !== undefined);
    if (!values.length) continue;
    while (tanks.length <= i) tanks.push({});
    tanks[i].startBar = values[0];
    tanks[i].endBar = values[values.length - 1];
  }

  // --- chiusura e blocco finale -------------------------------------------
  const maxDepthRaw = u16(data, closing[0] + 4);
  const maxDepth =
    maxDepthRaw === undefined ? undefined : imperial ? (maxDepthRaw / 10) * 0.3048 : maxDepthRaw / 10;
  const durationS = u24(data, closing[0] + 6);

  const computer: PnfLog['computer'] = {};
  if (final !== undefined) {
    const modelNumber = at(data, final + 13);
    computer.modelNumber = modelNumber;
    computer.model = modelNumber !== undefined ? MODELS[modelNumber] : undefined;
    const serial = u32(data, final + 2);
    if (serial !== undefined) computer.serial = serial.toString(16).toUpperCase().padStart(8, '0');
    const fw = at(data, final + 10);
    if (fw !== undefined) computer.firmware = `v${bcdByte(fw)}`;
  }

  const entry = gnss(data, opening[9], logVersion);
  const exit = gnss(data, closing[9], logVersion);

  if (sampleCount === 0) notes.push('Log senza campioni: solo apertura e chiusura.');

  return {
    computer,
    settings,
    gases: ordered,
    tanks,
    samples,
    startTimeS,
    maxDepth,
    durationS,
    entry,
    exit,
    bookmarks,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Letture elementari. Tutte tolleranti: un log troncato restituisce `undefined`
// invece di leggere oltre la fine, così un file danneggiato perde un campo e non
// fa cadere l'import.
// ---------------------------------------------------------------------------

function isZero(d: Uint8Array, from: number, len: number): boolean {
  for (let i = from; i < from + len; i++) if (d[i] !== 0) return false;
  return true;
}

const at = (d: Uint8Array, i: number | undefined) =>
  i === undefined || i < 0 || i >= d.length ? undefined : d[i];

function int8(d: Uint8Array, i: number | undefined): number | undefined {
  const v = at(d, i);
  return v === undefined ? undefined : v > 127 ? v - 256 : v;
}

function u16(d: Uint8Array, i: number | undefined): number | undefined {
  if (i === undefined || i < 0 || i + 1 >= d.length) return undefined;
  return (d[i] << 8) | d[i + 1];
}

function u24(d: Uint8Array, i: number | undefined): number | undefined {
  if (i === undefined || i < 0 || i + 2 >= d.length) return undefined;
  return (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
}

function u32(d: Uint8Array, i: number | undefined): number | undefined {
  if (i === undefined || i < 0 || i + 3 >= d.length) return undefined;
  return ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
}

function i32(d: Uint8Array, i: number | undefined): number | undefined {
  const v = u32(d, i);
  return v === undefined ? undefined : v | 0;
}

/** BCD su più byte: 0x12 0x34 → 1234. Così scrive i seriali dei trasmettitori. */
function bcd(d: Uint8Array, i: number | undefined, bytes: number): number | undefined {
  if (i === undefined) return undefined;
  let out = 0;
  for (let k = 0; k < bytes; k++) {
    const v = at(d, i + k);
    if (v === undefined) return undefined;
    out = out * 100 + bcdByte(v);
  }
  return out || undefined;
}

const bcdByte = (v: number) => (v >> 4) * 10 + (v & 0x0f);

/** Unità di 2 psi → bar. */
const psi2ToBar = (v: number | undefined) => (v === undefined ? undefined : (v * 2 * 6894.75729) / 100000);

const divide = (v: number | undefined, by: number) => (v === undefined ? undefined : v / by);

/**
 * Coordinate dal blocco 9, presenti dalla versione 17 del log e solo sui computer
 * con GPS. Vengono restituite solo con un fix valido (2D o 3D): gli altri stati
 * sono "nessun satellite", "nessun fix", "disabilitato", e trattarli come
 * coordinate metterebbe l'immersione a zero gradi zero — in mezzo all'Atlantico.
 */
function gnss(
  d: Uint8Array,
  record: number | undefined,
  logVersion: number | undefined,
): { lat: number; lon: number } | undefined {
  if (record === undefined || logVersion === undefined || logVersion < 17) return undefined;
  const status = at(d, record + 16);
  if (status !== 2 && status !== 3) return undefined;
  const lat = i32(d, record + 21);
  const lon = i32(d, record + 25);
  if (lat === undefined || lon === undefined) return undefined;
  return { lat: lat / 100000, lon: lon / 100000 };
}
