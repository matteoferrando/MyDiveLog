/**
 * Bühlmann ZH-L16C con gradient factor.
 *
 * PERCHÉ ESISTE, VISTO CHE L'APP DICE DI NON CALCOLARE LA DECOMPRESSIONE. Perché
 * ci sono due cose diverse. Pianificare la decompressione — dire a qualcuno quanto
 * fermarsi — resta fuori: quello è il dominio del computer e del corso. Rileggere
 * un'immersione già fatta con un modello dichiarato è un'altra cosa, ed è ciò che
 * permette di rispondere a domande che oggi restano senza risposta: quanto margine
 * avevi davvero all'uscita, cosa sarebbe cambiato con gradient factor diversi,
 * quale compartimento comandava la risalita.
 *
 * PERCHÉ SI PUÒ VERIFICARE, ED È IL PUNTO. Trentotto immersioni dell'archivio
 * hanno il GF99 all'uscita calcolato da Shearwater con la sua implementazione di
 * Bühlmann. Sono trentotto valori di controllo su dati reali: `npm run validate:gf`
 * confronta i nostri con i loro. Un modello decompressivo scritto senza un
 * riscontro esterno è un generatore di numeri plausibili, e i numeri plausibili in
 * questo dominio sono la cosa peggiore che si possa produrre.
 *
 * I COEFFICIENTI. ZH-L16C, sedici compartimenti, nella variante con il primo
 * compartimento a 4 minuti. Sono pubblicati e vanno riportati esatti: qui non c'è
 * niente da adattare e niente da migliorare.
 */

import type { GasMix, Salinity, Sample } from '../model';
import { ambientBar, depthFromAbsoluteBar } from '../units';

/** Pressione del vapore acqueo nei polmoni, bar (47 mmHg). */
export const WATER_VAPOUR_BAR = 0.0627;

/** Emitempi dell'azoto, minuti. */
const N2_HALF = [
  4.0, 8.0, 12.5, 18.5, 27.0, 38.3, 54.3, 77.0, 109.0, 146.0, 187.0, 239.0, 305.0, 390.0, 498.0, 635.0,
];

/**
 * Coefficienti `a` dell'azoto, variante C.
 *
 * QUESTA È LA RIGA CHE ERA SBAGLIATA. Bühlmann pubblica tre serie: ZH-L16A è
 * quella teorica (a = 2·t½^−⅓), ZH-L16B abbassa i coefficienti centrali per le
 * tabelle, ZH-L16C li abbassa ancora per i computer in tempo reale. Le prime
 * versioni di questo file dicevano «C» nel commento e portavano i valori della B
 * dal quinto compartimento in giù — più un 0.2971 al tredicesimo che è della A.
 *
 * Un `a` più piccolo è un valore M più basso, cioè un gradiente ammesso più
 * stretto, cioè un GF99 più alto a parità di carico: con la B raccontavamo
 * sistematicamente più margine di quello che c'era. Sulle 38 immersioni con il
 * GF99 di Shearwater lo scarto medio era −2.8 punti; con questi valori è −0.1.
 * Non è una taratura: è la tabella giusta al posto di quella sbagliata, e la
 * verifica esterna è ciò che ha permesso di accorgersene.
 */
const N2_A = [
  1.2599, 1.0, 0.8618, 0.7562, 0.62, 0.5043, 0.441, 0.4, 0.375, 0.35, 0.3295, 0.3065, 0.2835, 0.261, 0.248,
  0.2327,
];
const N2_B = [
  0.505, 0.6514, 0.7222, 0.7825, 0.8126, 0.8434, 0.8693, 0.891, 0.9092, 0.9222, 0.9319, 0.9403, 0.9477,
  0.9544, 0.9602, 0.9653,
];

/** Emitempi dell'elio, minuti. */
const HE_HALF = [
  1.51, 3.02, 4.72, 6.99, 10.21, 14.48, 20.53, 29.11, 41.2, 55.19, 70.69, 90.34, 115.29, 147.42, 188.24,
  240.03,
];
const HE_A = [
  1.7424, 1.383, 1.1919, 1.0458, 0.922, 0.8205, 0.7305, 0.6502, 0.595, 0.5545, 0.5333, 0.5189, 0.5181, 0.5176,
  0.5172, 0.5119,
];
const HE_B = [
  0.4245, 0.5747, 0.6527, 0.7223, 0.7582, 0.7957, 0.8279, 0.8553, 0.8757, 0.8903, 0.8997, 0.9073, 0.9122,
  0.9171, 0.9217, 0.9267,
];

export const COMPARTMENTS = N2_HALF.length;

export interface TissueState {
  /** Pressione parziale di azoto in ciascun compartimento, bar. */
  n2: number[];
  /** Pressione parziale di elio, bar. */
  he: number[];
}

/** Saturazione in aria a livello del mare: il punto di partenza di ogni immersione. */
export function surfacedTissues(surfacePressureBar = 1.01325): TissueState {
  const pn2 = (surfacePressureBar - WATER_VAPOUR_BAR) * 0.79;
  return {
    n2: new Array(COMPARTMENTS).fill(pn2),
    he: new Array(COMPARTMENTS).fill(0),
  };
}

/**
 * Un passo di carico/scarico a pressione ambiente costante (Haldane).
 *
 * Il passo di integrazione è l'intervallo fra due campioni, che sui nostri profili
 * è 4 o 10 secondi: molto più fine dell'emitempo più corto (4 minuti), quindi
 * l'approssimazione a pressione costante dentro il passo è irrilevante. Con passi
 * lunghi servirebbe l'equazione di Schreiner, che tiene conto della discesa dentro
 * il passo.
 */
export function step(state: TissueState, ambientBarValue: number, mix: GasMix, minutes: number): TissueState {
  if (!(minutes > 0)) return state;
  const inspired = Math.max(0, ambientBarValue - WATER_VAPOUR_BAR);
  const fHe = mix.he ?? 0;
  const fN2 = Math.max(0, 1 - mix.o2 - fHe);
  const piN2 = inspired * fN2;
  const piHe = inspired * fHe;

  const n2 = new Array(COMPARTMENTS);
  const he = new Array(COMPARTMENTS);
  for (let i = 0; i < COMPARTMENTS; i++) {
    n2[i] = state.n2[i] + (piN2 - state.n2[i]) * (1 - Math.pow(2, -minutes / N2_HALF[i]));
    he[i] = state.he[i] + (piHe - state.he[i]) * (1 - Math.pow(2, -minutes / HE_HALF[i]));
  }
  return { n2, he };
}

/** Coefficienti combinati: pesati sulle pressioni parziali dei due inerti. */
function coefficients(state: TissueState, i: number): { total: number; a: number; b: number } {
  const total = state.n2[i] + state.he[i];
  if (total <= 0) return { total: 0, a: N2_A[i], b: N2_B[i] };
  const a = (N2_A[i] * state.n2[i] + HE_A[i] * state.he[i]) / total;
  const b = (N2_B[i] * state.n2[i] + HE_B[i] * state.he[i]) / total;
  return { total, a, b };
}

/**
 * GF99: quanto sei sovrasaturo, in percentuale del gradiente ammesso dal modello
 * alla pressione ambiente in cui ti trovi.
 *
 * Zero significa saturazione pari all'ambiente, cento significa esattamente sul
 * valore M di Bühlmann. È il compartimento peggiore a comandare, ed è quello che
 * la funzione riporta.
 */
export function gf99(state: TissueState, ambientBarValue: number): { percent: number; leading: number } {
  let worst = 0;
  let leading = 0;
  for (let i = 0; i < COMPARTMENTS; i++) {
    const { total, a, b } = coefficients(state, i);
    const mValue = ambientBarValue / b + a;
    const gradient = mValue - ambientBarValue;
    if (gradient <= 0) continue;
    const percent = ((total - ambientBarValue) / gradient) * 100;
    if (percent > worst) {
      worst = percent;
      leading = i;
    }
  }
  return { percent: Math.max(0, Math.round(worst * 10) / 10), leading };
}

/**
 * Lo stato dei sedici compartimenti, uno per uno, pronto da disegnare.
 *
 * PERCHÉ SERVE UNA FUNZIONE E NON I NUMERI GREZZI. Perché il grafico dei
 * compartimenti — quello che ogni computer subacqueo mostra e che nessun logbook
 * mostra mai — ha bisogno di tre grandezze per barra: quanto inerte c'è dentro,
 * qual è il valore M a quella pressione ambiente, e dove cade il limite che ti sei
 * imposto con i gradient factor. Calcolarle nell'interfaccia significherebbe
 * riscrivere lì i coefficienti, ed è il modo in cui due parti dello stesso
 * programma cominciano a raccontare cose diverse.
 */
export interface CompartmentState {
  /** Indice 1-16, come lo chiamano i manuali. */
  index: number;
  halfTimeMin: number;
  n2: number;
  he: number;
  /** Inerte totale nel compartimento, bar. */
  total: number;
  /** Valore M alla pressione ambiente data: il limite del modello nudo. */
  mValue: number;
  /** Il limite ridotto dal gradient factor: `gf` fra 0 e 1. */
  limit: number;
  /** Percentuale del gradiente ammesso, cioè il GF99 di questo compartimento. */
  percent: number;
}

export function compartments(state: TissueState, ambientBarValue: number, gf = 1): CompartmentState[] {
  return N2_HALF.map((halfTimeMin, i) => {
    const { total, a, b } = coefficients(state, i);
    const mValue = ambientBarValue / b + a;
    const gradient = mValue - ambientBarValue;
    return {
      index: i + 1,
      halfTimeMin,
      n2: state.n2[i],
      he: state.he[i],
      total,
      mValue,
      limit: ambientBarValue + gradient * gf,
      percent: gradient > 0 ? Math.max(0, ((total - ambientBarValue) / gradient) * 100) : 0,
    };
  });
}

/**
 * Il tetto: la pressione ambiente più bassa tollerata, tradotta in metri.
 *
 * Con i gradient factor la formula è quella di Erik Baker: il gradiente ammesso
 * viene ridotto alla frazione `gf`. `gfLow` comanda la prima sosta, `gfHigh` la
 * risalita in superficie, e fra i due si interpola linearmente sulla profondità —
 * che è esattamente ciò che fa un computer con GF impostati.
 */
export function ceilingM(
  state: TissueState,
  gf: number,
  salinity: Salinity = 'salt',
  surfacePressureBar = 1.01325,
): number {
  let deepest = 0;
  for (let i = 0; i < COMPARTMENTS; i++) {
    const { total, a, b } = coefficients(state, i);
    // Baker: Pamb_tol = (Pt − a·gf) / (gf/b + 1 − gf)
    const tolerated = (total - a * gf) / (gf / b + 1 - gf);
    const metres = depthFromAbsoluteBar(tolerated, salinity, surfacePressureBar);
    if (metres > deepest) deepest = metres;
  }
  return Math.max(0, Math.round(deepest * 100) / 100);
}

/**
 * Desaturazione in superficie fra due immersioni.
 *
 * È un passo come gli altri, alla pressione di superficie e respirando aria. Il
 * motivo per cui merita una funzione con un nome è che dimenticarla è l'errore
 * più costoso di tutto il modulo: senza, ogni immersione ripetitiva riparte da
 * tessuti puliti e il modello sottostima la saturazione — cioè racconta più
 * margine di quello che c'è.
 */
export function desaturate(
  state: TissueState,
  surfaceMinutes: number,
  surfacePressureBar = 1.01325,
): TissueState {
  return step(state, surfacePressureBar, { o2: 0.21, he: 0 }, surfaceMinutes);
}

/**
 * LA DENSITÀ DICHIARATA DAL COMPUTER NON SI USA, E VALE LA PENA SPIEGARE PERCHÉ.
 *
 * Il Peregrine registra 1020 kg/m³ (l'impostazione EN13319), e sembrava ovvio
 * usare quella invece della nostra costante di 1030 per l'acqua salata. Provato:
 * peggiora. Con i coefficienti giusti lo scarto medio sulle 38 immersioni di
 * controllo è −0.9 punti con 1020 e −0.07 con 1030, e la scansione ha il minimo
 * proprio lì.
 *
 * La spiegazione probabile è che i 1020 servano alla profondità mostrata a
 * display, mentre il modello decompressivo lavori sulla pressione con la costante
 * dell'acqua di mare. Probabile, non dimostrato: quello che è misurato è che 1030
 * ricostruisce meglio i loro numeri, e questo è il motivo per cui la costante
 * resta una sola.
 */

export interface ProfileResult {
  /** GF99 all'uscita: il numero confrontabile con quello che scrive Shearwater. */
  gf99End: number;
  /** Il GF99 più alto raggiunto durante l'immersione. */
  gf99Max: number;
  /** Compartimento che comandava all'uscita, 1-16. */
  leadingCompartment: number;
  /** Tetto più profondo incontrato, metri: zero se l'immersione è restata in curva. */
  maxCeilingM: number;
  /** Minuti con un tetto attivo. */
  decoMinutes: number;
  state: TissueState;
  /**
   * Quanti campioni sono stati scartati perché illeggibili (tempo o profondità
   * non numerici, profondità negativa). Diverso da zero significa che questi
   * numeri descrivono un profilo con dei buchi, e chi li mostra deve dirlo.
   */
  skippedSamples?: number;
}

/**
 * Ripercorre un profilo campione per campione.
 *
 * `gfHigh` serve al tetto in superficie; il tetto durante l'immersione usa
 * l'interpolazione fra `gfLow` e `gfHigh`, come fa un computer. Il GF99 invece non
 * dipende dai gradient factor: è la sovrasaturazione rispetto al modello nudo, ed
 * è per questo che si può confrontare fra implementazioni diverse.
 */
export function runProfile(
  samples: Sample[],
  options: {
    mixOf?: (s: Sample) => GasMix | undefined;
    mix?: GasMix;
    gfLow?: number;
    gfHigh?: number;
    salinity?: Salinity;
    surfacePressureBar?: number;
    /** Stato iniziale, per le immersioni ripetitive. */
    initial?: TissueState;
  } = {},
): ProfileResult {
  const {
    mix = { o2: 0.21, he: 0 },
    mixOf,
    gfLow = 0.3,
    gfHigh = 0.85,
    salinity = 'salt',
    surfacePressureBar = 1.01325,
    initial,
  } = options;

  const amb = (depth: number) => ambientBar(depth, salinity, surfacePressureBar);

  /*
   * I campioni inutilizzabili si buttano PRIMA, non si integrano.
   *
   * Basta un `depth: NaN` in mezzo al profilo — e i parser di formati binari
   * malformati ne producono — perché tutti e sedici i compartimenti diventino
   * `NaN` per il resto dell'immersione. Il guaio non è il `NaN` in sé: è che poi
   * `gf99` esce **zero** e il tetto esce **zero**, cioè l'immersione viene
   * fotografata come la più tranquilla dell'archivio proprio perché il conto non
   * è stato fatto. Zero è il valore più rassicurante che quel numero possa
   * avere, ed è l'ultimo che dovrebbe comparire quando il dato manca.
   *
   * Saltare il campione e tenere il resto è meglio che rifiutare l'immersione:
   * un buco di qualche secondo in un profilo di quaranta minuti non cambia i
   * tessuti in modo apprezzabile, mentre perdere l'immersione intera spezza
   * anche la catena delle ripetitive.
   */
  const clean = samples.filter((sm) => Number.isFinite(sm.t) && Number.isFinite(sm.depth) && sm.depth >= 0);
  const skipped = samples.length - clean.length;
  samples = clean;

  let state = initial ?? surfacedTissues(surfacePressureBar);
  let gf99Max = 0;
  let maxCeilingM = 0;
  let decoMinutes = 0;
  let firstStopM = 0;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const minutes = (cur.t - prev.t) / 60;
    if (!(minutes > 0)) continue;
    const meanDepth = (prev.depth + cur.depth) / 2;
    state = step(state, amb(meanDepth), mixOf?.(cur) ?? mix, minutes);

    const here = gf99(state, amb(cur.depth));
    if (here.percent > gf99Max) gf99Max = here.percent;

    // L'obbligo decompressivo lo decide `gfHigh`: se con quello i tessuti
    // tollerano la superficie, l'immersione è in curva e non c'è nessun tetto —
    // che è ciò che mostra un computer. Usare `gfLow` per decidere l'obbligo
    // faceva comparire una sosta a cinque metri su un'immersione a 18 m per 30
    // minuti, che in curva ci sta comodamente.
    const ceilingHigh = ceilingM(state, gfHigh, salinity, surfacePressureBar);
    if (ceilingHigh <= 0) continue;

    // Da qui in poi si è in decompressione. La prima sosta è quella imposta da
    // `gfLow`, e su di essa si ancora l'interpolazione: `gfLow` alla prima sosta,
    // `gfHigh` in superficie.
    const deepCeiling = ceilingM(state, gfLow, salinity, surfacePressureBar);
    if (deepCeiling > firstStopM) firstStopM = deepCeiling;
    const gfNow =
      firstStopM > 0 ? gfHigh + ((gfLow - gfHigh) * Math.min(deepCeiling, firstStopM)) / firstStopM : gfHigh;
    const ceiling = ceilingM(state, gfNow, salinity, surfacePressureBar);
    if (ceiling > maxCeilingM) maxCeilingM = ceiling;
    decoMinutes += minutes;
  }

  const surfaceGf = gf99(state, surfacePressureBar);
  return {
    gf99End: surfaceGf.percent,
    ...(skipped > 0 ? { skippedSamples: skipped } : {}),
    // Il massimo comprende il valore ALL'USCITA, non solo quelli ai campioni.
    //
    // Molti computer smettono di registrare sopra il metro di quota, e su quei
    // profili l'ultimo campione non è la superficie: il massimo usciva più basso
    // del valore finale — una contraddizione interna — e sottostimava di trenta
    // punti su un profilo troncato a tre metri.
    gf99Max: Math.round(Math.max(gf99Max, surfaceGf.percent) * 10) / 10,
    leadingCompartment: surfaceGf.leading + 1,
    maxCeilingM: Math.round(maxCeilingM * 10) / 10,
    decoMinutes: Math.round(decoMinutes * 10) / 10,
    state,
  };
}

/**
 * Limite di non decompressione a una profondità, minuti.
 *
 * Con `gf = 1` è il limite del modello nudo, confrontabile con le tabelle
 * Bühlmann; con i gradient factor impostati è quello che mostrerebbe un computer.
 * Cerca per bisezione invece che per passi da un minuto: la funzione è monotona e
 * bastano una dozzina di iterazioni per il decimo di minuto.
 */
export function noDecoLimitMin(
  depthM: number,
  mix: GasMix = { o2: 0.21, he: 0 },
  options: { gfHigh?: number; salinity?: Salinity; surfacePressureBar?: number; maxMin?: number } = {},
): number {
  const { gfHigh = 1, salinity = 'salt', surfacePressureBar = 1.01325, maxMin = 360 } = options;
  const amb = ambientBar(depthM, salinity, surfacePressureBar);
  const fits = (minutes: number) => {
    const state = step(surfacedTissues(surfacePressureBar), amb, mix, minutes);
    return ceilingM(state, gfHigh, salinity, surfacePressureBar) <= 0;
  };
  if (fits(maxMin)) return maxMin;
  let lo = 0;
  let hi = maxMin;
  for (let k = 0; k < 20; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.round(lo * 10) / 10;
}
