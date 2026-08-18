import { describe, expect, it } from 'vitest';
import {
  correlation,
  histogram,
  medianOf,
  pairsOf,
  quartilesOf,
  settingsPeriods,
  tempByMonth,
  aggregate,
} from '../src/core/analysis/aggregate';
import { buildPlan, debriefDive } from '../src/core/analysis/coaching';
import { computeMetrics } from '../src/core/analysis/metrics';
import type { Dive, Sample } from '../src/core/model';
import { AIR } from '../src/core/model';
import { synthesise } from './fixtures';

const DAY = 86_400_000;
const NOW = new Date('2026-08-17T12:00:00Z').getTime();

/** Costruisce un archivio sintetico di N immersioni con caratteristiche date. */
function archive(
  n: number,
  spec: Parameters<typeof synthesise>[0] = {},
  opts: { everyDays?: number; endingDaysAgo?: number } = {},
): Dive[] {
  const everyDays = opts.everyDays ?? 10;
  const endingDaysAgo = opts.endingDaysAgo ?? 5;
  const out: Dive[] = [];
  for (let i = 0; i < n; i++) {
    const startTime = new Date(NOW - (endingDaysAgo + (n - 1 - i) * everyDays) * DAY);
    const s = synthesise({ ...spec, startTime });
    const samples: Sample[] = s.samples.map((w) => ({
      t: w.t,
      depth: w.depth,
      tempC: w.tempC,
      pressureBar: [w.bar],
      ceiling: w.ceiling > 0 ? w.ceiling : undefined,
      inDeco: w.ceiling > 0,
    }));
    const dive: Dive = {
      id: `d${i}`,
      number: i + 1,
      startTime: startTime.toISOString(),
      durationS: s.spec.durationS,
      maxDepth: Math.max(...s.samples.map((w) => w.depth)),
      minTempC: s.spec.minTempC,
      site: { name: s.spec.siteName },
      mode: 'oc',
      cylinders: [
        { mix: AIR, sizeL: s.spec.tankSizeL, startBar: s.spec.startBar, endBar: s.endBar },
      ],
      salinity: 'salt',
      source: { format: 'uddf', file: 'synth', importedAt: new Date(NOW).toISOString() },
      tags: [],
      samples,
    };
    dive.metrics = computeMetrics(dive);
    dive.avgDepth = dive.metrics.avgDepth;
    out.push(dive);
  }
  return out;
}

describe('aggregate', () => {
  it('conta e riassume', () => {
    const dives = archive(12);
    const a = aggregate(dives, NOW);
    expect(a.count).toBe(12);
    expect(a.withProfile).toBe(12);
    expect(a.daysSinceLastDive).toBe(5);
    expect(a.topSites[0].dives).toBe(12);
    expect(a.byMonth).toHaveLength(24);
    expect(a.rmv.length).toBe(12);
    expect(a.avgRmv).toBeGreaterThan(10);
  });

  it('rileva un consumo in peggioramento', () => {
    const good = archive(6, { rmvLpm: 14 }, { endingDaysAgo: 200 });
    const bad = archive(6, { rmvLpm: 24 }, { endingDaysAgo: 5 });
    const a = aggregate([...good, ...bad], NOW);
    expect(a.rmvTrend?.direction).toBe('worsening');
    expect(a.rmvTrend!.secondHalf).toBeGreaterThan(a.rmvTrend!.firstHalf);
  });

  it('rileva un assetto in miglioramento', () => {
    const old = archive(6, { wobbleM: 3, wobblePeriodS: 60 }, { endingDaysAgo: 300 });
    const recent = archive(6, { wobbleM: 0.2 }, { endingDaysAgo: 5 });
    const a = aggregate([...old, ...recent], NOW);
    expect(a.trimTrend?.direction).toBe('improving');
  });

  it('non calcola una tendenza su pochi punti', () => {
    const a = aggregate(archive(3), NOW);
    expect(a.rmvTrend).toBeUndefined();
  });
});

describe('piano di miglioramento', () => {
  it('non si pronuncia senza dati sufficienti', () => {
    const dives = archive(2);
    const a = aggregate(dives, NOW);
    const plan = buildPlan(dives, a, 'general');
    // Con due immersioni nessuna regola basata su medie deve attivarsi.
    expect(plan.findings.filter((f) => ['gas', 'buoyancy', 'ascent'].includes(f.area))).toHaveLength(0);
  });

  it('segnala il consumo alto e propone esercizi', () => {
    const dives = archive(12, { rmvLpm: 28 });
    const plan = buildPlan(dives, aggregate(dives, NOW), 'general');
    const gas = plan.findings.find((f) => f.id === 'gas-level');
    expect(gas).toBeDefined();
    expect(gas!.severity).toBe('serious');
    expect(gas!.drills.length).toBeGreaterThan(2);
    expect(gas!.evidence[0]).toContain('L/min');
    expect(gas!.basis).toBe(12);
  });

  it('riconosce un consumo basso come punto di forza', () => {
    const dives = archive(12, { rmvLpm: 13 });
    const plan = buildPlan(dives, aggregate(dives, NOW), 'general');
    expect(plan.strengths.some((f) => f.id === 'gas-level-excellent')).toBe(true);
  });

  it('mette la violazione del tetto deco al primo posto', () => {
    // Profilo che sale sopra il tetto: violazione deliberata.
    const dives = archive(10);
    dives[0].samples = [
      { t: 0, depth: 0 },
      { t: 60, depth: 40 },
      { t: 1500, depth: 40, ceiling: 12, inDeco: true },
      { t: 1700, depth: 4, ceiling: 12, inDeco: true },
      { t: 1900, depth: 4, ceiling: 9, inDeco: true },
      { t: 2100, depth: 0 },
    ];
    dives[0].metrics = computeMetrics(dives[0]);
    const plan = buildPlan(dives, aggregate(dives, NOW), 'tec');
    expect(plan.focus[0].id).toBe('ceiling-violation');
    expect(plan.focus[0].severity).toBe('critical');
  });

  it('segnala una pausa lunga', () => {
    const dives = archive(10, {}, { endingDaysAgo: 200, everyDays: 10 });
    const plan = buildPlan(dives, aggregate(dives, NOW), 'general');
    const currency = plan.findings.find((f) => f.id === 'currency-layoff');
    expect(currency).toBeDefined();
    expect(currency!.severity).toBe('serious');
  });

  it('limita il focus a tre priorità', () => {
    const dives = archive(14, { rmvLpm: 30, wobbleM: 4, ascentRateMpm: 22, safetyStopS: 0 });
    const plan = buildPlan(dives, aggregate(dives, NOW), 'tec');
    expect(plan.focus.length).toBeLessThanOrEqual(3);
    expect(plan.findings.length).toBeGreaterThan(3);
  });

  it('ogni valutazione dichiara i numeri su cui si basa', () => {
    const dives = archive(14, { rmvLpm: 30, wobbleM: 4 });
    const plan = buildPlan(dives, aggregate(dives, NOW), 'general');
    for (const f of plan.findings) {
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(f.basis).toBeGreaterThan(0);
    }
  });
});

describe('preparazione all\'obiettivo', () => {
  it('un archivio scarso non è pronto per il tecnico', () => {
    const dives = archive(8, { maxDepth: 18 });
    const plan = buildPlan(dives, aggregate(dives, NOW), 'tec');
    expect(plan.readiness.score).toBeLessThan
      ? expect(plan.readiness.score).toBeLessThan(0.7)
      : undefined;
    expect(plan.readiness.items.some((i) => !i.met)).toBe(true);
  });

  it('un archivio profondo, frequente e pulito si avvicina', () => {
    const dives = archive(
      40,
      { maxDepth: 36, rmvLpm: 16, wobbleM: 0.3, ascentRateMpm: 8, safetyStopS: 300, decoCeilingM: 6 },
      { everyDays: 8, endingDaysAgo: 4 },
    );
    const plan = buildPlan(dives, aggregate(dives, NOW), 'tec');
    expect(plan.readiness.score).toBeGreaterThan(0.7);
    expect(plan.readiness.verdict.length).toBeGreaterThan(10);
  });

  it('i criteri "non superare" sono marcati come tali', () => {
    const dives = archive(12);
    const plan = buildPlan(dives, aggregate(dives, NOW), 'tec');
    const rmv = plan.readiness.items.find((i) => i.label.includes('Consumo'));
    expect(rmv?.lowerIsBetter).toBe(true);
  });
});

describe('debrief di una singola immersione', () => {
  it('ordina le osservazioni per gravità', () => {
    const dives = archive(1, { ascentRateMpm: 25, safetyStopS: 0, rmvLpm: 30 });
    const obs = debriefDive(dives[0]);
    expect(obs.length).toBeGreaterThan(1);
    const order = ['critical', 'serious', 'warning', 'good'];
    const indices = obs.map((o) => order.indexOf(o.severity));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('riconosce un\'immersione ben eseguita', () => {
    const dives = archive(1, { ascentRateMpm: 8, safetyStopS: 300, rmvLpm: 15, wobbleM: 0.2 });
    const obs = debriefDive(dives[0]);
    expect(obs.every((o) => o.severity === 'good')).toBe(true);
  });

  it('non produce nulla senza metriche', () => {
    const dive = { ...archive(1)[0] };
    delete dive.metrics;
    expect(debriefDive(dive)).toHaveLength(0);
  });
});

describe('analisi aggiuntive sull’archivio', () => {
  const dive = (over: Partial<Dive>): Dive => ({
    id: Math.random().toString(36).slice(2),
    startTime: '2026-06-14T10:00:00Z',
    durationS: 2400,
    maxDepth: 30,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 } }],
    source: { format: 'logtrak', file: 'a', importedAt: 'x' },
    tags: [],
    ...over,
  });

  it('la correlazione tace sotto le cinque coppie', () => {
    expect(correlation([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }])).toBeUndefined();
    expect(correlation([1, 2, 3, 4, 5, 6].map((v) => ({ x: v, y: v })))).toBe(1);
    expect(correlation([1, 2, 3, 4, 5, 6].map((v) => ({ x: v, y: -v })))).toBe(-1);
  });

  it('la correlazione tace anche quando una delle due misure è costante', () => {
    // Con varianza zero il coefficiente sarebbe una divisione per zero: NaN
    // mostrato come "r NaN" sarebbe peggio di un trattino.
    expect(correlation([1, 2, 3, 4, 5, 6].map((v) => ({ x: v, y: 7 })))).toBeUndefined();
  });

  it('le coppie escludono le immersioni a cui manca una delle due misure', () => {
    const dives = [
      dive({ avgDepth: 20, metrics: { rmvLpm: 18 } as Dive['metrics'] }),
      dive({ avgDepth: undefined, metrics: { rmvLpm: 19 } as Dive['metrics'] }),
      dive({ avgDepth: 22, metrics: undefined }),
    ];
    const pairs = pairsOf(dives, (d) => d.avgDepth, (d) => d.metrics?.rmvLpm);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ x: 20, y: 18 });
  });

  it('l’istogramma tiene aperto l’ultimo intervallo', () => {
    const bins = histogram([1, 4, 7, 25, 40], [0, 3, 6, 9]);
    expect(bins.map((b) => b.count)).toEqual([1, 1, 1, 2]);
    expect(bins[bins.length - 1].label).toMatch(/^oltre 9/);
  });

  it('riconosce i periodi con impostazioni diverse del computer', () => {
    const dives = [
      // Il GF99 di periodo ora viene dal NOSTRO modello (`metrics.gf99Pct`) e
      // non da quello del computer: è l'unico che esiste su tutte le immersioni
      // con un profilo, quindi l'unico su cui una media per periodo non abbia
      // buchi a seconda di quale strumento ha scritto il file.
      dive({ startTime: '2025-05-31T10:00:00Z', computer: { gfLow: 45, gfHigh: 95 }, metrics: { gf99Pct: 67 } as Dive['metrics'] }),
      dive({ startTime: '2025-07-05T10:00:00Z', computer: { gfLow: 45, gfHigh: 95 }, metrics: { gf99Pct: 71 } as Dive['metrics'] }),
      dive({ startTime: '2026-03-08T10:00:00Z', computer: { gfLow: 20, gfHigh: 85 }, metrics: { gf99Pct: 60 } as Dive['metrics'] }),
    ];
    const periods = settingsPeriods(dives);
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({ label: 'GF 45/95', dives: 2, from: '2025-05-31', to: '2025-07-05' });
    expect(periods[0].avgGf99).toBeCloseTo(69, 0);
    expect(periods[1]).toMatchObject({ label: 'GF 20/85', dives: 1 });
  });

  it('la temperatura per mese usa il mese vero e non quello locale', () => {
    const months = tempByMonth([
      dive({ startTime: '2026-01-15T10:00:00Z', minTempC: 12 }),
      dive({ startTime: '2026-01-20T10:00:00Z', minTempC: 14 }),
      dive({ startTime: '2026-08-15T10:00:00Z', minTempC: 25 }),
    ]);
    expect(months[0]).toMatchObject({ label: 'gen', value: 13 });
    expect(months[7]).toMatchObject({ label: 'ago', value: 25 });
    expect(months[3].value).toBe(0);
  });
});

/**
 * Il prezzo delle ripetitive.
 *
 * È l'unica regola del progetto che si basa su un confronto fra due esecuzioni
 * dello stesso profilo — quella vera e quella rigiocata da tessuti puliti — e per
 * questo l'errore da temere non è un numero sbagliato ma un numero che compare
 * dove non dovrebbe: su immersioni che ripetitive non sono.
 */
describe('ripetitive', () => {
  const dive = (over: Partial<Dive>): Dive => ({
    id: Math.random().toString(36).slice(2),
    startTime: '2026-06-14T10:00:00Z',
    durationS: 2400,
    maxDepth: 30,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 } }],
    source: { format: 'logtrak', file: 'a', importedAt: 'x' },
    tags: [],
    ...over,
  });

  const rip = (id: string, gf99: number, clean: number, si: number): Dive =>
    dive({
      id,
      startTime: `2026-06-0${id}T13:00:00Z`,
      metrics: {
        gf99Pct: gf99,
        gf99CleanPct: clean,
        surfaceIntervalMin: si,
        quality: { sampleCount: 240 },
      } as unknown as Dive['metrics'],
    });

  it('non dice niente finché non ce ne sono abbastanza', () => {
    const agg = aggregate([rip('1', 70, 64, 60), rip('2', 68, 63, 70)]);
    expect(agg.repetitiveDives).toBe(2);
    expect(buildPlan([], agg).findings.some((f) => f.id.startsWith('repetitive'))).toBe(false);
  });

  it('misura il costo mediano e il caso peggiore', () => {
    const agg = aggregate([rip('1', 70, 64, 60), rip('2', 68, 63, 70), rip('3', 75, 62, 30)]);
    expect(agg.repetitiveDives).toBe(3);
    expect(agg.repetitiveCostMedian).toBeCloseTo(6, 1);
    expect(agg.repetitiveCostWorst?.points).toBeCloseTo(13, 1);
    expect(agg.repetitiveCostWorst?.surfaceIntervalMin).toBe(30);
    expect(agg.surfaceIntervalMedian).toBe(60);
  });

  it('quando costano poco lo dice come una cosa buona', () => {
    const agg = aggregate([rip('1', 65, 64, 180), rip('2', 66, 65, 200), rip('3', 64, 63, 240)]);
    const f = buildPlan([], agg).findings.find((x) => x.id.startsWith('repetitive'));
    expect(f?.id).toBe('repetitive-good');
    expect(f?.severity).toBe('good');
  });

  it('quando costano parecchio la regola compare e non prescrive nulla', () => {
    const agg = aggregate([rip('1', 75, 62, 30), rip('2', 78, 65, 25), rip('3', 74, 63, 40)]);
    const f = buildPlan([], agg).findings.find((x) => x.id === 'repetitive');
    expect(f).toBeDefined();
    // Il numero c'è, l'ordine di aspettare no: quanto durare una pausa lo decide la
    // barca, il gruppo e il freddo, non un'app.
    expect(f!.headline).toMatch(/punti di GF99/);
    expect(f!.detail).not.toMatch(/aspetta|allunga l’intervallo di almeno/i);
    expect(f!.evidence.join(' ')).toMatch(/rigiocando la stessa immersione/);
  });

  it('un archivio senza ripetitive non produce la regola né numeri', () => {
    const agg = aggregate([dive({ id: 'a' }), dive({ id: 'b' })]);
    expect(agg.repetitiveDives).toBe(0);
    expect(agg.repetitiveCostMedian).toBeUndefined();
    expect(buildPlan([], agg).findings.some((f) => f.id.startsWith('repetitive'))).toBe(false);
  });
})

/**
 * Una grandezza, una mediana.
 *
 * `quartilesOf` prendeva l'elemento centrale invece della mediana vera: con un
 * numero pari di immersioni le pagine mostravano 5.4 e i quartili 5.6 per lo
 * stesso archivio, e non c'è modo per chi legge di capire quale dei due creda.
 */
describe('mediane', () => {
  it('il p50 dei quartili è la mediana, anche col numero pari di valori', () => {
    const pari = [1, 2, 3, 4, 5, 6];
    expect(quartilesOf(pari)!.p50).toBe(medianOf(pari));
    expect(quartilesOf(pari)!.p50).toBe(3.5);
    const dispari = [1, 2, 3, 4, 5];
    expect(quartilesOf(dispari)!.p50).toBe(medianOf(dispari));
  });

  it('tace sotto le cinque misure invece di chiamare quartile una immersione', () => {
    expect(quartilesOf([1, 2, 3, 4])).toBeUndefined();
  });
});

/**
 * Zero e "non misurato" non sono la stessa cosa.
 *
 * Con un archivio senza pressioni il consumo non esiste, e il criterio di
 * prontezza lo dichiarava «0 L/min»: un valore che il confronto «non oltre 20»
 * legge come ottimo, quando in realtà nessuno l'ha mai misurato.
 */
describe('criteri di prontezza con dati mancanti', () => {
  it('un consumo mai misurato resta indefinito e il criterio non è soddisfatto', () => {
    // Un archivio senza pressioni: nessuna immersione permette di ricavare il
    // consumo, quindi la media non esiste.
    const dives = archive(30).map((d) => {
      const senza: Dive = {
        ...d,
        cylinders: d.cylinders.map((c) => ({ ...c, startBar: undefined, endBar: undefined })),
        samples: d.samples!.map((sm) => ({ ...sm, pressureBar: undefined })),
      };
      senza.metrics = computeMetrics(senza);
      return senza;
    });
    const agg = aggregate(dives, NOW);
    expect(agg.avgRmv).toBeUndefined();
    const rmv = buildPlan(dives, agg, 'general').readiness.items.find(
      (i) => i.label === 'Consumo di superficie',
    )!;
    expect(rmv.have).toBeUndefined();
    expect(rmv.met).toBe(false);
  });
});
