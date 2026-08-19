/**
 * Da notifiche BLE a flusso di byte.
 *
 * IL PROBLEMA, che è tutto qui. Il BLE non trasporta messaggi: trasporta
 * notifiche da venti byte scarsi (l'MTU predefinito è 23, meno tre di
 * intestazione). Un protocollo che chiede «l'intestazione dell'immersione, 152
 * byte» riceve otto notifiche, e i confini fra le notifiche NON hanno niente a
 * che vedere con i confini dei campi. Peggio: due risposte consecutive possono
 * arrivare nella stessa notifica, oppure una risposta può arrivare divisa a metà
 * di un numero a 32 bit.
 *
 * Quindi ogni driver, se parlasse direttamente con le notifiche, dovrebbe
 * accumulare, contare, e ricordarsi dove era rimasto. È esattamente il codice
 * che si scrive male, e siccome è nascosto dentro un protocollo, quando è
 * sbagliato il sintomo è «il computer non risponde» — che assomiglia a un
 * problema di Bluetooth, di batteria, di distanza, di qualunque cosa tranne che
 * a un errore di conteggio.
 *
 * Sta qui una volta sola, e si prova senza Bluetooth.
 *
 * LA SCADENZA È PER LETTURA, NON PER SCARICO. Un computer subacqueo che non
 * risponde entro qualche secondo non risponderà più: si è disconnesso, è andato
 * in sospensione, oppure ha ricevuto un comando che non ha capito. Aspettare
 * «finché non finisce» significa un'interfaccia bloccata per sempre, ed è il
 * modo in cui questi scarichi falliscono nella pratica.
 */

/** Quanto si aspetta un pezzo di risposta, se il driver non dice altro. */
export const DEFAULT_READ_TIMEOUT_MS = 4000;

export class BleTimeoutError extends Error {
  constructor(
    readonly wanted: number,
    readonly got: number,
    readonly timeoutMs: number,
  ) {
    super(
      `Il computer non ha risposto: attesi ${wanted} byte, ne sono arrivati ${got} in ${timeoutMs} ms. ` +
        'Di solito significa che si è disconnesso o che non ha capito il comando.',
    );
    this.name = 'BleTimeoutError';
  }
}

export class BleClosedError extends Error {
  constructor(detail: string) {
    super(`Collegamento chiuso: ${detail}`);
    this.name = 'BleClosedError';
  }
}

/**
 * Coda di byte con letture che aspettano.
 *
 * Un solo lettore alla volta, ed è un vincolo voluto: due `read` in volo sullo
 * stesso flusso significano un protocollo scritto male, e farle convivere
 * nasconderebbe l'errore invece di segnalarlo.
 */
export class ByteStream {
  /*
   * I frammenti servono ANCHE interi, non solo come byte.
   *
   * Il BLE consegna notifiche, e alcuni protocolli mettono un'intestazione in
   * ogni notifica invece che nel messaggio: Shearwater ci scrive «quante
   * notifiche compongono questo pacchetto» e «questa che numero è», due byte
   * che vanno tolti PRIMA di concatenare. Se il flusso conoscesse solo i byte,
   * quei due finirebbero in mezzo ai dati e non ci sarebbe modo di ritrovarli.
   *
   * Quindi la coda resta una sola — un unico posto dove i dati arrivano — e si
   * legge in due modi: a byte per i protocolli che vedono un flusso, a
   * notifiche per quelli che vedono pacchetti. Usarli tutti e due sullo stesso
   * collegamento sarebbe un errore del driver, e la guardia sulle letture
   * concorrenti lo intercetta.
   *
   * I PEZZI NON SI CONCATENANO SUBITO.
   *
   * Un elenco di frammenti e non un unico array che cresce: concatenare a ogni
   * notifica è quadratico, e su un archivio da cento immersioni sono decine di
   * migliaia di notifiche. Si concatena solo quando si legge, e solo quello che
   * serve.
   */
  private chunks: Uint8Array[] = [];
  private size = 0;
  private waiter: {
    n: number;
    resolve: (v: Uint8Array) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private frameWaiter: {
    resolve: (v: Uint8Array) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private closedReason: string | null = null;

  /** Byte già arrivati e non ancora letti. */
  get available(): number {
    return this.size;
  }

  get closed(): boolean {
    return this.closedReason !== null;
  }

  /** Una notifica dal dispositivo. */
  push(data: Uint8Array): void {
    if (this.closedReason !== null || data.length === 0) return;
    this.chunks.push(data);
    this.size += data.length;
    this.serve();
  }

  /**
   * La prossima notifica, INTERA e con i suoi confini.
   *
   * Non «i prossimi n byte»: esattamente il pacchetto che il dispositivo ha
   * mandato. Serve ai protocolli in cui l'intestazione sta nella notifica e non
   * nel messaggio, dove perdere il confine significa perdere il modo di
   * togliere l'intestazione.
   */
  readFrame(timeoutMs: number = DEFAULT_READ_TIMEOUT_MS): Promise<Uint8Array> {
    if (this.waiter || this.frameWaiter) {
      return Promise.reject(
        new Error('Due letture insieme sullo stesso flusso: è un errore del driver, non del dispositivo.'),
      );
    }
    const pronto = this.chunks.shift();
    if (pronto) {
      this.size -= pronto.length;
      return Promise.resolve(pronto);
    }
    if (this.closedReason !== null) return Promise.reject(new BleClosedError(this.closedReason));

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.frameWaiter = null;
        reject(new BleTimeoutError(1, 0, timeoutMs));
      }, timeoutMs);
      this.frameWaiter = { resolve, reject, timer };
    });
  }

  /**
   * Esattamente `n` byte.
   *
   * Non «fino a `n`»: un protocollo binario sa sempre quanti byte vuole, e una
   * lettura parziale che sembra riuscita è il modo in cui un campo si
   * disallinea e da lì in poi tutto quello che si legge è spazzatura
   * plausibile. Meglio un errore.
   */
  read(n: number, timeoutMs: number = DEFAULT_READ_TIMEOUT_MS): Promise<Uint8Array> {
    if (n <= 0) return Promise.resolve(new Uint8Array(0));
    if (this.waiter) {
      return Promise.reject(
        new Error('Due letture insieme sullo stesso flusso: è un errore del driver, non del dispositivo.'),
      );
    }
    if (this.size >= n) return Promise.resolve(this.take(n));
    if (this.closedReason !== null) return Promise.reject(new BleClosedError(this.closedReason));

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        const got = this.size;
        this.waiter = null;
        reject(new BleTimeoutError(n, got, timeoutMs));
      }, timeoutMs);
      this.waiter = { n, resolve, reject, timer };
    });
  }

  /** Quello che c'è adesso, senza aspettare. Serve a svuotare fra un comando e l'altro. */
  drain(): Uint8Array {
    return this.take(this.size);
  }

  /**
   * Butta via quello che è rimasto.
   *
   * Si chiama PRIMA di ogni comando, e non è pignoleria: se una risposta
   * precedente è arrivata dopo la sua scadenza, i suoi byte sono ancora in
   * coda, e la risposta al comando nuovo verrebbe letta a partire da quelli.
   * Il risultato è un valore sbagliato che sembra giusto.
   */
  reset(): void {
    this.chunks = [];
    this.size = 0;
  }

  /** Quante notifiche sono in coda, non ancora lette. */
  get pendingFrames(): number {
    return this.chunks.length;
  }

  /** Il dispositivo se n'è andato: chi aspetta deve saperlo subito. */
  close(reason: string): void {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    const w = this.waiter;
    if (w) {
      clearTimeout(w.timer);
      this.waiter = null;
      w.reject(new BleClosedError(reason));
    }
    const f = this.frameWaiter;
    if (f) {
      clearTimeout(f.timer);
      this.frameWaiter = null;
      f.reject(new BleClosedError(reason));
    }
  }

  private serve(): void {
    const f = this.frameWaiter;
    if (f) {
      const pronto = this.chunks.shift();
      if (!pronto) return;
      this.size -= pronto.length;
      clearTimeout(f.timer);
      this.frameWaiter = null;
      f.resolve(pronto);
      return;
    }
    const w = this.waiter;
    if (!w || this.size < w.n) return;
    clearTimeout(w.timer);
    this.waiter = null;
    w.resolve(this.take(w.n));
  }

  private take(n: number): Uint8Array {
    const out = new Uint8Array(Math.min(n, this.size));
    let off = 0;
    while (off < out.length) {
      const head = this.chunks[0];
      const need = out.length - off;
      if (head.length <= need) {
        out.set(head, off);
        off += head.length;
        this.chunks.shift();
      } else {
        out.set(head.subarray(0, need), off);
        this.chunks[0] = head.subarray(need);
        off += need;
      }
    }
    this.size -= out.length;
    return out;
  }
}

/**
 * Spezza una scrittura in pacchetti che ci stanno nell'MTU.
 *
 * Sta qui e non in ogni driver perché è la stessa operazione per tutti, e
 * perché l'MTU vero si conosce solo dopo la connessione: un driver che si
 * portasse dentro il numero 20 funzionerebbe finché il sistema non negozia un
 * MTU più grande, e poi manderebbe pacchetti corti a un firmware che li conta.
 */
export function chunkForMtu(data: Uint8Array, mtu: number): Uint8Array[] {
  const max = Math.max(1, mtu);
  if (data.length <= max) return [data];
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += max) out.push(data.subarray(i, Math.min(i + max, data.length)));
  return out;
}
