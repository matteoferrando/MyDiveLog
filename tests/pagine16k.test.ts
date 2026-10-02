/**
 * ► LE LIBRERIE NATIVE DI ANDROID E LE PAGINE DA 16 KB. ◄
 *
 * Il 2 ottobre 2026 Google Play ha fermato la 1.8.32 — poche ore dopo averla
 * chiesta per l'icona — con *«Your app does not support 16 KB memory page
 * sizes»*. Misurato dentro l'`.aab` e dentro l'APK: `libmydivelog_lib.so`, la
 * sola libreria nativa, aveva i quattro segmenti `PT_LOAD` allineati a 4 KB.
 * Play lo pretende dalle app che puntano ad Android 15; l'NDK 27 fissato nel
 * workflow collega a 4 KB se non glielo si dice.
 *
 * La cura è una riga per il linker in `src-tauri/build.rs`; il controllo sta in
 * `scripts/pagine-16k.py`, che apre il pacchetto costruito. Qui si difendono
 * tutti e due: la riga, il passo del workflow che guarda DOPO la build, e lo
 * script fatto girare davvero su pacchetti costruiti apposta — con un ELF a
 * 16 KB passa, con uno a 4 KB si accende, e nell'APK si accende anche una
 * libreria allineata giusta ma messa nello zip fuori posto.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { lavoro } from './lavoroDelWorkflow';

const RADICE = fileURLToPath(new URL('..', import.meta.url));

describe('la libreria nativa si collega per le pagine da 16 KB', () => {
  const build = readFileSync(join(RADICE, 'src-tauri/build.rs'), 'utf8');

  it('build.rs lo chiede al linker, solo per Android', () => {
    const corpo = /fn pagine_da_16_kb\(\) \{([\s\S]*?)\n\}/.exec(build)?.[1] ?? '';
    // Una riga vera, non un testo che compare: commentata, la cercata «contiene»
    // resterebbe verde (vedi la prova qui sotto, che l'ha imparato così).
    expect(corpo, 'la riga per il linker non c’è più, o è commentata').toMatch(
      /^\s*println!\("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384"\);$/m,
    );
    expect(corpo, 'su Windows o su un Mac quella riga non ha senso').toContain('"android"');
  });

  it('e main() la chiama', () => {
    // Una riga che comincia con la chiamata, non una che la contiene: la prima
    // versione cercava il testo e restava verde con la chiamata commentata — se
    // n'è accorta la mutazione.
    const main = /fn main\(\) \{([\s\S]*?)\n\}/.exec(build)?.[1] ?? '';
    expect(main, 'la chiamata non c’è, o è commentata').toMatch(/^\s*pagine_da_16_kb\(\);/m);
  });
});

describe('il workflow guarda le librerie nel pacchetto', () => {
  const wf = lavoro(readFileSync(join(RADICE, '.github/workflows/altre-piattaforme.yml'), 'utf8'), 'android');

  it('DOPO averlo costruito, e solo fra i pacchetti consegnati', () => {
    expect(wf).toContain('tauri android build');
    const costruisce = wf.indexOf('name: Costruisci');
    const guarda = wf.indexOf('name: Le librerie native reggono le pagine da 16 KB?');
    expect(guarda, 'nessun passo guarda le pagine da 16 KB').toBeGreaterThan(-1);
    expect(guarda, 'un controllo prima della build non guarda niente').toBeGreaterThan(costruisce);
    const passo = wf.slice(guarda, wf.indexOf('\n\n', guarda));
    expect(passo, 'il comando non c’è, o è commentato').toMatch(
      /^\s+python3 scripts\/pagine-16k\.py \$PACCHETTI$/m,
    );
    expect(passo).toContain('src-tauri/gen/android/app/build/outputs');
  });
});

describe('il controllo delle pagine da 16 KB', () => {
  const CONTROLLO = join(RADICE, 'scripts/pagine-16k.py');

  /**
   * Un pacchetto finto con dentro un ELF a 64 bit ridotto all'osso: intestazione
   * e due segmenti PT_LOAD con l'allineamento chiesto. Nell'APK la libreria è
   * salvata senza compressione, e `fuoriPosto` la mette nello zip a un indirizzo
   * che non è un multiplo di 16 KB.
   */
  function pacchetto(estensione: 'aab' | 'apk', allineamento: number, fuoriPosto = false): string {
    const file = join(mkdtempSync(join(tmpdir(), 'pagine-')), `prova.${estensione}`);
    const codice = `
import struct, sys, zipfile
uscita, allineamento, estensione, fuori = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4] == '1'
elf = bytearray(64 + 2 * 56)
elf[0:4] = b'\\x7fELF'; elf[4] = 2; elf[5] = 1
struct.pack_into('<Q', elf, 0x20, 64)
struct.pack_into('<HH', elf, 0x36, 56, 2)
for i in range(2):
    struct.pack_into('<IIQQQQQQ', elf, 64 + i * 56, 1, 5, 0, 0, 0, 0, 0, allineamento)
nome = ('base/lib/arm64-v8a/' if estensione == 'aab' else 'lib/arm64-v8a/') + 'libprova.so'
with zipfile.ZipFile(uscita, 'w') as z:
    if estensione == 'aab':
        z.writestr(nome, bytes(elf), compress_type=zipfile.ZIP_DEFLATED)
    else:
        info = zipfile.ZipInfo(nome)
        info.compress_type = zipfile.ZIP_STORED
        mancano = (16384 - (30 + len(nome)) % 16384) % 16384
        if mancano and mancano < 4:
            mancano += 16384
        if fuori:
            mancano += 8
        if mancano:
            info.extra = struct.pack('<HH', 0xD935, mancano - 4) + bytes(mancano - 4)
        z.writestr(info, bytes(elf))
`;
    const r = spawnSync('python3', [
      '-c',
      codice,
      file,
      String(allineamento),
      estensione,
      fuoriPosto ? '1' : '0',
    ]);
    if (r.status !== 0) throw new Error(r.stderr.toString());
    return file;
  }
  const controlla = (...file: string[]) => spawnSync('python3', [CONTROLLO, ...file], { encoding: 'utf8' });

  it('passa con le librerie allineate a 16 KB, nell’.aab e nell’APK', () => {
    const r = controlla(pacchetto('aab', 16384), pacchetto('apk', 16384));
    expect(r.stdout).toContain('ogni libreria nativa a posto');
    expect(r.status).toBe(0);
  });

  it('si accende con una libreria allineata a 4 KB, com’era la 1.8.32', () => {
    const r = controlla(pacchetto('aab', 4096));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('segmenti allineati a 0x1000');
  });

  it('nell’APK si accende anche se la libreria giusta sta nello zip fuori posto', () => {
    const r = controlla(pacchetto('apk', 16384, true));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('fuori da un multiplo di 16 KB');
  });

  it('non guardare niente è un errore', () => {
    expect(controlla().status).toBe(1);
  });
});
