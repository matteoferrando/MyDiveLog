/**
 * Lettore di file SQLite, in sola lettura, senza dipendenze.
 *
 * Serve per il database di Shearwater Cloud, che è un vero file SQLite. La
 * strada ovvia sarebbe `sql.js` o `@sqlite.org/sqlite-wasm`: circa 1,5 MB di
 * WebAssembly per fare `SELECT * FROM due_tabelle`. Qui non serve un motore SQL,
 * serve leggere le righe di due tabelle — e il formato del file SQLite è
 * documentato e stabile da vent'anni.
 *
 * Quindi: nessun WASM da caricare, nessun asset da configurare nel bundler,
 * funziona identico su desktop, iOS e web. Il prezzo è questo file, ed è un
 * prezzo che si paga una volta.
 *
 * COSA IMPLEMENTA (abbastanza per leggere una tabella per intero):
 *  - intestazione del database: dimensione pagina, codifica del testo;
 *  - `sqlite_master` per trovare la radice di ogni tabella e il suo CREATE;
 *  - alberi B delle tabelle: pagine interne (tipo 5) e foglia (tipo 13);
 *  - formato dei record: varint, tipi seriali, payload;
 *  - catene di pagine di overflow, indispensabili qui perché i profili
 *    compressi di Shearwater sono blob da oltre 10 KB e non stanno in una pagina.
 *
 * COSA NON IMPLEMENTA, deliberatamente: nessuna query, nessun indice, nessun
 * join, nessuna scrittura, nessun WAL. Se un file avesse modifiche non ancora
 * riversate in un `-wal` separato, quelle non si vedrebbero — per un export
 * scaricato dall'app non succede, e in ogni caso è meglio saperlo che
 * scoprirlo dopo.
 *
 * Verificato riga per riga e colonna per colonna contro `sqlite3` su un
 * database Shearwater Cloud reale.
 */

export type SqlValue = number | string | Uint8Array | null;
export type SqlRow = Record<string, SqlValue>;

const HEADER_MAGIC = 'SQLite format 3\0';

export function isSqlite(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false;
  for (let i = 0; i < HEADER_MAGIC.length; i++) {
    if (bytes[i] !== HEADER_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

interface DbInfo {
  pageSize: number;
  /** 1 = UTF-8, 2 = UTF-16LE, 3 = UTF-16BE. */
  encoding: number;
  reservedSpace: number;
}

function readHeader(bytes: Uint8Array): DbInfo {
  if (!isSqlite(bytes)) throw new Error('Non è un file SQLite (firma iniziale assente).');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // La dimensione pagina 1 significa 65536: sta in 16 bit e 65536 non ci sta.
  const raw = view.getUint16(16);
  const pageSize = raw === 1 ? 65536 : raw;
  if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0) {
    throw new Error(`Dimensione pagina non valida: ${pageSize}.`);
  }
  return {
    pageSize,
    encoding: view.getUint32(56) || 1,
    reservedSpace: bytes[20],
  };
}

/** Varint big-endian di SQLite: 1..9 byte, 7 bit utili per byte. */
function readVarint(bytes: Uint8Array, at: number): { value: number; length: number } {
  let value = 0;
  for (let i = 0; i < 8; i++) {
    const b = bytes[at + i];
    if (b === undefined) throw new Error('Varint troncato: file corrotto o incompleto.');
    // Number invece di BigInt: i valori che ci interessano (rowid, lunghezze,
    // tipi seriali) stanno largamente sotto 2^53.
    value = value * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) return { value, length: i + 1 };
  }
  // Nono byte: contribuisce tutti gli 8 bit.
  return { value: value * 256 + bytes[at + 8], length: 9 };
}

/**
 * Ricompone il payload di un record seguendo la catena di overflow.
 *
 * È la parte che non si può saltare: SQLite tiene nella pagina solo i primi
 * byte di un record grande e mette il resto in pagine collegate. I blob dei
 * profili Shearwater sono da 11 KB su pagine da 4 KB, quindi senza questo
 * ogni profilo arriverebbe tagliato — e tagliato in silenzio.
 */
function readPayload(
  bytes: Uint8Array,
  info: DbInfo,
  cellStart: number,
  payloadSize: number,
  usable: number,
): Uint8Array {
  const maxLocal = usable - 35;
  if (payloadSize <= maxLocal) {
    return bytes.subarray(cellStart, cellStart + payloadSize);
  }

  // ARITMETICA INTERA, non in virgola mobile. SQLite calcola questa soglia con
  // una divisione fra interi, e riprodurla con i float sbaglia di un byte: per
  // pagine da 512 il valore giusto è 415, ma `39.745 + 375.255` in doppia
  // precisione fa 414.99999999999994 e l'arrotondamento verso il basso dà 414.
  // Un byte di scarto sposta il puntatore alla pagina di overflow, che viene
  // letto come 0, e il blob esce TRONCATO senza nessun errore. Con dati tutti a
  // zero non si nota nemmeno: sembra corretto.
  const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23;
  let local = minLocal + ((payloadSize - minLocal) % (usable - 4));
  if (local > maxLocal) local = minLocal;

  const out = new Uint8Array(payloadSize);
  out.set(bytes.subarray(cellStart, cellStart + local), 0);
  let written = local;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let nextPage = view.getUint32(cellStart + local);
  let guard = 0;
  while (nextPage > 0 && written < payloadSize) {
    if (++guard > 100_000) throw new Error('Catena di overflow senza fine: file corrotto.');
    const base = (nextPage - 1) * info.pageSize;
    if (base + 4 > bytes.length) throw new Error('Pagina di overflow fuori dal file.');
    const chunk = Math.min(usable - 4, payloadSize - written);
    out.set(bytes.subarray(base + 4, base + 4 + chunk), written);
    written += chunk;
    nextPage = view.getUint32(base);
  }
  return out;
}

function decodeText(bytes: Uint8Array, encoding: number): string {
  if (encoding === 1) return new TextDecoder('utf-8').decode(bytes);
  return new TextDecoder(encoding === 2 ? 'utf-16le' : 'utf-16be').decode(bytes);
}

/** Decodifica un record: intestazione con i tipi seriali, poi i valori. */
function decodeRecord(payload: Uint8Array, encoding: number, rowid: number): SqlValue[] {
  const headerStart = readVarint(payload, 0);
  const headerSize = headerStart.value;
  const serials: number[] = [];
  let at = headerStart.length;
  while (at < headerSize) {
    const v = readVarint(payload, at);
    serials.push(v.value);
    at += v.length;
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const values: SqlValue[] = [];
  let body = headerSize;

  for (const serial of serials) {
    switch (serial) {
      case 0:
        // NULL, oppure — nella colonna INTEGER PRIMARY KEY — il rowid stesso.
        values.push(null);
        break;
      case 1:
        values.push(view.getInt8(body));
        body += 1;
        break;
      case 2:
        values.push(view.getInt16(body));
        body += 2;
        break;
      case 3:
        values.push((view.getInt8(body) << 16) | view.getUint16(body + 1));
        body += 3;
        break;
      case 4:
        values.push(view.getInt32(body));
        body += 4;
        break;
      case 5: {
        // 48 bit con segno.
        const hi = view.getInt16(body);
        const lo = view.getUint32(body + 2);
        values.push(hi * 2 ** 32 + lo);
        body += 6;
        break;
      }
      case 6: {
        const big = view.getBigInt64(body);
        values.push(Number(big));
        body += 8;
        break;
      }
      case 7:
        values.push(view.getFloat64(body));
        body += 8;
        break;
      case 8:
        values.push(0);
        break;
      case 9:
        values.push(1);
        break;
      case 10:
      case 11:
        values.push(null); // riservati, non usati dai file reali
        break;
      default: {
        const size = Math.floor((serial - 12) / 2);
        const slice = payload.subarray(body, body + size);
        values.push(serial % 2 === 0 ? new Uint8Array(slice) : decodeText(slice, encoding));
        body += size;
      }
    }
  }
  void rowid;
  return values;
}

interface Cell {
  rowid: number;
  values: SqlValue[];
}

/** Percorre l'albero B di una tabella e restituisce tutte le celle. */
function walkTable(bytes: Uint8Array, info: DbInfo, rootPage: number): Cell[] {
  const usable = info.pageSize - info.reservedSpace;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Cell[] = [];
  const queue: number[] = [rootPage];
  const visited = new Set<number>();

  while (queue.length) {
    const page = queue.shift()!;
    if (page <= 0 || visited.has(page)) continue;
    visited.add(page);

    const base = (page - 1) * info.pageSize;
    if (base >= bytes.length) continue;
    // La pagina 1 comincia con i 100 byte di intestazione del database.
    const hdr = page === 1 ? base + 100 : base;
    const type = bytes[hdr];
    if (type !== 5 && type !== 13) continue; // non è una pagina di tabella

    const cellCount = view.getUint16(hdr + 3);
    const headerLen = type === 5 ? 12 : 8;
    const pointerArray = hdr + headerLen;

    if (type === 5) {
      // Pagina interna: i figli, più il puntatore di destra.
      queue.push(view.getUint32(hdr + 8));
      for (let i = 0; i < cellCount; i++) {
        const off = view.getUint16(pointerArray + i * 2);
        queue.push(view.getUint32(base + off));
      }
      continue;
    }

    for (let i = 0; i < cellCount; i++) {
      const off = view.getUint16(pointerArray + i * 2);
      let at = base + off;
      const size = readVarint(bytes, at);
      at += size.length;
      const rowid = readVarint(bytes, at);
      at += rowid.length;
      const payload = readPayload(bytes, info, at, size.value, usable);
      out.push({ rowid: rowid.value, values: decodeRecord(payload, info.encoding, rowid.value) });
    }
  }

  out.sort((a, b) => a.rowid - b.rowid);
  return out;
}

/**
 * Solo i nomi delle tabelle, leggendo `sqlite_master` e nient'altro.
 *
 * Serve al riconoscimento del formato: cercare i nomi come testo nei primi
 * kilobyte del file non funziona, perché `sqlite_master` può finire in pagine
 * qualsiasi — nel database di Shearwater Cloud lo schema comincia a pagina 10,
 * ben oltre qualunque finestra ragionevole da ispezionare a occhio.
 */
export function sqliteTableNames(bytes: Uint8Array): string[] {
  const info = readHeader(bytes);
  const out: string[] = [];
  for (const cell of walkTable(bytes, info, 1)) {
    const [type, name] = cell.values;
    if (type === 'table' && typeof name === 'string') out.push(name);
  }
  return out;
}

export interface SqliteTable {
  name: string;
  columns: string[];
  rows: SqlRow[];
}

/**
 * Legge le tabelle richieste (o tutte) da un file SQLite in memoria.
 * I nomi delle colonne vengono dall'istruzione `CREATE TABLE` in `sqlite_master`.
 */
export function readSqliteTables(bytes: Uint8Array, only?: string[]): Map<string, SqliteTable> {
  const info = readHeader(bytes);
  // sqlite_master ha radice a pagina 1 e colonne fisse:
  // type, name, tbl_name, rootpage, sql
  const master = walkTable(bytes, info, 1);
  const wanted = only ? new Set(only.map((n) => n.toLowerCase())) : undefined;
  const out = new Map<string, SqliteTable>();

  for (const cell of master) {
    const [type, name, , rootpage, sql] = cell.values;
    if (type !== 'table' || typeof name !== 'string') continue;
    if (wanted && !wanted.has(name.toLowerCase())) continue;
    if (typeof rootpage !== 'number' || rootpage <= 0) continue;

    const schema = parseSchema(typeof sql === 'string' ? sql : '');
    const columns = schema.columns;
    const cells = walkTable(bytes, info, rootpage);
    const rows: SqlRow[] = cells.map((c) => {
      const row: SqlRow = {};
      columns.forEach((col, i) => {
        row[col] = c.values[i] ?? null;
      });
      // Una colonna `INTEGER PRIMARY KEY` è un alias del rowid: SQLite non la
      // memorizza nel record, la lascia NULL e tiene il valore nella chiave
      // della cella. Senza questa riga quelle colonne uscirebbero tutte vuote.
      if (schema.rowidAlias && row[schema.rowidAlias] === null) {
        row[schema.rowidAlias] = c.rowid;
      }
      return row;
    });
    out.set(name, { name, columns, rows });
  }
  return out;
}

export interface TableSchema {
  columns: string[];
  /**
   * Nome della colonna che è alias del rowid (`INTEGER PRIMARY KEY`), se c'è.
   * Serve perché il suo valore non sta nel record ma nella chiave della cella.
   */
  rowidAlias?: string;
}

/** Comodità: solo i nomi delle colonne. */
export function parseColumns(sql: string): string[] {
  return parseSchema(sql).columns;
}

/**
 * Estrae nomi delle colonne e alias del rowid da `CREATE TABLE`.
 *
 * Non è un parser SQL: divide la lista delle colonne sulle virgole di primo
 * livello (rispettando parentesi e virgolette) e prende il primo identificatore
 * di ciascuna, saltando i vincoli di tabella. Basta per gli schemi reali dei
 * logbook, che sono elenchi piatti di colonne.
 */
export function parseSchema(sql: string): TableSchema {
  const open = sql.indexOf('(');
  const close = sql.lastIndexOf(')');
  if (open < 0 || close <= open) return { columns: [] };
  const body = sql.slice(open + 1, close);

  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of body) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`' || ch === '[') {
      quote = ch === '[' ? ']' : ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);

  const TABLE_CONSTRAINTS = /^(constraint|primary|unique|check|foreign)\b/i;
  const columns: string[] = [];
  const types = new Map<string, string>();
  let rowidAlias: string | undefined;
  let tablePk: string | undefined;

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (TABLE_CONSTRAINTS.test(trimmed)) {
      // Forma con vincolo di tabella: PRIMARY KEY (colonna).
      const pk = /^primary\s+key\s*\(\s*("([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][\w$]*))\s*\)$/i.exec(
        trimmed,
      );
      if (pk) tablePk = pk[2] ?? pk[3] ?? pk[4] ?? pk[5];
      continue;
    }
    const m = /^("([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][\w$]*))/.exec(trimmed);
    if (!m) continue;
    const col = m[2] ?? m[3] ?? m[4] ?? m[5];
    columns.push(col);
    const rest = trimmed.slice(m[0].length).trim();
    types.set(col, rest);
    // L'alias del rowid richiede il tipo scritto esattamente INTEGER: `INT
    // PRIMARY KEY` è una colonna normale, e `DESC` annulla l'alias.
    if (/^integer\s+primary\s+key\b/i.test(rest) && !/\bdesc\b/i.test(rest)) {
      rowidAlias = col;
    }
  }

  if (!rowidAlias && tablePk && /^integer\b/i.test(types.get(tablePk) ?? '')) {
    rowidAlias = tablePk;
  }
  return rowidAlias ? { columns, rowidAlias } : { columns };
}
