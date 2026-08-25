/**
 * Pianificazione del gas sul consumo MISURATO.
 *
 * PERCHÉ ESISTE. Un pianificatore che parte da "20 litri al minuto, valore da
 * manuale" produce numeri validi per un subacqueo medio che non esiste. Questa app
 * ha il consumo reale di ogni immersione, calcolato da volume e pressioni: usarlo
 * qui è l'unica cosa che rende il piano *tuo*. Ed è anche il motivo per cui l'RMV è
 * calcolato con tanta cura e non stimato mai.
 *
 * COSA CALCOLA, E CON QUALI CONVENZIONI. Il numero che conta è il **gas minimo**
 * (rock bottom): quanto gas serve per portare DUE subacquei dal punto più profondo
 * alla superficie condividendo una bombola, dopo aver perso tempo a gestire il
 * problema. È una somma di fasi, ognuna a una pressione ambiente media:
 *
 *   1. gestione del problema sul fondo, a profondità massima;
 *   2. risalita fino alla sosta, alla velocità dichiarata;
 *   3. sosta di sicurezza;
 *   4. ultimo tratto fino alla superficie.
 *
 * Ogni fase viene mostrata separatamente nell'interfaccia: un numero unico non si
 * può controllare, quattro numeri con le loro ipotesi sì.
 *
 * COSA NON FA, E NON PER PRUDENZA FORMALE. Non pianifica la decompressione. Le
 * soste obbligatorie dipendono dal modello decompressivo, dai gradient factor e
 * dalla storia dei tessuti: sono il dominio del computer e del corso, non di una
 * sottrazione. Su un'immersione con obbligo deco, i tempi di sosta vanno presi dal
 * proprio piano e inseriti qui come "tempo aggiuntivo in risalita" — l'aritmetica
 * del gas la facciamo, la decompressione no.
 *
 * TUTTO IN SI: metri, secondi, litri, bar. Le conversioni stanno in `units.ts`.
 */

import type { Dive, GasMix, Salinity } from '../model';
import { LIMITS } from '../model';
import {
  ATM_BAR,
  ambientAta,
  ambientBar,
  bestMix,
  end as endDepth,
  mixName,
  mod,
  ppn2At,
  ppo2At,
} from '../units';
import { barometric } from './deco';
import { exposureOfSegments, type OxygenExposure } from './oxygen';

/** Consumo di superficie usato per il gas d'emergenza, litri al minuto. */
export const STRESS_RMV_DEFAULT = 30;

export interface GasPlanInput {
  /**
   * Profondità massima pianificata, metri.
   *
   * Decide il gas d'emergenza, la PPO2 e la narcosi: lì conta il caso peggiore.
   * NON decide il gas del fondo — quello dipende dalla media.
   */
  depthM: number;
  /**
   * Profondità media **del tempo di fondo**, metri.
   *
   * La convenzione va dichiarata perché è la fonte dell'errore più facile da fare:
   * la media che scrive il computer subacqueo è quella dell'*intera* immersione e
   * comprende già la risalita e le soste. Usarla qui, dove il tempo di risalita
   * viene contato a parte con le sue profondità, significa contare due volte la
   * parte poco profonda e sottostimare il gas — su un profilo quadro a 30 m,
   * del 12%. `bottomAvgForWholeAvg()` fa la conversione.
   *
   * Dentro il calcolo viene limitata alla massima: una media più profonda del
   * punto più profondo non esiste.
   */
  avgDepthM: number;
  /**
   * Tempo di fondo, minuti: dall'ingresso in acqua all'inizio della risalita
   * finale. Comprende la discesa, come lo conta il computer.
   */
  bottomMin: number;
  /**
   * Quanti minuti del tempo di fondo si passano alla profondità **massima**.
   *
   * Zero significa "non lo so": il fondo viene trattato come un unico tratto alla
   * profondità media, che per il gas è esatto comunque. Dandolo, il fondo si
   * spezza in due tratti — quello alla massima e il resto — e la profondità del
   * resto NON è un'ipotesi: è determinata dalla media, perché la pressione
   * ambiente è affine nella profondità. È anche il pezzo che rende utile il piano
   * delle pressioni: senza sapere quando si sta profondi, "al minuto 10 devi
   * avere X bar" sarebbe una media che non descrive nessun momento.
   */
  maxTimeMin: number;
  /**
   * Durata totale dell'immersione, minuti: dall'ingresso all'uscita.
   *
   * È un dato in ingresso, non un risultato, perché è il vincolo vero — l'ora in
   * cui devi essere in barca, il turno della muta, il compagno che ha meno gas. La
   * differenza fra totale e fondo è il budget della risalita: da lì escono la
   * velocità di risalita implicita e il tempo effettivo di ogni tratto, che è
   * quello che serve sapere per capire se il piano sta in piedi.
   */
  totalMin: number;
  /** Volume totale di gas trasportato, litri d'acqua (un bibombola 2×12 = 24). */
  tankL: number;
  startBar: number;
  mix: GasMix;
  salinity: Salinity;
  /**
   * Quota del sito sul livello del mare, metri.
   *
   * A milleduecento metri l'aria pesa l'undici per cento in meno, e questo cambia
   * due cose insieme: la pressione ambiente a ogni profondità — quindi il gas che
   * consumi, che è meno — e la pressione di superficie verso cui desaturi, quindi
   * la decompressione, che è più lunga. Molti pianificatori trattano la quota
   * assumendo comunque acqua di mare; qui quota e salinità sono due campi
   * indipendenti, perché immergersi in quota quasi sempre significa acqua dolce e
   * combinare le due cose è il caso normale, non l'eccezione.
   */
  altitudeM?: number;
  /**
   * Consumo di superficie in immersione, L/min: il TUO, misurato.
   *
   * Nota terminologica: la didattica tecnica chiama **SCR** il consumo riportato
   * alla superficie, e riserva "RMV" al consumo a una profondità dichiarata
   * (TDI Decompression Procedures 2011, p. 162). Il nome del campo resta per
   * compatibilità con gli archivi salvati; l'interfaccia dice "consumo di
   * superficie", che è la cosa senza ambiguità.
   */
  rmvLpm: number;
  /**
   * Consumo del compagno, L/min. Quando è più alto del tuo, il piano usa il suo.
   *
   * Non è cortesia: «the highest SCR of the team should be used» è ripetuto tre
   * volte nel manuale (TDI Decompression Procedures 2011, pp. 152, 163, 174).
   * Pianificare sul proprio respiro quando si scende in coppia significa che il
   * compagno gira prima di te e il piano non lo sa. Zero significa "solo io".
   */
  buddyRmvLpm: number;
  /**
   * Consumo di superficie in emergenza, L/min. Più alto del proprio: chi condivide
   * gas respira male. 30 L/min è il valore usato dalla didattica tecnica.
   */
  stressRmvLpm: number;
  /** Quante persone respirano dalla bombola durante la risalita d'emergenza. */
  divers: number;
  /** Minuti spesi a gestire il problema alla massima profondità. */
  problemMin: number;
  /**
   * Velocità della risalita **d'emergenza**, m/min.
   *
   * Non è la velocità della risalita pianificata: quella si ricava dal tempo
   * totale, perché è così che funziona davvero — si decide quando uscire, non a
   * che velocità. In emergenza invece la velocità è quella dello standard, e il
   * tempo è la conseguenza.
   */
  ascentRateMpm: number;
  /** Profondità e durata della sosta di sicurezza. */
  stopDepthM: number;
  stopMin: number;
  /**
   * Minuti aggiuntivi di sosta per una decompressione già pianificata altrove. Il
   * pianificatore non li calcola: li somma se glieli dai.
   */
  extraStopMin: number;
  /** Limite di PPO2 impostato sul computer, bar. */
  maxPpo2: number;
  /**
   * Miscela di decompressione portata in una bombola separata, se c'è.
   *
   * Il manuale calcola ogni gas a parte (TDI Decompression Procedures 2011,
   * pp. 167-171) e impone un margine: «the amount of decompression-gas to be
   * consumed should be multiplied by at least 1.5» (p. 176), perché in
   * decompressione il respiro accelera e una parte del gas può finire al
   * compagno. Senza questo campo le soste vengono pagate col gas di fondo, che è
   * l'ipotesi prudente ma non è come si immerge chi porta uno stage.
   */
  decoMix?: GasMix;
  /** Volume e pressione della bombola di deco, litri d'acqua e bar. */
  decoTankL: number;
  decoStartBar: number;
  /**
   * Consumo in decompressione, L/min. Il manuale lo tiene distinto da quello di
   * fondo (p. 152, p. 169): fermi a 6 metri si respira meno che a lavorare sul
   * fondo. Zero significa "come quello di fondo".
   */
  decoRmvLpm: number;
  /**
   * Come si decide la riserva.
   *
   * `rockBottom` è il gas calcolato per riportare due persone in superficie dal
   * punto più profondo: dipende da profondità, tempo e respiro, ed è la regola
   * della subacquea tecnica. `fixedBar` è la riserva fissa della subacquea
   * ricreativa — «esco con 50 bar» — che non dipende dalla profondità: è più
   * semplice e su immersioni facili è quello che si usa davvero.
   *
   * Quando è `fixedBar` il gas d'emergenza NON viene calcolato: niente fasi,
   * niente schema della risalita. Non è un valore nascosto, è un calcolo che non
   * viene fatto.
   */
  reserveRule: 'rockBottom' | 'fixedBar';
  /** La riserva fissa, in bar, quando la regola è `fixedBar`. */
  reserveBarFixed: number;
  /**
   * Quando girare l'immersione. `thirds` è la regola tecnica (un terzo
   * all'andata), `half` è quella ricreativa dell'andata e ritorno (metà del gas
   * utilizzabile), `none` non propone nessuna pressione di rientro — su una
   * discesa lineare con risalita libera qualunque regola di rientro è arbitraria.
   */
  turnRule: 'thirds' | 'half' | 'none';
}

export const DEFAULT_PLAN: Omit<GasPlanInput, 'rmvLpm'> = {
  depthM: 30,
  avgDepthM: 22,
  bottomMin: 20,
  maxTimeMin: 8,
  buddyRmvLpm: 0,
  // 20 di fondo, 3 di sosta e ~3.3 di risalita a 9 m/min: il totale predefinito è
  // coerente col resto invece di essere un numero tondo.
  totalMin: 27,
  tankL: 15,
  startBar: 200,
  mix: { o2: 0.21, he: 0 },
  salinity: 'salt',
  altitudeM: 0,
  stressRmvLpm: STRESS_RMV_DEFAULT,
  divers: 2,
  problemMin: 1,
  ascentRateMpm: 9,
  stopDepthM: 5,
  stopMin: 3,
  extraStopMin: 0,
  maxPpo2: 1.4,
  decoTankL: 7,
  decoStartBar: 200,
  decoRmvLpm: 0,
  reserveRule: 'rockBottom',
  reserveBarFixed: LIMITS.minReserveBar,
  turnRule: 'thirds',
};

/**
 * Un'avvertenza con il suo peso.
 *
 * La distinzione non è cosmetica: "il gas non basta" e "a questa profondità la
 * narcosi si sente" non sono la stessa cosa, e mostrarle con lo stesso rosso
 * insegna a ignorarle entrambe. `critical` è "questo piano non si esegue",
 * `caution` è "sappi cosa stai facendo".
 */
export interface GasWarning {
  level: 'critical' | 'caution';
  text: string;
}

export interface GasPhase {
  label: string;
  /**
   * Che tipo di tratto è. Serve a distinguere il fondo dal resto senza guardare
   * l'etichetta: da quando il fondo può essere spezzato in due, confrontare le
   * stringhe faceva finire "Fondo alla massima" fra i tratti di risalita.
   */
  kind: 'bottom' | 'travel' | 'stop';
  /** Durata della fase, minuti. */
  minutes: number;
  /** Profondità media della fase, metri. */
  meanDepthM: number;
  /** Pressione ambiente media, ATA. */
  meanAta: number;
  /** Quante persone respirano in questa fase. */
  divers: number;
  rmvLpm: number;
  /**
   * La miscela respirata in QUESTA fase.
   *
   * Sta nella fase e non si indovina da fuori perché il piano può avere due
   * gas: le soste pagate con lo stage si respirano col gas di decompressione.
   * Chi calcolava l'esposizione all'ossigeno rileggeva le fasi assumendo il gas
   * di fondo per tutte, e con soste a 6 m in ossigeno puro dopo 40 m in aria il
   * piano dichiarava CNS 8% e zero minuti sopra 1.6 bar dove i valori veri sono
   * 48% e 18 minuti: l’avvertenza sopra l’80% non poteva scattare. `deco.ts` la
   * stessa somma la fa sul gas davvero respirato in ogni tratto, e due
   * pianificatori della stessa app non possono dare due risposte diverse.
   */
  mix: GasMix;
  litres: number;
  /** Profondità di inizio e fine: servono a disegnare il profilo. */
  fromM: number;
  toM: number;
  /**
   * Vero quando i litri di questa fase escono da un'altra bombola (lo stage di
   * decompressione) e quindi non vanno scalati dal gas di fondo.
   *
   * Esiste come campo e non come confronto di identità perché la stessa
   * esclusione serve in due posti — il totale pianificato e la tabella delle
   * pressioni minuto per minuto — e finché era una `find` ripetuta i due posti
   * escludevano fasi diverse: la tabella addebitava alla bombola di fondo le
   * soste pagate con lo stage, e l'ultima riga arrivava a +37 bar rispetto
   * all'uscita prevista dallo stesso piano.
   */
  fromStage?: boolean;
}

/** Come si distribuisce la durata dell'immersione. */
export interface TimeSplit {
  bottomMin: number;
  /** Tutto quello che sta fra la fine del fondo e la superficie. */
  ascentMin: number;
  /** Dentro la risalita: quanto è transito verticale e quanto è sosta. */
  travelMin: number;
  stopsMin: number;
}

export interface GasPlan {
  /**
   * L'input **normalizzato**: profondità media limitata alla massima, sosta non
   * più profonda del fondo, tempo totale non inferiore al tempo di fondo. È questo
   * che l'interfaccia deve mostrare — far vedere un numero diverso da quello con
   * cui si è calcolato è il modo più rapido di perdere la fiducia di chi legge.
   */
  input: GasPlanInput;
  /** Durata totale, minuti: uguale a `input.totalMin` dopo la normalizzazione. */
  totalRuntimeMin: number;
  /** La distribuzione del tempo fra fondo, transito e soste. */
  split: TimeSplit;
  /**
   * Velocità media della risalita pianificata, m/min: profondità massima divisa
   * per il tempo di transito. `undefined` se il tempo totale non lascia nemmeno un
   * minuto per risalire.
   */
  plannedAscentRateMpm?: number;
  /** Durata minima possibile dell'immersione: fondo, soste e risalita al massimo consentito. */
  minTotalMin: number;
  /**
   * Profondità del tratto di fondo che NON è alla massima, quando il tempo alla
   * massima è dichiarato. Non è un'ipotesi: discende dalla media.
   */
  restDepthM?: number;
  /**
   * Massimo tempo alla profondità massima compatibile con la media dichiarata.
   * Oltre questo, per far tornare la media il resto del fondo dovrebbe stare
   * sopra il pelo dell'acqua.
   */
  maxFeasibleTimeMin: number;
  /**
   * Profondità media dell'**intera** immersione che questo piano produce: è il
   * numero che il computer scriverà a fine immersione, e quindi il modo di
   * verificare il piano dopo averlo eseguito.
   */
  wholeDiveAvgDepthM: number;
  /** Le fasi della risalita d'emergenza, in ordine. Vuote con la riserva fissa. */
  reserve: GasPhase[];
  /** Gas d'emergenza totale, litri e bar. */
  reserveL: number;
  reserveBar: number;
  /** Gas per l'immersione pianificata: fondo più risalita. */
  planned: GasPhase[];
  plannedL: number;
  plannedBar: number;
  /** Pressione all'uscita prevista se tutto va come pianificato. */
  expectedEndBar: number;
  /** Gas utilizzabile: dalla partenza alla riserva. */
  usableL: number;
  usableBar: number;
  /**
   * Pressione a cui girare l'immersione secondo la regola scelta. `undefined` con
   * `turnRule: 'none'`: nessun numero è meglio di un numero arbitrario.
   */
  turnBar?: number;
  /** Massimo tempo di fondo consentito dal gas, minuti. */
  gasLimitedBottomMin: number;
  /** Vero se il piano consuma più del gas utilizzabile. */
  overBudget: boolean;
  /** MOD della miscela al limite di PPO2 impostato, metri. */
  modM: number;
  /**
   * Le due MOD che la didattica chiede sempre insieme: 1.4 bar per la fase di
   * lavoro e 1.6 per la decompressione (TDI Advanced Nitrox p. 31 e p. 53).
   */
  modWorkM: number;
  modDecoM: number;
  /** La miscela migliore per questa profondità al limite di lavoro: Fg = Pg / P. */
  bestMixO2: number;
  /** Pressione parziale dell'azoto alla massima, ATA: la misura vera della narcosi. */
  ppn2AtDepth: number;
  /** CNS %, OTU e minuti oltre i limiti di PPO2, per l'immersione pianificata. */
  oxygen: OxygenExposure;
  /** Il consumo effettivamente usato: il più alto fra il tuo e quello del compagno. */
  planningRmvLpm: number;
  /** Vero se a pianificare è stato il respiro del compagno, non il tuo. */
  buddyDrivesPlan: boolean;
  /** Vero se la miscela richiede attrezzatura pulita per l'ossigeno (oltre il 40%). */
  needsO2CleanKit: boolean;
  /**
   * Il gas di decompressione, quando è in una bombola separata: litri richiesti
   * col margine di 1.5 del manuale, e la pressione che ne risulta.
   */
  deco?: {
    mix: GasMix;
    /** Profondità a cui si passa al gas di deco: la sua MOD a 1.6 bar. */
    switchDepthM: number;
    minutes: number;
    /** Litri effettivi delle soste fatte con questo gas. */
    litres: number;
    /** Litri da portare: gli effettivi moltiplicati per 1.5, come impone il manuale. */
    requiredL: number;
    requiredBar: number;
    /** Vero se la bombola dichiarata non basta. */
    short: boolean;
  };
  /** PPO2 alla profondità pianificata, bar. */
  ppo2AtDepth: number;
  /** END alla profondità pianificata, metri. */
  endM: number;
  /** Avvertenze: ognuna è un fatto, non un consiglio generico. */
  warnings: GasWarning[];
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Gas consumato in una fase, a profondità costante o in transito.
 *
 * La pressione ambiente media di un tratto percorso a velocità costante è quella
 * alla profondità media. Non è un'approssimazione: la pressione ambiente è affine
 * nella profondità (`ATM + ρgd`), quindi la sua media nel tempo è esattamente il
 * valore alla profondità media. È la stessa ragione per cui il gas del tempo di
 * fondo dipende solo dalla profondità media di quel tratto, qualunque forma abbia
 * il profilo — ed è il motivo per cui questo pianificatore non chiede la velocità
 * di discesa: non cambierebbe nessun risultato.
 */
function phaseAt(
  label: string,
  fromM: number,
  toM: number,
  minutes: number,
  rmvLpm: number,
  divers: number,
  salinity: Salinity,
  mix: GasMix,
  kind: GasPhase['kind'] = fromM === toM ? 'stop' : 'travel',
  surfaceBar = ATM_BAR,
): GasPhase {
  const meanDepthM = (fromM + toM) / 2;
  const meanAta = ambientAta(meanDepthM, salinity, surfaceBar);
  /*
   * I LITRI SI CONTANO SULLA PRESSIONE ASSOLUTA, non sugli ATA locali.
   *
   * «Litri» qui vuol dire bar·litro — `plannedBar = plannedL / tankL` e
   * `startL = startBar * tankL` — quindi il fattore giusto è la pressione
   * ambiente in bar, non il suo rapporto con la pressione di superficie del
   * posto. Al livello del mare i due differiscono dell'1.3%; in quota il
   * divisore cala e il consumo si gonfia: a 2000 metri il piano chiedeva 142
   * bar dove ne servono 113, cioè un quarto in più, e la documentazione di
   * `altitudeM` promette l'opposto — «la pressione ambiente a ogni profondità,
   * quindi il gas che consumi, che è meno».
   *
   * `meanAta` resta nel risultato perché è quello che l'interfaccia mostra come
   * ATA, ma non è più lui a fare il conto.
   */
  const meanBar = ambientBar(meanDepthM, salinity, surfaceBar);
  return {
    label,
    kind,
    // Nessun arrotondamento: la somma delle durate delle fasi DEVE valere la
    // durata totale, e arrotondare ogni fase a due decimali la faceva sballare di
    // un centesimo — abbastanza da far sforare il fondo scala al disegno.
    // L'arrotondamento è un fatto di presentazione e sta nell'interfaccia.
    minutes,
    meanDepthM: round1(meanDepthM),
    meanAta: Math.round(meanAta * 100) / 100,
    divers,
    rmvLpm,
    mix,
    litres: Math.round(minutes * meanBar * rmvLpm * divers),
    fromM: round1(fromM),
    toM: round1(toM),
  };
}

export function planGas(raw: GasPlanInput): GasPlan {
  const warnings: GasWarning[] = [];

  // --- normalizzazione ------------------------------------------------------
  // Ogni limite qui sotto è una combinazione che l'interfaccia può produrre e che
  // senza limite darebbe un numero senza significato: una media più profonda della
  // massima, una sosta sotto il fondo, un'immersione più corta del suo tempo di
  // fondo. Il risultato normalizzato torna dentro `plan.input`, così la pagina
  // mostra esattamente i valori con cui si è calcolato.
  const depthM = Math.max(1, raw.depthM);
  const stopDepthM = Math.min(Math.max(0, raw.stopDepthM), depthM);
  const avgDepthM = Math.min(Math.max(0, raw.avgDepthM), depthM);
  const bottomMin = Math.max(0, raw.bottomMin);
  const stopMin = Math.max(0, raw.stopMin);
  const extraStopMin = Math.max(0, raw.extraStopMin);
  const stopsMin = stopMin + extraStopMin;
  // Il totale non può essere più corto di fondo più soste: una sosta di
  // decompressione è un obbligo, non un'opzione che si taglia per rientrare
  // nell'orario. Se il numero dato è più basso, viene alzato — e siccome
  // `plan.input` è quello normalizzato, la pagina mostra il valore corretto invece
  // di un totale che le fasi contraddicono.
  const totalMin = Math.max(raw.totalMin, bottomMin + stopsMin);
  const tankL = Math.max(0.1, raw.tankL);
  const startBar = Math.max(0, raw.startBar);
  // Il consumo di squadra: il più alto dei due, come impone il manuale.
  const ownRmvLpm = Math.max(0.1, raw.rmvLpm);
  const buddyRmvLpm = Math.max(0, raw.buddyRmvLpm ?? 0);
  const rmvLpm = Math.max(ownRmvLpm, buddyRmvLpm);
  const stressRmvLpm = Math.max(0.1, raw.stressRmvLpm);
  const divers = Math.max(1, Math.round(raw.divers));
  const emergencyRateMpm = Math.max(1, raw.ascentRateMpm);
  const problemMin = Math.max(0, raw.problemMin);
  const maxPpo2 = Math.max(0.1, raw.maxPpo2);
  const reserveBarFixed = Math.max(0, raw.reserveBarFixed);
  const { mix, salinity, reserveRule, turnRule } = raw;
  // La quota entra da un punto solo: la pressione di superficie. Da lì scende in
  // ogni fase, perché ogni fase calcola la propria pressione ambiente media, ed è
  // quella a decidere quanti litri costa un minuto.
  const surfaceBar = barometric(raw.altitudeM ?? 0);
  const phase = (
    label: string,
    fromM: number,
    toM: number,
    minutes: number,
    rmvLpm: number,
    divers: number,
    sal: Salinity,
    kind?: GasPhase['kind'],
    /** Solo per le fasi che NON si respirano col gas di fondo (le soste con lo stage). */
    phaseMix?: GasMix,
  ) =>
    phaseAt(
      label,
      fromM,
      toM,
      minutes,
      rmvLpm,
      divers,
      sal,
      phaseMix ?? mix,
      kind ?? (fromM === toM ? 'stop' : 'travel'),
      surfaceBar,
    );

  const input: GasPlanInput = {
    ...raw,
    depthM,
    avgDepthM,
    bottomMin,
    totalMin,
    stopDepthM,
    stopMin,
    extraStopMin,
    tankL,
    startBar,
    rmvLpm: ownRmvLpm,
    buddyRmvLpm,
    stressRmvLpm,
    divers,
    ascentRateMpm: emergencyRateMpm,
    problemMin,
    maxPpo2,
    reserveBarFixed,
  };

  // --- come si distribuisce il tempo ---------------------------------------
  // Il budget della risalita è quello che avanza dal tempo totale. Le soste hanno
  // la precedenza — sono un obbligo, non un'opzione — e quello che resta è
  // transito verticale. Da lì esce la velocità di risalita che il piano implica,
  // che è il numero che dice se il piano è eseguibile.
  const ascentMin = Math.max(0, totalMin - bottomMin);
  const travelMin = Math.max(0, ascentMin - stopsMin);
  const plannedAscentRateMpm = travelMin > 0 ? depthM / travelMin : undefined;
  const minTotalMin = bottomMin + stopsMin + depthM / LIMITS.ascentRateDeepMpm;
  // Il transito si divide fra i due tratti in proporzione alla distanza: è
  // l'ipotesi di velocità costante, la stessa che fa il computer quando disegna la
  // rampa fra due campioni.
  const toStopMin = travelMin * ((depthM - stopDepthM) / depthM);
  const fromStopMin = travelMin * (stopDepthM / depthM);

  // --- il fondo, in uno o due tratti ----------------------------------------
  // Con il tempo alla massima dichiarato, il fondo si spezza. La profondità del
  // secondo tratto non si sceglie: la impone la media. Da
  //   media × fondo = massima × tempoAllaMassima + resto × tempoRestante
  // si ricava il resto. Se il tempo alla massima è troppo lungo per la media
  // dichiarata, il resto dovrebbe stare sopra la superficie: allora il tempo
  // viene riportato al massimo possibile e l'avvertenza lo dice, invece di
  // produrre un profilo che non esiste.
  const maxFeasibleTimeMin = depthM > 0 ? (avgDepthM * bottomMin) / depthM : bottomMin;
  const askedMaxTime = Math.max(0, Math.min(raw.maxTimeMin ?? 0, bottomMin));
  const maxTimeMin = Math.min(askedMaxTime, Math.floor(maxFeasibleTimeMin * 10) / 10);
  const restMin = Math.max(0, bottomMin - maxTimeMin);
  const restDepthM =
    maxTimeMin > 0 && restMin > 0
      ? Math.max(0, (avgDepthM * bottomMin - depthM * maxTimeMin) / restMin)
      : undefined;

  const bottomPhases: GasPhase[] =
    maxTimeMin <= 0
      ? [phase('Fondo', avgDepthM, avgDepthM, bottomMin, rmvLpm, 1, salinity, 'bottom')]
      : restMin <= 0
        ? [phase('Fondo alla massima', depthM, depthM, bottomMin, rmvLpm, 1, salinity, 'bottom')]
        : [
            phase('Fondo alla massima', depthM, depthM, maxTimeMin, rmvLpm, 1, salinity, 'bottom'),
            phase('Resto del fondo', restDepthM!, restDepthM!, restMin, rmvLpm, 1, salinity, 'bottom'),
          ];

  // --- gas dell'immersione pianificata --------------------------------------
  // --- gas di decompressione in bombola separata ----------------------------
  // Quando c'è, le soste NON si pagano col gas di fondo: si pagano con lui, alla
  // sua profondità e col suo consumo. Il passaggio avviene alla MOD del gas di
  // deco a 1.6 bar, che è il limite ammesso in decompressione.
  const decoMix = raw.decoMix;
  const decoSwitchDepthM = decoMix ? mod(decoMix, LIMITS.maxPpo2Deco, salinity, surfaceBar) : undefined;
  const decoRmvLpm = raw.decoRmvLpm > 0 ? raw.decoRmvLpm : rmvLpm;
  // Le soste si fanno col gas di deco solo se la loro profondità è dentro la sua
  // MOD: uno stage di ossigeno a 6 metri non serve a una sosta a 12.
  const stopsOnDeco =
    decoMix !== undefined && decoSwitchDepthM !== undefined && stopDepthM <= decoSwitchDepthM + 0.5;

  const planned: GasPhase[] = [
    ...bottomPhases,
    phase('Risalita fino alla sosta', depthM, stopDepthM, toStopMin, rmvLpm, 1, salinity),
    ...(stopsMin > 0
      ? [
          phase(
            stopsOnDeco
              ? `Soste con ${mixName(decoMix!)}`
              : extraStopMin > 0
                ? 'Soste (sicurezza e deco)'
                : 'Sosta di sicurezza',
            stopDepthM,
            stopDepthM,
            stopsMin,
            stopsOnDeco ? decoRmvLpm : rmvLpm,
            1,
            salinity,
            'stop',
            // Le soste con lo stage si pagano col gas di deco: i litri già lo
            // sapevano, l'ossigeno no. Ora lo sa anche lui, da un campo solo.
            stopsOnDeco ? decoMix : undefined,
          ),
        ]
      : []),
    phase('Ultimo tratto in superficie', stopDepthM, 0, fromStopMin, rmvLpm, 1, salinity),
  ];
  const stopPhase = planned.find((p) => p.kind === 'stop' && p.minutes > 0 && stopsOnDeco);
  if (stopPhase) stopPhase.fromStage = true;
  // Il totale sulla bombola di FONDO esclude le soste pagate con lo stage: sono
  // gas che esce da un'altra bombola, e sommarle qui gonfierebbe il consumo del
  // gas principale di una quantità che non spende.
  const plannedL = planned.reduce((a, p) => a + (p.fromStage ? 0 : p.litres), 0);
  const plannedBar = Math.ceil(plannedL / tankL);

  const deco = stopPhase
    ? (() => {
        const litres = stopPhase.litres;
        // Il ×1.5 del manuale: margine per un respiro accelerato o per una parte
        // del gas condivisa col compagno.
        const requiredL = Math.round(litres * 1.5);
        const requiredBar = Math.ceil(requiredL / Math.max(0.1, raw.decoTankL));
        return {
          mix: decoMix!,
          switchDepthM: round1(decoSwitchDepthM!),
          minutes: stopPhase.minutes,
          litres,
          requiredL,
          requiredBar,
          short: requiredBar > raw.decoStartBar,
        };
      })()
    : undefined;

  // La media dell'intera immersione che questo piano produce: la media pesata
  // delle fasi. È il numero che il computer scriverà a fine immersione.
  const wholeDiveAvgDepthM =
    totalMin > 0 ? planned.reduce((a, p) => a + p.meanDepthM * p.minutes, 0) / totalMin : 0;

  // --- gas d'emergenza (rock bottom) ----------------------------------------
  // Con la riserva fissa questo blocco non viene eseguito: l'utente ha detto che
  // non vuole quel calcolo, e riempirlo di valori predefiniti per mostrarlo
  // comunque sarebbe rispondere a una domanda che non è stata fatta.
  const emergencyToStopMin = Math.max(0, (depthM - stopDepthM) / emergencyRateMpm);
  const emergencyFromStopMin = stopDepthM / emergencyRateMpm;
  const reserve: GasPhase[] =
    reserveRule === 'fixedBar'
      ? []
      : [
          phase(
            'Gestione del problema sul fondo',
            depthM,
            depthM,
            Math.max(0, problemMin),
            stressRmvLpm,
            divers,
            salinity,
          ),
          phase(
            'Risalita fino alla sosta',
            depthM,
            stopDepthM,
            emergencyToStopMin,
            stressRmvLpm,
            divers,
            salinity,
          ),
          phase(
            extraStopMin > 0 ? 'Soste (sicurezza e deco)' : 'Sosta di sicurezza',
            stopDepthM,
            stopDepthM,
            stopsMin,
            stressRmvLpm,
            divers,
            salinity,
          ),
          phase(
            'Ultimo tratto in superficie',
            stopDepthM,
            0,
            emergencyFromStopMin,
            stressRmvLpm,
            divers,
            salinity,
          ),
        ];
  const reserveBar =
    reserveRule === 'fixedBar'
      ? Math.max(0, Math.round(reserveBarFixed))
      : Math.ceil(reserve.reduce((a, p) => a + p.litres, 0) / tankL);
  const reserveL =
    reserveRule === 'fixedBar' ? reserveBar * tankL : reserve.reduce((a, p) => a + p.litres, 0);

  // --- bilancio -------------------------------------------------------------
  const startL = startBar * tankL;
  const usableL = Math.max(0, startL - reserveL);
  const usableBar = Math.max(0, startBar - reserveBar);
  const expectedEndBar = Math.floor(startBar - plannedBar);

  // Tempo di fondo consentito dal gas: quello che resta dopo aver messo da parte
  // la riserva e pagato risalita e soste. Se non resta niente il tempo è zero, non
  // un numero positivo ottenuto sommandoci un pezzo di risalita.
  /*
   * Le fasi pagate con lo STAGE non si scalano dal gas di fondo.
   *
   * `plannedL` e `consumedAt` escludono già le fasi `fromStage`; qui no, e il
   * risultato veniva sottratto dall'utilizzabile per calcolare il tempo di fondo
   * consentito dal gas — cioè il numero dell'avviso «Il gas basta per N minuti
   * di fondo». Misurato su 40 m con soste sull'ossigeno: 18.2 minuti dichiarati
   * invece di 22.3, con i 360 L dello stage contati due volte.
   */
  const nonBottomL = planned
    .filter((p) => p.kind !== 'bottom' && !p.fromStage)
    .reduce((a, p) => a + p.litres, 0);
  const forBottomL = usableL - nonBottomL;
  const bottomLpm = rmvLpm * ambientBar(avgDepthM, salinity, surfaceBar);
  const gasLimitedBottomMin = Math.max(0, Math.floor((forBottomL / bottomLpm) * 10) / 10);
  // Una definizione sola, e le due cose che l'interfaccia mostra ne discendono
  // entrambe: prima erano due formule diverse e potevano contraddirsi.
  const overBudget = plannedL > usableL;

  // --- regola di rientro ----------------------------------------------------
  // Terzi: si gira dopo aver consumato un terzo dell'utilizzabile, il secondo
  // terzo serve per il ritorno e il terzo è il margine — è la regola della
  // subacquea tecnica, dove il ritorno è obbligato. Metà: andata e ritorno
  // simmetrici, la regola ricreativa. Nessuna: su una discesa lineare con
  // risalita libera qualunque numero sarebbe arbitrario, e non lo diamo.
  const turnBar =
    turnRule === 'none' ? undefined : Math.floor(startBar - usableBar / (turnRule === 'thirds' ? 3 : 2));

  // --- ossigeno e narcosi ---------------------------------------------------
  const modAtLimit = mod(mix, maxPpo2, salinity, surfaceBar);
  const ppo2AtDepth = ppo2At(mix, depthM, salinity, surfaceBar);
  // L'END con la pressione di superficie del posto: era l'unica delle cinque
  // grandezze elencate nel commento di `units.ts` («MOD, PPO2, END, EAD e CNS»)
  // rimasta indietro, e senza elio non si vede perché coincide con la
  // profondità. Con Tx18/30 a 60 m a 2000 m di quota: 39.64 m veri contro 38.99
  // dichiarati — e la soglia dell'avvertenza si sposta con lui.
  const end = endDepth(mix, depthM, salinity, { surfaceBar });
  const ppn2 = ppn2At(mix, depthM, salinity, surfaceBar);
  // L'esposizione all'ossigeno del piano: ogni fase è un tratto a PPO2 costante
  // (o mediamente costante, che per una grandezza affine è lo stesso), respirato
  // con la SUA miscela. Usare qui il gas di fondo per tutte le fasi significava
  // non vedere l'ossigeno delle soste sullo stage, cioè proprio il tratto che
  // l'esposizione la fa salire.
  const oxygen = exposureOfSegments(
    planned.map((ph) => ({
      ppo2: ppo2At(ph.mix, ph.meanDepthM, salinity, surfaceBar),
      minutes: ph.minutes,
    })),
  );

  // --- avvertenze -----------------------------------------------------------
  if (travelMin <= 0) {
    warnings.push({
      level: 'critical',
      text: `Il tempo totale non lascia nemmeno un minuto per risalire: ${bottomMin} minuti di fondo più ${stopsMin} di sosta riempiono già l'immersione. Per risalire da ${depthM} m alla velocità massima consentita servono almeno ${Math.ceil(minTotalMin)} minuti in tutto.`,
    });
  } else if (plannedAscentRateMpm !== undefined && plannedAscentRateMpm > LIMITS.ascentRateDeepMpm) {
    warnings.push({
      level: 'critical',
      text: `Con questi tempi la risalita viaggia a ${plannedAscentRateMpm.toFixed(1)} m/min di media, oltre i ${LIMITS.ascentRateDeepMpm} m/min raccomandati: porta il tempo totale ad almeno ${Math.ceil(minTotalMin)} minuti, o accorcia il fondo.`,
    });
  }
  if (askedMaxTime > maxTimeMin + 0.05) {
    warnings.push({
      level: 'caution',
      text: `Con una media di ${avgDepthM} m su ${bottomMin} minuti di fondo, il tempo massimo che puoi passare a ${depthM} m è ${maxTimeMin.toFixed(1)} minuti: oltre, il resto dell'immersione dovrebbe stare sopra la superficie per far tornare la media. Il piano usa ${maxTimeMin.toFixed(1)}.`,
    });
  }
  if (reserveBar >= startBar) {
    warnings.push({
      level: 'critical',
      text:
        reserveRule === 'fixedBar'
          ? `La riserva fissa di ${reserveBar} bar è pari o superiore alla pressione di partenza: con questa bombola non resta gas da usare.`
          : `Il gas minimo per la risalita d'emergenza (${reserveBar} bar) è pari o superiore alla pressione di partenza: con questa bombola l'immersione non è pianificabile.`,
    });
  }
  if (reserveRule === 'fixedBar' && depthM > 30) {
    warnings.push({
      level: 'caution',
      text: `La riserva fissa non dipende dalla profondità: a ${depthM} m gli stessi ${reserveBar} bar durano molto meno che a 15 m. Sotto i 30 metri, o in due su una bombola, il gas minimo calcolato è la regola che risponde alla domanda giusta — si attiva qui sopra.`,
    });
  }
  if (overBudget) {
    // I due numeri arrivano da due strade diverse (somma di litri arrotondati
    // contro divisione esatta) e sul filo possono coincidere: quando succede la
    // frase diventava "basta per 20 minuti, non 20". Al bordo si dice l'unica cosa
    // vera, cioè che non c'è margine.
    const allowed = Math.floor(gasLimitedBottomMin);
    warnings.push({
      level: 'critical',
      text:
        allowed < bottomMin
          ? `Il gas basta per ${allowed} minuti di fondo, non ${bottomMin}: servono più litri, una pressione di partenza più alta, meno profondità o meno tempo.`
          : `Il piano consuma tutto il gas utilizzabile senza lasciare margine: ${plannedL} L pianificati su ${Math.round(usableL)} L disponibili oltre la riserva.`,
    });
  }
  if (depthM > modAtLimit) {
    warnings.push({
      level: 'critical',
      text: `A ${depthM} m questa miscela supera il limite di PPO2 di ${maxPpo2} bar che hai impostato sul computer: la profondità massima operativa è ${modAtLimit.toFixed(1)} m.`,
    });
  }
  // La narcosi, nell'unità in cui la didattica la esprime davvero: «the generally
  // accepted range for nitrogen narcosis exposure is between 4.0 and 5.21 ata of
  // N2... There is no set rule» (TDI Advanced Nitrox p. 39), con 4.0 come massimo
  // in ambiente ostruito o in acqua fredda e buia (p. 40). Una soglia netta a 30 m
  // diceva più di quanto la fonte dica.
  if (ppn2 > 5.21) {
    warnings.push({
      level: 'caution',
      text: `Pressione parziale dell'azoto ${ppn2.toFixed(2)} ata (END ${end.toFixed(0)} m): oltre il limite superiore della fascia comunemente accettata, che va da 4.0 a 5.21 ata.`,
    });
  } else if (ppn2 > 4) {
    warnings.push({
      level: 'caution',
      text: `Pressione parziale dell'azoto ${ppn2.toFixed(2)} ata (END ${end.toFixed(0)} m): dentro la fascia accettata (4.0–5.21), ma sopra i 4.0 che la didattica indica come massimo in acqua fredda, buia o in ambiente ostruito.`,
    });
  }
  if (oxygen.cnsPercent >= 80) {
    warnings.push({
      level: oxygen.cnsPercent >= 100 ? 'critical' : 'caution',
      text: `Esposizione all'ossigeno ${oxygen.cnsPercent.toFixed(0)}% dell'orologio CNS${oxygen.minutesAbove14 > 0 ? `, con ${oxygen.minutesAbove14.toFixed(0)} minuti sopra 1.4 bar` : ''}: il limite è il 100% e va contato su tutte le immersioni della giornata, non solo su questa.`,
    });
  }
  if (!overBudget && expectedEndBar < reserveBar) {
    warnings.push({
      level: 'critical',
      text: `Uscita prevista a ${expectedEndBar} bar, sotto la riserva di ${reserveBar} bar che hai scelto: il piano consuma il gas che dovevi tenere da parte.`,
    });
  } else if (expectedEndBar < LIMITS.minReserveBar) {
    warnings.push({
      level: 'critical',
      text: `Uscita prevista a ${expectedEndBar} bar, sotto la riserva di ${LIMITS.minReserveBar} bar: il piano non lascia margine per un imprevisto in superficie.`,
    });
  }
  if (buddyRmvLpm > ownRmvLpm) {
    warnings.push({
      level: 'caution',
      text: `Il piano usa il consumo del compagno (${buddyRmvLpm} L/min) invece del tuo (${ownRmvLpm}): la didattica impone di pianificare sul respiro più alto della squadra, altrimenti è lui a girare prima e il piano non lo sa.`,
    });
  }
  if (decoMix && !stopsOnDeco && decoSwitchDepthM !== undefined) {
    warnings.push({
      level: 'caution',
      text: `La sosta è a ${stopDepthM} m ma ${mixName(decoMix)} si respira solo da ${decoSwitchDepthM.toFixed(1)} m in su: il piano paga le soste col gas di fondo. Sposta la sosta o cambia miscela di decompressione.`,
    });
  }
  if (deco?.short) {
    warnings.push({
      level: 'critical',
      text: `La bombola di decompressione non basta: servono ${deco.requiredBar} bar su ${raw.decoTankL} L (${deco.litres} L di soste × 1.5 di margine) e ne hai dichiarati ${raw.decoStartBar}.`,
    });
  }
  if (decoMix && decoMix.o2 > LIMITS.o2CleanThreshold + 1e-9) {
    warnings.push({
      level: 'caution',
      text: `Anche la bombola di decompressione (${mixName(decoMix)}) va pulita per il servizio ossigeno, e va etichettata con la sua profondità massima: ${decoSwitchDepthM?.toFixed(0)} m.`,
    });
  }
  if (mix.o2 > LIMITS.o2CleanThreshold + 1e-9) {
    warnings.push({
      level: 'caution',
      text: `Oltre il 40% di ossigeno serve attrezzatura pulita per il servizio ossigeno: erogatore, bombola e riempimento. Questa miscela è al ${Math.round(mix.o2 * 100)}%.`,
    });
  }
  if (extraStopMin === 0 && depthM >= 30 && bottomMin >= 20) {
    warnings.push({
      level: 'caution',
      text: 'A questa profondità e con questo tempo di fondo un obbligo decompressivo è probabile: le soste vanno prese dal tuo piano o dal computer e inserite come minuti aggiuntivi, questo pianificatore non le calcola.',
    });
  }

  return {
    input: { ...input, maxTimeMin },
    restDepthM: restDepthM === undefined ? undefined : round1(restDepthM),
    maxFeasibleTimeMin: round1(maxFeasibleTimeMin),
    // Non arrotondato, per la stessa ragione: è il totale con cui le fasi devono
    // quadrare.
    totalRuntimeMin: totalMin,
    split: {
      bottomMin: round1(bottomMin),
      ascentMin: round1(ascentMin),
      travelMin: round1(travelMin),
      stopsMin: round1(stopsMin),
    },
    plannedAscentRateMpm: plannedAscentRateMpm === undefined ? undefined : round1(plannedAscentRateMpm),
    minTotalMin: round1(minTotalMin),
    wholeDiveAvgDepthM: round1(wholeDiveAvgDepthM),
    reserve,
    reserveL,
    reserveBar,
    planned,
    plannedL,
    plannedBar,
    expectedEndBar,
    usableL,
    usableBar,
    turnBar,
    gasLimitedBottomMin,
    overBudget,
    modM: round1(modAtLimit),
    modWorkM: round1(mod(mix, LIMITS.maxPpo2Bottom, salinity, surfaceBar)),
    modDecoM: round1(mod(mix, LIMITS.maxPpo2Deco, salinity, surfaceBar)),
    bestMixO2: bestMix(depthM, LIMITS.maxPpo2Bottom, salinity, surfaceBar),
    planningRmvLpm: Math.round(rmvLpm * 10) / 10,
    buddyDrivesPlan: buddyRmvLpm > ownRmvLpm,
    needsO2CleanKit: mix.o2 > LIMITS.o2CleanThreshold + 1e-9,
    deco,
    ppn2AtDepth: Math.round(ppn2 * 100) / 100,
    oxygen,
    ppo2AtDepth: Math.round(ppo2AtDepth * 100) / 100,
    endM: round1(end),
    warnings,
  };
}

/**
 * Lo stesso piano a un'altra profondità massima.
 *
 * Usato sia dal campo "profondità massima" sia dalle curve, ed è il punto: prima
 * il campo riscalava la media e le curve no, quindi la curva prometteva a 40 m un
 * tempo che la pagina non dava mai se quel 40 lo scrivevi nel campo. Una funzione
 * sola, due usi, nessuna divergenza possibile.
 */
export function atDepth(
  p: GasPlanInput,
  d: number,
  avgRatio?: number,
  plannedAscentRateMpm?: number,
): GasPlanInput {
  const ratio = avgRatio ?? p.avgDepthM / Math.max(1, p.depthM);
  // La velocità di risalita si conserva, il tempo no: scendendo a 60 m con lo
  // stesso totale la risalita implicita diventa 15 m/min, e la curva prometteva
  // tempi di fondo che il piano stesso avrebbe bocciato. Tenere ferma la velocità
  // e allungare il totale è ciò che farebbe un subacqueo.
  const travel = Math.max(0, p.totalMin - p.bottomMin - p.stopMin - p.extraStopMin);
  // La velocità va passata da fuori quando si fanno più passaggi di seguito: se
  // la si ricava ogni volta dal totale arrotondato, un andata-e-ritorno sulla
  // profondità la degrada e l'immersione si allunga da sola.
  const rate = plannedAscentRateMpm ?? (travel > 0 ? p.depthM / travel : LIMITS.ascentRateDeepMpm);
  return {
    ...p,
    depthM: d,
    avgDepthM: Math.min(d, Math.round(ratio * d * 10) / 10),
    // Al minuto intero, e il tempo di transito arrotondato per ECCESSO: è un
    // campo che si compila a mano, e un totale di 28.6 veniva mostrato come
    // "29 min" mentre le righe della tabella arrivavano a 28.6 — due numeri
    // diversi per la stessa cosa nella stessa pagina. Per eccesso e non al più
    // vicino perché così la risalita che ne risulta è al massimo uguale a quella
    // di partenza, mai più veloce: l'arrotondamento non può inventare una
    // violazione del limite.
    totalMin: p.bottomMin + p.stopMin + p.extraStopMin + Math.ceil(d / rate),
    // La sosta NON viene toccata: limitarla qui la lasciava a 3 m per sempre dopo
    // un passaggio a bassa profondità. Al calcolo ci pensa `planGas`, che la
    // limita alla massima e lo dichiara in `plan.input`.
  };
}

/**
 * Il piano delle pressioni: a che minuto devi avere quanti bar.
 *
 * COSA È, E COSA NON È. Nei manuali TDI questa tabella non esiste. Quello che
 * insegnano sono due cose separate: il **run time schedule** (*Decompression
 * Procedures* pp. 134-138 e 159, colonne azione / profondità / stop time / run
 * time / miscela), che si porta sott'acqua su una lavagnetta e non ha nessuna
 * colonna di pressione; e la **turn pressure** (p. 176), che è un numero solo. La
 * colonna dei bar è un'aggiunta nostra, costruita con le formule del manuale — il
 * gas di ogni tratto è tempo × ATA medi × consumo (pp. 166-171) — ma non è una
 * procedura standard, e va presentata per quello che è.
 *
 * A COSA SERVE DAVVERO. La turn pressure dice se tornare indietro *adesso*; non
 * dice se stai consumando più del previsto quando ancora puoi rimediare. La
 * domanda che il manuale mette nella checklist di consapevolezza situazionale
 * (p. 123) — «in base al mio consumo attuale e alla profondità, quanto posso
 * ancora andare prima di raggiungere la mia pressione di virata?» — è mentale
 * proprio perché la tabella non c'è. Questa la mette in tasca.
 *
 * ONESTÀ DEL CONFRONTO. Il piano assume che tu respiri esattamente al consumo
 * dichiarato e stia esattamente sul profilo. Uno scostamento non significa che
 * stai sbagliando: significa che il piano e la realtà divergono, e a metà
 * immersione è un'informazione utile in entrambe le direzioni.
 */
export interface SchedulePoint {
  /** Minuti dall'ingresso in acqua. */
  runMin: number;
  /** Profondità in quell'istante, metri. */
  depthM: number;
  /** Pressione attesa in bombola, bar. */
  bar: number;
  /** Litri consumati fino a quel momento. */
  litres: number;
  /** Cosa stai facendo: l'etichetta della fase. */
  phase: string;
  /** Vero sui confini di fase: sono le righe che vanno in grassetto. */
  boundary: boolean;
}

export function pressureSchedule(plan: GasPlan, stepMin?: number): SchedulePoint[] {
  const { tankL, startBar } = plan.input;
  const total = plan.totalRuntimeMin;
  // Un passo che dia una decina di righe: una tabella di quaranta righe non si
  // legge sott'acqua, e una di tre non serve a niente.
  const step = stepMin ?? (total <= 25 ? 2 : total <= 60 ? 5 : 10);

  // Istanti da mostrare: i confini delle fasi (dove il profilo cambia) più la
  // griglia regolare. I confini ci sono sempre, anche se cadono fuori griglia.
  const marks = new Set<number>([0, total]);
  let t = 0;
  for (const ph of plan.planned) {
    t += ph.minutes;
    marks.add(Math.round(t * 100) / 100);
  }
  for (let m = step; m < total; m += step) marks.add(m);

  const ordered = [...marks].filter((m) => m >= 0 && m <= total + 1e-9).sort((a, b) => a - b);
  const boundaries = new Set<number>();
  t = 0;
  for (const ph of plan.planned) {
    t += ph.minutes;
    boundaries.add(Math.round(t * 100) / 100);
  }

  const out: SchedulePoint[] = [];
  for (const at of ordered) {
    const { litres, depthM, phase } = consumedAt(plan, at);
    out.push({
      runMin: Math.round(at * 10) / 10,
      depthM: Math.round(depthM * 10) / 10,
      litres: Math.round(litres),
      bar: Math.max(0, Math.round(startBar - litres / tankL)),
      phase,
      boundary: at === 0 || boundaries.has(Math.round(at * 100) / 100),
    });
  }
  return out;
}

/**
 * Litri consumati e profondità a un dato minuto.
 *
 * Dentro un tratto in transito la profondità è interpolata e il gas si integra
 * esattamente, perché la pressione ambiente è affine nella profondità: il consumo
 * fino a metà di una risalita è quello alla profondità media di quella metà, non
 * metà del consumo del tratto intero.
 */
function consumedAt(plan: GasPlan, atMin: number): { litres: number; depthM: number; phase: string } {
  const { salinity, altitudeM } = plan.input;
  // La stessa pressione di superficie con cui sono state costruite le fasi: a
  // 1500 m un minuto costa il 16% in meno che al mare, e la tabella che ignorava
  // la quota scriveva un'uscita più bassa di quella che il piano prometteva.
  const surfaceBar = barometric(altitudeM ?? 0);
  let elapsed = 0;
  let litres = 0;
  let depthM = plan.planned[0]?.fromM ?? 0;
  let phase = plan.planned[0]?.label ?? '';
  for (const ph of plan.planned) {
    const inPhase = Math.min(Math.max(0, atMin - elapsed), ph.minutes);
    if (inPhase > 0) {
      const frac = ph.minutes > 0 ? inPhase / ph.minutes : 0;
      const to = ph.fromM + (ph.toM - ph.fromM) * frac;
      // Consumo e numero di respiratori si leggono dalla fase, non dall'input:
      // le fasi di fondo sono pianificate sul respiro più alto della squadra e
      // le soste sullo stage, mentre `input.rmvLpm` è sempre e solo il tuo.
      // Prendendolo dall'input la tabella descriveva un'immersione diversa da
      // quella pianificata, e il minuto di rientro usciva sbagliato di alcuni
      // minuti proprio quando il compagno consuma più di te.
      if (!ph.fromStage) {
        litres += inPhase * ambientBar((ph.fromM + to) / 2, salinity, surfaceBar) * ph.rmvLpm * ph.divers;
      }
      depthM = to;
      phase = ph.label;
    }
    elapsed += ph.minutes;
    if (atMin <= elapsed + 1e-9) break;
  }
  return { litres, depthM, phase };
}

/**
 * Il minuto in cui la pressione attesa incrocia quella di rientro.
 *
 * È la traduzione temporale della turn pressure: sapere che si gira a 112 bar è
 * utile in acqua, sapere che dovrebbe succedere intorno al minuto 18 è utile
 * mentre si pianifica — se cade dopo la fine del fondo, la regola di rientro non
 * morde e vale la pena saperlo prima.
 */
export function turnMinute(plan: GasPlan): number | undefined {
  if (plan.turnBar === undefined) return undefined;
  const points = pressureSchedule(plan, 0.5);
  const crossing = points.find((p) => p.bar <= plan.turnBar!);
  return crossing?.runMin;
}

/**
 * Gli schedule di contingenza.
 *
 * «Contingency schedules should be printed and taken into the water» — cinque
 * scenari, elencati in TDI Decompression Procedures 2011, p. 160: fondo più corto,
 * fondo più lungo, più profondo del previsto, più lungo E più profondo insieme, e
 * perdita del gas di decompressione. Il senso è che la domanda «e se…» va fatta
 * in superficie, dove c'è tempo di rispondere.
 *
 * Qui ogni scenario è lo stesso piano ricalcolato con un parametro cambiato: non
 * una tabella a parte da tenere allineata a mano, ma la stessa aritmetica. Lo
 * scenario del gas di deco perso è l'unico strutturalmente diverso — le soste
 * tornano sul gas di fondo — ed è anche quello che morde di più.
 */
export interface Contingency {
  label: string;
  /** Cosa cambia rispetto al piano. */
  change: string;
  plan: GasPlan;
  /** Vero se il piano di contingenza sta ancora nel gas che porti. */
  fits: boolean;
  /** Differenza di pressione all'uscita rispetto al piano nominale, bar. */
  endBarDelta: number;
}

export function contingencies(input: GasPlanInput): Contingency[] {
  const base = planGas(input);
  const scenarios: { label: string; change: string; input: GasPlanInput }[] = [
    {
      label: 'Fondo più lungo',
      change: '+5 minuti sul fondo, tutto il resto uguale',
      input: { ...input, bottomMin: input.bottomMin + 5, totalMin: input.totalMin + 5 },
    },
    {
      label: 'Più profondo',
      change: '+3 metri sulla massima, con la media che segue',
      input: atDepth(input, input.depthM + 3, undefined, base.plannedAscentRateMpm),
    },
    {
      label: 'Più lungo e più profondo',
      change: 'i due insieme: è lo scenario peggiore che il manuale chiede di avere in tasca',
      input: {
        ...atDepth(input, input.depthM + 3, undefined, base.plannedAscentRateMpm),
        bottomMin: input.bottomMin + 5,
        totalMin: input.totalMin + 5 + 3 / Math.max(1, base.plannedAscentRateMpm ?? 9),
      },
    },
    {
      label: 'Fondo più corto',
      change: "−5 minuti: la via d'uscita se qualcosa non va",
      input: {
        ...input,
        bottomMin: Math.max(1, input.bottomMin - 5),
        totalMin: Math.max(1, input.totalMin - 5),
      },
    },
  ];

  if (input.decoMix) {
    scenarios.push({
      label: 'Gas di decompressione perso',
      change: 'le soste tornano sul gas di fondo, con il tuo consumo normale',
      input: { ...input, decoMix: undefined },
    });
  }

  return scenarios.map((s) => {
    const plan = planGas(s.input);
    return {
      label: s.label,
      change: s.change,
      plan,
      fits: !plan.overBudget && plan.expectedEndBar >= plan.reserveBar,
      endBarDelta: plan.expectedEndBar - base.expectedEndBar,
    };
  });
}

/**
 * La profondità media del tempo di fondo che produce una data media dell'intera
 * immersione.
 *
 * Serve a precompilare il modulo dall'archivio senza commettere l'errore che il
 * commento di `avgDepthM` descrive: il computer registra la media dell'intera
 * immersione, il pianificatore chiede quella del solo tempo di fondo, e le due
 * differiscono di parecchio. La conversione è esatta — la media di una grandezza
 * affine è la media pesata dei tratti — e si ottiene sottraendo dal totale il
 * contributo della risalita e delle soste, che il piano conosce già.
 *
 * Restituisce `undefined` quando il piano non ha tempo di fondo, e limita il
 * risultato alla profondità massima: se l'archivio suggerisce una media che il
 * profilo pianificato non può produrre, il valore giusto è il massimo possibile.
 */
export function bottomAvgForWholeAvg(input: GasPlanInput, wholeAvgM: number): number | undefined {
  const plan = planGas(input);
  const bottom = plan.split.bottomMin;
  if (bottom <= 0) return undefined;
  const others = plan.planned
    .filter((p) => p.kind !== 'bottom')
    .reduce((a, p) => a + p.meanDepthM * p.minutes, 0);
  const value = (wholeAvgM * plan.totalRuntimeMin - others) / bottom;
  return Math.max(1, Math.min(plan.input.depthM, Math.round(value * 10) / 10));
}

/**
 * Geometria di una sequenza di fasi, per disegnarla.
 *
 * Sta qui e non nel componente che la disegna perché è aritmetica, e come tale si
 * verifica: le fasi portano già la profondità di partenza e di arrivo, la
 * geometria si limita a incolonnarle nel tempo. Il disegno non può raccontare un
 * piano diverso da quello della tabella accanto, perché legge le stesse fasi.
 *
 * Vale sia per la risalita d'emergenza sia per il profilo pianificato.
 */
export interface AscentSegment {
  phase: GasPhase;
  fromM: number;
  toM: number;
  /** Minuti dall'inizio della sequenza. */
  startMin: number;
  endMin: number;
}

export function ascentGeometry(plan: GasPlan): AscentSegment[] {
  return phaseGeometry(plan.reserve);
}

export function phaseGeometry(phases: GasPhase[]): AscentSegment[] {
  let elapsed = 0;
  return phases.map((phase) => {
    const seg: AscentSegment = {
      phase,
      fromM: phase.fromM,
      toM: phase.toM,
      startMin: elapsed,
      endMin: elapsed + phase.minutes,
    };
    elapsed += phase.minutes;
    return seg;
  });
}

// ---------------------------------------------------------------------------
// Il consumo misurato, e i valori con cui riempire il modulo
// ---------------------------------------------------------------------------

export interface MeasuredRmv {
  /** Mediana del consumo misurato, L/min. */
  median?: number;
  /** Consumo peggiore fra i migliori tre quarti: il valore da usare per pianificare. */
  p75?: number;
  /** Il peggiore osservato. */
  max?: number;
  /** Su quante immersioni si basa. */
  n: number;
}

/**
 * Statistica del consumo dalle immersioni che lo hanno.
 *
 * Per pianificare si usa il **75° percentile** e non la media: pianificare sulla
 * media significa che una volta su due il gas basta appena. Il valore mediano
 * resta mostrato accanto, perché è quello che dice come vanno le cose di solito.
 */
export function measuredRmv(dives: Dive[]): MeasuredRmv {
  const values = dives
    .map((d) => d.metrics?.rmvLpm)
    .filter((v): v is number => v !== undefined && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (!values.length) return { n: 0 };
  const at = (q: number) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  return {
    median: round1(median),
    p75: round1(at(0.75)),
    max: round1(values[values.length - 1]),
    n: values.length,
  };
}

/** La bombola e la miscela che usa più spesso, per non far compilare il modulo a mano. */
export function usualSetup(dives: Dive[]): { tankL?: number; startBar?: number; mix?: GasMix } {
  const tanks = new Map<number, number>();
  const starts: number[] = [];
  const mixes = new Map<string, { count: number; mix: GasMix }>();
  for (const d of dives) {
    const c = d.cylinders[0];
    if (!c) continue;
    if (c.sizeL) tanks.set(c.sizeL, (tanks.get(c.sizeL) ?? 0) + 1);
    if (c.startBar) starts.push(c.startBar);
    if (c.mix) {
      const key = `${c.mix.o2}|${c.mix.he}`;
      const seen = mixes.get(key);
      if (seen) seen.count++;
      else mixes.set(key, { count: 1, mix: c.mix });
    }
  }
  const topTank = [...tanks].sort((a, b) => b[1] - a[1])[0]?.[0];
  const topMix = [...mixes.values()].sort((a, b) => b.count - a.count)[0]?.mix;
  const medianStart = starts.length
    ? [...starts].sort((a, b) => a - b)[Math.floor(starts.length / 2)]
    : undefined;
  return { tankL: topTank, startBar: medianStart, mix: topMix };
}

/**
 * Come sono andate davvero le immersioni a una profondità simile.
 *
 * È il pezzo che un pianificatore generico non può avere: accanto al piano, cosa è
 * successo le ultime volte. Se il piano dice "esci con 70 bar" e nelle sei
 * immersioni simili sei uscito con 45, il piano è ottimista — e lo si vede.
 */
export interface SimilarDives {
  /** Vero se il confronto tiene conto anche della durata, non solo della quota. */
  byDurationToo?: boolean;
  n: number;
  medianEndBar?: number;
  minEndBar?: number;
  /**
   * Mediana della durata TOTALE delle immersioni simili, minuti.
   *
   * Si chiamava `medianBottomMin` e restituiva questa stessa cosa: il nome
   * prometteva un tempo di fondo, e chi chiamava gli passava il tempo di fondo
   * del piano da confrontare con durate complete d'archivio.
   */
  medianDurationMin?: number;
  belowReserve: number;
}

export function similarDives(
  dives: Dive[],
  depthM: number,
  toleranceM = 5,
  /**
   * Durata pianificata, minuti. Quando c'è, il confronto tiene conto anche di
   * quella.
   *
   * PERCHÉ SERVE. «Alle immersioni a questa profondità sei uscito con 70 bar» era
   * un confronto sbagliato quando fra quelle immersioni ce n'era una da venti
   * minuti e una da cinquanta: la pressione d'uscita dipende dal tempo almeno
   * quanto dalla profondità, e mescolarle produceva una mediana che non
   * corrispondeva a nessuna immersione fatta davvero. La tolleranza è larga —
   * un terzo della durata — perché stringendola l'insieme si svuota, e un
   * confronto con due immersioni non è un confronto.
   *
   * DURATA TOTALE, non tempo di fondo: il filtro guarda `d.durationS`, cioè
   * l’immersione intera. Il Planner passava invece il tempo di fondo del piano,
   * e le due grandezze non sono confrontabili: con un piano da 25 minuti di
   * fondo (45 di durata) il pannello pescava le uscite corte da 22-28 minuti,
   * scriveva «uscita tipica 120 bar» accanto a un piano che ne prevede 70 e
   * spegneva l’avviso «ma di solito esci con…» proprio quando doveva parlare.
   */
  durationMin?: number,
): SimilarDives {
  const durationTolerance = durationMin !== undefined ? Math.max(10, durationMin / 3) : undefined;
  const closeEnough = (d: Dive) =>
    Math.abs(d.maxDepth - depthM) <= toleranceM && d.metrics?.endPressureBar !== undefined;
  const sameLength = (d: Dive) =>
    durationTolerance === undefined ||
    Math.abs(d.durationS / 60 - (durationMin as number)) <= durationTolerance;

  // Se filtrando anche sulla durata resta troppo poco, si torna al solo criterio
  // di profondità e lo si dichiara: meglio un confronto più largo, dichiarato,
  // che un confronto preciso su due immersioni.
  const strict = dives.filter((d) => closeEnough(d) && sameLength(d));
  const loose = dives.filter(closeEnough);
  const byDurationToo = strict.length >= 3;
  const pool = byDurationToo ? strict : loose;
  if (!pool.length) return { n: 0, belowReserve: 0, byDurationToo: false };
  const ends = pool.map((d) => d.metrics!.endPressureBar as number).sort((a, b) => a - b);
  const durations = pool.map((d) => d.durationS / 60).sort((a, b) => a - b);
  const mid = <T>(v: T[]) => v[Math.floor(v.length / 2)];
  return {
    n: pool.length,
    medianEndBar: Math.round(mid(ends)),
    minEndBar: Math.round(ends[0]),
    medianDurationMin: Math.round(mid(durations)),
    belowReserve: ends.filter((b) => b < LIMITS.minReserveBar).length,
    byDurationToo,
  };
}

/**
 * Quanto sta la profondità media sotto la massima, nelle immersioni vere.
 *
 * Serve a precompilare la profondità media del piano. Il valore da manuale non
 * esiste: dipende da come si immerge una persona — un profilo a scalini su un
 * relitto e una parete percorsa in discesa hanno rapporti diversi. La mediana
 * delle sue immersioni è l'unica risposta onesta, e `undefined` quando l'archivio
 * non ha abbastanza profili per dirlo.
 */
export function usualDepthRatio(dives: Dive[]): number | undefined {
  const ratios = dives
    .map((d) => (d.avgDepth !== undefined && d.maxDepth > 0 ? d.avgDepth / d.maxDepth : undefined))
    .filter((v): v is number => v !== undefined && v > 0.2 && v <= 1)
    .sort((a, b) => a - b);
  if (ratios.length < 5) return undefined;
  return Math.round(ratios[Math.floor(ratios.length / 2)] * 100) / 100;
}
