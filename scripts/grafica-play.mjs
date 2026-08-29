/**
 * La grafica fissa della scheda Google Play: il banner di testa (1024 x 500
 * esatti) e l'icona del negozio (512 x 512).
 *
 *   node scripts/grafica-play.mjs
 *
 * Escono in `_transfer/play/`.
 *
 * ► L'ICONA PARTE DA QUELLA DI APPLE, E NON DA `icons/icon-512.png`. ◄ Quella
 * ha il canale alfa e gli angoli trasparenti: Play ci mette sopra la SUA
 * maschera arrotondata, e il risultato è un'icona arrotondata due volte, più
 * piccola del suo riquadro. `icons/ios/AppIcon-512@2x.png` invece è già quadrata
 * e opaca — è la stessa che Apple pretende, per la stessa ragione — quindi
 * l'icona è **la stessa su tutti e tre i negozi**, che è come dev'essere: chi la
 * riconosce su un telefono deve riconoscerla sull'altro.
 *
 * Il ridimensionamento lo fa il browser che è già qui per il banner, invece di
 * tirare dentro una libreria di immagini per una moltiplicazione. Stessa scelta
 * di gzip e del lettore SQLite scritti a mano.
 *
 * ► IL MARCHIO SI LEGGE DA `sito/logo.svg`, NON SI RICOPIA. ◄ La prima versione
 * di questo banner aveva l'SVG del marchio incollato dentro l'HTML, e nel
 * ricopiarlo si era perso `fill="none"` dalla radice: senza quello la traccia
 * del profilo — che ha lo stroke ma nessun `fill` — si riempie di NERO, e il
 * marchio usciva con dentro una macchia scura invece della colonna d'acqua. Non
 * dava nessun errore: dava un disegno plausibile e sbagliato, che è la specie
 * di guasto che si vede solo guardando l'immagine.
 *
 * Adesso il file è uno solo. Gli identificativi interni vengono rinominati con
 * un prefisso prima di iniettarlo, perché nella pagina c'è un secondo SVG e due
 * `id` uguali nello stesso documento fanno vincere il primo — un altro modo di
 * ottenere un disegno plausibile e sbagliato.
 *
 * Le regole che vengono da Play e non dal gusto: niente testo che parli di
 * prezzo, classifiche o categorie del negozio; il banner viene ritagliato ai
 * bordi su alcune superfici, quindi quel che conta sta lontano dal bordo;
 * niente schermate qui dentro, che in miniatura diventano macchie e hanno il
 * loro riquadro nel modulo.
 */

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const USCITA = path.join(RADICE, '_transfer/play');
mkdirSync(USCITA, { recursive: true });

/** Il marchio, dal file vero, con gli `id` messi al riparo dalle collisioni. */
function marchio() {
  let svg = readFileSync(path.join(RADICE, 'sito/logo.svg'), 'utf8');
  svg = svg.replace(/<!--[\s\S]*?-->/g, '').trim();
  for (const id of ['water', 'column', 'card']) {
    svg = svg.replaceAll(`id="${id}"`, `id="marchio-${id}"`).replaceAll(`url(#${id})`, `url(#marchio-${id})`);
  }
  // La misura la decide il CSS del riquadro che lo ospita.
  svg = svg.replace(/\swidth="1024"\s+height="1024"/, '');
  if (!/\sfill="none"/.test(svg.slice(0, svg.indexOf('>')))) {
    throw new Error('sito/logo.svg non ha più fill="none" sulla radice: la traccia uscirebbe nera');
  }
  return svg;
}

const PAGINA = `<!doctype html>
<meta charset="utf-8" />
<title>MyDiveLog — feature graphic</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1024px; height: 500px; overflow: hidden; }
  body {
    background: linear-gradient(160deg, #0d3f6e 0%, #072341 48%, #04131f 100%);
    color: #eaf3fb;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    position: relative;
  }
  .alone {
    position: absolute; left: 62%; top: 50%;
    width: 900px; height: 900px; transform: translate(-50%, -50%);
    background: radial-gradient(50% 50% at 50% 50%, rgba(67, 214, 255, 0.16), transparent 70%);
  }
  .profilo { position: absolute; inset: 0; opacity: 0.55; }
  .contenuto {
    position: relative; height: 100%;
    display: flex; align-items: center; gap: 36px; padding: 0 76px;
  }
  .marchio { width: 132px; height: 132px; flex: none; box-shadow: 0 18px 46px rgba(0,0,0,0.45);
             border-radius: 30px; }
  .marchio svg { display: block; width: 100%; height: 100%; }
  h1 { font-size: 68px; line-height: 1; letter-spacing: -1.5px; font-weight: 700; }
  h1 span { color: #43d6ff; }
  p { margin-top: 18px; font-size: 27px; line-height: 1.34; color: #cfe2f4; max-width: 630px; }
  .righe { margin-top: 22px; display: flex; gap: 12px; flex-wrap: wrap; }
  .riga {
    font-size: 19px; padding: 8px 16px; border-radius: 999px;
    border: 1px solid rgba(157, 220, 255, 0.28);
    background: rgba(255, 255, 255, 0.05);
  }
</style>
<div class="alone"></div>
<svg class="profilo" viewBox="0 0 1024 500" preserveAspectRatio="none" fill="none">
  <defs>
    <linearGradient id="sfondo-colonna" x1="0" y1="120" x2="0" y2="500" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#9fcbfa" stop-opacity="0.20" />
      <stop offset="1" stop-color="#9fcbfa" stop-opacity="0.02" />
    </linearGradient>
  </defs>
  <path d="M0 150 L250 430 L560 430 L680 300 L790 300 L920 160 L1024 150 L1024 500 L0 500 Z" fill="url(#sfondo-colonna)" />
  <path d="M0 150 L250 430 L560 430 L680 300 L790 300 L920 160 L1024 150"
        stroke="#43d6ff" stroke-opacity="0.5" stroke-width="6" fill="none" stroke-linejoin="round" />
  <circle cx="680" cy="300" r="10" fill="#ffffff" fill-opacity="0.75" />
</svg>
<div class="contenuto">
  <div class="marchio">${marchio()}</div>
  <div>
    <h1>MyDive<span>Log</span></h1>
    <p>Il logbook subacqueo che unisce i dati di tutti i tuoi computer, li analizza e tiene i campi che la legge chiede.</p>
    <div class="righe">
      <div class="riga">105 modelli via Bluetooth</div>
      <div class="riga">Archivio sul tuo dispositivo</div>
      <div class="riga">Software libero</div>
    </div>
  </div>
</div>
`;

const html = path.join(USCITA, 'banner.html');
writeFileSync(html, PAGINA);

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
// La finestra È la misura, e si fotografa la finestra: `fullPage` darebbe
// un'immagine di un pixel diversa e Play rifiuta i rapporti non esatti.
const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
await page.goto('file://' + html);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(USCITA, 'feature-graphic-1024x500.png') });
await page.close();

// L'icona: 1024 opaca dentro una finestra da 512, fotografata a misura.
const sorgente = path.join(RADICE, 'src-tauri/icons/ios/AppIcon-512@2x.png');
const dati = readFileSync(sorgente).toString('base64');
const icona = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await icona.setContent(
  `<style>html,body{margin:0;width:512px;height:512px;overflow:hidden}
   img{display:block;width:512px;height:512px}</style>
   <img src="data:image/png;base64,${dati}">`,
);
await icona.waitForTimeout(300);
await icona.screenshot({ path: path.join(USCITA, 'icona-512.png') });
await browser.close();
console.log('_transfer/play/feature-graphic-1024x500.png');
console.log('_transfer/play/icona-512.png');
