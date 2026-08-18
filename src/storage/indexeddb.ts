/**
 * Persistenza su IndexedDB: usata sul web e come ripiego nel browser.
 *
 * Scritta a mano invece che con una libreria perché serve poco: tre object
 * store e nessuna query complessa (l'analisi avviene in memoria sui
 * riepiloghi). Una dipendenza in meno da mantenere su tre piattaforme.
 */

import type { Dive, Sample } from '../core/model';
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
  readonly location = 'Archivio del browser (IndexedDB)';
  private db: IDBDatabase | null = null;

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

  private tx(stores: string[], mode: IDBTransactionMode) {
    if (!this.db) throw new Error('Store non inizializzato.');
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
