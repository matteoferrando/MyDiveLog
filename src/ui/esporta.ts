/**
 * Portare un file fuori dall'applicazione.
 *
 * IL DIFETTO CHE QUESTO FILE CHIUDE. Ogni esportazione — backup JSON, UDDF,
 * byte grezzi del computer subacqueo, foglio del piano — aveva la sua copia
 * privata dello stesso helper: crea un `Blob`, crea un `<a download>`, clicca,
 * revoca l'URL. Sul desktop funziona. Dentro la WebView di un telefono quel
 * click **non scarica niente e non lancia nessun errore**: non c'è modo, dal
 * lato JavaScript, di accorgersi che è andata male.
 *
 * La conseguenza non era un file mancante, era una BUGIA: `download()` non può
 * fallire, quindi il `try` che lo avvolgeva arrivava sempre in fondo e
 * l'interfaccia scriveva «Backup scritto: 104 immersioni». Su una funzione che
 * esiste per rimettere in piedi l'archivio dopo un disastro, una falsa conferma
 * è il difetto peggiore che ci possa essere: costruisce fiducia in una copia
 * che non esiste.
 *
 * COSA FA ADESSO. Una funzione sola, che RESTITUISCE dove è finito il file,
 * oppure lancia, oppure dice che non è stato scritto niente perché nessuno ha
 * scelto dove. Tre esiti e non due — il terzo è arrivato con il selettore di
 * Android, e il commento su `EsportazioneAnnullata` racconta perché non poteva
 * essere ridotto agli altri due.
 *
 * Sui telefoni si passa dal motore Rust; sui computer e nel browser resta il
 * download, che è la strada giusta e funziona.
 */

import { inApp, suComputer, suIOS } from '../piattaforma';

/**
 * Le destinazioni possibili di un'esportazione, **come chiavi del dizionario**.
 *
 * ► PERCHÉ COSTANTI. ◄ Perché questa frase viene interpolata dentro un'altra
 * frase tradotta, in dieci punti diversi — «PDF salvato {dove}» — e nessuno dei
 * dieci poteva tradurla: `t()` vuole una stringa letterale per essere vista
 * dalla guardia del dizionario, e qui arriva una variabile. Con l'applicazione
 * in inglese si leggeva *«PDF saved dove il sistema mette i download»* e
 * *«Backup written dove il sistema mette i download: 42 dives»*.
 *
 * Esportate, una prova può scorrerle tutte e pretendere la voce inglese — la
 * stessa cura di `core/ble/avanzamentoTesti.ts` e `core/analysis/avvertenze.ts`.
 */
export const DOVE_SU_IPHONE = 'nell’app File, in «Sul mio iPhone → MyDiveLog»';
export const DOVE_NEI_DOWNLOAD = 'dove il sistema mette i download';
/**
 * ════════════════════════════════════════════════════════════════════════════
 * ► ANDROID: DUE SEGNALAZIONI DALLA STESSA PERSONA, A UN GIORNO DI DISTANZA. ◄
 *
 * **15 settembre 2026.** *«Premendo "Esporta PDF" compare "PDF salvato dove il
 * sistema mette i download", ma il file non compare né in Download né in
 * Recenti né cercando tutti i PDF.»*
 *
 * Il file non c'era. La frase in cima a questo file racconta il difetto — il
 * click su `<a download>` dentro una WebView non scarica niente e non lancia
 * niente — e lo raccontava **al passato**, perché era stato chiuso. *Chiuso su
 * iOS soltanto:* il ramo diceva `inApp() && suIOS()`, e la WebView di Android
 * si comportava come quella di Apple. *Una lezione imparata dentro un percorso
 * protegge quel percorso: finché non la si scrive anche nell'altro, il secondo
 * resta com'era.*
 *
 * **16 settembre 2026**, stessa persona, versione nuova:
 *
 *   *«Purtroppo il pdf non si genera ancora anche se è cambiato il messaggio.
 *    Forse perché si genera in una cartella che non risulta visibile se non da
 *    pc.»*
 *
 * La seconda frase è la diagnosi esatta, ed è arrivata da chi usa il programma
 * e non da qui. Il file adesso si scriveva davvero — ma in
 * `/storage/emulated/0/Android/data/<pacchetto>/files/Documents`, che è quello
 * che `document_dir()` vale su Android: da Android 11 **nessun gestore di file
 * può entrare in `Android/data`** (la vede solo un PC collegato via USB) e la
 * disinstallazione dell'applicazione la porta via. Avevamo smesso di mentire
 * senza ancora consegnare niente.
 *
 * ► ORA SI CHIEDE DOVE. ◄ Il motore apre il selettore di sistema
 * (`ACTION_CREATE_DOCUMENT`, lo Storage Access Framework): l'utente sceglie
 * Download, Drive, la scheda SD, quello che vuole. Da cui questa frase: la
 * destinazione non va più DESCRITTA, perché chi ha premuto l'ha appena scelta —
 * ed è l'unico caso in cui l'applicazione può dire dov'è il file con la
 * certezza di non sbagliare.
 */
export const DOVE_SCELTO_DA_TE = 'dove l’hai scelto tu';
/** Tutte e tre, per la prova che le confronta col dizionario. */
export const DESTINAZIONI = [DOVE_SU_IPHONE, DOVE_NEI_DOWNLOAD, DOVE_SCELTO_DA_TE] as const;

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL TERZO ESITO: NON SCRITTO, E NON È UN GUASTO. ◄
 *
 * Con il selettore di Android esiste un caso che prima non poteva esistere:
 * l'utente apre il selettore e lo chiude. Non c'è un file, e non c'è niente che
 * sia andato storto.
 *
 * Ridurlo agli altri due sarebbe sbagliato in tutte e due le direzioni:
 * dichiarare «PDF salvato» sarebbe la bugia che questo file esiste per
 * impedire; dichiarare «il PDF non è stato salvato, controlla lo spazio libero
 * e riprova» manderebbe a cercare un guasto che non c'è, il che è un modo più
 * lento di mentire.
 *
 * Quindi un tipo suo, che i chiamanti riconoscono con `annullata()` e a cui
 * rispondono con una riga sola. *La regola sta qui; i dieci punti che la usano
 * la instradano soltanto.*
 */
export class EsportazioneAnnullata extends Error {
  readonly annullata = true;
  constructor() {
    super(NON_SCELTO);
  }
}

/** La frase da mostrare quando il selettore si è chiuso senza una scelta. */
export const NON_SCELTO = 'Non hai scelto dove salvare: non è stato scritto niente.';

/** Vero se l'esportazione è stata annullata, e non fallita. */
export function annullata(err: unknown): err is EsportazioneAnnullata {
  return err instanceof EsportazioneAnnullata;
}

export interface EsitoEsportazione {
  /** Frase pronta da mostrare: «nell'app File…», «nei Download», «dove l'hai scelto tu». */
  dove: string;
  /**
   * Percorso completo, quando esiste.
   *
   * Su iPhone c'è ma NON si mostra: `/var/mobile/Containers/Data/Application/…`
   * non aiuta a trovare niente e sembra un errore. Su Android non c'è affatto —
   * la destinazione è un `content://…` che non significa niente per nessuno.
   * Resta perché è l'unica cosa che una segnalazione dal campo può citare.
   */
  percorso?: string;
  /** Il nome con cui il file è stato salvato. */
  nome?: string;
}

/**
 * La coda della frase: dove è finito il file.
 *
 * ► ESISTE PERCHÉ I POSTI CHE LA COMPONGONO SONO DIECI. ◄ Facevano tutti
 * `t(esito.dove)` e basta: il giorno in cui la frase ha dovuto dire qualcosa in
 * più — ed è successo — avrebbe voluto dire scriverlo dieci volte e
 * dimenticarlo in uno.
 */
export function frasePosizione(esito: EsitoEsportazione, t: (s: string) => string): string {
  return t(esito.dove);
}

/** Quello che il comando Rust risponde. Vedi `Esportato` in `src-tauri/src/lib.rs`. */
interface EsitoNativo {
  percorso?: string | null;
  nome?: string | null;
  annullato: boolean;
}

/**
 * Scrive un file di testo fuori dall'applicazione.
 *
 * @throws se la scrittura fallisce. È il punto di tutto: prima non poteva
 * fallire, e quindi non poteva nemmeno riuscire in modo verificabile.
 * @throws {EsportazioneAnnullata} se il selettore si è chiuso senza una scelta.
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
   * come quella di Apple — vedi `DOVE_SCELTO_DA_TE`. Il criterio giusto non è
   * «quale sistema», è **«c'è una finestra del browser che sa scaricare?»**: nel
   * browser sì, dentro l'applicazione no. Sul Mac e su Windows il download
   * funziona perché lì la WebView è collegata al gestore di scarichi del
   * sistema, ed è il motivo per cui `suComputer()` resta fuori da questo ramo.
   */
  if (inApp() && !suComputer()) {
    const { invoke } = await import('@tauri-apps/api/core');
    /*
     * Il tipo va fino in fondo, e su Android non è un dettaglio: il selettore
     * di sistema lo usa per decidere da quale cartella partire e con che
     * estensione salvare. Senza, un PDF finisce come «application/octet-stream»
     * e l'elenco dei PDF del telefono non lo trova — cioè di nuovo un file che
     * c'è e non si vede.
     */
    const esito = await invoke<EsitoNativo>('esporta_nei_documenti', { nome, tipo, contenuto });
    if (esito.annullato) throw new EsportazioneAnnullata();
    return {
      dove: suIOS() ? DOVE_SU_IPHONE : DOVE_SCELTO_DA_TE,
      percorso: esito.percorso ?? undefined,
      nome: esito.nome ?? undefined,
    };
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
  return { dove: DOVE_NEI_DOWNLOAD, nome };
}
