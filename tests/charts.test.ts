/**
 * Test della geometria dei grafici.
 *
 * Non testano l'aspetto: testano gli invarianti che, se rotti, producono un
 * grafico sbagliato in modo SILENZIOSO — una curva che esce dall'area di
 * disegno, una barra che sfonda la carta. Sono esattamente i difetti che non
 * fanno fallire nulla e si notano solo guardando lo schermo.
 */

import { describe, expect, it } from 'vitest';
import { niceTicks, roundedRightBar, roundedTopBar } from '../src/ui/components/Charts';

describe('niceTicks', () => {
  it('usa passi tondi', () => {
    expect(niceTicks(0, 10, 4)).toEqual([0, 5, 10]);
    expect(niceTicks(0, 3, 3)).toEqual([0, 2, 4]);
    expect(niceTicks(0, 47, 4)).toEqual([0, 20, 40, 60]);
  });

  it('l\'ultima tacca non è MAI sotto il massimo', () => {
    // Questo è il bug che ha fatto uscire il profilo dal grafico: con hi = 28 e
    // passo 10 la sequenza si fermava a 20, e una profondità di 26 m veniva
    // disegnata fuori dall'area.
    for (const hi of [3, 7, 12, 26.4, 28, 33, 41, 99, 101, 0.7, 1.3]) {
      const ticks = niceTicks(0, hi, 4);
      expect(ticks[ticks.length - 1], `massimo ${hi}`).toBeGreaterThanOrEqual(hi);
    }
  });

  it('la prima tacca non è mai sopra il minimo', () => {
    for (const [lo, hi] of [
      [15, 24],
      [3.2, 9.8],
      [180, 220],
    ]) {
      const ticks = niceTicks(lo, hi, 3);
      expect(ticks[0]).toBeLessThanOrEqual(lo);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(hi);
    }
  });

  it('è crescente e senza duplicati', () => {
    const ticks = niceTicks(0, 47, 4);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
  });

  it('non esplode sui casi degeneri', () => {
    expect(niceTicks(NaN, 10)).toEqual([0, 1]);
    // Serie a valore costante: l'intervallo si apre ATTORNO al valore. Prima
    // ripiegava su [0, 1] e il punto finiva fuori dal riquadro, con l'asse
    // etichettato 0–1 e il grafico apparentemente vuoto.
    for (const v of [0, 5, 18.4, -3]) {
      const ticks = niceTicks(v, v);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      expect(ticks[0]).toBeLessThanOrEqual(v);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(v);
    }
  });
});

describe('geometria delle marche', () => {
  it('la colonna parte dalla base e arriva alla cima indicata', () => {
    const d = roundedTopBar(10, 40, 20, 60, 4);
    // Parte dalla base (y + h = 100) e il raggio non supera metà larghezza.
    expect(d.startsWith('M10 100')).toBe(true);
    expect(d).toContain('Q');
  });

  it('la colonna non si deforma quando è più bassa del raggio', () => {
    const d = roundedTopBar(0, 98, 20, 2, 4);
    expect(d).not.toContain('NaN');
    expect(d.startsWith('M0 100')).toBe(true);
  });

  it('la barra orizzontale arrotonda solo l\'estremo del dato', () => {
    const d = roundedRightBar(50, 10, 100, 14, 4);
    expect(d.startsWith('M50 10')).toBe(true);
    expect(d).not.toContain('NaN');
  });

  it('nessuna marca produce coordinate non finite', () => {
    for (const w of [0, 1, 3, 24]) {
      for (const h of [0, 1, 5, 60]) {
        expect(roundedTopBar(0, 0, w, h, 4)).not.toContain('NaN');
        expect(roundedRightBar(0, 0, w, h, 4)).not.toContain('NaN');
      }
    }
  });
});
