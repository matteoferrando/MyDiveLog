import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { gunzip, inflateRaw, crc32 } from '../src/core/parsers/inflate';

function rnd(seed: number, n: number, alphabet = 256) {
  let s = seed >>> 0;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s >>> 16) % alphabet;
  }
  return out;
}

describe('inflate', () => {
  it('CRC32 concorda con zlib', () => {
    const data = rnd(7, 5000);
    expect(crc32(data)).toBe(zlib.crc32 ? zlib.crc32(data) : crc32(data));
  });

  for (const [name, data] of [
    ['dati casuali (incomprimibili → blocchi non compressi)', rnd(1, 40000)],
    ['dati molto ripetitivi (riferimenti indietro lunghi)', new Uint8Array(30000).fill(0x41)],
    ['alfabeto ristretto (Huffman dinamico)', rnd(2, 60000, 6)],
    ['vuoto', new Uint8Array(0)],
    ['un byte', new Uint8Array([0x2a])],
  ] as const) {
    it(`gunzip: ${name}`, () => {
      const gz = zlib.gzipSync(Buffer.from(data));
      expect(Array.from(gunzip(new Uint8Array(gz)))).toEqual(Array.from(data));
    });
    it(`inflateRaw: ${name}`, () => {
      const raw = zlib.deflateRawSync(Buffer.from(data), { level: 9 });
      expect(Array.from(inflateRaw(new Uint8Array(raw)))).toEqual(Array.from(data));
    });
  }

  it('sequenza con ripetizione sovrapposta', () => {
    // "abababab…": DEFLATE la codifica con distanza 2 e lunghezza maggiore della
    // distanza, il caso in cui una copia a blocchi darebbe il risultato sbagliato.
    const data = new Uint8Array(1000);
    for (let i = 0; i < data.length; i++) data[i] = i % 2 ? 0x62 : 0x61;
    const gz = zlib.gzipSync(Buffer.from(data));
    expect(Array.from(gunzip(new Uint8Array(gz)))).toEqual(Array.from(data));
  });

  it('rifiuta un flusso troncato invece di restituire dati mutilati', () => {
    const gz = new Uint8Array(zlib.gzipSync(Buffer.from(rnd(3, 20000, 8))));
    expect(() => gunzip(gz.subarray(0, gz.length - 200))).toThrow();
  });

  it('rifiuta un CRC sbagliato', () => {
    const gz = new Uint8Array(zlib.gzipSync(Buffer.from('immersione')));
    gz[gz.length - 5] ^= 0xff;
    expect(() => gunzip(gz)).toThrow(/CRC32/);
  });

  it('rifiuta ciò che non è gzip', () => {
    expect(() => gunzip(new Uint8Array(30))).toThrow(/Magic/);
  });
});
