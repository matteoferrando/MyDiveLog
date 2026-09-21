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

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * ► SI SALTA ANCHE QUANDO `dist/` È PIÙ VECCHIA DEI SORGENTI. ◄
 *
 * `dist/` assente è sempre stato un motivo per saltare: non c'è niente da
 * misurare. Il 18 settembre 2026 è saltato fuori il caso peggiore, che non era
 * coperto: `dist/` **c'è ma è di ieri**. Allora queste prove girano, passano, e
 * dichiarano verde il bilancio di un pacchetto che non è quello che si sta per
 * pubblicare — *una misura fatta sull'oggetto sbagliato è peggio di una misura
 * non fatta, perché la prima chiude la domanda.*
 *
 * E il caso c'era per davvero: fino a oggi la catena di `docs/RILASCIO.md`
 * faceva `tsc --noEmit` e poi le prove, senza costruire. Su un albero pulito
 * `dist/` è ignorato da git e non esiste, quindi il bilancio del bundle **non
 * girava affatto**; sulla macchina di chi pubblica c'era la build del rilascio
 * precedente, e girava sulla sbagliata. Adesso la catena costruisce per prima
 * cosa, e questa condizione è la rete: se qualcuno la riordina, il bilancio si
 * toglie di mezzo invece di mentire.
 */
const distVecchia = (): boolean => {
  if (!existsSync(join(DIST, 'index.html'))) return true;
  const quando = statSync(join(DIST, 'index.html')).mtimeMs;
  let piuRecente = 0;
  const giro = (radice: string) => {
    for (const voce of readdirSync(radice)) {
      if (voce.startsWith('.')) continue;
      const percorso = join(radice, voce);
      const st = statSync(percorso);
      if (st.isDirectory()) giro(percorso);
      else piuRecente = Math.max(piuRecente, st.mtimeMs);
    }
  };
  try {
    giro('src');
  } catch {
    return false;
  }
  return piuRecente > quando;
};

describe.skipIf(distVecchia())('bilancio del bundle', () => {
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

/*
 * ═════════════════════════════════════════════════════════════════════════════
 * ► E QUESTA PROVA NON SI SALTA MAI, perché è quella che tiene in piedi tutte
 * le altre di questo file. ◄
 *
 * Le prove qui sopra misurano `dist/`. Se la catena di rilascio non costruisce
 * prima di lanciarle, misurano il vuoto (e si saltano) o la build precedente (e
 * mentono). La condizione non sta nel codice: sta in un documento, ed è il
 * genere di cosa che si riordina senza pensarci. *Un documento che tiene in
 * piedi una prova va controllato come il codice.*
 */
/** La sezione 1 di `docs/RILASCIO.md`: la catena, e nient'altro. */
function laCatena(): string {
  const doc = readFileSync('docs/RILASCIO.md', 'utf8');
  const dalla = doc.indexOf('## 1.');
  const alla = doc.indexOf('## 2.');
  expect(dalla, 'in RILASCIO.md non c’è più la sezione 1').toBeGreaterThan(-1);
  expect(alla, 'in RILASCIO.md non c’è più la sezione 2').toBeGreaterThan(dalla);
  return doc.slice(dalla, alla);
}

describe('la catena di rilascio misura il pacco che sta pubblicando', () => {
  it('docs/RILASCIO.md costruisce prima di lanciare le prove', () => {
    const catena = laCatena();

    const iCostruzione = catena.indexOf('npm run build');
    const iProve = catena.indexOf('vitest run');
    expect(iCostruzione, 'la catena di rilascio non costruisce').toBeGreaterThan(-1);
    expect(iProve, 'la catena di rilascio non lancia le prove').toBeGreaterThan(-1);
    expect(
      iCostruzione,
      'la catena lancia le prove PRIMA di costruire: il bilancio del bundle misurerebbe la build vecchia, o nessuna',
    ).toBeLessThan(iProve);
  });

  it('e clippy ci sta dentro, con ogni avviso trattato da errore', () => {
    /*
     * ► DAL 21 SETTEMBRE 2026. ◄ Clippy non era mai stato lanciato: il 18 ha
     * trovato diciannove segnalazioni, fra cui la costante misurata che
     * giustifica l'attesa di un frammento Bluetooth e che nessuno leggeva.
     * Rimesse a zero, restano a zero solo se la catena lo pretende.
     *
     * E la pretesa è tutta in `-D warnings`: senza, clippy stampa i suoi avvisi,
     * esce con zero e la catena resta verde — un controllo che non sa dire di
     * no. Per questo la prova guarda la riga intera e non la sola parola.
     */
    expect(laCatena(), 'clippy non è nella catena, o non tratta gli avvisi da errori').toMatch(
      /cargo clippy --all-targets -- -D warnings/,
    );
  });
});
