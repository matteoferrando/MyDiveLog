/**
 * Portare un file fuori dall'applicazione.
 *
 * IL DIFETTO CHE QUESTO FILE CHIUDE. Ogni esportazione — backup JSON, UDDF,
 * byte grezzi del computer subacqueo, foglio del piano — aveva la sua copia
 * privata dello stesso helper: crea un `Blob`, crea un `<a download>`, clicca,
 * revoca l'URL. Sul desktop funziona. Dentro la WKWebView di iOS quel click
 * **non scarica niente e non lancia nessun errore**: non c'è modo, dal lato
 * JavaScript, di accorgersi che è andata male.
 *
 * La conseguenza non era un file mancante, era una BUGIA: `download()` non può
 * fallire, quindi il `try` che lo avvolgeva arrivava sempre in fondo e
 * l'interfaccia scriveva «Backup scritto: 104 immersioni». Su una funzione che
 * esiste per rimettere in piedi l'archivio dopo un disastro, una falsa conferma
 * è il difetto peggiore che ci possa essere: costruisce fiducia in una copia
 * che non esiste.
 *
 * COSA FA ADESSO. Una funzione sola, che RESTITUISCE dove è finito il file
 * oppure lancia. Su iOS scrive nella cartella Documenti dell'applicazione, che
 * grazie a `UIFileSharingEnabled` e `LSSupportsOpeningDocumentsInPlace`
 * (`src-tauri/Info.ios.plist`) compare nell'app File sotto «Sul mio iPhone →
 * MyDiveLog»: da lì il file si sposta, si condivide, si manda per email. Altrove
 * resta il download del browser, che è la strada giusta e funziona.
 *
 * Il valore di ritorno serve al chiamante per dire dov'è finito il file, che su
 * iPhone non è ovvio: senza quella frase l'utente cerca in Download e non trova
 * niente.
 */

import { inApp, suComputer, suIOS } from '../piattaforma';

/**
 * Le due destinazioni possibili di un'esportazione, **come chiavi del
 * dizionario**.
 *
 * ► PERCHÉ COSTANTI. ◄ Perché questa frase viene interpolata dentro un'altra
 * frase tradotta, in sei punti diversi — «PDF salvato {dove}» — e nessuno dei
 * sei poteva tradurla: `t()` vuole una stringa letterale per essere vista dalla
 * guardia del dizionario, e qui arriva una variabile. Con l'applicazione in
 * inglese si leggeva *«PDF saved dove il sistema mette i download»* e *«Backup
 * written dove il sistema mette i download: 42 dives»*.
 *
 * Esportate, una prova può scorrerle tutte e pretendere la voce inglese — la
 * stessa cura di `core/ble/avanzamentoTesti.ts` e `core/analysis/avvertenze.ts`,
 * che è il quarto caso della stessa forma in una settimana.
 */
export const DOVE_SU_IPHONE = 'nell’app File, in «Sul mio iPhone → MyDiveLog»';
export const DOVE_NEI_DOWNLOAD = 'dove il sistema mette i download';
/**
 * ════════════════════════════════════════════════════════════════════════════
 * ► ANDROID, E UNA SEGNALAZIONE DAL CAMPO CHE DICE ESATTAMENTE COSA SUCCEDEVA. ◄
 *
 * *«Premendo "Esporta PDF" compare "PDF salvato dove il sistema mette i
 * download", ma il file non compare né in Download né in Recenti né cercando
 * tutti i PDF.»* — Samsung Android, 15 settembre 2026.
 *
 * Il file non c'era. La frase in cima a questo file racconta il difetto —
 * dentro una WebView il click su `<a download>` **non scarica niente e non
 * lancia nessun errore**, quindi il `try` arriva in fondo e l'interfaccia
 * annuncia un file che non esiste — e lo racconta al passato, perché era stato
 * chiuso. *Chiuso su iOS soltanto.* Il ramo diceva `inApp() && suIOS()`, e la
 * WebView di Android si comportava come quella di Apple: stessa bugia, stesso
 * pulsante, altro telefono.
 *
 * *Una lezione imparata dentro un percorso protegge quel percorso: finché non
 * la si scrive anche nell'altro, il secondo resta com'era.* È la terza volta
 * che questa frase serve in due giorni — il segnalibro del Bluetooth, l'offerta
 * di ripartire, e adesso questa.
 *
 * ► PERCHÉ QUI IL PERCORSO SI MOSTRA E SU IPHONE NO. ◄ Su iPhone la
 * destinazione ha un nome che una persona può seguire: app File → Sul mio
 * iPhone → MyDiveLog. Su Android la cartella dell'applicazione non ha un nome
 * del genere, e «Download» è proprio il posto sbagliato in cui l'utente ha già
 * cercato. L'unica risposta utile è **il percorso esatto**, che il lato Rust
 * restituisce già.
 */
export const DOVE_SU_ANDROID = 'nella cartella dei documenti dell’app';
/** Tutte e tre, per la prova che le confronta col dizionario. */
export const DESTINAZIONI = [DOVE_SU_IPHONE, DOVE_NEI_DOWNLOAD, DOVE_SU_ANDROID] as const;

export interface EsitoEsportazione {
  /** Frase pronta da mostrare: «nell'app File, cartella MyDiveLog» o «nei Download». */
  dove: string;
  /** Percorso completo, quando esiste. */
  percorso?: string;
  /**
   * Se il percorso va DETTO a chi guarda, e non solo tenuto per il diario.
   *
   * Vero solo dove la destinazione non ha un nome che una persona possa
   * seguire — cioè su Android. Su iPhone il percorso è roba tipo
   * `/var/mobile/Containers/Data/Application/…`: non aiuta a trovare niente e
   * sembra un errore.
   */
  mostraPercorso?: boolean;
}

/**
 * La coda della frase: dove è finito il file, e — dove serve — con che percorso.
 *
 * ► ESISTE PERCHÉ I POSTI CHE LA COMPONGONO SONO OTTO. ◄ Facevano tutti
 * `t(esito.dove)` e basta: aggiungere il percorso avrebbe voluto dire scriverlo
 * otto volte e dimenticarlo in uno. Il commento qui sopra su `DOVE_SU_IPHONE`
 * dice già che questa frase viene interpolata in sei punti diversi — adesso
 * l'interpolazione la fa una funzione sola.
 */
export function frasePosizione(esito: EsitoEsportazione, t: (s: string) => string): string {
  const dove = t(esito.dove);
  return esito.mostraPercorso && esito.percorso ? `${dove}: ${esito.percorso}` : dove;
}

/**
 * Scrive un file di testo fuori dall'applicazione.
 *
 * @throws se la scrittura fallisce. È il punto di tutto: prima non poteva
 * fallire, e quindi non poteva nemmeno riuscire in modo verificabile.
 */
export async function esporta(
  nome: string,
  contenuto: string,
  tipo = 'application/xml;charset=utf-8',
): Promise<EsitoEsportazione> {
  /*
   * ► DENTRO L'APPLICAZIONE SI SCRIVE, FUORI SI SCARICA. ◄
   *
   * La condizione era `inApp() && suIOS()`, e la WebView di Android si comporta
   * come quella di Apple — vedi `DOVE_SU_ANDROID`. Il criterio giusto non è
   * «quale sistema», è **«c'è una finestra del browser che sa scaricare?»**: nel
   * browser sì, dentro l'applicazione no. Sul Mac e su Windows il download
   * funziona perché lì la WebView è collegata al gestore di scarichi del
   * sistema, ed è il motivo per cui `suComputer()` resta fuori da questo ramo.
   */
  if (inApp() && !suComputer()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const percorso = await invoke<string>('esporta_nei_documenti', { nome, contenuto });
    return suIOS()
      ? { dove: DOVE_SU_IPHONE, percorso }
      : { dove: DOVE_SU_ANDROID, percorso, mostraPercorso: true };
  }

  const blob = new Blob([contenuto], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { dove: DOVE_NEI_DOWNLOAD };
}
