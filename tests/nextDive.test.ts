/**
 * Il riepilogo che guarda avanti.
 *
 * Due cose vanno provate qui, e nessuna delle due è il contenuto delle frasi: che
 * l'ordine sia quello dell'urgenza — perché una nota critica sotto tre note
 * informative è una nota che nessuno legge — e che il tempo entri davvero nel
 * calcolo, cioè che `now` cambi il risultato. Il resto sono parole.
 */

import { describe, expect, it } from 'vitest';
import type { Dive } from '../src/core/model';
import type { GearItem } from '../src/core/analysis/gear';
import { nextDiveBriefing } from '../src/core/analysis/nextDive';
import { computeMetrics } from '../src/core/analysis/metrics';
import { chainArchive } from '../src/core/analysis/tissues';

const NOW = Date.parse('2026-08-17T18:00:00Z');

function profile(depthM: number, bottomMin: number) {
  const out = [];
  let t = 0;
  for (; t <= 120; t += 10) out.push({ t, depth: (t / 120) * depthM });
  for (; t <= 120 + bottomMin * 60; t += 10) out.push({ t, depth: depthM });
  for (let k = 10; k <= 200; k += 10) out.push({ t: t + k, depth: Math.max(0, depthM * (1 - k / 200)) });
  return out;
}

function dive(startTime: string, depthM = 30, bottomMin = 30): Dive {
  const samples = profile(depthM, bottomMin);
  const base: Dive = {
    id: `d${startTime}`,
    startTime,
    durationS: samples[samples.length - 1].t,
    maxDepth: depthM,
    cylinders: [{ mix: { o2: 0.21, he: 0 } }],
    source: { format: 'uddf', file: 't', importedAt: startTime },
    mode: 'oc',
    tags: [],
    samples,
  };
  return { ...base, metrics: computeMetrics(base) };
}

const gearItem = (over: Partial<GearItem> = {}): GearItem => ({
  id: 'g1',
  kind: 'cylinder',
  name: 'D12',
  ...over,
});

describe('ordine delle note', () => {
  it('lo scaduto viene prima di tutto', () => {
    const b = nextDiveBriefing(
      [dive('2026-08-01T09:00:00Z')],
      [
        gearItem({ id: 'g1', name: 'Erogatore', expiresOn: '2026-06-01' }),
        gearItem({ id: 'g2', name: 'Assicurazione', expiresOn: '2026-09-30' }),
      ],
      { headline: 'Assetto da migliorare', area: 'buoyancy' },
      NOW,
    );
    expect(b.notes[0].id).toBe('gear-expired');
    expect(b.notes[0].level).toBe('critical');
    // La nota "in scadenza" c'è, ma dopo.
    expect(b.notes.map((n) => n.id)).toContain('gear-due');
    expect(b.notes.findIndex((n) => n.id === 'gear-due')).toBeGreaterThan(0);
  });

  it('senza niente di urgente dice che non c’è niente, invece di tacere', () => {
    const b = nextDiveBriefing([dive('2026-08-10T09:00:00Z')], [gearItem({ expiresOn: '2030-01-01' })], undefined, NOW);
    expect(b.notes.some((n) => n.id === 'clear')).toBe(true);
    expect(b.notes.every((n) => n.level !== 'critical')).toBe(true);
  });

  it('un archivio vuoto manda all’import', () => {
    const b = nextDiveBriefing([], [], undefined, NOW);
    expect(b.notes[0].id).toBe('no-dives');
    expect(b.notes[0].goTo).toBe('import');
  });
});

describe('il tempo entra nel calcolo', () => {
  it('il carico residuo cala col passare delle ore', async () => {
    const d = dive('2026-08-17T09:00:00Z', 35, 35);
    const { dives } = await chainArchive([d], async () => d.samples ?? []);
    const dopoUnOra = nextDiveBriefing(dives, [], undefined, Date.parse('2026-08-17T11:00:00Z'));
    const dopoOtto = nextDiveBriefing(dives, [], undefined, Date.parse('2026-08-17T18:00:00Z'));
    expect(dopoUnOra.residualN2Bar!).toBeGreaterThan(dopoOtto.residualN2Bar!);
  });

  it('dopo ventiquattro ore non c’è più residuo da dichiarare', async () => {
    const d = dive('2026-08-15T09:00:00Z', 35, 35);
    const { dives } = await chainArchive([d], async () => d.samples ?? []);
    const b = nextDiveBriefing(dives, [], undefined, NOW);
    expect(b.residualN2Bar).toBeUndefined();
    expect(b.notes.some((n) => n.id === 'residual')).toBe(false);
  });

  it('una pausa lunga produce l’avviso, una corta no', () => {
    const vecchia = nextDiveBriefing([dive('2025-06-01T09:00:00Z')], [], undefined, NOW);
    const recente = nextDiveBriefing([dive('2026-08-10T09:00:00Z')], [], undefined, NOW);
    expect(vecchia.notes.some((n) => n.id === 'layoff')).toBe(true);
    expect(recente.notes.some((n) => n.id === 'layoff' || n.id === 'rusty')).toBe(false);
  });

  it('conta i giorni dalla FINE dell’immersione, non dall’inizio', () => {
    const b = nextDiveBriefing([dive('2026-08-16T09:00:00Z')], [], undefined, NOW);
    expect(b.daysSinceLast).toBe(1);
    expect(b.hoursSinceLast!).toBeGreaterThan(32);
    expect(b.hoursSinceLast!).toBeLessThan(33);
  });
});

describe('attrezzatura senza date', () => {
  it('un pezzo senza scadenza non passa per «a posto»', () => {
    const b = nextDiveBriefing([dive('2026-08-10T09:00:00Z')], [gearItem()], undefined, NOW);
    expect(b.notes.some((n) => n.id === 'gear-unknown')).toBe(true);
  });
});
