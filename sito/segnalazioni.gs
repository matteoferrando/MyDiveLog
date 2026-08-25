/**
 * Lo script che riceve le segnalazioni dal sito e le scrive nel foglio.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * COME SI PUBBLICA, una volta sola:
 *
 *   1. apri il foglio «MyDiveLog — Segnalazioni dal sito»;
 *   2. Estensioni → Apps Script;
 *   3. cancella quello che c'è e incolla questo file;
 *   4. Distribuisci → Nuova distribuzione → tipo «App web»;
 *      · Esegui come: me stesso
 *      · Chi ha accesso: CHIUNQUE          ← senza questo il sito riceve un 401
 *   5. copia l'indirizzo che finisce in `/exec` e mettilo dentro
 *      `SCRIPT_SEGNALAZIONI` nelle due pagine del sito.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ► «CHIUNQUE» NON VUOL DIRE CHE CHIUNQUE VEDE IL FOGLIO. ◄ Vuol dire che
 * chiunque può chiamare QUESTO script, che sa fare una cosa sola: aggiungere
 * una riga. Non legge niente, non risponde niente, non tocca le righe
 * esistenti. Il foglio resta privato come prima.
 *
 * ► COSA PUÒ ANDARE STORTO, ed è meglio saperlo prima. ◄ Un indirizzo pubblico
 * che scrive righe è un indirizzo che qualcuno può riempire di spazzatura. Le
 * due difese qui sotto non lo impediscono — niente lo impedisce senza chiedere
 * un account a chi segnala — ma lo rendono noioso: il testo si taglia, e una
 * riga senza testo non entra proprio. Se un giorno arrivasse davvero spazzatura,
 * la cosa da fare è spegnere la distribuzione, non irrigidire questo file.
 */

/** Quanto testo si accetta da un campo. Oltre, si taglia. */
const MASSIMO = 4000;

function doPost(e) {
  const foglio = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

  // L'intestazione si scrive una volta sola, al primo arrivo: così il foglio
  // nasce vuoto e si riempie da sé, senza che nessuno debba prepararlo.
  if (foglio.getLastRow() === 0) {
    foglio.appendRow(['Quando', 'Tipo', 'Cosa usa', 'Segnalazione', 'Contatto', 'Pagina']);
    foglio.setFrozenRows(1);
  }

  let dati = {};
  try {
    dati = JSON.parse(e.postData.contents);
  } catch (errore) {
    // Un corpo che non è JSON non è un motivo per perdere la segnalazione: si
    // scrive grezzo e si guarda a mano. Buttarla via sarebbe l'unico esito
    // peggiore di riceverla malformata.
    dati = { testo: String(e.postData && e.postData.contents).slice(0, MASSIMO) };
  }

  const taglia = (v) => String(v == null ? '' : v).slice(0, MASSIMO);

  // Senza testo non c'è segnalazione: è la riga che tiene fuori le richieste
  // vuote di chi passa di lì a caso.
  if (!taglia(dati.testo).trim()) {
    return ContentService.createTextOutput('vuota');
  }

  foglio.appendRow([
    new Date(),
    taglia(dati.tipo),
    taglia(dati.dove),
    taglia(dati.testo),
    taglia(dati.contatto),
    taglia(dati.pagina),
  ]);

  return ContentService.createTextOutput('ok');
}
