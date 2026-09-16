/**
 * QUATTRO NUMERI CHE DICEVANO UNA COSA DIVERSA DA QUELLA CHE AVEVANO ACCANTO.
 *
 * Trovati il 16 settembre 2026 nella stessa passata, diversi in tutto tranne
 * che nella forma: **un numero giusto nella sua casella e falso rispetto alla
 * casella accanto.** Nessuno di loro è un errore che si vede: sono tutti dati
 * plausibili.
 *
 *  1. La **MOD dell'analisi del gas** non teneva conto di acqua e quota,
 *     mentre i tre riquadri accanto sulla stessa pagina sì.
 *  2. Il **minimo e il massimo della zavorra** non erano arrotondati come la
 *     mediana che sta in mezzo a loro.
 *  3. La nota verde **«Niente in circolo — nessuna nota da leggere»** finiva
 *     sopra alle note che c'erano da leggere.
 *  4. Il **numero progressivo** non era deterministico: un confronto che
 *     restituisce `NaN` rende l'ordinamento indefinito, e le stesse quattro
 *     immersioni ricevevano tre numerazioni diverse a seconda dell'ordine in
 *     cui arrivavano.
 */

import { describe, expect, it } from 'vitest';
import { scartiDiAnalisi } from '../src/core/analisiGas';
import { zavorraPerMutaEAcqua } from '../src/core/analysis/gearStats';
import { nextDiveBriefing } from '../src/core/analysis/nextDive';
import { numeriProgressivi } from '../src/core/numerazione';
import { perData, istanteDi } from '../src/core/oraAParete';
import { mod } from '../src/core/units';
import { AIR, type Dive } from '../src/core/model';

const BOMBOLA_CONTESTATA = [
  { mix: { o2: 0.32, he: 0 }, sizeL: 12, startBar: 200, endBar: 80, analisi: { o2: 0.36 } },
];

describe('la MOD dell’analisi guarda l’acqua e la quota', () => {
  it('al mare dice quello che ha sempre detto', () => {
    const [s] = scartiDiAnalisi(BOMBOLA_CONTESTATA);
    expect(s.modDichiarata).toBeCloseTo(mod({ o2: 0.32, he: 0 }), 3);
  });

  it('in un lago in quota dice la MOD di quel lago, non quella del mare', () => {
    /*
     * ► IL CUORE. ◄ EAN32 in un lago a 2000 m: 0.795 bar, acqua dolce. La MOD
     * vera è più profonda di quella al mare — meno pressione sopra la testa —
     * e la funzione ne dichiarava 29.6 dove sono 33.3. Prudente, e comunque
     * l'unico numero della schermata che non teneva conto della quota.
     */
    const [lago] = scartiDiAnalisi(BOMBOLA_CONTESTATA, {
      salinity: 'fresh',
      surfacePressureBar: 0.795,
    });
    const [mare] = scartiDiAnalisi(BOMBOLA_CONTESTATA);
    expect(lago.modDichiarata).toBeGreaterThan(mare.modDichiarata + 3);
    expect(lago.modDichiarata).toBeCloseTo(mod({ o2: 0.32, he: 0 }, 1.4, 'fresh', 0.795), 3);
    // E anche quella analizzata, che è il numero che l'avviso nomina per primo.
    expect(lago.modAnalizzata).toBeGreaterThan(mare.modAnalizzata + 2);
  });

  it('una pressione impossibile in archivio non la fa diventare un altro numero', () => {
    const [zero] = scartiDiAnalisi(BOMBOLA_CONTESTATA, { surfacePressureBar: 0 });
    const [niente] = scartiDiAnalisi(BOMBOLA_CONTESTATA);
    expect(zero.modDichiarata).toBe(niente.modDichiarata);
  });
});

/**
 * Un'immersione con cintura e piastra.
 *
 * I due pesi restano SEPARATI e si sommano dentro `zavorraTotaleKg`, che è
 * dove la somma avviene davvero: `1.4 + 5.3` in virgola mobile fa
 * `6.699999999999999`, ed è quella la cifra che finiva a schermo. Sommandoli
 * qui nella prova, la coda non si formerebbe e la prova non misurerebbe niente.
 */
function immersioneConZavorra(id: string, quando: string, kg: [number, number]): Dive {
  return {
    id,
    startTime: quando,
    durationS: 2400,
    maxDepth: 20,
    mode: 'oc',
    salinity: 'salt',
    cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 80 }],
    source: { format: 'uddf', file: 't', importedAt: quando },
    tags: [],
    suit: 'Muta umida 5 mm',
    weightKg: kg[0],
    gear: { backplateKg: kg[1] },
  } as unknown as Dive;
}

describe('la zavorra: minimo e massimo arrotondati come la mediana', () => {
  const righe = zavorraPerMutaEAcqua(
    [
      immersioneConZavorra('a', '2026-01-01T10:00:00.000Z', [1.4, 5.3]),
      immersioneConZavorra('b', '2026-01-02T10:00:00.000Z', [4.0, 4.0]),
      immersioneConZavorra('c', '2026-01-03T10:00:00.000Z', [5.0, 4.5]),
    ],
    1,
  );

  it('c’è una riga, altrimenti non sto misurando niente', () => {
    expect(righe).toHaveLength(1);
    expect(righe[0].dives).toBe(3);
  });

  it('nessuno dei tre numeri ha più di un decimale', () => {
    // Prima: «6.699999999999999–9.5 kg» accanto a una mediana scritta «8».
    for (const v of [righe[0].minKg, righe[0].medianKg, righe[0].maxKg]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBe(Math.round(v * 10) / 10);
    }
    // `1.4 + 5.3` fa 6.699999999999999, ed è quello che usciva a schermo.
    expect(1.4 + 5.3).not.toBe(6.7);
    expect(righe[0].minKg).toBe(6.7);
  });
});

describe('«Niente in circolo» vale solo se non c’è nient’altro', () => {
  const vuoto = { dives: [] as Dive[], now: Date.parse('2026-06-14T10:00:00.000Z') };

  it('su un archivio vuoto la nota verde non compare: c’è «Archivio vuoto»', () => {
    const { notes } = nextDiveBriefing(vuoto.dives, undefined, vuoto.now);
    expect(notes.some((n) => n.id === 'no-dives')).toBe(true);
    expect(notes.some((n) => n.id === 'clear')).toBe(false);
  });

  it('con una nota da leggere la verde non compare, e non la scavalca', () => {
    /*
     * ► IL CUORE. ◄ La condizione contava solo le note non informative più le
     * due del residuo: `focus` è `info`, quindi non la faceva scattare, e la
     * verde ha priorità 30 contro 40 — finiva SOPRA. La schermata diceva
     * «nessuna nota da leggere» e subito sotto la nota da leggere.
     */
    const recente: Dive = {
      ...immersioneConZavorra('x', '2026-06-13T10:00:00.000Z', [6, 0]),
      metrics: undefined,
    };
    const { notes } = nextDiveBriefing(
      [recente],
      { headline: 'Assetto sulla sosta', area: 'trim' },
      Date.parse('2026-06-14T10:00:00.000Z'),
    );
    expect(notes.some((n) => n.id === 'focus')).toBe(true);
    expect(notes.some((n) => n.id === 'clear')).toBe(false);
  });
});

describe('il numero progressivo non dipende dall’ordine in cui arrivano', () => {
  const immersioni = (): Dive[] => [
    immersioneConZavorra('d1', '2026-01-03T10:00:00.000Z', [6, 0]),
    immersioneConZavorra('d2', '2026-01-01T10:00:00.000Z', [6, 0]),
    // Due senza una data leggibile: è il caso che rompeva tutto.
    immersioneConZavorra('d3', 'non una data', [6, 0]),
    immersioneConZavorra('d4', '', [6, 0]),
  ];

  /** Tutte le permutazioni di quattro elementi: 24 ordini di arrivo. */
  function permutazioni<T>(a: T[]): T[][] {
    if (a.length <= 1) return [a];
    return a.flatMap((x, i) => permutazioni([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r]));
  }

  it('ventiquattro ordini di arrivo danno la stessa numerazione', () => {
    const atteso = [...numeriProgressivi(immersioni()).entries()].sort().map(String).join('|');
    // Il riferimento deve essere sensato prima di essere confrontato.
    expect(numeriProgressivi(immersioni()).get('d2')).toBe(1);
    expect(numeriProgressivi(immersioni()).get('d1')).toBe(2);

    const visti = new Set<string>();
    for (const ordine of permutazioni(immersioni())) {
      visti.add([...numeriProgressivi(ordine).entries()].sort().map(String).join('|'));
    }
    expect([...visti]).toEqual([atteso]);
  });

  it('e le immersioni senza data vanno in fondo, dove non spostano le altre', () => {
    const n = numeriProgressivi(immersioni());
    expect(n.get('d3')!).toBeGreaterThan(n.get('d1')!);
    expect(n.get('d4')!).toBeGreaterThan(n.get('d1')!);
  });
});

describe('il confronto cronologico, da solo', () => {
  it('non restituisce mai `NaN`', () => {
    const cmp = perData<{ q?: string }>((x) => x.q);
    for (const a of ['2026-01-01T00:00:00Z', 'boh', '', undefined]) {
      for (const b of ['2026-01-01T00:00:00Z', 'boh', '', undefined]) {
        expect(Number.isNaN(cmp({ q: a }, { q: b }))).toBe(false);
      }
    }
  });

  it('mette le voci senza data in fondo in tutti e due i versi', () => {
    const voci = [{ q: undefined }, { q: '2026-01-02T00:00:00Z' }, { q: '2026-01-01T00:00:00Z' }];
    expect([...voci].sort(perData((x) => x.q)).map((x) => x.q)).toEqual([
      '2026-01-01T00:00:00Z',
      '2026-01-02T00:00:00Z',
      undefined,
    ]);
    expect([...voci].sort(perData((x) => x.q, 'decrescente')).map((x) => x.q)).toEqual([
      '2026-01-02T00:00:00Z',
      '2026-01-01T00:00:00Z',
      undefined,
    ]);
  });

  it('`istanteDi` dice «non lo so» invece di dire `NaN`', () => {
    expect(istanteDi('2026-01-01T00:00:00Z')).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(istanteDi('boh')).toBeUndefined();
    expect(istanteDi('')).toBeUndefined();
    expect(istanteDi(undefined)).toBeUndefined();
  });
});
