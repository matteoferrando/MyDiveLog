/**
 * Le icone di Android, nella forma che Android vuole: due strati.
 *
 *   node scripts/icone-android.mjs
 *
 * Scrive in `src-tauri/icons/android/`, da `src-tauri/icons/icon.svg`:
 *
 *   - `mipmap-<densità>/ic_launcher_foreground.png` — il profilo, trasparente
 *     intorno;
 *   - `mipmap-<densità>/ic_launcher_background.png` — l'acqua, piena fino al
 *     bordo;
 *   - `mipmap-anydpi-v26/ic_launcher.xml` — l'icona adattiva che li mette uno
 *     sopra l'altro.
 *
 * Le icone «di una volta» (`ic_launcher.png`, `ic_launcher_round.png`) restano
 * quelle che scrive `tauri icon`: Android le usa solo dove l'icona adattiva non
 * c'è, cioè sotto l'API 26, che è il nostro minimo.
 *
 * ► PERCHÉ ESISTE: GOOGLE PLAY HA RIFIUTATO LA 1.8.31. ◄ Il 2 ottobre 2026,
 * norma *Misleading Claims*: «l'icona installata è diversa da quella della
 * scheda». Aveva ragione. Il workflow rigenera il progetto Android con
 * `tauri android init`, che ci mette l'icona di fabbrica di Tauri — i due
 * anelli giallo e azzurro — e nessun passo ci copiava sopra le nostre, che
 * stavano in `src-tauri/icons/android/` dall'agosto e non arrivavano mai nel
 * pacchetto. L'APK del sito aveva lo stesso difetto. Lo copia adesso
 * `scripts/icone-progetto-android.mjs`, e `scripts/icona-nel-pacchetto.py`
 * apre il pacchetto costruito e lo controlla.
 *
 * ► E PERCHÉ NON BASTAVANO LE ICONE DI `tauri icon`. ◄ Quelle mettono l'icona
 * INTERA nello strato davanti, su uno sfondo bianco. Ma un'icona adattiva è
 * 108 dp per lato e il telefono ne mostra solo i 72 dp centrali, ritagliati
 * con la forma che sceglie lui (cerchio, goccia, quadrato arrotondato): dell'
 * icona intera si sarebbe visto il terzo di mezzo, ingrandito, col profilo
 * tagliato ai due lati. Un'icona diversa da quella della scheda, di nuovo —
 * solo meno diversa.
 *
 * Qui invece il disegno della scheda si rimpicciolisce di 72/108 attorno al
 * centro: la finestra che il telefono mostra contiene esattamente
 * l'icona del negozio, e la maschera la dà il telefono. Tutto il profilo cade
 * dentro il cerchio di sicurezza (66 dp), che è l'unica parte che nessuna
 * forma taglia: misurato dalla prova `tests/iconaAndroid.test.ts`, che guarda i
 * pixel invece di fidarsi del conto.
 *
 * Il disegno non si ricopia: si legge da `icon.svg`, e se lì cambia la forma
 * dei pezzi che servono questo script si ferma invece di indovinare. *Il
 * marchio incollato a mano nel banner di Play aveva perso `fill="none"`, e il
 * profilo usciva pieno di nero senza nessun errore* — vedi `grafica-play.mjs`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const SORGENTE = path.join(RADICE, 'src-tauri/icons/icon.svg');
const ANDROID = path.join(RADICE, 'src-tauri/icons/android');

/** La finestra visibile sul lato dello strato: 72 dp su 108. */
export const FINESTRA = 72 / 108;

/** I lati in pixel dei due strati, 108 dp per densità. */
export const STRATI = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
};

function pezzo(testo, espressione, nome) {
  const m = espressione.exec(testo);
  if (!m) throw new Error(`icon.svg: non trovo ${nome}. Il disegno è cambiato: guarda questo script.`);
  return m;
}

const svg = readFileSync(SORGENTE, 'utf8');
const acqua = pezzo(
  svg,
  /<linearGradient id="water"[^>]*>([\s\S]*?)<\/linearGradient>/,
  'il gradiente «water»',
);
const fermate = [...acqua[1].matchAll(/<stop[^>]*\/>/g)].map((m) => m[0]);
if (fermate.length < 2) throw new Error('icon.svg: il gradiente «water» ha meno di due fermate');
const colonna = pezzo(
  svg,
  /<linearGradient id="column"[\s\S]*?<\/linearGradient>/,
  'il gradiente «column»',
)[0];
// Il contenuto del cartoncino: tutto quello che sta dentro il ritaglio
// arrotondato. Il ritaglio si lascia fuori: la forma la dà il telefono.
const disegno = pezzo(
  svg,
  /<g clip-path="url\(#card\)">([\s\S]*)<\/g>\s*<\/svg>/,
  'il gruppo del cartoncino',
)[1];
for (const parte of ['url(#column)', 'stroke=', '<circle']) {
  if (!disegno.includes(parte)) throw new Error(`icon.svg: nel cartoncino manca ${parte}`);
}

const centro = 512;
const alto = centro - centro * FINESTRA;
const basso = centro + centro * FINESTRA;

/** Lo strato davanti: il profilo, rimpicciolito attorno al centro, trasparente intorno. */
export const PRIMO_PIANO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none">
  <defs>${colonna}</defs>
  <g transform="translate(${centro} ${centro}) scale(${FINESTRA}) translate(-${centro} -${centro})">${disegno}</g>
</svg>`;

/**
 * Lo strato dietro: l'acqua fino al bordo. Il gradiente va dal colore della
 * superficie a quello del fondo DENTRO la finestra visibile, come sull'icona
 * del negozio; fuori dalla finestra resta il colore dell'estremo, che si vede
 * solo quando il telefono anima l'icona.
 */
export const SFONDO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="acqua" x1="${centro}" y1="${alto}" x2="${centro}" y2="${basso}" gradientUnits="userSpaceOnUse">
      ${fermate.join('\n      ')}
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#acqua)" />
</svg>`;

const XML_ADATTIVA = `<?xml version="1.0" encoding="utf-8"?>
<!-- Scritto da scripts/icone-android.mjs: non si modifica a mano. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@mipmap/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;

// Il colore che `tauri icon` mette come sfondo (#fff) non lo usa più nessuno:
// lo sfondo adesso è un'immagine. Resta il colore di mezzo dell'acqua, perché
// se un giorno qualcuno ci rimettesse il riferimento non torni il bianco.
const XML_COLORE = `<?xml version="1.0" encoding="utf-8"?>
<!-- Scritto da scripts/icone-android.mjs. L'icona adattiva usa l'immagine
     mipmap/ic_launcher_background, non questo colore. -->
<resources>
  <color name="ic_launcher_background">#123d71</color>
</resources>
`;

async function fotografa(pagina, disegnoSvg, lato, file) {
  await pagina.setViewportSize({ width: lato, height: lato });
  await pagina.setContent(
    `<style>html,body{margin:0;background:transparent;overflow:hidden}
     svg{display:block;width:${lato}px;height:${lato}px}</style>${disegnoSvg}`,
  );
  await pagina.screenshot({
    path: file,
    omitBackground: true,
    clip: { x: 0, y: 0, width: lato, height: lato },
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  );
  const pagina = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [densita, lato] of Object.entries(STRATI)) {
    const cartella = path.join(ANDROID, `mipmap-${densita}`);
    mkdirSync(cartella, { recursive: true });
    await fotografa(pagina, PRIMO_PIANO, lato, path.join(cartella, 'ic_launcher_foreground.png'));
    await fotografa(pagina, SFONDO, lato, path.join(cartella, 'ic_launcher_background.png'));
    console.log(`mipmap-${densita}: ${lato} × ${lato}`);
  }
  await browser.close();
  writeFileSync(path.join(ANDROID, 'mipmap-anydpi-v26/ic_launcher.xml'), XML_ADATTIVA);
  writeFileSync(path.join(ANDROID, 'values/ic_launcher_background.xml'), XML_COLORE);
  console.log('mipmap-anydpi-v26/ic_launcher.xml, values/ic_launcher_background.xml');
}
