// @vitest-environment jsdom
/**
 * DUE SCHERMATE, GLI STESSI DATI, LA STESSA RISPOSTA.
 *
 * ► PERCHÉ ESISTE QUESTO FILE. ◄ Statistiche e Piano di miglioramento leggono
 * lo stesso aggregato e descrivono le stesse immersioni, ma i giudizi erano
 * scritti due volte: due soglie per la sosta di sicurezza, due per la riserva,
 * due criteri opposti sul GF99, due soglie diverse per l'ultimo tratto. Ogni
 * coppia funzionava benissimo da sola, e insieme diceva il contrario di sé.
 *
 * Le prove qui dentro cercano **i numeri**, non le frasi: estraggono la cifra
 * dalla riga e la confrontano con quella che il conto produce. Una guardia che
 * cerca una formulazione resta verde il giorno in cui la formulazione cambia e
 * il numero resta sbagliato — che è esattamente il modo in cui questi difetti
 * sono passati.
 *
 * Due idee le tengono tutte:
 *   1. **il numero che decide dev'essere il numero che si mostra**;
 *   2. **zero è il valore più rassicurante che un numero possa avere**, e
 *      l'ultimo che dovrebbe comparire quando il dato manca.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { aggregate, type Aggregates } from '../src/core/analysis/aggregate';
import { computeMetrics } from '../src/core/analysis/metrics';
import { periodOf } from '../src/core/analysis/window';
import { AIR, type Dive, type Sample } from '../src/core/model';

const finto = vi.hoisted(() => ({ valore: {} as Record<string, unknown> }));
vi.mock('../src/ui/state', () => ({ useDiveLog: () => finto.valore }));

import { BENCHMARK, buildPlan, gf99ConMargine, storicoDi } from '../src/core/analysis/coaching';
import { Stats } from '../src/ui/pages/Stats';
import { Compare } from '../src/ui/pages/Compare';

const GIORNO = 86_400_000;
const ORA = Date.parse('2026-08-17T12:00:00Z');

// ---------------------------------------------------------------------------
// Attrezzi
// ---------------------------------------------------------------------------

function monta(nodo: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(nodo));
  return {
    host,
    smonta: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const inventarioVuoto = { equipment: [], sets: [] };

const finestra = (dives: Dive[]) => ({
  period: periodOf('12m'),
  dives,
  excluded: 0,
  from: dives[0]?.startTime,
  to: dives[dives.length - 1]?.startTime,
});

/** Un'immersione nuda: qui contano i conteggi, non i profili. */
function immersione(over: Partial<Dive> & { id: string }): Dive {
  return {
    startTime: new Date(ORA - GIORNO).toISOString(),
    durationS: 2400,
    maxDepth: 25,
    mode: 'oc',
    cylinders: [{ mix: AIR }],
    source: { format: 'uddf', file: 'prova', importedAt: 'x' },
    tags: [],
    ...over,
  };
}

const immersioneIl = (giorniFa: number, over: Partial<Dive> = {}): Dive =>
  immersione({
    id: `g${giorniFa}`,
    startTime: new Date(ORA - giorniFa * GIORNO).toISOString(),
    ...over,
  });

/** Le metriche scritte a mano: il difetto da provare non sta nel loro calcolo. */
const metriche = (m: Record<string, unknown>): Dive['metrics'] =>
  ({
    quality: { sampleCount: 240, sampleIntervalS: 10, hasProfile: true },
    ...m,
  }) as unknown as Dive['metrics'];

/**
 * Il primo numero di una riga di prove, per quello che è: un numero.
 *
 * Serve a non incastrare la prova nella formulazione della frase — se domani
 * dicesse «soltanto» invece di «solo» la guardia deve restare accesa — ma a
 * tenere fermo il valore, che è la cosa che sbagliava.
 */
function numeroDi(righe: string[], pezzo: string): number {
  const riga = righe.find((r) => r.includes(pezzo));
  if (riga === undefined) throw new Error(`nessuna riga con «${pezzo}»:\n  ${righe.join('\n  ')}`);
  const trovato = riga.match(/-?\d+(?:\.\d+)?/);
  if (!trovato) throw new Error(`nessun numero in «${riga}»`);
  return Number(trovato[0]);
}

/** Il verdetto della pastiglia accanto a una riga della tabella «Disciplina». */
function verdettoDellaRiga(host: HTMLElement, etichetta: string): 'buono' | 'da migliorare' | 'senza' {
  const riga = [...host.querySelectorAll('tr')].find((r) => (r.textContent ?? '').includes(etichetta));
  if (!riga) throw new Error(`nessuna riga con «${etichetta}»`);
  const classi = riga.querySelector('.dot')?.className ?? '';
  return classi.includes('dot-good') ? 'buono' : classi.includes('dot-warning') ? 'da migliorare' : 'senza';
}

/** Il testo della tessera che porta quell'etichetta. */
function tessera(host: HTMLElement, etichetta: string): string {
  const trovata = [...host.querySelectorAll('.tile')].find((t) =>
    (t.querySelector('.tile-label')?.textContent ?? '').includes(etichetta),
  );
  if (!trovata) throw new Error(`nessuna tessera «${etichetta}»`);
  return trovata.textContent ?? '';
}

function montaStatistiche(dives: Dive[], agg: Aggregates) {
  finto.valore = { aggregates: agg, dives, scope: finestra(dives), gear: inventarioVuoto };
  return monta(<Stats onOpen={() => undefined} />);
}

beforeEach(() => {
  finto.valore = {};
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// 1. La frequenza mensile si divide per la FINESTRA
// ---------------------------------------------------------------------------

describe('frequenza mensile', () => {
  const sei = [0, 2, 4, 6, 8, 10].map((g) => immersioneIl(g));
  const seiPiuUnaVecchia = [...sei, immersioneIl(334)];

  it('su «Ultimi 12 mesi» il denominatore è dodici, non l’ampiezza dei dati', () => {
    const a = aggregate(sei, ORA, 12);
    expect(a.spanMonths).toBe(12);
    // Sei immersioni in dieci giorni, su una finestra di un anno: 6/12.
    expect(a.perMonthLast12m).toBe(0.5);
  });

  it('aggiungere un’immersione non può far peggiorare la frequenza', () => {
    const sole = aggregate(sei, ORA, 12).perMonthLast12m;
    const conLaVecchia = aggregate(seiPiuUnaVecchia, ORA, 12).perMonthLast12m;
    // 7/12 = 0.583. Prima: 6/1 = 6.0 contro 7/11 = 0.6, cioè dieci volte peggio
    // per aver scritto un'immersione in più.
    expect(conLaVecchia).toBe(0.6);
    expect(conLaVecchia).toBeGreaterThan(sole);
  });

  it('sei mesi dividono per sei, e «tutto l’archivio» per quello che i dati coprono', () => {
    expect(aggregate(sei, ORA, 6).spanMonths).toBe(6);
    expect(aggregate(sei, ORA, 6).perMonthLast12m).toBe(1);
    // Senza finestra non c'è un inizio da cui contare: resta l'ampiezza dei dati.
    const tutto = aggregate(sei, ORA);
    expect(tutto.spanMonths).toBe(1);
    expect(tutto.perMonthLast12m).toBe(6);
  });

  it('e il piano dà lo stesso verdetto prima e dopo quell’immersione', () => {
    const verdetto = (dives: Dive[]) =>
      buildPlan(dives, aggregate(dives, ORA, 12), 'general').findings.find((f) => f.id.startsWith('currency'))
        ?.id;
    // Sei immersioni in dieci giorni sono 0.5 al mese su un anno: poche. Prima
    // erano «In allenamento: 6 immersioni al mese», cioè un punto di forza.
    expect(verdetto(sei)).toBe('currency-frequency');
    expect(verdetto(seiPiuUnaVecchia)).toBe('currency-frequency');
  });
});

// ---------------------------------------------------------------------------
// 2. «Senza violazioni» solo dove la violazione si vedrebbe
// ---------------------------------------------------------------------------

describe('esposizione decompressiva', () => {
  /** Un profilo a 42 m con obbligo deco, col canale del tetto oppure senza. */
  function profiloDeco(conTetto: boolean): Sample[] {
    const out: Sample[] = [];
    for (let k = 0; k <= 160; k++) {
      const depth = k < 8 ? k * 5.25 : k < 100 ? 42 : Math.max(0, 42 - (k - 100) * 0.7);
      const s: Sample = { t: k * 30, depth, tempC: 18 };
      // L'obbligo c'è in tutti e due i casi: è il TETTO che manca a LogTRAK.
      if (depth > 8) s.inDeco = true;
      if (conTetto && depth >= 10) s.ceiling = 6;
      out.push(s);
    }
    return out;
  }

  const archivioDeco = (conTetto: boolean): Dive[] =>
    Array.from({ length: 10 }, (_, i) => {
      const d = immersioneIl(3 + i * 7, {
        id: `${conTetto ? 'tetto' : 'cieco'}${i}`,
        maxDepth: 42,
        durationS: 4800,
        samples: profiloDeco(conTetto),
        reported: { maxDecoObligationS: 600 },
      });
      d.metrics = computeMetrics(d);
      return d;
    });

  it('senza il canale del tetto il piano non dichiara niente sulle violazioni', () => {
    const dives = archivioDeco(false);
    const agg = aggregate(dives, ORA);
    expect(agg.decoDives).toBe(10);
    // Lo zero che rassicurava: nessuna violazione perché nessuna era misurabile.
    expect(agg.ceilingEligible).toBe(0);
    expect(agg.ceilingViolations).toBe(0);
    const piano = buildPlan(dives, agg, 'general');
    expect(piano.findings.some((f) => f.id === 'deco-exposure')).toBe(false);
  });

  it('col canale del tetto, e senza violazioni, la scheda c’è e dice su quante', () => {
    const dives = archivioDeco(true);
    const agg = aggregate(dives, ORA);
    expect(agg.decoDives).toBe(10);
    expect(agg.ceilingEligible).toBe(10);
    expect(agg.ceilingViolations).toBe(0);
    const f = buildPlan(dives, agg, 'general').findings.find((x) => x.id === 'deco-exposure');
    expect(f?.severity).toBe('good');
    expect(f?.basis).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 3. GF99: un criterio solo, e relativo
// ---------------------------------------------------------------------------

describe('GF99 all’uscita', () => {
  const conGf99 = (n: number, gf99: number, gfHigh?: number): Dive[] =>
    Array.from({ length: n }, (_, i) =>
      immersioneIl(3 + i * 7, {
        id: `gf${i}`,
        computer: gfHigh === undefined ? undefined : { gfLow: 20, gfHigh },
        metrics: metriche({ gf99Pct: gf99 }),
      }),
    );

  it('64% con il computer a 70/70 è il 91% del proprio limite: non è «nei limiti»', () => {
    const dives = conGf99(8, 64, 70);
    const a = aggregate(dives, ORA);
    expect(a.avgGf99).toBe(64);
    // La soglia assoluta di prima diceva di sì proprio qui: 64 ≤ 65.
    expect(a.avgGf99! <= 65).toBe(true);
    expect(gf99ConMargine(a.avgGf99, a.gf99, dives)).toBe(false);
  });

  it('55% con il computer a 85 lascia margine davvero', () => {
    const dives = conGf99(8, 55, 85);
    const a = aggregate(dives, ORA);
    expect(gf99ConMargine(a.avgGf99, a.gf99, dives)).toBe(true);
  });

  it('e la riga di Statistiche dà lo stesso verdetto del piano', () => {
    const dives = conGf99(8, 64, 70);
    const a = aggregate(dives, ORA);
    const vista = montaStatistiche(dives, a);
    expect(verdettoDellaRiga(vista.host, 'GF99')).toBe('da migliorare');
    vista.smonta();

    const larghi = conGf99(8, 55, 85);
    const b = aggregate(larghi, ORA);
    const seconda = montaStatistiche(larghi, b);
    expect(verdettoDellaRiga(seconda.host, 'GF99')).toBe('buono');
    seconda.smonta();
  });

  it('lo scarto dal computer si dichiara sulle immersioni confrontabili, non su tutte', () => {
    // Quarantotto immersioni col nostro GF99; una sola porta anche quello del
    // computer, ed è l'unica su cui uno scarto si possa misurare.
    const dives = Array.from({ length: 48 }, (_, i) =>
      immersioneIl(3 + i * 7, {
        id: `s${i}`,
        computer: { gfLow: 20, gfHigh: 85 },
        metrics: metriche({ gf99Pct: 60 }),
        reported: i === 0 ? { gf99End: 72 } : undefined,
      }),
    );
    const a = aggregate(dives, ORA);
    expect(a.gf99.length).toBe(48);
    expect(a.gf99AgreementCount).toBe(1);
    expect(a.gf99Agreement).toBe(12);

    const vista = montaStatistiche(dives, a);
    const riga = [...vista.host.querySelectorAll('tr')].find((r) =>
      (r.textContent ?? '').includes('scarto dal computer'),
    );
    if (!riga) throw new Error('manca la riga con lo scarto dal computer');
    const dichiarate = riga.textContent!.match(/(\d+)\s+immersion\S*\s+·\s+scarto/);
    expect(dichiarate).not.toBeNull();
    expect(Number(dichiarate![1])).toBe(a.gf99AgreementCount);
    vista.smonta();
  });
});

// ---------------------------------------------------------------------------
// 4. «Permettono di calcolare il consumo» vuol dire pressioni E volume
// ---------------------------------------------------------------------------

describe('qualità dei dati', () => {
  const archivio = (volume: boolean): Dive[] =>
    Array.from({ length: 10 }, (_, i) =>
      immersioneIl(3 + i * 7, {
        id: `q${i}`,
        metrics: metriche({
          quality: {
            sampleCount: 240,
            sampleIntervalS: 10,
            hasProfile: true,
            hasTankPressure: true,
            hasCylinderVolume: volume,
          },
        }),
      }),
    );

  const conteggio = (dives: Dive[]) => {
    const f = buildPlan(dives, aggregate(dives, ORA), 'general').findings.find(
      (x) => x.id === 'data-coverage',
    );
    if (!f) throw new Error('manca la scheda della qualità dei dati');
    return numeroDi(f.evidence, 'calcolare il consumo');
  };

  it('con le pressioni ma senza il volume, il consumo non si calcola su nessuna', () => {
    // Prima ne dichiarava dieci su dieci, sotto un titolo che dice che
    // l'analisi è bloccata e sopra la riga «10 hanno la pressione ma non il
    // volume». Tre righe della stessa scheda, e la prima smentiva le altre due.
    expect(conteggio(archivio(false))).toBe(0);
  });

  it('col volume compilato, tutte e dieci', () => {
    expect(conteggio(archivio(true))).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 5. La tessera dell'ultimo tratto stampa la soglia con cui conta
// ---------------------------------------------------------------------------

describe('velocità sull’ultimo tratto', () => {
  it('il numero contato e la soglia stampata parlano della stessa cosa', () => {
    const dives = Array.from({ length: 8 }, (_, i) =>
      immersioneIl(3 + i * 7, {
        id: `r${i}`,
        metrics: metriche({ finalAscentRateMpm: 6.3 }),
      }),
    );
    const base = aggregate(dives, ORA);
    // La tessera vive dentro la scheda dell'ossigeno, che compare solo quando
    // c'è almeno una giornata calcolabile: qui i profili non servono al difetto,
    // quindi si apre la scheda e basta.
    const a: Aggregates = { ...base, oxygen: { ...base.oxygen, eligible: dives.length } };
    const vista = montaStatistiche(dives, a);
    const nota = tessera(vista.host, 'ultimo tratto');

    const letto = nota.match(/(\d+)\s*>\s*(\d+(?:\.\d+)?)\s*m\/min/);
    expect(letto).not.toBeNull();
    const contate = Number(letto![1]);
    const soglia = Number(letto![2]);

    expect(contate).toBe(a.finalAscentsOverAppLimit);
    /*
     * Il cuore della prova: le immersioni che superano la soglia STAMPATA
     * devono essere quelle contate. Con otto immersioni a 6,3 m/min e la
     * soglia scritta «6», la tessera diceva «0 > 6 m/min» — falso otto volte
     * su otto — mentre contava sopra 6,5.
     */
    expect(dives.filter((d) => (d.metrics!.finalAscentRateMpm ?? 0) > soglia).length).toBe(contate);
    vista.smonta();
  });
});

// ---------------------------------------------------------------------------
// 6 e 7. Il numero che decide è il numero che si mostra
// ---------------------------------------------------------------------------

describe('criteri di prontezza', () => {
  const dueImmersioni = [immersioneIl(3, { id: 'x1' }), immersioneIl(10, { id: 'x2' })];
  const conTassi = (over: Partial<Aggregates>): Aggregates => ({
    ...aggregate(dueImmersioni, ORA),
    ...over,
  });
  const storico = storicoDi(
    Array.from({ length: 200 }, (_, i) => immersioneIl(1 + i, { id: `st${i}`, maxDepth: 32 })),
    ORA,
  );

  it('il valore mostrato soddisfa il criterio mostrato, e la riga dice «ok»', () => {
    // 12 risalite fuori limite su 115 sono 0.104, che a schermo è 10%; 43 soste
    // su 48 sono 0.896, che a schermo è 90%. Le due righe mostravano
    // «10% / non oltre 10% · da fare» e «90% / almeno 90% · da fare».
    const agg = conTassi({ fastAscentRate: 12 / 115, safetyStopRate: 43 / 48, safetyStopEligible: 48 });
    const items = buildPlan([], agg, 'tec', storico).readiness.items;

    const risalite = items.find((i) => i.label === 'Immersioni con risalite fuori limite')!;
    expect(risalite.have).toBe(10);
    expect(risalite.need).toBe(10);
    expect(risalite.met).toBe(true);

    const soste = items.find((i) => i.label === 'Soste di sicurezza completate')!;
    expect(soste.have).toBe(90);
    expect(soste.need).toBe(90);
    expect(soste.met).toBe(true);
  });

  it('e vale per ogni riga: «met» è il confronto fra i due numeri stampati', () => {
    const agg = conTassi({
      fastAscentRate: 12 / 115,
      safetyStopRate: 43 / 48,
      safetyStopEligible: 48,
      // Un consumo che a schermo è esattamente il criterio, e che al centesimo
      // lo sfora: 20.04 si legge «20.0 / non oltre 20».
      avgRmv: 20.04,
      avgTrim: 2.04,
      decoDives: 6,
    });
    for (const goal of ['tec', 'deep-recreational', 'general'] as const) {
      for (const i of buildPlan([], agg, goal, storico).readiness.items) {
        if (i.have === undefined) continue;
        expect(i.met, `${goal} · ${i.label}: ${i.have} / ${i.need}`).toBe(
          i.lowerIsBetter ? i.have <= i.need : i.have >= i.need,
        );
      }
    }
  });
});

describe('le stesse percentuali nelle due schermate', () => {
  const dueImmersioni = [immersioneIl(3, { id: 'y1' }), immersioneIl(10, { id: 'y2' })];
  const conTassi = (over: Partial<Aggregates>): Aggregates => ({
    ...aggregate(dueImmersioni, ORA),
    ...over,
  });

  it('35 soste su 37 sono «nei limiti» di qua e di là', () => {
    const agg = conTassi({ safetyStopRate: 35 / 37, safetyStopEligible: 37 });
    // 94.6% arrotonda a 95, e il piano scriveva «95%» dentro il ramo «sotto il 95%».
    const piano = buildPlan([], agg, 'general');
    expect(piano.findings.find((f) => f.id.startsWith('safety-stop'))?.id).toBe('safety-stop-good');

    const vista = montaStatistiche(dueImmersioni, agg);
    expect(verdettoDellaRiga(vista.host, 'Sosta di sicurezza completata')).toBe('buono');
    vista.smonta();
  });

  it('sotto la soglia sono «da migliorare» di qua e di là', () => {
    const agg = conTassi({ safetyStopRate: 0.7, safetyStopEligible: 37 });
    const piano = buildPlan([], agg, 'general');
    expect(piano.findings.find((f) => f.id.startsWith('safety-stop'))?.id).toBe('safety-stop');

    const vista = montaStatistiche(dueImmersioni, agg);
    expect(verdettoDellaRiga(vista.host, 'Sosta di sicurezza completata')).toBe('da migliorare');
    vista.smonta();
  });

  it('il 3% di uscite sotto riserva è un punto di forza in tutte e due', () => {
    const agg = conTassi({ lowReserveRate: 0.03, lowReserveEligible: 100 });
    const piano = buildPlan([], agg, 'general');
    expect(piano.findings.find((f) => f.id.startsWith('reserve'))?.id).toBe('reserve-good');

    const vista = montaStatistiche(dueImmersioni, agg);
    expect(verdettoDellaRiga(vista.host, 'Uscite sotto i 50 bar')).toBe('buono');
    vista.smonta();
  });

  it('una uscita sotto riserva su 250 non si può stampare come «0%»', () => {
    const agg = conTassi({ lowReserveRate: 1 / 250, lowReserveEligible: 250 });
    const f = buildPlan([], agg, 'general').findings.find((x) => x.id === 'reserve-good');
    if (!f) throw new Error('manca la scheda della riserva');
    const stampata = numeroDi(f.evidence, 'sotto i 50 bar');
    expect(stampata).toBeGreaterThan(0);
    // E la percentuale stampata descrive davvero quella immersione.
    expect(Math.round((stampata / 100) * 250)).toBe(1);

    const vista = montaStatistiche(dueImmersioni, agg);
    const riga = [...vista.host.querySelectorAll('tr')].find((r) =>
      (r.textContent ?? '').includes('Uscite sotto i 50 bar'),
    );
    expect(numeroDi([riga!.textContent ?? ''], '%')).toBeGreaterThan(0);
    vista.smonta();
  });

  it('e le soglie non sono scritte due volte', () => {
    // Se qualcuno rimette un numero a mano in una delle due schermate, questa
    // riga non se ne accorge: se ne accorgono le quattro qui sopra. Questa dice
    // solo che il riferimento condiviso esiste ed è quello dichiarato.
    expect(BENCHMARK.safetyStopRate).toBe(0.9);
    expect(BENCHMARK.lowReserveRate).toBe(0.05);
  });
});

// ---------------------------------------------------------------------------
// 9. Le colonne dei mesi e i secchi delle immersioni
// ---------------------------------------------------------------------------

describe('attività mese per mese', () => {
  const ADESSO = Date.parse('2026-08-31T23:00:00Z');

  it('un’immersione che il logbook data al 1° settembre ha la sua colonna', () => {
    // In Italia (+2) le 22:30Z del 31 agosto sono l'una e mezza di notte del 1°
    // settembre, ed è la data che il logbook mostra. Le colonne si costruivano
    // sul mese UTC di adesso: quella di settembre non esisteva, e l'immersione
    // non finiva da nessuna parte.
    const dives = [
      immersione({ id: 'a', startTime: '2026-08-20T09:00:00Z', utcOffsetMinutes: 120 }),
      immersione({ id: 'b', startTime: '2026-08-25T09:00:00Z', utcOffsetMinutes: 120 }),
      immersione({ id: 'c', startTime: '2026-08-31T22:30:00Z', utcOffsetMinutes: 120 }),
    ];
    const a = aggregate(dives, ADESSO);
    expect(a.count).toBe(3);
    expect(a.byMonth).toHaveLength(24);
    // La somma delle colonne è il numero scritto sopra l'istogramma: faceva 2.
    expect(a.byMonth.reduce((s, b) => s + b.value, 0)).toBe(a.count);
    expect(a.byMonth.find((b) => b.key === '2026-09')?.value).toBe(1);
    expect(a.byMonth.find((b) => b.key === '2026-08')?.value).toBe(2);
  });

  it('senza fuso dichiarato l’ultima colonna resta il mese di adesso', () => {
    const dives = [immersione({ id: 'd', startTime: '2026-08-31T22:30:00Z' })];
    const a = aggregate(dives, ADESSO);
    expect(a.byMonth[23]!.key).toBe('2026-08');
    expect(a.byMonth.find((b) => b.key === '2026-08')?.value).toBe(1);
  });

  it('una data sbagliata in archivio non allunga il grafico su mesi vuoti', () => {
    const dives = [
      immersione({ id: 'e', startTime: '2026-08-20T09:00:00Z' }),
      immersione({ id: 'f', startTime: '2030-01-10T09:00:00Z' }),
    ];
    const a = aggregate(dives, ADESSO);
    // Al massimo un mese oltre quello di adesso: un fuso sposta ore, non anni.
    expect(a.byMonth[23]!.key).toBe('2026-09');
    expect(a.byMonth.find((b) => b.key === '2026-08')?.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 11. Confronta: la differenza è quella fra i numeri mostrati
// ---------------------------------------------------------------------------

describe('confronto fra due immersioni', () => {
  it('la colonna «Differenza» torna con le due accanto', async () => {
    // 45:02 e 45:04 sono 45.033 e 45.067 minuti: arrotondati «45.0» e «45.1»,
    // e la differenza fra i valori pieni si stampava «+0.0».
    const sinistra = immersione({ id: 'p', startTime: '2026-06-01T09:00:00Z', durationS: 2702 });
    const destra = immersione({ id: 'q', startTime: '2026-06-02T09:00:00Z', durationS: 2704 });
    finto.valore = { dives: [sinistra, destra], loadSamples: async () => [] };

    const vista = monta(<Compare onOpen={() => undefined} />);
    await act(async () => {
      await Promise.resolve();
    });

    const riga = [...vista.host.querySelectorAll('tr')].find((r) =>
      (r.querySelector('td')?.textContent ?? '').startsWith('Durata'),
    );
    if (!riga) throw new Error('manca la riga della durata');
    const celle = [...riga.querySelectorAll('td')].map((c) => c.textContent ?? '');
    const n = (s: string) => Number((s.match(/-?\d+(?:\.\d+)?/) ?? ['NaN'])[0]);

    expect(n(celle[1]!)).toBe(45);
    expect(n(celle[2]!)).toBe(45.1);
    expect(n(celle[3]!)).toBe(0.1);
    // L'invariante, non il caso: la terza colonna è la sottrazione delle altre due.
    expect(n(celle[3]!)).toBe(Math.round((n(celle[2]!) - n(celle[1]!)) * 10) / 10);
    vista.smonta();
  });
});
