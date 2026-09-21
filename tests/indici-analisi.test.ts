/**
 * Gli accessi per indice di `core/analysis` che potevano uscire dai limiti.
 *
 * Accendendo `noUncheckedIndexedAccess`, ogni `a[i]` del modulo è passato da
 * una domanda: sta dentro per costruzione, o esiste un ingresso che lo porta
 * fuori? Quasi sempre la prima. Queste prove sono per i casi in cui la
 * risposta era la seconda, e ognuna è stata vista fallire sul codice di prima:
 * una garanzia che non si è vista rompere è un'ipotesi.
 */

import { describe, expect, it } from 'vitest';
import { bestGasAt, DEFAULT_DECO, planDeco, type PlanGas } from '../src/core/analysis/deco';
import { mutaPerTemperatura, stagioneTesto } from '../src/core/analysis/gearStats';
import type { Dive } from '../src/core/model';

const ARIA: PlanGas = { mix: { o2: 0.21, he: 0 }, role: 'bottom', tankL: 12, startBar: 200 };
const EAN50: PlanGas = { mix: { o2: 0.5, he: 0 }, role: 'deco', tankL: 7, startBar: 200 };

describe('planDeco: un livello che punta a un gas che non c’è', () => {
  /*
   * `PlanLevel.gasIndex` è un indice in `gases`, e niente controllava che lo
   * fosse: `advance` leggeva `gases[5]`, trovava `undefined`, e il piano cadeva
   * con un `TypeError`. Adesso vale la regola che il tipo dichiara per il campo
   * assente — «si sceglie il gas migliore utilizzabile» — la stessa che
   * `decoContingencies` applica al livello rimasto senza il suo gas.
   */
  const automatico = planDeco([{ depthM: 40, minutes: 25 }], [ARIA, EAN50]);
  for (const gasIndex of [5, 2, -1, 1.5, Number.NaN]) {
    it(`gasIndex ${gasIndex}: il piano esce, uguale a quello con la scelta automatica`, () => {
      const piano = planDeco([{ depthM: 40, minutes: 25, gasIndex }], [ARIA, EAN50]);
      expect(piano).toEqual(automatico);
    });
  }

  it('un indice valido resta la scelta di chi pianifica, anche lo zero', () => {
    // Il filtro guarda il gas, non la verità dell'indice: `0` è falso, `gases[0]`
    // no. A 20 metri la scelta automatica è l'EAN50; chi dichiara l'aria la tiene.
    const livelloSu = (gasIndex?: number) =>
      planDeco([{ depthM: 20, minutes: 30, gasIndex }], [ARIA, EAN50]).segments.filter(
        (s) => s.kind === 'level',
      );
    expect(livelloSu(undefined).map((s) => s.gasIndex)).toEqual([1]);
    expect(livelloSu(0).map((s) => s.gasIndex)).toEqual([0]);
  });
});

describe('bestGasAt senza nessun gas', () => {
  it('restituisce -1, come `findIndex`, e non `undefined`', () => {
    expect(bestGasAt(10, [], DEFAULT_DECO)).toBe(-1);
  });
});

describe('stagioneTesto: un mese che non esiste non diventa «undefined»', () => {
  /*
   * Quando `Date.parse` non legge la data, `meseLocale` ripiega sulle sue
   * cifre: da «2026-13-01» esce 13, e `MESI[12]` non c'è. La stagione usciva
   * `undefined` — da una funzione che promette una stringa — oppure
   * «undefined–mag», scritto nella tabella delle mute.
   */
  it('da solo: nessuna stagione, detta con il trattino', () => {
    expect(stagioneTesto([13])).toBe('—');
    expect(stagioneTesto([0])).toBe('—');
    expect(stagioneTesto([Number.NaN])).toBe('—');
  });

  it('accanto a un mese vero: conta solo quello', () => {
    expect(stagioneTesto([5, 13])).toBe('mag');
  });

  it('dalla tabella delle mute, con una data illeggibile in archivio', () => {
    let n = 0;
    const muta = (startTime: string): Dive => {
      const d: Partial<Dive> = {
        id: `m${n++}`,
        startTime,
        durationS: 2400,
        maxDepth: 20,
        suit: 'Umida 5 mm',
        cylinders: [{ mix: { o2: 0.21, he: 0 } }],
        tags: [],
      };
      return d as Dive;
    };
    const righe = mutaPerTemperatura([
      muta('2026-05-10T10:00:00.000Z'),
      muta('2026-05-17T10:00:00.000Z'),
      muta('2026-13-01T10:00:00.000Z'),
    ]);
    expect(righe.map((r) => r.stagione)).toEqual(['mag']);
  });
});
