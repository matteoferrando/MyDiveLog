/**
 * L'elenco dei file C che compongono libdivecomputer, contato da fuori.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO CHE QUESTO FILE ESISTE PER PRENDERE. ◄
 *
 * Su Windows `./configure` non gira — è uno script di shell che chiama `make`,
 * `sed` e `grep` — quindi `build.rs` compila la parte C da sé, con la cassa
 * `cc`, e per sapere QUALI file compilare legge `libdivecomputer_la_SOURCES`
 * dentro `src/Makefile.am`.
 *
 * Quella lettura è un'analisi di testo su un file che non è nostro. Se un
 * domani si aggiorna il tarball e quel Makefile cambia forma — una variabile
 * spezzata diversamente, un blocco condizionale in più — il lettore potrebbe
 * restituire **meno file** senza dare nessun errore. La libreria compilerebbe
 * benissimo. Semplicemente non conoscerebbe più alcuni computer subacquei, e
 * chi ne possiede uno vedrebbe «nessun modello con questo nome» senza che una
 * sola riga rossa sia comparsa da nessuna parte.
 *
 * È esattamente la forma di guasto che questo progetto ha già pagato una volta
 * con `DECO_NDL`: **niente si rompe, qualcosa diventa falso.**
 *
 * Il numero qui sotto non è un capriccio: è quanti file ha davvero
 * libdivecomputer 0.9.0. Il giorno che si cambia versione questo test diventa
 * rosso, e va aggiornato GUARDANDO — che è precisamente il momento in cui
 * qualcuno deve guardare.
 *
 * SI LEGGE DAL TARBALL, non dalla copia scompattata dalla build: quella è un
 * artefatto e su un'altra macchina può non esserci. Stessa regola del test
 * gemello sulle costanti.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const VERSIONE = '0.9.0';
const TARBALL = `src-tauri/vendor/libdivecomputer-${VERSIONE}.tar.gz`;
const BUILD_RS = 'src-tauri/build.rs';

/** Quanti `.c` ha libdivecomputer 0.9.0, serial escluso. Contati, non stimati. */
const QUANTI = 113;

let makefile = '';

beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'ldc-sorgenti-'));
  execSync(`tar xzf ${TARBALL} -C ${tmp}`);
  makefile = readFileSync(join(tmp, `libdivecomputer-${VERSIONE}/src/Makefile.am`), 'utf8');
});

/**
 * La stessa lettura che fa `build.rs`, riscritta qui in TypeScript.
 *
 * PERCHÉ RISCRITTA E NON RIUSATA: è codice Rust dentro uno script di build, che
 * da un test non si chiama. Ma non è una copia inutile — è una **seconda
 * implementazione della stessa regola**, ed è quello che le dà valore: se le
 * due leggono lo stesso Makefile e contano lo stesso numero, la regola è chiara;
 * se divergono, una delle due ha capito male, e vogliamo saperlo qui e non
 * dentro un pacchetto già consegnato.
 */
function sorgentiC(): string[] {
  const inizio = makefile.indexOf('libdivecomputer_la_SOURCES =');
  expect(inizio, 'libdivecomputer_la_SOURCES non c’è più in Makefile.am').toBeGreaterThan(-1);

  const file: string[] = [];
  for (const riga of makefile.slice(inizio).split('\n')) {
    const continua = riga.trimEnd().endsWith('\\');
    for (const pezzo of riga.replace(/\\+$/, '').trim().split(/\s+/)) {
      if (pezzo.endsWith('.c')) file.push(pezzo);
    }
    if (!continua) break;
  }
  return file;
}

describe('i file C di libdivecomputer, letti da Makefile.am', () => {
  it(`sono ${QUANTI}, ed è il numero che build.rs deve trovare su Windows`, () => {
    expect(sorgentiC()).toHaveLength(QUANTI);
  });

  it('contengono i driver dei due computer provati sul campo', () => {
    const file = sorgentiC();
    // Se un giorno la lettura si rompesse restituendo solo i primi file, il
    // conteggio potrebbe restare plausibile mentre spariscono i driver in fondo
    // all'elenco. Questi due stanno lontani fra loro apposta.
    expect(file).toContain('shearwater_petrel.c');
    expect(file).toContain('uwatec_smart.c');
    expect(file).toContain('divesoft_freedom.c');
  });

  it('non contengono il seriale, che build.rs sceglie per piattaforma', () => {
    // `serial_win32.c` e `serial_posix.c` stanno in due `+=` condizionali FUORI
    // dal blocco principale. Se un giorno finissero dentro, `build.rs` li
    // compilerebbe tutti e due e il linker troverebbe due volte le stesse
    // funzioni — un errore che si vede, ma solo su Windows, cioè tardi.
    const file = sorgentiC();
    expect(file).not.toContain('serial_win32.c');
    expect(file).not.toContain('serial_posix.c');
  });

  it('build.rs dichiara la stessa soglia minima che troviamo qui', () => {
    // `sorgenti_da_makefile` si ferma se conta 100 file o meno. Quella soglia
    // ha senso solo finché il numero vero le sta comodamente sopra: se un
    // aggiornamento del tarball scendesse a 105, la rete di sicurezza
    // resterebbe formalmente in piedi ma non prenderebbe più niente.
    const build = readFileSync(BUILD_RS, 'utf8');
    expect(build).toContain('file.len() > 100');
    expect(QUANTI).toBeGreaterThan(110);
  });
});
