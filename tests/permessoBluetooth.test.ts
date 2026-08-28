/**
 * Il permesso Bluetooth negato, e i nomi che non devono uscire dall'app.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO CHE HA FATTO NASCERE QUESTO FILE. ◄
 *
 * 28 agosto 2026. Il PRIMO utente esterno di MyDiveLog installa l'app
 * sull'iPhone, preme «Cerca il computer», e legge:
 *
 *     La ricerca non è partita: Btleplug error: Permission denied
 *
 * Aveva toccato «Non consentire» al pannello del Bluetooth — cosa che capita, e
 * che si sistema in dieci secondi **se qualcuno dice dove**. L'app invece gli ha
 * mostrato il nome di una libreria, in inglese, e lui ha concluso
 * ragionevolmente che fosse rotta.
 *
 * ► PERCHÉ NESSUN CONTROLLO POTEVA PRENDERLO, ed è la parte che vale. ◄ Non è
 * un errore di sintassi, non è un tipo sbagliato, non è un test mancante su una
 * funzione: è **codice che fa esattamente quello che c'è scritto**. Il ramo
 * diceva «stampa l'errore» e stampava l'errore. Per vederlo serviva un iPhone
 * su cui qualcuno avesse detto di no, e su tutti i telefoni di casa era stato
 * detto di sì una volta per sempre.
 *
 * Ed è peggio: il codice **affermava che quell'errore non potesse esistere**.
 * Due commenti — sopra `available()` in `storage/ble.ts` e sopra il riquadro dei
 * dodici secondi in `BleDownload.tsx` — deducevano dal sorgente del plugin che
 * il permesso negato fosse silenzioso. Vero per `checkPermissions` e per lo
 * stato dell'adattatore. Falso per `scan()`, che lancia. *Si guardavano i due
 * posti in cui l'informazione non c'era e non il terzo in cui c'era.*
 *
 * ► LA REGOLA CHE QUESTO FILE IMPONE, e che è più grande del difetto. ◄ Il nome
 * di una dipendenza non è un dettaglio di implementazione sfuggito: è una
 * CLASSE di difetti, e ne abbiamo visto un esemplare solo perché qualcuno ci ha
 * provato davvero. Un messaggio che finisce sotto gli occhi di una persona non
 * può contenere il nome di una libreria — chi legge non impara niente e non sa
 * cosa fare.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { causaDelGuasto, dettaglioLeggibile, NOMI_INTERNI } from '../src/core/ble/causaGuasto';
import { trasportoFinto } from '../src/ui/bluetoothFinto';

const leggi = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

describe('la causa di una ricerca fallita si legge dall’errore', () => {
  it('► riconosce ESATTAMENTE il messaggio che ha visto il primo utente ◄', () => {
    // Trascritto dalla schermata del 28 agosto 2026, non inventato.
    expect(causaDelGuasto(new Error('Btleplug error: Permission denied'))).toBe('denied');
  });

  it('riconosce le altre parole con cui i sistemi dicono la stessa cosa', () => {
    for (const m of [
      'Permission denied',
      'CBManager: not authorized',
      'Bluetooth unauthorized',
      'The operation was denied',
    ]) {
      expect(causaDelGuasto(new Error(m))).toBe('denied');
    }
  });

  it('riconosce l’adattatore spento, che ha un’altra risposta', () => {
    for (const m of ['Adapter is off', 'Bluetooth is off', 'Powered off']) {
      expect(causaDelGuasto(new Error(m))).toBe('off');
    }
  });

  it('quello che non sa, lo dichiara «non lo so» invece di indovinare', () => {
    /*
     * `unsupported` qui non vuol dire «non supportato»: è il caso in cui non si
     * è capito. Indovinare «denied» su un errore qualunque manderebbe una
     * persona a cercare un permesso già dato — un consiglio sbagliato è peggio
     * di nessun consiglio, perché fa perdere tempo con fiducia.
     */
    expect(causaDelGuasto(new Error('GATT operation failed'))).toBe('unsupported');
    expect(causaDelGuasto('qualcosa di inatteso')).toBe('unsupported');
  });
});

describe('il dettaglio tecnico mostrato a una persona', () => {
  it('perde il prefisso della libreria e tiene il messaggio del sistema', () => {
    expect(dettaglioLeggibile(new Error('Btleplug error: Device disconnected'))).toBe('Device disconnected');
  });

  it('► se non si può ripulire, non si mostra affatto ◄', () => {
    /*
     * La stringa vuota è una risposta, non un fallimento: l'interfaccia mostra
     * solo la frase umana. Meglio dire una cosa sola e chiara che due, di cui
     * una spaventa.
     */
    expect(dettaglioLeggibile(new Error('btleplug internal state corrupted'))).toBe('');
    expect(dettaglioLeggibile(new Error('Btleplug error:'))).toBe('');
  });
});

describe('► nessun nome interno arriva sotto gli occhi di chi usa l’app ◄', () => {
  it('l’elenco copre i livelli sotto l’interfaccia, e NON le dipendenze', () => {
    /*
     * ► QUESTO TEST PRIMA CHIEDEVA IL CONTRARIO, ED ERA SBAGLIATO. ◄
     *
     * Rileggeva `package.json` e pretendeva che ogni dipendenza fosse coperta.
     * È diventato rosso su `@garmin/fitsdk` — e aveva ragione il codice, non il
     * test: «garmin» nel nostro catalogo è una MARCA di computer subacquei, che
     * nominiamo apposta. Coprirla avrebbe voluto dire nascondere il nome di un
     * prodotto di cui parliamo all'utente.
     *
     * La regola vera è più stretta: si nascondono i nomi dei **livelli sotto
     * l'interfaccia**, i soli i cui errori risalgono fino a uno schermo.
     */
    expect(NOMI_INTERNI).toContain('btleplug'); // quello che ha bruciato
    expect(NOMI_INTERNI).toContain('tauri'); // il guscio nativo
    expect(NOMI_INTERNI).toContain('libsql'); // la sincronizzazione
    expect(NOMI_INTERNI).toContain('libdivecomputer'); // i driver di terzi

    // E non ci finisce quello che è un nome vero per chi legge.
    expect(NOMI_INTERNI).not.toContain('garmin');
    // Né quello che è troppo corto per cercarlo dentro le parole: «rust» c'era,
    // e si accendeva su «thrust» in una frase inglese del piano di miglioramento.
    expect(NOMI_INTERNI).not.toContain('rust');
  });

  it('nel dizionario non entra nessun nome di libreria, tranne due dichiarati', () => {
    /*
     * ► LE DUE ECCEZIONI SONO SCELTE, NON FUGHE. ◄ E vanno scritte qui, o fra
     * sei mesi qualcuno le «sistema» credendo di correggere una svista.
     *
     *  - **libdivecomputer** compare quattro volte, e tutte e quattro servono:
     *    nell'attribuzione della scheda Riconoscimenti, che la LGPL-2.1
     *    pretende sia visibile a chi riceve l'app, e nell'etichetta «via
     *    libdivecomputer, mai provato su questo modello» — che è una
     *    dichiarazione di onestà sotto un modello che non abbiamo mai provato,
     *    non un dettaglio sfuggito;
     *  - **SQLite** compare nella riga che dice dove stanno i dati.
     *
     * Tutti gli altri devono restare a zero, e oggi lo sono: misurato, non
     * supposto. Ma attenzione a cosa questo test NON dimostra: `btleplug` era
     * a zero nel dizionario anche il 28 agosto, mentre compariva a schermo.
     * Quel nome non passava di qui — arrivava dritto dalla libreria al riquadro
     * rosso. *Una guardia sul dizionario protegge le frasi che scriviamo noi,
     * non quelle che ci passano attraverso.*
     */
    const AMMESSI = new Set(['libdivecomputer', 'sqlite']);
    const dizionario = leggi('../src/ui/traduzioni.ts')
      .split('\n')
      .filter((r) => !r.trimStart().startsWith('//') && !r.trimStart().startsWith('*'))
      .join('\n')
      .toLowerCase();
    for (const nome of NOMI_INTERNI) {
      if (AMMESSI.has(nome)) continue;
      expect(dizionario.includes(nome), `«${nome}» è entrato nel dizionario`).toBe(false);
    }
  });

  it('il ramo che stampava l’errore grezzo non c’è più', () => {
    /*
     * La guardia più diretta che si possa scrivere per questo difetto: nel
     * punto in cui la ricerca fallisce non si interpola più `err.message` senza
     * passare da `dettaglioLeggibile`. Rimettendo la riga di prima, questo
     * diventa rosso — verificato.
     */
    const sorgente = leggi('../src/ui/components/BleDownload.tsx');
    const ricerca = sorgente.slice(
      sorgente.indexOf('const causa = causaDelGuasto(err)') - 2000,
      sorgente.indexOf("setStato({ fase: 'non-disponibile', motivo });"),
    );
    expect(ricerca).toContain('causaDelGuasto(err)');
    expect(ricerca).toContain('dettaglioLeggibile(err)');
    expect(ricerca).not.toMatch(/La ricerca non è partita'\)}: \$\{err instanceof Error/);
  });
});

/**
 * Un segnale che si annulla da solo dopo un istante.
 *
 * ► SERVE PERCHÉ ALTRIMENTI QUESTE GUARDIE DIVENTANO ROSSE IN TRENTA SECONDI. ◄
 * Provate a rovescio la prima volta — togliendo il `throw` dal finto — hanno
 * fallito per SCADENZA e non per asserzione: `scan()` per contratto non torna
 * finché non la si annulla, quindi senza l'errore restava lì. Rosso lo era, ma
 * dopo mezzo minuto e con scritto «test timed out», che non dice a chi legge
 * quale proprietà si sia rotta.
 *
 * Con un segnale che si arrende, la stessa rottura fallisce in un decimo di
 * secondo e dicendo la cosa giusta: la promessa si è risolta invece di
 * rifiutare. *Una guardia che si accende male insegna a non fidarsi di lei
 * quanto una che non si accende.*
 */
function segnaleCheSiArrende(dopoMs = 60): AbortSignal {
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), dopoMs);
  return ctl.signal;
}

describe('► il permesso negato adesso si può riprodurre senza un telefono ◄', () => {
  /*
   * Prima di questo modo, la schermata che il primo utente esterno ha visto
   * davvero si poteva soltanto descrivere. Un difetto che non si riproduce è un
   * difetto che torna: la prossima volta che quel ramo si rompe non se ne
   * accorge nessuno finché non lo tocca un altro estraneo.
   *
   * Il caso non passa da `available()` — il permesso negato su iPhone non lo
   * vede né lo stato dell'adattatore né `checkPermissions` — quindi il finto
   * doveva imparare a fallire nel punto giusto: dentro `scan()`, lanciando.
   */
  it('il trasporto finto fallisce la scansione col messaggio vero del plugin', async () => {
    const finto = trasportoFinto('negato');
    expect(await finto.available()).toBe(true); // il controllo preventivo dice di sì
    await expect(finto.scan(() => {}, segnaleCheSiArrende())).rejects.toThrow(/Permission denied/);
  });

  it('e quel messaggio viene classificato come «permesso negato»', async () => {
    /*
     * La prova che chiude il cerchio: il messaggio che il finto lancia è lo
     * stesso che la classificazione riconosce. Se un giorno divergessero — nel
     * finto o nel classificatore — questo test lo direbbe, ed è l'unico punto in
     * cui le due cose si guardano in faccia.
     *
     * ► SCRITTO COSÌ PERCHÉ LA PRIMA VERSIONE PASSAVA A VUOTO. ◄ Usava
     * `.catch(...)` con le asserzioni dentro: togliendo il `throw` dal finto la
     * promessa si risolveva, il ramo del `catch` non veniva eseguito, e il test
     * restava VERDE senza aver verificato niente. Se ne è accorto solo il giro
     * di mutazione — dove le rosse erano una invece di due.
     *
     * Adesso una risoluzione è un fallimento dichiarato: se la scansione non
     * lancia, il test lo dice con parole sue invece di tacere.
     */
    const finto = trasportoFinto('negato');
    const guasto = await finto
      .scan(() => {}, segnaleCheSiArrende())
      .then(
        () => {
          throw new Error('la scansione è finita senza lanciare: il permesso negato non è stato simulato');
        },
        (err: unknown) => err,
      );
    expect(causaDelGuasto(guasto)).toBe('denied');
    // E comunque vada la classificazione, il nome della libreria sparisce:
    // `dettaglioLeggibile` toglie il prefisso «Btleplug error: » e lascia solo
    // le parole del sistema operativo. Per il ramo `denied` l'interfaccia non
    // usa nemmeno questo — usa `permessoNegato()` — ma la proprietà vale su
    // qualunque strada l'errore prenda.
    expect(dettaglioLeggibile(guasto)).toBe('Permission denied');
    expect(dettaglioLeggibile(guasto).toLowerCase()).not.toContain('btleplug');
  });

  it('gli altri modi finti non lanciano: solo questo', async () => {
    // `vuoto` è una ricerca che non trova niente, non un errore. Confonderli è
    // esattamente quello che il commento di `bluetoothFinto.ts` diceva per
    // sbaglio prima del 28 agosto.
    const ctl = new AbortController();
    const vuoto = trasportoFinto('vuoto');
    ctl.abort();
    await expect(vuoto.scan(() => {}, ctl.signal)).resolves.toBeUndefined();
  });
});
