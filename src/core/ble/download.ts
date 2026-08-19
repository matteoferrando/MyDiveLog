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
  /**
   * Il diario tecnico: cosa è stato mandato e cosa è tornato, in ordine.
   *
   * Serve al primo tentativo con un computer vero, dove il protocollo
   * ricostruito quasi certamente sbaglia in un punto e il sintomo è sempre lo
   * stesso. È limitato: un archivio di cento immersioni produrrebbe decine di
   * migliaia di righe, e un diario che non si può incollare da nessuna parte
   * non serve a niente.
   */
  trace: string[];
  model?: string;
  serial?: string;
  firmware?: string;
  /**
   * L'impronta dell'immersione più recente arrivata: il prossimo segnalibro.
   *
   * Va salvato SOLO se lo scarico è finito per intero. Il manifesto si legge
   * dalla più nuova alla più vecchia, quindi salvarlo dopo uno scarico
   * interrotto direbbe «ho tutto fino alla più recente» avendo però perso
   * quelle in fondo — e quelle non tornerebbero mai più, perché il protocollo
   * non permette di ripartire da metà.
   */
  newestKey?: string;
}

export async function downloadFromComputer(
  transport: BleTransport,
  device: BleFoundDevice,
  driver: DiveComputerDriver,
  opts: {
    onEvent?: (e: DownloadEvent) => void;
    signal?: AbortSignal;
    /**
     * Il segnalibro da cui ripartire, chiesto una volta noto il seriale.
     *
     * Vedi `DiveComputerDriver.download`: è una funzione perché l'identità
     * stabile del computer è il suo seriale, e quello si sa solo dopo essersi
     * connessi.
     */
    since?: (identity: { serial?: string; model?: string }) => string | undefined;
  } = {},
): Promise<DownloadOutcome> {
  const warnings: string[] = [];
  const records: DownloadedRecord[] = [];
  /*
   * IL DIARIO SI TRONCA IN MEZZO, non alla fine.
   *
   * Le righe che servono sono le PRIME — dove il protocollo si presenta e
   * decide cosa fare — e le ULTIME, dove si è rotto. Quelle in mezzo sono
   * novantotto immersioni scaricate senza storia. Tenere solo le prime
   * duecento farebbe perdere l'errore; tenere solo le ultime farebbe perdere il
   * modello e la versione del firmware.
   */
  const TRACCIA_TESTA = 150;
  const TRACCIA_CODA = 150;
  const testa: string[] = [];
  const coda: string[] = [];
  let tracciaTotale = 0;
  const trace = (line: string) => {
    tracciaTotale++;
    if (testa.length < TRACCIA_TESTA) testa.push(line);
    else {
      coda.push(line);
      if (coda.length > TRACCIA_CODA) coda.shift();
    }
    opts.onEvent?.({ kind: 'trace', line });
  };
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
    trace(`aperto: ${device.name || 'senza nome'} (${device.id}), MTU ${link.mtu}`);
    if (link.describe) trace(link.describe());
    const restituiti = await driver.download(link, {
      emit,
      signal: ctl.signal,
      since: (identity) => {
        const s = opts.since?.(identity);
        trace(
          s
            ? `segnalibro per ${identity.serial ?? 'seriale ignoto'}: riparto da ${s}`
            : `nessun segnalibro per ${identity.serial ?? 'seriale ignoto'}: leggo tutta la memoria`,
        );
        return s;
      },
      trace,
    });
    for (const r of restituiti) {
      if (!records.some((x) => x.key === r.key)) records.push(r);
    }
  } catch (err) {
    errore = err instanceof Error ? err.message : String(err);
    trace(`ERRORE: ${errore}`);
    if (err instanceof Error && err.stack) trace(err.stack.split('\n').slice(1, 4).join(' | '));
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

  const saltate = tracciaTotale - testa.length - coda.length;
  return {
    dives,
    warnings,
    newestKey: records[0]?.key,
    trace: saltate > 0 ? [...testa, `… ${saltate} righe non riportate …`, ...coda] : [...testa, ...coda],
    total,
    model,
    serial,
    firmware,
    status: errore ? 'partial' : 'complete',
    error: errore,
  };
}
