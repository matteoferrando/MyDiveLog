/**
 * Verifica visiva dell'interfaccia: apre la build di produzione in Chromium,
 * importa i file dimostrativi e salva uno screenshot di ogni vista in
 * `screenshots/`.
 *
 *   npm run build && npm run demo
 *   npm i -D playwright && npx playwright install chromium
 *   node scripts/screenshot.mjs
 *
 * Serve perché i test unitari non vedono la geometria: una curva che esce dal
 * grafico o un'etichetta che collide non fanno fallire niente. Stampa anche gli
 * errori di console e il conteggio delle immersioni dopo la deduplica, che è la
 * verifica di correttezza più rapida che esista su questo progetto.
 */

import pw from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const { chromium } = pw;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(join(process.cwd(), 'dist', p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(4173, r));

// Un file per argomento sovrascrive l'elenco dimostrativo: utile per provare
// l'app su un export vero senza modificare lo script.
const files = process.argv.length > 2
  ? process.argv.slice(2)
  : [
      'demo/shearwater-cloud-export.uddf',
      'demo/subsurface-archivio.ssrf',
      'demo/shearwater-peregrine.xml',
      'demo/garmin-descent.fit',
      'demo/vecchio-logbook.csv',
    ];

import { mkdirSync } from 'node:fs';
mkdirSync('screenshots', { recursive: true });

// `PW_CHROMIUM` permette di usare un Chromium già presente sul sistema quando la
// versione di Playwright installata non corrisponde a quella dei suoi browser.
/**
 * Fotografa una pagina lunga a schermate successive.
 *
 * Il contenitore che scorre è `.main`, non il documento: `fullPage` di Playwright
 * guarda il documento e quindi restituirebbe sempre la sola prima schermata.
 */
async function shots(page, prefix, max = 6) {
  const height = await page.evaluate(() => {
    const el = document.querySelector('.main');
    el.scrollTop = 0;
    return el.scrollHeight;
  });
  const view = page.viewportSize().height;
  const steps = Math.min(max, Math.ceil(height / view));
  for (let i = 0; i < steps; i++) {
    await page.evaluate((y) => {
      document.querySelector('.main').scrollTop = y;
    }, i * (view - 60));
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${prefix}-${i + 1}.png` });
  }
  await page.evaluate(() => {
    document.querySelector('.main').scrollTop = 0;
  });
}

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const VW = +(process.env.VW || 1280);
const page = await browser.newPage({ viewport: { width: VW, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// La vista iniziale con archivio vuoto deve essere l'import.
await page.screenshot({ path: 'screenshots/1-import-vuoto.png', fullPage: true });

await page.setInputFiles('input[type=file]', files);
await page.waitForSelector('text=Esito dell\'import', { timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'screenshots/2-import-esito.png', fullPage: true });

const summary = await page.locator('table').first().innerText();

await page.click('button:has-text("Vai al logbook")');
await page.waitForTimeout(600);
const diveCount = await page.locator('tbody tr').count();
await page.screenshot({ path: 'screenshots/3-logbook.png', fullPage: true });

/*
 * Inserimento a mano, dal modulo vero.
 *
 * Vale la pena farlo qui e non solo nei test: i test del nucleo provano che
 * `buildManualDive` costruisce l'immersione giusta, ma non che il modulo la
 * salvi davvero, che l'elenco si aggiorni e che la saturazione compaia con la
 * dichiarazione di stima. Fra le due cose c'è tutto lo stato dell'applicazione.
 */
await page.click('button:has-text("Nuova immersione")');
await page.waitForTimeout(400);
// Datata PRIMA della più vecchia dell'archivio dimostrativo: così finisce in
// fondo all'elenco e i passi successivi continuano ad aprire la stessa
// immersione di sempre, invece di trovarsi davanti una senza profilo.
await page.fill('input[type=datetime-local]', '2025-09-01T10:00');
const campo = async (etichetta, valore) => {
  await page.locator('label', { hasText: etichetta }).first().locator('input').fill(String(valore));
};
await campo('Durata', 44);
await campo('Profondità massima', 27.5);
await campo('Profondità media', 16.4);
await campo('Sito', 'Ricopiata dal libretto');
await page.waitForTimeout(300);
await page.screenshot({ path: 'screenshots/3b-nuova-immersione.png', fullPage: true });
const avvisiNuova = await page.locator('.notice').first().innerText().catch(() => 'nessun avviso');
await page.click('button:has-text("Salva immersione")');
await page.waitForTimeout(900);
const dopoInserimento = await page.locator('tbody tr').count();
await page.screenshot({ path: 'screenshots/3c-dopo-inserimento.png', fullPage: true });

// Apri quella appena inserita e leggi la carta della saturazione: deve dire che
// i numeri sono stimati, altrimenti un GF99 ricostruito passa per misurato.
await page.locator('tbody tr', { hasText: 'Ricopiata dal libretto' }).first().click();
await page.waitForTimeout(900);
const saturazioneStimata = await page
  .locator('.card', { hasText: 'Saturazione' })
  .first()
  .innerText()
  .catch(() => 'CARTA SATURAZIONE MANCANTE');
await page.screenshot({ path: 'screenshots/3d-saturazione-stimata.png', fullPage: true });
await page.click('button:has-text("Logbook")');
await page.waitForTimeout(600);

// Apri la prima immersione.
await page.locator('tbody tr').first().click();
await page.waitForTimeout(900);
// La carta nuova: curva, tetto e TTS ricalcolati da noi lungo l'immersione.
const decoTl = await page
  .locator('.card')
  .filter({ has: page.locator('h2', { hasText: 'Curva e obbligo' }) })
  .first()
  .innerText()
  .catch(() => 'NESSUNA CARTA CURVA MINUTO PER MINUTO');
await page.screenshot({ path: 'screenshots/4-dettaglio.png', fullPage: true });
await shots(page, 'screenshots/4b-dettaglio');

// Hover sul profilo per verificare il tooltip.
const svg = page.locator('.chart svg').first();
const box = await svg.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.waitForTimeout(400);
}
await page.screenshot({ path: 'screenshots/5-tooltip.png', clip: box ? { x: box.x - 40, y: box.y - 60, width: box.width + 80, height: box.height + 120 } : undefined });

await page.click('button:has-text("Statistiche")');
await page.waitForTimeout(700);
await page.screenshot({ path: 'screenshots/6-statistiche.png', fullPage: true });
// `fullPage` non basta: il contenitore che scorre è `.main`, non il documento,
// quindi la parte bassa delle pagine lunghe non finirebbe in nessuno screenshot.
await shots(page, 'screenshots/6b-statistiche');

await page.click('button:has-text("Suggerimenti")');
await page.waitForTimeout(700);
await page.screenshot({ path: 'screenshots/7-piano.png', fullPage: true });
await shots(page, 'screenshots/7b-piano');

// Pianificatore di gas: il modulo va compilato dall'archivio, e le curve vanno
// ridisegnate quando un campo cambia — un'interazione che nessun test vede.
await page.click('button:has-text("Gas")');
await page.waitForTimeout(800);
await page.screenshot({ path: 'screenshots/13-gas.png', fullPage: true });
const gasTiles = await page.locator('.card', { hasText: 'Il tuo consumo' }).first().innerText();
const gasFields = await page.locator('.planner-field input').count();
// Cambio di profondità: i risultati e le curve devono seguire.
const depthInput = page.locator('.planner-field input').first();
await depthInput.fill('42');
await page.waitForTimeout(600);
const gasResult = await page.locator('.grid-tiles').nth(1).innerText();
const gasRuntime = await page.locator('.runtime').first().innerText();
await shots(page, 'screenshots/13b-gas');
// La riserva ricreativa: spenta la casella, il gas d'emergenza deve SPARIRE dalla
// pagina, non restare come numero calcolato e non mostrato.
await page.uncheck('[data-check="rock-bottom"]');
await page.waitForTimeout(500);
const gasFixed = await page.locator('.card', { hasText: 'Gas d\'emergenza: non calcolato' }).first().innerText();
await page.selectOption('select:below(:text("Regola di rientro"))', 'none').catch(() => {});
await page.waitForTimeout(400);
await shots(page, 'screenshots/13c-gas-ricreativa', 3);
await page.check('[data-check="rock-bottom"]');
await page.waitForTimeout(400);

// Sincronizzazione: solo il modulo del client libSQL è a caricamento pigro, e un
// errore di import si vedrebbe qui e non nei test.
await page.click('button:has-text("Impostazioni")');
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/10-impostazioni.png', fullPage: true });
// Con credenziali finte la connessione DEVE fallire con un messaggio, non con una
// pagina bianca: è il modo più rapido di verificare che il client si carichi.
await page.fill('input[type=text]', 'libsql://non-esiste-xyz.turso.io');
await page.fill('input[type=password]', 'token-finto');
await page.click('button:has-text("Prova la connessione")');
// Il limite di tempo del client è 30 s: qui si aspetta che il messaggio arrivi,
// perché il caso interessante è proprio "non resta appeso per sempre".
await page
  .waitForFunction(() => !document.body.innerText.includes('Verifica…'), null, { timeout: 45000 })
  .catch(() => console.log('ATTENZIONE: la prova di connessione non è terminata entro 45 s.'));
const syncMessage = await page.locator('.card').first().innerText();
await page.screenshot({ path: 'screenshots/11-sincronizza-errore.png', fullPage: true });

// L'analisi con Claude senza chiave configurata: il pulsante deve essere spento e
// la carta deve spiegare cosa manca, non fallire in silenzio.
await page.click('button:has-text("Suggerimenti")');
await page.waitForTimeout(600);
const aiCard = await page.locator('.card', { hasText: 'Rilettura del piano' }).first().innerText();
await page.screenshot({ path: 'screenshots/12-analisi.png', fullPage: true });

// Le carte nuove del pianificatore: contingenze, START, e il gas di deco.
await page.click('button:has-text("Gas")');
await page.waitForTimeout(700);
const contingenze = await page.locator('.card', { hasText: 'E se…' }).first().innerText().catch(() => 'CARTA MANCANTE');
const start = await page.locator('.card', { hasText: 'Prima di scendere' }).first().innerText().catch(() => 'CARTA MANCANTE');
// Le caselle si prendono per nome, non per posizione: aggiungerne una nuova
// altrove nella pagina non deve far puntare i test a quella sbagliata.
await page.check('[data-check="deco-mix"]');
await page.waitForTimeout(500);
const decoBox = await page.locator('.tile', { hasText: 'Ti serve' }).first().innerText().catch(() => 'NESSUN RIQUADRO DECO');
await shots(page, 'screenshots/14-gas-deco', 5);
await page.uncheck('[data-check="deco-mix"]');

// Modalità tecnica: la tabella di decompressione deve comparire con soste vere.
await page.click('button:has-text("Tecnica")');
await page.waitForTimeout(700);
const curvaCard = await page.locator('.card', { hasText: 'I livelli' }).first().innerText().catch(() => 'CARTA LIVELLI MANCANTE');
// Un profilo che la deco la prende di sicuro: 45 m per 30 minuti.
const livelli = page.locator('.card', { hasText: 'I livelli' }).first().locator('input[type=number]');
await livelli.nth(0).fill('45');
await livelli.nth(1).fill('30');
await page.waitForTimeout(600);
const tabella = await page.locator('.card', { hasText: 'Da portare in acqua' }).first().innerText().catch(() => 'NESSUNA TABELLA DI SOSTE');
const decoContingenze = await page.locator('.card', { hasText: 'Se qualcosa cambia' }).first().innerText().catch(() => 'NESSUNA CONTINGENZA');
await shots(page, 'screenshots/14b-deco-tecnica', 6);
await page.click('button:has-text("Ricreativa")');
await page.waitForTimeout(600);
const curva = await page.locator('.card').filter({ has: page.locator('h2', { hasText: 'Curva di sicurezza' }) }).first().innerText().catch(() => 'NESSUNA CARTA CURVA');

// Export UDDF dalle impostazioni: il file deve scaricarsi davvero.
await page.click('button:has-text("Impostazioni")');
await page.waitForTimeout(500);
const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
await page.click('button:has-text("Scarica UDDF")');
const uddf = await downloadPromise;
const uddfName = uddf ? uddf.suggestedFilename() : 'NESSUN DOWNLOAD';
let uddfBytes = 0;
if (uddf) {
  const path = await uddf.path();
  if (path) uddfBytes = (await import('node:fs/promises')).then ? (await (await import('node:fs/promises')).stat(path)).size : 0;
}
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshots/15-export.png', fullPage: true });

// Le pagine nuove: confronto e attrezzatura.
await page.click('button:has-text("Confronta")');
await page.waitForTimeout(900);
await page.screenshot({ path: 'screenshots/16-confronta.png', fullPage: true });
const confronto = await page.locator('.card', { hasText: 'Le differenze' }).first().innerText().catch(() => 'CARTA MANCANTE');

await page.click('button:has-text("Attrezzatura")');
await page.waitForTimeout(500);
await page.click('button:has-text("Aggiungi")');
await page.waitForTimeout(300);
await page.fill('.planner-field input[placeholder="D12 acciaio"]', 'Erogatore MK25');
await page.fill('input[type=date]', '2025-03-10');
await page.click('button:has-text("Salva")');
await page.waitForTimeout(500);
const attrezzatura = await page.locator('table').last().innerText().catch(() => 'TABELLA MANCANTE');
await page.screenshot({ path: 'screenshots/17-attrezzatura.png', fullPage: true });

// La mappa dei siti, dentro le statistiche.
await page.click('button:has-text("Statistiche")');
await page.waitForTimeout(700);
const mappa = await page.locator('.card', { hasText: 'Dove ti immergi' }).first().innerText().catch(() => 'CARTA MANCANTE');
await shots(page, 'screenshots/18-statistiche', 6);

// Modalità scura.
await page.emulateMedia({ colorScheme: 'dark' });
await page.click('button:has-text("Statistiche")');
await page.waitForTimeout(700);
await page.screenshot({ path: 'screenshots/8-statistiche-scuro.png', fullPage: true });

// Larghezza iPhone.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
await page.screenshot({ path: 'screenshots/9-mobile.png', fullPage: true });
// Il pianificatore è la pagina con più campi: se un modulo si rompe in
// larghezza, si rompe qui.
await page.click('button:has-text("Gas")');
await page.waitForTimeout(700);
await shots(page, 'screenshots/9b-mobile-gas', 4);

// Trabocco orizzontale a larghezza telefono.
// Una pagina che scorre in orizzontale su un telefono è un difetto che nessuna
// schermata rende evidente — la fotografia si allarga insieme al contenuto — e
// che invece si misura in una riga: se `scrollWidth` supera la larghezza della
// finestra, qualcosa dentro non ha accettato di stringersi.
const overflow = [];
for (const tab of ['Logbook', 'Statistiche', 'Coach', 'Gas', 'Confronta', 'Attrezzatura', 'Importa', 'Sincronizza']) {
  await page.click(`button:has-text("${tab}")`).catch(() => {});
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > w + 1)
      .slice(0, 4)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`);
    return { doc: document.documentElement.scrollWidth, w, wide };
  });
  if (info.doc > info.w + 1) overflow.push(`${tab}: ${info.doc}px su ${info.w} — ${info.wide.join(', ')}`);
}

await browser.close();
server.close();
console.log('IMPORT SUMMARY:\n' + summary);
console.log('DIVE ROWS:', diveCount, '→ dopo inserimento a mano:', dopoInserimento);
console.log('AVVISI DEL MODULO:\n' + avvisiNuova.slice(0, 400));
console.log('SATURAZIONE STIMATA:\n' + saturazioneStimata.slice(0, 700));
console.log('SYNC CARD:\n' + syncMessage);
console.log('AI CARD:\n' + aiCard);
console.log('GAS CONSUMO:\n' + gasTiles);
console.log('GAS CAMPI:', gasFields);
console.log('GAS A 42 m:\n' + gasResult);
console.log('GAS DURATA:\n' + gasRuntime);
console.log('GAS RISERVA FISSA:\n' + gasFixed);
console.log('CONTINGENZE:\n' + contingenze.slice(0, 400));
console.log('START:\n' + start.slice(0, 300));
console.log('DECO:\n' + decoBox);
console.log('EXPORT UDDF:', uddfName, uddfBytes ? `(${Math.round(uddfBytes / 1024)} kB)` : '');
console.log('CONFRONTO:\n' + confronto.slice(0, 300));
console.log('ATTREZZATURA:\n' + attrezzatura.slice(0, 260));
console.log('MAPPA:\n' + mappa.slice(0, 220));
console.log('CURVA MINUTO PER MINUTO:'); console.log(decoTl.slice(0, 700));
console.log('LIVELLI:'); console.log(curvaCard.slice(0, 300));
console.log('TABELLA SOSTE:'); console.log(tabella.slice(0, 600));
console.log('CONTINGENZE DECO:'); console.log(decoContingenze.slice(0, 700));
console.log('CURVA RICREATIVA:'); console.log(curva.slice(0, 600));
console.log('TRABOCCO A 390 px:', overflow.length ? overflow : 'nessuno');
console.log('CONSOLE ERRORS:', errors.length ? errors.slice(0, 10) : 'nessuno');
