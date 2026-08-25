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
 * I comandi dentro il `generate_handler!` che segue un dato `#[cfg(...)]`.
 *
 * Si cerca la condizione ESATTA e si prende il blocco fino alla parentesi
 * quadra chiusa. Se un domani qualcuno riscrive quella condizione, questo test
 * non trova più il blocco e diventa rosso — che è il comportamento giusto: una
 * condizione cambiata è esattamente il momento in cui qualcuno deve guardare.
 */
function comandiPer(condizione: string): string[] {
  const i = LIB.indexOf(`#[cfg(${condizione})]`);
  expect(i, `nessun gestore con la condizione ${condizione}`).toBeGreaterThan(-1);
  const dopo = LIB.slice(i);
  // Il primo `]` del testo NON è quello giusto: è la parentesi che chiude
  // `#[cfg(...)]`. Si cerca a partire dall'apertura del macro, o si finisce a
  // leggere un blocco vuoto e a credere che non ci sia nessun comando.
  const apre = dopo.indexOf('generate_handler![');
  expect(apre, `dopo ${condizione} non c’è nessun generate_handler!`).toBeGreaterThan(-1);
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
