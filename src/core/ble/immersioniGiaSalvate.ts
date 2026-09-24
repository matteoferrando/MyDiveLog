/**
 * Quante immersioni già in archivio deve nominare la frase in cima alla
 * schermata di esito — una regola sola, pura, per poterla provare senza un
 * Bluetooth davanti.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ ESISTE: LA FRASE IN CIMA RACCONTAVA L'ULTIMO TENTATIVO. ◄
 *
 * Il 23 settembre 2026, da chi aveva un Aqualung i330R in mano: *«nonostante i
 * messaggi di errore ha caricato le immersioni»*. Con la 1.8.29 su un iPhone,
 * un tentativo aveva portato in archivio settantuno immersioni prima che il
 * collegamento cadesse; l'applicazione aveva riprovato da sola, e il tentativo
 * dopo non si era più collegato. La frase in cima alla schermata parlava di
 * quello — «Lo scarico si è interrotto. Non è stata salvata nessuna
 * immersione.» — e chi la leggeva ha creduto di non avere niente, con
 * settantuno immersioni nel logbook.
 *
 * Il dato giusto la schermata ce l'aveva: il riquadro sotto, «il computer ha
 * più immersioni di quante ne siano arrivate», contava 71, perché il punto
 * raggiunto si porta avanti fra i tentativi. La frase in cima si calcolava
 * invece sulle immersioni del giro corrente. *Due parti della stessa schermata
 * che raccontano due storie diverse: la prima la legge chiunque, la seconda
 * quasi nessuno.*
 *
 * ► LE SALVATE, NON LE ARRIVATE. ◄ La frase promette immersioni «ricevute e
 * salvate», quindi conta quelle che un tentativo ha davvero scritto in
 * archivio. Arrivate e salvate sono due cose diverse — col disco pieno arrivano
 * e non si salvano — ed è la stessa distinzione che fanno il segnalibro e
 * l'offerta di ripartire.
 */

/** Quello che si sa quando un tentativo finisce. */
export interface FineDelTentativo {
  /** Le immersioni arrivate in questo tentativo. */
  arrivate: number;
  /**
   * Le immersioni che un tentativo precedente della stessa sessione ha scritto
   * in archivio: il massimo fra i tentativi, assente se nessuno ne ha scritte.
   */
  salvatePrima?: number;
}

/**
 * Il numero da nominare, o `undefined` quando la frase del tentativo corrente
 * vale già per tutta la sessione.
 *
 * Solo quando QUESTO tentativo non ha portato niente: se ne ha portate, la
 * frase parla di quelle e non dice niente di falso; se non ne ha portate e un
 * tentativo prima sì, dire «nessuna» è il difetto del 23 settembre.
 */
export function immersioniGiaSalvate(fine: FineDelTentativo): number | undefined {
  if (fine.arrivate > 0) return undefined;
  const prima = fine.salvatePrima ?? 0;
  return prima > 0 ? prima : undefined;
}
