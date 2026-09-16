/**
 * Ogni piattaforma registra i comandi Rust che le servono. Contati da fuori.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTO FILE ESISTE, ED È LA STESSA LEZIONE PER LA TERZA VOLTA. ◄
 *
 * `invoke_handler` era registrato solo per macOS e per iOS. Su Windows e su
 * Android l'applicazione arrivava all'avvio SENZA nessun gestore, e ogni
 * chiamata al motore Rust rispondeva «comando sconosciuto». Nessun errore in
 * compilazione, nessuno all'avvio, e nessun controllo automatico se ne è
 * accorto: si è visto guardando dentro l'APK consegnato.
 *
 * Poi è successo di nuovo, e peggio. La correzione per Android — il modulo del
 * ritorno dall'accesso, e il suo comando dentro il gestore — **è stata scritta,
 * ha fatto passare `cargo check`, ed è sparita dal file prima di essere
 * committata.** Il pacchetto successivo è uscito senza. Anche quella volta si è
 * vista solo cercando una stringa dentro il binario.
 *
 * Due volte lo stesso guasto trovato a mano è la definizione di un controllo
 * mancante. Questo file legge `lib.rs` e conta, così la terza volta è rossa
 * prima di diventare un pacchetto.
 *
 * ► PERCHÉ NON BASTA `cargo check`. ◄ Perché tutto quello che manca qui è
 * codice CORRETTO. Un gestore con dentro tre comandi invece di quattro compila
 * benissimo. Un modulo escluso da un `cfg` compila benissimo. Non c'è niente di
 * malformato da segnalare: c'è qualcosa di assente, e l'assenza non è un errore
 * di sintassi.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const LIB = readFileSync('src-tauri/src/lib.rs', 'utf8');

/**
 * I comandi dentro il `generate_handler!` di una data condizione.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PER MESI QUESTA FUNZIONE HA MISURATO macOS QUANDO LE SI CHIEDEVA iOS. ◄
 *
 * Cercava la condizione con `indexOf` e poi il primo `generate_handler![` dopo
 * di lei. Ma `#[cfg(target_os = "ios")]` in `lib.rs` compare **quattro volte**,
 * e la prima sta in cima al file, sopra `esporta_nei_documenti`: da lì il primo
 * `generate_handler!` che si incontra è quello di **macOS**, ottanta righe più
 * in basso. Quindi ogni riga che diceva «iOS» chiedeva conto del gestore
 * sbagliato, e passava — perché i due gestori si somigliano abbastanza.
 *
 * *Un controllo che guarda il posto sbagliato non è un controllo che passa: è
 * un controllo che non c'è* — ed è il difetto che questo file è nato per
 * impedire, commesso dal file stesso. Si è visto il 16 settembre 2026
 * aggiungendo una riga su un comando che su iOS c'è e su macOS no: è diventata
 * rossa sulla piattaforma giusta per il motivo sbagliato.
 *
 * ► ADESSO SI ANCORA AL GESTORE, NON ALLA CONDIZIONE. ◄ Si cerca
 * `#[cfg(...)]` **immediatamente seguito** da `let builder =
 * builder.invoke_handler(`: è l'unica forma in cui un attributo governa
 * davvero un gestore. Un `cfg` su una funzione, su un modulo o dentro un
 * commento non la ha, e quindi non può più essere scambiato per uno.
 *
 * E i commenti si tolgono prima di cercare, che in questo progetto è la quinta
 * volta: *una guardia che legge il sorgente come testo finisce per trovare il
 * commento che la descrive.* Il commento che racconta questo difetto contiene
 * `#[cfg(target_os = "ios")]` per iscritto.
 */
function senzaCommenti(sorgente: string): string {
  return sorgente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const CODICE = senzaCommenti(LIB);

function comandiPer(condizione: string): string[] {
  const ancora = `#[cfg(${condizione})]`;
  const gestore = 'let builder = builder.invoke_handler(tauri::generate_handler![';
  let i = -1;
  for (let da = 0; ;) {
    const trovato = CODICE.indexOf(ancora, da);
    if (trovato === -1) break;
    // Fra l'attributo e il gestore ci può stare solo spazio bianco: se c'è
    // altro, quell'attributo governa qualcos'altro.
    const dopo = CODICE.slice(trovato + ancora.length);
    if (dopo.trimStart().startsWith(gestore)) {
      i = trovato;
      break;
    }
    da = trovato + ancora.length;
  }
  expect(i, `nessun GESTORE con la condizione ${condizione}`).toBeGreaterThan(-1);
  const dopo = CODICE.slice(i);
  const apre = dopo.indexOf('generate_handler![');
  const blocco = dopo.slice(apre + 'generate_handler!['.length, dopo.indexOf(']', apre));
  return blocco
    .split('\n')
    .map((r) => r.trim().replace(/,$/, ''))
    .filter((r) => r.length > 0);
}

/** Le quattro piattaforme su cui l'applicazione gira davvero. */
const PIATTAFORME = [
  { nome: 'macOS', cfg: 'target_os = "macos"' },
  { nome: 'iOS', cfg: 'target_os = "ios"' },
  { nome: 'Windows', cfg: 'all(desktop, not(target_os = "macos"))' },
  { nome: 'Android', cfg: 'target_os = "android"' },
];

describe('i comandi Rust registrati, piattaforma per piattaforma', () => {
  it.each(PIATTAFORME)('$nome ha un gestore, e non è vuoto', ({ cfg }) => {
    expect(comandiPer(cfg).length).toBeGreaterThan(0);
  });

  /*
   * I due che valgono su OGNI piattaforma: il catalogo dei computer supportati
   * e lo scarico via libdivecomputer. Senza il primo il selettore non sa cosa
   * mostrare; senza il secondo il pulsante «scarica» risponde «comando
   * sconosciuto», che è il messaggio che non spiega niente a nessuno.
   */
  it.each(PIATTAFORME)('$nome sa elencare i computer e scaricare', ({ cfg }) => {
    const comandi = comandiPer(cfg);
    expect(comandi).toContain('computer_esterni::elenca_computer_supportati');
    expect(comandi).toContain('ponte_blec::scarica_da_computer_esterno');
  });

  /*
   * Il riconoscimento dal nome annunciato. Senza, la riga di un Mares torna a
   * dire «non riconosciuto come computer subacqueo» — non con un errore, con
   * un elenco vuoto: `riconosciComputerEsterno` tratta il comando assente
   * come «nessun candidato», di proposito, e quindi QUESTA è l'unica guardia.
   */
  it.each(PIATTAFORME)('$nome sa riconoscere un computer dal nome', ({ cfg }) => {
    expect(comandiPer(cfg)).toContain('computer_esterni::riconosci_computer_esterno');
  });

  /*
   * Il ritorno dall'accesso, che è il comando la cui assenza è già costata due
   * pacchetti. Vale ovunque tranne iPhone, dove il ritorno arriva da uno schema
   * URL e una porta locale non si può aprire.
   */
  it.each(PIATTAFORME.filter((p) => p.nome !== 'iOS'))(
    '$nome sa aprire il ritorno dell’accesso',
    ({ cfg }) => {
      expect(comandiPer(cfg)).toContain('ritorno_accesso::apri_ritorno_accesso');
    },
  );

  it('il modulo del ritorno è compilato anche su Android, non solo sul desktop', () => {
    // La riga che è già sparita una volta dopo essere stata scritta.
    expect(LIB).toContain('#[cfg(any(desktop, target_os = "android"))]\nmod ritorno_accesso');
  });

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ► L'ESPORTAZIONE DI UN FILE, SUI DUE TELEFONI. ◄
   *
   * Segnalazione dal campo del 15 settembre 2026, Samsung Android: *«premendo
   * "Esporta PDF" compare "PDF salvato dove il sistema mette i download", ma il
   * file non compare né in Download né in Recenti né cercando tutti i PDF.»*
   *
   * Il file non c'era. Dentro una WebView il click su `<a download>` non
   * scarica niente e non lancia nessun errore — quindi l'interfaccia annuncia
   * un file che non esiste. `esporta_nei_documenti` è la via d'uscita, ed era
   * registrata **solo su iOS**: su Android il comando non c'era proprio, e il
   * lato TypeScript nemmeno lo chiamava.
   *
   * Vale per tutti e due i telefoni e per nessuno dei due computer: là la
   * WebView è collegata al gestore di scarichi del sistema e il download
   * funziona davvero.
   */
  it.each(PIATTAFORME.filter((p) => p.nome === 'iOS' || p.nome === 'Android'))(
    '$nome sa scrivere un file fuori dall’applicazione',
    ({ cfg }) => {
      expect(comandiPer(cfg)).toContain('esporta_nei_documenti');
    },
  );

  it.each(PIATTAFORME.filter((p) => p.nome === 'macOS' || p.nome === 'Windows'))(
    '$nome non ne ha bisogno: là il download del browser funziona',
    ({ cfg }) => {
      expect(comandiPer(cfg)).not.toContain('esporta_nei_documenti');
    },
  );

  /*
   * Il portachiavi è di Apple e la dipendenza `keyring` è dichiarata solo là:
   * registrare quei comandi altrove non darebbe «funzione assente», darebbe un
   * errore di compilazione su un modulo che non c'è. Questo test difende il
   * confine dalla parte in cui è facile sbagliare copiando un gestore.
   */
  it.each(PIATTAFORME.filter((p) => p.nome === 'Windows' || p.nome === 'Android'))(
    '$nome non prova a registrare il portachiavi di Apple',
    ({ cfg }) => {
      expect(comandiPer(cfg).join(' ')).not.toContain('segreti::');
    },
  );
});
