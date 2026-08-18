/**
 * Export UDDF.
 *
 * La verifica che conta è una sola: **esporta e reimporta**. Un file che il nostro
 * stesso parser rilegge ricostruendo gli stessi valori è un export corretto; un
 * file che "sembra giusto" a leggerlo non dimostra niente. Il giro completo prende
 * anche gli errori di unità, che sono l'insidia vera di UDDF — pascal, kelvin e
 * metri cubi al posto di bar, gradi e litri.
 */

import { describe, expect, it } from 'vitest';
import { exportUddf } from '../src/core/export/uddf';
import { parseFile } from '../src/core/parsers';
import { computeMetrics } from '../src/core/analysis/metrics';
import { AIR, type Dive, type Sample } from '../src/core/model';

function profile(depth: number, n: number): Sample[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 10,
    depth: Math.max(0, depth - Math.abs(n / 2 - i) * (depth / (n / 2))),
    tempC: 15 + (i % 4),
    pressureBar: [200 - i * 0.5],
  }));
}

function dive(over: Partial<Dive> = {}): Dive {
  const samples = over.samples ?? profile(30, 60);
  const base: Dive = {
    id: 'abc123',
    startTime: '2026-06-14T10:38:00.000Z',
    durationS: samples[samples.length - 1].t,
    maxDepth: Math.max(...samples.map((s) => s.depth)),
    avgDepth: 18.4,
    minTempC: 14.5,
    airTempC: 27,
    mode: 'oc',
    salinity: 'salt',
    site: { name: 'Punta Chiappa', lat: 44.3167, lon: 9.15 },
    notes: 'Corrente da nord & visibilità <5 m',
    cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 70 }],
    source: { format: 'uddf', file: 'x', importedAt: '2026-06-14T20:00:00Z' },
    tags: [],
    samples,
    ...over,
  };
  return { ...base, metrics: computeMetrics(base) };
}

async function roundTrip(dives: Dive[]): Promise<Dive[]> {
  const { xml } = exportUddf(dives, { now: '2026-08-17T12:00:00Z' });
  const result = await parseFile({ fileName: 'export.uddf', text: xml });
  return result.dives;
}

describe('export UDDF', () => {
  it('produce un file che il nostro parser rilegge', async () => {
    const back = await roundTrip([dive()]);
    expect(back).toHaveLength(1);
    const d = back[0];
    expect(d.maxDepth).toBeCloseTo(30, 1);
    expect(d.durationS).toBe(590);
    expect(d.startTime.slice(0, 16)).toBe('2026-06-14T10:38');
  });

  it('le unità sopravvivono al giro: bar, gradi, litri', async () => {
    const [d] = await roundTrip([dive()]);
    // Pascal → bar.
    expect(d.cylinders[0].startBar).toBeCloseTo(200, 0);
    expect(d.cylinders[0].endBar).toBeCloseTo(70, 0);
    // Metri cubi → litri.
    expect(d.cylinders[0].sizeL).toBeCloseTo(12, 1);
    // Kelvin → Celsius.
    expect(d.minTempC).toBeCloseTo(14.5, 1);
    expect(d.airTempC).toBeCloseTo(27, 1);
    expect(d.avgDepth).toBeCloseTo(18.4, 1);
  });

  it('il profilo torna campione per campione', async () => {
    const original = dive();
    const [d] = await roundTrip([original]);
    expect(d.samples?.length).toBe(original.samples!.length);
    const first = d.samples![10];
    expect(first.t).toBe(original.samples![10].t);
    expect(first.depth).toBeCloseTo(original.samples![10].depth, 1);
    expect(first.tempC).toBeCloseTo(original.samples![10].tempC!, 1);
    expect(first.pressureBar?.[0]).toBeCloseTo(original.samples![10].pressureBar![0]!, 0);
  });

  it('sito, coordinate e note sopravvivono, compresi i caratteri da sfuggire', async () => {
    const [d] = await roundTrip([dive()]);
    expect(d.site?.name).toBe('Punta Chiappa');
    expect(d.site?.lat).toBeCloseTo(44.3167, 3);
    expect(d.site?.lon).toBeCloseTo(9.15, 3);
    // La nota contiene & e <: se l'escape mancasse, il file non sarebbe nemmeno XML.
    expect(d.notes).toBe('Corrente da nord & visibilità <5 m');
  });

  it('le miscele diventano definizioni condivise, una per gas', async () => {
    const nitrox = dive({
      id: 'n1',
      startTime: '2026-06-15T10:00:00.000Z',
      cylinders: [{ mix: { o2: 0.32, he: 0 }, sizeL: 15, startBar: 220, endBar: 80 }],
    });
    const { xml } = exportUddf([
      dive(),
      nitrox,
      dive({ id: 'terzo', startTime: '2026-06-16T10:00:00.000Z' }),
    ]);
    // Tre immersioni, due gas distinti: le definizioni non si duplicano.
    expect(xml.match(/<mix id=/g)).toHaveLength(2);
    const back = await parseFile({ fileName: 'e.uddf', text: xml });
    const mixes = back.dives.map((d) => d.cylinders[0]?.mix.o2).sort();
    expect(mixes).toEqual([0.21, 0.21, 0.32]);
  });

  it('senza profili il file è molto più piccolo, e lo dichiara', async () => {
    const withProfiles = exportUddf([dive()]);
    const without = exportUddf([dive()], { includeProfiles: false });
    expect(without.xml.length).toBeLessThan(withProfiles.xml.length / 3);
    expect(without.omitted.join(' ')).toMatch(/profili campionati/);
    expect(without.xml).not.toContain('<waypoint>');
  });

  it('dichiara cosa non è entrato nel file', async () => {
    const shearwater = dive({
      computer: { model: 'Peregrine', serial: 'X', gfLow: 20, gfHigh: 85 },
      samples: profile(30, 30).map((s) => ({ ...s, ceiling: 3, ndlS: 600 })),
    });
    const result = exportUddf([shearwater]);
    const omitted = result.omitted.join(' ');
    expect(omitted).toMatch(/gradient factor/);
    expect(omitted).toMatch(/tetto di decompressione/);
  });

  it('un archivio vuoto produce un file valido, non un errore', async () => {
    const result = exportUddf([]);
    expect(result.dives).toBe(0);
    const back = await parseFile({ fileName: 'vuoto.uddf', text: result.xml });
    expect(back.dives).toHaveLength(0);
  });

  it('l’ordine è cronologico, indipendente da come arrivano', async () => {
    const a = dive({ id: 'a', startTime: '2026-06-16T10:00:00.000Z' });
    const b = dive({ id: 'b', startTime: '2026-06-14T10:00:00.000Z' });
    const { xml } = exportUddf([a, b]);
    expect(xml.indexOf('dive-b')).toBeLessThan(xml.indexOf('dive-a'));
  });
});
