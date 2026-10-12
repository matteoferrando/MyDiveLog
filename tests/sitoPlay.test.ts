/**
 * ► ANDROID SUL SITO: GOOGLE PLAY DAVANTI, L'APK ACCANTO, E IL BACKUP PRIMA. ◄
 *
 * Dal 2 ottobre 2026 MyDiveLog è pubblica su Google Play. Il sito mandava
 * ancora tutti all'APK, che non si aggiorna da solo; adesso la scheda Android e
 * il pulsante in fondo portano a Play, e l'APK resta come alternativa.
 *
 * ► LE DUE COPIE NON HANNO LA STESSA FIRMA. ◄ Misurato il 12 ottobre 2026 in
 * Play Console: la chiave con cui Play firma l'app sui telefoni (SHA-256
 * D9:E0:67:CE…DA:17) l'ha generata Google; quella con cui firmiamo l'APK è la
 * nostra (69:39:26:8E…B3:11). Android non aggiorna un'applicazione con un
 * certificato diverso, quindi chi ha l'APK e passa a Play deve disinstallare —
 * e disinstallare cancella l'archivio sul telefono. È scritto nella stessa nota
 * del collegamento all'APK, con le parole esatte del percorso nel
 * menu dell'app: se l'app cambia nome a «Impostazioni» o alla carta del
 * backup, queste prove diventano rosse invece di lasciare sul sito un
 * percorso che non porta da nessuna parte.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const leggi = (file: string) => readFileSync(`${RADICE}${file}`, 'utf8');
const piano = (testo: string) => testo.replace(/\s+/g, ' ');

const IDENTIFICATIVO = (JSON.parse(leggi('src-tauri/tauri.conf.json')) as { identifier: string }).identifier;
const PLAY = `https://play.google.com/store/apps/details?id=${IDENTIFICATIVO}`;
const APK =
  'https://github.com/matteoferrando/MyDiveLog/releases/latest/download/MyDiveLog-Android-arm64.apk';

const NAVIGAZIONE = leggi('src/ui/navigazione.tsx');
const TRADUZIONI = leggi('src/ui/traduzioni.ts');
const IMPOSTAZIONI = /\{ id: 'sync', label: '([^']+)' \}/.exec(NAVIGAZIONE)?.[1];
const SETTINGS = new RegExp(`^\\s*'?${IMPOSTAZIONI}'?: '([^']+)',`, 'm').exec(TRADUZIONI)?.[1];
const CARTA = 'Backup completo e ripristino';
const CARD = new RegExp(`^\\s*'${CARTA}': '([^']+)',`, 'm').exec(TRADUZIONI)?.[1];

describe('le parole del percorso sono quelle dell’app', () => {
  it('la pagina si chiama così nel menu, e così in inglese', () => {
    expect(IMPOSTAZIONI).toBe('Impostazioni');
    expect(SETTINGS).toBe('Settings');
  });

  it('la carta del backup esiste nella pagina, e così si chiama in inglese', () => {
    expect(leggi('src/ui/pages/SyncPage.tsx')).toContain(`titolo={t('${CARTA}')}`);
    expect(CARD).toBe('Full backup and restore');
  });
});

describe.each([
  ['sito/index.html', () => `${IMPOSTAZIONI} → ${CARTA}`],
  ['sito/en/index.html', () => `${SETTINGS} → ${CARD}`],
])('%s', (file, percorso) => {
  const html = piano(leggi(file));

  it('la scheda Android porta a Google Play, col nome del pacchetto vero', () => {
    const scheda = new RegExp(
      `<a class="scheda-piattaforma minore" href="([^"]+)"[^>]*>(?:(?!</a>).)*<span class="nome">Android</span>`,
    ).exec(html);
    expect(scheda?.[1], 'la scheda Android non porta a Play').toBe(PLAY);
  });

  it('anche il pulsante in fondo', () => {
    expect(html).toMatch(
      new RegExp(`<a class="pulsante" href="${PLAY.replace(/[.?]/g, '\\$&')}"[^>]*> ?Android</a`),
    );
  });

  it('l’APK resta, e il backup sta nella stessa nota del suo collegamento', () => {
    const apk = html.indexOf(`href="${APK}"`);
    expect(apk, 'l’APK non è più offerto').toBeGreaterThan(-1);
    const nota = html.lastIndexOf('<p class="nota-schede">', apk);
    expect(nota, 'il collegamento all’APK non sta nella nota sulle firme').toBeGreaterThan(-1);
    const testo = html.slice(nota, html.indexOf('</p>', apk));
    expect(testo, 'il percorso del backup non è quello dell’app').toContain(percorso());
  });
});

describe.each([
  ['sito/aiuto.html', () => `${IMPOSTAZIONI} → ${CARTA}`],
  ['sito/en/help.html', () => `${SETTINGS} → ${CARD}`],
])('%s', (file, percorso) => {
  it('spiega come passare dall’APK a Play senza perdere le immersioni', () => {
    const html = piano(leggi(file));
    expect(html).toContain(PLAY);
    expect(html).toContain(percorso());
  });
});

describe('il README', () => {
  it('dice di Google Play e del backup', () => {
    const readme = piano(leggi('README.md'));
    expect(readme).toContain(PLAY);
    expect(readme).toContain(`${IMPOSTAZIONI} → ${CARTA}`);
  });
});
