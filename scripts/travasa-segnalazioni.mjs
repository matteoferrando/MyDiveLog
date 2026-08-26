/**
 * Porta nel foglio di Google le segnalazioni che nell'archivio del Worker sono
 * rimaste indietro.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► A COSA SERVE, cioè: quando una segnalazione resta indietro. ◄
 *
 * Il Worker salva ogni segnalazione nel suo archivio KV e poi ne manda una copia
 * al foglio. Le due cose sono in quest'ordine apposta — l'archivio è la verità,
 * il foglio è la copia comoda da leggere — e quindi la copia può mancare senza
 * che si perda niente. Succede in tre casi:
 *
 *  - **l'arretrato**: tutte le segnalazioni arrivate PRIMA che questo travaso
 *    esistesse. Il Worker le ha salvate e nessuno le ha mai copiate, perché il
 *    codice che le copia non c'era. Sono la ragione per cui questo script è
 *    stato scritto;
 *  - Google lento o irraggiungibile nel momento sbagliato;
 *  - il gettone cambiato nel foglio e non ancora nel Worker (o viceversa).
 *
 * In tutti e tre i casi la riga resta con `foglio: false`, e questo script la
 * ritrova e riprova. Si può lanciare quante volte si vuole: quello che è già
 * stato copiato non si copia due volte.
 *
 * ► PERCHÉ UNO SCRIPT DAL MAC E NON UNA ROTTA NEL WORKER. ◄ Una rotta che
 * rilegge le segnalazioni sarebbe un indirizzo pubblico che restituisce i
 * contatti di chi ha scritto: andrebbe protetta, e la protezione andrebbe fatta
 * bene, e il tutto per una cosa che si fa una volta ogni tanto. Da qui invece si
 * passa da `wrangler`, che è già autenticato con l'account di chi possiede
 * l'archivio. **Nessuna superficie nuova su Internet.**
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COME SI LANCIA
 *
 *   node scripts/travasa-segnalazioni.mjs            # dice cosa farebbe
 *   node scripts/travasa-segnalazioni.mjs --scrivi   # lo fa
 *
 * I due valori del foglio si passano nell'ambiente, perché non stanno e non
 * devono stare nel repository:
 *
 *   FOGLIO_SEGNALAZIONI='https://script.google.com/…/exec' \
 *   FOGLIO_GETTONE='…' \
 *   node scripts/travasa-segnalazioni.mjs --scrivi
 *
 * Sono gli stessi due valori che stanno nei segreti del Worker. Se non ce li hai
 * più sottomano non si rileggono da Cloudflare — i segreti si scrivono e non si
 * rileggono, ed è giusto così: si rigenerano.
 *
 * ► PARTE SEMPRE A VUOTO. ◄ Senza `--scrivi` non tocca niente e stampa cosa
 * farebbe. Uno script che travasa dati verso un servizio esterno e parte
 * scrivendo è uno script che qualcuno lancerà per sbaglio, e su questo la prova
 * generale costa un secondo.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCRIVI = process.argv.includes('--scrivi');
const INDIRIZZO = process.env.FOGLIO_SEGNALAZIONI ?? '';
const GETTONE = process.env.FOGLIO_GETTONE ?? '';

/**
 * L'identificativo dell'archivio si LEGGE da `wrangler.toml`, non si copia qui.
 *
 * Copiato, resterebbe indietro il giorno che cambia — e il guasto non sarebbe un
 * errore ma un silenzio: questo script leggerebbe un archivio vuoto, direbbe
 * «niente da travasare» e sembrerebbe aver funzionato.
 */
function identificativoArchivio() {
  const toml = readFileSync(fileURLToPath(new URL('../server/wrangler.toml', import.meta.url)), 'utf8');
  const blocco = toml.split('[[kv_namespaces]]').find((b) => b.includes('binding = "SEGNALAZIONI"'));
  const id = blocco?.match(/id\s*=\s*"([0-9a-f]+)"/)?.[1];
  if (!id) throw new Error('in server/wrangler.toml non trovo l’id del namespace SEGNALAZIONI');
  return id;
}

const wrangler = (...args) =>
  execFileSync('npx', ['--yes', 'wrangler@4', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

async function main() {
  const ns = identificativoArchivio();
  const chiavi = JSON.parse(wrangler('kv', 'key', 'list', '--namespace-id', ns, '--remote')).map(
    (k) => k.name,
  );
  console.log(`archivio ${ns}: ${chiavi.length} segnalazioni in tutto`);

  const arretrate = [];
  for (const chiave of chiavi) {
    const grezzo = wrangler('kv', 'key', 'get', chiave, '--namespace-id', ns, '--remote');
    let dati;
    try {
      dati = JSON.parse(grezzo);
    } catch {
      // Una riga illeggibile NON si salta in silenzio: si dice qual è, così
      // qualcuno può guardarla a mano. Saltarla e basta vorrebbe dire che il
      // conteggio finale mente.
      console.log(`  ‼ ${chiave} — non è JSON, la guardi a mano`);
      continue;
    }
    if (dati.foglio !== true) arretrate.push({ chiave, dati });
  }

  console.log(`da travasare: ${arretrate.length}`);
  if (!arretrate.length) return;

  for (const { chiave, dati } of arretrate) {
    const riassunto = `${dati.quando ?? '(senza data)'} — ${String(dati.testo ?? '')
      .slice(0, 60)
      .replace(/\s+/g, ' ')}…`;
    if (!SCRIVI) {
      console.log(`  · ${riassunto}`);
      continue;
    }
    if (!INDIRIZZO || !GETTONE) {
      console.error('\nFERMO: servono FOGLIO_SEGNALAZIONI e FOGLIO_GETTONE nell’ambiente.');
      process.exitCode = 1;
      return;
    }
    const risposta = await fetch(INDIRIZZO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...dati, gettone: GETTONE }),
    });
    const detto = (await risposta.text()).trim();
    /*
     * Si accetta solo `ok`, per la stessa ragione scritta in `worker.ts`: un
     * Apps Script risponde 200 anche quando rifiuta, perché il rifiuto è testo
     * nel corpo. Fidarsi dello stato marcherebbe tutto come travasato lasciando
     * il foglio vuoto — il modo peggiore di fallire, perché somiglia al successo.
     */
    if (!risposta.ok || detto !== 'ok') {
      console.log(`  ✗ ${riassunto}  →  ${risposta.status} «${detto}»`);
      continue;
    }
    wrangler(
      'kv',
      'key',
      'put',
      chiave,
      JSON.stringify({ ...dati, foglio: true }),
      '--namespace-id',
      ns,
      '--remote',
    );
    console.log(`  ✓ ${riassunto}`);
  }

  if (!SCRIVI) console.log('\n(prova a vuoto: rilancia con --scrivi per travasarle davvero)');
}

await main();
