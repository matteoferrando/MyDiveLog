/**
 * VPM-B: Varying Permeability Model, variante B di Erik C. Baker sul modello di
 * Yount e Hoffman.
 *
 * PERCHÉ UN SECONDO MODELLO. Bühlmann conta il gas disciolto e chiede che non
 * superi una soglia; il VPM conta le BOLLE. Parte dall'idea che nei tessuti
 * esistano già nuclei gassosi microscopici, che la discesa li schiacci rendendoli
 * più piccoli e più tolleranti, e che la risalita vada regolata sul volume di gas
 * libero che si acconsente a liberare. Ne escono tabelle di forma diversa: prima
 * sosta molto più profonda, molte soste profonde brevi, meno tempo alla sosta
 * finale. Averlo accanto a Bühlmann serve a vedere quella differenza sui propri
 * profili invece che leggerla in un forum — ed è il motivo per cui questo file
 * esiste in un logbook che non pianifica le immersioni per nessuno.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUELLO CHE QUESTO FILE NON FA. Leggerlo prima di credere ai numeri.
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  1. NIENTE CIRCUITO CHIUSO. Ogni livello respira una miscela fissa: niente
 *     setpoint, niente diluente.
 *  2. LA SALITA IN QUOTA È ISTANTANEA. L'algoritmo di quota c'è (vedi sotto), ma
 *     dove Baker integra i tessuti durante le ore di strada verso il lago, noi
 *     mettiamo il subacqueo in quota di colpo e contiamo solo le ore passate lì.
 *     È la lettura prudente — il gradiente che deforma i nuclei risulta il massimo
 *     possibile — e vale qualche minuto in più sulla tabella di chi si immerge
 *     appena arrivato.
 *  3. EMITEMPI DIVERSI DA QUELLI DI BAKER. Riusiamo `step` di `buhlmann.ts`, cioè
 *     ZH-L16C con il primo compartimento a 4.0 min (N2) e 1.51 min (He); il VPM di
 *     Baker usa 5.0 e 1.88. Non duplicare l'integrazione dei tessuti è una scelta
 *     deliberata — un secondo motore di saturazione nello stesso programma è il
 *     modo in cui due parti dell'app cominciano a raccontare cose diverse — ma il
 *     prezzo è che i compartimenti veloci qui sono più veloci, e i compartimenti
 *     veloci sono quelli che decidono la prima sosta.
 *  4. VAPORE ACQUEO 0.0627 bar. `step` usa il valore di Bühlmann (Rq = 1.0);
 *     Baker usa quello di Schreiner, 0.0493 bar (Rq = 0.8). Respiriamo quindi un
 *     filo meno di inerte del VPM canonico.
 *  5. NIENTE OSSIGENO, NIENTE GAS, NIENTE AVVISI. CNS, OTU, consumi, PPO2,
 *     controdiffusione: sono in `deco.ts` e restano lì.
 *
 * Tutto il resto dell'algoritmo pubblicato c'è: raggi critici e conservatorismo,
 * gradienti iniziali dalla tensione superficiale, rigenerazione dei nuclei,
 * pressione di schiacciamento con ramo permeabile e ramo impermeabile (cubica
 * risolta numericamente), gradienti ammessi, compensazione di Boyle in risalita —
 * che è precisamente ciò che distingue la «B» dal VPM liscio — l'algoritmo del
 * volume critico iterato fino a convergenza, l'algoritmo ripetitivo e quello di
 * quota.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RIPETITIVE E QUOTA: QUANTO VALGONO DAVVERO I NUCLEI
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Le due parti aggiunte per ultime — `VPM_REPETITIVE_ALGORITHM` e
 * `VPM_ALTITUDE_DIVE_ALGORITHM` — sono quelle su cui è più facile raccontarsi una
 * storia sbagliata, quindi vale la pena scrivere qui il risultato della misura
 * invece della descrizione dell'intenzione.
 *
 * Sono state misurate sul programma di riferimento accendendo e spegnendo la sola
 * subroutine dei nuclei, a parità di tutto il resto. Su un'immersione ripetitiva
 * l'allungamento della decompressione viene QUASI TUTTO dai tessuti ancora carichi,
 * non dai nuclei: su 45 m/25 min in aria la correzione dei nuclei vale ZERO minuti
 * a qualunque intervallo di superficie, su 80 m/25 min in trimix vale zero, su
 * 60 m/20 min vale un minuto. L'eccezione è la fascia media: su 30 m/40 min in aria
 * — dove a comandare la risalita sono compartimenti abbastanza veloci da aver
 * superato il gradiente ammesso iniziale nella prima immersione — vale fino a otto
 * minuti su quarantasette, cioè il venti per cento. Stessa storia in quota: a
 * 2000 m la correzione dei nuclei vale un minuto, mentre i restanti undici minuti
 * di allungamento vengono dalla pressione atmosferica più bassa e dai tessuti di
 * chi è appena salito.
 *
 * Detto altrimenti: chi si aspetta che l'algoritmo ripetitivo del VPM sia una
 * grossa penalità aggiuntiva rimarrà deluso, e chi lo lascia fuori sbaglia
 * soprattutto nella fascia dei 30 metri. Entrambe le affermazioni sono verificate
 * in `tests/vpm.test.ts` contro il programma di riferimento.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IL RISCONTRO ESTERNO, CHE È LA PARTE CHE CONTA
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Vale qui la frase che apre `buhlmann.ts`: un modello decompressivo scritto senza
 * un riscontro esterno è un generatore di numeri plausibili, e i numeri plausibili
 * in questo dominio sono la cosa peggiore che si possa produrre. Il riscontro c'è
 * ed è in `tests/vpm.test.ts`: le tabelle di riferimento vengono dal porting
 * pubblicato del programma FORTRAN di Baker (github.com/bwaite/vpmb) e da una
 * schedule VPM-B+1 pubblicata di Subsurface. Ci avviciniamo a qualche minuto, non
 * al minuto: le differenze elencate qui sopra — emitempi in testa — non permettono
 * di più, e il test dichiara la tolleranza caso per caso.
 *
 * Vale anche per le ripetitive e per la quota: i riferimenti sono coppie di
 * immersioni incatenate con `repetitive_code` e intervallo dichiarato, e profili
 * con `Altitude_Dive_Algorithm` acceso, dati allo stesso programma. Lo scarto
 * osservato è fra il 4 e il 9 per cento sulle ripetitive e fra il 3 e il 6 sulle
 * immersioni in quota da acclimatato; chi è appena salito lo calcoliamo dal 2 al 4
 * per cento più lungo del riferimento, e la ragione è la salita istantanea del
 * punto 2 qui sopra.
 *
 * FONTI DELLE FORMULE E DELLE COSTANTI:
 *  - E. C. Baker, programma VPMDECO/VPM-B in FORTRAN, porting pubblicato in
 *    https://github.com/bwaite/vpmb (`vpmb.py`: nuclear_regeneration,
 *    calc_initial_allowable_gradient, calc_crushing_pressure, critical_volume,
 *    boyles_law_compensation, vpm_repetitive_algorithm,
 *    vpm_altitude_dive_algorithm).
 *  - Subsurface, `core/deco.cpp`, per i moltiplicatori di conservatorismo:
 *    https://github.com/subsurface/subsurface/blob/master/core/deco.cpp
 *  - R. Helling, «VPM-B: How to compute your deco», The Theoretical Diver,
 *    https://thetheoreticaldiver.org/wordpress/index.php/2017/11/02/vpm-b-how-to-compute-your-deco/
 */

import type { GasMix, Salinity } from '../model';
import { ATM_BAR, ambientBar, depthFromAbsoluteBar } from '../units';
import { COMPARTMENTS, WATER_VAPOUR_BAR, step, surfacedTissues, type TissueState } from './buhlmann';
// La parte «tessuti» di ripetitive e quota esiste già in `deco.ts` ed è la stessa
// per i due modelli: desaturare in superficie e arrivare in quota non dipendono da
// come si calcola la risalita. Si importa invece di riscriverla — `deco.ts` non
// importa questo file (il pianificatore riceve le soste dall'esterno con
// `imposedStops`), quindi la dipendenza va in una direzione sola.
import {
  MAX_PLANNABLE_DEPTH_M,
  MAX_PLANNABLE_MINUTES,
  afterSurfaceInterval,
  barometric,
  sane,
  sanePositive,
  tissuesAtAltitude,
} from './deco';

// ---------------------------------------------------------------------------
// Le costanti del modello
// ---------------------------------------------------------------------------

/**
 * Tensione superficiale della pellicola del nucleo e tensione di compressione
 * della «pelle», N/m. Sono i due numeri da cui discende tutto il resto: il
 * gradiente ammesso è `2γ(γc − γ) / (r·γc)`, quindi un nucleo più piccolo tollera
 * una sovrasaturazione più grande. Valori di Yount, riportati identici da Baker.
 */
const GAMMA = 0.0179;
const GAMMA_C = 0.257;

/**
 * Raggi critici nominali dei nuclei, metri (0.55 e 0.45 µm).
 *
 * L'elio parte più piccolo dell'azoto, ed è la ragione per cui il VPM tratta le
 * due miscele in modo così diverso da Bühlmann.
 */
const CRITICAL_RADIUS_N2_M = 0.55e-6;
const CRITICAL_RADIUS_HE_M = 0.45e-6;

/** Costante di rigenerazione dei nuclei, minuti: due settimane. */
const REGENERATION_TIME_MIN = 20160;

/** Gradiente oltre il quale il nucleo diventa impermeabile: 8.2 atm, in bar. */
const IMPERM_GRADIENT_BAR = 8.2 * ATM_BAR;

/**
 * Parametro λ del volume critico. Yount lo pubblica come 7500 fsw·min e Baker lo
 * tiene in quelle unità: qui si converte una volta sola (1 fsw = 1/33 atm) e non
 * si guardano più i piedi.
 */
const CRIT_VOLUME_LAMBDA_BAR_MIN = (7500 / 33) * ATM_BAR;

/**
 * Pressione degli «altri gas» nel tessuto, 102 mmHg.
 *
 * È una differenza sostanziale rispetto a Bühlmann, non un dettaglio: il VPM
 * mette nella tensione del compartimento anche ossigeno, anidride carbonica e
 * vapore, perché a lui interessa la pressione totale dentro il nucleo e non la
 * sola quota di inerte disciolto.
 */
const OTHER_GASES_BAR = (102 / 760) * ATM_BAR;

const PA_PER_BAR = 100_000;

/**
 * Conservatorismo: moltiplicatori del raggio critico per i livelli 0..5.
 *
 * ATTENZIONE AL SEGNO, perché è controintuitivo e sbagliarlo produce un modello
 * che sembra funzionare e va nella direzione opposta: un nucleo PIÙ GRANDE tollera
 * un gradiente PIÙ PICCOLO (`ΔP ∝ 1/r`), quindi conservatorismo alto significa
 * raggio maggiorato, non ridotto. I primi cinque valori sono quelli di Subsurface
 * (`vpmb_conservatism_lvls`, che replicano i «+1 … +4» di V-Planner); il sesto è
 * estrapolato con lo stesso passo di crescita (1.35 × 1.12 ≈ 1.51) e va preso per
 * quello che è — un'estrapolazione nostra, non un valore pubblicato.
 */
const CONSERVATISM_FACTORS = [1.0, 1.05, 1.12, 1.22, 1.35, 1.51];

/**
 * Tetto di iterazioni dell'algoritmo del volume critico.
 *
 * Baker non ne mette nessuno e si affida alla convergenza; su un'immersione
 * normale bastano due o tre passate. Il tetto c'è perché un ciclo che non converge
 * dentro un logbook deve restituire l'ultima tabella calcolata e dichiarare quante
 * iterazioni ha fatto (`VpmResult.iterations`), non girare per sempre: se il
 * risultato riporta questo numero, la convergenza NON è stata raggiunta.
 *
 * ► ED È ESPORTATO PERCHÉ IL CONFRONTO SI FA ALTROVE. ◄ Il pianificatore
 * avvisa quando `iterations` ha toccato il tetto, e prima lo faceva contro un
 * `12` scritto a mano dentro il componente: due copie dello stesso numero, una
 * delle quali sarebbe rimasta indietro il giorno che si alza il tetto — e
 * l'avviso sarebbe scattato sempre, oppure mai.
 */
export const MAX_CRITICAL_VOLUME_ITERATIONS = 12;

/** Passo di integrazione dei tratti in pendenza, minuti. */
const RAMP_SLICE_MIN = 0.1;

/** Durata minima di una sosta, minuti: come Baker, si sosta a minuti interi. */
const MIN_STOP_MIN = 1;

/** Sbarramento contro le soste che non finiscono mai, minuti. */
const MAX_STOP_MIN = 999;

/**
 * Il raggio critico da cui riparte una ripetitiva: `VPM_REPETITIVE_ALGORITHM`,
 * l'ultima cosa che David Yount mise nel modello, pochi mesi prima di morire.
 *
 * L'idea è una resa dei conti onesta. L'algoritmo del volume critico, nella prima
 * immersione, ha ALLARGATO i gradienti ammessi oltre il «PssMin»: ha cioè accettato
 * consapevolmente che qualche nucleo crescesse. Se questo è avvenuto — se il
 * gradiente davvero raggiunto in risalita ha superato quello iniziale — allora al
 * rientro in acqua i nuclei sono più grandi di quelli nominali, e un nucleo più
 * grande tollera meno. Il raggio si ricava invertendo la stessa formula del
 * gradiente ammesso sul gradiente EFFETTIVO, corretto per lo schiacciamento; poi si
 * lascia rigenerare per l'intervallo di superficie, e all'infinito si torna al
 * raggio nominale.
 *
 * Se invece la risalita è rimasta sotto il gradiente iniziale non c'è niente da
 * scontare: il raggio riparte da quello di partenza, ed è la ragione per cui su
 * molte immersioni questa correzione non sposta un minuto.
 */
function repetitiveRadius(
  critBase: number,
  maxActualGradientBar: number,
  initialGradientBar: number,
  adjustedCrushBar: number,
  surfaceIntervalMin: number,
): number {
  if (!(maxActualGradientBar > initialGradientBar)) return critBase;
  const denominator = maxActualGradientBar * PA_PER_BAR * GAMMA_C - GAMMA * adjustedCrushBar * PA_PER_BAR;
  if (!(denominator > 0)) return critBase;
  const probed = (2 * GAMMA * (GAMMA_C - GAMMA)) / denominator;
  const regenerated =
    critBase + (critBase - probed) * Math.exp(-Math.max(0, surfaceIntervalMin) / REGENERATION_TIME_MIN);
  // Un raggio più PICCOLO del nominale sarebbe una ripetitiva più permissiva di
  // un'immersione da pulita, che è l'unico esito che il modello non può produrre.
  return Math.max(critBase, regenerated);
}

/**
 * Il raggio critico dopo la salita in quota: `VPM_ALTITUDE_DIVE_ALGORITHM`.
 *
 * Andare al lago è già una decompressione, e il VPM se ne accorge prima di
 * Bühlmann: i tessuti restano quelli del livello del mare mentre la pressione
 * ambiente cala, il gradiente che ne risulta agisce sui nuclei, e il nucleo si
 * ESPANDE — dilatandosi tollera meno. Due rami, come in Baker: se il gradiente
 * supera quello di formazione delle bolle per il raggio dato, il nucleo è stato
 * «sondato» e il nuovo raggio si legge invertendo la formula del gradiente; se
 * resta sotto, il nucleo si limita a gonfiarsi elasticamente. In entrambi i casi si
 * rigenera verso il raggio nominale con la costante delle due settimane, il che
 * significa che le stesse due righe descrivono sia chi si tuffa appena arrivato sia
 * chi al lago ci abita — a quest'ultimo l'esponenziale restituisce il nominale
 * senza bisogno di un ramo apposta.
 */
function altitudeRadius(critBase: number, gradientBar: number, hoursThere: number): number {
  const decay = Math.exp(-(Math.max(0, hoursThere) * 60) / REGENERATION_TIME_MIN);
  const gradientPa = gradientBar * PA_PER_BAR;
  const bubbleFormationPa = (2 * GAMMA * (GAMMA_C - GAMMA)) / (critBase * GAMMA_C);
  if (gradientPa > bubbleFormationPa) {
    const probed = (2 * GAMMA * (GAMMA_C - GAMMA)) / (gradientPa * GAMMA_C);
    return critBase + (critBase - probed) * decay;
  }
  const expanded = 1 / (gradientPa / (2 * (GAMMA - GAMMA_C)) + 1 / critBase);
  if (!(expanded > 0)) return critBase;
  return critBase + (expanded - critBase) * decay;
}

// ---------------------------------------------------------------------------
// Le costanti di tempo, prese in prestito da `buhlmann.ts` senza copiarle
// ---------------------------------------------------------------------------

/**
 * Le costanti di tempo dei compartimenti, ricavate INTERROGANDO `step` invece che
 * riscrivendo la tabella degli emitempi.
 *
 * Il volume di fase in superficie ha bisogno di `k = ln2 / t½` per ciascun
 * compartimento, e `buhlmann.ts` non esporta gli emitempi. Riportarli qui sarebbe
 * stata la strada breve, e sarebbe stata la solita seconda copia di una tabella
 * pubblicata destinata a divergere dalla prima. Invece si carica un compartimento
 * vuoto per un minuto esatto con inerte puro: la frazione raggiunta è
 * `1 − 2^(−1/t½)`, da cui `k = −ln(1 − f)`. Se un giorno `buhlmann.ts` cambia la
 * variante dei coefficienti, questo file la segue da solo.
 */
function probeTimeConstants(): { n2: number[]; he: number[] } {
  const empty: TissueState = {
    n2: new Array(COMPARTMENTS).fill(0),
    he: new Array(COMPARTMENTS).fill(0),
  };
  const probeBar = 10;
  const inspired = probeBar - WATER_VAPOUR_BAR;
  const afterN2 = step(empty, probeBar, { o2: 0, he: 0 }, 1);
  const afterHe = step(empty, probeBar, { o2: 0, he: 1 }, 1);
  return {
    n2: afterN2.n2.map((p) => -Math.log(1 - p / inspired)),
    he: afterHe.he.map((p) => -Math.log(1 - p / inspired)),
  };
}

const TIME_CONSTANT = probeTimeConstants();

// ---------------------------------------------------------------------------
// Ingressi e uscite
// ---------------------------------------------------------------------------

/**
 * Lo stato dei nuclei a fine immersione, per incatenare una ripetitiva.
 *
 * PERCHÉ NON BASTANO I TESSUTI. Il VPM porta avanti due memorie, non una. I
 * tessuti sono la memoria del gas disciolto e si svuotano in ore; i nuclei sono la
 * memoria di quanto si è lasciato bollire, e si rigenerano con una costante di due
 * settimane. Passare solo i tessuti alla ripetitiva significa dire al modello che
 * la prima immersione non è mai avvenuta dal punto di vista delle bolle.
 *
 * Sono i cinque ingredienti che la subroutine ripetitiva di Baker richiede, tutti
 * per compartimento. Non è uno stato «leggibile»: è un blocco da restituire tale e
 * quale a `planVpm` nella immersione successiva.
 */
export interface VpmNuclei {
  /** Raggi critici di partenza di QUESTA immersione, metri: già corretti per conservatorismo e quota. */
  critRadiusN2: number[];
  critRadiusHe: number[];
  /** Il fattore di conservatorismo con cui quei raggi sono stati costruiti. */
  conservatismFactor: number;
  /** Schiacciamento corretto per la rigenerazione, bar. */
  adjustedCrushN2: number[];
  adjustedCrushHe: number[];
  /** Gradienti ammessi iniziali, il «PssMin» di Yount, bar. */
  initialGradientN2: number[];
  initialGradientHe: number[];
  /** Massima sovrasaturazione effettivamente raggiunta in risalita, bar. */
  maxActualGradient: number[];
}

export interface VpmSettings {
  /** Conservatorismo: 0 = nominale, 1..5 come V-Planner. */
  conservatism: number;
  ascentRateMpm: number;
  descentRateMpm: number;
  lastStopM: number;
  stopIntervalM: number;
  salinity: Salinity;
  surfacePressureBar: number;
  /**
   * Tessuti di partenza.
   *
   * ATTENZIONE ALLA COPPIA CON `surfaceIntervalMin`, perché cambia il significato
   * di questo campo ed è l'unico posto del modulo in cui succede. Da solo,
   * `initial` è lo stato all'INIZIO di questa immersione, e chi lo passa se l'è
   * già desaturato. Insieme a `surfaceIntervalMin`, `initial` è lo stato alla FINE
   * dell'immersione precedente e la desaturazione la fa il modello, con
   * `afterSurfaceInterval` alla pressione di superficie giusta. La seconda forma è
   * quella da usare per incatenare: evita l'errore di desaturare due volte, o alla
   * pressione del livello del mare mentre si è al lago.
   */
  initial?: TissueState;
  /** Nuclei dell'immersione precedente. */
  previousNuclei?: VpmNuclei;
  /** Minuti di superficie fra la precedente e questa. */
  surfaceIntervalMin?: number;
  /**
   * Quota del sito, metri sul livello del mare.
   *
   * Se c'è e `surfacePressureBar` non è stato scritto a mano, la pressione di
   * superficie viene dalla formula barometrica standard. Scriverle entrambe è
   * legittimo — un barometro dice più di una carta topografica — e in quel caso
   * comanda `surfacePressureBar`, mentre la quota serve solo ai nuclei.
   */
  altitudeM?: number;
  /** Ore già passate a quella quota prima di immergersi. */
  hoursAtAltitude?: number;
}

/**
 * Il livello 3 come predefinito è la scelta di Subsurface, non la nostra: è il
 * valore che la comunità considera l'equivalente approssimativo di gradient factor
 * moderati. Il resto ricalca `DEFAULT_DECO` perché due pianificatori che partono
 * da velocità di risalita diverse non sono confrontabili.
 */
export const DEFAULT_VPM: VpmSettings = {
  conservatism: 3,
  ascentRateMpm: 9,
  descentRateMpm: 18,
  lastStopM: 3,
  stopIntervalM: 3,
  salinity: 'salt',
  surfacePressureBar: ATM_BAR,
};

export interface VpmStop {
  depthM: number;
  minutes: number;
}

export interface VpmResult {
  stops: VpmStop[];
  /** Minuti totali di decompressione. */
  decoMin: number;
  /** Prima sosta imposta dal modello, metri. */
  firstStopM?: number;
  /** Tessuti a fine immersione. */
  finalTissues: TissueState;
  /** Quante iterazioni ha richiesto l'algoritmo del volume critico. */
  iterations: number;
  /** Nuclei a fine immersione: da ripassare a `planVpm` per la ripetitiva. */
  nuclei: VpmNuclei;
}

/** Il livello: profondità, minuti (il primo include la discesa), miscela. */
export interface VpmLevel {
  depthM: number;
  minutes: number;
  mix: GasMix;
}

// ---------------------------------------------------------------------------
// Radice della cubica
// ---------------------------------------------------------------------------

/**
 * Risolve `A·r³ − B·r² − C = 0` fra due estremi, per bisezione.
 *
 * Baker usa un ibrido Newton-Raphson/bisezione preso da Numerical Recipes. Qui la
 * bisezione pura basta: sessanta iterazioni portano l'intervallo sotto 1e-18 volte
 * la sua ampiezza iniziale, le due cubiche del modello sono monotone fra gli
 * estremi che si passano, e la funzione viene chiamata poche migliaia di volte per
 * piano. Meno codice da sbagliare a parità di radice.
 */
function cubicRoot(a: number, b: number, c: number, low: number, high: number): number {
  const f = (r: number) => r * (r * (a * r - b)) - c;
  let lo = low;
  let hi = high;
  const fLo = f(lo);
  if (fLo === 0) return lo;
  // Se gli estremi non racchiudono la radice non si inventa un risultato: si
  // restituisce l'estremo più vicino a zero, che è il comportamento meno dannoso
  // (Baker in questo caso interrompe il programma).
  if (fLo * f(hi) > 0) return Math.abs(fLo) < Math.abs(f(hi)) ? lo : hi;
  const rising = fLo < 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (fMid === 0) return mid;
    if (fMid < 0 === rising) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Il piano
// ---------------------------------------------------------------------------

export function planVpm(
  levels: VpmLevel[],
  decoGases: { mix: GasMix; switchDepthM: number }[],
  settings: Partial<VpmSettings> = {},
): VpmResult {
  /*
   * Le impostazioni ripulite PRIMA di qualunque conto, con le stesse regole del
   * Bühlmann (`sane` sta in `deco.ts`, una sola definizione per due motori).
   *
   * Qui non era una precauzione teorica. Con `stopIntervalM: 0` o `NaN`, con
   * `conservatism: NaN`, con `surfacePressureBar: NaN` o con una quota di
   * centomila metri, `planVpm` restituiva una tabella VUOTA — zero soste, zero
   * minuti, nessun avviso, nessuna eccezione — su un profilo che con le
   * impostazioni buone ne chiedeva otto per 58 minuti. «Nessuna sosta» è
   * esattamente ciò che il subacqueo vuole leggere e non ha modo di smentire.
   * Con una velocità di risalita nulla o negativa, o con un passo fra le soste
   * negativo o infinitesimo, il ciclo di risalita non terminava affatto e
   * l'applicazione si piantava senza dire niente.
   */
  const asked: VpmSettings = {
    ...DEFAULT_VPM,
    ...settings,
    conservatism: Math.round(
      sane(settings.conservatism, DEFAULT_VPM.conservatism, 0, CONSERVATISM_FACTORS.length - 1),
    ),
    stopIntervalM: sanePositive(settings.stopIntervalM, DEFAULT_VPM.stopIntervalM, 1, 30),
    lastStopM: sanePositive(settings.lastStopM, DEFAULT_VPM.lastStopM, 1, 30),
    ascentRateMpm: sanePositive(settings.ascentRateMpm, DEFAULT_VPM.ascentRateMpm, 1, 60),
    descentRateMpm: sanePositive(settings.descentRateMpm, DEFAULT_VPM.descentRateMpm, 1, 120),
    altitudeM: settings.altitudeM === undefined ? undefined : sane(settings.altitudeM, 0, 0, 9000),
    hoursAtAltitude:
      settings.hoursAtAltitude === undefined ? undefined : sane(settings.hoursAtAltitude, 0, 0, 8760),
    surfaceIntervalMin:
      settings.surfaceIntervalMin === undefined
        ? undefined
        : sane(settings.surfaceIntervalMin, 0, 0, 525_600),
  };
  // La pressione di superficie: quella scritta a mano vince sempre, altrimenti la
  // ricava la formula barometrica standard dalla quota.
  const surfacePressureBar = sane(
    settings.surfacePressureBar ??
      (asked.altitudeM && asked.altitudeM > 0 ? barometric(asked.altitudeM) : DEFAULT_VPM.surfacePressureBar),
    DEFAULT_VPM.surfacePressureBar,
    0.3,
    1.2,
  );
  const s: VpmSettings = { ...asked, surfacePressureBar };

  const zeros = () => new Array<number>(COMPARTMENTS).fill(0);
  const amb = (depthM: number) => ambientBar(depthM, s.salinity, s.surfacePressureBar);
  const depthOf = (absBar: number) => depthFromAbsoluteBar(absBar, s.salinity, s.surfacePressureBar);

  // --- tessuti di partenza -------------------------------------------------
  // Tre casi, in ordine di specificità: si sta incatenando una ripetitiva e la
  // desaturazione la facciamo noi; oppure il chiamante ha già i suoi tessuti e ci
  // fidiamo; oppure si parte puliti, eventualmente in quota.
  const chained = s.initial !== undefined && s.surfaceIntervalMin !== undefined;
  const startTissues = chained
    ? afterSurfaceInterval(s.initial as TissueState, s.surfaceIntervalMin as number, s.surfacePressureBar)
    : (s.initial ??
      (s.altitudeM && s.altitudeM > 0
        ? tissuesAtAltitude(s.altitudeM, s.hoursAtAltitude ?? 0)
        : surfacedTissues(s.surfacePressureBar)));

  // --- raggi critici di partenza -------------------------------------------
  const conservatismLevel = Math.min(
    CONSERVATISM_FACTORS.length - 1,
    Math.max(0, Math.round(s.conservatism)),
  );
  const factor = CONSERVATISM_FACTORS[conservatismLevel];
  const critN2 = new Array<number>(COMPARTMENTS).fill(CRITICAL_RADIUS_N2_M * factor);
  const critHe = new Array<number>(COMPARTMENTS).fill(CRITICAL_RADIUS_HE_M * factor);

  const previous = s.previousNuclei;
  if (previous) {
    // Ripetitiva. I raggi non ripartono dal nominale ma da quelli dell'immersione
    // precedente, corretti per il bollire che le si è concesso e rigenerati
    // sull'intervallo. Se nel frattempo è cambiato il conservatorismo si riscala,
    // perché altrimenti la manopola non avrebbe più effetto dalla seconda
    // immersione in poi — una sorpresa che nessuno si aspetta.
    const rescale = previous.conservatismFactor > 0 ? factor / previous.conservatismFactor : 1;
    const si = s.surfaceIntervalMin ?? 0;
    for (let i = 0; i < COMPARTMENTS; i++) {
      critN2[i] = repetitiveRadius(
        previous.critRadiusN2[i] * rescale,
        previous.maxActualGradient[i],
        previous.initialGradientN2[i],
        previous.adjustedCrushN2[i],
        si,
      );
      critHe[i] = repetitiveRadius(
        previous.critRadiusHe[i] * rescale,
        previous.maxActualGradient[i],
        previous.initialGradientHe[i],
        previous.adjustedCrushHe[i],
        si,
      );
    }
  } else if (s.altitudeM && s.altitudeM > 0) {
    // Prima immersione di una serie, in quota. Il gradiente che deforma i nuclei
    // è quello di chi arriva su con i tessuti del livello del mare: è lo stesso
    // per tutti i compartimenti perché in superficie sono tutti in equilibrio, e
    // resta un ciclo per compartimento solo perché da qui in poi i raggi possono
    // divergere fra loro.
    const arrival = tissuesAtAltitude(s.altitudeM, 0);
    const hours = s.hoursAtAltitude ?? 0;
    for (let i = 0; i < COMPARTMENTS; i++) {
      const gradient = arrival.n2[i] + arrival.he[i] + OTHER_GASES_BAR - s.surfacePressureBar;
      critN2[i] = altitudeRadius(critN2[i], gradient, hours);
      critHe[i] = altitudeRadius(critHe[i], gradient, hours);
    }
  }

  /** Massima pressione di schiacciamento subita in discesa, bar. */
  const maxCrushN2 = zeros();
  const maxCrushHe = zeros();
  /** Raggio dopo schiacciamento e rigenerazione, metri. */
  const regenN2 = [...critN2];
  const regenHe = [...critHe];
  /** Schiacciamento «equivalente» che avrebbe prodotto il raggio rigenerato, bar. */
  const adjCrushN2 = zeros();
  const adjCrushHe = zeros();
  /** Gradienti ammessi prima e dopo il volume critico, bar. */
  const initialGradN2 = zeros();
  const initialGradHe = zeros();
  const allowGradN2 = zeros();
  const allowGradHe = zeros();
  /** Gradienti ammessi alla sosta corrente dopo la compensazione di Boyle, bar. */
  const decoGradN2 = zeros();
  const decoGradHe = zeros();

  /** I nuclei da restituire: si riempie strada facendo. */
  const nucleiOut = (maxActualGradient: number[]): VpmNuclei => ({
    critRadiusN2: [...critN2],
    critRadiusHe: [...critHe],
    conservatismFactor: factor,
    adjustedCrushN2: [...adjCrushN2],
    adjustedCrushHe: [...adjCrushHe],
    initialGradientN2: [...initialGradN2],
    initialGradientHe: [...initialGradHe],
    maxActualGradient,
  });

  const usable = levels
    .filter((l) => Number.isFinite(l.depthM) && l.depthM > 0 && Number.isFinite(l.minutes) && l.minutes >= 0)
    .map((l) => ({
      ...l,
      depthM: Math.min(l.depthM, MAX_PLANNABLE_DEPTH_M),
      minutes: Math.min(l.minutes, MAX_PLANNABLE_MINUTES),
    }));
  if (!usable.length) {
    return {
      stops: [],
      decoMin: 0,
      finalTissues: startTissues,
      iterations: 0,
      nuclei: nucleiOut(zeros()),
    };
  }

  // --- scelta del gas ------------------------------------------------------
  const bottomMix = usable[usable.length - 1].mix;
  /**
   * La miscela respirata a una quota in risalita: la più ricca di ossigeno fra
   * quelle dichiarate utilizzabili lì. Come in Baker il cambio avviene ALLA quota
   * di cambio, quindi il tratto che porta alla sosta si respira ancora con il gas
   * della sosta precedente, quella più profonda.
   */
  const mixAt = (depthM: number): GasMix => {
    let best = bottomMix;
    for (const g of decoGases) {
      if (g.switchDepthM + 1e-6 < depthM) continue;
      if (g.mix.o2 > best.o2) best = g.mix;
    }
    return best;
  };

  // --- integrazione di un tratto in pendenza -------------------------------
  /**
   * Integra una discesa o una risalita a fette da sei secondi.
   *
   * Baker usa l'equazione di Schreiner, che tiene conto della pressione che cambia
   * DENTRO il passo; noi riusiamo `step`, che è Haldane a pressione costante, e
   * compensiamo con la finezza del passo. A 0.1 minuti contro un emitempo minimo
   * di 4 minuti la differenza è sotto il centesimo di bar, e in cambio non esiste
   * una seconda integrazione dei tessuti in questo programma.
   */
  const ramp = (
    from: TissueState,
    fromM: number,
    toM: number,
    mix: GasMix,
    rateMpm: number,
    onSlice?: (state: TissueState, depthM: number) => void,
  ): { state: TissueState; minutes: number } => {
    const minutes = Math.abs(toM - fromM) / Math.max(1e-6, rateMpm);
    if (!(minutes > 0)) return { state: from, minutes: 0 };
    const slices = Math.max(1, Math.ceil(minutes / RAMP_SLICE_MIN));
    const dt = minutes / slices;
    let state = from;
    for (let k = 0; k < slices; k++) {
      const d0 = fromM + ((toM - fromM) * k) / slices;
      const d1 = fromM + ((toM - fromM) * (k + 1)) / slices;
      state = step(state, amb((d0 + d1) / 2), mix, dt);
      onSlice?.(state, d1);
    }
    return { state, minutes };
  };

  const tension = (state: TissueState, i: number) => state.n2[i] + state.he[i] + OTHER_GASES_BAR;

  // --- pressione di schiacciamento ------------------------------------------
  /**
   * Il ramo impermeabile: oltre 8.2 atm di gradiente la pelle del nucleo si serra,
   * il gas resta intrappolato e resiste alla compressione. Da lì in poi il raggio
   * non segue più una legge lineare e va trovato risolvendo una cubica, con
   * coefficienti diversi per elio e azoto perché i due nuclei partono da raggi
   * diversi. È la ragione per cui in questo regime i due schiacciamenti divergono.
   */
  const impermeableCrush = (
    critRadius: number,
    endAmbBar: number,
    onsetAmbBar: number,
    onsetTensionBar: number,
  ): number => {
    const skin = 2 * (GAMMA_C - GAMMA);
    const gradPa = IMPERM_GRADIENT_BAR * PA_PER_BAR;
    const rOnset = 1 / (gradPa / skin + 1 / critRadius);
    const endPa = endAmbBar * PA_PER_BAR;
    const onsetPa = onsetAmbBar * PA_PER_BAR;
    const tensionPa = onsetTensionBar * PA_PER_BAR;
    const a = endPa - onsetPa + tensionPa + skin / rOnset;
    const b = skin;
    const c = tensionPa * rOnset ** 3;
    const rEnd = cubicRoot(a, b, c, b / a, rOnset);
    const crushPa = gradPa + endPa - onsetPa + tensionPa * (1 - rOnset ** 3 / rEnd ** 3);
    return crushPa / PA_PER_BAR;
  };

  /**
   * Una discesa, con il conto dello schiacciamento.
   *
   * Lo schiacciamento NON è cumulativo: di una discesa a più riprese conta il
   * massimo ottenuto in un singolo tratto, ed è per questo che si tiene un massimo
   * per compartimento invece di sommare. Il punto di ingresso nel regime
   * impermeabile lo cerchiamo scandendo le fette dell'integrazione, dove Baker usa
   * una bisezione sul tempo: a sei secondi di risoluzione la differenza sul raggio
   * è trascurabile e il codice resta uno solo.
   */
  const descend = (from: TissueState, fromM: number, toM: number, mix: GasMix): TissueState => {
    const onsetAmb = new Array<number>(COMPARTMENTS).fill(NaN);
    const onsetTension = new Array<number>(COMPARTMENTS).fill(NaN);
    const startAmb = amb(fromM);
    for (let i = 0; i < COMPARTMENTS; i++) {
      // Caso limite che Baker non copre: si è già impermeabili all'inizio del
      // tratto (succede su una discesa spezzata). Si prende l'inizio del tratto
      // come punto di ingresso, che è la lettura prudente.
      if (startAmb - tension(from, i) > IMPERM_GRADIENT_BAR) {
        onsetAmb[i] = startAmb;
        onsetTension[i] = tension(from, i);
      }
    }
    const { state } = ramp(from, fromM, toM, mix, s.descentRateMpm, (st, depthM) => {
      const a = amb(depthM);
      for (let i = 0; i < COMPARTMENTS; i++) {
        if (!Number.isNaN(onsetAmb[i])) continue;
        const t = tension(st, i);
        if (a - t > IMPERM_GRADIENT_BAR) {
          onsetAmb[i] = a;
          onsetTension[i] = t;
        }
      }
    });

    const endAmb = amb(toM);
    for (let i = 0; i < COMPARTMENTS; i++) {
      const gradient = endAmb - tension(state, i);
      if (gradient <= IMPERM_GRADIENT_BAR || Number.isNaN(onsetAmb[i])) {
        // Ramo permeabile: il gas entra ed esce dal nucleo, e lo schiacciamento è
        // semplicemente il gradiente. Elio e azoto si comportano allo stesso modo.
        maxCrushN2[i] = Math.max(maxCrushN2[i], gradient);
        maxCrushHe[i] = Math.max(maxCrushHe[i], gradient);
      } else {
        maxCrushN2[i] = Math.max(
          maxCrushN2[i],
          impermeableCrush(critN2[i], endAmb, onsetAmb[i], onsetTension[i]),
        );
        maxCrushHe[i] = Math.max(
          maxCrushHe[i],
          impermeableCrush(critHe[i], endAmb, onsetAmb[i], onsetTension[i]),
        );
      }
    }
    return state;
  };

  // --- rigenerazione e gradienti iniziali ----------------------------------
  /**
   * I nuclei schiacciati ricrescono, con una costante di tempo di due settimane.
   *
   * Su un'immersione di un'ora l'effetto è quasi nullo — `exp(−60/20160)` vale
   * 0.997 — e la funzione sembra inutile. Diventa decisiva sulle immersioni in
   * saturazione, ed è nel modello per quello. Il secondo pezzo, lo «schiacciamento
   * corretto», serve a mantenere il conto riferito al raggio nominale: è il valore
   * di schiacciamento che avrebbe prodotto il raggio attuale senza rigenerazione,
   * e va usato al posto di quello vero nel volume critico.
   */
  const regenerate = (diveTimeMin: number) => {
    const skin = 2 * (GAMMA_C - GAMMA);
    const one = (maxCrushBar: number, crit: number): { regen: number; adjCrush: number } => {
      if (!(maxCrushBar > 0)) return { regen: crit, adjCrush: 0 };
      const crushPa = maxCrushBar * PA_PER_BAR;
      const ending = 1 / (crushPa / skin + 1 / crit);
      const regen = crit + (ending - crit) * Math.exp(-diveTimeMin / REGENERATION_TIME_MIN);
      const ratio = (ending * (crit - regen)) / (regen * (crit - ending));
      return { regen, adjCrush: maxCrushBar * ratio };
    };
    for (let i = 0; i < COMPARTMENTS; i++) {
      const n2 = one(maxCrushN2[i], critN2[i]);
      const he = one(maxCrushHe[i], critHe[i]);
      regenN2[i] = n2.regen;
      adjCrushN2[i] = n2.adjCrush;
      regenHe[i] = he.regen;
      adjCrushHe[i] = he.adjCrush;
    }
  };

  /**
   * I gradienti ammessi di partenza, il «PssMin» dei lavori di Yount: la minima
   * sovrasaturazione che farebbe crescere un nucleo del raggio dato. Sono questi a
   * fissare la prima sosta se si spegne l'algoritmo del volume critico.
   */
  const initialGradients = () => {
    const numerator = 2 * GAMMA * (GAMMA_C - GAMMA);
    for (let i = 0; i < COMPARTMENTS; i++) {
      initialGradN2[i] = numerator / (regenN2[i] * GAMMA_C) / PA_PER_BAR;
      initialGradHe[i] = numerator / (regenHe[i] * GAMMA_C) / PA_PER_BAR;
      allowGradN2[i] = initialGradN2[i];
      allowGradHe[i] = initialGradHe[i];
    }
  };

  // --- tetti ---------------------------------------------------------------
  /**
   * La pressione ambiente più bassa tollerata, in bar assoluti.
   *
   * I gradienti di elio e azoto si pesano sulle rispettive pressioni parziali, come
   * fa Bühlmann con i suoi coefficienti. Il compartimento vuoto — che capita dopo
   * lunghi tratti in ossigeno — non si può pesare: lì si prende il minore dei due,
   * che è la scelta di Baker e la più prudente.
   */
  const toleratedBar = (state: TissueState, gradN2: number[], gradHe: number[]): number => {
    let worst = 0;
    for (let i = 0; i < COMPARTMENTS; i++) {
      const load = state.n2[i] + state.he[i];
      const gradient =
        load > 0
          ? (gradHe[i] * state.he[i] + gradN2[i] * state.n2[i]) / load
          : Math.min(gradHe[i], gradN2[i]);
      const tolerated = Math.max(0, load + OTHER_GASES_BAR - gradient);
      if (tolerated > worst) worst = tolerated;
    }
    return worst;
  };

  /** Arrotonda una quota alla sosta utile immediatamente più profonda. */
  const stopAtOrBelow = (depthM: number): number => {
    if (depthM <= s.lastStopM) return s.lastStopM;
    const steps = Math.ceil((depthM - s.lastStopM) / s.stopIntervalM - 1e-9);
    return s.lastStopM + steps * s.stopIntervalM;
  };

  /**
   * La compensazione di Boyle, cioè la «B» di VPM-B.
   *
   * Il gradiente ammesso è calcolato per il nucleo com'è alla PRIMA sosta. Salendo,
   * la pressione ambiente cala e la bolla si espande: a parità di gas dentro, il
   * raggio cresce e il gradiente tollerabile si stringe. Si risolve la cubica di
   * Boyle `(P + 2γ/r)·r³ = costante` per il raggio alla sosta successiva e da lì si
   * ricava il gradiente. Senza questo pezzo il VPM liscio lascia salire troppo
   * negli ultimi metri, che è esattamente la critica che portò alla variante B.
   */
  const boyleCompensate = (firstStopM: number, nextStopM: number) => {
    const pFirst = amb(firstStopM) * PA_PER_BAR;
    const pNext = amb(nextStopM) * PA_PER_BAR;
    const one = (allowBar: number): number => {
      const gradPa = allowBar * PA_PER_BAR;
      if (!(gradPa > 0)) return allowBar;
      const rFirst = (2 * GAMMA) / gradPa;
      const a = pNext;
      const b = -2 * GAMMA;
      const c = (pFirst + (2 * GAMMA) / rFirst) * rFirst ** 3;
      const rEnd = cubicRoot(a, b, c, rFirst, rFirst * Math.cbrt(pFirst / pNext));
      return (2 * GAMMA) / rEnd / PA_PER_BAR;
    };
    for (let i = 0; i < COMPARTMENTS; i++) {
      decoGradN2[i] = one(allowGradN2[i]);
      decoGradHe[i] = one(allowGradHe[i]);
    }
  };

  // --- volume critico ------------------------------------------------------
  /**
   * Il tempo di volume di fase in superficie.
   *
   * Il VPM non smette di contare quando si esce dall'acqua: le bolle continuano a
   * crescere finché il tessuto resta sovrasaturo, e quel pezzo di integrale
   * `gradiente × tempo` entra nel bilancio del volume critico. Tre casi, come in
   * Baker: azoto ancora sopra l'inspirato in superficie, azoto già sotto ma elio
   * che tiene su la somma (e allora esiste un istante in cui il gradiente si
   * annulla, e si integra fino a lì), oppure nessuna sovrasaturazione e il termine
   * è zero.
   */
  const surfacePhaseVolumeTime = (state: TissueState): number[] => {
    const inspiredN2 = (s.surfacePressureBar - WATER_VAPOUR_BAR) * 0.79;
    const out = zeros();
    for (let i = 0; i < COMPARTMENTS; i++) {
      const n2 = state.n2[i];
      const he = state.he[i];
      const kN2 = TIME_CONSTANT.n2[i];
      const kHe = TIME_CONSTANT.he[i];
      if (n2 > inspiredN2) {
        out[i] = (he / kHe + (n2 - inspiredN2) / kN2) / (he + n2 - inspiredN2);
      } else if (he + n2 >= inspiredN2 && he > 1e-9 && Math.abs(kN2 - kHe) > 1e-12) {
        const decay = (1 / (kN2 - kHe)) * Math.log((inspiredN2 - n2) / he);
        const integral =
          (he / kHe) * (1 - Math.exp(-kHe * decay)) +
          ((n2 - inspiredN2) / kN2) * (1 - Math.exp(-kN2 * decay));
        out[i] = integral / (he + n2 - inspiredN2);
      } else {
        out[i] = 0;
      }
    }
    return out;
  };

  /**
   * L'algoritmo del volume critico: il cuore della variante B.
   *
   * L'idea di Yount è che non conta soltanto il gradiente istantaneo ma il VOLUME
   * di gas che si lascia liberare, cioè l'integrale del gradiente sul tempo. Se la
   * tabella generata con i gradienti iniziali libera meno del limite λ, i gradienti
   * si possono allargare — la decompressione si accorcia — e si rigenera la
   * tabella. La formula per il nuovo gradiente è la radice positiva della
   * quadratica `G² − B·G + C = 0`, con B e C costruiti su λ, sullo schiacciamento
   * corretto e sul tempo di fase totale.
   */
  const relaxGradients = (decoPhaseVolumeTime: number, surfacePhase: number[]) => {
    const lambdaPa = CRIT_VOLUME_LAMBDA_BAR_MIN * PA_PER_BAR;
    const one = (initialGradBar: number, adjCrushBar: number, phaseMin: number): number => {
      if (!(phaseMin > 0)) return initialGradBar;
      const initialPa = initialGradBar * PA_PER_BAR;
      const crushPa = adjCrushBar * PA_PER_BAR;
      const b = initialPa + (lambdaPa * GAMMA) / (GAMMA_C * phaseMin);
      const c = (GAMMA * GAMMA * lambdaPa * crushPa) / (GAMMA_C * GAMMA_C * phaseMin);
      const disc = b * b - 4 * c;
      if (!(disc >= 0)) return initialGradBar;
      return (b + Math.sqrt(disc)) / 2 / PA_PER_BAR;
    };
    for (let i = 0; i < COMPARTMENTS; i++) {
      const phase = decoPhaseVolumeTime + surfacePhase[i];
      allowGradN2[i] = one(initialGradN2[i], adjCrushN2[i], phase);
      allowGradHe[i] = one(initialGradHe[i], adjCrushHe[i], phase);
    }
  };

  // --- discesa, fondo, livelli ---------------------------------------------
  let state = startTissues;
  let depth = 0;
  let runtime = 0;

  for (let i = 0; i < usable.length; i++) {
    const lv = usable[i];
    const goingDown = lv.depthM > depth;
    const rate = goingDown ? s.descentRateMpm : s.ascentRateMpm;
    const travelMin = Math.abs(lv.depthM - depth) / rate;
    if (goingDown) state = descend(state, depth, lv.depthM, lv.mix);
    else if (lv.depthM < depth) state = ramp(state, depth, lv.depthM, lv.mix, rate).state;
    runtime += travelMin;
    // Come in `deco.ts` e come in ogni manuale: sul PRIMO livello il tempo
    // dichiarato comprende la discesa, sugli altri no.
    const atDepth = i === 0 ? Math.max(0, lv.minutes - travelMin) : lv.minutes;
    state = step(state, amb(lv.depthM), lv.mix, atDepth);
    runtime += atDepth;
    depth = lv.depthM;
  }

  const bottomState = state;
  const bottomDepth = depth;

  // I nuclei si rigenerano sul tempo di immersione, poi da lì escono i gradienti.
  regenerate(runtime);
  initialGradients();

  // --- inizio della zona di decompressione ---------------------------------
  /**
   * La quota in cui il compartimento guida entra in sovrasaturazione.
   *
   * Sotto di essa nessuna bolla può crescere, quindi nessuna sosta ha senso e
   * l'integrale del volume di fase non è ancora cominciato. Serve per due cose:
   * ancorare il calcolo della prima sosta e sapere da quale istante contare il
   * tempo di fase in acqua.
   */
  const decoZoneDepthM = (): number => {
    const supersaturated = (st: TissueState, depthM: number) => {
      const a = amb(depthM);
      for (let i = 0; i < COMPARTMENTS; i++) if (tension(st, i) >= a) return true;
      return false;
    };
    if (supersaturated(bottomState, bottomDepth)) return bottomDepth;
    let found = -1;
    ramp(bottomState, bottomDepth, 0, mixAt(bottomDepth), s.ascentRateMpm, (st, d) => {
      if (found < 0 && supersaturated(st, d)) found = d;
    });
    return found < 0 ? 0 : found;
  };
  const zoneM = decoZoneDepthM();

  // --- la risalita ---------------------------------------------------------
  /**
   * Verifica che salire fino alla sosta candidata non violi il tetto durante il
   * tragitto.
   *
   * Può succedere: risalendo da molto profondo un compartimento lento continua a
   * CARICARE mentre gli altri scaricano, e la sosta calcolata sui tessuti di
   * partenza risulta troppo bassa. Baker chiama questa verifica «projected
   * ascent»; se fallisce si approfondisce la sosta di un passo e si riprova.
   */
  const projectedAscent = (from: TissueState, fromM: number, candidateM: number): number => {
    let target = candidateM;
    for (let guard = 0; guard < 60 && target < fromM; guard++) {
      const trial = ramp(from, fromM, target, mixAt(fromM), s.ascentRateMpm).state;
      const pAmb = amb(target);
      let safe = true;
      for (let i = 0; i < COMPARTMENTS; i++) {
        const load = trial.n2[i] + trial.he[i];
        const gradient =
          load > 0
            ? (allowGradHe[i] * trial.he[i] + allowGradN2[i] * trial.n2[i]) / load
            : Math.min(allowGradHe[i], allowGradN2[i]);
        if (load + OTHER_GASES_BAR > pAmb + gradient) {
          safe = false;
          break;
        }
      }
      if (safe) return target;
      target += s.stopIntervalM;
    }
    return target;
  };

  interface Schedule {
    stops: VpmStop[];
    firstStopM: number;
    surfaceState: TissueState;
    /** Minuti dall'ingresso nella zona di deco all'arrivo in superficie. */
    decoPhaseMin: number;
    /**
     * Massima sovrasaturazione raggiunta in risalita, bar per compartimento.
     *
     * Non serve a questa immersione: serve alla PROSSIMA. È il numero con cui
     * l'algoritmo ripetitivo decide di quanto ingrandire i nuclei, e come lo
     * schiacciamento non è cumulativo — conta il massimo ottenuto in un singolo
     * gradino della risalita, non la somma.
     */
    maxActualGradient: number[];
  }

  /** Genera una tabella completa con i gradienti ammessi correnti. */
  const buildSchedule = (): Schedule => {
    const toZone = ramp(bottomState, bottomDepth, zoneM, mixAt(bottomDepth), s.ascentRateMpm);
    let cur = toZone.state;
    let elapsed = 0;

    // Il massimo gradiente si legge all'ARRIVO a ogni quota di sosta, prima di
    // sostarci: è lì che la sovrasaturazione è al culmine, e da lì in poi la sosta
    // la riduce. Compresa l'ultima risalita, perché la superficie è una quota come
    // le altre e su un'immersione senza soste è l'unica che conti.
    const maxActualGradient = zeros();
    const recordGradient = (state: TissueState, depthM: number) => {
      const pAmb = amb(depthM);
      for (let i = 0; i < COMPARTMENTS; i++) {
        const gradient = tension(state, i) - pAmb;
        if (gradient > maxActualGradient[i]) maxActualGradient[i] = gradient;
      }
    };

    const ceiling = depthOf(toleratedBar(cur, allowGradN2, allowGradHe));
    let stopM = ceiling <= 0 ? 0 : projectedAscent(cur, zoneM, stopAtOrBelow(ceiling));
    const firstStopM = stopM;

    if (stopM <= 0) {
      const up = ramp(cur, zoneM, 0, mixAt(zoneM), s.ascentRateMpm);
      recordGradient(up.state, 0);
      return {
        stops: [],
        firstStopM: 0,
        surfaceState: up.state,
        decoPhaseMin: up.minutes,
        maxActualGradient,
      };
    }

    const stops: VpmStop[] = [];
    let depthNow = zoneM;
    // Il contatore è una rete, non la correzione: le impostazioni degeneri sono
    // già state riportate in scala all'ingresso. Sta qui perché un ciclo che non
    // termina non produce un numero sbagliato — congela l'applicazione, e chi la
    // usa non ha modo di capire che cosa sia successo. Con un passo minimo di
    // mezzo metro dalla profondità massima pianificabile, settecento giri sono
    // già il doppio del necessario.
    let giri = 0;
    while (stopM > 0 && giri++ < 700) {
      const up = ramp(cur, depthNow, stopM, mixAt(depthNow), s.ascentRateMpm);
      cur = up.state;
      elapsed += up.minutes;
      depthNow = stopM;
      recordGradient(cur, stopM);

      const nextM = stopM <= s.lastStopM + 1e-9 ? 0 : stopM - s.stopIntervalM;
      boyleCompensate(firstStopM, nextM);

      const mix = mixAt(stopM);
      const stopAmb = amb(stopM);
      const nextAmb = amb(nextM);
      let minutes = 0;
      while (minutes < MAX_STOP_MIN) {
        cur = step(cur, stopAmb, mix, MIN_STOP_MIN);
        minutes += MIN_STOP_MIN;
        if (toleratedBar(cur, decoGradN2, decoGradHe) <= nextAmb + 1e-9) break;
      }
      elapsed += minutes;
      stops.push({ depthM: stopM, minutes });
      stopM = nextM;
    }

    const out = ramp(cur, depthNow, 0, mixAt(depthNow), s.ascentRateMpm);
    elapsed += out.minutes;
    recordGradient(out.state, 0);
    return {
      stops,
      firstStopM,
      surfaceState: out.state,
      decoPhaseMin: elapsed,
      maxActualGradient,
    };
  };

  // --- il ciclo del volume critico -----------------------------------------
  /**
   * Si genera una tabella, si misura il volume di gas liberato, e se non è ancora
   * al limite λ si allargano i gradienti e si rigenera. Baker dichiara la
   * convergenza quando il tempo di fase totale di UN compartimento qualsiasi
   * cambia di meno di un minuto rispetto al giro precedente: è un criterio lasco,
   * ma è il suo, e cambiarlo significherebbe non poter più confrontare i risultati
   * con nessuna implementazione pubblicata.
   */
  let schedule = buildSchedule();
  let iterations = 1;
  let lastPhase = zeros();

  while (schedule.stops.length > 0 && iterations < MAX_CRITICAL_VOLUME_ITERATIONS) {
    const surfacePhase = surfacePhaseVolumeTime(schedule.surfaceState);
    let converged = false;
    const phase = zeros();
    for (let i = 0; i < COMPARTMENTS; i++) {
      phase[i] = schedule.decoPhaseMin + surfacePhase[i];
      if (Math.abs(phase[i] - lastPhase[i]) <= 1) converged = true;
    }
    if (converged) break;
    relaxGradients(schedule.decoPhaseMin, surfacePhase);
    lastPhase = phase;
    schedule = buildSchedule();
    iterations++;
  }

  const decoMin = schedule.stops.reduce((sum, st) => sum + st.minutes, 0);
  return {
    stops: schedule.stops,
    decoMin,
    firstStopM: schedule.stops.length ? schedule.firstStopM : undefined,
    finalTissues: schedule.surfaceState,
    iterations,
    nuclei: nucleiOut(schedule.maxActualGradient),
  };
}
