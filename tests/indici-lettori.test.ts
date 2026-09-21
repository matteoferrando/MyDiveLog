/**
 * ► GLI INDICI CHE ESCONO DAI DATI: tre ingressi ostili, tre difetti chiusi. ◄
 *
 * Accendendo `noUncheckedIndexedAccess` il compilatore ha indicato ogni lettura
 * per indice che può restituire `undefined`. Quasi tutte stavano già dentro un
 * controllo di lunghezza; queste tre no. Con l'ingresso giusto — un file
 * troncato, un comando che chiede quello che non c'è, un database vuoto — il
 * `undefined` proseguiva: in aritmetica diventava NaN, in un bit a bit zero, e
 * da lì un valore inventato o un guasto che non spiegava niente, invece del
 * rifiuto che il codice attorno riservava già allo stesso caso.
 *
 * Ognuna di queste prove è stata vista ROSSA sul codice di prima.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { fintoPeregrine, logPnfSintetico } from '../src/core/ble/fake';
import { readSqliteTables, sqliteTableNames } from '../src/core/parsers/sqliteReader';

// ------------------------------------------------------------ SQLite a mano

const PAGINA = 512;
const utf8 = new TextEncoder();

/** Varint di SQLite: big-endian, sette bit per byte, il bit alto dice «continua». */
function varint(v: number): number[] {
  const cifre: number[] = [];
  let x = v;
  do {
    cifre.unshift(x & 0x7f);
    x = Math.floor(x / 128);
  } while (x > 0);
  return cifre.map((c, i) => (i < cifre.length - 1 ? c | 0x80 : c));
}

/** Un record: la dimensione dell'intestazione, i tipi seriali, i valori. Testi e interi da un byte. */
function record(valori: (string | number)[]): number[] {
  const tipi: number[] = [];
  const corpo: number[] = [];
  for (const v of valori) {
    if (typeof v === 'number') {
      tipi.push(1);
      corpo.push(v & 0xff);
    } else {
      const b = [...utf8.encode(v)];
      tipi.push(13 + 2 * b.length);
      corpo.push(...b);
    }
  }
  const testa = tipi.flatMap(varint);
  return [...varint(testa.length + 1), ...testa, ...corpo];
}

/** Una pagina foglia di tabella con una cella sola, il cui payload va dentro così com'è. */
function foglia(db: Uint8Array, pagina: number, payload: number[]): void {
  const base = (pagina - 1) * PAGINA;
  // La pagina 1 comincia con i cento byte d'intestazione del database.
  const testa = pagina === 1 ? base + 100 : base;
  const cella = [...varint(payload.length), ...varint(1), ...payload];
  const inizio = PAGINA - cella.length;
  db[testa] = 13;
  db[testa + 4] = 1; // una cella
  db[testa + 8] = inizio >> 8; // il suo puntatore, relativo alla pagina
  db[testa + 9] = inizio & 0xff;
  db.set(cella, base + inizio);
}

function database(pagine: number): Uint8Array {
  const db = new Uint8Array(PAGINA * pagine);
  db.set(utf8.encode('SQLite format 3\0'), 0);
  db[16] = PAGINA >> 8; // dimensione della pagina, big-endian
  db[59] = 1; // testo in UTF-8
  return db;
}

/** Otto byte col bit di continuazione acceso: un varint che vuole anche il nono. */
const OTTO_CONTINUAZIONI = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

describe('SQLite: il nono byte di un varint si controlla come gli altri otto', () => {
  /*
   * Il ciclo di `readVarint` rifiutava un varint troncato dal primo all'ottavo
   * byte — «Varint troncato: file corrotto o incompleto» — e leggeva il nono
   * senza guardare. Se il nono non c'era, il valore usciva NaN: un tipo seriale
   * NaN diventava un testo vuoto, una dimensione d'intestazione NaN una riga
   * tutta NULL. Dati che il file non contiene, al posto del rifiuto.
   */
  it('un tipo seriale troncato nello schema si rifiuta, invece di diventare un testo vuoto', () => {
    // Intestazione di nove byte: la sua dimensione, poi un tipo seriale che di
    // byte ne vorrebbe nove e ne trova otto prima che il record finisca.
    const db = database(1);
    foglia(db, 1, [9, ...OTTO_CONTINUAZIONI]);
    expect(() => sqliteTableNames(db)).toThrow(/Varint troncato/);
  });

  it('una dimensione d’intestazione troncata si rifiuta, invece di diventare una riga di NULL', () => {
    const schema = record(['table', 't', 't', 2, 'CREATE TABLE t(a, b)']);

    // Il controllo: lo stesso database, con una riga sana, si legge. Così il
    // rifiuto qui sotto viene dal varint e non da un database costruito male.
    const sano = database(2);
    foglia(sano, 1, schema);
    foglia(sano, 2, record([1, 2]));
    expect(readSqliteTables(sano).get('t')?.rows).toEqual([{ a: 1, b: 2 }]);

    const troncato = database(2);
    foglia(troncato, 1, schema);
    foglia(troncato, 2, OTTO_CONTINUAZIONI);
    expect(() => readSqliteTables(troncato)).toThrow(/Varint troncato/);
  });
});

// ------------------------------------------------------------- il finto Peregrine

/** Una notifica sola: `FF 01 len 00`, il comando, il separatore. Nessun byte da raddoppiare. */
const notifica = (comando: number[]) =>
  Uint8Array.from([1, 0, 0xff, 0x01, comando.length + 1, 0x00, ...comando, 0xc0]);

/** Il carico delle risposte, senza l'intestazione delle notifiche, lo SLIP e `01 FF len 00`. */
function risposte(uscita: Uint8Array | Uint8Array[] | undefined): number[][] {
  const notifiche = uscita === undefined ? [] : Array.isArray(uscita) ? uscita : [uscita];
  const pacchetti: number[][] = [];
  let corrente: number[] = [];
  let fuga = false;
  for (const c of notifiche.flatMap((n) => [...n.subarray(2)])) {
    if (fuga) {
      corrente.push(c === 0xdc ? 0xc0 : 0xdb);
      fuga = false;
    } else if (c === 0xdb) fuga = true;
    else if (c === 0xc0) {
      if (corrente.length) pacchetti.push(corrente.slice(4));
      corrente = [];
    } else corrente.push(c);
  }
  return pacchetti;
}

describe('finto Peregrine: quello che non ha lo rifiuta col NAK', () => {
  /*
   * `logs[i]` fuori dall'elenco arrivava indefinito a `comprimi`, e il finto
   * cadeva con «Cannot read properties of undefined (reading 'slice')» dentro
   * la scrittura del driver. Misurato con quattro immersioni in memoria —
   * l'indirizzo della quarta, nel manifesto del finto, torna a zero — lo
   * scarico intero finiva con quel messaggio come errore, cioè un guasto del
   * finto che sembrava del driver.
   */
  const unaImmersione = () => fintoPeregrine([logPnfSintetico(1_750_000_000, 200)]);

  it('l’indirizzo di un’immersione che non c’è dà «fuori limite»', () => {
    // UPLOAD_INIT all'indirizzo della quinta immersione, su una memoria che ne ha una.
    const fuori = [0x35, 0x10, 0x34, 0x80, 0x00, 0x01, 0x40, 0xff, 0xff, 0xff];
    expect(risposte(unaImmersione()(notifica(fuori), 0))).toEqual([[0x7f, 0x35, 0x31]]);
  });

  it('un UPLOAD_INIT troppo corto per portare un indirizzo, lo stesso', () => {
    expect(risposte(unaImmersione()(notifica([0x35, 0x10]), 0))).toEqual([[0x7f, 0x35, 0x31]]);
  });

  it('e l’immersione che c’è si apre come prima', () => {
    const prima = [0x35, 0x10, 0x34, 0x80, 0x00, 0x00, 0x40, 0xff, 0xff, 0xff];
    expect(risposte(unaImmersione()(notifica(prima), 0))).toEqual([[0x75, 0x10, 0x00, 0x02]]);
  });
});

// ----------------------------------------------------------------- validate-pnf

describe('validate-pnf: un database di Shearwater Cloud senza log', () => {
  const radice = fileURLToPath(new URL('..', import.meta.url));
  const cartella = mkdtempSync(join(tmpdir(), 'indici-lettori-'));
  afterAll(() => rmSync(cartella, { recursive: true, force: true }));

  it('lo dice, invece di cadere su `undefined` dopo aver stampato «0/0»', () => {
    const percorso = join(cartella, 'vuoto.db');
    // La tabella c'è, con le colonne che lo script legge: mancano solo le righe.
    const tabella =
      'create table log_data (log_id integer primary key, file_name text, ' +
      'calculated_values_from_samples text, data_bytes_1 blob, data_bytes_3 text, created_unixtime integer)';
    const crea = spawnSync(process.execPath, [
      '-e',
      `const { DatabaseSync } = require('node:sqlite');
       const db = new DatabaseSync(${JSON.stringify(percorso)});
       db.exec(${JSON.stringify(tabella)});
       db.close();`,
    ]);
    expect(crea.status).toBe(0);

    const esito = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/validate-pnf.ts', percorso], {
      cwd: radice,
      encoding: 'utf8',
    });
    expect(esito.stderr).toMatch(/Nessun log nel database/);
    expect(esito.stderr).not.toMatch(/TypeError|Cannot read properties/);
    expect(esito.status).toBe(1);
  });
});
