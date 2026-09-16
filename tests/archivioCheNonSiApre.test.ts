// @vitest-environment jsdom
/**
 * «NON C'È UN ARCHIVIO NATIVO» E «C'È E NON VA APERTO» SONO DUE COSE DIVERSE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * `getStore()` ripiega su IndexedDB quando SQLite non parte, e fa bene: meglio
 * un'applicazione che funziona che una che non si apre. Ma ripiegava su
 * **qualunque** errore — compreso il rifiuto esplicito di aprire un archivio
 * scritto da una versione più recente, che è il controllo messo lì apposta per
 * non rovinarlo.
 *
 * La conseguenza non era un'app che non parte: era **un'app che parte
 * sull'archivio sbagliato**. Logbook vuoto accanto a un archivio pieno,
 * immersioni nuove in un secondo deposito, e il giorno che SQLite torna
 * disponibile quelle sembrano sparite.
 *
 * *Il difetto non è il ripiego: è il cambio silenzioso della fonte dei dati.*
 *
 * Trovato da una verifica esterna il 16 settembre 2026.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const stato = { errore: null as Error | null };

vi.mock('../src/storage/sqlite', async () => {
  const vero = await vi.importActual<typeof import('../src/storage/sqlite')>('../src/storage/sqlite');
  return {
    ...vero,
    SqliteStore: class {
      kind = 'sqlite';
      async init() {
        if (stato.errore) throw stato.errore;
      }
      async listDives() {
        return [];
      }
    },
  };
});
vi.mock('../src/storage/indexeddb', () => ({
  IndexedDbStore: class {
    kind = 'indexeddb';
    async init() {}
    async listDives() {
      return [];
    }
  },
}));

beforeEach(() => {
  stato.errore = null;
  Object.assign(window, { __TAURI_INTERNALS__: {} });
});

describe('quando l’archivio nativo non si apre', () => {
  it('un archivio scritto da una versione più recente FERMA l’avvio', async () => {
    /*
     * ► IL CUORE. ◄ È il caso che il controllo sullo schema esiste per prendere:
     * il telefono si aggiorna prima del Mac, sincronizza, e il Mac si trova un
     * archivio che non sa leggere. Prima partiva su IndexedDB e non lo diceva.
     */
    const { ArchivioDaNonAprire } = await import('../src/storage/sqlite');
    stato.errore = new ArchivioDaNonAprire('archivio più recente');
    const { getStore, __resetStore } = await import('../src/storage');
    __resetStore();
    await expect(getStore()).rejects.toThrow('archivio più recente');
  });

  it('ma un guasto qualunque continua a ripiegare: meglio aperta che chiusa', async () => {
    // La metà che impedisce di «correggere» facendo fallire sempre l'avvio.
    // Il plugin che non c'è, la libreria che non si carica: lì il ripiego è
    // giusto, ed è il motivo per cui esiste.
    stato.errore = new Error('plugin sql non disponibile');
    const { getStore, __resetStore } = await import('../src/storage');
    __resetStore();
    const store = await getStore();
    expect(store.kind).toBe('indexeddb');
  });

  it('e senza Tauri si va su IndexedDB senza nemmeno provarci', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    stato.errore = new Error('non dovrebbe nemmeno essere chiamato');
    const { getStore, __resetStore } = await import('../src/storage');
    __resetStore();
    expect((await getStore()).kind).toBe('indexeddb');
  });
});
