/**
 * La pagina dei computer supportati dice quello che dice l'applicazione.
 *
 * ► PERCHÉ QUESTA PAGINA È PIÙ PERICOLOSA DELLE ALTRE. ◄ Le altre pagine del
 * sito raccontano il progetto; questa fa una promessa modello per modello. Una
 * cask sbagliata dà «checksum mismatch» e qualcuno se ne accorge; una pagina
 * che promette un computer che non si scarica manda una persona a comprare un
 * apparecchio, o a rinunciare a MyDiveLog dopo averci provato — **e non se ne
 * accorge nessuno**.
 *
 * La pagina è generata da `scripts/genera-pagina-computer.ts`, che importa il
 * catalogo vero e chiama `esitoPer()`, cioè la stessa funzione che scrive quella
 * riga nel selettore dell'app. Queste prove difendono le due cose che il
 * generatore non può garantire da solo: che la pagina **in `sito/` sia stata
 * rigenerata** dopo l'ultima modifica al catalogo, e che il file non sia stato
 * ritoccato a mano.
 *
 * *Un generatore che nessuno rilancia è un file scritto a mano con un passato.*
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MODELLI_SENZA_BLE, marchePerDiffusione } from '../src/core/ble/catalogo';
import { esitoPer } from '../src/core/ble/scelta';
import type { VoceCatalogo } from '../src/core/ble/catalogo';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const PAGINE = [
  { file: 'sito/computer-supportati.html', lingua: 'it' as const },
  { file: 'sito/en/supported-computers.html', lingua: 'en' as const },
];
const leggi = (f: string) => readFileSync(`${RADICE}${f}`, 'utf8');

/** Tutte le voci che la pagina deve nominare: quelle BLE più quelle senza. */
const TUTTE: VoceCatalogo[] = [...marchePerDiffusione().flatMap((m) => [...m.modelli]), ...MODELLI_SENZA_BLE];

describe('la pagina dei computer supportati', () => {
  it.each(PAGINE)('$file nomina tutti i modelli del catalogo, e nessuno in più', ({ file }) => {
    const html = leggi(file);
    const nella = [...html.matchAll(/<span class="computer-nome">([^<]*)<\/span>/g)].map((m) => m[1]);
    // Il confronto è nei due sensi. «Li contiene tutti» lascerebbe passare una
    // pagina con dentro anche un modello inventato, che è il difetto peggiore
    // dei due: un modello mancante lo segnala chi non lo trova, uno di troppo
    // lo scopre chi ci ha creduto.
    expect(nella.length, `${file}: quanti modelli`).toBe(TUTTE.length);
    expect([...nella].sort()).toEqual(TUTTE.map((v) => v.modello).sort());
  });

  it.each(PAGINE)('$file dà a ogni modello l’esito che gli dà l’applicazione', ({ file }) => {
    /*
     * Il confronto vero: per ogni modello, la classe dell'etichetta sulla
     * pagina deve corrispondere a quello che `esitoPer` risponde. Con
     * `conLibdivecomputer = true`, perché è così che sono compilati i pacchetti
     * pubblicati — `default = ["computer-esterni"]` in `Cargo.toml`. Una pagina
     * generata con `false` sarebbe più modesta del vero, che è un errore meno
     * appariscente e non meno errore.
     */
    const html = leggi(file);
    /*
     * ► DUE CLASSI PER QUATTRO ESITI, E NON È UNA SEMPLIFICAZIONE DI COMODO. ◄
     * Decisione del proprietario, 3 settembre 2026: la pagina risponde a
     * «funziona col mio computer?», che ha due risposte. La distinzione fra
     * «provato» e «mai provato su questo modello» resta dov'è utile — nell'app,
     * sotto il nome, nel momento in cui uno sta per collegare l'apparecchio — e
     * `esitoPer` la calcola ancora.
     *
     * La corrispondenza si controlla lo stesso, così se un giorno `esitoPer`
     * imparasse una risposta nuova questa prova diventa rossa invece di far
     * finire quel caso in una delle due caselle per inerzia.
     */
    const classe: Record<string, string> = {
      'si-scarica': 'bluetooth',
      'si-scarica-ldc': 'bluetooth',
      'non-ancora': 'dal-file',
      'mai-via-radio': 'dal-file',
    };
    const righe = [
      ...html.matchAll(/<span class="computer-nome">([^<]*)<\/span>\s*<span class="esito esito-([a-z-]+)">/g),
    ];
    expect(righe.length, `${file}: righe leggibili`).toBe(TUTTE.length);
    const perNome = new Map(righe.map((m) => [m[1], m[2]]));
    for (const voce of TUTTE) {
      const atteso = classe[esitoPer(voce, true).tipo];
      expect(perNome.get(voce.modello), `${file}: ${voce.marca} ${voce.modello}`).toBe(atteso);
    }
  });

  it.each(PAGINE)('$file distingue il Bluetooth dal solo-file', ({ file }) => {
    /*
     * Le due colonne devono essere entrambe popolate. Se un giorno finissero
     * tutti in «via Bluetooth» la pagina sarebbe una bugia perfettamente
     * coerente: nessun conteggio cambierebbe, nessun modello mancherebbe, e la
     * sola distinzione che questa pagina fa sparirebbe in silenzio. Chi ha un
     * Garmin proverebbe col Bluetooth e non capirebbe perché non succede niente.
     */
    const html = leggi(file);
    const conta = (c: string) => html.split(`esito-${c}"`).length - 1;
    expect(conta('bluetooth'), `${file}: nessun modello via Bluetooth`).toBeGreaterThan(0);
    expect(conta('dal-file'), `${file}: nessun modello «solo dal file»`).toBeGreaterThan(0);
  });

  it.each(PAGINE)('$file non parla di driver, di librerie né di prove', ({ file }) => {
    /*
     * `esitoPer` risponde `si-scarica` per tutta la FAMIGLIA di driver, mentre
     * con l'apparecchio in mano sono stati provati due modelli: il Peregrine e
     * l'Aladin Sport Matrix. La prima stesura di questa pagina scriveva
     * «provato con l'apparecchio in mano» accanto a tutti e ventidue, ed era
     * falsa su venti — *sbagliata proprio dalla parte che conviene.*
     *
     * La riga accanto al modello non può più dirlo; la legenda sì, perché lì
     * c'è spazio per dire quali due.
     */
    const html = leggi(file);
    /*
     * Si guarda il CONTENUTO, non tutta la pagina: nel piede c'è il rimando a
     * `libdivecomputer.org`, che è **l'attribuzione LGPL** e deve restare — la
     * licenza chiede che sia visibile, e questo progetto la rispetta. La prima
     * stesura di questa prova cercava in tutto l'HTML ed è diventata rossa
     * proprio su quella riga: *una guardia che si accende su una cosa che deve
     * esserci insegna a spegnerla.*
     */
    const corpo = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
    expect(corpo.length, `${file}: nessun <main>`).toBeGreaterThan(1000);
    expect(corpo, `${file}: parla di driver`).not.toMatch(/\bdriver\b/i);
    expect(corpo, `${file}: parla di prove sui modelli`).not.toMatch(
      /provato con l’apparecchio|tested with the device|mai provato|never tested/i,
    );
    // E nemmeno il nome della libreria: è un livello sotto l'interfaccia, ed è
    // la stessa regola per cui `Btleplug` non esce a schermo nell'applicazione.
    expect(corpo, `${file}: nomina libdivecomputer`).not.toMatch(/libdivecomputer/i);
  });

  it.each(PAGINE)('$file dice che è generata, e da cosa', ({ file }) => {
    // Non è cortesia: è l'istruzione per chi la trova sbagliata. Senza,
    // qualcuno correggerà l'HTML a mano e la correzione sparirà alla
    // rigenerazione successiva — che è il modo in cui un file generato
    // insegna a non fidarsi dei generatori.
    const html = leggi(file);
    expect(html).toMatch(/generata dal catalogo|generated from the app/i);
  });

  it('Garmin è dov’è la sua diffusione, non in fondo', () => {
    /*
     * Garmin è la quarta marca al mondo e in libdivecomputer non compare: chi
     * la cerca la cerca fra le prime, e trovarla in fondo all'elenco insieme
     * alle marche che nessuno ha somiglia troppo a «non c'è». Il difetto
     * gemello — la risposta su Garmin irraggiungibile nella ricerca dell'app —
     * è già registrato nel commento di `MODELLI_SENZA_BLE`.
     */
    const html = leggi('sito/computer-supportati.html');
    const ordine = [...html.matchAll(/data-marca="([^"]*)"/g)].map((m) => m[1]);
    const dove = ordine.indexOf('garmin');
    expect(dove, 'Garmin non è nella pagina').toBeGreaterThan(-1);
    expect(dove, 'Garmin è finita in fondo').toBeLessThan(5);
  });

  it('la ricerca funziona anche senza JavaScript, mostrando tutto', () => {
    // Il campo di ricerca è comodo; l'elenco è necessario. Senza JavaScript
    // nessuna voce deve essere nascosta all'inizio, o la pagina sarebbe vuota
    // proprio per chi ha meno strumenti.
    for (const { file } of PAGINE) {
      const html = leggi(file);
      const nascoste = [...html.matchAll(/<li class="computer"[^>]*\bhidden\b/g)];
      expect(nascoste.length, `${file}: voci nascoste nel markup`).toBe(0);
    }
  });
});
