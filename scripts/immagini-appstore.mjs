/**
 * Le schermate per l'App Store — iPhone e Mac, in italiano e in inglese —
 * prese dall'applicazione vera.
 *
 *   npm run appstore
 *
 * che costruisce, rigenera l'archivio dimostrativo, fotografa e alla fine
 * misura tutto contro le specifiche di Apple (`controlla-appstore.mjs`).
 *
 * Stessa regola delle schermate di Play e del sito: **quello che si mette nella
 * scheda di un negozio è una promessa**. È la build in `dist/`, caricata con
 * l'archivio dimostrativo, fotografata alle misure che Apple accetta. Niente
 * cornici di telefono, niente ritocchi.
 *
 * ► PERCHÉ ESISTE. ◄ Misurato il 22 settembre 2026 sulla scheda pubblica: le
 * dieci schermate dell'iPhone sono fotografie fatte dal proprietario sul suo
 * telefono, col suo archivio, **e hanno ancora il pulsante del menu in alto a
 * destra** — che dalla 1.8.23 è una barra in basso. E aggiungendo la scheda in
 * inglese, Apple parte dalle schermate della lingua principale: a chi legge in
 * inglese avrebbe mostrato l'app in italiano. Quelle del Mac dalla scheda
 * pubblica non si vedono: l'API di Apple restituisce solo quelle dell'iPhone.
 *
 * L'archivio dimostrativo non è l'archivio vero, ed è una scelta: **le
 * schermate del proprietario restano sue** (decisione del 27 agosto), e questo
 * script non le sostituisce da solo. Prepara un'alternativa che si rifà in un
 * comando, uguale in due lingue, e quale caricare lo decide lui.
 *
 * ► LE MISURE, dalle specifiche di Apple lette il 22 settembre 2026. ◄
 *
 *   iPhone 6,9"   440 × 956 px CSS × 3  →  1320 × 2868
 *   Mac           1440 × 900 px CSS × 2  →  2880 × 1800   (16:10)
 *
 * Il 6,9" basta per tutti gli iPhone: senza le misure più piccole, Apple
 * scala queste. Il Mac ha le sue, obbligatorie per un'app Mac. Come per Play,
 * la misura si ottiene col `deviceScaleFactor` e non allargando la finestra:
 * 440 px CSS è la larghezza di un iPhone Pro Max, e un'interfaccia da 1320 px
 * CSS sarebbe quella del desktop rimpicciolita dentro un telefono.
 *
 * ► IL MAC SENZA I SEMAFORI. ◄ La barra del titolo trasparente del Mac lascia
 * 88 px a sinistra per i tre pulsanti della finestra, che sono del sistema e
 * non della pagina: fotografata col guscio `desktop`, la barra avrebbe 88 px di
 * vuoto senza niente dentro. Si fotografa col guscio `web`, che è la stessa
 * interfaccia con la barra che comincia dal bordo.
 *
 * ► IL TEMA SCURO, come le schermate di Play. ◄ L'applicazione segue il
 * sistema; nelle due schede dei negozi la stessa app deve sembrare la stessa.
 *
 * ► `npm run demo` SPORCA `demo/`. ◄ Come per Play: dopo, `git restore
 * --source=HEAD -- demo/`.
 */

import pw from 'playwright';
import { FUSO_DELLE_FOTOGRAFIE, portaInCima, vaiA } from './naviga.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, readFileSync } from 'node:fs';
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
await new Promise((r) => server.listen(4178, r));

const USCITA = '_transfer/appstore';
mkdirSync(USCITA, { recursive: true });

const FILE = [
  'demo/shearwater-cloud-export.uddf',
  'demo/subsurface-archivio.ssrf',
  'demo/shearwater-peregrine.xml',
  'demo/garmin-descent.fit',
];

const APPARECCHI = [
  { nome: 'iphone', css: { width: 440, height: 956 }, scala: 3, guscio: 'ios', attesa: [1320, 2868] },
  { nome: 'mac', css: { width: 1440, height: 900 }, scala: 2, guscio: 'web', attesa: [2880, 1800] },
];

/**
 * ► I NOMI DELLE SCHEDE SI LEGGONO DAL DIZIONARIO. ◄ `immagini-sito.mjs` li
 * scrive a mano in due lingue: è la stessa navigazione copiata un'altra volta,
 * e il giorno che «Suggerimenti» cambia nome in inglese quella copia resta
 * indietro senza dirlo. Qui l'inglese viene da `src/ui/traduzioni.ts`, e se la
 * voce non c'è lo script si ferma invece di cercare un pulsante che non esiste.
 */
const DIZIONARIO = readFileSync('src/ui/traduzioni.ts', 'utf8');
function inIngleseDi(frase) {
  const chiave = frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^\\s*'?${chiave}'?:\\s*'([^']+)'`, 'm').exec(DIZIONARIO);
  if (!m) throw new Error(`«${frase}» non ha una voce in traduzioni.ts`);
  return m[1];
}

const browser = await pw.chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);

for (const [locale, lingua] of [
  ['it-IT', 'it'],
  ['en-US', 'en'],
]) {
  const nome = (frase) => (lingua === 'it' ? frase : inIngleseDi(frase));
  for (const app of APPARECCHI) {
    const page = await browser.newPage({
      viewport: app.css,
      deviceScaleFactor: app.scala,
      // La lingua si dichiara al contesto, come fa `immagini-sito.mjs`: si parte
      // già nella lingua giusta invece di fotografare l'istante del cambio.
      locale,
      timezoneId: FUSO_DELLE_FOTOGRAFIE,
      colorScheme: 'dark',
    });
    /*
     * ► IL GUSCIO DELL'APPARECCHIO VERO, E RILETTO. ◄ Nel browser `main.tsx`
     * dichiara `web`; l'app sull'iPhone dichiara `ios`. Oggi l'unica regola del
     * foglio di stile che guarda il guscio è quella dei semafori del Mac, quindi
     * sull'iPhone `ios` e `web` si disegnano uguali: si dichiara lo stesso quello
     * vero, così il giorno che nasce una regola per l'iPhone le fotografie la
     * seguono da sole. Il valore si scrive DOPO `main.tsx` — i moduli girano
     * prima di `DOMContentLoaded`, questo ascoltatore dopo — e più sotto si
     * rilegge, invece di contare sull'ordine.
     */
    await page.addInitScript((g) => {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.dataset.guscio = g;
      });
    }, app.guscio);
    await page.goto('http://localhost:4178/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.setInputFiles('input[type=file]', FILE);
    await page.waitForSelector('.card h2', { timeout: 120000 });
    await page.waitForTimeout(1500);
    const guscio = await page.evaluate(() => document.documentElement.dataset.guscio);
    if (guscio !== app.guscio) throw new Error(`${app.nome}: guscio «${guscio}» invece di «${app.guscio}»`);

    const scatta = async (scena) => {
      await page.waitForTimeout(300);
      const file = `${USCITA}/${app.nome}-${lingua}-${scena}.png`;
      await page.screenshot({ path: file });
      // Il conto di `deviceScaleFactor` si verifica, non si spera: una misura
      // sbagliata di un pixel e App Store Connect rifiuta il file.
      const png = readFileSync(file);
      const misura = [png.readUInt32BE(16), png.readUInt32BE(20)];
      if (misura[0] !== app.attesa[0] || misura[1] !== app.attesa[1]) {
        throw new Error(`${file}: ${misura.join('×')} invece di ${app.attesa.join('×')}`);
      }
    };

    await vaiA(page, nome('Logbook'));
    await portaInCima(page, nome('Logbook'));
    await scatta('1-logbook');

    await page.locator('tbody tr td:nth-child(3)').first().click();
    await page.waitForTimeout(1800);
    await scatta('2-immersione');

    await portaInCima(page, nome('Profilo'));
    await scatta('3-profilo');

    await vaiA(page, nome('Logbook'));
    await vaiA(page, nome('Statistiche'));
    await scatta('4-statistiche');

    await vaiA(page, nome('Suggerimenti'));
    await scatta('5-suggerimenti');

    await vaiA(page, nome('Gas'));
    await scatta('6-gas');

    await page.close();
    console.log(`${app.nome} ${lingua}: fatte 6`);
  }
}

await browser.close();
server.close();
console.log(`in ${USCITA}/`);
