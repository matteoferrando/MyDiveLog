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
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { MODELLI_BLE, MODELLI_SENZA_BLE, RICONOSCIUTE_DA_SOLE } from '../src/core/ble/catalogo';

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

describe('i numeri del sito vengono dal catalogo', () => {
  it('la pagina iniziale non promette più modelli di quelli che si scaricano', () => {
    const scaricabili = MODELLI_BLE.length + MODELLI_SENZA_BLE.length;
    for (const pagina of ['index.html', 'en/index.html']) {
      const html = leggi(pagina);
      const numeri = [...html.matchAll(/<b>(\d{2,4})<\/b>/g)].map((m) => Number(m[1]));
      expect(numeri, `${pagina}: il riquadro dei numeri deve citare ${scaricabili}`).toContain(scaricabili);
      // E non deve più esserci il numero della libreria spacciato per il nostro.
      expect(numeri, `${pagina}: 356 sono i modelli che libdivecomputer DESCRIVE`).not.toContain(356);
    }
  });

  it('la pagina dei computer conta quello che il catalogo contiene', () => {
    /*
     * Questa pagina è GENERATA dal catalogo (`scripts/genera-pagina-computer.ts`),
     * quindi il conto delle marche è quello delle voci del catalogo — senza le
     * tre «riconosciute dal solo nome», che non sono righe dell'elenco.
     */
    const catalogo = [...MODELLI_BLE, ...MODELLI_SENZA_BLE];
    const marche = new Set(catalogo.map((m) => m.marca)).size;
    const html = leggi('computer-supportati.html');
    expect(html).toContain(`${catalogo.length} modelli`);
    expect(html).toContain(`${marche} marche`);
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
