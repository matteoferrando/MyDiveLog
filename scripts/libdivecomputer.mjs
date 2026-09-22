/**
 * La libdivecomputer vendorizzata: quale versione, e dov'è il tarball.
 *
 * ► UN POSTO SOLO, ED È `build.rs`. ◄ Fino al 22 settembre 2026 la versione
 * stava scritta in cinque file — lo script di build, lo script del catalogo e
 * tre prove — ognuno col suo `'0.9.0'`. Il giorno dell'aggiornamento andavano
 * cambiati tutti e cinque, e dimenticarne uno non dava un errore chiaro: dava
 * una prova che leggeva un tarball che non c'era più. *Cinque copie della
 * stessa regola sono una regola e quattro sue versioni vecchie* — la frase è
 * in testa a `naviga.mjs`, e vale anche qui.
 *
 * Adesso la versione la dichiara solo `build.rs`, che è chi compila davvero, e
 * tutti gli altri la leggono da lì. Se la riga cambiasse forma, questo modulo
 * si ferma invece di indovinare.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const BUILD_RS = readFileSync(path.join(RADICE, 'src-tauri/build.rs'), 'utf8');

const trovata = /const VERSIONE: &str = "([^"]+)";/.exec(BUILD_RS);
if (!trovata) {
  throw new Error('src-tauri/build.rs non dichiara più `const VERSIONE: &str = "…";`: è cambiata forma?');
}

/** La versione, così come la scrive `configure.ac`: «0.10.0-devel». */
export const VERSIONE_LDC = trovata[1];

/** Il tarball versionato, relativo alla radice del repository. */
export const TARBALL_LDC = `src-tauri/vendor/libdivecomputer-${VERSIONE_LDC}.tar.gz`;

/** La cartella che il tarball crea quando lo si scompatta. */
export const CARTELLA_LDC = `libdivecomputer-${VERSIONE_LDC}`;
