/**
 * Attrezzatura, brevetti, zavorra.
 *
 * Riscritto insieme al modulo, ad agosto 2026. Il test vecchio verificava gli
 * stati `ok | due | expired` di una lista unica, e quegli stati non esistono più:
 * il modulo restituisce FATTI — mesi passati, prossima data — e non giudizi,
 * perché per giudicare servirebbe sapere se la bombola è in garage da un anno.
 *
 * Le due cose che vale la pena inchiodare sono l'aritmetica delle date (sommare
 * mesi è la funzione che tutti scrivono male, e il 31 gennaio più un mese è il
 * caso che la rompe) e la migrazione dai dati vecchi: chi aggiorna l'app non deve
 * perdere niente di quello che aveva digitato.
 */

import { describe, expect, it } from 'vitest';
import {
  addMonths,
  configurationRows,
  highestLevel,
  migrateGear,
  serviceFacts,
  sortEquipment,
  weightingBySuit,
  type Certification,
  type Equipment,
  type LegacyGearItem,
} from '../src/core/analysis/gear';
import { computeMetrics } from '../src/core/analysis/metrics';
import type { Dive } from '../src/core/model';
import { synthesise } from './fixtures';

const NOW = Date.parse('2026-08-17T12:00:00Z');

const attrezzo = (over: Partial<Equipment> = {}): Equipment => ({
  id: 'x',
  kind: 'cylinder',
  name: 'D12 200',
  service: 'hydro',
  ...over,
});

describe('somma di mesi a una data', () => {
  it('caso normale', () => {
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', 24)).toBe('2028-01-15');
  });

  it('tiene i giorni impossibili dentro il mese giusto', () => {
    // Il 31 gennaio più un mese non è il 3 marzo: è il 28 febbraio. È l'errore
    // che si fa con `setMonth` senza prima azzerare il giorno.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-05-31', 1)).toBe('2026-06-30');
  });

  it('su una data non valida non inventa niente', () => {
    expect(addMonths('non una data', 12)).toBeUndefined();
  });
});

describe('fatti sulla manutenzione, senza giudizio', () => {
  it('senza manutenzione periodica non dice niente', () => {
    expect(serviceFacts(attrezzo({ service: 'none', lastServiceOn: '2020-01-01' }), NOW)).toEqual({});
  });

  it('senza data dell’ultima non dice niente', () => {
    // Un pezzo senza date non è «a posto» né «scaduto»: è un pezzo di cui non
    // si sa niente, e la risposta giusta è il silenzio.
    expect(serviceFacts(attrezzo({ intervalMonths: 24 }), NOW)).toEqual({});
  });

  it('con la sola data dice quanto tempo è passato', () => {
    const f = serviceFacts(attrezzo({ lastServiceOn: '2025-08-17' }), NOW);
    expect(f.monthsSince).toBe(12);
    expect(f.nextOn).toBeUndefined();
    expect(f.monthsToNext).toBeUndefined();
  });

  it('con data e intervallo calcola la prossima, avanti e indietro', () => {
    const futura = serviceFacts(attrezzo({ lastServiceOn: '2025-08-17', intervalMonths: 24 }), NOW);
    expect(futura.nextOn).toBe('2027-08-17');
    expect(futura.monthsToNext).toBe(12);

    const passata = serviceFacts(attrezzo({ lastServiceOn: '2023-01-10', intervalMonths: 24 }), NOW);
    expect(passata.nextOn).toBe('2025-01-10');
    // Negativo: la data è indietro. Ma resta un numero, non un allarme.
    expect(passata.monthsToNext).toBeLessThan(0);
    expect(passata.monthsSince).toBeGreaterThan(40);
  });
});

describe('ordinamento', () => {
  it('i ritirati vanno in fondo, il resto per tipo e nome', () => {
    const list: Equipment[] = [
      attrezzo({ id: 'a', kind: 'regulator', name: 'Zeta' }),
      attrezzo({ id: 'b', kind: 'cylinder', name: 'S80' }),
      attrezzo({ id: 'c', kind: 'cylinder', name: 'D12', retired: true }),
      attrezzo({ id: 'd', kind: 'regulator', name: 'Alfa' }),
    ];
    expect(sortEquipment(list).map((x) => x.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('livello più alto', () => {
  const cert = (level: Certification['level']): Certification => ({
    id: level,
    agency: 'X',
    name: level,
    level,
  });

  it('senza brevetti dice che non lo sa, invece di assumere il primo livello', () => {
    // È un'affermazione su una persona: senza dati non si fa.
    expect(highestLevel([])).toBeUndefined();
  });

  it('prende il massimo, non l’ultimo inserito', () => {
    expect(highestLevel([cert('tech'), cert('base')])).toBe('tech');
    expect(highestLevel([cert('base'), cert('advanced')])).toBe('advanced');
  });
});

describe('zavorra ricavata dalle immersioni', () => {
  const conMuta = (id: string, suit: string | undefined, weightKg: number | undefined): Dive => {
    const s = synthesise({ startTime: new Date('2026-06-14T09:00:00Z') });
    const base: Dive = {
      id,
      startTime: '2026-06-14T09:00:00Z',
      durationS: s.spec.durationS,
      maxDepth: Math.max(...s.samples.map((w) => w.depth)),
      mode: 'oc',
      cylinders: [{ mix: { o2: 0.21, he: 0 } }],
      source: { format: 'uddf', file: 'x', importedAt: 'x' },
      tags: [],
      suit,
      weightKg,
      samples: s.samples.map((w) => ({ t: w.t, depth: w.depth })),
    };
    return { ...base, metrics: computeMetrics(base) };
  };

  it('salta le immersioni a cui manca uno dei due campi', () => {
    const rows = weightingBySuit([
      conMuta('a', 'umida 5 mm', 6),
      conMuta('b', 'umida 5 mm', 6),
      conMuta('c', undefined, 6),
      conMuta('d', 'stagna', undefined),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].suit).toBe('umida 5 mm');
    expect(rows[0].dives).toBe(2);
  });

  it('tace sotto il minimo, perché una immersione non è una configurazione', () => {
    expect(weightingBySuit([conMuta('a', 'stagna', 8)])).toEqual([]);
  });

  it('dà mediana e intervallo, e dichiara su quante immersioni misura l’assetto', () => {
    const rows = weightingBySuit([
      conMuta('a', 'stagna', 8),
      conMuta('b', 'stagna', 10),
      conMuta('c', 'stagna', 9),
    ]);
    expect(rows[0].medianKg).toBe(9);
    expect(rows[0].minKg).toBe(8);
    expect(rows[0].maxKg).toBe(10);
    // Il profilo sintetico produce un assetto misurabile: la base deve dirlo.
    expect(rows[0].trimBasis).toBe(3);
    expect(rows[0].medianTrimMpm).toBeGreaterThan(0);
  });
});

describe('configurazione contata sui log', () => {
  const conBombole = (n: number, mode: Dive['mode'] = 'oc'): Dive => ({
    id: `c${n}${mode}`,
    startTime: '2026-06-14T09:00:00Z',
    durationS: 2400,
    maxDepth: 30,
    mode,
    cylinders: Array.from({ length: n }, () => ({ mix: { o2: 0.21, he: 0 } })),
    source: { format: 'uddf', file: 'x', importedAt: 'x' },
    tags: [],
  });

  it('raggruppa per numero di bombole e per modalità', () => {
    const rows = configurationRows([
      conBombole(1),
      conBombole(1),
      conBombole(2),
      conBombole(0),
      conBombole(1, 'ccr'),
    ]);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.dives]));
    expect(byLabel['Una bombola']).toBe(2);
    expect(byLabel['Due bombole']).toBe(1);
    expect(byLabel['Bombole non registrate']).toBe(1);
    expect(byLabel['Rebreather a circuito chiuso']).toBe(1);
    // In ordine di frequenza: è così che si legge.
    expect(rows[0].dives).toBeGreaterThanOrEqual(rows[rows.length - 1].dives);
  });
});

describe('migrazione dalla lista unica', () => {
  const vecchio = (over: Partial<LegacyGearItem>): LegacyGearItem => ({
    id: 'v',
    kind: 'regulator',
    name: 'Apeks XTX50',
    ...over,
  });

  it('un archivio già nuovo passa intatto', () => {
    const nuovo = { equipment: [attrezzo()], certifications: [] };
    expect(migrateGear(nuovo)).toBe(nuovo);
  });

  it('niente da migrare dà due elenchi vuoti, non undefined', () => {
    expect(migrateGear(null)).toEqual({ equipment: [], certifications: [] });
    expect(migrateGear([])).toEqual({ equipment: [], certifications: [] });
  });

  it('l’attrezzatura vera diventa attrezzatura, con la sua manutenzione', () => {
    const { equipment } = migrateGear([
      vecchio({
        kind: 'cylinder',
        name: 'D12',
        serial: 'AB123',
        lastServiceDate: '2025-03-01',
        intervalMonths: 24,
      }),
    ]);
    expect(equipment).toHaveLength(1);
    expect(equipment[0]).toMatchObject({
      kind: 'cylinder',
      name: 'D12',
      serial: 'AB123',
      service: 'hydro',
      lastServiceOn: '2025-03-01',
      intervalMonths: 24,
    });
  });

  it('i brevetti diventano brevetti, e il livello NON viene indovinato', () => {
    const { certifications, equipment } = migrateGear([
      vecchio({
        kind: 'certification',
        name: 'Advanced Open Water',
        serial: 'PADI-99',
        lastServiceDate: '2019-07-01',
      }),
    ]);
    expect(equipment).toHaveLength(0);
    expect(certifications[0]).toMatchObject({
      name: 'Advanced Open Water',
      number: 'PADI-99',
      issuedOn: '2019-07-01',
      // Dal nome commerciale si potrebbe TENTARE di dedurre «advanced», ma
      // sarebbe un'affermazione inventata su un dato di una persona: si mette il
      // primo livello e si lascia correggere.
      level: 'base',
    });
  });

  it('certificato medico e assicurazione NON si buttano', () => {
    // Non esistono più come categoria, perché non ci sono più avvisi. Ma
    // qualcuno le aveva digitate, e buttare in silenzio quello che una persona
    // ha scritto è il modo più rapido di fargli perdere fiducia nell'archivio.
    const { equipment, certifications } = migrateGear([
      vecchio({ id: 'm', kind: 'medical', name: 'Dott. Rossi', expiresOn: '2027-01-15' }),
      vecchio({
        id: 'i',
        kind: 'insurance',
        name: 'DAN Europe',
        lastServiceDate: '2026-01-01',
        intervalMonths: 12,
      }),
    ]);
    expect(certifications).toHaveLength(0);
    expect(equipment).toHaveLength(2);
    expect(equipment[0].name).toContain('Certificato medico');
    expect(equipment[0].service).toBe('none');
    expect(equipment[0].notes).toContain('2027-01-15');
    expect(equipment[1].name).toContain('Assicurazione');
    // La scadenza derivata dall'intervallo finisce nelle note, non sparisce.
    expect(equipment[1].notes).toContain('2027-01-01');
  });

  it('un tipo sconosciuto finisce in «altro» invece di far cadere tutto', () => {
    const { equipment } = migrateGear([vecchio({ kind: 'boh', name: 'Qualcosa' })]);
    expect(equipment[0].kind).toBe('other');
    expect(equipment[0].name).toBe('Qualcosa');
  });

  it('conserva id e timbro della sincronizzazione', () => {
    const { equipment } = migrateGear([vecchio({ id: 'stabile', savedAt: '2026-08-01T10:00:00Z' })]);
    expect(equipment[0].id).toBe('stabile');
    expect(equipment[0].savedAt).toBe('2026-08-01T10:00:00Z');
  });
});
