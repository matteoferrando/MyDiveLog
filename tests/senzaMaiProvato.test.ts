/**
 * ► LA FRASE CHE DICE «NON L'ABBIAMO PROVATO» NON SI SCRIVE, DA NESSUNA PARTE. ◄
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Decisione del proprietario, 23 settembre 2026. Fino a quel giorno, sotto ogni
 * modello che passa da libdivecomputer e che nessuno aveva ancora acceso, il
 * selettore diceva che non era stato provato; l'aiuto del sito lo ripeteva in
 * due lingue, e il README lo citava. Era vero, e c'erano buone ragioni per
 * dirlo. Ma detto sotto ogni nome, a chi sta per collegare il suo computer, non
 * informa: scoraggia.
 *
 * Adesso il selettore scrive la strada, «via libdivecomputer», che è un fatto e
 * porta l'attribuzione che la LGPL chiede; «provato su questo modello» si
 * aggiunge un modello per volta, quando qualcuno lo accende davvero
 * (`src/core/ble/provati.ts`, sorvegliato da `provatiSulCampo.test.ts`). Non si
 * scrive il contrario, e non si scrive nemmeno «provato» dove nessuno l'ha
 * acceso: le due regole stanno insieme.
 *
 * ► PERCHÉ UNA PROVA E NON SOLO UNA CORREZIONE. ◄ Una frase tolta da un posto
 * torna da un altro: era in quattro file diversi, scritti in giorni diversi.
 * Questa guarda tutto quello che qualcuno può leggere — il sorgente dell'app e
 * del guscio Rust (commenti compresi: il repository è pubblico, e il diario
 * nasce lì), il sito, i due LEGGIMI, e i testi della versione che si sta per
 * pubblicare. Non guarda la storia: le note e i testi delle versioni già
 * uscite restano come sono stati pubblicati, e `docs/stato-progetto.md`
 * racconta quello che è successo, non quello che si scrive oggi.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RADICE = fileURLToPath(new URL('..', import.meta.url));

/**
 * Le forme della frase, in italiano e in inglese. Fra le parole può esserci un
 * a capo, e dentro un commento anche l'asterisco della riga dopo: una frase
 * spezzata dall'impaginazione è la stessa frase.
 */
const VIETATE: RegExp[] = [
  /mai[\s*/]+provat/gi,
  /mai[\s*/]+stat[aeio][\s*/]+provat/gi,
  /never[\s*/]+(?:been[\s*/]+)?tested/gi,
  /\buntested\b/gi,
];

const ESTENSIONI = /\.(?:ts|tsx|mjs|js|rs|html|css|json|md|txt|xml|gs)$/;

/** I file di una cartella e delle sue sottocartelle, relativi alla radice. */
function giro(cartella: string, raccolti: string[] = []): string[] {
  for (const nome of readdirSync(join(RADICE, cartella))) {
    const percorso = join(cartella, nome);
    if (statSync(join(RADICE, percorso)).isDirectory()) giro(percorso, raccolti);
    else if (ESTENSIONI.test(nome)) raccolti.push(percorso);
  }
  return raccolti;
}

/** Tutto quello che si legge: il codice, il sito, i LEGGIMI, i testi di questa versione. */
function daGuardare(): string[] {
  const { version } = JSON.parse(readFileSync(join(RADICE, 'package.json'), 'utf8')) as { version: string };
  const documenti = readdirSync(join(RADICE, 'docs'))
    .filter((f) => f.includes(`-${version}`) || f.includes(`-v${version}`))
    .map((f) => join('docs', f));
  return [
    ...giro('src'),
    ...giro('src-tauri/src'),
    ...giro('sito'),
    ...giro('linux'),
    'README.md',
    ...documenti,
  ];
}

describe('la frase che dice «non l’abbiamo provato»', () => {
  const file = daGuardare();

  it('si cerca davvero dove si legge', () => {
    // Un giro rotto troverebbe zero file e quindi zero frasi: verde per niente.
    expect(file.length).toBeGreaterThan(150);
    for (const atteso of [
      join('src', 'ui', 'traduzioni.ts'),
      join('src', 'ui', 'components', 'ScegliComputer.tsx'),
      join('sito', 'aiuto.html'),
      join('sito', 'en', 'help.html'),
      join('linux', 'LEGGIMI.md'),
      'README.md',
    ]) {
      expect(file, atteso).toContain(atteso);
    }
    expect(
      file.some((f) => f.includes('RELEASE-v')),
      'le note della versione che si pubblica',
    ).toBe(true);
    expect(
      file.some((f) => f.endsWith('.rs')),
      'il guscio Rust',
    ).toBe(true);
  });

  it('non compare da nessuna parte', () => {
    const trovate: string[] = [];
    for (const f of file) {
      const testo = readFileSync(join(RADICE, f), 'utf8');
      for (const forma of VIETATE) {
        for (const m of testo.matchAll(forma)) {
          const riga = testo.slice(0, m.index).split('\n').length;
          trovate.push(`${f}:${riga}: «${m[0].replace(/\s+/g, ' ')}»`);
        }
      }
    }
    expect(trovate).toEqual([]);
  });
});
