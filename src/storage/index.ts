/**
 * Scelta dell'implementazione di persistenza in base all'ambiente.
 *
 * `__TAURI_INTERNALS__` esiste solo dentro una webview Tauri, quindi lo stesso
 * bundle funziona come app desktop (SQLite), come app iOS (SQLite) e come web
 * app nel browser (IndexedDB) senza compilazioni condizionali.
 */

import { comeSta, type Traduci } from '../core/traduci';
import { IndexedDbStore } from './indexeddb';
import { SqliteStore } from './sqlite';
import type { DiveStore } from './types';

export type { DiveStore, DiveSummary } from './types';
export { stripSamples } from './types';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let instance: DiveStore | null = null;

/**
 * L'archivio, uno solo per tutta la vita dell'applicazione.
 *
 * `t` in coda e opzionale: chi chiama senza — i test, e sono parecchi — ottiene
 * gli errori in italiano. Attenzione a COSA si passa: l'istanza è memorizzata,
 * quindi una `t` che cattura la lingua di adesso resterebbe quella per sempre.
 * `state.tsx` passa apposta una funzione stabile che rilegge la lingua corrente
 * a ogni chiamata — vedi `useTraduciStabile`.
 */
export async function getStore(t: Traduci = comeSta): Promise<DiveStore> {
  if (instance) return instance;

  if (isTauri()) {
    const store = new SqliteStore(t);
    try {
      await store.init();
      instance = store;
      return store;
    } catch (err) {
      // Meglio un'app che funziona con IndexedDB che un'app che non parte.
      console.warn('SQLite non disponibile, ripiego su IndexedDB:', err);
    }
  }

  const fallback = new IndexedDbStore(t);
  await fallback.init();
  instance = fallback;
  return fallback;
}

/** Solo per i test. */
export function __resetStore() {
  instance = null;
}
