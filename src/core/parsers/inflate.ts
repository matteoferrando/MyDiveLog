/**
 * DEFLATE e gzip, scritti a mano (RFC 1951 e RFC 1952).
 *
 * PERCHÉ NON UNA LIBRERIA, E PERCHÉ NON `DecompressionStream`. I log nativi dei
 * computer Shearwater dentro il database di Shearwater Cloud sono compressi con
 * gzip, quindi per leggerli serve uno scompattatore. Le alternative erano tre:
 *
 *  - `DecompressionStream('gzip')`, che il browser ha già. È **asincrona**, e
 *    l'interfaccia dei parser di questo progetto è sincrona: adottarla
 *    significherebbe rendere asincrona la catena di tutti i parser per un solo
 *    formato. Ed è comunque assente su WKWebView più vecchi di Safari 16.4, cioè
 *    su iPhone che sono ancora in giro.
 *  - una dipendenza (`fflate`, `pako`): la più rapida, e la meno adatta a un
 *    codice che gira identico su tre piattaforme e che finora non ha dipendenze
 *    per leggere i formati.
 *  - questo file, ~200 righe di algoritmo del 1996 che non cambierà mai.
 *
 * La correttezza non è un'opinione: `tests/inflate.test.ts` verifica l'uscita
 * contro `zlib` di Node su dati casuali e sui casi limite (blocchi non compressi,
 * Huffman fisso, Huffman dinamico, riferimenti indietro sovrapposti), e lo script
 * di validazione la confronta sui 38 log reali dell'archivio.
 */

/** Errore di formato: dato non gzip, o flusso troncato. */
export class InflateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InflateError';
  }
}

/**
 * Scompatta un flusso gzip (RFC 1952): intestazione, DEFLATE, e verifica di CRC32
 * e lunghezza in coda.
 *
 * La verifica finale non è pignoleria: un blob troncato a metà produrrebbe
 * altrimenti un profilo plausibile e mutilato, che è il tipo di errore che poi si
 * ritrova in una statistica e non si sa da dove viene.
 */
export function gunzip(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 18) throw new InflateError('Flusso gzip troppo corto.');
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new InflateError('Magic gzip assente.');
  if (bytes[2] !== 8) throw new InflateError(`Metodo di compressione ${bytes[2]} non previsto.`);

  const flags = bytes[3];
  let pos = 10;
  if (flags & 0x04) {
    // FEXTRA
    const extraLen = bytes[pos] | (bytes[pos + 1] << 8);
    pos += 2 + extraLen;
  }
  if (flags & 0x08) pos = skipZeroTerminated(bytes, pos); // FNAME
  if (flags & 0x10) pos = skipZeroTerminated(bytes, pos); // FCOMMENT
  if (flags & 0x02) pos += 2; // FHCRC
  if (pos >= bytes.length) throw new InflateError('Intestazione gzip incompleta.');

  // Il piede (CRC32 e lunghezza) va cercato dove FINISCE il flusso compresso, non
  // in fondo al buffer: i blob di Shearwater Cloud hanno del riempimento dopo il
  // gzip, e leggere gli ultimi quattro byte del buffer dava lunghezza zero.
  const { out, bytesRead } = inflateRawTracked(bytes.subarray(pos));
  const trailer = pos + bytesRead;
  if (trailer + 8 > bytes.length) throw new InflateError('Piede gzip mancante.');

  const expectedSize = readU32LE(bytes, trailer + 4);
  if (out.length !== expectedSize) {
    throw new InflateError(`Lunghezza attesa ${expectedSize}, ottenuta ${out.length}.`);
  }
  const expectedCrc = readU32LE(bytes, trailer);
  const actualCrc = crc32(out);
  if (actualCrc !== expectedCrc) {
    throw new InflateError(
      `CRC32 non corrisponde (atteso ${expectedCrc.toString(16)}, calcolato ${actualCrc.toString(16)}).`,
    );
  }
  return out;
}

function skipZeroTerminated(bytes: Uint8Array, from: number): number {
  let i = from;
  while (i < bytes.length && bytes[i] !== 0) i++;
  return i + 1;
}

const readU32LE = (b: Uint8Array, at: number) =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

// ---------------------------------------------------------------------------
// DEFLATE (RFC 1951)
// ---------------------------------------------------------------------------

/** Basi e bit extra delle lunghezze, codici 257..285. */
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
/** Basi e bit extra delle distanze, codici 0..29. */
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
/** Ordine in cui sono scritte le lunghezze dei codici dell'albero dei codici. */
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/**
 * Albero di Huffman canonico in forma di tabelle piatte.
 *
 * `counts[l]` = quanti codici hanno lunghezza `l`; `symbols` = i simboli ordinati
 * per lunghezza. La decodifica scorre bit per bit sommando: è l'algoritmo
 * dell'appendice di RFC 1951, lento in teoria e in pratica irrilevante — questi
 * blob sono da 13 KB, non da 13 MB — e molto più facile da leggere di una tabella
 * di lookup a più livelli.
 */
interface Huffman {
  counts: Int32Array;
  symbols: Int32Array;
}

function buildHuffman(lengths: Uint8Array | number[], n: number): Huffman {
  const counts = new Int32Array(16);
  for (let i = 0; i < n; i++) counts[lengths[i]]++;
  counts[0] = 0;

  const offsets = new Int32Array(16);
  for (let l = 1; l < 16; l++) offsets[l] = offsets[l - 1] + counts[l - 1];

  const symbols = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
  }
  return { counts, symbols };
}

class BitReader {
  private bitBuf = 0;
  private bitCount = 0;
  private pos = 0;

  constructor(private readonly data: Uint8Array) {}

  /** `n` bit, LSB per primo. */
  bits(n: number): number {
    while (this.bitCount < n) {
      if (this.pos >= this.data.length) throw new InflateError('Flusso DEFLATE troncato.');
      this.bitBuf |= this.data[this.pos++] << this.bitCount;
      this.bitCount += 8;
    }
    const value = this.bitBuf & ((1 << n) - 1);
    this.bitBuf >>>= n;
    this.bitCount -= n;
    return value;
  }

  /** Allinea al byte successivo, per i blocchi non compressi. */
  align(): void {
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  byteAt(i: number): number {
    if (i >= this.data.length) throw new InflateError('Flusso DEFLATE troncato.');
    return this.data[i];
  }

  get bytePos(): number {
    return this.pos;
  }

  /** Byte interi consumati: quelli letti meno quelli ancora nel buffer dei bit. */
  get bytesConsumed(): number {
    return this.pos - Math.floor(this.bitCount / 8);
  }

  set bytePos(v: number) {
    this.pos = v;
  }

  decode(table: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= this.bits(1);
      const count = table.counts[len];
      if (code - first < count) return table.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new InflateError('Codice di Huffman non valido.');
  }
}

/** Alberi fissi (RFC 1951 §3.2.6), costruiti una volta sola. */
let fixedTables: { literal: Huffman; distance: Huffman } | null = null;
function fixed() {
  if (fixedTables) return fixedTables;
  const lit = new Uint8Array(288);
  for (let i = 0; i < 144; i++) lit[i] = 8;
  for (let i = 144; i < 256; i++) lit[i] = 9;
  for (let i = 256; i < 280; i++) lit[i] = 7;
  for (let i = 280; i < 288; i++) lit[i] = 8;
  const dist = new Uint8Array(30).fill(5);
  fixedTables = { literal: buildHuffman(lit, 288), distance: buildHuffman(dist, 30) };
  return fixedTables;
}

/**
 * DEFLATE grezzo, senza intestazioni.
 *
 * `expectedSize`, quando noto, dimensiona il buffer di uscita in un colpo: gzip lo
 * porta in coda, e usarlo evita di raddoppiare e ricopiare un buffer per un dato
 * di cui si conosce già la lunghezza esatta.
 */
export function inflateRaw(bytes: Uint8Array, expectedSize?: number): Uint8Array {
  return inflateRawTracked(bytes, expectedSize).out;
}

/**
 * Come `inflateRaw`, ma dice anche quanti byte del buffer sono stati consumati:
 * serve a gzip per sapere dove sta il piede quando dopo il flusso c'è altro.
 */
export function inflateRawTracked(
  bytes: Uint8Array,
  expectedSize?: number,
): { out: Uint8Array; bytesRead: number } {
  const reader = new BitReader(bytes);
  let out = new Uint8Array(expectedSize && expectedSize > 0 ? expectedSize : 1024);
  let len = 0;

  const ensure = (extra: number) => {
    if (len + extra <= out.length) return;
    let size = out.length * 2;
    while (size < len + extra) size *= 2;
    const bigger = new Uint8Array(size);
    bigger.set(out.subarray(0, len));
    out = bigger;
  };

  for (;;) {
    const last = reader.bits(1);
    const type = reader.bits(2);

    if (type === 0) {
      // Blocco non compresso: lunghezza e complemento, poi i byte grezzi.
      reader.align();
      const p = reader.bytePos;
      const blockLen = reader.byteAt(p) | (reader.byteAt(p + 1) << 8);
      const nlen = reader.byteAt(p + 2) | (reader.byteAt(p + 3) << 8);
      if ((blockLen ^ 0xffff) !== nlen) throw new InflateError('Blocco non compresso incoerente.');
      reader.bytePos = p + 4;
      ensure(blockLen);
      for (let i = 0; i < blockLen; i++) out[len++] = reader.byteAt(reader.bytePos + i);
      reader.bytePos += blockLen;
    } else if (type === 1 || type === 2) {
      let literal: Huffman;
      let distance: Huffman;
      if (type === 1) {
        ({ literal, distance } = fixed());
      } else {
        const hlit = reader.bits(5) + 257;
        const hdist = reader.bits(5) + 1;
        const hclen = reader.bits(4) + 4;
        const codeLengths = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) codeLengths[CODE_LENGTH_ORDER[i]] = reader.bits(3);
        const codeTable = buildHuffman(codeLengths, 19);

        const lengths = new Uint8Array(hlit + hdist);
        let i = 0;
        while (i < lengths.length) {
          const sym = reader.decode(codeTable);
          if (sym < 16) {
            lengths[i++] = sym;
          } else if (sym === 16) {
            if (i === 0) throw new InflateError('Ripetizione senza lunghezza precedente.');
            const prev = lengths[i - 1];
            const repeat = 3 + reader.bits(2);
            for (let r = 0; r < repeat && i < lengths.length; r++) lengths[i++] = prev;
          } else if (sym === 17) {
            i += 3 + reader.bits(3);
          } else {
            i += 11 + reader.bits(7);
          }
        }
        if (i > lengths.length) throw new InflateError('Tabella delle lunghezze oltre il limite.');
        literal = buildHuffman(lengths.subarray(0, hlit), hlit);
        distance = buildHuffman(lengths.subarray(hlit), hdist);
      }

      for (;;) {
        const sym = reader.decode(literal);
        if (sym < 256) {
          ensure(1);
          out[len++] = sym;
        } else if (sym === 256) {
          break;
        } else {
          const li = sym - 257;
          if (li >= LENGTH_BASE.length) throw new InflateError(`Codice di lunghezza ${sym} non valido.`);
          const length = LENGTH_BASE[li] + reader.bits(LENGTH_EXTRA[li]);
          const di = reader.decode(distance);
          if (di >= DIST_BASE.length) throw new InflateError(`Codice di distanza ${di} non valido.`);
          const dist = DIST_BASE[di] + reader.bits(DIST_EXTRA[di]);
          if (dist > len) throw new InflateError('Riferimento indietro oltre l’inizio dei dati.');
          ensure(length);
          // Copia byte per byte di proposito: quando `dist < length` la copia
          // DEVE leggere i byte appena scritti (è così che DEFLATE codifica le
          // ripetizioni), e `copyWithin` con intervalli sovrapposti non lo fa.
          let from = len - dist;
          for (let i = 0; i < length; i++) out[len++] = out[from++];
        }
      }
    } else {
      throw new InflateError('Tipo di blocco 3 riservato.');
    }

    if (last) break;
  }

  return { out: out.subarray(0, len), bytesRead: reader.bytesConsumed };
}

// ---------------------------------------------------------------------------
// CRC32
// ---------------------------------------------------------------------------

let crcTable: Uint32Array | null = null;
function crc32Table(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(bytes: Uint8Array): number {
  const table = crc32Table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
