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

/**
 * LA VERSIONE DELLO SCHEMA DELL'ARCHIVIO.
 *
 * Si alza quando lo schema cambia in un modo che una versione precedente non
 * saprebbe leggere. Un archivio con un numero PIÙ ALTO di questo non si apre:
 * meglio un messaggio che dice «aggiorna l'applicazione» che una riscrittura
 * silenziosa che butta via i campi che questa versione non conosce.
 *
 * Parte da 1 e non da 0 perché zero è il valore che SQLite dà a un archivio in
 * cui nessuno l'ha mai scritto: gli archivi già esistenti hanno zero, passano
 * il controllo, e vengono marcati alla prima apertura.
 */
export const VERSIONE_ARCHIVIO = 1;

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ► «NON C'È UN ARCHIVIO NATIVO» E «C'È E NON VA APERTO» SONO DUE COSE DIVERSE. ◄
 *
 * `getStore()` ripiega su IndexedDB quando SQLite non parte, e fa bene: meglio
 * un'applicazione che funziona che un'applicazione che non si apre. Ma
 * ripiegava su **qualunque** errore, compreso il rifiuto qui sotto — quello che
 * dice «questo archivio l'ha scritto una versione più recente, non lo tocco».
 *
 * La conseguenza non era un'app che non parte: era **un'app che parte
 * sull'archivio sbagliato.** Il logbook appariva vuoto o diverso, le immersioni
 * nuove finivano in un secondo deposito, e il giorno che SQLite tornava
 * disponibile quelle sembravano sparite. *Il difetto non è il ripiego: è il
 * cambio silenzioso della fonte dei dati.*
 *
 * Trovato da una verifica esterna il 16 settembre 2026.
 *
 * Questo errore ha un tipo suo apposta perché `getStore()` possa distinguerlo
 * da tutti gli altri e **rilanciarlo** invece di nasconderlo: un archivio che
 * c'è e non si può aprire è una cosa che la persona deve sapere, non un
 * dettaglio da console.
 */
export class ArchivioDaNonAprire extends Error {
  readonly archivioEsiste = true;
}

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
  readonly location = 'in un file su questo dispositivo';
  private db: SqlDatabase | null = null;

  /** Vedi `IndexedDbStore`: serve solo alla guardia qui sotto. */
  constructor(private readonly t: Traduci = comeSta) {}

  async init(): Promise<void> {
    if (this.db) return;
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    this.db = (await Database.load('sqlite:mydivelog.db')) as unknown as SqlDatabase;
    /*
     * ════════════════════════════════════════════════════════════════════════
     * ► UN ARCHIVIO SCRITTO DA UNA VERSIONE PIÙ NUOVA NON SI APRE ALLA CIECA. ◄
     *
     * IL BUCO CHIUSO IL 15 SETTEMBRE 2026. Qui non c'era **nessun numero di
     * versione**: né `PRAGMA user_version` né una chiave in `settings`. Cioè
     * l'applicazione non aveva modo di accorgersi di stare aprendo un archivio
     * scritto da una versione futura — e con la sincronizzazione fra dispositivi
     * il caso non è teorico: basta che il telefono si aggiorni prima del Mac.
     *
     * Finché tutto sta dentro la colonna `doc` va bene per caso, non per
     * costruzione: la prima colonna vera aggiunta da una versione futura fa sì
     * che questa apra l'archivio, non veda quella colonna, e riscriva i
     * documenti senza il campo che non conosce. Silenziosamente.
     *
     * `IndexedDbStore` un numero di versione ce l'ha da sempre (`DB_VERSION`);
     * qui mancava, ed è il ramo che gira su Mac e iPhone, cioè dove sta
     * l'archivio vero delle persone.
     */
    const [{ user_version: versione }] =
      await this.db.select<{ user_version: number }[]>('PRAGMA user_version');
    if (versione > VERSIONE_ARCHIVIO) {
      throw new ArchivioDaNonAprire(
        this.t(
          'Questo archivio è stato scritto da una versione più recente di MyDiveLog. Aggiorna l’applicazione: aprirlo così rischierebbe di perdere i dati che questa versione non conosce.',
        ),
      );
    }
    for (const stmt of SCHEMA) await this.db.execute(stmt);
    await this.db.execute(`PRAGMA user_version = ${VERSIONE_ARCHIVIO}`);
    await this.db.execute('PRAGMA foreign_keys = ON');
  }

  // Stessa frase di `IndexedDbStore`, e non è una svista: vedi il commento
  // lungo là, sul perché un'asserzione da programmatore non è un messaggio.
  private get sql(): SqlDatabase {
    if (!this.db)
      throw new Error(
        this.t(
          'L’archivio non è pronto. Chiudi e riapri l’applicazione: quello che stavi salvando non è stato scritto.',
        ),
      );
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

  /**
   * Scrive le immersioni, TUTTE O NESSUNA.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * ► PERCHÉ LA TRANSAZIONE, visto che «tanto SQLite è affidabile». ◄
   *
   * Perché ogni immersione qui è **tre scritture**: il riepilogo, il profilo e
   * l'eventuale secondo profilo. In auto-commit sono tre transazioni separate, e
   * l'applicazione chiusa in mezzo — su un telefono succede quando il sistema
   * ha bisogno di memoria — lascia un'immersione in archivio senza il suo
   * profilo. Su un dispositivo con l'account la sincronizzazione lo ripesca; su
   * uno senza, quel profilo non c'è più e niente lo dice.
   *
   * L'ordine scelto era già quello giusto — prima il riepilogo, poi i profili —
   * e questo riquadro non lo cambia: aggiunge solo che il pezzo o è tutto
   * dentro o è tutto fuori.
   */
  async putDives(dives: Dive[]): Promise<void> {
    await this.sql.execute('BEGIN');
    try {
      await this.scriviDives(dives);
      await this.sql.execute('COMMIT');
    } catch (err) {
      // `ROLLBACK` può fallire a sua volta — per esempio se la transazione è
      // già stata annullata dal motore — e il guasto da riportare è il primo,
      // non il secondo: il secondo è una conseguenza.
      await this.sql.execute('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  private async scriviDives(dives: Dive[]): Promise<void> {
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
