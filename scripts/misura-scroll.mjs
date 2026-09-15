/**
 * QUANTO SI SCORRE, SU UN TELEFONO VERO — misurato, non stimato.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Nasce il 15 settembre 2026 da un'osservazione di una riga: «su iPhone 16 Pro
 * c'è parecchio scroll». È il tipo di segnalazione che non si può chiudere
 * discutendo — o si misura, o si tira a indovinare quale schermata intendesse.
 *
 * Apre la build di produzione alla larghezza vera dell'iPhone 16 Pro (402 px
 * logici) e per ogni scheda stampa **quante schermate servono per arrivare in
 * fondo**, insieme ai cinque blocchi che occupano più altezza. Il contenitore
 * che scorre è `.main`, non il documento: `document.body.scrollHeight`
 * risponderebbe sempre la stessa cosa.
 *
 * L'altezza utile è 790 e non 874: su Safari la barra degli indirizzi e
 * l'indicatore in basso mangiano quasi un centimetro, e misurare sull'altezza
 * nominale vorrebbe dire dichiarare meno scroll di quanto ce n'è.
 *
 *   npm run build && npm run demo
 *   node scripts/misura-scroll.mjs
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
  '.png': 'image/png',
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

const LARGHEZZA = +(process.env.VW || 402);
const ALTEZZA = +(process.env.VH || 790);

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const page = await browser.newPage({
  viewport: { width: LARGHEZZA, height: ALTEZZA },
  deviceScaleFactor: 1,
  locale: 'it-IT',
  isMobile: true,
  hasTouch: true,
});
const errori = [];
page.on('console', (m) => m.type() === 'error' && errori.push(m.text()));
page.on('pageerror', (e) => errori.push('pageerror: ' + e.message));

await page.goto('http://localhost:4174/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const files = [
  'demo/shearwater-cloud-export.uddf',
  'demo/subsurface-archivio.ssrf',
  'demo/shearwater-peregrine.xml',
  'demo/garmin-descent.fit',
  'demo/vecchio-logbook.csv',
];
// L'importazione passa dalla scheda Importa, come la farebbe una persona.
async function vaiA(tab) {
  const hamburger = page.locator('.hamburger');
  if (await hamburger.isVisible().catch(() => false)) {
    await hamburger.click();
    await page.waitForTimeout(200);
    await page.locator(`.menu-telefono button:has-text("${tab}")`).first().click();
  } else {
    await page.locator(`.nav button:has-text("${tab}")`).first().click();
  }
  await page.waitForTimeout(600);
}

await vaiA('Importa');
await page.setInputFiles('input[type=file]', files);
await page.waitForTimeout(3500);

/** Quanto scorre questa schermata, e chi si prende l'altezza. */
async function misura(nome) {
  const dati = await page.evaluate(
    ({ vista }) => {
      const main = document.querySelector('.main');
      if (!main) return null;
      main.scrollTop = 0;
      const blocchi = [...main.querySelectorAll(':scope > *, :scope > * > *')]
        .filter((el) => el.getBoundingClientRect().height > 40)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          classe: (el.className || '').toString().split(' ').slice(0, 2).join(' '),
          testo: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 44),
          h: Math.round(el.getBoundingClientRect().height),
        }))
        .sort((a, b) => b.h - a.h)
        .slice(0, 5);
      return { altezza: main.scrollHeight, vista, blocchi };
    },
    { vista: ALTEZZA },
  );
  if (!dati) return;
  const schermate = dati.altezza / dati.vista;
  console.log(
    `${nome.padEnd(16)} ${String(dati.altezza).padStart(6)} px  =  ${schermate.toFixed(1).padStart(5)} schermate`,
  );
  for (const b of dati.blocchi) {
    console.log(`                 ${String(b.h).padStart(5)} px  ${b.classe.padEnd(22)} ${b.testo}`);
  }
}

console.log(`\nViewport ${LARGHEZZA}×${ALTEZZA} (iPhone 16 Pro, Safari con barre)\n`);
for (const tab of [
  'Logbook',
  'Confronta',
  'Statistiche',
  'Suggerimenti',
  'Gas',
  'Attrezzatura',
  'Importa',
  'Impostazioni',
]) {
  try {
    await vaiA(tab);
  } catch {
    // La navigazione che non riesce deve ROMPERE, non misurare la pagina di
    // prima e dichiararla: è lo stesso modo di fallire che  si è
    // già portato dietro due volte.
    console.log(`${tab.padEnd(16)} NON RAGGIUNTA — il nome della scheda non combacia`);
    continue;
  }
  await misura(tab);
}

// E la scheda di una singola immersione, che è la pagina più lunga di tutte.
await vaiA('Logbook');
await page
  .locator('.riga-immersione, tbody tr, .card-immersione')
  .first()
  .click()
  .catch(() => {});
await page.waitForTimeout(1200);
await misura('Scheda imm.');

if (errori.length) console.log('\nerrori in console:', errori.slice(0, 5));
await browser.close();
server.close();
