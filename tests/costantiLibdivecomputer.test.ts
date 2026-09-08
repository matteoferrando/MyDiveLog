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
let scompattato = '';

/** Un'intestazione qualunque della libreria, dal tarball versionato. */
function leggiIntestazione(nome: string): string {
  return readFileSync(join(scompattato, `include/libdivecomputer/${nome}`), 'utf8');
}

beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'ldc-costanti-'));
  execSync(`tar xzf ${TARBALL} -C ${tmp}`);
  scompattato = join(tmp, `libdivecomputer-${VERSIONE}`);
  intestazione = leggiIntestazione('parser.h');
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

  /*
   * ► LE SEI `ioctl` DEL BLUETOOTH, RICALCOLATE DALLE MACRO VERE. ◄
   *
   * `0x4000_6201` non è un numero: è il risultato di
   * `DC_IOCTL_BASE(dir, type, nr, size)` applicato a `('b', 1, variabile)` in
   * direzione lettura. Scritto a mano è una trascrizione come le altre, e
   * sbagliarne una **non dà nessun errore**: dà una richiesta che il nostro
   * `match` non riconosce, quindi «non supportato», quindi — per il PIN —
   * uno scarico che si ferma dicendo che il PIN non si sa chiedere, con il
   * codice del PIN scritto e funzionante due righe più in là.
   *
   * Sbagliare il BIT DI DIREZIONE è ancora peggio: `GET_ACCESSCODE` e
   * `SET_ACCESSCODE` hanno lo stesso `nr` e differiscono **solo** per quel
   * bit, e scambiarli significa leggere un buffer che andava scritto.
   */
  describe('le sei ioctl del Bluetooth', () => {
    /** `DC_IOCTL_BASE`: `(dir << 30) | (size << 16) | (type << 8) | nr`. */
    function base(dir: number, tipo: string, nr: number, size: number): number {
      // `>>> 0` perché in JavaScript lo scorrimento a sinistra dà un numero con
      // segno: `1 << 30` sta ancora dentro, ma `2 << 30` diventa negativo.
      return ((dir << 30) | (size << 16) | (tipo.charCodeAt(0) << 8) | nr) >>> 0;
    }

    it('le macro sono ancora quelle che crediamo', () => {
      // Se un domani cambiasse la formula, il conto qui sotto sarebbe una
      // finzione che si conferma da sola.
      const ioctl = leggiIntestazione('ioctl.h');
      expect(ioctl).toContain('#define DC_IOCTL_DIR_READ  1u');
      expect(ioctl).toContain('#define DC_IOCTL_DIR_WRITE 2u');
      // La dimensione «variabile» vale zero, ed è il terzo argomento con cui
      // le cinque costanti sono calcolate: darlo per scontato vorrebbe dire
      // che il conto qui sotto si conferma da solo.
      expect(ioctl).toContain('#define DC_IOCTL_SIZE_VARIABLE 0');
      expect(ioctl.replace(/\s+/g, ' ')).toContain(
        '#define DC_IOCTL_BASE(dir,type,nr,size) \\ (((dir) << 30) | \\ ((size) << 16) | \\ ((type) << 8) | \\ ((nr) << 0))',
      );
    });

    it.each([
      ['DC_IOCTL_BLE_GET_NAME', 1, 0],
      ['DC_IOCTL_BLE_GET_PINCODE', 1, 1],
      ['DC_IOCTL_BLE_GET_ACCESSCODE', 1, 2],
      ['DC_IOCTL_BLE_SET_ACCESSCODE', 2, 2],
      ['DC_IOCTL_BLE_CHARACTERISTIC_READ', 1, 3],
    ])('%s vale quello che dice ble.h', (nome, dir, nr) => {
      // Prima si controlla che `ble.h` lo definisca ancora con quel numero e
      // quella direzione: il conto vale solo se i due argomenti sono giusti.
      const ble = leggiIntestazione('ble.h');
      const macro = dir === 1 ? 'DC_IOCTL_IOR' : 'DC_IOCTL_IOW';
      expect(ble.replace(/\s+/g, ' ')).toContain(
        `#define ${nome} ${macro}('b', ${nr}, DC_IOCTL_SIZE_VARIABLE)`,
      );
      const atteso = base(dir, 'b', nr, 0);
      // E adesso il Rust: scritto come `0x4000_6201`, con il trattino basso.
      const esadecimale = atteso.toString(16).padStart(8, '0');
      const conTrattino = `0x${esadecimale.slice(0, 4)}_${esadecimale.slice(4)}`;
      expect(
        rust.includes(`const ${nome}: c_uint = ${conTrattino};`),
        `${nome} deve valere ${conTrattino}`,
      ).toBe(true);
    });

    it('la scrittura di una caratteristica resta fuori, e si dice perché', () => {
      // È la sesta, e non la implementiamo: nessuno dei backend che ci
      // interessano la usa. Sta scritto nel commento della callback, e questa
      // riga esiste perché quel commento resti vero — se un giorno la si
      // implementasse, questa prova diventa rossa e obbliga a riscriverlo.
      expect(rust).not.toContain('DC_IOCTL_BLE_CHARACTERISTIC_WRITE');
      // La frase intera, non una parola qualunque: «Resta fuori» da solo
      // passerebbe per qualsiasi occorrenza in duemila righe di commenti.
      expect(rust).toContain('Resta fuori\n/// la scrittura di una caratteristica');
    });
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
