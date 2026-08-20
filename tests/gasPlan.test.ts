/**
 * Pianificazione del gas.
 *
 * Questi numeri si respirano, quindi i test non verificano che il codice girigiri:
 * verificano l'aritmetica contro calcoli fatti a mano, e le proprietà che devono
 * valere sempre (più profondo = più gas d'emergenza, più persone = più gas).
 *
 * Il calcolo di riferimento, ricontrollato a mano per il caso base:
 *   30 m, 2 subacquei, consumo in emergenza 30 L/min, 1 minuto sul fondo,
 *   risalita a 9 m/min fino a 5 m, sosta di 3 minuti, poi in superficie.
 *   - problema:  1 min × 4.00 ata × 30 × 2 = 240 L
 *   - risalita:  (30-5)/9 = 2.78 min a media 17.5 m → 2.75 ata → 2.78 × 2.75 × 60 = 459 L
 *   - sosta:     3 min × 1.25 ata (media 5 m) × 60 = 225 L
 *   - ultimo:    5/9 = 0.56 min × 1.125 ata × 60 = 37 L
 *   totale ≈ 961 L → su una bombola da 15 L sono 65 bar.
 * Le pressioni ambiente usano la densità dell'acqua salata di `units.ts`, quindi
 * gli scostamenti dell'ordine dell'1% sono attesi.
 */

import { describe, expect, it } from 'vitest';
import {
  ascentGeometry,
  atDepth,
  contingencies,
  bottomAvgForWholeAvg,
  DEFAULT_PLAN,
  measuredRmv,
  planGas,
  pressureSchedule,
  similarDives,
  turnMinute,
  usualDepthRatio,
  usualSetup,
  type GasPlanInput,
} from '../src/core/analysis/gasPlan';
import {
  cnsAfterSurface,
  cnsPercentPerMinute,
  exposureOfSegments,
  otuPerMinute,
} from '../src/core/analysis/oxygen';
import type { Dive } from '../src/core/model';

/** Le avvertenze come un testo unico: i test guardano cosa dicono, non l'ordine. */
const texts = (plan: { warnings: { text: string }[] }) => plan.warnings.map((w) => w.text).join(' ');

const input = (over: Partial<GasPlanInput> = {}): GasPlanInput => ({
  ...DEFAULT_PLAN,
  rmvLpm: 18,
  ...over,
});

describe('gas minimo per la risalita d’emergenza', () => {
  it('somma le quattro fasi come il calcolo a mano', () => {
    const plan = planGas(input({ depthM: 30, tankL: 15, stressRmvLpm: 30, divers: 2 }));
    expect(plan.reserve).toHaveLength(4);
    /*
     * Gli estremi si sono alzati dell'1.3%, ed è la correzione a essere giusta:
     * i «litri» qui sono bar·litro, quindi il fattore è la pressione ambiente in
     * bar e non il suo rapporto con la pressione di superficie. Il calcolo a
     * mano che questo test riproduce moltiplica per gli ATA e sta un punto e
     * mezzo sotto — differenza invisibile al livello del mare, e un quarto del
     * totale a duemila metri di quota.
     */
    expect(plan.reserveL).toBeGreaterThan(900);
    expect(plan.reserveL).toBeLessThan(1030);
    expect(plan.reserveBar).toBeGreaterThanOrEqual(62);
    expect(plan.reserveBar).toBeLessThanOrEqual(70);
    // Ogni fase dichiara le proprie ipotesi: è ciò che rende il numero controllabile.
    const problema = plan.reserve[0];
    expect(problema.minutes).toBe(1);
    expect(problema.divers).toBe(2);
    expect(problema.meanAta).toBeCloseTo(4, 1);
  });

  it('cresce con la profondità', () => {
    const shallow = planGas(input({ depthM: 15 }));
    const deep = planGas(input({ depthM: 45 }));
    expect(deep.reserveL).toBeGreaterThan(shallow.reserveL * 2);
  });

  it('raddoppia con due persone invece di una', () => {
    const solo = planGas(input({ divers: 1 }));
    const pair = planGas(input({ divers: 2 }));
    expect(pair.reserveL).toBeCloseTo(solo.reserveL * 2, -1);
  });

  it('somma le soste decompressive quando glieli si dà, senza calcolarle', () => {
    const noDeco = planGas(input({ extraStopMin: 0 }));
    const withDeco = planGas(input({ extraStopMin: 6 }));
    expect(withDeco.reserveL).toBeGreaterThan(noDeco.reserveL);
    // Conto a mano: 6 min × 2 persone × 30 L/min × ~1.5 ATA (5 m) ≈ 540 L.
    expect(withDeco.reserveL - noDeco.reserveL).toBeGreaterThan(500);
    expect(withDeco.reserveL - noDeco.reserveL).toBeLessThan(580);
  });

  it('dice che l’immersione non è pianificabile quando il minimo supera la partenza', () => {
    const plan = planGas(input({ depthM: 50, tankL: 10, startBar: 50 }));
    expect(texts(plan)).toMatch(/non è pianificabile/);
  });
});

describe('tempo di fondo consentito dal gas', () => {
  it('con più gas si sta più a lungo', () => {
    const small = planGas(input({ tankL: 10, startBar: 200 }));
    const big = planGas(input({ tankL: 18, startBar: 230 }));
    expect(big.gasLimitedBottomMin).toBeGreaterThan(small.gasLimitedBottomMin);
  });

  it('con un consumo più alto si sta meno', () => {
    const efficient = planGas(input({ rmvLpm: 14 }));
    const thirsty = planGas(input({ rmvLpm: 24 }));
    expect(thirsty.gasLimitedBottomMin).toBeLessThan(efficient.gasLimitedBottomMin);
  });

  it('avvisa quando il tempo pianificato non ci sta', () => {
    const plan = planGas(input({ depthM: 40, bottomMin: 45, tankL: 12, startBar: 200 }));
    expect(plan.overBudget).toBe(true);
    expect(texts(plan)).toMatch(/Il gas basta per/);
  });

  it('il piano che ci sta non produce l’avviso', () => {
    const plan = planGas(input({ depthM: 18, bottomMin: 25, tankL: 15, startBar: 220, rmvLpm: 16 }));
    expect(plan.overBudget).toBe(false);
    expect(plan.expectedEndBar).toBeGreaterThan(plan.reserveBar);
  });
});

describe('ossigeno e narcosi', () => {
  it('segnala il superamento della MOD col limite impostato', () => {
    const plan = planGas(input({ depthM: 40, mix: { o2: 0.32, he: 0 }, maxPpo2: 1.4 }));
    expect(plan.modM).toBeLessThan(40);
    expect(texts(plan)).toMatch(/PPO2/);
  });

  it('con l’aria a 30 m la PPO2 resta sotto 1.4 e non avvisa', () => {
    const plan = planGas(input({ depthM: 30, mix: { o2: 0.21, he: 0 } }));
    expect(plan.ppo2AtDepth).toBeLessThan(1.4);
    expect(texts(plan)).not.toMatch(/PPO2/);
  });

  it('il trimix abbassa la profondità narcotica', () => {
    const air = planGas(input({ depthM: 45, mix: { o2: 0.21, he: 0 } }));
    const trimix = planGas(input({ depthM: 45, mix: { o2: 0.21, he: 0.35 } }));
    expect(trimix.endM).toBeLessThan(air.endM);
  });

  it('avvisa su un obbligo decompressivo probabile senza pretendere di calcolarlo', () => {
    const plan = planGas(input({ depthM: 35, bottomMin: 25, extraStopMin: 0 }));
    expect(texts(plan)).toMatch(/obbligo decompressivo è probabile/);
    expect(texts(plan)).toMatch(/questo pianificatore non le calcola/);
  });
});

describe('valori presi dall’archivio', () => {
  const dive = (over: Partial<Dive>): Dive => ({
    id: Math.random().toString(36).slice(2),
    startTime: '2026-06-14T10:00:00Z',
    durationS: 2400,
    maxDepth: 30,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: 15, startBar: 220, endBar: 70 }],
    source: { format: 'logtrak', file: 'a', importedAt: 'x' },
    tags: [],
    ...over,
  });

  it('per pianificare usa il 75° percentile, non la media', () => {
    const dives = [14, 16, 18, 20, 30].map((rmv) => dive({ metrics: { rmvLpm: rmv } as Dive['metrics'] }));
    const r = measuredRmv(dives);
    expect(r.n).toBe(5);
    expect(r.median).toBe(18);
    // Il 75° percentile è più severo della mediana: pianificare sulla mediana
    // significa che una volta su due il gas basta appena.
    expect(r.p75).toBeGreaterThan(r.median!);
    expect(r.max).toBe(30);
  });

  it('tace quando nessuna immersione ha il consumo', () => {
    expect(measuredRmv([dive({}), dive({})])).toEqual({ n: 0 });
  });

  it('propone la bombola e la miscela più usate', () => {
    const dives = [
      dive({}),
      dive({}),
      dive({ cylinders: [{ mix: { o2: 0.32, he: 0 }, sizeL: 12, startBar: 200 }] }),
    ];
    const setup = usualSetup(dives);
    expect(setup.tankL).toBe(15);
    expect(setup.mix?.o2).toBe(0.21);
    expect(setup.startBar).toBe(220);
  });

  it('confronta il piano con le immersioni vere a profondità simile', () => {
    const dives = [
      dive({ maxDepth: 29, metrics: { endPressureBar: 45 } as Dive['metrics'] }),
      dive({ maxDepth: 31, metrics: { endPressureBar: 60 } as Dive['metrics'] }),
      dive({ maxDepth: 32, metrics: { endPressureBar: 40 } as Dive['metrics'] }),
      dive({ maxDepth: 12, metrics: { endPressureBar: 90 } as Dive['metrics'] }),
    ];
    const similar = similarDives(dives, 30, 5);
    expect(similar.n).toBe(3);
    expect(similar.minEndBar).toBe(40);
    // Due delle tre sono uscite sotto la riserva di 50 bar: è l'informazione che
    // dice se il piano è ottimista.
    expect(similar.belowReserve).toBe(2);
  });
});

describe('geometria della risalita disegnata', () => {
  /**
   * Lo schema della risalita non ricalcola niente: ricava le profondità dalle
   * fasi. Se questa aritmetica sbaglia, la figura racconta un piano diverso da
   * quello nella tabella accanto — e nessun test dei tipi se ne accorge.
   */
  it('parte dal fondo, tocca la sosta e arriva a zero', () => {
    const plan = planGas(input({ depthM: 30, stopDepthM: 5, stopMin: 3, ascentRateMpm: 9 }));
    const segs = ascentGeometry(plan);
    expect(segs).toHaveLength(4);
    expect(segs[0].fromM).toBe(30);
    expect(segs[0].toM).toBe(30); // gestione del problema: si resta giù
    expect(segs[1].fromM).toBe(30);
    expect(segs[1].toM).toBeCloseTo(5, 1);
    expect(segs[2].fromM).toBeCloseTo(5, 1);
    expect(segs[2].toM).toBeCloseTo(5, 1);
    expect(segs[3].toM).toBe(0);
  });

  it('i tempi sono contigui e sommano la durata della risalita', () => {
    const plan = planGas(input({ depthM: 40, extraStopMin: 8 }));
    const segs = ascentGeometry(plan);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].startMin).toBeCloseTo(segs[i - 1].endMin, 6);
      // Nessun salto di profondità fra una fase e la successiva.
      expect(segs[i].fromM).toBeCloseTo(segs[i - 1].toM, 6);
    }
    const total = plan.reserve.reduce((a, ph) => a + ph.minutes, 0);
    expect(segs[segs.length - 1].endMin).toBeCloseTo(total, 6);
  });

  it('non manda mai la profondità sotto zero', () => {
    for (const depthM of [5, 6, 8, 12, 40, 60]) {
      for (const seg of ascentGeometry(planGas(input({ depthM })))) {
        expect(seg.fromM).toBeGreaterThanOrEqual(0);
        expect(seg.toM).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('i due tempi e la distribuzione del profilo', () => {
  it('il budget della risalita è quello che avanza dal totale', () => {
    const plan = planGas(input({ depthM: 30, bottomMin: 20, totalMin: 27, stopMin: 3, extraStopMin: 0 }));
    expect(plan.totalRuntimeMin).toBe(27);
    expect(plan.split.bottomMin).toBe(20);
    expect(plan.split.ascentMin).toBe(7);
    expect(plan.split.stopsMin).toBe(3);
    expect(plan.split.travelMin).toBe(4);
    // 30 m in 4 minuti: 7.5 m/min, sotto il limite.
    expect(plan.plannedAscentRateMpm).toBeCloseTo(7.5, 1);
  });

  it('la somma delle fasi è esattamente la durata totale', () => {
    for (const over of [{}, { extraStopMin: 9 }, { totalMin: 60 }, { depthM: 45, totalMin: 35 }]) {
      const plan = planGas(input(over));
      const sum = plan.planned.reduce((a, p) => a + p.minutes, 0);
      expect(sum).toBeCloseTo(plan.totalRuntimeMin, 1);
    }
  });

  it('un totale troppo corto per risalire è un errore, non una risalita istantanea', () => {
    const plan = planGas(input({ depthM: 40, bottomMin: 25, totalMin: 27, stopMin: 3 }));
    expect(plan.split.travelMin).toBe(0);
    expect(plan.plannedAscentRateMpm).toBeUndefined();
    expect(texts(plan)).toMatch(/non lascia nemmeno un minuto per risalire/);
    expect(plan.minTotalMin).toBeCloseTo(32, 0);
  });

  it('avvisa quando i tempi implicano una risalita più veloce del consentito', () => {
    const plan = planGas(input({ depthM: 40, bottomMin: 25, totalMin: 30, stopMin: 3 }));
    // 40 m in 2 minuti = 20 m/min.
    expect(plan.plannedAscentRateMpm).toBeCloseTo(20, 1);
    expect(texts(plan)).toMatch(/20.0 m\/min di media, oltre i 10/);
  });

  it('un totale più corto di fondo più soste viene alzato: una sosta non si taglia', () => {
    const plan = planGas(input({ bottomMin: 30, totalMin: 10, stopMin: 3, extraStopMin: 6 }));
    expect(plan.input.totalMin).toBe(39);
    expect(plan.totalRuntimeMin).toBe(39);
    expect(plan.split.travelMin).toBe(0);
    expect(texts(plan)).toMatch(/non lascia nemmeno un minuto per risalire/);
  });
});

describe('profondità media', () => {
  it('il gas del fondo si calcola sulla media, non sulla massima', () => {
    const flat = planGas(input({ depthM: 40, avgDepthM: 40 }));
    const real = planGas(input({ depthM: 40, avgDepthM: 26 }));
    // Il fondo può essere spezzato in due tratti: quello che conta è la somma.
    const bottomOf = (p: ReturnType<typeof planGas>) => ({
      litres: p.planned.filter((f) => f.kind === 'bottom').reduce((a, f) => a + f.litres, 0),
    });
    expect(bottomOf(real).litres).toBeLessThan(bottomOf(flat).litres * 0.75);
    // E il tempo di fondo consentito cresce di conseguenza: è il senso della modifica.
    expect(real.gasLimitedBottomMin).toBeGreaterThan(flat.gasLimitedBottomMin);
  });

  it('il gas d’emergenza resta alla massima: in emergenza si risale da lì', () => {
    const a = planGas(input({ depthM: 40, avgDepthM: 40 }));
    const b = planGas(input({ depthM: 40, avgDepthM: 20 }));
    expect(b.reserveL).toBe(a.reserveL);
  });

  it('una media più profonda della massima viene riportata alla massima, e il piano lo dichiara', () => {
    const plan = planGas(input({ depthM: 18, avgDepthM: 30 }));
    const bottom = plan.planned.find((f) => f.kind === 'bottom')!;
    expect(bottom.meanDepthM).toBe(18);
    // E l'input restituito è quello NORMALIZZATO: la pagina non può mostrare 30
    // mentre il calcolo usa 18.
    expect(plan.input.avgDepthM).toBe(18);
  });

  it('il gas del fondo dipende solo dalla media, qualunque sia la forma del profilo', () => {
    // La pressione ambiente è affine nella profondità: la media nel tempo è il
    // valore alla profondità media. Due profili diversi con la stessa media e lo
    // stesso tempo consumano lo stesso gas — ed è la ragione per cui non serve
    // chiedere la velocità di discesa.
    // Senza tempo alla massima dichiarato: un tratto solo, alla media.
    const a = planGas(input({ depthM: 40, avgDepthM: 25, bottomMin: 20, maxTimeMin: 0 }));
    const b = planGas(input({ depthM: 30, avgDepthM: 25, bottomMin: 20, maxTimeMin: 0 }));
    const fondo = (p: ReturnType<typeof planGas>) => ({
      litres: p.planned.filter((f) => f.kind === 'bottom').reduce((a, f) => a + f.litres, 0),
    });
    expect(fondo(a).litres).toBe(fondo(b).litres);
  });

  it('la media dell’intera immersione è la media pesata delle fasi', () => {
    const plan = planGas(input({ depthM: 30, avgDepthM: 24, bottomMin: 20, totalMin: 27, stopMin: 3 }));
    const byHand = plan.planned.reduce((a, p) => a + p.meanDepthM * p.minutes, 0) / plan.totalRuntimeMin;
    expect(plan.wholeDiveAvgDepthM).toBeCloseTo(byHand, 1);
    // Ed è più bassa della media del fondo: la risalita e la sosta la tirano su.
    expect(plan.wholeDiveAvgDepthM).toBeLessThan(24);
  });

  it('converte la media dell’intera immersione in media del fondo, e il giro torna', () => {
    const base = input({ depthM: 30, bottomMin: 20, totalMin: 27, stopMin: 3 });
    const bottomAvg = bottomAvgForWholeAvg(base, 21)!;
    // Con quella media del fondo, il piano produce davvero una media di 21 m.
    expect(planGas({ ...base, avgDepthM: bottomAvg }).wholeDiveAvgDepthM).toBeCloseTo(21, 1);
    // Ed è più profonda di 21: è l'errore da 12% che si evitava.
    expect(bottomAvg).toBeGreaterThan(21);
  });

  it('propone il rapporto medio delle immersioni vere, e tace sotto le cinque', () => {
    const d = (maxDepth: number, avgDepth: number): Dive => ({
      id: `${maxDepth}-${avgDepth}`,
      startTime: '2026-06-14T10:00:00Z',
      durationS: 2400,
      maxDepth,
      avgDepth,
      mode: 'oc',
      cylinders: [],
      source: { format: 'uddf', file: 'a', importedAt: 'x' },
      tags: [],
    });
    expect(usualDepthRatio([d(30, 20), d(40, 28)])).toBeUndefined();
    expect(usualDepthRatio([d(30, 21), d(40, 28), d(20, 14), d(35, 24.5), d(25, 17.5)])).toBeCloseTo(0.7, 2);
  });
});

describe('regola della riserva', () => {
  it('con la riserva fissa il gas d’emergenza non viene calcolato affatto', () => {
    const plan = planGas(input({ reserveRule: 'fixedBar', reserveBarFixed: 50, tankL: 15 }));
    // Non "calcolato e nascosto": non c'è.
    expect(plan.reserve).toEqual([]);
    expect(plan.reserveBar).toBe(50);
    expect(plan.reserveL).toBe(50 * 15);
  });

  it('la riserva fissa lascia più gas utilizzabile del rock bottom, in profondità', () => {
    const fixed = planGas(input({ depthM: 40, reserveRule: 'fixedBar', reserveBarFixed: 50 }));
    const rock = planGas(input({ depthM: 40, reserveRule: 'rockBottom' }));
    expect(fixed.usableBar).toBeGreaterThan(rock.usableBar);
    // ...ed è esattamente per questo che sotto i 30 m arriva l'avvertenza.
    expect(texts(fixed)).toMatch(/non dipende dalla profondità/);
    expect(texts(rock)).not.toMatch(/non dipende dalla profondità/);
  });

  it('in acqua bassa la riserva fissa non genera avvertenze di profondità', () => {
    const plan = planGas(input({ depthM: 18, reserveRule: 'fixedBar', reserveBarFixed: 50 }));
    expect(texts(plan)).not.toMatch(/non dipende dalla profondità/);
  });

  it('avvisa se il piano consuma la riserva scelta', () => {
    const plan = planGas(
      input({
        depthM: 30,
        avgDepthM: 30,
        bottomMin: 40,
        totalMin: 48,
        tankL: 12,
        startBar: 200,
        reserveRule: 'fixedBar',
        reserveBarFixed: 70,
      }),
    );
    expect(plan.overBudget).toBe(true);
    expect(texts(plan)).toMatch(/Il gas basta per \d+ minuti di fondo, non 40/);
  });
});

describe('regola di rientro', () => {
  it('i terzi girano più presto della metà', () => {
    const thirds = planGas(input({ turnRule: 'thirds' }));
    const half = planGas(input({ turnRule: 'half' }));
    expect(thirds.turnBar!).toBeGreaterThan(half.turnBar!);
  });

  it('senza regola non propone nessuna pressione di rientro', () => {
    expect(planGas(input({ turnRule: 'none' })).turnBar).toBeUndefined();
  });

  it('la regola non cambia il gas: cambia solo dove si gira', () => {
    const a = planGas(input({ turnRule: 'thirds' }));
    const b = planGas(input({ turnRule: 'none' }));
    expect(b.reserveL).toBe(a.reserveL);
    expect(b.usableBar).toBe(a.usableBar);
    expect(b.gasLimitedBottomMin).toBe(a.gasLimitedBottomMin);
  });
});

describe('cambiare la profondità massima', () => {
  /**
   * Questi tre test nascono da un audit avversariale: il campo della profondità e
   * le curve riscalavano il piano in due modi diversi, quindi la curva prometteva a
   * 40 m un tempo che la pagina non dava mai se quel 40 lo scrivevi nel campo. Ora
   * la funzione è una sola, e queste sono le sue proprietà.
   */
  it('conserva la velocità di risalita invece del tempo', () => {
    const base = input({ depthM: 30, bottomMin: 20, totalMin: 27, stopMin: 3 });
    const rate = planGas(base).plannedAscentRateMpm!;
    for (const d of [10, 20, 40, 60]) {
      const got = planGas(atDepth(base, d)).plannedAscentRateMpm!;
      // Il totale sta in minuti interi, quindi la velocità che ne risulta non è
      // identica: la proprietà che conta è che l'arrotondamento non la renda mai
      // PIÙ VELOCE dell'originale, cioè non possa inventare una violazione.
      expect(got).toBeLessThanOrEqual(rate + 0.01);
      expect(got).toBeGreaterThan(rate * 0.6);
    }
  });

  it('andata e ritorno riportano il piano dov’era', () => {
    const base = input({ depthM: 30, avgDepthM: 22, bottomMin: 20, totalMin: 27, stopMin: 3, stopDepthM: 5 });
    const ratio = base.avgDepthM / base.depthM;
    const rate = planGas(base).plannedAscentRateMpm!;
    for (const via of [3, 5, 10, 60]) {
      const back = atDepth(atDepth(base, via, ratio, rate), 30, ratio, rate);
      expect(back.avgDepthM).toBeCloseTo(base.avgDepthM, 1);
      // Il totale può allungarsi di un minuto per l'arrotondamento del transito,
      // mai accorciarsi: la risalita non diventa più veloce di com'era.
      expect(back.totalMin).toBeGreaterThanOrEqual(base.totalMin);
      expect(back.totalMin - base.totalMin).toBeLessThanOrEqual(2);
      // La sosta non viene toccata: prima restava schiacciata a 3 m per sempre.
      expect(back.stopDepthM).toBe(5);
    }
  });

  it('più profondo significa meno fondo, non una risalita più veloce', () => {
    const base = input({ depthM: 30, bottomMin: 20, totalMin: 27, stopMin: 3 });
    const deep = planGas(atDepth(base, 60));
    expect(deep.plannedAscentRateMpm!).toBeLessThanOrEqual(10);
    expect(deep.gasLimitedBottomMin).toBeLessThan(planGas(base).gasLimitedBottomMin);
  });
});

describe('coerenza interna, dai casi trovati dall’audit', () => {
  const combos: Partial<GasPlanInput>[] = [
    {},
    { extraStopMin: 9 },
    { depthM: 8, stopDepthM: 3, bottomMin: 20, stopMin: 3, totalMin: 24 },
    { totalMin: 27.65 },
    { depthM: 80, totalMin: 600 },
    { bottomMin: 0 },
    { depthM: 1 },
    { avgDepthM: 0 },
    { stopDepthM: 40, depthM: 30 },
    { divers: 0, problemMin: -2, maxPpo2: -1, reserveBarFixed: -5 },
  ];

  it('la somma delle durate delle fasi vale esattamente la durata totale', () => {
    for (const over of combos) {
      const plan = planGas(input(over));
      const sum = plan.planned.reduce((a, p) => a + p.minutes, 0);
      expect(sum).toBeCloseTo(plan.totalRuntimeMin, 6);
    }
  });

  it('non produce mai NaN, infiniti, litri negativi o durate negative', () => {
    for (const over of combos) {
      const plan = planGas(input(over));
      for (const f of [...plan.planned, ...plan.reserve]) {
        expect(Number.isFinite(f.litres)).toBe(true);
        expect(f.litres).toBeGreaterThanOrEqual(0);
        expect(f.minutes).toBeGreaterThanOrEqual(0);
      }
      for (const v of [
        plan.reserveL,
        plan.plannedL,
        plan.usableL,
        plan.gasLimitedBottomMin,
        plan.wholeDiveAvgDepthM,
      ]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('l’input restituito è quello con cui ha calcolato, sempre', () => {
    for (const over of combos) {
      const plan = planGas(input(over));
      expect(plan.input.avgDepthM).toBeLessThanOrEqual(plan.input.depthM);
      expect(plan.input.stopDepthM).toBeLessThanOrEqual(plan.input.depthM);
      expect(plan.input.totalMin).toBeGreaterThanOrEqual(
        plan.input.bottomMin + plan.input.stopMin + plan.input.extraStopMin,
      );
      expect(plan.input.divers).toBeGreaterThanOrEqual(1);
      expect(plan.input.problemMin).toBeGreaterThanOrEqual(0);
      expect(plan.input.reserveBarFixed).toBeGreaterThanOrEqual(0);
    }
  });

  it('non dice mai «basta per N minuti, non N»', () => {
    // Il caso esatto trovato dall'audit: due strade di arrotondamento diverse che
    // sul filo davano lo stesso numero due volte.
    const plan = planGas(
      input({
        depthM: 30,
        avgDepthM: 22,
        bottomMin: 20,
        totalMin: 27,
        stopMin: 3,
        tankL: 12,
        startBar: 210.58,
        rmvLpm: 19.4,
      }),
    );
    expect(plan.overBudget).toBe(true);
    /*
     * La proprietà è che il messaggio non dica lo STESSO numero due volte, non
     * che prenda un ramo preciso: con i litri contati sulla pressione assoluta
     * il gas basta per 19 minuti invece che per 20 tondi, quindi la frase
     * corretta è quella con i due numeri diversi. Il difetto originale era
     * «basta per 20 minuti di fondo, non 20», e resta escluso.
     */
    expect(texts(plan)).not.toMatch(/per (\d+) minuti di fondo, non \1\b/);
    expect(texts(plan)).toMatch(/basta per 19 minuti di fondo, non 20|senza lasciare margine/);
  });
});

describe('tempo alla profondità massima e piano delle pressioni', () => {
  it('la profondità del resto del fondo discende dalla media, non è un’ipotesi', () => {
    const plan = planGas(input({ depthM: 40, avgDepthM: 25, bottomMin: 20, maxTimeMin: 8, totalMin: 30 }));
    expect(plan.restDepthM).toBeCloseTo(15, 1);
    const bottom = plan.planned.filter((p) => p.kind === 'bottom');
    expect(bottom).toHaveLength(2);
    // Il conto torna: la media pesata dei due tratti è quella dichiarata.
    const media = bottom.reduce((a, p) => a + p.meanDepthM * p.minutes, 0) / 20;
    expect(media).toBeCloseTo(25, 2);
  });

  it('dice qual è il massimo tempo alla massima compatibile con la media', () => {
    // 20 min di media a 25 m con massima 40: 25×20/40 = 12.5 minuti al massimo.
    const plan = planGas(input({ depthM: 40, avgDepthM: 25, bottomMin: 20, maxTimeMin: 18, totalMin: 32 }));
    expect(plan.maxFeasibleTimeMin).toBeCloseTo(12.5, 1);
    expect(plan.input.maxTimeMin).toBeCloseTo(12.5, 1);
    expect(texts(plan)).toMatch(/il tempo massimo che puoi passare a 40 m è 12.5 minuti/);
    // E il resto del fondo non finisce sopra la superficie.
    for (const p of plan.planned) expect(p.meanDepthM).toBeGreaterThanOrEqual(0);
  });

  it('il piano delle pressioni parte dalla pressione di partenza e arriva a quella d’uscita', () => {
    const plan = planGas(
      input({
        depthM: 40,
        avgDepthM: 25,
        bottomMin: 20,
        maxTimeMin: 8,
        totalMin: 30,
        tankL: 15,
        startBar: 220,
      }),
    );
    const schedule = pressureSchedule(plan);
    expect(schedule[0].runMin).toBe(0);
    expect(schedule[0].bar).toBe(220);
    const last = schedule[schedule.length - 1];
    expect(last.runMin).toBeCloseTo(plan.totalRuntimeMin, 1);
    // L'ultima riga coincide con l'uscita prevista, a un bar di arrotondamento.
    expect(Math.abs(last.bar - plan.expectedEndBar)).toBeLessThanOrEqual(1);
  });

  it('le pressioni scendono sempre, e più in fretta quando si sta profondi', () => {
    const plan = planGas(
      input({
        depthM: 40,
        avgDepthM: 25,
        bottomMin: 20,
        maxTimeMin: 8,
        totalMin: 30,
        tankL: 15,
        startBar: 220,
      }),
    );
    const s = pressureSchedule(plan, 1);
    for (let i = 1; i < s.length; i++) expect(s[i].bar).toBeLessThanOrEqual(s[i - 1].bar);
    // Il consumo al minuto sul tratto profondo è maggiore che su quello basso.
    const deep = s[3].bar - s[4].bar;
    const shallow = s[13].bar - s[14].bar;
    expect(deep).toBeGreaterThan(shallow);
  });

  it('traduce la pressione di rientro in un minuto', () => {
    const plan = planGas(
      input({
        depthM: 30,
        avgDepthM: 22,
        bottomMin: 20,
        maxTimeMin: 6,
        totalMin: 27,
        tankL: 15,
        startBar: 200,
      }),
    );
    const minute = turnMinute(plan);
    expect(minute).toBeDefined();
    // A quel minuto la pressione attesa è davvero scesa alla soglia di rientro.
    const at = pressureSchedule(plan, 0.5).find((p) => p.runMin === minute)!;
    expect(at.bar).toBeLessThanOrEqual(plan.turnBar!);
    // Senza regola di rientro non c'è nessun minuto da indicare.
    expect(turnMinute(planGas(input({ turnRule: 'none' })))).toBeUndefined();
  });
});

describe('esposizione all’ossigeno del piano', () => {
  it('conta il CNS con i limiti NOAA per singola esposizione', () => {
    // 40 minuti a 1.4 bar sono il 26.7% dell'orologio: è l'esempio del manuale
    // TDI Advanced Nitrox p. 33 (40/150 × 100).
    const e = exposureOfSegments([{ ppo2: 1.4, minutes: 40 }]);
    expect(e.cnsPercent).toBeCloseTo(26.7, 1);
    expect(e.minutesAbove14).toBe(0);
  });

  it('riproduce la tabella OTU del manuale', () => {
    // TDI Advanced Nitrox p. 36: 1.0 → 1.000, 1.3 → 1.479, 1.6 → 1.928.
    expect(otuPerMinute(1.0)).toBeCloseTo(1.0, 3);
    expect(otuPerMinute(1.3)).toBeCloseTo(1.479, 3);
    // La tabella stampata arrotonda al millesimo: 1.9286 → 1.928.
    expect(otuPerMinute(1.6)).toBeCloseTo(1.928, 2);
    // Sotto 0.6 bar il manuale dice di non contare, e non si conta.
    expect(otuPerMinute(0.5)).toBe(0);
    expect(cnsPercentPerMinute(0.5)).toBe(0);
  });

  it('il CNS si dimezza ogni 90 minuti in superficie', () => {
    // L'esempio esplicito del manuale: 40% + 90 minuti → 20%.
    expect(cnsAfterSurface(40, 90)).toBeCloseTo(20, 1);
    expect(cnsAfterSurface(40, 180)).toBeCloseTo(10, 1);
  });

  it('un piano lungo e profondo in nitrox accumula CNS, e il piano lo dice', () => {
    const plan = planGas(
      input({
        depthM: 38,
        avgDepthM: 30,
        bottomMin: 45,
        maxTimeMin: 10,
        totalMin: 60,
        mix: { o2: 0.32, he: 0 },
        maxPpo2: 1.6,
      }),
    );
    expect(plan.oxygen.cnsPercent).toBeGreaterThan(20);
    expect(plan.oxygen.otu).toBeGreaterThan(30);
  });
});

describe('consumo di squadra e attrezzatura', () => {
  it('pianifica sul respiro più alto dei due', () => {
    const solo = planGas(input({ rmvLpm: 16, buddyRmvLpm: 0 }));
    const team = planGas(input({ rmvLpm: 16, buddyRmvLpm: 22 }));
    expect(solo.planningRmvLpm).toBe(16);
    expect(team.planningRmvLpm).toBe(22);
    expect(team.buddyDrivesPlan).toBe(true);
    expect(team.plannedL).toBeGreaterThan(solo.plannedL);
    expect(texts(team)).toMatch(/respiro più alto della squadra/);
  });

  it('un compagno che consuma meno non cambia niente', () => {
    const a = planGas(input({ rmvLpm: 20, buddyRmvLpm: 0 }));
    const b = planGas(input({ rmvLpm: 20, buddyRmvLpm: 14 }));
    expect(b.plannedL).toBe(a.plannedL);
    expect(b.buddyDrivesPlan).toBe(false);
    // E il campo resta quello che ha scritto l'utente, non viene azzerato.
    expect(b.input.buddyRmvLpm).toBe(14);
  });

  it('oltre il 40% di ossigeno chiede attrezzatura pulita', () => {
    expect(planGas(input({ mix: { o2: 0.36, he: 0 } })).needsO2CleanKit).toBe(false);
    const rich = planGas(input({ depthM: 6, mix: { o2: 0.5, he: 0 } }));
    expect(rich.needsO2CleanKit).toBe(true);
    expect(texts(rich)).toMatch(/attrezzatura pulita per il servizio ossigeno/);
  });
});

describe('gas di decompressione separato', () => {
  const withDeco = (over: Partial<GasPlanInput> = {}) =>
    planGas(
      input({
        depthM: 40,
        avgDepthM: 28,
        bottomMin: 25,
        maxTimeMin: 10,
        totalMin: 45,
        stopDepthM: 6,
        stopMin: 3,
        extraStopMin: 12,
        decoMix: { o2: 1, he: 0 },
        decoTankL: 7,
        decoStartBar: 200,
        decoRmvLpm: 15,
        ...over,
      }),
    );

  it('le soste escono dalla bombola di deco, non da quella di fondo', () => {
    const conDeco = withDeco();
    const senzaDeco = withDeco({ decoMix: undefined });
    expect(conDeco.plannedL).toBeLessThan(senzaDeco.plannedL);
    expect(conDeco.expectedEndBar).toBeGreaterThan(senzaDeco.expectedEndBar);
    // E la somma delle fasi resta la durata totale: le soste ci sono ancora.
    const sum = conDeco.planned.reduce((a, p) => a + p.minutes, 0);
    expect(sum).toBeCloseTo(conDeco.totalRuntimeMin, 6);
  });

  it('applica il margine di 1.5 imposto dal manuale', () => {
    const plan = withDeco();
    expect(plan.deco).toBeDefined();
    expect(plan.deco!.requiredL).toBe(Math.round(plan.deco!.litres * 1.5));
    expect(plan.deco!.requiredBar).toBe(Math.ceil(plan.deco!.requiredL / 7));
  });

  it('il passaggio avviene alla MOD del gas di deco a 1.6 bar', () => {
    const plan = withDeco();
    // Ossigeno puro: 1.6 bar / 1.0 = 1.6 ata ≈ 6 m.
    expect(plan.deco!.switchDepthM).toBeGreaterThan(5);
    expect(plan.deco!.switchDepthM).toBeLessThan(7);
  });

  it('se la sosta è più profonda della MOD del gas, le soste restano sul fondo', () => {
    const plan = withDeco({ stopDepthM: 9 });
    expect(plan.deco).toBeUndefined();
    expect(texts(plan)).toMatch(/si respira solo da/);
  });

  it('avvisa quando la bombola di deco non basta', () => {
    const plan = withDeco({ decoTankL: 2, decoStartBar: 100 });
    expect(plan.deco!.short).toBe(true);
    expect(texts(plan)).toMatch(/La bombola di decompressione non basta/);
  });
});

describe('schedule di contingenza', () => {
  const base = () =>
    input({
      depthM: 35,
      avgDepthM: 26,
      bottomMin: 22,
      maxTimeMin: 8,
      totalMin: 32,
      tankL: 15,
      startBar: 220,
    });

  it('produce i quattro scenari del manuale, più quello del gas perso quando serve', () => {
    expect(contingencies(base()).map((c) => c.label)).toEqual([
      'Fondo più lungo',
      'Più profondo',
      'Più lungo e più profondo',
      'Fondo più corto',
    ]);
    const conDeco = contingencies({ ...base(), decoMix: { o2: 1, he: 0 }, stopDepthM: 6 });
    expect(conDeco.map((c) => c.label)).toContain('Gas di decompressione perso');
  });

  it('ogni scenario peggiore esce con meno gas, quello migliore con più', () => {
    const list = contingencies(base());
    const byLabel = Object.fromEntries(list.map((c) => [c.label, c]));
    expect(byLabel['Fondo più lungo'].endBarDelta).toBeLessThan(0);
    expect(byLabel['Più profondo'].endBarDelta).toBeLessThan(0);
    expect(byLabel['Più lungo e più profondo'].endBarDelta).toBeLessThan(
      byLabel['Fondo più lungo'].endBarDelta,
    );
    expect(byLabel['Fondo più corto'].endBarDelta).toBeGreaterThan(0);
  });

  it('perdere il gas di deco costa gas di fondo', () => {
    const conDeco = { ...base(), stopDepthM: 6, extraStopMin: 10, decoMix: { o2: 1, he: 0 } };
    const perso = contingencies(conDeco).find((c) => c.label === 'Gas di decompressione perso')!;
    expect(perso.endBarDelta).toBeLessThan(0);
    expect(perso.plan.deco).toBeUndefined();
  });

  it('non altera il piano di partenza', () => {
    const original = base();
    const copy = JSON.parse(JSON.stringify(original));
    contingencies(original);
    expect(original).toEqual(copy);
  });
});

/**
 * La tabella delle pressioni deve descrivere lo STESSO piano dei totali.
 *
 * Erano due aritmetiche separate e divergevano su tre punti: il consumo (la
 * tabella usava il tuo, il piano quello del compagno), la quota (la tabella la
 * ignorava) e le soste pagate con lo stage (il piano le escludeva, la tabella
 * le addebitava al gas di fondo). Sul caso peggiore l'ultima riga dava 106 bar
 * dove il piano prometteva 69.
 */
describe('coerenza fra tabella delle pressioni e totali del piano', () => {
  const teamPlan = (over: Partial<GasPlanInput> = {}): GasPlanInput =>
    input({
      depthM: 40,
      avgDepthM: 30,
      bottomMin: 20,
      totalMin: 45,
      stopDepthM: 6,
      stopMin: 3,
      extraStopMin: 6,
      tankL: 15,
      startBar: 230,
      rmvLpm: 18,
      buddyRmvLpm: 25,
      ...over,
    });

  const lastBar = (plan: ReturnType<typeof planGas>) => {
    const rows = pressureSchedule(plan);
    return rows[rows.length - 1].bar;
  };

  it('l’ultima riga vale l’uscita prevista quando il compagno consuma più di te', () => {
    const plan = planGas(teamPlan());
    expect(plan.buddyDrivesPlan).toBe(true);
    expect(lastBar(plan)).toBe(Math.max(0, plan.expectedEndBar));
  });

  it('l’ultima riga vale l’uscita prevista anche in quota', () => {
    const plan = planGas(teamPlan({ altitudeM: 1500, bottomMin: 12, startBar: 300 }));
    expect(plan.expectedEndBar).toBeGreaterThan(0);
    expect(lastBar(plan)).toBe(plan.expectedEndBar);
  });

  it('le soste pagate con lo stage non le scala dal gas di fondo', () => {
    const plan = planGas(teamPlan({ decoMix: { o2: 0.5, he: 0 }, startBar: 300 }));
    expect(plan.deco).toBeDefined();
    expect(plan.planned.some((p) => p.fromStage)).toBe(true);
    expect(plan.expectedEndBar).toBeGreaterThan(0);
    expect(lastBar(plan)).toBe(plan.expectedEndBar);
  });

  it('il minuto di rientro cade dove la tabella incrocia la pressione di rientro', () => {
    const plan = planGas(teamPlan({ turnRule: 'thirds', startBar: 300, bottomMin: 25 }));
    const at = turnMinute(plan)!;
    const rows = pressureSchedule(plan, 0.5);
    const before = rows.filter((r) => r.runMin < at).pop();
    expect(before!.bar).toBeGreaterThan(plan.turnBar!);
    expect(rows.find((r) => r.runMin === at)!.bar).toBeLessThanOrEqual(plan.turnBar!);
  });
});
