/**
 * Le righe che si leggono a schermo mentre un computer si scarica.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ STANNO QUI E NON DOVE VENGONO SCRITTE. ◄
 *
 * Un driver vive in `core`, dove la lingua non si sa: `t()` è roba
 * dell'interfaccia. Finché l'etichetta è una frase fissa il problema non c'è —
 * la si manda in italiano e l'interfaccia la cerca nel dizionario — ma appena
 * dentro c'è un numero la chiave cambia a ogni battito della barra e nel
 * dizionario non ci sarà mai:
 *
 *     `Ricevo la memoria del computer: 128 di 512 kB`
 *
 * È lo stesso difetto che ha lasciato novantuno frasi del piano di
 * miglioramento in italiano, e la cura è la stessa: **il modello viaggia con i
 * segnaposti, i numeri viaggiano a parte, e la frase si compone alla fine** —
 * con `frase()`, dove la lingua si conosce. Vedi `core/frase.ts`.
 *
 * ► E PERCHÉ SONO COSTANTI ESPORTATE INVECE DI STRINGHE SUL POSTO. ◄ Perché una
 * prova possa **scorrerle tutte** e pretendere che ognuna abbia la sua voce nel
 * dizionario, con gli stessi segnaposti in tutte e due le lingue. Scritte sul
 * posto sarebbero raggiungibili solo con una ricerca a espressioni regolari nel
 * sorgente, e quella non vede quella nuova che qualcuno aggiungerà domani.
 * *Il dizionario ha già una guardia che copre `t()` e `frase()`; questa è la
 * stessa idea per il canale che quella guardia non può vedere.*
 */

/** La memoria che arriva, con i kilobyte fatti e quelli totali. */
export const RICEVO_LA_MEMORIA = 'Ricevo la memoria del computer: {0} di {1} kB';

/**
 * Come sopra, quando il trasferimento è già stato ripreso almeno una volta.
 *
 * Due modelli e non uno con la coda opzionale: in inglese quella coda può
 * andare in un altro punto della frase, e chi traduce deve vedere la frase
 * intera per poterla spostare.
 */
export const RICEVO_LA_MEMORIA_RIPRESA = 'Ricevo la memoria del computer: {0} di {1} kB (ripresa {2})';

/** Il computer ha smesso di rispondere e si sta riaprendo il collegamento. */
export const RIAPRO_IL_COLLEGAMENTO = 'Il computer non risponde più: riapro il collegamento…';

/**
 * Tutte quante, per la prova che le confronta col dizionario.
 *
 * Una costante nuova che non finisce in questo elenco sfugge alla guardia: è il
 * solo punto debole del meccanismo, ed è scritto qui perché chi aggiunge la
 * prossima lo veda mentre lo fa.
 */
export const TESTI_DELL_AVANZAMENTO = [
  RICEVO_LA_MEMORIA,
  RICEVO_LA_MEMORIA_RIPRESA,
  RIAPRO_IL_COLLEGAMENTO,
] as const;
