/**
 * Le costanti copiate da libdivecomputer, confrontate con libdivecomputer.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTO FILE ESISTE, ED È LA LEZIONE PIÙ CARA DEL 25 AGOSTO 2026. ◄
 *
 * `src-tauri/src/trasporto_ldc.rs` parla con una libreria C attraverso venti
 * righe di `extern` scritte a mano. Scritte a mano vuol dire che i numeri —
 * quale campo è il 12, quale valore significa «nessuna decompressione» — sono
 * TRASCRIZIONI, e una trascrizione sbagliata di un enum C non dà nessun errore:
 * dà un numero plausibile.
 *
 * È successo. `DECO_NDL` valeva 1 con un commento che diceva «0 nessuna, 1 NDL,
 * 2 sosta deco, 3 sosta di sicurezza» — un ordine inventato. Quello vero è
 * `DC_DECO_NDL = 0`, `DC_DECO_SAFETYSTOP = 1`. Conseguenze, tutte silenziose:
 * l'NDL non arrivava MAI, i secondi di una sosta di sicurezza finivano dentro
 * `ndlS`, e ogni campione in curva riceveva `ceiling: 0` — il che, in
 * `dedupe.ts`, fa valere due punti in più a quel profilo e gli permette di
 * **sostituire** il profilo vero letto da uno dei driver scritti in casa.
 *
 * Tipi, test, lint, formato, build, cargo e la compilazione per iPhone: tutto
 * verde. Nessun controllo poteva accorgersene, perché non c'era niente da
 * confrontare. Adesso c'è: si legge l'intestazione VERA dal tarball versionato
 * e la si confronta con quello che il Rust dichiara.
 *
 * SI LEGGE DAL TARBALL, non dalla copia scompattata dalla build: quella è un
 * artefatto e su un'altra macchina può non esserci. È la stessa regola dello
 * script che genera il catalogo.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const VERSIONE = '0.9.0';
const TARBALL = `src-tauri/vendor/libdivecomputer-${VERSIONE}.tar.gz`;
const RUST = 'src-tauri/src/trasporto_ldc.rs';

let intestazione = '';
let rust = '';

beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'ldc-costanti-'));
  execSync(`tar xzf ${TARBALL} -C ${tmp}`);
  intestazione = readFileSync(
    join(tmp, `libdivecomputer-${VERSIONE}/include/libdivecomputer/parser.h`),
    'utf8',
  );
  rust = readFileSync(RUST, 'utf8');
});

/**
 * I valori di un `enum` C, nell'ordine in cui sono scritti.
 *
 * Gli enum di `parser.h` non assegnano valori espliciti: contano da zero
 * nell'ordine di dichiarazione, ed è proprio questo che rende una trascrizione
 * a memoria così facile da sbagliare — non c'è nessun numero da copiare, c'è
 * una POSIZIONE da contare.
 */
function valoriEnum(nome: string): string[] {
  const m = intestazione.match(new RegExp(`typedef enum ${nome}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`enum ${nome} non trovato in parser.h`);
  return m[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** Il valore di una costante `const NOME: c_uint = N;` nel Rust. */
function costanteRust(nome: string): number {
  const m = rust.match(new RegExp(`const ${nome}: c_uint = (\\d+);`));
  if (!m) throw new Error(`costante ${nome} non trovata in ${RUST}`);
  return Number(m[1]);
}

describe('le costanti del ponte combaciano con parser.h', () => {
  it('DECO_NDL è DC_DECO_NDL, che vale zero — non uno', () => {
    const tipi = valoriEnum('dc_deco_type_t');
    expect(tipi).toEqual(['DC_DECO_NDL', 'DC_DECO_SAFETYSTOP', 'DC_DECO_DECOSTOP', 'DC_DECO_DEEPSTOP']);
    expect(costanteRust('DECO_NDL')).toBe(tipi.indexOf('DC_DECO_NDL'));
  });

  it('gli indici dei campi sono quelli di dc_field_type_t', () => {
    /*
     * Sette costanti, sette posizioni in un elenco di quindici. Sbagliarne una
     * significa leggere un campo per un altro — e `dc_parser_get_field` scrive
     * in un puntatore `void*`, quindi leggere la temperatura in un `c_uint`
     * destinato alla durata non dà errore: dà un numero.
     */
    const campi = valoriEnum('dc_field_type_t');
    const attesi: [string, string][] = [
      ['CAMPO_DURATA', 'DC_FIELD_DIVETIME'],
      ['CAMPO_PROF_MAX', 'DC_FIELD_MAXDEPTH'],
      ['CAMPO_PROF_MEDIA', 'DC_FIELD_AVGDEPTH'],
      ['CAMPO_GAS_QUANTI', 'DC_FIELD_GASMIX_COUNT'],
      ['CAMPO_GAS', 'DC_FIELD_GASMIX'],
      ['CAMPO_TEMP_MIN', 'DC_FIELD_TEMPERATURE_MINIMUM'],
      ['CAMPO_TEMP_MAX', 'DC_FIELD_TEMPERATURE_MAXIMUM'],
      ['CAMPO_BOMBOLE_QUANTE', 'DC_FIELD_TANK_COUNT'],
      ['CAMPO_BOMBOLA', 'DC_FIELD_TANK'],
      ['CAMPO_MODALITA', 'DC_FIELD_DIVEMODE'],
    ];
    for (const [nostro, loro] of attesi) {
      const posizione = campi.indexOf(loro);
      expect(posizione, `${loro} non è più in dc_field_type_t`).toBeGreaterThanOrEqual(0);
      expect(costanteRust(nostro), `${nostro} deve valere come ${loro}`).toBe(posizione);
    }
  });

  it('le modalità d’immersione sono tradotte nella parola giusta', () => {
    /*
     * `dc_divemode_t` comincia dall'APNEA, non dal circuito aperto: chi si
     * aspetta l'ordine «oc, ccr, scr» e conta da zero mette ogni immersione
     * nella casella sbagliata. Qui si legge l'ordine vero e si controlla che il
     * `match` del Rust dica quella parola.
     */
    const modalita = valoriEnum('dc_divemode_t');
    const parole: Record<string, string> = {
      DC_DIVEMODE_FREEDIVE: 'freedive',
      DC_DIVEMODE_GAUGE: 'gauge',
      DC_DIVEMODE_OC: 'oc',
      DC_DIVEMODE_CCR: 'ccr',
      DC_DIVEMODE_SCR: 'scr',
    };
    for (const [nome, parola] of Object.entries(parole)) {
      const valore = modalita.indexOf(nome);
      expect(valore, `${nome} non è più in dc_divemode_t`).toBeGreaterThanOrEqual(0);
      expect(
        rust.includes(`${valore} => Some("${parola}")`),
        `${nome} vale ${valore} e deve tradursi in «${parola}»`,
      ).toBe(true);
    }
  });

  it('DC_GASMIX_UNKNOWN è quello che dice l’intestazione', () => {
    // Una bombola senza miscela dichiarata porta questo valore. Sbagliarlo
    // significa leggere `0xFFFFFFFF` come un indice e cercare la miscela numero
    // quattro miliardi.
    expect(intestazione).toMatch(/#define\s+DC_GASMIX_UNKNOWN\s+0xFFFFFFFF/);
    expect(rust).toMatch(/const GASMIX_SCONOSCIUTA: c_uint = 0xFFFF_FFFF;/);
  });

  it('dc_tank_t ha ancora i campi nell’ordine in cui li leggiamo', () => {
    /*
     * `BombolaC` è `#[repr(C)]` e si sovrappone alla memoria che scrive la
     * libreria: un campo aggiunto in mezzo, in una versione futura, sposterebbe
     * tutti quelli dopo. Il sintomo non sarebbe un errore — sarebbe un volume
     * di bombola che vale quanto una pressione.
     */
    const m = intestazione.match(/typedef struct dc_tank_t \{([\s\S]*?)\} dc_tank_t;/);
    expect(m).not.toBeNull();
    const nomi = [...m![1].matchAll(/^\s*[\w ]+\s+(\w+);/gm)].map((x) => x[1]);
    expect(nomi).toEqual([
      'gasmix',
      'type',
      'volume',
      'workpressure',
      'beginpressure',
      'endpressure',
      'usage',
    ]);
  });
});
