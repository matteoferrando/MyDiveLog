/**
 * IL SITO NON PUÒ PROMETTERE PIÙ DI QUELLO CHE C'È DENTRO.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► TRE BUGIE MISURATE IL 15 SETTEMBRE 2026. ◄
 *
 *  1. **«356 modelli supportati»** nel riquadro dei numeri della pagina
 *     iniziale. Trecentocinquantasei sono i modelli che libdivecomputer
 *     DESCRIVE; quelli che questa applicazione riesce a scaricare sono
 *     centotredici, perché l'unico trasporto che apriamo è il Bluetooth LE — su
 *     ogni piattaforma, non solo sul telefono. Duecentoquarantatré di quei
 *     modelli non si collegano.
 *
 *  2. **Cinque marche nel nastro della vetrina che nel catalogo non ci sono**:
 *     Atomic Aquatics, Seac, Tusa, Zeagle, Beuchat. Chi le legge e va a cercare
 *     il proprio computer non lo trova.
 *
 *  3. **`aiuto.html` e `en/help.html` portavano i meta dell'informativa sulla
 *     privacy**: chi condivideva il link all'aiuto vedeva comparire l'anteprima
 *     «Informativa sulla privacy», con l'indirizzo della pagina sbagliata.
 *
 * Tutte e tre sono della stessa specie: un numero o un nome scritto a mano in
 * un posto, e la verità che sta in un altro. *Due copie della stessa
 * informazione sono un'informazione e la sua versione vecchia.* Questo file le
 * incolla.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► LA QUARTA, MISURATA IL 23 SETTEMBRE 2026 — E QUESTO FILE LA DIFENDEVA. ◄
 *
 * La correzione della prima aveva messo al posto del 356 la somma
 * `MODELLI_BLE.length + MODELLI_SENZA_BLE.length`, in una variabile chiamata
 * `scaricabili`, e la pagina iniziale la presentava come i modelli «che si
 * scaricano via Bluetooth». Gli otto di `MODELLI_SENZA_BLE` sono i Garmin
 * Descent, e via Bluetooth non si scaricano: è la ragione stessa per cui
 * stanno in quell'elenco. Il 113 del 15 settembre era 105 più otto Garmin; il
 * 123 della libreria nuova era 115 più gli stessi otto. La pagina dei computer
 * scriveva «Solo dal file» accanto a ciascuno, due schermate sotto il numero
 * che li contava fra i Bluetooth, e l'aiuto ripeteva il numero sbagliato.
 *
 * *Una guardia che incolla un numero sbagliato non è una guardia: è il modo in
 * cui l'errore resiste alla correzione successiva.* Adesso il numero dei
 * Bluetooth si conta con `esitoPer` — la funzione che scrive la riga di ogni
 * modello — e la somma vecchia è vietata per nome.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { MODELLI_BLE, MODELLI_SENZA_BLE, RICONOSCIUTE_DA_SOLE } from '../src/core/ble/catalogo';
import { esitoPer } from '../src/core/ble/scelta';
import {
  modelliViaBluetooth,
  // @ts-expect-error — script `.mjs` senza tipi: la direttiva sta sulla riga del modulo, vedi travasoSegnalazioni.test.ts.
} from '../scripts/lib/conta-modelli.mjs';

const leggi = (p: string) => readFileSync(`sito/${p}`, 'utf8');

/** Le marche del catalogo, più quelle riconosciute dal solo nome del dispositivo. */
const MARCHE_VERE = new Set<string>([
  ...MODELLI_BLE.map((m) => m.marca),
  ...MODELLI_SENZA_BLE.map((m) => m.marca),
  ...RICONOSCIUTE_DA_SOLE,
]);

/** Le voci del nastro delle marche di una pagina. */
const marcheDelNastro = (html: string): string[] => {
  const nastro = /<div class="marche-nastro">([\s\S]*?)<\/div>/.exec(html);
  expect(nastro, 'il nastro delle marche deve esistere').toBeTruthy();
  return [...nastro![1]!.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]!.trim());
};

describe('il nastro delle marche dice il vero', () => {
  for (const pagina of ['index.html', 'en/index.html']) {
    it(`${pagina}: ogni marca elencata è nel catalogo`, () => {
      const elencate = [...new Set(marcheDelNastro(leggi(pagina)))];
      const inventate = elencate.filter((m) => !MARCHE_VERE.has(m));
      expect(inventate, `marche che nel catalogo non esistono: ${inventate.join(', ')}`).toEqual([]);
    });

    it(`${pagina}: le due copie del nastro dicono la stessa cosa`, () => {
      // La seconda è `aria-hidden` e serve allo scorrimento continuo: se le due
      // divergono, metà del giro mostra marche diverse dall'altra metà.
      const tutte = marcheDelNastro(leggi(pagina));
      expect(tutte.slice(0, tutte.length / 2)).toEqual(tutte.slice(tutte.length / 2));
    });
  }
});

/**
 * I modelli che si scaricano via Bluetooth, contati come li conta la pagina:
 * con la libreria compilata dentro, come nei pacchetti pubblicati.
 */
const VIA_BLUETOOTH = [...MODELLI_BLE, ...MODELLI_SENZA_BLE].filter((v) =>
  esitoPer(v, true).tipo.startsWith('si-scarica'),
).length;
/** Il numero sbagliato di prima: i Bluetooth più i Garmin, che Bluetooth non sono. */
const CON_I_GARMIN = MODELLI_BLE.length + MODELLI_SENZA_BLE.length;
/** Quanti modelli descrive la libreria, dalla testa del catalogo generato. */
const DESCRITTI = Number(
  /Su (\d+) modelli descritti dalla libreria/.exec(
    readFileSync('src/core/ble/catalogoGenerato.ts', 'utf8'),
  )?.[1],
);
/** Il testo di una pagina, senza marcatori e con gli spazi ridotti a uno. */
const piatto = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

describe('i numeri del sito vengono dal catalogo', () => {
  it('i due conti sono diversi, altrimenti le prove qui sotto non distinguono niente', () => {
    expect(MODELLI_SENZA_BLE.length).toBeGreaterThan(0);
    expect(VIA_BLUETOOTH).toBeLessThan(CON_I_GARMIN);
    expect(DESCRITTI).toBeGreaterThan(VIA_BLUETOOTH);
  });

  it('la pagina iniziale non promette più modelli di quelli che si scaricano', () => {
    for (const pagina of ['index.html', 'en/index.html']) {
      const html = leggi(pagina);
      const numeri = [...html.matchAll(/<b>(\d{2,4})<\/b>/g)].map((m) => Number(m[1]));
      expect(numeri, `${pagina}: il riquadro dei numeri deve citare ${VIA_BLUETOOTH}`).toContain(
        VIA_BLUETOOTH,
      );
      // Né il numero della libreria spacciato per il nostro…
      expect(numeri, `${pagina}: ${DESCRITTI} sono i modelli che libdivecomputer DESCRIVE`).not.toContain(
        DESCRITTI,
      );
      expect(numeri, `${pagina}: 356 sono i modelli che libdivecomputer 0.9.0 descriveva`).not.toContain(356);
      // …né i Garmin contati fra quelli che si scaricano via Bluetooth.
      expect(numeri, `${pagina}: ${CON_I_GARMIN} comprende gli otto Garmin`).not.toContain(CON_I_GARMIN);
    }
  });

  it('la pagina dei computer conta i Bluetooth e i file separatamente', () => {
    /*
     * Questa pagina è GENERATA dal catalogo (`scripts/genera-pagina-computer.ts`),
     * quindi il conto delle marche è quello delle voci del catalogo — senza le
     * tre «riconosciute dal solo nome», che non sono righe dell'elenco.
     */
    const catalogo = [...MODELLI_BLE, ...MODELLI_SENZA_BLE];
    const marche = new Set(catalogo.map((m) => m.marca)).size;
    const dalFile = catalogo.length - VIA_BLUETOOTH;
    const it = leggi('computer-supportati.html');
    expect(it).toContain(`${VIA_BLUETOOTH} via Bluetooth, ${dalFile} dal file, ${marche} marche`);
    expect(it).toContain(`I ${VIA_BLUETOOTH} computer subacquei che MyDiveLog scarica via Bluetooth`);
    expect(it).not.toContain(`I ${CON_I_GARMIN} computer`);
    const en = leggi('en/supported-computers.html');
    expect(en).toContain(`${VIA_BLUETOOTH} over Bluetooth, ${dalFile} from a file, ${marche} brands`);
    expect(en).toContain(`The ${VIA_BLUETOOTH} dive computers MyDiveLog downloads over Bluetooth`);
    expect(en).not.toContain(`The ${CON_I_GARMIN} dive computers`);
    // E le righe «Via Bluetooth» dell'elenco sono tante quante dice il numero.
    expect(it.match(/class="esito esito-bluetooth"/g)?.length).toBe(VIA_BLUETOOTH);
    expect(en.match(/class="esito esito-bluetooth"/g)?.length).toBe(VIA_BLUETOOTH);
  });

  it('l’aiuto dice gli stessi due numeri: quanti ne descrive la libreria, quanti ne scarichiamo', () => {
    // Scritti a mano, e il 23 settembre 2026 dicevano 123: nessuna prova li guardava.
    const it =
      /Dei (\d+) modelli che libdivecomputer descrive, quelli che riusciamo a scaricare sono (\d+),/.exec(
        piatto(leggi('aiuto.html')),
      );
    expect(it, 'aiuto.html: la frase coi due numeri non si trova più').not.toBeNull();
    expect([Number(it![1]), Number(it![2])], 'aiuto.html').toEqual([DESCRITTI, VIA_BLUETOOTH]);
    const en = /Of the (\d+) models libdivecomputer describes, (\d+) are ones we can actually download,/.exec(
      piatto(leggi('en/help.html')),
    );
    expect(en, 'en/help.html: la frase coi due numeri non si trova più').not.toBeNull();
    expect([Number(en![1]), Number(en![2])], 'en/help.html').toEqual([DESCRITTI, VIA_BLUETOOTH]);
  });
});

describe('il banner di Play conta come il sito', () => {
  it('il numero del banner viene dal catalogo, ed è quello del sito', () => {
    // Fino al 23 settembre 2026 il banner diceva «105 modelli via Bluetooth»,
    // scritto a mano: vero con la libreria vecchia, fermo con quella nuova.
    expect(modelliViaBluetooth('.')).toBe(VIA_BLUETOOTH);
    const script = readFileSync('scripts/grafica-play.mjs', 'utf8');
    expect(script).toContain('${modelliViaBluetooth(RADICE)} modelli via Bluetooth');
    expect(script, 'un numero scritto a mano nel banner').not.toMatch(/\d+ modelli via Bluetooth/);
  });
});

describe('ogni pagina parla di sé', () => {
  /*
   * I meta di Open Graph decidono cosa compare quando qualcuno incolla il link
   * in un messaggio. Copiati da una pagina all'altra e non aggiornati, mandano
   * chi legge da un'altra parte — ed è successo su due pagine su dodici.
   */
  const pagine = [
    ...readdirSync('sito').filter((f) => f.endsWith('.html')),
    ...readdirSync('sito/en')
      .filter((f) => f.endsWith('.html'))
      .map((f) => `en/${f}`),
  ];

  it('c’è almeno una pagina da controllare, altrimenti questo file non prova niente', () => {
    expect(pagine.length).toBeGreaterThan(8);
  });

  for (const pagina of pagine) {
    it(`${pagina}: l’indirizzo dichiarato è il suo`, () => {
      const html = leggi(pagina);
      const url = /<meta property="og:url" content="([^"]+)"/.exec(html);
      expect(url, 'og:url deve esserci').toBeTruthy();
      // `index.html` si serve come cartella; le altre come nome senza estensione.
      const atteso = pagina
        .replace(/index\.html$/, '')
        .replace(/\.html$/, '')
        .replace(/^en\/$/, 'en/');
      expect(url![1]).toBe(`https://mydivelog.site/${atteso}`);
    });
  }
});
