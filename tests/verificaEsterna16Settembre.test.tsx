// @vitest-environment jsdom
/**
 * QUATTRO DIFETTI TROVATI DA UNA VERIFICA ESTERNA, IL 16 SETTEMBRE 2026.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Una revisione indipendente ha letto il progetto alla 1.8.24 e ha riprodotto
 * nove problemi. Questi sono i quattro che si chiudono qui dentro; hanno in
 * comune la forma che questo progetto conosce bene — **un errore ingoiato, e
 * un'operazione che va avanti lo stesso.**
 *
 *  1. Il **cestino** leggeva i profili con un `.catch(() => [])` per parte. Un
 *     errore di lettura transitorio diventava «questa immersione non ha
 *     profilo», il cestino riceveva la scheda nuda e la cancellazione andava
 *     avanti: *«ripristina» restituiva un'immersione senza profilo, e il
 *     profilo non c'era più da nessuna parte.*
 *
 *  2. Il **ripristino** riscriveva il disco e riallineava in memoria tre
 *     impostazioni su otto. `subacqueo` non era in nessuno dei due elenchi —
 *     né in quello del ripristino né in quello della sincronizzazione — quindi
 *     il libretto usciva col nome di prima fino al riavvio.
 *
 *  3. `getStore()` **ripiegava su IndexedDB su qualunque errore**, compreso il
 *     rifiuto esplicito di aprire un archivio scritto da una versione più
 *     recente. L'applicazione partiva vuota accanto a un archivio pieno, e le
 *     immersioni nuove finivano in un secondo deposito.
 *
 *  4. Il **servizio di accesso** non ammetteva `http://tauri.localhost`, che è
 *     l'origine delle build native di **Windows e Android**: 403 al preflight,
 *     cioè accesso e rinnovo della chiave impossibili su due piattaforme su
 *     quattro. Un difetto che si vede solo dove in questa casa non c'è un
 *     apparecchio.
 */

import { it, expect, vi, describe } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { DiveStore } from '../src/storage';
import type { BackupFile } from '../src/core/export/backup';
import type { Dive, Sample } from '../src/core/model';

const h = vi.hoisted(() => ({ store: null as unknown as DiveStore }));
vi.mock('../src/storage', async () => ({
  ...(await vi.importActual('../src/storage')),
  getStore: async () => h.store,
}));
vi.mock('../src/storage/secrets', () => ({
  openSecretStore: async () => ({ place: 'archive', read: async () => undefined, remove: async () => {} }),
  dimenticaChiaveAi: async () => {},
}));

import { DiveLogProvider, useDiveLog } from '../src/ui/state';

/** Un archivio finto che risponde a tutto, e che si può far inciampare. */
function archivio(over: Partial<DiveStore> = {}, impostazioni = new Map<string, unknown>()): DiveStore {
  return {
    kind: 'indexeddb',
    location: 'prova',
    init: async () => {},
    listDives: async () => [],
    getDive: async () => undefined,
    getSamples: async () => [],
    getAltSamples: async () => [],
    sampleCounts: async () => new Map(),
    altSampleCounts: async () => new Map(),
    putDives: async () => {},
    deleteDive: async () => {},
    clear: async () => {},
    getSetting: async <T,>(k: string) => impostazioni.get(k) as T,
    setSetting: async (k: string, v: unknown) => {
      impostazioni.set(k, v);
    },
    ...over,
  } as DiveStore;
}

/**
 * Monta il provider vero e restituisce la sua interfaccia.
 *
 * `api` è un GETTER e non un valore: `useDiveLog()` restituisce un oggetto
 * nuovo a ogni render, e restituire quello del primo montaggio vorrebbe dire
 * guardare per sempre lo stato di partenza — cioè una prova che non può mai
 * vedere un aggiornamento, che è esattamente quello che deve misurare.
 */
async function conIlProvider(): Promise<{
  readonly api: ReturnType<typeof useDiveLog>;
  smonta: () => Promise<void>;
}> {
  let corrente!: ReturnType<typeof useDiveLog>;
  function Sonda() {
    corrente = useDiveLog();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () =>
    root.render(
      <DiveLogProvider>
        <Sonda />
      </DiveLogProvider>,
    ),
  );
  return {
    get api() {
      return corrente;
    },
    smonta: async () => void (await act(async () => root.unmount())),
  };
}

const IMMERSIONE = {
  id: 'x',
  startTime: '2026-01-01T10:00:00Z',
  durationS: 600,
  maxDepth: 20,
  mode: 'oc',
  cylinders: [],
  tags: [],
  source: { format: 'manual', file: '', importedAt: '2026-01-01T10:00:00Z' },
} as unknown as Dive;

describe('il cestino non cancella quello che non è riuscito a copiare', () => {
  it('con la lettura del profilo che fallisce, l’immersione resta dov’è', async () => {
    let cancellata = false;
    let inciampa = false;
    const impostazioni = new Map<string, unknown>();
    h.store = archivio(
      {
        listDives: async () => [IMMERSIONE],
        getDive: async () => IMMERSIONE,
        getSamples: async () => {
          if (inciampa) throw new Error('errore di lettura temporaneo');
          return [
            { t: 0, depth: 0 },
            { t: 600, depth: 0 },
          ] as Sample[];
        },
        deleteDive: async () => {
          cancellata = true;
        },
      },
      impostazioni,
    );
    const p = await conIlProvider();
    inciampa = true;

    /*
     * ► SI GUARDA QUELLO CHE È SUCCESSO ALL'ARCHIVIO, non solo se la promessa
     *   ha rifiutato. ◄
     *
     * Un `rejects.toThrow` da solo direbbe che la funzione si è lamentata, non
     * che l'immersione è ancora al suo posto — e sono due cose diverse: la
     * versione col difetto cancellava **e poi** poteva lamentarsi lo stesso.
     * I due fatti che contano sono che `deleteDive` non sia stato chiamato e
     * che nel cestino non sia finita una scheda senza il suo profilo.
     */
    let errore: unknown = null;
    await act(async () => {
      try {
        await p.api.removeDive('x');
      } catch (e) {
        errore = e;
      }
    });

    expect(cancellata, 'ha cancellato senza avere una copia').toBe(false);
    expect(impostazioni.get('trash') ?? null, 'ha messo nel cestino una scheda monca').toBeNull();
    expect((errore as Error | null)?.message, 'e non lo ha detto a nessuno').toContain(
      'errore di lettura temporaneo',
    );
    await p.smonta();
  });

  it('e quando la lettura riesce, cancella come ha sempre fatto', async () => {
    // La metà che impedisce di «correggere» smettendo di cancellare.
    let cancellata = false;
    h.store = archivio({
      listDives: async () => [IMMERSIONE],
      getDive: async () => IMMERSIONE,
      getSamples: async () => [{ t: 0, depth: 0 }] as Sample[],
      deleteDive: async () => {
        cancellata = true;
      },
    });
    const p = await conIlProvider();
    await act(async () => void (await p.api.removeDive('x')));
    expect(cancellata).toBe(true);
    await p.smonta();
  });
});

describe('dopo un ripristino lo schermo dice quello che dice il disco', () => {
  it('anche per i dati del subacqueo, che non erano in nessuno dei due elenchi', async () => {
    const impostazioni = new Map<string, unknown>([['subacqueo', { nome: 'Prima' }]]);
    h.store = archivio({}, impostazioni);
    const p = await conIlProvider();

    const file = {
      format: 'mydivelog-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      app: { name: 'MyDiveLog', store: 'prova' },
      dives: [],
      settings: { subacqueo: { nome: 'Dopo' }, 'subacqueo:at': new Date().toISOString() },
      summary: { dives: 0, withProfile: 0, samples: 0, settings: ['subacqueo'] },
    } as BackupFile;
    await act(async () => void (await p.api.restoreBackup(file, 'merge')));

    expect(impostazioni.get('subacqueo'), 'sul disco').toEqual({ nome: 'Dopo' });
    // ► `p.api` e non una destrutturazione: `const { api } = p` valuterebbe il
    //   getter UNA VOLTA e guarderebbe per sempre il primo render.
    expect(p.api.subacqueo, 'a schermo').toEqual({ nome: 'Dopo' });
    await p.smonta();
  });
});

describe('il servizio di accesso e le origini native', () => {
  it('ammette l’origine di Windows e Android, non solo quella di Apple', async () => {
    /*
     * Tauri 2 usa `tauri://localhost` su macOS e iOS e `http://tauri.localhost`
     * su Windows e Android. La seconda non era nell'elenco: 403 al preflight.
     */
    const { default: worker } = await import('../server/worker');
    const conf = readFileSync('server/wrangler.toml', 'utf8');
    const origini = /^ORIGINI_AMMESSE = "([^"]+)"/m.exec(conf)![1];

    for (const origine of ['http://tauri.localhost', 'tauri://localhost', 'https://mydivelog.site']) {
      const risposta = await worker.fetch(
        new Request('https://prova.invalid/accesso', {
          method: 'OPTIONS',
          headers: { Origin: origine, 'Access-Control-Request-Method': 'POST' },
        }),
        { ORIGINI_AMMESSE: origini } as never,
      );
      expect(risposta.status, `origine ${origine}`).toBe(204);
    }
  });

  it('e continua a rifiutare quelle che non conosce', async () => {
    // Senza questa riga, «ammetti tutto» farebbe passare la prova qui sopra.
    const { default: worker } = await import('../server/worker');
    const conf = readFileSync('server/wrangler.toml', 'utf8');
    const origini = /^ORIGINI_AMMESSE = "([^"]+)"/m.exec(conf)![1];
    const risposta = await worker.fetch(
      new Request('https://prova.invalid/accesso', {
        method: 'OPTIONS',
        headers: { Origin: 'https://sito-di-qualcun-altro.example', 'Access-Control-Request-Method': 'POST' },
      }),
      { ORIGINI_AMMESSE: origini } as never,
    );
    expect(risposta.status).toBe(403);
  });
});
