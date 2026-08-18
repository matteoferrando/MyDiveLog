/**
 * Garmin FIT (Descent Mk2/Mk3, e anche l'export FIT dell'app Suunto).
 *
 * Usiamo `@garmin/fitsdk`, l'SDK ufficiale, perché il suo profilo dei messaggi
 * è rigenerato dal `Profile.xlsx` di Garmin a ogni release: i campi subacquei
 * nuovi arrivano senza che noi manteniamo tabelle a mano. L'SDK applica già
 * scale e offset, quindi `record.depth` arriva in metri e non in millimetri.
 *
 * Tre cose che il formato NON fa come ci si aspetterebbe:
 *
 *  1. La pressione della bombola NON è nei `record`. Sta in messaggi
 *     `tank_update` separati, uno per lettura del trasmettitore, identificati
 *     dal `sensor` (ANT channel ID). Va agganciata al profilo per timestamp.
 *  2. `bottom_time`, `descent_time`, `ascent_time` hanno scala 1000: sono
 *     millisecondi mentre `surface_interval`, accanto, è in secondi.
 *  3. Il volume della bombola non esiste nel FIT. Lo ricaviamo da
 *     `tank_summary`: volume_used / (start_pressure - end_pressure) dà i litri.
 *     È l'unico modo per calcolare un consumo in L/min da un file Garmin.
 *
 * Sull'export FIT di Suunto: è povero (manca il gas del trasmettitore e la
 * composizione della miscela). Quello che c'è lo leggiamo, il resto va
 * completato a mano nella scheda immersione.
 */

import { AIR, type Cylinder, type Dive, type DiveMode, type GasMix, type Sample } from '../model';
import { diveIdFor } from '../dedupe';
import { computeMetrics } from '../analysis/metrics';
import type { DiveParser, ParseInput, ParseResult } from './types';

/** Firma dei file FIT: byte 8..11 valgono ".FIT". */
const FIT_SIGNATURE = [0x2e, 0x46, 0x49, 0x54];

export const garminFitParser: DiveParser = {
  format: 'garmin-fit',
  label: 'Garmin FIT (Descent, export Suunto app)',
  extensions: ['.fit'],

  detect(input: ParseInput) {
    const b = input.bytes;
    if (!b || b.length < 14) return false;
    return FIT_SIGNATURE.every((v, i) => b[8 + i] === v);
  },

  parse(): ParseResult {
    throw new Error('Il formato FIT richiede parseFit(), che è asincrono.');
  },
};

/**
 * Il decoder FIT è un import dinamico: l'SDK pesa e non serve finché non si
 * importa davvero un file Garmin. Su iOS e web questo mantiene il bundle iniziale leggero.
 */
export async function parseFit(input: ParseInput): Promise<ParseResult> {
  const warnings: string[] = [];
  if (!input.bytes) return { format: 'garmin-fit', dives: [], warnings: ['File FIT vuoto.'] };

  const { Decoder, Stream } = await import('@garmin/fitsdk');
  const stream = Stream.fromByteArray(input.bytes);
  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read({
    mesgListener: undefined,
    expandSubFields: true,
    expandComponents: true,
    applyScaleAndOffset: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
  });
  if (errors?.length) {
    warnings.push(`Il decoder FIT ha segnalato ${errors.length} anomalie; l'import continua sui dati validi.`);
  }

  const m = messages as FitMessages;
  const importedAt = new Date().toISOString();
  const records = (m.recordMesgs ?? []).filter((r) => r.timestamp instanceof Date);
  records.sort((a, b) => ms(a.timestamp) - ms(b.timestamp));

  const diveSessions = (m.sessionMesgs ?? []).filter(
    (s) => typeof s.sport === 'string' && /div|apnea/i.test(s.sport),
  );

  // Se il file non dichiara una sessione subacquea ma ha profondità nei record,
  // lo trattiamo comunque come un'immersione: alcuni export perdono la sessione.
  const sessions: FitSession[] = diveSessions.length
    ? diveSessions
    : records.some((r) => typeof r.depth === 'number' && r.depth > 1)
      ? [syntheticSession(records)]
      : [];

  if (sessions.length === 0) {
    return { format: 'garmin-fit', dives: [], warnings: [...warnings, 'Nessuna immersione nel file FIT.'] };
  }

  const device = (m.fileIdMesgs ?? [])[0];
  const deviceModel = readModel(m);
  const gases = readGases(m);
  const tanks = readTanks(m, warnings);

  const dives: Dive[] = [];
  sessions.forEach((session, sessionIndex) => {
    const start = ms(session.startTime);
    const elapsed = (session.totalElapsedTime ?? session.totalTimerTime ?? 0) * 1000;
    const endMs = elapsed > 0 ? start + elapsed : Number.POSITIVE_INFINITY;
    const own = records.filter((r) => ms(r.timestamp) >= start && ms(r.timestamp) <= endMs);
    if (own.length < 2) return;

    const summary = matchSummary(m, sessionIndex);
    const cylinders = buildCylinders(gases, tanks);

    const samples: Sample[] = own.map((r) => {
      const t = Math.round((ms(r.timestamp) - start) / 1000);
      return {
        t,
        depth: round1(r.depth ?? 0),
        tempC: r.temperature,
        pressureBar: tanks.length ? tanks.map((tank) => pressureAt(tank, ms(r.timestamp))) : undefined,
        ndlS: r.ndlTime,
        ttsS: r.timeToSurface,
        stopDepth: r.nextStopDepth && r.nextStopDepth > 0 ? round1(r.nextStopDepth) : undefined,
        stopTimeS: r.nextStopTime,
        inDeco: !!(r.nextStopDepth && r.nextStopDepth > 0),
        cns: r.cnsLoad,
        gasIndex: undefined,
      };
    });

    const maxDepth = summary?.maxDepth ?? Math.max(...samples.map((s) => s.depth));
    const durationS = Math.round(
      (session.totalTimerTime ?? session.totalElapsedTime ?? samples[samples.length - 1].t) || 0,
    );
    if (!maxDepth || !durationS) return;

    const base = {
      startTime: new Date(start).toISOString(),
      maxDepth: round1(maxDepth),
      durationS,
      computer: {
        model: deviceModel,
        deviceId: device?.serialNumber !== undefined ? String(device.serialNumber) : undefined,
        diveId: summary?.diveNumber !== undefined ? String(summary.diveNumber) : undefined,
      },
    };

    const dive: Dive = {
      id: diveIdFor(base),
      number: summary?.diveNumber,
      startTime: base.startTime,
      durationS,
      maxDepth: base.maxDepth,
      avgDepth: summary?.avgDepth !== undefined ? round1(summary.avgDepth) : undefined,
      minTempC: minOf(own.map((r) => r.temperature)),
      site: siteFromRecords(own),
      mode: modeFor(session.subSport),
      cylinders,
      salinity: waterType(m) === 'fresh' ? 'fresh' : 'salt',
      surfaceIntervalS: summary?.surfaceInterval,
      computer: base.computer,
      source: { format: 'garmin-fit', file: input.fileName, importedAt },
      tags: [],
      samples,
    };
    dive.metrics = computeMetrics(dive);
    if (dive.avgDepth === undefined) dive.avgDepth = dive.metrics.avgDepth;
    dives.push(dive);
  });

  if (dives.length === 0) warnings.push('Sessioni subacquee trovate ma senza profilo utilizzabile.');
  return { format: 'garmin-fit', dives, warnings };
}

// ---------------------------------------------------------------------------
// Bombole e gas
// ---------------------------------------------------------------------------

interface TankStream {
  sensor: string;
  readings: { at: number; bar: number }[];
  startBar?: number;
  endBar?: number;
  /** Litri, ricavati da volume_used / Δpressione. */
  sizeL?: number;
}

function readGases(m: FitMessages): GasMix[] {
  const enabled = (m.diveGasMesgs ?? []).filter(
    (g) => g.status === undefined || !/disabled/i.test(String(g.status)),
  );
  const mixes = enabled
    .map((g) => ({
      o2: (g.oxygenContent ?? 21) / 100,
      he: (g.heliumContent ?? 0) / 100,
    }))
    .filter((mix) => mix.o2 > 0 && mix.o2 <= 1);
  return mixes.length ? mixes : [AIR];
}

function readTanks(m: FitMessages, warnings: string[]): TankStream[] {
  const bySensor = new Map<string, TankStream>();
  for (const u of m.tankUpdateMesgs ?? []) {
    if (!(u.timestamp instanceof Date) || typeof u.pressure !== 'number') continue;
    const key = String(u.sensor ?? 'default');
    let tank = bySensor.get(key);
    if (!tank) {
      tank = { sensor: key, readings: [] };
      bySensor.set(key, tank);
    }
    tank.readings.push({ at: ms(u.timestamp), bar: u.pressure });
  }

  for (const s of m.tankSummaryMesgs ?? []) {
    const key = String(s.sensor ?? 'default');
    const tank = bySensor.get(key) ?? { sensor: key, readings: [] };
    tank.startBar = s.startPressure !== undefined ? Math.round(s.startPressure) : undefined;
    tank.endBar = s.endPressure !== undefined ? Math.round(s.endPressure) : undefined;
    // Il FIT non contiene il volume della bombola: lo deduciamo.
    if (s.volumeUsed !== undefined && s.startPressure !== undefined && s.endPressure !== undefined) {
      const delta = s.startPressure - s.endPressure;
      if (delta > 5) tank.sizeL = Math.round((s.volumeUsed / delta) * 10) / 10;
    }
    bySensor.set(key, tank);
  }

  const tanks = [...bySensor.values()];
  tanks.forEach((t) => t.readings.sort((a, b) => a.at - b.at));
  if (tanks.length && !tanks.some((t) => t.sizeL !== undefined)) {
    warnings.push(
      'Il FIT non contiene il volume della bombola e non è deducibile da tank_summary: inserisci i litri nella scheda per avere il consumo in L/min.',
    );
  }
  return tanks;
}

function buildCylinders(gases: GasMix[], tanks: TankStream[]): Cylinder[] {
  const count = Math.max(gases.length, tanks.length, 1);
  const out: Cylinder[] = [];
  for (let i = 0; i < count; i++) {
    const tank = tanks[i];
    out.push({
      description: tank ? `Trasmettitore ${tank.sensor}` : undefined,
      sizeL: tank?.sizeL,
      startBar: tank?.startBar ?? tank?.readings[0]?.bar,
      endBar: tank?.endBar ?? tank?.readings[tank.readings.length - 1]?.bar,
      mix: gases[i] ?? gases[0] ?? AIR,
    });
  }
  return out;
}

/** Pressione del trasmettitore all'istante dato (ultima lettura non successiva). */
function pressureAt(tank: TankStream, at: number): number | undefined {
  const r = tank.readings;
  if (r.length === 0) return undefined;
  let lo = 0;
  let hi = r.length - 1;
  if (at < r[0].at) return undefined;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (r[mid].at <= at) lo = mid;
    else hi = mid - 1;
  }
  return Math.round(r[lo].bar * 10) / 10;
}

// ---------------------------------------------------------------------------

function matchSummary(m: FitMessages, sessionIndex: number): FitDiveSummary | undefined {
  const summaries = m.diveSummaryMesgs ?? [];
  const forSession = summaries.filter((s) => s.referenceMesg === undefined || /session/i.test(String(s.referenceMesg)));
  return forSession[sessionIndex] ?? forSession[0] ?? summaries[sessionIndex] ?? summaries[0];
}

function modeFor(subSport: string | undefined): DiveMode {
  const s = (subSport ?? '').toLowerCase();
  if (s.includes('ccr')) return 'ccr';
  if (s.includes('apnea') || s.includes('freedive')) return 'freedive';
  if (s.includes('gauge')) return 'gauge';
  return 'oc';
}

function waterType(m: FitMessages): string | undefined {
  const settings = (m.diveSettingsMesgs ?? [])[0];
  return settings?.waterType ? String(settings.waterType).toLowerCase() : undefined;
}

function readModel(m: FitMessages): string | undefined {
  const info = (m.deviceInfoMesgs ?? []).find((d) => d.garminProduct || d.productName || d.product);
  const raw = info?.productName ?? info?.garminProduct ?? info?.product;
  if (raw === undefined) return undefined;
  return prettyProduct(String(raw));
}

/** "descentMk3i51mm" → "Descent Mk3i". */
export function prettyProduct(raw: string): string {
  const spaced = raw
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/\s?\d+\s?mm$/i, '')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Il punto d'ingresso in acqua, se il computer ha registrato il GPS. */
function siteFromRecords(records: FitRecord[]): { name: string; lat?: number; lon?: number } | undefined {
  const fix = records.find(
    (r) => typeof r.positionLat === 'number' && typeof r.positionLong === 'number',
  );
  if (!fix) return undefined;
  const lat = semicirclesToDegrees(fix.positionLat!);
  const lon = semicirclesToDegrees(fix.positionLong!);
  return { name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon };
}

/** FIT salva le coordinate in semicerchi: 2^31 semicerchi = 180°. */
export const semicirclesToDegrees = (v: number) => (v * 180) / 2 ** 31;

function syntheticSession(records: FitRecord[]): FitSession {
  const first = records[0];
  const last = records[records.length - 1];
  return {
    sport: 'diving',
    startTime: first.timestamp,
    totalElapsedTime: (ms(last.timestamp) - ms(first.timestamp)) / 1000,
    totalTimerTime: (ms(last.timestamp) - ms(first.timestamp)) / 1000,
  };
}

const ms = (d: Date | undefined) => (d instanceof Date ? d.getTime() : 0);
const round1 = (v: number) => Math.round(v * 10) / 10;

function minOf(values: (number | undefined)[]): number | undefined {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? Math.min(...nums) : undefined;
}

// ---------------------------------------------------------------------------
// Tipi minimi per i messaggi FIT che ci interessano.
// L'SDK non pubblica dichiarazioni TypeScript, quindi li descriviamo qui:
// meglio un tipo stretto e nostro che `any` sparso nel parser.
// ---------------------------------------------------------------------------

interface FitRecord {
  timestamp?: Date;
  depth?: number;
  temperature?: number;
  absolutePressure?: number;
  nextStopDepth?: number;
  nextStopTime?: number;
  timeToSurface?: number;
  ndlTime?: number;
  cnsLoad?: number;
  n2Load?: number;
  ascentRate?: number;
  positionLat?: number;
  positionLong?: number;
}

interface FitSession {
  sport?: string;
  subSport?: string;
  startTime?: Date;
  totalElapsedTime?: number;
  totalTimerTime?: number;
}

interface FitDiveSummary {
  referenceMesg?: string;
  referenceIndex?: number;
  avgDepth?: number;
  maxDepth?: number;
  surfaceInterval?: number;
  diveNumber?: number;
  bottomTime?: number;
  avgRmv?: number;
}

interface FitMessages {
  recordMesgs?: FitRecord[];
  sessionMesgs?: FitSession[];
  diveSummaryMesgs?: FitDiveSummary[];
  diveGasMesgs?: { oxygenContent?: number; heliumContent?: number; status?: string }[];
  diveSettingsMesgs?: { waterType?: string; gfLow?: number; gfHigh?: number }[];
  tankUpdateMesgs?: { timestamp?: Date; sensor?: string | number; pressure?: number }[];
  tankSummaryMesgs?: {
    sensor?: string | number;
    startPressure?: number;
    endPressure?: number;
    volumeUsed?: number;
  }[];
  fileIdMesgs?: { serialNumber?: number; garminProduct?: string }[];
  deviceInfoMesgs?: { productName?: string; garminProduct?: string; product?: number }[];
}
