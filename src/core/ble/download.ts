/**
 * Lo scarico, dall'inizio alla fine, senza sapere che Bluetooth c'è sotto.
 *
 * Questa funzione è la sola cosa che l'interfaccia chiama. Prende un trasporto,
 * un dispositivo e un driver, e restituisce immersioni. Non importa niente di
 * Tauri: con il trasporto finto gira nei test, con quello vero gira su un Mac.
 *
 * Tre regole che vengono da come falliscono davvero questi scarichi.
 *
 * **Un'immersione illeggibile non ne ferma novantanove.** Le memorie dei
 * computer subacquei contengono record troncati — batteria finita a metà
 * scrittura, firmware aggiornato con un formato diverso, settori mai riscritti
 * dopo un reset. Fermarsi al primo significa non scaricare niente per colpa di
 * una immersione del 2019.
 *
 * **La disconnessione a metà non butta via quello che è arrivato.** Sono minuti
 * di trasferimento: quello che si è letto si tiene, si dice quanto manca, e si
 * riprende dopo. Un errore che azzera il lavoro fatto è il motivo per cui la
 * gente rinuncia e ricopia a mano.
 *
 * **Si chiude sempre.** Un collegamento BLE lasciato aperto tiene il computer
 * sveglio finché la batteria non finisce, e su alcuni modelli impedisce
 * all'app del costruttore di connettersi finché non li si spegne a mano.
 */

import type { Dive } from '../model';
import type {
  BleFoundDevice,
  BleTransport,
  DiveComputerDriver,
  DownloadEvent,
  DownloadedRecord,
} from './types';

export interface DownloadOutcome {
  /** Le immersioni decodificate. Può essere vuoto senza che sia un errore: memoria vuota. */
  dives: Dive[];
  /** Quello che è stato letto ma non capito, e ogni assunzione fatta strada facendo. */
  warnings: string[];
  /** Quante immersioni il computer diceva di avere, dove lo dice. */
  total?: number;
  /** Come si è chiuso: `partial` significa che i dati valgono ma non sono tutti. */
  status: 'complete' | 'partial';
  /** Presente solo se qualcosa è andato storto, anche a scarico parzialmente riuscito. */
  error?: string;
  model?: string;
  serial?: string;
  firmware?: string;
}

export async function downloadFromComputer(
  transport: BleTransport,
  device: BleFoundDevice,
  driver: DiveComputerDriver,
  opts: {
    onEvent?: (e: DownloadEvent) => void;
    signal?: AbortSignal;
    /** Chiave dell'ultima immersione già in archivio da questo computer. */
    since?: string;
  } = {},
): Promise<DownloadOutcome> {
  const warnings: string[] = [];
  const records: DownloadedRecord[] = [];
  let total: number | undefined;
  let model: string | undefined;
  let serial: string | undefined;
  let firmware: string | undefined;

  /*
   * Un controllore proprio, incatenato a quello di chi chiama.
   *
   * Serve per poter annullare dall'interno — alla disconnessione — senza
   * toccare il segnale del chiamante, che non è nostro. Il `finally` lo
   * scollega: un ascoltatore lasciato su un `AbortSignal` di lunga vita è una
   * perdita di memoria silenziosa, e qui il segnale può essere quello della
   * pagina intera.
   */
  const ctl = new AbortController();
  const propaga = () => ctl.abort(opts.signal?.reason);
  if (opts.signal) {
    if (opts.signal.aborted) propaga();
    else opts.signal.addEventListener('abort', propaga, { once: true });
  }

  const emit = (e: DownloadEvent) => {
    if (e.kind === 'counted') total = e.total;
    if (e.kind === 'identified') {
      model = e.model;
      serial = e.serial;
      firmware = e.firmware;
    }
    if (e.kind === 'record') records.push(e.record);
    if (e.kind === 'skipped') {
      warnings.push(`Immersione ${e.key} non letta: ${e.reason}`);
    }
    opts.onEvent?.(e);
  };

  let link: Awaited<ReturnType<BleTransport['open']>> | undefined;
  let errore: string | undefined;

  try {
    const stato = await transport.available();
    if (stato !== true) throw new Error(stato.detail);

    emit({ kind: 'connecting' });
    link = await transport.open(device.id, driver.profile, ctl.signal);

    /*
     * Il driver riceve gli eventi già emessi da lui, non i record.
     *
     * Così un driver che si interrompe a metà ha comunque consegnato tutto
     * quello che aveva letto fino a quel punto: se restituisse solo alla fine,
     * un'eccezione all'ottantesima immersione perderebbe le prime settantanove.
     * Il valore restituito serve ai driver che leggono la memoria in un colpo
     * solo, e viene usato solo per quello che non era già passato dagli eventi.
     */
    const restituiti = await driver.download(link, { emit, signal: ctl.signal, since: opts.since });
    for (const r of restituiti) {
      if (!records.some((x) => x.key === r.key)) records.push(r);
    }
  } catch (err) {
    errore = err instanceof Error ? err.message : String(err);
  } finally {
    opts.signal?.removeEventListener('abort', propaga);
    if (link) {
      // La chiusura non deve poter nascondere l'errore vero.
      await link.close().catch((err: unknown) => {
        warnings.push(`Chiusura del collegamento non riuscita: ${err instanceof Error ? err.message : err}`);
      });
    }
  }

  /*
   * Si decodifica ANCHE quando lo scarico è fallito.
   *
   * È il punto della regola sulla disconnessione a metà: quaranta immersioni
   * arrivate e poi il collegamento caduto valgono quaranta immersioni, non
   * zero. Se poi anche la decodifica cade, allora sì che non resta niente, e
   * quello si dice.
   */
  let dives: Dive[] = [];
  if (records.length) {
    try {
      const out = driver.decode(records);
      dives = out.dives;
      warnings.push(...out.warnings);
    } catch (err) {
      warnings.push(
        `Le ${records.length} immersioni sono state scaricate ma non si sono potute decodificare: ` +
          `${err instanceof Error ? err.message : String(err)}.`,
      );
    }
  }

  return {
    dives,
    warnings,
    total,
    model,
    serial,
    firmware,
    status: errore ? 'partial' : 'complete',
    error: errore,
  };
}
