/**
 * Che cos'è un computer subacqueo, visto da qui.
 *
 * Questo file non importa niente e non parla con nessuno. È il contratto fra
 * tre cose che cambiano a velocità diverse: il **trasporto** (il Bluetooth del
 * sistema operativo, che cambia con Tauri e con Apple), il **driver** (il
 * protocollo di un computer, che non cambia mai perché è inciso nel firmware) e
 * l'**interfaccia** (che cambia ogni volta che qualcosa non si capisce).
 *
 * Perché tre pezzi e non una funzione sola. Un protocollo si scrive UNA VOLTA e
 * poi si prova col computer in mano, che è la parte lenta e costosa: se il
 * codice del protocollo è mescolato alle chiamate del plugin BLE, ogni tentativo
 * richiede il computer acceso, un Mac, e una build. Separati, il protocollo si
 * prova contro un dispositivo finto — che risponde come quello vero e sbaglia
 * come quello vero — e col computer in mano resta da verificare solo l'ultimo
 * miglio.
 *
 * E c'è una ragione più concreta: nessuno dei due protocolli che ci servono è
 * documentato dal costruttore. Sono stati ricostruiti leggendo
 * `libdivecomputer`, e la prima versione di una cosa ricostruita è sempre
 * sbagliata in qualche punto. Il posto dove si scopre quale punto è un test che
 * gira in un secondo, non una barca.
 */

/** Un dispositivo visto durante la ricerca. Non ancora connesso. */
export interface BleFoundDevice {
  /**
   * Come lo chiama il sistema per riconnettersi.
   *
   * NON è un indirizzo MAC su Apple: CoreBluetooth non lo espone e restituisce
   * un UUID che vale solo per questo Mac e per questa app. Quindi è opaco per
   * definizione, non si mostra all'utente e non si salva come identità del
   * computer — per quella c'è il numero di serie, che arriva dopo, dal
   * protocollo.
   */
  id: string;
  /** Il nome annunciato. Vuoto succede, ed è il caso che rompe i riconoscimenti ingenui. */
  name: string;
  /** Potenza del segnale in dBm, dove il sistema la dà. Serve a ordinare, non a decidere. */
  rssi?: number;
  /** UUID dei servizi annunciati, minuscoli. Spesso vuoto: molti computer non li annunciano. */
  serviceUuids: string[];
}

/**
 * I due canali che servono per parlare con un computer subacqueo.
 *
 * Praticamente tutti espongono una «seriale su BLE»: una caratteristica su cui
 * si scrive e una su cui arrivano le notifiche. Non è uno standard — è una
 * convenzione che tutti hanno copiato dai moduli Nordic e Microchip — quindi gli
 * UUID li dichiara il driver, uno per modello.
 */
export interface BleServiceProfile {
  service: string;
  /**
   * Dove si scrive. Indefinito = si SCOPRE dal dispositivo.
   *
   * La scoperta è la scelta buona per difetto, e non per pigrizia: gli UUID
   * delle caratteristiche dentro un servizio proprietario cambiano da modello a
   * modello e da firmware a firmware, mentre le PROPRIETÀ no — quella su cui si
   * scrive dichiara «write» o «write senza risposta», quella da cui si legge
   * dichiara «notify». È il criterio che usa Subsurface, e regge su tutta la
   * famiglia di un costruttore invece che su un modello solo. Scriverli a mano
   * resta possibile per i casi in cui un servizio ne espone più di una.
   */
  writeCharacteristic?: string;
  /** Da dove arrivano le risposte. Indefinito = si scopre. */
  notifyCharacteristic?: string;
  /**
   * Con o senza conferma.
   *
   * Non è un dettaglio: alcuni firmware perdono i pacchetti scritti «con
   * risposta» perché la conferma li rallenta oltre il loro timeout interno,
   * altri buttano via quelli senza. Sbagliare qui dà un dispositivo che si
   * connette e poi tace, che è il sintomo più difficile da leggere.
   *
   * `auto` significa «senza conferma se la caratteristica lo permette, con
   * conferma altrimenti», ed è la scelta giusta quando non si è mai visto il
   * dispositivo vero. È quello che fa Subsurface, e la ragione è che le due
   * modalità non sono intercambiabili a livello GATT: scrivere «senza
   * risposta» su una caratteristica che dichiara solo «write» fallisce, e
   * fallisce in un punto — la prima scrittura — in cui il sintomo è
   * indistinguibile da «il computer non risponde».
   */
  writeType: 'withResponse' | 'withoutResponse' | 'auto';
}

/** Perché il Bluetooth non è utilizzabile adesso. Ogni caso ha una risposta diversa. */
export type BleUnavailable =
  /** Siamo nel browser, o in una build senza il plugin. Non si risolve chiedendo. */
  | { reason: 'unsupported'; detail: string }
  /** L'adattatore è spento. Si risolve accendendolo. */
  | { reason: 'off'; detail: string }
  /** Il permesso è stato negato. Si risolve nelle impostazioni di sistema. */
  | { reason: 'denied'; detail: string };

/**
 * Una connessione aperta, vista come un flusso di byte.
 *
 * Deliberatamente NON espone le notifiche come callback. Un protocollo è fatto
 * di «scrivi questo, aspetta N byte, leggine altri M», ed è la forma in cui è
 * scritto anche `libdivecomputer`: tradurlo in callback significherebbe
 * riscrivere ogni driver come una macchina a stati, cioè introdurre bug che nel
 * protocollo non c'erano. Il riassemblaggio dei pacchetti sta in `ByteStream` e
 * si prova da solo.
 */
export interface BleLink {
  /** Byte per scrittura che il collegamento regge. Il driver spezza di conseguenza. */
  readonly mtu: number;
  /** Scrive, spezzando da sé se serve. Per i protocolli che vedono un flusso. */
  write(data: Uint8Array): Promise<void>;
  /**
   * Scrive ESATTAMENTE questa notifica, senza spezzare.
   *
   * Serve ai protocolli in cui il pacchetto BLE ha una sua intestazione — «di
   * quante notifiche è fatto questo messaggio, e questa che numero è» — perché
   * lì la divisione la decide il driver, che è l'unico a sapere dove mettere i
   * contatori. Se i byte non ci stanno nell'MTU è un errore del driver, non una
   * cosa da aggiustare in silenzio spezzando.
   */
  writeFrame(data: Uint8Array): Promise<void>;
  /**
   * Esattamente `n` byte, o un errore allo scadere del tempo.
   *
   * `signal` interrompe l'attesa SUBITO. Senza, l'annullamento si nota solo
   * quando la scadenza è passata — dodici o venti secondi durante uno scarico —
   * e per tutto quel tempo il pulsante «Annulla» non fa niente.
   */
  read(n: number, timeoutMs?: number, signal?: AbortSignal): Promise<Uint8Array>;
  /** La prossima notifica intera, con i suoi confini. */
  readFrame(timeoutMs?: number, signal?: AbortSignal): Promise<Uint8Array>;
  /** Tutto quello che è già arrivato, senza aspettare. Vuoto se non c'è niente. */
  drain(): Uint8Array;
  /**
   * Una riga su COME è stato aperto: servizio e caratteristiche risolte.
   *
   * Va nel diario tecnico. Quando un protocollo ricostruito non risponde, la
   * prima domanda è sempre «stiamo scrivendo sulla caratteristica giusta?», e
   * senza questa riga la risposta richiede un altro giro di prove col computer
   * in mano.
   */
  describe?(): string;
  close(): Promise<void>;
}

/** Il Bluetooth di questa piattaforma. Una sola implementazione vera, più quella finta. */
export interface BleTransport {
  /** Utilizzabile adesso? La risposta negativa dice PERCHÉ, perché ogni causa ha un rimedio diverso. */
  available(): Promise<true | BleUnavailable>;
  /**
   * Cerca dispositivi finché non si annulla.
   *
   * `onUpdate` riceve l'elenco COMPLETO a ogni novità, non le differenze: un
   * elenco che si aggiorna da sé è più semplice da disegnare e impossibile da
   * desincronizzare.
   */
  scan(onUpdate: (devices: BleFoundDevice[]) => void, signal: AbortSignal): Promise<void>;
  open(deviceId: string, profile: BleServiceProfile, signal: AbortSignal): Promise<BleLink>;
}

/** Una immersione scaricata, ancora nella forma in cui la scrive il computer. */
export interface DownloadedRecord {
  /**
   * Come la chiama il computer: numero di immersione, indirizzo in memoria.
   *
   * Serve a due cose concrete — non riscaricare quello che si ha già, e citare
   * nel messaggio d'errore l'immersione che non si è letta invece di «una».
   */
  key: string;
  bytes: Uint8Array;
}

/**
 * Fin dove si era arrivati l'ultima volta con QUESTO computer.
 *
 * È il modo in cui lo scarico diventa incrementale, ed è la sola cosa che
 * rende usabile un computer con centocinquanta immersioni in memoria: senza,
 * ogni collegamento rilegge tutto, e su BLE tutto sono parecchi minuti.
 *
 * L'impronta è quella dell'immersione PIÙ RECENTE che è stata scaricata per
 * intero, perché il manifesto si legge dalla più nuova alla più vecchia e
 * l'unico punto in cui ci si può fermare è quello. Non esiste un modo di
 * saltare un pezzo in mezzo: è una proprietà del protocollo, non una scelta.
 */
export const BLE_MARKERS_KEY = 'bleMarkers';

export interface DownloadMarker {
  /** Impronta dell'immersione più recente già in archivio da questo computer. */
  fingerprint: string;
  /** Quando è stato fatto quello scarico, ISO. Serve a poterlo mostrare. */
  at: string;
  /** Quante immersioni erano arrivate. Solo per il messaggio a schermo. */
  dives: number;
  model?: string;
}

/**
 * La chiave sotto cui si ricorda il segnalibro: il SERIALE del computer.
 *
 * Non l'identificativo del dispositivo, che su Apple è un UUID valido solo per
 * quel Mac e per quella app e cambia reinstallando. Il seriale è del computer
 * subacqueo, quindi il segnalibro sopravvive e vale anche fra dispositivi
 * diversi che si sincronizzano. Il ripiego serve solo se il computer non
 * dichiara un seriale, che sarebbe già di per sé un caso da guardare.
 */
export const markerKey = (driverId: string, serial: string | undefined, deviceId: string) =>
  `${driverId}:${serial ?? `dispositivo-${deviceId}`}`;

/** Chi è il computer con cui si sta parlando, appena si è saputo. */
export interface ComputerIdentity {
  serial?: string;
  model?: string;
}

/** Che cosa sta succedendo, mentre succede. */
export type DownloadEvent =
  | { kind: 'connecting' }
  /** Il computer si è presentato: modello, seriale, firmware. Da qui in poi si sa con chi si parla. */
  | { kind: 'identified'; model: string; serial?: string; firmware?: string }
  /** Quante immersioni ci sono in memoria. Manca su alcuni protocolli: senza, la barra non c'è. */
  | { kind: 'counted'; total?: number }
  | { kind: 'record'; done: number; total?: number; record: DownloadedRecord }
  /** Un'immersione illeggibile NON ferma le altre: si annota e si va avanti. */
  | { kind: 'skipped'; key: string; reason: string }
  /**
   * Avanzamento a BYTE, per i protocolli che non sanno ancora quante immersioni ci sono.
   *
   * Shearwater legge un manifesto e poi le immersioni una per una: il numero
   * di immersioni si sa prima di leggerle, e l'avanzamento è «quarantatré su
   * novantotto». Uwatec no — chiede al computer quanti byte ha da dare e li
   * riceve tutti in un blocco solo, e solo alla fine, tagliando quel blocco sui
   * marcatori `A5 A5 5A 5A`, scopre che erano ottantacinque immersioni.
   *
   * Senza questo evento l'interfaccia resterebbe ferma su «Leggo…» per i tre o
   * quattro minuti che il trasferimento richiede — e un'applicazione ferma che
   * non dice niente è indistinguibile da una bloccata. È la differenza fra
   * aspettare e riavviare.
   */
  | { kind: 'progress'; done: number; total?: number; label: string }
  /**
   * Una riga di diario tecnico.
   *
   * Non è per l'utente: è per chi dovrà capire perché il primo tentativo con un
   * computer vero non ha funzionato. Un protocollo ricostruito sbaglia sempre
   * in qualche punto, e il sintomo è quasi sempre lo stesso — «il computer non
   * risponde» — qualunque sia la causa. La differenza fra sistemarlo in dieci
   * minuti e sistemarlo in tre giri è avere scritto QUALE comando è partito e
   * COSA è tornato.
   */
  | { kind: 'trace'; line: string };

/**
 * Il protocollo di un computer.
 *
 * `matches` decide se questo driver riconosce un dispositivo trovato. È
 * volutamente separato da `download`: la ricerca deve poter etichettare le voci
 * dell'elenco («Peregrine») senza connettersi a niente, perché connettersi a un
 * dispositivo sconosciuto per chiedergli chi è vuol dire, in pratica, provare a
 * parlare con le cuffie di qualcun altro.
 */
export interface DiveComputerDriver {
  id: string;
  /** Come si chiama in italiano nell'interfaccia, es. «Shearwater (Peregrine, Perdix, Petrel)». */
  label: string;
  profile: BleServiceProfile;
  matches(device: BleFoundDevice): boolean;
  /**
   * Scarica. Genera eventi via `emit` e restituisce quello che ha letto.
   *
   * IL VALORE RESTITUITO È ORDINATO DALLA PIÙ RECENTE ALLA PIÙ VECCHIA, ed è un
   * obbligo, non una convenzione: il primo elemento diventa il SEGNALIBRO da
   * cui ripartirà il prossimo scarico. Gli eventi non bastano a stabilirlo,
   * perché escono nell'ordine in cui le immersioni arrivano — e un
   * trasferimento ripreso a metà le fa arrivare in un ordine che non è quello.
   *
   * `since` è la chiave dell'ultima immersione già in archivio per questo
   * computer: i protocolli che lo permettono si fermano lì invece di rileggere
   * tutta la memoria, che su un Peregrine pieno sono minuti di attesa e batteria.
   */
  download(
    link: BleLink,
    ctx: {
      emit: (e: DownloadEvent) => void;
      signal: AbortSignal;
      /**
       * Il segnalibro per QUESTO computer, chiesto quando lo si conosce.
       *
       * È una funzione e non un valore, e la ragione è concreta: il computer
       * si identifica col numero di SERIALE, che è l'unica cosa stabile —
       * l'identificativo che dà il sistema operativo vale solo per quel Mac e
       * per quella installazione, e cambia reinstallando. Ma il seriale si
       * legge solo DOPO essersi connessi, mentre il segnalibro serviva prima.
       *
       * Passandolo come valore, chi chiama doveva indovinare la chiave prima
       * di sapere con chi stava parlando: è il difetto che ha reso lo scarico
       * incrementale del tutto inefficace, salvando sotto il seriale e
       * rileggendo sotto l'identificativo. Due chiavi diverse per la stessa
       * cosa, nessuna corrispondenza, tutta la memoria riletta ogni volta —
       * senza un solo errore a schermo.
       *
       * Il driver la chiama subito dopo aver emesso `identified`, cioè nel
       * primo istante in cui la domanda ha una risposta.
       */
      since: (identity: ComputerIdentity) => string | undefined;
      /** Scrive una riga nel diario tecnico. Vedi `DownloadEvent.trace`. */
      trace: (line: string) => void;
      /**
       * Chiude il collegamento e ne apre uno nuovo allo stesso dispositivo.
       *
       * PERCHÉ UN DRIVER DEVE POTERLO CHIEDERE. Perché un computer subacqueo
       * può impiantarsi senza disconnettersi: smette di rispondere, il
       * collegamento resta formalmente aperto, e da lì non c'è comando che lo
       * risvegli. È quello che fa l'Aladin a un terzo del trasferimento. In quel
       * caso rimandare il comando sulla stessa sessione è inutile per
       * costruzione — l'unica cosa che rimette in moto il firmware è una
       * sessione GATT nuova.
       *
       * Restituisce il collegamento NUOVO: quello vecchio da qui in poi è
       * chiuso, e continuare a usarlo darebbe errori che sembrano un guasto del
       * dispositivo. Il chiamante tiene traccia di quale sia quello vivo, così
       * la chiusura finale non ne lascia mai uno aperto — un collegamento
       * dimenticato tiene il computer sveglio finché ha batteria.
       *
       * Va usato con parsimonia: riaprire costa qualche secondo e, su alcuni
       * stack, una nuova richiesta di permesso all'utente.
       */
      riapri: () => Promise<BleLink>;
    },
  ): Promise<DownloadedRecord[]>;
  /**
   * Da byte del computer a immersioni.
   *
   * Separata dallo scarico apposta: la decodifica è pura, gira su un file
   * salvato e si prova senza Bluetooth. È anche il punto in cui si riusano i
   * decoder che esistono già — `shearwaterPnf.ts` legge esattamente il blob che
   * il Peregrine manda, perché è la copia della sua memoria.
   */
  decode(records: DownloadedRecord[]): { dives: import('../model').Dive[]; warnings: string[] };
}
