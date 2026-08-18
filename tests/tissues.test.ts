/**
 * Il carico di azoto attraverso l'archivio.
 *
 * La cosa da provare qui non è il modello — quello è provato in `buhlmann.test.ts`
 * e validato contro Shearwater — ma la CATENA: che l'ordine sia cronologico e non
 * quello dell'array, che l'intervallo di superficie conti, che si spezzi dove deve,
 * e che il ricalcolo sia incrementale davvero. Un errore qui non produce numeri
 * assurdi: produce numeri leggermente ottimisti sulle ripetitive, che è il modo
 * peggiore di sbagliare perché nessuno se ne accorge guardando.
 */

import { describe, expect, it } from 'vitest';
import type { Dive, Sample } from '../src/core/model';
import { computeMetrics } from '../src/core/analysis/metrics';
import {
  CHAIN_BREAK_HOURS,
  chainArchive,
  entryState,
  entryStateFor,
  needsRecompute,
  previousDive,
  residualLoadBar,
  segmentsToSamples,
  curveOfPlan,
  decoTimeline,
} from '../src/core/analysis/tissues';
import { surfacedTissues } from '../src/core/analysis/buhlmann';

function square(depthM: number, bottomMin: number): Sample[] {
  const out: Sample[] = [];
  let t = 0;
  const descentS = Math.round((depthM / 18) * 60);
  for (; t <= descentS; t += 10) out.push({ t, depth: (t / descentS) * depthM });
  const bottomEnd = descentS + bottomMin * 60;
  for (; t <= bottomEnd; t += 10) out.push({ t, depth: depthM });
  const ascentS = Math.round((depthM / 9) * 60);
  for (let k = 10; k <= ascentS; k += 10) {
    out.push({ t: bottomEnd + k, depth: Math.max(0, depthM * (1 - k / ascentS)) });
  }
  return out;
}

function dive(id: string, startTime: string, depthM: number, bottomMin: number): Dive {
  const samples = square(depthM, bottomMin);
  const base: Dive = {
    id,
    startTime,
    durationS: samples[samples.length - 1].t,
    maxDepth: depthM,
    cylinders: [{ mix: { o2: 0.21, he: 0 } }],
    source: { format: 'uddf', file: 'test', importedAt: startTime },
    mode: 'oc',
    tags: [],
    samples,
  };
  return { ...base, metrics: computeMetrics(base) };
}

const load = (dives: Dive[]) => async (id: string) => dives.find((d) => d.id === id)?.samples ?? [];

describe('carico residuo', () => {
  it('senza precedente si entra a tessuti puliti', () => {
    const d = dive('a', '2026-06-01T09:00:00Z', 30, 25);
    const e = entryState(d, undefined);
    expect(e.residualN2Bar).toBe(0);
    expect(e.surfaceIntervalMin).toBeUndefined();
  });

  it('l’azoto in eccesso cala al crescere dell’intervallo', async () => {
    // I tessuti di partenza vengono da un'immersione VERA, non da sedici numeri
    // uguali: un compartimento da 635 minuti caricato a mano resta carico per
    // mezza giornata e il test misurerebbe la finzione invece del modello.
    const first = dive('a', '2026-06-01T09:00:00Z', 30, 25);
    const chained = await chainArchive([first], load([first]));
    const loaded = chained.dives[0].metrics!.tissuesEnd!;
    const endMs = Date.parse(first.startTime) + first.durationS * 1000;
    const gaps = [30, 60, 180, 600].map((min) => {
      const next = dive('b', new Date(endMs + min * 60_000).toISOString(), 20, 20);
      return entryState(next, { state: loaded, endTimeMs: endMs }).residualN2Bar;
    });
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]);
    expect(gaps[gaps.length - 1]).toBeLessThan(gaps[0] / 2);
  });

  it('oltre le ventiquattro ore la catena si spezza da sola', () => {
    const first = dive('a', '2026-06-01T09:00:00Z', 30, 25);
    const endMs = Date.parse(first.startTime) + first.durationS * 1000;
    const next = dive('b', new Date(endMs + (CHAIN_BREAK_HOURS + 1) * 3600_000).toISOString(), 20, 20);
    const e = entryState(next, { state: { n2: new Array(16).fill(1.6), he: new Array(16).fill(0) }, endTimeMs: endMs });
    expect(e.residualN2Bar).toBe(0);
    expect(e.surfaceIntervalMin).toBeUndefined();
  });

  it('due immersioni sovrapposte non si incatenano', () => {
    // Succede con due computer non deduplicati o un orologio sfasato: incatenarle
    // produrrebbe un residuo inventato su un'immersione che è la stessa.
    const first = dive('a', '2026-06-01T09:00:00Z', 30, 25);
    const endMs = Date.parse(first.startTime) + first.durationS * 1000;
    const overlapping = dive('b', new Date(endMs - 600_000).toISOString(), 30, 25);
    const e = entryState(overlapping, { state: { n2: new Array(16).fill(1.6), he: new Array(16).fill(0) }, endTimeMs: endMs });
    expect(e.residualN2Bar).toBe(0);
  });

  it('a tessuti a riposo il residuo è zero', () => {
    expect(residualLoadBar(surfacedTissues(), 1.01325)).toBe(0);
  });
});

describe('la catena sull’archivio', () => {
  it('la ripetitiva esce più alta della stessa immersione fatta da pulita', async () => {
    const a = dive('a', '2026-06-01T09:00:00Z', 30, 30);
    const endMs = Date.parse(a.startTime) + a.durationS * 1000;
    const b = dive('b', new Date(endMs + 60 * 60_000).toISOString(), 30, 30);
    const { dives } = await chainArchive([a, b], load([a, b]));
    const first = dives.find((d) => d.id === 'a')!.metrics!;
    const second = dives.find((d) => d.id === 'b')!.metrics!;
    expect(second.gf99Pct!).toBeGreaterThan(first.gf99Pct!);
    expect(second.gf99CleanPct).toBeDefined();
    expect(second.gf99Pct!).toBeGreaterThan(second.gf99CleanPct!);
    expect(second.surfaceIntervalMin).toBe(60);
  });

  it('l’ordine dell’array non conta, conta quello cronologico', async () => {
    const a = dive('a', '2026-06-01T09:00:00Z', 30, 30);
    const endMs = Date.parse(a.startTime) + a.durationS * 1000;
    const b = dive('b', new Date(endMs + 60 * 60_000).toISOString(), 30, 30);
    const dritto = await chainArchive([a, b], load([a, b]));
    const rovescio = await chainArchive([b, a], load([a, b]));
    const gf = (r: Awaited<ReturnType<typeof chainArchive>>, id: string) =>
      r.dives.find((d) => d.id === id)!.metrics!.gf99Pct;
    expect(gf(dritto, 'b')).toBe(gf(rovescio, 'b'));
    expect(gf(dritto, 'a')).toBe(gf(rovescio, 'a'));
  });

  it('il secondo giro non rilegge nessun profilo', async () => {
    const a = dive('a', '2026-06-01T09:00:00Z', 30, 30);
    const endMs = Date.parse(a.startTime) + a.durationS * 1000;
    const b = dive('b', new Date(endMs + 60 * 60_000).toISOString(), 25, 40);
    const first = await chainArchive([a, b], load([a, b]));
    expect(first.report.computed).toBe(2);

    // Se rileggesse un profilo il caricatore esploderebbe: è il modo più diretto
    // di provare che il ricalcolo è incrementale davvero.
    const second = await chainArchive(
      first.dives.map(({ samples: _s, ...rest }) => rest as Dive),
      async () => {
        throw new Error('non deve rileggere niente');
      },
    );
    expect(second.report.computed).toBe(0);
    expect(second.report.reused).toBe(2);
    expect(second.updated).toHaveLength(0);
  });

  it('inserire un’immersione prima fa ricalcolare quelle dopo', async () => {
    const a = dive('a', '2026-06-01T09:00:00Z', 35, 30);
    const endA = Date.parse(a.startTime) + a.durationS * 1000;
    const b = dive('b', new Date(endA + 45 * 60_000).toISOString(), 30, 35);
    const solaB = await chainArchive([b], load([b]));
    const senzaResiduo = solaB.dives[0].metrics!.gf99Pct!;
    expect(solaB.dives[0].metrics!.residualN2Bar).toBeUndefined();

    // La stessa `b`, ma ora preceduta da `a`: il residuo va ricalcolato anche se
    // il suo GF99 era già stato scritto e sembrava a posto.
    const conA = await chainArchive([a, solaB.dives[0]], load([a, b]));
    const dopo = conA.dives.find((d) => d.id === 'b')!.metrics!;
    expect(conA.report.computed).toBe(2);
    expect(dopo.surfaceIntervalMin).toBe(45);
    expect(dopo.residualN2Bar!).toBeGreaterThan(0);
    expect(dopo.gf99Pct!).toBeGreaterThan(senzaResiduo);
  });

  /*
   * Questo test diceva il CONTRARIO fino ad agosto 2026, ed era sbagliato lui.
   *
   * La regola vecchia era «senza profilo la catena si spezza, e chi viene dopo
   * riparte pulito invece di ereditare un numero inventato». Suona prudente e non
   * lo è: fra un carico STIMATO da un profilo quadro e un carico ZERO, il secondo
   * non è più cauto — è solo più sbagliato, e nella direzione che rassicura. Chi
   * legge vedeva una ripetitiva con il GF99 di una prima immersione della
   * giornata. Sull'archivio di riferimento succedeva 19 volte su 104.
   *
   * Ora il quadro si ricostruisce da profondità media e durata, la catena
   * prosegue, e la stima è dichiarata in `tissuesEstimated` perché nessun numero
   * ricostruito deve poter passare per misurato.
   */
  it('un’immersione senza profilo non spezza più la catena: la stima e lo dichiara', async () => {
    const a = dive('a', '2026-06-01T09:00:00Z', 30, 30);
    const endA = Date.parse(a.startTime) + a.durationS * 1000;
    const senzaProfilo: Dive = {
      id: 'x',
      startTime: new Date(endA + 3600_000).toISOString(),
      durationS: 2400,
      maxDepth: 20,
      avgDepth: 14,
      cylinders: [{ mix: { o2: 0.21, he: 0 } }],
      source: { format: 'csv', file: 'test', importedAt: a.startTime },
      mode: 'oc',
      tags: [],
    };
    const endX = Date.parse(senzaProfilo.startTime) + senzaProfilo.durationS * 1000;
    const c = dive('c', new Date(endX + 3600_000).toISOString(), 25, 30);
    const r = await chainArchive([a, senzaProfilo, c], load([a, c]));

    // Il conteggio ora dice «quante poggiano su una stima», non «dove si è rotta».
    expect(r.report.withoutProfile).toBe(1);
    const x = r.dives.find((d) => d.id === 'x')!.metrics!;
    expect(x.tissuesEstimated).toBe(true);
    expect(x.gf99Pct).toBeGreaterThan(0);
    // Ed eredita a sua volta il carico di `a`, che il profilo ce l'ha.
    expect(x.residualN2Bar!).toBeGreaterThan(0);

    // `c` viene dopo il buco e NON riparte pulita: è il difetto che chiudeva.
    const cm = r.dives.find((d) => d.id === 'c')!.metrics!;
    expect(cm.residualN2Bar!).toBeGreaterThan(0);
    expect(cm.tissuesEstimated).toBeUndefined();
    expect(cm.gf99Pct!).toBeGreaterThan(cm.gf99CleanPct!);
  });

  it('needsRecompute non chiede di rifare quello che è già giusto', async () => {
    const a = dive('a', '2026-06-01T09:00:00Z', 30, 30);
    const r = await chainArchive([a], load([a]));
    expect(needsRecompute(r.dives[0], entryState(r.dives[0], undefined))).toBe(false);
  });
});

describe('trovare la precedente in archivio', () => {
  const a = dive('a', '2026-06-01T09:00:00Z', 30, 30);
  const endA = Date.parse(a.startTime) + a.durationS * 1000;
  const b = dive('b', new Date(endA + 3600_000).toISOString(), 25, 30);

  it('prende quella immediatamente prima', () => {
    expect(previousDive(b, [a, b])?.id).toBe('a');
    expect(previousDive(a, [a, b])).toBeUndefined();
  });

  it('ignora quelle troppo lontane nel tempo', () => {
    const lontana = dive('z', '2020-01-01T09:00:00Z', 30, 30);
    expect(previousDive(a, [lontana, a])).toBeUndefined();
  });

  it('ricostruisce il carico d’ingresso senza leggere profili', async () => {
    const chained = await chainArchive([a, b], load([a, b]));
    const entry = entryStateFor(
      chained.dives.find((d) => d.id === 'b')!,
      chained.dives.map(({ samples: _s, ...rest }) => rest as Dive),
    );
    expect(entry.residualN2Bar).toBeGreaterThan(0);
    expect(entry.surfaceIntervalMin).toBe(60);
  });
});

describe('la curva di un piano', () => {
  const segments = [
    { fromM: 0, toM: 30, minutes: 2 },
    { fromM: 30, toM: 30, minutes: 20 },
    { fromM: 30, toM: 5, minutes: 3 },
    { fromM: 5, toM: 5, minutes: 3 },
    { fromM: 5, toM: 0, minutes: 1 },
  ];

  it('i campioni coprono esattamente la durata dichiarata', () => {
    const s = segmentsToSamples(segments);
    expect(s[s.length - 1].t).toBe(29 * 60);
    expect(s[0].depth).toBe(0);
    expect(s[s.length - 1].depth).toBe(0);
  });

  it('il limite in curva cala con la profondità', () => {
    const c = curveOfPlan(segments, { mix: { o2: 0.21, he: 0 }, avgDepthM: 22, maxDepthM: 30 });
    expect(c.ndlAtAvgMin).toBeGreaterThan(c.ndlAtMaxMin);
  });

  it('un piano lungo esce dalla curva, e dice a che minuto', () => {
    const lungo = [
      { fromM: 0, toM: 40, minutes: 3 },
      { fromM: 40, toM: 40, minutes: 40 },
      { fromM: 40, toM: 0, minutes: 5 },
    ];
    const c = curveOfPlan(lungo, { mix: { o2: 0.21, he: 0 }, avgDepthM: 38, maxDepthM: 40 });
    expect(c.maxCeilingM).toBeGreaterThan(0);
    expect(c.leavesCurveAtMin).toBeDefined();
    expect(c.leavesCurveAtMin!).toBeGreaterThan(0);
    expect(c.leavesCurveAtMin!).toBeLessThan(48);
  });
});

/**
 * La curva minuto per minuto.
 *
 * L'errore da temere qui non è un numero un po' diverso da quello del computer —
 * quello è fisiologico fra due implementazioni — ma una curva che racconta la
 * storia sbagliata: NDL che risale mentre si sta scendendo, tetto che sparisce
 * mentre l'obbligo c'è, TTS che si accorcia scendendo.
 */
describe('curva e obbligo lungo l’immersione', () => {
  const profondo = dive('a', '2026-06-01T09:00:00Z', 40, 30);
  const basso = dive('b', '2026-06-02T09:00:00Z', 12, 40);

  it('emette un punto ogni passo, non uno per campione', () => {
    const tl = decoTimeline(profondo, profondo.samples!, { stepS: 60 });
    const atteso = Math.ceil(profondo.durationS / 60);
    expect(tl.length).toBeGreaterThan(atteso - 3);
    expect(tl.length).toBeLessThan(atteso + 3);
    expect(tl[0].t).toBe(0);
  });

  it('il tempo in curva si consuma scendendo e non torna indietro sul fondo', () => {
    const tl = decoTimeline(profondo, profondo.samples!);
    const fondo = tl.filter((p) => p.depthM > 35);
    for (let i = 1; i < fondo.length; i++) {
      expect(fondo[i].ndlMin).toBeLessThanOrEqual(fondo[i - 1].ndlMin);
    }
    // E all'inizio, in superficie, il limite è al massimo consentito.
    expect(tl[0].ndlMin).toBe(99);
  });

  it('un’immersione bassa resta in curva per tutta la durata', () => {
    const tl = decoTimeline(basso, basso.samples!);
    expect(tl.every((p) => p.ceilingM === 0 && p.ceilingDirectM === 0)).toBe(true);
    expect(Math.min(...tl.map((p) => p.ndlMin))).toBeGreaterThan(0);
  });

  it('un’immersione impegnativa prende un tetto, e lo perde risalendo', () => {
    const lunga = dive('c', '2026-06-03T09:00:00Z', 42, 35);
    const tl = decoTimeline(lunga, lunga.samples!);
    expect(Math.max(...tl.map((p) => p.ceilingM))).toBeGreaterThan(0);
    // La curva finisce quando non si può più salire DRITTI: è `ceilingDirectM`,
    // calcolato col solo `gfHigh`, ad essere accoppiato con `ndlMin`. Il
    // `ceilingM` accanto è un'altra cosa — la quota a cui ti devi fermare adesso,
    // con i gradient factor interpolati — ed è più profondo. Confonderli faceva
    // disegnare un tetto grosso un terzo di quello del computer.
    for (const p of tl) if (p.ceilingDirectM > 0) expect(p.ndlMin).toBe(0);
    for (const p of tl) expect(p.ceilingM).toBeGreaterThanOrEqual(p.ceilingDirectM);
    // E all'uscita il tetto c'è ANCORA, perché questo profilo sintetico risale
    // dritto senza fermarsi: il modello dice che sei arrivato in superficie con
    // quasi dieci metri di obbligo sopra la testa. Aspettarsi zero qui sarebbe
    // aspettarsi che il modello perdoni una risalita che non perdona.
    expect(tl[tl.length - 1].ceilingM).toBeGreaterThan(5);
    expect(tl[tl.length - 1].gf99).toBeGreaterThan(150);
  });

  it('il tempo di risalita cresce col carico e torna a zero in superficie', () => {
    const tl = decoTimeline(profondo, profondo.samples!);
    const alFondo = tl.filter((p) => p.depthM > 35);
    expect(alFondo[alFondo.length - 1].ttsMin).toBeGreaterThan(alFondo[0].ttsMin);
    // In superficie il conto è zero per definizione: non c'è più niente da
    // risalire. Un metro sopra la superficie, invece, il TTS è ancora quello
    // dell'obbligo che ti porti dietro — ed è il caso di questo profilo, che
    // risale dritto e finisce a un metro di quota.
    const inSuperficie = decoTimeline(basso, basso.samples!);
    expect(inSuperficie[inSuperficie.length - 1].ttsMin).toBe(0);
  });

  it('il carico residuo entra: la ripetitiva parte con meno curva', async () => {
    const a = dive('x', '2026-06-01T09:00:00Z', 35, 35);
    const chained = await chainArchive([a], load([a]));
    const b = dive('y', '2026-06-01T11:00:00Z', 30, 30);
    const pulita = decoTimeline(b, b.samples!);
    const ripetitiva = decoTimeline(b, b.samples!, {
      initial: entryStateFor(b, [...chained.dives, b]).state,
    });
    // Il confronto va fatto alla FINE del fondo, non all'inizio: nei primi minuti
    // comanda un compartimento veloce, che il residuo di due ore prima ha già
    // scaricato, e le due curve coincidono. Il residuo sta nei tessuti medi, e si
    // vede quando cominciano a comandare loro.
    const ultimoAlFondo = (tl: typeof pulita) => {
      const fondo = tl.filter((p) => p.depthM > 25);
      return fondo[fondo.length - 1].ndlMin;
    };
    expect(ultimoAlFondo(ripetitiva)).toBeLessThanOrEqual(ultimoAlFondo(pulita));
    const gf = (tl: typeof pulita) => tl[tl.length - 1].gf99;
    expect(gf(ripetitiva)).toBeGreaterThan(gf(pulita));
  });

  it('senza profilo non inventa una curva', () => {
    expect(decoTimeline(profondo, [])).toEqual([]);
    expect(decoTimeline(profondo, [{ t: 0, depth: 0 }])).toEqual([]);
  });
})
