/**
 * LE QUATTRO RIGHE CHE TENGONO LA PAGINA DENTRO LO SCHERMO.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTA PROVA GUARDA IL FOGLIO DI STILE E NON LA PAGINA. ◄
 *
 * Perché jsdom non impagina: non ha larghezze, non ha flex, non ha
 * `getBoundingClientRect` che dica qualcosa di vero. Uno sforo orizzontale è
 * geometria, e la geometria qui non esiste. *Una prova che non può vedere la
 * cosa non deve fingere di guardarla.*
 *
 * La misura vera la fa `scripts/misura-larghezza.mjs`, che apre la build in un
 * browser vero a dieci larghezze — da iPhone SE a uno schermo da 27" — e dice
 * quali elementi hanno il bordo destro oltre il contenitore. Si lancia con
 * `npm run larghezza:verifica`, e va lanciato quando si tocca l'impaginazione.
 *
 * Quello che questo file può fare, e che serve, è un'altra cosa: **tenere le
 * quattro dichiarazioni che sono costate un difetto ciascuna.** Sono righe che
 * sembrano superflue leggendole, e che qualcuno un giorno toglierà «perché non
 * fa niente». Qui sotto c'è scritto cosa faceva ognuna il giorno che mancava.
 *
 * ► I DIFETTI, misurati il 15 settembre 2026 su segnalazione «su iPhone 16 il
 * logbook scrolla orizzontale». Non si vedevano con l'archivio dimostrativo:
 * dipendono dai DATI, ed è il motivo per cui `demo/nomi-lunghi.csv` adesso
 * esiste. ◄
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync('src/ui/styles.css', 'utf8');

/**
 * Il corpo di OGNI regola che ha esattamente questo selettore, unito.
 *
 * ► Unito, e non «la prima che trovo». ◄ La prima versione di questo file
 * prendeva la prima occorrenza, e `.tabella-logbook td` ne aveva tre: la prova
 * guardava quella sbagliata e diventava rossa su una correzione che c'era. Un
 * selettore ripetuto è anche un difetto suo — *due copie della stessa regola
 * sono una regola e la sua versione vecchia* — e infatti le tre sono state
 * unite in due; ma la prova non deve dipendere da quante sono.
 */
function regola(selettore: string): string {
  const corpi: string[] = [];
  for (let i = CSS.indexOf(`\n${selettore} {`); i > -1; i = CSS.indexOf(`\n${selettore} {`, i + 1)) {
    corpi.push(CSS.slice(i, CSS.indexOf('}', i)));
  }
  expect(corpi.length, `il selettore \`${selettore}\` non esiste più nel foglio di stile`).toBeGreaterThan(0);
  return corpi.join('\n');
}

describe('le righe che impediscono lo scorrimento laterale', () => {
  it('`.main` dichiara `overflow-x`, invece di lasciarlo decidere alla specifica', () => {
    /*
     * Qui c'era solo `overflow-y: auto`. Quando un asse è `visible` e l'altro
     * no, la specifica calcola il primo a `auto`: il contenitore era
     * trascinabile di lato **per costruzione**, e bastava un elemento che
     * sforasse di un pixel perché la pagina si spostasse sotto il dito.
     */
    expect(regola('.main')).toContain('overflow-x: hidden');
  });

  it('le celle del logbook spezzano le parole lunghe', () => {
    /*
     * Un sito chiamato «Grottadellafocamonacaepuntadelloscogliolungo» — che è
     * come li scrivono certi computer — dettava la larghezza minima della cella
     * e spingeva la scheda fuori: **96 px di scorrimento a 320, 23 a 393**.
     *
     * `anywhere` e non `break-word`: è `anywhere` che toglie la parola lunga dal
     * conto della larghezza MINIMA, ed è la larghezza minima che spinge.
     */
    const r = regola('  .tabella-logbook td');
    expect(r).toContain('overflow-wrap: anywhere');
    expect(r).toContain('min-width: 0');
  });

  it('le tessere delle statistiche fanno lo stesso', () => {
    // Stesso nome di sito, stesso meccanismo, altro punto della pagina: dodici
    // pixel di troppo a 320. Tre posti diversi, una causa sola.
    const r = regola('.tile');
    expect(r).toContain('overflow-wrap: anywhere');
    expect(r).toContain('min-width: 0');
  });

  it('i filtri incolonnati sul telefono non vanno a capo', () => {
    /*
     * La regola base ha `flex-wrap: wrap`, giusta in riga. In COLONNA significa
     * che il contenitore può creare una seconda colonna, e la larghezza di una
     * colonna la detta l'elemento più largo, **non il contenitore**: con
     * `align-items: stretch` quella larghezza viene poi imposta a tutti.
     * Misurato: `.filters` largo 280 con dentro una `label` larga 325.
     */
    const i = CSS.indexOf('@media (max-width: 700px) {\n  .filters {');
    expect(i, 'il blocco telefono dei filtri non esiste più').toBeGreaterThan(-1);
    const blocco = CSS.slice(i, CSS.indexOf('\n  }', i));
    expect(blocco).toContain('flex-direction: column');
    expect(blocco).toContain('flex-wrap: nowrap');
  });

  it('le pastiglie lunghe vanno a capo sul telefono invece di essere tagliate', () => {
    /*
     * `white-space: nowrap` è quello che rende una pastiglia una pastiglia, ma
     * «in miglioramento: 21.2 → 18.3 L/min» a 320 px non ci sta. E da quando
     * `.main` taglia, sforare vuol dire sparire: una frase a metà è peggio di
     * una pagina che scorre. La rete non deve trasformare un difetto visibile
     * in uno invisibile.
     */
    const i = CSS.indexOf('@media (max-width: 480px) {\n  .badge {');
    expect(i, 'il blocco telefono delle pastiglie non esiste più').toBeGreaterThan(-1);
    const blocco = CSS.slice(i, CSS.indexOf('\n  }', i));
    expect(blocco).toContain('white-space: normal');
    expect(blocco).toContain('overflow-wrap: anywhere');
  });
});

describe('il file che ha fatto trovare il difetto resta negli esempi', () => {
  it('`demo/nomi-lunghi.csv` contiene un nome di sito senza spazi', () => {
    /*
     * Senza di lui il giro di misura dichiarava pulito tutto, su ogni
     * dispositivo — perché l'archivio dimostrativo aveva solo nomi con gli
     * spazi. *Un campione che non contiene il caso difficile misura la propria
     * scelta del campione.*
     */
    const csv = readFileSync('demo/nomi-lunghi.csv', 'utf8');
    const senzaSpazi = csv
      .split('\n')
      .slice(1)
      .map((r) => r.split(';')[4] ?? '')
      .filter((sito) => sito.length > 30 && !sito.includes(' '));
    expect(senzaSpazi.length, 'serve almeno un sito lungo e senza spazi').toBeGreaterThan(0);
  });
});
