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
  'period',
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
    const rotte = f.dives.filter(
      (d) => !d || typeof d.id !== 'string' || !d.id || typeof d.startTime !== 'string' || !d.startTime,
    ).length;
    if (rotte) errors.push(`${rotte} immersioni non hanno un identificativo o una data: il file è danneggiato.`);
    if (!f.dives.length) warnings.push('Il backup non contiene nessuna immersione.');
  }
  if (f.settings && typeof f.settings !== 'object') errors.push('Le impostazioni non sono leggibili.');
  for (const k of SECRET_KEYS) {
    if (f.settings && k in (f.settings as object)) {
      warnings.push(
        `Il file contiene la chiave «${k}», che nelle versioni recenti resta fuori dai backup perché è una credenziale. Verrà ignorata.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings, file: errors.length ? undefined : (raw as BackupFile) };
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

  for (const incoming of file.dives) {
    const existing = byId.get(incoming.id);
    if (!existing) {
      added.push(incoming);
    } else if (mode === 'replace') {
      // Sostituzione secca: vince il file, perché è quello che «ripristina» vuol
      // dire quando lo si chiede esplicitamente.
      merged.push(incoming);
    } else {
      // Fusione: il backup è la parte «in arrivo», e `mergeDive` protegge già i
      // campi compilati a mano e sceglie il profilo più ricco.
      merged.push(mergeDive(existing, incoming));
    }
  }

  const inFile = new Set(file.dives.map((d) => d.id));
  const onlyLocal = current.filter((d) => !inFile.has(d.id)).length;

  const settings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(file.settings ?? {})) {
    if (!SECRET_KEYS.includes(k)) settings[k] = v;
  }

  return { added, merged, onlyLocal, settings };
}

/** Il nome del file, con la data: in una cartella di backup l'ordine è tutto. */
export function backupFileName(now = new Date()): string {
  return `mydivelog-backup-${now.toISOString().slice(0, 10)}.json`;
}
