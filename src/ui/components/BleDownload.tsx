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
import { fusoDelDispositivo } from '../../core/oraAParete';
import { downloadFromComputer, type DownloadOutcome } from '../../core/ble/download';
import { frase } from '../../core/frase';
import { DRIVERS, recognise, type RecognisedDevice } from '../../core/ble/registry';
import type { VoceCatalogo } from '../../core/ble/catalogo';
import { esitoPer } from '../../core/ble/scelta';
import { proponi, type CandidatoRiconosciuto, type Proposta } from '../../core/ble/riconosci';
import { ScegliComputer } from './ScegliComputer';
import {
  riconosciComputerEsterno,
  rispondiCodicePin,
  scaricaDaComputerEsterno,
} from '../../storage/computerEsterni';
import {
  codiceAccoppiamento,
  dimenticaAccoppiamento,
  salvaCodiceAccoppiamento,
} from '../../core/accoppiamento';
import { decidiComeInsistere } from '../../core/insistenza';
import { righeDelloSchermo, tieniSvegliaLoSchermo } from '../../core/schermoSveglio';
import { dimenticaMetodo, metodoConservato, salvaMetodo } from '../../core/metodo';
import type { Dive } from '../../core/model';
import {
  markerKey,
  type BleFoundDevice,
  type BleTransport,
  type BleUnavailable,
  type DownloadEvent,
} from '../../core/ble/types';
import { TauriBleTransport, permessoNegato } from '../../storage/ble';
import { causaDelGuasto, conDettaglio, dettaglioLeggibile } from '../../core/ble/causaGuasto';
import { esporta } from '../esporta';
import { suIOS } from '../../piattaforma';
import { useDiveLog } from '../state';
import { useLingua, useTraduciStabile } from '../lingua';
import type { DownloadMarker } from '../../core/ble/types';
import { dateShort, imm, plural } from '../format';
import { versione } from '../../versione';

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
      /**
       * Lo schermo non si può tenere acceso da qui: lo si dice a chi guarda,
       * mentre può ancora farci qualcosa.
       *
       * Vedi `schermoSveglio.ts`. Su iOS uno schermo che si spegne **sospende
       * l'applicazione**: le notifiche Bluetooth smettono di arrivare e per il
       * computer subacqueo la conversazione si interrompe a metà. Se non
       * riusciamo a impedirlo, l'unica difesa è una persona informata.
       */
      schermoScoperto?: boolean;
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
      /**
       * Come riprovare con un altro metodo, quando ce n'è ancora uno.
       *
       * ► PERCHÉ STA NELLO STATO E NON IN UNA VARIABILE A PARTE. ◄ Perché la
       * schermata di esito è l'unico posto da cui si può ripartire, e quello
       * che serve per ripartire — quale computer, quale modello, quale
       * numero — è esattamente quello che si sa lì e in nessun altro momento.
       * Tenerlo altrove vorrebbe dire ricostruirlo, e ricostruirlo vuol dire
       * sbagliarlo il giorno che qualcuno tocca la ricerca.
       */
      altroMetodo?: {
        device: BleFoundDevice;
        marca: string;
        modello: string;
        /** Il prossimo da provare, contando da zero. */
        prossimo: number;
        totale: number;
      };
      /**
       * Il punto da cui ripartire la prossima volta, offerto a chi guarda
       * DOPO uno scarico rotto che qualcosa ha portato.
       *
       * ════════════════════════════════════════════════════════════════════
       * ► PERCHÉ QUESTA OFFERTA ESISTE, ED È IL CONTO DELL'11 SETTEMBRE. ◄
       *
       * Il diario del Puck 4 dice 32 KB e 142 comandi per immersione. Un
       * archivio di quarantacinque immersioni è quindi 1,4 MB e 6 400 comandi,
       * e i due guasti veri sono caduti dopo 25 775 e 64 236 byte, cioè in
       * media ogni 45 KB. *Se quel tasso è costante, la probabilità che un
       * tentativo arrivi in fondo è e^-32: uno su cento mila miliardi.* Con
       * cinque tentativi è lo stesso numero. **Riprovare non basta e non
       * basterà mai**, perché ogni tentativo rifà la stessa strada e inciampa
       * alla stessa distanza media.
       *
       * Ma quasi nessuno ha davvero bisogno di tutte: le vecchie sono già nel
       * libretto, arrivate da un backup, da un'altra applicazione, o scritte a
       * mano. Quello che serve è **smettere di riattraversarle**. Il segnalibro
       * lo sa fare da sempre — solo che si posa da solo unicamente dopo uno
       * scarico finito bene, che qui è proprio la cosa che non succede.
       *
       * Quindi lo si offre a mano, e la differenza con il salvataggio
       * automatico è tutta qui: **lo decide una persona informata**. Il
       * pericolo del segnalibro messo su uno scarico rotto — perdere in
       * silenzio le più vecchie — sparisce nel momento in cui smette di essere
       * silenzioso.
       */
      /** Lo scambio intero, quando il banco di prova era acceso. */
      registrazione?: string[];
      ripartiDaQui?: {
        chiave: string;
        impronta: string;
        /** Quante ne sono arrivate in questo scarico rotto. */
        quante: number;
        modello: string;
      };
    };

/**
 * Il punto più avanti raggiunto in TUTTO il giro dei tentativi.
 *
 * ► PERCHÉ SI PORTA DA UN TENTATIVO ALL'ALTRO, COME IL DIARIO. ◄ L'offerta di
 * ripartire da qui si fa alla fine, quando l'applicazione ha smesso di provare
 * — ma quello che c'è da offrire lo ha prodotto, quasi sempre, il **primo**
 * tentativo, e l'ultimo può benissimo essere finito a zero immersioni con un
 * collegamento caduto subito. Guardare solo l'ultimo vorrebbe dire non offrire
 * niente proprio nei giri in cui è andata meglio.
 *
 * L'impronta è la stessa in tutti i tentativi — è l'immersione più recente del
 * computer, che non cambia mentre si scarica — quindi si tiene la prima vista;
 * `quante` invece cresce, e racconta quanto lontano si è arrivati.
 */
type PuntoRaggiunto = { impronta: string; quante: number };

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
  /*
   * ► IL COMPUTER CHIEDE UN NUMERO, E LO SCARICO È FERMO FINCHÉ NON GLI SI
   * RISPONDE. ◄
   *
   * La famiglia Pelagic (Aqualung i330R, Apeks DSX) accende sul proprio
   * schermo un PIN di sei cifre al primo comando e non va avanti senza. Il
   * guscio Rust, in quel momento, è dentro una chiamata di libdivecomputer:
   * non può fare altro che aspettare, e aspetta al massimo tre minuti.
   *
   * Quindi da qui bisogna rispondere SEMPRE — con le cifre o con una rinuncia
   * — e per questo la rinuncia è un pulsante e non una crocetta: chiudere e
   * basta è esattamente il gesto che lascerebbe l'applicazione ferma.
   *
   * Non è una finestra modale, come niente in questa applicazione: nella
   * WKWebView di macOS i pannelli di sistema non compaiono, e questa è la
   * stessa lezione che ha prodotto `BottoneConferma`.
   */
  const [pin, setPin] = useState<{ nome: string; cifre: string } | null>(null);
  /*
   * ► SE QUESTA SCHEDA SPARISCE MENTRE IL COMPUTER ASPETTA. ◄
   *
   * Basta toccare «Immersioni» mentre si legge il numero sul polso: React
   * smonta il componente, il riquadro sparisce, e **nessuno risponde più**. Il
   * thread dello scarico resta fermo dentro la `ioctl` per i tre minuti pieni,
   * e in quei tre minuti ogni nuovo tentativo trova «uno scarico è già in
   * corso». È lo stesso guasto che la rinuncia esiste per evitare, raggiunto
   * da un'altra porta.
   *
   * Il riferimento serve perché la pulizia gira una volta sola, allo
   * smontaggio, e leggerebbe il valore che c'era al primo disegno.
   */
  const pinAperto = useRef(false);
  useEffect(() => {
    pinAperto.current = pin !== null;
  }, [pin]);
  useEffect(
    () => () => {
      if (pinAperto.current) void rispondiCodicePin(null);
    },
    [],
  );
  const [trovati, setTrovati] = useState<RecognisedDevice[]>([]);
  const [copiato, setCopiato] = useState(false);
  /** L'ordine in cui i dispositivi stanno adesso. Vedi `recognise`. */
  const ordine = useRef<string[]>([]);
  /*
   * IL DISPOSITIVO PER CUI SI STA SCEGLIENDO MARCA E MODELLO.
   *
   * È l'identificativo e non l'oggetto: l'elenco dei trovati si riscrive a ogni
   * giro della scansione, e tenere qui una copia vecchia vorrebbe dire mandare
   * lo scarico a un dispositivo che nel frattempo non è più quello. Con
   * l'identificativo si ripesca sempre la riga di adesso — e se il dispositivo
   * è sparito dall'elenco, il selettore si chiude da solo invece di parlare a
   * un fantasma.
   */
  const [scegliPer, setScegliPer] = useState<string | null>(null);
  /*
   * La risposta data a chi ha scelto un modello che non si scarica.
   *
   * Sta qui e non nel selettore perché è la CONCLUSIONE della scelta, non un
   * suo passaggio: il selettore si chiude, e quello che resta a schermo è la
   * frase che dice come fare invece.
   */
  const [spiegazione, setSpiegazione] = useState<VoceCatalogo | null>(null);
  /*
   * ► CHE COMPUTER È, DETTO DAL NOME, PER LE MARCHE SENZA DRIVER DI CASA. ◄
   *
   * Un centro immersioni ha visto venti volte «Quad Ci — non riconosciuto come
   * computer subacqueo», e venti volte ha dovuto cercare Mares in un elenco di
   * centocinque. Il nome lo diceva già: libdivecomputer ha, per ogni
   * costruttore, il filtro con cui Subsurface propone il modello, e il guscio
   * Rust lo interroga (`riconosci_computer_esterno`). Qui si chiede una volta
   * per NOME — non per giro di scansione, che riscrive l'elenco ogni secondo —
   * e si tiene la proposta per dispositivo, così la riga mostra «Mares Quad
   * Ci» e un «Scarica» diretto.
   *
   * La memoria è per nome e non per identificativo perché è il nome che il
   * filtro guarda: due Quad Ci sulla stessa barca hanno due identificativi e
   * una risposta sola. E la risposta di un nome non cambia mai nel corso di una
   * ricerca — cambia con la versione della libreria, cioè con l'applicazione.
   *
   * Una proposta è una proposta: accanto c'è sempre «Non è questo?», che apre
   * il selettore di sempre. Il costo di una proposta sbagliata è un tentativo
   * che il computer non capisce e un errore leggibile, non un'immersione
   * inventata in archivio.
   */
  const [proposte, setProposte] = useState<Record<string, Proposta>>({});
  const riconoscimenti = useRef(new Map<string, Promise<CandidatoRiconosciuto[]>>());
  useEffect(() => {
    let vivo = true;
    for (const { device, driver } of trovati) {
      const nome = device.name?.trim() ?? '';
      if (driver || nome === '' || proposte[device.id]) continue;
      let candidati = riconoscimenti.current.get(nome);
      if (!candidati) {
        candidati = riconosciComputerEsterno(nome);
        riconoscimenti.current.set(nome, candidati);
      }
      void candidati.then((elenco) => {
        if (!vivo) return;
        const proposta = proponi(nome, elenco);
        setProposte((p) => (p[device.id] ? p : { ...p, [device.id]: proposta }));
      });
    }
    return () => {
      vivo = false;
    };
  }, [trovati, proposte]);
  /*
   * ► QUESTA COPIA DELL'APPLICAZIONE HA DENTRO LIBDIVECOMPUTER? ◄
   *
   * Non è una cosa che si può sapere leggendo il codice: `computer-esterni` è
   * una funzionalità di compilazione, e la stessa `src/` produce due binari
   * diversi. Lo si CHIEDE al guscio Rust, che risponde con l'elenco dei modelli
   * che la libreria conosce — vuoto quando la funzionalità non c'è.
   *
   * Perché non presumerlo acceso: il selettore mostrerebbe «Scarica» su
   * ottantatré modelli e fallirebbe su tutti. Perché non presumerlo spento:
   * direbbe «non ancora» a chi ce l'ha, e quella persona non proverebbe mai.
   * L'unica risposta giusta è quella vera, e costa una chiamata all'avvio.
   *
   * L'elenco NON si tiene: sono trecentocinquantasei voci di cui ci serve
   * soltanto sapere se sono più di zero. Il catalogo che l'interfaccia mostra
   * è quello generato in `core/ble/catalogoGenerato.ts`, che esiste anche
   * quando la libreria non è compilata — ed è il motivo per cui il selettore
   * funziona comunque, dicendo la verità su ogni modello.
   */
  const [conLibdivecomputer, setConLibdivecomputer] = useState(false);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const elenco = await invoke<unknown[]>('elenca_computer_supportati');
        if (vivo) setConLibdivecomputer(elenco.length > 0);
      } catch {
        // Nel browser il modulo non c'è, e va benissimo: resta spento, che è
        // la verità — nel browser non si scarica da nessun computer.
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);
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
  /**
   * Il banco di prova: registra tutto lo scambio invece della sola testa e
   * coda. Vedi `ScaricoEsterno.registra`. Spento per difetto, e non si
   * conserva fra un avvio e l'altro: è una cosa che si accende per una sera
   * con un apparecchio davanti, non una preferenza.
   */
  const [registra, setRegistra] = useState(false);
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
   * ► IL «BASTA» DELLA PERSONA, CHE NESSUNA REGOLA PUÒ SCAVALCARE. ◄ Lo
   * scarico che passa da libdivecomputer non ha un controllore da abortire —
   * il guscio Rust è dentro la libreria e non si può interrompere a metà — ma
   * i tentativi automatici sì: quelli li decide questa schermata, e devono
   * smettere appena qualcuno lo chiede. È un `ref` e non uno stato perché lo
   * legge una funzione che sta già girando, e uno stato le arriverebbe vecchio.
   */
  const smettiDiInsistere = useRef(false);
  /*
   * Lo scarico esterno chiama sé stesso per riprovare. Passare dal `ref`
   * invece che dal nome evita di doverlo mettere fra le proprie dipendenze —
   * che è un ciclo — e garantisce che il tentativo dopo usi la versione
   * corrente della funzione e non quella catturata al primo giro.
   */
  const scaricaEsternoRef = useRef<
    | ((
        device: BleFoundDevice,
        marca: string,
        modello: string,
        tentativo?: number,
        insiste?: { fatti: number; stesso: number; diario: string[]; raccolto?: PuntoRaggiunto },
      ) => Promise<void>)
    | null
  >(null);

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
      // L'effetto sincronizza con un sistema esterno vero — la ricerca BLE, che va e viene
      // senza chiedere niente a React — e questa riga spegne il messaggio «non trovo niente»
      // nell'istante in cui qualcosa si trova. Non c'è un render da cui derivarla: dipende da
      // quanto è durata la ricerca.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    /*
     * ► UNA RICERCA NUOVA È UNA SCHERMATA NUOVA. ◄
     *
     * Senza queste due righe il catalogo e la risposta «non legge ancora»
     * sopravvivevano alla ricerca precedente, e alla successiva RISORGEVANO da
     * soli: `scegliPer` tiene l'identificativo del dispositivo, la nuova
     * scansione ritrova lo stesso dispositivo con lo stesso identificativo, e
     * il pannello si riapriva senza che nessuno avesse premuto niente — con
     * l'`autoFocus` che su un telefono tira su la tastiera.
     *
     * Non era teoria: bastava aprire il catalogo, fermare la ricerca e
     * ripremere «Cerca il computer». A 390 px il pannello riaperto spingeva il
     * quarto dispositivo fuori dallo schermo.
     */
    setScegliPer(null);
    setSpiegazione(null);
    setStato({ fase: 'cerca' });
    try {
      /*
       * L'ORDINE DI PRIMA SI PASSA A QUELLO DI ADESSO.
       *
       * `recognise` da sola non può ricordare niente: è una funzione pura, ed è
       * giusto che lo resti. La memoria sta qui, in un riferimento e non in uno
       * stato, perché serve DENTRO la richiamata della scansione e non deve far
       * ridisegnare niente da sé — è l'ordine, non un dato da mostrare.
       *
       * Senza questo, l'elenco si riordinava a ogni annuncio Bluetooth: le
       * righe si scambiavano di posto sotto il dito, e sul telefono la scheda
       * del catalogo aperta dentro una riga saltava su e giù mentre si stava
       * scegliendo un modello.
       */
      ordine.current = [];
      await transport.scan((devs) => {
        const elenco = recognise(devs, DRIVERS, ordine.current);
        ordine.current = elenco.map((r) => r.device.id);
        setTrovati(elenco);
      }, ctl.signal);
    } catch (err) {
      /*
       * ► QUI SI LEGGEVA «Btleplug error: Permission denied». ◄
       *
       * Non in un log: sullo schermo del primo utente esterno dell'app, il 28
       * agosto 2026, alla prima cosa che ha provato a fare. Il messaggio
       * appendeva l'errore grezzo, e l'errore grezzo portava il nome di una
       * libreria — in inglese, dentro un'app italiana, a una persona che voleva
       * solo scaricare le sue immersioni.
       *
       * E c'era di peggio: `reason` era **fisso** su `unsupported`. Il tipo
       * `BleUnavailable` ha da sempre anche `denied` e `off`, e i loro testi
       * esistevano già tradotti — solo che questo ramo non li usava mai. La
       * macchina per rispondere bene c'era: mancava chi la accendesse.
       *
       * Adesso l'errore si classifica, e per i due casi che hanno una risposta
       * si dice ALLA PERSONA COSA FARE, col percorso giusto per il suo sistema.
       * Per il caso «non lo so» resta il dettaglio tecnico, ma ripulito: se non
       * si può ripulire non si mostra, perché una frase chiara da sola è meglio
       * di una frase chiara seguita da una che spaventa.
       */
      const causa = causaDelGuasto(err);
      const dettaglio = dettaglioLeggibile(err);
      const motivo: BleUnavailable =
        causa === 'denied'
          ? { reason: 'denied', detail: permessoNegato(t) }
          : causa === 'off'
            ? {
                reason: 'off',
                detail: t('Il Bluetooth di questo dispositivo è spento. Accendilo e riprova.'),
              }
            : {
                reason: 'unsupported',
                detail:
                  dettaglio === ''
                    ? t('La ricerca non è partita')
                    : `${t('La ricerca non è partita')}: ${dettaglio}`,
              };
      setStato({ fase: 'non-disponibile', motivo });
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

  /*
   * ► IL FUOCO TORNA DA DOVE È PARTITO. ◄
   *
   * Chiudendo il selettore il fuoco cadeva su `<body>`: chi naviga da tastiera
   * ricominciava a tabulare dall'inizio della pagina, riattraversando la
   * navigazione, l'area dei file e tutte le righe dei dispositivi per tornare
   * al punto in cui era. È il difetto classico di un pannello che si smonta.
   *
   * Si cerca per attributo invece di tenere un riferimento per ogni riga:
   * l'elenco dei dispositivi si riscrive a ogni giro della scansione e i
   * riferimenti seguirebbero righe che non esistono più. L'attributo invece sta
   * sul pulsante di adesso, qualunque esso sia — e se quel dispositivo è
   * sparito dall'elenco non si trova niente e non succede niente, che è la cosa
   * giusta.
   *
   * `requestAnimationFrame` perché al momento del clic React non ha ancora
   * ridisegnato: il pulsante da mettere a fuoco, in quell'istante, è ancora
   * coperto dal pannello che si sta chiudendo.
   */
  const tornaAlPulsante = useCallback((idDispositivo: string) => {
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`button[data-scegli="${CSS.escape(idDispositivo)}"]`)
        ?.focus();
    });
  }, []);

  /*
   * ► «INTERROMPI» DEVE FARE QUALCOSA, SEMPRE. ◄
   *
   * Il controllore esiste solo per la strada dei driver di casa; lo scarico che
   * passa da libdivecomputer non ne ha uno, e per tutta la sua durata il
   * pulsante chiamava `abort()` su `null` — cioè non faceva niente, davanti a
   * una schermata ferma su «Lettura in corso…» che non offre nessun'altra uscita. Un
   * bersaglio che non risponde non si legge come «non c'è niente da fermare»:
   * si legge come un'applicazione bloccata, e chi lo preme due volte a vuoto
   * chiude l'app e perde quello che stava arrivando.
   *
   * Quando c'è un trasferimento da fermare lo si ferma davvero. Quando non c'è,
   * si restituisce almeno la schermata — l'unica cosa onesta che resti da fare,
   * visto che quello che è già entrato in archivio ci resta comunque.
   */
  const interrompi = useCallback(() => {
    // Prima di tutto: si smette di insistere. Anche se il trasferimento in
    // corso non si può fermare, il tentativo DOPO non deve partire — o il
    // pulsante mentirebbe.
    smettiDiInsistere.current = true;
    if (scarico.current) {
      scarico.current.abort();
      return;
    }
    setStato((p) => (p.fase === 'scarica' ? { fase: 'iniziale' } : p));
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
      setStato({ fase: 'scarica', nome, fatte: 0, passo: t('Collegamento in corso…') });

      const onEvent = (e: DownloadEvent) => {
        // Le righe del diario non toccano lo stato mostrato: sarebbero un
        // aggiornamento di React per ogni notifica BLE, cioè migliaia.
        if (e.kind === 'trace') return;
        setStato((p) =>
          p.fase !== 'scarica'
            ? p
            : e.kind === 'identified'
              ? { ...p, nome: e.model, passo: t('Conteggio delle immersioni…') }
              : e.kind === 'counted'
                ? { ...p, totale: e.total, passo: t('Lettura in corso…') }
                : e.kind === 'record'
                  ? {
                      ...p,
                      fatte: e.done,
                      totale: e.total ?? p.totale,
                      passo: t('Lettura in corso…'),
                      byte: undefined,
                    }
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
       * ► DA QUI IN POI TUTTO STA DENTRO UN `try`, E IL MOTIVO NON È IL DECORO. ◄
       *
       * Nel Bluetooth si lancia: il dispositivo si addormenta, il permesso
       * cade, l'archivio rifiuta una scrittura. Senza questa rete la schermata
       * restava su «Lettura in corso…» PER SEMPRE — nessun messaggio, nessun pulsante che
       * riporti indietro — e chi guardava non aveva modo di sapere se le
       * immersioni erano entrate in archivio o no. È il caso peggiore, perché
       * la reazione naturale è riscaricare tutto, che è esattamente la cosa che
       * non serve quando erano entrate.
       */
      let esito: DownloadOutcome | undefined;
      /** Quante immersioni sono già in archivio, se poi qualcosa va storto. */
      let inArchivio = 0;
      /*
       * Lo schermo resta acceso anche qui. I driver di casa leggono cento e
       * passa immersioni a testa: è lo stesso identico rischio della strada di
       * libdivecomputer, ed è l'unico posto del programma in cui una persona
       * guarda per minuti senza toccare niente. Vedi `schermoSveglio.ts`.
       */
      const schermo = await tieniSvegliaLoSchermo();
      const inizio = Date.now();
      try {
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
        esito = await downloadFromComputer(transport, scelto.device, driver, {
          onEvent,
          signal: ctl.signal,
          registra,
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
          /*
           * Il fuso lo mette il telefono che sta scaricando, ed è l'unico posto
           * dell'applicazione che lo sa. Il nucleo non legge l'orologio di
           * sistema — è la regola che tiene verdi i test a Kiritimati e a Midway
           * — quindi la funzione parte da qui e scende fino al driver.
           *
           * È esattamente quello che fanno LogTRAK e Shearwater Cloud, ed è il
           * motivo per cui in quelle applicazioni l'ora è giusta.
           */
          fuso: fusoDelDispositivo,
        });

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
            ? conDettaglio(
                `${t('Lo scarico si è interrotto. Non è stata salvata nessuna immersione.')} ` +
                  t('Spegni e riaccendi il computer subacqueo, avvicinalo e riprova.'),
                esito.error,
              )
            : usato && !tuttoDaCapo
              ? t('Niente di nuovo: il computer non ha immersioni più recenti di quelle che hai già.')
              : t('Il computer non ha immersioni in memoria da scaricare.');
        } else {
          const r = await importDives(esito.dives, `${esito.model ?? origine} via Bluetooth`);
          if (!r.ok) {
            // `r.error` è già ripulito da `state.tsx` e può mancare del tutto:
            // quando manca si dice «motivo non riportato» invece di stampare
            // `undefined`, che è il modo più veloce di far sembrare rotta l'app.
            testo =
              `${imm(esito.dives.length, t)} ${t('sono arrivate ma non si sono potute salvare')}: ` +
              `${r.error ?? t('motivo non riportato')}. ` +
              t('Controlla lo spazio libero sul dispositivo e riprova.');
          } else {
            /*
             * QUANTE NE SONO ENTRATE DAVVERO, tenuto da parte per il caso in cui
             * da qui in poi qualcosa esploda.
             *
             * `added` più `merged` è quello che l'archivio ha in più adesso e non
             * aveva un minuto fa; i doppioni erano già lì. Il numero serve al ramo
             * dell'errore qui sotto: da questo punto in avanti si scrive ancora —
             * il segnalibro — e un guasto che tacesse su cosa è stato salvato
             * lascerebbe l'unica via d'uscita nel riscaricare tutto per scoprirlo.
             */
            inArchivio = r.added + r.merged;
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
        /*
         * Il motivo grezzo resta NEL DIARIO, che è il posto per cui è nato; a
         * schermo ci arriva solo se `dettaglioLeggibile` lo lascia passare.
         *
         * E solo quando qualcosa è arrivato: se non è arrivato niente, `testo`
         * ha già detto tutto — compreso questo dettaglio — e ripeterlo qui
         * sotto darebbe due righe che dicono la stessa cosa.
         */
        const dettaglioEsito = esito.error ? dettaglioLeggibile(esito.error) : '';
        if (dettaglioEsito && esito.dives.length > 0) avvisi.push(dettaglioEsito);
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
          registrazione: esito.registrazione,
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
      } catch (guasto) {
        /*
         * ► IL MESSAGGIO DICE DUE COSE, NON UNA. ◄
         *
         * Che si è interrotto, e che cosa è già salvato. Un errore che tace sul
         * secondo punto costringe chi legge a rifare tutto il trasferimento
         * solo per sapere a che punto era — minuti di radio e di batteria per
         * un'informazione che l'applicazione aveva già in mano.
         *
         * `parziale` accende il riquadro rosso: qui non è «si è fermato prima
         * della fine», che è un esito previsto e lo dice `esito.status`, ma
         * «si è rotto», che non lo è.
         */
        const motivo = guasto instanceof Error ? guasto.message : String(guasto);
        /*
         * ► IL MOTIVO NON APRE PIÙ LA FRASE, LA CHIUDE — e solo se si legge. ◄
         *
         * Prima era interpolato in mezzo: «Lo scarico si è interrotto: <roba
         * inglese>. Quello che era già arrivato è salvato in archivio: 12.» La
         * parte che conta — quante ne hai — stava DOPO una riga incomprensibile,
         * e questo è il punto dell'applicazione in cui il motivo ha più
         * probabilità di essere un errore del motore d'archivio, perché qui si
         * finisce quando salta il salvataggio o il segnalibro.
         *
         * Il diario, due righe più giù, tiene il motivo grezzo: è il blocco che
         * si incolla in una segnalazione, e lì serve intero.
         */
        setStato({
          fase: 'finito',
          testo: conDettaglio(
            `${
              inArchivio
                ? frase(
                    t,
                    'Lo scarico si è interrotto. Quello che era già arrivato è salvato in archivio: {0}.',
                    imm(inArchivio, t),
                  )
                : t('Lo scarico si è interrotto. Non è stata salvata nessuna immersione.')
            } ${t('Spegni e riaccendi il computer subacqueo, avvicinalo e riprova.')}`,
            guasto,
          ),
          avvisi: [],
          parziale: true,
          /*
           * Il diario porta comunque le righe del protocollo, quando ce ne sono.
           *
           * È il motivo per cui `esito` è dichiarato fuori dal `try`: se il
           * guasto è arrivato dopo il trasferimento — il salvataggio, il
           * segnalibro — quelle righe raccontano che cosa il computer aveva
           * risposto, e senza di loro una segnalazione su un guasto del genere
           * non contiene niente su cui lavorare.
           */
          // Anche qui, e soprattutto qui: la registrazione di uno scarico
          // rotto vale più di quella di uno riuscito.
          registrazione: esito?.registrazione,
          diario: [
            `MyDiveLog — diario dello scarico`,
            `dispositivo: ${scelto.device.name || 'senza nome'}`,
            `driver: ${driver.id}`,
            `esito: guasto — ${motivo}`,
            `immersioni salvate prima del guasto: ${inArchivio}`,
            '',
            ...(esito?.trace ?? []),
          ],
        });
      } finally {
        /*
         * Il controllore muore QUI, non appena il trasferimento è finito.
         *
         * Azzerato subito dopo `downloadFromComputer` lasciava scoperta tutta la
         * fase in cui si scrive in archivio: in quella finestra «Interrompi»
         * chiamava `abort()` su `null`, cioè non faceva niente, davanti a una
         * schermata che diceva ancora «Lettura in corso…». E su un percorso che lanciava
         * restava `null` per sempre.
         */
        scarico.current = null;
        /*
         * ► LE RIGHE DELLO SCHERMO SI ATTACCANO IN CODA AL DIARIO GIÀ SCRITTO. ◄
         * Qui il diario è stato composto dentro il `try`, prima che si sapesse
         * com'era andata con lo schermo: l'unico modo di non perdere quella
         * misura — che è la più interessante di tutte, quando c'è — è
         * aggiungerla dopo, a schermata già fatta.
         */
        const comeSta = await schermo.lascia();
        const righe = [
          `durata dello scarico: ${Math.round((Date.now() - inizio) / 1000)} s`,
          ...righeDelloSchermo(comeSta),
        ];
        setStato((p) => (p.fase === 'finito' ? { ...p, diario: [...p.diario, ...righe] } : p));
      }
    },
    [
      importDives,
      fermaRicerca,
      bleMarkers,
      saveBleMarker,
      forgetBleMarker,
      tuttoDaCapo,
      registra,
      transport,
      t,
    ],
  );

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ► LO SCARICO CHE PASSA DA LIBDIVECOMPUTER. ◄
   *
   * È una funzione a parte e non un ramo dentro `scarica`, e la ragione non è
   * di stile: le due strade hanno un pezzo che non si può condividere. I
   * driver scritti in casa leggono un MANIFESTO e si fermano al segnalibro —
   * «dammi solo quelle dopo questa» — e su un Peregrine pieno sono minuti di
   * attesa e batteria risparmiati. libdivecomputer non espone quel punto di
   * arresto in modo uniforme fra le famiglie: legge la memoria e basta.
   *
   * Quindi qui NON si salva nessun segnalibro. Non è una mancanza da colmare:
   * un segnalibro che non viene onorato dallo scarico successivo è peggio di
   * nessun segnalibro, perché fa credere di aver risparmiato una lettura che
   * invece è avvenuta. La deduplica fa il resto, come per i file, ed è la
   * stessa strada che percorrono le immersioni importate da un `.uddf`.
   */
  /**
   * La risposta alla richiesta del PIN: le cifre, oppure una rinuncia.
   *
   * Il riquadro si chiude PRIMA di mandare la risposta, e non dopo: la
   * risposta attraversa il guscio Rust e può metterci un istante, e un
   * riquadro che resta lì mentre lo scarico è già ripartito invita a premere
   * «Conferma» una seconda volta — cioè a mandare una risposta a una domanda
   * che non c'è più.
   */
  const rispondiAlPin = useCallback((cifre: string | null) => {
    setPin(null);
    /*
     * ► UNA RINUNCIA È UN «NO», E UN «NO» VALE ANCHE PER I TENTATIVI DOPO. ◄
     *
     * Da stanotte l'applicazione riprova da sola, e il computer che chiede il
     * PIN — l'i330R, il DSX — risponde eccome prima di chiederlo: quindi un
     * fallimento dopo la rinuncia sembra, ai numeri, il caso «il modo funziona,
     * riprova uguale». E riprovare uguale vuol dire **richiedere il PIN**, a
     * una persona che ha appena detto di no. Due volte.
     *
     * *Un'insistenza che non sa distinguere «non ha funzionato» da «non ho
     * voluto» non è tenacia: è non ascoltare.* Le cifre invece lasciano correre
     * tutto: lì la persona ha detto di sì, e se poi si rompe qualcosa il
     * ritentativo è esattamente quello che si aspetta.
     */
    if (cifre === null) smettiDiInsistere.current = true;
    void rispondiCodicePin(cifre);
  }, []);

  const scaricaEsterno = useCallback(
    async (
      device: BleFoundDevice,
      marca: string,
      modello: string,
      tentativo?: number,
      insiste?: { fatti: number; stesso: number; diario: string[]; raccolto?: PuntoRaggiunto },
    ) => {
      fermaRicerca();
      const nome = `${marca} ${modello}`;
      /*
       * ► CHI PARTE A MANO AZZERA LA RESA. ◄ `insiste` c'è solo quando questo
       * giro è stato deciso dal giro prima. Quando invece è una persona a
       * premere, si riparte con la pazienza intera — e soprattutto si toglie
       * l'eventuale «basta» di un «Interrompi» precedente, o il primo
       * fallimento del nuovo tentativo si arrenderebbe subito per una
       * decisione presa in un'altra occasione.
       */
      if (!insiste) smettiDiInsistere.current = false;
      const fatti = insiste?.fatti ?? 0;
      const stesso = insiste?.stesso ?? 0;
      setStato({
        fase: 'scarica',
        nome,
        fatte: 0,
        passo:
          fatti > 0
            ? t('Nuovo tentativo ({0}º)…').replace('{0}', String(fatti + 1))
            : t('Collegamento in corso…'),
      });

      const diario: string[] = [];
      /*
       * Il metodo con cui si sta provando, riempito dall'evento `method` che
       * arriva subito dopo il collegamento. Serve dopo, a scarico finito: per
       * conservare quello che ha vinto, e per sapere se ce n'è un altro da
       * offrire. È una variabile e non uno stato di React perché nessuno la
       * guarda mentre lo scarico è in corso — a schermo c'è l'avanzamento — e
       * uno stato in più vorrebbe dire un ridisegno in più per niente.
       */
      let metodoInCorso: { indice: number; totale: number; nome: string; chiave: string } | undefined;
      /** L'ultimo `exchange` arrivato: quanti byte ha davvero detto il computer. */
      let scambio: { writes: number; notifications: number; bytes: number } | undefined;
      /*
       * L'impronta della PIÙ RECENTE, cioè del primo record che arriva: i
       * backend di libdivecomputer leggono dalla più recente alla più vecchia,
       * e quella è la sola che serve a dire «da qui in giù ce l'ho già».
       * Prendere l'ultima invece della prima farebbe fermare il prossimo
       * scarico all'immersione più VECCHIA — cioè non lo fermerebbe mai, e il
       * segnalibro non servirebbe a niente senza dare nessun segno di sé.
       */
      let piuRecente: string | undefined;
      const onEvent = (e: DownloadEvent) => {
        // Come nell'altra strada: le righe di diario non toccano lo stato
        // mostrato, sarebbero un aggiornamento di React per ogni notifica.
        if (e.kind === 'trace') {
          diario.push(e.line);
          return;
        }
        /*
         * La richiesta del PIN. Da qui in poi lo scarico è FERMO: il guscio
         * Rust aspetta dentro la libreria, e riprende solo quando
         * `rispondiCodicePin` gli manda una risposta — le cifre o la rinuncia.
         */
        if (e.kind === 'pinRequired') {
          setPin({ nome, cifre: '' });
          return;
        }
        /*
         * La chiave di accoppiamento, in cambio del PIN. Si conserva subito e
         * non alla fine: se lo scarico si interrompe DOPO questo punto, il
         * codice resta valido lo stesso e il prossimo tentativo non chiederà
         * più niente. Conservarla alla fine vorrebbe dire perderla proprio nel
         * caso in cui riprovare è più probabile.
         *
         * Non entra nel diario: il diario si allega alle segnalazioni.
         */
        /*
         * I numeri dello scambio. Non si mostrano e non entrano nel diario —
         * il riassunto in prosa dice le stesse cose meglio — ma sono quelli
         * che decidono il tentativo dopo: vedi `decidiComeInsistere`.
         */
        if (e.kind === 'exchange') {
          scambio = e;
          return;
        }
        if (e.kind === 'accessCode') {
          salvaCodiceAccoppiamento(device.id, e.hex);
          diario.push('il computer ha rilasciato un codice di accoppiamento, conservato');
          return;
        }
        /*
         * Quale dei modi possibili di parlare con questo computer si sta
         * provando. Finisce nel diario perché è la prima cosa da sapere
         * quando qualcosa non funziona, e nel passo a schermo quando ce n'è
         * più d'uno: chi ha premuto «riprova» deve vedere che sta succedendo
         * qualcosa di diverso, o premerà di nuovo.
         */
        if (e.kind === 'method') {
          metodoInCorso = { indice: e.index - 1, totale: e.total, nome: e.name, chiave: e.key };
          diario.push(`metodo ${e.index} di ${e.total}: ${e.name}`);
          if (e.total > 1) {
            const etichetta = `${t('Metodo')} ${e.index}/${e.total}: ${e.name}`;
            setStato((p) => (p.fase === 'scarica' ? { ...p, passo: etichetta } : p));
          }
          return;
        }
        if (e.kind === 'record' && piuRecente === undefined && !e.record.key.startsWith('posizione-')) {
          piuRecente = e.record.key;
        }
        setStato((p) =>
          p.fase !== 'scarica'
            ? p
            : e.kind === 'counted'
              ? { ...p, totale: e.total, passo: t('Lettura in corso…') }
              : e.kind === 'record'
                ? {
                    ...p,
                    fatte: e.done,
                    totale: e.total ?? p.totale,
                    passo: t('Lettura in corso…'),
                    byte: undefined,
                  }
                : e.kind === 'progress'
                  ? {
                      ...p,
                      passo: e.label,
                      byte: e.total ? { fatti: e.done, totali: e.total } : p.byte,
                    }
                  : p,
        );
      };

      let dives: Dive[] = [];
      /*
       * ► DUE FORME DELLO STESSO GUASTO, e tenerle separate è tutto il punto. ◄
       *
       * `guasto` è l'errore com'è, e serve al DIARIO — il file che si allega a
       * una segnalazione, dove «stato 5» e il nome della libreria sono
       * esattamente quello che chi ripara vuole leggere.
       *
       * A SCHERMO invece arrivava lo stesso testo, e diceva due cose che non
       * insegnano niente: «scarico non riuscito (stato 5)», che è un numero
       * senza tabella, e «libdivecomputer non ha aperto il trasporto (stato
       * 3)», che è il nome di una libreria — uno dei nomi che
       * `dettaglioLeggibile` esiste apposta per togliere, nel punto più
       * evidente in cui non veniva usata. Quel nome viene dal Rust
       * (`src-tauri/src/trasporto_ldc.rs`) e non si può cambiare da qui senza
       * perdere il diario: si filtra qui, dove si decide che cosa mostrare.
       */
      let guasto: unknown;
      let grezzo: string | undefined;
      /** Lo scambio intero, quando il banco di prova è acceso. */
      let registrazione: string[] | undefined;
      const conservato = codiceAccoppiamento(device.id);
      // Il metodo conservato vale solo quando NON si sta già riprovando: chi
      // preme «riprova con un altro metodo» sta dicendo proprio che quello
      // conservato non va.
      const metodoSalvato = tentativo === undefined ? metodoConservato(device.id) : undefined;
      /*
       * ► IL SEGNALIBRO, CIOÈ LA COSA CHE ACCORCIA IL TRASFERIMENTO. ◄
       *
       * libdivecomputer si ferma appena ritrova l'immersione che gli diciamo di
       * conoscere già: senza, ogni scarico rilegge tutta la memoria del
       * computer, comprese le quaranta immersioni che sono già in archivio.
       * Su un collegamento che perde colpi è la leva più forte che abbiamo,
       * perché i byte che non attraversi sono gli unici che non possono
       * rompersi — ma vale **dal secondo scarico in poi**, e il primo resta
       * lungo quanto è sempre stato.
       *
       * `tuttoDaCapo` lo salta, perché è esattamente quello che chiede chi lo
       * accende.
       */
      const chiaveSegnalibro = markerKey(`ldc-${marca}-${modello}`, undefined, device.id);
      const segnalibro = tuttoDaCapo ? undefined : bleMarkers[chiaveSegnalibro]?.fingerprint;
      if (segnalibro) diario.push('si riparte dal segnalibro: solo le immersioni nuove');

      /*
       * ════════════════════════════════════════════════════════════════════
       * ► LO SCHERMO RESTA ACCESO, E SE SI SPEGNE LO SI SCRIVE. ◄
       *
       * Il conto del diario del Puck: 142 comandi e 32 KB per immersione, cioè
       * **migliaia** di comandi e parecchi minuti per un archivio intero. Minuti
       * in cui nessuno tocca lo schermo, perché c'è solo una barra che avanza —
       * e su iPhone il blocco automatico arriva dopo decine di secondi. Quando
       * lo schermo si spegne l'applicazione viene sospesa, le notifiche
       * Bluetooth smettono di arrivare, e per libdivecomputer è un computer che
       * ha smesso di rispondere: la lettura scade, il backend ritenta, e da lì
       * nasce la catena che il 10 settembre ha ucciso lo scarico.
       *
       * *Questa è un'ipotesi.* Per questo il blocco viene con la sua misura:
       * `righeDelloSchermo` scrive nel diario se il blocco non c'era e se la
       * pagina è sparita comunque. Il prossimo diario conferma o uccide
       * l'ipotesi con un'osservazione, non con un ragionamento.
       */
      const schermo = await tieniSvegliaLoSchermo();
      // ► E SOLO DOVE CONTA DAVVERO. ◄ Su un computer lo schermo che si
      // spegne non sospende l'applicazione: avvertire sarebbe mandare a
      // risolvere un problema che non c'è. Vedi `schermoSveglio.ts`, dove la
      // stessa correzione toglie la riga falsa dal diario.
      if (!schermo.ottenuto && schermo.contaDavvero) {
        setStato((p) => (p.fase === 'scarica' ? { ...p, schermoScoperto: true } : p));
      }
      const inizio = Date.now();
      try {
        const esito = await scaricaDaComputerEsterno({
          dispositivo: device.id,
          nome: device.name,
          marca,
          modello,
          codiceAccesso: conservato,
          tentativo,
          metodo: metodoSalvato,
          segnalibro,
          registra,
          emit: onEvent,
        });
        dives = esito.dives;
        registrazione = esito.registrazione;
        /*
         * ► UNO SCARICO ROTTO A METÀ NON È UNO SCARICO RIUSCITO, NEMMENO SE HA
         * PORTATO QUALCOSA. ◄ Le immersioni arrivate si tengono — sono buone,
         * sono le più recenti — ma il guasto va raccontato lo stesso, perché è
         * lui a decidere due cose che le immersioni non possono decidere: che
         * il segnalibro **non** si conserva (le più vecchie non sono state
         * lette) e che vale la pena riprovare.
         */
        if (esito.guasto) {
          grezzo = esito.guasto;
          guasto = new Error(esito.guasto);
        }
      } catch (e) {
        guasto = e;
        grezzo = e instanceof Error ? e.message : String(e);
        /*
         * ► UNA CHIAVE CHE NON VALE PIÙ SI DIMENTICA, O NON SI ESCE PIÙ. ◄
         *
         * Il computer viene azzerato, o accoppiato con il telefono di
         * qualcun altro, e la chiave conservata smette di valere. Ma con una
         * chiave in mano `pelagic_i330r_init` **salta del tutto il ramo del
         * PIN** e fallisce subito: lo scarico muore identico a ogni
         * tentativo, per sempre, e l'unica uscita sarebbe disinstallare
         * l'applicazione.
         *
         * Quindi al primo scarico fallito la chiave si butta. Il costo, se il
         * guasto era un altro, è digitare sei cifre una volta in più; il
         * costo di tenerla è un computer che non si scarica mai più.
         */
        if (conservato) {
          dimenticaAccoppiamento(device.id);
          diario.push(
            'lo scarico è fallito con una chiave conservata: chiave dimenticata, la prossima volta si riparte dal PIN',
          );
        }
        /*
         * ► E LO STESSO PER IL METODO. ◄ Un metodo conservato ha funzionato
         * una volta; se adesso fallisce, riproporlo domani vorrebbe dire
         * ripetere all'infinito la cosa che ha appena fallito. Si dimentica e
         * il giro riparte dal primo. Il costo, se il guasto era un altro, è un
         * tocco in più; il costo di tenerlo è un computer che non si scarica
         * mai più.
         */
        if (metodoSalvato) {
          dimenticaMetodo(device.id);
          diario.push('lo scarico è fallito con il metodo conservato: metodo dimenticato');
        }
      } finally {
        /*
         * La richiesta del PIN si chiude COMUNQUE vada.
         *
         * Se lo scarico è finito — bene o male — nessuno sta più aspettando
         * quelle cifre, e un riquadro che le chiede sotto il risultato è una
         * domanda a cui rispondere non serve più a niente. Succede davvero:
         * il collegamento può cadere mentre la persona sta ancora leggendo il
         * numero sullo schermo del computer.
         */
        setPin(null);
        /*
         * ► E LO SCHERMO SI LASCIA ANDARE COMUNQUE VADA. ◄ Un blocco preso e
         * mai rilasciato tiene il telefono acceso finché l'applicazione non si
         * chiude: una comodità che diventa una batteria vuota è peggio della
         * scomodità che toglieva.
         */
        const comeSta = await schermo.lascia();
        diario.push(`durata del tentativo: ${Math.round((Date.now() - inizio) / 1000)} s`);
        diario.push(...righeDelloSchermo(comeSta));
      }

      let testo: string;
      const avvisi: string[] = [];
      if (dives.length === 0) {
        testo = grezzo
          ? conDettaglio(
              `${t('Lo scarico si è interrotto. Non è stata salvata nessuna immersione.')} ` +
                t('Spegni e riaccendi il computer subacqueo, avvicinalo e riprova.'),
              guasto,
            )
          : segnalibro
            ? /*
               * ► CON UN SEGNALIBRO, ZERO IMMERSIONI NON È UNA MEMORIA VUOTA. ◄
               * È la risposta «non c'è niente di più recente di quello che hai
               * già», e dirla come se il computer fosse vuoto manda a
               * controllare un apparecchio che non ha nessun problema — o, peggio,
               * a rifare uno scarico completo per niente. La strada dei driver
               * di casa questa distinzione la faceva già: qui mancava.
               */
              t('Niente di nuovo: il computer non ha immersioni più recenti di quelle che hai già.')
            : t('Il computer non ha immersioni in memoria da scaricare.');
      } else {
        /*
         * L'ORIGINE DICE DA DOVE PASSA, e non è un dettaglio di etichetta.
         *
         * Una lettura fatta da libdivecomputer con un modello che qui dentro
         * non è mai stato provato non è la stessa cosa di una fatta dai driver
         * di casa, che con l'apparecchio in mano hanno letto cento e passa
         * immersioni a testa. Se un giorno un profilo risultasse storto, la
         * prima domanda sarà «da dove è entrato»: la risposta va scritta
         * addosso all'immersione, non ricostruita dopo.
         */
        const r = await importDives(dives, `${marca} ${modello} via libdivecomputer`);
        testo = r.ok
          ? `${imm(r.found, t)} ${t('lette dal computer')}: ${r.added} ${t('nuove')}, ` +
            `${r.merged} ${t('arricchite')}, ${r.duplicates} ${t('già in archivio')}.`
          : `${imm(dives.length, t)} ${t('sono arrivate ma non si sono potute salvare')}: ` +
            `${r.error ?? t('motivo non riportato')}. ` +
            t('Controlla lo spazio libero sul dispositivo e riprova.');
        if (r.ok) avvisi.push(...r.warnings);
      }
      // Come sull'altra strada: se non è arrivato niente il motivo sta già in
      // `testo`, e ripeterlo qui sarebbe la stessa riga scritta due volte.
      if (dives.length > 0) {
        const dettaglio = guasto === undefined ? '' : dettaglioLeggibile(guasto);
        if (dettaglio) avvisi.push(dettaglio);
      }

      /*
       * ► IL METODO CHE HA VINTO SI CONSERVA, QUELLO CHE HA PERSO SI OFFRE DI
       * CAMBIARE. ◄
       *
       * Riuscito vuol dire che quelle cinque scelte erano giuste per QUESTO
       * computer: dal prossimo scarico si riparte da lì, e l'attesa di due
       * tocchi diventa nessuna. Fallito vuol dire che ce n'è un altro da
       * provare — se c'è — e allora la schermata di esito non è un vicolo
       * cieco ma un pulsante.
       *
       * «Ha funzionato» qui è **almeno un'immersione arrivata**, non l'assenza
       * di eccezioni: un collegamento che si apre, non dice niente e si chiude
       * senza errori non ha dimostrato niente sul metodo, e conservarlo
       * vorrebbe dire inchiodare quel computer a una combinazione muta.
       *
       * ► E, ALL'OPPOSTO, UNO SCARICO ROTTO A METÀ IL METODO LO HA DIMOSTRATO
       * ECCOME. ◄ Le due immersioni del Puck sono passate da lì: quel metodo è
       * buono, è il collegamento che si è rotto. Per questo «conservo il
       * metodo?» e «c'è ancora qualcosa da fare?» sono due domande diverse,
       * con due risposte diverse, e da adesso hanno due nomi diversi. Tenerle
       * insieme sotto un solo `riuscito` è costato il diario del 10 settembre:
       * trenta righe più giù c'è scritto quanto.
       */
      const metodoHaFunzionato = dives.length > 0;
      if (metodoHaFunzionato && metodoInCorso) {
        salvaMetodo(device.id, metodoInCorso.chiave);
        diario.push(`metodo conservato per la prossima volta: ${metodoInCorso.nome}`);
      }

      /*
       * ════════════════════════════════════════════════════════════════════
       * ► IL SEGNALIBRO SI SALVA SOLO DOPO UNO SCARICO FINITO BENE. ◄
       *
       * E qui la condizione è **`!grezzo`**, non «ha funzionato»: dev’essere finito
       * senza errori, non «aver portato qualcosa».
       *
       * Perché le immersioni si leggono dalla più recente alla più vecchia. Uno
       * scarico interrotto a metà ha in mano le prime — le più nuove — e non ha
       * ancora visto le più vecchie. Salvare lì l'impronta della più recente
       * direbbe al prossimo scarico «da qui in giù ce l'ho già», e le vecchie
       * **non arriverebbero mai più**, in silenzio, senza un errore da nessuna
       * parte.
       *
       * *In un logbook è il difetto peggiore che esista: non perde dati che
       * hai, perde dati che non sai di non avere.* Con l'insistenza automatica
       * — che gli scarichi interrotti li produce apposta, cinque per giro — non
       * è un caso di scuola: sarebbe il caso normale.
       *
       * E dopo `importDives`, mai prima: se il salvataggio in archivio
       * fallisse, il segnalibro salterebbe proprio le immersioni che non sono
       * entrate.
       */
      if (!grezzo && metodoHaFunzionato && piuRecente) {
        await saveBleMarker(chiaveSegnalibro, {
          fingerprint: piuRecente,
          at: new Date().toISOString(),
          dives: dives.length,
          model: `${marca} ${modello}`,
        });
        diario.push('segnalibro conservato: il prossimo scarico leggerà solo le immersioni nuove');
      }

      /*
       * ════════════════════════════════════════════════════════════════════
       * ► IL DIARIO SI ACCUMULA FRA I TENTATIVI, E NON È UN DETTAGLIO. ◄
       *
       * Da qui in avanti l'applicazione riprova da sola, anche tre o quattro
       * volte. Se ogni giro cancellasse il diario del precedente, chi ci manda
       * una segnalazione ci manderebbe **l'ultimo** tentativo — cioè quello
       * fatto nelle condizioni peggiori, dopo che il computer è stato
       * scollegato e ricollegato più volte — e non il primo, che è quello che
       * racconta come è cominciata.
       *
       * *È lo stesso motivo per cui il riassunto tiene la coda delle scritture
       * invece della sola testa: quello che serve a capire non è la parte che
       * arriva per prima.*
       */
      const righeDiQuestoGiro = [
        ...(insiste && insiste.diario.length > 0 ? ['', `── tentativo n. ${fatti + 1} ──`] : []),
        `MyDiveLog — diario dello scarico (libdivecomputer)`,
        `dispositivo: ${device.name || 'senza nome'}`,
        `modello scelto: ${marca} ${modello}`,
        `esito: ${grezzo ? `errore — ${grezzo}` : 'completato'}`,
        `immersioni: ${dives.length}`,
        '',
        ...diario,
      ];
      const diarioIntero = [...(insiste?.diario ?? []), ...righeDiQuestoGiro];

      /*
       * Il punto più avanti raggiunto, che si porta avanti come il diario.
       * Vedi `PuntoRaggiunto`: sta **prima** del blocco che riprova perché
       * deve scendere nel tentativo successivo, e non solo finire nel riquadro.
       */
      const raccolto: PuntoRaggiunto | undefined = piuRecente
        ? {
            impronta: insiste?.raccolto?.impronta ?? piuRecente,
            quante: Math.max(dives.length, insiste?.raccolto?.quante ?? 0),
          }
        : insiste?.raccolto;

      /*
       * ► E QUI SI DECIDE SE RIPROVARE, E COME. ◄ La regola sta tutta in
       * `core/insistenza.ts`, che è una funzione pura apposta: la differenza
       * fra «riprova uguale» e «prova un altro modo» è la cosa più importante
       * di questa schermata, e va potuta provare senza un Bluetooth davanti.
       */
      /*
       * ════════════════════════════════════════════════════════════════════
       * ► «SONO ARRIVATE DELLE IMMERSIONI» NON VUOL DIRE «NON C'È PIÙ NIENTE
       *   DA FARE». ◄
       *
       * Questa riga nasce da un diario vero, quello del 10 settembre 2026: un
       * Puck 4 su un iPhone, 64 236 byte ricevuti, un errore di protocollo, e
       * **due** immersioni salvate su un archivio che ne conta quarantacinque.
       * Il recupero parziale, scritto la notte prima, aveva fatto esattamente
       * il suo mestiere. E proprio per questo l'applicazione si è fermata:
       * `riuscito` era `dives.length > 0`, due è più di zero, e i cinque
       * tentativi automatici — scritti la stessa notte, per lo stesso
       * apparecchio — non sono mai partiti. *Due rimedi giusti, messi insieme,
       * si sono spenti a vicenda: il primo ha fatto sembrare riuscito quello
       * che il secondo esisteva per riprovare.*
       *
       * Si smette dunque solo quando non è rimasto niente da chiedere:
       *
       *  - lo scarico è finito **senza errori** (`!grezzo`) — un errore vuol
       *    dire, per definizione, che il computer aveva ancora qualcosa da
       *    dire e non è riuscito a dirlo;
       *  - e o è arrivata almeno un'immersione, o c'era un **segnalibro**:
       *    con un segnalibro, zero immersioni non è un fallimento ma la
       *    risposta «niente di nuovo», e insistere cinque volte per farsela
       *    ripetere sarebbe solo batteria buttata a chi non ha nessun problema.
       *
       * Restano a insistere i due casi che se lo meritano: lo scarico rotto —
       * con o senza immersioni in mano — e il collegamento muto senza
       * segnalibro, che è quello che fa girare i metodi.
       */
      const nienteAltroDaFare = !grezzo && (dives.length > 0 || segnalibro !== undefined);

      const scelta = decidiComeInsistere({
        nienteAltroDaFare,
        haRisposto: (scambio?.notifications ?? 0) > 0,
        metodo: metodoInCorso ? { indice: metodoInCorso.indice, totale: metodoInCorso.totale } : undefined,
        partitoDa: tentativo,
        fatti,
        stesso,
        fermato: smettiDiInsistere.current,
      });

      if (scelta.cosa !== 'smetti') {
        const comeSiChiama =
          scelta.cosa === 'stesso-metodo'
            ? 'il computer aveva risposto: riprovo allo stesso modo'
            : 'nessuna risposta con questo modo: provo il prossimo';
        diarioIntero.push('', `→ ${comeSiChiama}`);
        await scaricaEsternoRef.current?.(device, marca, modello, scelta.tentativo, {
          fatti: scelta.fatti,
          stesso: scelta.stesso,
          diario: diarioIntero,
          raccolto,
        });
        return;
      }

      /*
       * Si è smesso. Il pulsante «Riprova con un altro modo» resta, ma adesso
       * è davvero l'ultima spiaggia e non la prima proposta: ci si arriva solo
       * dopo che l'applicazione ha provato da sola tutto quello che sapeva
       * provare. *Toglierlo del tutto sarebbe stato più pulito e meno onesto:
       * chi ha il computer in mano sa cose che noi non sappiamo.*
       */
      const altroMetodo =
        !metodoHaFunzionato && metodoInCorso && metodoInCorso.indice + 1 < metodoInCorso.totale
          ? {
              device,
              marca,
              modello,
              prossimo: metodoInCorso.indice + 1,
              totale: metodoInCorso.totale,
            }
          : undefined;

      /*
       * ► L'OFFERTA SI FA SOLO QUANDO SERVE DAVVERO, E CIOÈ QUASI MAI. ◄
       *
       * Due condizioni insieme: c'è stato un **guasto** (uno scarico finito
       * bene il segnalibro se lo prende da solo) e in qualche tentativo era
       * arrivata almeno un'immersione, cioè esiste un punto da cui ripartire.
       * Fuori da questo incrocio il riquadro non compare, perché un'offerta
       * che si può accettare per sbaglio quando non serve è peggio di nessuna
       * offerta: qui accettarla vuol dire smettere di cercare delle
       * immersioni.
       */
      const ripartiDaQui =
        grezzo && raccolto
          ? {
              chiave: chiaveSegnalibro,
              impronta: raccolto.impronta,
              quante: raccolto.quante,
              modello: `${marca} ${modello}`,
            }
          : undefined;

      setStato({
        fase: 'finito',
        testo,
        avvisi,
        parziale: false,
        altroMetodo,
        ripartiDaQui,
        registrazione,
        diario: diarioIntero,
      });
    },
    [fermaRicerca, importDives, t, bleMarkers, saveBleMarker, tuttoDaCapo, registra],
  );
  /*
   * Il `ref` si riempie dopo ogni disegno, così il tentativo automatico che
   * parte fra dieci secondi usa la funzione di adesso e non quella di allora.
   * Va in un effetto e non nel corpo: scrivere un `ref` durante il disegno è
   * il genere di cosa che funziona finché React non decide di disegnare due
   * volte, e allora smette di funzionare in un modo che non somiglia alla
   * causa.
   */
  useEffect(() => {
    scaricaEsternoRef.current = scaricaEsterno;
  });

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
          <button onClick={interrompi}>{t('Interrompi')}</button>
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
       * ► ATTENZIONE: LA PREMESSA DI QUESTO RIQUADRO È CAMBIATA. ◄ Qui c'era
       * scritto che «su iPhone il permesso Bluetooth negato NON produce nessun
       * errore». Il 28 agosto 2026 il primo utente esterno dell'app ha
       * dimostrato il contrario: `scan()` lancia `Permission denied`, e adesso
       * quel caso ha un messaggio suo, col percorso delle impostazioni (vedi il
       * `catch` della ricerca, e `core/ble/causaGuasto.ts`).
       *
       * Resta vero il pezzo su `checkPermissions`, implementato solo per
       * Android, e sull'enum dell'adattatore che non ha un valore «non
       * autorizzato»: nessuno dei due vede il permesso.
       *
       * QUINDI PERCHÉ QUESTO RIQUADRO RESTA. Perché copre i casi che sono
       * ancora muti davvero, e sono i più comuni: il computer spento, lontano o
       * non in modalità collegamento, e il pannello del permesso mai comparso.
       * In tutti quei casi la ricerca gira e basta. Si elencano ONESTAMENTE le
       * cause possibili invece di indovinarne una — e adesso quella del
       * permesso negato è nell'elenco per prudenza, non più perché non si sa
       * distinguerla. Dodici secondi: abbastanza perché un computer acceso e
       * vicino sia già comparso, poco perché nessuno si arrenda prima.
       *
       * ► E L'ULTIMA RIGA DEL RIQUADRO DICEVA ANCORA LA COSA SMENTITA. ◄ «Un
       * permesso negato non dà errore: la ricerca sembra solo non trovare
       * niente.» Era la premessa crollata il 28 agosto, rimasta a schermo dopo
       * che il codice l'aveva abbandonata — e da lì contraddiceva il ramo
       * `denied`, che un errore lo mostra eccome. Peggio: mandava a controllare
       * un permesso a chi ce l'ha, cioè a cercare dove NON è il problema.
       * Adesso dice il contrario, che è anche quello che serve sapere qui: se
       * il permesso fosse negato lo diremmo, quindi la ricerca sta girando
       * davvero e il computer è da cercare altrove.
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
          {t('Un permesso negato lo diremmo con un messaggio: qui la ricerca sta girando davvero.')}
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
          {/*
           * ► IL BANCO DI PROVA STA QUI, IN CHIARO, E NON DIETRO UN GESTO
           * SEGRETO. ◄
           *
           * La tentazione era nasconderlo: è roba da manutentori, e una riga in
           * più su una schermata che deve restare semplice si paga. Ma un
           * interruttore nascosto ha due difetti che pesano di più. Il primo è
           * che va ricordato — e chi lo ha scritto se lo ricorda per un mese,
           * chi lo userà fra un anno no. Il secondo è che *una funzione
           * nascosta in un'app di un negozio è una funzione che nessuno ha
           * dichiarato*, e questo progetto non ne ha.
           *
           * Sta in fondo, spento, con scritto a cosa serve e che non serve a
           * chi scarica le immersioni. Chi non ne ha bisogno lo legge una volta
           * e non lo tocca più.
           */}
          <label
            className="planner-check"
            style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}
          >
            <input type="checkbox" checked={registra} onChange={(e) => setRegistra(e.target.checked)} />
            <span>
              {t('Registra tutto lo scambio col computer')}
              <span className="muted">
                {' — '}
                {t('per chi ripara: alla fine si può salvare su file. Non serve a scaricare le immersioni.')}
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
              {trovati.map(({ device, driver }) => {
                /*
                 * LA RIGA DICE QUELLO CHE SI SA, E SOLO QUELLO.
                 *
                 * Con un driver di casa: l'etichetta del driver. Senza, ma con
                 * un modello riconosciuto dal nome: marca e modello, e da
                 * dove passa lo scarico. Senza, con una famiglia ma non il
                 * modello: la marca, e «scegli il modello». Senza niente: la
                 * frase di sempre. Quattro righe diverse per quattro
                 * situazioni diverse, perché «non riconosciuto» davanti a un
                 * Mares era una bugia che costava venti tocchi.
                 */
                const proposta = driver ? undefined : proposte[device.id];
                const riconosciuto = proposta?.tipo === 'modello' ? proposta.voce : null;
                const esitoRiconosciuto = riconosciuto ? esitoPer(riconosciuto, conLibdivecomputer) : null;
                const scaricabile =
                  esitoRiconosciuto?.tipo === 'si-scarica' || esitoRiconosciuto?.tipo === 'si-scarica-ldc';
                const marcheProposte =
                  proposta?.tipo === 'scelta'
                    ? [...new Set(proposta.voci.map((v) => v.marca))].join(' / ')
                    : '';
                const didascalia = driver
                  ? t(driver.label)
                  : riconosciuto
                    ? `${riconosciuto.marca} ${riconosciuto.modello}${
                        esitoRiconosciuto?.tipo === 'si-scarica-ldc' ? ` — ${t('via libdivecomputer')}` : ''
                      }`
                    : marcheProposte
                      ? `${marcheProposte} — ${t('scegli il modello')}`
                      : t('non riconosciuto come computer subacqueo');
                const avviaRiconosciuto = () => {
                  if (!riconosciuto || !esitoRiconosciuto) return;
                  if (esitoRiconosciuto.tipo === 'si-scarica') {
                    const scelto = DRIVERS.find((d) => d.id === esitoRiconosciuto.driverId);
                    if (scelto) void scarica({ device, driver: scelto });
                    return;
                  }
                  if (esitoRiconosciuto.tipo === 'si-scarica-ldc') {
                    void scaricaEsterno(device, riconosciuto.marca, riconosciuto.modello);
                  }
                };
                return (
                  <li key={device.id}>
                    <div className="dispositivo-nome">
                      <b>{device.name || t('senza nome')}</b>
                      <span>{didascalia}</span>
                    </div>
                    <div className="dispositivo-azione">
                      <span className="muted tabular" style={{ fontSize: 12 }}>
                        {device.rssi !== undefined ? `${device.rssi} dBm` : '—'}
                      </span>
                      {driver ? (
                        <button className="btn" onClick={() => void scarica({ device, driver })}>
                          {t('Scarica')}
                        </button>
                      ) : scaricabile ? (
                        /*
                         * RICONOSCIUTO DAL NOME: «Scarica» diretto, e accanto
                         * la via d'uscita. Il pulsante di ripiego tiene
                         * `data-scegli`, perché è lui che riprende il fuoco
                         * quando il selettore si chiude senza scaricare.
                         */
                        <>
                          <button
                            className="btn secondary"
                            style={{ fontSize: 12 }}
                            data-scegli={device.id}
                            onClick={() => {
                              setSpiegazione(null);
                              setScegliPer(scegliPer === device.id ? null : device.id);
                            }}
                          >
                            {t('Non è questo?')}
                          </button>
                          <button className="btn" onClick={avviaRiconosciuto}>
                            {t('Scarica')}
                          </button>
                        </>
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
                        <button
                          className="btn secondary"
                          style={{ fontSize: 12 }}
                          data-scegli={device.id}
                          onClick={() => {
                            setSpiegazione(null);
                            setScegliPer(scegliPer === device.id ? null : device.id);
                          }}
                        >
                          {t('Che computer è?')}
                        </button>
                      )}
                    </div>
                    {/*
                     * IL SELETTORE SI APRE SOTTO LA RIGA DEL DISPOSITIVO, non
                     * altrove. Sono 105 modelli: aperti in un'altra schermata si
                     * perde di vista A QUALE dei dispositivi trovati si sta
                     * dando un nome, e in una barca con tre computer accesi non è
                     * un dettaglio.
                     */}
                    {scegliPer === device.id && (
                      <ScegliComputer
                        onAnnulla={() => {
                          setScegliPer(null);
                          tornaAlPulsante(device.id);
                        }}
                        conLibdivecomputer={conLibdivecomputer}
                        /*
                         * Le proposte entrano nel selettore solo quando il nome
                         * ha dato la famiglia e non il modello. Dopo «Non è
                         * questo?» la proposta è già stata rifiutata: riproporla
                         * in cima sarebbe insistere.
                         */
                        proposte={proposta?.tipo === 'scelta' ? proposta.voci : []}
                        onScegli={(modello) => {
                          const esito = esitoPer(modello, conLibdivecomputer);
                          setScegliPer(null);
                          // Il fuoco torna al pulsante solo quando si RESTA qui:
                          // se parte uno scarico la schermata cambia del tutto, e
                          // rimettere il fuoco su un pulsante che sta per sparire
                          // sposterebbe la pagina per niente.
                          if (esito.tipo !== 'si-scarica' && esito.tipo !== 'si-scarica-ldc') {
                            tornaAlPulsante(device.id);
                          }
                          if (esito.tipo === 'si-scarica') {
                            const scelto = DRIVERS.find((d) => d.id === esito.driverId);
                            if (scelto) void scarica({ device, driver: scelto });
                            return;
                          }
                          if (esito.tipo === 'si-scarica-ldc') {
                            void scaricaEsterno(device, modello.marca, modello.modello);
                            return;
                          }
                          setSpiegazione(modello);
                        }}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/*
           * ► LA RISPOSTA A CHI HA SCELTO UN COMPUTER CHE NON SI SCARICA. ◄
           *
           * È il momento in cui l'applicazione deve dire una cosa scomoda, e il
           * modo in cui la dice decide se quella persona resta. Quindi: cosa
           * NON si può fare, perché, e cosa si può fare INVECE — in
           * quest'ordine, e senza «prossimamente», che è una promessa che non
           * possiamo mantenere a data certa.
           *
           * I due casi sono diversi e vanno detti diversi. «Non ancora» vuol
           * dire che il protocollo si conosce e prima o poi ci arriviamo.
           * Garmin vuol dire che non ci arriveremo mai, perché i Descent i dati
           * via Bluetooth non li danno a nessuna applicazione: li mandano ai
           * server di Garmin. Dire «non ancora» anche lì sarebbe una bugia
           * comoda, e qualcuno aspetterebbe una versione che non esisterà.
           */}
          {spiegazione && (
            <div className="notice" role="status">
              <b>
                {spiegazione.marca} {spiegazione.modello}
              </b>{' '}
              {esitoPer(spiegazione, conLibdivecomputer).tipo === 'mai-via-radio'
                ? t(
                    'non manda le immersioni via Bluetooth a nessuna applicazione: le tiene per quella del costruttore. Esporta le immersioni da lì e importa qui il file — i dati sono gli stessi.',
                  )
                : t(
                    'usa un protocollo che l’applicazione non legge ancora. Nel frattempo esporta le immersioni dall’applicazione del costruttore e importa qui il file: i formati accettati sono elencati qui sotto.',
                  )}
              <div style={{ marginTop: 8 }}>
                <button className="btn secondary" onClick={() => setSpiegazione(null)}>
                  {t('Ho capito')}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/*
       * ► LA RICHIESTA DEL PIN. ◄ Sta sopra l'avanzamento perché mentre è
       * aperta l'avanzamento non avanza: lo scarico è fermo qui.
       *
       * `aria-live="assertive"` e non `polite`: è l'unica cosa in tutta
       * l'applicazione che interrompe una persona perché un apparecchio la
       * sta aspettando, e chi usa un lettore di schermo deve saperlo adesso e
       * non alla fine della frase che stava ascoltando.
       */}
      {pin && (
        <div className="notice" role="group" aria-live="assertive" style={{ marginBottom: 10 }}>
          <b>{t('Il computer chiede un codice')}</b>
          <p style={{ margin: '6px 0' }}>
            {t('Sullo schermo del computer subacqueo è comparso un numero di sei cifre. Scrivilo qui sotto.')}{' '}
            <span className="muted">{t('Serve solo la prima volta: dopo, il collegamento è diretto.')}</span>
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              /*
               * `inputMode="numeric"` apre la tastiera dei numeri sul
               * telefono, che è dove questo succede quasi sempre: un computer
               * subacqueo si scarica in barca, non alla scrivania. Il tipo
               * resta `text` di proposito — `type="number"` aggiunge le
               * frecce, accetta il segno meno e la notazione esponenziale, e
               * qui non è un numero: è una sequenza di sei cifre.
               */
              type="text"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              maxLength={6}
              aria-label={t('Le sei cifre mostrate dal computer')}
              value={pin.cifre}
              onChange={(e) =>
                // Si filtra scrivendo e non al momento di confermare: chi
                // digita una lettera per sbaglio la vede sparire subito,
                // invece di scoprire alla fine che il codice non va bene.
                setPin((p) => (p ? { ...p, cifre: e.target.value.replace(/\D/g, '').slice(0, 6) } : p))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pin.cifre.length > 0) rispondiAlPin(pin.cifre);
              }}
              style={{ width: '7em', letterSpacing: '0.25em', fontSize: 18 }}
            />
            {/*
             * Si conferma da UNA cifra in su, e non da sei, anche se il testo
             * qui sopra dice sei e il campo non ne accetta di più.
             * `pelagic_i330r_init_passcode` ne accetta da una a sei e le
             * allinea a destra: se un domani un modello ne mostrasse quattro,
             * pretenderne sei bloccherebbe quella persona per sempre, mentre
             * confermare presto per sbaglio costa un tentativo. Fra un
             * fastidio e un muro si sceglie il fastidio.
             */}
            <button
              className="btn"
              disabled={pin.cifre.length === 0}
              onClick={() => rispondiAlPin(pin.cifre)}
            >
              {t('Conferma')}
            </button>
            {/*
             * La rinuncia è un PULSANTE, e non una crocetta in un angolo.
             * Chiudere senza rispondere lascerebbe lo scarico fermo fino alla
             * scadenza — tre minuti in cui l'applicazione non fa niente e non
             * dice niente. Qui la rinuncia è una risposta, e arriva subito.
             */}
            <button className="btn secondary" onClick={() => rispondiAlPin(null)}>
              {t('Annulla lo scarico')}
            </button>
          </div>
        </div>
      )}

      {stato.fase === 'scarica' && stato.schermoScoperto && (
        /*
         * ► SI DICE SOLO QUANDO NON SI PUÒ FARE. ◄ Se il blocco dello schermo
         * l'abbiamo preso, questa riga è rumore sopra una barra che avanza: chi
         * guarda non deve fare niente e leggerebbe un avvertimento inutile, che
         * è il modo di insegnare a non leggere gli avvertimenti. Compare solo
         * dove il sistema non ci lascia difendere lo scarico da soli — e lì è
         * l'unica difesa che resta.
         */
        <div className="notice notice-error" role="status">
          {t(
            'Tieni acceso lo schermo e resta su questa schermata: se il telefono si blocca o cambi applicazione, lo scarico si ferma.',
          )}
        </div>
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
           * sarebbe la scritta «Lettura in corso…», che è indistinguibile da un blocco.
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
           * ► «NON HA FUNZIONATO» NON È UNA RISPOSTA, SE C'È ANCORA QUALCOSA DA
           * PROVARE. ◄
           *
           * Per parlare con un computer via Bluetooth ci sono cinque scelte da
           * fare, e su un modello mai visto indovinarle tutte al primo colpo è
           * fortuna. Finché il guscio ha un'altra combinazione in elenco,
           * questa schermata deve offrirla — e deve dire **quante** ne restano,
           * perché premere un pulsante senza sapere se è l'ultimo è il modo
           * migliore per smettere al secondo tentativo.
           *
           * Sta sopra il diario tecnico di proposito: il diario serve a chi
           * ripara, questo pulsante a chi ha il computer in mano adesso.
           */}
          {stato.altroMetodo && (
            <div className="notice" style={{ marginTop: 10 }}>
              <b>{t('C’è un altro modo da provare.')}</b>{' '}
              {t(
                'Ogni computer si collega in un modo suo, e non sempre si indovina al primo colpo. Riprova: cambia il modo di parlargli, non il computer.',
              )}
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn"
                  onClick={() => {
                    const a = stato.altroMetodo;
                    if (a) void scaricaEsterno(a.device, a.marca, a.modello, a.prossimo);
                  }}
                >
                  {t('Riprova con un altro modo')}
                </button>
                <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
                  {frase(
                    t,
                    'Modo {0} di {1}.',
                    String(stato.altroMetodo.prossimo + 1),
                    String(stato.altroMetodo.totale),
                  )}
                </span>
              </div>
            </div>
          )}
          {/*
           * ► IL PUNTO DI RIPARTENZA, OFFERTO E NON PRESO. ◄
           *
           * Sta **sotto** «prova un altro modo» e **sopra** il diario, e
           * l'ordine è la scala di quanto è reversibile quello che si propone:
           * prima riprovare (non costa niente), poi questo (costa delle
           * immersioni che non si andranno più a prendere), poi il diario (che
           * è per chi ripara).
           *
           * Il pulsante dice cosa fa, non «ok»: chi lo preme sta rinunciando a
           * qualcosa, e deve leggerlo nel pulsante e non solo nel paragrafo
           * sopra — i paragrafi sopra i pulsanti non li legge nessuno.
           */}
          {stato.ripartiDaQui && (
            <div className="notice" style={{ marginTop: 10 }}>
              <b>{t('Il computer ha più immersioni di quante ne siano arrivate.')}</b>{' '}
              {frase(
                t,
                'Lo scarico si è interrotto dopo {0}. Su una memoria piena, riprovare spesso non basta: il trasferimento si rompe sempre prima della fine, e ogni tentativo riparte da capo.',
                imm(stato.ripartiDaQui.quante, t),
              )}
              <p style={{ margin: '8px 0 0' }}>
                {t(
                  'Se le immersioni più vecchie ce le hai già — da un backup, da un’altra applicazione, o sul libretto — puoi dire a MyDiveLog di ripartire da qui: dalla prossima volta scaricherà soltanto quelle nuove, in pochi secondi.',
                )}
              </p>
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
                {t(
                  'Quelle più vecchie di così non verranno più scaricate da questo computer. Per ripensarci: togli il segnalibro qui sopra, oppure spunta «Scarica tutto da capo».',
                )}
              </p>
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn"
                  onClick={() => {
                    const r = stato.ripartiDaQui;
                    if (!r) return;
                    void saveBleMarker(r.chiave, {
                      fingerprint: r.impronta,
                      at: new Date().toISOString(),
                      dives: r.quante,
                      model: r.modello,
                    });
                    // L'offerta sparisce appena è stata accettata: un pulsante
                    // che resta premibile dopo aver fatto il suo mestiere fa
                    // premere due volte, e la seconda volta non si sa cosa
                    // succede.
                    setStato((p) =>
                      p.fase === 'finito'
                        ? {
                            ...p,
                            ripartiDaQui: undefined,
                            avvisi: [
                              ...p.avvisi,
                              t('Segnalibro messo: dalla prossima volta arrivano solo le immersioni nuove.'),
                            ],
                          }
                        : p,
                    );
                  }}
                >
                  {t('Considera già prese le più vecchie')}
                </button>
              </div>
            </div>
          )}
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
               * ► LA REGISTRAZIONE SI SALVA SU FILE, NON SI COPIA NEGLI
               * APPUNTI. ◄ Su un archivio pieno sono migliaia di righe: gli
               * appunti le prendono e poi si scopre che l'incollata è tagliata,
               * o che l'applicazione dove si incolla non regge. *Un file si
               * apre fra un anno; una cosa incollata da qualche parte no.*
               */}
              {stato.registrazione && stato.registrazione.length > 0 && (
                <button
                  onClick={() => {
                    void (async () => {
                      try {
                        /*
                         * ► IL DIARIO VA IN TESTA ALLA REGISTRAZIONE, COME
                         * INTESTAZIONE. ◄
                         *
                         * La prima registrazione vera, dell'11 settembre 2026,
                         * era decodificabile per intero — seriale, orologio,
                         * impronta, tutto tornava con il diario — e **non
                         * diceva di chi fosse**. Nessun modello, nessuna
                         * versione, nessuna data dentro il file.
                         *
                         * Fra sei mesi, con dieci registrazioni di apparecchi
                         * diversi in una cartella, quel file sarebbe stato
                         * indistinguibile dagli altri. *Un file destinato a
                         * sopravvivere all'apparecchio deve dire da dove
                         * viene, e il posto giusto per dirlo è dentro di sé,
                         * non nel nome.*
                         *
                         * Il diario lo sa già tutto — modello, seriale,
                         * firmware, MTU, metodo, durata — quindi non si
                         * inventa niente: si mette in testa col segno `!`, che
                         * nel formato vuol dire «evento» ed è già quello che
                         * chi analizza salta.
                         */
                        const righe = [
                          `! MyDiveLog ${versione()} — registrazione dello scambio`,
                          `! salvata il ${new Date().toISOString()}`,
                          ...stato.diario.map((r) => `! ${r}`),
                          '',
                          ...(stato.registrazione ?? []),
                        ];
                        const dove = await esporta(
                          `mydivelog-scambio-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`,
                          righe.join('\n'),
                          'text/plain;charset=utf-8',
                        );
                        setSalvataggio(`${t('Salvato')} ${dove.dove}.`);
                      } catch (err) {
                        // `conDettaglio` e non l'errore crudo: la prima
                        // versione di questa riga metteva a schermo il
                        // messaggio così com'era, e `nomiInterniAValle` l'ha
                        // presa in venti secondi. *Una guardia che prende chi
                        // l'ha scritta è una guardia che funziona.*
                        setSalvataggio(
                          conDettaglio(
                            `${t('Non si è potuto salvare')}. ` +
                              t(
                                'Controlla lo spazio libero sul dispositivo e riprova: il file non è stato scritto.',
                              ),
                            err,
                          ),
                        );
                      }
                    })();
                  }}
                >
                  {frase(t, 'Salva lo scambio ({0} righe)', String(stato.registrazione.length))}
                </button>
              )}
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
                          conDettaglio(
                            `${t('Non si è potuto salvare')}. ` +
                              t(
                                'Controlla lo spazio libero sul dispositivo e riprova: il file non è stato scritto.',
                              ),
                            err,
                          ),
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
