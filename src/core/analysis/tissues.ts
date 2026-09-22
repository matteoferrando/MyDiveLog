/**
 * Il carico di azoto attraverso tutto l'archivio, non una immersione alla volta.
 *
 * PERCHÉ È UN MODULO A SÉ. Ogni altra metrica di questo progetto si calcola da una
 * sola immersione: il consumo, l'assetto, la velocità di risalita non hanno bisogno
 * di sapere cosa è successo prima. La saturazione sì. Chi entra in acqua alle 14
 * dopo essere uscito alle 11 non riparte da tessuti puliti, e trattarlo come se lo
 * facesse è l'errore che la validazione contro Shearwater ha misurato: sulle
 * ripetitive il nostro GF99 usciva quattro punti sotto il loro, cioè l'app
 * raccontava margine che non c'era.
 *
 * COSA FA. Ordina l'archivio nel tempo, e porta lo stato dei sedici compartimenti
 * da un'immersione alla successiva desaturando per l'intervallo di superficie.
 * Salva in `metrics` il GF99 all'uscita, quello massimo, il carico con cui si è
 * ENTRATI in acqua e i tessuti finali — questi ultimi perché la prossima volta la
 * catena possa ripartire da lì invece di rileggere tutto l'archivio.
 *
 * DOVE SI SPEZZA, E PERCHÉ VA DETTO. In due casi: dopo ventiquattro ore di
 * superficie, perché il residuo è ormai indistinguibile da zero; e quando
 * un'immersione non ha un profilo campionato, perché non sappiamo quanto abbia
 * caricato. Nel secondo caso le immersioni successive ripartono da pulite e la cosa
 * è dichiarata (`chainBroken`), invece di essere nascosta dentro un numero: un
 * carico residuo inventato è peggio di un carico residuo assente.
 */

import type { Dive, DiveMetrics, GasMix, Salinity, Sample } from '../model';
import { ambientBar, pressioneDiSuperficie } from '../units';
import { finDoveSiSale, type PassoDiRisalita } from './deco';
import { profonditaMedia } from '../profondita';
import {
  WATER_VAPOUR_BAR,
  ceilingM,
  desaturate,
  gf99,
  noDecoLimitMin,
  runProfile,
  step,
  surfacedTissues,
  type ProfileResult,
  type TissueState,
  FRAZIONE_N2_ARIA,
} from './buhlmann';
import { perData } from './../oraAParete';
import { inOrdineDiTempo } from '../campioni';

/** Oltre questo intervallo il residuo è trascurabile e la catena riparte da zero. */
export const CHAIN_BREAK_HOURS = 24;

/** Gradient factor da usare quando il computer non li ha registrati. */
export const DEFAULT_GF = { low: 30, high: 85 };

export interface TissueEntry {
  /** Minuti di superficie dall'immersione precedente. Assente se la catena parte qui. */
  surfaceIntervalMin?: number;
  /** Tessuti all'ingresso, dopo la desaturazione in superficie. */
  state: TissueState;
  /**
   * Azoto in eccesso nel compartimento più carico all'ingresso, bar.
   *
   * NON è un GF99 d'ingresso, e la differenza conta. Il GF99 misura la
   * sovrasaturazione rispetto alla pressione ambiente: dopo un'ora in superficie è
   * zero praticamente sempre, perché a un bar non sei sovrasaturo — ma l'azoto in
   * più ce l'hai eccome, e si vede solo quando riscendi. Questo numero è quello:
   * quanto stai sopra l'equilibrio con l'aria che respiri.
   */
  residualN2Bar: number;
  /** Vero se la catena è stata interrotta da un'immersione senza profilo. */
  chainBroken: boolean;
}

/** Azoto di equilibrio in superficie: il valore verso cui tutto tende a riposo. */
function equilibriumN2(surfaceBar: number): number {
  return (surfaceBar - WATER_VAPOUR_BAR) * FRAZIONE_N2_ARIA;
}

/** Quanto inerte porti sopra l'equilibrio, nel compartimento che ne porta di più. */
export function residualLoadBar(state: TissueState, surfaceBar: number): number {
  const eq = equilibriumN2(surfaceBar);
  let worst = 0;
  // `n2` e `he` hanno sempre la stessa lunghezza: nascono insieme in `surfacedTissues` e `step`.
  for (let i = 0; i < state.n2.length; i++) {
    const excess = state.n2[i]! + state.he[i]! - eq;
    if (excess > worst) worst = excess;
  }
  return Math.round(worst * 1000) / 1000;
}

/**
 * Pressione di superficie dichiarata dal computer, o quella standard.
 *
 * `??` non basta e non è mai bastato: uno zero scritto in archivio da un campo
 * azzerato del computer passa intatto e fa partire i tessuti da azoto negativo.
 * Il filtro sta in `pressioneDiSuperficie`, una volta sola per tutta
 * l'applicazione.
 */
function surfaceOf(dive: Dive): number {
  return pressioneDiSuperficie(dive.surfacePressureBar);
}

/**
 * Con quali tessuti si entra in acqua.
 *
 * Funzione pura e separata perché è il punto in cui si decide se la catena
 * continua o riparte, ed è la cosa che va potuta provare da sola.
 */
export function entryState(
  dive: Dive,
  previous: { state: TissueState; endTimeMs: number } | undefined,
): TissueEntry {
  const surface = surfaceOf(dive);
  const clean = { state: surfacedTissues(surface), residualN2Bar: 0, chainBroken: false };
  if (!previous) return clean;
  const minutes = (Date.parse(dive.startTime) - previous.endTimeMs) / 60_000;
  // Un intervallo negativo significa immersioni sovrapposte: due computer sulla
  // stessa uscita non deduplicati, o un orologio sfasato. Non si incatena.
  if (!(minutes > 0) || minutes > CHAIN_BREAK_HOURS * 60) return clean;
  const state = desaturate(previous.state, minutes, surface);
  return {
    state,
    surfaceIntervalMin: Math.round(minutes),
    residualN2Bar: residualLoadBar(state, surface),
    chainBroken: false,
  };
}

/**
 * L'immersione che viene subito prima nell'archivio, se abbastanza vicina.
 *
 * Cerca fra i riepiloghi che l'app tiene già in memoria: i tessuti finali sono
 * salvati nelle metriche, quindi ricostruire il carico d'ingresso non costa una
 * lettura di profilo.
 */
export function previousDive(dive: Dive, all: Dive[]): Dive | undefined {
  const start = Date.parse(dive.startTime);
  let best: Dive | undefined;
  let bestEnd = -Infinity;
  for (const other of all) {
    if (other.id === dive.id) continue;
    const end = Date.parse(other.startTime) + other.durationS * 1000;
    if (!(end <= start) || end <= bestEnd) continue;
    best = other;
    bestEnd = end;
  }
  if (!best) return undefined;
  return start - bestEnd <= CHAIN_BREAK_HOURS * 3600_000 ? best : undefined;
}

/** Il carico d'ingresso ricostruito dall'archivio in memoria, senza leggere profili. */
export function entryStateFor(dive: Dive, all: Dive[]): TissueEntry {
  const before = previousDive(dive, all);
  const tissuesEnd = before?.metrics?.tissuesEnd;
  if (!before || !usableTissues(tissuesEnd)) return entryState(dive, undefined);
  return entryState(dive, {
    state: tissuesEnd as TissueState,
    endTimeMs: Date.parse(before.startTime) + before.durationS * 1000,
  });
}

/** I gradient factor con cui rileggere l'immersione: quelli del computer se ci sono. */
export function gfOf(dive: Dive): { low: number; high: number } {
  return {
    low: (dive.computer?.gfLow ?? DEFAULT_GF.low) / 100,
    high: (dive.computer?.gfHigh ?? DEFAULT_GF.high) / 100,
  };
}

/** Rilegge un profilo partendo da tessuti dati. Un solo posto che chiama `runProfile`. */
export function analyseProfile(
  dive: Dive,
  samples: Sample[],
  initial: TissueState,
  gf?: { low: number; high: number },
): ProfileResult {
  const { low, high } = gf ?? gfOf(dive);
  return runProfile(samples, {
    mixOf: (s) => dive.cylinders[s.gasIndex ?? 0]?.mix ?? dive.cylinders[0]?.mix,
    mix: dive.cylinders[0]?.mix ?? { o2: 0.21, he: 0 },
    gfLow: low,
    gfHigh: high,
    salinity: dive.salinity ?? 'salt',
    surfacePressureBar: surfaceOf(dive),
    initial,
  });
}

/** Quello che la catena scrive dentro `metrics`. */
export interface TissueMetrics {
  gf99Pct: number;
  gf99MaxPct: number;
  leadingCompartment: number;
  residualN2Bar?: number;
  gf99CleanPct?: number;
  surfaceIntervalMin?: number;
  tissuesEnd: TissueState;
}

/**
 * Serve ricalcolare questa immersione?
 *
 * Non basta guardare se il valore c'è: se in mezzo all'archivio compare
 * un'immersione nuova, quelle dopo hanno un GF99 valido ma calcolato con il
 * predecessore sbagliato. Il segnale è l'intervallo di superficie o il carico
 * d'ingresso che non corrispondono più.
 */
/**
 * Tessuti utilizzabili: sedici compartimenti, tutti numeri veri.
 *
 * Esportata perché la stessa domanda se la deve fare chiunque rilegga dei
 * tessuti salvati, non solo la catena: il grafico della saturazione e il
 * pianificatore li prendevano come venivano, e con uno stato troncato a otto
 * compartimenti il primo disegnava coordinate NaN e il secondo contava vuoti i
 * compartimenti mancanti — cioè sottostimava il carico di una ripetitiva.
 */
export function usableTissues(state: TissueState | undefined): state is TissueState {
  return (
    !!state &&
    Array.isArray(state.n2) &&
    Array.isArray(state.he) &&
    state.n2.length === 16 &&
    state.he.length === 16 &&
    state.n2.every((v) => Number.isFinite(v)) &&
    state.he.every((v) => Number.isFinite(v))
  );
}

export function needsRecompute(dive: Dive, entry: TissueEntry): boolean {
  const m = dive.metrics;
  // Uno stato di tessuti malformato — array corto, o con dentro un NaN — non va
  // riusato: si propagherebbe a tutta la catena delle ripetitive, e un NaN nei
  // tessuti rende NaN ogni numero che tocca senza far cadere niente.
  if (!usableTissues(m?.tissuesEnd) || m?.gf99Pct === undefined) return true;
  if ((m.surfaceIntervalMin === undefined) !== (entry.surfaceIntervalMin === undefined)) return true;
  if (
    m.surfaceIntervalMin !== undefined &&
    entry.surfaceIntervalMin !== undefined &&
    Math.abs(m.surfaceIntervalMin - entry.surfaceIntervalMin) > 1
  ) {
    return true;
  }
  // Il carico d'ingresso è l'impronta del predecessore: se cambia, questa
  // immersione è stata calcolata dietro a un'altra e va rifatta.
  return Math.abs((m.residualN2Bar ?? 0) - entry.residualN2Bar) > 0.005;
}

export interface ChainReport {
  /** Immersioni rilette dal profilo. */
  computed: number;
  /** Immersioni già a posto, di cui si è riusato lo stato salvato. */
  reused: number;
  /**
   * Immersioni senza profilo registrato, per cui i tessuti sono stati stimati su
   * un profilo quadro. La catena NON si spezza più su di loro: il numero serve a
   * dire quanta parte dell'archivio poggia su una stima.
   */
  withoutProfile: number;
}

/**
 * Percorre l'archivio nel tempo e aggiorna le immersioni che ne hanno bisogno.
 *
 * Non tocca il resto delle metriche e non scrive niente: restituisce le immersioni
 * cambiate e lascia al chiamante la scrittura, che è l'unico modo di tenere questo
 * modulo dentro `core` senza dipendenze di piattaforma.
 */
/**
 * Il profilo che un'immersione senza campioni ha quasi certamente avuto.
 *
 * Discesa alla velocità dichiarata, permanenza alla profondità MEDIA, risalita.
 * Non è il profilo vero — quello non esiste da nessuna parte — ma è esattamente
 * il modello con cui si pianifica un'immersione a tavolino, ed è quello che le
 * tabelle usano da cinquant'anni.
 *
 * La media, non la massima: la massima è un istante e userebbe come permanenza
 * un valore che nessuno ha tenuto per quaranta minuti, sovrastimando il carico
 * di parecchio. Quando la media manca — capita sulle righe ricopiate a mano —
 * si usa il 70% della massima, che è il rapporto mediano misurato sull'archivio
 * reale ed è dichiarato in `usualDepthRatio`.
 *
 * Perché stimare invece di arrendersi: prima la catena si SPEZZAVA qui, e
 * l'immersione successiva ripartiva da tessuti puliti. Fra «carico stimato con
 * un quadro» e «carico zero», il secondo non è più prudente: è solo più
 * sbagliato, e per giunta nella direzione che rassicura. Una stima dichiarata
 * batte una lacuna nascosta.
 */
export function squareProfile(dive: Dive, ascentRateMpm = 9, descentRateMpm = 18): Sample[] {
  const durationS = Math.max(60, Math.round(dive.durationS));
  const maxDepth = Math.max(1, dive.maxDepth);
  // Anche qui la funzione e non il campo: il profilo non c'è **adesso**, ma le
  // metriche possono portare una media misurata al momento dell'importazione,
  // e un quadro costruito su quella è più vicino al vero del 70% di ripiego.
  const media = profonditaMedia(dive);
  const avg = media && media > 0 ? Math.min(media, maxDepth) : maxDepth * 0.7;
  const descentS = Math.round((avg / descentRateMpm) * 60);
  const ascentS = Math.round((avg / ascentRateMpm) * 60);
  // Se discesa e risalita da sole non ci stanno nella durata, si comprimono in
  // proporzione: meglio un profilo più ripido del vero che una permanenza
  // negativa, che darebbe tessuti senza senso.
  const travelS = descentS + ascentS;
  const scale = travelS > durationS * 0.9 ? (durationS * 0.9) / Math.max(1, travelS) : 1;
  const dS = Math.max(1, Math.round(descentS * scale));
  const aS = Math.max(1, Math.round(ascentS * scale));
  const bottomS = Math.max(1, durationS - dS - aS);

  const out: Sample[] = [{ t: 0, depth: 0 }];
  const step = 10;
  for (let t = step; t < dS; t += step) out.push({ t, depth: (avg * t) / dS });
  out.push({ t: dS, depth: avg });
  for (let t = dS + step; t < dS + bottomS; t += step) out.push({ t, depth: avg });
  out.push({ t: dS + bottomS, depth: avg });
  for (let t = dS + bottomS + step; t < durationS; t += step) {
    out.push({ t, depth: avg * (1 - (t - dS - bottomS) / aS) });
  }
  out.push({ t: durationS, depth: 0 });
  return out;
}

export async function chainArchive(
  dives: Dive[],
  loadSamples: (id: string) => Promise<Sample[]>,
): Promise<{ dives: Dive[]; updated: Dive[]; report: ChainReport }> {
  const report: ChainReport = { computed: 0, reused: 0, withoutProfile: 0 };
  const byId = new Map(dives.map((d) => [d.id, d]));
  const order = [...dives].sort(perData((d) => d.startTime));
  const updated: Dive[] = [];

  let previous: { state: TissueState; endTimeMs: number } | undefined;

  for (const original of order) {
    const dive = byId.get(original.id)!;
    const entry = entryState(dive, previous);

    if (!needsRecompute(dive, entry)) {
      report.reused++;
      previous = {
        state: dive.metrics!.tissuesEnd!,
        endTimeMs: Date.parse(dive.startTime) + dive.durationS * 1000,
      };
      continue;
    }

    const registrati = dive.samples?.length ? dive.samples : await loadSamples(dive.id);
    /*
     * Senza profilo si RICOSTRUISCE un quadro, non si spezza la catena.
     *
     * Prima qui c'era `previous = undefined`: la catena si interrompeva e ogni
     * immersione successiva ripartiva da tessuti puliti. Sull'archivio reale
     * sono 19 immersioni su 104 — quelle ricopiate a mano in LogTRAK — e ognuna
     * regalava un GF99 ottimista alla ripetitiva che la seguiva, senza che
     * niente lo dicesse. Il quadro non è il profilo vero, ma sbaglia molto meno
     * dello zero, e sbaglia dalla parte giusta.
     */
    const stimato = registrati.length < 2;
    const samples = stimato ? squareProfile(dive) : registrati;
    if (samples.length < 2) {
      report.withoutProfile++;
      previous = undefined;
      continue;
    }
    if (stimato) report.withoutProfile++;

    const result = analyseProfile(dive, samples, entry.state);
    // Quanto è costato il residuo: la STESSA immersione rigiocata da tessuti
    // puliti. È l'unico modo di dare un numero all'intervallo di superficie che
    // significhi qualcosa per chi lo legge — «l'ora di pausa ti è costata cinque
    // punti» invece di «0.14 bar di azoto residuo».
    const clean =
      entry.residualN2Bar > 0
        ? analyseProfile(dive, samples, surfacedTissues(surfaceOf(dive))).gf99End
        : undefined;
    const tissue: TissueMetrics = {
      ...(stimato ? { tissuesEstimated: true } : {}),
      gf99Pct: result.gf99End,
      gf99MaxPct: result.gf99Max,
      leadingCompartment: result.leadingCompartment,
      ...(entry.residualN2Bar > 0 ? { residualN2Bar: entry.residualN2Bar } : {}),
      ...(clean !== undefined ? { gf99CleanPct: clean } : {}),
      ...(entry.surfaceIntervalMin !== undefined ? { surfaceIntervalMin: entry.surfaceIntervalMin } : {}),
      tissuesEnd: result.state,
    };

    // `metrics` può mancare su un'immersione senza profilo arrivata da un CSV; qui
    // il profilo c'è, quindi le metriche pure — ma il tipo non lo sa.
    // I tre campi opzionali si assegnano espliciti anche quando sono `undefined`:
    // se un'immersione smette di essere una ripetitiva — perché quella prima è
    // stata cancellata — il residuo di prima deve sparire, non restare lì.
    /*
     * Un'immersione senza `metrics` non deve perdere i tessuti appena calcolati.
     *
     * Prima il ramo `: dive` la lasciava intatta: la catena proseguiva — lo stato
     * passava alla successiva — ma il GF99 di QUESTA non veniva scritto da
     * nessuna parte, e la sua scheda restava vuota. Succede alle immersioni
     * arrivate da un CSV di riepilogo e a quelle inserite a mano da un percorso
     * che non passa da `computeMetrics`. Si costruisce allora il minimo
     * indispensabile, con una qualità che dichiara quello che è: nessun campione.
     */
    const baseMetrics: DiveMetrics =
      dive.metrics ??
      ({
        quality: {
          sampleCount: 0,
          sampleIntervalS: 0,
          hasProfile: false,
          hasTankPressure: false,
          hasCylinderVolume: false,
          hasCeiling: false,
          ratesIntervalS: 0,
        },
      } as DiveMetrics);
    const next: Dive = {
      ...dive,
      metrics: {
        ...baseMetrics,
        ...tissue,
        tissuesEstimated: stimato ? true : undefined,
        residualN2Bar: entry.residualN2Bar > 0 ? entry.residualN2Bar : undefined,
        gf99CleanPct: clean,
        surfaceIntervalMin: entry.surfaceIntervalMin,
      },
    };
    if (next !== dive) {
      byId.set(dive.id, next);
      updated.push(next);
      report.computed++;
    }
    previous = { state: result.state, endTimeMs: Date.parse(dive.startTime) + dive.durationS * 1000 };
  }

  return { dives: dives.map((d) => byId.get(d.id)!), updated, report };
}

/**
 * Rigioca un'immersione con gradient factor diversi da quelli usati davvero.
 *
 * È la domanda a cui il computer, a immersione finita, non può più rispondere:
 * quanto margine avresti avuto con 30/70 al posto di 45/95, e dove sarebbe comparsa
 * la prima sosta. Il GF99 NON cambia — è la sovrasaturazione rispetto al modello
 * nudo, e non dipende dai gradient factor: cambiano il tetto, l'obbligo e i minuti
 * passati sotto di esso.
 */
export interface WhatIf {
  gfLow: number;
  gfHigh: number;
  /** Tetto più profondo che quei GF avrebbero imposto, metri. Zero: sempre in curva. */
  maxCeilingM: number;
  /** Minuti con un obbligo attivo. */
  decoMinutes: number;
  /** Vero se con quei GF l'immersione sarebbe uscita dalla curva. */
  wouldHaveDeco: boolean;
}

// ---------------------------------------------------------------------------
// La curva di sicurezza di un piano, prima di scendere
// ---------------------------------------------------------------------------

/** Un tratto del profilo pianificato: da dove a dove, e in quanto. */
export interface PlanSegment {
  fromM: number;
  toM: number;
  minutes: number;
}

export interface PlanCurve {
  /** Minuti in curva restando fermi alla massima, da tessuti puliti. */
  ndlAtMaxMin: number;
  /** Lo stesso alla profondità media pianificata. */
  ndlAtAvgMin: number;
  /** Minuto in cui il piano esce dalla curva. Assente se non ci esce. */
  leavesCurveAtMin?: number;
  /** GF99 previsto all'uscita se il piano viene eseguito così com'è. */
  gf99EndPct: number;
  /** Tetto più profondo che il piano imporrebbe, metri. */
  maxCeilingM: number;
  /** Minuti con un obbligo attivo. */
  decoMinutes: number;
}

/**
 * Trasforma i tratti del piano in campioni, come se l'immersione fosse già stata
 * fatta: è l'unico modo di far passare un piano dentro lo stesso codice che
 * rilegge i profili veri, invece di scriverne una seconda versione che diverge.
 */
export function segmentsToSamples(segments: PlanSegment[], stepS = 10): Sample[] {
  const out: Sample[] = [{ t: 0, depth: segments[0]?.fromM ?? 0 }];
  let t = 0;
  for (const seg of segments) {
    const total = Math.max(0, seg.minutes) * 60;
    if (total <= 0) continue;
    for (let dt = stepS; dt <= total; dt += stepS) {
      const f = Math.min(1, dt / total);
      out.push({ t: t + dt, depth: seg.fromM + (seg.toM - seg.fromM) * f });
    }
    // L'ultimo campione del tratto deve stare esattamente alla fine: senza questo
    // un tratto di 4.5 minuti con passo di 10 s perderebbe gli ultimi secondi, e
    // su una sosta lunga l'errore si accumula.
    const last = out[out.length - 1]!;
    if (last.t < t + total) out.push({ t: t + total, depth: seg.toM });
    t += total;
  }
  return out;
}

/**
 * Quanto tempo hai in curva, e a che minuto il piano ne esce.
 *
 * PERCHÉ NON BASTA L'NDL DA TABELLA. Il limite a una profondità fissa risponde a
 * «quanto posso stare a 30 metri»; un piano vero scende, sta a una media, tocca la
 * massima, risale e si ferma. Il minuto in cui esce dalla curva dipende da tutta
 * quella forma, e si trova solo facendo passare il piano dentro il modello.
 *
 * Il gas è quello di fondo per tutta la durata, anche dove il piano prevede una
 * miscela di decompressione: sull'obbligo è l'ipotesi prudente, ed è dichiarata
 * nell'interfaccia invece che nascosta qui dentro.
 */
export function curveOfPlan(
  segments: PlanSegment[],
  options: {
    mix: GasMix;
    avgDepthM: number;
    maxDepthM: number;
    gfLow?: number;
    gfHigh?: number;
    salinity?: Salinity;
    surfacePressureBar?: number;
  },
): PlanCurve {
  const {
    mix,
    avgDepthM,
    maxDepthM,
    gfLow = DEFAULT_GF.low / 100,
    gfHigh = DEFAULT_GF.high / 100,
    salinity = 'salt',
    surfacePressureBar = 1.01325,
  } = options;

  const samples = segmentsToSamples(segments);
  const result = runProfile(samples, {
    mix,
    gfLow,
    gfHigh,
    salinity,
    surfacePressureBar,
  });

  // Il minuto dell'uscita dalla curva si trova rifacendo il percorso e fermandosi
  // al primo campione con un tetto: `runProfile` restituisce il totale, non il
  // momento, e il momento è la cosa che si porta in acqua.
  let leaves: number | undefined;
  if (result.maxCeilingM > 0) {
    let state = surfacedTissues(surfacePressureBar);
    for (let i = 1; i < samples.length; i++) {
      const minutes = (samples[i]!.t - samples[i - 1]!.t) / 60;
      if (!(minutes > 0)) continue;
      state = stepAt(
        (samples[i - 1]!.depth + samples[i]!.depth) / 2,
        state,
        mix,
        minutes,
        salinity,
        surfacePressureBar,
      );
      if (ceilingM(state, gfHigh, salinity, surfacePressureBar) > 0) {
        leaves = Math.round((samples[i]!.t / 60) * 10) / 10;
        break;
      }
    }
  }

  const ndl = (depth: number) =>
    noDecoLimitMin(depth, mix, { gfHigh, salinity, surfacePressureBar, maxMin: 300 });

  return {
    ndlAtMaxMin: ndl(maxDepthM),
    ndlAtAvgMin: ndl(avgDepthM),
    leavesCurveAtMin: leaves,
    gf99EndPct: result.gf99End,
    maxCeilingM: result.maxCeilingM,
    decoMinutes: Math.round(result.decoMinutes),
  };
}

function stepAt(
  depth: number,
  state: TissueState,
  mix: GasMix,
  minutes: number,
  salinity: Salinity,
  surfacePressureBar: number,
): TissueState {
  return step(state, ambientBar(depth, salinity, surfacePressureBar), mix, minutes);
}

export function whatIfGf(
  dive: Dive,
  samples: Sample[],
  initial: TissueState,
  pairs: { low: number; high: number }[],
): WhatIf[] {
  return pairs.map(({ low, high }) => {
    const r = analyseProfile(dive, samples, initial, { low, high });
    return {
      gfLow: Math.round(low * 100),
      gfHigh: Math.round(high * 100),
      maxCeilingM: r.maxCeilingM,
      decoMinutes: Math.round(r.decoMinutes),
      wouldHaveDeco: r.maxCeilingM > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Minuto per minuto: curva e obbligo lungo tutta l'immersione
// ---------------------------------------------------------------------------

export interface DecoPoint {
  /** Secondi dall'inizio. */
  t: number;
  depthM: number;
  /** Minuti ancora disponibili in curva restando a questa quota. */
  ndlMin: number;
  /**
   * Tetto in questo istante, metri, con i gradient factor INTERPOLATI.
   *
   * Prima usava solo `gfHigh`, e usciva grosso un terzo di quello che scriveva il
   * computer — mentre la didascalia sotto il grafico prometteva entrambi i
   * gradient factor e il TTS della stessa riga era calcolato con l'interpolazione.
   * Tre parti dello stesso riquadro dicevano tre cose. Qui vale la regola di
   * Baker, la stessa di `deco.ts`: `gfLow` alla prima sosta, `gfHigh` in
   * superficie.
   */
  ceilingM: number;
  /**
   * Il tetto con il solo `gfHigh`: zero significa «posso salire dritto».
   *
   * È la domanda a cui risponde `ndlMin`, ed è per questo che sono accoppiati.
   * Distinto dal precedente perché sono due domande diverse: «dove mi devo
   * fermare adesso» e «posso andarmene».
   */
  ceilingDirectM: number;
  /** Sovrasaturazione istantanea rispetto al modello nudo. */
  gf99: number;
  /**
   * Minuti per arrivare in superficie rispettando gli obblighi.
   *
   * `undefined` quando la risalita non converge entro duemila passi: succede
   * sulle esposizioni estreme, e prima restituiva i minuti accumulati come se il
   * subacqueo fosse emerso — 394 minuti dove ne servivano 1 131. *Un buco nel
   * grafico si vede, un numero sbagliato no.*
   */
  ttsMin: number | undefined;
}

/**
 * Come cambiano curva e obbligo lungo l'immersione.
 *
 * PERCHÉ SERVE, VISTO CHE IL COMPUTER LO SCRIVE GIÀ. Perché lo scrive solo qualche
 * computer. NDL, TTS e tetto stanno nei campioni degli Shearwater; l'Aladin non li
 * registra, i file UDDF esportati da altri programmi quasi mai, e sulle immersioni
 * importate da un CSV non esistono proprio. Il profilo però ce l'hanno tutte, e da
 * un profilo il modello si rigioca: così la curva la vedi su OGNI immersione, non
 * solo su quelle di uno strumento.
 *
 * E dove il computer i suoi numeri li ha scritti, i due si possono mettere sullo
 * stesso grafico. Non per correggere il computer — è lui ad aver ragione, era lì —
 * ma perché due implementazioni dello stesso modello che divergono dicono qualcosa,
 * e vederle sovrapposte è l'unico modo di accorgersene.
 *
 * IL COSTO. L'integrazione dei tessuti resta a piena risoluzione, perché è lì che
 * si accumula l'errore; i punti si emettono ogni `stepS` secondi, perché una curva
 * di NDL campionata ogni dieci secondi disegna esattamente la stessa linea di una
 * campionata ogni trenta e costa il triplo. Il TTS è la parte cara — richiede di
 * simulare una risalita completa da ogni punto — ed è il motivo per cui il passo
 * predefinito non è più fitto.
 */
export function decoTimeline(
  dive: Dive,
  samples: Sample[],
  options: {
    initial?: TissueState;
    gf?: { low: number; high: number };
    stepS?: number;
  } = {},
): DecoPoint[] {
  /*
   * ► IN ORDINE DI TEMPO, COME `runProfile`. ◄ Qui i tessuti si integrano da un
   * campione al successivo: sui campioni come stanno nel file — col blocco di
   * risalita scritto per primo, per dire — l'intervallo usciva negativo e la
   * linea tornava indietro nel tempo. Misurato il 21 settembre 2026: 9 punti che
   * partivano dal minuto 25 invece di 46 dal minuto zero. Vedi
   * `tests/schedaFuoriOrdine.test.tsx`.
   */
  samples = inOrdineDiTempo(samples);
  if (samples.length < 2) return [];
  const { low, high } = options.gf ?? gfOf(dive);
  const surface = surfaceOf(dive);
  const salinity = dive.salinity ?? 'salt';
  const stepS = options.stepS ?? 30;
  const mixOf = (s: Sample) =>
    dive.cylinders[s.gasIndex ?? 0]?.mix ?? dive.cylinders[0]?.mix ?? { o2: 0.21, he: 0 };

  let state = options.initial ?? surfacedTissues(surface);
  const out: DecoPoint[] = [];
  let nextEmit = 0;
  // L'ancora dell'interpolazione: la prima sosta che il modello impone, decisa con
  // `gfLow`, e che una volta trovata non si sposta più.
  let anchorM: number | undefined;

  const emit = (t: number, depthM: number, mix: GasMix) => {
    if (anchorM === undefined) {
      const deep = ceilingM(state, low, salinity, surface);
      if (deep > 0) anchorM = Math.max(3, Math.ceil(deep / 3) * 3);
    }
    const gfHere =
      anchorM && anchorM > 0 ? high + ((low - high) * Math.min(depthM, anchorM)) / anchorM : high;
    const direct = ceilingM(state, high, salinity, surface);
    // L'OBBLIGO lo decide `gfHigh`, la QUOTA a cui fermarsi i gradient factor
    // interpolati. Senza la prima condizione, un'immersione a dodici metri
    // comodamente in curva mostrava un «tetto» di quaranta centimetri — vero
    // secondo Baker, ma nessun computer lo mostra, perché finché puoi salire
    // dritto non c'è niente da cui fermarsi. È la stessa regola che usa
    // `runProfile`, e vale la pena che le due parti dell'app la applichino uguale.
    const ceiling = direct > 0 ? ceilingM(state, gfHere, salinity, surface) : 0;
    const ttsMin = timeToSurface(state, depthM, mix, { low, high }, salinity, surface);
    out.push({
      t,
      depthM: Math.round(depthM * 10) / 10,
      // Il limite in curva si misura da QUI: non è quello da tessuti puliti, è
      // quanto puoi ancora restare con il carico che hai adesso. È la differenza
      // fra una tabella e un computer.
      ndlMin: remainingNdl(state, depthM, mix, high, salinity, surface),
      ceilingM: Math.round(ceiling * 10) / 10,
      ceilingDirectM: Math.round(direct * 10) / 10,
      gf99: gf99(state, ambientBar(depthM, salinity, surface)).percent,
      ttsMin,
    });
  };

  emit(samples[0]!.t, samples[0]!.depth, mixOf(samples[0]!));
  nextEmit = samples[0]!.t + stepS;

  for (let i = 1; i < samples.length; i++) {
    const minutes = (samples[i]!.t - samples[i - 1]!.t) / 60;
    if (!(minutes > 0)) continue;
    const meanDepth = (samples[i - 1]!.depth + samples[i]!.depth) / 2;
    state = step(state, ambientBar(meanDepth, salinity, surface), mixOf(samples[i]!), minutes);
    if (samples[i]!.t >= nextEmit || i === samples.length - 1) {
      emit(samples[i]!.t, samples[i]!.depth, mixOf(samples[i]!));
      nextEmit = samples[i]!.t + stepS;
    }
  }
  return out;
}

/*
 * ► LA VELOCITÀ DI RISALITA E IL PASSO DELLE SOSTE, UNA VOLTA SOLA. ◄
 *
 * Erano due costanti locali dentro `timeToSurface` (`ASCENT = 9`, `STOP = 3`) e
 * due numeri scritti a mano dentro `decoTimeline` (`Math.ceil(deep / 3) * 3`).
 * Quattro copie dello stesso valore in un file solo, e nessuna che sapesse
 * dell'altra: cambiarne una avrebbe lasciato indietro le altre tre.
 *
 * Restano diverse da `DEFAULT_DECO` del pianificatore per una ragione dichiarata
 * e non per dimenticanza: questo è il TTS «da computer subacqueo», che non sa
 * che gas hai a bordo né a che quota hai deciso di fare l'ultima sosta, e usa i
 * valori di procedura. Se un giorno diventeranno configurabili, si cambiano qui
 * e cambiano dappertutto.
 */
const ASCENT_MPM = 9;
const STOP_M = 3;

/**
 * Quanti minuti restano in curva DA QUESTO STATO, a questa quota.
 *
 * `noDecoLimitMin` risponde alla domanda della tabella — quanto si può stare
 * partendo puliti — che è un'altra cosa: a metà immersione il tempo residuo
 * dipende da quanto azoto hai già addosso. Bisezione come là, perché la funzione è
 * monotona e venti iterazioni bastano per il decimo di minuto.
 */
function remainingNdl(
  state: TissueState,
  depthM: number,
  mix: GasMix,
  gfHigh: number,
  salinity: Salinity,
  surfaceBar: number,
  // Novantanove come i computer subacquei, e non per imitarli: oltre il centinaio
  // di minuti il numero smette di essere un limite e diventa «tanto», e una curva
  // che schizza a trecento all'inizio e alla fine dell'immersione rende illeggibile
  // tutto quello che c'è in mezzo.
  maxMin = 99,
): number {
  const amb = ambientBar(depthM, salinity, surfaceBar);
  /*
   * «SENZA OBBLIGHI» VUOL DIRE RISALENDO, e la risalita è quella vera: nove
   * metri al minuto lungo la griglia delle soste, integrando i tessuti. Qui
   * c'era la domanda della tabella — «potrei emergere in questo istante?» — che
   * è un'altra cosa, e dava un numero diverso da quello del pianificatore sulla
   * stessa immersione. `finDoveSiSale` è la stessa funzione che usa `planDeco`:
   * *due copie della stessa regola sono una regola e la sua versione vecchia.*
   */
  const passo: PassoDiRisalita = {
    lastStopM: 3,
    stopIntervalM: 3,
    ascentRateMpm: ASCENT_MPM,
    salinity,
    surfacePressureBar: surfaceBar,
  };
  const fits = (minutes: number) => {
    const dopo = step(state, amb, mix, minutes);
    /*
     * Due condizioni, e la prima è quella storica: **si può stare in
     * superficie adesso?** Senza, un punto del profilo a profondità zero
     * scavalcava del tutto la camminata — fra zero e la superficie non c'è
     * nessun gradino da controllare — e la curva risultava al massimo, 99
     * minuti, su un subacqueo già emerso con un obbligo sopra la testa.
     * La seconda è la camminata: **ci si arriva, risalendo?**
     */
    if (ceilingM(dopo, gfHigh, salinity, surfaceBar) > 0) return false;
    return (
      finDoveSiSale(
        dopo,
        depthM,
        passo,
        () => gfHigh,
        () => mix,
      ).quota <= 0.01
    );
  };
  if (!fits(0)) return 0;
  if (fits(maxMin)) return maxMin;
  let lo = 0;
  let hi = maxMin;
  for (let k = 0; k < 20; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  /*
   * SI ARROTONDA PER DIFETTO, e non è pedanteria sul decimo.
   *
   * `lo` è per costruzione un tempo che passa la prova; `Math.round` può
   * portarlo fino a mezzo decimo OLTRE il confine vero. Su un numero qualunque
   * non importerebbe; su questo sì, perché è il numero che qualcuno scrive
   * nella casella dei minuti e porta in acqua. Misurato il 15 settembre 2026:
   * cinque profondità fra 48 e 68 metri dichiaravano una curva che, scritta
   * tale e quale, faceva uscire il piano con uno o due minuti di obbligo.
   *
   * *Un minuto in più a una sosta non ha mai fatto male a nessuno; un minuto in
   * più al fondo sì.*
   */
  return Math.floor(lo * 10) / 10;
}

/**
 * Minuti per arrivare in superficie da qui rispettando gli obblighi.
 *
 * Risalita a nove metri al minuto e soste di un minuto alla volta, sul gas che si
 * sta respirando: è il TTS «pessimista», senza cambi di gas, che è anche quello
 * che mostra un computer quando non sa che gas hai a bordo.
 */
function timeToSurface(
  state: TissueState,
  depthM: number,
  mix: GasMix,
  gf: { low: number; high: number },
  salinity: Salinity,
  surfaceBar: number,
): number | undefined {
  const passo: PassoDiRisalita = {
    lastStopM: STOP_M,
    stopIntervalM: STOP_M,
    ascentRateMpm: ASCENT_MPM,
    salinity,
    surfacePressureBar: surfaceBar,
  };
  let current = depthM;
  let tissues = state;
  let minutes = 0;
  let anchor: number | undefined;
  let guard = 0;

  /*
   * ► LA GUARDIA È ALZATA, E SOPRATTUTTO ADESSO PARLA. ◄
   *
   * Era `guard++ < 400`, e quando scattava questa funzione restituiva i minuti
   * accumulati **come se il subacqueo fosse emerso**. Nessun `undefined`, nessun
   * segnale: un numero plausibile e sbagliato.
   *
   * Misurato il 15 settembre 2026: 60 m per 80 minuti ad aria mostravano un TTS
   * di 394 minuti contro i 633 veri; 45 m per 180 minuti ne mostravano 396
   * contro 1 131. **Una sottostima di dodici ore**, su *il* numero con cui si
   * decide se il gas basta, stampato accanto al TTS del computer. Il gemello di
   * questa funzione in `deco.ts` la stessa cosa la faceva bene da mesi: guardia
   * a 2000 **e** un avviso.
   *
   * Adesso il tetto è lo stesso — un'immersione che chiede più di duemila
   * minuti di risalita non è un'immersione — e chi non converge restituisce
   * `undefined`, che il grafico disegna come un buco. *Un buco si vede, un
   * numero sbagliato no.*
   */
  while (current > 0 && guard++ < 2000) {
    if (anchor === undefined) {
      /*
       * ► L'ANCORA NASCE QUANDO NASCE L'OBBLIGO, E L'OBBLIGO LO DECIDE `gfHigh`. ◄
       *
       * Qui l'ancora si accendeva appena il tetto con `gfLow` diventava
       * positivo — che con GF 30/85 succede molto prima che ci sia un obbligo
       * vero. Da quel momento questa funzione infilava soste in una risalita
       * che non ne aveva bisogno, e il grafico della scheda mostrava, sullo
       * stesso istante, «restano 3.6 minuti di curva» accanto a un tempo di
       * risalita che conteneva soste. Due numeri che si smentiscono a vicenda,
       * uno sotto l'altro.
       *
       * È la stessa regola che `decoTimeline` applica due righe più su per il
       * tetto — «finché puoi salire dritto non c'è niente da cui fermarsi» — e
       * che `runProfile` applica da sempre. Mancava solo qui.
       */
      if (ceilingM(tissues, gf.high, salinity, surfaceBar) > 0) {
        const deep = ceilingM(tissues, gf.low, salinity, surfaceBar);
        if (deep > 0) anchor = Math.max(STOP_M, Math.ceil(deep / STOP_M) * STOP_M);
      }
    }
    const gfAt = (d: number) =>
      anchor && anchor > 0 ? gf.high + ((gf.low - gf.high) * Math.min(d, anchor)) / anchor : gf.high;

    // La stessa camminata del pianificatore: un gradino per volta, integrando.
    // Prima si guardava il tetto sui tessuti di ADESSO e si saltava dritti al
    // bersaglio, che su un rimbalzo profondo diceva «puoi emergere» mentre la
    // risalita caricava ancora.
    const salita = finDoveSiSale(tissues, current, passo, gfAt, () => mix);
    const target = salita.quota;
    if (target >= current - 0.01) {
      tissues = step(tissues, ambientBar(current, salinity, surfaceBar), mix, 1);
      minutes += 1;
      continue;
    }
    const travel = (current - target) / ASCENT_MPM;
    tissues = salita.tessuti;
    minutes += travel;
    current = target;
  }
  // Non convergente: meglio niente che un numero. Chi lo mostra disegna un buco.
  if (current > 0) return undefined;
  return Math.round(minutes * 10) / 10;
}
