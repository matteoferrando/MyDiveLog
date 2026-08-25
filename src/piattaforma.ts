/**
 * Dove sta girando l'applicazione, per le poche volte in cui cambia la risposta.
 *
 * NON serve a decidere l'aspetto — quello lo decide la larghezza della finestra,
 * che è il criterio giusto e vale anche per un Mac ridotto a metà schermo. Serve
 * a dire la verità quando una funzione non ESISTE su una piattaforma, invece di
 * dare la colpa a qualcos'altro.
 *
 * Il caso concreto: la stampa. Passa da `window.open` più la stampa di sistema,
 * e su iPhone `window.open` restituisce `null` — non perché qualcuno l'abbia
 * bloccata, ma perché in una WKWebView non c'è nessuna finestra da aprire e su
 * iOS non esiste un dialogo di stampa come sul Mac. Il messaggio «il browser ha
 * bloccato l'apertura di una nuova finestra, consentila e riprova» manda a
 * cercare un'impostazione che non c'è.
 */

/** Vero dentro l'applicazione Tauri (macOS o iOS), falso in un browser. */
export function inApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Vero su iPhone o iPad.
 *
 * Si guarda `maxTouchPoints` oltre alla piattaforma perché su iPadOS Safari si
 * dichiara «MacIntel»: senza, un iPad verrebbe scambiato per un Mac.
 */
/**
 * Vero su un telefono Android.
 *
 * Si guarda la stringa dell'agente e non `navigator.platform`, che su Android
 * dice «Linux armv8l» — vero, inutile, e indistinguibile da un computer Linux.
 * «Android» invece nell'agente c'è sempre, ed è quello che tutti guardano.
 */
export function suAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent ?? '');
}

/**
 * Vero dentro l'applicazione su un COMPUTER — Mac o Windows — e falso sui
 * telefoni e nel browser.
 *
 * SERVE A UNA COSA SOLA, e vale la pena dire quale: l'aggiornamento automatico.
 * Quel plugin è compilato solo per i computer, quindi chiamarlo altrove non dà
 * «funzione assente», dà un comando sconosciuto — cioè un errore che non spiega
 * niente a chi lo legge.
 *
 * PERCHÉ NON SI CHIAMA PIÙ `suMac`. Perché si chiamava così, era scritta
 * «nell'app e non su iPhone», e per due mesi è stata giusta perché il Mac era
 * l'unico computer che avessimo. Il giorno che sono arrivati Windows e Android
 * è diventata vera su tutti e due — e su Android sbagliata, perché lì
 * l'aggiornamento automatico non c'è. **Una funzione il cui nome descrive un
 * caso e il cui corpo ne descrive un altro è una trappola che scatta da sola**
 * appena il mondo si allarga.
 */
export function suComputer(): boolean {
  return inApp() && !suIOS() && !suAndroid();
}

export function suIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const p = navigator.platform ?? '';
  if (/iPhone|iPad|iPod/.test(p)) return true;
  return p === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
}
