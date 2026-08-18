/**
 * Statistiche aggregate su tutto l'archivio.
 *
 * Regola trasversale: una metrica derivata dal profilo (consumo, assetto,
 * velocità di risalita) viene calcolata SOLO sulle immersioni che hanno quel
 * dato, e la UI mostra sempre su quante immersioni si basa. Un consumo medio
 * calcolato su 4 immersioni su 180 non è un consumo medio, e presentarlo come
 * tale è il modo più rapido di rendere inutile una dashboard.
 */

import { oxygenLoad, type OxygenLoad } from './oxygen';
import type { Dive } from '../model';
import { DEEP_STOP_MIN_DEPTH_M } from './metrics';

export interface Bucket {
  label: string;
  value: number;
  /** Chiave ordinabile (es. "2026-06"). */
  key: string;
}

export interface SeriesPoint {
  /** Millisecondi epoch, per l'asse temporale. */
  at: number;
  value: number;
  diveId: string;
}

export interface Trend {
  /** Variazione stimata per anno, nelle unità della serie. */
  slopePerYear: number;
  /** Media dei primi e degli ultimi punti confrontati. */
  firstHalf: number;
  secondHalf: number;
  n: number;
  /** 'meglio' / 'peggio' / 'stabile', già interpretato secondo `lowerIsBetter`. */
  direction: 'improving' | 'worsening' | 'flat';
}

export interface SiteStat {
  name: string;
  dives: number;
  totalS: number;
  maxDepth: number;
  lastDive: string;
}

export interface Aggregates {
  count: number;
  withProfile: number;
  totalS: number;
  maxDepthEver: number;
  avgMaxDepth: number;
  avgDurationS: number;
  deepest?: Dive;
  longest?: Dive;
  firstDive?: string;
  lastDive?: string;
  daysSinceLastDive?: number;

  divesLast90d: number;
  /** Immersioni negli ultimi dodici mesi, DENTRO la finestra scelta. */
  divesLast12m: number;
  /**
   * Su quanti mesi si sta effettivamente guardando, al massimo dodici.
   *
   * Serve a non dividere per dodici un conteggio raccolto su sei: la frequenza
   * mensile è l'unica grandezza dell'aggregato che dipende dall'ampiezza della
   * finestra, e senza questo numero mentiva ogni volta che la finestra non era
   * l'anno intero.
   */
  spanMonths: number;
  /** Media mensile sugli ultimi 12 mesi. */
  perMonthLast12m: number;

  byYear: Bucket[];
  byMonth: Bucket[];
  byDepthBand: Bucket[];
  byMode: Bucket[];
  byMix: Bucket[];
  topSites: SiteStat[];

  deepDives24: number;
  deepDives30: number;
  deepDives40: number;
  decoDives: number;
  ccrDives: number;
  coldDives: number;

  /**
   * GF99 all'uscita calcolato da NOI, su tutte le immersioni con un profilo.
   *
   * Prima questa serie veniva da `reported.gf99End`, cioè solo dalle immersioni
   * Shearwater: la tendenza aveva buchi ogni volta che si scendeva con un altro
   * computer, e due immersioni della stessa uscita potevano comparire o no a
   * seconda di quale strumento avesse scritto il file. Ora la serie è completa
   * perché il modello lo abbiamo, ed è validato: un solo modello su tutto
   * l'archivio è l'unica base su cui una tendenza significhi qualcosa.
   */
  gf99: SeriesPoint[];
  avgGf99?: number;
  maxGf99?: number;
  /** Lo stesso valore, ma come lo scrive il computer: solo dove c'è. */
  gf99Reported: SeriesPoint[];
  /**
   * Scarto medio assoluto fra il nostro GF99 e quello del computer, sulle
   * immersioni in cui esistono entrambi. È la misura di quanto ci si può fidare
   * della serie completa, e va mostrata accanto ad essa invece che nascosta.
   */
  gf99Agreement?: number;
  gf99AgreementCount: number;

  rmv: SeriesPoint[];
  rmvTrend?: Trend;
  avgRmv?: number;

  trim: SeriesPoint[];
  trimTrend?: Trend;
  avgTrim?: number;

  maxAscentRate: SeriesPoint[];
  ascentTrend?: Trend;
  /** Frazione di immersioni con almeno 30 s sopra il limite di risalita. */
  fastAscentRate?: number;

  /** Frazione di immersioni non-deco con sosta di sicurezza completata. */
  safetyStopRate?: number;
  safetyStopEligible: number;

  ceilingViolations: number;
  /**
   * Su quante immersioni la violazione del tetto è VERIFICABILE: solo dove il
   * profilo porta il canale del tetto. Le altre non sono "senza violazioni",
   * sono non verificabili, e usare il totale come denominatore diluiva il dato
   * fino a farlo sparire.
   */
  ceilingEligible: number;
  /** Frazione di immersioni terminate sotto i 50 bar. */
  lowReserveRate?: number;
  lowReserveEligible: number;

  /** Carico di ossigeno giorno per giorno: CNS col dimezzamento, OTU additive. */
  oxygen: OxygenLoad;
  /** Velocità sull'ultimo tratto, dalla sosta alla superficie. */
  finalAscent: SeriesPoint[];
  /** Quante immersioni hanno superato il riferimento DAN di 60 m/min su quel tratto. */
  fastFinalAscents: number;

  /** Immersioni con una sosta profonda riconoscibile, e su quante era sensato farla. */
  deepStopDives: number;
  deepStopEligible: number;
  /** Indice di dente di sega, metri sprecati per ora: serie e mediana. */
  sawtooth: SeriesPoint[];
  /**
   * I quartili del dente di sega su questo archivio.
   *
   * L'indice non ha una soglia: il manuale dice di evitare i profili a dente di
   * sega e non quantifica «molti». Un numero senza riferimento non si può leggere
   * — «14 m/h» non dice niente a nessuno — quindi il riferimento lo fornisce
   * l'archivio stesso: dove cade questa immersione rispetto alle proprie. È
   * l'unico paragone onesto disponibile.
   */
  sawtoothRef?: { p25: number; p50: number; p75: number; n: number };
  /** Verso del profilo in metri, con segno: quanto la prima metà sta più giù. */
  depthTrend: SeriesPoint[];
  /**
   * Le ripetitive: quante sono, e quanto è costato loro il carico residuo.
   *
   * Il costo è la differenza fra il GF99 con cui sono uscite e quello con cui
   * sarebbero uscite partendo da tessuti puliti. È una grandezza che nessun
   * computer subacqueo mostra, perché richiede di guardare due immersioni
   * insieme, e che qui abbiamo per costruzione.
   */
  repetitiveDives: number;
  /** Costo mediano del carico residuo, punti di GF99. */
  repetitiveCostMedian?: number;
  /** Il caso peggiore, e su quale immersione. */
  repetitiveCostWorst?: { points: number; dive: Dive; surfaceIntervalMin?: number };
  /** Intervallo di superficie mediano fra due immersioni della stessa giornata, minuti. */
  surfaceIntervalMedian?: number;
  /** Quante immersioni hanno la parte profonda per prima, come si raccomanda. */
  deepestFirstDives: number;
  deepestFirstEligible: number;
  /** Cambi di gas fatti sotto la MOD del gas di destinazione: dovrebbero essere zero. */
  badGasSwitches: number;
}

const DAY = 86_400_000;

/**
 * Mediana: la statistica giusta quando la domanda è "di solito".
 * Sta qui perché la usano sia le pagine sia le regole di giudizio, e due copie
 * della stessa formula sono due occasioni di scriverla diversa.
 */
export function medianOf(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function aggregate(dives: Dive[], now: number = Date.now()): Aggregates {
  const sorted = [...dives].sort((a, b) => at(a) - at(b));
  const withProfile = sorted.filter((d) => (d.metrics?.quality?.sampleCount ?? 0) > 2);
  // Su quanti mesi si sta guardando: la finestra è già stata applicata a monte,
  // qui si misura l'ampiezza reale dell'insieme ricevuto.
  const oldest = sorted.length ? at(sorted[0]) : now;
  const spanMonths = Math.max(1, Math.min(12, (now - oldest) / (30.44 * DAY)));

  const totalS = sum(sorted.map((d) => d.durationS));
  const deepest = maxBy(sorted, (d) => d.maxDepth);
  const longest = maxBy(sorted, (d) => d.durationS);
  const last = sorted[sorted.length - 1];

  const rmv = series(sorted, (d) => d.metrics?.rmvLpm);
  const gf99 = series(sorted, (d) => d.metrics?.gf99Pct);
  const gf99Reported = series(sorted, (d) => d.reported?.gf99End);
  // Quanto i due modelli vanno d'accordo, misurato qui e non affermato altrove.
  const bothGf = sorted.filter(
    (d) => d.metrics?.gf99Pct !== undefined && d.reported?.gf99End !== undefined,
  );
  const trim = series(sorted, (d) => d.metrics?.bottomVerticalTravelMpm);
  const ascent = series(sorted, (d) => d.metrics?.maxAscentRateMpm);

  // Sosta di sicurezza: valutabile solo su immersioni senza obbligo deco,
  // oltre i 10 m e con un profilo campionato.
  const safetyEligible = withProfile.filter(
    (d) => d.maxDepth >= 10 && (d.metrics?.decoS ?? 0) < 60 && d.mode !== 'freedive',
  );
  const reserveEligible = sorted.filter((d) => d.metrics?.endPressureBar !== undefined);

  return {
    count: sorted.length,
    withProfile: withProfile.length,
    totalS,
    maxDepthEver: sorted.length ? Math.max(...sorted.map((d) => d.maxDepth)) : 0,
    avgMaxDepth: mean(sorted.map((d) => d.maxDepth)) ?? 0,
    avgDurationS: mean(sorted.map((d) => d.durationS)) ?? 0,
    deepest,
    longest,
    firstDive: sorted[0]?.startTime,
    lastDive: last?.startTime,
    daysSinceLastDive: last ? Math.floor((now - at(last)) / DAY) : undefined,

    // Questi tre contano su quello che ricevono, che è già filtrato dalla
    // finestra scelta nell'interfaccia. `spanMonths` dice su quanti mesi si sta
    // guardando davvero, e la frequenza si divide per QUELLI: scegliendo «ultimi
    // 6 mesi» il coach accusava di scarsa frequenza chi fa 2.6 immersioni al mese,
    // perché divideva per dodici un conteggio di sei.
    divesLast90d: sorted.filter((d) => now - at(d) <= 90 * DAY).length,
    divesLast12m: sorted.filter((d) => now - at(d) <= 365 * DAY).length,
    spanMonths: round(spanMonths, 1),
    perMonthLast12m: round(
      sorted.filter((d) => now - at(d) <= 365 * DAY).length / Math.max(1, Math.min(12, spanMonths)),
      1,
    ),

    byYear: byYear(sorted),
    byMonth: byMonth(sorted, now),
    byDepthBand: byDepthBand(sorted),
    byMode: byKey(sorted, (d) => modeLabel(d)),
    byMix: byKey(sorted, (d) => mixLabel(d)),
    topSites: topSites(sorted),

    deepDives24: sorted.filter((d) => d.maxDepth >= 24).length,
    deepDives30: sorted.filter((d) => d.maxDepth >= 30).length,
    deepDives40: sorted.filter((d) => d.maxDepth >= 40).length,
    // Un'immersione conta come decompressiva se il PROFILO mostra l'obbligo
    // oppure se il computer lo ha dichiarato. Servono entrambe le vie: il formato
    // Uwatec non contiene dati di decompressione, quindi sulle immersioni
    // importate da LogTRAK il profilo non può dirlo — lo dice solo il riepilogo
    // Shearwater della stessa immersione.
    decoDives: sorted.filter(
      (d) => (d.metrics?.decoS ?? 0) >= 60 || (d.reported?.maxDecoObligationS ?? 0) >= 60,
    ).length,
    ccrDives: sorted.filter((d) => d.mode === 'ccr').length,
    coldDives: sorted.filter((d) => (d.minTempC ?? 99) <= 14).length,

    gf99,
    avgGf99: mean(gf99.map((p) => p.value)),
    maxGf99: gf99.length ? Math.max(...gf99.map((p) => p.value)) : undefined,
    gf99Reported,
    gf99Agreement: mean(
      bothGf.map((d) => Math.abs((d.metrics!.gf99Pct as number) - (d.reported!.gf99End as number))),
    ),
    gf99AgreementCount: bothGf.length,

    rmv,
    rmvTrend: trend(rmv, true),
    avgRmv: mean(rmv.map((p) => p.value)),

    trim,
    trimTrend: trend(trim, true),
    avgTrim: mean(trim.map((p) => p.value)),

    maxAscentRate: ascent,
    ascentTrend: trend(ascent, true),
    fastAscentRate: withProfile.length
      ? round(
          withProfile.filter((d) => (d.metrics?.fastAscentS ?? 0) + (d.metrics?.fastShallowAscentS ?? 0) >= 30)
            .length / withProfile.length,
          3,
        )
      : undefined,

    safetyStopRate: safetyEligible.length
      ? round(safetyEligible.filter((d) => d.metrics?.didSafetyStop).length / safetyEligible.length, 3)
      : undefined,
    safetyStopEligible: safetyEligible.length,

    ceilingViolations: sorted.filter((d) => (d.metrics?.ceilingViolationS ?? 0) > 10).length,
    ceilingEligible: sorted.filter((d) => d.metrics?.quality?.hasCeiling).length,
    lowReserveRate: reserveEligible.length
      ? round(reserveEligible.filter((d) => (d.metrics!.endPressureBar ?? 0) < 50).length / reserveEligible.length, 3)
      : undefined,
    lowReserveEligible: reserveEligible.length,
    oxygen: oxygenLoad(sorted),
    finalAscent: series(sorted, (d) => d.metrics?.finalAscentRateMpm),
    // 60 m/min è la media che DAN misura sul tratto dopo la sosta di sicurezza
    // (TDI Advanced Nitrox p. 38): non è un limite, è il comportamento reale
    // contro cui confrontarsi.
    fastFinalAscents: sorted.filter((d) => (d.metrics?.finalAscentRateMpm ?? 0) > 60).length,
    // La sosta profonda ha senso solo dove c'è profondità da dimezzare: sotto i
    // 20 m il punto medio cade dentro la sosta di sicurezza.
    // Numeratore e denominatore sullo STESSO insieme: prima il numeratore
    // contava tutte le immersioni con una sosta profonda riconosciuta e il
    // denominatore solo quelle sopra i venti metri, e sull'archivio vero usciva
    // «114% con sosta profonda». La soglia adesso è applicata anche a monte, in
    // `metrics.ts`, ma qui resta esplicita perché due filtri che devono
    // corrispondere è meglio vederli vicini.
    deepStopDives: withProfile.filter(
      (d) => d.maxDepth >= DEEP_STOP_MIN_DEPTH_M && (d.metrics?.deepStopS ?? 0) > 0,
    ).length,
    deepStopEligible: withProfile.filter((d) => d.maxDepth >= DEEP_STOP_MIN_DEPTH_M).length,
    sawtooth: series(sorted, (d) => d.metrics?.sawtoothMPerHour),
    sawtoothRef: quartilesOf(
      withProfile.map((d) => d.metrics?.sawtoothMPerHour).filter((v): v is number => v !== undefined),
    ),
    depthTrend: series(sorted, (d) => d.metrics?.depthTrendM),
    ...repetitiveStats(sorted),
    deepestFirstDives: withProfile.filter((d) => d.metrics?.deepestPartFirst === true).length,
    deepestFirstEligible: withProfile.filter((d) => d.metrics?.deepestPartFirst !== undefined).length,
    badGasSwitches: sorted.reduce((a, d) => a + (d.metrics?.badGasSwitches ?? 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Serie e tendenze
// ---------------------------------------------------------------------------

function series(dives: Dive[], pick: (d: Dive) => number | undefined): SeriesPoint[] {
  return dives
    .map((d) => ({ at: at(d), value: pick(d), diveId: d.id }))
    .filter((p): p is SeriesPoint => p.value !== undefined && Number.isFinite(p.value));
}

/**
 * Tendenza di una serie temporale: regressione lineare sui millisecondi,
 * riportata a variazione per anno, più il confronto fra la prima e la seconda
 * metà dei punti (più leggibile della pendenza per chi legge la UI).
 *
 * `lowerIsBetter` per consumo, assetto, velocità di risalita: scendere è
 * migliorare. La soglia del 5% evita di chiamare "miglioramento" il rumore.
 */
export function trend(points: SeriesPoint[], lowerIsBetter: boolean): Trend | undefined {
  if (points.length < 4) return undefined;
  const n = points.length;
  const meanX = points.reduce((a, p) => a + p.at, 0) / n;
  const meanY = points.reduce((a, p) => a + p.value, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.at - meanX) * (p.value - meanY);
    den += (p.at - meanX) ** 2;
  }
  const slopePerMs = den === 0 ? 0 : num / den;
  const slopePerYear = slopePerMs * 365 * DAY;

  const half = Math.floor(n / 2);
  const firstHalf = mean(points.slice(0, half).map((p) => p.value))!;
  const secondHalf = mean(points.slice(n - half).map((p) => p.value))!;
  const relative = firstHalf === 0 ? 0 : (secondHalf - firstHalf) / Math.abs(firstHalf);

  let direction: Trend['direction'] = 'flat';
  if (Math.abs(relative) >= 0.05) {
    const gettingSmaller = relative < 0;
    direction = gettingSmaller === lowerIsBetter ? 'improving' : 'worsening';
  }

  return {
    slopePerYear: round(slopePerYear, 2),
    firstHalf: round(firstHalf, 2),
    secondHalf: round(secondHalf, 2),
    n,
    direction,
  };
}

// ---------------------------------------------------------------------------
// Raggruppamenti
// ---------------------------------------------------------------------------

function byYear(dives: Dive[]): Bucket[] {
  return groupCount(dives, (d) => String(new Date(d.startTime).getUTCFullYear()));
}

function byMonth(dives: Dive[], now: number): Bucket[] {
  // 24 mesi pieni, anche quelli a zero: un istogramma con i buchi mostra la
  // stagionalità e le pause, che è esattamente l'informazione utile.
  const out: Bucket[] = [];
  const cursor = new Date(now);
  const keys: string[] = [];
  for (let i = 23; i >= 0; i--) {
    // Costruito in UTC come le chiavi delle immersioni: mescolare `Date.UTC` e il
    // costruttore locale faceva cadere un'immersione di fine mese nel secchio
    // sbagliato a seconda del fuso di chi guarda.
    const d = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const counts = new Map<string, number>();
  for (const d of dives) {
    const dt = new Date(d.startTime);
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  for (const key of keys) {
    const [y, mo] = key.split('-');
    out.push({ key, label: `${MONTHS[+mo - 1]} ${y.slice(2)}`, value: counts.get(key) ?? 0 });
  }
  return out;
}

const DEPTH_BANDS: { max: number; label: string }[] = [
  { max: 12, label: '0–12 m' },
  { max: 18, label: '12–18 m' },
  { max: 24, label: '18–24 m' },
  { max: 30, label: '24–30 m' },
  { max: 40, label: '30–40 m' },
  { max: 60, label: '40–60 m' },
  { max: Infinity, label: '60 m+' },
];

function byDepthBand(dives: Dive[]): Bucket[] {
  return DEPTH_BANDS.map((band, i) => ({
    key: String(i),
    label: band.label,
    value: dives.filter((d) => d.maxDepth < band.max && (i === 0 || d.maxDepth >= DEPTH_BANDS[i - 1].max))
      .length,
  })).filter((b, i) => b.value > 0 || i < 5);
}

function byKey(dives: Dive[], keyOf: (d: Dive) => string): Bucket[] {
  return groupCount(dives, keyOf);
}

function groupCount(dives: Dive[], keyOf: (d: Dive) => string): Bucket[] {
  const counts = new Map<string, number>();
  for (const d of dives) {
    const k = keyOf(d);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, value]) => ({ key, label: key, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

function topSites(dives: Dive[], limit = 10): SiteStat[] {
  const map = new Map<string, SiteStat>();
  for (const d of dives) {
    const name = d.site?.name?.trim();
    if (!name) continue;
    const s = map.get(name) ?? { name, dives: 0, totalS: 0, maxDepth: 0, lastDive: d.startTime };
    s.dives++;
    s.totalS += d.durationS;
    s.maxDepth = Math.max(s.maxDepth, d.maxDepth);
    if (at(d) > new Date(s.lastDive).getTime()) s.lastDive = d.startTime;
    map.set(name, s);
  }
  return [...map.values()].sort((a, b) => b.dives - a.dives).slice(0, limit);
}

export function modeLabel(d: Dive): string {
  switch (d.mode) {
    case 'ccr':
      return 'Rebreather';
    case 'scr':
      return 'SCR';
    case 'gauge':
      return 'Gauge';
    case 'freedive':
      return 'Apnea';
    default:
      return 'Circuito aperto';
  }
}

export function mixLabel(d: Dive): string {
  const mix = d.cylinders[0]?.mix;
  if (!mix) return 'Sconosciuto';
  const o2 = Math.round(mix.o2 * 100);
  const he = Math.round(mix.he * 100);
  if (he > 0) return `Trimix ${o2}/${he}`;
  if (o2 === 21) return 'Aria';
  if (o2 >= 99) return 'Ossigeno';
  return `Nitrox ${o2}`;
}

// ---------------------------------------------------------------------------

const at = (d: Dive) => new Date(d.startTime).getTime();
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);

function mean(v: number[]): number | undefined {
  if (v.length === 0) return undefined;
  return round(sum(v) / v.length, 2);
}

function maxBy<T>(items: T[], pick: (t: T) => number): T | undefined {
  if (items.length === 0) return undefined;
  return items.reduce((best, cur) => (pick(cur) > pick(best) ? cur : best), items[0]);
}

function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

// ---------------------------------------------------------------------------
// Analisi che servono a rispondere a "perché", non solo a "quanto"
// ---------------------------------------------------------------------------

export interface XYPoint {
  x: number;
  y: number;
  diveId: string;
  label: string;
}

/**
 * Coefficiente di correlazione di Pearson.
 *
 * Serve a dire quanto due misure si muovono insieme — consumo e profondità,
 * assetto e zavorra — con un numero invece che a occhio su un grafico. Va
 * presentato per quello che è: una correlazione osservata su questo archivio, non
 * una causa. Restituisce `undefined` sotto le 5 coppie, perché con quattro punti
 * si ottiene sempre un valore alto e non significa niente.
 */
export function correlation(pairs: { x: number; y: number }[]): number | undefined {
  const n = pairs.length;
  if (n < 5) return undefined;
  const mx = sum(pairs.map((p) => p.x)) / n;
  const my = sum(pairs.map((p) => p.y)) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (const p of pairs) {
    const dx = p.x - mx;
    const dy = p.y - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return undefined;
  return round(cov / Math.sqrt(vx * vy), 2);
}

/** Coppie (x, y) fra due grandezze, prese solo dove esistono entrambe. */
export function pairsOf(
  dives: Dive[],
  x: (d: Dive) => number | undefined,
  y: (d: Dive) => number | undefined,
): XYPoint[] {
  const out: XYPoint[] = [];
  for (const d of dives) {
    const xv = x(d);
    const yv = y(d);
    if (xv === undefined || yv === undefined) continue;
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    out.push({
      x: xv,
      y: yv,
      diveId: d.id,
      label: `${d.startTime.slice(0, 10)}${d.site?.name ? ` · ${d.site.name}` : ''}`,
    });
  }
  return out;
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
  label: string;
}

/**
 * Istogramma a intervalli scelti.
 *
 * Le medie nascondono le code, e sulle code si gioca la sicurezza: una velocità
 * di risalita media di 6 m/min può contenere tre immersioni a 18. Entrambi gli
 * intervalli estremi sono aperti: l'ultimo verso l'alto perché i casi peggiori
 * non finiscano fuori dal grafico, il primo verso il basso perché i casi
 * migliori non spariscano — un consumo di 7 L/min con il primo intervallo a 8
 * non veniva contato da nessuna parte, e le colonne non sommavano al totale
 * dichiarato dalla carta.
 */
export function histogram(values: number[], edges: number[], unit = ''): HistogramBin[] {
  const bins: HistogramBin[] = [];
  for (let i = 0; i < edges.length; i++) {
    const from = i === 0 ? -Infinity : edges[i];
    const to = i + 1 < edges.length ? edges[i + 1] : Infinity;
    bins.push({
      from,
      to,
      count: 0,
      label:
        to === Infinity
          ? `oltre ${edges[i]}${unit}`
          : from === -Infinity
            ? `fino a ${to}${unit}`
            : `${from}–${to}${unit}`,
    });
  }
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const idx = bins.findIndex((b) => v >= b.from && v < b.to);
    if (idx >= 0) bins[idx].count++;
  }
  return bins;
}

export interface SettingsPeriod {
  label: string;
  from: string;
  to: string;
  dives: number;
  /** GF99 medio all'uscita nel periodo, se il computer lo riporta. */
  avgGf99?: number;
}

/**
 * Periodi in cui il computer ha avuto le stesse impostazioni di decompressione.
 *
 * Questa non è una curiosità: il GF99 all'uscita dipende dai gradient factor
 * impostati, quindi una tendenza del GF99 che attraversa un cambio di
 * impostazioni non misura un cambio di comportamento del subacqueo. Senza questa
 * tabella accanto, quella tendenza si legge male — ed è esattamente quello che
 * succede sull'archivio reale, dove le impostazioni sono passate da 45/95 a 20/85.
 */
export function settingsPeriods(dives: Dive[]): SettingsPeriod[] {
  const withGf = [...dives]
    .filter((d) => d.computer?.gfLow !== undefined && d.computer?.gfHigh !== undefined)
    .sort((a, b) => at(a) - at(b));
  const out: SettingsPeriod[] = [];
  for (const d of withGf) {
    const label = `GF ${d.computer!.gfLow}/${d.computer!.gfHigh}`;
    const last = out[out.length - 1];
    if (last && last.label === label) {
      last.to = d.startTime.slice(0, 10);
      last.dives++;
    } else {
      out.push({ label, from: d.startTime.slice(0, 10), to: d.startTime.slice(0, 10), dives: 1 });
    }
  }
  // Media del GF99 per periodo, calcolata sulle immersioni che lo riportano.
  for (const period of out) {
    const inPeriod = withGf.filter(
      (d) =>
        d.startTime.slice(0, 10) >= period.from &&
        d.startTime.slice(0, 10) <= period.to &&
        `GF ${d.computer!.gfLow}/${d.computer!.gfHigh}` === period.label &&
        d.metrics?.gf99Pct !== undefined,
    );
    period.avgGf99 = mean(inPeriod.map((d) => d.metrics!.gf99Pct as number));
  }
  return out;
}

/** Temperatura minima media per mese dell'anno, per vedere la stagionalità. */
export function tempByMonth(dives: Dive[]): Bucket[] {
  const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return MONTHS.map((label, i) => {
    const temps = dives
      .filter((d) => new Date(d.startTime).getUTCMonth() === i && d.minTempC !== undefined)
      .map((d) => d.minTempC as number);
    return { label, key: String(i).padStart(2, '0'), value: temps.length ? round(mean(temps) ?? 0, 1) : 0 };
  });
}

/**
 * I quartili di una serie di valori, o `undefined` se sono troppo pochi.
 *
 * Cinque è la soglia sotto la quale un quartile è un aneddoto: con quattro
 * immersioni il «quarto peggiore» è una sola immersione, e chiamarla tendenza
 * sarebbe una bugia con l'aria della statistica.
 */
export function quartilesOf(values: number[]): { p25: number; p50: number; p75: number; n: number } | undefined {
  if (values.length < 5) return undefined;
  const v = [...values].sort((a, b) => a - b);
  const at = (q: number) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  // Il p50 passa da `medianOf` e non dall'elemento centrale: con un numero pari
  // di valori l'elemento centrale non è la mediana, e l'archivio finiva per
  // mostrare due «mediane» diverse (5.6 nei quartili, 5.4 nelle pagine) per la
  // stessa grandezza.
  return {
    p25: round(at(0.25), 1),
    p50: round(medianOf(v) as number, 1),
    p75: round(at(0.75), 1),
    n: v.length,
  };
}

/**
 * Dove cade un valore rispetto ai quartili dell'archivio, a parole.
 *
 * Restituisce `undefined` quando il riferimento non c'è: senza abbastanza
 * immersioni non si dice niente invece di dire qualcosa di inventato.
 */
export function positionAgainst(
  value: number | undefined,
  ref: { p25: number; p50: number; p75: number } | undefined,
  lowerIsBetter = true,
): string | undefined {
  if (value === undefined || !ref) return undefined;
  const good = lowerIsBetter ? 'fra le tue migliori' : 'fra le tue peggiori';
  const bad = lowerIsBetter ? 'nel quarto peggiore' : 'nel quarto migliore';
  if (value <= ref.p25) return `${good} (mediana ${ref.p50})`;
  if (value >= ref.p75) return `${bad} (mediana ${ref.p50})`;
  return `in media con le tue (mediana ${ref.p50})`;
}

/**
 * Quanto costano le ripetitive, misurato e non affermato.
 *
 * Le immersioni che portano `gf99CleanPct` sono quelle che la catena dei tessuti
 * ha riconosciuto come ripetitive: per ognuna sappiamo il GF99 con cui è uscita e
 * quello con cui sarebbe uscita da pulita. La differenza è il prezzo
 * dell'intervallo di superficie, ed è l'unica cosa che rende quel numero
 * utilizzabile — «0.14 bar di azoto residuo» non dice niente a nessuno.
 */
function repetitiveStats(dives: Dive[]): {
  repetitiveDives: number;
  repetitiveCostMedian?: number;
  repetitiveCostWorst?: { points: number; dive: Dive; surfaceIntervalMin?: number };
  surfaceIntervalMedian?: number;
} {
  const rip = dives.filter(
    (d) => d.metrics?.gf99CleanPct !== undefined && d.metrics.gf99Pct !== undefined,
  );
  if (!rip.length) return { repetitiveDives: 0 };

  const costs = rip.map((d) => ({
    points: round((d.metrics!.gf99Pct as number) - (d.metrics!.gf99CleanPct as number), 1),
    dive: d,
    surfaceIntervalMin: d.metrics!.surfaceIntervalMin,
  }));
  const sortedCosts = [...costs].sort((a, b) => a.points - b.points);
  const intervals = rip
    .map((d) => d.metrics!.surfaceIntervalMin)
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b);

  return {
    repetitiveDives: rip.length,
    // Anche qui la mediana vera, non l'elemento centrale: le ripetitive sono
    // poche e con un numero pari di casi la differenza si vede.
    repetitiveCostMedian: round(medianOf(sortedCosts.map((c) => c.points)) as number, 1),
    repetitiveCostWorst: sortedCosts[sortedCosts.length - 1],
    surfaceIntervalMedian: medianOf(intervals),
  };
}
