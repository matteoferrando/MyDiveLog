/**
 * Shearwater XML (export "XML" di Shearwater Cloud Desktop).
 *
 * Struttura: `/dive/diveLog` con un blocco di intestazione e
 * `diveLogRecords/diveLogRecord` per i campioni.
 *
 * Le unità di Shearwater sono la parte insidiosa e sono la ragione per cui
 * questo parser è lungo:
 *
 *  - `imperialUnits` è un flag che decide COME leggere profondità e temperatura
 *    nello stesso file. Ignorarlo significa registrare 30 m come 30 ft.
 *  - `startSurfacePressure` è in MILLIBAR, non bar.
 *  - `tank0pressurePSI` è in MEZZI PSI: il valore va moltiplicato per 2 prima di
 *    convertirlo. Il fattore 2 non è nel nome del campo ed è documentato solo
 *    nell'XSLT di Subsurface.
 *  - `currentTime` non ha unità documentate. Invece di indovinare, la ricaviamo
 *    dal passo mediano fra campioni (vedi `detectTimeScale`): un passo di 10000
 *    sono millisecondi, uno di 10 sono secondi.
 *
 * Per l'export CSV di Shearwater non esiste documentazione pubblica delle
 * intestazioni, quindi non lo supportiamo: l'XML e l'UDDF hanno identificatori
 * stabili e sono la strada giusta.
 */

import { AIR, type Cylinder, type Dive, type DiveMode, type GasMix, type Sample } from '../model';
import { fahrenheitToC, feetToM, mbarToBar, shearwaterTankToBar, wallClockToIso } from '../units';
import { diveIdFor } from '../dedupe';
import { computeMetrics } from '../analysis/metrics';
import { comeSta, type Traduci } from '../traduci';
import { child, children, num, parseXml, text } from './xml';
import type { DiveParser, ParseInput, ParseResult } from './types';

export const shearwaterParser: DiveParser = {
  format: 'shearwater-xml',
  label: 'Shearwater Cloud (export XML)',
  extensions: ['.xml'],

  detect(input: ParseInput) {
    return !!input.text && /<diveLog[\s>]/.test(input.text);
  },

  parse(input: ParseInput, t: Traduci = comeSta): ParseResult {
    const warnings: string[] = [];
    const root = parseXml(input.text ?? '');
    const importedAt = new Date().toISOString();

    // Un file può contenere un solo <dive> o una raccolta.
    const logs = [
      ...children(child(root, 'dive'), 'diveLog'),
      ...children(root, 'diveLog'),
      ...children(child(root, 'dives'), 'diveLog'),
    ];

    const dives: Dive[] = [];
    for (const log of logs) {
      const dive = readLog(log, input.fileName, importedAt, warnings, t);
      if (dive) dives.push(dive);
    }
    if (dives.length === 0) warnings.push(t('Nessun <diveLog> valido trovato nel file Shearwater.'));
    return { format: 'shearwater-xml', dives, warnings };
  },
};

// ---------------------------------------------------------------------------

function readLog(
  log: unknown,
  fileName: string,
  importedAt: string,
  warnings: string[],
  t: Traduci = comeSta,
): Dive | null {
  const imperial = (num(child(log, 'imperialUnits')) ?? 0) === 1;
  const depth = (v: number | undefined) => (v === undefined ? undefined : imperial ? feetToM(v) : v);
  const temp = (v: number | undefined) => (v === undefined ? undefined : imperial ? fahrenheitToC(v) : v);

  const startDate = text(child(log, 'startDate'));
  if (!startDate) {
    warnings.push(t('Immersione Shearwater senza startDate scartata.'));
    return null;
  }
  const startTime = parseShearwaterDate(startDate);

  const records = children(child(log, 'diveLogRecords'), 'diveLogRecord');
  const timeScale = detectTimeScale(records.map((r) => num(child(r, 'currentTime'))));
  if (timeScale === null && records.length > 2) {
    warnings.push(
      t('Passo di campionamento Shearwater non riconosciuto: i tempi sono interpretati come secondi.'),
    );
  }
  const divisor = timeScale ?? 1;

  // Prima passata: censimento delle miscele usate, per costruire la lista bombole.
  const mixKey = (m: GasMix) => `${Math.round(m.o2 * 100)}/${Math.round(m.he * 100)}`;
  const mixOrder: GasMix[] = [];
  const mixIndex = new Map<string, number>();
  for (const r of records) {
    const mix = readMix(r);
    if (!mix) continue;
    const key = mixKey(mix);
    if (!mixIndex.has(key)) {
      mixIndex.set(key, mixOrder.length);
      mixOrder.push(mix);
    }
  }
  const cylinders: Cylinder[] = (mixOrder.length ? mixOrder : [AIR]).map((mix) => ({ mix }));

  let ppo2NeedsScaling = false;
  const samples: Sample[] = [];
  for (const r of records) {
    const rawTime = num(child(r, 'currentTime'));
    const d = depth(num(child(r, 'currentDepth')));
    if (rawTime === undefined || d === undefined) continue;

    const mix = readMix(r);
    const gasIndex = mix ? mixIndex.get(mixKey(mix)) : undefined;

    const tank0 = num(child(r, 'tank0pressurePSI'));
    const tank1 = num(child(r, 'tank1pressurePSI'));
    const pressures: (number | undefined)[] = [];
    if (tank0 !== undefined && tank0 > 0) pressures[0] = round1(shearwaterTankToBar(tank0));
    if (tank1 !== undefined && tank1 > 0) pressures[1] = round1(shearwaterTankToBar(tank1));

    const rawPpo2 = num(child(r, 'averagePPO2'));
    let ppo2: number | undefined;
    if (rawPpo2 !== undefined && rawPpo2 > 0) {
      // `imperialUnits` governa profondità e temperatura, NON questo campo: una
      // pressione parziale è in bar (o bar×100) qualunque sia l'unità del resto
      // del file. Convertirla da PSI dava 8.96 bar su un'immersione a 1.30, e
      // siccome è oltre il limite di deco l'app emetteva un allarme critico di
      // ossigeno su un'immersione perfettamente regolare.
      if (rawPpo2 > 3) {
        // Valori sopra 3 bar sono impossibili: il campo è scalato ×100.
        ppo2 = rawPpo2 / 100;
        ppo2NeedsScaling = true;
      } else ppo2 = rawPpo2;
    }

    const stopDepth = depth(num(child(r, 'firstStopDepth')));
    const ceiling = depth(num(child(r, 'decoCeiling')));

    samples.push({
      t: Math.round(rawTime / divisor),
      depth: round1(d),
      tempC: roundOrUndef(temp(num(child(r, 'waterTemp'))), 1),
      pressureBar: pressures.length ? pressures : undefined,
      ndlS: minutesToSeconds(num(child(r, 'currentNdl'))),
      stopDepth,
      stopTimeS: minutesToSeconds(num(child(r, 'firstStopTime'))),
      ceiling: ceiling && ceiling > 0 ? ceiling : undefined,
      inDeco: (stopDepth ?? 0) > 0,
      cns: num(child(r, 'CNSPercent')),
      ppo2: roundOrUndef(ppo2, 2),
      gasIndex,
    });
  }
  if (ppo2NeedsScaling) {
    warnings.push(t('PPO2 Shearwater riscalata di 100: il campo non è documentato in unità.'));
  }

  const maxDepth =
    depth(num(child(log, 'maxDepth'))) ??
    (samples.length ? Math.max(...samples.map((s) => s.depth)) : undefined);
  const durationS =
    normaliseDuration(num(child(log, 'maxTime')), samples) ??
    (samples.length ? samples[samples.length - 1].t : undefined);

  if (!maxDepth || !durationS) {
    // Spezzata perché una chiave con la data dentro sarebbe una voce di
    // dizionario diversa per ogni immersione. Vale per tutte quelle che seguono.
    warnings.push(
      `${t('Immersione Shearwater del')} ${startDate} ${t('scartata: durata o profondità mancanti.')}`,
    );
    return null;
  }

  const circuit = records.length ? num(child(records[0], 'currentCircuitSetting')) : undefined;
  const mode: DiveMode = circuit !== undefined && circuit > 0 ? 'ccr' : 'oc';

  const base = {
    startTime,
    maxDepth: round1(maxDepth),
    durationS: Math.round(durationS),
    computer: {
      model: text(child(log, 'computerModel')) ?? text(child(log, 'product')),
      serial: text(child(log, 'computerSerial')),
      deviceId: text(child(log, 'computerSerial')),
      diveId: text(child(log, 'number')),
      firmware: text(child(log, 'computerFirmware')),
      decoModel: text(child(log, 'decoModel')),
      gfLow: num(child(log, 'gfMin')),
      gfHigh: num(child(log, 'gfMax')),
    },
  };

  const dive: Dive = {
    id: diveIdFor(base),
    number: num(child(log, 'number')),
    startTime,
    durationS: base.durationS,
    maxDepth: base.maxDepth,
    minTempC: minOf(samples.map((s) => s.tempC)),
    mode,
    cylinders,
    salinity: 'salt',
    surfacePressureBar: roundOrUndef(mapDefined(num(child(log, 'startSurfacePressure')), mbarToBar), 3),
    computer: base.computer,
    source: { format: 'shearwater-xml', file: fileName, importedAt },
    tags: [],
    samples,
  };
  dive.metrics = computeMetrics(dive);
  dive.avgDepth = dive.metrics.avgDepth;

  // Le pressioni iniziali/finali della bombola vengono dai campioni.
  cylinders.forEach((cyl, i) => {
    const values = samples
      .map((s) => s.pressureBar?.[i])
      .filter((p): p is number => p !== undefined && p > 0);
    if (values.length >= 2) {
      cyl.startBar = Math.round(values[0]);
      cyl.endBar = Math.round(values[values.length - 1]);
    }
  });

  return dive;
}

// ---------------------------------------------------------------------------

/**
 * Ricava il fattore di scala del campo `currentTime` dal passo fra campioni.
 * Shearwater campiona a 2 / 5 / 10 / 20 / 30 / 60 s: se il passo mediano è
 * 10000 il campo è in millisecondi, se è 10 in secondi.
 * Restituisce il divisore per ottenere secondi, o `null` se non riconosciuto.
 */
export function detectTimeScale(raw: (number | undefined)[]): number | null {
  const values = raw.filter((v): v is number => v !== undefined && Number.isFinite(v));
  if (values.length < 3) return 1;
  const deltas: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) deltas.push(d);
  }
  if (deltas.length === 0) return 1;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];

  const plausibleIntervals = [1, 2, 5, 10, 15, 20, 30, 60];
  for (const divisor of [1, 1000]) {
    const seconds = median / divisor;
    if (plausibleIntervals.some((i) => Math.abs(seconds - i) < 0.51)) return divisor;
  }
  return null;
}

/**
 * `maxTime` non dichiara l'unità. Se è dello stesso ordine dell'ultimo campione
 * (in secondi) sono secondi; se è ~60 volte più piccolo sono minuti.
 */
function normaliseDuration(maxTime: number | undefined, samples: Sample[]): number | undefined {
  if (maxTime === undefined || maxTime <= 0) return undefined;
  if (samples.length === 0) return maxTime;
  const lastT = samples[samples.length - 1].t;
  if (lastT <= 0) return maxTime;
  const ratio = lastT / maxTime;
  if (ratio > 30 && ratio < 90) return Math.round(maxTime * 60); // maxTime in minuti
  return Math.round(maxTime);
}

/** NDL e tempi di sosta Shearwater sono in minuti. */
const minutesToSeconds = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 60));

function readMix(record: unknown): GasMix | undefined {
  const o2 = num(child(record, 'fractionO2'));
  const he = num(child(record, 'fractionHe'));
  if (o2 === undefined) return undefined;
  // Il campo si chiama "fraction" ma è salvato in percentuale.
  return {
    o2: o2 > 1 ? o2 / 100 : o2,
    he: he === undefined ? 0 : he > 1 ? he / 100 : he,
  };
}

/**
 * "2026-06-14 10:38:00" o ISO.
 *
 * Shearwater scrive la lettura dell'orologio senza fuso: fissata su UTC per non
 * far dipendere l'istante dal fuso della macchina. Vedi `wallClockToIso`.
 */
export function parseShearwaterDate(raw: string): string {
  return wallClockToIso(raw) ?? new Date(0).toISOString();
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function roundOrUndef(v: number | undefined, digits = 1): number | undefined {
  if (v === undefined) return undefined;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function mapDefined<T, R>(v: T | undefined, fn: (v: T) => R): R | undefined {
  return v === undefined ? undefined : fn(v);
}

function minOf(values: (number | undefined)[]): number | undefined {
  const nums = values.filter((v): v is number => v !== undefined);
  return nums.length ? Math.min(...nums) : undefined;
}
