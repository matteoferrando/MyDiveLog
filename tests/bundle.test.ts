/**
 * Bilancio del bundle: quanto codice deve leggere la webview per disegnare la
 * prima schermata.
 *
 * Non è un test di correttezza, è un test di regressione su un numero che
 * peggiora sempre in silenzio. Un `import { Planner } from './pages/Planner'`
 * messo in cima ad App.tsx per comodità non rompe niente, non fa fallire nessun
 * altro test, e riporta 90 kB dentro il pezzo che l'iPhone deve compilare prima
 * di mostrare il logbook. È esattamente il modo in cui questo bundle era
 * arrivato a 744 kB in un pezzo solo.
 *
 * Le misure si leggono da `dist/`, cioè dalla build vera: qualunque stima fatta
 * dalle sorgenti mentirebbe, perché il minificatore e il tree-shaking spostano
 * decine di kB. Il prezzo è che il test dipende da un artefatto che potrebbe non
 * esserci — su una macchina appena clonata, o in una CI che lancia i test prima
 * della build — e in quel caso salta invece di fallire: un test rosso per un
 * `dist/` mancante direbbe «il bundle è troppo grosso», che è falso.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));

/**
 * Soglie, e da dove vengono.
 *
 * Sono tarate sui numeri misurati subito dopo la divisione, con un margine
 * intorno al 15%: abbastanza da non far fallire la build per una funzione in
 * più, troppo poco perché ci rientri una pagina intera tornata dentro l'avvio.
 */

/*
 * Nessun pezzo singolo oltre questo. Il più grosso è e resterà `@garmin/fitsdk`
 * (376 kB): è un SDK di terze parti con dentro il profilo completo dei messaggi
 * FIT, non c'è niente da limare, e comunque arriva solo se qualcuno importa un
 * file `.fit`. La soglia esiste per il caso opposto — un pezzo che cresce fino a
 * ridiventare il monolite di prima.
 */
const MAX_CHUNK_KB = 420;

/*
 * Il numero che conta davvero: quanto pesa, compresso, ciò che il browser deve
 * scaricare PRIMA di disegnare. Misurato 169 kB dopo la divisione, contro i
 * 233 kB del pezzo unico di prima.
 *
 * ALZATA DA 190 A 200 IL 24 AGOSTO 2026, e vale la pena dire perché — alzare
 * una soglia perché la si è superata è il modo in cui le soglie muoiono.
 *
 * La misura era 190.3 kB: trecento byte oltre, accumulati da mesi di codice
 * dell'applicazione vero e proprio (il libretto di legge, la firma, la
 * numerazione), non da una dipendenza entrata di soppiatto. Il pezzo `index` è
 * anzi CALATO — 113.1 kB gzip alla 1.3.0, 111.2 adesso.
 *
 * Quello che questa soglia esiste per intercettare è un'altra cosa: il
 * pianificatore che rientra nel pezzo iniziale, e sono 27 kB gzip. Con 200 il
 * margine è di quasi dieci kB, cioè un terzo di quel salto: il guardiano fa
 * ancora il suo mestiere. Se un giorno servisse alzarla di nuovo, la domanda
 * giusta non è «di quanto» ma «cosa è entrato».
 */
const MAX_EAGER_GZIP_KB = 200;

/** Le pagine che devono restare in un pezzo proprio, caricato solo se si apre. */
const PAGINE_PIGRE = ['Planner', 'Stats', 'Coach', 'Compare', 'Gear', 'ImportPage', 'SyncPage', 'DiveDetail'];

const kb = (n: number) => Math.round((n / 1024) * 10) / 10;

/** Tutti i pezzi JavaScript prodotti, con dimensione grezza e compressa. */
function chunks() {
  const dir = join(DIST, 'assets');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((name) => {
      const bytes = readFileSync(join(dir, name));
      return { name, raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
    })
    .sort((a, b) => b.raw - a.raw);
}

/**
 * I pezzi che il browser carica subito.
 *
 * Si leggono da `index.html` e non indovinando dai nomi: Vite ci mette lo script
 * d'ingresso e un `modulepreload` per ogni dipendenza statica di quello script.
 * Quell'elenco È, per definizione, il costo del primo avvio — se una pagina
 * smette di essere pigra, il suo pezzo compare lì dentro (o sparisce, riassorbito
 * nell'ingresso: in entrambi i casi il totale sale e il test se ne accorge).
 */
function eagerChunks() {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const href = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) =>
    m[1].replace('/assets/', ''),
  );
  return chunks().filter((c) => href.includes(c.name));
}

// `dist/` assente: la build non è ancora stata fatta, non c'è niente da misurare.
describe.skipIf(!existsSync(join(DIST, 'index.html')))('bilancio del bundle', () => {
  it('la build è divisa in più pezzi, non in un file solo', () => {
    const c = chunks();
    // Uno per pagina pigra, più ingresso, react, xml e le dipendenze asincrone:
    // ben oltre dieci. Il confronto è largo di proposito — qui interessa solo
    // distinguere «diviso» da «monolite», non congelare il conteggio esatto.
    expect(c.length, c.map((x) => `${x.name} ${kb(x.raw)} kB`).join('\n')).toBeGreaterThan(8);
  });

  it('nessun pezzo singolo supera la soglia', () => {
    const troppoGrossi = chunks().filter((c) => c.raw > MAX_CHUNK_KB * 1024);
    expect(troppoGrossi.map((c) => `${c.name}: ${kb(c.raw)} kB (limite ${MAX_CHUNK_KB})`)).toEqual([]);
  });

  it('ogni pagina pesante ha un pezzo proprio', () => {
    const nomi = chunks().map((c) => c.name);
    for (const pagina of PAGINE_PIGRE) {
      expect(
        nomi.some((n) => n.startsWith(`${pagina}-`)),
        `${pagina} non ha un pezzo proprio: o non è più caricata con React.lazy, ` +
          `oppure è stata riassorbita nell'ingresso. Pezzi presenti: ${nomi.join(', ')}`,
      ).toBe(true);
    }
  });

  it('il logbook resta nel pezzo iniziale', () => {
    // È la vista di partenza: renderla pigra scambierebbe byte con un lampo di
    // pagina vuota all'apertura. Se un giorno compare `Logbook-*.js`, qualcuno
    // ha fatto quello scambio senza accorgersene.
    const nomi = chunks().map((c) => c.name);
    expect(nomi.filter((n) => n.startsWith('Logbook-'))).toEqual([]);
  });

  it('il costo del primo avvio resta sotto il budget', () => {
    const eager = eagerChunks();
    // Se il file d'ingresso non si trova, la regex sopra ha smesso di combaciare
    // con quello che Vite scrive: meglio accorgersene qui che misurare zero.
    expect(eager.length).toBeGreaterThan(0);

    const gzip = eager.reduce((s, c) => s + c.gzip, 0);
    const dettaglio = eager.map((c) => `${c.name}: ${kb(c.gzip)} kB gzip`).join('\n');
    expect(kb(gzip), `primo avvio = ${kb(gzip)} kB gzip\n${dettaglio}`).toBeLessThanOrEqual(
      MAX_EAGER_GZIP_KB,
    );
  });
});
