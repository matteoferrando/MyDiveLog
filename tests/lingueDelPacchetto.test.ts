/**
 * LE LINGUE CHE IL PACCHETTO APPLE DICHIARA SONO QUELLE CHE L'APP PARLA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO, misurato il 21 settembre 2026 sulla 1.8.29 consegnata. ◄
 *
 * L'App Store elencava l'applicazione come **solo inglese**
 * (`languageCodesISO2A: EN`). Dentro i due pacchetti consegnati il motivo: nessuna
 * cartella `.lproj`, e la regione di sviluppo di fabbrica di Tauri — `en`
 * sull'iPhone, `English` sul Mac. Nessuno l'aveva mai letta.
 *
 * E non era solo la scheda del negozio. Provato su un simulatore iPhone con la
 * lingua di sistema italiana, con una WebView e tre varianti dello stesso
 * pacchetto: senza dichiarazione UIKit sceglie `en` e scrive
 * «Cancel/Done/Copy/Paste» — sono i pezzi che il sistema disegna DENTRO l'app;
 * dichiarando `it` scrive «Annulla/Fine/Copia/Incolla». L'interfaccia invece
 * non cambiava: `navigator.language` rispondeva `it-IT` in tutte e tre.
 *
 * ► PERCHÉ LE LINGUE SI LEGGONO DAL TIPO `Lingua` E NON DA UN ELENCO QUI. ◄ Il
 * giorno che l'interfaccia impara una terza lingua, un elenco scritto in questo
 * file continuerebbe a dire «italiano e inglese» e passerebbe. Letto dalla
 * dichiarazione, la prova diventa rossa da sola e dice cosa manca.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const leggi = (percorso: string) => readFileSync(percorso, 'utf8');

/** Le lingue dell'interfaccia, lette dal tipo che le dichiara. */
function lingueDellInterfaccia(): string[] {
  const tipo = /export type Lingua\s*=\s*([^;]+);/.exec(leggi('src/ui/lingua.tsx'));
  return [...(tipo?.[1] ?? '').matchAll(/'([a-z]{2})'/g)].map((m) => m[1] ?? '').sort();
}

/** Le lingue che un Info.plist dichiara al sistema. */
function lingueDichiarate(plist: string): string[] {
  const elenco = /<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist);
  return [...(elenco?.[1] ?? '').matchAll(/<string>([^<]+)<\/string>/g)]
    .map((m) => (m[1] ?? '').trim())
    .sort();
}

/** Le frasi di un file `.strings`, chiave → testo. */
function frasi(testo: string): Map<string, string> {
  const senzaCommenti = testo.replace(/\/\*[\s\S]*?\*\//g, '');
  const mappa = new Map<string, string>();
  for (const m of senzaCommenti.matchAll(/"([^"]+)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g)) {
    mappa.set(m[1] ?? '', m[2] ?? '');
  }
  return mappa;
}

/** Le frasi che il sistema mostra a nome nostro: i perché dei permessi. */
function permessi(plist: string): Map<string, string> {
  const mappa = new Map<string, string>();
  for (const m of plist.matchAll(/<key>(NS\w*UsageDescription)<\/key>\s*<string>([^<]*)<\/string>/g)) {
    mappa.set(m[1] ?? '', m[2] ?? '');
  }
  return mappa;
}

const LINGUE = lingueDellInterfaccia();
const PLIST = [
  ['macOS', 'src-tauri/Info.plist'],
  ['iOS', 'src-tauri/Info.ios.plist'],
] as const;
const stringsDi = (lingua: string) => `src-tauri/lingue/${lingua}.lproj/InfoPlist.strings`;

describe('le lingue del pacchetto Apple', () => {
  it('le lingue dell’interfaccia si leggono (se no le prove sotto non guardano niente)', () => {
    expect(LINGUE).toContain('it');
    expect(LINGUE.length).toBeGreaterThan(1);
  });

  it.each(PLIST)('%s dichiara al sistema le lingue dell’interfaccia', (_, percorso) => {
    expect(lingueDichiarate(leggi(percorso))).toEqual(LINGUE);
  });

  it.each(LINGUE)('%s.lproj esiste e traduce ogni perché che il sistema mostra', (lingua) => {
    expect(existsSync(stringsDi(lingua)), stringsDi(lingua)).toBe(true);
    const tradotte = frasi(leggi(stringsDi(lingua)));
    for (const [, percorso] of PLIST) {
      for (const chiave of permessi(leggi(percorso)).keys()) {
        expect(tradotte.get(chiave), `${chiave} manca in ${stringsDi(lingua)}`).toBeTruthy();
      }
    }
  });

  it('l’italiano delle cartelle e quello dei plist sono la stessa frase', () => {
    /*
     * Il testo scritto nel plist resta il ripiego del sistema. Se divergesse
     * da quello di `it.lproj` ci sarebbero due italiani per la stessa
     * promessa sul Bluetooth, e prima o poi uno dei due resterebbe indietro.
     */
    const italiano = frasi(leggi(stringsDi('it')));
    for (const [, percorso] of PLIST) {
      for (const [chiave, testo] of permessi(leggi(percorso))) {
        expect(italiano.get(chiave), `${chiave} in ${percorso}`).toBe(testo);
      }
    }
  });

  it('sul Mac le cartelle entrano nel pacchetto, da tauri.conf.json', () => {
    const conf = JSON.parse(leggi('src-tauri/tauri.conf.json')) as {
      bundle: { macOS: { files?: Record<string, string> } };
    };
    const file = conf.bundle.macOS.files ?? {};
    for (const lingua of LINGUE) {
      const sorgente = file[`Resources/${lingua}.lproj/InfoPlist.strings`];
      expect(sorgente, `manca ${lingua}.lproj fra i file del pacchetto macOS`).toBe(
        `lingue/${lingua}.lproj/InfoPlist.strings`,
      );
      expect(existsSync(`src-tauri/${sorgente ?? ''}`)).toBe(true);
    }
  });

  it('su iPhone ogni script le copia nel progetto PRIMA di generarlo', () => {
    /*
     * Come il manifesto della privacy (`iosGuardie.test.ts`): `gen/apple/` è
     * generata, e XcodeGen elenca le risorse quando genera — una cartella
     * copiata dopo non entrerebbe nel pacchetto, senza dirlo.
     */
    const pacchetto = JSON.parse(leggi('package.json')) as { scripts: Record<string, string> };
    const script = Object.entries(pacchetto.scripts).filter(([nome]) => nome.startsWith('ios:'));
    expect(script.length).toBeGreaterThan(0);
    for (const [nome, riga] of script) {
      const copia = riga.indexOf('cp -R src-tauri/lingue/. src-tauri/gen/apple/mydivelog_iOS/');
      const init = riga.indexOf('tauri ios init');
      expect(copia, nome).toBeGreaterThanOrEqual(0);
      expect(copia, nome).toBeLessThan(init);
    }
  });
});
