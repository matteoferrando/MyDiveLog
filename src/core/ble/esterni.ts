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
import type { Cylinder, Dive, DiveMode, GasMix, Sample } from '../model';

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
  /**
   * Vero quando il computer non ha dato nessuna data.
   *
   * Senza questa bandiera `startMs` valeva zero, che è un istante legittimo — il
   * 1° gennaio 1970 — e l'immersione entrava in archivio datata 31 dicembre
   * 1969, col fuso applicato sopra. In un logbook una data inventata non è un
   * dettaglio: la catena dei tessuti si calcola sugli orari, e le statistiche si
   * raggruppano per giornata.
   */
  senzaData?: boolean;
  /**
   * Lo scostamento da UTC in minuti, QUANDO IL COMPUTER LO DICHIARA.
   *
   * ► ARRIVAVA E VENIVA BUTTATO. ◄ Nel ponte Rust c'era un commento che diceva
   * che libdivecomputer il fuso non lo fornisce; non è vero — `dc_datetime_t`
   * ha il campo, e sei famiglie di lettori lo riempiono, Shearwater compresa —
   * e il valore veniva letto e scartato. Le immersioni di uno Shearwater
   * entravano con l'orario spostato dello scostamento.
   *
   * Vale più del fuso del telefono (`ContestoEsterno.fuso`): quello è dove sei
   * ADESSO, questo è dove eri QUANDO TI SEI IMMERSO. Chi scarica in aeroporto
   * al ritorno dal Mar Rosso li ha diversi di un'ora, e il secondo è quello
   * giusto.
   */
  utcOffsetMinutes?: number;
  durationS: number;
  maxDepth: number;
  avgDepth?: number;
  tempMinC?: number;
  tempMaxC?: number;
  /** Le miscele nell'ordine in cui le dichiara il computer. */
  gas: { o2: number; he: number }[];
  /**
   * Le bombole, che sono una lista DIVERSA dalle miscele.
   *
   * `CampioneLdc.pressureBar` è indicizzata **qui**, non su `gas`. Un computer
   * integrato con un gas dichiarato e il trasmettitore sulla seconda bombola è
   * la normalità, non un caso limite.
   */
  bombole?: BombolaLdc[];
  /** La modalità dichiarata dal computer. Assente se non la dice. */
  mode?: DiveMode;
  samples: CampioneLdc[];
}

export interface BombolaLdc {
  /** L'indice della miscela in `gas`, quando il computer lo dichiara. */
  gasIndex?: number;
  /** Capacità in acqua, litri. */
  sizeL?: number;
  startBar?: number;
  endBar?: number;
}

export interface CampioneLdc {
  /** Secondi dall'inizio. */
  t: number;
  depth?: number;
  tempC?: number;
  /** Una voce per BOMBOLA, nell'ordine di `bombole` — non di `gas`. */
  pressureBar?: (number | null)[];
  ndlS?: number;
  ttsS?: number;
  ceiling?: number;
  inDeco?: boolean;
  /** Il computer sta contando la sosta di sicurezza: consiglio, non obbligo. */
  inSafetyStop?: boolean;
  /** Il computer sta proponendo una sosta profonda: consiglio, non obbligo. */
  inDeepStop?: boolean;
  cns?: number;
  ppo2?: number;
  setpoint?: number;
  rbtMin?: number;
  /**
   * L'indice della miscela respirata, nella lista `gas` — **non** in `bombole`.
   *
   * Le due liste sono diverse e libdivecomputer le tiene separate apposta. La
   * traduzione verso `Sample.gasIndex`, che invece è indicizzato sulle bombole,
   * la fa `cilindri` qui sotto: è l'unico posto che vede tutte e due.
   */
  gasMixIndex?: number;
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
  /**
   * Che cosa è stato scartato, e perché.
   *
   * Esiste perché uno scarto silenzioso è peggio di un'immersione sbagliata:
   * chi ha appena aspettato tre minuti di trasferimento conta le immersioni, e
   * se ne mancano una deve poter sapere che non è stata persa per un guasto.
   */
  onScarto?: (motivo: string) => void;
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
/**
 * ═════════════════════════════════════════════════════════════════════════════
 * ► I DUE MOTIVI DI SCARTO, COME COSTANTI. ◄
 *
 * Non sono note interne: finiscono nell'elenco sotto la riga verde a fine
 * scarico, cioè **nella spiegazione del perché il conto delle immersioni non
 * torna**. Uscivano in italiano anche con l'applicazione in inglese, perché
 * `BleDownload.tsx` disegnava l'elenco così com'era.
 *
 * Costanti esportate e non stringhe sul posto perché una prova possa scorrerle
 * tutte e pretendere la voce inglese: la traduzione avviene dove si disegna —
 * qui la lingua non si sa — e lì la chiave arriva come variabile, quindi
 * `chiaviDi` non la vede. È la stessa cura di `core/ble/avanzamentoTesti.ts` e
 * `core/analysis/avvertenze.ts`.
 */

/** Il computer non ha dichiarato la data: senza, l'immersione non entra. */
export const SCARTO_SENZA_DATA =
  'Il computer non ha dato la data di questa immersione: non è stata importata.';

/** Né profondità né durata: non è un'immersione. */
export const SCARTO_SENZA_PROFONDITA_NE_DURATA =
  'Un record del computer non ha né profondità né durata: non è un’immersione, non è stato importato.';

/**
 * Tutti e due, per la prova che li confronta col dizionario.
 *
 * Un motivo nuovo che non finisce in questo elenco sfugge alla guardia: è il
 * solo punto debole del meccanismo, ed è scritto qui perché chi aggiunge il
 * prossimo lo veda mentre lo fa.
 */
export const MOTIVI_DI_SCARTO = [SCARTO_SENZA_DATA, SCARTO_SENZA_PROFONDITA_NE_DURATA] as const;

export function immersioneDaLdc(imm: ImmersioneLdc, ctx: ContestoEsterno): Dive | undefined {
  /*
   * ► UN RECORD SENZA DATA NON ENTRA IN ARCHIVIO. ◄
   *
   * Non è prudenza eccessiva. `dc_parser_get_datetime` può fallire, e senza
   * questa bandiera `startMs` valeva zero: l'immersione si piazzava al 1°
   * gennaio 1970 — al 31 dicembre 1969 col fuso applicato sopra — e da lì
   * avvelenava la catena dei tessuti, che si calcola sugli orari, e il
   * raggruppamento per giornata di CNS e OTU. E `diveIdFor` si ricava
   * dall'orario: due record senza data sarebbero diventati la stessa
   * immersione, cioè una delle due sparita.
   *
   * Si scarta DICENDOLO, mai in silenzio: chi ha appena aspettato tre minuti di
   * trasferimento conta le immersioni, e ha diritto di sapere che una non è
   * entrata e perché.
   */
  if (imm.senzaData) {
    ctx.onScarto?.(SCARTO_SENZA_DATA);
    return undefined;
  }

  const bombole = cilindri(imm);
  const samples = campioni(imm, bombole.lista.length, bombole.perMiscela);

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
  /*
   * IL MASSIMO DEI TEMPI, non l'ultimo campione — che è quello che c'era
   * scritto qui, ed era incoerente con la riga sopra, che il massimo lo prende
   * davvero. Con istanti non perfettamente ordinati, `[0, 3000, 60]` dava una
   * durata di **60 secondi** su un'immersione di cinquanta minuti: la deduplica
   * non avrebbe più riconosciuto la stessa immersione venuta da un'altra fonte,
   * e il consumo sarebbe stato diviso per un minuto invece che per cinquanta.
   */
  const durationS = Math.max(imm.durationS || 0, ...samples.map((s) => s.t), 0);
  if (maxDepth <= 0 && durationS <= 0) {
    /*
     * ► ANCHE QUESTO SCARTO PARLA, E PRIMA NO. ◄ Venti righe più su c'è scritto
     * «si scarta DICENDOLO, mai in silenzio», e questa uscita non lo faceva:
     * restituiva `undefined` e basta. Non è simmetria estetica — vedi
     * `immersioniDaLdc`: da questo avviso dipende il **segnalibro**, e un record
     * sparito senza dirlo poteva portarselo dietro.
     */
    ctx.onScarto?.(SCARTO_SENZA_PROFONDITA_NE_DURATA);
    return undefined;
  }

  const oraAParete = imm.startMs;
  /*
   * ► IL FUSO DEL COMPUTER VIENE PRIMA DI QUELLO DEL TELEFONO. ◄
   *
   * `ctx.fuso` è il fuso del dispositivo che sta scaricando, applicato alla
   * data dell'immersione: è un ripiego ragionevole e resta, perché la maggior
   * parte dei computer il fuso non lo dichiara. Ma quando il computer lo dice,
   * lo dice meglio: è dove eri quando ti sei immerso, non dove sei adesso.
   * Chi scarica in aeroporto al ritorno dal Mar Rosso ha un'ora di differenza
   * fra i due, e quell'ora finisce su ogni immersione del viaggio.
   */
  const fusoMinuti = imm.utcOffsetMinutes ?? ctx.fuso?.(oraAParete);
  const startTime = new Date(
    fusoMinuti === undefined ? oraAParete : istanteDaOraAParete(oraAParete, fusoMinuti),
  ).toISOString();

  const base: Omit<Dive, 'id'> = {
    startTime,
    // Dichiarato solo quando lo sappiamo davvero: senza, `startTime` è ancora
    // l'ora a parete e fingere un fuso la sposterebbe una seconda volta.
    utcOffsetMinutes: fusoMinuti,
    durationS,
    maxDepth,
    /*
     * LA PROFONDITÀ MEDIA E LA TEMPERATURA MINIMA DICHIARATE DAL COMPUTER.
     *
     * Arrivavano dal Rust e venivano buttate. Non è ridondanza col profilo:
     * `computeMetrics` le usa **come ripiego quando il profilo non c'è** — e i
     * record di sola sintesi, senza campioni, esistono su parecchi computer.
     * Senza, quelle immersioni entravano in archivio senza profondità media,
     * senza pressione ambiente media e senza temperatura.
     *
     * `tempMaxC` invece resta fuori, e non per dimenticanza: `Dive` non ha un
     * campo per la temperatura massima dell'acqua. `airTempC` è un'altra cosa —
     * è l'aria in superficie — e infilarcela dentro vorrebbe dire scrivere in
     * archivio un dato che dice quello che non è.
     */
    avgDepth: imm.avgDepth,
    minTempC: imm.tempMinC,
    /*
     * LA MODALITÀ ARRIVA DAL COMPUTER, e prima era `'oc'` fisso.
     *
     * Un rebreather entrava in archivio a circuito aperto. Non è un'etichetta:
     * le CCR si contano a parte, l'apnea e il profondimetro vengono esclusi
     * dalle statistiche che falserebbero, e la modalità finisce sul libretto a
     * valore legale. Quando il computer non la dichiara resta `'oc'`, che è
     * l'assunzione di tutti — ma adesso è un ripiego, non un'invenzione.
     */
    mode: imm.mode ?? 'oc',
    cylinders: bombole.lista,
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
  /*
   * ► LA PROFONDITÀ MEDIA MISURATA TORNA SULL'IMMERSIONE, COME FANNO GLI ALTRI. ◄
   *
   * Questa riga c'è in **tutti** gli altri importatori — UDDF, Subsurface,
   * LogTRAK, Garmin, Shearwater Cloud, il driver Uwatec di casa — e qui
   * mancava. Non è simmetria estetica: `dive.avgDepth` è quello che finisce
   * nella deduplica, nel profilo quadro della catena dei tessuti e
   * nell'archivio salvato, e lasciarlo vuoto quando il numero ce l'abbiamo
   * significa buttarlo.
   *
   * E si buttava sempre, non ogni tanto: il parser Shearwater di
   * libdivecomputer **non implementa `DC_FIELD_AVGDEPTH`**, quindi
   * `imm.avgDepth` da uno Shearwater è vuoto per costruzione.
   *
   * Il dichiarato resta padrone quando c'è: `computeMetrics` mette nel campo la
   * media pesata sul profilo e ricade sul dichiarato solo senza campioni, e
   * questa riga scrive soltanto dove non c'era niente.
   */
  if (dive.avgDepth === undefined) dive.avgDepth = dive.metrics.avgDepth;
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
 * Le immersioni **e** quello che è stato scartato per strada.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ NON BASTAVA `immersioniDaLdc`, E PERCHÉ È UN DIFETTO DA LOGBOOK. ◄
 *
 * `ContestoEsterno.onScarto` esisteva da sempre e **non lo passava nessuno**:
 * due sole occorrenze in tutto il sorgente, tutte e due dentro questo file.
 * Quindi un record scartato qui spariva senza lasciare traccia — e il guaio non
 * è l'immersione persa, è quello che succede dopo.
 *
 * Il Rust ha già emesso il suo `Record` per quel record, quindi l'interfaccia ha
 * già fissato l'impronta della **più recente**. Se la più recente è proprio
 * quella scartata, lo scarico finisce «senza errori», il segnalibro si salva su
 * di lei, e al giro successivo `dc_device_set_fingerprint` ferma il backend lì:
 * **quell'immersione e tutte quelle più vecchie non verranno più offerte. Mai
 * più, senza un avviso.**
 *
 * *È il difetto peggiore che un logbook possa avere: non perde dati che hai,
 * perde dati che non sai di non avere* — la frase è già scritta in
 * `BleDownload.tsx` accanto al segnalibro, per l'interruzione a metà. Questa è
 * la stessa cosa da un'altra porta, e la porta era aperta.
 *
 * La strada dei driver di casa la guardia ce l'ha: `download.ts` pretende
 * `out.dives.length === records.length && saltate === 0` prima di dare per buono
 * il segnalibro. Questa funzione è l'equivalente per la strada esterna.
 */
export function immersioniDaLdcConScarti(
  imm: ImmersioneLdc[],
  ctx: ContestoEsterno,
): { dives: Dive[]; scartate: string[] } {
  const scartate: string[] = [];
  const dives = immersioniDaLdc(imm, {
    ...ctx,
    onScarto: (motivo) => {
      scartate.push(motivo);
      ctx.onScarto?.(motivo);
    },
  });
  return { dives, scartate };
}

/**
 * Le bombole, e il legame con le miscele che è la parte che si sbaglia.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► DUE LISTE, NON UNA. ◄
 *
 * libdivecomputer tiene le **miscele** (`DC_FIELD_GASMIX`) e le **bombole**
 * (`DC_FIELD_TANK`) in due elenchi separati, e `dc_tank_t` porta un campo
 * `gasmix` proprio perché non coincidono. La pressione di un campione è
 * indicizzata sulle BOMBOLE.
 *
 * Il difetto che c'era: `cylinders` nasceva dalle miscele e le pressioni
 * venivano copiate con l'indice della bombola. Un computer con un gas
 * dichiarato e il trasmettitore assegnato alla seconda bombola — la normalità
 * su un integrato d'aria — mandava `[null, 220]`, il logbook leggeva la sola
 * posizione 0 e scriveva nella scheda «nessuna pressione bombola: consumo gas
 * non calcolabile». Su un'immersione in cui il computer aveva registrato 130
 * bar consumati.
 *
 * Adesso: se le bombole ci sono, sono loro l'elenco, e ognuna prende la miscela
 * che dichiara. Se non ci sono — parecchi computer non le espongono — si
 * ricade sulle miscele, che è il comportamento di prima ed è corretto proprio
 * perché in quel caso le due liste non hanno modo di divergere.
 */
interface Bombole {
  lista: Cylinder[];
  /**
   * Da indice-MISCELA a indice-BOMBOLA, che è come `Sample.gasIndex` è
   * indicizzato. `undefined` quando quella miscela non sta in nessuna bombola e
   * non è mai stata respirata: inventarle un posto sarebbe aggiungere
   * all'immersione un contenitore che non è esistito.
   */
  perMiscela: (i: number) => number | undefined;
}

/**
 * Le miscele che il profilo dice di aver davvero respirato.
 *
 * ► SOLO QUELLE RESPIRATE, E NON TUTTE QUELLE DICHIARATE. ◄ Un computer da
 * decompressione porta in memoria cinque miscele programmate anche quando
 * l'immersione è stata fatta con una sola: aggiungere una bombola per ognuna
 * riempirebbe la scheda di contenitori mai portati sott'acqua, e il conto del
 * gas li conterebbe come bombole senza pressione — cioè come dati mancanti
 * invece che come gas mai usati.
 */
function miscelePercorse(imm: ImmersioneLdc): Set<number> {
  const viste = new Set<number>();
  for (const c of imm.samples) {
    if (c.gasMixIndex !== undefined) viste.add(c.gasMixIndex);
  }
  return viste;
}

function cilindri(imm: ImmersioneLdc): Bombole {
  const gas = imm.gas.map(miscela);
  const bombole = imm.bombole ?? [];
  if (bombole.length) {
    const lista: Cylinder[] = bombole.map((b) => ({
      // Una bombola senza miscela dichiarata prende la prima, che è quasi
      // sempre quella giusta e comunque meglio di nessun gas: senza `mix` non
      // si calcola né PPO2 né MOD né consumo.
      mix: (b.gasIndex !== undefined ? gas[b.gasIndex] : undefined) ?? gas[0] ?? ARIA,
      sizeL: b.sizeL,
      startBar: b.startBar,
      endBar: b.endBar,
    }));
    /*
     * ════════════════════════════════════════════════════════════════════════
     * ► LA MISCELA RESPIRATA CHE NON STA IN NESSUNA BOMBOLA. ◄
     *
     * È il caso NORMALE, non quello limite: un trasmettitore solo sulla bombola
     * di fondo e il deco gas cambiato a mano sul computer. Il computer dichiara
     * due miscele e una bombola, e a metà risalita dice «adesso respiro la
     * miscela 1» — che in `bombole` non c'è.
     *
     * Le tre strade possibili, e perché questa:
     *
     *  - **buttare il cambio**: tutta la risalita verrebbe calcolata sulla
     *    miscela di fondo. È quello che l'applicazione faceva fino alla 1.8.18,
     *    ed è il difetto da togliere;
     *  - **attaccare il cambio alla bombola 0**: peggio di buttarlo. Direbbe
     *    che quel gas era nella bombola di fondo, cioè una cosa falsa scritta
     *    con la faccia di una misurata;
     *  - **una bombola in più, senza volume e senza pressioni**, che è quello
     *    che è successo davvero: c'era un secondo gas, non sappiamo quanto ne
     *    è stato usato. Il modello lo permette — `sizeL`, `startBar` e `endBar`
     *    sono opzionali — e il conto del gas la salta da sé perché non ha
     *    pressioni.
     *
     * Si aggiunge **in fondo**, e non è un dettaglio: `Sample.pressureBar` è
     * indicizzato su questa lista, e infilarla in mezzo sposterebbe di uno le
     * pressioni di tutte le bombole dopo.
     */
    const daMiscela = new Map<number, number>();
    gas.forEach((_, m) => {
      const quale = bombole.findIndex((b) => b.gasIndex === m);
      if (quale >= 0) daMiscela.set(m, quale);
    });
    for (const m of miscelePercorse(imm)) {
      if (daMiscela.has(m) || !gas[m]) continue;
      daMiscela.set(m, lista.length);
      lista.push({ mix: gas[m] });
    }
    return { lista, perMiscela: (i) => daMiscela.get(i) };
  }
  /*
   * ALMENO UNA BOMBOLA, SEMPRE.
   *
   * Un computer in modalità profondimetro non dichiara nessuna miscela, e
   * un'immersione senza bombole manda a vuoto ogni conto sul gas e ogni calcolo
   * di PPO2. Aria è l'assunzione che fanno tutti — compresa la didattica quando
   * parla di «immersione ad aria» come caso di riferimento — ed è dichiarata
   * qui invece che nascosta dentro un `?? 0.21` sparso.
   */
  /*
   * Qui le due liste NON possono divergere — le bombole sono le miscele — e
   * quindi l'indice della miscela è già l'indice della bombola. L'unico caso
   * fuori posto è la bombola d'aria inventata quando non c'è nessuna miscela:
   * lì qualunque indice punterebbe a un contenitore che il computer non ha
   * dichiarato, e si preferisce non dire niente.
   */
  if (!gas.length) return { lista: [{ mix: ARIA }], perMiscela: () => undefined };
  return { lista: gas.map((mix) => ({ mix })), perMiscela: (i) => (gas[i] ? i : undefined) };
}

const ARIA: GasMix = { o2: 0.21, he: 0 };

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
function campioni(
  imm: ImmersioneLdc,
  quanteBombole: number,
  perMiscela: (i: number) => number | undefined,
): Sample[] {
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
      /*
       * SI PORTA A LUNGHEZZA, e la lunghezza è quella delle bombole.
       *
       * `Sample.pressureBar` è indicizzata come `Dive.cylinders`, e un array
       * più corto o più lungo dell'elenco delle bombole è una promessa rotta
       * verso tutto ciò che sta a valle. Più corto: le posizioni mancanti
       * restano indefinite, che è la verità («quella bombola non ha mandato
       * niente»). Più lungo: le posizioni in eccesso si buttano, perché
       * puntano a una bombola che nell'immersione non esiste — tenerle
       * significherebbe attribuire una pressione a un contenitore inventato.
       */
      const p = c.pressureBar.slice(0, quanteBombole).map((v) => (v === null ? undefined : v));
      if (p.some((v) => v !== undefined)) s.pressureBar = p;
    }
    if (c.ndlS !== undefined) s.ndlS = c.ndlS;
    if (c.ttsS !== undefined) s.ttsS = c.ttsS;
    if (c.ceiling !== undefined) s.ceiling = c.ceiling;
    if (c.inDeco !== undefined) s.inDeco = c.inDeco;
    if (c.inSafetyStop !== undefined) s.inSafetyStop = c.inSafetyStop;
    if (c.inDeepStop !== undefined) s.inDeepStop = c.inDeepStop;
    if (c.cns !== undefined) s.cns = c.cns;
    if (c.ppo2 !== undefined) s.ppo2 = c.ppo2;
    if (c.setpoint !== undefined) s.setpoint = c.setpoint;
    if (c.rbtMin !== undefined) s.rbtMin = c.rbtMin;
    /*
     * ► DA INDICE-MISCELA A INDICE-BOMBOLA, E SOLO QUI. ◄ Il lato Rust manda
     * l'indice nella lista delle miscele, perché è quello che libdivecomputer
     * dice; `Sample.gasIndex` invece è indicizzato sulle bombole, perché è
     * quello che indicizza le pressioni. Le due liste coincidono spesso e non
     * sempre, e il giorno che divergono un numero giusto con l'etichetta
     * sbagliata fa respirare al modello dei tessuti il gas di un'altra bombola.
     */
    if (c.gasMixIndex !== undefined) {
      const quale = perMiscela(c.gasMixIndex);
      if (quale !== undefined) s.gasIndex = quale;
    }
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
  const o2 = g.o2 > 0 ? g.o2 : ARIA.o2;
  const he = g.he > 0 ? g.he : 0;
  return { o2, he };
}
