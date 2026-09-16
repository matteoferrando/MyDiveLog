// @vitest-environment jsdom
/**
 * IL NUMERO CHE RIPARTE DA DOVE FINISCE IL LOGBOOK DI CARTA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Segnalazione del 16 settembre 2026, dalla stessa persona che il giorno prima
 * aveva trovato il PDF che non si trovava:
 *
 *   *«Dovresti inserire la possibilità di cambiare la numerazione delle
 *    immersioni. Ad esempio io ho scaricato dal mio computer 148 immersioni e
 *    l'ultima mi compare immersione #148 ma in realtà sarebbe la #183.»*
 *
 * ► PERCHÉ QUESTO FILE ESISTE ACCANTO A `numerazione.test.ts`. ◄ Perché il
 * motore sapeva già contare da un numero diverso da zero: `numeriProgressivi`
 * ha il parametro `precedenti` dal giorno in cui è nata, e una prova lo
 * misurava già. Quello che mancava era **il filo**: l'impostazione, la
 * lettura all'avvio, il passaggio alla mappa dei numeri.
 *
 * *Una funzione giusta che nessuno può chiamare non è una funzione: è una
 * funzione in attesa.* Ed è la stessa specie di difetto del gestore che
 * registra un comando non compilato — la prova che leggeva l'elenco diceva
 * verde, perché il nome c'era; quello che non c'era era il collegamento.
 *
 * Quindi qui non si prova `numeriProgressivi`: si monta **il provider vero**,
 * gli si dà un archivio e un'impostazione, e si guarda che numero esce. È
 * l'unico modo per vedere il filo.
 */

import { it, expect, vi, describe } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { DiveStore } from '../src/storage';
import type { Dive } from '../src/core/model';

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

function imm(id: string, giorno: number): Dive {
  return {
    id,
    startTime: `2026-01-${String(giorno).padStart(2, '0')}T10:00:00Z`,
    durationS: 600,
    maxDepth: 20,
    mode: 'oc',
    cylinders: [],
    tags: [],
    source: { format: 'manual', file: '', importedAt: '2026-01-01T10:00:00Z' },
  } as unknown as Dive;
}

const ARCHIVIO = [imm('a', 1), imm('b', 2), imm('c', 3)];

function archivio(impostazioni: Map<string, unknown>): DiveStore {
  return {
    kind: 'indexeddb',
    location: 'prova',
    init: async () => {},
    listDives: async () => ARCHIVIO,
    getDive: async (id: string) => ARCHIVIO.find((d) => d.id === id),
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
async function conIlProvider(impostazioni: Map<string, unknown>): Promise<{
  readonly api: ReturnType<typeof useDiveLog>;
  smonta: () => Promise<void>;
}> {
  h.store = archivio(impostazioni);
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

describe('lo scarto arriva dall’impostazione fino al numero', () => {
  it('con 35 immersioni di carta alle spalle, la prima registrata è la 36', async () => {
    const p = await conIlProvider(new Map([['subacqueo', { immersioniPrecedenti: 35 }]]));
    try {
      expect(p.api.numeri.get('a')).toBe(36);
      expect(p.api.numeri.get('b')).toBe(37);
      expect(p.api.numeri.get('c')).toBe(38);
    } finally {
      await p.smonta();
    }
  });

  it('e senza impostazione si riparte da uno, come è sempre stato', async () => {
    // La metà che impedisce di «sistemare» sommando qualcosa a tutti: chi non
    // ha mai toccato questa casella non deve accorgersi che esiste.
    const p = await conIlProvider(new Map());
    try {
      expect(p.api.numeri.get('a')).toBe(1);
      expect(p.api.numeri.get('c')).toBe(3);
    } finally {
      await p.smonta();
    }
  });

  it('cambiando l’impostazione i numeri cambiano SUBITO, senza riavviare', async () => {
    /*
     * ► LA PARTE CHE SI ROMPE IN SILENZIO. ◄ La mappa dei numeri è dentro un
     * `useMemo`: se l'elenco delle dipendenze non nomina lo scarto, la mappa
     * resta quella del primo calcolo e la casella nuova non fa niente fino al
     * riavvio. Non dà errore, non dà avviso — dà un pulsante che sembra guasto.
     *
     * È lo stesso difetto della prova sul cestino: la funzione «si lamenta»
     * (qui: salva) senza fare quello che deve. Si misura sul fatto osservabile,
     * cioè il numero, e non sul fatto che il salvataggio sia andato a buon fine.
     */
    const p = await conIlProvider(new Map());
    try {
      expect(p.api.numeri.get('a')).toBe(1);
      await act(async () => {
        await p.api.saveSubacqueo({ immersioniPrecedenti: 148 });
      });
      expect(p.api.numeri.get('a'), 'la casella non ha effetto finché non si riavvia').toBe(149);
      expect(p.api.numeri.get('c')).toBe(151);
    } finally {
      await p.smonta();
    }
  });

  it('e uno scarto storto non produce un numero storto', async () => {
    // Il valore arriva da una casella, e in archivio può esserci finito
    // qualunque cosa: un backup vecchio, una sincronizzazione da un'altra
    // versione. `#NaN` sotto a un'immersione sembra un guasto del programma.
    const p = await conIlProvider(new Map([['subacqueo', { immersioniPrecedenti: -7 }]]));
    try {
      expect(p.api.numeri.get('a')).toBe(1);
    } finally {
      await p.smonta();
    }
  });
});
