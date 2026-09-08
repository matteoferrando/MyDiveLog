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
 * ► E DALL'8 SETTEMBRE ANCHE LE INTESTAZIONI, PERCHÉ IL TITOLO NON BASTAVA. ◄
 * Quella notte alle pagine di aiuto — italiano e inglese — è stata aggiunta una
 * voce sul codice di sei cifre dell'Aqualung. Il titolo delle due pagine non è
 * cambiato, il foglio di stile nemmeno, e questo controllo ha risposto «il sito
 * pubblicato è quello sul disco» **mentre non lo era**: la voce nuova sul sito
 * vero non c'era, e non c'è stata finché qualcuno non ha ripubblicato.
 *
 * *Una guardia che risponde «tutto a posto» su una cosa che non guarda è
 * peggio di una guardia che non c'è: la prima si legge come una misura.* Adesso
 * si confrontano anche i testi di tutte le intestazioni `<h2>` e `<h3>`, che
 * sono l'ossatura di ogni pagina di questo sito: una sezione aggiunta, tolta o
 * rinominata si vede, e si vede con il suo nome scritto nel messaggio.
 *
 * Resta fuori quello che cambia dentro un paragrafo senza toccare nessuna
 * intestazione, ed è dichiarato: sono i due modi in cui questo sito è stato
 * indietro finora, e adesso sono coperti tutti e due.
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

/**
 * I testi di tutte le intestazioni `<h2>` e `<h3>`, in ordine.
 *
 * Si toglie il marcatore interno (`<b>`, `<code>`) e si schiacciano gli spazi:
 * un a capo in più nel sorgente non deve diventare una differenza, o la guardia
 * si accende per niente — e una guardia che si accende per niente insegna a non
 * fidarsi di lei.
 */
const intestazioni = (html) =>
  [...html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)].map((m) =>
    m[1]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );

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
  const locIntestazioni = intestazioni(locale);
  const serIntestazioni = intestazioni(servito);
  if (locIntestazioni.join('\n') !== serIntestazioni.join('\n')) {
    guasti++;
    // Si nomina la PRIMA differenza, non il conto: «tre intestazioni diverse»
    // manda a cercare; «manca "Il computer mi chiede un codice"» dice cosa.
    const solo = (a, b) => a.find((x) => !b.includes(x));
    const manca = solo(locIntestazioni, serIntestazioni);
    const avanza = solo(serIntestazioni, locIntestazioni);
    const dettaglio = manca
      ? `online manca «${manca}»`
      : avanza
        ? `online c'è in più «${avanza}»`
        : 'stesse voci in ordine diverso';
    console.log(`✗ ${indirizzo(pagina).padEnd(24)} contenuto vecchio: ${dettaglio}`);
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
  console.log('\ntitoli, foglio di stile e intestazioni: il sito pubblicato è quello sul disco.');
}
