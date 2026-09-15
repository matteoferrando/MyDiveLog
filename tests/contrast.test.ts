/**
 * Contrasto della tavolozza.
 *
 * I colori sono scritti a mano in `styles.css` e nessuno se ne accorge quando
 * uno smette di essere leggibile: il grigio dei testi secondari stava a 3.5:1
 * sul chiaro e il rosso degli errori a 3.3:1 sullo scuro, cioè esattamente le
 * righe che segnalano un problema erano le meno visibili. Questo test legge il
 * foglio di stile e verifica i rapporti di WCAG 2.1 AA: 4.5:1 per il testo,
 * 3:1 per gli indicatori grafici (i pallini di stato, le linee di riferimento).
 *
 * Non sostituisce il giudizio visivo — dice solo che nessuno può abbassare un
 * colore sotto la soglia senza che un test lo dica.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const parts = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = parts.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * I valori di un blocco `{ … }` del foglio di stile. Il tema chiaro è il primo
 * blocco `:root`, quello scuro il blocco `:root[data-theme='dark']`: leggerli
 * dal file invece di ricopiarli qui è l'unico modo perché il test resti vero
 * quando la tavolozza cambia.
 */
function palette(startsWith: string): Record<string, string> {
  const from = css.indexOf(startsWith);
  expect(from, `blocco ${startsWith} non trovato`).toBeGreaterThan(-1);
  const block = css.slice(from, css.indexOf('\n}', from));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

const LIGHT = palette(':root {');
const DARK_OVERRIDES = palette(":root[data-theme='dark'] {");
// Il tema scuro RIDEFINISCE solo quello che cambia: tutto il resto lo eredita
// dal blocco chiaro per cascata, e il test deve guardare il colore che l'utente
// vede davvero, non solo quello riscritto.
const DARK = { ...LIGHT, ...DARK_OVERRIDES };

/** Le superfici su cui il testo può cadere: la scheda, la pagina e le righe alternate. */
const SURFACES = ['--surface-1', '--surface-2', '--surface-3'] as const;

describe('contrasto della tavolozza', () => {
  for (const [nome, tema] of [
    ['chiaro', LIGHT],
    ['scuro', DARK],
  ] as const) {
    describe(`tema ${nome}`, () => {
      it('ha tutti i colori attesi', () => {
        for (const key of [
          ...SURFACES,
          '--text-primary',
          '--text-secondary',
          '--text-muted',
          '--critical',
          '--warning',
          '--serious',
          '--good',
        ]) {
          expect(tema[key], `${key} mancante nel tema ${nome}`).toBeDefined();
        }
      });

      it.each([
        '--text-primary',
        '--text-secondary',
        '--text-muted',
        '--critical',
        '--good-text',
        '--warning-text',
      ])('%s è leggibile su tutte le superfici (4.5:1)', (token) => {
        for (const bg of SURFACES) {
          const ratio = contrast(tema[token], tema[bg]);
          expect(
            ratio,
            `${token} ${tema[token]} su ${bg} ${tema[bg]} = ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });

      /*
       * `--warning-text` sta con i colori di TESTO, non con gli indicatori.
       *
       * `--warning` è validato a 3:1 perché è un pallino, ma veniva usato come
       * colore di testo in sei punti — misurato in pagina: 3.62:1 su 13 px. Ora
       * chi deve leggere usa il gemello, e il gemello è qui sotto la soglia del
       * testo insieme agli altri.
       */
      it.each(['--good', '--warning', '--serious', '--critical'])(
        '%s si distingue come indicatore grafico (3:1)',
        (token) => {
          for (const bg of SURFACES) {
            const ratio = contrast(tema[token], tema[bg]);
            expect(
              ratio,
              `${token} ${tema[token]} su ${bg} ${tema[bg]} = ${ratio.toFixed(2)}:1`,
            ).toBeGreaterThanOrEqual(3);
          }
        },
      );

      it('--good-text è testo, quindi va oltre 4.5:1', () => {
        for (const bg of SURFACES) {
          expect(contrast(tema['--good-text'], tema[bg])).toBeGreaterThanOrEqual(4.5);
        }
      });
    });
  }

  it('il blocco `prefers-color-scheme: dark` dice le stesse cose di `data-theme=dark`', () => {
    // Due blocchi che devono restare allineati a mano: se divergono, il tema
    // automatico e quello scelto dall'utente mostrano colori diversi.
    const auto = palette("  :root:where(:not([data-theme='light'])) {");
    for (const key of Object.keys(DARK_OVERRIDES)) {
      expect(auto[key], `${key} diverge fra i due blocchi scuri`).toBe(DARK_OVERRIDES[key]);
    }
  });
});

/**
 * L'ORDINE DELLE REGOLE, che è la cosa che questo foglio di stile sbaglia sempre.
 *
 * Una media query non aggiunge specificità: `@media … { .nav { display: none } }`
 * e `.nav { display: flex }` pesano identico, e vince l'ultima scritta nel file.
 * È già costato due volte — il corpo dei pulsanti della navigazione, e poi la
 * striscia che restava visibile sul telefono accanto al menu — e in entrambi i
 * casi il sintomo era «la regola non fa niente», che nessuno screenshot
 * distingue da «la regola non c'è».
 *
 * Il test non giudica il layout: verifica solo che chi spegne qualcosa sul
 * telefono lo faccia DOPO chi lo accende. È l'unica proprietà che un file di
 * testo può garantire da solo.
 */
describe('ordine delle regole per il telefono', () => {
  /** Posizione dell'ultima occorrenza di una dichiarazione dentro una regola. */
  const dove = (regola: string, dichiarazione: string): number => {
    let ultimo = -1;
    let da = 0;
    for (;;) {
      const i = css.indexOf(regola, da);
      if (i < 0) break;
      const fine = css.indexOf('}', i);
      if (fine > 0 && css.slice(i, fine).includes(dichiarazione)) ultimo = i;
      da = i + regola.length;
    }
    return ultimo;
  };

  it('la striscia si spegne dopo essersi accesa', () => {
    const accesa = dove('.nav {', 'display: flex');
    const spenta = dove('.nav {', 'display: none');
    expect(accesa, 'la regola che accende la striscia non c’è più').toBeGreaterThan(-1);
    expect(spenta, 'la regola che la spegne sul telefono non c’è più').toBeGreaterThan(-1);
    expect(spenta).toBeGreaterThan(accesa);
  });

  /*
   * ► LE TRE COSE DEL TELEFONO SI SPENGONO INSIEME, IN UNA REGOLA SOLA. ◄
   *
   * `.barra-basso`, `.foglio-fondo` e `.foglio-altro` condividono lo stesso
   * `display: none` di partenza: è scritto così apposta, perché tre regole
   * separate sono tre occasioni di dimenticarne una — e quella dimenticata
   * lascerebbe un pannello del telefono piantato in mezzo alla finestra del
   * Mac. Il selettore comune si cerca per intero, con le tre voci nell'ordine
   * in cui stanno nel file.
   */
  it('la barra in basso e il foglio partono spenti, in una regola sola', () => {
    const spegne = css.indexOf('.barra-basso,\n.foglio-fondo,\n.foglio-altro {');
    expect(spegne, 'le tre cose del telefono non si spengono più insieme').toBeGreaterThan(-1);
    expect(css.slice(spegne, css.indexOf('}', spegne))).toContain('display: none');
  });

  /*
   * ► IL VALORE CHE ACCENDE VA SCRITTO PER ESTESO, e la prima stesura di questa
   *   prova non lo faceva. ◄
   *
   * Cercava `display: ` — il nome della proprietà e basta — e `.foglio-altro {`
   * è una sottostringa del selettore raggruppato qui sopra, che di `display:`
   * ne contiene uno: `none`. Misurato togliendo `display: block` dalla media
   * query, **la prova restava verde**, perché trovava lo SPEGNIMENTO e lo
   * scambiava per l'accensione. Una prova che confonde l'una con l'altro
   * verifica soltanto che la parola «display» compaia da qualche parte.
   *
   * Cercando il valore giusto — `flex` per la barra, `block` per i due pezzi
   * del foglio — quella sottostringa non può più rispondere al posto suo.
   */
  it.each([
    ['.barra-basso {', 'display: flex'],
    ['.foglio-fondo {', 'display: block'],
    ['.foglio-altro {', 'display: block'],
  ])('%s si accende dopo essere stato spento, e solo sotto i 700 px', (regola, accende) => {
    const spento = css.indexOf('.barra-basso,\n.foglio-fondo,\n.foglio-altro {');
    const acceso = dove(regola, accende);
    expect(acceso, `la regola che accende ${regola} non c’è più`).toBeGreaterThan(-1);
    expect(acceso).toBeGreaterThan(spento);
    // La regola che lo accende deve stare dentro una media query per telefono:
    // si guarda l'ultima `@media` aperta prima di quel punto.
    const media = css.lastIndexOf('@media', acceso);
    expect(css.slice(media, media + 40)).toContain('max-width: 700px');
  });
});

/**
 * LA TESTA DEL LOGBOOK CHE RESTA FERMA, e le tre cose che la rompono in silenzio.
 *
 * `position: sticky` è la dichiarazione che «non fa niente» più facilmente di
 * ogni altra, e in tutti e tre i modi il sintomo è lo stesso: la pagina si
 * vede, solo che scorre tutta. Nessuno screenshot distingue «non si blocca» da
 * «non doveva bloccarsi».
 */
describe('la testa del logbook resta ferma', () => {
  /*
   * ► IL SELETTORE SI CERCA A INIZIO RIGA, e la prima stesura no. ◄
   *
   * `css.indexOf('.main {')` trovava la prima occorrenza, che è **dentro la
   * media query del telefono** (`  .main { padding-bottom: 20px }`): la prova
   * leggeva quel corpo di due righe e concludeva che `.main` non ha padding —
   * una prova rossa su un file corretto. L'a capo davanti àncora la regola di
   * primo livello, che è quella di cui si parla qui.
   */
  const regola = (selettore: string): string => {
    const i = css.indexOf('\n' + selettore);
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
  };

  it('è `sticky` e dichiara il suo `top`', () => {
    const testa = regola('.logbook-testa {');
    expect(testa, 'la regola non c’è più').not.toBe('');
    expect(testa).toContain('position: sticky');
    // Senza `top`, `sticky` si comporta come `static`: la regola c'è e non fa
    // niente. È il primo dei tre modi.
    expect(testa, '`sticky` senza `top` non blocca niente').toMatch(/\btop:/);
  });

  it('ha uno sfondo, o l’elenco le passa attraverso', () => {
    // Il secondo modo: la testa resta ferma ma è trasparente, e si legge una
    // data del 2019 sovrapposta alla parola «Logbook».
    expect(regola('.logbook-testa {')).toContain('background:');
  });

  /*
   * ► IL TERZO MODO, ed è quello che è successo davvero. ◄
   *
   * Il rettangolo a cui `sticky` si aggancia è quello del contenitore che
   * scorre **ridotto del suo padding**. Con `padding-top: 20px` su `.main`, la
   * testa si fermava venti pixel più in basso e in quella striscia il contenuto
   * continuava a scorrere visibile: si vedeva passare il bordo di una carta
   * sopra il titolo. Misurato: `top` della testa a 20 px dal bordo di `.main`,
   * con lo scorrimento a 1400.
   *
   * La cura è stata spostare quei venti pixel su `.page`. Queste due righe
   * tengono insieme la coppia: chi li rimettesse su `.main` — la cosa più
   * naturale del mondo — rifarebbe il difetto senza vedere niente di rotto.
   */
  it('`.main` non ha padding in alto, e `.page` sì', () => {
    expect(regola('.main {'), '`.main` ha di nuovo un padding in alto: la testa si blocca più giù').toMatch(
      /padding:\s*0 /,
    );
    expect(regola('.page {'), 'i venti pixel non sono su `.page`').toMatch(/padding-top:\s*20px/);
  });
});

describe('bersagli e ritagli dello schermo', () => {
  /*
   * Due proprietà che si possono verificare solo leggendo il file, e che sono
   * già state violate: l'ordine delle regole (quattro volte) e le variabili
   * della safe area (esistevano solo per due lati su quattro).
   */
  it('le caselle piccole del pianificatore valgono solo dove c’è un mouse', () => {
    /*
     * `.planner-check input { width: 16px }` stava DOPO il blocco
     * `@media (pointer: coarse)` che le porta a 24×24, con la stessa
     * specificità: vinceva, e ogni casella dell'app tornava a 16 px proprio sul
     * telefono. Ora la regola è dentro una condizione esplicita, che è
     * verificabile invece che dipendere dalla posizione nel file.
     */
    const i = css.indexOf('.planner-check input {\n    width: 16px');
    expect(i, 'la regola a 16 px non è più dove ci si aspetta').toBeGreaterThan(-1);
    const media = css.lastIndexOf('@media', i);
    expect(css.slice(media, media + 60)).toContain('pointer: fine');
  });

  it('la safe area è dichiarata per tutti e quattro i lati', () => {
    for (const lato of ['top', 'bottom', 'left', 'right']) {
      expect(css, `manca --safe-${lato}`).toContain(`--safe-${lato}: env(safe-area-inset-${lato}`);
    }
    // E i due lati nuovi devono essere USATI, non solo dichiarati: in verticale
    // valgono zero, quindi una variabile inerte non la noterebbe nessuno finché
    // qualcuno non gira il telefono.
    expect(css).toContain('var(--safe-left)');
    expect(css).toContain('var(--safe-right)');
  });

  it('il margine per i semafori di macOS è condizionato al guscio desktop', () => {
    const i = css.indexOf('padding-left: 88px');
    expect(i).toBeGreaterThan(-1);
    // Deve stare dentro un selettore che nomina il guscio: su iPhone in
    // orizzontale le regole del telefono non valgono, e incondizionato lasciava
    // 88 px di vuoto sul bordo sinistro.
    expect(css.slice(Math.max(0, i - 200), i)).toContain("data-guscio='desktop'");
  });
});
