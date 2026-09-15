/**
 * Cancellare una voce da una raccolta che si sincronizza.
 *
 * ► IL DIFETTO, MISURATO. ◄ Attrezzatura, brevetti e piani di decompressione
 * salvati con un nome si fondono **per chiave**: ogni voce è un oggetto a sé, e
 * quando la stessa chiave esiste da due parti vince quella salvata più tardi. È
 * la regola giusta per chi ne aggiunge una su un dispositivo e una sull'altro:
 * nessuna sparisce.
 *
 * Ma una fusione per chiave **non ha nessuna nozione di cancellazione**: una
 * chiave che il locale non ha e il remoto sì viene riaggiunta e riscritta in
 * locale. Cancellare una muta, un brevetto o un piano era quindi impossibile con
 * la sincronizzazione accesa — tornava al primo giro, e il rapporto annunciava
 * pure un arricchimento mentre disfaceva una cancellazione. *E qui pesa più che
 * altrove:* l'attrezzatura è l'unico dato dell'archivio che esiste solo perché
 * qualcuno l'ha scritto a mano.
 *
 * ► PERCHÉ UNA LAPIDE E NON UN ELENCO A PARTE. ◄ Le immersioni cancellate hanno
 * un elenco di lapidi tutto loro, con la sua chiave, il suo giro di
 * sincronizzazione e la sua regola per non rimpallarsi (`Tombstone.spedita`).
 * Qui non serve niente di tutto questo: **la cancellazione è già una scrittura
 * come le altre.** Si lascia la voce dov'è, con una data di cancellazione e una
 * data di salvataggio fresca; la fusione per chiave la fa vincere sulla copia
 * viva dell'altro dispositivo, esattamente come farebbe una modifica. Zero righe
 * nuove nella sincronizzazione, zero chiavi nuove nell'archivio.
 *
 * *Il prezzo, dichiarato:* le raccolte non si accorciano mai. Sono decine di
 * voci scritte a mano in anni, non migliaia, e potarle vorrebbe dire far
 * risorgere quello che si è potato sul dispositivo rimasto spento più a lungo —
 * che è il difetto da cui siamo partiti.
 *
 * ► CHI VEDE LE LAPIDI. ◄ Nessuno, tranne l'archivio e la sincronizzazione.
 * L'interfaccia riceve l'elenco già filtrato da `soloVive`, così le decine di
 * punti che leggono l'attrezzatura non devono ricordarsi di niente — e non c'è
 * il rischio che uno se ne dimentichi e mostri una voce cancellata.
 */

/** Quello che una voce deve avere per poter essere cancellata e risincronizzata. */
export interface VoceConLapide {
  /** Quando è stata cancellata. Assente per le voci vive. */
  cancellataIl?: string;
  /** La data che la fusione per chiave confronta. */
  savedAt?: string;
}

/** Le voci vive: quelle senza lapide. */
export function soloVive<T extends VoceConLapide>(raccolta: readonly T[] | undefined): T[] {
  return (raccolta ?? []).filter((v) => !v.cancellataIl);
}

/**
 * L'elenco da ARCHIVIARE, dato quello che l'interfaccia ha in mano.
 *
 * `archiviata` è l'elenco vero, lapidi comprese; `vive` è quello che
 * l'interfaccia ha appena salvato, che le lapidi non le ha mai viste. Quello che
 * era vivo prima e adesso non c'è più è stato cancellato da qualcuno, e prende
 * la sua lapide.
 *
 * L'ordine dell'uscita è: prima le voci vive nell'ordine in cui arrivano —
 * perché è l'ordine che l'interfaccia ha deciso e che l'utente vede — poi le
 * lapidi, vecchie e nuove. *Una funzione che riordina quello che le passi fa
 * sembrare cambiato qualcosa che non è cambiato, e la sincronizzazione lo
 * spedisce.*
 */
export function conLapidi<T extends VoceConLapide>(
  archiviata: readonly T[] | undefined,
  vive: readonly T[],
  chiaveDi: (v: T) => string,
  adesso: string = new Date().toISOString(),
): T[] {
  const primaEranoVive = new Map(soloVive(archiviata).map((v) => [chiaveDi(v), v]));
  const restano = new Set(vive.map(chiaveDi));
  const lapidiVecchie = (archiviata ?? []).filter((v) => v.cancellataIl);
  const lapidiNuove = [...primaEranoVive.entries()]
    .filter(([k]) => !restano.has(k))
    // La data di salvataggio si rifà: è quella che la fusione confronta, e una
    // lapide con la data vecchia perderebbe contro la copia viva dell'altro
    // dispositivo — cioè non cancellerebbe niente.
    .map(([, v]) => ({ ...v, cancellataIl: adesso, savedAt: adesso }));
  return [...vive, ...lapidiVecchie, ...lapidiNuove];
}
