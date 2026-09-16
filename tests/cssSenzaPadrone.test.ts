/**
 * UNA REGOLA SENZA PADRONE RACCONTA UN'APPLICAZIONE CHE NON C'È.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ, dal 16 settembre 2026. ◄ Nel foglio di stile c'erano `.streaming`,
 * `@keyframes blink` e `.ai-meta`: vestivano una risposta che arrivava un pezzo
 * per volta e la riga di dati sotto — roba di un assistente che dall'app è
 * stato tolto. Nessuno se n'era accorto perché il CSS morto non fa niente di
 * male: non rallenta niente di misurabile, non rompe niente.
 *
 * Il danno è a chi legge. Un foglio di stile è anche una descrizione
 * dell'interfaccia, e una classe che nessuno usa dice che da qualche parte
 * esiste una cosa che non esiste. Peggio: il giorno in cui qualcuno scrive
 * `className="streaming"` per un motivo suo, si ritrova addosso un cursore
 * lampeggiante che nessuno ha progettato per quel posto — cioè un difetto che
 * arriva dal passato e che non si spiega leggendo il componente.
 *
 * ► COME CERCA. ◄ Prende i nomi di classe dal foglio e li cerca in tutto ciò
 * che potrebbe nominarli: sorgenti TypeScript, `index.html`, e gli script di
 * misura, che pilotano l'interfaccia per selettore e quindi sono padroni a
 * tutti gli effetti. La ricerca è sul testo, non sugli attributi `className`:
 * una classe composta a pezzi (`dot-${livello}`) verrebbe segnalata, ed è il
 * momento giusto per metterla in `COMPOSTE_A_MANO` con scritto chi la compone.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Le classi che nessun sorgente nomina per intero perché vengono COMPOSTE.
 *
 * Non è un permesso a lasciare regole morte: è l'elenco di quelle il cui
 * padrone esiste ma si chiama in un altro modo. Ogni voce dice dove.
 */
const COMPOSTE_A_MANO: Record<string, string> = {};

function file(radice: string, estensioni: string[]): string[] {
  let trovati: string[] = [];
  let voci: string[] = [];
  try {
    voci = readdirSync(radice);
  } catch {
    return [];
  }
  for (const voce of voci) {
    if (voce === 'node_modules' || voce.startsWith('.')) continue;
    const percorso = join(radice, voce);
    if (statSync(percorso).isDirectory()) trovati = trovati.concat(file(percorso, estensioni));
    else if (estensioni.some((e) => voce.endsWith(e))) trovati.push(percorso);
  }
  return trovati;
}

describe('il foglio di stile non veste nessuno che non esista', () => {
  it('ogni classe del CSS è nominata da qualche parte', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const classi = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

    const pezzi = [...file('src', ['.ts', '.tsx', '.html']), ...file('scripts', ['.mjs']), 'index.html'].map(
      (p) => {
        try {
          return readFileSync(p, 'utf8');
        } catch {
          return '';
        }
      },
    );
    const testo = pezzi.join('\n');

    // Una guardia che non guarda niente è verde per sempre.
    expect(classi.size, 'nessuna classe letta: il foglio non è stato trovato').toBeGreaterThan(50);
    expect(testo.length, 'nessun sorgente letto: il giro delle cartelle è rotto').toBeGreaterThan(100000);

    const senzaPadrone = [...classi].filter((c) => !testo.includes(c) && !(c in COMPOSTE_A_MANO)).sort();
    expect(
      senzaPadrone,
      'classi che il CSS veste e che nessuno indossa: toglile, o spiega in COMPOSTE_A_MANO chi le compone',
    ).toEqual([]);
  });
});
