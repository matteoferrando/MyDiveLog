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
