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
 * Legge il letterale a mano invece di fidarsi di un'espressione regolare fino
 * alle virgolette di chiusura: le frasi di questo progetto contengono apostrofi
 * sfuggiti (`\'`) e virgolette dentro virgolette, e una regolare avida o pigra
 * le taglierebbe nel posto sbagliato — restituendo chiavi che nel dizionario
 * non ci sono per un motivo che non ha niente a che fare col dizionario.
 */
export function chiaviDi(sorgente: string): string[] {
  const fuori: string[] = [];
  for (const m of sorgente.matchAll(APERTURA)) {
    const apice = m[1];
    let i = (m.index ?? 0) + m[0].length;
    let testo = '';
    while (i < sorgente.length) {
      const c = sorgente[i];
      if (c === '\\') {
        const dopo = sorgente[i + 1];
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
