/**
 * Le immersioni che arrivano da libdivecomputer, tradotte nel modello di casa.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DOVE STA IL CONFINE.
 *
 * Il guscio Rust fa la parte difficile: apre il collegamento, parla il
 * protocollo del modello scelto, e consegna una struttura piatta
 * (`ImmersioneLdc`, in `src-tauri/src/trasporto_ldc.rs`) con l'inizio, la
 * durata, le miscele e i campioni accorpati per istante. Questo file fa il
 * resto, ed è **solo aritmetica e convenzioni**: nessun Bluetooth, nessun
 * Tauri, nessun `invoke`. È quello che permette di provarlo per intero senza un
 * computer subacqueo in mano, che è l'unica verifica disponibile finché
 * l'hardware non c'è.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► L'ORA È UN'ORA A PARETE, ESATTAMENTE COME PER SHEARWATER. ◄
 *
 * `startMs` è l'ora che il computer segnava, letta come se fosse UTC.
 * libdivecomputer non sa in che fuso si trovasse l'apparecchio — nessuno lo sa,
 * perché quel dato nella memoria non c'è — e inventarne uno sarebbe peggio che
 * dichiarare l'ambiguità.
 *
 * Quindi si passa dalla stessa strada già battuta col Peregrine:
 * `istanteDaOraAParete()` con il fuso del dispositivo che sta scaricando, alla
 * DATA dell'immersione. È il motivo per cui quella funzione sta in un file suo
 * e non dentro un driver: il difetto delle quattro immersioni del 24 agosto
 * nasceva proprio dal trattare un'ora a parete come un istante assoluto, e
 * ripeterlo qui vorrebbe dire ripetere il difetto su altri cento modelli.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * QUELLO CHE NON ARRIVA, e va detto invece che riempito.
 *
 * Dal computer non vengono sito, compagno, note, zavorra, muta: sono campi
 * dell'applicazione del costruttore, non della memoria dell'apparecchio. E
 * libdivecomputer, a differenza dei nostri due driver, non espone le
 * impostazioni di decompressione in modo uniforme fra le famiglie: i gradient
 * factor di un Peregrine e la «conservatism» di un Suunto non sono lo stesso
 * numero, e metterli nello stesso campo produrrebbe una statistica che confronta
 * cose diverse. Restano vuoti.
 */

import { istanteDaOraAParete } from '../oraAParete';
import { computeMetrics } from '../analysis/metrics';
import { diveIdFor } from '../dedupe';
import type { Cylinder, Dive, GasMix, Sample } from '../model';

/**
 * Un'immersione come la consegna il guscio Rust.
 *
 * I nomi sono quelli che `serde` produce (`#[serde(rename)]` in
 * `trasporto_ldc.rs`): questa interfaccia e quella struttura vanno cambiate
 * insieme, e il test `tests/esterniLdc.test.ts` tiene un esemplare copiato da
 * lì proprio per accorgersene.
 */
export interface ImmersioneLdc {
  /** Ora a parete letta come UTC, millisecondi dall'epoca. Vedi sopra. */
  startMs: number;
  durationS: number;
  maxDepth: number;
  avgDepth?: number;
  tempMinC?: number;
  tempMaxC?: number;
  /** Le miscele nell'ordine in cui le dichiara il computer. */
  gas: { o2: number; he: number }[];
  samples: CampioneLdc[];
}

export interface CampioneLdc {
  /** Secondi dall'inizio. */
  t: number;
  depth?: number;
  tempC?: number;
  /** Una voce per bombola, nell'ordine di `gas`. */
  pressureBar?: (number | null)[];
  ndlS?: number;
  ttsS?: number;
  ceiling?: number;
  inDeco?: boolean;
  cns?: number;
  ppo2?: number;
  setpoint?: number;
  rbtMin?: number;
}

export interface ContestoEsterno {
  /** Marca e modello scelti dall'utente nel catalogo. */
  marca: string;
  modello: string;
  /** L'identificativo di sistema del dispositivo, per la provenienza. */
  dispositivo?: string;
  /**
   * Il fuso del dispositivo che scarica, alla data dell'immersione.
   *
   * Assente vuol dire «non lo so»: allora `startTime` resta l'ora a parete
   * scritta come UTC e `utcOffsetMinutes` non viene dichiarato. È l'ambiguità
   * detta, che è sempre meglio di un fuso inventato.
   */
  fuso?: (oraAParete: number) => number;
  /** L'istante dello scarico, per `source.importedAt`. */
  importedAt: string;
}

/**
 * Da una immersione di libdivecomputer a una del logbook.
 *
 * Restituisce `undefined` per quello che non è un'immersione: durata a zero,
 * profondità a zero e nessun campione. Succede — la memoria di alcuni computer
 * contiene record vuoti o troncati — e farli entrare in archivio significa
 * sporcare le statistiche con immersioni di zero minuti che poi vanno
 * cancellate a mano una per una.
 */
export function immersioneDaLdc(imm: ImmersioneLdc, ctx: ContestoEsterno): Dive | undefined {
  const samples = campioni(imm);

  /*
   * IL MASSIMO FRA IL DICHIARATO E I CAMPIONI, e non uno dei due.
   *
   * È la stessa lezione del driver Shearwater, dove un log troncato dichiarava
   * zero metri con un profilo che arrivava a ventitré: `??` non intercetta lo
   * zero, e l'immersione entrava in archivio a profondità zero senza un solo
   * errore a schermo. Qui il rischio è identico, perché anche libdivecomputer
   * prende la profondità massima da un campo dell'intestazione quando c'è.
   */
  const daiCampioni = samples.length ? Math.max(...samples.map((s) => s.depth)) : 0;
  const maxDepth = Math.max(imm.maxDepth || 0, daiCampioni);
  const durationS = Math.max(imm.durationS || 0, samples.length ? samples[samples.length - 1].t : 0);
  if (maxDepth <= 0 && durationS <= 0) return undefined;

  const oraAParete = imm.startMs;
  const fusoMinuti = ctx.fuso?.(oraAParete);
  const startTime = new Date(
    fusoMinuti === undefined ? oraAParete : istanteDaOraAParete(oraAParete, fusoMinuti),
  ).toISOString();

  /*
   * ALMENO UNA BOMBOLA, SEMPRE.
   *
   * Un computer in modalità profondimetro non dichiara nessuna miscela, e
   * un'immersione senza bombole manda a vuoto ogni conto sul gas e ogni
   * calcolo di PPO2. Aria è l'assunzione che fanno tutti — compresa la
   * didattica quando parla di «immersione ad aria» come caso di riferimento —
   * ed è dichiarata qui invece che nascosta dentro un `?? 0.21` sparso.
   */
  const cylinders: Cylinder[] = imm.gas.length
    ? imm.gas.map((g) => ({ mix: miscela(g) }))
    : [{ mix: { o2: 0.21, he: 0 } }];

  const base: Omit<Dive, 'id'> = {
    startTime,
    // Dichiarato solo quando lo sappiamo davvero: senza, `startTime` è ancora
    // l'ora a parete e fingere un fuso la sposterebbe una seconda volta.
    utcOffsetMinutes: fusoMinuti,
    durationS,
    maxDepth,
    mode: 'oc',
    cylinders,
    computer: {
      model: `${ctx.marca} ${ctx.modello}`.trim(),
      deviceId: ctx.dispositivo,
    },
    source: {
      format: 'libdivecomputer',
      file: `bluetooth:${ctx.dispositivo ?? `${ctx.marca}-${ctx.modello}`}`,
      importedAt: ctx.importedAt,
    },
    tags: [],
    samples,
  };

  const dive: Dive = { ...base, id: diveIdFor(base) };
  dive.metrics = computeMetrics(dive);
  return dive;
}

/** Tutte quelle che sono immersioni, dalla più recente alla più vecchia. */
export function immersioniDaLdc(imm: ImmersioneLdc[], ctx: ContestoEsterno): Dive[] {
  return imm
    .map((i) => immersioneDaLdc(i, ctx))
    .filter((d): d is Dive => d !== undefined)
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
}

/**
 * I campioni, con la profondità riportata avanti quando manca.
 *
 * libdivecomputer manda un istante e poi i soli valori CAMBIATI: il guscio Rust
 * li accorpa per istante, ma un campione in cui la profondità non è cambiata
 * arriva comunque senza profondità. Lasciarlo a `undefined` non si può — `depth`
 * è obbligatoria e ogni grafico la legge — e metterci zero disegnerebbe
 * un'immersione che risale in superficie e ridiscende a ogni secondo in cui il
 * subacqueo è stato fermo. Si riporta avanti l'ultima nota, che è quello che il
 * computer sta dicendo: «non è cambiata».
 *
 * Prima del primo valore la profondità non è nota e non c'è niente da riportare
 * avanti: quei campioni si buttano, invece di inventare uno zero che il grafico
 * mostrerebbe come una discesa dalla superficie che non è stata registrata.
 */
function campioni(imm: ImmersioneLdc): Sample[] {
  const out: Sample[] = [];
  let ultima: number | undefined;
  for (const c of imm.samples) {
    if (c.depth !== undefined) ultima = c.depth;
    if (ultima === undefined) continue;
    const s: Sample = { t: c.t, depth: ultima };
    if (c.tempC !== undefined) s.tempC = c.tempC;
    /*
     * `null` è una bombola SENZA lettura a quell'istante, non uno zero.
     *
     * Il lato Rust manda `Vec<Option<f64>>`, che in JSON diventa
     * `[203.0, null]`: la seconda bombola non ha trasmettitore, o non ha
     * ancora mandato niente. Uno zero lì vorrebbe dire «bombola vuota», che è
     * il messaggio opposto e finisce dritto nel calcolo del consumo.
     */
    if (c.pressureBar?.length) {
      s.pressureBar = c.pressureBar.map((p) => (p === null ? undefined : p));
    }
    if (c.ndlS !== undefined) s.ndlS = c.ndlS;
    if (c.ttsS !== undefined) s.ttsS = c.ttsS;
    if (c.ceiling !== undefined) s.ceiling = c.ceiling;
    if (c.inDeco !== undefined) s.inDeco = c.inDeco;
    if (c.cns !== undefined) s.cns = c.cns;
    if (c.ppo2 !== undefined) s.ppo2 = c.ppo2;
    if (c.setpoint !== undefined) s.setpoint = c.setpoint;
    if (c.rbtMin !== undefined) s.rbtMin = c.rbtMin;
    out.push(s);
  }
  return out;
}

/**
 * Una miscela, con le frazioni rimesse in riga.
 *
 * libdivecomputer le dà come frazioni 0..1, ma alcune famiglie dichiarano
 * ossigeno zero per «aria» invece di 0.21 — è una convenzione del firmware, non
 * un errore della libreria. Uno zero passato così com'è produce una PPO2 di
 * zero e un'immersione che risulta respirata in ipossia grave: qui si
 * riconosce e si legge come aria, che è ciò che l'apparecchio intendeva.
 */
function miscela(g: { o2: number; he: number }): GasMix {
  const o2 = g.o2 > 0 ? g.o2 : 0.21;
  const he = g.he > 0 ? g.he : 0;
  return { o2, he };
}
