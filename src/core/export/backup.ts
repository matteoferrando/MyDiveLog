/**
 * Backup completo dell'archivio, e ripristino.
 *
 * PERCHÉ NON BASTAVA L'UDDF. La scheda *Sincronizza* chiamava l'export UDDF «il
 * backup», e non lo è. UDDF è un formato di INTERSCAMBIO: serve a far leggere le
 * tue immersioni a un'altra applicazione, e per riuscirci deve limitarsi a quello
 * che quel formato sa dire. L'export dichiara già una quindicina di perdite —
 * modalità, compagno, voto, zavorra, muta, visibilità, fuso, pressione di
 * superficie, annotazioni, valori del computer, eventi, altri computer,
 * etichette, regione del sito, materiale della bombola, canali dei campioni — e
 * soprattutto non porta NIENTE di quello che sta fuori dalle immersioni:
 * impostazioni, attrezzatura, brevetti, piani salvati, analisi generate.
 *
 * Chi ripristina da un UDDF si ritrova un logbook, non il suo archivio. E lo
 * scopre nel momento peggiore, cioè quando ha già perso l'originale.
 *
 * COSA FA QUESTO. Un JSON che contiene tutto quello che l'applicazione sa, nella
 * forma esatta in cui lo tiene: immersioni complete di profili, secondi profili,
 * metriche, e ogni impostazione. Non è leggibile da nessun altro programma e non
 * ci prova: quel mestiere lo fa l'UDDF, e i due esistono insieme perché
 * rispondono a due domande diverse — «voglio i miei dati altrove» e «voglio poter
 * tornare indietro».
 *
 * IL RIPRISTINO NON CANCELLA. Ricostruire l'archivio da zero è la modalità
 * pericolosa, e non è quella predefinita: per difetto il ripristino FONDE, con la
 * stessa regola dell'import — i campi compilati a mano non vengono sovrascritti,
 * il profilo più ricco vince. Chi vuole davvero ripartire da capo lo chiede
 * esplicitamente, e la differenza fra le due cose è scritta nell'interfaccia.
 */

import { mergeDive } from '../dedupe';
import type { Dive, Sample } from '../model';

/**
 * La versione del formato.
 *
 * Serve a un ripristino futuro per sapere che cosa sta leggendo. Non è
 * decorativa: il giorno in cui il modello cambierà, un file vecchio dovrà poter
 * essere ancora letto, e senza un numero l'unico modo sarebbe indovinare dalla
 * forma.
 */
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: 'mydivelog-backup';
  version: number;
  /** Quando è stato prodotto, ISO 8601. */
  createdAt: string;
  /** Che cosa l'ha prodotto: utile quando un file arriva da un altro dispositivo. */
  app: { name: string; store: string };
  /**
   * Le immersioni COMPLETE, profili inclusi. È il motivo per cui questo file è
   * grande: un archivio di cento immersioni campionate ogni dieci secondi sono
   * qualche decina di migliaia di campioni, e sono esattamente ciò che non si
   * può ricostruire se si perde.
   */
  dives: Dive[];
  /**
   * Le impostazioni, chiave per chiave, così come stanno nell'archivio.
   *
   * Comprende attrezzatura, brevetti, piani salvati, analisi generate, obiettivo
   * e periodo scelti. NON comprende le credenziali: vedi `SECRET_KEYS`.
   */
  settings: Record<string, unknown>;
  /** Riepilogo leggibile, per poter capire cosa c'è dentro senza aprire tutto. */
  summary: {
    dives: number;
    withProfile: number;
    samples: number;
    firstDive?: string;
    lastDive?: string;
    settings: string[];
  };
}

/**
 * Le chiavi che NON entrano nel backup.
 *
 * Il token di sincronizzazione e la chiave dell'API sono credenziali: finiscono
 * in un file che poi viene copiato su un disco esterno, mandato per posta,
 * lasciato in Download. Un backup che le contiene trasforma ogni copia in una
 * copia dei tuoi segreti, e chi ripristina non se ne accorge perché tutto
 * funziona. Si riscrivono a mano dopo un ripristino: sono due campi, e il
 * fastidio di ridigitarli è incomparabilmente minore del danno di spargerli.
 */
export const SECRET_KEYS = ['sync', 'ai'];

export interface ArchiveSource {
  listDives(): Promise<Dive[]>;
  getSamples(id: string): Promise<Sample[]>;
  getAltSamples(id: string): Promise<Sample[]>;
  getSetting<T>(key: string): Promise<T | undefined>;
  readonly kind: string;
}

/** Tutte le chiavi di impostazione che l'applicazione usa. */
export const SETTING_KEYS = [
  'goal',
  'goal:at',
  'period',
  'period:at',
  'gasPlan',
  'gasPlan:at',
  'decoPlan',
  'decoPlan:at',
  'decoPlans',
  'decoPlans:at',
  'analyses',
  'analyses:at',
  'gear',
  'gear:at',
  /*
   * ► NOME E BREVETTO DEL SUBACQUEO. Lettere a) e b) del libretto di legge. ◄
   *
   * `state.tsx` scrive questa impostazione da sempre e non era in NESSUNA delle
   * due liste bianche — né qui né in `SHARED_SETTINGS` — quindi il backup «che
   * contiene tutto quello che l'applicazione sa» non la conteneva, e anche
   * mettendocela a mano il ripristino l'avrebbe scartata (`planRestore` accetta
   * solo le chiavi di questa lista).
   *
   * Come si vedeva: backup, cambio telefono, ripristino. L'archivio torna
   * intero — immersioni, profili, attrezzatura, piani — e il libretto stampato
   * esce senza generalità e senza brevetto, cioè le due voci che lo rendono un
   * documento invece che un elenco. Nessun avviso, perché non manca niente che
   * l'applicazione sappia di dover cercare.
   *
   * `tests/backup.test.ts` confronta ora l'insieme delle chiavi passate a
   * `setSetting` in `src/` con l'unione delle due liste più le esclusioni
   * dichiarate, così il prossimo che aggiunge un'impostazione se ne accorge.
   */
  'subacqueo',
  'subacqueo:at',
  // Fin dove si era arrivati con ogni computer subacqueo. Sta nel backup
  // perché ripristinare le immersioni senza il segnalibro farebbe rileggere
  // tutta la memoria del computer al primo collegamento successivo.
  'bleMarkers',
  'bleMarkers:at',
];

/**
 * Costruisce il backup leggendo l'archivio.
 *
 * Prende i profili UNO PER UNO invece di caricarli tutti in memoria e poi
 * mapparli: su un archivio grande la differenza è fra qualche decina di megabyte
 * di picco e il doppio, e su iOS il doppio è la differenza fra funzionare e
 * essere terminati dal sistema.
 */
export async function buildBackup(store: ArchiveSource, now = new Date()): Promise<BackupFile> {
  const summaries = await store.listDives();
  const dives: Dive[] = [];
  let samples = 0;
  let withProfile = 0;

  for (const d of summaries) {
    const s = await store.getSamples(d.id);
    const alt = await store.getAltSamples(d.id);
    samples += s.length + alt.length;
    if (s.length) withProfile++;
    dives.push({
      ...d,
      ...(s.length ? { samples: s } : {}),
      ...(alt.length ? { altSamples: alt } : {}),
    });
  }

  const settings: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const value = await store.getSetting<unknown>(key);
    if (value !== undefined) settings[key] = value;
  }

  const times = summaries.map((d) => d.startTime).sort();
  return {
    format: 'mydivelog-backup',
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    app: { name: 'MyDiveLog', store: store.kind },
    dives,
    settings,
    summary: {
      dives: dives.length,
      withProfile,
      samples,
      firstDive: times[0],
      lastDive: times[times.length - 1],
      settings: Object.keys(settings),
    },
  };
}

export interface BackupCheck {
  ok: boolean;
  /** Perché non si può usare. Vuoto quando `ok`. */
  errors: string[];
  /** Cose da sapere prima di procedere: non impediscono il ripristino. */
  warnings: string[];
  file?: BackupFile;
}

/**
 * Controlla un file prima di toccare l'archivio.
 *
 * Il ripristino è l'operazione che si fa quando le cose sono già andate male, e
 * un errore a metà strada lascerebbe un archivio mezzo sovrascritto — cioè
 * peggio di come si era partiti. Quindi si verifica tutto PRIMA: che sia il
 * formato giusto, che la versione sia leggibile, che le immersioni abbiano i
 * campi senza cui non sono immersioni.
 */
export function checkBackup(raw: unknown): BackupCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['Il file non contiene un oggetto JSON.'], warnings };
  }
  const f = raw as Partial<BackupFile>;
  if (f.format !== 'mydivelog-backup') {
    return {
      ok: false,
      errors: [
        'Questo non è un backup di MyDiveLog. Se stai cercando di importare immersioni da un’altra applicazione, il posto giusto è la scheda Importa: lì i formati riconosciuti sono sette.',
      ],
      warnings,
    };
  }
  if (typeof f.version !== 'number') errors.push('Manca il numero di versione del formato.');
  else if (f.version > BACKUP_VERSION) {
    errors.push(
      `Il file è stato scritto da una versione più recente dell’applicazione (formato ${f.version}, questa legge fino al ${BACKUP_VERSION}). Aggiorna prima di ripristinare: leggerlo comunque significherebbe scartare in silenzio quello che non capisce.`,
    );
  }
  if (!Array.isArray(f.dives)) errors.push('Manca l’elenco delle immersioni.');
  else {
    /*
     * Si controllano TUTTI i campi che l'interfaccia dà per scontati, non solo
     * id e data.
     *
     * Il commento qui sopra prometteva «i campi senza cui non sono immersioni» e
     * ne verificava due. Un'immersione senza `maxDepth` passava, entrava in
     * archivio, e alla prima apertura del logbook `d.maxDepth.toFixed(1)` faceva
     * schermata bianca — con il record ormai scritto, quindi bianca anche dopo
     * il riavvio. Un ripristino non deve poter rendere l'applicazione
     * inavviabile: è l'operazione che si fa proprio quando si stanno rimettendo
     * le cose a posto.
     */
    const incompleta = (d: Partial<Dive>) =>
      !d ||
      typeof d.id !== 'string' ||
      !d.id ||
      typeof d.startTime !== 'string' ||
      !d.startTime ||
      !Number.isFinite(d.maxDepth) ||
      !Number.isFinite(d.durationS) ||
      !Array.isArray(d.cylinders) ||
      !Array.isArray(d.tags) ||
      !d.source ||
      typeof d.source !== 'object';
    const rotte = f.dives.filter(incompleta).length;
    if (rotte) {
      errors.push(
        `${rotte} immersioni sono incomplete — manca l’identificativo, la data, la profondità, la durata o la provenienza. Il file è danneggiato, e ripristinarlo renderebbe il logbook inapribile.`,
      );
    }
    const doppi = f.dives.length - new Set(f.dives.map((d) => d?.id)).size;
    if (doppi > 0) {
      warnings.push(
        `${doppi} immersioni compaiono più di una volta nel file: le copie verranno fuse fra loro invece di contarsi due volte.`,
      );
    }
    if (!f.dives.length) warnings.push('Il backup non contiene nessuna immersione.');
  }
  if (f.settings && typeof f.settings !== 'object') errors.push('Le impostazioni non sono leggibili.');
  /*
   * Una chiave che il programma non scrive MAI non è un'impostazione da
   * ripristinare: è qualcosa che qualcun altro ha messo lì. La più pericolosa è
   * `deletedDives`, il registro delle cancellazioni.
   */
  const sconosciute = Object.keys((f.settings as object) ?? {}).filter(
    (k) => !SETTING_KEYS.includes(k) && !SECRET_KEYS.includes(k),
  );
  if (sconosciute.length) {
    errors.push(
      `Il file contiene impostazioni che questa applicazione non scrive mai (${sconosciute.join(', ')}). Non viene ripristinato: fra queste può esserci il registro delle cancellazioni, che si propagherebbe a tutti i dispositivi collegati.`,
    );
  }
  for (const k of SECRET_KEYS) {
    if (f.settings && k in (f.settings as object)) {
      warnings.push(
        `Il file contiene la chiave «${k}», che nelle versioni recenti resta fuori dai backup perché è una credenziale. Verrà ignorata.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings, file: errors.length ? undefined : (raw as BackupFile) };
}

/**
 * Quello che impedisce di ripristinare, quando dipende dal MODO scelto.
 *
 * Sta separata da `checkBackup` perché il modo si sceglie dopo aver aperto il
 * file — e cambiando modo la stessa identica coppia file/archivio passa da
 * innocua a distruttiva.
 *
 * Il caso che conta è uno solo, ed era un semplice avviso: un backup con ZERO
 * immersioni in modalità «ricostruisci da zero». La ricostruzione cancella
 * tutto quello che il file non contiene; se il file non contiene niente,
 * l'operazione è «cancella l'archivio» scritta in un altro modo. Chi la lancia
 * pensa di star rimettendo a posto le cose — è il momento in cui si ripristina
 * un backup — e un avviso giallo fra gli altri avvisi non lo ferma. Questo lo
 * ferma: non è un file di cui valga la pena permettere il ripristino, ed è
 * sempre e solo un file sbagliato o troncato.
 *
 * La fusione resta permessa: fondere un file vuoto non fa niente, e «non fa
 * niente» non ha bisogno di essere impedito.
 */
export function restoreBlockers(file: BackupFile, mode: 'merge' | 'replace', currentDives: number): string[] {
  const out: string[] = [];
  if (mode === 'replace' && file.dives.length === 0 && currentDives > 0) {
    out.push(
      `Questo backup non contiene nessuna immersione, e «ricostruisci da zero» cancellerebbe le ${currentDives} che hai adesso senza rimetterne nessuna. Il file è vuoto o troncato: o ne usi un altro, oppure scegli «fondi», che con un file vuoto non fa niente.`,
    );
  }
  return out;
}

export interface RestorePlan {
  /** Immersioni che non ci sono e verranno aggiunte. */
  added: Dive[];
  /** Immersioni già presenti: la versione fusa. */
  merged: Dive[];
  /** Immersioni presenti in archivio e non nel backup. */
  onlyLocal: number;
  /** Impostazioni che verranno riscritte. */
  settings: Record<string, unknown>;
}

/**
 * Che cosa succederebbe, calcolato prima di farlo.
 *
 * Puro: non tocca niente e non ha bisogno dell'archivio, solo di quello che c'è
 * già in memoria. Serve a poter mostrare «aggiungerà 12 immersioni, ne aggiornerà
 * 91, e 3 che hai solo qui resteranno dove sono» PRIMA di premere il bottone. Un
 * ripristino che non si può prevedere è un ripristino che nessuno lancia.
 */
export function planRestore(
  file: BackupFile,
  current: Dive[],
  mode: 'merge' | 'replace' = 'merge',
): RestorePlan {
  const byId = new Map(current.map((d) => [d.id, d]));
  const added: Dive[] = [];
  const merged: Dive[] = [];

  /*
   * Lo stesso id due volte nello stesso file si fonde, non si conta due volte.
   *
   * Prima l'interfaccia annunciava «2 aggiunte» e in archivio ne compariva una:
   * vinceva l'ULTIMA copia scritta, non la migliore.
   */
  const daFile = new Map<string, Dive>();
  for (const d of file.dives) {
    const gia = daFile.get(d.id);
    daFile.set(d.id, gia ? mergeDive(gia, d) : d);
  }

  for (const incoming of daFile.values()) {
    const existing = byId.get(incoming.id);
    if (!existing) {
      added.push(incoming);
    } else if (mode === 'replace') {
      // Sostituzione secca: vince il file, perché è quello che «ripristina» vuol
      // dire quando lo si chiede esplicitamente.
      merged.push(incoming);
    } else {
      /*
       * Fusione: il backup è la parte «in arrivo», e `mergeDive` protegge già i
       * campi compilati a mano e sceglie il profilo più ricco.
       *
       * QUELLE CHE NON CAMBIANO NON ENTRANO. `mergeDive` restituisce lo STESSO
       * riferimento quando non c'è niente da aggiungere, e metterle comunque
       * in `merged` faceva sì che il ripristino le riscrivesse tutte con il
       * timbro di adesso: da lì in poi la versione locale — vecchia quanto il
       * backup — vinceva su qualunque cosa esistesse sugli altri dispositivi.
       * Backup di gennaio, nota scritta sull'iPhone a marzo, ripristino in
       * modalità «Fondi» ad agosto: la nota di marzo spariva da entrambi. La
       * modalità si chiama «Fondi» e promette di non perdere niente.
       */
      const fusa = mergeDive(existing, incoming);
      if (fusa !== existing) merged.push(fusa);
    }
  }

  const inFile = new Set(daFile.keys());
  const onlyLocal = current.filter((d) => !inFile.has(d.id)).length;

  /*
   * In ingresso si accettano SOLO le chiavi che il programma scrive.
   *
   * La scrittura aveva una lista bianca (`SETTING_KEYS`) e la lettura no, e
   * quell'asimmetria era un buco: un file che passa ogni controllo può portare
   * `deletedDives`, cioè le lapidi della sincronizzazione. Ripristinandolo, le
   * lapidi entrano nell'archivio, la sincronizzazione successiva le applica e
   * le propaga — e le immersioni spariscono da TUTTI i dispositivi collegati.
   * Con una data nel futuro la lapide vince anche contro le immersioni toccate
   * di recente. Basta un file `.json` chiamato «backup».
   */
  const settings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(file.settings ?? {})) {
    if (SECRET_KEYS.includes(k) || !SETTING_KEYS.includes(k)) continue;
    settings[k] = v;
  }

  return { added, merged, onlyLocal, settings };
}

/** Il nome del file, con la data: in una cartella di backup l'ordine è tutto. */
export function backupFileName(now = new Date()): string {
  return `mydivelog-backup-${now.toISOString().slice(0, 10)}.json`;
}
