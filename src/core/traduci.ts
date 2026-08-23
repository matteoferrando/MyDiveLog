/**
 * Chi traduce, visto da fuori dall'interfaccia.
 *
 * PERCHÉ UN FILE SUO E NON `model.ts`. `model.ts` dichiara il modello dei DATI —
 * un'immersione, un campione, una miscela — e la sua prima riga di commento
 * promette che non importa niente e che è condiviso senza modifiche fra le tre
 * piattaforme. Un tipo che parla di come il testo viene mostrato non è un dato
 * dell'immersione, e infilarcelo dentro trasformerebbe il file del modello nel
 * posto dove finisce tutto quello che non ha una casa. Due righe in un file loro
 * costano meno di quella deriva, e chi importa `Traduci` non si porta dietro il
 * modello.
 *
 * PERCHÉ STA IN `core` E NON IN `ui`. `src/core` non può importare da `src/ui`:
 * è il vincolo su cui è costruito tutto il progetto — il nucleo si prova senza
 * React e senza un browser. Ma i parser producono frasi che l'utente legge, e
 * quelle frasi devono poter diventare inglesi. Il tipo scende quindi nel nucleo,
 * e `src/ui/format.ts` lo riesporta perché l'interfaccia continui a chiederlo
 * dove se l'è sempre chiesto.
 *
 * COME SI USA. Ogni funzione che produce testo prende `t: Traduci = comeSta`
 * come ULTIMO parametro: chi non passa niente ottiene l'italiano — che è la
 * chiave del dizionario, quindi «non tradotto» e «tradotto in italiano» sono la
 * stessa cosa — e nessun chiamante esistente si rompe.
 */

export type Traduci = (s: string) => string;

/**
 * L'identità: la traduzione che non traduce.
 *
 * Sta qui una volta sola e non come `(s) => s` scritto in ogni firma, perché
 * ripetuta è una funzione nuova a ogni chiamata — irrilevante per il risultato,
 * fastidiosa per i confronti di identità che React fa sulle dipendenze.
 */
export const comeSta: Traduci = (s) => s;
