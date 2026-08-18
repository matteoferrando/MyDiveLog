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
  /** Dove si scrive. */
  writeCharacteristic: string;
  /** Da dove arrivano le risposte. */
  notifyCharacteristic: string;
  /**
   * Con o senza conferma.
   *
   * Non è un dettaglio: alcuni firmware perdono i pacchetti scritti «con
   * risposta» perché la conferma li rallenta oltre il loro timeout interno,
   * altri buttano via quelli senza. Sbagliare qui dà un dispositivo che si
   * connette e poi tace, che è il sintomo più difficile da leggere.
   */
  writeType: 'withResponse' | 'withoutResponse';
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
  write(data: Uint8Array): Promise<void>;
  /** Esattamente `n` byte, o un errore allo scadere del tempo. */
  read(n: number, timeoutMs?: number): Promise<Uint8Array>;
  /** Tutto quello che è già arrivato, senza aspettare. Vuoto se non c'è niente. */
  drain(): Uint8Array;
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

/** Che cosa sta succedendo, mentre succede. */
export type DownloadEvent =
  | { kind: 'connecting' }
  /** Il computer si è presentato: modello, seriale, firmware. Da qui in poi si sa con chi si parla. */
  | { kind: 'identified'; model: string; serial?: string; firmware?: string }
  /** Quante immersioni ci sono in memoria. Manca su alcuni protocolli: senza, la barra non c'è. */
  | { kind: 'counted'; total?: number }
  | { kind: 'record'; done: number; total?: number; record: DownloadedRecord }
  /** Un'immersione illeggibile NON ferma le altre: si annota e si va avanti. */
  | { kind: 'skipped'; key: string; reason: string };

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
   * `since` è la chiave dell'ultima immersione già in archivio per questo
   * computer: i protocolli che lo permettono si fermano lì invece di rileggere
   * tutta la memoria, che su un Peregrine pieno sono minuti di attesa e batteria.
   */
  download(
    link: BleLink,
    ctx: { emit: (e: DownloadEvent) => void; signal: AbortSignal; since?: string },
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
