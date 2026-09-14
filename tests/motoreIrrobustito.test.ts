/**
 * QUATTRO NUMERI DEL MOTORE CHE USCIVANO SBAGLIATI SENZA DIRLO.
 *
 * Sono tutti della stessa famiglia: **un valore che non si può calcolare
 * diventa zero**, oppure **un rapporto fra due grandezze che coprono tratti
 * diversi**. Nessuno dei quattro produceva un errore: producevano un numero.
 */

import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/core/analysis/metrics';
import { analyseProfile } from '../src/core/analysis/tissues';
import { step, surfacedTissues } from '../src/core/analysis/buhlmann';
import { bestMix } from '../src/core/units';
import { AIR, type Dive, type Sample } from '../src/core/model';

const scheda = (samples: Sample[], over: Partial<Dive> = {}): Dive => ({
  id: 'x',
  startTime: '2026-06-14T10:00:00.000Z',
  durationS: samples[samples.length - 1].t,
  maxDepth: Math.max(...samples.map((s) => s.depth)),
  mode: 'oc',
  salinity: 'salt',
  cylinders: [{ mix: AIR }],
  source: { format: 'uddf', file: 'x', importedAt: '2026-06-14T12:00:00.000Z' },
  tags: [],
  samples,
  ...over,
});

describe('la velocità di discesa', () => {
  /** Discesa lineare a `mpm`, poi fondo, poi risalita: la velocità è nota. */
  const profilo = (mpm: number): Sample[] => {
    const fondo = 40;
    const tDiscesa = Math.round((fondo / mpm) * 60);
    const s: Sample[] = [];
    for (let t = 0; t <= tDiscesa; t += 2) s.push({ t, depth: (mpm * t) / 60 });
    for (let t = tDiscesa + 2; t <= tDiscesa + 1200; t += 2) s.push({ t, depth: fondo });
    for (let t = tDiscesa + 1202; t <= tDiscesa + 1202 + 600; t += 2) {
      s.push({ t, depth: Math.max(0, fondo - (fondo * (t - tDiscesa - 1200)) / 600) });
    }
    return s;
  };

  it.each([6, 12, 18, 30])('a %i m/min dichiara %i m/min, non un terzo in più', (mpm) => {
    /*
     * ► IL RAPPORTO ERA ESATTAMENTE 1/0.75. ◄ Numeratore la profondità massima
     * (il 100%), denominatore il tempo per arrivare al 75%: 18 m/min veri
     * uscivano **24**. Con il limite a 20 m/min, ogni discesa sopra i 15 reali
     * sarebbe stata chiamata caduta.
     */
    const m = computeMetrics(scheda(profilo(mpm)));
    expect(m.descentRateMpm).toBeGreaterThan(mpm * 0.9);
    expect(m.descentRateMpm).toBeLessThan(mpm * 1.12);
  });

  it('e resta confrontabile con quella di risalita, che era già giusta', () => {
    /*
     * Stessa velocità in discesa e in risalita: i due numeri devono somigliarsi.
     * Prima no — uno era un terzo più alto dell'altro — e nessuno se ne
     * accorgeva, perché non li mostra mai nessuno accanto.
     */
    const s: Sample[] = [];
    const mpm = 18;
    const tDiscesa = Math.round((60 / mpm) * 60);
    for (let t = 0; t <= tDiscesa; t += 2) s.push({ t, depth: (mpm * t) / 60 });
    for (let t = tDiscesa + 2; t <= tDiscesa + 1200; t += 2) s.push({ t, depth: 60 });
    for (let t = tDiscesa + 1202; t <= tDiscesa + 1202 + tDiscesa; t += 2) {
      s.push({ t, depth: Math.max(0, 60 - (mpm * (t - tDiscesa - 1200)) / 60) });
    }
    const m = computeMetrics(scheda(s));
    expect(Math.abs((m.descentRateMpm ?? 0) - (m.ascentRateMpm ?? 0))).toBeLessThan(4);
  });
});

describe('una miscela impossibile', () => {
  const profondo = (): Sample[] => {
    const s: Sample[] = [];
    for (let t = 0; t <= 180; t += 10) s.push({ t, depth: (40 * t) / 180 });
    for (let t = 190; t <= 1800; t += 10) s.push({ t, depth: 40 });
    for (let t = 1810; t <= 2100; t += 10) s.push({ t, depth: Math.max(0, 40 - (40 * (t - 1800)) / 300) });
    return s;
  };

  it.each([
    ['la percentuale al posto della frazione', { o2: 21, he: 0 }],
    ['un numero che non è un numero', { o2: Number.NaN, he: 0 }],
    ['una somma sopra uno', { o2: 0.8, he: 0.5 }],
    ['una frazione negativa', { o2: -0.2, he: 0 }],
  ])('non fa uscire GF99 zero e tetto zero (%s)', (_come, mix) => {
    /*
     * ► LO ZERO ERA LA RISPOSTA PIÙ RASSICURANTE POSSIBILE. ◄ Con la frazione
     * inerte a zero i tessuti non caricano; con NaN ogni confronto è falso e il
     * massimo non si aggiorna mai. In tutti e due i casi l'immersione usciva
     * con **GF99 0, tetto 0 e zero minuti di obbligo** — la più tranquilla
     * dell'archivio. Adesso la miscela impossibile diventa aria, che sbaglia
     * dalla parte prudente.
     */
    const samples = profondo();
    const d = scheda(samples, { cylinders: [{ mix }] });
    const esito = analyseProfile(d, samples, surfacedTissues());
    expect(esito.gf99End, 'i tessuti non hanno caricato').toBeGreaterThan(50);
    expect(esito.maxCeilingM).toBeGreaterThan(0);
  });

  it('e una miscela vera continua a comportarsi da miscela vera', () => {
    const samples = profondo();
    const aria = analyseProfile(scheda(samples), samples, surfacedTissues());
    const ean32 = analyseProfile(
      scheda(samples, { cylinders: [{ mix: { o2: 0.32, he: 0 } }] }),
      samples,
      surfacedTissues(),
    );
    // Meno azoto, meno carico: se la guardia avesse sostituito anche questa con
    // aria, i due numeri sarebbero identici.
    expect(ean32.gf99End).toBeLessThan(aria.gf99End);
  });

  it('e il passo singolo non produce più NaN nei tessuti', () => {
    const dopo = step(surfacedTissues(), 5, { o2: Number.NaN, he: 0 }, 10);
    expect(dopo.n2.every((v) => Number.isFinite(v))).toBe(true);
    expect(dopo.n2[0]).toBeGreaterThan(surfacedTissues().n2[0]);
  });
});

describe('una pressione di superficie impossibile', () => {
  it('non fa partire i tessuti da un azoto negativo', () => {
    /*
     * `?? 1.01325` non intercetta lo zero, e chi legge l'archivio usa `??`. Con
     * zero l'azoto d'equilibrio è **−0.0495 bar**: tessuti più vuoti del vuoto,
     * e su un 40 m × 30 min il GF99 saliva da 177.8 a 272.9.
     */
    expect(surfacedTissues(0).n2[0]).toBeGreaterThan(0.7);
    expect(surfacedTissues(Number.NaN).n2[0]).toBeGreaterThan(0.7);
    // E una quota vera resta una quota vera: 2000 m sono 0.795 bar.
    expect(surfacedTissues(0.795).n2[0]).toBeLessThan(surfacedTissues(1.01325).n2[0]);
  });
});

describe('la miscela migliore per una profondità', () => {
  it('non supera l’ossigeno puro', () => {
    // A tre metri `1.4 / 1.32` dà 1.06, e il pianificatore stampava «EAN106».
    expect(bestMix(3, 1.4)).toBeLessThanOrEqual(1);
    expect(bestMix(3, 1.4, 'fresh')).toBeLessThanOrEqual(1);
    expect(bestMix(0, 1.6)).toBeLessThanOrEqual(1);
    // E a profondità vere il numero non cambia.
    // Arrotondata per difetto: 1.4 / 4.03 bar = 0.347 → EAN34, mai EAN35.
    expect(bestMix(30, 1.4)).toBeCloseTo(0.34, 2);
  });
});
