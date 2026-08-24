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
   * I byte grezzi arrivati dal computer, uno per immersione.
   *
   * PERCHÉ SI TENGONO. Perché la prossima volta che qualcosa non torna — una
   * immersione che non si fonde con la stessa arrivata da file, un profilo che
   * finisce a metà, un modello nuovo — la domanda è sempre «cosa ha mandato il
   * computer davvero», e la risposta oggi richiede di riavere il computer in
   * mano, acceso, vicino, con la batteria carica. Salvati su file, quei byte si
   * rileggono qui dentro per sempre, e il difetto si riproduce in un test che
   * gira in un secondo.
   *
   * Non finiscono in archivio: vivono quanto la schermata dello scarico, e
   * escono solo se qualcuno preme «Salva i dati grezzi».
   */
  records: DownloadedRecord[];
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

/** Aspetta, ma si sveglia subito se lo scarico viene annullato. */
function pausa(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((risolvi) => {
    if (signal.aborted) return risolvi();
    const t = setTimeout(fine, ms);
    function fine() {
      clearTimeout(t);
      signal.removeEventListener('abort', fine);
      risolvi();
    }
    signal.addEventListener('abort', fine, { once: true });
  });
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
    /**
     * Il fuso in cui l'immersione è avvenuta, chiesto per la sua ora a parete.
     *
     * Arriva da fuori perché è l'unica cosa qui dentro che dipende
     * dall'ambiente: `src/core` non legge l'orologio del sistema. Quando manca,
     * i tempi restano come li scrive il computer — vedi `DecodeOptions`.
     */
    fuso?: (oraAParete: number) => number;
  } = {},
): Promise<DownloadOutcome> {
  const warnings: string[] = [];
  const records: DownloadedRecord[] = [];
  /** Quante immersioni il driver ha dichiarato illeggibili. Vedi `emit`. */
  let saltate = 0;
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
      /*
       * UN'IMMERSIONE SALTATA È UN BUCO, e il segnalibro non lo può scavalcare.
       *
       * `tutteDecodificate` confrontava solo quante immersioni sono uscite dalla
       * decodifica con quanti record sono arrivati — e un record SALTATO non
       * arriva affatto, quindi il conto tornava. Il segnalibro avanzava sopra
       * l'immersione che il computer non era riuscito a mandare, e alla
       * connessione successiva quel buco non veniva più offerto: persa per
       * sempre, con a schermo «scarico completo».
       */
      saltate++;
    }
    opts.onEvent?.(e);
  };

  let link: Awaited<ReturnType<BleTransport['open']>> | undefined;
  let errore: string | undefined;
  /*
   * L'elenco RESTITUITO dal driver, che non è l'elenco degli eventi.
   *
   * Gli eventi escono nell'ordine in cui le immersioni arrivano, che è l'ordine
   * del computer — e su un trasferimento ripreso a metà quell'ordine si
   * spezza: il driver Uwatec riparte dall'impronta dell'ultima ricevuta, quindi
   * il primo evento del secondo giro è più recente di tutti quelli del primo.
   * Prendere `records[0]` come segnalibro dava allora la seconda immersione più
   * recente, e tutto quello che veniva dopo di lei sarebbe sparito per sempre
   * al giro successivo.
   *
   * Il valore restituito è ordinato dal driver, dalla più recente alla più
   * vecchia: è quello che decide il segnalibro. Gli eventi restano la rete di
   * sicurezza per quando il driver muore a metà e non restituisce niente.
   */
  let ordinati: DownloadedRecord[] | undefined;

  try {
    const stato = await transport.available();
    if (stato !== true) throw new Error(stato.detail);

    emit({ kind: 'connecting' });
    link = await transport.open(device.id, driver.profile, ctl.signal);

    /*
     * Riaprire il collegamento, quando il driver lo chiede.
     *
     * `link` è una variabile e non una costante proprio per questo: il
     * riferimento vivo cambia, e il `finally` qui sotto deve chiudere l'ULTIMO,
     * non il primo. Chiudere quello sbagliato lascerebbe una sessione aperta
     * che tiene sveglio il computer finché non finisce la batteria.
     *
     * La pausa fra la chiusura e l'apertura non è scaramanzia: su CoreBluetooth
     * la disconnessione è asincrona, e riaprire nello stesso istante trova il
     * dispositivo ancora occupato dalla sessione precedente.
     */
    const riapri = async () => {
      trace('riapro il collegamento: il computer non risponde più su questa sessione');
      await link?.close().catch(() => undefined);
      link = undefined;
      await pausa(2000, ctl.signal);
      if (ctl.signal.aborted) throw new Error('annullato');
      link = await transport.open(device.id, driver.profile, ctl.signal);
      trace(`riaperto: MTU ${link.mtu}`);
      if (link.describe) trace(link.describe());
      return link;
    };

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
    ordinati = await driver.download(link, {
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
      riapri,
    });
    for (const r of ordinati) {
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
  /*
   * IL SEGNALIBRO NON PUÒ SCAVALCARE UNA IMMERSIONE CHE NON SI È CAPITA.
   *
   * `records[0]` è la più recente ARRIVATA, non la più recente DECODIFICATA. Se
   * proprio quella non si decodifica — un record troncato, un firmware con un
   * campo nuovo — il driver la trasforma in un avviso e lo scarico resta
   * `complete`: il segnalibro si sposterebbe sul suo orario, e da lì in poi il
   * computer non la offrirebbe MAI PIÙ. Al giro dopo direbbe «niente di nuovo»,
   * e l'immersione sarebbe persa senza che nessuno se ne accorga.
   *
   * Quindi: si avanza solo se OGNI record è diventato un'immersione. Il costo
   * di non avanzare è rileggere qualche minuto di memoria alla prossima
   * connessione; il costo di avanzare a sproposito è un'immersione che non
   * esiste più. Non è un pareggio.
   */
  let tutteDecodificate = saltate === 0;
  if (records.length) {
    try {
      const out = driver.decode(records, { fuso: opts.fuso });
      dives = out.dives;
      warnings.push(...out.warnings);
      tutteDecodificate = out.dives.length === records.length && saltate === 0;
      if (!tutteDecodificate) {
        const perse = records.length - out.dives.length + saltate;
        warnings.push(
          `${perse} ${perse === 1 ? 'immersione non si è potuta leggere' : 'immersioni non si sono potute leggere'}. ` +
            'Il punto di ripartenza non viene spostato, così alla prossima connessione il computer le ' +
            'ripropone: costa qualche minuto di lettura, ma non si perde niente.',
        );
      }
    } catch (err) {
      tutteDecodificate = false;
      warnings.push(
        `Le ${records.length} immersioni sono state scaricate ma non si sono potute decodificare: ` +
          `${err instanceof Error ? err.message : String(err)}.`,
      );
    }
  }

  const annullato = ctl.signal.aborted;
  const stato: DownloadOutcome['status'] = errore || annullato ? 'partial' : 'complete';
  const saltate2 = tracciaTotale - testa.length - coda.length;
  return {
    dives,
    warnings,
    /*
     * IL SEGNALIBRO ESISTE SOLO SU UNO SCARICO COMPLETO.
     *
     * L'interfaccia già lo salva solo con `status === 'complete'`, ma il campo
     * veniva popolato lo stesso su uno scarico interrotto: una trappola per il
     * prossimo che leggerà questo risultato, e il tipo di trappola che si scopre
     * quando qualcuno ha già perso delle immersioni. La condizione sta qui, una
     * volta sola, accanto al valore.
     */
    newestKey:
      stato === 'complete' && tutteDecodificate ? (ordinati?.[0]?.key ?? records[0]?.key) : undefined,
    records,
    trace: saltate2 > 0 ? [...testa, `… ${saltate2} righe non riportate …`, ...coda] : [...testa, ...coda],
    total,
    model,
    serial,
    firmware,
    /*
     * ANNULLARE NON È «COMPLETO», anche se nessuno ha sollevato un'eccezione.
     *
     * Un driver che vede il segnale di annullamento smette di leggere e
     * restituisce quello che ha: nessun errore, quindi lo scarico risultava
     * riuscito, quindi l'interfaccia salvava il segnalibro sull'immersione più
     * recente del manifesto — che è la PRIMA letta. Tutte quelle che venivano
     * dopo sparivano per sempre, e a schermo c'era scritto che era andato tutto
     * bene.
     *
     * È il difetto più costoso che questo file possa avere, perché la perdita è
     * silenziosa e definitiva. Il controllo sta qui e non nei driver apposta:
     * un driver nuovo non deve doverselo ricordare.
     */
    status: stato,
    error: errore ?? (annullato ? 'Scarico annullato: quello che era arrivato è stato salvato.' : undefined),
  };
}
