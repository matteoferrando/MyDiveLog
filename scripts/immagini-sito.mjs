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
   * ► LE DUE SCHERMATE DELL'APERTURA. ◄
   *
   * In cima al sito non c'è una fotografia: c'è una scena di due, che il foglio
   * di stile dissolve una nell'altra — prima la schermata di importazione con i
   * file che entrano, poi il logbook pieno. Racconta in tre secondi la cosa che
   * il testo accanto impiega un paragrafo a dire: *i file che hai già diventano
   * il tuo logbook.*
   *
   * DEVONO ESSERE DELLA STESSA IDENTICA MISURA. Si sovrappongono, e due
   * fotografie di forma diversa in dissolvenza si vedono «saltare»: è la stessa
   * ragione per cui si scattano nello stesso giro, con la stessa finestra e con
   * lo stesso `deviceScaleFactor`, invece che in due passaggi.
   *
   * La finestra è più bassa di quella delle cinque schermate della galleria —
   * 1080 × 1240 invece di 1280 × 820 — perché in cima sta in una colonna alta e
   * stretta, e una 16:10 lì lascia mezza colonna vuota. Alta, ma non troppo: a
   * 1400 px la scena diventava una torre.
   */
  const scena = await browser.newPage({
    viewport: { width: 1080, height: 1240 },
    deviceScaleFactor: 1.25,
    locale,
  });
  await scena.goto('http://localhost:4174/', { waitUntil: 'networkidle' });
  await scena.waitForTimeout(400);
  await scena.setInputFiles('input[type=file]', FILE);
  await scena.waitForSelector('.card h2', { timeout: 60000 });
  await scena.waitForTimeout(1400);

  const fermaScena = async (nome) => {
    await scena.evaluate(() => {
      document.querySelector('.main').scrollTop = 0;
    });
    await scena.waitForTimeout(200);
    await scena.screenshot({
      path: `sito/immagini/${nome}-${suffisso}.jpg`,
      type: 'jpeg',
      quality: 82,
    });
  };

  // Dopo il caricamento l'applicazione RESTA sulla schermata di importazione,
  // con l'esito riga per riga: è il primo fotogramma della scena, e si scatta
  // prima di andare altrove. La prima versione di questo codice andava dritta
  // al logbook e la schermata di importazione non l'ha mai fotografata —
  // salvo poi finire nel sito al posto del logbook, perché il passaggio al
  // logbook mancava dall'altra parte. Nessun comando se n'era accorto.
  await fermaScena('vetrina-importa');

  await scena.locator(`.nav button:has-text("${NOMI.logbook}")`).first().click();
  await scena.waitForTimeout(1000);
  await fermaScena('vetrina');

  await scena.close();
}

await giro('it-IT', 'it');
await giro('en-US', 'en');

await browser.close();
server.close();
console.log('fatte.');
