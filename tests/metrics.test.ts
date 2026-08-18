import { describe, expect, it } from 'vitest';
import { AIR, type Dive, type Sample } from '../src/core/model';
import { computeMetrics } from '../src/core/analysis/metrics';
import { oxygenLoad } from '../src/core/analysis/oxygen';
import { parseFile } from '../src/core/parsers';
import { synthesise, toUddf } from './fixtures';

function makeDive(samples: Sample[], overrides: Partial<Dive> = {}): Dive {
  const maxDepth = Math.max(...samples.map((s) => s.depth));
  return {
    id: 'test',
    startTime: '2026-06-14T10:38:00.000Z',
    durationS: samples[samples.length - 1].t,
    maxDepth,
    mode: 'oc',
    cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 70 }],
    salinity: 'salt',
    source: { format: 'uddf', file: 'test', importedAt: '2026-06-14T12:00:00.000Z' },
    tags: [],
    samples,
    ...overrides,
  };
}

/** Profilo rettangolare: discesa lineare, fondo piatto, risalita lineare. */
function square(depth: number, bottomS: number, ascentRateMpm: number, interval = 10): Sample[] {
  const out: Sample[] = [];
  const descentS = Math.round((depth / 18) * 60);
  const ascentS = Math.round((depth / ascentRateMpm) * 60);
  let t = 0;
  for (; t <= descentS; t += interval) out.push({ t, depth: (t / descentS) * depth });
  for (; t <= descentS + bottomS; t += interval) out.push({ t, depth });
  const total = descentS + bottomS + ascentS;
  for (; t <= total; t += interval) {
    out.push({ t, depth: Math.max(0, depth * (1 - (t - descentS - bottomS) / ascentS)) });
  }
  return out;
}

describe('rilevamento delle fasi', () => {
  it('separa discesa, fondo e risalita', () => {
    const m = computeMetrics(makeDive(square(30, 20 * 60, 9)));
    // Discesa a 18 m/min fino a 30 m: la soglia di fase (75% = 22.5 m) viene
    // raggiunta intorno agli 80 secondi.
    expect(m.phases.descentS).toBeGreaterThanOrEqual(70);
    expect(m.phases.descentS).toBeLessThan(130);
    expect(m.phases.bottomS).toBeGreaterThan(19 * 60);
    // Risalita a 9 m/min da 30 m: la soglia di fase la accorcia a ~150 s.
    expect(m.phases.ascentS).toBeGreaterThanOrEqual(140);
  });
});

describe('velocità verticali', () => {
  it('misura una risalita a 9 m/min come conforme', () => {
    const m = computeMetrics(makeDive(square(30, 20 * 60, 9)));
    expect(m.maxAscentRateMpm!).toBeGreaterThan(8);
    expect(m.maxAscentRateMpm!).toBeLessThan(11);
    // Sotto i 10 m/min non ci sono violazioni in profondità.
    expect(m.fastAscentS).toBe(0);
  });

  it('rileva una risalita a 20 m/min', () => {
    const m = computeMetrics(makeDive(square(30, 20 * 60, 20)));
    expect(m.maxAscentRateMpm!).toBeGreaterThan(17);
    expect(m.fastAscentS).toBeGreaterThan(30);
  });

  it('distingue le violazioni sopra i 10 metri', () => {
    // Risalita lenta in profondità, poi sparata negli ultimi metri.
    const samples: Sample[] = [];
    for (let t = 0; t <= 600; t += 10) samples.push({ t, depth: 20 });
    for (let t = 610; t <= 700; t += 10) samples.push({ t, depth: 20 - ((t - 600) / 90) * 10 }); // 20→10 in 90 s
    for (let t = 710; t <= 760; t += 10) samples.push({ t, depth: Math.max(0, 10 - ((t - 700) / 50) * 10) }); // 10→0 in 50 s = 12 m/min
    const m = computeMetrics(makeDive(samples));
    expect(m.fastShallowAscentS).toBeGreaterThan(0);
  });

  it('non confonde il rumore del sensore con una risalita rapida', () => {
    // Fondo piatto con ±0.15 m di rumore a 2 s: fra campioni adiacenti darebbe
    // 4.5 m/min, ma la finestra mobile di 30 s lo annulla.
    const samples: Sample[] = [];
    for (let t = 0; t <= 1200; t += 2) {
      samples.push({ t, depth: 25 + (t % 4 === 0 ? 0.15 : -0.15) });
    }
    const m = computeMetrics(makeDive(samples));
    expect(m.fastAscentS).toBe(0);
    expect(m.maxAscentRateMpm!).toBeLessThan(2);
  });
});

describe('assetto', () => {
  it('dà oscillazione quasi nulla su un fondo perfettamente piatto', () => {
    const m = computeMetrics(makeDive(square(30, 20 * 60, 9)));
    expect(m.bottomVerticalTravelMpm!).toBeLessThan(0.3);
  });

  it('misura l\'oscillazione di un assetto instabile', () => {
    const wobbly = synthesise({ wobbleM: 2.5, wobblePeriodS: 60 });
    const flat = synthesise({ wobbleM: 0 });
    const a = computeMetrics(makeDive(wobbly.samples.map((s) => ({ t: s.t, depth: s.depth }))));
    const b = computeMetrics(makeDive(flat.samples.map((s) => ({ t: s.t, depth: s.depth }))));
    expect(a.bottomVerticalTravelMpm!).toBeGreaterThan(b.bottomVerticalTravelMpm!);
    expect(a.bottomVerticalTravelMpm!).toBeGreaterThan(2);
  });

  it('non conta come errore uno spostamento netto voluto', () => {
    // Discesa graduale da 20 a 40 m in fase di fondo: è una scelta, non un errore.
    const samples: Sample[] = [];
    for (let t = 0; t <= 120; t += 10) samples.push({ t, depth: (t / 120) * 40 });
    for (let t = 130; t <= 1200; t += 10) samples.push({ t, depth: 40 - ((t - 130) / 1070) * 8 });
    for (let t = 1210; t <= 1500; t += 10) samples.push({ t, depth: Math.max(0, 32 - ((t - 1200) / 300) * 32) });
    const m = computeMetrics(makeDive(samples));
    expect(m.bottomVerticalTravelMpm!).toBeLessThan(0.5);
  });
});

describe('sosta di sicurezza', () => {
  it('riconosce una sosta di 4 minuti a 5 metri', () => {
    const samples: Sample[] = [];
    for (let t = 0; t <= 100; t += 10) samples.push({ t, depth: (t / 100) * 25 });
    for (let t = 110; t <= 1500; t += 10) samples.push({ t, depth: 25 });
    for (let t = 1510; t <= 1640; t += 10) samples.push({ t, depth: 25 - ((t - 1500) / 140) * 20 });
    for (let t = 1650; t <= 1890; t += 10) samples.push({ t, depth: 5 });
    for (let t = 1900; t <= 1990; t += 10) samples.push({ t, depth: Math.max(0, 5 - ((t - 1890) / 100) * 5) });
    const m = computeMetrics(makeDive(samples));
    expect(m.safetyStopS).toBeGreaterThan(200);
    expect(m.didSafetyStop).toBe(true);
  });

  it('non conta come sosta un passaggio veloce nella fascia', () => {
    const m = computeMetrics(makeDive(square(25, 20 * 60, 9)));
    expect(m.didSafetyStop).toBe(false);
  });
});

describe('decompressione', () => {
  it('conta il tempo in deco e le violazioni del tetto', () => {
    const samples: Sample[] = [
      { t: 0, depth: 0 },
      { t: 60, depth: 40 },
      { t: 1500, depth: 40, ceiling: 9, inDeco: true },
      { t: 1600, depth: 12, ceiling: 9, inDeco: true },
      // Sale a 6 m con il tetto a 9: violazione.
      { t: 1700, depth: 6, ceiling: 9, inDeco: true },
      { t: 1800, depth: 6, ceiling: 6, inDeco: true },
      { t: 1900, depth: 3, ceiling: 0 },
      { t: 2000, depth: 0 },
    ];
    const m = computeMetrics(makeDive(samples));
    expect(m.decoS).toBeGreaterThan(0);
    expect(m.ceilingViolationS).toBeGreaterThan(0);
    expect(m.maxCeilingM).toBe(9);
  });

  it('non segnala violazioni se il tetto è rispettato', () => {
    const samples: Sample[] = [
      { t: 0, depth: 0 },
      { t: 60, depth: 40 },
      { t: 1500, depth: 40, ceiling: 9, inDeco: true },
      { t: 1700, depth: 12, ceiling: 9, inDeco: true },
      { t: 1900, depth: 9, ceiling: 9, inDeco: true },
      { t: 2100, depth: 6, ceiling: 6, inDeco: true },
      { t: 2400, depth: 0 },
    ];
    const m = computeMetrics(makeDive(samples));
    expect(m.ceilingViolationS).toBe(0);
  });
});

describe('consumo gas', () => {
  it('calcola il consumo di superficie con il volume noto', () => {
    // 130 bar consumati su 12 L = 1560 L, in 25 minuti a ~3 ATA → ~20.8 L/min.
    const samples: Sample[] = [];
    for (let t = 0; t <= 1500; t += 30) samples.push({ t, depth: 20 });
    const m = computeMetrics(
      makeDive(samples, { durationS: 1500, cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 70 }] }),
    );
    expect(m.rmvLpm).toBeDefined();
    expect(m.rmvLpm!).toBeGreaterThan(18);
    expect(m.rmvLpm!).toBeLessThan(24);
    expect(m.sacBarPerMin).toBeCloseTo(5.2, 1);
    expect(m.endPressureBar).toBe(70);
    expect(m.reserveFraction).toBeCloseTo(0.35, 2);
  });

  it('spiega perché non può calcolare il consumo quando manca il volume', () => {
    const samples: Sample[] = [{ t: 0, depth: 0 }, { t: 600, depth: 20 }, { t: 1200, depth: 0 }];
    const m = computeMetrics(makeDive(samples, { cylinders: [{ mix: AIR, startBar: 200, endBar: 80 }] }));
    expect(m.rmvLpm).toBeUndefined();
    expect(m.sacBarPerMin).toBeDefined();
    expect(m.quality.caveats.join(' ')).toContain('Volume bombola');
  });

  it('ricostruisce il consumo con cui il profilo era stato generato', async () => {
    const synth = synthesise({ rmvLpm: 16, tankSizeL: 15, startBar: 230 });
    const { dives } = await parseFile({ fileName: 'x.uddf', text: toUddf(synth) });
    expect(dives[0].metrics!.rmvLpm!).toBeGreaterThan(14.5);
    expect(dives[0].metrics!.rmvLpm!).toBeLessThan(17.5);
  });
});

describe('qualità del dato', () => {
  it('avverte quando il campionamento è troppo rado', () => {
    const samples: Sample[] = [];
    for (let t = 0; t <= 1800; t += 60) samples.push({ t, depth: 20 });
    const m = computeMetrics(makeDive(samples));
    expect(m.quality.sampleIntervalS).toBe(60);
    expect(m.quality.caveats.join(' ')).toContain('approssimate');
  });

  it('gestisce un\'immersione senza profilo senza esplodere', () => {
    const dive = makeDive([{ t: 0, depth: 0 }]);
    dive.samples = [];
    dive.durationS = 2400;
    dive.maxDepth = 28;
    const m = computeMetrics(dive);
    expect(m.quality.hasProfile).toBe(false);
    expect(m.fastAscentS).toBe(0);
    expect(m.quality.caveats.join(' ')).toContain('Nessun profilo');
  });
});

describe('esposizione all’ossigeno', () => {
  it('calcola CNS e OTU dal profilo, separati da quelli del computer', () => {
    // 30 metri in aria: PPO2 di fondo ~0.85 bar, sotto il gradino di 0.9 → il
    // limite usato è 360 minuti, cioè 0.28% al minuto.
    const m = computeMetrics(makeDive(square(30, 25 * 60, 9)));
    expect(m.cnsPct).toBeGreaterThan(5);
    expect(m.cnsPct).toBeLessThan(20);
    expect(m.otu).toBeGreaterThan(15);
    // Il computer non ha scritto il suo CNS in questo profilo, e il nostro non
    // prende il suo posto: sono due misure diverse e restano separate.
    expect(m.cnsEndPct).toBeUndefined();
  });

  it('in nitrox l’esposizione è più alta che in aria, a parità di profilo', () => {
    const samples = square(30, 25 * 60, 9);
    const air = computeMetrics(makeDive(samples));
    const nitrox = computeMetrics(
      makeDive(samples, { cylinders: [{ mix: { o2: 0.32, he: 0 }, sizeL: 12, startBar: 200, endBar: 70 }] }),
    );
    expect(nitrox.cnsPct!).toBeGreaterThan(air.cnsPct!);
    expect(nitrox.otu!).toBeGreaterThan(air.otu!);
  });

  it('somma le OTU della giornata e dimezza il CNS negli intervalli di superficie', () => {
    const dive = (startTime: string, cnsPct: number, otu: number) => ({
      startTime,
      durationS: 2400,
      metrics: { cnsPct, otu },
    });
    // Due immersioni, 90 minuti esatti di superficie fra la fine della prima e
    // l'inizio della seconda: il 20% residuo diventa 10, più il nuovo 20.
    const load = oxygenLoad([
      dive('2026-06-14T10:00:00Z', 20, 40),
      dive('2026-06-14T12:10:00Z', 20, 40),
    ]);
    expect(load.days).toHaveLength(1);
    expect(load.days[0].otu).toBe(80);
    expect(load.days[0].peakCnsPercent).toBe(30);
    // La somma nuda sarebbe 40: è la sovrastima che il dimezzamento evita.
    expect(load.days[0].dailyCnsPercent).toBe(40);
  });

  it('conta le giornate oltre la dose TDI', () => {
    const load = oxygenLoad([
      { startTime: '2026-06-14T10:00:00Z', durationS: 3600, metrics: { cnsPct: 30, otu: 200 } },
      { startTime: '2026-06-14T14:00:00Z', durationS: 3600, metrics: { cnsPct: 30, otu: 150 } },
      { startTime: '2026-06-15T10:00:00Z', durationS: 3600, metrics: { cnsPct: 10, otu: 90 } },
    ]);
    expect(load.days).toHaveLength(2);
    expect(load.daysOverOtu300).toBe(1);
    expect(load.worstOtuDay?.date).toBe('2026-06-14');
  });
});

describe('velocità sull’ultimo tratto', () => {
  /** Sosta a 5 m e poi uno sparo in superficie in pochi secondi. */
  function withFastExit(finalSeconds: number): Sample[] {
    const out: Sample[] = [];
    let t = 0;
    for (; t <= 120; t += 2) out.push({ t, depth: (t / 120) * 25 });
    for (; t <= 900; t += 2) out.push({ t, depth: 25 });
    for (; t <= 1080; t += 2) out.push({ t, depth: 25 - ((t - 900) / 180) * 20 });
    for (; t <= 1260; t += 2) out.push({ t, depth: 5 });
    const start = t;
    for (; t <= start + finalSeconds; t += 2) {
      out.push({ t, depth: Math.max(0, 5 * (1 - (t - start) / finalSeconds)) });
    }
    out.push({ t: t + 2, depth: 0 });
    return out;
  }

  it('misura il tratto dalla sosta alla superficie, che la finestra di 30 s nasconde', () => {
    // 5 metri in 6 secondi sono 50 m/min: il difetto che DAN misura come diffuso.
    const m = computeMetrics(makeDive(withFastExit(6)));
    expect(m.finalAscentFromM).toBeCloseTo(5, 0);
    expect(m.finalAscentRateMpm!).toBeGreaterThan(35);
    // La metrica su finestra mobile lo diluisce: è la ragione per cui questa
    // esiste come misura separata.
    expect(m.maxAscentRateMpm!).toBeLessThan(m.finalAscentRateMpm!);
  });

  it('una risalita finale lenta risulta lenta', () => {
    const m = computeMetrics(makeDive(withFastExit(60)));
    expect(m.finalAscentRateMpm!).toBeLessThan(8);
  });
});

describe('soste profonde e forma del profilo', () => {
  it('riconosce una sosta a metà della profondità massima', () => {
    // 40 m, risalita con due minuti fermi a 20 m: la regola pratica del manuale.
    const out: Sample[] = [];
    let t = 0;
    for (; t <= 120; t += 10) out.push({ t, depth: (t / 120) * 40 });
    for (; t <= 900; t += 10) out.push({ t, depth: 40 });
    for (; t <= 1020; t += 10) out.push({ t, depth: 40 - ((t - 900) / 120) * 20 });
    for (; t <= 1140; t += 10) out.push({ t, depth: 20 });
    for (; t <= 1260; t += 10) out.push({ t, depth: 20 - ((t - 1140) / 120) * 15 });
    for (; t <= 1440; t += 10) out.push({ t, depth: 5 });
    for (; t <= 1500; t += 10) out.push({ t, depth: Math.max(0, 5 - ((t - 1440) / 60) * 5) });
    const m = computeMetrics(makeDive(out));
    expect(m.deepStopS).toBeGreaterThanOrEqual(120);
    expect(m.deepStopDepthM).toBeCloseTo(20, 0);
    expect(m.safetyStopS).toBeGreaterThanOrEqual(180);
    expect(m.didSafetyStop).toBe(true);
  });

  it('una sosta di due minuti e mezzo non conta più come completa', () => {
    // Tre minuti è la soglia del manuale: 150 secondi erano più permissivi.
    const out: Sample[] = [];
    let t = 0;
    for (; t <= 60; t += 10) out.push({ t, depth: (t / 60) * 20 });
    for (; t <= 600; t += 10) out.push({ t, depth: 20 });
    for (; t <= 720; t += 10) out.push({ t, depth: 20 - ((t - 600) / 120) * 15 });
    for (; t <= 840; t += 10) out.push({ t, depth: 5 });
    for (; t <= 900; t += 10) out.push({ t, depth: Math.max(0, 5 - ((t - 840) / 60) * 5) });
    const m = computeMetrics(makeDive(out));
    expect(m.safetyStopS).toBeGreaterThanOrEqual(140);
    expect(m.safetyStopS).toBeLessThan(180);
    expect(m.didSafetyStop).toBe(false);
  });

  it('misura il dente di sega e dice se la parte profonda viene prima', () => {
    const square30 = computeMetrics(makeDive(square(30, 20 * 60, 9)));
    expect(square30.sawtoothMPerHour).toBeLessThan(1);
    expect(square30.deepestPartFirst).toBe(true);

    // Tre risalite e ridiscese da dieci metri: il profilo che il manuale dice di evitare.
    const saw: Sample[] = [];
    let t = 0;
    for (; t <= 120; t += 10) saw.push({ t, depth: (t / 120) * 30 });
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let k = 0; k < 12; k++, t += 10) saw.push({ t, depth: 30 - k * 2 });
      for (let k = 0; k < 12; k++, t += 10) saw.push({ t, depth: 6 + k * 2 });
    }
    for (; t <= 2000; t += 10) saw.push({ t, depth: Math.max(0, 30 - (t - 1800) * 0.15) });
    const m = computeMetrics(makeDive(saw));
    expect(m.sawtoothMPerHour!).toBeGreaterThan(50);
  });

  it('segnala un cambio di gas fatto sotto la MOD del gas di destinazione', () => {
    const samples: Sample[] = [];
    let t = 0;
    for (; t <= 120; t += 10) samples.push({ t, depth: (t / 120) * 40, gasIndex: 0 });
    for (; t <= 600; t += 10) samples.push({ t, depth: 40, gasIndex: 0 });
    // Passaggio all'ossigeno a 40 m: MOD 1.6 bar ≈ 6 m. Errore grave.
    for (; t <= 900; t += 10) samples.push({ t, depth: 40, gasIndex: 1 });
    for (; t <= 1200; t += 10) samples.push({ t, depth: Math.max(0, 40 - (t - 900) * 0.13), gasIndex: 1 });
    const dive = makeDive(samples, {
      cylinders: [
        { mix: AIR, sizeL: 12, startBar: 200, endBar: 70 },
        { mix: { o2: 1, he: 0 }, sizeL: 7, startBar: 200, endBar: 150 },
      ],
    });
    expect(computeMetrics(dive).badGasSwitches).toBe(1);
  });

  it('lo stesso cambio fatto alla profondità giusta non è un errore', () => {
    const samples: Sample[] = [];
    let t = 0;
    for (; t <= 120; t += 10) samples.push({ t, depth: (t / 120) * 40, gasIndex: 0 });
    for (; t <= 600; t += 10) samples.push({ t, depth: 40, gasIndex: 0 });
    for (; t <= 900; t += 10) samples.push({ t, depth: Math.max(6, 40 - (t - 600) * 0.12), gasIndex: 0 });
    for (; t <= 1200; t += 10) samples.push({ t, depth: 6, gasIndex: 1 });
    for (; t <= 1260; t += 10) samples.push({ t, depth: Math.max(0, 6 - (t - 1200) * 0.1), gasIndex: 1 });
    const dive = makeDive(samples, {
      cylinders: [
        { mix: AIR, sizeL: 12, startBar: 200, endBar: 70 },
        { mix: { o2: 1, he: 0 }, sizeL: 7, startBar: 200, endBar: 150 },
      ],
    });
    expect(computeMetrics(dive).badGasSwitches).toBe(0);
  });
});
