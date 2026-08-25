/**
 * Che cosa dichiarare nell'attributo `accept` del selettore dei file.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUESTO FILE ESISTE PER UN CRASH IN REVISIONE APPLE, 25 agosto 2026.
 *
 * Il revisore ha aperto la scheda Importa, ha toccato il pulsante, e nel menu
 * che è comparso ha scelto **«Take Photo or Video»**. L'applicazione è morta.
 * Dal rapporto di crash, alla lettera:
 *
 *     namespace: TCC
 *     "This app has crashed because it attempted to access privacy-sensitive
 *      data without a usage description. The app's Info.plist must contain an
 *      NSCameraUsageDescription key..."
 *
 * Non è un difetto del nostro codice: è iOS che termina il processo. E la
 * catena parte da una riga scritta il giorno prima.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COME CI SIAMO ARRIVATI, perché è una lezione più della correzione.
 *
 * 1. `accept` conteneva l'elenco delle estensioni: `.uddf`, `.ssrf`, `.fit`…
 *    Su iOS l'app File non ragiona per estensioni ma per UTI, e quei formati
 *    un UTI dichiarato non ce l'hanno: nel selettore i file risultavano non
 *    selezionabili. Difetto vero, sulla porta d'ingresso dell'applicazione.
 *
 * 2. La correzione è stata **togliere `accept`**. Il file si sceglieva, sì. Ma
 *    senza `accept` la WKWebView non sa più che tipi accetti, quindi assume
 *    QUALUNQUE cosa — comprese foto e video — e offre il menu completo:
 *    Libreria foto, Scatta foto o video, Scegli file.
 *
 * 3. Il ramo della fotocamera chiede l'accesso all'hardware. Senza
 *    `NSCameraUsageDescription` nel plist, il sistema non mostra un errore:
 *    **uccide il processo**. È il comportamento voluto da Apple, ed è giusto.
 *
 * Togliere una restrizione ha aperto una porta che non sapevamo esistesse. Il
 * difetto vecchio impediva di scegliere un file; quello nuovo faceva morire
 * l'applicazione. La seconda è peggio della prima.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA CORREZIONE, E PERCHÉ NON È «AGGIUNGERE IL PERMESSO».
 *
 * La strada breve sarebbe dichiarare `NSCameraUsageDescription` e chiudere il
 * crash. È sbagliata due volte: chiederebbe all'utente un permesso per una
 * funzione che non esiste — questa applicazione con la fotocamera non c'entra
 * niente — e smentirebbe quello che abbiamo dichiarato ad Apple nelle note per
 * la revisione, cioè che il Bluetooth è l'unico permesso che l'app chiede mai.
 * Una promessa mantenuta vale più di un crash chiuso in fretta.
 *
 * La strada giusta è dire a iOS che i media non ci interessano. Quando fra i
 * tipi accettati non compaiono immagini né video, il menu non viene proposto
 * affatto: si apre direttamente il browser dei file. Niente fotocamera da
 * toccare, e un tocco in meno per chi importa davvero.
 *
 * `application/octet-stream` corrisponde all'UTI `public.data`, a cui
 * qualunque file conforma: nel browser non c'è niente in grigio, che era il
 * problema di partenza. Fa le due cose insieme, ed è il motivo per cui è
 * questo il valore e non un elenco di estensioni.
 */

/**
 * @param iOS vero dentro la WKWebView di iPhone e iPad.
 * @param estensioni l'elenco dei formati riconosciuti, per il desktop.
 */
export function accettaFile(iOS: boolean, estensioni: readonly string[]): string {
  /*
   * Sul desktop l'elenco delle estensioni resta, ed è utile: nel dialogo di
   * sistema i file che non c'entrano finiscono in grigio, il che aiuta a
   * trovare quello giusto in una cartella piena. Là le estensioni funzionano,
   * perché macOS e Windows filtrano per estensione e non per UTI.
   */
  return iOS ? TIPO_QUALUNQUE_FILE : estensioni.join(',');
}

/**
 * Un tipo che vuol dire «un file, uno qualunque» — e soprattutto NON un media.
 *
 * Se un giorno qualcuno volesse restringere davvero i tipi su iOS, la strada
 * NON è rimettere le estensioni: è dichiarare gli UTI in `Info.ios.plist`
 * (`UTExportedTypeDeclarations`) così che il sistema sappia cosa sono. Finché
 * non esistono, qualunque restrizione qui rende i file non selezionabili.
 */
export const TIPO_QUALUNQUE_FILE = 'application/octet-stream';

/**
 * Vero se questo `accept` può far comparire la fotocamera o la libreria foto.
 *
 * Serve al test: è la condizione esatta che ha fatto morire l'applicazione in
 * revisione, e va guardata da qualcosa che non sia un revisore di Apple.
 */
export function puoAprireLaFotocamera(accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === '') return true;
  return /image\/|video\/|\.jpe?g|\.png|\.heic|\.mov|\.mp4/i.test(accept);
}
