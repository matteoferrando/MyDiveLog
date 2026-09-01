/**
 * Quello che vale per tutte le prove, prima che comincino.
 *
 * ► IL MURO DI «act(...)». ◄ Una passata di `npm test` stampava **centinaia** di
 * righe uguali:
 *
 *     The current testing environment is not configured to support act(...)
 *
 * Una per ogni render dei test che montano componenti. Nessuna di quelle righe
 * segnalava un difetto: React chiede solo che l'ambiente si dichiari come
 * ambiente di prova, e nessuno gliel'aveva mai detto. Il costo però era vero, ed
 * è lo stesso dei quattordici avvisi di lint corretti l'1 settembre: **un output
 * che nessuno può leggere insegna a non leggere l'output.** In mezzo a quelle
 * righe c'erano, e ci sono, i messaggi veri — quello dell'archivio che rifiuta
 * di aprirsi, per esempio — e li copriva.
 *
 * `IS_REACT_ACT_ENVIRONMENT` è la bandiera che React legge per sapere di essere
 * dentro una prova: alzata, `act()` fa il suo mestiere — svuota la coda degli
 * effetti prima di restituire il controllo — invece di lamentarsi. Vale anche
 * per i test in ambiente Node, dove semplicemente non la guarda nessuno.
 */

declare global {
  // `var` e non `let`: in TypeScript è l'unico modo di dichiarare qualcosa
  // sull'oggetto globale. (Qui c'era anche un'eccezione per `no-var` — tolta,
  // perché quella regola in questo progetto non è accesa: una direttiva che non
  // spegne niente è rumore che sembra una precauzione.)
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export {};
