/**
 * IL NUMERO CHE DECIDE DEV'ESSERE IL NUMERO CHE SI MOSTRA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Quattro difetti trovati il 15 settembre 2026, tutti della stessa famiglia:
 * una grandezza calcolata in un modo e mostrata in un altro, oppure un valore
 * impossibile che passa un controllo perché il controllo guardava la cosa
 * sbagliata.
 */

import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/core/analysis/metrics';
import { planGas } from '../src/core/analysis/gasPlan';
import { mod } from '../src/core/units';
import type { Dive, Sample } from '../src/core/model';

/** Un'immersione che risale a velocità costante `mpm` dai 30 metri. */
function risalitaA(mpm: number): Dive {
  const samples: Sample[] = [{ t: 0, depth: 0 }];
  for (let t = 20; t <= 200; t += 20) samples.push({ t, depth: (30 * t) / 200 });
  for (let t = 220; t <= 1400; t += 20) samples.push({ t, depth: 30 });
  let d = 30;
  for (let t = 1420; d > 0; t += 20) {
    d = Math.max(0, d - (mpm * 20) / 60);
    samples.push({ t, depth: Math.round(d * 1000) / 1000 });
  }
  return {
    id: 'x',
    startTime: '2026-06-14T10:00:00Z',
    durationS: samples[samples.length - 1]!.t,
    maxDepth: 30,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: 12, startBar: 200, endBar: 70 }],
    source: { format: 'manual', file: '', importedAt: '2026-06-14T20:00:00Z' },
    tags: [],
    samples,
  };
}

describe('la velocità di risalita si giudica sul numero stampato', () => {
  /*
   * ► LA CONTRADDIZIONE, MISURATA. ◄
   *
   *   vera 9.96  → mostrata «10 m/min», nessuna osservazione
   *   vera 10.04 → mostrata «10 m/min», «Risalita oltre il limite, picco 10»
   *
   * Lo stesso numero a schermo, due giudizi opposti, e nessun modo di capirlo
   * leggendo la scheda. Il progetto aveva già chiuso lo stesso caso per la
   * risalita finale; qui la correzione non era arrivata.
   */
  it('una risalita che si mostra come «10» non viene accusata di superare 10', () => {
    const m = computeMetrics(risalitaA(10.04));
    expect(m.maxAscentRateMpm).toBe(10);
    expect(m.fastAscentS, 'mostrata 10, limite 10: non c’è niente da accusare').toBe(0);
  });

  it('e una che si mostra come «10.4» viene accusata', () => {
    // La soglia continua a mordere: la correzione non è «non accusare mai».
    const m = computeMetrics(risalitaA(10.4));
    expect(m.maxAscentRateMpm).toBeGreaterThan(10);
    expect(m.fastAscentS).toBeGreaterThan(0);
  });

  it('una risalita regolare resta regolare', () => {
    const m = computeMetrics(risalitaA(8));
    expect(m.fastAscentS).toBe(0);
  });
});

describe('il pianificatore ricreativo non dichiara eseguibile un piano di NaN', () => {
  const base = {
    depthM: 30,
    stopDepthM: 5,
    avgDepthM: 15,
    bottomMin: 25,
    stopMin: 3,
    extraStopMin: 0,
    totalMin: 30,
    tankL: 12,
    startBar: 200,
    rmvLpm: 20,
    stressRmvLpm: 30,
    divers: 2,
    ascentRateMpm: 9,
    problemMin: 1,
    maxPpo2: 1.4,
    reserveBarFixed: 50,
    mix: { o2: 0.21, he: 0 },
    salinity: 'salt' as const,
    reserveRule: 'rockBottom' as const,
    turnRule: 'thirds' as const,
    maxTimeMin: 60,
    buddyRmvLpm: 0,
    decoTankL: 0,
    decoStartBar: 0,
    decoRmvLpm: 0,
  };

  const numeriFiniti = (p: unknown) =>
    Object.entries(p as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'number' && !Number.isFinite(v))
      .map(([k]) => k);

  it('nessun campo del piano è NaN o infinito, qualunque cosa arrivi', () => {
    /*
     * `Math.max(1, NaN)` vale `NaN`, e tutti i limiti di questo modulo erano
     * `Math.max`/`Math.min`. Il pericolo non è il NaN stampato — quello si vede
     * — è che **ogni confronto di sicurezza con un NaN è falso**: con
     * `depthM = NaN` il piano usciva con zero avvisi, cioè dichiarato
     * eseguibile. `sane`/`sanePositive` esistevano in `deco.ts` da mesi.
     */
    for (const campo of [
      'depthM',
      'bottomMin',
      'totalMin',
      'tankL',
      'startBar',
      'rmvLpm',
      'stressRmvLpm',
      'divers',
      'ascentRateMpm',
      'maxPpo2',
      'altitudeM',
    ]) {
      for (const valore of [NaN, Infinity, -Infinity]) {
        const p = planGas({ ...base, [campo]: valore });
        expect(numeriFiniti(p), `${campo} = ${valore}`).toEqual([]);
      }
    }
  });

  it('un gas allo 0% di ossigeno non ha una profondità massima infinita', () => {
    /*
     * `maxPpo2 / 0` vale `Infinity`, e il confronto «profondità oltre la MOD»
     * con un infinito è sempre falso: l'avviso non compariva mai, su un gas che
     * non si respira nemmeno in superficie.
     */
    expect(mod({ o2: 0, he: 0 })).toBe(0);
    expect(Number.isFinite(planGas({ ...base, mix: { o2: 0, he: 0 } }).modM)).toBe(true);
    // E una miscela vera continua a dare la sua MOD.
    expect(mod({ o2: 0.32, he: 0 }, 1.4)).toBeGreaterThan(30);
  });
});
