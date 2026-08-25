/**
 * Metriche per singola immersione.
 *
 * È il cuore analitico: tutto ciò che le statistiche e il coach mostrano
 * viene da qui. Ogni metrica dichiara la propria affidabilità in
 * `metrics.quality`, perché un profilo campionato ogni 30 s non permette di
 * misurare la velocità di risalita con la stessa fiducia di uno a 2 s.
 *
 * Scelte di metodo, esplicite perché sono opinabili:
 *
 *  - Le fasi (discesa / fondo / risalita) usano la soglia del 75% della
 *    profondità massima. `descentEnd` è il primo campione che la raggiunge,
 *    `ascentStart` è l'ultimo. Su un profilo multilivello "fondo" significa
 *    quindi il livello più profondo, non tutta la parte immersa — per questo
 *    l'assetto NON si misura sulla fase di fondo ma su tutti i tratti a quota
 *    tenuta, vedi `analyseVerticalRates`.
 *  - Le velocità verticali sono calcolate su finestra mobile di 30 s, non fra
 *    campioni adiacenti: a 2 s di campionamento il rumore del sensore
 *    produrrebbe picchi di 30 m/min inesistenti.
 *  - Le violazioni di velocità di risalita sono contate su TUTTO il profilo,
 *    non solo in fase di risalita: una risalita rapida a metà immersione conta.
 */

import {
  LIMITS,
  type Dive,
  type DiveMetrics,
  type DivePhases,
  type MetricQuality,
  type Salinity,
  type Sample,
} from '../model';
import { ambientAta, end as endDepth, mod } from '../units';
import { exposureOfProfile } from './oxygen';

/** Ampiezza della finestra mobile per le velocità verticali, secondi. */
export const RATE_WINDOW_S = 30;

/**
 * Finestra lunga usata per distinguere il TRANSITO (discesa o risalita
 * sostenuta) dall'OSCILLAZIONE d'assetto. Su 150 secondi un'oscillazione di
 * pochi metri si annulla, mentre una risalita si vede tutta: è ciò che permette
 * di escludere le code di discesa e risalita dal calcolo dell'assetto senza
 * escludere l'oscillazione, che è proprio il dato che vogliamo misurare.
 */
const TRANSIT_WINDOW_S = 150;

/** Oltre questa velocità sostenuta il subacqueo sta transitando, non tenendo la quota. */
const TRANSIT_THRESHOLD_MPM = 3;

/** Soglia di fase: frazione della profondità massima. */
const PHASE_THRESHOLD = 0.75;

/** Sotto questa profondità un campione è considerato "in superficie". */
const SURFACE_M = 0.5;

/**
 * Sotto questa profondità non si misura l'assetto: il dondolio in superficie fra
 * l'uscita e la barca non è un errore di controllo della quota. La sosta di
 * sicurezza a 3-6 m invece rientra, ed è giusto che rientri.
 */
const HOLDING_MIN_DEPTH_M = 1.5;

/**
 * Sotto questa profondità massima la sosta profonda non si cerca.
 *
 * Venti metri è la soglia che le statistiche usavano già al denominatore: sotto,
 * metà profondità cade dentro la fascia della sosta di sicurezza, e la stessa
 * permanenza verrebbe contata due volte con due nomi diversi.
 */
export const DEEP_STOP_MIN_DEPTH_M = 20;

export function computeMetrics(dive: Dive): DiveMetrics {
  const samples = (dive.samples ?? []).filter((s) => Number.isFinite(s.depth) && s.t >= 0);
  samples.sort((a, b) => a.t - b.t);

  const caveats: string[] = [];
  const hasProfile = samples.length >= 3;
  const intervalS = hasProfile
    ? (samples[samples.length - 1].t - samples[0].t) / Math.max(1, samples.length - 1)
    : 0;

  if (!hasProfile) {
    caveats.push('Nessun profilo campionato: disponibili solo i dati di sintesi.');
  } else if (intervalS > 20) {
    caveats.push(
      `Campionamento a ${Math.round(intervalS)} s: velocità verticali e sosta di sicurezza sono approssimate.`,
    );
  }

  const maxDepth = hasProfile
    ? Math.max(dive.maxDepth ?? 0, ...samples.map((s) => s.depth))
    : (dive.maxDepth ?? 0);

  const phases = detectPhases(samples, maxDepth, dive.durationS);
  const salinity = dive.salinity ?? 'salt';

  // La profondità media viene dal profilo se c'è, altrimenti dal valore
  // dichiarato dal formato sorgente. Se non c'è nessuno dei due resta ignota:
  // niente stime, perché da qui passa il calcolo del consumo.
  const avgDepth = hasProfile
    ? round(
        timeWeightedMean(samples, (s) => s.depth),
        2,
      )
    : dive.avgDepth;
  const avgAta = hasProfile
    ? round(
        timeWeightedMean(samples, (s) => ambientAta(s.depth, salinity, dive.surfacePressureBar)),
        3,
      )
    : avgDepth !== undefined
      ? round(ambientAta(avgDepth, salinity, dive.surfacePressureBar), 3)
      : undefined;

  // LE VELOCITÀ VERTICALI SI MISURANO SUL PROFILO PIÙ FITTO DISPONIBILE.
  //
  // L'oscillazione a quota tenuta dipende dalla densità di campionamento: sulle
  // immersioni reali di questo archivio, registrate da due computer, il profilo a
  // 10 s la legge un terzo più bassa di quello a 4 s sulla STESSA immersione. Se le
  // immersioni recenti usassero il profilo rado e le vecchie quello fitto, la
  // tendenza mostrerebbe un miglioramento che è solo un cambio di strumento.
  //
  // Il profilo principale resta quello con più canali (tetto, NDL, TTS, CNS), che
  // serve a tutto il resto: qui si cambia soltanto la base su cui si misurano le
  // velocità, e `quality.ratesIntervalS` dice quale è stata usata.
  const alt = (dive.altSamples ?? []).filter((x) => Number.isFinite(x.depth) && x.t >= 0);
  alt.sort((a, b) => a.t - b.t);
  const altIntervalS =
    alt.length >= 3 ? (alt[alt.length - 1].t - alt[0].t) / Math.max(1, alt.length - 1) : Infinity;
  const useAlt = alt.length >= 3 && altIntervalS < intervalS - 0.01;
  const ratesSamples = useAlt ? alt : samples;
  const ratesIntervalS = useAlt ? altIntervalS : intervalS;
  if (useAlt) {
    caveats.push(
      `Velocità e assetto misurati sul profilo a ${Math.round(ratesIntervalS)} s del secondo computer, più fitto di quello mostrato (${Math.round(intervalS)} s): un profilo più rado leggerebbe l'oscillazione più bassa di quanto è.`,
    );
  }

  const ratesPhases = useAlt ? detectPhases(ratesSamples, maxDepth, dive.durationS) : phases;
  const rates = analyseVerticalRates(ratesSamples, ratesPhases);
  // Anche la sosta di sicurezza si misura meglio sul profilo fitto: la sua durata
  // si conta a campioni, e a 10 s la granularità è di dieci secondi per volta.
  const stops = analyseStops(ratesSamples, ratesPhases, maxDepth);
  const shape = analyseShape(samples, dive.durationS);
  const badGasSwitches = analyseGasSwitches(dive, samples, salinity);
  const deco = analyseDeco(samples);
  const gas = analyseGas(dive, samples, avgAta, caveats);
  const oxygen = analyseOxygen(dive, samples, maxDepth, salinity);
  // Sul profilo più fitto disponibile: un tratto di cinque secondi su un passo di
  // dieci non esiste proprio, e questa è la metrica che vive lì.
  const finalAscent = analyseFinalAscent(ratesSamples);

  const quality: MetricQuality = {
    sampleCount: samples.length,
    sampleIntervalS: Math.round(intervalS * 10) / 10,
    hasProfile,
    hasTankPressure: gas.hasTankPressure,
    hasCylinderVolume: gas.hasCylinderVolume,
    hasCeiling: deco.hasCeiling,
    ratesIntervalS: Math.round(ratesIntervalS * 10) / 10,
    ratesFromAlt: useAlt,
    caveats,
  };

  return {
    avgDepth,
    avgAta,
    phases,
    rmvLpm: gas.rmvLpm,
    sacBarPerMin: gas.sacBarPerMin,
    endPressureBar: gas.endPressureBar,
    reserveFraction: gas.reserveFraction,
    descentRateMpm: rates.descentRateMpm,
    ascentRateMpm: rates.ascentRateMpm,
    maxAscentRateMpm: rates.maxAscentRateMpm,
    fastAscentS: rates.fastAscentS,
    fastShallowAscentS: rates.fastShallowAscentS,
    bottomVerticalTravelMpm: rates.bottomVerticalTravelMpm,
    bottomDepthStdM: rates.bottomDepthStdM,
    holdingS: rates.holdingS,
    safetyStopS: stops.safetyStopS,
    didSafetyStop: stops.didSafetyStop,
    deepStopS: stops.deepStopS,
    deepStopDepthM: stops.deepStopDepthM,
    sawtoothMPerHour: shape.sawtoothMPerHour,
    depthTrendM: shape.depthTrendM,
    deepestPartFirst: shape.deepestPartFirst,
    badGasSwitches,
    decoS: deco.decoS,
    ceilingViolationS: deco.ceilingViolationS,
    maxCeilingM: deco.maxCeilingM,
    cnsEndPct: deco.cnsEndPct,
    minTempC: dive.minTempC ?? minOf(samples.map((s) => s.tempC)),
    maxPpo2: oxygen.maxPpo2,
    endM: oxygen.endM,
    cnsPct: oxygen.cnsPct,
    otu: oxygen.otu,
    minutesAbovePpo214: oxygen.minutesAbovePpo214,
    minutesAbovePpo216: oxygen.minutesAbovePpo216,
    finalAscentRateMpm: finalAscent.finalAscentRateMpm,
    finalAscentFromM: finalAscent.finalAscentFromM,
    minPpo2: oxygen.minPpo2,
    quality,
  };
}

// ---------------------------------------------------------------------------
// Fasi
// ---------------------------------------------------------------------------

function detectPhases(samples: Sample[], maxDepth: number, durationS: number): DivePhases {
  if (samples.length < 3 || maxDepth <= 0) {
    return {
      descentEndS: 0,
      ascentStartS: durationS,
      descentS: 0,
      bottomS: durationS,
      ascentS: 0,
    };
  }
  const threshold = maxDepth * PHASE_THRESHOLD;
  let descentEndS = samples[0].t;
  let ascentStartS = samples[samples.length - 1].t;

  for (const s of samples) {
    if (s.depth >= threshold) {
      descentEndS = s.t;
      break;
    }
  }
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].depth >= threshold) {
      ascentStartS = samples[i].t;
      break;
    }
  }
  if (ascentStartS < descentEndS) ascentStartS = descentEndS;

  const last = samples[samples.length - 1].t;
  return {
    descentEndS,
    ascentStartS,
    descentS: descentEndS - samples[0].t,
    bottomS: ascentStartS - descentEndS,
    ascentS: Math.max(0, last - ascentStartS),
  };
}

// ---------------------------------------------------------------------------
// Velocità verticali e assetto
// ---------------------------------------------------------------------------

interface RateResult {
  descentRateMpm?: number;
  ascentRateMpm?: number;
  maxAscentRateMpm?: number;
  fastAscentS: number;
  fastShallowAscentS: number;
  bottomVerticalTravelMpm?: number;
  bottomDepthStdM?: number;
  holdingS?: number;
}

/**
 * Velocità verticale su finestra mobile, m/min, positiva in risalita.
 * `undefined` dove la finestra non è ancora piena: all'inizio dell'immersione
 * non esiste una velocità sostenuta da misurare, e calcolarla su due campioni
 * adiacenti trasformerebbe il rumore del sensore in picchi inesistenti — a 2 s
 * di campionamento, ±15 cm di rumore diventano 9 m/min.
 */
export function windowedRates(samples: Sample[], windowS: number): (number | undefined)[] {
  const rates: (number | undefined)[] = new Array(samples.length).fill(undefined);
  const minWindow = windowS * 0.8;
  let j = 0;
  for (let i = 1; i < samples.length; i++) {
    while (j < i - 1 && samples[i].t - samples[j + 1].t >= windowS) j++;
    const dt = samples[i].t - samples[j].t;
    if (dt < minWindow) continue;
    rates[i] = ((samples[j].depth - samples[i].depth) / dt) * 60;
  }
  return rates;
}

function analyseVerticalRates(samples: Sample[], phases: DivePhases): RateResult {
  const out: RateResult = { fastAscentS: 0, fastShallowAscentS: 0 };
  if (samples.length < 3) return out;

  const rates = windowedRates(samples, RATE_WINDOW_S);
  let maxAscent = 0;
  for (let i = 1; i < samples.length; i++) {
    const rate = rates[i];
    if (rate === undefined || rate <= 0) continue;
    const slice = samples[i].t - samples[i - 1].t;
    const depth = samples[i].depth;
    if (depth <= SURFACE_M) continue;

    if (rate > maxAscent) maxAscent = rate;
    if (depth >= 10 && rate > LIMITS.ascentRateDeepMpm) out.fastAscentS += slice;
    if (depth < 10 && rate > LIMITS.ascentRateShallowMpm) out.fastShallowAscentS += slice;
  }
  out.maxAscentRateMpm = round(maxAscent, 1);

  // Medie di fase: sulla distanza netta percorsa, che è ciò che il subacqueo
  // percepisce come "quanto veloce sono scesa/risalito".
  const first = samples[0];
  const deepest = samples.reduce((a, b) => (b.depth > a.depth ? b : a), samples[0]);
  if (phases.descentS > 0) {
    out.descentRateMpm = round(((deepest.depth - first.depth) / phases.descentS) * 60, 1);
  }
  const ascentSamples = samples.filter((s) => s.t >= phases.ascentStartS);
  if (phases.ascentS > 30 && ascentSamples.length > 1) {
    const from = ascentSamples[0].depth;
    const to = ascentSamples[ascentSamples.length - 1].depth;
    out.ascentRateMpm = round(((from - to) / phases.ascentS) * 60, 1);
  }

  // Assetto: metri verticali "sprecati" per minuto MENTRE il subacqueo tiene la
  // quota, su tutta l'immersione e non solo nella fase di fondo.
  //
  // Restringere il calcolo alla fase di fondo sembrava naturale ed è sbagliato
  // su un profilo multilivello: un'immersione che scende a 30 m, risale
  // gradualmente a 13 e passa mezz'ora fra 13 e 15 m avrebbe una "fase di fondo"
  // di dieci minuti, e i trenta minuti in cui l'assetto conta davvero
  // resterebbero fuori dalla misura. L'ho scoperto guardando un profilo vero.
  //
  // Quello che serve escludere non è una fase, è il TRANSITO: i momenti in cui la
  // profondità cambia perché il subacqueo la sta cambiando. Il filtro è la
  // velocità sostenuta su 150 s, che l'oscillazione d'assetto non produce.
  //
  // Dentro ogni segmento continuo di quota tenuta sottraiamo lo spostamento
  // NETTO di quel segmento: seguire una parete che scende da 13 a 15 m è una
  // scelta, oscillare fra 13 e 15 m no. La sottrazione va fatta per segmento e
  // non sul totale, altrimenti due tratti in direzioni opposte si annullano.
  const transit = windowedRates(samples, TRANSIT_WINDOW_S);
  let travel = 0;
  let netTotal = 0;
  let heldS = 0;
  const heldDepths: number[] = [];

  let segStart: number | undefined;
  let segEnd = 0;
  const closeSegment = () => {
    if (segStart !== undefined) netTotal += Math.abs(segEnd - segStart);
    segStart = undefined;
  };

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const r = transit[i];
    const holding =
      r !== undefined && Math.abs(r) <= TRANSIT_THRESHOLD_MPM && cur.depth >= HOLDING_MIN_DEPTH_M;
    if (!holding) {
      closeSegment();
      continue;
    }
    const dt = cur.t - prev.t;
    if (dt <= 0) continue;

    if (segStart === undefined) segStart = prev.depth;
    segEnd = cur.depth;
    travel += Math.abs(cur.depth - prev.depth);
    heldS += dt;
    heldDepths.push(cur.depth);
  }
  closeSegment();

  if (heldS >= 120) {
    out.bottomVerticalTravelMpm = round((Math.max(0, travel - netTotal) / heldS) * 60, 2);
    out.bottomDepthStdM = round(stdev(heldDepths), 2);
    out.holdingS = Math.round(heldS);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sosta di sicurezza
// ---------------------------------------------------------------------------

function analyseStops(
  samples: Sample[],
  phases: DivePhases,
  maxDepth: number,
): { safetyStopS: number; didSafetyStop: boolean; deepStopS: number; deepStopDepthM?: number } {
  /*
   * LA PERMANENZA CONTIGUA PIÙ LUNGA, non la somma dei passaggi.
   *
   * Sommando, due transiti da cento secondi fra tre e sei metri diventavano
   * «sosta di sicurezza di 5:05» con il pallino verde e il tasso di soste
   * completate al 100% — senza che ci fosse stata nessuna sosta di tre minuti.
   * Un profilo 30 → 4 m per 100 s → 12 m → 4 m per 100 s → superficie non è una
   * sosta: è un saliscendi. La sosta profonda, dieci righe più sotto in questa
   * stessa funzione, il tratto contiguo lo cerca già — e il commento lì spiega
   * proprio che passarci in transito due volte non è una sosta.
   *
   */
  const [lo, hi] = LIMITS.safetyStopBandM;
  let corrente = 0;
  let piuLunga = 0;
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    if (s.t < phases.ascentStartS) continue;
    const dt = s.t - samples[i - 1].t;
    if (s.depth >= lo && s.depth <= hi) {
      corrente += dt;
      if (corrente > piuLunga) piuLunga = corrente;
    } else {
      corrente = 0;
    }
  }

  // La sosta profonda: una permanenza attorno a metà della profondità massima
  // durante la risalita. Si cerca il tratto contiguo più lungo dentro la fascia,
  // non il tempo totale: passarci in transito due volte non è una sosta.
  //
  // SOTTO I VENTI METRI NON SI CERCA. Metà di dodici metri sono sei, cioè dentro
  // la fascia della sosta di sicurezza: quattro immersioni dell'archivio reale si
  // vedevano attribuire una «sosta profonda a 6.6 m» e contemporaneamente una
  // «sosta di sicurezza non fatta» — la stessa permanenza, contata due volte con
  // due nomi. Le statistiche arrivavano al 114% di immersioni con sosta profonda,
  // perché il denominatore questa soglia ce l'aveva già e il numeratore no.
  const [fLo, fHi] = LIMITS.deepStopBandFraction;
  if (maxDepth < DEEP_STOP_MIN_DEPTH_M) {
    return {
      safetyStopS: Math.round(piuLunga),
      didSafetyStop: piuLunga >= LIMITS.safetyStopMinS,
      deepStopS: 0,
    };
  }
  const bandLo = maxDepth * fLo;
  const bandHi = maxDepth * fHi;
  let best = 0;
  let bestDepth: number | undefined;
  let run = 0;
  let runDepthSum = 0;
  let runSamples = 0;
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    if (s.t < phases.ascentStartS || s.depth < bandLo || s.depth > bandHi) {
      run = 0;
      runDepthSum = 0;
      runSamples = 0;
      continue;
    }
    run += s.t - samples[i - 1].t;
    runDepthSum += s.depth;
    runSamples++;
    if (run > best) {
      best = run;
      bestDepth = runDepthSum / runSamples;
    }
  }

  return {
    // `safetyStopS` è la SOSTA, cioè la permanenza più lunga: è il numero che la
    // scheda mostra come «sosta di sicurezza di N» e che il tasso di soste
    // completate conta. Il tempo totale in fascia non è una sosta.
    safetyStopS: Math.round(piuLunga),
    didSafetyStop: piuLunga >= LIMITS.safetyStopMinS,
    deepStopS: best >= LIMITS.deepStopMinS ? Math.round(best) : 0,
    deepStopDepthM: best >= LIMITS.deepStopMinS && bestDepth !== undefined ? round(bestDepth, 1) : undefined,
  };
}

/**
 * Profilo a dente di sega, e "la parte profonda per prima".
 *
 * «Saw tooth profiles or dives with many big swings in depth should be avoided.
 * Ideally, dives should be conducted with the deeper portion of the dive occurring
 * first» (TDI Advanced Nitrox 2013, p. 38). Il manuale non quantifica "many big
 * swings": qui si contano i metri ridiscesi DOPO essere già risaliti di almeno tre
 * metri, normalizzati sull'ora. È un indice da leggere in relativo — contro le
 * proprie immersioni — non contro una soglia che il manuale non dà.
 */
function analyseShape(
  samples: Sample[],
  durationS: number,
): { sawtoothMPerHour?: number; deepestPartFirst?: boolean; depthTrendM?: number } {
  if (samples.length < 5 || durationS <= 0) return {};
  const MIN_SWING_M = 3;
  let wasted = 0;
  let ascended = 0;
  let descending = false;
  let countThisDescent = false;
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i].depth - samples[i - 1].depth;
    if (delta < 0) {
      ascended += -delta;
      descending = false;
    } else if (delta > 0) {
      if (!descending) {
        // Inizio di una ridiscesa: si conta INTERA, ma solo se prima si era
        // risaliti di almeno tre metri. La discesa iniziale non conta perché
        // prima di lei non c'è nessuna risalita.
        descending = true;
        countThisDescent = ascended >= MIN_SWING_M;
        ascended = 0;
      }
      if (countThisDescent) wasted += delta;
    }
  }

  const half = samples[samples.length - 1].t / 2;
  const first = samples.filter((s) => s.t <= half);
  const second = samples.filter((s) => s.t > half);
  const mean = (list: Sample[]) => (list.length ? list.reduce((a, s) => a + s.depth, 0) / list.length : 0);

  // Il verso del profilo come GRANDEZZA, non come sì/no.
  //
  // «Deeper portion first» era un booleano, e un booleano su una raccomandazione
  // graduale butta via l'informazione che conta: due metri di differenza fra le
  // due metà e venti metri di differenza diventavano lo stesso "no". Qui la
  // differenza fra le profondità medie delle due metà resta in metri, con il segno
  // — positivo se la parte profonda viene prima — e il booleano si ricava da lei.
  // Così l'indice del dente di sega e il verso del profilo si leggono insieme,
  // sulla stessa scala: sono due modi in cui la stessa forma può essere sbagliata.
  const trend = first.length && second.length ? mean(first) - mean(second) : undefined;

  return {
    sawtoothMPerHour: round((wasted / durationS) * 3600, 1),
    depthTrendM: trend !== undefined ? round(trend, 1) : undefined,
    deepestPartFirst: trend !== undefined ? trend >= 0 : undefined,
  };
}

/**
 * Cambi di gas fatti sotto la MOD del gas su cui si passa.
 *
 * È l'unico errore di procedura che un logbook può verificare da solo: il passo D
 * dell'acronimo MODS — «verifica la profondità e conferma di essere alla MOD o più
 * in alto» (TDI Decompression Procedures 2011, p. 138). Il limite usato è 1.6 bar,
 * quello ammesso in decompressione.
 */
function analyseGasSwitches(dive: Dive, samples: Sample[], salinity: Salinity): number {
  if (dive.cylinders.length < 2) return 0;
  let bad = 0;
  let previous = samples[0]?.gasIndex;
  for (const s of samples) {
    const index = s.gasIndex;
    if (index === undefined || index === previous) continue;
    const mix = dive.cylinders[index]?.mix;
    if (mix) {
      const limit = mod(mix, LIMITS.maxPpo2Deco, salinity);
      if (s.depth > limit + 0.5) bad++;
    }
    previous = index;
  }
  return bad;
}

// ---------------------------------------------------------------------------
// Decompressione
// ---------------------------------------------------------------------------

function analyseDeco(samples: Sample[]) {
  let decoS = 0;
  let ceilingViolationS = 0;
  let maxCeilingM: number | undefined;
  let hasCeiling = false;

  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    const dt = s.t - samples[i - 1].t;
    const ceiling = s.ceiling ?? (s.stopDepth && s.stopDepth > 0 ? s.stopDepth : undefined);
    if (ceiling !== undefined) hasCeiling = true;

    const obliged = s.inDeco === true || (ceiling !== undefined && ceiling > 0);
    if (obliged) decoS += dt;
    if (ceiling !== undefined && ceiling > 0) {
      if (maxCeilingM === undefined || ceiling > maxCeilingM) maxCeilingM = ceiling;
      // Violazione: il subacqueo è PIÙ ALTO del tetto imposto.
      if (s.depth < ceiling - 0.3) ceilingViolationS += dt;
    }
  }
  const cns = samples.length ? samples[samples.length - 1].cns : undefined;
  return {
    decoS: Math.round(decoS),
    ceilingViolationS: Math.round(ceilingViolationS),
    maxCeilingM,
    cnsEndPct: cns,
    hasCeiling,
  };
}

// ---------------------------------------------------------------------------
// Consumo gas
// ---------------------------------------------------------------------------

function analyseGas(dive: Dive, samples: Sample[], avgAta: number | undefined, caveats: string[]) {
  const cylinders = dive.cylinders ?? [];
  const durationMin = dive.durationS / 60;

  // Pressione iniziale/finale: preferisce i valori dichiarati sulla bombola,
  // altrimenti li ricava dal primo e ultimo campione utile.
  const fromSamples = tankPressureFromSamples(samples, cylinders.length);
  let hasTankPressure = false;
  let hasCylinderVolume = false;
  let consumedBarL = 0;
  let primaryDelta: number | undefined;
  let primaryEnd: number | undefined;
  let primaryStart: number | undefined;

  cylinders.forEach((cyl, i) => {
    const start = cyl.startBar ?? fromSamples[i]?.start;
    const endBar = cyl.endBar ?? fromSamples[i]?.end;
    if (start === undefined || endBar === undefined) return;
    const delta = start - endBar;
    if (delta <= 0) return;
    hasTankPressure = true;
    if (i === 0 || primaryDelta === undefined) {
      primaryDelta = delta;
      primaryEnd = endBar;
      primaryStart = start;
    }
    if (cyl.sizeL !== undefined && cyl.sizeL > 0) {
      hasCylinderVolume = true;
      consumedBarL += delta * cyl.sizeL;
    }
  });

  let rmvLpm: number | undefined;
  if (avgAta === undefined && hasTankPressure && hasCylinderVolume) {
    caveats.push(
      'Profondità media sconosciuta (nessun profilo campionato): l’RMV in L/min non è calcolabile, resta il consumo in bar/min.',
    );
  }
  if (avgAta !== undefined && hasCylinderVolume && consumedBarL > 0 && durationMin > 0 && avgAta > 0) {
    rmvLpm = round(consumedBarL / (durationMin * avgAta), 1);
    if (cylinders.length > 1) {
      /*
       * DUE GRANDEZZE SU DUE INSIEMI DIVERSI, e finora lo diceva a metà.
       *
       * `rmvLpm` somma TUTTE le bombole; `sacBarPerMin`, `endPressureBar` e
       * `reserveFraction` guardano solo la prima. Su una configurazione con una
       * stage di decompressione il risultato è un consumo in L/min che comprende
       * la stage e una pressione finale che è quella del back gas: la riserva
       * mostrata è quella della bombola sbagliata, e la stessa `endPressureBar`
       * alimenta la statistica «uscite sotto i 50 bar» e la colonna dell'archivio.
       *
       * Non si può risolvere sommando: i bar di bombole di volume diverso non si
       * sommano. Quello che si può fare è NON far passare per generale un dato
       * che riguarda una bombola sola, e dirlo dove il numero viene letto.
       */
      caveats.push(
        'Più bombole: l’RMV in L/min è calcolato sul totale di tutte, mentre il consumo in bar/min, la pressione finale e la frazione di riserva riguardano SOLO la prima bombola — i bar di bombole di volume diverso non si sommano.',
      );
    }
  } else if (hasTankPressure && !hasCylinderVolume) {
    caveats.push('Volume bombola non indicato: calcolabile solo il consumo in bar/min, non l’RMV in L/min.');
  } else if (!hasTankPressure) {
    caveats.push('Nessuna pressione bombola: consumo gas non calcolabile.');
  }

  return {
    rmvLpm,
    sacBarPerMin:
      primaryDelta !== undefined && durationMin > 0 ? round(primaryDelta / durationMin, 2) : undefined,
    endPressureBar: primaryEnd,
    reserveFraction:
      primaryEnd !== undefined && primaryStart ? round(primaryEnd / primaryStart, 3) : undefined,
    hasTankPressure,
    hasCylinderVolume,
  };
}

function tankPressureFromSamples(samples: Sample[], nCylinders: number) {
  const out: { start?: number; end?: number }[] = Array.from({ length: Math.max(1, nCylinders) }, () => ({}));
  for (const s of samples) {
    if (!s.pressureBar) continue;
    s.pressureBar.forEach((p, i) => {
      if (p === undefined || !Number.isFinite(p) || p <= 0) return;
      if (!out[i]) out[i] = {};
      if (out[i].start === undefined) out[i].start = p;
      out[i].end = p;
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ossigeno / narcosi
// ---------------------------------------------------------------------------

function analyseOxygen(dive: Dive, samples: Sample[], maxDepth: number, salinity: 'salt' | 'fresh') {
  const measured = samples.map((s) => s.ppo2).filter((v): v is number => v !== undefined && v > 0);
  let maxPpo2 = measured.length ? Math.max(...measured) : undefined;
  // La PPO2 minima ha senso solo se MISURATA: su circuito aperto ricostruirla dal
  // mix darebbe sempre il valore in superficie, che non è un'esposizione.
  const minPpo2 = measured.length ? round(Math.min(...measured), 2) : undefined;

  if (maxPpo2 === undefined) {
    // Calcolata: per ogni campione la miscela in uso (o la prima disponibile).
    let peak = 0;
    for (const s of samples) {
      const mix = dive.cylinders[s.gasIndex ?? 0]?.mix ?? dive.cylinders[0]?.mix;
      if (!mix) continue;
      const p =
        mix.o2 *
        ambientAta(s.depth, salinity, dive.surfacePressureBar) *
        (dive.surfacePressureBar ?? 1.01325);
      if (p > peak) peak = p;
    }
    if (peak > 0) maxPpo2 = round(peak, 2);
  } else {
    maxPpo2 = round(maxPpo2, 2);
  }

  const trimix = dive.cylinders.find((c) => c.mix.he > 0.01);
  const endM = trimix ? round(endDepth(trimix.mix, maxDepth, salinity), 1) : undefined;

  // CNS e OTU calcolati da NOI dal profilo, con le tabelle NOAA. Il computer ne
  // scrive una sua versione (`cnsEndPct`): sono due numeri diversi con due
  // modelli diversi, e vanno tenuti separati invece di sovrascriversi.
  const exposure =
    samples.length > 1
      ? exposureOfProfile(
          samples,
          (sample: Sample) => dive.cylinders[sample.gasIndex ?? 0]?.mix ?? dive.cylinders[0]?.mix,
          salinity,
        )
      : undefined;

  return {
    maxPpo2,
    minPpo2,
    endM,
    cnsPct: exposure?.cnsPercent,
    otu: exposure?.otu,
    minutesAbovePpo214: exposure?.minutesAbove14,
    minutesAbovePpo216: exposure?.minutesAbove16,
  };
}

/**
 * L'ultimo tratto: dalla sosta di sicurezza (o dall'ultimo punto sotto i 3 m)
 * fino alla superficie.
 *
 * Misurato punto a punto e non su finestra mobile, perché dura pochi secondi ed è
 * proprio quello il motivo per cui nessuno se ne accorge. La superficie si
 * considera raggiunta a 0.5 m: aspettare lo zero esatto include il tempo in cui
 * il subacqueo galleggia già in superficie e diluisce la velocità.
 */
function analyseFinalAscent(samples: Sample[]): {
  finalAscentRateMpm?: number;
  finalAscentFromM?: number;
} {
  if (samples.length < 3) return {};
  const SURFACE_M = 0.5;
  // L'ultimo istante in cui era ancora sotto: da lì in poi c'è solo la risalita
  // finale, qualunque cosa sia successa prima.
  let last = -1;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].depth > SURFACE_M) {
      last = i;
      break;
    }
  }
  if (last < 1) return {};
  const surfaced = samples[last + 1];
  if (!surfaced) return {};

  // Si torna indietro finché la traccia sale in modo STRETTAMENTE monotono:
  // l'inizio del tratto è dove il subacqueo ha lasciato l'ultima quota tenuta.
  // Con il confronto non stretto si attraversava la sosta piatta e si finiva a
  // risalire dal fondo, misurando tutt'altra cosa.
  let start = last;
  while (start > 0 && samples[start - 1].depth > samples[start].depth) start--;

  const fromM = samples[start].depth;
  const seconds = surfaced.t - samples[start].t;
  if (!(seconds > 0) || fromM <= SURFACE_M) return {};
  return {
    finalAscentRateMpm: round((fromM / seconds) * 60, 1),
    finalAscentFromM: round(fromM, 1),
  };
}

// ---------------------------------------------------------------------------
// Utilità numeriche
// ---------------------------------------------------------------------------

function timeWeightedMean(samples: Sample[], pick: (s: Sample) => number): number {
  let area = 0;
  let span = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    if (dt <= 0) continue;
    area += ((pick(samples[i]) + pick(samples[i - 1])) / 2) * dt;
    span += dt;
  }
  return span > 0 ? area / span : pick(samples[0] ?? ({ depth: 0, t: 0 } as Sample));
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function minOf(values: (number | undefined)[]): number | undefined {
  const nums = values.filter((v): v is number => v !== undefined && Number.isFinite(v));
  return nums.length ? Math.min(...nums) : undefined;
}

export function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
