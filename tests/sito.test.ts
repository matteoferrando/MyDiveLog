/**
 * Il sito, per la parte che si può verificare senza un browser.
 *
 * Una prova sola, e nasce da un guasto vero: Cloudflare serve `stile.css` con
 * quattro ore di cache, quindi chi era già stato sul sito continua a usare il
 * foglio VECCHIO su un HTML NUOVO. Non si vede «il sito di ieri»: si vede un
 * ibrido rotto — testi centrati, corsivi fuori posto, un rettangolo nero al
 * posto del grafico. E chi pubblica non lo vede MAI, perché il suo browser ha
 * appena scaricato tutto.
 *
 * La difesa è l'impronta del foglio nell'indirizzo, che `npm run sito:versiona`
 * scrive nelle pagine. Questo test la ricalcola e pretende di ritrovarla: se
 * qualcuno cambia il CSS e dimentica quel passaggio, la CI diventa rossa
 * invece di lasciare in giro un sito che si rompe solo per chi ci era già
 * stato.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SITO = fileURLToPath(new URL('../sito', import.meta.url));

function pagine(dir: string, dentro: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) pagine(p, dentro);
    else if (nome.endsWith('.html')) dentro.push(p);
  }
  return dentro;
}

describe('il sito', () => {
  it('non dice «dal Mac» quando intende «dal computer»', () => {
    /*
     * ► LA STESSA CORREZIONE, CHIESTA UNA VOLTA E APPLICATA A METÀ. ◄
     *
     * Il 31 agosto 2026 il proprietario aveva chiesto di sostituire «dal Mac e
     * anche dall'iPhone» con «dal computer o anche dal telefono»: da quando le
     * piattaforme sono cinque, nominare il Mac dove si intende «un computer
     * qualunque» taglia fuori Windows e Linux nella frase stessa che dovrebbe
     * includerli. La correzione è stata fatta sulla home, e **le due pagine
     * sulla legge sono rimaste indietro** — se n'è accorto lui, il 3 settembre,
     * rileggendo la pagina dei computer.
     *
     * *Una correzione testuale applicata a mano su un sito di dodici pagine è
     * una correzione applicata dove qualcuno si è ricordato di guardare.*
     *
     * Questa prova cerca le forme in cui «Mac» sta per «computer», e non le
     * altre: «Mac App Store», «Mac Apple Silicon», «Mac Intel» e `macOS`
     * nominano il Mac perché parlano proprio del Mac, e devono restare.
     */
    const sbagliate = [/\bdal Mac (e|o)\b/, /\bfrom the Mac (and|or)\b/, /\bsul Mac (e|o) sul\b/];
    const guasti: string[] = [];
    for (const pagina of pagine(SITO)) {
      const html = readFileSync(pagina, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      for (const forma of sbagliate) {
        const trovata = forma.exec(html);
        if (trovata) guasti.push(`${pagina}: «${trovata[0]}»`);
      }
    }
    expect(guasti, 'qui «Mac» sta per «computer»: Windows e Linux restano fuori dalla frase').toEqual([]);
  });

  it('ogni pagina chiede il foglio di stile con la sua impronta', () => {
    const impronta = createHash('sha256')
      .update(readFileSync(join(SITO, 'stile.css')))
      .digest('hex')
      .slice(0, 8);

    const file = pagine(SITO);
    expect(file.length).toBeGreaterThan(0);

    for (const pagina of file) {
      const html = readFileSync(pagina, 'utf8');
      const richiami = [...html.matchAll(/href="((?:\.\.\/)?stile\.css)(\?v=[0-9a-f]+)?"/g)];
      expect(richiami.length, pagina).toBe(1);
      expect(richiami[0][2], `${pagina}: lancia \`npm run sito:versiona\``).toBe(`?v=${impronta}`);
    }
  });
});
