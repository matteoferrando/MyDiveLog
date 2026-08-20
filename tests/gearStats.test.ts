/**
 * L'attrezzatura incrociata col resto del log.
 *
 * Due famiglie di prove, e la seconda è quella che conta di più:
 *  - che gli incroci raggruppino e ordinino come dichiarato;
 *  - che la ZAVORRA sia sempre il totale, piastra compresa, in OGNI punto in cui
 *    viene mostrata. Sono due campi separati per un motivo, e dimenticarsi di
 *    sommarli racconta il contrario di quello che succede in acqua: chi ha una
 *    piastra d'acciaio da 3 kg e scrive «2 kg di zavorra» ne porta cinque.
 */

import { describe, expect, it } from 'vitest';
import {
  consumoPerAttrezzo,
  mutaFuoriAbitudine,
  mutaPerTemperatura,
  nomeBombola,
  nomeMuta,
  nomiErogatori,
  stagioneTesto,
  zavorraPerMutaEAcqua,
} from '../src/core/analysis/gearStats';
import {
  piastraDellImmersione,
  weightingBySuit,
  zavorraTotaleKg,
  type Equipment,
} from '../src/core/analysis/gear';
import { logbookHtml } from '../src/core/export/logbookPrint';
import { diveContext } from '../src/ai/context';
import type { Dive } from '../src/core/model';

let contatore = 0;
const imm = (over: Partial<Dive> = {}): Dive =>
  ({
    id: `d${contatore++}`,
    startTime: '2026-06-14T10:00:00.000Z',
    utcOffsetMinutes: 120,
    durationS: 2400,
    maxDepth: 20,
    cylinders: [{ mix: { o2: 0.21, he: 0 } }],
    source: { format: 'logtrak', file: 'a', importedAt: 'x' },
    tags: [],
    ...over,
  }) as Dive;

const GAV: Equipment = {
  id: 'gav1',
  kind: 'bcd',
  name: 'Divesystem 3K',
  service: 'none',
  plateKg: 2,
  backplateKg: 1.5,
};

// ---------------------------------------------------------------------------
// La piastra non si perde per strada
// ---------------------------------------------------------------------------

describe('la zavorra è sempre il totale, piastra compresa', () => {
  it('somma quello che c’è scritto sull’immersione', () => {
    expect(zavorraTotaleKg(imm({ weightKg: 2, gear: { backplateKg: 3 } }))).toBe(5);
  });

  /*
   * IL BUCO VERO. Il peso della piastra si scrive sul GAV nell'inventario e da lì
   * viene proposto sull'immersione quando scegli quel GAV. Chi compila il peso
   * OGGI ha già cento immersioni con quel GAV e nessun chilo scritto sopra: senza
   * il ripiego sull'inventario, ogni statistica sulla zavorra le racconta senza
   * piastra e nessuno se ne accorge.
   */
  it('lo recupera dal GAV quando l’immersione non lo porta', () => {
    const d = imm({ weightKg: 4, gear: { bcd: { id: 'gav1', name: 'Divesystem 3K' } } });
    expect(zavorraTotaleKg(d)).toBe(4);
    expect(zavorraTotaleKg(d, [GAV])).toBe(7.5);
    expect(piastraDellImmersione(d, [GAV])).toBe(3.5);
  });

  it('ma quello che c’è scritto sull’immersione vince sempre', () => {
    const d = imm({ weightKg: 4, gear: { bcd: { id: 'gav1', name: 'Divesystem 3K' }, backplateKg: 0 } });
    expect(zavorraTotaleKg(d, [GAV])).toBe(4);
  });

  /*
   * Chi scende con una piastra d'acciaio e zero piombo addosso ha una zavorra
   * totale vera, e finiva fuori tabella come se non avesse scritto niente.
   */
  it('la tabella per muta non scarta chi ha solo la piastra', () => {
    const righe = weightingBySuit(
      [
        imm({ suit: 'Stagna', gear: { bcd: { id: 'gav1', name: 'Divesystem 3K' } } }),
        imm({ suit: 'Stagna', gear: { bcd: { id: 'gav1', name: 'Divesystem 3K' } } }),
      ],
      2,
      [GAV],
    );
    expect(righe).toHaveLength(1);
    expect(righe[0].medianKg).toBe(3.5);
    expect(righe[0].withBackplate).toBe(2);
  });

  it('e senza inventario quelle stesse immersioni restano fuori, invece di valere zero', () => {
    const righe = weightingBySuit([
      imm({ suit: 'Stagna', gear: { bcd: { id: 'gav1', name: 'Divesystem 3K' } } }),
      imm({ suit: 'Stagna', gear: { bcd: { id: 'gav1', name: 'Divesystem 3K' } } }),
    ]);
    expect(righe).toEqual([]);
  });

  it('il foglio da stampare dichiara il totale', () => {
    const html = logbookHtml(
      [imm({ weightKg: 4, gear: { bcd: { id: 'gav1', name: 'Divesystem 3K' } } })],
      new Map(),
      { now: '2026-08-20T10:00:00Z', inventario: [GAV] },
    );
    expect(html).toContain('7.5 kg');
  });

  it('e il contesto per il modello anche, con la scomposizione accanto', () => {
    const testo = diveContext(imm({ weightKg: 4, gear: { bcd: { id: 'gav1', name: 'Divesystem 3K' } } }), [
      GAV,
    ]);
    expect(testo).toContain('"zavorraTotaleKg": 7.5');
    expect(testo).toContain('"diCuiPiastraKg": 3.5');
  });
});

// ---------------------------------------------------------------------------
// Gli incroci
// ---------------------------------------------------------------------------

describe('nomi degli attrezzi', () => {
  it('la muta viene dal riferimento, e in mancanza dal testo', () => {
    expect(nomeMuta(imm({ suit: 'Umida 5mm' }))).toBe('Umida 5mm');
    expect(nomeMuta(imm({ suit: 'Umida 5mm', gear: { suit: { id: 's', name: 'Stagna' } } }))).toBe('Stagna');
    expect(nomeMuta(imm({}))).toBeUndefined();
  });

  it('gli erogatori non si contano due volte', () => {
    const d = imm({
      gear: {
        regulators: [
          { id: 'a', name: 'Apeks XTX50' },
          { id: 'b', name: 'apeks xtx 50' },
        ],
      },
    });
    expect(nomiErogatori(d)).toEqual(['Apeks XTX50']);
  });

  it('la bombola porta litri e materiale, e sparisce se ce n’è più d’una', () => {
    expect(
      nomeBombola(imm({ cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: 12, material: 'steel' }] })),
    ).toBe('12 L acciaio');
    expect(nomeBombola(imm({ cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: 11.1 }] }))).toBe('11.1 L');
    expect(
      nomeBombola(
        imm({
          cylinders: [
            { mix: { o2: 0.21, he: 0 }, sizeL: 12 },
            { mix: { o2: 0.5, he: 0 }, sizeL: 7 },
          ],
        }),
      ),
    ).toBeUndefined();
  });
});

describe('la stagione si scrive come intervallo, e l’anno è circolare', () => {
  it('mesi consecutivi', () => expect(stagioneTesto([6, 7, 8])).toBe('giu–ago'));
  it('un mese solo', () => expect(stagioneTesto([3])).toBe('mar'));
  // Il caso che un ordinamento numerico sbaglierebbe: una muta invernale.
  it('a cavallo dell’anno', () => expect(stagioneTesto([11, 12, 1, 2])).toBe('nov–feb'));
  it('tutto l’anno', () =>
    expect(stagioneTesto([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe('tutto l’anno'));
  it('niente', () => expect(stagioneTesto([])).toBe('—'));
});

describe('muta e temperatura', () => {
  const dives = [
    imm({ suit: 'Umida 5mm', minTempC: 25, startTime: '2026-07-10T10:00:00.000Z' }),
    imm({ suit: 'Umida 5mm', minTempC: 24, startTime: '2026-08-10T10:00:00.000Z' }),
    imm({ suit: 'Umida 5mm', minTempC: 20, startTime: '2026-06-10T10:00:00.000Z' }),
    imm({ suit: 'Stagna', minTempC: 13, startTime: '2026-01-10T10:00:00.000Z' }),
    imm({ suit: 'Stagna', minTempC: 14, startTime: '2026-02-10T10:00:00.000Z' }),
    imm({ suit: 'Stagna', minTempC: 12, startTime: '2026-12-10T10:00:00.000Z' }),
  ];

  it('ordina dalla muta più calda alla più fredda', () => {
    expect(mutaPerTemperatura(dives).map((r) => r.suit)).toEqual(['Umida 5mm', 'Stagna']);
  });

  it('la più fredda affrontata è un minimo, non una mediana', () => {
    const stagna = mutaPerTemperatura(dives).find((r) => r.suit === 'Stagna')!;
    expect(stagna.minTempC).toBe(12);
    expect(stagna.medianTempC).toBe(13);
    expect(stagna.stagione).toBe('dic–feb');
  });

  it('sotto la soglia una muta non entra', () => {
    expect(mutaPerTemperatura([imm({ suit: 'Umida', minTempC: 20 })])).toEqual([]);
  });

  it('segnala l’immersione fuori abitudine, non tutte quelle diverse', () => {
    const fuori = mutaFuoriAbitudine([
      ...dives,
      imm({ suit: 'Umida 5mm', minTempC: 13, startTime: '2026-03-10T10:00:00.000Z' }),
    ]);
    expect(fuori).toHaveLength(1);
    expect(fuori[0].suit).toBe('Umida 5mm');
    expect(fuori[0].solita).toBe('Stagna');
  });
});

describe('zavorra per muta e tipo d’acqua', () => {
  // Tre per gruppo: la soglia è la stessa delle altre due tabelle della scheda,
  // perché con soglie diverse una muta compariva in una e non nelle altre.
  const dives = [
    imm({ suit: 'Umida 5mm', salinity: 'salt', weightKg: 6 }),
    imm({ suit: 'Umida 5mm', salinity: 'salt', weightKg: 6 }),
    imm({ suit: 'Umida 5mm', salinity: 'salt', weightKg: 6 }),
    imm({ suit: 'Umida 5mm', salinity: 'fresh', weightKg: 4 }),
    imm({ suit: 'Umida 5mm', salinity: 'fresh', weightKg: 4 }),
    imm({ suit: 'Umida 5mm', salinity: 'fresh', weightKg: 4 }),
  ];

  /*
   * IL PUNTO DI TUTTA LA TABELLA: mescolate darebbero 5 kg, un numero che non è
   * giusto in nessuna delle due situazioni ed è peggio di non averlo.
   */
  it('tiene separate dolce e salata', () => {
    const righe = zavorraPerMutaEAcqua(dives);
    expect(righe).toHaveLength(2);
    expect(righe.find((r) => r.salinity === 'salt')?.medianKg).toBe(6);
    expect(righe.find((r) => r.salinity === 'fresh')?.medianKg).toBe(4);
  });

  it('somma la piastra anche qui, presa dal GAV', () => {
    const righe = zavorraPerMutaEAcqua(
      dives.map((d) => ({ ...d, gear: { bcd: { id: 'gav1', name: 'Divesystem 3K' } } })),
      3,
      [GAV],
    );
    expect(righe.find((r) => r.salinity === 'salt')?.medianKg).toBe(9.5);
    expect(righe.find((r) => r.salinity === 'salt')?.withBackplate).toBe(3);
  });

  it('riporta la bombola più usata del gruppo', () => {
    const righe = zavorraPerMutaEAcqua(
      dives.map((d, i) => ({
        ...d,
        cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: i === 0 ? 15 : 12, material: 'steel' as const }],
      })),
    );
    expect(righe.find((r) => r.salinity === 'fresh')?.bombolaPiuUsata).toBe('12 L acciaio');
  });
});

describe('consumo per attrezzo', () => {
  const con = (nome: string, rmv: number, depth = 20) =>
    imm({
      gear: { regulators: [{ id: nome, name: nome }] },
      maxDepth: depth,
      metrics: { rmvLpm: rmv } as Dive['metrics'],
    });

  it('confronta due erogatori e ordina dal consumo più basso', () => {
    const t = consumoPerAttrezzo([
      con('A', 14),
      con('A', 15),
      con('A', 16),
      con('B', 20),
      con('B', 21),
      con('B', 22),
    ]);
    const erogatori = t.find((x) => x.titolo === 'Erogatore')!;
    expect(erogatori.righe.map((r) => r.etichetta)).toEqual(['A', 'B']);
    expect(erogatori.righe[0].medianRmvLpm).toBe(15);
  });

  /*
   * Con un gruppo solo non c'è niente da confrontare, e la riga singola invita a
   * leggere quel numero come una proprietà dell'attrezzo invece che del subacqueo.
   */
  it('con un gruppo solo la tabella non compare', () => {
    expect(consumoPerAttrezzo([con('A', 14), con('A', 15), con('A', 16)])).toEqual([]);
  });

  it('porta accanto la profondità, che è quello che smonta il confronto', () => {
    const t = consumoPerAttrezzo([
      con('A', 14, 12),
      con('A', 15, 12),
      con('A', 16, 12),
      con('B', 20, 38),
      con('B', 21, 38),
      con('B', 22, 38),
    ]);
    const righe = t.find((x) => x.titolo === 'Erogatore')!.righe;
    expect(righe.map((r) => r.medianMaxDepth)).toEqual([12, 38]);
  });
});
