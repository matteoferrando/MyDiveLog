import { describe, expect, it } from 'vitest';
import {
  diveIdFor,
  likelySame,
  mergeDive,
  mergeImports,
  profileChannels,
  similar,
  stableId,
} from '../src/core/dedupe';
import { parseFile } from '../src/core/parsers';
import { parseFit } from '../src/core/parsers/garminFit';
import { synthesise, toFit, toShearwaterXml, toSubsurface, toUddf } from './fixtures';
import type { Dive } from '../src/core/model';

const base = (over: Partial<Dive> = {}): Dive => ({
  id: 'x',
  startTime: '2026-06-14T10:38:00.000Z',
  durationS: 42 * 60,
  maxDepth: 32,
  avgDepth: 21,
  mode: 'oc',
  cylinders: [],
  source: { format: 'uddf', file: 'f', importedAt: '2026-06-14T12:00:00.000Z' },
  tags: [],
  ...over,
});

describe('tolleranza proporzionale', () => {
  it('accetta differenze sotto la soglia assoluta', () => {
    expect(similar(32, 32.5, 1)).toBe(true);
    // 2 m su 34 sono comunque entro il 10%: passa dal ramo relativo.
    expect(similar(32, 34, 1)).toBe(true);
    // 8 m su 40 sono il 20%: fuori da entrambi i rami.
    expect(similar(32, 40, 1)).toBe(false);
  });

  it('accetta differenze sotto il 10% del maggiore', () => {
    // 2 minuti su 42 sono meno del 10%: la stessa immersione vista da due computer.
    expect(similar(42 * 60, 44 * 60, 5 * 60)).toBe(true);
    // Su valori grandi la soglia relativa è più permissiva di quella assoluta.
    expect(similar(6000, 6400, 300)).toBe(true);
  });
});

describe('riconoscimento della stessa immersione', () => {
  it('riconosce lo stesso profilo con orologi sfasati di 8 minuti', () => {
    const a = base();
    const b = base({ startTime: '2026-06-14T10:46:00.000Z' });
    // La finestra è metà della durata (21 min), quindi 8 minuti rientrano.
    expect(likelySame(a, b)).toBe(true);
  });

  it('non fonde due immersioni ripetitive dello stesso giorno', () => {
    const a = base();
    // Seconda immersione: più corta e meno profonda. Anche se l'orario cadesse
    // nella finestra, profondità e durata la distinguono.
    const b = base({ startTime: '2026-06-14T11:10:00.000Z', durationS: 20 * 60, maxDepth: 18 });
    expect(likelySame(a, b)).toBe(false);
  });

  it('non fonde immersioni di profondità diversa nella stessa finestra', () => {
    const a = base();
    const b = base({ maxDepth: 45 });
    expect(likelySame(a, b)).toBe(false);
  });

  it('usa la corrispondenza forte quando i computer coincidono', () => {
    const computer = { model: 'Peregrine', deviceId: 'SW1001', diveId: '77' };
    const a = base({ computer });
    const b = base({ computer: { ...computer, model: 'PEREGRINE' } });
    expect(likelySame(a, b)).toBe(true);
  });
});

describe('id stabile', () => {
  it('è deterministico', () => {
    expect(stableId(['a', 1, undefined])).toBe(stableId(['a', 1, undefined]));
    expect(stableId(['a', 1])).not.toBe(stableId(['a', 2]));
  });

  it("preferisce l'identificativo del computer quando esiste", () => {
    const withDc = diveIdFor({
      startTime: '2026-06-14T10:38:00.000Z',
      maxDepth: 32,
      durationS: 2520,
      computer: { model: 'Peregrine', deviceId: 'SW1', diveId: '5' },
    });
    // Cambiando l'orario ma non l'identificativo, l'id resta lo stesso.
    const shifted = diveIdFor({
      startTime: '2026-06-14T11:00:00.000Z',
      maxDepth: 32,
      durationS: 2520,
      computer: { model: 'Peregrine', deviceId: 'SW1', diveId: '5' },
    });
    expect(withDc).toBe(shifted);
  });

  it('reimportare lo stesso file dà lo stesso id', async () => {
    const synth = synthesise();
    const first = await parseFile({ fileName: 'a.uddf', text: toUddf(synth) });
    const second = await parseFile({ fileName: 'a.uddf', text: toUddf(synth) });
    expect(first.dives[0].id).toBe(second.dives[0].id);
  });
});

describe('merge degli import', () => {
  it('non duplica reimportando lo stesso file', async () => {
    const synth = synthesise();
    const { dives } = await parseFile({ fileName: 'a.uddf', text: toUddf(synth) });
    const once = mergeImports([], dives);
    expect(once.added).toBe(1);
    const twice = mergeImports(once.dives, dives);
    expect(twice.added).toBe(0);
    expect(twice.dives).toHaveLength(1);
  });

  it('unisce la stessa immersione arrivata da tre computer diversi', async () => {
    const synth = synthesise();
    const [uddf, ssrf, fit] = await Promise.all([
      parseFile({ fileName: 'a.uddf', text: toUddf(synth) }),
      parseFile({ fileName: 'b.ssrf', text: toSubsurface(synth) }),
      parseFit({ fileName: 'c.fit', bytes: toFit(synth) }),
    ]);

    let report = mergeImports([], uddf.dives);
    report = mergeImports(report.dives, ssrf.dives);
    report = mergeImports(report.dives, fit.dives);

    expect(report.dives).toHaveLength(1);
  });

  it('non sovrascrive le note scritte a mano con un reimport', async () => {
    const synth = synthesise();
    const { dives } = await parseFile({ fileName: 'a.xml', text: toShearwaterXml(synth) });
    const stored = { ...dives[0], notes: 'Annotazione mia', buddy: 'Marco' };
    const report = mergeImports([stored], dives);
    expect(report.dives[0].notes).toBe('Annotazione mia');
    expect(report.dives[0].buddy).toBe('Marco');
  });

  it('preferisce il profilo più fitto', async () => {
    const dense = synthesise({ intervalS: 2 });
    const sparse = synthesise({ intervalS: 30 });
    const a = await parseFile({ fileName: 'sparse.uddf', text: toUddf(sparse) });
    const b = await parseFile({ fileName: 'dense.uddf', text: toUddf(dense) });

    const report = mergeImports(a.dives, b.dives);
    expect(report.dives).toHaveLength(1);
    expect(report.dives[0].samples!.length).toBe(b.dives[0].samples!.length);
  });

  it('mantiene distinte due immersioni della stessa giornata', async () => {
    const morning = synthesise({ startTime: new Date('2026-06-14T09:00:00Z'), maxDepth: 34 });
    const afternoon = synthesise({
      startTime: new Date('2026-06-14T14:00:00Z'),
      maxDepth: 20,
      durationS: 35 * 60,
    });
    const a = await parseFile({ fileName: 'm.uddf', text: toUddf(morning, 1) });
    const b = await parseFile({ fileName: 'p.uddf', text: toUddf(afternoon, 2) });
    const report = mergeImports(a.dives, b.dives);
    expect(report.dives).toHaveLength(2);
  });
});

describe('scelta del profilo fra due computer', () => {
  const base = (samples: Dive['samples']): Dive => ({
    id: 'x',
    startTime: '2026-06-14T10:38:00+02:00',
    durationS: 2400,
    maxDepth: 32,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 } }],
    source: { format: 'logtrak', file: 'a.logtrak', importedAt: '2026-06-14T20:00:00Z' },
    tags: [],
    samples,
  });

  /** Profilo fitto ma senza niente sulla decompressione: è l'Uwatec. */
  const dense = Array.from({ length: 600 }, (_, i) => ({ t: i * 4, depth: 20, tempC: 18 }));
  /** Profilo più rado ma con tetto, TTS e CNS: è lo Shearwater. */
  const rich = Array.from({ length: 240 }, (_, i) => ({
    t: i * 10,
    depth: 20,
    tempC: 18,
    ndlS: 600,
    ttsS: 120,
    cns: 4,
  }));

  it('conta i canali, non solo i campioni', () => {
    expect(profileChannels(base(dense))).toBe(2);
    expect(profileChannels(base(rich))).toBeGreaterThan(profileChannels(base(dense)));
  });

  it('tiene il profilo con i dati di decompressione anche se ha meno campioni', () => {
    const merged = mergeDive(base(dense), {
      ...base(rich),
      source: { format: 'shearwater-cloud', file: 'b.db', importedAt: 'x' },
    });
    expect(merged.samples).toHaveLength(240);
    expect(merged.samples?.[0].ttsS).toBe(120);
  });

  it('e non lo perde quando le fonti arrivano nell’ordine opposto', () => {
    const merged = mergeDive(base(rich), {
      ...base(dense),
      source: { format: 'logtrak', file: 'c.logtrak', importedAt: 'x' },
    });
    expect(merged.samples).toHaveLength(240);
  });

  it('a pari canali tiene il profilo più fitto', () => {
    const denser = Array.from({ length: 1200 }, (_, i) => ({ t: i * 2, depth: 20, tempC: 18 }));
    const merged = mergeDive(base(dense), {
      ...base(denser),
      source: { format: 'uddf', file: 'd.uddf', importedAt: 'x' },
    });
    expect(merged.samples).toHaveLength(1200);
  });
});
