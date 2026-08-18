/**
 * UDDF 3.x — Universal Dive Data Format.
 *
 * È il formato di scambio da preferire quando un computer lo esporta (Shearwater
 * Cloud lo fa), perché è l'unico con unità dichiarate e non ambigue.
 *
 * ATTENZIONE ALLE UNITÀ: UDDF è interamente SI. Non "quasi" SI.
 *   <depth>18.3</depth>            → 18.3 METRI
 *   <temperature>293.15</temperature> → KELVIN, non Celsius
 *   <tankpressure>20000000</tankpressure> → PASCAL, cioè 200 bar
 *   <setpo2>1.4e5</setpo2>         → PASCAL, cioè 1.4 bar
 *   <tankvolume>0.012</tankvolume> → METRI CUBI, cioè 12 litri
 *   <o2>0.32</o2>                  → FRAZIONE, non percentuale
 *
 * Nota pratica: l'export UDDF di Shearwater non collega correttamente le
 * miscele alle bombole (problema noto, discusso sulla mailing list di
 * Subsurface). Se `tankdata` non ha `link`, associamo la prima miscela
 * definita e lo segnaliamo fra i warning.
 */

import { AIR, type Cylinder, type Dive, type DiveMode, type GasMix, type Sample } from '../model';
import { cubicMToL, kelvinToC, pascalToBar, wallClockToIso } from '../units';
import { diveIdFor } from '../dedupe';
import { computeMetrics } from '../analysis/metrics';
import { asArray, attr, attrNumAny, child, children, num, parseXml, text } from './xml';
import type { DiveParser, ParseInput, ParseResult } from './types';

export const uddfParser: DiveParser = {
  format: 'uddf',
  label: 'UDDF (Shearwater Cloud, Subsurface, MacDive…)',
  extensions: ['.uddf', '.xml'],

  detect(input: ParseInput) {
    return !!input.text && /<uddf[\s>]/i.test(input.text);
  },

  parse(input: ParseInput): ParseResult {
    const warnings: string[] = [];
    const root = parseXml(input.text ?? '');
    const uddf = (child(root, 'uddf') ?? root) as Record<string, unknown>;
    const importedAt = new Date().toISOString();

    const mixes = readGasDefinitions(uddf);
    const sites = readDiveSites(uddf);
    // Il generatore si legge ma NON diventa un computer subacqueo: è il programma
    // che ha scritto il file, e finisce nell'avviso quando serve, non fra gli
    // strumenti.
    const generator = text(child(child(uddf, 'generator'), 'name'));
    if (generator) warnings.push(`File scritto da ${generator}.`);

    const dives: Dive[] = [];
    for (const group of children(child(uddf, 'profiledata'), 'repetitiongroup')) {
      for (const node of children(group, 'dive')) {
        const dive = readDive(node, mixes, sites, input.fileName, importedAt, warnings);
        if (dive) dives.push(dive);
      }
    }
    // Alcuni generatori mettono <dive> direttamente sotto <profiledata>.
    if (dives.length === 0) {
      for (const node of children(child(uddf, 'profiledata'), 'dive')) {
        const dive = readDive(node, mixes, sites, input.fileName, importedAt, warnings);
        if (dive) dives.push(dive);
      }
    }

    if (dives.length === 0) warnings.push('Nessuna immersione trovata nel file UDDF.');
    return { format: 'uddf', dives, warnings };
  },
};

// ---------------------------------------------------------------------------

function readGasDefinitions(uddf: Record<string, unknown>): Map<string, GasMix & { name?: string }> {
  const out = new Map<string, GasMix & { name?: string }>();
  for (const mix of children(child(uddf, 'gasdefinitions'), 'mix')) {
    const id = attr(mix, 'id');
    if (!id) continue;
    out.set(id, {
      o2: num(child(mix, 'o2')) ?? 0.21,
      he: num(child(mix, 'he')) ?? 0,
      name: text(child(mix, 'name')),
    });
  }
  return out;
}

interface SiteRecord {
  name: string;
  region?: string;
  country?: string;
  lat?: number;
  lon?: number;
}

function readDiveSites(uddf: Record<string, unknown>): Map<string, SiteRecord> {
  const out = new Map<string, SiteRecord>();
  for (const site of children(child(uddf, 'divesite'), 'site')) {
    const id = attr(site, 'id');
    if (!id) continue;
    const geo = child(site, 'geography');
    out.set(id, {
      name: text(child(site, 'name')) ?? id,
      region: text(child(geo, 'location')) ?? text(child(geo, 'province')),
      country: text(child(geo, 'country')),
      lat: num(child(geo, 'latitude')),
      lon: num(child(geo, 'longitude')),
    });
  }
  return out;
}

function readDive(
  node: unknown,
  mixes: Map<string, GasMix & { name?: string }>,
  sites: Map<string, SiteRecord>,
  fileName: string,
  importedAt: string,
  warnings: string[],
): Dive | null {
  const before = child(node, 'informationbeforedive');
  const after = child(node, 'informationafterdive');

  const datetime = text(child(before, 'datetime'));
  if (!datetime) {
    warnings.push('Immersione senza <datetime> scartata.');
    return null;
  }
  const startTime = normaliseDateTime(datetime);
  if (!startTime) {
    warnings.push(
      `Immersione scartata: data «${datetime}» in un formato che non so leggere. ` +
        'UDDF vuole ISO 8601 (2026-06-14T10:38:00); segnala il file, che il formato si aggiunge.',
    );
    return null;
  }

  // --- bombole e miscele ---
  const mixIds = [...mixes.keys()];
  const cylinders: Cylinder[] = [];
  let linkFallbackUsed = false;
  for (const tank of children(node, 'tankdata')) {
    const refs = asArray(child(tank, 'link'))
      .map((l) => attr(l, 'ref'))
      .filter(Boolean) as string[];
    let mix = refs.map((r) => mixes.get(r)).find(Boolean);
    if (!mix && mixIds.length) {
      mix = mixes.get(mixIds[0]);
      linkFallbackUsed = true;
    }
    const volumeM3 = num(child(tank, 'tankvolume'));
    cylinders.push({
      description: mix?.name,
      sizeL: volumeM3 !== undefined ? round1(cubicMToL(volumeM3)) : undefined,
      startBar: toBar(num(child(tank, 'tankpressurebegin'))),
      endBar: toBar(num(child(tank, 'tankpressureend'))),
      mix: mix ? { o2: mix.o2, he: mix.he } : AIR,
    });
  }
  if (linkFallbackUsed) {
    warnings.push(
      "Alcune bombole non hanno il collegamento alla miscela (limite noto dell'export UDDF di Shearwater): assegnata la prima miscela definita.",
    );
  }
  if (cylinders.length === 0 && mixIds.length) {
    const first = mixes.get(mixIds[0])!;
    cylinders.push({ description: first.name, mix: { o2: first.o2, he: first.he } });
  }
  if (cylinders.length === 0) cylinders.push({ mix: AIR });

  // --- profilo ---
  const gasIndexByRef = new Map<string, number>();
  children(node, 'tankdata').forEach((tank, i) => {
    asArray(child(tank, 'link')).forEach((l) => {
      const ref = attr(l, 'ref');
      if (ref) gasIndexByRef.set(ref, i);
    });
  });

  const samples: Sample[] = [];
  let currentGas: number | undefined;
  for (const wp of children(child(node, 'samples'), 'waypoint')) {
    const t = num(child(wp, 'divetime'));
    const depth = num(child(wp, 'depth'));
    if (t === undefined || depth === undefined) continue;

    const switchRef = attr(child(wp, 'switchmix'), 'ref');
    if (switchRef) currentGas = gasIndexByRef.get(switchRef) ?? currentGas;

    const decostop = child(wp, 'decostop');
    const stopDepth = attrNumAny(decostop, 'decodepth', 'depth');
    const stopTime = attrNumAny(decostop, 'duration', 'time');
    const kind = attr(decostop, 'kind');

    const tankPressurePa = num(child(wp, 'tankpressure'));
    const sample: Sample = {
      t: Math.round(t),
      depth,
      tempC: mapDefined(num(child(wp, 'temperature')), kelvinToC),
      pressureBar:
        tankPressurePa !== undefined ? indexed(currentGas ?? 0, pascalToBar(tankPressurePa)) : undefined,
      ndlS: num(child(wp, 'nodecotime')),
      ttsS: num(child(wp, 'remainingbottomtime')),
      stopDepth,
      stopTimeS: stopTime,
      inDeco: kind === 'mandatory' || (stopDepth !== undefined && stopDepth > 0),
      cns: mapDefined(num(child(wp, 'cns')), (v) => (v <= 1 ? v * 100 : v)),
      ppo2: mapDefined(num(child(wp, 'measuredpo2')) ?? num(child(wp, 'calculatedpo2')), pascalToBar),
      setpoint: mapDefined(num(child(wp, 'setpo2')), pascalToBar),
      gasIndex: currentGas,
      heartRate: num(child(wp, 'heartrate')) ?? num(child(wp, 'pulserate')),
    };
    samples.push(sample);
  }

  // Durata e profondità dichiarate dal file, oppure dedotte dai campioni.
  //
  // Dedurle va benissimo quando il file semplicemente non le scrive. Va molto
  // meno bene quando il file è TRONCATO — un download interrotto — perché allora
  // i campioni finiscono a metà e ne esce un'immersione che sembra vera: venti
  // minuti invece di quaranta, che la deduplica non riconosce come la stessa
  // (durata troppo diversa) e che quindi entra in archivio ACCANTO all'originale.
  // Non possiamo sapere se un file è troncato, ma possiamo dire che quei numeri
  // sono dedotti, ed è tutto quello che serve per non fidarsene.
  const declaredDuration = num(child(after, 'diveduration'));
  const declaredDepth = num(child(after, 'greatestdepth'));
  const durationS = declaredDuration ?? (samples.length ? samples[samples.length - 1].t : 0);
  const maxDepth = declaredDepth ?? (samples.length ? Math.max(...samples.map((s) => s.depth)) : 0);
  if (declaredDuration === undefined && declaredDepth === undefined && samples.length > 2) {
    warnings.push(
      `Immersione del ${startTime.slice(0, 16)}: il file non dichiara durata né profondità massima, ` +
        'ricavate dai campioni. Se il file è stato scaricato a metà, questi numeri descrivono solo la parte arrivata.',
    );
  }

  if (!durationS || !maxDepth) {
    warnings.push(`Immersione del ${startTime} scartata: durata o profondità mancanti.`);
    return null;
  }

  const siteRef = asArray(child(before, 'link'))
    .map((l) => attr(l, 'ref'))
    .find(Boolean);
  const site = siteRef ? sites.get(siteRef) : undefined;

  const apparatus = text(child(before, 'apparatus'));
  const mode: DiveMode =
    apparatus === 'rebreather' || apparatus === 'closed-circuit'
      ? 'ccr'
      : apparatus === 'semi-closed-circuit'
        ? 'scr'
        : 'oc';

  const base = {
    startTime,
    maxDepth: round1(maxDepth),
    durationS: Math.round(durationS),
    // NIENTE `model` dal generatore del file.
    //
    // Prima ci finiva il nome del programma che aveva scritto l'UDDF.
    // Reimportando un nostro export, ogni immersione si portava dietro un secondo
    // «computer» chiamato MyDiveLog, che la deduplica non toglieva perché è
    // genuinamente diverso dal principale. Il generatore è software: sta nella
    // provenienza (`source`), non fra gli strumenti.
    computer: {
      model: undefined as string | undefined,
      decoModel: text(child(child(child(node, 'applicationdata'), 'decomodel'), 'name')),
    },
  };

  const dive: Dive = {
    id: diveIdFor(base),
    number: num(child(before, 'divenumber')),
    startTime: base.startTime,
    durationS: base.durationS,
    maxDepth: base.maxDepth,
    avgDepth: mapDefined(num(child(after, 'averagedepth')), round1),
    minTempC: mapDefined(num(child(after, 'lowesttemperature')), (k) => round1(kelvinToC(k))),
    airTempC: mapDefined(num(child(before, 'airtemperature')), (k) => round1(kelvinToC(k))),
    site: site ? { ...site } : undefined,
    // Le note UDDF stanno dentro <para>, non come testo diretto di <notes>:
    // è così che le scrivono Subsurface e gli altri, e finora le buttavamo via
    // in silenzio. Si accettano entrambe le forme.
    notes: text(child(child(after, 'notes'), 'para')) ?? text(child(after, 'notes')),
    mode,
    cylinders,
    salinity: 'salt',
    surfacePressureBar: mapDefined(num(child(before, 'surfacepressure')), pascalToBar),
    surfaceIntervalS: num(child(child(before, 'surfaceintervalbeforedive'), 'passedtime')),
    computer: base.computer,
    source: { format: 'uddf', file: fileName, importedAt },
    rating: num(child(after, 'rating')),
    visibilityM: num(child(after, 'visibility')),
    tags: [],
    samples,
  };
  dive.metrics = computeMetrics(dive);
  if (dive.avgDepth === undefined) dive.avgDepth = dive.metrics.avgDepth;
  return dive;
}

// ---------------------------------------------------------------------------

const toBar = (pa: number | undefined) => (pa === undefined ? undefined : Math.round(pascalToBar(pa)));
const round1 = (v: number) => Math.round(v * 10) / 10;

function mapDefined<T, R>(v: T | undefined, fn: (v: T) => R): R | undefined {
  return v === undefined ? undefined : fn(v);
}

function indexed(index: number, value: number): (number | undefined)[] {
  const arr: (number | undefined)[] = [];
  arr[index] = value;
  return arr;
}

/**
 * UDDF usa ISO 8601, ma non tutti i generatori includono il fuso.
 *
 * Senza fuso quei numeri sono la lettura dell'orologio del computer subacqueo, e
 * vengono fissati su UTC: interpretarli nel fuso della macchina che importa
 * renderebbe l'istante — e quindi l'identificativo dell'immersione — diverso da
 * dispositivo a dispositivo. Vedi `wallClockToIso`.
 */
export function normaliseDateTime(raw: string): string | undefined {
  // Prima, una data che il parser non capiva diventava il 1° gennaio 1970.
  //
  // Il danno non era la data sbagliata: era che TUTTE le immersioni del file
  // finivano allo stesso istante, e a quel punto la deduplica — che riconosce
  // come «la stessa immersione» due tuffi vicini nel tempo e simili per
  // profondità — ne fondeva a due a due. Tre immersioni entravano, due restavano,
  // e la schermata di import diceva «1 duplicato». Senza un avviso.
  return wallClockToIso(raw);
}
