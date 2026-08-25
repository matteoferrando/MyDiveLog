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
import { fusoDelDispositivo } from '../core/oraAParete';
import type { Dive } from '../core/model';
import type { DownloadEvent } from '../core/ble/types';
import { isTauri } from './index';

/** Il nome dell'evento Tauri. Deve combaciare con `EVENTO` in `ponte_blec.rs`. */
const EVENTO = 'scarico-esterno';

export interface ScaricoEsterno {
  /** L'identificativo di sistema del dispositivo, da `BleFoundDevice.id`. */
  dispositivo: string;
  /** Marca e modello come li scrive libdivecomputer, dal catalogo. */
  marca: string;
  modello: string;
  emit: (e: DownloadEvent) => void;
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
  marca,
  modello,
  emit,
}: ScaricoEsterno): Promise<Dive[]> {
  if (!isTauri()) {
    /*
     * Nel browser non c'è né il guscio Rust né il Bluetooth. Dirlo qui, con
     * una frase, invece di lasciar fallire `invoke` con un errore di modulo
     * mancante: quello arriverebbe all'utente come una riga di JavaScript.
     */
    throw new Error(
      'Lo scarico dal computer subacqueo funziona nell’applicazione, non nel browser.',
    );
  }

  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');

  const spegni = await listen<DownloadEvent>(EVENTO, (evento) => emit(evento.payload));
  try {
    const grezze = await invoke<ImmersioneLdc[]>('scarica_da_computer_esterno', {
      dispositivo,
      marca,
      prodotto: modello,
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
