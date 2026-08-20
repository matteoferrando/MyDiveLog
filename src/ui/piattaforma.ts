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
export function suIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const p = navigator.platform ?? '';
  if (/iPhone|iPad|iPod/.test(p)) return true;
  return p === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
}
