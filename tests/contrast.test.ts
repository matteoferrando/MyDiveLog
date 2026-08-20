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
