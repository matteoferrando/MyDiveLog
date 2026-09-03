/**
 * Il PKGBUILD per Arch e Manjaro: che dica il vero, come la cask.
 *
 * È lo stesso problema della cask di Homebrew, e ha le stesse prove: un file che
 * dichiara una versione e un'impronta, dove le due righe possono contraddirsi
 * senza che nessun comando lo dica — se non `makepkg` sulla macchina di chi
 * installa, che si ferma con «One or more files did not pass the validity
 * check» e lascia a quella persona la caccia.
 *
 * ► DA DOVE VIENE. ◄ Il 3 settembre 2026 il proprietario ha installato MyDiveLog
 * su Manjaro. Il progetto pubblica solo un .deb, e Manjaro non ha dpkg: il
 * PKGBUILD è stato scritto a mano quel giorno, ha funzionato al primo colpo —
 * si installa, si apre, importa, scarica via Bluetooth — e il giorno stesso è
 * passato nel generatore, perché un file scritto a mano che dichiara
 * un'impronta è esattamente la cosa che `genera-cask.mjs` esiste per non avere.
 *
 * Perché non si controlla l'impronta contro la rete: vedi `cask.test.ts` — una
 * prova che chiama GitHub fallisce in aereo, e insegna a ignorare il rosso.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const PKGBUILD = readFileSync(`${RADICE}linux/PKGBUILD`, 'utf8');
const PACCHETTO = JSON.parse(readFileSync(`${RADICE}package.json`, 'utf8'));
const WORKFLOW = readFileSync(`${RADICE}.github/workflows/altre-piattaforme.yml`, 'utf8');

const variabile = (nome: string) => new RegExp(`^${nome}=(.+)$`, 'm').exec(PKGBUILD)?.[1];

describe('il PKGBUILD per Arch', () => {
  it('dichiara la versione del progetto', () => {
    expect(variabile('pkgver')).toBe(PACCHETTO.version);
  });

  it('l’impronta è un vero sha256, e non un segnaposto', () => {
    const sha = /^sha256sums=\('([^']+)'\)$/m.exec(PKGBUILD)?.[1];
    expect(sha, 'il PKGBUILD non dichiara nessuna impronta').toBeDefined();
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    // `SKIP` è legittimo in un PKGBUILD e serve ai sorgenti che cambiano a ogni
    // richiesta. Qui sarebbe il modo di far passare un pacchetto che non sa
    // cosa sta scaricando.
    expect(PKGBUILD).not.toMatch(/sha256sums=\(\s*'SKIP'/);
  });

  it('l’indirizzo porta la versione dichiarata, non «latest»', () => {
    // Con «latest», il giorno che esce una versione nuova il PKGBUILD
    // scaricherebbe un file diverso da quello di cui dichiara l'impronta.
    const source = /^source=\("([^"]+)"\)$/m.exec(PKGBUILD)?.[1];
    expect(source, 'il PKGBUILD non ha un source').toBeDefined();
    expect(source, 'il PKGBUILD scarica «latest»').not.toContain('/latest/');
    expect(source).toContain('/releases/download/v${pkgver}/');
    expect(source).toContain('MyDiveLog-Linux-amd64.deb');
  });

  it('il file che dice di non estrarre è lo stesso che scarica', () => {
    // makepkg estrae da solo tutto quello che riconosce, e un .deb non lo
    // riconosce — ma se il nome in `noextract` non combacia con quello in
    // `source`, makepkg PROVA a estrarlo, fallisce in silenzio, e package()
    // non trova il file. Due righe che devono dire la stessa cosa.
    const nomeLocale = /^source=\("([^:]+)::/m.exec(PKGBUILD)?.[1];
    const noextract = /^noextract=\("([^"]+)"\)$/m.exec(PKGBUILD)?.[1];
    expect(nomeLocale).toBeDefined();
    expect(noextract).toBe(nomeLocale);
    // E package() apre proprio quel file, non un altro nome scritto a mano.
    expect(PKGBUILD).toContain(`"\${srcdir}/${nomeLocale}"`);
  });

  it('scarica il pacchetto che il workflow costruisce davvero', () => {
    // Il nome dell'allegato non si inventa: è quello che `altre-piattaforme.yml`
    // copia in `consegna/`. Se un giorno cambia lì, deve cambiare anche qui.
    const nel = /-exec cp \{\} consegna\/(MyDiveLog-Linux-[^ ;\\]+)/.exec(WORKFLOW)?.[1];
    expect(nel, 'il workflow non nomina più il .deb: la prova va aggiornata').toBeDefined();
    expect(PKGBUILD).toContain(nel!);
  });

  it('dichiara le dipendenze coi nomi di Arch, e le stesse del .deb', () => {
    // Il .deb dichiara `libwebkit2gtk-4.1-0` e `libgtk-3-0`. Su Arch si chiamano
    // così, e sono le due librerie che il binario carica davvero.
    expect(variabile('depends')).toBe("('webkit2gtk-4.1' 'gtk3')");
    // Il Bluetooth su Linux passa da BlueZ, che non è una dipendenza del
    // binario ma di quello che l'utente vuole farci: facoltativa, e detta.
    expect(PKGBUILD).toMatch(/^optdepends=\('bluez:/m);
  });

  it('resta un file generato, e lo dice a chi lo apre', () => {
    expect(PKGBUILD.split('\n')[0]).toContain('FILE GENERATO');
    expect(PKGBUILD).toContain('npm run cask');
  });

  it('non promette un aggiornamento automatico che su Linux non c’è', () => {
    // L'aggiornatore di Tauri su Linux funziona con l'AppImage, non col .deb, ed
    // è spento alla compilazione. Un PKGBUILD che tacesse lascerebbe credere
    // che l'app si aggiorni come sul Mac.
    expect(PKGBUILD).toMatch(/NON si aggiorna da sola/);
  });
});
