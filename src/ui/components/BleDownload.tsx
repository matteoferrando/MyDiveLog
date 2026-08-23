/**
 * Scaricare le immersioni dal computer subacqueo.
 *
 * Il pezzo di interfaccia più esposto al fallimento di tutta l'applicazione:
 * dipende da un adattatore radio, da un permesso di sistema, da un dispositivo a
 * batteria che si addormenta, e da un protocollo che nessun costruttore
 * documenta. Quindi è scritto al contrario del solito — prima i modi in cui va
 * male, poi il caso in cui va bene.
 *
 * TRE COSE CHE NON SONO ESTETICHE.
 *
 * *Ogni causa di indisponibilità ha un rimedio diverso*, e un solo «Bluetooth non
 * disponibile» li nasconderebbe tutti: il browser non si aggiusta, l'adattatore
 * spento sì con un interruttore, il permesso negato nelle Impostazioni di
 * Sistema. Il messaggio dice quale delle tre.
 *
 * *I dispositivi che non sappiamo leggere restano nell'elenco*, in fondo e
 * dichiarati. Nasconderli è la scelta che sembra pulita e che fa perdere un'ora:
 * chi ha un computer non supportato deve poter vedere che l'app lo TROVA e non
 * lo sa leggere, che è un'informazione diversa da «non lo trova».
 *
 * *Uno scarico interrotto conserva quello che è arrivato.* Sono minuti di
 * trasferimento; un errore che azzera il lavoro fatto è il motivo per cui la
 * gente rinuncia e ricopia a mano. Qui l'interruzione produce «ne ho prese 40 su
 * 104» e le importa comunque.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadFromComputer } from '../../core/ble/download';
import { DRIVERS, recognise, type RecognisedDevice } from '../../core/ble/registry';
import { markerKey, type BleTransport, type BleUnavailable, type DownloadEvent } from '../../core/ble/types';
import { TauriBleTransport } from '../../storage/ble';
import { esporta } from '../esporta';
import { suIOS } from '../../piattaforma';
import { useDiveLog } from '../state';
import { useLingua, useTraduciStabile } from '../lingua';
import type { DownloadMarker } from '../../core/ble/types';
import { dateShort, imm, plural } from '../format';

type Stato =
  | { fase: 'iniziale' }
  | { fase: 'non-disponibile'; motivo: BleUnavailable }
  | { fase: 'cerca' }
  | {
      fase: 'scarica';
      nome: string;
      fatte: number;
      totale?: number;
      passo: string;
      /** Avanzamento a byte, per i protocolli che scaricano la memoria in blocco. */
      byte?: { fatti: number; totali: number };
    }
  | {
      fase: 'finito';
      testo: string;
      avvisi: string[];
      parziale: boolean;
      diario: string[];
      /** I byte grezzi, per poterli salvare su file. Vedi `salvaGrezzi`. */
      grezzi?: {
        driver: string;
        model?: string;
        serial?: string;
        firmware?: string;
        records: { key: string; base64: string }[];
      };
    };

/** Byte → base64, senza dipendenze e senza far esplodere lo stack sui blocchi grandi. */
function byteInBase64(b: Uint8Array): string {
  let s = '';
  // A pezzi: `String.fromCharCode(...tuttiIByte)` su un blocco da centomila
  // elementi supera il limite di argomenti e getta un errore che sembra un
  // guasto della memoria.
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
}

export function BleDownload() {
  const { importDives, bleMarkers, saveBleMarker, forgetBleMarker } = useDiveLog();
  const { t } = useLingua();
  /*
   * IL TRASPORTO È UNO SOLO, e sa tradurre i propri errori.
   *
   * Stava fuori dal componente, costruito all'import del modulo: lì la lingua
   * non esiste ancora. Ora nasce qui, una volta sola — `useTraduciStabile()`
   * non cambia mai identità, quindi `useMemo` non lo ricostruisce mai — e la
   * traduzione che riceve rilegge la lingua di adesso a ogni chiamata, non
   * quella del momento in cui l'oggetto è stato creato.
   */
  const traduci = useTraduciStabile();
  const vero = useMemo(() => new TauriBleTransport(traduci), [traduci]);
  /*
   * IL BLUETOOTH FINTO, E PERCHÉ LA BANDIERA È DI COMPILAZIONE.
   *
   * Le schermate dello scarico — l’elenco dei dispositivi, l’avanzamento, il
   * computer che si scollega a metà, l’esito — esistono soltanto quando una
   * ricerca Bluetooth trova qualcosa, e nel browser il Bluetooth non c’è.
   * Nessun controllo automatico poteva vederle, ed è lì che è passato il
   * difetto arrivato fino all’utente: l’elenco che si trascinava di lato su
   * iPhone. Compilando con `VITE_FINTO_BLUETOOTH=1`, al posto del trasporto
   * vero ne arriva uno finto con dentro quattro computer, e
   * `npm run schermate:ble` le fotografa e le misura.
   *
   * La bandiera è di COMPILAZIONE e non un interruttore, perché un finto
   * computer subacqueo raggiungibile in una build di produzione immetterebbe
   * immersioni inventate nell’archivio di qualcuno — e in un logbook è il
   * difetto peggiore che ci sia. `import.meta.env.VITE_FINTO_BLUETOOTH` è una
   * costante alla compilazione: senza la bandiera questa condizione è falsa
   * per sempre, il ramo è codice morto e Rollup butta via l’`import()`
   * insieme a tutto quello che raggiunge. Non «c’è ma non si arriva»: non
   * c’è. Vedi `src/ui/bluetoothFinto.ts`.
   *
   * Arriva DOPO il primo disegno, perché un `import()` è asincrono: fino a
   * che non è caricato si usa il trasporto vero, che nel browser risponde
   * «non disponibile». È un istante, e comunque prima che si prema qualcosa.
   */
  const [finto, setFinto] = useState<BleTransport | null>(null);
  useEffect(() => {
    if (import.meta.env.VITE_FINTO_BLUETOOTH !== '1') return;
    let vivo = true;
    void import('../bluetoothFinto').then((m) => {
      if (vivo) setFinto(m.trasportoFinto());
    });
    return () => {
      vivo = false;
    };
  }, []);
  const transport = finto ?? vero;
  const [stato, setStato] = useState<Stato>({ fase: 'iniziale' });
  const [trovati, setTrovati] = useState<RecognisedDevice[]>([]);
  const [copiato, setCopiato] = useState(false);
  /*
   * L'esito del salvataggio dei grezzi si DICHIARA.
   *
   * Il pulsante non diceva niente in nessuno dei due casi, e su iPhone il
   * salvataggio non avveniva affatto: si premeva, non succedeva niente, e
   * l'unica interpretazione possibile era che il pulsante fosse rotto. Ora dice
   * dove è finito il file — che su iPhone è l'app File, non i Download.
   */
  const [salvataggio, setSalvataggio] = useState<string | null>(null);
  /** Vero quando la ricerca è in corso da un po' e non ha ancora trovato niente. */
  const [aLungoSenzaNulla, setALungoSenzaNulla] = useState(false);
  /*
   * «Riscarica tutto» è spento per difetto, e deve esistere.
   *
   * Il segnalibro può solo AVANZARE — il manifesto si legge dalla più recente
   * alla più vecchia e ci si può fermare solo in cima — quindi una volta
   * spostato in avanti non c'è modo di tornare indietro chiedendo al computer.
   * Se qualcosa va storto (un'immersione cancellata per sbaglio, un archivio
   * ricostruito da zero) senza questa casella l'unico rimedio sarebbe modificare
   * un'impostazione a mano.
   */
  const [tuttoDaCapo, setTuttoDaCapo] = useState(false);
  /*
   * I segnalibri SVUOTATI non si mostrano.
   *
   * «Dimentica» non cancella la riga: la svuota, perché una riga cancellata
   * tornerebbe indietro dall'altro dispositivo alla prima sincronizzazione (vedi
   * `forgetBleMarker`). Chi guarda però deve vedere quello che vede da sempre —
   * niente riga — altrimenti «Dimentica» sembrerebbe non aver funzionato.
   */
  const segnalibri = Object.entries(bleMarkers).filter(([, m]) => m.fingerprint);
  const ricerca = useRef<AbortController | null>(null);
  const scarico = useRef<AbortController | null>(null);

  /*
   * La ricerca si ferma smontando il componente.
   *
   * Una scansione BLE lasciata accesa consuma batteria — sul portatile si
   * sente — e continua a chiamare `setState` su un componente che non c'è più.
   * Cambiare scheda mentre si cerca è la cosa più naturale del mondo.
   */
  useEffect(() => {
    return () => {
      ricerca.current?.abort();
      scarico.current?.abort();
    };
  }, []);

  /*
   * Il contatore dei dodici secondi vive qui, legato alla fase.
   *
   * In un effetto e non dentro `cerca` perché deve azzerarsi quando la ricerca
   * riparte, quando si ferma, e quando un dispositivo compare — tre uscite
   * diverse che un `setTimeout` sparso dentro la funzione dimenticherebbe.
   */
  useEffect(() => {
    if (stato.fase !== 'cerca' || trovati.length > 0) {
      setALungoSenzaNulla(false);
      return;
    }
    // `attesa` e non `t`: in questo file `t` è la traduzione, e un timer che le
    // ruba il nome dentro un effetto è una trappola che scatta il giorno in cui
    // qualcuno aggiunge qui una frase da tradurre.
    const attesa = setTimeout(() => setALungoSenzaNulla(true), 12_000);
    return () => clearTimeout(attesa);
  }, [stato.fase, trovati.length]);

  const cerca = useCallback(async () => {
    const disponibile = await transport.available();
    if (disponibile !== true) {
      setStato({ fase: 'non-disponibile', motivo: disponibile });
      return;
    }
    const ctl = new AbortController();
    ricerca.current = ctl;
    setTrovati([]);
    setStato({ fase: 'cerca' });
    try {
      await transport.scan((devs) => setTrovati(recognise(devs, DRIVERS)), ctl.signal);
    } catch (err) {
      setStato({
        fase: 'non-disponibile',
        motivo: {
          reason: 'unsupported',
          detail: `${t('La ricerca non è partita')}: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
  }, [transport, t]);

  /*
   * Stabile fra un render e l'altro, e senza leggere `stato`.
   *
   * Serve dentro `scarica`, che è memorizzata: una funzione ricreata a ogni
   * render la invaliderebbe di continuo. E l'aggiornamento passa dalla forma
   * funzionale di `setStato` invece di leggere `stato` dalla chiusura — così
   * non c'è una dipendenza da uno stato che cambia, e soprattutto non si può
   * riportare la fase a «iniziale» partendo da una lettura vecchia, che
   * cancellerebbe dallo schermo uno scarico appena partito.
   */
  const fermaRicerca = useCallback(() => {
    ricerca.current?.abort();
    ricerca.current = null;
    setStato((p) => (p.fase === 'cerca' ? { fase: 'iniziale' } : p));
  }, []);

  const scarica = useCallback(
    async (scelto: RecognisedDevice) => {
      // Estratto in una costante: dentro la funzione passata a `since` il
      // restringimento del tipo si perde, e un `!` sarebbe una bugia in un
      // punto dove il controllo esiste davvero.
      const driver = scelto.driver;
      if (!driver) return;
      fermaRicerca();
      const ctl = new AbortController();
      scarico.current = ctl;
      const nome = scelto.device.name || t('computer');
      /*
       * L'ORIGINE CHE FINISCE IN ARCHIVIO NON SI TRADUCE.
       *
       * `nome` qui sopra sta a schermo e segue la lingua di chi guarda. Questa
       * invece viene salvata dentro l'immersione come sua provenienza e ci
       * resta per sempre: tradotta, lo stesso computer scriverebbe un'origine
       * diversa a seconda della lingua attiva il giorno dello scarico, e in
       * archivio comparirebbe come due sorgenti distinte.
       */
      const origine = scelto.device.name || 'computer';
      setStato({ fase: 'scarica', nome, fatte: 0, passo: t('Mi collego…') });

      const onEvent = (e: DownloadEvent) => {
        // Le righe del diario non toccano lo stato mostrato: sarebbero un
        // aggiornamento di React per ogni notifica BLE, cioè migliaia.
        if (e.kind === 'trace') return;
        setStato((p) =>
          p.fase !== 'scarica'
            ? p
            : e.kind === 'identified'
              ? { ...p, nome: e.model, passo: t('Chiedo quante immersioni ci sono…') }
              : e.kind === 'counted'
                ? { ...p, totale: e.total, passo: t('Leggo…') }
                : e.kind === 'record'
                  ? { ...p, fatte: e.done, totale: e.total ?? p.totale, passo: t('Leggo…'), byte: undefined }
                  : e.kind === 'progress'
                    ? {
                        ...p,
                        passo: e.label,
                        byte: e.total ? { fatti: e.done, totali: e.total } : p.byte,
                      }
                    : p,
        );
      };

      /*
       * Il segnalibro si cerca col SERIALE, quando il computer si è presentato.
       *
       * Non prima: prima si avrebbe solo l'identificativo che dà il sistema
       * operativo, che su Apple vale per quel Mac e per quella installazione
       * soltanto. Salvare sotto il seriale e rileggere sotto l'identificativo
       * — che è quello che facevo — significa non trovare MAI il segnalibro:
       * lo scarico incrementale c'era e rileggeva comunque tutta la memoria,
       * senza un solo errore a schermo.
       */
      let usato: { chiave: string; marker: DownloadMarker } | undefined;
      const esito = await downloadFromComputer(transport, scelto.device, driver, {
        onEvent,
        signal: ctl.signal,
        since: ({ serial }) => {
          if (tuttoDaCapo) return undefined;
          const chiave = markerKey(driver.id, serial, scelto.device.id);
          const m = bleMarkers[chiave];
          // Impronta vuota = segnalibro dimenticato: si riparte da capo, ed è
          // esattamente quello che era stato chiesto premendo «Dimentica».
          if (!m?.fingerprint) return undefined;
          usato = { chiave, marker: m };
          return m.fingerprint;
        },
      });
      scarico.current = null;

      /*
       * Si importa anche quando lo scarico è finito male.
       *
       * `status: 'partial'` con quaranta immersioni in mano significa quaranta
       * immersioni, non un fallimento: buttarle costringerebbe a rifare tutto
       * il trasferimento per riavere quello che si aveva già.
       */
      const avvisi = [...esito.warnings];
      let testo: string;
      if (esito.dives.length === 0) {
        testo = esito.error
          ? `${t('Non è arrivata nessuna immersione')}: ${esito.error}`
          : usato && !tuttoDaCapo
            ? t('Niente di nuovo: il computer non ha immersioni più recenti di quelle che hai già.')
            : t('Il computer non ha immersioni in memoria da scaricare.');
      } else {
        const r = await importDives(esito.dives, `${esito.model ?? origine} via Bluetooth`);
        if (!r.ok) {
          testo = `${imm(esito.dives.length, t)} ${t('sono arrivate ma non si sono potute salvare')}: ${r.error}`;
        } else {
          testo =
            `${imm(r.found, t)} ${t('lette dal computer')}: ${r.added} ${t('nuove')}, ` +
            `${r.merged} ${t('arricchite')}, ${r.duplicates} ${t('già in archivio')}.`;
          if (esito.status === 'partial') {
            testo += ` ${t('Il trasferimento si è interrotto prima della fine')}${
              esito.total ? ` (${esito.dives.length} ${t('su')} ${esito.total})` : ''
            }: ${t('quello che è arrivato è salvato, il resto si riprende riscaricando.')}`;
          }
          avvisi.push(...r.warnings);

          /*
           * Il segnalibro si sposta SOLO a scarico completo, e solo dopo che
           * le immersioni sono in archivio.
           *
           * Su uno scarico interrotto abbiamo le più recenti e non le più
           * vecchie; scrivere «ho tutto fino alla più recente» perderebbe
           * quelle in fondo PER SEMPRE, perché il protocollo non permette di
           * ripartire da metà manifesto. Meglio rileggerle la prossima volta:
           * costa minuti, non dati.
           *
           * E dopo `importDives`, non prima: se il salvataggio fallisse, il
           * segnalibro salterebbe proprio le immersioni che non sono entrate.
           */
          if (esito.status === 'complete' && esito.newestKey) {
            const chiave = markerKey(driver.id, esito.serial, scelto.device.id);
            await saveBleMarker(chiave, {
              fingerprint: esito.newestKey,
              at: new Date().toISOString(),
              dives: r.found,
              model: esito.model,
            });
            // Un segnalibro vecchio salvato sotto una chiave diversa — per
            // esempio prima che il computer dichiarasse il seriale — non serve
            // più: due chiavi per lo stesso computer si contraddirebbero.
            if (usato && usato.chiave !== chiave) await forgetBleMarker(usato.chiave);
          }
        }
      }
      if (esito.error) avvisi.push(esito.error);
      setStato({
        fase: 'finito',
        testo,
        avvisi,
        parziale: esito.status === 'partial',
        grezzi: {
          driver: driver.id,
          model: esito.model,
          serial: esito.serial,
          firmware: esito.firmware,
          records: esito.records.map((r) => ({ key: r.key, base64: byteInBase64(r.bytes) })),
        },
        /*
         * IL DIARIO NON SI TRADUCE, ed è l'unica cosa qui dentro che resta
         * italiana per scelta.
         *
         * Non è testo dell'interfaccia: è il blocco che si incolla in una
         * segnalazione, e le righe che contano davvero — `esito.trace` — le
         * scrivono i driver, che l'italiano ce l'hanno cucito dentro insieme ai
         * numeri. Tradurre solo le sei intestazioni darebbe un rapporto metà e
         * metà, più difficile da leggere per chi lo riceve e da confrontare con
         * quello di ieri. L'etichetta del pulsante che lo apre, invece, si
         * traduce: quella la legge chi usa l'app, non chi la ripara.
         */
        diario: [
          `MyDiveLog — diario dello scarico`,
          `dispositivo: ${scelto.device.name || 'senza nome'}`,
          `driver: ${driver.id}`,
          `modello: ${esito.model ?? '—'} · seriale ${esito.serial ?? '—'} · firmware ${esito.firmware ?? '—'}`,
          `esito: ${esito.status}${esito.error ? ` — ${esito.error}` : ''}`,
          `immersioni: ${esito.dives.length}${esito.total !== undefined ? ` su ${esito.total}` : ''}`,
          '',
          ...esito.trace,
        ],
      });
    },
    [importDives, fermaRicerca, bleMarkers, saveBleMarker, forgetBleMarker, tuttoDaCapo, transport, t],
  );

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{t('Scarica dal computer subacqueo')}</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            {t(
              'Via Bluetooth, senza l’app del costruttore. Le immersioni già presenti vengono arricchite, non duplicate.',
            )}
          </p>
        </div>
        {stato.fase === 'cerca' ? (
          <button onClick={fermaRicerca}>{t('Ferma la ricerca')}</button>
        ) : stato.fase === 'scarica' ? (
          <button onClick={() => scarico.current?.abort()}>{t('Interrompi')}</button>
        ) : (
          <button className="btn" onClick={() => void cerca()}>
            {t('Cerca il computer')}
          </button>
        )}
      </div>

      {/*
       * Il caso senza driver è il primo, non un dettaglio in fondo.
       *
       * Finché non c'è un protocollo provato contro il suo computer, l'elenco
       * dei driver è vuoto di proposito: un driver scritto leggendo
       * `libdivecomputer` e mai eseguito su un dispositivo vero fallirebbe in un
       * modo che sembra un guasto dell'applicazione. Dirlo qui è più onesto che
       * far cercare a vuoto.
       */}
      {DRIVERS.length === 0 && (
        <div className="notice">
          <b>{t('Nessun computer è ancora supportato per lo scarico diretto.')}</b>{' '}
          {t(
            'Il Bluetooth funziona, ma i protocolli si aggiungono uno alla volta. Per ora: esporta dall’app del costruttore e importa il file qui sopra.',
          )}
        </div>
      )}

      {stato.fase === 'non-disponibile' && (
        <div className="notice notice-error" role="alert">
          {stato.motivo.detail}
        </div>
      )}

      {/*
       * QUANDO LA RICERCA GIRA A VUOTO, DOPO UN PO' SI DICE PERCHÉ POTREBBE.
       *
       * Il motivo per cui questo riquadro esiste è brutto: su iPhone il
       * permesso Bluetooth negato NON produce nessun errore. `checkPermissions`
       * del plugin è implementato solo per Android e altrove risponde sempre di
       * sì; lo stato dell'adattatore ha solo tre valori e nessuno significa
       * «non autorizzato». Chi tocca «Non consentire» si ritrova quindi una
       * ricerca che gira per sempre, senza dispositivi e senza spiegazioni, ed
       * è irreversibile finché non sa dove guardare.
       *
       * Non potendo distinguere quel caso da «nessun computer acceso qui
       * intorno», si elencano ONESTAMENTE le tre cause possibili invece di
       * indovinarne una. Dodici secondi: abbastanza perché un computer acceso e
       * vicino sia già comparso, poco perché nessuno si arrenda prima.
       */}
      {stato.fase === 'cerca' && trovati.length === 0 && aLungoSenzaNulla && (
        <div className="notice" role="status">
          <b>{t('Ancora niente.')}</b>{' '}
          {t('Controlla: il computer è in modalità collegamento? È vicino? Il permesso Bluetooth è dato?')}{' '}
          {t(
            suIOS()
              ? 'Impostazioni → MyDiveLog → Bluetooth.'
              : 'Impostazioni di Sistema → Privacy e sicurezza → Bluetooth.',
          )}{' '}
          {t('Un permesso negato non dà errore: la ricerca sembra solo non trovare niente.')}
        </div>
      )}

      {/*
       * Che cosa succederà, prima che succeda.
       *
       * Uno scarico incrementale è invisibile quando funziona — «ha preso solo
       * due immersioni» e «si è rotto dopo due immersioni» hanno lo stesso
       * aspetto. Dire prima che si riparte da un segnalibro, e da quando,
       * trasforma il silenzio in una conferma.
       */}
      {segnalibri.length > 0 && (stato.fase === 'cerca' || stato.fase === 'iniziale') && (
        <div className="notice" style={{ marginBottom: 10 }}>
          {/*
           * Il SERIALE si mostra, e ogni segnalibro si può dimenticare.
           *
           * Serve a due cose che sono successe davvero. La prima: un
           * segnalibro salvato con una chiave sbagliata resta lì per sempre e
           * compare come un secondo computer che non esiste — è capitato
           * correggendo la lettura del seriale, che prima usciva come numero e
           * ora come testo. La seconda: il segnalibro può solo AVANZARE, quindi
           * senza un modo di cancellarlo l'unico rimedio a qualunque errore
           * sarebbe modificare un'impostazione a mano.
           *
           * Il seriale è scritto perché è l'unica cosa che permette di
           * riconoscere QUALE riga si sta buttando: il modello è lo stesso per
           * due Peregrine.
           */}
          {segnalibri.map(([k, m]) => (
            <div
              key={k}
              className="spread"
              style={{ fontSize: 13, alignItems: 'center', gap: 8, marginBottom: 4 }}
            >
              <span>
                <b>{m.model ?? t('Computer')}</b> <span className="muted">{k.replace(/^[^:]+:/, '')}</span>:{' '}
                {t('l’ultima volta')} ({dateShort(m.at)}) {t('sono arrivate')} {imm(m.dives, t)}.{' '}
                {t('Al prossimo collegamento prendo solo quelle più recenti.')}
              </span>
              <button style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => void forgetBleMarker(k)}>
                {t('Dimentica')}
              </button>
            </div>
          ))}
          <label
            className="planner-check"
            style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}
          >
            <input type="checkbox" checked={tuttoDaCapo} onChange={(e) => setTuttoDaCapo(e.target.checked)} />
            <span>
              {t('Rileggi tutta la memoria del computer, non solo le nuove')}
              <span className="muted">
                {' — '}
                {t('serve se hai cancellato qualcosa e la rivuoi indietro')}
              </span>
            </span>
          </label>
        </div>
      )}

      {stato.fase === 'cerca' && (
        <>
          <p className="planner-hint" style={{ marginTop: 0 }}>
            {t(
              'Accendi il computer e mettilo in modalità trasferimento o Bluetooth — quasi tutti annunciano solo per qualche minuto dopo che li hai toccati, e si riaddormentano da soli. La ricerca continua finché non la fermi.',
            )}
          </p>
          {trovati.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              {t('Sto cercando…')}
            </p>
          ) : (
            /*
             * UN ELENCO E NON UNA TABELLA, e la colpa è della tendina.
             *
             * A 390 px di larghezza — un iPhone qualunque — questo blocco si
             * trascinava di lato: 571 px di contenuto dentro 312 disponibili.
             * Le cause erano due, e la seconda è quella che nessuno si aspetta.
             *
             * La prima: un dispositivo che non annuncia un nome viene elencato
             * con il suo identificativo, trentasei caratteri senza spazi, che
             * dentro una cella di tabella non si spezzano in nessun punto.
             *
             * La seconda: un `<select>` è largo quanto la sua opzione PIÙ
             * LUNGA, sempre, anche mentre mostra soltanto «provalo come…».
             * L'opzione più lunga qui è l'etichetta Scubapro — «Scubapro /
             * Uwatec (Aladin Matrix, A1, A2, G2, G3, Luna 2)» — e da sola
             * sfonda lo schermo. Non è un caso risolto una volta per tutte:
             * aggiungere un driver con un'etichetta più lunga lo rimetterebbe
             * identico, ed è il CSS di `.dispositivo-azione` a tenere il freno,
             * non la fortuna.
             *
             * Con la tabella se ne vanno anche le intestazioni «Dispositivo» e
             * «Segnale». In un elenco dove ogni riga È un dispositivo e il
             * numero ha già «dBm» attaccato, erano due parole che ripetevano
             * quello che si vedeva — e due colonne in meno da far stare in 312 px.
             */
            <ul className="dispositivi">
              {trovati.map(({ device, driver }) => (
                <li key={device.id}>
                  <div className="dispositivo-nome">
                    <b>{device.name || t('senza nome')}</b>
                    <span>{driver ? t(driver.label) : t('non riconosciuto come computer subacqueo')}</span>
                  </div>
                  <div className="dispositivo-azione">
                    <span className="muted tabular" style={{ fontSize: 12 }}>
                      {device.rssi !== undefined ? `${device.rssi} dBm` : '—'}
                    </span>
                    {driver ? (
                      <button className="btn" onClick={() => void scarica({ device, driver })}>
                        {t('Scarica')}
                      </button>
                    ) : (
                      /*
                       * LA VIA D'USCITA QUANDO IL NOME NON È QUELLO PREVISTO.
                       *
                       * Il riconoscimento si fa sul nome annunciato, e i nomi
                       * cambiano: l'Aladin Sport Matrix si annuncia «Aladin
                       * Sport» e non «Aladin», che è il nome con cui lo elenca
                       * libdivecomputer. Il risultato è stato una schermata che
                       * diceva «non riconosciuto come computer subacqueo»
                       * davanti a un computer subacqueo, senza niente da
                       * premere — e la sola cosa da fare era aspettare una
                       * versione nuova dell'applicazione.
                       *
                       * Con questa tendina, chi SA che computer ha lo prova.
                       * Il rischio è mandare comandi a un dispositivo che non
                       * è quello: lo si accetta perché la scelta è esplicita e
                       * la fa una persona che ha il computer in mano, non un
                       * riconoscimento automatico che si sbaglia da solo. Il
                       * protocollo comunque non trova il suo servizio e si
                       * ferma con un errore leggibile, senza scrivere niente.
                       */
                      <select
                        defaultValue=""
                        aria-label={t('provalo come…')}
                        style={{ fontSize: 12 }}
                        onChange={(e) => {
                          const scelto = DRIVERS.find((d) => d.id === e.target.value);
                          e.target.value = '';
                          if (scelto) void scarica({ device, driver: scelto });
                        }}
                      >
                        <option value="">{t('provalo come…')}</option>
                        {DRIVERS.map((d) => (
                          <option key={d.id} value={d.id}>
                            {t(d.label)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {stato.fase === 'scarica' && (
        <div className="notice" role="status" aria-live="polite">
          <b>{stato.nome}</b> — {stato.passo}{' '}
          {stato.fatte > 0 && (
            <>
              {stato.totale
                ? `${stato.fatte} ${t('di')} ${imm(stato.totale, t)}.`
                : `${imm(stato.fatte, t)}.`}
            </>
          )}
          {/*
           * La barra c'è solo quando il totale si conosce.
           *
           * Alcuni protocolli non dicono quante immersioni ci sono: si legge
           * finché la memoria non finisce. Una barra che avanza verso un totale
           * inventato è peggio di nessuna barra — promette una fine che non sa
           * dove sia.
           */}
          {/*
           * Due barre possibili, mai insieme: immersioni quando si sa quante
           * sono, byte quando si sa solo quanti ne mancano. La seconda serve a
           * Uwatec, che manda tutta la memoria in un blocco e le immersioni le
           * scopre alla fine: senza, l'unica cosa a schermo per tre minuti
           * sarebbe la scritta «Leggo…», che è indistinguibile da un blocco.
           */}
          {(() => {
            const q = stato.totale
              ? stato.fatte / stato.totale
              : stato.byte
                ? stato.byte.fatti / stato.byte.totali
                : undefined;
            if (q === undefined) return null;
            return (
              <div
                style={{
                  marginTop: 8,
                  height: 6,
                  borderRadius: 3,
                  background: 'var(--surface-3)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.round(Math.min(1, Math.max(0, q)) * 100)}%`,
                    height: '100%',
                    background: 'var(--accent-solid)',
                  }}
                />
              </div>
            );
          })()}
        </div>
      )}

      {stato.fase === 'finito' && (
        <>
          <div className={stato.parziale ? 'notice notice-error' : 'notice'} role="status">
            {stato.testo}
          </div>
          {/*
           * IL DIARIO TECNICO, e perché è un pulsante e non un riquadro aperto.
           *
           * Un protocollo di computer subacqueo non è documentato da nessun
           * costruttore: è ricostruito, e la prima versione sbaglia sempre in
           * qualche punto. Il sintomo però è quasi sempre lo stesso — «il
           * computer non risponde» — qualunque sia la causa, e senza sapere
           * QUALE comando è partito e COSA è tornato la correzione diventa un
           * indovinello a distanza.
           *
           * Sta chiuso perché a scarico riuscito non serve a nessuno, e aperto
           * sarebbe un muro di esadecimale sotto una buona notizia. Il pulsante
           * copia negli appunti, che è il gesto che serve davvero: il diario va
           * incollato in una segnalazione, non letto a schermo.
           */}
          <details style={{ marginTop: 10 }}>
            <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>
              {t('Diario tecnico')} ({plural(stato.diario.length, 'riga', 'righe', t)}){' — '}
              {t('serve solo se qualcosa non ha funzionato')}
            </summary>
            <div className="row" style={{ gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(stato.diario.join('\n'));
                  setCopiato(true);
                  setTimeout(() => setCopiato(false), 2000);
                }}
              >
                {t(copiato ? 'Copiato' : 'Copia il diario')}
              </button>
              {/*
               * I BYTE GREZZI SI POSSONO PORTARE VIA, e non è una funzione da
               * sviluppatori.
               *
               * Quando un'immersione scaricata non combacia con la stessa
               * arrivata da un file, o un profilo finisce a metà, la domanda è
               * sempre «cosa ha mandato il computer davvero». Senza questo
               * pulsante la risposta richiede di riavere il computer acceso,
               * vicino, carico, e di rifare tutto lo scarico ogni volta che si
               * prova una correzione. Con questo file, il difetto si riproduce
               * in un test che gira in un secondo — anche fra un anno, anche
               * senza quel computer.
               */}
              {stato.grezzi && stato.grezzi.records.length > 0 && (
                <button
                  onClick={() => {
                    void (async () => {
                      try {
                        const dove = await esporta(
                          `mydivelog-grezzi-${stato.grezzi?.driver}-${new Date().toISOString().slice(0, 10)}.json`,
                          JSON.stringify(stato.grezzi, null, 1),
                          'application/json',
                        );
                        setSalvataggio(`${t('Salvato')} ${dove.dove}.`);
                      } catch (err) {
                        setSalvataggio(
                          `${t('Non si è potuto salvare')}: ${err instanceof Error ? err.message : String(err)}`,
                        );
                      }
                    })();
                  }}
                >
                  {t('Salva i dati grezzi')} ({stato.grezzi.records.length})
                </button>
              )}
              {salvataggio && (
                <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
                  {salvataggio}
                </span>
              )}
            </div>
            {/*
             * `overflow-wrap: anywhere` INSIEME a `pre-wrap`, e non è una
             * ridondanza: `pre-wrap` manda a capo agli spazi, ma nel diario le
             * righe che contano sono esadecimale e identificativi — token lunghi
             * senza un solo spazio, che non si spezzano da nessuna parte. A 390 px
             * il riquadro si trascinava di lato di cinque pixel: poco, ma è
             * esattamente il difetto che `npm run schermate:ble` è stato scritto
             * per trovare, misurato dentro il contenitore e non nel documento.
             */}
            <pre
              style={{
                fontSize: 11,
                maxHeight: 300,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                background: 'var(--surface-3)',
                padding: 10,
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {stato.diario.join('\n')}
            </pre>
          </details>
          {stato.avvisi.length > 0 && (
            <ul className="muted" style={{ fontSize: 12, margin: '8px 0 0', paddingLeft: 18 }}>
              {stato.avvisi.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
