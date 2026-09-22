/**
 * ► IL CONTROLLO DELLE SCHERMATE PER L'APP STORE, VISTO DIRE DI NO. ◄
 *
 * `scripts/controlla-appstore.mjs` è l'ultima cosa che guarda le schermate prima
 * che finiscano su App Store Connect. Un controllo che non si è visto rifiutare
 * niente è un'ipotesi: qui gli si danno cartelle finte, una per ogni cosa che
 * Apple rifiuterebbe — o che Apple accetterebbe e che sarebbe comunque
 * sbagliata, come una scena che c'è in italiano e manca in inglese — e si
 * guarda che dica di no, e che dica PERCHÉ con il nome del file.
 *
 * I PNG sono finti e minuscoli: la firma, l'intestazione con le misure e il
 * tipo di colore, i blocchi fino a `IDAT`. È tutto quello che il controllo
 * legge, e un'immagine vera da 2880×1800 peserebbe megabyte senza provare
 * niente di più.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  controlla,
  // @ts-expect-error — script `.mjs` senza tipi: la direttiva sta sulla riga del modulo, vedi travasoSegnalazioni.test.ts.
} from '../scripts/controlla-appstore.mjs';

type Esito = { righe: string[]; guai: string[] };
const controllaTipato = controlla as (cartella: string) => Esito;

function blocco(tipo: string, dati: Buffer): Buffer {
  const lunghezza = Buffer.alloc(4);
  lunghezza.writeUInt32BE(dati.length);
  // Il CRC non lo legge nessuno: quattro zeri bastano a tenere il passo.
  return Buffer.concat([lunghezza, Buffer.from(tipo, 'latin1'), dati, Buffer.alloc(4)]);
}

/**
 * Un PNG ridotto all'osso: firma, `IHDR`, i blocchi chiesti, `IDAT`, `IEND`.
 *
 * `contenuto` finisce dentro `IDAT` e serve a una cosa sola: rendere diversi
 * i byte di due file della stessa misura. Il controllo rifiuta due file
 * identici — è la stessa fotografia con due nomi — e senza questo tutte le
 * schermate finte di un apparecchio sarebbero gemelle.
 */
function png(
  larghezza: number,
  altezza: number,
  contenuto: string,
  tipoColore = 2,
  extra: string[] = [],
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(larghezza, 0);
  ihdr.writeUInt32BE(altezza, 4);
  ihdr[8] = 8;
  ihdr[9] = tipoColore;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    blocco('IHDR', ihdr),
    ...extra.map((t) => blocco(t, Buffer.alloc(3))),
    blocco('IDAT', Buffer.from(contenuto)),
    blocco('IEND', Buffer.alloc(0)),
  ]);
}

const IPHONE: [number, number] = [1320, 2868];
const MAC: [number, number] = [2880, 1800];
const SCENE = ['1-logbook', '2-immersione', '3-profilo'];

/** La cartella che deve passare: tre scene, due lingue, due apparecchi. */
function buona(): Map<string, Buffer> {
  const f = new Map<string, Buffer>();
  for (const lingua of ['it', 'en'])
    for (const scena of SCENE) {
      f.set(`iphone-${lingua}-${scena}.png`, png(...IPHONE, `iphone ${lingua} ${scena}`));
      f.set(`mac-${lingua}-${scena}.png`, png(...MAC, `mac ${lingua} ${scena}`));
    }
  return f;
}

function cartella(file: Map<string, Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), 'appstore-'));
  for (const [nome, dati] of file) writeFileSync(join(dir, nome), dati);
  return dir;
}

/** I guai di una cartella ottenuta da quella buona cambiando qualcosa. */
function guaiDopo(cambia: (f: Map<string, Buffer>) => void): string[] {
  const f = buona();
  cambia(f);
  return controllaTipato(cartella(f)).guai;
}

describe('il controllo delle schermate per l’App Store', () => {
  it('una cartella giusta passa, e ogni file ha la sua riga', () => {
    const { righe, guai } = controllaTipato(cartella(buona()));
    expect(guai).toEqual([]);
    expect(righe.filter((r) => r.includes('✓'))).toHaveLength(12);
  });

  it('un pixel di troppo non passa: Apple vuole una misura dell’elenco, non un rapporto', () => {
    const guai = guaiDopo((f) => f.set('iphone-it-2-immersione.png', png(1320, 2869, 'alta')));
    expect(guai).toHaveLength(1);
    expect(guai[0]).toMatch(/iphone-it-2-immersione\.png.*1320×2869/);
  });

  it('un 16:10 perfetto che non è nell’elenco del Mac non passa', () => {
    // 1920×1200 è 16:10 esatto: il controllo di Play, che guarda il rapporto,
    // lo lascerebbe entrare. Apple no.
    const guai = guaiDopo((f) => f.set('mac-en-1-logbook.png', png(1920, 1200, '16:10')));
    expect(guai.join('\n')).toMatch(/mac-en-1-logbook\.png.*1920×1200/);
  });

  it('l’iPhone si può girare in orizzontale, il Mac in verticale no', () => {
    expect(guaiDopo((f) => f.set('iphone-it-3-profilo.png', png(2868, 1320, 'girata')))).toEqual([]);
    expect(guaiDopo((f) => f.set('mac-it-3-profilo.png', png(1800, 2880, 'girata'))).join('\n')).toMatch(
      /mac-it-3-profilo\.png/,
    );
  });

  it('la trasparenza non passa, né col canale alfa né col blocco tRNS', () => {
    const alfa = guaiDopo((f) => f.set('iphone-en-1-logbook.png', png(...IPHONE, 'alfa', 6)));
    expect(alfa.join('\n')).toMatch(/iphone-en-1-logbook\.png.*trasparen/);
    // Il caso che non si vede: RGB senza canale alfa, ma con un colore
    // dichiarato trasparente. Guardare solo il tipo di colore lo farebbe passare.
    const trns = guaiDopo((f) => f.set('mac-it-2-immersione.png', png(...MAC, 'trns', 2, ['tRNS'])));
    expect(trns.join('\n')).toMatch(/mac-it-2-immersione\.png.*trasparen/);
  });

  it('una scena che c’è in italiano e manca in inglese non passa', () => {
    const guai = guaiDopo((f) => f.delete('iphone-en-3-profilo.png'));
    expect(guai.join('\n')).toMatch(/iphone.*3-profilo/);
  });

  it('due file della stessa scena sono il residuo di una rinumerazione', () => {
    const guai = guaiDopo((f) => {
      f.set('iphone-it-4-immersione.png', png(...IPHONE, 'residuo it'));
      f.set('iphone-en-4-immersione.png', png(...IPHONE, 'residuo en'));
    });
    expect(guai.join('\n')).toMatch(/iphone-it-4-immersione\.png.*iphone-it-2-immersione\.png/);
  });

  it('più di dieci per apparecchio e lingua non passano', () => {
    const guai = guaiDopo((f) => {
      for (let n = 4; n <= 11; n++)
        for (const lingua of ['it', 'en'])
          f.set(`mac-${lingua}-${n}-scena${n}.png`, png(...MAC, `${lingua} ${n}`));
    });
    expect(guai.join('\n')).toMatch(/Mac, it: 11 schermate, il massimo è 10/);
  });

  it('un apparecchio senza schermate non passa', () => {
    const guai = guaiDopo((f) => {
      for (const nome of [...f.keys()]) if (nome.startsWith('mac-')) f.delete(nome);
    });
    expect(guai.join('\n')).toMatch(/Mac, it: nessuna schermata/);
  });

  it('un file che non è una schermata di nessun apparecchio non passa', () => {
    // Nella cartella si carica tutto quello che c'è: un file in più finisce
    // nella scheda per sbaglio, e il nome è l'unico posto dove si vede.
    const senzaLingua = guaiDopo((f) => f.set('iphone-1-logbook.png', png(...IPHONE, 'senza lingua')));
    expect(senzaLingua.join('\n')).toMatch(/iphone-1-logbook\.png/);
    const ipad = guaiDopo((f) => f.set('ipad-it-1-logbook.png', png(2064, 2752, 'ipad')));
    expect(ipad.join('\n')).toMatch(/ipad-it-1-logbook\.png/);
  });

  it('due scene identiche byte per byte non passano: la seconda non è stata raggiunta', () => {
    // Il caso vero di Play del 21 settembre: nomi diversi, misure giuste,
    // conteggio dentro il massimo — e la stessa fotografia due volte.
    const guai = guaiDopo((f) => f.set('iphone-it-3-profilo.png', f.get('iphone-it-2-immersione.png')!));
    expect(guai).toEqual([
      'iphone-it-3-profilo.png: identica byte per byte a iphone-it-2-immersione.png — la stessa fotografia con due nomi',
    ]);
  });

  it('una schermata inglese identica a quella italiana non passa: la lingua non è arrivata', () => {
    const guai = guaiDopo((f) => f.set('mac-en-1-logbook.png', f.get('mac-it-1-logbook.png')!));
    expect(guai.join('\n')).toMatch(/mac-it-1-logbook\.png: identica byte per byte a mac-en-1-logbook\.png/);
  });
});
