/**
 * Persistenza su IndexedDB: usata sul web e come ripiego nel browser.
 *
 * Scritta a mano invece che con una libreria perché serve poco: tre object
 * store e nessuna query complessa (l'analisi avviene in memoria sui
 * riepiloghi). Una dipendenza in meno da mantenere su tre piattaforme.
 */

import type { Dive, Sample } from '../core/model';
import { comeSta, type Traduci } from '../core/traduci';
import { ALT_SUFFIX, altKey, isAltKey, stripSamples, type DiveStore, type DiveSummary } from './types';

const DB_NAME = 'mydivelog';
/**
 * 2: aggiunto `count` ai profili, con indice, per poter contare i campioni senza
 * leggerli (serve alla sincronizzazione — vedi `sampleCounts`).
 */
const DB_VERSION = 2;
const DIVES = 'dives';
const SAMPLES = 'samples';
const SETTINGS = 'settings';

export class IndexedDbStore implements DiveStore {
  readonly kind = 'indexeddb' as const;
  /**
   * DOVE VIVE L'ARCHIVIO, detto all'utente nelle impostazioni.
   *
   * ► QUI C'ERA IL NOME DEL MOTORE, E LO LEGGEVA CHIUNQUE. ◄ Diceva «File
   * SQLite nella cartella dati dell'app» sul Mac e «Archivio del browser
   * (IndexedDB)» sul web — le due frasi comparivano in cima alla schermata
   * Importa, cioè **la prima riga della prima schermata di chi installa
   * l'applicazione**. Si vedono nella fotografia che il primo utente esterno ha
   * mandato il 28 agosto 2026: sopra l'errore del Bluetooth, che allora sembrava
   * l'unico difetto di quello schermo, c'era già questa.
   *
   * A chi si immerge, «SQLite» e «IndexedDB» non dicono niente. La domanda a cui
   * questa riga deve rispondere è un'altra, ed è la sola che una persona si fa:
   * **dove sono i miei dati, e chi li vede.**
   *
   * La distinzione fra i due motori resta perché è VERA e ha una conseguenza
   * pratica: quello che sta nella memoria di un browser sparisce se si cancellano
   * i dati del sito, quello che sta in un file no. Cambia il modo di dirlo, non
   * il fatto.
   *
   * Resta la frase italiana e non passa da `t()` qui: è una stringa costante,
   * letta da chi la mostra, e la traduzione si fa a schermo — `t(storeLocation)`
   * in `ImportPage` e `SyncPage`. Tradurla alla costruzione la congelerebbe
   * nella lingua di quel momento, perché l'archivio si apre una volta sola
   * all'avvio mentre la lingua si può cambiare dopo.
   */
  readonly location = 'nella memoria di questo browser';
  private db: IDBDatabase | null = null;

  /**
   * La traduzione degli errori che possono arrivare a schermo.
   *
   * È una guardia che in pratica non scatta — `getStore()` aspetta sempre
   * `init()` — ma se scattasse il messaggio finirebbe nel banner rosso come
   * qualunque altro, e allora segue la stessa regola di tutti: chi non passa
   * niente ottiene l'italiano.
   */
  constructor(private readonly t: Traduci = comeSta) {}

  async init(): Promise<void> {
    if (this.db) return;
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DIVES)) {
          const store = db.createObjectStore(DIVES, { keyPath: 'id' });
          store.createIndex('startTime', 'startTime');
        }
        const samples = db.objectStoreNames.contains(SAMPLES)
          ? req.transaction!.objectStore(SAMPLES)
          : db.createObjectStore(SAMPLES, { keyPath: 'diveId' });
        if (!samples.indexNames.contains('count')) {
          samples.createIndex('count', 'count');
          // I record scritti dalla versione 1 non hanno `count` e resterebbero
          // fuori dall'indice: li riscriviamo qui, una volta sola.
          const cursorReq = samples.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            const row = cursor.value as { diveId: string; count?: number; samples: Sample[] };
            if (typeof row.count !== 'number') {
              cursor.update({ ...row, count: row.samples?.length ?? 0 });
            }
            cursor.continue();
          };
        }
        if (!db.objectStoreNames.contains(SETTINGS)) {
          db.createObjectStore(SETTINGS, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /*
   * ► «Store non inizializzato.» ERA UN'ASSERZIONE DA PROGRAMMATORE. ◄
   *
   * In teoria non scatta mai — `getStore()` aspetta sempre `init()` — ma una
   * guardia che non scatta mai non esisterebbe: quando scatta, il testo esce
   * dal `catch` di chi ha chiamato e finisce in un riquadro rosso. «Store» non
   * è una parola italiana e non è una cosa che chi legge possa avere in mente;
   * «non inizializzato» descrive lo stato di un oggetto in memoria, non quello
   * dei dati di una persona.
   *
   * La frase nuova dice le due cose che servono: che si può fare (riavviare) e
   * che cosa è successo a quello che si stava salvando (niente, non è stato
   * scritto). È la STESSA di `SqliteStore`, di proposito: chi la legge non sa
   * quale dei due motori sta usando, e non deve importargli.
   */
  private tx(stores: string[], mode: IDBTransactionMode) {
    if (!this.db)
      throw new Error(
        this.t(
          'L’archivio non è pronto. Chiudi e riapri l’applicazione: quello che stavi salvando non è stato scritto.',
        ),
      );
    return this.db.transaction(stores, mode);
  }

  async listDives(): Promise<Dive[]> {
    const all = await request<DiveSummary[]>(this.tx([DIVES], 'readonly').objectStore(DIVES).getAll());
    return (all ?? []).sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime)) as Dive[];
  }

  async getDive(id: string): Promise<Dive | undefined> {
    const summary = await request<DiveSummary | undefined>(
      this.tx([DIVES], 'readonly').objectStore(DIVES).get(id),
    );
    if (!summary) return undefined;
    const samples = await this.getSamples(id);
    const alt = await this.getAltSamples(id);
    return { ...(summary as Dive), samples, ...(alt.length ? { altSamples: alt } : {}) };
  }

  async getSamples(id: string): Promise<Sample[]> {
    const row = await request<{ diveId: string; samples: Sample[] } | undefined>(
      this.tx([SAMPLES], 'readonly').objectStore(SAMPLES).get(id),
    );
    return row?.samples ?? [];
  }

  async getAltSamples(id: string): Promise<Sample[]> {
    return this.getSamples(altKey(id));
  }

  /**
   * Conteggi dei campioni letti dal solo indice: un cursore sulle chiavi
   * dell'indice `count` restituisce il valore indicizzato (`cursor.key`) e la
   * chiave primaria (`cursor.primaryKey`) senza mai deserializzare l'array dei
   * campioni. Con `getAll` sull'object store si leggerebbe l'intero archivio dei
   * profili per contare.
   */
  async sampleCounts(): Promise<Map<string, number>> {
    const index = this.tx([SAMPLES], 'readonly').objectStore(SAMPLES).index('count');
    return new Promise((resolve, reject) => {
      const out = new Map<string, number>();
      const req = index.openKeyCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(out);
        // Le righe del secondo profilo non sono immersioni: fuori dal conteggio.
        if (!isAltKey(String(cursor.primaryKey))) {
          out.set(String(cursor.primaryKey), Number(cursor.key));
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async altSampleCounts(): Promise<Map<string, number>> {
    const index = this.tx([SAMPLES], 'readonly').objectStore(SAMPLES).index('count');
    return new Promise((resolve, reject) => {
      const out = new Map<string, number>();
      const req = index.openKeyCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(out);
        const key = String(cursor.primaryKey);
        if (isAltKey(key)) out.set(key.slice(0, -ALT_SUFFIX.length), Number(cursor.key));
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async putDives(dives: Dive[]): Promise<void> {
    const tx = this.tx([DIVES, SAMPLES], 'readwrite');
    const diveStore = tx.objectStore(DIVES);
    const sampleStore = tx.objectStore(SAMPLES);
    for (const dive of dives) {
      diveStore.put(stripSamples(dive));
      for (const [key, samples] of [
        [dive.id, dive.samples],
        [altKey(dive.id), dive.altSamples],
      ] as const) {
        if (!samples || !samples.length) continue;
        sampleStore.put({ diveId: key, count: samples.length, samples });
      }
    }
    await done(tx);
  }

  async deleteDive(id: string): Promise<void> {
    const tx = this.tx([DIVES, SAMPLES], 'readwrite');
    tx.objectStore(DIVES).delete(id);
    tx.objectStore(SAMPLES).delete(id);
    tx.objectStore(SAMPLES).delete(altKey(id));
    await done(tx);
  }

  async clear(): Promise<void> {
    const tx = this.tx([DIVES, SAMPLES, SETTINGS], 'readwrite');
    tx.objectStore(DIVES).clear();
    tx.objectStore(SAMPLES).clear();
    tx.objectStore(SETTINGS).clear();
    await done(tx);
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const row = await request<{ key: string; value: T } | undefined>(
      this.tx([SETTINGS], 'readonly').objectStore(SETTINGS).get(key),
    );
    return row?.value;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    const tx = this.tx([SETTINGS], 'readwrite');
    tx.objectStore(SETTINGS).put({ key, value });
    await done(tx);
  }
}

function request<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
