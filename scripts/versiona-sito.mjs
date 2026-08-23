/**
 * Mette l'impronta del foglio di stile nell'indirizzo con cui le pagine lo
 * chiedono: `stile.css?v=a1b2c3d4`.
 *
 * ► PERCHÉ ESISTE, e non è una raffinatezza. ◄ Cloudflare serve `stile.css` con
 * quattro ore di cache. Chi ha visitato il sito prima di una modifica continua
 * a usare il foglio VECCHIO su un HTML NUOVO — e il risultato non è «il sito di
 * ieri», è un ibrido rotto: il 23 agosto 2026 la pagina rifatta è comparsa con
 * i testi centrati, il corsivo dove non doveva esserci e un rettangolo NERO al
 * posto del grafico (una `path` senza `fill: none` la si riempie di nero, ed è
 * quello che succede quando le regole non arrivano).
 *
 * Il rimedio è vecchio quanto il web: se cambia il contenuto, cambia
 * l'indirizzo. Con l'impronta in coda il browser non ha niente in cache per
 * quell'indirizzo e lo scarica, senza che nessuno debba svuotare niente.
 *
 * SI LANCIA DOPO OGNI MODIFICA AL CSS, e non è affidato alla memoria: un test
 * (`tests/sito.test.ts`) ricalcola l'impronta e pretende che le pagine la
 * portino. Se qualcuno cambia il foglio e dimentica questo passaggio, la CI
 * diventa rossa invece di lasciare in giro un sito che si rompe solo per chi
 * c'era già stato — che è il difetto più insidioso di tutti, perché chi lo
 * pubblica non lo vede mai.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITO = 'sito';

/** Le prime otto cifre bastano: qui non ci si difende da nessuno, si distingue. */
export function improntaStile(contenuto) {
  return createHash('sha256').update(contenuto).digest('hex').slice(0, 8);
}

function pagine(dir, dentro = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) pagine(p, dentro);
    else if (nome.endsWith('.html')) dentro.push(p);
  }
  return dentro;
}

const impronta = improntaStile(readFileSync(join(SITO, 'stile.css')));
let toccate = 0;

for (const pagina of pagine(SITO)) {
  const prima = readFileSync(pagina, 'utf8');
  // Vale sia per `stile.css` sia per `../stile.css` della cartella inglese, e
  // sostituisce anche un'impronta vecchia già presente.
  const dopo = prima.replace(/href="((?:\.\.\/)?stile\.css)(?:\?v=[0-9a-f]+)?"/g, `href="$1?v=${impronta}"`);
  if (dopo !== prima) {
    writeFileSync(pagina, dopo);
    toccate++;
  }
}

console.log(`impronta ${impronta} — pagine aggiornate: ${toccate}`);
