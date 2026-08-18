/**
 * Finestra temporale di statistiche e piano.
 *
 * La proprietà che conta: la finestra parte da ADESSO e non si allunga da sé per
 * trovare dei dati. Un periodo che si estende finché non si riempie non è una
 * finestra temporale, è un numero di immersioni con l'etichetta sbagliata — e
 * porterebbe a leggere come "ultimi 12 mesi" una media calcolata su tre anni.
 */

import { describe, expect, it } from 'vitest';
import { applyPeriod, DEFAULT_PERIOD, PERIODS, periodOf } from '../src/core/analysis/window';
import type { Dive } from '../src/core/model';

const dive = (startTime: string): Dive => ({
  id: startTime,
  startTime,
  durationS: 2400,
  maxDepth: 30,
  mode: 'oc',
  cylinders: [{ mix: { o2: 0.21, he: 0 } }],
  source: { format: 'logtrak', file: 'a', importedAt: 'x' },
  tags: [],
});

const NOW = Date.parse('2026-08-17T12:00:00Z');
const archive = [
  dive('2020-06-14T10:00:00Z'),
  dive('2023-07-01T10:00:00Z'),
  dive('2025-06-30T10:00:00Z'), // 13 mesi e mezzo prima: fuori dai 12 mesi
  dive('2025-10-18T10:00:00Z'),
  dive('2026-03-08T10:00:00Z'),
  dive('2026-07-11T10:00:00Z'),
];

describe('finestra temporale', () => {
  it('la predefinita è dodici mesi', () => {
    expect(DEFAULT_PERIOD).toBe('12m');
    expect(periodOf(DEFAULT_PERIOD).months).toBe(12);
  });

  it('tiene solo le immersioni dentro la finestra', () => {
    const scope = applyPeriod(archive, '12m', NOW);
    expect(scope.dives.map((d) => d.startTime.slice(0, 7))).toEqual(['2025-10', '2026-03', '2026-07']);
    expect(scope.excluded).toBe(3);
  });

  it('finestre diverse, insiemi diversi', () => {
    expect(applyPeriod(archive, '6m', NOW).dives).toHaveLength(2);
    expect(applyPeriod(archive, '24m', NOW).dives).toHaveLength(4);
    expect(applyPeriod(archive, 'all', NOW).dives).toHaveLength(6);
    expect(applyPeriod(archive, 'all', NOW).excluded).toBe(0);
  });

  it('non si allunga per riempirsi quando non ci si immerge da mesi', () => {
    // Ultima immersione 14 mesi prima di "adesso": la finestra di 12 mesi resta
    // vuota, e deve dirlo invece di scivolare indietro fino a trovare dati.
    const stale = [dive('2025-06-01T10:00:00Z'), dive('2025-06-02T10:00:00Z')];
    const scope = applyPeriod(stale, '12m', NOW);
    expect(scope.dives).toHaveLength(0);
    expect(scope.excluded).toBe(2);
  });

  it('riporta gli estremi effettivi del periodo, non quelli richiesti', () => {
    const scope = applyPeriod(archive, '24m', NOW);
    expect(scope.from?.slice(0, 10)).toBe('2025-06-30');
    expect(scope.to?.slice(0, 10)).toBe('2026-07-11');
  });

  it('ordina le immersioni dalla più vecchia, come si aspettano le tendenze', () => {
    const shuffled = [archive[5], archive[0], archive[3]];
    const scope = applyPeriod(shuffled, 'all', NOW);
    expect(scope.dives.map((d) => d.startTime)).toEqual([
      archive[0].startTime,
      archive[3].startTime,
      archive[5].startTime,
    ]);
  });

  it('ogni periodo ha un’etichetta e una spiegazione', () => {
    for (const p of PERIODS) {
      expect(p.label.length).toBeGreaterThan(3);
      expect(p.description.length).toBeGreaterThan(20);
    }
  });
});
