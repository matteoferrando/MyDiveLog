import type { Dive, Sample } from '../core/model';

/**
 * Interfaccia unica di persistenza.
 *
 * Il punto architetturale: i profili (`samples`) sono SEPARATI dal riepilogo.
 * Un archivio di 2000 immersioni con campionamento a 10 s sono ~700.000
 * campioni: caricarli per disegnare la lista del logbook renderebbe l'app
 * inutilizzabile su iPhone. La lista carica solo i riepiloghi (che contengono
 * già le metriche precalcolate); il profilo si carica quando si apre la scheda.
 *
 * Due implementazioni, stessa interfaccia:
 *  - `sqlite.ts` su desktop e iOS (Tauri, dati in un file .db)
 *  - `indexeddb.ts` sul web e come ripiego nel browser durante lo sviluppo
 */
export interface DiveStore {
  readonly kind: 'sqlite' | 'indexeddb';
  /** Descrizione leggibile di dove stanno i dati, mostrata nelle impostazioni. */
  readonly location: string;

  init(): Promise<void>;

  /** Riepiloghi ordinati dal più recente. Senza `samples`. */
  listDives(): Promise<Dive[]>;
  getDive(id: string): Promise<Dive | undefined>;
  getSamples(id: string): Promise<Sample[]>;
  /**
   * Il secondo profilo, quando due computer hanno registrato la stessa immersione
   * e il perdente è più fitto del vincente. Vedi `Dive.altSamples`: serve a
   * misurare assetto e velocità su una base confrontabile.
   */
  getAltSamples(id: string): Promise<Sample[]>;

  /**
   * Quanti campioni ha il profilo di ciascuna immersione, senza leggerne
   * nemmeno uno. Solo le immersioni che hanno un profilo compaiono nella mappa.
   *
   * Esiste per la sincronizzazione, che deve decidere quali profili spostare: il
   * conteggio è il criterio con cui si sceglie la versione da tenere, e
   * ricavarlo caricando i profili significherebbe leggere l'intero archivio —
   * centinaia di migliaia di campioni — per poi scoprire che non c'è niente da
   * fare. Entrambe le implementazioni lo ottengono dal solo indice.
   */
  sampleCounts(): Promise<Map<string, number>>;
  /**
   * Come `sampleCounts` ma per i secondi profili. Serve alla riparazione per
   * accorgersi che le metriche di un'immersione sono state calcolate su un profilo
   * più rado di quello disponibile.
   */
  altSampleCounts(): Promise<Map<string, number>>;

  /** Inserisce o aggiorna. I `samples` vengono scritti solo se presenti. */
  putDives(dives: Dive[]): Promise<void>;
  deleteDive(id: string): Promise<void>;
  clear(): Promise<void>;

  getSetting<T>(key: string): Promise<T | undefined>;
  setSetting<T>(key: string, value: T): Promise<void>;
}

/** Riepilogo senza profili, quello che viaggia nella lista. */
export type DiveSummary = Omit<Dive, 'samples' | 'altSamples'>;

export function stripSamples(dive: Dive): DiveSummary {
  const { samples: _samples, altSamples: _alt, ...rest } = dive;
  return rest;
}

/**
 * Chiave del secondo profilo nella tabella dei profili.
 *
 * Un suffisso sulla stessa tabella invece di una tabella nuova: lo schema resta
 * quello — una riga per profilo — e funziona identico su SQLite e IndexedDB senza
 * migrazioni. Il carattere `#` non compare negli id delle immersioni, che sono
 * esadecimali.
 */
export const ALT_SUFFIX = '#alt';
export const altKey = (id: string) => `${id}${ALT_SUFFIX}`;
export const isAltKey = (key: string) => key.endsWith(ALT_SUFFIX);
