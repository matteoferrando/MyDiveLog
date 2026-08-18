import { describe, expect, it } from 'vitest';
import {
  ambientBar,
  bestMix,
  depthFromAbsoluteBar,
  ead,
  end,
  fahrenheitToC,
  feetToM,
  formatDuration,
  kelvinToC,
  mixName,
  mod,
  pascalToBar,
  ppn2At,
  psiToBar,
  shearwaterTankToBar,
  withFraction,
} from '../src/core/units';

describe('conversioni di unità', () => {
  it('converte piedi in metri', () => {
    expect(feetToM(100)).toBeCloseTo(30.48, 4);
  });

  it('converte Fahrenheit e Kelvin in Celsius', () => {
    expect(fahrenheitToC(32)).toBeCloseTo(0, 6);
    expect(fahrenheitToC(59)).toBeCloseTo(15, 6);
    expect(kelvinToC(293.15)).toBeCloseTo(20, 6);
  });

  it('converte Pascal e PSI in bar', () => {
    // 200 bar in UDDF si scrivono 2e7 Pa.
    expect(pascalToBar(20_000_000)).toBeCloseTo(200, 6);
    expect(psiToBar(3000)).toBeCloseTo(206.8, 1);
  });

  it('applica il fattore 2 alla pressione bombola Shearwater', () => {
    // Il campo è in mezzi PSI: 1450 → 2900 psi → ~200 bar.
    expect(shearwaterTankToBar(1450)).toBeCloseTo(199.9, 1);
    // Senza il fattore 2 verrebbe la metà: è l'errore che questo test blocca.
    expect(shearwaterTankToBar(1450)).toBeGreaterThan(150);
  });
});

describe('fisica', () => {
  it('dà circa 1 bar ogni 10 metri in acqua salata', () => {
    expect(ambientBar(0)).toBeCloseTo(1.01325, 4);
    expect(ambientBar(10)).toBeCloseTo(2.024, 2);
    expect(ambientBar(30)).toBeCloseTo(4.045, 2);
  });

  it('è invertibile', () => {
    for (const d of [0, 5, 18, 32.5, 60]) {
      expect(depthFromAbsoluteBar(ambientBar(d))).toBeCloseTo(d, 4);
    }
  });

  it('l\'acqua dolce pesa meno', () => {
    expect(ambientBar(30, 'fresh')).toBeLessThan(ambientBar(30, 'salt'));
  });

  it('calcola la MOD di un nitrox', () => {
    // EAN32 a PPO2 1.4 sta intorno ai 33-34 m.
    const m = mod({ o2: 0.32, he: 0 }, 1.4);
    expect(m).toBeGreaterThan(32);
    expect(m).toBeLessThan(35);
  });

  it('con la convenzione TDI il nitrox non riduce la narcosi, l’EAD sì', () => {
    const nitrox = { o2: 0.32, he: 0 };
    // «The easy rule of thumb is to not dive nitrox deeper than you would dive
    // with air» (TDI Advanced Nitrox p. 40): senza elio l'END è la profondità.
    expect(end(nitrox, 30)).toBeCloseTo(30, 1);
    // L'EAD è un'altra domanda — quanto azoto respiri — e resta più bassa.
    expect(ead(nitrox, 30)).toBeLessThan(26);
    // Con la convenzione "solo azoto narcotico" le due tornano a coincidere.
    expect(end(nitrox, 30, 'salt', { oxygenNarcotic: false })).toBeCloseTo(ead(nitrox, 30), 3);
  });

  it('l’EAD segue la formula del manuale', () => {
    // TDI Advanced Nitrox p. 52: EAN32 a 30 m → [(0.68 × 40) / 0.79] − 10 = 24.4 m.
    // Con la densità reale dell'acqua salata di `units.ts` il valore è vicino ma
    // non identico: il manuale usa 10 m = 1 bar.
    expect(ead({ o2: 0.32, he: 0 }, 30)).toBeCloseTo(24.4, 0);
  });

  it('la miscela migliore è troncata in giù, come nel manuale', () => {
    // TDI p. 49: 35 m → 1.4 / 4.5 = 31%. Il manuale usa 10 m = 1 bar, noi la
    // densità reale: il risultato cade sullo stesso punto percentuale.
    expect(Math.round(bestMix(35, 1.4) * 100)).toBe(30);
    // E la MOD della miscela proposta non è mai più bassa della profondità.
    for (const d of [12, 18, 24, 30, 35, 40]) {
      expect(mod({ o2: bestMix(d, 1.4), he: 0 }, 1.4)).toBeGreaterThanOrEqual(d - 0.01);
    }
  });

  it('la pressione parziale dell’azoto è quella su cui la didattica pone il limite', () => {
    // Aria a 40 m: 5.03 bar × 0.79 ≈ 3.97 ata di N2, appena sotto il 4.0 che TDI
    // indica come massimo in ambiente ostruito o in acqua fredda (p. 40).
    expect(ppn2At({ o2: 0.21, he: 0 }, 40)).toBeCloseTo(3.97, 1);
  });

  it('l\'elio riduce la profondità narcotica', () => {
    expect(end({ o2: 0.21, he: 0.35 }, 45)).toBeLessThan(45);
  });

  it('nomina le miscele', () => {
    expect(mixName({ o2: 0.21, he: 0 })).toBe('Aria');
    expect(mixName({ o2: 0.32, he: 0 })).toBe('EAN32');
    expect(mixName({ o2: 0.21, he: 0.35 })).toBe('Tx21/35');
    expect(mixName({ o2: 1, he: 0 })).toBe('Ossigeno');
  });
});

describe('formattazione', () => {
  it('formatta le durate', () => {
    expect(formatDuration(930)).toBe('15:30');
    expect(formatDuration(3720)).toBe('1:02:00');
    expect(formatDuration(59)).toBe('0:59');
  });
});

/**
 * Il vincolo sulla somma delle frazioni.
 *
 * Una miscela con ossigeno ed elio che sommano più di uno ha azoto negativo, e
 * il motore di decompressione la calcola senza protestare: pressione parziale
 * sotto zero, nessun obbligo, un piano che descrive un'immersione impossibile.
 * L'unico posto in cui il vincolo va imposto è dove il numero entra.
 */
describe('withFraction', () => {
  it('taglia il valore a quello che ci sta', () => {
    expect(withFraction({ o2: 0.4, he: 0 }, 'he', 0.9)).toEqual({ o2: 0.4, he: 0.6 });
    const tagliato = withFraction({ o2: 0, he: 0.7 }, 'o2', 0.5);
    expect(tagliato.o2).toBeCloseTo(0.3, 10);
    expect(tagliato.he).toBe(0.7);
  });

  it('lascia passare quello che sta dentro il 100%', () => {
    expect(withFraction({ o2: 0.21, he: 0 }, 'he', 0.35)).toEqual({ o2: 0.21, he: 0.35 });
    expect(withFraction({ o2: 0.21, he: 0.35 }, 'o2', 0.18)).toEqual({ o2: 0.18, he: 0.35 });
  });

  it('non produce frazioni negative', () => {
    expect(withFraction({ o2: 0.5, he: 0 }, 'he', -0.2)).toEqual({ o2: 0.5, he: 0 });
  });

  it('la somma non supera mai uno, comunque si digiti', () => {
    for (const o2 of [0.05, 0.21, 0.5, 1]) {
      for (const he of [0, 0.35, 0.7, 0.95]) {
        const m = withFraction(withFraction({ o2: 0.21, he: 0 }, 'o2', o2), 'he', he);
        expect(m.o2 + m.he).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});
