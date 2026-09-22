/**
 * ► IL CONTROLLO DELLE IMMAGINI DI PLAY, E LA FOTOGRAFIA CON DUE NOMI. ◄
 *
 * `scripts/controlla-play.mjs` non aveva una prova. Controllava nomi, misure,
 * rapporti e conteggi, e il 21 settembre 2026 ha passato una cartella in cui
 * `telefono-2-immersione.png` e `telefono-3-profilo.png` erano **lo stesso
 * file**, byte per byte: lo script che fotografa non aveva trovato il titolo
 * «Profilo» sul telefono ed era tornato senza dire niente. Tutto quello che il
 * controllo guardava era giusto; la cosa sbagliata stava dove non guardava.
 *
 * Qui si rifà quella cartella, in piccolo, e si guarda che adesso dica di no —
 * insieme a una cartella giusta, che deve continuare a passare, e a un
 * rapporto sbagliato di un pixel, che è la ragione per cui il controllo è nato.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  controlla,
  // @ts-expect-error — script `.mjs` senza tipi: la direttiva sta sulla riga del modulo, vedi travasoSegnalazioni.test.ts.
} from '../scripts/controlla-play.mjs';

type Esito = { righe: string[]; guai: string[] };
const controllaTipato = controlla as (cartella: string) => Esito;

function blocco(tipo: string, dati: Buffer): Buffer {
  const lunghezza = Buffer.alloc(4);
  lunghezza.writeUInt32BE(dati.length);
  return Buffer.concat([lunghezza, Buffer.from(tipo, 'latin1'), dati, Buffer.alloc(4)]);
}

/** Firma, `IHDR` e un `IDAT` col nome dentro, perché due file non siano gemelli per caso. */
function png(larghezza: number, altezza: number, contenuto: string): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(larghezza, 0);
  ihdr.writeUInt32BE(altezza, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    blocco('IHDR', ihdr),
    blocco('IDAT', Buffer.from(contenuto)),
    blocco('IEND', Buffer.alloc(0)),
  ]);
}

/** La cartella del 21 settembre, com'era da scattare: sei scene per il telefono. */
function buona(): Map<string, Buffer> {
  const f = new Map<string, Buffer>([
    ['icona-512.png', png(512, 512, 'icona')],
    ['feature-graphic-1024x500.png', png(1024, 500, 'banner')],
  ]);
  for (const scena of [
    '1-logbook',
    '2-immersione',
    '3-profilo',
    '4-statistiche',
    '5-suggerimenti',
    '6-gas',
  ]) {
    f.set(`telefono-${scena}.png`, png(1080, 1920, `telefono ${scena}`));
    f.set(`tablet7-${scena}.png`, png(1920, 1080, `tablet7 ${scena}`));
    f.set(`tablet10-${scena}.png`, png(2560, 1440, `tablet10 ${scena}`));
  }
  return f;
}

function guaiDi(file: Map<string, Buffer>): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'play-'));
  for (const [nome, dati] of file) writeFileSync(join(dir, nome), dati);
  return controllaTipato(dir).guai;
}

describe('il controllo delle immagini di Play', () => {
  it('una cartella giusta passa', () => {
    expect(guaiDi(buona())).toEqual([]);
  });

  it('un pixel di troppo rompe il 9:16, e il controllo lo dice col nome del file', () => {
    const f = buona();
    f.set('telefono-4-statistiche.png', png(1080, 1921, 'alta'));
    expect(guaiDi(f)).toEqual(['telefono-4-statistiche.png: non è 16:9 né 9:16']);
  });

  it('la stessa fotografia con due nomi non passa — il caso vero del 21 settembre', () => {
    const f = buona();
    f.set('telefono-3-profilo.png', f.get('telefono-2-immersione.png')!);
    expect(guaiDi(f)).toEqual([
      'telefono-3-profilo.png: identica byte per byte a telefono-2-immersione.png — la stessa fotografia con due nomi',
    ]);
  });
});
