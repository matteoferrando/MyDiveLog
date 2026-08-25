/**
 * «Quello che c'è scritto nel campo è diverso da quello che è in archivio?»
 *
 * ► IL DIFETTO CHE QUESTO FILE ESISTE PER NON FAR PIÙ RIPETERE. ◄ Un campo di
 * testo si salva quasi sempre NORMALIZZATO — qui: senza gli spazi ai bordi —
 * perché uno spazio in coda a un token o a un cognome non è un dato, è un
 * incidente del copia-e-incolla. Poi, per decidere se c'è qualcosa da salvare,
 * si confronta il campo con l'archivio. E lì si scriveva:
 *
 *     token !== salvato        // salvato era token.trim()
 *
 * cioè si normalizzava DA UN LATO SOLO. Con uno spazio in coda i due valori non
 * coincidono mai: il campo resta «modificato» per sempre. Su SyncPage.tsx questo
 * teneva «Sincronizza» disabilitato a vita — e incollare un token con uno spazio
 * in coda è la norma, non il caso limite — mentre sul nome del libretto teneva
 * acceso per sempre un pulsante «Salva» che non aveva più niente da salvare.
 * Nessuno dei due dice a schermo perché.
 *
 * ► LA REGOLA, CHE VALE OVUNQUE E NON SOLO QUI. ◄ **Normalizzare da un lato
 * solo del confronto È l'errore.** Non è un dettaglio da ricordare: è che un
 * confronto fra un valore grezzo e un valore già ripulito non risponde alla
 * domanda che chi lo scrive crede di aver fatto. Le forme corrette sono due, e
 * sono entrambe accettabili: si normalizzano TUTTI E DUE i lati, oppure NESSUNO
 * DEI DUE — e allora anche il salvataggio deve scrivere il valore grezzo. Quella
 * in mezzo non è un compromesso, è il difetto.
 *
 * Sta in una funzione e non ripetuta in ogni pagina proprio per questo: la
 * simmetria scritta una volta non si può rompere in un punto solo, e il giorno
 * che la normalizzazione cambia — un `toLowerCase()`, la larghezza unicode —
 * cambia per il salvataggio e per il confronto insieme.
 */

/**
 * La normalizzazione, in un posto solo.
 *
 * `undefined` e stringa vuota sono lo STESSO stato — «non c'è» — perché è così
 * che l'archivio li tratta: chi salva scrive `nome.trim() || undefined`, quindi
 * un campo svuotato torna indietro come `undefined` e confrontarlo con `''`
 * darebbe «modificato» su un campo che nessuno ha toccato.
 */
export const ripulisci = (v: string | null | undefined): string => (v ?? '').trim();

/**
 * Vero quando c'è davvero qualcosa da salvare.
 *
 * Chiamala su ENTRAMBI i valori — è tutto il punto: prende il grezzo e il
 * salvato e li porta sulla stessa forma prima di guardarli.
 */
export function campoModificato(digitato: string, salvato: string | null | undefined): boolean {
  return ripulisci(digitato) !== ripulisci(salvato);
}
