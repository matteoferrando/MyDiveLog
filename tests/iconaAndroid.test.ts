/**
 * ► L'ICONA DI ANDROID È LA NOSTRA, E ARRIVA NEL PACCHETTO. ◄
 *
 * Il 2 ottobre 2026 Google Play ha rifiutato la 1.8.31, norma *Misleading
 * Claims*: «l'icona installata è diversa da quella della scheda». Aveva ragione,
 * e non solo per quella versione: il workflow rigenera il progetto Android con
 * `tauri android init`, che ci mette l'icona di fabbrica di Tauri, e nessun
 * passo ci copiava sopra le nostre. **Ogni APK e ogni `.aab` fino alla 1.8.31
 * avevano i due anelli di Tauri**, compreso l'APK del sito. Nessun comando
 * falliva e nessuna prova guardava.
 *
 * Tre pezzi, e una prova per ciascuno:
 *
 *   1. `scripts/icone-android.mjs` disegna l'icona adattiva — sfondo e profilo
 *      su due strati — dal marchio di `icon.svg`. Qui si guardano i PNG che ha
 *      scritto: misure, sfondo pieno, profilo dentro il cerchio che nessuna
 *      maschera taglia. Diventano rossi se qualcuno rilancia `tauri icon`, che
 *      rimette l'icona intera nello strato davanti su uno sfondo bianco.
 *   2. `scripts/icone-progetto-android.mjs` le copia nel progetto generato.
 *   3. `scripts/icona-nel-pacchetto.py` apre l'APK e l'`.aab` costruiti e
 *      confronta i pixel. Visto rosso sui pacchetti veri della 1.8.31, verde su
 *      quelli stessi con le nostre icone ricodificate (byte diversi, pixel
 *      uguali, come fa gradle), rosso di nuovo cambiando UN pixel.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  copiaIcone,
  // @ts-expect-error — script `.mjs` senza tipi: la direttiva sta sulla riga del modulo, vedi travasoSegnalazioni.test.ts.
} from '../scripts/icone-progetto-android.mjs';
import { lavoro } from './lavoroDelWorkflow';
import { leggiPng } from './pngPixel';

const copia = copiaIcone as (origine: string, destinazione: string) => string[];

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const ANDROID = join(RADICE, 'src-tauri/icons/android');
/** Il lato dei due strati, 108 dp, densità per densità. */
const STRATI = [
  ['mdpi', 108],
  ['hdpi', 162],
  ['xhdpi', 216],
  ['xxhdpi', 324],
  ['xxxhdpi', 432],
] as const;

const strato = (densita: string, nome: string) =>
  leggiPng(readFileSync(join(ANDROID, `mipmap-${densita}`, `ic_launcher_${nome}.png`)));

describe("l'icona adattiva nel repository", () => {
  it('prende i due strati nostri, non lo sfondo bianco di `tauri icon`', () => {
    const xml = readFileSync(join(ANDROID, 'mipmap-anydpi-v26/ic_launcher.xml'), 'utf8');
    expect(xml).toContain('<adaptive-icon');
    expect(xml).toContain('@mipmap/ic_launcher_foreground');
    expect(xml, 'lo sfondo è tornato un colore: è passato `tauri icon`').toContain(
      '@mipmap/ic_launcher_background',
    );
  });

  it.each(STRATI)('mipmap-%s: due strati da %i pixel', (densita, lato) => {
    for (const nome of ['foreground', 'background']) {
      const { larghezza, altezza } = strato(densita, nome);
      expect([larghezza, altezza], `ic_launcher_${nome}.png`).toEqual([lato, lato]);
    }
  });

  it.each(STRATI)('mipmap-%s: lo sfondo è pieno fino al bordo', (densita) => {
    const { rgba } = strato(densita, 'background');
    let trasparenti = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) trasparenti++;
    expect(trasparenti, 'uno sfondo con dei buchi mostra la carta da parati del telefono').toBe(0);
  });

  /*
   * Il telefono mostra i 72 dp centrali dei 108 e ci passa sopra la SUA
   * maschera: cerchio, goccia, quadrato arrotondato. L'unica parte che nessuna
   * maschera taglia è il cerchio di 66 dp al centro. Il profilo deve starci
   * dentro tutto — e deve esserci: uno strato vuoto passerebbe la prima metà.
   */
  it.each(STRATI)('mipmap-%s: il profilo sta tutto dentro il cerchio di sicurezza', (densita, lato) => {
    const { rgba } = strato(densita, 'foreground');
    const centro = lato / 2;
    const raggio = (lato * 33) / 108;
    let lontano = 0;
    let visibili = 0;
    for (let y = 0; y < lato; y++) {
      for (let x = 0; x < lato; x++) {
        if (rgba[(y * lato + x) * 4 + 3] === 0) continue;
        visibili++;
        lontano = Math.max(lontano, Math.hypot(x + 0.5 - centro, y + 0.5 - centro));
      }
    }
    expect(visibili / (lato * lato), 'lo strato del profilo è vuoto').toBeGreaterThan(0.05);
    expect(lontano, 'qualcosa esce dal cerchio di 66 dp: una maschera tonda lo taglia').toBeLessThanOrEqual(
      raggio + 1,
    );
  });
});

describe('il workflow mette le icone nel progetto e poi le cerca nel pacchetto', () => {
  const wf = lavoro(readFileSync(join(RADICE, '.github/workflows/altre-piattaforme.yml'), 'utf8'), 'android');

  it('il ritaglio è il lavoro Android', () => {
    expect(wf).toContain('tauri android build');
    expect(wf).not.toContain('shell: pwsh');
  });

  it('copia le icone DOPO aver generato il progetto e PRIMA di costruirlo', () => {
    const genera = wf.indexOf('tauri android init');
    // La riga `run:` vera: un comando commentato conterrebbe lo stesso testo.
    const icone = wf.search(/^\s+run: node scripts\/icone-progetto-android\.mjs$/m);
    const costruisce = wf.indexOf('name: Costruisci');
    expect(icone, 'nessun passo copia le icone: torna quella di Tauri').toBeGreaterThan(-1);
    expect(icone, 'copiate prima di init, init le sovrascrive').toBeGreaterThan(genera);
    expect(costruisce, 'copiate dopo la build, non entrano nel pacchetto').toBeGreaterThan(icone);
  });

  it('guarda nel pacchetto DOPO averlo costruito, e solo fra i pacchetti consegnati', () => {
    const costruisce = wf.indexOf('name: Costruisci');
    const guarda = wf.indexOf("name: L'icona nel pacchetto è la nostra?");
    expect(guarda).toBeGreaterThan(costruisce);
    const passo = wf.slice(guarda, wf.indexOf('\n\n', guarda));
    expect(passo, 'il comando non c’è, o è commentato').toMatch(
      /^\s+python3 scripts\/icona-nel-pacchetto\.py \$PACCHETTI$/m,
    );
    expect(passo, 'gli intermedi di gradle non sono pacchetti consegnati').toContain(
      'src-tauri/gen/android/app/build/outputs',
    );
  });
});

describe('la copia delle icone nel progetto generato', () => {
  function cartelle(conAdattiva = true) {
    const base = mkdtempSync(join(tmpdir(), 'icone-android-'));
    const origine = join(base, 'icone');
    const res = join(base, 'res');
    mkdirSync(join(origine, 'mipmap-mdpi'), { recursive: true });
    writeFileSync(join(origine, 'mipmap-mdpi/ic_launcher.png'), 'la nostra');
    if (conAdattiva) {
      mkdirSync(join(origine, 'mipmap-anydpi-v26'), { recursive: true });
      writeFileSync(join(origine, 'mipmap-anydpi-v26/ic_launcher.xml'), '<adaptive-icon/>');
    }
    mkdirSync(join(res, 'mipmap-mdpi'), { recursive: true });
    writeFileSync(join(res, 'mipmap-mdpi/ic_launcher.png'), 'quella di Tauri');
    return { base, origine, res };
  }

  it('scrive le nostre sopra quelle di fabbrica', () => {
    const { origine, res } = cartelle();
    expect(copia(origine, res)).toEqual(['mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-mdpi/ic_launcher.png']);
    expect(readFileSync(join(res, 'mipmap-mdpi/ic_launcher.png'), 'utf8')).toBe('la nostra');
  });

  it('si ferma se il progetto non è stato generato', () => {
    const { base, origine } = cartelle();
    expect(() => copia(origine, join(base, 'non-generato'))).toThrow(/tauri android init/);
  });

  it("si ferma se manca l'icona adattiva", () => {
    const { origine, res } = cartelle(false);
    expect(() => copia(origine, res)).toThrow(/anydpi/);
  });

  it('con le icone vere porta tutti e due gli strati, a ogni densità', () => {
    const { res } = cartelle();
    const copiati = copia(ANDROID, res);
    for (const [densita] of STRATI) {
      expect(copiati).toContain(`mipmap-${densita}/ic_launcher_foreground.png`);
      expect(copiati).toContain(`mipmap-${densita}/ic_launcher_background.png`);
    }
  });
});

describe("il controllo dell'icona dentro il pacchetto", () => {
  const CONTROLLO = join(RADICE, 'scripts/icona-nel-pacchetto.py');

  /** Un `.aab` finto con le icone del repository; `scambi` mette un file al posto di un altro. */
  function bundle(scambi: Record<string, string> = {}, adattiva = true): string {
    const file = join(mkdtempSync(join(tmpdir(), 'pacchetto-')), 'prova.aab');
    const codice = `
import json, sys, zipfile
uscita, icone, scambi, adattiva = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), sys.argv[4] == '1'
with zipfile.ZipFile(uscita, 'w', zipfile.ZIP_DEFLATED) as z:
    for d in ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']:
        for n in ['ic_launcher_foreground.png', 'ic_launcher_background.png', 'ic_launcher.png']:
            chiave = f'mipmap-{d}/{n}'
            z.write(f'{icone}/{scambi.get(chiave, chiave)}', f'base/res/mipmap-{d}-v4/{n}')
    if adattiva:
        z.writestr('base/res/mipmap-anydpi-v26/ic_launcher.xml', '<adaptive-icon/>')
`;
    const r = spawnSync('python3', [
      '-c',
      codice,
      file,
      ANDROID,
      JSON.stringify(scambi),
      adattiva ? '1' : '0',
    ]);
    if (r.status !== 0) throw new Error(r.stderr.toString());
    return file;
  }
  const controlla = (...pacchetti: string[]) =>
    spawnSync('python3', [CONTROLLO, ...pacchetti], { encoding: 'utf8' });

  it('passa con le nostre icone', { timeout: 60_000 }, () => {
    const r = controlla(bundle());
    expect(r.stdout + r.stderr).toContain('icona nostra');
    expect(r.status).toBe(0);
  });

  it('si accende se uno strato non è il nostro', { timeout: 60_000 }, () => {
    // Stessa misura, pixel diversi: lo sfondo al posto del profilo.
    const r = controlla(
      bundle({ 'mipmap-mdpi/ic_launcher_foreground.png': 'mipmap-mdpi/ic_launcher_background.png' }),
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('mipmap-mdpi/ic_launcher_foreground.png: nel pacchetto non c');
  });

  it("si accende se manca l'icona adattiva", { timeout: 60_000 }, () => {
    const r = controlla(bundle({}, false));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('mipmap-anydpi-v26/ic_launcher.xml');
  });

  it('non guardare niente è un errore', () => {
    const r = controlla();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('non ha guardato niente');
  });
});
