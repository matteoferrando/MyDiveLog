/**
 * Lo script che riceve le segnalazioni dal Worker e le scrive nel foglio.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► CHI LO CHIAMA, E PERCHÉ NON È IL SITO. ◄
 *
 * Non lo chiama il modulo del sito: lo chiama il **Worker**, dopo aver già
 * salvato la segnalazione nel suo archivio. L'ordine conta ed è tutto il
 * disegno — l'archivio è la verità, questo foglio è **una copia comoda da
 * leggere**. Se Google è lento o questo script è rotto non si perde niente: la
 * riga resta nell'archivio marcata da travasare, e
 * `scripts/travasa-segnalazioni.mjs` la riprende.
 *
 * Il modulo del sito non ha mai parlato con Google e non deve cominciare: gli
 * darebbe l'indirizzo di questo script in chiaro dentro una pagina pubblica.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COME SI PUBBLICA, una volta sola:
 *
 *   1. apri il foglio «MyDiveLog — Segnalazioni dal sito»;
 *   2. Estensioni → Apps Script;
 *   3. cancella quello che c'è e incolla questo file;
 *   4. metti in `GETTONE` qui sotto una parola d'ordine lunga e a caso
 *      (`openssl rand -hex 24` ne genera una buona);
 *   5. Distribuisci → Nuova distribuzione → tipo «App web»;
 *      · Esegui come: me stesso
 *      · Chi ha accesso: CHIUNQUE          ← senza questo il Worker riceve un 401
 *   6. copia l'indirizzo che finisce in `/exec` e mettilo nel Worker, insieme
 *      alla parola d'ordine, come SEGRETI — non nel file di configurazione:
 *
 *        cd server
 *        npx wrangler@4 secret put FOGLIO_SEGNALAZIONI   # l'indirizzo /exec
 *        npx wrangler@4 secret put FOGLIO_GETTONE        # la stessa di GETTONE
 *
 *      Poi si ridistribuisce il Worker. I due valori non entrano nel
 *      repository: `wrangler` li chiede da tastiera e li tiene su Cloudflare.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ► «CHIUNQUE» NON VUOL DIRE CHE CHIUNQUE VEDE IL FOGLIO. ◄ Vuol dire che
 * chiunque può CHIAMARE questo script, che sa fare una cosa sola: aggiungere una
 * riga. Non legge niente, non tocca le righe esistenti, non risponde con dati.
 * Il foglio resta privato come prima.
 *
 * ► MA CHIUNQUE POTEVA ANCHE RIEMPIRLO, E ADESSO NO. ◄ Un indirizzo pubblico che
 * scrive righe è un indirizzo che qualcuno riempie di spazzatura, e l'indirizzo
 * non è segreto per costruzione: basta che finisca in un log, in un messaggio
 * d'errore, in uno screenshot. Da qui il `GETTONE`, che il Worker manda a ogni
 * chiamata e che questo script controlla PRIMA di qualunque altra cosa. Chi
 * conosce l'indirizzo e non la parola d'ordine non scrive niente.
 *
 * Il gettone non è cifrato e non è una firma: chi potesse leggere il traffico fra
 * il Worker e Google lo vedrebbe. Non serve a quello — serve a rendere inutile
 * un indirizzo trapelato, che è il modo in cui questa cosa si rompe davvero.
 *
 * ► SE UN GIORNO ARRIVASSE SPAZZATURA LO STESSO ◄ (cioè: se il gettone è
 * trapelato), la cosa da fare è **cambiarlo** — qui e nel segreto del Worker —
 * non irrigidire questo file. E le segnalazioni vere non si perdono comunque:
 * stanno nell'archivio del Worker, non qui.
 */

/** La parola d'ordine che il Worker deve presentare. Da riempire alla riga 4. */
const GETTONE = 'DA-RIEMPIRE';

/** Quanto testo si accetta da un campo. Oltre, si taglia. */
const MASSIMO = 4000;

function doPost(e) {
  let dati = {};
  try {
    dati = JSON.parse(e.postData.contents);
  } catch (errore) {
    // Un corpo che non è JSON, adesso, è per forza una chiamata che non viene
    // dal Worker: non si prova nemmeno a salvarlo. Prima si scriveva grezzo per
    // non perdere una segnalazione, ma la segnalazione ormai è già salvata
    // altrove — quello che arriva qui malformato è rumore.
    return ContentService.createTextOutput('malformata');
  }

  /*
   * Il gettone si controlla PRIMA di aprire il foglio.
   *
   * Non è pignoleria di ordine: `getActiveSpreadsheet()` e `getLastRow()` sono
   * chiamate che costano, e sono contate nella quota giornaliera di Apps Script.
   * Chi bussa senza parola d'ordine non deve poter consumare la quota di chi ce
   * l'ha — altrimenti il rifiuto protegge il foglio e lascia aperta la porta per
   * spegnerlo.
   */
  if (!GETTONE || GETTONE === 'DA-RIEMPIRE' || String(dati.gettone || '') !== GETTONE) {
    return ContentService.createTextOutput('rifiutata');
  }

  const taglia = (v) => String(v == null ? '' : v).slice(0, MASSIMO);

  // Senza testo non c'è segnalazione.
  if (!taglia(dati.testo).trim()) {
    return ContentService.createTextOutput('vuota');
  }

  const foglio = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

  // L'intestazione si scrive una volta sola, al primo arrivo: così il foglio
  // nasce vuoto e si riempie da sé, senza che nessuno debba prepararlo.
  if (foglio.getLastRow() === 0) {
    foglio.appendRow(['Quando', 'Tipo', 'Cosa usa', 'Segnalazione', 'Contatto', 'Pagina']);
    foglio.setFrozenRows(1);
  }

  /*
   * La data arriva dalla segnalazione, non da qui.
   *
   * `new Date()` scriverebbe il momento del TRAVASO, che per una segnalazione
   * ripresa dall'archivio mesi dopo sarebbe una data falsa — e falsa in modo
   * credibile, che è il peggio. `dati.quando` è l'istante in cui qualcuno ha
   * premuto «invia».
   */
  foglio.appendRow([
    taglia(dati.quando),
    taglia(dati.tipo),
    taglia(dati.dove),
    taglia(dati.testo),
    taglia(dati.contatto),
    taglia(dati.pagina),
  ]);

  // ► La risposta è `ok` SOLO da qui. ◄ Il Worker la legge e solo con questa
  // marca la segnalazione come travasata: qualunque altra parola — «rifiutata»,
  // «vuota», «malformata» — la lascia in coda, da riprovare.
  return ContentService.createTextOutput('ok');
}
