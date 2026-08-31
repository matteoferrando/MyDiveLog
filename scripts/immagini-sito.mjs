/**
 * Le fotografie del sito, prese dall'applicazione vera.
 *
 * Non sono ritocchi né mockup: è la stessa build che gira sul Mac, caricata con
 * l'archivio dimostrativo, fotografata in italiano e in inglese. Ha un costo —
 * vanno rifatte quando l'interfaccia cambia — e in cambio non può succedere che
 * il sito mostri una schermata che il programma non produce più.
 *
 *   npm run build && npm run demo && node scripts/immagini-sito.mjs
 *
 * Le immagini finiscono in `sito/immagini/`, in JPEG.
 *
 * PERCHÉ JPEG E NON PNG. Sono fotografie di un'interfaccia piena di sfumature e
 * di testo antialiasato: in PNG la stessa schermata pesa il doppio, e su
 * Cloudflare Pages ogni chilobyte è banda pagata da chi apre il sito da un
 * telefono in barca. La qualità 82 non lascia artefatti visibili sul testo.
 *
 * La finestra è 1280 px con `deviceScaleFactor: 1.25`: l'immagine esce a 1600 px
 * di lato lungo, che è il doppio della larghezza a cui il sito la mostra. Sopra
 * non si legge niente di più e si paga solo banda.
 */

import pw from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
const server = createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(join(process.cwd(), 'dist', p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(4174, r));
mkdirSync('sito/immagini', { recursive: true });

const FILE = [
  'demo/shearwater-cloud-export.uddf',
  'demo/subsurface-archivio.ssrf',
  'demo/shearwater-peregrine.xml',
  'demo/garmin-descent.fit',
];

const browser = await pw.chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);

/**
 * Un giro completo in una lingua.
 *
 * La lingua si dichiara al contesto (`locale`) invece di premere il pulsante:
 * qui non si sta provando il pulsante, si stanno facendo fotografie, e partire
 * già nella lingua giusta evita di fotografare l'istante in cui il dizionario
 * inglese non è ancora arrivato.
 */
async function giro(locale, suffisso) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 1.25,
    locale,
  });
  await page.goto('http://localhost:4174/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.setInputFiles('input[type=file]', FILE);
  await page.waitForSelector('.card h2', { timeout: 60000 });
  await page.waitForTimeout(1200);

  const vai = async (nome) => {
    await page.locator(`.nav button:has-text("${nome}")`).first().click();
    await page.waitForTimeout(900);
  };
  const scatta = async (nome) => {
    await page.evaluate(() => {
      document.querySelector('.main').scrollTop = 0;
    });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: `sito/immagini/${nome}-${suffisso}.jpg`,
      type: 'jpeg',
      quality: 82,
    });
  };

  const NOMI =
    suffisso === 'it'
      ? { logbook: 'Logbook', stats: 'Statistiche', gas: 'Gas', coach: 'Suggerimenti' }
      : { logbook: 'Logbook', stats: 'Statistics', gas: 'Gas', coach: 'Coaching' };

  await vai(NOMI.logbook);
  await scatta('logbook');

  // La scheda di un'immersione: si apre la prima riga dell'elenco, che
  // nell'archivio dimostrativo è sempre una con il profilo campionato.
  await page.locator('tbody tr td:nth-child(3)').first().click();
  await page.waitForTimeout(1400);
  await scatta('immersione');

  await vai(NOMI.logbook);
  await vai(NOMI.stats);
  await scatta('statistiche');

  await vai(NOMI.gas);
  await scatta('gas');

  await vai(NOMI.coach);
  await scatta('suggerimenti');

  /*
   * IL TELEFONO NON SI FOTOGRAFA PIÙ, e non è una dimenticanza.
   *
   * La schermata dell'iPhone è alta e stretta: in una griglia di riquadri
   * larghi finiva da sola su una riga, con mezzo schermo di vuoto accanto. Una
   * fotografia che sta male non convince nessuno che l'app su iPhone sia la
   * stessa: quella frase la dice il testo, e la dice meglio.
   *
   * Che l'applicazione regga i 390 px continua a verificarlo
   * `scripts/screenshot.mjs`, che a quella larghezza misura il trabocco e i
   * bersagli tattili — cioè fa il lavoro vero, non la fotografia.
   */

  await page.close();

  /*
   * ► LA SCHERMATA ALTA DELL'APERTURA. ◄
   *
   * Le cinque qui sopra sono larghe 1600 e alte 1000, che è la forma di una
   * finestra sul Mac ed è giusta per una griglia di figure. In cima al sito,
   * però, quella forma va messa in una colonna alta il doppio: misurata, la
   * griglia dell'apertura è alta 1128 px e un'immagine 16:10 larga quanto la
   * colonna ne riempie 381. Il resto è vuoto, e non c'è CSS che lo chiuda —
   * un'immagine non diventa più alta perché le si dà più spazio.
   *
   * Quindi si fotografa una finestra ALTA. Non è un ritaglio né uno stiramento
   * della prima: è la stessa applicazione con la finestra di un'altra forma, e
   * in una finestra alta il logbook mostra più righe — cioè l'immagine dice
   * anche qualcosa di più, invece di dire la stessa cosa in grande.
   *
   * 1080 × 1400 a `deviceScaleFactor: 1.25` fa 1350 × 1750: il doppio della
   * larghezza a cui il sito la mostra, come per tutte le altre.
   */
  const alta = await browser.newPage({
    viewport: { width: 1080, height: 1400 },
    deviceScaleFactor: 1.25,
    locale,
  });
  await alta.goto('http://localhost:4174/', { waitUntil: 'networkidle' });
  await alta.waitForTimeout(400);
  await alta.setInputFiles('input[type=file]', FILE);
  await alta.waitForSelector('.card h2', { timeout: 60000 });
  await alta.waitForTimeout(1200);
  /*
   * Al logbook, come nel giro qui sopra. Senza questa riga la fotografia usciva
   * sulla schermata di importazione — che è dove l'applicazione resta dopo aver
   * caricato i file — mentre l'`alt` sul sito prometteva l'elenco delle
   * immersioni. Non se n'era accorto nessun comando: il file veniva scritto,
   * pesava i suoi duecento kilobyte, e mostrava la pagina sbagliata.
   */
  await alta.locator(`.nav button:has-text("${NOMI.logbook}")`).first().click();
  await alta.waitForTimeout(1000);
  await alta.evaluate(() => {
    document.querySelector('.main').scrollTop = 0;
  });
  await alta.waitForTimeout(200);
  await alta.screenshot({
    path: `sito/immagini/vetrina-${suffisso}.jpg`,
    type: 'jpeg',
    quality: 82,
  });
  await alta.close();
}

await giro('it-IT', 'it');
await giro('en-US', 'en');

await browser.close();
server.close();
console.log('fatte.');
