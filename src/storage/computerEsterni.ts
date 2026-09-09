/**
 * Lo scarico via libdivecomputer, dietro l'interfaccia che l'app già conosce.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * COSA FA, ED È POCO DI PROPOSITO.
 *
 * Chiama un comando del guscio Rust, ascolta gli eventi che quel comando
 * emette, e traduce quello che torna nel modello di casa. Tutto il resto —
 * aprire il collegamento, parlare il protocollo, accorpare i campioni — sta di
 * là, e la traduzione delle immersioni sta in `core/ble/esterni.ts`, dove si
 * prova senza hardware. Qui non c'è niente da provare perché non c'è niente da
 * sbagliare: è il punto in cui i due mondi si toccano, e va tenuto sottile
 * apposta.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ GLI EVENTI PASSANO DI QUI SENZA ESSERE TRADOTTI. ◄
 *
 * Il lato Rust emette già `{ kind: "record", done: 3, … }`, cioè esattamente
 * `DownloadEvent` di `core/ble/types.ts` — c'è un commento in
 * `ponte_blec.rs` che lo impone. Non è pigrizia condivisa: la scheda dello
 * scarico esiste già e mostra l'avanzamento dei due driver scritti in casa. Se
 * questa strada parlasse un secondo vocabolario, quella scheda andrebbe scritta
 * due volte, e le due copie divergerebbero al primo ritocco.
 *
 * L'unico evento che NON arriva è `identified`: per questa strada il modello lo
 * sceglie la persona da un elenco, e libdivecomputer non ce lo ripete indietro.
 * Emetterlo col nome scelto vorrebbe dire far dire al computer una cosa che non
 * ha detto — e nella scheda dell'immersione quel nome finisce in archivio.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * L'IMPORT È DINAMICO, come per il portachiavi e per il Bluetooth: nel bundle
 * web `@tauri-apps/api` non esiste, e un import statico lo trascinerebbe dentro
 * rompendo la build del browser.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► E QUANDO LA FUNZIONALITÀ NON È COMPILATA. ◄
 *
 * Il comando esiste sempre — c'è una seconda definizione, senza
 * `computer-esterni`, che risponde di no e dice perché. Non sparisce, perché un
 * comando assente produce «comando sconosciuto», che non spiega niente a
 * nessuno. Qui quel «no» arriva come un errore normale e va mostrato com'è: è
 * la verità, e la verità è che quella copia dell'applicazione libdivecomputer
 * dentro non ce l'ha.
 */

import { immersioniDaLdc, type ImmersioneLdc } from '../core/ble/esterni';
import type { CandidatoRiconosciuto } from '../core/ble/riconosci';
import { fusoDelDispositivo } from '../core/oraAParete';
import type { Dive } from '../core/model';
import type { DownloadEvent } from '../core/ble/types';
import { isTauri } from './index';

/** Il nome dell'evento Tauri. Deve combaciare con `EVENTO` in `ponte_blec.rs`. */
const EVENTO = 'scarico-esterno';

export interface ScaricoEsterno {
  /** L'identificativo di sistema del dispositivo, da `BleFoundDevice.id`. */
  dispositivo: string;
  /**
   * Il nome visto in scansione, da `BleFoundDevice.name`. Non è decorativo:
   * la famiglia Oceanic/Aqualung ci legge dentro il numero di serie per la
   * stretta di mano, e vuole quello pubblicitario — il guscio Rust lo
   * preferisce a quello che il plugin ha in cache. Vuoto è ammesso.
   */
  nome?: string;
  /** Marca e modello come li scrive libdivecomputer, dal catalogo. */
  marca: string;
  modello: string;
  /**
   * Il codice di accoppiamento conservato per QUESTO dispositivo, in
   * esadecimale, se ce n'è uno.
   *
   * Vale per la famiglia Pelagic (Aqualung i330R, Apeks DSX) e per nessun
   * altro: senza, il computer chiede il PIN a ogni scarico. Illeggibile non è
   * un errore da mostrare — il guscio riparte dal PIN e lo scrive nel diario —
   * perché fermare uno scarico per una preferenza storta bloccherebbe una
   * persona su un dato che può cancellare solo disinstallando.
   */
  codiceAccesso?: string;
  /**
   * «Prova il metodo numero N», contando da zero.
   *
   * Lo passa il pulsante «Riprova con un altro metodo» dopo un fallimento, ed
   * è l'unica cosa che distingue un secondo tentativo da una seconda identica
   * scommessa. Vince sul metodo conservato: chi lo preme sta dicendo proprio
   * che quello conservato non va.
   */
  tentativo?: number;
  /**
   * Il metodo che ha funzionato l'ultima volta con QUESTO computer.
   *
   * Vedi `core/metodo.ts`. Se non è più fra quelli possibili — il firmware
   * annuncia altri servizi — il guscio riparte dal primo e lo scrive nel
   * diario, invece di fermarsi.
   */
  metodo?: string;
  emit: (e: DownloadEvent) => void;
}

/**
 * La risposta alla richiesta del PIN. Vedi `DownloadEvent.pinRequired`.
 *
 * **Va chiamata sempre**, anche quando la persona rinuncia — allora con
 * `null`. Senza, lo scarico resta fermo dentro la libreria per tre minuti, e
 * un'applicazione che non risponde per tre minuti è un'applicazione rotta,
 * qualunque cosa stia facendo davvero.
 *
 * Non fallisce mai e non torna niente: una risposta che arriva quando nessuno
 * aspetta più — la finestra chiusa un istante dopo la scadenza — non è un
 * errore da mostrare a nessuno. Un guasto della chiamata si ignora per lo
 * stesso motivo: a quel punto lo scarico è già finito male per conto suo.
 */
export async function rispondiCodicePin(pin: string | null): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('rispondi_codice_pin', { pin });
  } catch {
    // Vedi sopra: qui non c'è niente da dire a nessuno.
  }
}

/**
 * I modelli che libdivecomputer riconosce da questo nome annunciato.
 *
 * È la domanda «di chi è questo nome?» fatta ai filtri di `descriptor.c`, gli
 * stessi con cui Subsurface propone il modello. La risposta è per costruttore
 * — per «Quad Ci» tornano tutti i Mares con il Bluetooth — e stringere sul
 * modello è compito di `proponi` in `core/ble/riconosci.ts`, che conosce il
 * catalogo e si prova senza guscio.
 *
 * ► VUOTO NON È UN ERRORE. ◄ Vuoto vuol dire: nel browser; oppure la copia è
 * compilata senza `computer-esterni` (il comando c'è e risponde con un elenco
 * vuoto); oppure un nome che nessun filtro reclama, che è il caso di un
 * auricolare. In tutti e tre i casi la schermata fa quello che faceva prima:
 * mostra il nome e chiede «Che computer è?». Per questo un guasto della
 * chiamata si tratta come un elenco vuoto e non si mostra: un riconoscimento
 * mancato costa un tocco in più, un riquadro rosso a ogni auricolare costa
 * la fiducia.
 */
export async function riconosciComputerEsterno(nome: string): Promise<CandidatoRiconosciuto[]> {
  if (!isTauri() || nome.trim() === '') return [];
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<CandidatoRiconosciuto[]>('riconosci_computer_esterno', { nome });
  } catch {
    return [];
  }
}

/**
 * Scarica, e restituisce le immersioni pronte per l'archivio.
 *
 * L'ordine è dalla più recente alla più vecchia, come per i driver scritti in
 * casa: il primo elemento diventa il segnalibro da cui ripartirà il prossimo
 * scarico, e un ordine diverso lo sposterebbe sull'immersione sbagliata.
 */
export async function scaricaDaComputerEsterno({
  dispositivo,
  nome,
  marca,
  modello,
  codiceAccesso,
  tentativo,
  metodo,
  emit,
}: ScaricoEsterno): Promise<Dive[]> {
  if (!isTauri()) {
    /*
     * Nel browser non c'è né il guscio Rust né il Bluetooth. Dirlo qui, con
     * una frase, invece di lasciar fallire `invoke` con un errore di modulo
     * mancante: quello arriverebbe all'utente come una riga di JavaScript.
     */
    throw new Error('Lo scarico dal computer subacqueo funziona nell’applicazione, non nel browser.');
  }

  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');

  const spegni = await listen<DownloadEvent>(EVENTO, (evento) => emit(evento.payload));
  try {
    const grezze = await invoke<ImmersioneLdc[]>('scarica_da_computer_esterno', {
      dispositivo,
      nome: nome && nome.trim() !== '' ? nome : null,
      marca,
      prodotto: modello,
      codiceAccesso: codiceAccesso && codiceAccesso.trim() !== '' ? codiceAccesso : null,
      // `null` e non `undefined`: un argomento indefinito sparisce dalla
      // serializzazione di Tauri, e il guscio non distingue «non me l'hai
      // passato» da «non ce l'ho» — che qui vogliono dire la stessa cosa, ma
      // per ragioni diverse e con messaggi di diario diversi.
      tentativo: tentativo ?? null,
      metodo: metodo && metodo.trim() !== '' ? metodo : null,
    });
    /*
     * IL FUSO SI CHIEDE QUI, non nel guscio Rust.
     *
     * `fusoDelDispositivo` legge l'orologio del dispositivo che sta scaricando
     * alla DATA dell'immersione, che è l'unico modo di prendere l'ora legale
     * di allora invece di quella di oggi. È la stessa funzione che usano i due
     * driver scritti in casa, e usarla anche qui è ciò che impedisce di
     * ripetere su altri cento modelli il difetto che il 24 agosto 2026 ha
     * fatto entrare due immersioni in archivio quattro volte.
     */
    return immersioniDaLdc(grezze, {
      marca,
      modello,
      dispositivo,
      fuso: fusoDelDispositivo,
      importedAt: new Date().toISOString(),
    });
  } finally {
    // Si spegne SEMPRE, anche quando lo scarico fallisce: un ascoltatore
    // dimenticato riceve gli eventi del tentativo successivo e li manda a una
    // schermata che non esiste più.
    spegni();
  }
}
