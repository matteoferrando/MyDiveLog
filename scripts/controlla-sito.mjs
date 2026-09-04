/**
 * Un controllo del sito che non apre un browser: file, ancore, lingue, dati
 * strutturati.
 *
 *   npm run sito:controlla
 *
 * ► LA PRIMA VERSIONE DI QUESTO FILE HA SEGNALATO TRENTA GUASTI, E VENTISEI
 * ERANO SUOI. ◄ Non sapeva che gli indirizzi canonici del sito sono senza
 * `.html` — Cloudflare Pages serve `privacy.html` per `/privacy`, ed è scritto
 * anche in testa alla sitemap — quindi dava per rotto ogni collegamento
 * interno; e cercava la `meta description` con una regex a riga singola mentre
 * il formattatore manda gli attributi a capo, quindi dichiarava che tutte e otto
 * le pagine non ne avessero una. *Uno strumento di misura si misura prima di
 * credergli, se no si passa il pomeriggio a riparare cose che non sono rotte.*
 *
 * Quello che resta di vero, dopo la correzione, sono quattro `meta description`
 * più lunghe di quanto Google mostri. Le altre venticinque righe erano rumore.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Relativo allo script, non alla cartella da cui lo si lancia e non alla casa di
// chi lo ha scritto: la prima versione portava dentro un percorso assoluto del
// Mac di sviluppo e sarebbe morta su qualunque altra macchina, CI compresa.
const SITO = fileURLToPath(new URL('../sito/', import.meta.url));
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
const guasti = [];
const nota = (p, m) => guasti.push(`${p}: ${m}`);

const testi = new Map(PAGINE.map((p) => [p, readFileSync(join(SITO, p), 'utf8')]));
const senzaCommenti = (h) => h.replace(/<!--[\s\S]*?-->/g, '');

for (const [pagina, grezzo] of testi) {
  const html = senzaCommenti(grezzo);
  const cartella = dirname(join(SITO, pagina));

  // 1. Ogni id compare una volta sola.
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  for (const id of new Set(ids)) {
    if (ids.filter((x) => x === id).length > 1) nota(pagina, `id doppio: #${id}`);
  }

  // 2. Ogni ancora interna esiste.
  for (const m of html.matchAll(/href="#([^"]+)"/g)) {
    if (m[1] !== 'segnala' && !ids.includes(m[1])) nota(pagina, `ancora senza bersaglio: #${m[1]}`);
  }

  // 3. Ogni collegamento a una pagina del sito esiste su disco.
  for (const m of html.matchAll(/href="(?!https?:|mailto:|#|data:)([^"]+)"/g)) {
    const pulito = m[1].split('#')[0].split('?')[0];
    if (!pulito) continue;
    const bersaglio = pulito.startsWith('/') ? join(SITO, pulito) : resolve(cartella, pulito);
    // Gli indirizzi del sito sono SENZA `.html`: è la forma canonica, e
    // Cloudflare Pages serve `privacy.html` per `/privacy`. Un controllo che non
    // lo sa segnala come rotto ogni collegamento del sito — ed è successo.
    const candidati = bersaglio.endsWith('/')
      ? [join(bersaglio, 'index.html')]
      : [bersaglio, `${bersaglio}.html`, join(bersaglio, 'index.html')];
    if (!candidati.some(existsSync)) nota(pagina, `collegamento a un file che non c'è: ${m[1]}`);
  }

  // 4. Ogni immagine e ogni `source` esistono, e ogni `img` ha un alt.
  for (const m of html.matchAll(/(?:src|srcset)="(?!data:|https?:)([^"]+)"/g)) {
    const f = m[1].startsWith('/') ? join(SITO, m[1]) : resolve(cartella, m[1]);
    if (!existsSync(f)) nota(pagina, `file che non c'è: ${m[1]}`);
  }
  for (const m of html.matchAll(/<img\b([^>]*)>/g)) {
    if (!/\balt=/.test(m[1])) nota(pagina, `un <img> senza alt: ${m[1].trim().slice(0, 60)}`);
  }

  // 5. La lingua dichiarata.
  const lang = /<html[^>]*\blang="([^"]+)"/.exec(html)?.[1];
  const attesa = pagina.startsWith('en/') ? 'en' : 'it';
  if (lang !== attesa) nota(pagina, `lang="${lang}" invece di "${attesa}"`);

  // 6. hreflang: ci sono tutti e tre, e puntano a pagine vere.
  const alternate = [...html.matchAll(/<link rel="alternate"[^>]*hreflang="([^"]+)"[^>]*href="([^"]+)"/g)];
  const lingue = alternate
    .map((m) => m[1])
    .sort()
    .join(',');
  if (lingue !== 'en,it,x-default') nota(pagina, `hreflang: ${lingue || 'nessuno'}`);

  // 7. Titolo e descrizione ci sono e non sono vuoti.
  const titolo = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim();
  if (!titolo) nota(pagina, 'senza <title>');
  // Il tag sta su più righe: il formattatore manda a capo gli attributi, e una
  // regex a riga singola non lo trova. Segnalava «senza meta description» su
  // tutte e otto le pagine, che ce l'hanno tutte.
  const descr = /<meta[^>]*name="description"[^>]*content="([^"]*)"/s.exec(html)?.[1]?.trim();
  if (!descr) nota(pagina, 'senza meta description');
  else if (descr.length > 165)
    nota(pagina, `meta description di ${descr.length} caratteri (Google ne mostra ~160)`);

  // 8. I dati strutturati si leggono.
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(m[1]);
    } catch (e) {
      nota(pagina, `JSON-LD illeggibile: ${e.message}`);
    }
  }
}

// 9. La sitemap elenca esattamente le pagine che esistono.
const sitemap = readFileSync(join(SITO, 'sitemap.xml'), 'utf8');
const dentro = [...sitemap.matchAll(/<loc>https:\/\/mydivelog\.site\/?([^<]*)<\/loc>/g)].map((m) => m[1]);
// Anche qui gli indirizzi canonici sono corti, e la sitemap li elenca così di
// proposito: la forma con `.html` esiste ma Cloudflare la rimanda con un 308, e
// una mappa fatta di otto salti è una mappa peggiore.
const attese = PAGINE.map((p) =>
  p === 'index.html' ? '' : p === 'en/index.html' ? 'en/' : p.replace(/\.html$/, ''),
);
for (const a of attese) if (!dentro.includes(a)) guasti.push(`sitemap.xml: manca ${a || '(home)'}`);
for (const d of dentro)
  if (!attese.includes(d)) guasti.push(`sitemap.xml: elenca ${d}, che non è fra le pagine`);

// 10. I pulsanti di scarico puntano ai nomi che la CI produce davvero.
import { readdirSync } from 'node:fs';
const CARTELLA = join(SITO, '../.github/workflows');
const workflow = readdirSync(CARTELLA)
  .map((f) => readFileSync(join(CARTELLA, f), 'utf8'))
  .join('\n');
import { execSync } from 'node:child_process';
const ovunque = execSync('git grep -h "MyDiveLog-" -- . ":(exclude)sito" || true', {
  cwd: join(SITO, '..'),
  encoding: 'utf8',
});
for (const [pagina, grezzo] of testi) {
  for (const m of senzaCommenti(grezzo).matchAll(/releases\/latest\/download\/([^"]+)/g)) {
    // Il `.dmg` del Mac non lo fa un workflow: si costruisce e si rinomina sul
    // Mac, ed è descritto in `rilascio-e-versioni`. Si cerca quindi in tutto il
    // repository, non solo nella CI.
    if (!workflow.includes(m[1]) && !ovunque.includes(m[1])) {
      nota(pagina, `il pulsante scarica \`${m[1]}\`, che non è nominato da nessuna parte fuori dal sito`);
    }
  }
}

console.log(guasti.length ? guasti.join('\n') : 'nessun guasto trovato');
console.log(`\n— ${guasti.length} —`);
// Esito diverso da zero se c'è qualcosa: così serve anche da controllo, non solo
// da rapporto da leggere a mano.
process.exit(guasti.length ? 1 : 0);
