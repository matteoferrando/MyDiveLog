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
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIVI = process.argv.includes('--scrivi');

/**
 * Chiede un valore alla tastiera, senza farlo comparire a schermo.
 *
 * ► PERCHÉ NON BASTA L'AMBIENTE. ◄ `FOGLIO_GETTONE='…' node script.mjs` scrive
 * la parola d'ordine in due posti che sopravvivono al comando: la cronologia
 * della shell (`~/.zsh_history`, in chiaro, per sempre) e la riga di comando del
 * processo, che sulla stessa macchina la legge chiunque con un `ps`. Sono
 * esattamente i due posti da cui un segreto trapela senza che nessuno abbia
 * fatto niente di sbagliato.
 *
 * Chiesto qui invece vive solo in memoria, per il tempo del travaso. Le due
 * variabili d'ambiente restano accettate — servono a chi lo lancia da uno
 * script — ma non sono più la strada normale.
 */
async function chiedi(domanda, nascosto) {
  const riga = createInterface({ input: process.stdin, output: process.stdout });
  if (nascosto) {
    // Il carattere digitato non si riscrive: al suo posto niente. `readline` non
    // ha una modalità password, e questa è la sua scorciatoia consueta.
    riga.output.write = ((scrivi) => (testo) => {
      if (riga.stdoutMuted && !testo.includes(domanda)) return true;
      return scrivi.call(riga.output, testo);
    })(riga.output.write);
  }
  const promessa = riga.question(domanda);
  riga.stdoutMuted = Boolean(nascosto);
  const risposta = await promessa;
  riga.stdoutMuted = false;
  if (nascosto) process.stdout.write('\n');
  riga.close();
  return risposta.trim();
}

let INDIRIZZO = process.env.FOGLIO_SEGNALAZIONI ?? '';
let GETTONE = process.env.FOGLIO_GETTONE ?? '';

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

/**
 * Tiene le ultime righe che dicono qualcosa, e butta il resto.
 *
 * `wrangler` quando fallisce non stampa una riga: stampa la tabella
 * dell'account, l'elenco dei permessi del gettone e il percorso di un file di
 * log. La riga che spiega il guasto è una sola, e sta in mezzo.
 */
export function ultimeRigheUtili(testo, quante = 6) {
  const righe = String(testo ?? '')
    .split('\n')
    .map((r) => r.trimEnd())
    // Via le cornici della tabella e le righe dell'elenco dei permessi: sono
    // decine, e non riguardano il comando che è appena morto.
    .filter((r) => r.trim() && !/^[┌├└│]/.test(r) && !/^\s*-\s/.test(r));
  return righe.slice(-quante).join('\n');
}

/**
 * Dice in una riga perché `wrangler` è morto, o `null` se non lo riconosce.
 *
 * ► SI RICONOSCE SOLO QUELLO CHE SI VEDE SCRITTO. ◄ Questo progetto ha già
 * pagato una diagnosi inventata a priori: la notarizzazione si fermava su
 * credenziali scadute e il messaggio accusava un profilo mancante, che invece
 * c'era. *Un messaggio che nomina una causa che non ha misurato manda chi legge
 * a cercare nel posto sbagliato, e più suona preciso più lo manda lontano.*
 * Quindi qui si cerca il marcatore esatto, e se non c'è si restituisce `null` e
 * si mostrano le righe vere invece di indovinare.
 */
export function perchePuoEsserMorto(uscita) {
  const testo = String(uscita ?? '');
  if (/code:\s*10000/.test(testo) || /Authentication error/i.test(testo)) {
    return [
      'Cloudflare ha rifiutato le credenziali (Authentication error, code 10000).',
      'Succede anche con un accesso valido, al primo comando dopo una pausa:',
      'il gettone OAuth va rinfrescato e il primo tentativo muore.',
      '  1. rilancia lo stesso comando — spesso al secondo giro passa;',
      '  2. se insiste:  npx wrangler@4 login',
    ].join('\n');
  }
  return null;
}

/**
 * Lancia `wrangler` e, se muore, lo racconta in poche righe invece di
 * rovesciare in terminale l'oggetto errore di Node.
 *
 * ► PERCHÉ NON BASTA LASCIARLO ESPLODERE. ◄ `execFileSync` che fallisce lancia
 * un `Error` con dentro `status`, `signal`, `pid`, `output` **e** `stdout` — e
 * le ultime due sono la stessa cosa stampata due volte. Con una tabella
 * dell'account e trenta righe di permessi lì dentro, Node stampa un muro in cui
 * la frase che conta — cinque parole — è tipograficamente identica a tutto il
 * resto. *È lo stesso guasto della pagina HTML di Google riversata al posto di
 * un errore, e sta nello stesso file: la prima correzione ha sistemato la
 * risposta del foglio e ha lasciato intatta quella di `wrangler`.*
 *
 * `stderr` si cattura invece di lasciarlo passare (`inherit`) proprio per poterlo
 * classificare: il prezzo è che i messaggi di `wrangler` non scorrono in diretta,
 * e per comandi che durano un secondo è un prezzo che vale la pena pagare.
 */
const wrangler = (...args) => {
  try {
    return execFileSync('npx', ['--yes', 'wrangler@4', ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (errore) {
    // Il comando si ristampa senza gli identificativi: sono lunghi, non si
    // leggono, e chi guarda vuole sapere QUALE passo è morto, non con quali
    // argomenti.
    const passo = args.filter((a) => !a.startsWith('--') && a.length < 40).join(' ');
    const uscita = `${errore.stdout ?? ''}\n${errore.stderr ?? ''}`;
    const causa = perchePuoEsserMorto(uscita);
    console.error(`\nFERMO: «wrangler ${passo}» non è riuscito.\n`);
    console.error(causa ?? `Non riconosco il motivo. Ultime righe:\n${ultimeRigheUtili(uscita)}`);
    process.exit(1);
  }
};

/**
 * Dice perché un indirizzo NON è chiamabile da qui, o `null` se lo è.
 *
 * ► PERCHÉ ESISTE QUESTO CONTROLLO. ◄ Google pubblica ogni Apps Script a due
 * indirizzi che si somigliano fino all'ultimo pezzo:
 *
 *   …/exec   la versione pubblicata. Risponde a chiunque, anche a un `fetch`.
 *   …/dev    l'ultimo salvataggio. Risponde SOLO al proprietario, e solo dentro
 *            un browser già collegato a Google.
 *
 * Copiare il secondo è facilissimo, perché è quello che l'editor dello script
 * tiene sotto mano. E il modo in cui fallisce è il peggiore possibile: la
 * chiamata non dà un errore che parli di permessi, dà **401 con dentro la
 * pagina «Pagina non trovata»** — un messaggio che manda a cercare il guasto
 * nel posto sbagliato (l'indirizzo scritto male, lo script cancellato, il
 * gettone) mentre l'indirizzo è giusto e lo script c'è.
 *
 * Fermarsi PRIMA della chiamata costa un confronto di stringhe e risparmia
 * quella caccia. È il tipo di controllo che si scrive dopo averci perso mezz'ora
 * una volta: e infatti è stato scritto dopo.
 */
export function perchePeggioDiExec(indirizzo) {
  if (!/^https:\/\//.test(indirizzo)) return 'non comincia per https://';
  if (/\/dev\/?$/.test(indirizzo)) {
    return 'finisce per /dev: quello è l’indirizzo di prova, risponde solo a te dentro il browser. Serve quello che finisce per /exec (Apps Script → Distribuisci → Gestisci distribuzioni).';
  }
  if (!/\/exec\/?$/.test(indirizzo)) return 'non finisce per /exec';
  return null;
}

/**
 * Riduce a una riga la risposta del foglio, che riga non è.
 *
 * Quando Apps Script rifiuta, non risponde con una frase: risponde con una
 * **pagina HTML intera**, centinaia di righe di `<style>` e `<script>` che
 * scorrendo cancellano dal terminale tutto quello che c'era prima — compreso
 * l'elenco delle segnalazioni che stavamo travasando. Il guasto diventa
 * illeggibile non perché dica poco, ma perché dice troppo.
 *
 * Di quella pagina l'unica cosa che informa è il `<title>`. Lo si tira fuori e
 * si butta il resto; se HTML non è, si taglia e basta.
 */
export function accorcia(detto, quanto = 200) {
  const testo = String(detto).trim();
  if (/^\s*<(!doctype|html)/i.test(testo)) {
    const titolo = testo.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    return titolo ? `pagina HTML: «${titolo}»` : 'pagina HTML senza titolo';
  }
  return testo.length > quanto ? `${testo.slice(0, quanto)}… (${testo.length} caratteri)` : testo;
}

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

  // I due valori si chiedono UNA VOLTA SOLA, e solo se si scrive davvero: la
  // prova a vuoto non ha niente da mandare a nessuno, e chiederle lo stesso
  // insegnerebbe a digitarle senza motivo.
  if (SCRIVI) {
    if (!INDIRIZZO) INDIRIZZO = await chiedi('Indirizzo /exec dello script del foglio: ', false);
    if (!GETTONE) GETTONE = await chiedi('Parola d’ordine (non compare a schermo): ', true);
    if (!INDIRIZZO || !GETTONE) {
      console.error('FERMO: senza indirizzo e parola d’ordine non si travasa niente.');
      process.exitCode = 1;
      return;
    }
    // Si controlla QUI, prima del ciclo: sbagliato l'indirizzo, sbagliano tutte
    // le chiamate, e ognuna sbaglia in modo da non far capire perché.
    const male = perchePeggioDiExec(INDIRIZZO);
    if (male) {
      console.error(`FERMO: l’indirizzo ${male}`);
      process.exitCode = 1;
      return;
    }
  }

  for (const { chiave, dati } of arretrate) {
    const riassunto = `${dati.quando ?? '(senza data)'} — ${String(dati.testo ?? '')
      .slice(0, 60)
      .replace(/\s+/g, ' ')}…`;
    if (!SCRIVI) {
      console.log(`  · ${riassunto}`);
      continue;
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
      console.log(`  ✗ ${riassunto}  →  ${risposta.status} «${accorcia(detto)}»`);
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

/*
 * `main()` parte solo se questo file è stato LANCIATO. Importato — come fa la
 * prova, che di qui prende le due funzioni pure — non deve fare niente:
 * altrimenti un `npm test` si metterebbe a parlare con Cloudflare.
 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
