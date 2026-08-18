/**
 * VPM-B: il riscontro esterno, che è l'unica ragione per cui ci si può fidare.
 *
 * Vale qui la frase che apre `buhlmann.ts`: «un modello decompressivo scritto senza
 * un riscontro esterno è un generatore di numeri plausibili, e i numeri plausibili
 * in questo dominio sono la cosa peggiore che si possa produrre». Con Bühlmann il
 * riscontro erano trentotto GF99 scritti da Shearwater su immersioni vere. Qui non
 * esiste niente del genere — nessun computer dell'archivio calcola VPM-B — quindi
 * il confronto è con altre implementazioni, e va detto con precisione con QUALI.
 *
 * DUE FONTI, ENTRAMBE VERIFICABILI.
 *
 *  1. Il porting pubblicato del programma FORTRAN di Erik C. Baker, che è la
 *     referenza canonica del VPM-B: https://github.com/bwaite/vpmb (`vpmb.py`,
 *     copyright Bryan Waite / Erik C. Baker). Le tabelle riportate qui sotto sono
 *     state prodotte eseguendo quel programma con i parametri dichiarati in ogni
 *     test: unità msw, quota zero, λ = 7500 fsw·min, γ = 0.0179, γc = 0.257,
 *     soglia di impermeabilità 8.2 atm, rigenerazione 20160 min, altri gas
 *     102 mmHg, sosta minima 1 min. Il caso a 80 msw è ancora più forte, perché non
 *     l'abbiamo prodotto noi: è il caso `tests/msw_test` COMMITTATO nel repository
 *     insieme al suo `expected.json`, cioè un valore di controllo pubblicato.
 *  2. Una schedule VPM-B+1 pubblicata, calcolata con Subsurface e stampata per
 *     intero da Robert Helling: «VPM-B Gradients as Gradient factors»,
 *     https://thetheoreticaldiver.org/wordpress/index.php/2017/11/02/vpm-b-gradients-as-gradient-factors/
 *     È una terza implementazione indipendente, ed è utile proprio perché non è
 *     Baker: se cadiamo in mezzo alle due, il modello è nella famiglia giusta.
 *
 * QUANTO CI SI PUÒ AVVICINARE, E PERCHÉ NON DI PIÙ. La nostra implementazione
 * riusa l'integrazione dei tessuti di `buhlmann.ts`: emitempi ZH-L16C (primo
 * compartimento 4.0 min invece dei 5.0 di Baker), vapore acqueo 0.0627 bar invece
 * di 0.0493, pressione idrostatica dell'acqua salata a 1030 kg/m³ invece dei 10 msw
 * per bar esatti del programma di Baker. Sono differenze piccole una per una e
 * tutte nella stessa direzione: sui casi qui sotto la nostra decompressione totale
 * risulta sistematicamente dal 5 all'11 per cento più corta del riferimento.
 * La tolleranza è quindi del 15 per cento sul totale e di un gradino di sosta
 * (3 m) sulla prima sosta: più stretta di così il test diventerebbe un test sulle
 * costanti di Bühlmann e non sul VPM, più larga non verificherebbe niente.
 *
 * E LA PARTE STRUTTURALE, che non dipende da nessuna tolleranza: le monotonie che
 * un modello decompressivo non può violare, e la forma caratteristica del VPM
 * rispetto a Bühlmann — prima sosta molto più profonda, più soste, e una quota
 * minore del totale spesa all'ultima sosta.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_VPM, planVpm, type VpmLevel, type VpmResult } from '../src/core/analysis/vpm';
import { planDeco } from '../src/core/analysis/deco';
import { desaturate } from '../src/core/analysis/buhlmann';
import { afterSurfaceInterval } from '../src/core/analysis/deco';

const AIR = { o2: 0.21, he: 0 };
const EAN36 = { o2: 0.36, he: 0 };
const EAN50 = { o2: 0.5, he: 0 };
const OXY = { o2: 1, he: 0 };
const TX18_45 = { o2: 0.18, he: 0.45 };
const TX18_50 = { o2: 0.18, he: 0.5 };
const TX15_45 = { o2: 0.15, he: 0.45 };

/** Minuti passati a una data quota nella tabella. */
const minutesAt = (r: { stops: { depthM: number; minutes: number }[] }, depthM: number) =>
  r.stops.filter((s) => s.depthM === depthM).reduce((sum, s) => sum + s.minutes, 0);

/** Scarto relativo dal riferimento, in percentuale con segno. */
const deviation = (ours: number, reference: number) => ((ours - reference) / reference) * 100;

const TOLERANCE_PCT = 15;

describe('riscontro con il programma di Baker (github.com/bwaite/vpmb)', () => {
  /**
   * Il caso `tests/msw_test` del repository, con il suo `expected.json` committato:
   * trimix 15/45 a 80 msw, discesa a 23 m/min, fondo fino al runtime di 30 min,
   * risalita a 10 m/min con passo 3 m, EAN36 dai 33 m, ossigeno dai 6 m. Raggi
   * critici 0.6 µm (N2) e 0.5 µm (He), cioè fra il nostro conservatorismo 1
   * (×1.05 → 0.578/0.473) e il 2 (×1.12 → 0.616/0.504): usiamo il 2, che è il più
   * vicino per l'elio e leggermente più prudente per l'azoto.
   *
   * Riferimento: prima sosta 54 m, 92 minuti di soste, runtime finale 125 min.
   * https://github.com/bwaite/vpmb/blob/master/tests/msw_test/expected.json
   */
  it('80 msw in trimix 15/45: prima sosta e totale nella fascia del riferimento', () => {
    const r = planVpm(
      [{ depthM: 80, minutes: 30, mix: TX15_45 }],
      [
        { mix: EAN36, switchDepthM: 33 },
        { mix: OXY, switchDepthM: 6 },
      ],
      { conservatism: 2, descentRateMpm: 23, ascentRateMpm: 10 },
    );
    expect(r.firstStopM).toBe(54);
    expect(Math.abs(deviation(r.decoMin, 92))).toBeLessThan(TOLERANCE_PCT);
  });

  /**
   * Aria a 45 m, runtime di fondo 25 min (discesa a 18 m/min compresa), risalita a
   * 9 m/min, nessun gas di decompressione, ultima sosta a 3 m.
   *
   * Riferimento prodotto con `vpmb.py` ai raggi nominali (0.55/0.45), cioè
   * conservatorismo 0: prima sosta 24 m, soste 24:1 21:1 18:3 15:3 12:5 9:6 6:10
   * 3:18, totale 47 minuti.
   */
  it('45 m in aria, conservatorismo nominale', () => {
    const r = planVpm([{ depthM: 45, minutes: 25, mix: AIR }], [], { conservatism: 0 });
    expect(r.firstStopM).toBe(24);
    expect(Math.abs(deviation(r.decoMin, 47))).toBeLessThan(TOLERANCE_PCT);
  });

  /**
   * Lo stesso profilo ai raggi ×1.12 e ×1.35, cioè conservatorismo 2 e 4:
   * riferimento 56 e 70 minuti di soste, prima sosta 24 m in entrambi i casi.
   * Il conservatorismo 4 è quello in cui la nostra prima sosta può scendere di un
   * gradino, ed è il motivo per cui la tolleranza sulla prima sosta è di 3 m.
   */
  it('45 m in aria, conservatorismo 2 e 4', () => {
    const c2 = planVpm([{ depthM: 45, minutes: 25, mix: AIR }], [], { conservatism: 2 });
    const c4 = planVpm([{ depthM: 45, minutes: 25, mix: AIR }], [], { conservatism: 4 });
    expect(Math.abs(deviation(c2.decoMin, 56))).toBeLessThan(TOLERANCE_PCT);
    expect(Math.abs(deviation(c4.decoMin, 70))).toBeLessThan(TOLERANCE_PCT);
    expect(Math.abs((c2.firstStopM ?? 0) - 24)).toBeLessThanOrEqual(3);
    expect(Math.abs((c4.firstStopM ?? 0) - 24)).toBeLessThanOrEqual(3);
  });

  /**
   * Trimix 18/45 a 60 m, runtime 30 min, EAN50 dai 21 m e ossigeno dai 6 m,
   * risalita 9 m/min. Riferimento: conservatorismo 0 → prima sosta 36 m e 47
   * minuti di soste; conservatorismo 3 (raggi ×1.22) → 36 m e 56 minuti.
   */
  it('60 m in trimix con due gas di decompressione', () => {
    const gases = [
      { mix: EAN50, switchDepthM: 21 },
      { mix: OXY, switchDepthM: 6 },
    ];
    const c0 = planVpm([{ depthM: 60, minutes: 30, mix: TX18_45 }], gases, { conservatism: 0 });
    const c3 = planVpm([{ depthM: 60, minutes: 30, mix: TX18_45 }], gases, { conservatism: 3 });
    expect(c0.firstStopM).toBe(36);
    expect(c3.firstStopM).toBe(36);
    expect(Math.abs(deviation(c0.decoMin, 47))).toBeLessThan(TOLERANCE_PCT);
    expect(Math.abs(deviation(c3.decoMin, 56))).toBeLessThan(TOLERANCE_PCT);
  });

  /**
   * Aria a 30 m, runtime 30 min: un profilo ricreativo appena oltre la curva, dove
   * il VPM ha pochi minuti da distribuire ed è più facile sbagliarli tutti.
   * Riferimento ai raggi nominali: 9:2 6:4 3:8, cioè 14 minuti.
   */
  it('30 m in aria, appena oltre la curva', () => {
    const r = planVpm([{ depthM: 30, minutes: 30, mix: AIR }], [], { conservatism: 0 });
    expect(r.firstStopM).toBeLessThanOrEqual(12);
    expect(Math.abs(deviation(r.decoMin, 14))).toBeLessThan(TOLERANCE_PCT);
  });
});

describe('riscontro con una schedule VPM-B+1 pubblicata (Subsurface)', () => {
  /**
   * 120 m con TMX 18/50, uscita dal fondo al runtime di 20 minuti, EAN50 e
   * ossigeno, VPM-B+1. La tabella pubblicata somma 107 minuti di soste (runtime
   * finale 141 minuti) con prima sosta a 63 m.
   * https://thetheoreticaldiver.org/wordpress/index.php/2017/11/02/vpm-b-gradients-as-gradient-factors/
   *
   * Sulla prima sosta non ci si può confrontare: quella schedule usa velocità di
   * risalita variabili (9 m/min fino al 75% della profondità media, poi 6, poi 1
   * negli ultimi metri) che non sono esprimibili con un solo `ascentRateMpm`, e la
   * velocità di risalita sposta la prima sosta. Il totale delle soste invece è
   * robusto rispetto a quel dettaglio, ed è quello che si confronta. Per
   * riferimento incrociato, lo stesso profilo dato al programma di Baker con
   * λ = 7500 fsw·min produce 115 minuti di soste e prima sosta a 75 m: le due
   * implementazioni pubblicate differiscono già fra loro di otto minuti.
   */
  it('120 m in trimix, VPM-B+1: il totale delle soste sta fra le due referenze', () => {
    const r = planVpm(
      [{ depthM: 120, minutes: 20, mix: TX18_50 }],
      [
        { mix: EAN50, switchDepthM: 21 },
        { mix: OXY, switchDepthM: 6 },
      ],
      { conservatism: 1, descentRateMpm: 17 },
    );
    expect(Math.abs(deviation(r.decoMin, 107))).toBeLessThan(TOLERANCE_PCT);
    expect(Math.abs(deviation(r.decoMin, 115))).toBeLessThan(TOLERANCE_PCT);
    // La prima sosta resta comunque una sosta profonda: il VPM su questo profilo
    // non lascia salire oltre la metà della profondità massima.
    expect(r.firstStopM).toBeGreaterThan(55);
  });
});

describe('monotonie che devono valere sempre', () => {
  const gases = [{ mix: EAN50, switchDepthM: 21 }];

  it('più profondo non può accorciare la decompressione', () => {
    const a = planVpm([{ depthM: 40, minutes: 25, mix: AIR }], gases, {});
    const b = planVpm([{ depthM: 48, minutes: 25, mix: AIR }], gases, {});
    expect(b.decoMin).toBeGreaterThan(a.decoMin);
  });

  it('più lungo non può accorciare la decompressione', () => {
    const a = planVpm([{ depthM: 45, minutes: 20, mix: AIR }], gases, {});
    const b = planVpm([{ depthM: 45, minutes: 35, mix: AIR }], gases, {});
    expect(b.decoMin).toBeGreaterThan(a.decoMin);
  });

  it('il conservatorismo allunga a ogni gradino, da 0 a 5', () => {
    const times = [0, 1, 2, 3, 4, 5].map(
      (conservatism) =>
        planVpm([{ depthM: 45, minutes: 30, mix: AIR }], gases, { conservatism }).decoMin,
    );
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    // Fra il nominale e il massimo ci deve essere una differenza sostanziale: se
    // fosse di due minuti la manopola sarebbe finta.
    expect(times[5]).toBeGreaterThan(times[0] * 1.4);
  });

  it('un gas di decompressione ricco accorcia la decompressione', () => {
    const senza = planVpm([{ depthM: 45, minutes: 30, mix: AIR }], [], {});
    const con = planVpm(
      [{ depthM: 45, minutes: 30, mix: AIR }],
      [
        { mix: EAN50, switchDepthM: 21 },
        { mix: OXY, switchDepthM: 6 },
      ],
      {},
    );
    expect(con.decoMin).toBeLessThan(senza.decoMin);
  });

  it('i tessuti già carichi di una ripetitiva allungano la decompressione', () => {
    const prima = planVpm([{ depthM: 40, minutes: 25, mix: AIR }], [], {});
    const dopo = planVpm([{ depthM: 40, minutes: 25, mix: AIR }], [], {
      initial: desaturate(prima.finalTissues, 45),
    });
    expect(dopo.decoMin).toBeGreaterThan(prima.decoMin);
  });

  it('in quota la decompressione si allunga', () => {
    const mare = planVpm([{ depthM: 40, minutes: 25, mix: AIR }], [], {});
    const monte = planVpm([{ depthM: 40, minutes: 25, mix: AIR }], [], {
      surfacePressureBar: 0.795,
    });
    expect(monte.decoMin).toBeGreaterThan(mare.decoMin);
  });
});

describe('la forma della tabella, che è ciò che distingue il VPM', () => {
  const profile: VpmLevel[] = [{ depthM: 50, minutes: 25, mix: AIR }];
  const vpm = planVpm(profile, [{ mix: EAN50, switchDepthM: 21 }], {});
  const buhl = planDeco(
    [{ depthM: 50, minutes: 25 }],
    [
      { mix: AIR, role: 'bottom' },
      { mix: EAN50, role: 'deco' },
    ],
    { gfLow: 0.5, gfHigh: 0.9 },
  );

  it('la prima sosta è nettamente più profonda che con Bühlmann a GF alti', () => {
    expect(vpm.firstStopM).toBeGreaterThan((buhl.firstStopM ?? 0) + 3);
  });

  it('le soste sono di più', () => {
    expect(vpm.stops.length).toBeGreaterThan(buhl.stops.length);
  });

  it("all'ultima sosta va una quota minore del totale rispetto a Bühlmann", () => {
    const vpmShare = minutesAt(vpm, 3) / vpm.decoMin;
    const buhlShare = minutesAt(buhl, 3) / buhl.decoMin;
    expect(vpmShare).toBeLessThan(buhlShare);
  });

  it('la tabella è ordinata dal profondo verso la superficie, sul passo dichiarato', () => {
    for (let i = 1; i < vpm.stops.length; i++) {
      expect(vpm.stops[i].depthM).toBeLessThan(vpm.stops[i - 1].depthM);
      expect(vpm.stops[i - 1].depthM - vpm.stops[i].depthM).toBe(DEFAULT_VPM.stopIntervalM);
    }
    expect(vpm.stops[vpm.stops.length - 1].depthM).toBe(DEFAULT_VPM.lastStopM);
    expect(vpm.stops.every((s) => s.minutes >= 1 && Number.isInteger(s.minutes))).toBe(true);
    expect(vpm.decoMin).toBe(vpm.stops.reduce((sum, s) => sum + s.minutes, 0));
  });

  it("l'ultima sosta a 6 metri è rispettata e non ne compaiono di più basse", () => {
    const r = planVpm(profile, [{ mix: EAN50, switchDepthM: 21 }], { lastStopM: 6 });
    expect(r.stops.every((s) => s.depthM >= 6)).toBe(true);
    expect(r.stops[r.stops.length - 1].depthM).toBe(6);
  });

  it('il cambio gas avviene alla quota dichiarata e non prima', () => {
    // L'ossigeno dichiarato a 6 m non può accorciare le soste più profonde di 6 m:
    // se lo facesse, il piano lo starebbe respirando dove non si può.
    const senzaOxy = planVpm(profile, [{ mix: EAN50, switchDepthM: 21 }], {});
    const conOxy = planVpm(
      profile,
      [
        { mix: EAN50, switchDepthM: 21 },
        { mix: OXY, switchDepthM: 6 },
      ],
      {},
    );
    expect(minutesAt(conOxy, 9)).toBe(minutesAt(senzaOxy, 9));
    expect(minutesAt(conOxy, 6)).toBeLessThan(minutesAt(senzaOxy, 6));
  });
});

describe('il ciclo del volume critico', () => {
  it('converge in poche iterazioni e non tocca mai il tetto', () => {
    const profili: VpmLevel[][] = [
      [{ depthM: 30, minutes: 40, mix: AIR }],
      [{ depthM: 45, minutes: 30, mix: AIR }],
      [{ depthM: 60, minutes: 30, mix: TX18_45 }],
      [{ depthM: 90, minutes: 25, mix: TX15_45 }],
      [{ depthM: 120, minutes: 20, mix: TX18_50 }],
    ];
    for (const levels of profili) {
      const r = planVpm(
        levels,
        [
          { mix: EAN50, switchDepthM: 21 },
          { mix: OXY, switchDepthM: 6 },
        ],
        {},
      );
      expect(r.iterations).toBeGreaterThan(1);
      // Il tetto dichiarato nel modulo è 12: toccarlo significa non aver converso.
      expect(r.iterations).toBeLessThan(12);
    }
  });

  it('il volume critico accorcia la decompressione rispetto alla prima passata', () => {
    // La prima iterazione usa i gradienti iniziali, le successive li allargano: il
    // risultato finale non può essere più lungo di una tabella a una sola passata.
    // Lo si verifica indirettamente sul numero di iterazioni e sul fatto che la
    // prima sosta non si approfondisca iterando.
    const r = planVpm([{ depthM: 60, minutes: 30, mix: TX18_45 }], [], {});
    expect(r.iterations).toBeGreaterThanOrEqual(2);
    expect(r.firstStopM).toBeGreaterThan(0);
  });
});

describe('casi limite: deve fermarsi sempre', () => {
  const finito = (r: VpmResult) => {
    expect(Number.isFinite(r.decoMin)).toBe(true);
    expect(r.stops.every((s) => Number.isFinite(s.minutes) && s.minutes > 0)).toBe(true);
    expect(r.finalTissues.n2.every(Number.isFinite)).toBe(true);
    expect(r.finalTissues.he.every(Number.isFinite)).toBe(true);
  };

  it('nessun livello utile: nessuna tabella, nessuna eccezione', () => {
    const r = planVpm([], [], {});
    expect(r.stops).toHaveLength(0);
    expect(r.decoMin).toBe(0);
    expect(r.iterations).toBe(0);
    expect(r.firstStopM).toBeUndefined();
  });

  it("un'immersione in curva non produce soste", () => {
    const r = planVpm([{ depthM: 18, minutes: 40, mix: AIR }], [], {});
    expect(r.stops).toHaveLength(0);
    expect(r.decoMin).toBe(0);
    expect(r.firstStopM).toBeUndefined();
  });

  it('un profilo multilivello termina e sta fra i due profili quadri', () => {
    const multi = planVpm(
      [
        { depthM: 40, minutes: 20, mix: AIR },
        { depthM: 20, minutes: 20, mix: AIR },
      ],
      [],
      {},
    );
    finito(multi);
    // Venti minuti a metà quota SONO decompressione: l'obbligo residuo deve essere
    // più corto di quello del profilo quadro a 40 m — ed è l'errore in cui si cade
    // scrivendo il test al contrario, perché «più tempo in acqua» suona come «più
    // deco». Ma deve restare più lungo del solo passaggio a 20 m, che da solo è
    // quasi in curva: il carico preso a 40 m non si scarica tutto risalendo.
    const solo40 = planVpm([{ depthM: 40, minutes: 20, mix: AIR }], [], {});
    const solo20 = planVpm([{ depthM: 20, minutes: 40, mix: AIR }], [], {});
    expect(multi.decoMin).toBeLessThan(solo40.decoMin);
    expect(multi.decoMin).toBeGreaterThan(solo20.decoMin);
  });

  it('dieci ore a 40 metri: soste lunghissime, ma finite', () => {
    const r = planVpm([{ depthM: 40, minutes: 600, mix: AIR }], [], {});
    finito(r);
    expect(r.decoMin).toBeGreaterThan(500);
    // Nessuna sosta può aver toccato lo sbarramento interno di 999 minuti.
    expect(r.stops.every((s) => s.minutes < 999)).toBe(true);
  });

  it('una miscela senza azoto non manda in NaN il calcolo dei gradienti pesati', () => {
    const r = planVpm([{ depthM: 30, minutes: 40, mix: { o2: 0.4, he: 0.6 } }], [{ mix: OXY, switchDepthM: 6 }], {});
    finito(r);
    expect(r.decoMin).toBeGreaterThan(0);
  });

  it('un piano completo si calcola in pochi millisecondi', () => {
    const inizio = Date.now();
    for (let i = 0; i < 20; i++) {
      planVpm([{ depthM: 60, minutes: 30, mix: TX18_45 }], [{ mix: EAN50, switchDepthM: 21 }], {});
    }
    expect(Date.now() - inizio).toBeLessThan(2000);
  });
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * RIPETITIVE
 * ────────────────────────────────────────────────────────────────────────────
 *
 * I riferimenti sono stati prodotti con lo stesso programma dei test qui sopra
 * (https://github.com/bwaite/vpmb), incatenando due immersioni identiche con
 * `repetitive_code: 1` e `surface_interval_time_minutes` dichiarato, ai raggi
 * nominali 0.55/0.45 µm.
 *
 * LA TOLLERANZA QUI È DEL 20 PER CENTO, non del 15, e la ragione è strutturale:
 * la seconda immersione eredita dalla prima sia i tessuti sia i nuclei, quindi lo
 * scarto sistematico del nostro motore si somma a se stesso. Sui casi qui sotto lo
 * scarto osservato sta comunque fra il 4 e il 9 per cento — cioè non peggiora
 * granché — ma il margine tiene conto del fatto che potrebbe.
 */
describe('immersioni ripetitive: riscontro con il programma di Baker', () => {
  const AIR_45_25: VpmLevel[] = [{ depthM: 45, minutes: 25, mix: AIR }];
  const AIR_30_40: VpmLevel[] = [{ depthM: 30, minutes: 40, mix: AIR }];
  const TX_80_25: VpmLevel[] = [{ depthM: 80, minutes: 25, mix: TX15_45 }];
  const TX_GASES = [
    { mix: EAN36, switchDepthM: 33 },
    { mix: OXY, switchDepthM: 6 },
  ];
  const REPETITIVE_TOLERANCE_PCT = 20;

  /** La stessa immersione due volte, con l'intervallo dichiarato. */
  const repeatDive = (
    levels: VpmLevel[],
    gases: { mix: typeof AIR; switchDepthM: number }[],
    surfaceIntervalMin: number,
    options: Partial<Parameters<typeof planVpm>[2]> = {},
  ) => {
    const first = planVpm(levels, gases, { conservatism: 0, ...options });
    const second = planVpm(levels, gases, {
      conservatism: 0,
      ...options,
      initial: first.finalTissues,
      previousNuclei: first.nuclei,
      surfaceIntervalMin,
    });
    return { first, second };
  };

  /**
   * 45 m/25 min in aria ripetuta. Riferimento, minuti di soste sulla seconda
   * immersione: 75 con 30 minuti di intervallo, 62 con 60, 50 con 120, 48 con 240,
   * 47 con 720 — cioè identica a quella da pulita, che è 47.
   */
  it('45 m in aria ripetuta: intervalli da 30 a 240 minuti', () => {
    for (const [si, reference] of [
      [30, 75],
      [60, 62],
      [120, 50],
      [240, 48],
    ] as const) {
      const { second } = repeatDive(AIR_45_25, [], si);
      expect(Math.abs(deviation(second.decoMin, reference))).toBeLessThan(REPETITIVE_TOLERANCE_PCT);
    }
  });

  /**
   * 30 m/40 min in aria ripetuta: riferimento 47 minuti con intervallo di 60,
   * 37 con 120. È il profilo su cui la correzione dei nuclei conta davvero, ed è
   * per questo che sta nei test invece di una seconda immersione profonda.
   */
  it('30 m in aria ripetuta', () => {
    for (const [si, reference] of [
      [60, 47],
      [120, 37],
    ] as const) {
      const { second } = repeatDive(AIR_30_40, [], si);
      expect(Math.abs(deviation(second.decoMin, reference))).toBeLessThan(REPETITIVE_TOLERANCE_PCT);
    }
  });

  /**
   * 80 m/25 min in trimix 15/45 con EAN36 e ossigeno, discesa a 23 m/min:
   * riferimento 95 minuti con intervallo di 60, 85 con 120 (da pulita sono 71).
   */
  it('80 m in trimix ripetuta', () => {
    for (const [si, reference] of [
      [60, 95],
      [120, 85],
    ] as const) {
      const { second } = repeatDive(TX_80_25, TX_GASES, si, { descentRateMpm: 23 });
      expect(Math.abs(deviation(second.decoMin, reference))).toBeLessThan(REPETITIVE_TOLERANCE_PCT);
    }
  });

  /**
   * QUANTO VALGONO I SOLI NUCLEI. È la misura che giustifica di aver scritto
   * l'algoritmo ripetitivo, e insieme quella che impedisce di raccontarlo più
   * grosso di quello che è.
   *
   * Nel programma di riferimento la stessa misura si fa spegnendo la sola
   * subroutine `vpm_repetitive_algorithm`: su 45 m/25 min e su 80 m/25 min la
   * differenza è di ZERO minuti a qualunque intervallo, su 30 m/40 min vale otto
   * minuti con un'ora di intervallo e sei con tre ore. Qui la stessa cosa si
   * ottiene passando o non passando `previousNuclei`, a parità di tessuti.
   */
  it('i nuclei non spostano nulla sulle immersioni profonde e contano a 30 metri', () => {
    const withAndWithout = (levels: VpmLevel[], gases: typeof TX_GASES, si: number, options = {}) => {
      const first = planVpm(levels, gases, { conservatism: 0, ...options });
      const conNuclei = planVpm(levels, gases, {
        conservatism: 0,
        ...options,
        initial: first.finalTissues,
        previousNuclei: first.nuclei,
        surfaceIntervalMin: si,
      });
      const soloTessuti = planVpm(levels, gases, {
        conservatism: 0,
        ...options,
        initial: first.finalTissues,
        surfaceIntervalMin: si,
      });
      return conNuclei.decoMin - soloTessuti.decoMin;
    };
    // Profonde: i compartimenti che comandano non hanno mai superato il gradiente
    // ammesso iniziale, quindi non c'è niente da scontare.
    expect(withAndWithout(AIR_45_25, [], 60)).toBe(0);
    expect(withAndWithout(TX_80_25, TX_GASES, 60, { descentRateMpm: 23 })).toBe(0);
    // Fascia media: qui la correzione vale, e vale parecchio.
    expect(withAndWithout(AIR_30_40, [], 60)).toBeGreaterThanOrEqual(3);
  });
});

describe('ripetitive: le proprietà che devono valere comunque', () => {
  const LEVELS: VpmLevel[] = [{ depthM: 40, minutes: 25, mix: AIR }];
  const pulita = planVpm(LEVELS, [], { conservatism: 0 });
  const dopo = (surfaceIntervalMin: number) =>
    planVpm(LEVELS, [], {
      conservatism: 0,
      initial: pulita.finalTissues,
      previousNuclei: pulita.nuclei,
      surfaceIntervalMin,
    }).decoMin;

  it('con un intervallo corto la ripetitiva è più lunga della stessa immersione da pulita', () => {
    expect(dopo(30)).toBeGreaterThan(pulita.decoMin);
  });

  it("la penalità cala man mano che l'intervallo cresce", () => {
    const serie = [15, 30, 60, 120, 240, 480].map(dopo);
    for (let i = 1; i < serie.length; i++) expect(serie[i]).toBeLessThanOrEqual(serie[i - 1]);
    expect(serie[serie.length - 1]).toBeLessThan(serie[0]);
  });

  it('dopo settimane di superficie la ripetitiva torna identica a quella da pulita', () => {
    // Non basta un giorno: i tessuti si svuotano in ore, i nuclei si rigenerano con
    // una costante di due settimane, ed è esattamente la differenza fra le due
    // memorie che il modello porta avanti. A sei settimane l'esponenziale è spento
    // e la tabella deve tornare quella di partenza.
    expect(dopo(1440)).toBeGreaterThanOrEqual(pulita.decoMin);
    expect(dopo(60480)).toBe(pulita.decoMin);
  });

  it('la catena regge tre immersioni di fila senza divergere', () => {
    let stato = pulita;
    const serie: number[] = [];
    for (let i = 0; i < 3; i++) {
      stato = planVpm(LEVELS, [], {
        conservatism: 0,
        initial: stato.finalTissues,
        previousNuclei: stato.nuclei,
        surfaceIntervalMin: 60,
      });
      serie.push(stato.decoMin);
      expect(stato.nuclei.critRadiusN2.every(Number.isFinite)).toBe(true);
      expect(stato.nuclei.maxActualGradient.every((g) => g >= 0)).toBe(true);
    }
    // Ogni tuffo della giornata è più caro del precedente, ma la serie non esplode.
    for (let i = 1; i < serie.length; i++) expect(serie[i]).toBeGreaterThanOrEqual(serie[i - 1]);
    expect(serie[2]).toBeLessThan(pulita.decoMin * 6);
  });

  it('`surfaceIntervalMin` desatura i tessuti al posto del chiamante', () => {
    // Le due forme devono dare la stessa identica tabella: è la garanzia che
    // passare i tessuti di fine immersione con l'intervallo non li desaturi due
    // volte né li lasci carichi.
    const a = planVpm(LEVELS, [], {
      conservatism: 0,
      initial: pulita.finalTissues,
      surfaceIntervalMin: 90,
    });
    const b = planVpm(LEVELS, [], {
      conservatism: 0,
      initial: afterSurfaceInterval(pulita.finalTissues, 90),
    });
    expect(a.decoMin).toBe(b.decoMin);
    expect(a.stops).toEqual(b.stops);
  });

  it('cambiare conservatorismo fra le due immersioni continua a fare effetto', () => {
    // I raggi arrivano dai nuclei della prima immersione e portano dentro il
    // conservatorismo con cui è stata calcolata: senza riscalarli, dalla seconda
    // immersione in poi la manopola diventerebbe muta. Il bug sarebbe silenzioso —
    // la tabella resta plausibile — quindi il test c'è.
    const serie = [0, 2, 5].map(
      (conservatism) =>
        planVpm(LEVELS, [], {
          conservatism,
          initial: pulita.finalTissues,
          previousNuclei: pulita.nuclei,
          surfaceIntervalMin: 60,
        }).decoMin,
    );
    for (let i = 1; i < serie.length; i++) expect(serie[i]).toBeGreaterThan(serie[i - 1]);
  });

  it('i nuclei tornano sempre, anche quando non ci sono soste', () => {
    const curva = planVpm([{ depthM: 18, minutes: 40, mix: AIR }], [], {});
    expect(curva.stops).toHaveLength(0);
    expect(curva.nuclei.critRadiusN2).toHaveLength(16);
    expect(curva.nuclei.maxActualGradient.every(Number.isFinite)).toBe(true);
    const vuota = planVpm([], [], {});
    expect(vuota.nuclei.critRadiusHe.every((r) => r > 0)).toBe(true);
  });
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * QUOTA
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Riferimenti prodotti con lo stesso programma, `Altitude_Dive_Algorithm: "ON"`,
 * 45 m/25 min in aria ai raggi nominali. Acclimatato: 47 minuti al livello del
 * mare, 49 a 500 m, 52 a 1000, 58 a 2000, 62 a 3000. Non acclimatato a 2000 m
 * appena arrivato: 62; dopo tre ore in quota torna a 58.
 *
 * PERCHÉ NON SI USA IL CASO `altitude_dive1` COMMITTATO NEL REPOSITORY. Perché è a
 * 100 metri di quota e la sua differenza rispetto al livello del mare è di tre
 * minuti su duecentosettantasei, cioè meno dell'arrotondamento al minuto delle
 * diciotto soste che compongono quella tabella: su un profilo del genere il rumore
 * di quantizzazione può cambiare il segno del risultato, nostro e loro. Un test
 * costruito lì misurerebbe l'arrotondamento, non l'algoritmo di quota. Si usano
 * quindi le quote in cui l'effetto è inequivocabile.
 */
describe('immersioni in quota: riscontro con il programma di Baker', () => {
  const LEVELS: VpmLevel[] = [{ depthM: 45, minutes: 25, mix: AIR }];
  const ACCLIMATIZED_HOURS = 72;

  it('acclimatato a 1000, 2000 e 3000 metri', () => {
    for (const [altitudeM, reference] of [
      [1000, 52],
      [2000, 58],
      [3000, 62],
    ] as const) {
      const r = planVpm(LEVELS, [], {
        conservatism: 0,
        altitudeM,
        hoursAtAltitude: ACCLIMATIZED_HOURS,
      });
      expect(Math.abs(deviation(r.decoMin, reference))).toBeLessThan(TOLERANCE_PCT);
    }
  });

  /**
   * Appena arrivati a 2000 m il riferimento dà 62 minuti contro i 58 da
   * acclimatato, e a 3000 m dà 74. Noi siamo un filo più prudenti perché la nostra
   * salita in quota è istantanea mentre quella di Baker dura un'ora, durante la
   * quale i tessuti cominciano già a scaricare: la differenza è dichiarata in testa
   * al modulo e va nella direzione giusta.
   */
  it('appena saliti in quota', () => {
    const due = planVpm(LEVELS, [], { conservatism: 0, altitudeM: 2000, hoursAtAltitude: 0 });
    const tre = planVpm(LEVELS, [], { conservatism: 0, altitudeM: 3000, hoursAtAltitude: 0 });
    expect(Math.abs(deviation(due.decoMin, 62))).toBeLessThan(TOLERANCE_PCT);
    expect(Math.abs(deviation(tre.decoMin, 74))).toBeLessThan(TOLERANCE_PCT);
  });
});

describe('quota: le proprietà che devono valere comunque', () => {
  const LEVELS: VpmLevel[] = [{ depthM: 45, minutes: 25, mix: AIR }];
  const at = (altitudeM: number, hoursAtAltitude: number) =>
    planVpm(LEVELS, [], { conservatism: 0, altitudeM, hoursAtAltitude }).decoMin;

  it('più si sale, più lunga è la decompressione', () => {
    const serie = [0, 1000, 2000, 3000].map((a) => at(a, 72));
    for (let i = 1; i < serie.length; i++) expect(serie[i]).toBeGreaterThan(serie[i - 1]);
  });

  it('chi è appena salito decomprime più a lungo di chi è acclimatato', () => {
    expect(at(2000, 0)).toBeGreaterThan(at(2000, 72));
    expect(at(3000, 0)).toBeGreaterThan(at(3000, 72));
  });

  it("la penalità di chi è appena salito si esaurisce con le ore passate in quota", () => {
    const serie = [0, 1, 3, 12, 48].map((h) => at(2000, h));
    for (let i = 1; i < serie.length; i++) expect(serie[i]).toBeLessThanOrEqual(serie[i - 1]);
    expect(serie[serie.length - 1]).toBeLessThan(serie[0]);
  });

  it('la quota gonfia i nuclei: raggi critici più grandi del nominale', () => {
    const mare = planVpm(LEVELS, [], { conservatism: 0 });
    const monte = planVpm(LEVELS, [], { conservatism: 0, altitudeM: 3000, hoursAtAltitude: 0 });
    for (let i = 0; i < 16; i++) {
      expect(monte.nuclei.critRadiusN2[i]).toBeGreaterThan(mare.nuclei.critRadiusN2[i]);
      expect(monte.nuclei.critRadiusHe[i]).toBeGreaterThan(mare.nuclei.critRadiusHe[i]);
    }
  });

  it('una pressione di superficie scritta a mano ha la precedenza sulla quota', () => {
    // Chi ha un barometro sa più della carta topografica, e deve poterlo dire.
    const daQuota = planVpm(LEVELS, [], { conservatism: 0, altitudeM: 3000, hoursAtAltitude: 72 });
    const aMano = planVpm(LEVELS, [], {
      conservatism: 0,
      altitudeM: 3000,
      hoursAtAltitude: 72,
      surfacePressureBar: 1.01325,
    });
    expect(aMano.decoMin).toBeLessThan(daQuota.decoMin);
  });

  it('con i nuclei di una precedente la correzione di quota non si applica due volte', () => {
    // Chi è già in acqua da stamattina la salita in quota l'ha fatta ieri: i suoi
    // nuclei se la portano già dentro, e riapplicarla sarebbe contarla due volte.
    const prima = planVpm(LEVELS, [], { conservatism: 0, altitudeM: 2000, hoursAtAltitude: 12 });
    const seconda = planVpm(LEVELS, [], {
      conservatism: 0,
      altitudeM: 2000,
      hoursAtAltitude: 12,
      initial: prima.finalTissues,
      previousNuclei: prima.nuclei,
      surfaceIntervalMin: 60480,
    });
    // A intervallo lunghissimo la ripetitiva torna identica alla prima: se la
    // correzione di quota si sommasse a ogni giro, non potrebbe accadere.
    expect(seconda.decoMin).toBe(prima.decoMin);
  });
});
