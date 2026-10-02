/**
 * I pixel di un PNG, per le prove che devono GUARDARE un'immagine.
 *
 * Solo quello che escono da Chromium e da `tauri icon`: 8 bit per canale,
 * RGB o RGBA, non interlacciato. Qualunque altra cosa è un errore e non un
 * tentativo: una prova che decodifica male passa o fallisce per il motivo
 * sbagliato, e qui conta il motivo. Il gemello completo, che legge anche quello
 * che gradle ricomprime, sta in `scripts/icona-nel-pacchetto.py` ed è stato
 * confrontato con Pillow su tutti i 434 PNG dei pacchetti della 1.8.31.
 */

import { inflateSync } from 'node:zlib';

export interface Immagine {
  larghezza: number;
  altezza: number;
  /** RGBA, riga per riga. */
  rgba: Uint8Array;
}

export function leggiPng(dati: Buffer): Immagine {
  if (!dati.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('non è un PNG');
  let pos = 8;
  let larghezza = 0;
  let altezza = 0;
  let canali = 0;
  const idat: Buffer[] = [];
  while (pos < dati.length) {
    const lunghezza = dati.readUInt32BE(pos);
    const tipo = dati.toString('latin1', pos + 4, pos + 8);
    const corpo = dati.subarray(pos + 8, pos + 8 + lunghezza);
    pos += 12 + lunghezza;
    if (tipo === 'IHDR') {
      larghezza = corpo.readUInt32BE(0);
      altezza = corpo.readUInt32BE(4);
      const [profondita, colore, , , interlacciato] = corpo.subarray(8, 13);
      if (profondita !== 8 || (colore !== 2 && colore !== 6) || interlacciato !== 0) {
        throw new Error(
          `PNG non gestito qui: ${profondita} bit, colore ${colore}, interlacciato ${interlacciato}`,
        );
      }
      canali = colore === 6 ? 4 : 3;
    } else if (tipo === 'IDAT') idat.push(corpo);
    else if (tipo === 'IEND') break;
  }
  const grezzo = inflateSync(Buffer.concat(idat));
  const perRiga = larghezza * canali;
  const righe = new Uint8Array(altezza * perRiga);
  for (let y = 0; y < altezza; y++) {
    const filtro = grezzo[y * (perRiga + 1)];
    for (let x = 0; x < perRiga; x++) {
      const v = grezzo[y * (perRiga + 1) + 1 + x]!;
      const a = x >= canali ? righe[y * perRiga + x - canali]! : 0;
      const b = y > 0 ? righe[(y - 1) * perRiga + x]! : 0;
      const c = x >= canali && y > 0 ? righe[(y - 1) * perRiga + x - canali]! : 0;
      let p = 0;
      if (filtro === 1) p = a;
      else if (filtro === 2) p = b;
      else if (filtro === 3) p = Math.floor((a + b) / 2);
      else if (filtro === 4) {
        const s = a + b - c;
        const [pa, pb, pc] = [Math.abs(s - a), Math.abs(s - b), Math.abs(s - c)];
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      righe[y * perRiga + x] = (v + p) & 255;
    }
  }
  const rgba = new Uint8Array(larghezza * altezza * 4);
  for (let i = 0; i < larghezza * altezza; i++) {
    rgba[i * 4] = righe[i * canali]!;
    rgba[i * 4 + 1] = righe[i * canali + 1]!;
    rgba[i * 4 + 2] = righe[i * canali + 2]!;
    rgba[i * 4 + 3] = canali === 4 ? righe[i * canali + 3]! : 255;
  }
  return { larghezza, altezza, rgba };
}
