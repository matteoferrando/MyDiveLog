/**
 * Generatore di tabelle di decompressione.
 *
 * DOVE FINISCE IL PIANIFICATORE DI GAS E COMINCIA QUESTO. `gasPlan.ts` risponde a
 * «quanto gas mi serve»: dà per scontata la forma dell'immersione e calcola bar e
 * litri. Questo modulo risponde a «che forma deve avere l'immersione»: dove ti devi
 * fermare, per quanto, e a che minuto sei fuori. Sono due domande diverse e restano
 * due moduli, ma il piano di gas ora può chiedere a questo la sagoma invece di
 * ipotizzarla.
 *
 * COSA CALCOLA. Profilo multi-livello, più miscele con profondità di cambio, soste
 * arrotondate al passo scelto, gradient factor interpolati fra la prima sosta e la
 * superficie secondo Baker, consumo per singolo gas, CNS e OTU segmento per
 * segmento, EAD/END/PPO2 su ogni riga, controllo della controdiffusione isobarica
 * ai cambi gas, tempo prima di poter volare. Circuito chiuso con setpoint, con
 * bailout a circuito aperto.
 *
 * COSA NON FA, E NON LO FARÀ. Non ti dice se il piano è sicuro. Un generatore di
 * tabelle produce numeri per qualunque profilo, compresi quelli che non vanno fatti:
 * la profondità la decidi tu, la miscela la decidi tu, l'addestramento ce l'hai o
 * non ce l'hai. L'app segnala quello che sa vedere — PPO2 fuori limite, END
 * eccessiva, gas insufficiente, controdiffusione — e si ferma lì.
 *
 * PERCHÉ SI PUÒ CREDERE AI NUMERI. Perché il motore sotto è lo stesso che è stato
 * validato contro Shearwater su 38 immersioni reali: `buhlmann.ts`, con lo scarto
 * medio di 0.07 punti di GF99. Un pianificatore di decompressione scritto su un
 * motore non verificato è la cosa più pericolosa che si possa mettere in un'app.
 */

import type { GasMix, Salinity } from '../model';
import { ambientAta, ambientBar, ead, end as endOf, mod, ppn2At, ppo2At } from '../units';
import {
  ceilingM,
  desaturate,
  gf99,
  step,
  surfacedTissues,
  type TissueState,
} from './buhlmann';
import { exposureOfSegments, type OxygenExposure } from './oxygen';

// ---------------------------------------------------------------------------
// Ingressi
// ---------------------------------------------------------------------------

export type GasRole = 'bottom' | 'travel' | 'deco' | 'bailout';

export interface PlanGas {
  mix: GasMix;
  role: GasRole;
  /**
   * Profondità massima a cui si respira questo gas, metri.
   *
   * Se manca, la calcola l'app dalla MOD: 1.4 bar per i gas di fondo e di
   * transito, 1.6 per quelli di decompressione, che è la convenzione dei manuali.
   * Baltic te la fa scrivere sempre a mano; qui è precompilata e modificabile,
   * perché la MOD la sappiamo già calcolare e farla riscrivere è un invito a
   * sbagliarla.
   */
  switchDepthM?: number;
  /** Bombola, per tradurre i litri in bar. */
  tankL?: number;
  startBar?: number;
  /** Setpoint in bar: se presente, questo gas è il diluente di un circuito chiuso. */
  setpointBar?: number;
  label?: string;
}

export interface PlanLevel {
  depthM: number;
  /**
   * Minuti a questa quota.
   *
   * Sul PRIMO livello il tempo comprende la discesa, che è la convenzione di ogni
   * manuale e di ogni computer: «venti metri per trenta minuti» conta dal momento
   * in cui lasci la superficie. Sui livelli successivi il transito è in più,
   * perché lì il tempo dichiarato è tempo passato a quella quota.
   */
  minutes: number;
  /** Indice in `gases`. Se manca, si sceglie il gas migliore utilizzabile. */
  gasIndex?: number;
  /** Setpoint a questa quota, per il circuito chiuso. */
  setpointBar?: number;
}

export interface DecoSettings {
  gfLow: number;
  gfHigh: number;
  ascentRateMpm: number;
  descentRateMpm: number;
  /** Ultima sosta, metri: 3 in ricreativa, 6 in molte procedure tecniche. */
  lastStopM: number;
  /** Passo fra una sosta e l'altra, metri. */
  stopIntervalM: number;
  salinity: Salinity;
  surfacePressureBar: number;
  /** Limiti di PPO2: il primo in fase di lavoro, il secondo in decompressione. */
  maxPpo2Work: number;
  maxPpo2Deco: number;
  /** Consumo al fondo e in decompressione, L/min. Distinti come in Baltic. */
  rmvLpm: number;
  decoRmvLpm: number;
  /** Minuti spesi a cambiare gas, contati alla quota di cambio. */
  switchMin: number;
  /**
   * Sosta di sicurezza: profondità e minuti, oppure `null` per non farla.
   *
   * PERCHÉ È UN'OPZIONE E NON UNA REGOLA. Perché non è obbligatoria: nessun modello
   * decompressivo la impone, e su un'immersione bassa e lunga il piano che esce dal
   * modello arriva in superficie senza fermarsi. Ma tutte le didattiche la
   * insegnano, praticamente tutti la fanno, e in un piano che non la contempla i
   * tre minuti a cinque metri diventano tre minuti di gas non calcolato — poco, ma
   * calcolato male è peggio che poco.
   *
   * NON si aggiunge quando il modello impone già una sosta a quella quota o più
   * bassa: in decompressione l'ultima sosta fa già quel mestiere, e sommarne
   * un'altra vorrebbe dire contare due volte lo stesso tempo.
   */
  safetyStop: { depthM: number; minutes: number } | null;
  /**
   * Consumo metabolico di ossigeno su circuito chiuso, L/min, al fondo e in
   * decompressione.
   *
   * Non dipende dalla profondità, ed è tutta la differenza fra un rebreather e un
   * circuito aperto: il corpo consuma lo stesso ossigeno a sei metri e a sessanta,
   * mentre il polmone ventila gas compresso. Distinti fondo/deco come il consumo a
   * circuito aperto, perché lo sforzo è diverso.
   */
  morLpm: number;
  decoMorLpm: number;
  /** Volume del circuito, litri: è quello che va riempito di diluente scendendo. */
  loopVolumeL: number;
  /** Bombola dell'ossigeno del rebreather. */
  ccrO2TankL?: number;
  ccrO2StartBar?: number;
  /** Tessuti di partenza: per le ripetitive. */
  initial?: TissueState;
  /**
   * Quota da cui comincia la risalita, quando non si parte dalla superficie.
   *
   * Serve al bailout: «sono qui, con questi tessuti, e devo uscire». Senza, per
   * calcolare una risalita d'emergenza bisognerebbe far riscendere il modello
   * dalla superficie, che caricherebbe di nuovo i tessuti e darebbe una tabella
   * più lunga di quella vera.
   */
  startDepthM?: number;
  /** Si ferma alla fine del fondo, senza risalire: serve a fotografare i tessuti. */
  bottomOnly?: boolean;
  /**
   * Soste imposte dall'esterno, invece di calcolarle.
   *
   * PERCHÉ ESISTE. Perché il secondo modello — VPM-B — produce una tabella di
   * soste ma non sa niente di bombole, di CNS, di controdiffusione e di gas perso:
   * tutta quella parte sta qui. Con le soste imposte si può far percorrere a
   * questo motore la risalita decisa da un altro modello e ottenere il resto —
   * consumo per bombola, ossigeno, avvisi, contingenze — senza scrivere una
   * seconda volta lo stesso codice, e senza che i due modelli raccontino numeri
   * diversi sulle stesse grandezze.
   */
  imposedStops?: { depthM: number; minutes: number }[];
  /** Quota della cabina di un aereo pressurizzato, metri, per il tempo di volo. */
  flyingAltitudeM: number;
}

/**
 * Sotto questa profondità massima la sosta di sicurezza non si propone.
 *
 * Dieci metri è la soglia delle didattiche ricreative («any dive deeper than 10
 * m/30 ft»), non un numero scelto qui: è il punto sotto il quale la sosta non ha
 * un carico da cui proteggere.
 */
export const SAFETY_STOP_MIN_DEPTH_M = 10;

export const DEFAULT_DECO: DecoSettings = {
  gfLow: 0.4,
  gfHigh: 0.85,
  ascentRateMpm: 9,
  descentRateMpm: 18,
  lastStopM: 3,
  stopIntervalM: 3,
  salinity: 'salt',
  surfacePressureBar: 1.01325,
  maxPpo2Work: 1.4,
  maxPpo2Deco: 1.6,
  rmvLpm: 20,
  decoRmvLpm: 17,
  switchMin: 1,
  // Cinque metri per tre minuti: il valore che insegnano quasi tutte le didattiche
  // ricreative, ed è anche il valore predefinito del pianificatore di gas — i due
  // devono dire la stessa cosa.
  safetyStop: { depthM: 5, minutes: 3 },
  morLpm: 0.8,
  decoMorLpm: 0.5,
  loopVolumeL: 6,
  flyingAltitudeM: 2400,
};

// ---------------------------------------------------------------------------
// Uscite
// ---------------------------------------------------------------------------

export type SegmentKind = 'descent' | 'level' | 'ascent' | 'stop' | 'switch';

export interface DecoSegment {
  kind: SegmentKind;
  fromM: number;
  toM: number;
  minutes: number;
  /** Runtime a FINE segmento, minuti: è il numero che si scrive sulla lavagnetta. */
  runtimeMin: number;
  gasIndex: number;
  /** PPO2 alla quota più profonda del segmento, bar. */
  ppo2: number;
  /** Profondità equivalente in aria e narcotica, metri. */
  eadM: number;
  endM: number;
  /** CNS aggiunto da questo segmento e totale progressivo, percentuale. */
  cnsAdded: number;
  cnsTotal: number;
  /** Litri consumati in questo segmento. */
  litres: number;
  setpointBar?: number;
  /** Miscela realmente respirata: sul circuito chiuso non è il diluente. */
  breathed: GasMix;
  /**
   * I tessuti alla FINE di questo tratto.
   *
   * Costa trentadue numeri per riga e serve a una cosa sola, che però non si può
   * fare in nessun altro modo: ripartire da metà immersione. Il bailout da una
   * sosta, o da una quota qualunque della risalita, ha bisogno di sapere com'erano
   * i tessuti in quel momento — e ricalcolarli rifacendo mezzo piano darebbe un
   * risultato diverso da quello che si sta guardando.
   */
  tissues: TissueState;
}

export interface CcrUsage {
  /** Ossigeno metabolico consumato, litri. */
  o2Litres: number;
  /** Diluente usato per riempire il circuito scendendo, litri. */
  diluentLitres: number;
  o2Bar?: number;
  o2StartBar?: number;
  insufficientO2: boolean;
}

export interface GasUsage {
  gasIndex: number;
  mix: GasMix;
  role: GasRole;
  litres: number;
  /** Bar consumati, se la bombola è nota. */
  bar?: number;
  tankL?: number;
  startBar?: number;
  /** Vero se il gas a bordo non basta. */
  insufficient: boolean;
}

export interface IcdWarning {
  atDepthM: number;
  fromLabel: string;
  toLabel: string;
  /** Aumento di azoto e calo di elio in pressione parziale, bar. */
  n2RiseBar: number;
  heDropBar: number;
}

export interface DecoResult {
  segments: DecoSegment[];
  /**
   * Solo le soste, per la tabella da portare in acqua.
   *
   * `mandatory` distingue quelle imposte dal modello dalla sosta di sicurezza, che
   * è una scelta: confonderle significherebbe far credere che tre minuti a cinque
   * metri siano un obbligo decompressivo, o che un obbligo si possa saltare.
   */
  stops: { depthM: number; minutes: number; runtimeMin: number; gasIndex: number; mandatory: boolean }[];
  runtimeMin: number;
  /** Minuti dalla fine del fondo alla superficie. */
  ascentMin: number;
  /**
   * Runtime alla fine dell'ultimo livello, minuti.
   *
   * Serve a distinguere i tratti del fondo da quelli della risalita quando si ha
   * in mano solo `segments`. Dedurlo dal tipo dei tratti non funziona: fra due
   * livelli può esserci un cambio gas, e su un profilo multilivello la discesa
   * verso il secondo livello viene dopo il primo.
   */
  bottomRuntimeMin: number;
  /** Minuti passati in sosta obbligata. La sosta di sicurezza non conta qui. */
  decoMin: number;
  /** Minuti di sosta di sicurezza, se è stata fatta. */
  safetyStopMin: number;
  /** Vero se il piano resta in curva di sicurezza. */
  noDeco: boolean;
  /** Minuti ancora disponibili in curva al primo livello, da tessuti puliti. */
  ndlMin: number;
  firstStopM?: number;
  /** Quota in risalita da cui i tessuti cominciano a scaricare. */
  offgassingFromM?: number;
  gasUsage: GasUsage[];
  oxygen: OxygenExposure;
  gf99EndPct: number;
  finalTissues: TissueState;
  icd: IcdWarning[];
  /** Consumo del circuito chiuso, quando il piano ne usa uno. */
  ccr?: CcrUsage;
  /** I tessuti alla fine del fondo, prima di cominciare a risalire. */
  bottomTissues: TissueState;
  /** Ore prima di poter volare, dalla riemersione. */
  timeToFlyH?: number;
  warnings: { level: 'info' | 'warning' | 'critical'; text: string }[];
}

// ---------------------------------------------------------------------------
// Scelta del gas
// ---------------------------------------------------------------------------

/** La MOD di un gas secondo il suo ruolo, quando non è stata scritta a mano. */
export function switchDepthOf(gas: PlanGas, s: DecoSettings): number {
  if (gas.switchDepthM !== undefined) return gas.switchDepthM;
  const limit = gas.role === 'deco' ? s.maxPpo2Deco : s.maxPpo2Work;
  // Arrotondata al metro, non troncata. L'ossigeno puro ha la MOD a 5.8 m con il
  // limite di 1.6: troncando in giù verrebbe 5, e la sosta a sei metri — quella su
  // cui è costruita ogni procedura di decompressione ricreativa e tecnica —
  // resterebbe senza il gas che tutti ci respirano. Il mezzo metro di differenza
  // vale 1.61 bar invece di 1.60, che è la tolleranza con cui le tabelle sono
  // scritte.
  return Math.round(mod(gas.mix, limit, s.salinity));
}

/**
 * Il gas migliore utilizzabile a una quota: il più ricco di ossigeno fra quelli
 * respirabili lì.
 *
 * In risalita è la regola che fa scattare i cambi da sola, senza doverli scrivere
 * uno per uno — che è la differenza pratica fra questo pianificatore e uno in cui i
 * cambi si dichiarano a mano e ci si dimentica sempre l'ultimo.
 */
export function bestGasAt(depthM: number, gases: PlanGas[], s: DecoSettings): number {
  let best = -1;
  let bestO2 = -1;
  let bestVolume = -1;
  const available = (g: PlanGas) => (g.tankL ?? 0) * (g.startBar ?? 0);
  for (let i = 0; i < gases.length; i++) {
    if (gases[i].role === 'bailout') continue;
    if (switchDepthOf(gases[i], s) + 0.01 < depthM) continue;
    const o2 = gases[i].mix.o2;
    const vol = available(gases[i]);
    // A parità di miscela vince la bombola più capiente.
    //
    // Sembra un dettaglio e non lo è: nel bailout da un rebreather il diluente e
    // la bombola d'emergenza hanno la STESSA miscela, e senza questa regola il
    // piano sceglieva i tre litri del diluente invece degli undici del bailout,
    // dichiarando poi che servivano 227 bar. Il gas c'era: era la bombola
    // sbagliata.
    if (o2 > bestO2 || (o2 === bestO2 && vol > bestVolume)) {
      bestO2 = o2;
      bestVolume = vol;
      best = i;
    }
  }
  // Nessun gas è respirabile a questa quota. Non se ne inventa uno: si prende il
  // MENO peggio — la miscela più magra di ossigeno, e a parità la bombola più
  // capiente — e l'avviso sulla PPO2 lo dà il piano. Restituire il primo della
  // lista, come faceva prima, significava scegliere in base all'ordine in cui
  // erano stati scritti i gas.
  if (best < 0) {
    let fallback = 0;
    for (let i = 1; i < gases.length; i++) {
      const a = gases[i];
      const b = gases[fallback];
      if (a.mix.o2 < b.mix.o2 || (a.mix.o2 === b.mix.o2 && available(a) > available(b))) fallback = i;
    }
    return fallback;
  }
  return best;
}

/**
 * La miscela realmente respirata a una quota.
 *
 * Su circuito aperto è il gas della bombola. Su circuito chiuso no: il loop tiene
 * l'ossigeno al setpoint, quindi la frazione di O2 cambia con la profondità e il
 * resto è diluente in proporzione. È la ragione per cui un rebreather a 1.3 bar di
 * setpoint respira quasi ossigeno puro a sei metri.
 */
export function breathedAt(depthM: number, gas: PlanGas, setpointBar: number | undefined, s: DecoSettings): GasMix {
  const sp = setpointBar ?? gas.setpointBar;
  if (sp === undefined) return gas.mix;
  const amb = ambientBar(depthM, s.salinity, s.surfacePressureBar);
  const fo2 = Math.min(1, sp / amb);
  const rest = Math.max(0, 1 - fo2);
  const dilInert = Math.max(1e-9, 1 - gas.mix.o2);
  return {
    o2: fo2,
    he: rest * (gas.mix.he / dilInert),
  };
}

// ---------------------------------------------------------------------------
// Il piano
// ---------------------------------------------------------------------------

/**
 * Genera la tabella.
 *
 * Il cuore è il ciclo di risalita: a ogni passo si chiede al modello qual è la
 * quota minima tollerata, la si arrotonda in su al passo delle soste, e ci si ferma
 * lì un minuto alla volta finché il tetto non lascia salire. La sola sottigliezza è
 * il gradient factor, che non è costante: vale `gfLow` alla PRIMA sosta e `gfHigh`
 * in superficie, interpolato in mezzo — e la prima sosta si conosce solo dopo
 * averla calcolata, quindi si ancora al primo tetto incontrato e non si sposta più.
 */
export function planDeco(levels: PlanLevel[], gases: PlanGas[], settings: Partial<DecoSettings> = {}): DecoResult {
  const s: DecoSettings = { ...DEFAULT_DECO, ...settings };
  // Valori degeneri: un passo fra le soste a zero faceva `Invalid array length`,
  // e nel VPM produceva in silenzio una tabella senza soste. Si torna al
  // predefinito invece di calcolare qualcosa di indefinito.
  if (!(s.stopIntervalM > 0)) s.stopIntervalM = DEFAULT_DECO.stopIntervalM;
  if (!(s.lastStopM > 0)) s.lastStopM = DEFAULT_DECO.lastStopM;
  if (!(s.ascentRateMpm > 0)) s.ascentRateMpm = DEFAULT_DECO.ascentRateMpm;
  if (!(s.descentRateMpm > 0)) s.descentRateMpm = DEFAULT_DECO.descentRateMpm;
  const segments: DecoSegment[] = [];
  const warnings: DecoResult['warnings'] = [];
  const icd: IcdWarning[] = [];

  const usable = levels.filter((l) => l.depthM > 0 && l.minutes >= 0);
  if (!usable.length || !gases.length) {
    return emptyResult(s, warnings);
  }

  let state = s.initial ?? surfacedTissues(s.surfacePressureBar);
  let runtime = 0;
  let cnsTotal = 0;
  const litresByGas = new Map<number, number>();
  let ccrO2Litres = 0;
  let ccrDiluentLitres = 0;
  const exposure: { ppo2: number; minutes: number }[] = [];

  /** Un tratto: integra i tessuti, il gas, l'ossigeno, e scrive la riga. */
  const advance = (
    kind: SegmentKind,
    fromM: number,
    toM: number,
    minutes: number,
    gasIndex: number,
    setpointBar: number | undefined,
    rmv: number,
  ) => {
    if (!(minutes > 0)) return;
    const meanM = (fromM + toM) / 2;
    const deepM = Math.max(fromM, toM);
    const gas = gases[gasIndex];
    const breathed = breathedAt(meanM, gas, setpointBar, s);
    state = step(state, ambientBar(meanM, s.salinity, s.surfacePressureBar), breathed, minutes);

    const ppo2 = ppo2At(breathedAt(deepM, gas, setpointBar, s), deepM, s.salinity);
    const ppo2Mean = ppo2At(breathed, meanM, s.salinity);
    const cnsAdded = exposureOfSegments([{ ppo2: ppo2Mean, minutes }]).cnsPercent;
    cnsTotal += cnsAdded;
    exposure.push({ ppo2: ppo2Mean, minutes });

    // Circuito aperto e circuito chiuso consumano in due modi diversi, e la
    // differenza non è un dettaglio contabile: a circuito aperto il gas se ne va
    // con la ventilazione, quindi cresce con la profondità; a circuito chiuso se
    // ne va con il metabolismo, che della profondità non sa niente. È il motivo
    // per cui un rebreather permette immersioni lunghe e profonde con bombole
    // piccole.
    const closed = (setpointBar ?? gas.setpointBar) !== undefined;
    const litres = closed
      ? 0
      : rmv * minutes * ambientAta(meanM, s.salinity, s.surfacePressureBar);
    litresByGas.set(gasIndex, (litresByGas.get(gasIndex) ?? 0) + litres);
    if (closed) {
      ccrO2Litres += (kind === 'stop' || kind === 'switch' ? s.decoMorLpm : s.morLpm) * minutes;
      // Il diluente serve solo a riempire il circuito mentre si scende: risalendo
      // il gas in eccesso esce dalla valvola di sovrapressione e non si recupera,
      // ma nemmeno si consuma dalla bombola.
      const dAta =
        ambientAta(toM, s.salinity, s.surfacePressureBar) -
        ambientAta(fromM, s.salinity, s.surfacePressureBar);
      if (dAta > 0) ccrDiluentLitres += s.loopVolumeL * dAta;
    }

    runtime += minutes;
    segments.push({
      kind,
      fromM: round1(fromM),
      toM: round1(toM),
      minutes: round1(minutes),
      runtimeMin: round1(runtime),
      gasIndex,
      ppo2: round2(ppo2),
      eadM: round1(Math.max(0, ead(breathed, deepM, s.salinity))),
      endM: round1(Math.max(0, endOf(breathed, deepM, s.salinity))),
      cnsAdded: round1(cnsAdded),
      cnsTotal: round1(cnsTotal),
      litres: Math.round(litres),
      setpointBar,
      breathed,
      tissues: { n2: [...state.n2], he: [...state.he] },
    });
  };

  /** Cambio gas: registra la controdiffusione se il salto la produce. */
  const switchTo = (depthM: number, fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const before = breathedAt(depthM, gases[fromIndex], levelSetpoint, s);
    const after = breathedAt(depthM, gases[toIndex], levelSetpoint, s);
    const n2Rise = ppn2At(after, depthM, s.salinity) - ppn2At(before, depthM, s.salinity);
    const heDrop =
      (before.he - after.he) * ambientBar(depthM, s.salinity, s.surfacePressureBar);
    // Regola dei quinti: passare a un gas che aggiunge più di un quinto dell'elio
    // che toglie è il caso in cui la controdiffusione isobarica è documentata.
    if (heDrop > 0 && n2Rise > heDrop / 5) {
      icd.push({
        atDepthM: round1(depthM),
        fromLabel: label(gases[fromIndex]),
        toLabel: label(gases[toIndex]),
        n2RiseBar: round2(n2Rise),
        heDropBar: round2(heDrop),
      });
    }
    if (s.switchMin > 0) {
      advance('switch', depthM, depthM, s.switchMin, toIndex, levelSetpoint, s.decoRmvLpm);
    }
  };

  // --- discesa e livelli ---------------------------------------------------
  let levelSetpoint = usable[0].setpointBar;
  let currentDepth = s.startDepthM ?? 0;
  let gasIndex = usable[0].gasIndex ?? bestGasAt(usable[0].depthM, gases, s);

  for (let i = 0; i < usable.length; i++) {
    const level = usable[i];
    levelSetpoint = level.setpointBar;
    // Il transito si respira con il gas buono per il punto PIÙ PROFONDO del
    // tragitto, non con quello del livello di arrivo: salendo da 40 a 20 metri si
    // passa all'EAN50 quando si è arrivati, non prima — altrimenti il piano
    // prevede di respirarlo a quaranta metri, che è il modo in cui ci si fa male.
    const deepestOfTravel = Math.max(currentDepth, level.depthM);
    const travelGas = level.gasIndex ?? bestGasAt(deepestOfTravel, gases, s);
    if (i > 0 && travelGas !== gasIndex) switchTo(currentDepth, gasIndex, travelGas);
    gasIndex = travelGas;

    const travelMin = Math.abs(level.depthM - currentDepth) / (level.depthM > currentDepth ? s.descentRateMpm : s.ascentRateMpm);
    advance(
      level.depthM > currentDepth ? 'descent' : 'ascent',
      currentDepth,
      level.depthM,
      travelMin,
      gasIndex,
      levelSetpoint,
      s.rmvLpm,
    );
    currentDepth = level.depthM;

    const wanted = level.gasIndex ?? bestGasAt(level.depthM, gases, s);
    if (wanted !== gasIndex) {
      switchTo(currentDepth, gasIndex, wanted);
      gasIndex = wanted;
    }

    // Sul primo livello il tempo dichiarato include la discesa. Sugli altri no.
    const atDepth = i === 0 ? Math.max(0, level.minutes - travelMin) : level.minutes;
    advance('level', currentDepth, currentDepth, atDepth, gasIndex, levelSetpoint, s.rmvLpm);
  }

  const bottomRuntime = runtime;
  const deepestM = Math.max(...usable.map((l) => l.depthM));
  const bottomTissues = { n2: [...state.n2], he: [...state.he] };

  // --- risalita ------------------------------------------------------------
  // Ancora del gradient factor: la prima sosta che il modello IMPONE, calcolata
  // con `gfLow` prima di cominciare a salire. Non è necessariamente la prima sosta
  // che si fa davvero — durante la risalita i tessuti scaricano — e per questo la
  // sosta mostrata all'utente è un'altra cosa, presa dalla tabella vera.
  let anchorM: number | undefined;
  let firstStopImposed: number | undefined;
  let offgassingFromM: number | undefined;
  let decoMin = 0;
  let safetyStopMin = 0;
  // La sosta di sicurezza si fa una volta sola, e non si fa affatto se il modello
  // ha già imposto una sosta a quella quota o più bassa.
  const safety = s.safetyStop && s.safetyStop.minutes > 0 ? s.safetyStop : null;
  const deepestSoFar = Math.max(...usable.map((l) => l.depthM), s.startDepthM ?? 0);
  let safetyDone = false;
  const safetyStopSegments = new Set<number>();

  /**
   * Inserisce la sosta di sicurezza sull'ultimo tratto verso la superficie.
   *
   * Tre condizioni, e ognuna nasce da un errore visto girando il motore. Solo
   * sull'ultimo tratto (`to === 0`), perché inserendola a ogni passaggio per i
   * cinque metri finiva IN MEZZO alle soste obbligate, fra quella dei sei e quella
   * dei tre. Mai se il piano ha soste obbligate, quali che siano: la sosta di
   * sicurezza è una pratica della subacquea in curva, e su un'immersione
   * decompressiva l'ultima sosta fa già quel mestiere — appiccicarne una a cinque
   * metri sotto una sosta obbligata a sei è un gradino che nessuna procedura
   * prevede. E mai sotto i dieci metri di profondità massima, che è la soglia
   * sopra la quale le didattiche ricreative la raccomandano: un'immersione a sei
   * metri non ha niente da cui fermarsi.
   */
  const maybeSafetyStop = (from: number, to: number): number => {
    if (!safety || safetyDone || to > 0.01) return from;
    if (decoMin > 0) return from;
    if (deepestSoFar < SAFETY_STOP_MIN_DEPTH_M) return from;
    if (from <= safety.depthM) return from;
    const wanted = bestGasAt(from, gases, s);
    if (wanted !== gasIndex) {
      switchTo(from, gasIndex, wanted);
      gasIndex = wanted;
    }
    advance('ascent', from, safety.depthM, (from - safety.depthM) / s.ascentRateMpm, gasIndex, levelSetpoint, s.decoRmvLpm);
    const atStop = bestGasAt(safety.depthM, gases, s);
    if (atStop !== gasIndex) {
      switchTo(safety.depthM, gasIndex, atStop);
      gasIndex = atStop;
    }
    safetyStopSegments.add(segments.length);
    advance('stop', safety.depthM, safety.depthM, safety.minutes, gasIndex, levelSetpoint, s.decoRmvLpm);
    safetyStopMin += safety.minutes;
    safetyDone = true;
    return safety.depthM;
  };
  let guard = 0;

  const gfAt = (depthM: number) =>
    anchorM && anchorM > 0
      ? s.gfHigh + ((s.gfLow - s.gfHigh) * Math.min(depthM, anchorM)) / anchorM
      : s.gfHigh;

  /**
   * Le quote a cui ci si può fermare, dalla più bassa alla più profonda.
   *
   * La superficie è una di queste: «posso salire fino a zero» è la stessa domanda
   * di «posso salire fino a sei metri», e trattarla a parte è il modo in cui si
   * finisce per usare il gradient factor sbagliato sull'ultima sosta.
   */
  const candidates = (below: number): number[] => {
    const out = [0];
    for (let d = s.lastStopM; d < below - 0.01; d += s.stopIntervalM) out.push(d);
    return out;
  };

  // Risalita a soste imposte: si esegue la tabella di un altro modello invece di
  // calcolarla. Il tetto non si consulta — quella decisione l'ha già presa chi ha
  // prodotto le soste, e ricontrollarla qui significherebbe sovrapporre due modelli.
  if (!s.bottomOnly && s.imposedStops?.length) {
    for (const stop of [...s.imposedStops].sort((a, b) => b.depthM - a.depthM)) {
      if (stop.depthM >= currentDepth) continue;
      const wanted = bestGasAt(currentDepth, gases, s);
      if (wanted !== gasIndex) {
        switchTo(currentDepth, gasIndex, wanted);
        gasIndex = wanted;
      }
      currentDepth = maybeSafetyStop(currentDepth, stop.depthM);
      advance('ascent', currentDepth, stop.depthM, (currentDepth - stop.depthM) / s.ascentRateMpm, gasIndex, levelSetpoint, s.decoRmvLpm);
      currentDepth = stop.depthM;
      if (firstStopImposed === undefined) firstStopImposed = stop.depthM;
      const atStop = bestGasAt(currentDepth, gases, s);
      if (atStop !== gasIndex) {
        switchTo(currentDepth, gasIndex, atStop);
        gasIndex = atStop;
      }
      advance('stop', currentDepth, currentDepth, stop.minutes, gasIndex, levelSetpoint, s.decoRmvLpm);
      decoMin += stop.minutes;
    }
    if (currentDepth > 0) {
      currentDepth = maybeSafetyStop(currentDepth, 0);
      advance('ascent', currentDepth, 0, currentDepth / s.ascentRateMpm, gasIndex, levelSetpoint, s.decoRmvLpm);
      currentDepth = 0;
    }
  }

  while (!s.bottomOnly && !s.imposedStops?.length && currentDepth > 0 && guard++ < 2000) {
    // La prima sosta si decide con `gfLow`: è la sua definizione. Da lì in poi il
    // gradient factor si interpola verso `gfHigh`, che vale in superficie —
    // valutato SEMPRE alla quota di destinazione, non a quella di partenza.
    if (anchorM === undefined) {
      const deep = ceilingM(state, s.gfLow, s.salinity, s.surfacePressureBar);
      if (deep > 0) anchorM = Math.max(s.lastStopM, Math.ceil(deep / s.stopIntervalM) * s.stopIntervalM);
    }

    // La quota più bassa raggiungibile: la prima, salendo, che il tetto consente.
    let target = currentDepth;
    for (const d of candidates(currentDepth)) {
      if (ceilingM(state, gfAt(d), s.salinity, s.surfacePressureBar) <= d + 1e-6) {
        target = d;
        break;
      }
    }

    if (target >= currentDepth - 0.01) {
      // Il tetto non lascia salire: un minuto di sosta qui, sul gas migliore.
      const wanted = bestGasAt(currentDepth, gases, s);
      if (wanted !== gasIndex) {
        switchTo(currentDepth, gasIndex, wanted);
        gasIndex = wanted;
      }
      advance('stop', currentDepth, currentDepth, 1, gasIndex, levelSetpoint, s.decoRmvLpm);
      decoMin += 1;
      continue;
    }
    // Si può salire: fino alla prossima sosta, o fino in superficie.
    const next = target;
    const wanted = bestGasAt(currentDepth, gases, s);
    if (wanted !== gasIndex) {
      switchTo(currentDepth, gasIndex, wanted);
      gasIndex = wanted;
    }
    if (offgassingFromM === undefined) offgassingFromM = currentDepth;
    currentDepth = maybeSafetyStop(currentDepth, next);
    advance('ascent', currentDepth, next, (currentDepth - next) / s.ascentRateMpm, gasIndex, levelSetpoint, s.decoRmvLpm);
    currentDepth = next;
  }

  if (guard >= 2000) {
    // Non è mai successo sui piani provati, ma un ciclo che non converge deve
    // dirlo invece di restituire una tabella lunga duemila righe come se niente
    // fosse: succede se il gas rimasto non permette di uscire.
    warnings.push({
      level: 'critical',
      text: 'La risalita non converge: con questi gas e questi gradient factor il modello non arriva in superficie. Controlla le miscele.',
    });
  }

  // --- riepiloghi ----------------------------------------------------------
  const merged = mergeStops(segments, safetyStopSegments);
  const oxygen = exposureOfSegments(exposure);
  const surfaceGf = gf99(state, s.surfacePressureBar);

  const gasUsage: GasUsage[] = gases.map((g, i) => {
    const litres = Math.round(litresByGas.get(i) ?? 0);
    // `g.tankL === 0` è una bombola VUOTA, non una bombola sconosciuta: trattarla
    // come sconosciuta faceva dichiarare che il gas bastava. Solo `undefined`
    // significa «non lo so».
    const bar =
      g.tankL === undefined ? undefined : g.tankL > 0 ? Math.ceil(litres / g.tankL) : Infinity;
    return {
      gasIndex: i,
      mix: g.mix,
      role: g.role,
      litres,
      bar,
      tankL: g.tankL,
      startBar: g.startBar,
      insufficient: bar !== undefined && bar > (g.startBar ?? 0),
    };
  });

  // Il limite in curva parte dai tessuti CON CUI SI ENTRA, non da quelli puliti.
  //
  // Era il difetto più insidioso di questo modulo, perché l'interfaccia offre di
  // proposito la scelta dell'immersione precedente e dell'intervallo: su una
  // ripetitiva a venti minuti dalla prima, il riquadro «Curva al primo livello»
  // diceva 42 minuti dove i minuti veri erano 20, e lo stesso numero finiva
  // stampato sul foglio da portare in acqua. `noDecoLimitMin` risponde alla
  // domanda della tabella — quanto si può stare partendo puliti — che qui è
  // l'altra domanda.
  const firstDepth = usable[0].depthM;
  const firstMix = breathedAt(
    firstDepth,
    gases[usable[0].gasIndex ?? bestGasAt(firstDepth, gases, s)],
    usable[0].setpointBar,
    s,
  );
  const ndlMin = remainingNoDecoMin(
    s.initial ?? surfacedTissues(s.surfacePressureBar),
    firstDepth,
    firstMix,
    s,
  );

  const usesCcr = ccrO2Litres > 0 || ccrDiluentLitres > 0;
  const ccr: CcrUsage | undefined = usesCcr
    ? {
        o2Litres: Math.round(ccrO2Litres),
        diluentLitres: Math.round(ccrDiluentLitres),
        o2Bar: s.ccrO2TankL ? Math.ceil(ccrO2Litres / s.ccrO2TankL) : undefined,
        o2StartBar: s.ccrO2StartBar,
        insufficientO2:
          s.ccrO2TankL !== undefined &&
          s.ccrO2StartBar !== undefined &&
          Math.ceil(ccrO2Litres / s.ccrO2TankL) > s.ccrO2StartBar,
      }
    : undefined;

  // --- avvisi --------------------------------------------------------------
  // I due limiti si controllano sui tratti giusti, non sul massimo di tutto il
  // piano. Prima bastava che esistesse una sosta perché il controllo sul limite di
  // LAVORO smettesse di funzionare: un fondo a PPO2 1.47 passava silenzioso solo
  // perché più su c'era una deco. Sono due domande diverse — quanto ossigeno
  // respiri lavorando, e quanto ne respiri fermo a decomprimere — e vanno fatte
  // separatamente.
  //
  // «Lavoro» è tutto ciò che accade fino alla fine del fondo; da lì in poi si sta
  // decomprimendo, anche mentre si sale. Distinguere per TIPO di tratto invece che
  // per momento sbagliava sull'ultimo pezzo di risalita: sei metri respirando
  // ossigeno puro sono 1.61 bar, il piano li segnalava come PPO2 di lavoro fuori
  // limite, ed è la sosta finale di qualunque procedura di decompressione.
  const isDeco = (x: DecoSegment) => x.runtimeMin > bottomRuntime + 1e-9 || x.kind === 'stop' || x.kind === 'switch';
  const worstWork = Math.max(0, ...segments.filter((x) => !isDeco(x)).map((x) => x.ppo2));
  const worstDeco = Math.max(0, ...segments.filter(isDeco).map((x) => x.ppo2));
  // La tolleranza di cinque centesimi non è indulgenza: l'ossigeno puro alla sosta
  // dei sei metri sta a 1.61 bar, ed è la sosta su cui è costruita ogni procedura.
  // Gridare al limite superato proprio lì insegnerebbe a ignorare l'avviso.
  if (worstDeco > s.maxPpo2Deco + 0.05) {
    warnings.push({
      level: 'critical',
      text: `PPO2 fino a ${worstDeco.toFixed(2)} bar in decompressione, oltre il limite di ${s.maxPpo2Deco.toFixed(1)} che hai impostato.`,
    });
  }
  if (worstWork > s.maxPpo2Work + 0.001) {
    warnings.push({
      level: worstWork > s.maxPpo2Deco + 0.05 ? 'critical' : 'warning',
      text: `PPO2 fino a ${worstWork.toFixed(2)} bar in fase di lavoro, oltre ${s.maxPpo2Work.toFixed(1)}: a questa quota non hai una miscela respirabile.`,
    });
  }
  const worstEnd = Math.max(0, ...segments.map((x) => x.endM));
  if (worstEnd > 40) {
    warnings.push({
      level: 'warning',
      text: `Profondità narcotica equivalente fino a ${worstEnd.toFixed(0)} m: oltre i 40 m la didattica tecnica chiede l'elio.`,
    });
  }
  if (ccr?.insufficientO2) {
    warnings.push({
      level: 'critical',
      text: `L'ossigeno del rebreather non basta: servono ${ccr.o2Bar} bar su ${ccr.o2StartBar} disponibili.`,
    });
  }
  for (const u of gasUsage) {
    if (u.insufficient) {
      warnings.push({
        level: 'critical',
        text: Number.isFinite(u.bar)
          ? `Il gas ${label(gases[u.gasIndex])} non basta: servono ${u.bar} bar su ${u.startBar ?? 0} disponibili.`
          : `Il gas ${label(gases[u.gasIndex])} serve al piano (${u.litres} L) ma la bombola dichiarata è vuota.`,
      });
    }
  }
  for (const w of icd) {
    warnings.push({
      level: 'warning',
      text: `Controdiffusione a ${w.atDepthM} m passando da ${w.fromLabel} a ${w.toLabel}: l'azoto sale di ${w.n2RiseBar.toFixed(2)} bar mentre l'elio scende di ${w.heDropBar.toFixed(2)}. La regola dei quinti dice di non farlo.`,
    });
  }
  // Uscire oltre il cento per cento significa essere arrivati in superficie sopra
  // il valore M del modello: nessun avviso lo diceva, e con soste imposte
  // incoerenti il piano si dichiarava perfino «in curva». È l'unica cosa che il
  // motore può affermare senza sapere niente di chi la esegue.
  if (surfaceGf.percent > 100) {
    warnings.push({
      level: 'critical',
      text: `Questo piano arriva in superficie al ${surfaceGf.percent.toFixed(0)}% del valore M: oltre il cento per cento si emerge sopra il limite del modello, quali che siano i gradient factor impostati.`,
    });
  } else if (surfaceGf.percent > s.gfHigh * 100 + 1) {
    warnings.push({
      level: 'warning',
      text: `GF99 previsto all'uscita ${surfaceGf.percent.toFixed(0)}%, oltre il ${Math.round(s.gfHigh * 100)}% che hai impostato come GF alto.`,
    });
  }
  if (oxygen.cnsPercent >= 100) {
    warnings.push({ level: 'critical', text: `Orologio CNS al ${oxygen.cnsPercent.toFixed(0)}%: oltre il limite per singola esposizione.` });
  }
  // Sopra 1.6 bar la tabella NOAA non esiste più e il CNS viene contato come se
  // fossero 1.6: venti minuti a 3 bar davano lo stesso numero di venti minuti a
  // 1.6. Il dato `offTable` c'era e non lo leggeva nessuno. La soglia di mezzo
  // decimo evita che scatti sull'ossigeno ai sei metri, che sta a 1.61 per
  // procedura.
  if (worstDeco > 1.65 || worstWork > 1.65) {
    warnings.push({
      level: 'warning',
      text: `Sopra 1.6 bar di PPO2 le tabelle NOAA non arrivano: il CNS qui sopra è calcolato come se fossero 1.6 bar, quindi è una SOTTOSTIMA. Il valore vero non lo sa nessuno, ed è la ragione per cui quel limite esiste.`,
    });
  }
  if (deepestM > 40 && !segments.some((x) => x.kind === 'stop')) {
    warnings.push({ level: 'info', text: 'Oltre i 40 metri senza soste obbligate: verifica che il tuo computer, con i suoi gradient factor, sia d’accordo.' });
  }

  return {
    segments,
    stops: merged,
    runtimeMin: round1(runtime),
    ascentMin: round1(runtime - bottomRuntime),
    bottomRuntimeMin: round1(bottomRuntime),
    // Il totale è la somma delle righe stampate, non il conto interno: un foglio
    // in cui le righe non sommano al totale è un foglio che non si può usare.
    decoMin: merged.filter((x) => x.mandatory).reduce((a, x) => a + x.minutes, 0),
    safetyStopMin: merged.filter((x) => !x.mandatory).reduce((a, x) => a + x.minutes, 0),
    noDeco: decoMin === 0,
    ndlMin,
    firstStopM: merged.find((x) => x.mandatory)?.depthM ?? firstStopImposed,
    offgassingFromM: offgassingFromM !== undefined ? round1(offgassingFromM) : undefined,
    gasUsage,
    oxygen,
    gf99EndPct: surfaceGf.percent,
    finalTissues: state,
    icd,
    ccr,
    bottomTissues,
    timeToFlyH: timeToFly(state, s),
    warnings,
  };
}

/**
 * Ore di superficie prima che il modello permetta la quota di cabina.
 *
 * Cerca il primo momento in cui il tetto, calcolato alla pressione ridotta di un
 * aereo pressurizzato, scende a zero. Non sostituisce le 12/18/24 ore delle
 * didattiche — quelle sono regole di prudenza costruite su statistiche, non
 * sull'uscita di un modello — e la funzione lo dichiara restituendo un numero
 * che va confrontato con quelle, non usato al loro posto.
 */
export function timeToFly(state: TissueState, s: DecoSettings): number | undefined {
  const cabinBar = barometric(s.flyingAltitudeM);
  for (let h = 0; h <= 48; h += 0.5) {
    const after = desaturate(state, h * 60, s.surfacePressureBar);
    if (ceilingM(after, s.gfHigh, s.salinity, cabinBar) <= 0) return h;
  }
  return undefined;
}

/**
 * Con che tessuti si arriva in quota.
 *
 * Salire a milleduecento metri è una decompressione: la pressione di superficie
 * cala e i tessuti, che erano in equilibrio con il livello del mare, si trovano di
 * colpo sovrasaturi. Ci vogliono ore perché tornino a posto, e chi si immerge
 * appena arrivato parte con dell'azoto in più — esattamente come in una ripetitiva,
 * e per la stessa ragione.
 *
 * `hoursThere` è il tempo passato alla quota prima di entrare in acqua. Con un
 * valore alto la funzione restituisce i tessuti acclimatati, che è il caso di chi
 * al lago ci abita.
 */
export function tissuesAtAltitude(altitudeM: number, hoursThere: number): TissueState {
  const atSea = surfacedTissues(barometric(0));
  if (!(altitudeM > 0)) return atSea;
  return desaturate(atSea, Math.max(0, hoursThere) * 60, barometric(altitudeM));
}

/**
 * I tessuti dopo un intervallo di superficie, per pianificare una ripetitiva.
 *
 * È la stessa funzione che incatena l'archivio, esposta qui con un nome che dice
 * a cosa serve nel pianificatore: prendi i tessuti con cui sei uscito dalla prima
 * immersione, dichiara quanto stai fuori, e ottieni quelli con cui rientri.
 */
export function afterSurfaceInterval(
  state: TissueState,
  surfaceMinutes: number,
  surfacePressureBar = 1.01325,
): TissueState {
  return desaturate(state, Math.max(0, surfaceMinutes), surfacePressureBar);
}

/** Pressione atmosferica a una quota, bar: formula barometrica standard. */
export function barometric(altitudeM: number): number {
  return 1.01325 * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);
}

/**
 * Minuti ancora disponibili in curva a una quota, PARTENDO DA QUESTI TESSUTI.
 *
 * Bisezione come in `noDecoLimitMin`, perché la funzione è monotona; la differenza
 * è tutta nel punto di partenza. Tagliato a 99 minuti come fanno i computer: oltre
 * il centinaio il numero smette di essere un limite e diventa «tanto».
 */
function remainingNoDecoMin(
  state: TissueState,
  depthM: number,
  mix: GasMix,
  s: DecoSettings,
  maxMin = 99,
): number {
  const amb = ambientBar(depthM, s.salinity, s.surfacePressureBar);
  const fits = (minutes: number) =>
    ceilingM(step(state, amb, mix, minutes), s.gfHigh, s.salinity, s.surfacePressureBar) <= 0;
  if (!fits(0)) return 0;
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

/** Le soste consecutive alla stessa quota diventano una riga sola. */
function mergeStops(segments: DecoSegment[], safetyIndexes: Set<number>) {
  const out: DecoResult['stops'] = [];
  segments.forEach((seg, i) => {
    if (seg.kind !== 'stop') return;
    const mandatory = !safetyIndexes.has(i);
    const last = out[out.length - 1];
    if (
      last &&
      Math.abs(last.depthM - seg.fromM) < 0.01 &&
      last.gasIndex === seg.gasIndex &&
      last.mandatory === mandatory
    ) {
      last.minutes += seg.minutes;
      last.runtimeMin = seg.runtimeMin;
    } else {
      out.push({
        depthM: seg.fromM,
        minutes: seg.minutes,
        runtimeMin: seg.runtimeMin,
        gasIndex: seg.gasIndex,
        mandatory,
      });
    }
  });
  // Arrotondare per DIFETTO ogni riga faceva stampare «16 minuti di soste» sopra
  // «di cui 17 di decompressione», sullo stesso foglio. Le soste si arrotondano
  // per eccesso — un minuto in più a una sosta non ha mai fatto male a nessuno,
  // uno in meno sì — e il totale si ricalcola dalle righe arrotondate, così quello
  // che si legge in fondo è la somma di quello che si legge sopra.
  return out.map((x) => ({ ...x, minutes: Math.ceil(x.minutes), runtimeMin: Math.round(x.runtimeMin) }));
}

function emptyResult(s: DecoSettings, warnings: DecoResult['warnings']): DecoResult {
  return {
    bottomTissues: surfacedTissues(s.surfacePressureBar),
    segments: [],
    stops: [],
    runtimeMin: 0,
    ascentMin: 0,
    bottomRuntimeMin: 0,
    decoMin: 0,
    safetyStopMin: 0,
    noDeco: true,
    ndlMin: 0,
    gasUsage: [],
    oxygen: exposureOfSegments([]),
    gf99EndPct: 0,
    finalTissues: surfacedTissues(s.surfacePressureBar),
    icd: [],
    warnings,
  };
}

export function label(gas: PlanGas): string {
  if (gas.label) return gas.label;
  const o2 = Math.round(gas.mix.o2 * 100);
  const he = Math.round(gas.mix.he * 100);
  if (he > 0) return `Tx${o2}/${he}`;
  if (o2 === 21) return 'Aria';
  if (o2 === 100) return 'O₂';
  return `EAN${o2}`;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Il bailout: uscire a circuito aperto da dove sei.
 *
 * PERCHÉ NON È UNA CONTINGENZA COME LE ALTRE. «Più profondo» e «più lungo» sono
 * variazioni del piano; il bailout è l'abbandono del piano. Il circuito si chiude,
 * si respira dalla bombola, e da quel momento il gas conta come su un qualunque
 * circuito aperto — cioè moltiplicato per la pressione ambiente, che è la ragione
 * per cui un bailout profondo consuma tanto. La domanda che conta non è quanto dura
 * la risalita: è se il gas che ti porti basta a farla.
 *
 * Si riparte dai tessuti alla FINE del fondo, che è il momento peggiore in cui può
 * succedere, e dalla quota più profonda.
 */
export function bailoutPlan(
  levels: PlanLevel[],
  gases: PlanGas[],
  settings: Partial<DecoSettings> = {},
  /**
   * Quota da cui si abbandona il circuito, metri. Assente: la fine del fondo.
   *
   * Perché si possa scegliere: il bailout dal fondo è il caso peggiore, ma non è
   * l'unico che vale la pena guardare. Se il gas basta dal fondo va bene tutto;
   * se NON basta, la domanda diventa «da dove in su ce la faccio», e quella si
   * risponde solo provando quote diverse.
   */
  fromDepthM?: number,
): DecoResult | undefined {
  const usable = levels.filter((l) => l.depthM > 0);
  if (!usable.length) return undefined;

  const deepest = Math.max(...usable.map((l) => l.depthM));
  const start = fromDepthM !== undefined ? Math.min(fromDepthM, deepest) : deepest;

  // I tessuti al momento del guasto. Dal fondo basta fermare il piano lì; da una
  // quota della risalita si ripercorre il piano vero e si prende lo stato del
  // tratto che arriva a quella quota — non un piano rifatto, che darebbe numeri
  // diversi da quelli che l'utente sta guardando.
  const bottom = planDeco(levels, gases, { ...settings, bottomOnly: true });
  let atFailure = bottom.bottomTissues;
  if (fromDepthM !== undefined && start < deepest - 0.01) {
    const full = planDeco(levels, gases, settings);
    // IL PRIMO tratto che tocca quella quota non è quello giusto.
    //
    // Su un profilo multilivello — venti metri, poi sessanta — il primo segmento
    // che arriva a trenta metri è la DISCESA iniziale, con i tessuti ancora quasi
    // puliti: il bailout rispondeva «zero obbligo, undici bar» dove servono
    // cinquanta minuti e centoquaranta bar. Il momento del guasto è in RISALITA,
    // cioè dopo la fine del fondo: si cerca lì, e fra i candidati si prende il
    // primo — che risalendo è anche il più profondo, quindi il più oneroso.
    const ascent = full.segments.filter((seg) => seg.runtimeMin > full.bottomRuntimeMin + 1e-9);
    const reached = ascent.filter((seg) => seg.toM <= start + 0.01);
    if (reached.length) atFailure = reached[0].tissues;
    else if (ascent.length) atFailure = ascent[0].tissues;
  }
  // Chi porta una bombola di bailout non respira il diluente.
  //
  // Sembra una sottigliezza ed è la differenza fra un piano eseguibile e uno che
  // non lo è: il diluente sta in tre litri, serve a riempire il circuito, e a
  // circuito aperto dura pochi minuti. La regola «il gas più ricco respirabile
  // qui» da sola lo sceglieva — è più ricco della miscela di bailout, che è
  // apposta più magra per andare più giù. Quando una bombola di bailout c'è, il
  // diluente esce dall'elenco; quando non c'è, resta, perché allora è tutto quello
  // che hai e il piano deve dirti che non basta invece di non calcolare niente.
  //
  // Il diluente si riconosce dal fatto che l'immersione è a circuito chiuso — il
  // setpoint sta sui livelli, non sul gas — e che quel gas fa da gas di fondo.
  const closedCircuit = usable.some((l) => l.setpointBar !== undefined) || gases.some((g) => g.setpointBar !== undefined);
  const hasBailout = gases.some((g) => g.role === 'bailout');
  const openCircuit: PlanGas[] = gases
    .filter((g) => !(closedCircuit && hasBailout && (g.role === 'bottom' || g.setpointBar !== undefined)))
    .map((g) => ({
      ...g,
      role: g.role === 'bailout' ? 'bottom' : g.role,
      setpointBar: undefined,
    }));

  return planDeco([{ depthM: start, minutes: 0 }], openCircuit, {
    ...settings,
    initial: atFailure,
    startDepthM: start,
  });
}

// ---------------------------------------------------------------------------
// Una serie di immersioni, non una sola
// ---------------------------------------------------------------------------

export interface SeriesDive {
  levels: PlanLevel[];
  gases: PlanGas[];
  /** Minuti di superficie PRIMA di questa immersione. Ignorato sulla prima. */
  surfaceIntervalMin: number;
}

/**
 * Pianifica una giornata, non un'immersione.
 *
 * PERCHÉ SERVE. Perché la seconda immersione della giornata si pianifica prima di
 * fare la prima, e fino a ora l'unico modo di tenerne conto era ripartire dai
 * tessuti di un'immersione già in archivio — cioè di una cosa già successa. Chi
 * organizza una giornata di due tuffi ha bisogno di sapere adesso quanto costerà
 * il secondo, e come cambia allungando la pausa.
 *
 * Ogni immersione riceve i tessuti di quella prima, desaturati per l'intervallo
 * dichiarato, e li passa alla successiva. È la stessa catena che l'app percorre
 * sull'archivio, applicata a immersioni che non esistono ancora.
 */
export function planSeries(
  series: SeriesDive[],
  settings: Partial<DecoSettings> = {},
): DecoResult[] {
  const s: DecoSettings = { ...DEFAULT_DECO, ...settings };
  const out: DecoResult[] = [];
  let tissues = s.initial;

  for (let i = 0; i < series.length; i++) {
    const d = series[i];
    const initial =
      i === 0
        ? tissues
        : afterSurfaceInterval(tissues ?? surfacedTissues(s.surfacePressureBar), d.surfaceIntervalMin, s.surfacePressureBar);
    const result = planDeco(d.levels, d.gases, { ...settings, initial });
    out.push(result);
    tissues = result.finalTissues;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contingenze: cosa succede se
// ---------------------------------------------------------------------------

export interface DecoContingency {
  id: string;
  label: string;
  description: string;
  result: DecoResult;
  /** Minuti di runtime in più rispetto al piano, e soste in più. */
  extraRuntimeMin: number;
  extraDecoMin: number;
  /** Vero se questa contingenza non è eseguibile con il gas a bordo. */
  breaks: boolean;
}

/**
 * Gli scenari che un pianificatore tecnico deve avere accanto al piano.
 *
 * Più profondo, più lungo, tutti e due, e — quello che conta davvero — con un gas
 * perso. Sono le quattro cose che succedono, e il momento di sapere quanto costano
 * è prima di scendere, non mentre accadono.
 */
export function decoContingencies(
  levels: PlanLevel[],
  gases: PlanGas[],
  settings: Partial<DecoSettings> = {},
): DecoContingency[] {
  const base = planDeco(levels, gases, settings);
  const out: DecoContingency[] = [];

  const add = (id: string, lab: string, description: string, result: DecoResult) => {
    out.push({
      id,
      label: lab,
      description,
      result,
      extraRuntimeMin: Math.round(result.runtimeMin - base.runtimeMin),
      extraDecoMin: Math.round(result.decoMin - base.decoMin),
      breaks: result.gasUsage.some((u) => u.insufficient),
    });
  };

  const deeper = levels.map((l, i) => (i === 0 ? { ...l, depthM: l.depthM + 3 } : l));
  const longer = levels.map((l, i) => (i === 0 ? { ...l, minutes: l.minutes + 5 } : l));
  const both = deeper.map((l, i) => (i === 0 ? { ...l, minutes: l.minutes + 5 } : l));

  add('deeper', '3 metri più giù', 'Sceso più del previsto sul primo livello.', planDeco(deeper, gases, settings));
  add('longer', '5 minuti in più', 'Rimasto al fondo più del previsto.', planDeco(longer, gases, settings));
  add('both', 'Più giù e più a lungo', 'Le due cose insieme: è il caso che costa di più.', planDeco(both, gases, settings));

  // Gas perso: uno scenario per ciascun gas di decompressione, perché perdere
  // l'ossigeno e perdere l'EAN50 non costano la stessa cosa.
  gases.forEach((g, i) => {
    if (g.role !== 'deco') return;
    const without = gases.filter((_, k) => k !== i);
    if (!without.length) return;
    // Togliere un gas dall'elenco SPOSTA gli indici di quelli dopo.
    //
    // I livelli che dichiarano il gas a mano continuavano a puntare al numero
    // vecchio: lo scenario «ho perso l'EAN50» veniva calcolato su un'immersione a
    // sessanta metri respirando ossigeno puro, e con tre gas soli il programma
    // cadeva con un `TypeError`. Qui gli indici si rimappano, e un livello che
    // puntava proprio al gas perduto torna alla scelta automatica.
    const remap = (index: number | undefined): number | undefined => {
      if (index === undefined) return undefined;
      if (index === i) return undefined;
      return index > i ? index - 1 : index;
    };
    add(
      `lost-${i}`,
      `Perso ${label(g)}`,
      'La decompressione rifatta con i gas che restano.',
      planDeco(
        levels.map((l) => ({ ...l, gasIndex: remap(l.gasIndex) })),
        without,
        settings,
      ),
    );
  });

  return out;
}

// ---------------------------------------------------------------------------
// La tabella da portare in acqua
// ---------------------------------------------------------------------------

/**
 * Il piano in testo semplice, da copiare o stampare.
 *
 * PERCHÉ IN TESTO E NON UN PDF. Perché questa roba finisce su una lavagnetta di
 * plastica scritta a matita, o su un foglio in tasca alla muta, o in un messaggio
 * al compagno la sera prima. Il formato che serve è quello che si incolla ovunque
 * e si legge senza aprire niente. Un PDF impaginato sarebbe più bello e meno utile.
 *
 * L'ordine è quello in cui le cose servono: prima le soste, che sono la ragione per
 * cui il foglio esiste; poi il gas, che si controlla prima di entrare; poi il
 * resto. Gli avvisi stanno in fondo e non in cima di proposito — chi stampa questo
 * foglio li ha già letti sullo schermo, e in acqua servono i numeri.
 */
export function decoTableText(
  result: DecoResult,
  levels: PlanLevel[],
  gases: PlanGas[],
  settings: Partial<DecoSettings> = {},
): string {
  const s: DecoSettings = { ...DEFAULT_DECO, ...settings };
  const L: string[] = [];
  const pad = (v: string | number, n: number) => String(v).padStart(n);

  const profilo = levels
    .filter((l) => l.depthM > 0)
    .map((l) => `${l.depthM} m × ${l.minutes} min`)
    .join(' → ');
  L.push(`PIANO — ${profilo}`);
  L.push(
    `GF ${Math.round(s.gfLow * 100)}/${Math.round(s.gfHigh * 100)} · risalita ${s.ascentRateMpm} m/min · ` +
      `ultima sosta ${s.lastStopM} m · ${s.salinity === 'salt' ? 'mare' : 'acqua dolce'}` +
      (s.surfacePressureBar < 1.0 ? ` · quota (${s.surfacePressureBar.toFixed(3)} bar)` : ''),
  );
  L.push('');

  // Il limite in curva si stampa SEMPRE quando non ci sono obblighi, anche se una
  // sosta di sicurezza c'è: prima bastava la sosta facoltativa a far sparire dal
  // foglio l'unico numero che dice quanto margine hai.
  if (!result.stops.some((x) => x.mandatory)) {
    L.push(`Nessuna sosta obbligata: il piano resta in curva (limite ${result.ndlMin.toFixed(0)} min).`);
    L.push('');
  }
  if (result.stops.length) {
    L.push('SOSTE');
    L.push('quota   min   runtime  gas');
    for (const st of result.stops) {
      L.push(
        `${pad(`${st.depthM} m`, 5)}  ${pad(st.minutes, 4)}  ${pad(st.runtimeMin, 7)}  ${label(gases[st.gasIndex])}` +
          (st.mandatory ? '' : '   (sicurezza, non obbligatoria)'),
      );
    }
  } else {
    L.push('SOSTE: nessuna.');
  }
  L.push('');
  L.push(
    `Runtime totale ${result.runtimeMin.toFixed(0)} min, di cui ${result.decoMin} di decompressione` +
      (result.safetyStopMin > 0 ? ` e ${result.safetyStopMin} di sosta di sicurezza.` : '.'),
  );
  L.push('');

  L.push('GAS');
  for (const u of result.gasUsage.filter((x) => x.litres > 0)) {
    const bar = u.bar !== undefined ? `${u.bar} bar` : `${u.litres} L`;
    const su = u.startBar !== undefined ? ` su ${u.startBar}` : '';
    L.push(`  ${label(gases[u.gasIndex]).padEnd(10)} ${bar}${su}${u.insufficient ? '   ⚠ NON BASTA' : ''}`);
  }
  if (result.ccr) {
    L.push(`  ${'O₂ metab.'.padEnd(10)} ${result.ccr.o2Litres} L${result.ccr.o2Bar ? ` (${result.ccr.o2Bar} bar)` : ''}`);
    L.push(`  ${'diluente'.padEnd(10)} ${result.ccr.diluentLitres} L`);
  }
  L.push('');

  L.push(
    `CNS ${result.oxygen.cnsPercent.toFixed(0)}% · OTU ${result.oxygen.otu.toFixed(0)} · ` +
      `GF99 previsto ${result.gf99EndPct.toFixed(0)}%` +
      (result.timeToFlyH !== undefined ? ` · volo dopo ${result.timeToFlyH} h (modello)` : ''),
  );

  if (result.warnings.length) {
    L.push('');
    L.push('AVVISI');
    for (const w of result.warnings) L.push(`  [${w.level === 'critical' ? '!!' : w.level === 'warning' ? '! ' : '  '}] ${w.text}`);
  }

  L.push('');
  L.push('Generato da MyDiveLog. Un pianificatore produce numeri per qualunque profilo,');
  L.push('compresi quelli che non vanno fatti: l’addestramento ce l’hai o non ce l’hai.');
  return L.join('\n');
}
