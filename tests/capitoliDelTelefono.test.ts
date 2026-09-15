/**
 * I CAPITOLI CHE SI APRONO: che ci sia il numero, e che le chiavi siano diverse.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTO FILE NASCE OGGI, 15 SETTEMBRE 2026. ◄
 *
 * `CartaApribile` esiste da stamattina e porta scritta in testa la regola che la
 * rende utile: *un riquadro chiuso deve dire abbastanza da far decidere se
 * aprirlo.* Poi si è contato, e il conto era questo: **su ventitré riquadri
 * apribili, ventitré erano senza `sommario`.** Quindici nelle Statistiche,
 * cinque nella scheda di un'immersione, due nei Suggerimenti, uno nel
 * pianificatore. La regola valeva per una carta su sedici.
 *
 * Il rimedio principale non è qui: `sommario` è diventato **obbligatorio nel
 * tipo**, e il compilatore rifiuta un riquadro senza. Una guardia che sta nel
 * tipo è meglio di una che sta in una prova, perché non si può lasciare rossa
 * «per adesso».
 *
 * Qui resta quello che un tipo non può vedere.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Tutti i sorgenti dell'interfaccia, in profondità. */
function sorgenti(dir: string): string[] {
  const fuori: string[] = [];
  for (const voce of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, voce.name);
    if (voce.isDirectory()) fuori.push(...sorgenti(p));
    else if (voce.name.endsWith('.tsx') || voce.name.endsWith('.ts')) fuori.push(p);
  }
  return fuori;
}

/**
 * Ogni apertura di `<CartaApribile …>` con il suo file e il testo del tag.
 *
 * ► TROVARE IL `>` CHE CHIUDE È PIÙ DIFFICILE DI QUANTO SEMBRI, e le prime due
 *   versioni di questa funzione hanno sbagliato tutte e due. ◄
 *
 * Un `indexOf('>')` si ferma dentro la prima espressione che contiene una
 * freccia — `(punto) => punto.value` — cioè quasi sempre. Contando le parentesi
 * graffe si sistema quello, e si inciampa nel secondo: i commenti. In questo
 * progetto ogni attributo ha il suo, e dentro ci sono `from >= limite` e
 * `periods.length >= 2`, che sono maggiori a profondità zero. Misurato: la prova
 * segnalava «manca `sommario`» su due riquadri che ce l'avevano, perché il tag
 * le finiva a metà.
 *
 * Quindi si saltano i commenti di blocco e le stringhe, oltre a contare le
 * graffe. *Una prova che sbaglia a leggere il sorgente non misura il sorgente:
 * misura sé stessa.*
 */
function apribili(): { file: string; tag: string }[] {
  const fuori: { file: string; tag: string }[] = [];
  for (const file of sorgenti(SRC)) {
    const testo = readFileSync(file, 'utf8');
    for (let i = testo.indexOf('<CartaApribile'); i >= 0; i = testo.indexOf('<CartaApribile', i + 1)) {
      let j = i;
      let prof = 0;
      let virgoletta = '';
      for (; j < testo.length; j++) {
        const c = testo[j];
        if (virgoletta) {
          if (c === virgoletta && testo[j - 1] !== '\\') virgoletta = '';
          continue;
        }
        if (c === '/' && testo[j + 1] === '*') {
          j = testo.indexOf('*/', j + 2);
          if (j < 0) break;
          j++;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') virgoletta = c;
        else if (c === '{') prof++;
        else if (c === '}') prof--;
        else if (c === '>' && prof === 0) break;
      }
      fuori.push({ file: file.slice(SRC.length + 1), tag: testo.slice(i, j) });
    }
  }
  return fuori;
}

const CAPITOLI = apribili();

describe('i capitoli che si aprono', () => {
  it('ce ne sono, e la prova non sta misurando il vuoto', () => {
    /*
     * La riga che rende vere tutte le altre. Un `it.each([])` non fallisce: passa
     * con zero casi, in silenzio. Se un giorno il componente cambia nome o
     * l'espressione qui sopra smette di trovarlo, senza questa riga il file
     * resterebbe verde dichiarando che va tutto bene su niente.
     */
    expect(CAPITOLI.length).toBeGreaterThan(20);
  });

  it.each(CAPITOLI.map((c) => [`${c.file}: ${c.tag.match(/chiave=[{"]([^"}`]*)/)?.[1] ?? '?'}`, c] as const))(
    '«%s» porta il suo numero',
    (_, capitolo) => {
      /*
       * Il tipo pretende che `sommario` venga passato; non può pretendere che sia
       * qualcosa. `sommario=""` e `sommario={undefined}` compilano, e a schermo
       * sono esattamente il titolo con la freccia che la regola vieta.
       */
      expect(capitolo.tag, 'manca `sommario`').toContain('sommario');
      expect(capitolo.tag, 'il sommario è vuoto').not.toMatch(/sommario=(""|{undefined}|{''}|{null})/);
    },
  );

  it('due capitoli non condividono la stessa chiave', () => {
    /*
     * ► È SUCCESSO DAVVERO, ed è il motivo per cui questa prova esiste. ◄
     *
     * `CartaApribile` ricorda l'apertura in una mappa indicizzata dalla chiave.
     * Due riquadri con la stessa chiave si aprono e si chiudono INSIEME, come un
     * interruttore solo per due lampade — e il caso non è teorico: le
     * impostazioni del computer, nella scheda di un'immersione, vengono disegnate
     * due volte affiancate quando l'immersione è stata fatta con due computer.
     * Lì la chiave contiene il numero di serie proprio per questo.
     *
     * Il difetto non rompe niente e non si vede leggendo: si vede solo aprendo
     * una delle due e accorgendosi che si è aperta anche l'altra.
     */
    const chiavi = CAPITOLI.map((c) => c.tag.match(/chiave=[{"]([^"}`]*)/)?.[1] ?? '?').filter(
      (k) => k !== '?' && k !== '',
    );
    const doppie = chiavi.filter((k, i) => chiavi.indexOf(k) !== i);
    expect(doppie, `chiavi ripetute: ${doppie.join(', ')}`).toEqual([]);
  });
});
