/**
 * Il menu del sito e il fondo delle pagine.
 *
 * Due guasti veri, tutti e due visti da chi guardava il sito e non dal codice.
 *
 * Il primo: il menu esisteva completo solo sulla home. Sulle altre pagine
 * mancavano delle voci, e chi ci finiva non aveva più modo di tornare indietro
 * se non col tasto del browser. Peggio: nessuna pagina diceva su quale pagina
 * si fosse. Ora le voci sono sette dappertutto e una sola porta
 * `aria-current="page"` — sulle sei pagine interne è la voce corrispondente,
 * sulle due home è il marchio, che è il collegamento alla home.
 *
 * Il secondo: sotto il piede c'erano fino a 191 px di nero. Non era un margine
 * e non era il padding: era l'alone decorativo, un elemento assoluto messo a
 * `bottom: -30%`. Chi sporge SOTTO allunga l'area scorribile della pagina anche
 * se non disegna niente; chi sporge SOPRA no. Da qui la regola che questo file
 * difende: in fondo alla pagina l'alone non scende sotto il bordo.
 *
 * Perché guardie di testo e non di disegno: qui non serve un browser. Le tre
 * cose che si sono rotte — una voce che sparisce, l'`aria-current` che manca o
 * si sdoppia, un offset che torna negativo — si vedono tutte nel sorgente, e
 * una guardia che gira in millisecondi a ogni prova vale più di una che
 * richiede di aprire Chromium. Il disegno vero si è misurato a mano quando si
 * è corretto: 0 px di vuoto su otto pagine per due larghezze.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SITO = fileURLToPath(new URL('../sito', import.meta.url));

/** Le pagine, e per ciascuna la voce che deve risultare «sei qui». */
const PAGINE = [
  { file: 'index.html', quiE: 'marchio' },
  { file: 'privacy.html', quiE: 'voce' },
  { file: 'termini.html', quiE: 'voce' },
  { file: 'libretto-immersioni.html', quiE: 'voce' },
  { file: 'aiuto.html', quiE: 'voce' },
  { file: 'en/index.html', quiE: 'marchio' },
  { file: 'en/privacy.html', quiE: 'voce' },
  { file: 'en/terms.html', quiE: 'voce' },
  { file: 'en/dive-logbook-law.html', quiE: 'voce' },
  { file: 'en/help.html', quiE: 'voce' },
] as const;

/**
 * I commenti si tolgono prima di qualunque conta. Nel sorgente ci sono commenti
 * che SPIEGANO `aria-current="page"` citandolo per esteso: contarli come
 * attributi farebbe passare una pagina che l'attributo vero non ce l'ha. È
 * esattamente il modo in cui una guardia diventa verde per il motivo sbagliato.
 */
function senzaCommenti(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function navigazione(html: string): string {
  const dentro = /<nav class="navigazione">([\s\S]*?)<\/nav>/.exec(senzaCommenti(html));
  if (!dentro) throw new Error('nessun <nav class="navigazione"> nella pagina');
  return dentro[1];
}

function leggi(file: string): string {
  return readFileSync(join(SITO, file), 'utf8');
}

describe('il menu del sito', () => {
  it.each(PAGINE.map((p) => p.file))('%s ha tutte e otto le voci', (file) => {
    // Erano sette fino al 1° settembre, quando è arrivata «Aiuto». Il numero è
    // scritto qui e non dedotto da una pagina campione: se domani una pagina
    // ne perdesse una, dedurlo dalla prima vorrebbe dire non accorgersene.
    const nav = navigazione(leggi(file));
    const voci = [...nav.matchAll(/<(a|button)[\s>]/g)];
    expect(voci.length, `${file}: voci nel menu`).toBe(8);
  });

  it.each(PAGINE.map((p) => p.file))('%s manda all’aiuto prima che a «Segnala»', (file) => {
    // L'ordine di un menu è una risposta alla domanda «in che ordine ci si
    // prova»: chi sta per segnalare un problema conviene che passi prima di
    // lì. Invertirle non romperebbe niente, e nessuno se ne accorgerebbe.
    const nav = navigazione(leggi(file));
    const aiuto = nav.search(/href="(aiuto|help)\.html"/);
    const segnala = nav.search(/class="voce-segnala"/);
    expect(aiuto, `${file}: non c'è la voce dell'aiuto`).toBeGreaterThan(-1);
    expect(aiuto, `${file}: «Segnala» viene prima dell'aiuto`).toBeLessThan(segnala);
  });

  it.each(PAGINE.map((p) => p.file))('%s tiene la voce Segnala', (file) => {
    const nav = navigazione(leggi(file));
    // Sulla home è il pulsante che apre il modulo; altrove è un collegamento al
    // frammento, perché il modulo e il suo codice vivono solo sulla home.
    const casa = file.endsWith('index.html');
    if (casa) expect(nav, file).toMatch(/<button class="voce-segnala"/);
    else expect(nav, file).toMatch(/class="voce-segnala" href="\/(en\/)?#segnala"/);
  });

  it.each(PAGINE.map((p) => p.file))('%s ha lo scambio di lingua', (file) => {
    const nav = navigazione(leggi(file));
    expect(nav, file).toMatch(/<span class="lingua"><a href="\/[^"]*">/);
  });

  it.each(PAGINE)('$file dice dove siamo, una volta sola', ({ file, quiE }) => {
    const html = senzaCommenti(leggi(file));
    const segni = [...html.matchAll(/aria-current="page"/g)];
    expect(segni.length, `${file}: quante voci dicono «sei qui»`).toBe(1);

    const sulMarchio = /<a class="marchio"[^>]*aria-current="page"/.test(html);
    if (quiE === 'marchio') {
      expect(sulMarchio, `${file}: sulla home il segno sta sul marchio`).toBe(true);
    } else {
      expect(sulMarchio, `${file}: qui il segno sta su una voce, non sul marchio`).toBe(false);
      expect(navigazione(leggi(file)), file).toMatch(/aria-current="page"/);
    }
  });
});

describe('il fondo delle pagine', () => {
  const css = readFileSync(join(SITO, 'stile.css'), 'utf8');

  it("l'alone del piede non scende sotto il bordo", () => {
    const regola = /\.piede::before\s*\{([\s\S]*?)\}/.exec(css);
    expect(regola, 'la regola .piede::before non c’è più').not.toBeNull();
    const dentro = regola![1];
    expect(dentro, 'l’alone deve restare ancorato al bordo inferiore').toMatch(/bottom:\s*0\s*;/);
    expect(dentro, 'un offset negativo verso il basso allunga la pagina').not.toMatch(/bottom:\s*-/);
  });

  it('nessun elemento del piede sporge sotto con un offset negativo', () => {
    // La regola vale per tutto ciò che sta nel piede, non solo per l'alone: la
    // prossima decorazione messa a `bottom: -qualcosa` rifarebbe lo stesso buco.
    for (const blocco of css.matchAll(/\.piede[^{}]*\{([\s\S]*?)\}/g)) {
      expect(blocco[1], `regola del piede: ${blocco[0].slice(0, 40)}`).not.toMatch(/bottom:\s*-/);
    }
  });
});
