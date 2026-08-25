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
import { ceilingM, desaturate, gf99, step, surfacedTissues, type TissueState } from './buhlmann';
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
  return Math.round(mod(gas.mix, limit, s.salinity, s.surfacePressureBar));
}

/**
 * Il gas migliore utilizzabile a una quota: il più ricco di ossigeno fra quelli
 * respirabili lì.
 *
 * In risalita è la regola che fa scattare i cambi da sola, senza doverli scrivere
 * uno per uno — che è la differenza pratica fra questo pianificatore e uno in cui i
 * cambi si dichiarano a mano e ci si dimentica sempre l'ultimo.
 */
export function bestGasAt(
  depthM: number,
  gases: PlanGas[],
  s: DecoSettings,
  /**
   * Vero quando il tratto si respira sul CIRCUITO CHIUSO.
   *
   * IL DIFETTO CHE CHIUDE. Senza questo argomento, su un piano con setpoint la
   * scelta del gas era la stessa del circuito aperto: in risalita prendeva lo
   * stage più ricco d'ossigeno — un EAN50, un O₂ puro — e il motore lo trattava
   * comunque come DILUENTE, perché il circuito chiuso lo decide il setpoint del
   * livello e non il gas. Misurato su 60 m × 25 min con setpoint 1.3: la
   * decompressione scendeva da 40 a 33 minuti, e quelle bombole registravano
   * **zero litri** consumati. Cioè un piano che guadagna sette minuti restando
   * sul circuito e senza aprire lo stage: ineseguibile, e più corto del vero.
   * Bastava spuntare «circuito chiuso» con i gas predefiniti della pagina.
   *
   * Su un rebreather la decompressione si fa sul loop col diluente: lo stage di
   * deco si respira solo in bailout, che è un altro piano. Quindi qui i gas di
   * ruolo `deco` sono esclusi esattamente come quelli di ruolo `bailout`.
   */
  chiuso = false,
): number {
  let best = -1;
  let bestO2 = -1;
  let bestVolume = -1;
  const available = (g: PlanGas) => (g.tankL ?? 0) * (g.startBar ?? 0);
  const escluso = (g: PlanGas) => g.role === 'bailout' || (chiuso && g.role === 'deco');
  for (let i = 0; i < gases.length; i++) {
    if (escluso(gases[i])) continue;
    // Un gas di loop non ha MOD nel senso del circuito aperto: la pressione
    // parziale la fa il setpoint, non la frazione della bombola. Escluderlo dalla
    // sua MOD teorica mandava il piano a cercarne un altro proprio quando il
    // diluente andava benissimo.
    const loopGas = gases[i].setpointBar !== undefined;
    if (!loopGas && switchDepthOf(gases[i], s) + 0.01 < depthM) continue;
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
    // Il ripiego deve rispettare la stessa esclusione del ciclo sopra: la bombola
    // di BAILOUT non è collegata al circuito, per definizione. Senza questo
    // controllo, appena il diluente superava la propria MOD teorica il piano
    // cominciava a respirare il bailout dentro il loop — e siccome era un
    // trimix, l'elio ACCORCIAVA la decompressione: 51 m davano 148 minuti e
    // 54 m ne davano 115. Tre metri più giù, mezz'ora di deco in meno, su un
    // piano ineseguibile perché quella bombola sta appesa di lato.
    const eligible: number[] = [];
    for (let i = 0; i < gases.length; i++) if (!escluso(gases[i])) eligible.push(i);
    const pool = eligible.length ? eligible : gases.map((_, i) => i);
    let fallback = pool[0];
    for (const i of pool) {
      const a = gases[i];
      const b = gases[fallback];
      if (a.mix.o2 < b.mix.o2 || (a.mix.o2 === b.mix.o2 && available(a) > available(b))) fallback = i;
    }
    return fallback;
  }
  return best;
}

/**
 * La quota di cambio più PROFONDA che si incontra salendo da `da` a `a`.
 *
 * Serve a spezzare la risalita dove il gas cambia, invece di scavalcare uno
 * stage perché la prossima sosta è più in alto della sua MOD. Restituisce
 * `undefined` quando non c'è niente per strada.
 *
 * I gas di loop non hanno una quota di cambio in questo senso — la pressione
 * parziale la fa il setpoint — e i gas esclusi dal circuito in corso non
 * contano: sarebbe una fermata per un cambio che non avverrà.
 */
export function quotaDiCambioTra(
  da: number,
  a: number,
  gases: PlanGas[],
  s: DecoSettings,
  chiuso = false,
): number | undefined {
  let best: number | undefined;
  for (const g of gases) {
    if (g.role === 'bailout' || (chiuso && g.role === 'deco')) continue;
    if (g.setpointBar !== undefined) continue;
    const d = switchDepthOf(g, s);
    if (d < da - 0.01 && d > a + 0.01 && (best === undefined || d > best)) best = d;
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
export function breathedAt(
  depthM: number,
  gas: PlanGas,
  setpointBar: number | undefined,
  s: DecoSettings,
): GasMix {
  const sp = setpointBar ?? gas.setpointBar;
  if (sp === undefined) return gas.mix;
  const amb = ambientBar(depthM, s.salinity, s.surfacePressureBar);
  const fo2 = Math.min(1, sp / amb);
  const rest = Math.max(0, 1 - fo2);
  // Un diluente senza inerte non diluisce: il loop è ossigeno puro, e il resto
  // non è azoto. Con `dilInert` a 1e-9 la frazione di elio veniva zero e tutto
  // il resto finiva in azoto — cioè il modello caricava azoto che nel circuito
  // non c'è. Non dovrebbe più capitare da quando i gas di deco non entrano nel
  // loop, ma la formula non deve dipendere da chi la chiama.
  const dilInert = 1 - gas.mix.o2;
  if (dilInert <= 1e-9) return { o2: 1, he: 0 };
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
/**
 * Riporta un'impostazione numerica dentro il possibile.
 *
 * Serve perché ogni campo di questo modulo può arrivare da una casella di testo,
 * e `parseFloat('')` è `NaN`. Un `NaN` non fa saltare niente: si propaga in
 * silenzio dentro le pressioni parziali, esce dai tessuti come `NaN`, e il
 * confronto `tetto > 0` con un `NaN` è falso — cioè il piano dichiara «in curva»
 * un'immersione decompressiva. È il modo peggiore in cui questo programma possa
 * sbagliare, e costa quattro righe evitarlo.
 *
 * La scelta è tornare al PREDEFINITO e non al valore più vicino: un campo vuoto
 * significa «non l'ho impostato», e il predefinito è la risposta giusta a quella
 * domanda. Un valore fuori scala invece viene tagliato, perché lì l'intenzione
 * c'è ed è solo sbagliata di misura.
 */
export function sane(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Come `sane`, ma per le grandezze in cui zero e i negativi non sono «piccoli»:
 * sono «non impostato».
 *
 * Un passo fra le soste di zero metri non è una tabella fittissima, è l'assenza
 * di una tabella; una velocità di risalita di zero non è una risalita lenta, è
 * una risalita che non finisce. Tagliarli al minimo darebbe un risultato
 * formalmente valido e praticamente assurdo — con lo zero tagliato a mezzo metro
 * il VPM produceva 43 soste — quindi si torna al predefinito, che è la risposta
 * giusta alla domanda «non l'ho impostato».
 */
export function sanePositive(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Le impostazioni ripulite, in un posto solo.
 *
 * Prima le difese erano quattro — passo delle soste, ultima sosta, velocità — e
 * coprivano i campi che avevano già fatto danni. I test randomizzati hanno
 * mostrato che gli altri dodici erano scoperti: `rmvLpm` negativo produceva un
 * consumo di −184 litri presentato come controllo superato, `switchMin` infinito
 * un runtime infinito dichiarato in curva, `surfacePressureBar` NaN un piano
 * decompressivo dichiarato in curva. Vale per tutti la stessa regola.
 */
function saneSettings(s: DecoSettings): DecoSettings {
  return {
    ...s,
    // Sotto il metro il passo non è una tabella fitta, è un ciclo che non
    // finisce: a 1e-9 il motore costruiva array da miliardi di elementi.
    stopIntervalM: sanePositive(s.stopIntervalM, DEFAULT_DECO.stopIntervalM, 1, 30),
    lastStopM: sanePositive(s.lastStopM, DEFAULT_DECO.lastStopM, 1, 30),
    ascentRateMpm: sanePositive(s.ascentRateMpm, DEFAULT_DECO.ascentRateMpm, 1, 60),
    descentRateMpm: sanePositive(s.descentRateMpm, DEFAULT_DECO.descentRateMpm, 1, 120),
    // Dalla cima dell'Everest (0.33 bar) al livello del mare abbondante.
    surfacePressureBar: sane(s.surfacePressureBar, DEFAULT_DECO.surfacePressureBar, 0.3, 1.2),
    // Un gradient factor non valido NON deve stringere la risalita: `gfLow: NaN`
    // dava 26 minuti di deco invece di 29 e la prima sosta tre metri più su.
    gfLow: sane(s.gfLow, DEFAULT_DECO.gfLow, 0.05, 1),
    gfHigh: sane(s.gfHigh, DEFAULT_DECO.gfHigh, 0.05, 1),
    maxPpo2Work: sane(s.maxPpo2Work, DEFAULT_DECO.maxPpo2Work, 0.16, 2),
    maxPpo2Deco: sane(s.maxPpo2Deco, DEFAULT_DECO.maxPpo2Deco, 0.16, 2),
    rmvLpm: sanePositive(s.rmvLpm, DEFAULT_DECO.rmvLpm, 1, 200),
    decoRmvLpm: sanePositive(s.decoRmvLpm, DEFAULT_DECO.decoRmvLpm, 1, 200),
    switchMin: sane(s.switchMin, DEFAULT_DECO.switchMin, 0, 30),
    morLpm: sane(s.morLpm, DEFAULT_DECO.morLpm, 0.1, 5),
    decoMorLpm: sane(s.decoMorLpm, DEFAULT_DECO.decoMorLpm, 0.1, 5),
    loopVolumeL: sane(s.loopVolumeL, DEFAULT_DECO.loopVolumeL, 1, 20),
  };
}

/**
 * La profondità massima che questo pianificatore accetta.
 *
 * Il record mondiale a circuito aperto sta sotto i 333 metri. Oltre non c'è
 * niente da pianificare, e i numeri enormi servono solo a far girare il motore
 * per un minuto — a 1e6 metri ci metteva 69 secondi — o a farlo cadere con
 * «Invalid array length».
 */
export const MAX_PLANNABLE_DEPTH_M = 350;
/** Un'immersione più lunga di un giorno non è un'immersione. */
export const MAX_PLANNABLE_MINUTES = 1440;

export function planDeco(
  levels: PlanLevel[],
  gases: PlanGas[],
  settings: Partial<DecoSettings> = {},
): DecoResult {
  const s: DecoSettings = saneSettings({ ...DEFAULT_DECO, ...settings });
  const segments: DecoSegment[] = [];
  const warnings: DecoResult['warnings'] = [];
  const icd: IcdWarning[] = [];

  // I livelli passano dallo stesso filtro delle impostazioni: una profondità
  // `NaN` arrivava fino ai tessuti e li rendeva tutti `NaN`, e un livello da
  // centomila metri faceva girare il motore per un minuto prima di cadere.
  const usable = levels
    .filter((l) => Number.isFinite(l.depthM) && l.depthM > 0 && Number.isFinite(l.minutes) && l.minutes >= 0)
    .map((l) => ({
      ...l,
      depthM: Math.min(l.depthM, MAX_PLANNABLE_DEPTH_M),
      minutes: Math.min(l.minutes, MAX_PLANNABLE_MINUTES),
    }));
  if (levels.length && !usable.length) {
    warnings.push({
      level: 'critical',
      text: 'Nessun livello utilizzabile: profondità o tempi mancanti, negativi o non numerici. Il piano qui sotto è vuoto perché non c\u2019è niente da pianificare, non perché l\u2019immersione non richieda soste.',
    });
  }
  if (levels.some((l) => Number.isFinite(l.depthM) && l.depthM > MAX_PLANNABLE_DEPTH_M)) {
    warnings.push({
      level: 'critical',
      text: `Profondità oltre i ${MAX_PLANNABLE_DEPTH_M} m: il piano è stato calcolato a ${MAX_PLANNABLE_DEPTH_M} m, che è già oltre il record mondiale a circuito aperto.`,
    });
  }
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

    const ppo2 = ppo2At(breathedAt(deepM, gas, setpointBar, s), deepM, s.salinity, s.surfacePressureBar);
    const ppo2Mean = ppo2At(breathed, meanM, s.salinity, s.surfacePressureBar);
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
    /*
     * I LITRI SI CONTANO SULLA PRESSIONE IN BAR, non sugli ATA locali.
     *
     * Questi «litri» sono bar·litro: più sotto diventano bar dividendoli per
     * `g.tankL`. Il fattore giusto è quindi la pressione ambiente assoluta, non
     * il suo rapporto con la pressione di superficie del posto. È lo stesso
     * difetto che `gasPlan.ts` ha già chiuso per il pianificatore ricreativo, ma
     * la correzione non era arrivata qui, dove la quota entra dal suo campo:
     * 30 m per 30 minuti in aria con una 24 L danno 125 bar al mare (dichiarati
     * 123) e 127 a 2000 metri, dove il piano ne chiedeva 159.
     *
     * Le due righe del diluente qui sotto restano in ATA ed è giusto così: lì il
     * volume del circuito si riempie in proporzione alla pressione ambiente e il
     * risultato è già in litri liberi.
     */
    const litres = closed ? 0 : rmv * minutes * ambientBar(meanM, s.salinity, s.surfacePressureBar);
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
      eadM: round1(Math.max(0, ead(breathed, deepM, s.salinity, s.surfacePressureBar))),
      // L'END con la pressione di superficie: senza, in quota diceva un numero
      // più basso del vero (Tx18/30 a 60 m a 2000 m: 38.99 invece di 39.64) e
      // muoveva con sé la soglia dell'avvertenza sulla narcosi. Invisibile senza
      // elio, perché lì l'END coincide con la profondità.
      endM: round1(Math.max(0, endOf(breathed, deepM, s.salinity, { surfaceBar: s.surfacePressureBar }))),
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
    const n2Rise =
      ppn2At(after, depthM, s.salinity, s.surfacePressureBar) -
      ppn2At(before, depthM, s.salinity, s.surfacePressureBar);
    const heDrop = (before.he - after.he) * ambientBar(depthM, s.salinity, s.surfacePressureBar);
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
  /*
   * Il gas di partenza è quello con cui si ENTRA in acqua, non quello del fondo.
   *
   * Prendendo il gas del primo livello, un piano con un gas di transito produceva
   * un cambio a zero metri al minuto zero — con tanto di avviso di
   * controdiffusione «a 0 m», che è una frase senza senso. Si entra con il
   * transito e si cambia alla sua quota, che è il cambio vero.
   */
  const transitoIniziale = gases.findIndex(
    (g) =>
      g.role === 'travel' && g.setpointBar === undefined && switchDepthOf(g, s) + 0.01 > (s.startDepthM ?? 0),
  );
  let gasIndex =
    usable[0].gasIndex ??
    (usable[0].depthM > (s.startDepthM ?? 0) && transitoIniziale >= 0
      ? transitoIniziale
      : bestGasAt(usable[0].depthM, gases, s, usable[0].setpointBar !== undefined));

  for (let i = 0; i < usable.length; i++) {
    const level = usable[i];
    levelSetpoint = level.setpointBar;
    // Il transito si respira con il gas buono per il punto PIÙ PROFONDO del
    // tragitto, non con quello del livello di arrivo: salendo da 40 a 20 metri si
    // passa all'EAN50 quando si è arrivati, non prima — altrimenti il piano
    // prevede di respirarlo a quaranta metri, che è il modo in cui ci si fa male.
    /*
     * IN DISCESA VINCE IL GAS DI TRANSITO, se c'è.
     *
     * `GasRole` prevede `'travel'` e l'interfaccia lo offre, ma nessun ramo del
     * motore lo usava per il tragitto verso il fondo: la discesa si pianificava
     * sul gas di fondo, che su un piano profondo è un'ipossica. 0 → 80 metri con
     * un Tx10/70 vuol dire **PPO2 0.10 bar in superficie** — cioè perdere
     * conoscenza prima di bagnarsi — e il piano usciva con zero avvisi
     * sull'ossigeno. Il gas di transito esiste esattamente per questo tratto.
     *
     * Solo scendendo, e solo fino a dove è respirabile: da lì in giù si passa
     * al gas del livello, che è il cambio che si fa davvero.
     */
    const inDiscesa = level.depthM > currentDepth;
    /*
     * La discesa si spezza alla MOD del gas di transito.
     *
     * Un gas di transito si respira dalla superficie fino alla SUA massima
     * quota operativa, e da lì si passa al gas del livello. Prenderlo o
     * lasciarlo tutto intero non avrebbe senso: la sua ragione di esistere è
     * proprio il tratto in cui l'ipossica non si può respirare.
     */
    const transito =
      inDiscesa && level.gasIndex === undefined
        ? gases.findIndex(
            (g) =>
              g.role === 'travel' && g.setpointBar === undefined && switchDepthOf(g, s) + 0.01 > currentDepth,
          )
        : -1;
    if (transito >= 0) {
      const finoA = Math.min(level.depthM, switchDepthOf(gases[transito], s));
      if (finoA > currentDepth + 0.01) {
        if (transito !== gasIndex) switchTo(currentDepth, gasIndex, transito);
        gasIndex = transito;
        advance(
          'descent',
          currentDepth,
          finoA,
          (finoA - currentDepth) / s.descentRateMpm,
          gasIndex,
          levelSetpoint,
          s.rmvLpm,
        );
        currentDepth = finoA;
      }
    }
    const travelGas =
      level.gasIndex ??
      bestGasAt(Math.max(currentDepth, level.depthM), gases, s, levelSetpoint !== undefined);
    if (i > 0 && travelGas !== gasIndex) switchTo(currentDepth, gasIndex, travelGas);
    gasIndex = travelGas;

    const travelMin =
      Math.abs(level.depthM - currentDepth) /
      (level.depthM > currentDepth ? s.descentRateMpm : s.ascentRateMpm);
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

    const wanted = level.gasIndex ?? bestGasAt(level.depthM, gases, s, levelSetpoint !== undefined);
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
  /*
   * NON esiste più un accumulatore dei minuti di sosta di sicurezza.
   *
   * C'era, veniva incrementato, e non veniva mai letto: il valore restituito si
   * ricava dalle righe stampate (vedi `merged` in fondo), perché la tabella è la
   * verità e un conto parallelo può solo divergere da lei. Il contatore era il
   * residuo di una strategia precedente, e TypeScript non lo segnalava perché una
   * variabile a cui si SCRIVE gli risulta usata. L'ha trovato eslint.
   */
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
    if (from <= 0.01) return from;
    /*
     * La sosta si fa alla quota nominale se ci si arriva dall'alto, ALTRIMENTI
     * dove si è già.
     *
     * Il controllo di prima era `if (from <= safety.depthM) return from`, e
     * saltava la sosta ogni volta che la risalita era già stata spezzata più in
     * su. Succedeva esattamente sulle immersioni al limite della curva: a 18 m
     * per 43 minuti la sosta c'era, a 44 il tetto impediva di salire dritti, il
     * piano si fermava a 3 m come tappa — e da lì `from` valeva 3, cioè meno di
     * 5, e la sosta spariva. Senza avvisi, su 43 combinazioni di quota e tempo
     * fra gli 11 e i 50 metri: tutta la diagonale delle immersioni ricreative
     * tirate, cioè proprio quelle in cui la sosta di sicurezza è meno
     * facoltativa che mai. Faceva anche uscire la contingenza «tre metri più
     * giù» PIÙ CORTA del piano nominale, che è il contrario di quello che quel
     * pannello dice di mostrare.
     *
     * Risalire per fare la sosta non è un'opzione: si sosta dove si è.
     */
    const stopAt = Math.min(from, safety.depthM);
    const wanted = bestGasAt(from, gases, s, levelSetpoint !== undefined);
    if (wanted !== gasIndex) {
      switchTo(from, gasIndex, wanted);
      gasIndex = wanted;
    }
    if (from > stopAt + 0.01) {
      advance(
        'ascent',
        from,
        stopAt,
        (from - stopAt) / s.ascentRateMpm,
        gasIndex,
        levelSetpoint,
        s.decoRmvLpm,
      );
    }
    const atStop = bestGasAt(stopAt, gases, s, levelSetpoint !== undefined);
    if (atStop !== gasIndex) {
      switchTo(stopAt, gasIndex, atStop);
      gasIndex = atStop;
    }
    safetyStopSegments.add(segments.length);
    advance('stop', stopAt, stopAt, safety.minutes, gasIndex, levelSetpoint, s.decoRmvLpm);
    safetyDone = true;
    return stopAt;
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
      const wanted = bestGasAt(currentDepth, gases, s, levelSetpoint !== undefined);
      if (wanted !== gasIndex) {
        switchTo(currentDepth, gasIndex, wanted);
        gasIndex = wanted;
      }
      currentDepth = maybeSafetyStop(currentDepth, stop.depthM);
      advance(
        'ascent',
        currentDepth,
        stop.depthM,
        (currentDepth - stop.depthM) / s.ascentRateMpm,
        gasIndex,
        levelSetpoint,
        s.decoRmvLpm,
      );
      currentDepth = stop.depthM;
      if (firstStopImposed === undefined) firstStopImposed = stop.depthM;
      const atStop = bestGasAt(currentDepth, gases, s, levelSetpoint !== undefined);
      if (atStop !== gasIndex) {
        switchTo(currentDepth, gasIndex, atStop);
        gasIndex = atStop;
      }
      advance('stop', currentDepth, currentDepth, stop.minutes, gasIndex, levelSetpoint, s.decoRmvLpm);
      decoMin += stop.minutes;
    }
    if (currentDepth > 0) {
      currentDepth = maybeSafetyStop(currentDepth, 0);
      advance(
        'ascent',
        currentDepth,
        0,
        currentDepth / s.ascentRateMpm,
        gasIndex,
        levelSetpoint,
        s.decoRmvLpm,
      );
      currentDepth = 0;
    }
  }

  while (!s.bottomOnly && !s.imposedStops?.length && currentDepth > 0 && guard++ < 2000) {
    // La prima sosta si decide con `gfLow`: è la sua definizione. Da lì in poi il
    // gradient factor si interpola verso `gfHigh`, che vale in superficie —
    // valutato SEMPRE alla quota di destinazione, non a quella di partenza.
    if (anchorM === undefined) {
      const deep = ceilingM(state, s.gfLow, s.salinity, s.surfacePressureBar);
      /*
       * L'ancora è il tetto con `gfLow` arrotondato IN SU alla griglia delle
       * soste. È la regola di Baker come la implementano i computer, ed è quella
       * con cui il modello è stato validato contro 38 immersioni reali dello
       * Shearwater (scarto medio 0.07 punti di GF99).
       *
       * LIMITE NOTO E MISURATO. L'ancora così è una quota a cui non sempre ci si
       * ferma: quando il tetto cade appena sopra una riga della griglia — 15.04
       * invece di 14.98 — l'ancora sale di un gradino mentre la prima sosta
       * eseguita resta dov'era, e i gradient factor alle soste reali risultano
       * un filo più laschi. Effetto: a 33 m un minuto di fondo IN PIÙ può dare
       * un minuto di deco IN MENO. Su una griglia di 550 combinazioni (10–60 m
       * × 5–60 min, tre coppie di GF) succede UNA volta, e vale un minuto.
       *
       * PROVATO E SCARTATO: ancorare alla prima sosta effettiva con un punto
       * fisso. Un punto fisso spesso non esiste — abbassare l'ancora stringe i
       * gradient factor e fa tornare la sosta più profonda, e i due valori si
       * rincorrono — e scegliendo l'ancora più bassa nell'oscillazione le
       * violazioni passavano da una a nove, con cali fino a cinque minuti.
       * Sostituire un difetto misurato da un minuto con uno da cinque non è una
       * correzione: qui resta la regola validata, con il suo limite scritto.
       */
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
      const wanted = bestGasAt(currentDepth, gases, s, levelSetpoint !== undefined);
      if (wanted !== gasIndex) {
        switchTo(currentDepth, gasIndex, wanted);
        gasIndex = wanted;
      }
      advance('stop', currentDepth, currentDepth, 1, gasIndex, levelSetpoint, s.decoRmvLpm);
      decoMin += 1;
      continue;
    }
    /*
     * Si può salire: fino alla prossima sosta, fino in superficie — o FINO ALLA
     * PROSSIMA QUOTA DI CAMBIO, se ce n'è una per strada.
     *
     * IL DIFETTO CHE CHIUDE. Il gas si sceglieva alla quota di PARTENZA del
     * tratto e poi si saliva fino al target in un colpo solo: se il target era
     * più in alto della MOD di uno stage, quello stage veniva scavalcato. Su un
     * piano a 40 m con EAN50 (MOD 22 m), il primo tratto andava da 40 a 15 m
     * tutto sul gas di fondo — sette metri respirati dalla bombola sbagliata.
     * Peggio, rompeva la monotonia: a 30 m × 10 min la risalita tirava dritta
     * fino a 3 m sul trimix, a 31 m si spezzava a 6 m e prendeva l'ossigeno, e
     * il GF99 all'uscita passava da 52.3 a 38.6. Un metro più giù, meno
     * decompressione — che è un risultato che un pianificatore non può dare.
     *
     * Ci si ferma solo se il gas cambia davvero: altrimenti si spezzerebbe il
     * tratto in due righe identiche.
     */
    const chiuso = levelSetpoint !== undefined;
    const cambio = quotaDiCambioTra(currentDepth, target, gases, s, chiuso);
    const next = cambio !== undefined && bestGasAt(cambio, gases, s, chiuso) !== gasIndex ? cambio : target;
    const wanted = bestGasAt(currentDepth, gases, s, levelSetpoint !== undefined);
    if (wanted !== gasIndex) {
      switchTo(currentDepth, gasIndex, wanted);
      gasIndex = wanted;
    }
    if (offgassingFromM === undefined) offgassingFromM = currentDepth;
    currentDepth = maybeSafetyStop(currentDepth, next);
    advance(
      'ascent',
      currentDepth,
      next,
      (currentDepth - next) / s.ascentRateMpm,
      gasIndex,
      levelSetpoint,
      s.decoRmvLpm,
    );
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
    const bar = g.tankL === undefined ? undefined : g.tankL > 0 ? Math.ceil(litres / g.tankL) : Infinity;
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
    gases[usable[0].gasIndex ?? bestGasAt(firstDepth, gases, s, usable[0].setpointBar !== undefined)],
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
  const isDeco = (x: DecoSegment) =>
    x.runtimeMin > bottomRuntime + 1e-9 || x.kind === 'stop' || x.kind === 'switch';
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
  /*
   * LA PPO2 TROPPO BASSA È UN LIMITE COME QUELLA TROPPO ALTA.
   *
   * C'erano solo i limiti superiori: un piano con un'ipossica respirata in
   * superficie usciva senza un avviso sull'ossigeno, e un gas a `{o2: 0, he:
   * 0.8}` a quaranta metri usciva del tutto pulito. Sotto i 0.16 bar la
   * coscienza non è garantita e sotto 0.18 il margine non c'è: 0.18 è la soglia
   * che la didattica tecnica usa per dichiarare un gas «respirabile in
   * superficie», ed è quella scritta qui.
   */
  const PPO2_MINIMA = 0.18;
  /*
   * Si valuta all'estremo PIÙ ALTO del tratto, non al più profondo. `ppo2` sul
   * segmento è quella al punto profondo, che su una discesa 0 → 80 è alta: il
   * pericolo sta all'altro capo, dove l'ipossica si respira in superficie.
   */
  let ppo2Minima: { valore: number; quota: number } | undefined;
  for (const x of segments) {
    const alta = Math.min(x.fromM, x.toM);
    const gas = gases[x.gasIndex];
    if (!gas) continue;
    const v = ppo2At(breathedAt(alta, gas, x.setpointBar, s), alta, s.salinity, s.surfacePressureBar);
    if (!ppo2Minima || v < ppo2Minima.valore) ppo2Minima = { valore: v, quota: alta };
  }
  if (ppo2Minima && ppo2Minima.valore < PPO2_MINIMA) {
    warnings.push({
      level: 'critical',
      text: `PPO2 di ${ppo2Minima.valore.toFixed(2)} bar a ${Math.round(ppo2Minima.quota)} m: sotto ${PPO2_MINIMA.toFixed(2)} la miscela non è respirabile. Per il tratto verso il fondo serve un gas di transito.`,
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
    warnings.push({
      level: 'critical',
      text: `Orologio CNS al ${oxygen.cnsPercent.toFixed(0)}%: oltre il limite per singola esposizione.`,
    });
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
    warnings.push({
      level: 'info',
      text: 'Oltre i 40 metri senza soste obbligate: verifica che il tuo computer, con i suoi gradient factor, sia d’accordo.',
    });
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
  const closedCircuit =
    usable.some((l) => l.setpointBar !== undefined) || gases.some((g) => g.setpointBar !== undefined);
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
export function planSeries(series: SeriesDive[], settings: Partial<DecoSettings> = {}): DecoResult[] {
  const s: DecoSettings = { ...DEFAULT_DECO, ...settings };
  const out: DecoResult[] = [];
  let tissues = s.initial;

  for (let i = 0; i < series.length; i++) {
    const d = series[i];
    const initial =
      i === 0
        ? tissues
        : afterSurfaceInterval(
            tissues ?? surfacedTissues(s.surfacePressureBar),
            d.surfaceIntervalMin,
            s.surfacePressureBar,
          );
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

  add(
    'deeper',
    '3 metri più giù',
    'Sceso più del previsto sul primo livello.',
    planDeco(deeper, gases, settings),
  );
  add('longer', '5 minuti in più', 'Rimasto al fondo più del previsto.', planDeco(longer, gases, settings));
  add(
    'both',
    'Più giù e più a lungo',
    'Le due cose insieme: è il caso che costa di più.',
    planDeco(both, gases, settings),
  );

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
    L.push(
      `  ${'O₂ metab.'.padEnd(10)} ${result.ccr.o2Litres} L${result.ccr.o2Bar ? ` (${result.ccr.o2Bar} bar)` : ''}`,
    );
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
    for (const w of result.warnings)
      L.push(`  [${w.level === 'critical' ? '!!' : w.level === 'warning' ? '! ' : '  '}] ${w.text}`);
  }

  L.push('');
  L.push('Generato da MyDiveLog. Un pianificatore produce numeri per qualunque profilo,');
  L.push('compresi quelli che non vanno fatti: l’addestramento ce l’hai o non ce l’hai.');
  return L.join('\n');
}
