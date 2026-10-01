/**
 * ► HOMEBREW E LA FIDUCIA NEI TAP: LE ISTRUZIONI COL NOME INTERO. ◄
 *
 * Homebrew non carica più le cask dei tap che non sono suoi finché qualcuno non
 * le dichiara fidate. Le istruzioni che il sito, il README e il tap davano fino
 * al 1° ottobre 2026 — il tap, e poi l'installazione col nome corto — si
 * fermavano con *«Refusing to load cask matteoferrando/mydivelog/mydivelog
 * from untrusted tap matteoferrando/mydivelog»*. Se n'è accorto il
 * proprietario, con un `brew upgrade` sul suo Mac: nessuna prova lo vedeva.
 *
 * Misurato con Homebrew allo stesso commit di quel Mac (7.0.7-72-gd6ca355), in
 * un contenitore Linux, da capo ogni volta:
 *
 *   - `brew tap matteoferrando/mydivelog` va; l'installazione col nome corto,
 *     subito dopo, è il rifiuto qui sopra;
 *   - `brew install --cask matteoferrando/mydivelog/mydivelog` aggiunge il tap,
 *     scrive *«Trusted cask matteoferrando/mydivelog/mydivelog»* — e la
 *     fiducia resta, `brew trust` la elenca — e si ferma solo su *«This cask
 *     requires macOS»*, cioè dove una cask per Mac deve fermarsi su Linux;
 *   - `brew info`, `brew fetch` e `brew audit` col nome intero caricano la
 *     cask anche senza fiducia: i comandi del rilascio (README) e il passo
 *     `brew audit` del flusso che aggiorna la cask non cambiano.
 *
 * Quindi un comando solo, col nome intero, per chi installa; e una riga, una
 * volta, per chi aveva installato col tap: `brew trust --cask …`. Senza, il suo
 * Homebrew ignora la cask — l'app no: si aggiorna da sola, la cask dichiara
 * `auto_updates`.
 *
 * Il nome intero non si scrive a mano qui: si ricava dalla cask (`cask "…"`) e
 * dal nome del repository del tap, così una cask che cambiasse nome farebbe
 * diventare rosse le istruzioni rimaste indietro invece di lasciarle sbagliate.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const leggi = (file: string) => readFileSync(`${RADICE}${file}`, 'utf8');

/** I posti dove qualcuno legge come installare con Homebrew. */
const DOVE = ['README.md', 'sito/aiuto.html', 'sito/en/help.html', 'homebrew/README-del-tap.md'] as const;

/** Gli spazi tutti uguali: prettier manda a capo dentro un `<code>` quando vuole. */
const piano = (testo: string) => testo.replace(/\s+/g, ' ');

const CASK = leggi('homebrew/mydivelog.rb');
const NOME = /^cask "([^"]+)" do$/m.exec(CASK)?.[1];
/** `matteoferrando/homebrew-mydivelog` è il tap `matteoferrando/mydivelog`. */
const TAP = /github\.com\/(\w+)\/homebrew-([\w-]+)/.exec(leggi('homebrew/LEGGIMI.md'));
const NOME_INTERO = `${TAP?.[1]}/${TAP?.[2]}/${NOME}`;

describe('le istruzioni di Homebrew reggono la fiducia nei tap', () => {
  it('il nome intero si ricava dalla cask e dal tap', () => {
    expect(NOME, 'la cask non dichiara più `cask "…" do`').toBe('mydivelog');
    expect(NOME_INTERO).toBe('matteoferrando/mydivelog/mydivelog');
  });

  it.each(DOVE)('%s installa col nome intero, in un comando solo', (file) => {
    expect(piano(leggi(file))).toContain(`brew install --cask ${NOME_INTERO}`);
  });

  it.each(DOVE)('%s non dice più di installare col nome corto', (file) => {
    /*
     * Il nome corto dopo un `brew tap` è proprio il comando che Homebrew
     * rifiuta. Nessuna eccezione per le spiegazioni: chi copia un comando da
     * un testo non legge la frase intorno.
     */
    const corto = new RegExp(`brew install --cask ${NOME}(?![\\w/-])`);
    expect(piano(leggi(file))).not.toMatch(corto);
  });

  it.each(DOVE)('%s dice a chi aveva già installato come dare fiducia', (file) => {
    expect(piano(leggi(file))).toContain(`brew trust --cask ${NOME_INTERO}`);
  });
});
