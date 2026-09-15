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
 * ► COSA SI CONFRONTA, E COME CI SI È ARRIVATI IN TRE PASSI. ◄ Ogni gradino di
 * questo elenco è stato aggiunto dopo che quello precedente aveva detto «tutto
 * a posto» su una cosa che non guardava.
 *
 * 1. **Il `<title>`** — è unico per pagina, è la prima cosa che cambia quando la
 *    pagina servita è un'altra, e non cambia fra un ritocco e l'altro della
 *    stessa pagina. Più l'impronta del foglio di stile, che serve a far scadere
 *    la cache e risponde gratis alla domanda «cosa c'è pubblicato».
 * 2. **Le intestazioni `<h2>` e `<h3>`**, dall'8 settembre: quella notte alle
 *    due pagine di aiuto era stata aggiunta una voce sul codice di sei cifre
 *    dell'Aqualung, i titoli non erano cambiati, e questo controllo ha risposto
 *    «il sito pubblicato è quello sul disco» **mentre non lo era**.
 * 3. **Il testo visibile e i rimandi, dal 15 settembre.** Fino a quella notte
 *    qui sotto c'era scritto, dichiarato apertamente, che restava fuori «quello
 *    che cambia dentro un paragrafo senza toccare nessuna intestazione». Quella
 *    notte lo si è misurato a mano — dodici pagine scaricate e confrontate byte
 *    per byte — e si è scoperto che **si poteva chiudere**: bastava sapere quali
 *    trasformazioni mette la CDN. *Un buco dichiarato resta un buco: la
 *    dichiarazione serve a chi legge il codice, non a chi legge il sito.*
 *
 * ► LE DUE COSE CHE CLOUDFLARE CAMBIA, E CHE NON SONO DIFFERENZE. ◄ Il sito
 * servito **non è** byte per byte quello sul disco, e non è un difetto: con
 * l'offuscamento degli indirizzi acceso, ogni `mailto:` diventa un rimando a
 * `/cdn-cgi/l/email-protection` con dentro l'indirizzo cifrato, e in fondo alla
 * pagina compare uno `<script>` che lo decifra nel browser. Sono le uniche due,
 * misurate: tolte quelle, le dodici pagine coincidono esattamente.
 *
 * *Si normalizza soltanto quello che si è visto fare alla CDN.* Normalizzare a
 * tappeto — schiacciare tutto finché due cose diverse si somigliano — renderebbe
 * questa guardia incapace di accendersi, che è il modo più silenzioso di
 * spegnerla.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITO = fileURLToPath(new URL('../sito', import.meta.url));
const BASE = 'https://mydivelog.site';

// Le stesse dodici pagine di controlla-sito.mjs, con lo stesso indirizzo corto.
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
 * Le due trasformazioni della CDN, e nient'altro.
 *
 * Il rimando all'indirizzo di posta diventa un segnaposto tanto nella forma
 * `mailto:` (quella sul disco) quanto in quella offuscata (quella servita), così
 * le due si confrontano. Lo `<script>` che Cloudflare inietta per decifrarlo si
 * riconosce dal `src` sotto `/cdn-cgi/` e sparisce.
 */
const senzaCloudflare = (html) =>
  html
    .replace(/<a\s[^>]*(?:mailto:|cdn-cgi\/l\/email-protection)[^>]*>[\s\S]*?<\/a\s*>/g, 'INDIRIZZO')
    .replace(/<script[^>]*\ssrc="\/cdn-cgi\/[^"]*"[^>]*><\/script>/g, '');

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

/** Tutto il testo che una persona legge sulla pagina, ridotto a parole. */
const parole = (html) =>
  senzaCloudflare(html)
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * Dove puntano i rimandi, in ordine: `href` e `src` di tutta la pagina.
 *
 * Il testo visibile non li vede, e sono la metà delle cose che rompono un sito:
 * un pulsante «Scarica» che punta al nome vecchio di un allegato dice la frase
 * giusta e consegna un 404.
 */
const rimandi = (html) => [...senzaCloudflare(html).matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]);

/** La prima differenza fra due elenchi, con attorno il contesto che la fa capire. */
function primaDifferenza(sulDisco, servito, quanti = 8) {
  const quante = Math.max(sulDisco.length, servito.length);
  for (let i = 0; i < quante; i++) {
    if (sulDisco[i] === servito[i]) continue;
    const da = Math.max(0, i - 6);
    return {
      contesto: sulDisco.slice(da, i).join(' '),
      disco: sulDisco.slice(i, i + quanti).join(' ') || '(finisce qui)',
      online: servito.slice(i, i + quanti).join(' ') || '(finisce qui)',
    };
  }
  return undefined;
}

let guasti = 0;
for (const pagina of PAGINE) {
  const locale = readFileSync(join(SITO, pagina), 'utf8');
  // `?t=` in coda: senza, la risposta può venire da una cache e dire una cosa
  // vecchia di giorni con la stessa faccia di una misura. Vedi la lezione del
  // lookup di Apple nel documento di stato.
  const risposta = await fetch(`${BASE}${indirizzo(pagina)}?t=${Date.now()}`);
  const servito = await risposta.text();
  const dove = indirizzo(pagina).padEnd(24);
  const atteso = titolo(locale);
  const trovato = titolo(servito);
  if (trovato !== atteso) {
    guasti++;
    console.log(`✗ ${dove} titolo servito «${trovato}» — atteso «${atteso}»`);
    continue;
  }
  const locImpronta = impronta(locale);
  const serImpronta = impronta(servito);
  if (locImpronta && serImpronta !== locImpronta) {
    guasti++;
    console.log(`✗ ${dove} foglio di stile ${serImpronta} — sul disco ${locImpronta}`);
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
    console.log(`✗ ${dove} contenuto vecchio: ${dettaglio}`);
    continue;
  }
  const testo = primaDifferenza(parole(locale), parole(servito));
  if (testo) {
    guasti++;
    console.log(`✗ ${dove} testo vecchio dopo «…${testo.contesto}»`);
    console.log(`     sul disco: ${testo.disco}…`);
    console.log(`     online:    ${testo.online}…`);
    continue;
  }
  // Un rimando solo, non otto: un indirizzo lungo riempie la riga da sé.
  const dove_puntano = primaDifferenza(rimandi(locale), rimandi(servito), 1);
  if (dove_puntano) {
    guasti++;
    console.log(`✗ ${dove} rimando diverso: sul disco «${dove_puntano.disco}»`);
    console.log(`     online: «${dove_puntano.online}»`);
    continue;
  }
  console.log(`✓ ${dove} «${trovato}»`);
}

if (guasti) {
  console.log(
    `\n${guasti} pagine non sono quelle sul disco. Per pubblicare:\n  npx wrangler pages deploy sito --project-name mydivelog-sito`,
  );
  if (guasti === PAGINE.length) {
    console.log(
      '\n*Tutte e dodici insieme, però, somigliano più a una trasformazione nuova della\nCDN che a dodici pagine vecchie: si guarda la differenza stampata qui sopra\nprima di ripubblicare.*',
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    '\ntitoli, foglio di stile, intestazioni, testo e rimandi: il sito pubblicato è quello sul disco.',
  );
}
