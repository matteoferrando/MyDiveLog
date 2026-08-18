/**
 * Lettore SQLite.
 *
 * I file di prova sono veri file SQLite, creati qui con `node:sqlite` — cioè con
 * la stessa libreria che li scrive nel mondo reale. Verificare il mio lettore
 * contro l'implementazione ufficiale è l'unico modo di essere sicuri: un errore
 * nel formato dei record non solleva eccezioni, restituisce valori sbagliati.
 *
 * Il caso che conta più di tutti è il BLOB grande: SQLite spezza i record che non
 * stanno in una pagina su una catena di pagine di overflow, e ricomporla male
 * significa dati troncati in silenzio. Il database di Shearwater Cloud contiene
 * profili compressi da oltre 10 KB, quindi quel percorso è la norma, non
 * l'eccezione.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSqlite, parseColumns, parseSchema, readSqliteTables } from '../src/core/parsers/sqliteReader';

const dir = mkdtempSync(join(tmpdir(), 'mydivelog-sqlite-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Crea un database su disco e restituisce i suoi byte. */
function build(name: string, setup: (db: DatabaseSync) => void, pageSize?: number): Uint8Array {
  const path = join(dir, `${name}.db`);
  const db = new DatabaseSync(path);
  if (pageSize) db.exec(`PRAGMA page_size = ${pageSize}`);
  // Senza WAL: il lettore non legge i file -wal, e per gli export non serve.
  db.exec('PRAGMA journal_mode = DELETE');
  setup(db);
  db.close();
  return new Uint8Array(readFileSync(path));
}

describe('riconoscimento', () => {
  it('riconosce un file SQLite dalla firma', () => {
    const bytes = build('sig', (db) => db.exec('create table t (a)'));
    expect(isSqlite(bytes)).toBe(true);
    expect(isSqlite(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(isSqlite(new TextEncoder().encode('{"dives":[]}'))).toBe(false);
  });
});

describe('tipi di valore', () => {
  it('legge tutti i tipi seriali che i logbook usano', () => {
    const bytes = build('types', (db) => {
      db.exec(`create table t (
        i_null integer, i_1 integer, i_2 integer, i_3 integer, i_4 integer,
        i_6 integer, r real, s text, b blob, zero integer, one integer
      )`);
      const st = db.prepare('insert into t values (?,?,?,?,?,?,?,?,?,?,?)');
      st.run(
        null,
        7,
        300,
        100_000,
        70_000_000,
        5_000_000_000,
        17.256,
        'Recco, Gonzatti',
        new Uint8Array([0, 255, 16]),
        0,
        1,
      );
      st.run(null, -7, -300, -100_000, -70_000_000, -5_000_000_000, -0.5, '', new Uint8Array(), 0, 1);
    });
    const t = readSqliteTables(bytes).get('t')!;
    expect(t.rows).toHaveLength(2);
    const [a, b] = t.rows;
    expect(a.i_null).toBeNull();
    expect(a.i_1).toBe(7);
    expect(a.i_2).toBe(300);
    expect(a.i_3).toBe(100_000);
    expect(a.i_4).toBe(70_000_000);
    expect(a.i_6).toBe(5_000_000_000);
    expect(a.r).toBeCloseTo(17.256, 6);
    expect(a.s).toBe('Recco, Gonzatti');
    expect([...(a.b as Uint8Array)]).toEqual([0, 255, 16]);
    // I negativi verificano l'estensione del segno sugli interi a 3 e 6 byte.
    expect(b.i_1).toBe(-7);
    expect(b.i_2).toBe(-300);
    expect(b.i_3).toBe(-100_000);
    expect(b.i_4).toBe(-70_000_000);
    expect(b.i_6).toBe(-5_000_000_000);
    expect(b.r).toBeCloseTo(-0.5, 6);
  });

  it('restituisce il rowid per una colonna INTEGER PRIMARY KEY', () => {
    // SQLite non memorizza quella colonna nel record: la lascia vuota e tiene il
    // valore nella chiave della cella. Senza gestirlo, la colonna sarebbe tutta null.
    const bytes = build('rowid', (db) => {
      db.exec('create table v (Id INTEGER PRIMARY KEY, DbVersion integer)');
      db.prepare('insert into v values (?,?)').run(12, 3);
      db.prepare('insert into v values (?,?)').run(99, 4);
    });
    const t = readSqliteTables(bytes).get('v')!;
    expect(t.rows.map((r) => r.Id)).toEqual([12, 99]);
    expect(t.rows.map((r) => r.DbVersion)).toEqual([3, 4]);
  });
});

describe('pagine di overflow', () => {
  it('ricompone blob più grandi di una pagina, byte per byte', () => {
    // 40 KB su pagine da 1 KB: decine di pagine di overflow concatenate.
    const big = new Uint8Array(40_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + (i >> 8)) & 0xff;
    const text = 'x'.repeat(9000);

    const bytes = build(
      'overflow',
      (db) => {
        db.exec('create table logs (id text, blob1 blob, note text)');
        const st = db.prepare('insert into logs values (?,?,?)');
        for (let i = 0; i < 12; i++) st.run(`log-${i}`, big, text);
      },
      1024,
    );

    const t = readSqliteTables(bytes).get('logs')!;
    expect(t.rows).toHaveLength(12);
    for (const [i, row] of t.rows.entries()) {
      const got = row.blob1 as Uint8Array;
      expect(got.length, `riga ${i}: lunghezza`).toBe(big.length);
      // Confronto integrale: un solo byte fuori posto significa catena rotta.
      expect(
        got.every((v, j) => v === big[j]),
        `riga ${i}: contenuto`,
      ).toBe(true);
      expect(row.note).toBe(text);
      expect(row.id).toBe(`log-${i}`);
    }
  });

  it("non tronca al confine del payload locale (bug dell'arrotondamento)", () => {
    // Con pagine da 512 byte la soglia del payload locale cade su un valore che
    // l'aritmetica in virgola mobile sbaglia di uno. Il dato DEVE essere non
    // banale: con un blob di soli zeri un troncamento passerebbe inosservato,
    // perché il risultato sbagliato è indistinguibile da quello giusto.
    const blob = new Uint8Array(6000).map((_, i) => (i * 7 + 1) & 0xff);
    const bytes = build(
      'boundary',
      (db) => {
        db.exec('create table t (a blob)');
        db.prepare('insert into t values (?)').run(blob);
      },
      512,
    );
    const got = readSqliteTables(bytes).get('t')!.rows[0].a as Uint8Array;
    expect(got.length).toBe(blob.length);
    const firstDiff = [...got].findIndex((v, i) => v !== blob[i]);
    expect(firstDiff, `primo byte diverso all'indice ${firstDiff}`).toBe(-1);
  });

  it('funziona con tutte le dimensioni di pagina', () => {
    const blob = new Uint8Array(6000).map((_, i) => (i * 13 + 5) & 0xff);
    for (const pageSize of [512, 1024, 4096, 8192, 65536]) {
      const bytes = build(
        `ps${pageSize}`,
        (db) => {
          db.exec('create table t (a blob)');
          db.prepare('insert into t values (?)').run(blob);
        },
        pageSize,
      );
      const t = readSqliteTables(bytes).get('t')!;
      const got = t.rows[0].a as Uint8Array;
      expect(got.length, `pagina ${pageSize}`).toBe(blob.length);
      expect(
        got.every((v, j) => v === blob[j]),
        `pagina ${pageSize}`,
      ).toBe(true);
    }
  });
});

describe('alberi B su più livelli', () => {
  it('legge tutte le righe attraversando le pagine interne', () => {
    // Con pagine da 512 byte e 2000 righe l'albero ha più di un livello, quindi
    // il lettore deve seguire le pagine interne e non solo le foglie.
    const bytes = build(
      'many',
      (db) => {
        db.exec('create table dives (n integer, site text, depth real)');
        const st = db.prepare('insert into dives values (?,?,?)');
        for (let i = 1; i <= 2000; i++) st.run(i, `Sito numero ${i}`, i / 10);
      },
      512,
    );
    const t = readSqliteTables(bytes).get('dives')!;
    expect(t.rows).toHaveLength(2000);
    // Ordine per rowid: le righe devono tornare nell'ordine di inserimento.
    expect(t.rows[0].n).toBe(1);
    expect(t.rows[1999].n).toBe(2000);
    expect(t.rows[1234].site).toBe('Sito numero 1235');
    expect(t.rows[1234].depth as number).toBeCloseTo(123.5, 6);
  });
});

describe('selezione delle tabelle', () => {
  it('legge solo quelle richieste', () => {
    const bytes = build('multi', (db) => {
      db.exec('create table dive_details (DiveId text)');
      db.exec('create table log_data (log_id text)');
      db.exec('create table rumore (x text)');
      db.prepare('insert into dive_details values (?)').run('a');
      db.prepare('insert into log_data values (?)').run('b');
    });
    const only = readSqliteTables(bytes, ['dive_details', 'log_data']);
    expect([...only.keys()].sort()).toEqual(['dive_details', 'log_data']);
    expect(readSqliteTables(bytes).has('rumore')).toBe(true);
  });

  it('dà un errore chiaro su un file che non è SQLite', () => {
    expect(() => readSqliteTables(new Uint8Array(200))).toThrow(/SQLite/);
    expect(() => readSqliteTables(new TextEncoder().encode('{"dives":[]}'))).toThrow(/SQLite/);
    // Un database senza schema è un file da 0 byte: non è leggibile e va detto.
    expect(() => readSqliteTables(build('empty', () => undefined))).toThrow(/SQLite/);
  });

  it('legge una tabella esistente ma vuota', () => {
    const bytes = build('novuote', (db) => db.exec('create table dive_details (DiveId text, Depth real)'));
    const t = readSqliteTables(bytes).get('dive_details')!;
    expect(t.columns).toEqual(['DiveId', 'Depth']);
    expect(t.rows).toHaveLength(0);
  });
});

describe('lettura dello schema', () => {
  it('estrae i nomi delle colonne saltando i vincoli di tabella', () => {
    expect(
      parseColumns(
        'CREATE TABLE t (a integer, "b c" varchar(20), [d] blob, `e` text, PRIMARY KEY (a), FOREIGN KEY (a) REFERENCES u(x))',
      ),
    ).toEqual(['a', 'b c', 'd', 'e']);
  });

  it("riconosce l'alias del rowid nelle sue forme", () => {
    expect(parseSchema('CREATE TABLE t (Id INTEGER PRIMARY KEY, x)').rowidAlias).toBe('Id');
    expect(parseSchema('CREATE TABLE t (Id integer primary key autoincrement, x)').rowidAlias).toBe('Id');
    expect(parseSchema('CREATE TABLE t (Id INTEGER, x, PRIMARY KEY (Id))').rowidAlias).toBe('Id');
    // `INT` non è `INTEGER`: non è un alias del rowid, è una colonna normale.
    expect(parseSchema('CREATE TABLE t (Id INT PRIMARY KEY, x)').rowidAlias).toBeUndefined();
    // `DESC` annulla l'alias.
    expect(parseSchema('CREATE TABLE t (Id INTEGER PRIMARY KEY DESC, x)').rowidAlias).toBeUndefined();
    expect(parseSchema('CREATE TABLE t (a, b)').rowidAlias).toBeUndefined();
  });

  it('gestisce le virgole dentro i tipi e le virgolette', () => {
    expect(parseColumns("CREATE TABLE t (a decimal(10, 2), b varchar(5), c text default 'x, y')")).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
