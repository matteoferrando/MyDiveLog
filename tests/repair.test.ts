/**
 * Riparazione dell'archivio.
 *
 * Il caso che ha reso necessario questo codice è quello reale: la scheda mostrava
 * una bombola da 12 litri con 240 → 60 bar e, accanto, "nessuna pressione bombola:
 * consumo non calcolabile", perché le metriche erano state calcolate sulla
 * versione dell'immersione arrivata dall'altro computer. Un reimport lo avrebbe
 * risolto, ma chiedere un reimport per far tornare un numero non è una risposta.
 *
 * Le due proprietà verificate qui contano entrambe:
 *  - la riparazione **corregge** le incoerenze osservabili;
 *  - la riparazione **non scrive** quando non c'è niente da correggere, altrimenti
 *    a ogni avvio marcherebbe come modificate tutte le immersioni e la
 *    sincronizzazione le rimanderebbe al database remoto senza motivo.
 */

import { describe, expect, it } from 'vitest';
import {
  dedupeDiveComputers,
  hydrateForMerge,
  inconsistencies,
  repairArchive,
  normaliseDive,
} from '../src/storage/repair';
import { filterDeleted } from '../src/storage/trash';
import { mergeImports } from '../src/core/dedupe';
import { computeMetrics } from '../src/core/analysis/metrics';
import type { Dive, Sample } from '../src/core/model';
import type { DiveStore } from '../src/storage';

function profile(n: number, everyS = 10): Sample[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * everyS,
    depth: i < 6 ? i * 4 : i > n - 8 ? Math.max(0, (n - i) * 3) : 22 + Math.sin(i / 5),
    tempC: 18,
  }));
}

function dive(over: Partial<Dive> = {}): Dive {
  return {
    id: 'd1',
    startTime: '2026-07-11T11:59:00+02:00',
    durationS: 3000,
    maxDepth: 29.3,
    avgDepth: 14.9,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: 12, startBar: 240, endBar: 60 }],
    source: { format: 'logtrak', file: 'a.logtrak', importedAt: '2026-08-17T10:00:00Z' },
    tags: [],
    ...over,
  };
}

/** Store in memoria con profili separati, come le implementazioni vere. */
function memoryStore(
  dives: Dive[],
  samples: Record<string, Sample[]> = {},
  alt: Record<string, Sample[]> = {},
) {
  const byId = new Map(dives.map((d) => [d.id, d]));
  const written: Dive[][] = [];
  const store: DiveStore = {
    kind: 'indexeddb',
    location: 'memoria',
    async init() {},
    async listDives() {
      return [...byId.values()];
    },
    async getDive(id) {
      return byId.get(id);
    },
    async getSamples(id) {
      return samples[id] ?? [];
    },
    async getAltSamples(id) {
      return alt[id] ?? [];
    },
    async sampleCounts() {
      return new Map(Object.entries(samples).map(([id, s]) => [id, s.length]));
    },
    async altSampleCounts() {
      return new Map(Object.entries(alt).map(([id, s]) => [id, s.length]));
    },
    async putDives(list) {
      written.push(list);
      for (const d of list) byId.set(d.id, d);
    },
    async deleteDive() {},
    async clear() {},
    async getSetting() {
      return undefined;
    },
    async setSetting() {},
  };
  return { store, written };
}

describe('rilevamento delle incoerenze', () => {
  it('trova il caso reale: pressioni note e consumo assente', () => {
    // Metriche calcolate su un'immersione SENZA pressioni, poi unite a una che le
    // ha: è esattamente ciò che accadeva fondendo Aladin e Peregrine.
    const withoutGas = dive({ cylinders: [{ mix: { o2: 0.21, he: 0 } }], samples: profile(300) });
    const staleMetrics = computeMetrics(withoutGas);
    const merged = dive({ metrics: staleMetrics });
    const reasons = inconsistencies(merged, 300);
    expect(reasons.join(' ')).toMatch(/consumo assente/);
  });

  it('trova le metriche calcolate su un profilo diverso', () => {
    const d = dive({ metrics: computeMetrics(dive({ samples: profile(100) })) });
    expect(inconsistencies(d, 300).join(' ')).toMatch(/invece di 300/);
  });

  it('trova un profilo senza metriche', () => {
    expect(inconsistencies(dive(), 300).join(' ')).toMatch(/nessuna metrica/);
  });

  it('tace su un’immersione coerente', () => {
    const samples = profile(300);
    const d = dive({ samples });
    const coherent = { ...d, metrics: computeMetrics(d) };
    delete coherent.samples;
    expect(inconsistencies(coherent, 300)).toEqual([]);
  });

  it('tace su un’immersione senza profilo e senza dati gas', () => {
    const d = dive({ cylinders: [{ mix: { o2: 0.21, he: 0 } }], avgDepth: undefined });
    const withMetrics = { ...d, metrics: computeMetrics(d) };
    expect(inconsistencies(withMetrics, 0)).toEqual([]);
  });
});

describe('riparazione', () => {
  it('ricalcola il consumo e riscrive solo le immersioni corrette', async () => {
    const samples = profile(300);
    const withoutGas = dive({ cylinders: [{ mix: { o2: 0.21, he: 0 } }], samples });
    const broken = dive({ metrics: computeMetrics(withoutGas) });
    const fine = (() => {
      const d = dive({ id: 'd2', samples });
      const m = computeMetrics(d);
      return { ...d, id: 'd2', metrics: m, samples: undefined } as Dive;
    })();

    const { store, written } = memoryStore([broken, fine], { d1: samples, d2: samples });
    const { report, dives } = await repairArchive(store, [broken, fine]);

    expect(dives[0].metrics?.rmvLpm).toBeGreaterThan(5);
    expect(dives[0].metrics?.endPressureBar).toBe(60);
    // Entrambe vengono toccate, ma per motivi diversi: `d1` per il consumo,
    // `d2` perché il carico di azoto non era mai stato calcolato. La riparazione
    // dichiara i due motivi separatamente invece di confonderli.
    expect(report.repaired).toBe(2);
    expect(report.reasons['volume e pressioni noti ma consumo assente']).toBe(1);
    expect(report.reasons['carico di azoto non ancora calcolato']).toBe(2);
    // Una sola scrittura, con dentro tutte e due.
    expect(written).toHaveLength(1);
    expect(written[0].map((d) => d.id).sort()).toEqual(['d1', 'd2']);
    // I campioni non finiscono nel riepilogo: stanno nella loro tabella.
    for (const d of written[0]) expect(d.samples).toBeUndefined();
  });

  it('non scrive niente su un archivio già coerente e già analizzato', async () => {
    // «Già coerente» ora vuol dire anche «con il carico di azoto calcolato»: una
    // grandezza nuova fa lavorare la riparazione una volta, ed è il modo in cui
    // gli archivi vecchi si aggiornano da soli. Quello che deve valere è che la
    // SECONDA esecuzione non tocchi più niente.
    const samples = profile(300);
    const d = dive({ samples });
    const coherent = { ...d, metrics: computeMetrics(d), samples: undefined } as Dive;
    const { store, written } = memoryStore([coherent], { d1: samples });

    const primo = await repairArchive(store, [coherent]);
    expect(primo.report.repaired).toBe(1);
    expect(primo.report.reasons['carico di azoto non ancora calcolato']).toBe(1);

    const secondo = await repairArchive(store, primo.dives);
    expect(secondo.report.repaired).toBe(0);
    expect(written).toHaveLength(1);
  });

  it('eseguita due volte di fila non fa niente la seconda', async () => {
    const samples = profile(300);
    const withoutGas = dive({ cylinders: [{ mix: { o2: 0.21, he: 0 } }], samples });
    const broken = dive({ metrics: computeMetrics(withoutGas) });
    const { store, written } = memoryStore([broken], { d1: samples });

    const first = await repairArchive(store, [broken]);
    expect(first.report.repaired).toBe(1);
    const second = await repairArchive(store, first.dives);
    expect(second.report.repaired).toBe(0);
    expect(written).toHaveLength(1);
  });
});

describe('profili caricati prima di una fusione', () => {
  const rich = (n: number): Sample[] => profile(n).map((s) => ({ ...s, ndlS: 600, ttsS: 120, cns: 3 }));

  it('carica il profilo delle immersioni vicine a quelle in arrivo', async () => {
    const stored = dive({ id: 'd1', samples: undefined });
    const far = dive({ id: 'd2', startTime: '2020-01-01T10:00:00Z', samples: undefined });
    const { store } = memoryStore([stored, far], { d1: rich(300), d2: rich(300) });

    const incoming = [dive({ id: 'x', startTime: '2026-07-11T09:59:00Z' })];
    const hydrated = await hydrateForMerge(store, [stored, far], incoming);

    expect(hydrated[0].samples).toHaveLength(300);
    // L'immersione del 2020 non c'entra con l'import: non si carica.
    expect(hydrated[1].samples).toBeUndefined();
  });

  it('senza questo passaggio la fusione perderebbe il profilo migliore', async () => {
    // Il caso reale: in archivio c'è il profilo del Peregrine (con i dati
    // decompressivi) ma la lista in memoria non lo porta; in arrivo c'è quello
    // dell'Aladin, più fitto e senza deco. Confrontando i canali su un profilo
    // "vuoto", il più povero vincerebbe.
    const storedSummary = dive({ id: 'd1', samples: undefined, metrics: undefined });
    const denseNoDeco = dive({
      id: 'd1',
      samples: profile(600, 5),
      source: { format: 'logtrak', file: 'b.logtrak', importedAt: 'x' },
    });
    const { store } = memoryStore([storedSummary], { d1: rich(300) });

    const naive = mergeImports([storedSummary], [denseNoDeco], '2026-08-17T00:00:00Z');
    expect(naive.dives[0].samples?.[0].ndlS).toBeUndefined(); // profilo povero: deco perso

    const hydrated = await hydrateForMerge(store, [storedSummary], [denseNoDeco]);
    const correct = mergeImports(hydrated, [denseNoDeco], '2026-08-17T00:00:00Z');
    expect(correct.dives[0].samples?.[0].ndlS).toBe(600); // il profilo con la deco resta
  });

  it('non duplica il computer principale reimportando gli stessi file', async () => {
    const peregrine = { model: 'Shearwater Peregrine', serial: 'A1B2C3D4', gfLow: 20, gfHigh: 85 };
    const aladin = { model: 'Scubapro Aladin Sport Matrix', serial: '6303450223', ppo2MaxBar: 1.5 };

    const stored = dive({
      id: 'd1',
      computer: peregrine,
      otherComputers: [aladin],
      samples: undefined,
    });
    const { store } = memoryStore([stored], { d1: rich(300) });
    const incomingShearwater = dive({
      id: 'd1',
      computer: { ...peregrine },
      samples: rich(300),
      source: { format: 'shearwater-cloud', file: 'c.db', importedAt: 'x' },
    });

    const hydrated = await hydrateForMerge(store, [stored], [incomingShearwater]);
    const merged = mergeImports(hydrated, [incomingShearwater], '2026-08-17T00:00:00Z');
    const d = merged.dives[0];
    expect(d.computer?.model).toBe('Shearwater Peregrine');
    expect(d.otherComputers?.map((c) => c.model)).toEqual(['Scubapro Aladin Sport Matrix']);
  });

  it('ripulisce un archivio dove il principale era già finito nell’elenco', () => {
    const peregrine = { model: 'Shearwater Peregrine', serial: 'A1B2C3D4' };
    const stored = dive({
      id: 'd1',
      computer: peregrine,
      otherComputers: [{ ...peregrine }, { model: 'Scubapro Aladin Sport Matrix', serial: '63' }],
      samples: profile(300),
    });
    const merged = mergeImports(
      [stored],
      [dive({ id: 'd1', notes: 'nota nuova', samples: profile(300) })],
      'x',
    );
    expect(merged.dives[0].otherComputers?.map((c) => c.model)).toEqual(['Scubapro Aladin Sport Matrix']);
  });
});

describe('riparazione dei computer duplicati', () => {
  const peregrine = { model: 'Shearwater Peregrine', serial: 'A1B2C3D4' };

  it('toglie dall’elenco il computer che è già il principale', () => {
    const d = dive({ computer: peregrine, otherComputers: [{ ...peregrine }] });
    expect(dedupeDiveComputers(d)?.otherComputers).toBeUndefined();
  });

  it('non tocca un elenco corretto', () => {
    const d = dive({
      computer: peregrine,
      otherComputers: [{ model: 'Scubapro Aladin Sport Matrix', serial: '63' }],
    });
    expect(dedupeDiveComputers(d)).toBeNull();
  });

  it('la riparazione all’avvio li ripulisce e conta una sola immersione', async () => {
    const samples = profile(300);
    const d = dive({ computer: peregrine, otherComputers: [{ ...peregrine }], samples });
    const coherent = { ...d, metrics: computeMetrics(d), samples: undefined } as Dive;
    const { store, written } = memoryStore([coherent], { d1: samples });
    const { report, dives } = await repairArchive(store, [coherent]);
    expect(report.repaired).toBe(1);
    expect(dives[0].otherComputers).toBeUndefined();
    expect(written).toHaveLength(1);
    expect(written[0]).toHaveLength(1);
  });
});

describe('secondo profilo: il meglio dei due computer', () => {
  /**
   * Lo STESSO tuffo campionato in due modi: è il punto della prova.
   *
   * La profondità è una funzione del tempo con un'oscillazione di periodo 30 s,
   * cioè il genere di movimento che un passo di 4 s cattura e uno di 10 s aliasa.
   * Costruire i due profili con funzioni diverse non proverebbe niente: la
   * differenza verrebbe dalle funzioni, non dalla risoluzione.
   */
  const depthAt = (t: number) => 20 + Math.sin((2 * Math.PI * t) / 24) * 1.2;
  /** L'Aladin: 4 s, nessun dato decompressivo. */
  const dense = (n: number): Sample[] =>
    Array.from({ length: n }, (_, i) => ({ t: i * 4, depth: depthAt(i * 4), tempC: 18 }));
  /** Il Peregrine: 10 s, con tetto, NDL, TTS e CNS. */
  const sparse = (n: number): Sample[] =>
    Array.from({ length: n }, (_, i) => ({
      t: i * 10,
      depth: depthAt(i * 10),
      tempC: 18,
      ndlS: 600,
      ttsS: 120,
      cns: 3,
    }));

  it('la fusione tiene il profilo rado per la visualizzazione e quello fitto per misurare', () => {
    const fromAladin = dive({ samples: dense(600) });
    const fromPeregrine = dive({
      samples: sparse(240),
      source: { format: 'shearwater-cloud', file: 'b.db', importedAt: 'x' },
    });
    const merged = mergeImports([fromAladin], [fromPeregrine], '2026-08-17T00:00:00Z').dives[0];

    // Il principale è quello con i canali decompressivi…
    expect(merged.samples?.[0].ndlS).toBe(600);
    expect(merged.samples).toHaveLength(240);
    // …e il fitto resta come secondo profilo.
    expect(merged.altSamples).toHaveLength(600);
    // Le velocità sono misurate sul fitto, e la scheda lo dichiara.
    expect(merged.metrics?.quality.ratesFromAlt).toBe(true);
    expect(merged.metrics?.quality.ratesIntervalS).toBe(4);
    expect(merged.metrics?.quality.caveats.join(' ')).toMatch(/secondo computer/);
  });

  it('misurare sul profilo fitto cambia l’assetto in modo sostanziale', () => {
    // È la ragione per cui il secondo profilo viene conservato: sui dati reali il
    // profilo a 10 s legge l'oscillazione circa un terzo più bassa.
    const base = dive({ samples: sparse(240) });
    const onlySparse = computeMetrics(base);
    const withDense = computeMetrics({ ...base, altSamples: dense(600) });
    expect(onlySparse.bottomVerticalTravelMpm).toBeDefined();
    // Sui dati reali di questo archivio il rapporto misurato è 0.66 (il profilo
    // rado legge un terzo in meno). Qui basta verificare la direzione e che sia
    // sostanziale: l'ampiezza esatta dipende da come oscilla il tuffo.
    expect(withDense.bottomVerticalTravelMpm).toBeGreaterThan(
      (onlySparse.bottomVerticalTravelMpm ?? 0) * 1.1,
    );
    expect(withDense.quality.ratesIntervalS).toBe(4);
    expect(onlySparse.quality.ratesIntervalS).toBe(10);
  });

  it('un secondo profilo più rado del principale non viene conservato', () => {
    const rich = dive({ samples: dense(600) });
    const poor = dive({
      samples: sparse(60),
      source: { format: 'csv', file: 'c.csv', importedAt: 'x' },
    });
    const merged = mergeImports([rich], [poor], 'x').dives[0];
    // Il profilo con i canali deco vince, ma solo se è anche utile: qui il fitto
    // resta come secondo perché ha un passo minore.
    expect(merged.altSamples?.length).toBe(600);
    // E l'inverso non accade: nessun secondo profilo più rado di quello mostrato.
    const back = mergeImports([poor], [rich], 'x').dives[0];
    const altInterval = back.altSamples
      ? (back.altSamples[back.altSamples.length - 1].t - back.altSamples[0].t) / (back.altSamples.length - 1)
      : Infinity;
    const mainInterval =
      (back.samples![back.samples!.length - 1].t - back.samples![0].t) / (back.samples!.length - 1);
    expect(altInterval).toBeLessThan(mainInterval);
  });

  it('la riparazione non ricalcola quando il profilo fitto non è disponibile', async () => {
    // Caso di un dispositivo che ha ricevuto l'immersione dalla sincronizzazione:
    // le metriche buone ci sono, il secondo profilo no. Ricalcolare le
    // peggiorerebbe, quindi non si tocca niente.
    const withBoth = dive({ samples: sparse(240), altSamples: dense(600) });
    const metrics = computeMetrics(withBoth);
    expect(metrics.quality.ratesFromAlt).toBe(true);
    const stored = { ...withBoth, metrics, samples: undefined, altSamples: undefined } as Dive;

    const { store, written } = memoryStore([stored], { d1: sparse(240) });
    const { report, dives } = await repairArchive(store, [stored]);
    // Il carico di azoto viene calcolato — quello si può fare anche sul profilo
    // rado — ma l'assetto NON viene ricalcolato, che è la cosa che questo test
    // protegge: misurato sul profilo più rado uscirebbe più basso di quanto è.
    expect(report.reasons['velocità misurate sul profilo rado mentre esiste quello fitto']).toBeUndefined();
    expect(dives[0].metrics?.bottomVerticalTravelMpm).toBe(metrics.bottomVerticalTravelMpm);
    expect(dives[0].metrics?.gf99Pct).toBeGreaterThan(0);
    expect(
      written[0]?.every((d) => d.metrics?.bottomVerticalTravelMpm === metrics.bottomVerticalTravelMpm),
    ).toBe(true);
  });

  it('la riparazione ricalcola usando il profilo fitto quando c’è', async () => {
    const withBoth = dive({ samples: sparse(240), altSamples: dense(600) });
    // Metriche vecchie, calcolate senza il secondo profilo.
    const stale = computeMetrics({ ...withBoth, altSamples: undefined });
    const stored = { ...withBoth, metrics: stale, samples: undefined, altSamples: undefined } as Dive;
    const { store } = memoryStore([stored], { d1: sparse(240) }, { d1: dense(600) });
    const { dives } = await repairArchive(store, [stored]);
    expect(dives[0].metrics?.quality.ratesFromAlt).toBe(true);
    expect(dives[0].metrics?.bottomVerticalTravelMpm).toBeGreaterThan(
      (stale.bottomVerticalTravelMpm ?? 0) * 1.1,
    );
  });
});

describe('pulizia di ciò che arriva dalla rete', () => {
  /**
   * Questo blocco nasce da un difetto che si è ripresentato DOPO una
   * sincronizzazione: l'import puliva, la riparazione all'avvio puliva, ma il
   * documento che scendeva dal database remoto veniva scritto così com'era.
   */
  const peregrine = { model: 'Shearwater Peregrine', serial: 'A1B2C3D4', gfLow: 20, gfHigh: 85 };
  const peregrineParziale = { model: 'Shearwater Peregrine', serial: 'A1B2C3D4', firmware: 'v89' };
  const aladin = { model: 'Scubapro Aladin Sport Matrix', serial: '6303450223' };

  const dive = (over: Partial<Dive>): Dive => ({
    id: 'x',
    startTime: '2026-06-14T10:00:00Z',
    durationS: 2400,
    maxDepth: 30,
    mode: 'oc',
    cylinders: [],
    source: { format: 'uddf', file: 'a', importedAt: 'x' },
    tags: [],
    ...over,
  });

  it('toglie dall’elenco il computer che è già quello principale', () => {
    const cleaned = normaliseDive(dive({ computer: peregrine, otherComputers: [peregrine, aladin] }));
    expect(cleaned.otherComputers).toHaveLength(1);
    expect(cleaned.otherComputers![0].model).toMatch(/Aladin/);
  });

  it('deduplica l’elenco anche contro se stesso', () => {
    // Lo stesso computer due volte fra gli "altri", con campi diversi: prima
    // sopravvivevano entrambi e la scheda mostrava due volte lo stesso strumento.
    const cleaned = normaliseDive(dive({ computer: aladin, otherComputers: [peregrine, peregrineParziale] }));
    expect(cleaned.otherComputers).toHaveLength(1);
    // E i campi delle due letture si sommano invece di perdersi.
    expect(cleaned.otherComputers![0]).toMatchObject({ gfLow: 20, gfHigh: 85, firmware: 'v89' });
  });

  it('non tocca un’immersione già pulita', () => {
    const good = dive({ computer: peregrine, otherComputers: [aladin] });
    expect(normaliseDive(good)).toBe(good);
  });

  it('regge le immersioni senza computer', () => {
    const bare = dive({});
    expect(normaliseDive(bare)).toBe(bare);
  });
});

/**
 * Quello che è stato cancellato non deve tornare da un import.
 *
 * È il difetto che si scopre usando l'app, e che lo scarico Bluetooth rende
 * sistematico: la memoria del computer contiene ancora l'immersione cancellata
 * e non c'è modo di toglierla da lì, quindi ogni collegamento la rimetterebbe
 * in archivio. Sui file capitava di rado — bastava reimportare lo stesso
 * export — ma il meccanismo era lo stesso: l'import fonde tutto quello che
 * arriva, e di cestino e lapidi non sa niente.
 */
describe('import contro cestino e lapidi', () => {
  const imm = (id: string): Dive => ({
    id,
    startTime: '2026-06-14T09:00:00Z',
    durationS: 2400,
    maxDepth: 30,
    mode: 'oc',
    cylinders: [],
    source: { format: 'uddf', file: 'x', importedAt: 'x' },
    tags: [],
  });

  it('un’immersione nel cestino non rientra', () => {
    const out = filterDeleted([imm('a'), imm('b')], [{ dive: { id: 'a' } }], []);
    expect(out.keep.map((d) => d.id)).toEqual(['b']);
    expect(out.inTrash).toBe(1);
    expect(out.buried).toBe(0);
  });

  it('un’immersione con la lapide non risorge', () => {
    // Se rientrasse, verrebbe ricancellata dalla sincronizzazione successiva —
    // oppure sopravvivrebbe e tornerebbe su tutti i dispositivi.
    const out = filterDeleted([imm('a')], [], [{ id: 'a' }]);
    expect(out.keep).toHaveLength(0);
    expect(out.buried).toBe(1);
  });

  it('le due categorie si contano separate, perché hanno rimedi diversi', () => {
    // Dal cestino si rimette a posto; con la lapide no. Un conteggio unico
    // impedirebbe di dire qual è la strada per riaverle.
    const out = filterDeleted([imm('a'), imm('b'), imm('c')], [{ dive: { id: 'a' } }], [{ id: 'b' }]);
    expect(out.keep.map((d) => d.id)).toEqual(['c']);
    expect(out.inTrash).toBe(1);
    expect(out.buried).toBe(1);
  });

  it('senza cancellazioni non tocca niente', () => {
    const arrivate = [imm('a'), imm('b')];
    const out = filterDeleted(arrivate, [], []);
    expect(out.keep).toEqual(arrivate);
  });
});

/*
 * LO STESSO ALADIN SCRITTO IN DUE MODI.
 *
 * LogTRAK esporta il seriale con il numero di tipo in coda — `6303450223` per
 * l'apparecchio che via Bluetooth si presenta come `63034502` — e la scheda
 * mostrava due Scubapro Aladin Sport Matrix: uno con PPO2 e firmware, l'altro
 * col passo di campionamento. Correggere il lettore non basta: le immersioni già
 * in archivio restano com'erano, e chiedere un reimport per far sparire una
 * scheda doppia è la richiesta che questo file esiste per non fare.
 */
describe('due scritture dello stesso seriale', () => {
  const conDue = (over: Partial<Dive> = {}): Dive => ({
    ...dive(),
    computer: {
      model: 'Scubapro Aladin Sport Matrix',
      serial: '6303450223',
      ppo2MaxBar: 1.5,
      firmware: '2.1',
    },
    otherComputers: [{ model: 'Scubapro Aladin Sport Matrix', serial: '63034502', sampleIntervalS: 4 }],
    ...over,
  });

  it('diventano un computer solo, col seriale corto e i campi di entrambi', () => {
    const d = normaliseDive(conDue());
    expect(d.otherComputers).toBeUndefined();
    expect(d.computer?.serial).toBe('63034502');
    expect(d.computer?.ppo2MaxBar).toBe(1.5);
    expect(d.computer?.firmware).toBe('2.1');
    expect(d.computer?.sampleIntervalS).toBe(4);
  });

  it('non tocca due modelli diversi', () => {
    const d = normaliseDive(
      conDue({
        otherComputers: [{ model: 'Shearwater Peregrine', serial: '6303450223999' }],
      }),
    );
    expect(d.otherComputers).toHaveLength(1);
  });

  it('non tocca due seriali che si somigliano soltanto', () => {
    // stesso modello, ma quattro cifre di differenza: non è una coda di tipo
    const d = normaliseDive(
      conDue({
        computer: { model: 'Scubapro Aladin Sport Matrix', serial: '63034502' },
        otherComputers: [{ model: 'Scubapro Aladin Sport Matrix', serial: '630345021234' }],
      }),
    );
    expect(d.otherComputers).toHaveLength(1);
  });

  it('non accorcia sotto le sei cifre', () => {
    const d = normaliseDive(
      conDue({
        computer: { model: 'Scubapro Aladin Sport Matrix', serial: '12345' },
        otherComputers: [{ model: 'Scubapro Aladin Sport Matrix', serial: '1234523' }],
      }),
    );
    expect(d.otherComputers).toHaveLength(1);
  });

  /*
   * IL CASO CHE IL PRIMO TENTATIVO NON PRENDEVA: l'immersione registrata da un
   * Peregrine e da un Aladin. Il principale è il Peregrine, e le due scritture
   * dell'Aladin stanno ENTRAMBE fra gli altri — dove il confronto col solo
   * principale non le vedeva. Tre computer per due apparecchi.
   */
  it('unifica anche due «altri» fra loro, quando il principale è un terzo computer', () => {
    const d = normaliseDive(
      conDue({
        computer: { model: 'Shearwater Peregrine', serial: '988B023F', gfLow: 20, gfHigh: 85 },
        otherComputers: [
          { model: 'Scubapro Aladin Sport Matrix', serial: '6303450223', ppo2MaxBar: 1.5, firmware: '2.1' },
          { model: 'Scubapro Aladin Sport Matrix', serial: '63034502', sampleIntervalS: 4 },
        ],
      }),
    );
    expect(d.computer?.serial).toBe('988B023F');
    expect(d.otherComputers).toHaveLength(1);
    expect(d.otherComputers?.[0]).toMatchObject({
      serial: '63034502',
      ppo2MaxBar: 1.5,
      firmware: '2.1',
      sampleIntervalS: 4,
    });
  });

  it('non scrive niente quando non c’è niente da unificare', () => {
    const pulita = dive();
    expect(normaliseDive(pulita)).toBe(pulita);
  });
});
