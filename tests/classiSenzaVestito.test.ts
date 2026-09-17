/**
 * UNA CLASSE CHE NON VESTE NIENTE È UNA PROMESSA CHE IL FOGLIO NON MANTIENE.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ► È IL SPECCHIO DI `cssSenzaPadrone`. ◄ Quella prova cerca regole che non
 * vestono nessuno; questa cerca il contrario, ed è il difetto più subdolo dei
 * due: il CSS morto non fa niente, una classe inventata FA QUALCOSA — fa
 * credere a chi legge il componente che quel pezzo sia stato disegnato.
 *
 * ► COSA HA TROVATO IL 17 SETTEMBRE 2026, la prima volta che è girata. ◄
 *
 *  - `linklike`, due volte in `Compare.tsx`, sui due pulsanti che aprono le
 *    immersioni confrontate. Il nome dice tutto: dovevano sembrare
 *    collegamenti. Nel foglio non c’era niente con quel nome, e quindi erano
 *    due pulsanti grigi con la cornice, alti 35,5 px, dentro l’intestazione di
 *    una tabella. Il componente giusto esisteva già e si chiama `.cell-link`:
 *    lo stesso identico gesto, nel logbook, disegnato come si deve.
 *  - `btn-small`, tre volte, su «Togli questa bombola», «＋Aggiungi una
 *    bombola» e «＋metti in attrezzatura». Tre pulsanti che qualcuno voleva
 *    piccoli e che uscivano della misura piena, perché `.btn` c’era e
 *    `.btn-small` no. Sono diventati `.pastiglia`, che è quel pulsante lì.
 *
 * Nessuno dei cinque rompeva niente. Si vedevano solo guardando, e guardare
 * cinque punti in nove schede non è un metodo: contare lo è.
 *
 * ► PERCHÉ IL GANCIO DI UNA PROVA NON È UN DIFETTO. ◄ `voce-altro` e
 * `proposte-dal-nome` non hanno nessuna regola e vanno benissimo: servono a
 * `naviga.mjs` e a `riconosciutoDalNome.test.tsx` per mettere le mani su un
 * pezzo di pagina. La differenza non è nel nome, è nel fatto che QUALCUNO le
 * nomina — e quel qualcuno si cerca, non si elenca a mano: un elenco di nomi
 * permessi invecchia da solo, e il giorno in cui la prova che usava il gancio
 * viene cancellata, l’elenco continua a dire che il gancio serve.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * I nomi di classe scritti PER INTERO nel markup.
 *
 * Solo quelli letterali: `className="card"`, i pezzi fissi di un template, e
 * `className={'x'}`. Quello che si compone a pezzi — `dot-${livello}` — resta
 * fuori di proposito: di un nome costruito a metà non si può dire niente
 * leggendo il sorgente, e una prova che indovina dà allarmi finti finché
 * qualcuno la spegne.
 */
function classiNelMarkup(sorgente: string): Set<string> {
  const fuori = new Set<string>();
  const metti = (grezzo: string) => {
    for (const c of grezzo.split(/\s+/)) if (/^[a-zA-Z][\w-]*$/.test(c)) fuori.add(c);
  };
  for (const m of sorgente.matchAll(/className="([^"]*)"/g)) metti(m[1]);
  for (const m of sorgente.matchAll(/className=\{'([^']*)'\}/g)) metti(m[1]);
  for (const m of sorgente.matchAll(/className=\{`([^`]*)`\}/g)) {
    for (const pezzo of m[1].split(/\$\{[^}]*\}/)) metti(pezzo);
  }
  return fuori;
}

describe('ogni classe del markup ha un vestito o un padrone', () => {
  it('nessun componente indossa un nome che non esiste', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const vestite = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

    // Chi altro può dare un senso a una classe: una prova o uno script di misura
    // che la usa come selettore per mettere le mani su un pezzo di pagina.
    const ganci = [...file('tests', ['.ts', '.tsx']), ...file('scripts', ['.mjs'])]
      .map((p) => readFileSync(p, 'utf8'))
      .join('\n');

    const indossate = new Map<string, string[]>();
    for (const p of file('src', ['.tsx'])) {
      for (const c of classiNelMarkup(readFileSync(p, 'utf8'))) {
        indossate.set(c, [...(indossate.get(c) ?? []), p]);
      }
    }

    // Una guardia che non guarda niente è verde per sempre.
    expect(vestite.size, 'nessuna classe letta dal foglio').toBeGreaterThan(50);
    expect(indossate.size, 'nessuna classe letta dal markup').toBeGreaterThan(50);
    expect(ganci.length, 'nessuna prova né script letti: il giro delle cartelle è rotto').toBeGreaterThan(
      10000,
    );

    const nude = [...indossate.entries()]
      .filter(([c]) => !vestite.has(c))
      // Un gancio è tale se qualcuno lo usa DAVVERO come selettore: `.nome`.
      .filter(([c]) => !ganci.includes(`.${c}`))
      .map(([c, dove]) => `${c} (${[...new Set(dove)].join(', ')})`)
      .sort();

    expect(
      nude,
      'classi indossate che nessuna regola veste e che nessuna prova usa come gancio: o le disegni, o usi la classe che esiste già',
    ).toEqual([]);
  });
});
