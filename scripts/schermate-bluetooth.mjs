/**
 * Le schermate dello scarico Bluetooth, fotografate e MISURATE.
 *
 *   npm i -D playwright && npx playwright install chromium
 *   node scripts/schermate-bluetooth.mjs      (oppure: npm run schermate:ble)
 *
 * PERCHÉ ESISTE UNO SCRIPT A PARTE. `scripts/screenshot.mjs` guarda la build
 * normale, dove il Bluetooth non c'è: nel browser non esiste, quindi premere
 * «Cerca il computer» produce una spiegazione e finisce lì. Tutto quello che
 * viene DOPO — l'elenco dei dispositivi trovati, l'avanzamento, il computer che
 * si scollega a metà, il riquadro dei segnalibri, l'esito — non è mai stato
 * fotografato da nessuno, perché quelle schermate esistono solo quando una
 * ricerca Bluetooth trova qualcosa.
 *
 * E infatti è di lì che è uscito il difetto arrivato fino all'utente: a 390 px
 * l'elenco dei dispositivi si trascinava di lato. Nessun controllo automatico
 * poteva prenderlo.
 *
 * COME. Si compila con `VITE_FINTO_BLUETOOTH=1` in `dist-ble/` — una cartella a
 * parte, così la build normale resta quella che si pubblica — e in quella build
 * il trasporto vero è sostituito da quattro computer subacquei finti che
 * rispondono davvero (vedi `src/ui/bluetoothFinto.ts`). Nella build normale
 * quel modulo non esiste: la bandiera è di compilazione, e in fondo a questo
 * file c'è il controllo che lo dimostra.
 *
 * LA MISURA CHE CONTA È IL TRABOCCO DEI CONTENITORI INTERNI, non del documento.
 * È l'errore che ha lasciato passare il difetto: `documentElement.scrollWidth`
 * era pulito mentre un contenitore dentro la pagina si trascinava di 260 px.
 * Qui si guarda OGNI elemento visibile che possa scorrere in orizzontale e si
 * confronta `scrollWidth` con `clientWidth`. Se qualcosa sfora, il processo
 * esce con codice diverso da zero: è fatto apposta per poter finire in CI.
 */

import pw from 'playwright';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const { chromium } = pw;
const CARTELLA = 'dist-ble';
const PORTA = 4174;
const LARGHEZZE = [
  // 390: un iPhone qualunque, ed è la larghezza a cui il difetto è successo.
  { px: 390, alto: 780, nome: '390' },
  // 1280: il portatile. Serve perché le due disposizioni sono diverse davvero
  // — sotto i 700 px la navigazione diventa un hamburger — e un difetto
  // aggiustato stringendo può ricomparire allargando.
  { px: 1280, alto: 900, nome: '1280' },
];

// ------------------------------------------------------------------ la build

/*
 * Si ricompila ogni volta, e non è pigrizia: una fotografia fatta su una build
 * vecchia è peggio di nessuna fotografia, perché dice che il difetto è
 * aggiustato quando non lo è. `SALTA_BUILD=1` esiste solo per chi sta
 * lavorando su questo script.
 */
if (!process.env.SALTA_BUILD) {
  console.log(`Compilo in ${CARTELLA}/ con VITE_FINTO_BLUETOOTH=1…`);
  const build = spawnSync('npx', ['vite', 'build', '--outDir', CARTELLA, '--emptyOutDir'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_FINTO_BLUETOOTH: '1' },
  });
  if (build.status !== 0) {
    console.error('La compilazione è fallita: non c’è niente da fotografare.');
    process.exit(1);
  }
}

// ----------------------------------------------------------------- il server

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const server = createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(join(process.cwd(), CARTELLA, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(PORTA, r));

mkdirSync('screenshots/ble', { recursive: true });

// ------------------------------------------------------------- gli strumenti

/** Quello che si è misurato, riga per riga. Vuoto = pulito. */
const trabocchi = [];
/** Le schermate che si sono davvero prodotte, per poterlo dichiarare alla fine. */
const fatte = [];
const errori = [];

/**
 * Va a una scheda, QUALUNQUE sia la larghezza della finestra.
 *
 * Copiato da `screenshot.mjs` insieme alla lezione che c'è dietro: sotto i
 * 700 px la striscia di navigazione non esiste, c'è l'hamburger. Un clic che
 * non trova il pulsante deve ROMPERE — un `catch` vuoto qui significa misurare
 * otto volte la stessa pagina e dichiararle tutte pulite.
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
  await page.waitForTimeout(400);
}

/**
 * Fotografa, e dichiara di averlo fatto.
 *
 * L'elenco di quello che è stato prodotto è metà del valore di questo script:
 * senza, «le schermate sono coperte» è un'affermazione che nessuno può
 * verificare senza aprire la cartella.
 */
async function scatta(page, larghezza, nome) {
  const file = `screenshots/ble/${larghezza}-${nome}.png`;
  await page.screenshot({ path: file, fullPage: true });
  fatte.push(`${larghezza} px · ${nome}`);
}

/**
 * IL TRABOCCO ORIZZONTALE, contenitore per contenitore.
 *
 * Ieri si guardava `documentElement.scrollWidth` e basta: era pulito mentre
 * `.table-scroll` dentro la pagina si trascinava di 260 px sotto il dito. Il
 * guscio dell'applicazione è alto quanto la finestra e ogni pezzo che scorre lo
 * fa per conto suo, quindi la domanda giusta non è «scorre il documento» ma
 * «QUALE contenitore scorre».
 *
 * Il criterio: ogni elemento visibile il cui `overflow-x` non è `visible` —
 * cioè ogni elemento che PUÒ scorrere o tagliare — con `scrollWidth` più largo
 * del suo `clientWidth`. Più il documento, che resta il caso più grave perché
 * fa muovere tutta la pagina.
 *
 * `chi` serve a saper poi dove guardare: un nome tipo «390 px · elenco dei
 * dispositivi» vale dieci minuti quando il difetto rientra fra sei mesi.
 */
async function misura(page, chi) {
  const trovati = await page.evaluate(() => {
    const nome = (el) => {
      const cls = (el.className || '').toString().trim().split(/\s+/)[0];
      return el.tagName.toLowerCase() + (cls ? `.${cls}` : '') + (el.id ? `#${el.id}` : '');
    };
    const out = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      out.push({
        che: 'il documento intero',
        scroll: doc.scrollWidth,
        visibile: doc.clientWidth,
        colpevoli: [],
      });
    }
    for (const el of document.querySelectorAll('body *')) {
      const st = getComputedStyle(el);
      if (st.overflowX === 'visible') continue;
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      // Un elemento chiuso (un `<details>` non aperto, una scheda nascosta) non
      // è un difetto: nessuno lo vede e nessuno lo può trascinare.
      if (r.width === 0 || r.height === 0) continue;
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      /*
       * CHI lo fa sforare, non solo che sfora. Il contenitore è la vittima; il
       * colpevole è il figlio che non ha accettato di stringersi, ed è quello
       * su cui si mette le mani. Senza questo, «.table-scroll sfora» manda a
       * cercare nel CSS del contenitore, che è quasi sempre innocente.
       */
      const limite = el.getBoundingClientRect().right;
      const colpevoli = [...el.querySelectorAll('*')]
        .filter((f) => f.getBoundingClientRect().right > limite + 1)
        .slice(0, 3)
        .map((f) => `${nome(f)} «${(f.textContent || '').trim().slice(0, 40)}»`);
      out.push({ che: nome(el), scroll: el.scrollWidth, visibile: el.clientWidth, colpevoli });
    }
    return out;
  });
  for (const t of trovati) {
    trabocchi.push(
      `${chi} — ${t.che}: ${t.scroll}px dentro ${t.visibile}px (+${t.scroll - t.visibile})` +
        (t.colpevoli.length ? `\n      colpevole: ${t.colpevoli.join(' · ')}` : ''),
    );
  }
}

// ------------------------------------------------------------------ il giro

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);

/**
 * Un giro completo a una larghezza.
 *
 * Ogni larghezza ha il suo contesto: l'archivio si azzera, quindi il segnalibro
 * salvato dal primo giro non falsa il secondo — e il riquadro dei segnalibri
 * compare quando deve, cioè dopo il primo scarico riuscito, e non prima.
 */
async function giro({ px, alto, nome: larghezza }) {
  const contesto = await browser.newContext({
    viewport: { width: px, height: alto },
    deviceScaleFactor: 1,
    locale: 'it-IT',
  });
  const page = await contesto.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errori.push(`${larghezza}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errori.push(`${larghezza}: pageerror ${e.message}`));

  // --------------------------------------------------- 1. l'elenco dei trovati
  await page.goto(`http://localhost:${PORTA}/`, { waitUntil: 'networkidle' });
  await vaiA(page, 'Importa');
  await page.locator('button:has-text("Cerca il computer")').first().click();
  // Quattro dispositivi: se non arrivano, il finto non è nella build e tutto il
  // resto misurerebbe una pagina vuota dichiarandola pulita.
  await page.waitForFunction(() => document.querySelectorAll('.dispositivi li').length === 4, null, {
    timeout: 15_000,
  });
  await page.waitForTimeout(300);
  await scatta(page, larghezza, '1-elenco-dispositivi');
  await misura(page, `${larghezza} px · elenco dei dispositivi`);
  const elenco = await page.locator('.dispositivi').innerText();

  // ------------------------------------- 2. l'avanzamento e l'esito riuscito
  await page
    .locator('.dispositivi li', { hasText: 'Peregrine' })
    .locator('button:has-text("Scarica")')
    .click();
  await page.waitForSelector('button:has-text("Interrompi")', { timeout: 10_000 });
  await page.waitForTimeout(600);
  await scatta(page, larghezza, '2-avanzamento');
  await misura(page, `${larghezza} px · avanzamento dello scarico`);
  await page.waitForSelector('button:has-text("Cerca il computer")', { timeout: 60_000 });
  await page.waitForTimeout(400);
  await scatta(page, larghezza, '3-esito-riuscito');
  await misura(page, `${larghezza} px · esito dello scarico riuscito`);
  const esito = await page.locator('.card .notice').first().innerText();

  // Il diario tecnico aperto: è un muro di esadecimale dentro un `<pre>`, cioè
  // il posto dove un trabocco orizzontale è quasi garantito se nessuno guarda.
  await page.locator('details summary', { hasText: 'Diario tecnico' }).click();
  await page.waitForTimeout(300);
  await scatta(page, larghezza, '4-diario-tecnico');
  await misura(page, `${larghezza} px · diario tecnico aperto`);

  // ------------------------------------------------ 3. il riquadro dei segnalibri
  await page.locator('button:has-text("Cerca il computer")').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.dispositivi li').length === 4, null, {
    timeout: 15_000,
  });
  await page.waitForTimeout(300);
  await scatta(page, larghezza, '5-segnalibri');
  await misura(page, `${larghezza} px · riquadro dei segnalibri`);
  const segnalibro = await page.locator('.notice', { hasText: 'l’ultima volta' }).first().innerText();

  // ------------------------------- 4. lo scarico interrotto, dal senza nome
  /*
   * Si passa dalla TENDINA, che è il percorso vero per un dispositivo che non
   * annuncia un nome: l'applicazione non lo riconosce, chi ha il computer in
   * mano sì. E quel dispositivo si scollega a metà, che è la cosa che succede
   * davvero in barca.
   */
  // Si cerca per «senza nome», non per l'identificativo: l'elenco NON lo
  // mostra più. Era proprio lui a sfondare la tabella — trentasei caratteri
  // senza un punto in cui spezzarsi — e il rimedio è stato togliere di mezzo
  // la tabella e l'identificativo insieme. Il dispositivo finto continua ad
  // annunciarsi senza nome perché il caso resta quello, e la fotografia serve
  // a vedere che adesso ci sta.
  const senzaNome = page.locator('.dispositivi li', { hasText: 'senza nome' });
  await senzaNome.locator('select').selectOption('shearwater');
  await page.waitForSelector('button:has-text("Interrompi")', { timeout: 10_000 });
  await page.waitForTimeout(500);
  await scatta(page, larghezza, '6-avanzamento-senza-nome');
  await page.waitForSelector('button:has-text("Cerca il computer")', { timeout: 60_000 });
  await page.waitForTimeout(400);
  await scatta(page, larghezza, '7-esito-interrotto');
  await misura(page, `${larghezza} px · esito dello scarico interrotto`);
  const interrotto = await page.locator('.card .notice').first().innerText();

  // ------------------------------------------- 5. il computer che non risponde
  await page.locator('button:has-text("Cerca il computer")').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.dispositivi li').length === 4, null, {
    timeout: 15_000,
  });
  await page
    .locator('.dispositivi li', { hasText: 'Aladin Sport' })
    .locator('button:has-text("Scarica")')
    .click();
  await page.waitForSelector('button:has-text("Cerca il computer")', { timeout: 60_000 });
  await page.waitForTimeout(400);
  await scatta(page, larghezza, '8-esito-nessuna-risposta');
  await misura(page, `${larghezza} px · esito «il computer non risponde»`);
  const muto = await page.locator('.card .notice').first().innerText();

  // ---------------------------------- 6. la ricerca che non trova niente
  /*
   * Dodici secondi di attesa, e sono il punto della prova: è dopo dodici
   * secondi che compare il riquadro che elenca le tre cause possibili, ed è la
   * schermata che su iPhone sta davanti a chi ha negato il permesso Bluetooth —
   * dove il permesso negato non produce nessun errore e la ricerca sembra solo
   * non trovare niente.
   */
  await page.goto(`http://localhost:${PORTA}/?finto=vuoto`, { waitUntil: 'networkidle' });
  await vaiA(page, 'Importa');
  await page.locator('button:has-text("Cerca il computer")').first().click();
  await page.waitForSelector('.notice:has-text("Ancora niente")', { timeout: 20_000 });
  await scatta(page, larghezza, '9-ricerca-a-vuoto');
  await misura(page, `${larghezza} px · ricerca che non trova niente`);
  const vuoto = await page.locator('.notice', { hasText: 'Ancora niente' }).innerText();

  // ------------------------------------------- 7. il Bluetooth spento
  await page.goto(`http://localhost:${PORTA}/?finto=spento`, { waitUntil: 'networkidle' });
  await vaiA(page, 'Importa');
  await page.locator('button:has-text("Cerca il computer")').first().click();
  await page.waitForSelector('.notice-error', { timeout: 10_000 });
  await scatta(page, larghezza, '10-bluetooth-spento');
  await misura(page, `${larghezza} px · Bluetooth spento`);
  const spento = await page.locator('.notice-error').first().innerText();

  await contesto.close();
  return { elenco, esito, segnalibro, interrotto, muto, vuoto, spento };
}

const esiti = {};
for (const l of LARGHEZZE) esiti[l.nome] = await giro(l);
await browser.close();
server.close();

// ------------------------------------------- il finto NON è nella build normale

/*
 * LA PROVA, non la promessa.
 *
 * Tutto il ragionamento sulla bandiera di compilazione vale zero se non lo
 * verifica qualcosa: si legge il `dist/` — la build normale, quella che si
 * pubblica — e ci si cerca dentro il finto. Se `dist/` non c'è, si dichiara che
 * non si è potuto controllare, invece di stampare «pulito» per una cartella
 * inesistente. Che è lo stesso errore di misurare il documento invece del
 * contenitore: un controllo che non può fallire non è un controllo.
 */
let bandiera = 'non verificato: manca dist/ (compila con `npm run build`)';
try {
  const file = await readdir('dist/assets');
  const sporchi = [];
  for (const f of file) {
    if (!f.endsWith('.js')) continue;
    const testo = await readFile(join('dist/assets', f), 'utf8');
    if (/FakeTransport|bluetoothFinto|fintoPeregrine|Samsung 5 Series/.test(testo)) sporchi.push(f);
  }
  bandiera = sporchi.length
    ? `IL FINTO È FINITO NELLA BUILD NORMALE: ${sporchi.join(', ')}`
    : `pulito: nessuna traccia del finto in ${file.length} file di dist/assets`;
  if (sporchi.length) trabocchi.push('il finto è nel bundle di produzione');
} catch {
  /* dist/ non c'è: lo dice la stringa qui sopra. */
}

// ------------------------------------------------------------- il riepilogo

const riga = (t) => console.log(t);
riga('');
riga('════════════════════════ SCHERMATE DELLO SCARICO BLUETOOTH ════════════════════════');
riga(`SCHERMATE PRODOTTE (${fatte.length}) in screenshots/ble/:`);
for (const f of fatte) riga(`  · ${f}`);
riga('');
riga('ELENCO DEI DISPOSITIVI (390 px):');
riga(esiti['390'].elenco.replace(/^/gm, '  '));
riga('');
riga('ESITO RIUSCITO: ' + esiti['390'].esito.replace(/\n/g, ' ').slice(0, 220));
riga('SEGNALIBRO: ' + esiti['390'].segnalibro.replace(/\n/g, ' ').slice(0, 220));
riga('SCARICO INTERROTTO: ' + esiti['390'].interrotto.replace(/\n/g, ' ').slice(0, 260));
riga('NESSUNA RISPOSTA: ' + esiti['390'].muto.replace(/\n/g, ' ').slice(0, 260));
riga('RICERCA A VUOTO: ' + esiti['390'].vuoto.replace(/\n/g, ' ').slice(0, 260));
riga('BLUETOOTH SPENTO: ' + esiti['390'].spento.replace(/\n/g, ' ').slice(0, 200));
riga('');
riga('IL FINTO NELLA BUILD NORMALE: ' + bandiera);
riga('ERRORI DI CONSOLE: ' + (errori.length ? errori.slice(0, 8).join('\n  ') : 'nessuno'));
riga('');
if (trabocchi.length) {
  riga(`TRABOCCO ORIZZONTALE — ${trabocchi.length} punti:`);
  for (const t of trabocchi) riga(`  ✗ ${t}`);
  riga('');
  riga('Esco con codice 1: questo è il difetto che è arrivato fino all’utente.');
  process.exit(1);
}
riga('TRABOCCO ORIZZONTALE: nessuno, né nel documento né nei contenitori interni.');
