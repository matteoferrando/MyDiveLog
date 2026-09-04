/**
 * Confronta il sito PUBBLICATO con quello sul disco, pagina per pagina.
 *
 *   npm run sito:online
 *
 * ► PERCHÉ NON BASTA UN 200. ◄ Il 1° settembre 2026 il documento di stato ha
 * scritto, come cosa misurata, che la pagina di aiuto era online: «`/aiuto`
 * risponde 200». Non lo era, e non lo è stata per due giorni. **Cloudflare
 * Pages, quando una pagina non esiste, serve la home con codice 200** — è il
 * comportamento previsto per i siti a pagina singola, e questo sito non ha un
 * `404.html` che lo spenga. Quindi `curl -o /dev/null -w '%{http_code}'` su
 * `/aiuto`, `/aiuto.html`, `/en/help` e su `/qualunque-cosa` risponde 200 a
 * tutti, e un 200 lì non dice «la pagina c'è»: dice «il server ha risposto».
 *
 * L'ha scoperto il proprietario aprendo il sito e non trovando la voce nel
 * menu — cioè nel modo in cui questo progetto scopre sempre i guasti di questa
 * specie: guardando la cosa consegnata, non l'esito di un comando. *Un esito
 * zero dice che il comando non è morto, non che abbia fatto quello che doveva.*
 *
 * ► COSA SI CONFRONTA. ◄ Il `<title>`: è unico per pagina, è la prima cosa che
 * cambia quando la pagina è un'altra, e non cambia fra un ritocco e l'altro
 * della stessa pagina. Se il titolo servito è quello della home per una pagina
 * che non è la home, la pagina non c'è. Più l'impronta del foglio di stile
 * nella home, che è la stessa che serve a far scadere la cache — e che risponde
 * gratis alla domanda «cosa c'è pubblicato», come già scritto nel documento.
 *
 * Non dice se il CONTENUTO è aggiornato: due versioni della stessa pagina con lo
 * stesso titolo passano uguali. È una guardia piccola e dichiarata: coglie la
 * pagina che manca e il foglio di stile vecchio, che sono i due modi in cui
 * questo sito è stato indietro finora.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITO = fileURLToPath(new URL('../sito', import.meta.url));
const BASE = 'https://mydivelog.site';

// Le stesse dieci pagine di controlla-sito.mjs, con lo stesso indirizzo corto.
const PAGINE = [
  'index.html',
  'privacy.html',
  'termini.html',
  'libretto-immersioni.html',
  'computer-supportati.html',
  'aiuto.html',
  'en/index.html',
  'en/privacy.html',
  'en/terms.html',
  'en/dive-logbook-law.html',
  'en/supported-computers.html',
  'en/help.html',
];
const indirizzo = (p) =>
  p === 'index.html' ? '/' : p === 'en/index.html' ? '/en/' : '/' + p.replace(/\.html$/, '');

const titolo = (html) => /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim();
const impronta = (html) => /stile\.css\?v=([0-9a-f]+)/.exec(html)?.[1];

let guasti = 0;
for (const pagina of PAGINE) {
  const locale = readFileSync(join(SITO, pagina), 'utf8');
  // `?t=` in coda: senza, la risposta può venire da una cache e dire una cosa
  // vecchia di giorni con la stessa faccia di una misura. Vedi la lezione del
  // lookup di Apple nel documento di stato.
  const risposta = await fetch(`${BASE}${indirizzo(pagina)}?t=${Date.now()}`);
  const servito = await risposta.text();
  const atteso = titolo(locale);
  const trovato = titolo(servito);
  if (trovato !== atteso) {
    guasti++;
    console.log(`✗ ${indirizzo(pagina).padEnd(24)} titolo servito «${trovato}» — atteso «${atteso}»`);
    continue;
  }
  const locImpronta = impronta(locale);
  const serImpronta = impronta(servito);
  if (locImpronta && serImpronta !== locImpronta) {
    guasti++;
    console.log(
      `✗ ${indirizzo(pagina).padEnd(24)} foglio di stile ${serImpronta} — sul disco ${locImpronta}`,
    );
    continue;
  }
  console.log(`✓ ${indirizzo(pagina).padEnd(24)} «${trovato}»`);
}

if (guasti) {
  console.log(
    `\n${guasti} pagine non sono quelle sul disco. Per pubblicare:\n  npx wrangler pages deploy sito --project-name mydivelog-sito`,
  );
  process.exitCode = 1;
} else {
  console.log('\nil sito pubblicato è quello sul disco.');
}
