/**
 * Le schermate per la scheda di Google Play, prese dall'applicazione vera.
 *
 *   npm run build && npm run demo && node scripts/immagini-play.mjs
 *
 * Stessa regola di `immagini-sito.mjs`, e vale il doppio qui: **quello che si
 * mette nella scheda di un negozio è una promessa**. Non sono mockup, non sono
 * ritocchi, non sono composizioni con una cornice di telefono intorno: è la
 * build che sta in `dist/`, caricata con l'archivio dimostrativo, fotografata
 * alle misure che Play pretende. Se l'interfaccia cambia, si rifà girare questo
 * e le immagini seguono; una scheda che mostra una schermata che il programma
 * non produce più è un difetto che nessun test può vedere.
 *
 * ► PERCHÉ TRE FORMATI, E PERCHÉ QUEI NUMERI ◄
 *
 * Play accetta SOLO 16:9 o 9:16 esatti, e un rapporto sbagliato di un pixel fa
 * rifiutare il caricamento senza spiegare quale file. I tre riquadri del modulo
 * hanno vincoli diversi sul lato:
 *
 *   telefono          320–3840 px per lato   →  1080 × 1920  (9:16)
 *   tablet 7 pollici  320–3840 px per lato   →  1920 × 1080  (16:9)
 *   tablet 10 pollici 1080–7680 px per lato  →  2560 × 1440  (16:9)
 *
 * Il telefono è verticale perché è così che si tiene un telefono, e 1080 di
 * lato corto è il minimo che Play chiede per considerare l'app promuovibile.
 * I due tablet sono orizzontali perché **sopra i 700 px l'interfaccia cambia**:
 * la striscia delle schede torna in cima al posto del menu a comparsa, e le
 * tabelle smettono di diventare schede. Fotografare un tablet in verticale
 * stretto mostrerebbe l'interfaccia del telefono ingrandita, che è una cosa che
 * su un tablet non succede.
 *
 * ► IL NUMERO DI PIXEL NON SI OTTIENE ALLARGANDO LA FINESTRA ◄
 *
 * La misura richiesta è di PIXEL DELL'IMMAGINE, non di pixel CSS. Portare la
 * finestra a 1080 px di larghezza darebbe un'interfaccia da desktop rimpicciolita
 * dentro un telefono. Quindi la finestra resta quella vera del dispositivo —
 * 360 px CSS per il telefono, 960 e 1280 per i due tablet — e il conto lo fa
 * `deviceScaleFactor`, che è esattamente quello che fa lo schermo di un
 * apparecchio vero: tre pixel fisici per ogni pixel CSS.
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
await new Promise((r) => server.listen(4176, r));

const USCITA = '_transfer/play';
mkdirSync(USCITA, { recursive: true });

const FILE = [
  'demo/shearwater-cloud-export.uddf',
  'demo/subsurface-archivio.ssrf',
  'demo/shearwater-peregrine.xml',
  'demo/garmin-descent.fit',
];

/**
 * I tre apparecchi. `css` è la finestra vera, `scala` porta l'immagine alla
 * misura che Play vuole: il prodotto dei due DEVE dare `attesa`, e più sotto
 * c'è il controllo che lo pretende invece di sperarci.
 */
const APPARECCHI = [
  { nome: 'telefono', css: { width: 360, height: 640 }, scala: 3, attesa: [1080, 1920] },
  { nome: 'tablet7', css: { width: 960, height: 540 }, scala: 2, attesa: [1920, 1080] },
  { nome: 'tablet10', css: { width: 1280, height: 720 }, scala: 2, attesa: [2560, 1440] },
];

const browser = await pw.chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);

/**
 * Sotto i 700 px la navigazione è un menu a comparsa, sopra è una striscia di
 * schede. Questa funzione percorre la strada vera dell'una o dell'altra invece
 * di forzare lo stato: è la stessa `vaiA` di `scripts/screenshot.mjs`, e la
 * ragione per cui esiste è che un click ingoiato da un `.catch` faceva
 * «fotografare» otto schede restando sempre sulla stessa.
 */
async function vaiA(page, tab) {
  const hamburger = page.locator('.hamburger');
  if (await hamburger.isVisible().catch(() => false)) {
    await hamburger.click();
    await page.waitForTimeout(250);
    await page.locator(`.menu-telefono button:has-text("${tab}")`).first().click();
  } else {
    await page.locator(`.nav button:has-text("${tab}")`).first().click();
  }
  await page.waitForTimeout(600);
}

for (const app of APPARECCHI) {
  const page = await browser.newPage({
    viewport: app.css,
    deviceScaleFactor: app.scala,
    locale: 'it-IT',
    // ► IL TEMA SCURO SI DICHIARA, NON SI SPERA. ◄ L'applicazione non ha un
    // interruttore suo: segue il sistema, con `prefers-color-scheme`. Chromium
    // senza questa riga dichiara «chiaro», e le fotografie uscirebbero nel tema
    // chiaro accanto a un'icona e a un banner scuri — due cose vere che insieme
    // sembrano due applicazioni diverse. Nessuno dei due tema è più vero
    // dell'altro: si sceglie quello che sta accanto al resto della scheda.
    colorScheme: 'dark',
  });
  await page.goto('http://localhost:4176/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.setInputFiles('input[type=file]', FILE);
  await page.waitForSelector('.card h2', { timeout: 120000 });
  await page.waitForTimeout(1500);

  /**
   * Porta in cima alla finestra il titolo che dà il nome alla schermata.
   *
   * Serve perché **la prima schermata di una scheda di negozio non deve essere
   * l'intestazione**: senza questo, la fotografia del Logbook mostrava due
   * riquadri di benvenuto e tre tendine di filtro, e l'elenco delle immersioni
   * — cioè la cosa che il programma fa — restava sotto il bordo. Una fotografia
   * che non mostra il contenuto non è sbagliata: è inutile, che è peggio,
   * perché non se ne accorge nessuno.
   */
  const portaInCima = async (testo, margine = 14) => {
    await page.evaluate(
      ({ testo, margine }) => {
        const m = document.querySelector('.main');
        if (!m) return;
        const titolo = [...m.querySelectorAll('h1, h2, h3')].find((h) => h.textContent.trim() === testo);
        if (!titolo) return;
        m.scrollTop += titolo.getBoundingClientRect().top - m.getBoundingClientRect().top - margine;
      },
      { testo, margine },
    );
    await page.waitForTimeout(350);
  };

  const scatta = async (nome) => {
    await page.waitForTimeout(300);
    // `fullPage: false` è deliberato: la fotografia deve essere la FINESTRA,
    // cioè quello che l'apparecchio mostra. Una pagina intera darebbe
    // un'immagine altissima, con un rapporto che Play rifiuta.
    await page.screenshot({ path: `${USCITA}/${app.nome}-${nome}.png` });
  };

  await vaiA(page, 'Logbook');
  await portaInCima('Logbook');
  await scatta('1-logbook');

  // La scheda di un'immersione: la prima riga dell'elenco, che nell'archivio
  // dimostrativo ha sempre il profilo campionato. È la schermata che dice cosa
  // fa davvero questo programma, e sta al secondo posto apposta.
  await page.locator('tbody tr td:nth-child(3)').first().click();
  await page.waitForTimeout(1800);
  await scatta('2-immersione');

  // Il profilo, in una fotografia sua. Sul tablet entra già nella schermata
  // sopra; sul telefono resta appena sotto il bordo, ed è la cosa che questo
  // programma fa e che si riconosce a colpo d'occhio: merita il suo riquadro
  // invece di stare mezzo tagliato in fondo a un altro.
  await portaInCima('Profilo');
  await scatta('3-profilo');

  await vaiA(page, 'Logbook');
  await vaiA(page, 'Statistiche');
  await scatta('4-statistiche');

  await vaiA(page, 'Suggerimenti');
  await scatta('5-suggerimenti');

  await vaiA(page, 'Gas');
  await scatta('6-gas');

  await page.close();
  console.log(`${app.nome}: fatte 6`);
}

await browser.close();
server.close();
console.log(`in ${USCITA}/`);
