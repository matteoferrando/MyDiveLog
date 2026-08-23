/**
 * Subsurface XML (`.ssrf` / `.xml`).
 *
 * Formato importante non tanto perché lo si usi, ma perché è il
 * ponte universale: Subsurface importa da praticamente qualsiasi computer
 * subacqueo e riesporta in questo XML. Chi ha uno storico decennale, ce l'ha qui.
 *
 * DUE INSIDIE, entrambe già costate tempo a chi ha scritto parser prima di noi:
 *
 *  1. Le unità sono DENTRO la stringa: `depth='18.3 m'`, `pressure0='200 bar'`,
 *     `time='14:30 min'`. E `min` in `time='14:30 min'` non significa che il
 *     valore siano minuti: sono minuti:secondi. Vedi `durationValue` in xml.ts.
 *  2. I campioni sono DELTA-CODIFICATI: un attributo che non cambia viene
 *     omesso. `<sample time='1:00 min' depth='2.44 m' />` senza `temp` non vuol
 *     dire "temperatura sconosciuta", vuol dire "la stessa di prima". Un parser
 *     che non riporta avanti i valori produce profili di temperatura a buchi.
 */

import { AIR, type Cylinder, type Dive, type DiveMode, type Sample } from '../model';
import { diveIdFor } from '../dedupe';
import { computeMetrics } from '../analysis/metrics';
import {
  attr,
  attrNum,
  child,
  children,
  depthValue,
  durationValue,
  parseXml,
  pressureValue,
  tempValue,
  text,
} from './xml';
import { comeSta, type Traduci } from '../traduci';
import { wallClockToIso } from '../units';
import type { DiveParser, ParseInput, ParseResult } from './types';

export const subsurfaceParser: DiveParser = {
  format: 'subsurface',
  label: 'Subsurface (.ssrf / .xml)',
  extensions: ['.ssrf', '.xml'],

  detect(input: ParseInput) {
    // Confronto SENSIBILE alle maiuscole, deliberatamente: Shearwater usa
    // `<diveLog>` e un `/i` qui gliela ruberebbe, mandando i suoi file nel
    // parser sbagliato che poi non troverebbe nessuna immersione.
    return !!input.text && /<divelog[\s>]/.test(input.text);
  },

  parse(input: ParseInput, t: Traduci = comeSta): ParseResult {
    const warnings: string[] = [];
    const root = parseXml(input.text ?? '');
    const divelog = child(root, 'divelog') as Record<string, unknown> | undefined;
    if (!divelog) {
      return { format: 'subsurface', dives: [], warnings: [t('Radice <divelog> non trovata.')] };
    }

    const importedAt = new Date().toISOString();
    const sites = readSites(divelog);
    const divesNode = child(divelog, 'dives');

    const raw: { node: unknown; tripLocation?: string }[] = [];
    for (const d of children(divesNode, 'dive')) raw.push({ node: d });
    for (const trip of children(divesNode, 'trip')) {
      const location = attr(trip, 'location') ?? text(child(trip, 'location'));
      for (const d of children(trip, 'dive')) raw.push({ node: d, tripLocation: location });
    }

    const dives: Dive[] = [];
    for (const { node, tripLocation } of raw) {
      const dive = readDive(node, sites, tripLocation, input.fileName, importedAt, warnings, t);
      if (dive) dives.push(dive);
    }
    if (dives.length === 0) warnings.push(t('Nessuna immersione trovata nel file Subsurface.'));
    return { format: 'subsurface', dives, warnings };
  },
};

// ---------------------------------------------------------------------------

function readSites(divelog: Record<string, unknown>) {
  const out = new Map<string, { name: string; lat?: number; lon?: number; region?: string }>();
  for (const site of children(child(divelog, 'divesites'), 'site')) {
    const uuid = attr(site, 'uuid');
    if (!uuid) continue;
    const gps = attr(site, 'gps');
    const [lat, lon] = (gps ?? '').split(/\s+/).map(Number);
    out.set(uuid.toLowerCase(), {
      name: attr(site, 'name') ?? uuid,
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
      region: attr(site, 'description'),
    });
  }
  return out;
}

function readDive(
  node: unknown,
  sites: Map<string, { name: string; lat?: number; lon?: number; region?: string }>,
  tripLocation: string | undefined,
  fileName: string,
  importedAt: string,
  warnings: string[],
  t: Traduci = comeSta,
): Dive | null {
  const date = attr(node, 'date');
  const time = attr(node, 'time') ?? '00:00:00';
  if (!date) {
    warnings.push(t('Immersione senza attributo date scartata.'));
    return null;
  }
  // `wallClockToIso` e non `new Date(...)`: Subsurface scrive l'ora dell'orologio
  // senza fuso, e interpretarla nel fuso della macchina fa dipendere l'id
  // dell'immersione da dove ti trovi quando importi.
  const startTime = wallClockToIso(`${date}T${padTime(time)}`);
  if (!startTime) {
    warnings.push(`${t('Immersione con data non interpretabile scartata:')} ${date} ${time}`);
    return null;
  }

  const cylinders: Cylinder[] = children(node, 'cylinder').map((c) => ({
    description: attr(c, 'description'),
    sizeL: depthValueless(attr(c, 'size')),
    workPressureBar: pressureValue(attr(c, 'workpressure')),
    startBar: roundOrUndef(pressureValue(attr(c, 'start'))),
    endBar: roundOrUndef(pressureValue(attr(c, 'end'))),
    mix: {
      o2: percentFraction(attr(c, 'o2')) ?? AIR.o2,
      he: percentFraction(attr(c, 'he')) ?? 0,
    },
  }));
  if (cylinders.length === 0) cylinders.push({ mix: AIR });

  // Subsurface può avere più <divecomputer> per la stessa immersione:
  // prendiamo quello con più campioni, che è il profilo migliore disponibile.
  const dcs = children(node, 'divecomputer');
  const dc = dcs.reduce<unknown>((best, current) => {
    const n = children(current, 'sample').length;
    const bn = best ? children(best, 'sample').length : -1;
    return n > bn ? current : best;
  }, undefined);

  const samples = readSamples(dc, cylinders.length);

  const depthNode = child(dc, 'depth');
  const maxDepth =
    depthValue(attr(depthNode, 'max')) ??
    (samples.length ? Math.max(...samples.map((s) => s.depth)) : undefined);
  const durationS =
    durationValue(attr(node, 'duration')) ??
    durationValue(attr(dc, 'duration')) ??
    (samples.length ? samples[samples.length - 1].t : undefined);

  if (!maxDepth || !durationS) {
    warnings.push(`${t('Immersione del')} ${date} ${t('scartata: durata o profondità mancanti.')}`);
    return null;
  }

  const siteId = attr(node, 'divesiteid')?.toLowerCase();
  const site = siteId ? sites.get(siteId) : undefined;
  const inlineLocation = text(child(node, 'location'));
  const siteName = site?.name ?? inlineLocation ?? tripLocation;

  const dcType = attr(dc, 'dctype');
  const mode: DiveMode =
    dcType === 'CCR' ? 'ccr' : dcType === 'pSCR' ? 'scr' : dcType === 'Freedive' ? 'freedive' : 'oc';

  const salinityGl = pressureValue(attr(node, 'watersalinity'));
  const base = {
    startTime,
    maxDepth: round1(maxDepth),
    durationS: Math.round(durationS),
    computer: {
      model: attr(dc, 'model'),
      deviceId: attr(dc, 'deviceid'),
      diveId: attr(dc, 'diveid'),
    },
  };

  const tags = (attr(node, 'tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const dive: Dive = {
    id: diveIdFor(base),
    number: attrNum(node, 'number'),
    startTime,
    durationS: base.durationS,
    maxDepth: base.maxDepth,
    avgDepth: roundOrUndef(depthValue(attr(depthNode, 'mean')), 2),
    minTempC: minTemp(samples),
    airTempC: tempValue(attr(node, 'airtemp')),
    site: siteName ? { name: siteName, lat: site?.lat, lon: site?.lon, region: site?.region } : undefined,
    buddy: text(child(node, 'buddy')),
    notes: text(child(node, 'notes')),
    mode,
    cylinders,
    salinity: salinityGl !== undefined && salinityGl < 1015 ? 'fresh' : 'salt',
    surfacePressureBar: pressureValue(attr(node, 'airpressure')),
    computer: base.computer,
    source: { format: 'subsurface', file: fileName, importedAt },
    rating: attrNum(node, 'rating'),
    visibilityM: attrNum(node, 'visibility'),
    tags,
    samples,
  };
  dive.metrics = computeMetrics(dive);
  if (dive.avgDepth === undefined) dive.avgDepth = dive.metrics.avgDepth;
  return dive;
}

/**
 * Legge i campioni riportando avanti i valori omessi.
 * `carry` è lo stato: ogni attributo assente eredita il valore precedente.
 */
function readSamples(dc: unknown, nCylinders: number): Sample[] {
  const out: Sample[] = [];
  const carry: Partial<Sample> & { pressures: (number | undefined)[] } = {
    pressures: new Array(Math.max(1, nCylinders)).fill(undefined),
  };

  for (const s of children(dc, 'sample')) {
    const t = durationValue(attr(s, 'time'));
    const depth = depthValue(attr(s, 'depth'));
    if (t === undefined) continue;

    if (depth !== undefined) carry.depth = depth;
    const temp = tempValue(attr(s, 'temp'));
    if (temp !== undefined) carry.tempC = temp;

    for (let i = 0; i < carry.pressures.length + 1; i++) {
      const p = pressureValue(attr(s, `pressure${i}`));
      if (p !== undefined) carry.pressures[i] = p;
    }

    const ndl = durationValue(attr(s, 'ndl'));
    if (ndl !== undefined) carry.ndlS = ndl;
    const tts = durationValue(attr(s, 'tts'));
    if (tts !== undefined) carry.ttsS = tts;
    const stopDepth = depthValue(attr(s, 'stopdepth'));
    if (stopDepth !== undefined) carry.stopDepth = stopDepth;
    const stopTime = durationValue(attr(s, 'stoptime'));
    if (stopTime !== undefined) carry.stopTimeS = stopTime;
    const inDeco = attr(s, 'in_deco');
    if (inDeco !== undefined) carry.inDeco = inDeco === '1';
    const cns = percent(attr(s, 'cns'));
    if (cns !== undefined) carry.cns = cns;
    const po2 = pressureValue(attr(s, 'po2'));
    if (po2 !== undefined) carry.ppo2 = po2;
    const hr = attrNum(s, 'heartbeat');
    if (hr !== undefined) carry.heartRate = hr;

    out.push({
      t,
      depth: carry.depth ?? 0,
      tempC: carry.tempC,
      pressureBar: carry.pressures.some((p) => p !== undefined) ? [...carry.pressures] : undefined,
      ndlS: carry.ndlS,
      ttsS: carry.ttsS,
      stopDepth: carry.stopDepth,
      stopTimeS: carry.stopTimeS,
      inDeco: carry.inDeco,
      cns: carry.cns,
      ppo2: carry.ppo2,
      heartRate: carry.heartRate,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------

const round1 = (v: number) => Math.round(v * 10) / 10;

function roundOrUndef(v: number | undefined, digits = 0): number | undefined {
  if (v === undefined) return undefined;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** `size='13.399 l'` → 13.4 (litri). */
function depthValueless(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const v = Number(raw.replace(/[^\d.]/g, ''));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : undefined;
}

/** `'32.0%'` → 0.32 */
function percentFraction(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const v = Number(raw.replace('%', ''));
  return Number.isFinite(v) ? v / 100 : undefined;
}

/** `'45%'` → 45 */
function percent(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const v = Number(raw.replace('%', ''));
  return Number.isFinite(v) ? v : undefined;
}

function minTemp(samples: Sample[]): number | undefined {
  const temps = samples.map((s) => s.tempC).filter((t): t is number => t !== undefined);
  return temps.length ? Math.min(...temps) : undefined;
}

function padTime(t: string): string {
  const parts = t.split(':');
  while (parts.length < 3) parts.push('00');
  return parts.map((p) => p.padStart(2, '0')).join(':');
}
