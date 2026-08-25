/**
 * Persistenza su SQLite, via `tauri-plugin-sql`. È il percorso usato su macOS
 * e su iOS: i dati stanno in un vero file di database nella cartella dati
 * dell'app, quindi sono copiabili, versionabili e ispezionabili con qualsiasi
 * strumento SQLite.
 *
 * Scelta di schema: i campi che servono per ordinare e filtrare sono colonne
 * vere; tutto il resto dell'immersione è un documento JSON. Il motivo è che il
 * modello evolverà (nuovi campi dai computer nuovi) e non voglio una migrazione
 * per ogni campo aggiunto — ma voglio comunque poter fare
 * `select … order by start_time` senza deserializzare 2000 documenti.
 *
 * I profili stanno in una tabella separata, letta solo su richiesta.
 */

import type { Dive, Sample } from '../core/model';
import { comeSta, type Traduci } from '../core/traduci';
import { stripSamples, type DiveStore, type DiveSummary } from './types';

interface SqlDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS dives (
     id           TEXT PRIMARY KEY,
     start_time   TEXT NOT NULL,
     duration_s   INTEGER NOT NULL,
     max_depth    REAL NOT NULL,
     site         TEXT,
     mode         TEXT,
     source       TEXT,
     doc          TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_dives_start ON dives(start_time DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_dives_site ON dives(site)`,
  `CREATE TABLE IF NOT EXISTS dive_samples (
     dive_id  TEXT PRIMARY KEY,
     count    INTEGER NOT NULL,
     doc      TEXT NOT NULL,
     FOREIGN KEY (dive_id) REFERENCES dives(id) ON DELETE CASCADE
   )`,
  `CREATE TABLE IF NOT EXISTS dive_alt_samples (
     dive_id  TEXT PRIMARY KEY,
     count    INTEGER NOT NULL,
     doc      TEXT NOT NULL,
     FOREIGN KEY (dive_id) REFERENCES dives(id) ON DELETE CASCADE
   )`,
  `CREATE TABLE IF NOT EXISTS settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
];

export class SqliteStore implements DiveStore {
  readonly kind = 'sqlite' as const;
  /** Come in `IndexedDbStore`: la frase è la chiave, e si traduce a schermo. */
  /*
   * L'apostrofo è quello TIPOGRAFICO, e la differenza non è estetica.
   *
   * La chiave del dizionario è la frase italiana copiata carattere per
   * carattere. Qui c'era l'apostrofo dritto, nel dizionario quello tipografico:
   * due stringhe diverse, quindi la traduzione non veniva mai trovata e questa
   * riga usciva in italiano anche in inglese. Nessun errore, nessun test rosso —
   * è il difetto silenzioso che la regola in testa a `traduzioni.ts` avverte di
   * evitare, e ci sono cascato lo stesso.
   */
  readonly location = 'File SQLite nella cartella dati dell’app';
  private db: SqlDatabase | null = null;

  /** Vedi `IndexedDbStore`: serve solo alla guardia qui sotto. */
  constructor(private readonly t: Traduci = comeSta) {}

  async init(): Promise<void> {
    if (this.db) return;
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    this.db = (await Database.load('sqlite:mydivelog.db')) as unknown as SqlDatabase;
    for (const stmt of SCHEMA) await this.db.execute(stmt);
    await this.db.execute('PRAGMA foreign_keys = ON');
  }

  private get sql(): SqlDatabase {
    if (!this.db) throw new Error(this.t('Database non inizializzato.'));
    return this.db;
  }

  async listDives(): Promise<Dive[]> {
    const rows = await this.sql.select<{ doc: string }[]>('SELECT doc FROM dives ORDER BY start_time DESC');
    return rows.map((r) => JSON.parse(r.doc) as Dive);
  }

  async getDive(id: string): Promise<Dive | undefined> {
    const rows = await this.sql.select<{ doc: string }[]>('SELECT doc FROM dives WHERE id = ?', [id]);
    if (!rows.length) return undefined;
    const dive = JSON.parse(rows[0].doc) as Dive;
    dive.samples = await this.getSamples(id);
    const alt = await this.getAltSamples(id);
    if (alt.length) dive.altSamples = alt;
    return dive;
  }

  async getSamples(id: string): Promise<Sample[]> {
    const rows = await this.sql.select<{ doc: string }[]>('SELECT doc FROM dive_samples WHERE dive_id = ?', [
      id,
    ]);
    return rows.length ? (JSON.parse(rows[0].doc) as Sample[]) : [];
  }

  /**
   * Il secondo profilo sta in una TABELLA a parte e non in una riga con la chiave
   * modificata: `dive_samples` ha un vincolo di chiave esterna su `dives(id)`, e una
   * riga con chiave `id#alt` lo violerebbe — l'inserimento fallirebbe su ogni
   * archivio esistente, dove il vincolo è già in vigore.
   */
  async getAltSamples(id: string): Promise<Sample[]> {
    const rows = await this.sql.select<{ doc: string }[]>(
      'SELECT doc FROM dive_alt_samples WHERE dive_id = ?',
      [id],
    );
    return rows.length ? (JSON.parse(rows[0].doc) as Sample[]) : [];
  }

  async sampleCounts(): Promise<Map<string, number>> {
    // La colonna `count` esiste proprio per questo: nessun profilo viene letto.
    // Le righe del secondo profilo vengono escluse: non sono immersioni.
    const rows = await this.sql.select<{ dive_id: string; count: number }[]>(
      'SELECT dive_id, count FROM dive_samples',
    );
    return new Map(rows.map((r) => [r.dive_id, Number(r.count)]));
  }

  async altSampleCounts(): Promise<Map<string, number>> {
    const rows = await this.sql.select<{ dive_id: string; count: number }[]>(
      'SELECT dive_id, count FROM dive_alt_samples',
    );
    return new Map(rows.map((r) => [r.dive_id, Number(r.count)]));
  }

  async putDives(dives: Dive[]): Promise<void> {
    for (const dive of dives) {
      const summary: DiveSummary = stripSamples(dive);
      await this.sql.execute(
        `INSERT INTO dives (id, start_time, duration_s, max_depth, site, mode, source, doc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           start_time = excluded.start_time,
           duration_s = excluded.duration_s,
           max_depth  = excluded.max_depth,
           site       = excluded.site,
           mode       = excluded.mode,
           source     = excluded.source,
           doc        = excluded.doc`,
        [
          dive.id,
          dive.startTime,
          dive.durationS,
          dive.maxDepth,
          dive.site?.name ?? null,
          dive.mode,
          dive.source.format,
          JSON.stringify(summary),
        ],
      );
      for (const [table, samples] of [
        ['dive_samples', dive.samples],
        ['dive_alt_samples', dive.altSamples],
      ] as const) {
        if (!samples || !samples.length) continue;
        await this.sql.execute(
          `INSERT INTO ${table} (dive_id, count, doc) VALUES (?, ?, ?)
           ON CONFLICT(dive_id) DO UPDATE SET count = excluded.count, doc = excluded.doc`,
          [dive.id, samples.length, JSON.stringify(samples)],
        );
      }
    }
  }

  async deleteDive(id: string): Promise<void> {
    await this.sql.execute('DELETE FROM dive_samples WHERE dive_id = ?', [id]);
    await this.sql.execute('DELETE FROM dive_alt_samples WHERE dive_id = ?', [id]);
    await this.sql.execute('DELETE FROM dives WHERE id = ?', [id]);
  }

  async clear(): Promise<void> {
    await this.sql.execute('DELETE FROM dive_alt_samples');
    await this.sql.execute('DELETE FROM dive_samples');
    await this.sql.execute('DELETE FROM dives');
    await this.sql.execute('DELETE FROM settings');
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const rows = await this.sql.select<{ value: string }[]>('SELECT value FROM settings WHERE key = ?', [
      key,
    ]);
    return rows.length ? (JSON.parse(rows[0].value) as T) : undefined;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    await this.sql.execute(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, JSON.stringify(value)],
    );
  }
}
