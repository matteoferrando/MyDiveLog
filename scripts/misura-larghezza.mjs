/**
 * CHI SFORA IN LARGHEZZA, E DI QUANTO — su ogni dispositivo, misurato.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Nasce il 15 settembre 2026 da «su iPhone 16 il logbook scrolla orizzontale».
 * Uno scorrimento laterale non voluto è il difetto di impaginazione più
 * fastidioso che ci sia: sposta il contenuto sotto il dito mentre si scorre in
 * verticale, e non si capisce da dove venga guardando la pagina — perché a
 * sforare è quasi sempre UN elemento solo, spesso largo pochi pixel più del
 * dovuto.
 *
 * Per ogni larghezza e per ogni scheda, lo script dice se il contenitore scorre
 * lateralmente e **quali elementi** hanno il bordo destro oltre il suo. Non «la
 * pagina è larga»: il nome della classe e i pixel di troppo.
 *
 * Le larghezze sono quelle vere, in punti CSS, dei dispositivi su cui questa
 * applicazione gira davvero — non una scala arbitraria da 320 a 1920.
 *
 *   npm run build && node scripts/misura-larghezza.mjs
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
await new Promise((r) => server.listen(4179, r));

/** Larghezza in punti CSS, altezza, nome. Le misure sono quelle dei dispositivi veri. */
const DISPOSITIVI = process.env.SOLO
  ? [['solo', +process.env.SOLO, 850]]
  : [
      ['iPhone SE', 320, 568],
      ['iPhone 13 mini', 375, 812],
      ['iPhone 16', 393, 852],
      ['iPhone 16 Pro', 402, 874],
      ['iPhone 16 Pro Max', 440, 956],
      ['iPad mini verticale', 744, 1133],
      ['iPad Pro 11 verticale', 834, 1194],
      ['iPad Pro 11 orizzontale', 1194, 834],
      ['portatile', 1280, 800],
      ['schermo grande', 1680, 1050],
    ];

const SCHEDE = [
  'Logbook',
  'Confronta',
  'Statistiche',
  'Suggerimenti',
  'Gas',
  'Attrezzatura',
  'Importa',
  'Impostazioni',
];

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);

/**
 * Chi sfora, dentro il contenitore che scorre.
 *
 * ► SI GUARDA IL BORDO DESTRO, non `scrollWidth` dei figli. ◄ Un elemento può
 * avere `scrollWidth` enorme ed essere perfettamente a posto: è il caso delle
 * tabelle dentro `.table-scroll`, che scorrono APPOSTA. Quello che non va bene
 * è un elemento il cui bordo destro cade oltre il bordo destro del contenitore,
 * perché quello spinge la pagina.
 */
const CERCA_SFORI = () => {
  const main = document.querySelector('.main');
  if (!main) return null;
  const limite = main.getBoundingClientRect().right;
  /*
   * ► CHI STA DENTRO A QUALCOSA CHE TAGLIA NON SPINGE NIENTE. ◄
   *
   * Due casi, e confonderli riempie il rapporto di falsi allarmi:
   *
   *  · `overflow-x: auto|scroll` — il contenitore scorre APPOSTA, ed è la
   *    ragione per cui `.table-scroll` esiste. Una tabella larga lì dentro è il
   *    comportamento voluto, non un difetto.
   *  · `overflow: hidden` e `clip-path` — il contenuto è ritagliato e non
   *    raggiunge lo schermo. È il caso delle tabelle equivalenti per i lettori
   *    di schermo (`.solo-lettori`), alte e larghe un pixel con dentro una
   *    tabella intera: la prima versione di questo script le denunciava su ogni
   *    dispositivo, e non sforavano niente.
   *
   * Si guarda anche l'elemento STESSO e non solo gli antenati: una cella con
   * `overflow: hidden` e dentro una parola lunga non spinge nessuno.
   */
  const dentroUnoScorrevole = (el) => {
    for (let n = el; n && n !== main; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') return true;
      if (s.overflow === 'hidden' || s.overflowX === 'hidden') return true;
      if (s.clipPath !== 'none') return true;
    }
    return false;
  };
  const colpevoli = [];
  for (const el of main.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const oltre = Math.round(r.right - limite);
    if (oltre <= 1) continue;
    // Chi sta dentro un contenitore che scorre di proposito non è un colpevole:
    // è esattamente il motivo per cui quel contenitore esiste.
    if (dentroUnoScorrevole(el)) continue;
    colpevoli.push({
      tag: el.tagName.toLowerCase(),
      classe: (el.className || '').toString().split(' ').slice(0, 3).join(' '),
      testo: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 34),
      oltre,
      largo: Math.round(r.width),
    });
  }
  // Solo i più esterni: se una carta sfora, sforano anche tutti i suoi figli, e
  // stamparli tutti nasconde il colpevole in mezzo a venti complici.
  const esterni = colpevoli.filter(
    (c, i) => !colpevoli.some((altro, j) => j !== i && altro.oltre >= c.oltre && altro.largo > c.largo),
  );
  return {
    scorreLateralmente: main.scrollWidth - main.clientWidth,
    colpevoli: (esterni.length ? esterni : colpevoli).sort((a, b) => b.oltre - a.oltre).slice(0, 4),
  };
};

let problemi = 0;
for (const [nome, w, h] of DISPOSITIVI) {
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    locale: 'it-IT',
    isMobile: w < 700,
    hasTouch: w < 700,
  });
  await page.goto('http://localhost:4179/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const vai = async (tab) => {
    const ham = page.locator('.hamburger');
    if (await ham.isVisible().catch(() => false)) {
      await ham.click();
      await page.waitForTimeout(150);
      await page.locator(`.menu-telefono button:has-text("${tab}")`).first().click();
    } else {
      await page.locator(`.nav button:has-text("${tab}")`).first().click();
    }
    await page.waitForTimeout(450);
  };
  await vai('Importa');
  await page.setInputFiles('input[type=file]', [
    'demo/shearwater-cloud-export.uddf',
    'demo/subsurface-archivio.ssrf',
    'demo/vecchio-logbook.csv',
    // Il file che ha fatto nascere questo script: nomi di sito senza spazi.
    // Senza di lui il logbook risultava a posto su ogni dispositivo, ed era
    // quello che l'archivio dimostrativo non conteneva.
    'demo/nomi-lunghi.csv',
  ]);
  await page.waitForTimeout(3000);

  const righe = [];
  for (const tab of SCHEDE) {
    await vai(tab);
    const esito = await page.evaluate(CERCA_SFORI);
    if (!esito) continue;
    if (esito.scorreLateralmente > 1 || esito.colpevoli.length) {
      problemi++;
      righe.push(`  ► ${tab}: scorre di ${esito.scorreLateralmente} px`);
      for (const c of esito.colpevoli) {
        righe.push(
          `      +${String(c.oltre).padStart(4)} px  ${c.tag}.${c.classe.padEnd(24)} (largo ${c.largo}) ${c.testo}`,
        );
      }
    }
  }
  /*
   * E LA SCHEDA DI UNA SINGOLA IMMERSIONE, che non è una scheda del menu e
   * quindi il ciclo qui sopra non la vedeva: è la pagina con il grafico del
   * profilo, le tabelle delle bombole e il nome del sito scritto in grande —
   * cioè tre dei quattro modi in cui questa applicazione ha già sfondato di
   * lato. Lasciarla fuori dal giro voleva dire dichiarare pulito quello che non
   * si era guardato.
   */
  await vai('Logbook');
  const primaRiga = page.locator('.tabella-logbook tbody tr').first();
  if (await primaRiga.count()) {
    await primaRiga.click();
    await page.waitForTimeout(900);
    const esito = await page.evaluate(CERCA_SFORI);
    if (esito && (esito.scorreLateralmente > 1 || esito.colpevoli.length)) {
      problemi++;
      righe.push(`  ► Scheda immersione: scorre di ${esito.scorreLateralmente} px`);
      for (const c of esito.colpevoli) {
        righe.push(
          `      +${String(c.oltre).padStart(4)} px  ${c.tag}.${c.classe.padEnd(24)} (largo ${c.largo}) ${c.testo}`,
        );
      }
    }
  }

  console.log(`${nome} — ${w}×${h}${righe.length ? '' : '   tutto dentro'}`);
  for (const r of righe) console.log(r);
  await page.close();
}
console.log(`\n${problemi === 0 ? 'nessuno sforo' : problemi + ' schede che sforano'}`);
await browser.close();
server.close();
