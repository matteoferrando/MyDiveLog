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
await new Promise((r) => server.listen(4173, r));

// Un file per argomento sovrascrive l'elenco dimostrativo: utile per provare
// l'app su un export vero senza modificare lo script.
const files =
  process.argv.length > 2
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
    await page.evaluate(
      (y) => {
        document.querySelector('.main').scrollTop = y;
      },
      i * (view - 60),
    );
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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// La vista iniziale con archivio vuoto deve essere l'import.
await page.screenshot({ path: 'screenshots/1-import-vuoto.png', fullPage: true });

await page.setInputFiles('input[type=file]', files);
await page.waitForSelector("text=Esito dell'import", { timeout: 60000 });
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
/*
 * Con la VIRGOLA, non con il punto.
 *
 * È il separatore che una tastiera italiana produce, ed era il difetto: con
 * `type="number"` il campo accetta solo il separatore della lingua della
 * webview, quindi «27,5» arrivava vuoto o troncato a 275 senza un segnale.
 * Ora i campi decimali sono di testo e la conversione la fa `num()`. Se questa
 * riga tornasse a `27.5` il difetto potrebbe rientrare senza che nessuno lo
 * veda: il valore va scritto qui come lo scrive una persona.
 */
await campo('Profondità massima', '27,5');
await campo('Profondità media', '16,4');
await campo('Sito', 'Ricopiata dal libretto');
await page.waitForTimeout(300);
await page.screenshot({ path: 'screenshots/3b-nuova-immersione.png', fullPage: true });
const avvisiNuova = await page
  .locator('.notice')
  .first()
  .innerText()
  .catch(() => 'nessun avviso');
await page.click('button:has-text("Salva immersione")');
await page.waitForTimeout(900);
/*
 * Dopo un salvataggio RIUSCITO deve comparire la conferma, non il riquadro
 * rosso degli errori del modulo appena svuotato. Il modulo resta aperto — chi
 * ricopia un libretto ne inserisce cinque di fila — e prima l'unico messaggio
 * in pagina diceva il contrario di quello che era appena successo.
 */
const esitoSalvataggio = await page
  .locator('.notice')
  .filter({ hasText: 'Immersione aggiunta' })
  .count()
  .catch(() => 0);
const rossoDopoSalvataggio = await page.locator('.notice-error').count();
await page.click('button:has-text("Chiudi")');
await page.waitForTimeout(400);
const dopoInserimento = await page.locator('tbody tr').count();
await page.screenshot({ path: 'screenshots/3c-dopo-inserimento.png', fullPage: true });

const rigaManuale = await page
  .locator('tbody tr', { hasText: 'Ricopiata dal libretto' })
  .first()
  .innerText()
  .catch(() => 'RIGA MANCANTE');

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

/*
 * Modifica in blocco: si selezionano due immersioni e si scrive un campo solo.
 * La proprietà da verificare non è che il modulo compaia — quella si vede in
 * fotografia — ma che scriva SOLO il campo compilato e lasci stare gli altri.
 */
const primaDelBlocco = await page.locator('tbody tr').nth(1).innerText();
await page.locator('tbody tr').nth(1).locator('input[type=checkbox]').check();
await page.locator('tbody tr').nth(2).locator('input[type=checkbox]').check();
await page.waitForTimeout(400);
await page.locator('label', { hasText: 'Compagno' }).first().locator('input').fill('Squadra di prova');
await page.waitForTimeout(200);
await page.screenshot({ path: 'screenshots/3e-modifica-in-blocco.png', fullPage: true });
await page.click('button:has-text("Applica a 2")');
await page.waitForTimeout(1500);
const dopoIlBlocco = await page.locator('tbody tr').nth(1).innerText();

/*
 * Le condizioni, scritte in blocco su due gruppi diversi.
 *
 * Serve a due cose insieme. La prima è provare i campi nuovi della modifica in
 * blocco, che è il posto giusto per compilarle: mare, meteo e visibilità sono le
 * uniche cose che valgono davvero uguali per otto immersioni di fila.
 *
 * La seconda è dare da mangiare alla tabella delle condizioni nelle statistiche:
 * l'archivio dimostrativo non ha nessun dato meteo, quindi senza questo passaggio
 * quella carta non comparirebbe mai e nessuno la vedrebbe fino a quando non la
 * riempie un utente vero. Due gruppi e non uno, perché con un gruppo solo non c'è
 * niente da confrontare e la carta si rifiuta di comparire — che è la regola che
 * si vuole verificare.
 */
async function condizioniInBlocco(righe, meteo, mare, visibilita) {
  for (const n of righe) await page.locator('tbody tr').nth(n).locator('input[type=checkbox]').check();
  await page.waitForTimeout(300);
  await page.locator('label', { hasText: 'Meteo' }).first().locator('select').selectOption(meteo);
  await page.locator('label', { hasText: 'Mare' }).first().locator('select').selectOption(mare);
  await page
    .locator('label', { hasText: 'Visibilità' })
    .first()
    .locator('select')
    .selectOption({ index: visibilita });
  await page.locator(`button:has-text("Applica a ${righe.length}")`).first().click();
  await page.waitForTimeout(1800);
}
/*
 * L'attrezzatura in blocco, e la piastra che arriva dal GAV.
 *
 * È il percorso per cui esiste la colonna «Immersioni» nell'inventario: senza
 * un modo di collegare otto immersioni di un viaggio allo stesso erogatore in
 * un colpo, quel conteggio resterebbe a zero per sempre. Si prova qui perché è
 * fatto di tre pezzi che devono combaciare — il selettore, il salvataggio in
 * inventario e la scrittura sulle immersioni — e nessuno dei tre da solo dice
 * se il conto poi torna.
 */
await page.locator('tbody tr').nth(3).locator('input[type=checkbox]').check();
await page.locator('tbody tr').nth(4).locator('input[type=checkbox]').check();
await page.waitForTimeout(300);
await page.locator('input[list^="attrezzi-regulator"]').first().fill('Apeks XTX50');
await page.waitForTimeout(200);
await page.locator('button:has-text("in attrezzatura")').first().click();
await page.waitForTimeout(400);
await page.locator('label', { hasText: 'Piastra o schienalino' }).first().locator('input').fill('3');
await page.screenshot({ path: 'screenshots/3g-attrezzatura-in-blocco.png', fullPage: true });
await page.locator('button:has-text("Applica a 2")').first().click();
await page.waitForTimeout(1800);

// Il conteggio nell'inventario: due immersioni su quell'erogatore.
await page.click('button:has-text("Attrezzatura")');
await page.waitForTimeout(700);
const usoAttrezzo = await page
  .locator('tbody tr', { hasText: 'Apeks XTX50' })
  .first()
  .innerText()
  .catch(() => 'RIGA ASSENTE');
await page.click('button:has-text("Logbook")');
await page.waitForTimeout(600);

await condizioniInBlocco([3, 4, 5, 6], 'sunny', 'calm', 6);
await condizioniInBlocco([7, 8, 9, 10], 'rainy', 'rough', 3);

/*
 * MUTA E ZAVORRA, su due gruppi diversi.
 *
 * Stessa ragione delle condizioni: l'archivio dimostrativo non ha né muta né
 * chili — nessun formato di esportazione li porta — quindi tutte le tabelle che
 * incrociano l'attrezzatura resterebbero invisibili per sempre. Due gruppi
 * perché con uno solo non c'è confronto e le tabelle si rifiutano di comparire,
 * ed è proprio la regola da verificare.
 */
async function mutaInBlocco(righe, nomeMuta, kg) {
  for (const n of righe) await page.locator('tbody tr').nth(n).locator('input[type=checkbox]').check();
  await page.waitForTimeout(300);
  await page.locator('label', { hasText: 'Muta' }).first().locator('input').fill(nomeMuta);
  await page.locator('label', { hasText: 'Zavorra' }).first().locator('input').fill(String(kg));
  await page.locator(`button:has-text("Applica a ${righe.length}")`).first().click();
  await page.waitForTimeout(1800);
}
await mutaInBlocco([3, 4, 5, 6], 'Muta Umida 5mm', 6);
await mutaInBlocco([7, 8, 9, 10], 'Stagna Trilaminato', 10);
await page.screenshot({ path: 'screenshots/3f-condizioni-in-blocco.png', fullPage: true });
const bloccoOk =
  dopoIlBlocco.includes('Squadra di prova') &&
  // Il sito NON doveva essere toccato: era vuoto nel modulo.
  primaDelBlocco.split('\n')[2] === dopoIlBlocco.split('\n')[2];

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

/*
 * La scheda di modifica, aperta.
 *
 * È la pagina in cui si scrive tutto quello che il computer non misura, ed è
 * anche l'unica che sa tradurre «S80» in litri. Quella traduzione va provata
 * qui e non solo nei test: nei test si prova la funzione, qui si prova che il
 * campo si compili davvero quando esci dal riquadro — che è la parte che si
 * rompe cambiando un `onBlur` in un `onChange`.
 */
await page.locator('button:has-text("Modifica dati")').first().click();
await page.waitForTimeout(400);
await page.locator('input[placeholder="notturna al relitto"]').fill('Prova della scheda');
const sigla = page.locator('input[placeholder="S80, D12, 15 L…"]').first();
let siglaVerdetto = 'NESSUN CAMPO SIGLA';
if (await sigla.count()) {
  await sigla.fill('S80');
  await sigla.blur();
  await page.waitForTimeout(200);
  const litri = await page
    .locator('.card')
    .filter({ has: page.locator('h2', { hasText: 'Modifica dati' }) })
    // Il campo si cerca per ETICHETTA, non per `type`: i campi con i decimali
    // sono di testo apposta — `type="number"` accetta solo il separatore della
    // lingua della webview, e «6,5» diventava 65. Vedi `ui/numero.ts`.
    .locator('label', { hasText: "Litri d'acqua" })
    .locator('input')
    .first()
    .inputValue();
  siglaVerdetto = `S80 → ${litri} L`;
}
// L'erogatore: si scrive un nome nuovo e deve comparire il pulsante che lo
// mette in inventario senza cambiare pagina.
/*
 * Un nome che NON è già in inventario.
 *
 * La modifica in blocco, più su, ci mette dentro «Apeks XTX50»: riusandolo qui
 * il pulsante «metti in attrezzatura» non comparirebbe — ed è giusto che non
 * compaia, perché il nome combacia. Il controllo che serve è l'altro: un nome
 * nuovo deve poter entrare in inventario senza cambiare pagina.
 */
await page.locator('input[list^="attrezzi-regulator"]').first().fill('Scubapro MK25 EVO');
await page.waitForTimeout(200);
const bottoneInventario = await page
  .locator('button:has-text("in attrezzatura")')
  .first()
  .isVisible()
  .catch(() => false);
await page.screenshot({ path: 'screenshots/4c-modifica.png', fullPage: true });
await shots(page, 'screenshots/4c-modifica');
console.log('SIGLA BOMBOLA:', siglaVerdetto);
console.log('NUOVO ATTREZZO DALLA SCHEDA:', bottoneInventario ? 'pulsante presente' : 'PULSANTE ASSENTE');
await page.locator('button:has-text("Chiudi modifica")').first().click();
await page.waitForTimeout(300);

// Hover sul profilo per verificare il tooltip.
const svg = page.locator('.chart svg').first();
const box = await svg.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.waitForTimeout(400);
}
await page.screenshot({
  path: 'screenshots/5-tooltip.png',
  clip: box ? { x: box.x - 40, y: box.y - 60, width: box.width + 80, height: box.height + 120 } : undefined,
});

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
const gasFixed = await page
  .locator('.card', { hasText: "Gas d'emergenza: non calcolato" })
  .first()
  .innerText();
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
const contingenze = await page
  .locator('.card', { hasText: 'E se…' })
  .first()
  .innerText()
  .catch(() => 'CARTA MANCANTE');
const start = await page
  .locator('.card', { hasText: 'Prima di scendere' })
  .first()
  .innerText()
  .catch(() => 'CARTA MANCANTE');
// Le caselle si prendono per nome, non per posizione: aggiungerne una nuova
// altrove nella pagina non deve far puntare i test a quella sbagliata.
await page.check('[data-check="deco-mix"]');
await page.waitForTimeout(500);
const decoBox = await page
  .locator('.tile', { hasText: 'Ti serve' })
  .first()
  .innerText()
  .catch(() => 'NESSUN RIQUADRO DECO');
await shots(page, 'screenshots/14-gas-deco', 5);
await page.uncheck('[data-check="deco-mix"]');

// Modalità tecnica: la tabella di decompressione deve comparire con soste vere.
await page.click('button:has-text("Tecnica")');
await page.waitForTimeout(700);
const curvaCard = await page
  .locator('.card', { hasText: 'I livelli' })
  .first()
  .innerText()
  .catch(() => 'CARTA LIVELLI MANCANTE');
// Un profilo che la deco la prende di sicuro: 45 m per 30 minuti.
// `inputMode=decimal` e non `type=number`: i campi numerici sono di testo
// apposta, perché la limitazione a ogni tasto trasformava «18» in «38» e la
// virgola decimale non passava. Vedi `components/InputNumerico.tsx`.
const livelli = page.locator('.card', { hasText: 'I livelli' }).first().locator('input[inputmode=decimal]');
await livelli.nth(0).fill('45');
await livelli.nth(1).fill('30');
await page.waitForTimeout(600);
const tabella = await page
  .locator('.card', { hasText: 'Da portare in acqua' })
  .first()
  .innerText()
  .catch(() => 'NESSUNA TABELLA DI SOSTE');
const decoContingenze = await page
  .locator('.card', { hasText: 'Se qualcosa cambia' })
  .first()
  .innerText()
  .catch(() => 'NESSUNA CONTINGENZA');
await shots(page, 'screenshots/14b-deco-tecnica', 6);
await page.click('button:has-text("Ricreativa")');
await page.waitForTimeout(600);
const curva = await page
  .locator('.card')
  .filter({ has: page.locator('h2', { hasText: 'Curva di sicurezza' }) })
  .first()
  .innerText()
  .catch(() => 'NESSUNA CARTA CURVA');

/*
 * Le soste in modalità RICREATIVA.
 *
 * Il piano dimostrativo esce dalla curva — lo dice la carta qui sopra — quindi
 * la tabella delle soste deve comparire. È la verifica che serve: fino a ieri
 * questa pagina si limitava a dire «non calcola la decompressione», e la
 * differenza fra prima e adesso è esattamente questa carta.
 */
const sosteRec = await page
  .locator('.card')
  .filter({ has: page.locator('h2', { hasText: 'Le soste che questo piano impone' }) })
  .first()
  .innerText()
  .catch(() => 'NESSUNA CARTA SOSTE');
await page.screenshot({ path: 'screenshots/13d-gas-soste.png', fullPage: true });
const stampaPiano = await page
  .locator('button:has-text("Stampa il piano")')
  .first()
  .isVisible()
  .catch(() => false);

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
  if (path)
    uddfBytes = (await import('node:fs/promises')).then
      ? (await (await import('node:fs/promises')).stat(path)).size
      : 0;
}
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshots/15-export.png', fullPage: true });

// Le pagine nuove: confronto e attrezzatura.
await page.click('button:has-text("Confronta")');
await page.waitForTimeout(900);
await page.screenshot({ path: 'screenshots/16-confronta.png', fullPage: true });
const confronto = await page
  .locator('.card', { hasText: 'Le differenze' })
  .first()
  .innerText()
  .catch(() => 'CARTA MANCANTE');

/*
 * Attrezzatura: rifatta in tre sezioni ad agosto 2026, quindi il percorso qui
 * sotto è nuovo. Si aggiunge un erogatore con la sua revisione e un brevetto, e
 * si controlla che la sezione della zavorra — che NON si compila, si ricava dalle
 * immersioni — dica qualcosa di sensato sull'archivio dimostrativo.
 */
await page.click('button:has-text("Attrezzatura")');
await page.waitForTimeout(600);
// Il primo «Aggiungi» è quello dell'attrezzatura, il secondo quello dei brevetti.
await page.locator('button:has-text("Aggiungi")').first().click();
await page.waitForTimeout(300);
await page.locator('label', { hasText: 'Marca e modello' }).first().locator('input').fill('Scubapro MK25');
await page.locator('label', { hasText: 'Ultima fatta' }).first().locator('input').fill('2025-03-10');
await page.locator('button:has-text("Salva")').first().click();
await page.waitForTimeout(600);

await page.locator('button:has-text("Aggiungi")').nth(1).click();
await page.waitForTimeout(300);
await page.locator('label', { hasText: 'Didattica' }).first().locator('input').fill('PADI');
await page
  .locator('label', { hasText: 'Nome sulla tessera' })
  .first()
  .locator('input')
  .fill('Advanced Open Water');
await page.locator('button:has-text("Salva")').first().click();
await page.waitForTimeout(600);

/*
 * DUE PEZZI DI FILA: si apre il primo, si annulla, si apre il secondo.
 *
 * Senza `key` sulla scheda, React non rimontava il componente e lo `useState`
 * iniziale restava quello del primo pezzo: nel modulo comparivano i campi
 * dell'erogatore mentre il titolo diceva il nome della bombola, e «Salva»
 * scriveva sull'identificativo sbagliato. Qui si aggiunge un secondo pezzo e si
 * verifica che aprendo il primo dopo il secondo il modulo mostri il primo.
 */
await page.locator('button:has-text("Aggiungi")').first().click();
await page.waitForTimeout(300);
await page.locator('label', { hasText: 'Marca e modello' }).first().locator('input').fill('Faber D12');
await page.locator('button:has-text("Salva")').first().click();
await page.waitForTimeout(600);

await page.locator('tbody tr', { hasText: 'Faber D12' }).first().click();
await page.waitForTimeout(300);
await page.locator('button:has-text("Annulla")').first().click();
await page.waitForTimeout(300);
await page.locator('tbody tr', { hasText: 'Scubapro MK25' }).first().click();
await page.waitForTimeout(400);
const schedaDopoDueAperture = await page
  .locator('label', { hasText: 'Marca e modello' })
  .first()
  .locator('input')
  .inputValue()
  .catch(() => 'CAMPO MANCANTE');
// E l'eliminazione chiede conferma invece di cancellare al primo clic.
await page.locator('button:has-text("Elimina")').first().click();
await page.waitForTimeout(300);
const chiedeConferma = await page.locator('button:has-text("Sì, elimina")').count();
await page.locator('button:has-text("No")').first().click();
await page.waitForTimeout(200);
await page.locator('button:has-text("Annulla")').first().click();
await page.waitForTimeout(400);

const attrezzatura = await page
  .locator('.card', { hasText: 'Quello che porti in acqua' })
  .first()
  .innerText()
  .catch(() => 'CARTA ATTREZZATURA MANCANTE');
const brevetti = await page
  .locator('.card', { hasText: 'Brevetti' })
  .first()
  .innerText()
  .catch(() => 'CARTA BREVETTI MANCANTE');
const zavorra = await page
  .locator('.card', { hasText: 'Zavorra e configurazione' })
  .first()
  .innerText()
  .catch(() => 'CARTA ZAVORRA MANCANTE');
await page.screenshot({ path: 'screenshots/17-attrezzatura.png', fullPage: true });

// La mappa dei siti, dentro le statistiche.
await page.click('button:has-text("Statistiche")');
await page.waitForTimeout(700);
const mappa = await page
  .locator('.card', { hasText: 'Dove ti immergi' })
  .first()
  .innerText()
  .catch(() => 'CARTA MANCANTE');
const condizioniCard = await page
  .locator('.card')
  .filter({ has: page.locator('h2', { hasText: 'Quanto contano le condizioni' }) })
  .first()
  .innerText()
  .catch(() => 'CARTA CONDIZIONI MANCANTE');
await shots(page, 'screenshots/18-statistiche', 8);

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

/*
 * IL CESTINO FUNZIONA DAVVERO?
 *
 * Era morto e nessuno se n'era accorto: la conferma passava da
 * `window.confirm`, che nella WKWebView di macOS non mostra niente e
 * restituisce `false`. Il pulsante non faceva NIENTE — nessun errore, nessuna
 * finestra — e l'unica conclusione possibile era che l'app fosse rotta.
 *
 * Playwright, come la WKWebView, respinge le finestre di dialogo: quindi
 * questo controllo avrebbe trovato il difetto il giorno in cui è nato. Adesso
 * la conferma è dentro la pagina e il percorso si può percorrere tutto.
 */
// La finestra torna larga: i passi precedenti la stringono a 390 px per
// provare il telefono, e una scheda di modifica in blocco a quella larghezza
// impila i pulsanti in un modo che rende il percorso diverso da quello vero.
await page.setViewportSize({ width: 1180, height: 900 });
await page.click('button:has-text("Logbook")');
await page.waitForTimeout(600);
const primaDelCestino = await page.locator('tbody tr').count();
// DUE righe, non una: «Rimetti a posto tutte» compare solo quando il cestino ne
// contiene più di una — con una sola c'è già il pulsante della riga — e il
// difetto che questo passo cerca (la chiave del cestino riscritta partendo
// sempre dallo stesso elenco) si vede appunto solo da due in su.
await page.locator('tbody tr').nth(0).locator('input[type=checkbox]').check();
await page.locator('tbody tr').nth(1).locator('input[type=checkbox]').check();
await page.waitForTimeout(300);
await page.locator('button:has-text("Sposta nel cestino")').first().click();
await page.waitForTimeout(300);
// Il primo clic ARMA soltanto: l'archivio non deve essere ancora cambiato.
const dopoIlPrimoClic = await page.locator('tbody tr').count();
await page.locator('button:has-text("Sì, sposta")').first().click();
await page.waitForTimeout(900);
const dopoIlCestino = await page.locator('tbody tr').count();
await page.screenshot({ path: 'screenshots/19-cestino.png', fullPage: true });

/*
 * SI DIGITA UNA CIFRA ALLA VOLTA, non con `fill()`.
 *
 * È il controllo che mancava, ed è il motivo per cui il difetto è vissuto
 * tanto: `fill()` scrive il valore in un colpo solo, mentre una persona batte
 * una cifra dopo l'altra. Il campo limitava il valore a OGNI battuta e
 * rimandava il risultato al genitore, che tornava indietro e riscriveva il
 * testo sotto le dita: con un minimo di 3, «18» diventava «38» — un piano a
 * trentotto metri per chi ne aveva chiesti diciotto — e nel campo
 * dell'ossigeno «21» diventava «81», cioè un EAN81 con la sua MOD e le sue
 * soste, tutte plausibili e tutte sbagliate.
 */
await page.click('button:has-text("Gas")');
await page.waitForTimeout(700);
async function digita(campo, testo) {
  await campo.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(testo, { delay: 30 });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  return campo.inputValue();
}
const campoProfondita = page.locator('label', { hasText: 'Profondità massima' }).locator('input').first();
const campoO2 = page.locator('input[aria-label="Ossigeno, percento"]').first();
const digitati = [];
if (await campoProfondita.count()) digitati.push(`profondità 18 → ${await digita(campoProfondita, '18')}`);
if (await campoO2.count()) digitati.push(`ossigeno 21 → ${await digita(campoO2, '21')}`);
// La virgola decimale: su una webview in inglese un campo numerico la mangia.
if (await campoProfondita.count())
  digitati.push(`profondità 18,5 → ${await digita(campoProfondita, '18,5')}`);
const digitazione = digitati.join(' · ');

/*
 * LA SEZIONE ATTREZZATURA NELLE STATISTICHE.
 *
 * Tre tabelle che nascono da dati facoltativi — muta, zavorra, erogatori — e
 * quindi possono legittimamente non esserci. Quello che NON deve succedere è
 * che spariscano in silenzio su un archivio che i dati ce li ha: qui si
 * verifica che compaiano, e che la zavorra mostrata sia il TOTALE.
 */
await page.click('button:has-text("Statistiche")');
await page.waitForTimeout(900);
const cartaAttrezzatura = await page
  .locator('.card', { hasText: 'Quello che porti addosso incrociato' })
  .first();
const attrezzaturaStat = (await cartaAttrezzatura.count())
  ? (await cartaAttrezzatura.innerText()).replace(/\s+/g, ' ').slice(0, 1400)
  : 'SEZIONE ASSENTE';

/*
 * «RIMETTI A POSTO TUTTE»: il percorso che ripara un errore fatto in blocco.
 *
 * Nasce da un caso vero — cinquantadue immersioni cancellate insieme perché
 * sembravano doppioni, e poi non lo erano. Il rischio che va inchiodato qui non
 * è il pulsante, è la scrittura: ripristinare in un ciclo la versione singola
 * riscriverebbe la chiave del cestino cinquantadue volte partendo sempre dallo
 * stesso elenco, l'ultima vincerebbe, e in archivio tornerebbero tutte mentre
 * nel cestino ne resterebbero cinquantuno. Quindi si contano ENTRAMBI i lati.
 */
await page.click('button:has-text("Impostazioni")');
await page.waitForTimeout(700);
const cestinoPrima = await page.locator('.card', { hasText: 'Cestino' }).first().locator('tbody tr').count();
let ripristinoEsito = 'pulsante assente';
const rimettiTutte = page.locator('button:has-text("Rimetti a posto tutte")').first();
if (await rimettiTutte.count()) {
  await rimettiTutte.click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Sì, rimetti")').first().click();
  await page.waitForTimeout(900);
  const cestinoDopo = await page.locator('.card', { hasText: 'Cestino' }).first().locator('tbody tr').count();
  await page.click('button:has-text("Logbook")');
  await page.waitForTimeout(700);
  const archivioDopo = await page.locator('tbody tr').count();
  ripristinoEsito =
    cestinoDopo === 0 && archivioDopo === primaDelCestino
      ? `cestino ${cestinoPrima} → 0, archivio ${dopoIlCestino} → ${archivioDopo} (corretto)`
      : `SBAGLIATO: cestino ${cestinoPrima} → ${cestinoDopo}, archivio ${dopoIlCestino} → ${archivioDopo}, atteso ${primaDelCestino}`;
}

/*
 * Scarico Bluetooth: il percorso che nel browser NON può funzionare.
 *
 * È il caso più importante da inchiodare, perché è quello che l'harness può
 * vedere davvero: qui non c'è Tauri, quindi premere «Cerca il computer» deve
 * produrre una spiegazione — non un pulsante che gira, non un errore in
 * console, non un elenco vuoto che sembra «non trovo il tuo computer». E la
 * scheda deve dichiarare che nessun protocollo è ancora supportato, invece di
 * far cercare a vuoto.
 */
await page.setViewportSize({ width: 1180, height: 900 });
await page.click('button:has-text("Importa")');
await page.waitForTimeout(600);
const bleCard = await page
  .locator('.card', { hasText: 'Scarica dal computer subacqueo' })
  .first()
  .innerText()
  .catch(() => 'CARTA BLUETOOTH MANCANTE');
await page.locator('button:has-text("Cerca il computer")').first().click();
await page.waitForTimeout(600);
const bleErrore = await page
  .locator('.notice-error')
  .first()
  .innerText()
  .catch(() => 'NESSUNA SPIEGAZIONE');
await page.screenshot({ path: 'screenshots/18-bluetooth.png', fullPage: true });

/*
 * Scorrimento fantasma: la pagina che scorre nel vuoto.
 *
 * Il guscio è alto quanto la finestra e a scorrere deve essere SOLO `.main`.
 * Quando un elemento in `position: absolute` non trova un antenato posizionato
 * si aggancia al documento, e se sta in fondo a un contenuto lungo allunga lo
 * scroll dell'elemento `html` fino a lì: dopo l'ultima scheda si continua a
 * scorrere dentro il nero. È successo con le tabelle nascoste per gli screen
 * reader, alte un pixel e invisibili, e nessuna fotografia lo mostra — si vede
 * solo confrontando `scrollHeight` con `clientHeight`.
 */
const fantasma = [];
for (const tab of [
  'Logbook',
  'Statistiche',
  'Coach',
  'Gas',
  'Confronta',
  'Attrezzatura',
  'Importa',
  'Sincronizza',
]) {
  await page.click(`button:has-text("${tab}")`).catch(() => {});
  await page.waitForTimeout(400);
  const d = await page.evaluate(() => ({
    doc: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    body: document.body.scrollHeight - document.body.clientHeight,
  }));
  if (d.doc > 1 || d.body > 1) fantasma.push(`${tab}: documento +${d.doc}px, body +${d.body}px`);
}
// E la scheda di un'immersione, che è la pagina più lunga di tutte.
await page.click('button:has-text("Logbook")');
await page.waitForTimeout(400);
await page.locator('tbody tr').first().click();
await page.waitForTimeout(1200);
{
  const d = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
  if (d > 1) fantasma.push(`scheda immersione: documento +${d}px`);
}

// Trabocco orizzontale a larghezza telefono.
// Una pagina che scorre in orizzontale su un telefono è un difetto che nessuna
// schermata rende evidente — la fotografia si allarga insieme al contenuto — e
// che invece si misura in una riga: se `scrollWidth` supera la larghezza della
// finestra, qualcosa dentro non ha accettato di stringersi.
const overflow = [];
for (const tab of [
  'Logbook',
  'Statistiche',
  'Coach',
  'Gas',
  'Confronta',
  'Attrezzatura',
  'Importa',
  'Sincronizza',
]) {
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
console.log('VIRGOLA DECIMALE:', rigaManuale.replace(/\n/g, ' | ').slice(0, 200));
console.log(
  'ESITO SALVATAGGIO:',
  esitoSalvataggio > 0 ? 'conferma mostrata' : 'CONFERMA MANCANTE',
  '· riquadri rossi:',
  rossoDopoSalvataggio,
);
console.log('SCHEDA DOPO DUE APERTURE:', schedaDopoDueAperture, '(atteso: Scubapro MK25)');
console.log('ELIMINA CHIEDE CONFERMA:', chiedeConferma > 0 ? 'sì' : 'NO — cancella al primo clic');
console.log('ATTREZZATURA:\n' + attrezzatura.slice(0, 420));
console.log('BREVETTI:\n' + brevetti.slice(0, 300));
console.log('ZAVORRA:\n' + zavorra.slice(0, 500));
console.log('MAPPA:\n' + mappa.slice(0, 220));
console.log('CURVA MINUTO PER MINUTO:');
console.log(decoTl.slice(0, 700));
console.log('LIVELLI:');
console.log(curvaCard.slice(0, 300));
console.log('TABELLA SOSTE:');
console.log(tabella.slice(0, 600));
console.log('CONTINGENZE DECO:');
console.log(decoContingenze.slice(0, 700));
console.log('CURVA RICREATIVA:');
console.log(curva.slice(0, 600));
console.log('ATTREZZATURA IN BLOCCO:', usoAttrezzo.replace(/\n/g, ' | '));
console.log('CONDIZIONI NELLE STATISTICHE:');
console.log(condizioniCard.slice(0, 700));
console.log('SOSTE IN RICREATIVA:');
console.log(sosteRec.slice(0, 500));
console.log('DIGITAZIONE A CIFRE:', digitazione);
console.log('STAMPA DEL PIANO:', stampaPiano ? 'pulsante presente' : 'PULSANTE ASSENTE');
console.log(
  'MODIFICA IN BLOCCO:',
  bloccoOk
    ? 'compagno scritto, sito non toccato'
    : `SBAGLIATA\nprima: ${primaDelBlocco}\ndopo: ${dopoIlBlocco}`,
);
console.log(
  'CESTINO:',
  `${primaDelCestino} righe → ${dopoIlPrimoClic} dopo il primo clic → ${dopoIlCestino} dopo la conferma`,
  dopoIlPrimoClic === primaDelCestino && dopoIlCestino === primaDelCestino - 2
    ? '(corretto)'
    : 'SBAGLIATO: la conferma non arma o non cancella',
);
console.log('RIMETTI A POSTO TUTTE:', ripristinoEsito);
console.log('ATTREZZATURA IN STATISTICHE:', attrezzaturaStat);
console.log('BLUETOOTH CARTA:\n' + bleCard.slice(0, 400));
console.log('BLUETOOTH NEL BROWSER:', bleErrore.replace(/\n/g, ' ').slice(0, 220));
console.log('SCORRIMENTO FANTASMA:', fantasma.length ? fantasma : 'nessuno');
console.log('TRABOCCO A 390 px:', overflow.length ? overflow : 'nessuno');
console.log('CONSOLE ERRORS:', errors.length ? errors.slice(0, 10) : 'nessuno');
