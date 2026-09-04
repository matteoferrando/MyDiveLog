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
  { file: 'computer-supportati.html', quiE: 'voce' },
  { file: 'aiuto.html', quiE: 'voce' },
  { file: 'en/index.html', quiE: 'marchio' },
  { file: 'en/privacy.html', quiE: 'voce' },
  { file: 'en/terms.html', quiE: 'voce' },
  { file: 'en/dive-logbook-law.html', quiE: 'voce' },
  { file: 'en/supported-computers.html', quiE: 'voce' },
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
    expect(voci.length, `${file}: voci nel menu`).toBe(9);
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

/*
 * ► LE STESSE VOCI, NON SOLO LO STESSO NUMERO ◄
 *
 * Il 3 settembre 2026 il proprietario ha chiesto di controllare che tutte le
 * pagine avessero lo stesso menu e lo stesso piede, con le stesse voci. Il
 * menu era a posto. **Il piede no**, e in due modi:
 *
 *  - la home aveva un piede a tre colonne con otto voci; le otto pagine interne
 *    ne avevano quattro o cinque, ognuna un po' diverse dalle altre — e nessuna
 *    con «Aiuto», che nel piede non c'era nemmeno sulla home;
 *  - `aiuto.html` e `en/help.html`, costruite dalla struttura di `privacy.html`,
 *    avevano tenuto **il piede della privacy**: il collegamento «English»
 *    mandava a `/en/privacy.html` e non alla pagina gemella dell'aiuto. Il
 *    menu era stato corretto, il piede no. *Copiare una pagina per farne
 *    un'altra copia anche gli errori che quella pagina non aveva ancora.*
 *  - e sulle pagine inglesi il marchio nel piede portava a `/`, la home
 *    italiana, mentre lo stesso marchio nel menu portava a `/en/`.
 *
 * La guardia che c'era contava le voci del menu — otto — e basta: otto voci
 * sbagliate passano come otto voci giuste. Queste confrontano ETICHETTA e
 * DESTINAZIONE di ogni voce con quelle della home della stessa lingua, e
 * ammettono di differire solo dove DEVONO differire: «Segnala» (pulsante sulla
 * home, collegamento al frammento altrove) e lo scambio di lingua nel menu, che
 * punta alla pagina gemella.
 *
 * ► I COLLEGAMENTI ESTERNI SI APRONO IN UNA SCHEDA NUOVA ◄ — chiesto lo stesso
 * giorno. Erano 63, e nessuno aveva `target="_blank"`. Esclusi i download
 * diretti (`releases/latest/download/…`): un file non porta via dal sito, e una
 * scheda vuota che si apre e si chiude per scaricare un `.dmg` è un difetto,
 * non una cortesia. L'esclusione è scritta come regola nella prova, così non
 * può cambiare in silenzio in nessuna delle due direzioni.
 */

/** Le voci di un blocco: etichetta → destinazione, in ordine. */
function vociDi(blocco: string): string[] {
  // `<\/\1\s*>` e non `<\/\1>`: prettier spezza `</a>` in `</a\n>` quando la
  // riga è lunga, e un'espressione che non lo sa perde voci in silenzio — è
  // successo mentre si scriveva questa prova, con un piede da nove voci letto
  // come otto.
  return [...senzaCommenti(blocco).matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1\s*>/g)].map((m) => {
    const testo = m[3]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const href = /href="([^"]*)"/.exec(m[2])?.[1] ?? '(pulsante)';
    return `${testo} → ${href}`;
  });
}

function piede(html: string): string {
  const dentro = /<footer class="piede">([\s\S]*?)<\/footer>/.exec(senzaCommenti(html));
  if (!dentro) throw new Error('nessun <footer class="piede"> nella pagina');
  return dentro[1];
}

const homeDi = (file: string) => (file.startsWith('en/') ? 'en/index.html' : 'index.html');
const INTERNE = PAGINE.filter((p) => p.quiE === 'voce').map((p) => p.file);

describe('le stesse voci su tutte le pagine', () => {
  it.each(INTERNE)('%s ha nel menu le stesse voci della sua home', (file) => {
    const qui = vociDi(navigazione(leggi(file)));
    const casa = vociDi(navigazione(leggi(homeDi(file))));
    expect(qui.length).toBe(casa.length);
    for (let i = 0; i < casa.length; i++) {
      const [etichetta, dove] = qui[i].split(' → ');
      const [etichettaCasa, doveCasa] = casa[i].split(' → ');
      expect(etichetta, `${file}: voce ${i + 1}`).toBe(etichettaCasa);
      // Le due voci che devono differire: «Segnala» e lo scambio di lingua.
      if (doveCasa === '(pulsante)') expect(dove, `${file}: Segnala`).toMatch(/^\/(en\/)?#segnala$/);
      else if (/^\/(en\/)?$/.test(doveCasa))
        expect(dove, `${file}: lingua`).toMatch(/^\/(en\/)?[a-z-]+\.html$/);
      else expect(dove, `${file}: voce ${i + 1} «${etichetta}»`).toBe(doveCasa);
    }
  });

  it.each(INTERNE)('%s ha nel piede le stesse voci della sua home', (file) => {
    const qui = vociDi(piede(leggi(file)));
    const casa = vociDi(piede(leggi(homeDi(file))));
    expect(qui.length, `${file}: voci nel piede`).toBe(casa.length);
    for (let i = 0; i < casa.length; i++) {
      const [etichetta, dove] = qui[i].split(' → ');
      const [etichettaCasa, doveCasa] = casa[i].split(' → ');
      expect(etichetta, `${file}: voce ${i + 1}`).toBe(etichettaCasa);
      if (doveCasa === '(pulsante)') expect(dove, `${file}: Segnala`).toMatch(/^\/(en\/)?#segnala$/);
      else expect(dove, `${file}: voce ${i + 1} «${etichetta}»`).toBe(doveCasa);
    }
  });

  it.each(PAGINE.map((p) => p.file))('%s: il marchio nel piede porta dove porta quello nel menu', (file) => {
    const nelMenu = /<a class="marchio" href="([^"]*)"/.exec(senzaCommenti(leggi(file)))?.[1];
    const nelPiede = /<a class="piede-marchio" href="([^"]*)"/.exec(piede(leggi(file)))?.[1];
    expect(nelPiede, `${file}: marchio nel piede`).toBe(nelMenu);
  });

  it.each(PAGINE.map((p) => p.file))('%s: il piede nomina l’aiuto', (file) => {
    // La pagina è nata dopo il piede, e il piede non l'aveva: la voce che manca
    // non dà errore, e nessuno la cerca.
    expect(piede(leggi(file))).toMatch(/href="(aiuto|help)\.html"/);
  });
});

describe('i collegamenti esterni', () => {
  const esterno = (href: string) =>
    /^https?:\/\//.test(href) && !/^https?:\/\/(www\.)?mydivelog\.site/.test(href);
  const scaricamento = (href: string) => /\/releases\/latest\/download\//.test(href);

  it.each(PAGINE.map((p) => p.file))(
    '%s: si aprono in una scheda nuova, e senza consegnare la finestra',
    (file) => {
      const html = senzaCommenti(leggi(file));
      let contati = 0;
      for (const m of html.matchAll(/<a\b([^>]*)>/g)) {
        const attributi = m[1];
        const href = /href="([^"]*)"/.exec(attributi)?.[1] ?? '';
        if (!esterno(href) || scaricamento(href)) continue;
        contati++;
        expect(attributi, `${file}: ${href}`).toMatch(/target="_blank"/);
        // `rel="noopener"`: senza, la pagina aperta può raggiungere `window.opener`
        // e cambiare l'indirizzo di questa. I browser recenti lo mettono da soli,
        // ma «i browser recenti» non è una garanzia che questo sito debba dare.
        expect(attributi, `${file}: ${href}`).toMatch(/rel="[^"]*noopener/);
      }
      expect(
        contati,
        `${file}: nessun collegamento esterno trovato — la prova non ha guardato niente`,
      ).toBeGreaterThan(0);
    },
  );

  it.each(['index.html', 'en/index.html'])('%s: i download NON si aprono in una scheda nuova', (file) => {
    // È una decisione, e sta qui perché non possa cambiare in silenzio.
    const html = senzaCommenti(leggi(file));
    let contati = 0;
    for (const m of html.matchAll(/<a\b([^>]*)>/g)) {
      const href = /href="([^"]*)"/.exec(m[1])?.[1] ?? '';
      if (!scaricamento(href)) continue;
      contati++;
      expect(m[1], `${file}: ${href}`).not.toMatch(/target="_blank"/);
    }
    expect(contati, `${file}: nessun download in pagina`).toBeGreaterThan(0);
  });
});
