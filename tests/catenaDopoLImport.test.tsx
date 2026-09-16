// @vitest-environment jsdom
/**
 * IL GF99 CHE DICEVA «SERVE UN PROFILO CAMPIONATO» SU UN PROFILO CHE C'ERA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Trovato da una verifica esterna il 16 settembre 2026, e misurato
 * nell'interfaccia: subito dopo un'importazione le statistiche dicevano «30
 * immersioni con profilo» e il riquadro della saturazione rispondeva *«serve un
 * profilo campionato»*. Dopo un ricaricamento della pagina, **senza dati
 * nuovi**, compariva **84% su 30 immersioni**.
 *
 * *Il numero non era sbagliato: era assente, e il messaggio ne dava la colpa
 * alla cosa sbagliata* — mandava a cercare un profilo che c'era già.
 *
 * ► LA CAUSA. ◄ `computeMetrics` sa tutto di una singola immersione e niente di
 * quelle intorno: il carico residuo di azoto, il GF99 e l'intervallo di
 * superficie nascono dalla CATENA, che va da un'immersione all'altra in ordine
 * di tempo. Ripassarla è quello che fa `repairArchive`, e quelle tre righe
 * c'erano in tre posti su cinque — l'avvio, l'inserimento a mano, il ripristino
 * da backup — e **mancavano nelle due strade dell'import**: quella da file e
 * quella dal Bluetooth. Cioè proprio dove le immersioni arrivano a decine.
 *
 * *Due copie della stessa regola sono una regola e la sua versione vecchia*;
 * cinque sono quattro occasioni di dimenticarsene. Adesso la regola è una
 * funzione sola, `ripassaLaCatena`, e questa prova guarda il risultato — non la
 * funzione.
 */

import { it, expect, vi, describe } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { DiveStore } from '../src/storage';
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

/** Un profilo vero: quaranta metri, salita, sosta. Serve che i tessuti si carichino. */
function profilo(): Sample[] {
  const punti: Sample[] = [];
  for (let t = 0; t <= 1800; t += 10) {
    const depth = t < 1200 ? 40 : Math.max(0, 40 - (t - 1200) / 15);
    punti.push({ t, depth });
  }
  return punti;
}

function imm(id: string, quando: string): Dive {
  return {
    id,
    startTime: quando,
    durationS: 1800,
    maxDepth: 40,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: 12, startBar: 200, endBar: 60 }],
    tags: [],
    source: { format: 'manual', file: '', importedAt: '2026-01-01T10:00:00Z' },
    samples: profilo(),
  } as unknown as Dive;
}

/** Archivio in memoria che tiene i profili a parte, come quelli veri. */
function archivio(): DiveStore {
  const dives = new Map<string, Dive>();
  const samples = new Map<string, Sample[]>();
  const impostazioni = new Map<string, unknown>();
  return {
    kind: 'indexeddb',
    location: 'prova',
    init: async () => {},
    listDives: async () => [...dives.values()].sort((a, b) => (a.startTime < b.startTime ? 1 : -1)),
    getDive: async (id: string) => dives.get(id),
    getSamples: async (id: string) => samples.get(id) ?? [],
    getAltSamples: async () => [],
    sampleCounts: async () => new Map([...samples].map(([id, s]) => [id, s.length])),
    altSampleCounts: async () => new Map(),
    putDives: async (list: Dive[]) => {
      for (const d of list) {
        const { samples: s, ...resto } = d;
        dives.set(d.id, resto as Dive);
        if (s?.length) samples.set(d.id, s);
      }
    },
    deleteDive: async (id: string) => void dives.delete(id),
    clear: async () => dives.clear(),
    getSetting: async <T,>(k: string) => impostazioni.get(k) as T,
    setSetting: async (k: string, v: unknown) => void impostazioni.set(k, v),
  } as DiveStore;
}

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

describe('la catena dei tessuti si ripassa SUBITO dopo un’importazione', () => {
  it('l’immersione appena importata ha il carico di azoto, senza riavviare', async () => {
    /*
     * ► IL CUORE. ◄ `tissuesEnd` è quello che la catena produce e che
     * `computeMetrics` da sola non sa fare. Prima dell'intervento restava
     * indefinito fino al riavvio successivo, e la scheda della saturazione
     * diceva «serve un profilo campionato» accanto a un profilo di 181 punti.
     */
    h.store = archivio();
    const p = await conIlProvider();
    try {
      await act(async () => {
        await p.api.importDives([imm('a', '2026-05-01T09:00:00Z')], 'Bluetooth');
      });

      const a = p.api.dives.find((d) => d.id === 'a');
      expect(a, 'l’immersione è in elenco').toBeDefined();
      expect(a?.metrics?.tissuesEnd, 'la catena NON è stata ripassata').toBeDefined();
    } finally {
      await p.smonta();
    }
  });

  it('e la ripetitiva che segue riceve il carico di quella prima', async () => {
    /*
     * ► LA METÀ CHE CONTA DI PIÙ, e che la prova qui sopra da sola non prende. ◄
     *
     * Un'immersione nuova non cambia solo la propria riga: cambia quelle che la
     * SEGUONO, calcolate quando lei non c'era — cioè con i tessuti puliti, cioè
     * più tranquille del vero. Su una ripetitiva a quaranta metri non è un
     * dettaglio estetico.
     */
    h.store = archivio();
    const p = await conIlProvider();
    try {
      // Prima arriva la seconda immersione della giornata, da sola.
      await act(async () => {
        await p.api.importDives([imm('b', '2026-05-01T12:00:00Z')], 'Bluetooth');
      });
      const sola = p.api.dives.find((d) => d.id === 'b')?.metrics?.tissuesEnd;
      expect(sola).toBeDefined();

      // Poi quella del mattino, che le sta davanti nella catena.
      await act(async () => {
        await p.api.importDives([imm('a', '2026-05-01T09:00:00Z')], 'file.uddf');
      });
      const dopo = p.api.dives.find((d) => d.id === 'b')?.metrics?.tissuesEnd;

      expect(dopo, 'la seconda è stata ricalcolata con l’azoto della prima').not.toEqual(sola);
    } finally {
      await p.smonta();
    }
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════
 * ► LA GUARDIA GROSSOLANA CHE COPRE LA STRADA CHE L'ALTRA NON PERCORRE. ◄
 *
 * La prova qui sopra monta il provider vero e importa dal Bluetooth
 * (`importDives`). L'altra strada — `importFiles`, quella dei file — vorrebbe
 * dei `File` veri con dentro un formato vero, e una prova che costruisce un
 * UDDF finto per misurare il ricalcolo della saturazione misura dieci cose e ne
 * dichiara una.
 *
 * Ma è **esattamente la strada su cui questo difetto è nato**: la regola c'era
 * in tre posti su cinque, e i due che mancavano erano i due import. Lasciarne
 * uno scoperto qui vorrebbe dire ripetere l'errore nel file scritto per
 * chiuderlo.
 *
 * Quindi: si legge il sorgente e si pretende che tutte e due le funzioni
 * nominino `ripassaLaCatena`. Non sa se la chiamata è nel punto giusto — quello
 * lo prova la misura qui sopra sull'altra strada — ma prende l'unico errore che
 * si fa davvero: scrivere una terza strada d'ingresso e dimenticarsene.
 */
describe('tutte e due le strade d’ingresso ripassano la catena', () => {
  /** Il corpo di un `useCallback`, per parentesi bilanciate. */
  function corpoDi(sorgente: string, nome: string): string {
    const apertura = sorgente.indexOf(`const ${nome} = useCallback(`);
    expect(apertura, `«${nome}» non c’è più in state.tsx`).toBeGreaterThan(-1);
    let profondita = 0;
    let i = sorgente.indexOf('(', apertura);
    const inizio = i;
    for (; i < sorgente.length; i++) {
      if (sorgente[i] === '(') profondita++;
      else if (sorgente[i] === ')' && --profondita === 0) break;
    }
    return sorgente.slice(inizio, i);
  }

  it.each(['importFiles', 'importDives'])('%s la ripassa', async (nome) => {
    const { readFileSync } = await import('node:fs');
    const sorgente = readFileSync('src/ui/state.tsx', 'utf8');
    expect(corpoDi(sorgente, nome)).toContain('ripassaLaCatena(');
  });

  it('e l’estrattore sa fare il suo mestiere', async () => {
    // ► LA GUARDIA DELLA GUARDIA: se `corpoDi` restituisse tutto il file, la
    //   prova qui sopra passerebbe anche con le chiamate tolte.
    const { readFileSync } = await import('node:fs');
    const sorgente = readFileSync('src/ui/state.tsx', 'utf8');
    const corpo = corpoDi(sorgente, 'importDives');
    expect(corpo.length).toBeLessThan(sorgente.length / 4);
    expect(corpo).toContain('origine');
    expect(corpo, 'ha preso il corpo dell’altra').not.toContain('files: File[]');
  });
});
