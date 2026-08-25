/**
 * Con che locale si scrivono date, ore e numeri.
 *
 * ► IL DIFETTO CHE QUESTO FILE CHIUDE. ◄ Sparse per l'interfaccia c'erano una
 * dozzina di `toLocaleDateString('it-IT', …)`. Ognuna, presa da sola, sembrava
 * innocua — l'applicazione è scritta in italiano, l'italiano è il ripiego
 * ovunque. Messe insieme facevano una cosa sola: a chi aveva scelto EN la
 * schermata usciva mezza tradotta e mezza no, con le frasi in inglese e sopra
 * «domenica 12 luglio 2026». Il dizionario non poteva accorgersene, perché
 * quelle date non passano dal dizionario: le scrive ICU, e ICU obbedisce alla
 * stringa che gli si dà.
 *
 * ► PERCHÉ UN REGISTRO E NON UN PARAMETRO. ◄ La strada ovvia — aggiungere un
 * `locale` in coda a ogni firma, come il progetto già fa con `t: Traduci` — qui
 * non regge il conto. `t` sta in una decina di funzioni che producono FRASI;
 * `dateShort`, `dateLong`, `timeShort` e `int` sono chiamate da una quarantina
 * di punti in dieci file, quasi tutti dentro JSX, e passare il locale a ognuno
 * vorrebbe dire che ogni componente che mostra una data deve prima chiedere la
 * lingua. Il costo non è scrivere quaranta argomenti una volta: è che da domani
 * dimenticarne uno è di nuovo il difetto di prima, silenzioso come prima.
 *
 * E soprattutto: il locale NON È UN DATO DELLA CHIAMATA. È una preferenza sola,
 * di questo dispositivo, già custodita in un posto solo (`ui/lingua.tsx`, che la
 * tiene nel `localStorage`). Un valore che è globale per costruzione si modella
 * bene come globale; farlo viaggiare per quaranta firme sarebbe far finta che
 * possa essere diverso in due punti della stessa schermata, cosa che non
 * succede e non deve succedere.
 *
 * ► PERCHÉ NON UN HOOK. ◄ Perché `ui/format.ts` non è un componente React —
 * lo dice già il commento su `Traduci` — e lo usano anche i test e le
 * esportazioni, dove non esiste nessun contesto. Un `useLingua()` lì dentro non
 * si può scrivere; una funzione che legge una variabile di modulo sì, ovunque.
 *
 * ► PERCHÉ IN `core` E NON IN `ui`. ◄ Stessa ragione di `core/traduci.ts`:
 * `src/core` non può importare da `src/ui`, ma anche il nucleo scrive testo che
 * l'utente legge — `analysis/coaching.ts` mette una data dentro le frasi del
 * piano di miglioramento. Il registro scende qui e l'interfaccia lo alimenta.
 *
 * ► IL PREZZO, DETTO CHIARO. ◄ È uno stato mutabile di modulo, quindi due test
 * che lo cambiano nello stesso processo si vedono a vicenda. Il ripiego è
 * `it-IT`, cioè esattamente il comportamento di prima: chi non registra niente
 * — ogni test che non parla di lingue, ogni esportazione — non si accorge che
 * questo file esiste. Chi lo cambia in un test se lo rimette a posto.
 */

/**
 * Da lingua dell'interfaccia a locale BCP-47.
 *
 * `en-GB` e non `en-US`: giorno prima del mese e orologio a 24 ore, che è come
 * scrive le date il resto d'Europa ed è come le mostra il computer subacqueo da
 * cui quelle immersioni arrivano. Con `en-US` un'immersione del 7 dicembre
 * comparirebbe come «12/7» accanto a un profilo che segna le 14:30 come
 * «2:30 PM», e su un logbook la data ambigua non è un dettaglio di stile.
 */
export const LOCALE_DELLA_LINGUA = { it: 'it-IT', en: 'en-GB' } as const;

let corrente: string = LOCALE_DELLA_LINGUA.it;

/**
 * Dichiara con che locale si scrive da adesso in poi.
 *
 * Va chiamata quando la lingua viene DECISA, non in un effetto: un effetto gira
 * dopo il primo disegno, e siccome questo valore non è stato di React nessuno
 * ridisegnerebbe le date già scritte — chi apre l'app in inglese si terrebbe
 * una prima schermata con le date italiane finché non tocca qualcosa.
 */
export function registraLocale(locale: string): void {
  corrente = locale;
}

/** Il locale di adesso. `it-IT` finché nessuno dice altrimenti. */
export function localeCorrente(): string {
  return corrente;
}
