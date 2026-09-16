/**
 * Le frasi che un file passa al dizionario, lette dal suo sorgente.
 *
 * ► PERCHÉ ESISTE UN FILE APPOSTA. ◄ Questa estrazione la usano due prove che
 * fanno domande diverse — `pianoTradotto.test.ts` chiede se il piano di
 * miglioramento è tradotto per intero, `dizionario.test.ts` chiede se esiste
 * nell'applicazione una frase che passa da `t()` senza avere una voce — e una
 * copia per parte vorrebbe dire che il giorno in cui l'estrazione si sbaglia,
 * si sbaglia in un posto solo e l'altra prova continua a dire di sì.
 *
 * Non è un file di prova: non ha `describe` né `it`, e Vitest non lo raccoglie.
 */

/**
 * L'apertura di una chiamata che porta con sé una chiave di dizionario:
 * `t('…` oppure `frase(t, '…`, con le virgolette di un tipo o dell'altro —
 * prettier sceglie le doppie quando la frase contiene un apostrofo.
 *
 * ► E `traduci(`, CHE È LO STESSO TRADUTTORE CON UN ALTRO NOME. ◄ In
 * `ui/state.tsx` la funzione arriva da `useTraduciStabile()` e si chiama
 * `traduci`, perché lì dentro `t` è già il nome di altre cose. Per
 * l'estrazione era un nome sconosciuto, quindi diciassette frasi
 * dell'applicazione — fra cui il messaggio del PRIMO SCHERMO POSSIBILE,
 * l'archivio che non si apre — passavano dal dizionario senza che nessuna
 * prova potesse dire se la voce ci fosse. Il buco non si vedeva da nessuna
 * parte: in italiano il dizionario non si apre, e in inglese una frase non
 * tradotta esce corretta in italiano.
 *
 * *Due delle diciassette non avevano la voce, ed erano appena state scritte.*
 *
 * ► E ANCHE L'APICE INVERSO, CHE È IL MOTIVO PRINCIPALE PER CUI SI GUARDA. ◄
 * `t(`Consumo ${x} L/min`)` è la forma sbagliata — la chiave cambia a ogni
 * chiamata e nel dizionario non ci sarà mai — ed è esattamente quella che
 * l'estrazione deve trovare per poterla segnalare. Lasciando fuori l'apice
 * inverso, la prova che cerca le chiavi interpolate non poteva accendersi
 * nemmeno di fronte al difetto che è nata per prendere: è successo, si è visto
 * provandola, ed è la ragione per cui quel carattere è qui.
 */
const APERTURA = /(?:\bfrase\s*\(\s*(?:t|traduci)\s*,\s*|\b(?:t|traduci)\s*\(\s*)(['"`])/g;

/**
 * Il sorgente senza i commenti, e la quarta volta che questa lezione si ripete.
 *
 * ► COS'È SUCCESSO. ◄ Il 16 settembre 2026 `dizionario.test.ts` è diventata
 * rossa segnalando che la frase **«letterale»** non aveva una voce. Nessuno
 * l'aveva mai passata a `t()`: stava dentro un commento che SPIEGAVA questa
 * estrazione, e diceva testualmente che la guardia vede solo i `t('letterale')`.
 * *La prova ha letto la propria descrizione e l'ha scambiata per codice.*
 *
 * In questo progetto è la quarta volta, sempre nella stessa forma: una guardia
 * che legge il sorgente come testo finisce per trovare il commento che la
 * descrive. È già costato una prova rossa su una carta corretta
 * (`capitoliDelTelefono`), una regola di ordinamento cercata dentro il commento
 * che la spiegava, e una verifica sulle traduzioni che cercava la forma storica
 * del difetto invece del difetto.
 *
 * ► E NON È SOLO RUMORE. ◄ Il verso opposto è peggio e non si vede: un commento
 * che contenga `t('Salva')` fa passare per coperta una frase che nessuno ha
 * tradotto. Tolti i commenti, l'estrazione guarda il codice e basta.
 *
 * Le stringhe non si toccano: `//` dentro un indirizzo web è un caso normale in
 * questo progetto, e tagliare lì dentro produrrebbe chiavi mozzate — cioè
 * esattamente il difetto che `chiaviDi` esiste per non avere.
 */
function senzaCommenti(sorgente: string): string {
  let fuori = '';
  let apice = '';
  for (let i = 0; i < sorgente.length; i++) {
    const c = sorgente[i];
    if (apice) {
      fuori += c;
      if (c === '\\') {
        fuori += sorgente[i + 1] ?? '';
        i += 1;
      } else if (c === apice) apice = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      apice = c;
      fuori += c;
      continue;
    }
    if (c === '/' && sorgente[i + 1] === '*') {
      const fine = sorgente.indexOf('*/', i + 2);
      i = fine < 0 ? sorgente.length : fine + 1;
      continue;
    }
    if (c === '/' && sorgente[i + 1] === '/') {
      const fine = sorgente.indexOf('\n', i);
      i = fine < 0 ? sorgente.length : fine - 1;
      continue;
    }
    fuori += c;
  }
  return fuori;
}

/**
 * Legge il letterale a mano invece di fidarsi di un'espressione regolare fino
 * alle virgolette di chiusura: le frasi di questo progetto contengono apostrofi
 * sfuggiti (`\'`) e virgolette dentro virgolette, e una regolare avida o pigra
 * le taglierebbe nel posto sbagliato — restituendo chiavi che nel dizionario
 * non ci sono per un motivo che non ha niente a che fare col dizionario.
 */
export function chiaviDi(sorgente: string): string[] {
  /*
   * ► IL CODICE SENZA COMMENTI SI CALCOLA UNA VOLTA SOLA, e la prima stesura
   *   lo calcolava per cercare e poi leggeva dall'originale. ◄
   *
   * Gli indici delle due stringhe non coincidono — togliendo i commenti tutto
   * quello che viene dopo si sposta all'indietro — quindi la ricerca trovava
   * l'apertura nel posto giusto e il testo veniva letto da qualche centinaio
   * di caratteri più in là. Il risultato erano chiavi come « attorno all» e
   * mezzo commento sull'aggiornatore: *non un difetto trovato, un difetto
   * inventato dall'estrazione stessa.*
   */
  const codice = senzaCommenti(sorgente);
  const fuori: string[] = [];
  for (const m of codice.matchAll(APERTURA)) {
    const apice = m[1];
    let i = (m.index ?? 0) + m[0].length;
    let testo = '';
    while (i < codice.length) {
      const c = codice[i];
      if (c === '\\') {
        const dopo = codice[i + 1];
        testo += dopo === 'n' ? '\n' : dopo === 't' ? '\t' : dopo;
        i += 2;
        continue;
      }
      if (c === apice) break;
      testo += c;
      i += 1;
    }
    fuori.push(testo);
  }
  return fuori;
}
