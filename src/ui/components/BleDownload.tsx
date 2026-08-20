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

import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadFromComputer } from '../../core/ble/download';
import { DRIVERS, recognise, type RecognisedDevice } from '../../core/ble/registry';
import { markerKey, type BleUnavailable, type DownloadEvent } from '../../core/ble/types';
import { TauriBleTransport } from '../../storage/ble';
import { esporta } from '../esporta';
import { suIOS } from '../../piattaforma';
import { useDiveLog } from '../state';
import type { DownloadMarker } from '../../core/ble/types';
import { dateShort, imm } from '../format';

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

const transport = new TauriBleTransport();

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
    const t = setTimeout(() => setALungoSenzaNulla(true), 12_000);
    return () => clearTimeout(t);
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
          detail: `La ricerca non è partita: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
  }, []);

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
      const nome = scelto.device.name || 'computer';
      setStato({ fase: 'scarica', nome, fatte: 0, passo: 'Mi collego…' });

      const onEvent = (e: DownloadEvent) => {
        // Le righe del diario non toccano lo stato mostrato: sarebbero un
        // aggiornamento di React per ogni notifica BLE, cioè migliaia.
        if (e.kind === 'trace') return;
        setStato((p) =>
          p.fase !== 'scarica'
            ? p
            : e.kind === 'identified'
              ? { ...p, nome: e.model, passo: 'Chiedo quante immersioni ci sono…' }
              : e.kind === 'counted'
                ? { ...p, totale: e.total, passo: 'Leggo…' }
                : e.kind === 'record'
                  ? { ...p, fatte: e.done, totale: e.total ?? p.totale, passo: 'Leggo…', byte: undefined }
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
          ? `Non è arrivata nessuna immersione: ${esito.error}`
          : usato && !tuttoDaCapo
            ? 'Niente di nuovo: il computer non ha immersioni più recenti di quelle che hai già.'
            : 'Il computer non ha immersioni in memoria da scaricare.';
      } else {
        const r = await importDives(esito.dives, `${esito.model ?? nome} via Bluetooth`);
        if (!r.ok) {
          testo = `Le ${esito.dives.length} immersioni sono arrivate ma non si sono potute salvare: ${r.error}`;
        } else {
          testo =
            `${imm(r.found)} lette dal computer: ${r.added} nuove, ${r.merged} arricchite, ` +
            `${r.duplicates} già in archivio.`;
          if (esito.status === 'partial') {
            testo += ` Il trasferimento si è interrotto prima della fine${
              esito.total ? ` (${esito.dives.length} su ${esito.total})` : ''
            }: quello che è arrivato è salvato, il resto si riprende riscaricando.`;
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
    [importDives, fermaRicerca, bleMarkers, saveBleMarker, forgetBleMarker, tuttoDaCapo],
  );

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>Scarica dal computer subacqueo</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            Via Bluetooth, senza passare dall'applicazione del costruttore. Le immersioni entrano nello stesso
            modo dei file: quelle che ci sono già vengono arricchite, non duplicate.
          </p>
        </div>
        {stato.fase === 'cerca' ? (
          <button onClick={fermaRicerca}>Ferma la ricerca</button>
        ) : stato.fase === 'scarica' ? (
          <button onClick={() => scarico.current?.abort()}>Interrompi</button>
        ) : (
          <button className="btn" onClick={() => void cerca()}>
            Cerca il computer
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
          <b>Nessun computer è ancora supportato per lo scarico diretto.</b> Il collegamento Bluetooth è
          pronto e provato, ma i protocolli — che nessun costruttore pubblica — si aggiungono uno alla volta,
          ognuno verificato contro il computer vero. Finché non c'è quello del tuo, la strada resta l'export
          dall'applicazione del costruttore e l'import del file qui sopra.
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
          <b>Ancora niente.</b> Di solito è una di tre cose: il computer non è in modalità collegamento
          (sull'Aladin si tiene premuto il tasto, sui Shearwater c'è la voce nel menu), oppure è troppo
          lontano, oppure il permesso Bluetooth è stato negato a questa app.{' '}
          {suIOS()
            ? 'Il permesso si controlla in Impostazioni → MyDiveLog → Bluetooth.'
            : 'Il permesso si controlla in Impostazioni di Sistema → Privacy e sicurezza → Bluetooth.'}{' '}
          Un permesso negato non produce nessun errore: la ricerca sembra semplicemente non trovare niente.
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
                <b>{m.model ?? 'Computer'}</b> <span className="muted">{k.replace(/^[^:]+:/, '')}</span>:
                l'ultima volta ({dateShort(m.at)}) sono arrivate {imm(m.dives)}. Al prossimo collegamento
                prendo solo quelle più recenti.
              </span>
              <button style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => void forgetBleMarker(k)}>
                Dimentica
              </button>
            </div>
          ))}
          <label
            className="planner-check"
            style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}
          >
            <input type="checkbox" checked={tuttoDaCapo} onChange={(e) => setTuttoDaCapo(e.target.checked)} />
            <span>
              Rileggi tutta la memoria del computer, non solo le nuove
              <span className="muted"> — serve se hai cancellato qualcosa e la rivuoi indietro</span>
            </span>
          </label>
        </div>
      )}

      {stato.fase === 'cerca' && (
        <>
          <p className="planner-hint" style={{ marginTop: 0 }}>
            Accendi il computer e mettilo in modalità trasferimento o Bluetooth — quasi tutti annunciano solo
            per qualche minuto dopo che li hai toccati, e si riaddormentano da soli. La ricerca continua
            finché non la fermi.
          </p>
          {trovati.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              Sto cercando…
            </p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Dispositivo</th>
                    <th>Segnale</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {trovati.map(({ device, driver }) => (
                    <tr key={device.id}>
                      <td>
                        <div style={{ fontWeight: 550 }}>{device.name || 'senza nome'}</div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {driver ? driver.label : 'non riconosciuto come computer subacqueo'}
                        </div>
                      </td>
                      <td className="muted tabular" style={{ fontSize: 12 }}>
                        {device.rssi !== undefined ? `${device.rssi} dBm` : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {driver ? (
                          <button className="btn" onClick={() => void scarica({ device, driver })}>
                            Scarica
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
                            style={{ fontSize: 12 }}
                            onChange={(e) => {
                              const scelto = DRIVERS.find((d) => d.id === e.target.value);
                              e.target.value = '';
                              if (scelto) void scarica({ device, driver: scelto });
                            }}
                          >
                            <option value="">provalo come…</option>
                            {DRIVERS.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {stato.fase === 'scarica' && (
        <div className="notice" role="status" aria-live="polite">
          <b>{stato.nome}</b> — {stato.passo}{' '}
          {stato.fatte > 0 && (
            <>
              {stato.totale ? `${stato.fatte} di ${stato.totale} immersioni.` : `${stato.fatte} immersioni.`}
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
              Diario tecnico ({stato.diario.length} righe) — serve solo se qualcosa non ha funzionato
            </summary>
            <div className="row" style={{ gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(stato.diario.join('\n'));
                  setCopiato(true);
                  setTimeout(() => setCopiato(false), 2000);
                }}
              >
                {copiato ? 'Copiato' : 'Copia il diario'}
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
                        setSalvataggio(`Salvato ${dove.dove}.`);
                      } catch (err) {
                        setSalvataggio(
                          `Non si è potuto salvare: ${err instanceof Error ? err.message : String(err)}`,
                        );
                      }
                    })();
                  }}
                >
                  Salva i dati grezzi ({stato.grezzi.records.length})
                </button>
              )}
              {salvataggio && (
                <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
                  {salvataggio}
                </span>
              )}
            </div>
            <pre
              style={{
                fontSize: 11,
                maxHeight: 300,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
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
