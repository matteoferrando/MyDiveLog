/**
 * Test della sincronizzazione.
 *
 * Due livelli, deliberatamente separati:
 *
 *  1. `planSync` — logica pura, nessuna rete e nessun database. Qui si verifica
 *     la proprietà che conta davvero: **sincronizzare due volte di fila non fa
 *     niente la seconda volta.** Un piano non idempotente fa rimpallare le
 *     immersioni fra due dispositivi all'infinito, e non è un bug che si nota
 *     guardando l'interfaccia: si nota dopo un mese, sulla bolletta di Turso.
 *
 *  2. `syncArchive` — eseguito contro un **vero** SQLite in memoria
 *     (`node:sqlite`) al posto del client libSQL. Le query vengono compilate ed
 *     eseguite per davvero: un errore di sintassi, un `ON CONFLICT` su una
 *     colonna sbagliata o un segnaposto in più fanno fallire il test. Un finto
 *     client che risponde `{rows: []}` a tutto verificherebbe solo che il codice
 *     non lancia eccezioni, cioè quasi niente.
 *
 * Lo scenario centrale è quello reale di questo archivio: due dispositivi che
 * hanno la stessa immersione, uno col profilo e uno senza.
 */

import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Dive, Sample } from '../src/core/model';
import type { DiveStore } from '../src/storage';
import { digestOf, planSync, stableStringify, type SyncFingerprint } from '../src/sync/plan';
import {
  localFingerprints,
  remoteFingerprints,
  syncArchive,
  type SqlExecutor,
  mergeAnalyses,
  mergeKeyed,
  fondiAttrezzatura,
  fondiSegnalibri,
  ensureRemoteSchema,
  TOMBSTONE_KEY,
} from '../src/sync/turso';
import { TRASH_KEY } from '../src/storage/trash';
import { BLE_MARKERS_KEY } from '../src/core/ble/types';

// ---------------------------------------------------------------------------
// Impalcatura
// ---------------------------------------------------------------------------

/** Un `SqlExecutor` su SQLite vero, in memoria. */
function sqliteExecutor(): SqlExecutor & { db: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    async execute(sql: string, args: unknown[] = []) {
      const isSelect = /^\s*select/i.test(sql);
      if (!isSelect) {
        db.prepare(sql).run(...(args as never[]));
        return { rows: [] };
      }
      const rows = db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[];
      return { rows };
    },
    close: () => db.close(),
  };
}

/**
 * Store in memoria con la stessa semantica delle due implementazioni vere: i
 * profili stanno in una mappa a parte e `putDives` NON cancella un profilo
 * esistente quando il record che arriva non ne ha uno. È esattamente il punto su
 * cui la sincronizzazione potrebbe distruggere dati — scaricando un riepilogo
 * remoto senza profilo sopra un'immersione locale che il profilo ce l'ha — e
 * quindi va riprodotto qui, non semplificato.
 */
function memoryStore(seed: Dive[] = []): DiveStore {
  const dives = new Map<string, Dive>();
  const samples = new Map<string, Sample[]>();
  const altSamples = new Map<string, Sample[]>();
  const settings = new Map<string, unknown>();

  const put = (list: Dive[]) => {
    for (const d of list) {
      const { samples: s, altSamples: _a, ...rest } = d;
      dives.set(d.id, rest as Dive);
      if (s && s.length) samples.set(d.id, s);
      if (d.altSamples?.length) altSamples.set(d.id, d.altSamples);
    }
  };
  put(seed);

  return {
    kind: 'indexeddb',
    location: 'memoria (test)',
    async init() {},
    async listDives() {
      return [...dives.values()].sort((a, b) => (a.startTime < b.startTime ? 1 : -1));
    },
    async getDive(id) {
      return dives.get(id);
    },
    async getSamples(id) {
      return samples.get(id) ?? [];
    },
    async getAltSamples(id) {
      return altSamples.get(id) ?? [];
    },
    async sampleCounts() {
      return new Map([...samples].map(([id, s]) => [id, s.length]));
    },
    async altSampleCounts() {
      return new Map([...altSamples].map(([id, s]) => [id, s.length]));
    },
    async putDives(list) {
      put(list);
    },
    async deleteDive(id) {
      dives.delete(id);
      samples.delete(id);
    },
    async clear() {
      dives.clear();
      samples.clear();
    },
    async getSetting<T>(key: string) {
      return settings.get(key) as T | undefined;
    },
    async setSetting<T>(key: string, value: T) {
      settings.set(key, value);
    },
  };
}

function dive(id: string, overrides: Partial<Dive> = {}): Dive {
  return {
    id,
    startTime: '2026-06-14T10:38:00+02:00',
    durationS: 2520,
    maxDepth: 32.4,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: 12, startBar: 220, endBar: 70 }],
    source: { format: 'uddf', file: 'a.uddf', importedAt: '2026-06-14T20:00:00Z' },
    tags: [],
    ...overrides,
  };
}

function profile(n: number, everyS = 10): Sample[] {
  return Array.from({ length: n }, (_, i) => ({ t: i * everyS, depth: 5 + (i % 20) }));
}

/** Impronta di un'immersione con il profilo attaccato (fuori dallo store). */
const fp = (d: Dive): SyncFingerprint => localFingerprints([d], new Map())[0];

// ---------------------------------------------------------------------------
// Pianificazione
// ---------------------------------------------------------------------------

describe('planSync', () => {
  it('carica ciò che il remoto non ha, scarica ciò che manca in locale', () => {
    const local = [fp(dive('a')), fp(dive('b'))];
    const remote = [fp(dive('b')), fp(dive('c'))];
    const plan = planSync(local, remote);
    expect(plan.push).toEqual(['a']);
    expect(plan.pull).toEqual(['c']);
    expect(plan.unchanged).toBe(1);
  });

  it('non fa niente quando i due archivi sono identici', () => {
    const same = [fp(dive('a')), fp(dive('b', { maxDepth: 18 }))];
    const plan = planSync(same, same);
    expect(plan).toMatchObject({ push: [], pull: [], pushSamples: [], pullSamples: [], unchanged: 2 });
  });

  it('prende la nota da chi l’ha scritta e il profilo da chi l’ha, nello stesso giro', () => {
    // Il caso che conta, ed è il caso normale di questo archivio: il riepilogo
    // remoto è stato modificato dopo (una nota aggiunta a mano), ma il profilo
    // esiste solo in locale. Le due decisioni sono indipendenti: si scarica il
    // riepilogo E si carica il profilo. Se una regola sola governasse entrambi,
    // uno dei due dati sarebbe perso.
    const withProfile = fp(dive('a', { samples: profile(200), updatedAt: '2026-01-01T00:00:00Z' }));
    const newerNoProfile = fp(dive('a', { notes: 'ritoccata', updatedAt: '2026-08-01T00:00:00Z' }));
    const plan = planSync([withProfile], [newerNoProfile]);
    expect(plan.pull).toEqual(['a']);
    expect(plan.pushSamples).toEqual(['a']);
    expect(plan.push).toEqual([]);
  });

  it('rompe la parità in modo identico sui due dispositivi', () => {
    // Senza `updatedAt` la scelta è arbitraria, ma deve essere la stessa vista da
    // entrambi i lati: se ciascuno preferisse sé stesso, i due si
    // riscriverebbero il record a vicenda a ogni sincronizzazione.
    const x = fp(dive('a', { notes: 'versione X' }));
    const y = fp(dive('a', { notes: 'versione Y' }));
    const fromX = planSync([x], [y]);
    const fromY = planSync([y], [x]);
    const winnerSeenByX = fromX.push.length ? 'x' : 'y';
    const winnerSeenByY = fromY.push.length ? 'y' : 'x';
    expect(winnerSeenByX).toBe(winnerSeenByY);
  });

  it('a pari profilo fa vincere il più recente', () => {
    const older = fp(dive('a', { notes: 'vecchia', updatedAt: '2026-01-01T00:00:00Z' }));
    const newer = fp(dive('a', { notes: 'nuova', updatedAt: '2026-08-01T00:00:00Z' }));
    expect(planSync([older], [newer]).pull).toEqual(['a']);
    expect(planSync([newer], [older]).push).toEqual(['a']);
  });

  it('sposta il profilo anche quando il riepilogo è già allineato', () => {
    const base = dive('a', { updatedAt: '2026-01-01T00:00:00Z' });
    const local = fp(base);
    const remote = { ...fp(base), sampleCount: 240 };
    const plan = planSync([local], [remote]);
    expect(plan.pull).toEqual([]); // il riepilogo non cambia…
    expect(plan.pullSamples).toEqual(['a']); // …ma il profilo va preso
  });

  it('non carica e scarica la stessa cosa', () => {
    const local = [fp(dive('a', { samples: profile(100) })), fp(dive('b', { notes: 'x' }))];
    const remote = [fp(dive('a')), fp(dive('b', { notes: 'y', updatedAt: '2027-01-01T00:00:00Z' }))];
    const plan = planSync(local, remote);
    for (const id of plan.push) expect(plan.pull).not.toContain(id);
    for (const id of plan.pushSamples) expect(plan.pullSamples).not.toContain(id);
  });
});

describe('digestOf', () => {
  it('ignora l’ordine delle chiavi', () => {
    const a = { x: 1, y: { b: 2, a: 3 }, z: [1, 2] };
    const b = { z: [1, 2], y: { a: 3, b: 2 }, x: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(digestOf(a)).toBe(digestOf(b));
  });

  it('non cambia se cambia solo la provenienza', () => {
    // La stessa immersione importata da due file diversi non è una modifica:
    // se lo fosse, i due dispositivi si riscriverebbero il record a vicenda a
    // ogni sincronizzazione senza mai convergere.
    const d1 = dive('a', { source: { format: 'uddf', file: 'x.uddf', importedAt: '2026-01-01T00:00:00Z' } });
    const d2 = dive('a', {
      source: { format: 'shearwater-cloud', file: 'y.db', importedAt: '2026-08-01T00:00:00Z' },
      updatedAt: '2026-08-02T00:00:00Z',
    });
    expect(digestOf(d1 as unknown as Record<string, unknown>)).toBe(
      digestOf(d2 as unknown as Record<string, unknown>),
    );
  });

  it('cambia se cambia un dato dell’immersione', () => {
    const d1 = dive('a') as unknown as Record<string, unknown>;
    const d2 = dive('a', { notes: 'corrente forte' }) as unknown as Record<string, unknown>;
    expect(digestOf(d1)).not.toBe(digestOf(d2));
  });
});

// ---------------------------------------------------------------------------
// Trasporto, su SQLite vero
// ---------------------------------------------------------------------------

describe('syncArchive contro un SQLite vero', () => {
  let sql: ReturnType<typeof sqliteExecutor>;

  beforeEach(() => {
    sql = sqliteExecutor();
  });

  it('carica un archivio su un database remoto vuoto, profili compresi', async () => {
    const store = memoryStore([
      dive('a', { samples: profile(150) }),
      dive('b', { startTime: '2026-07-01T09:00:00+02:00', samples: profile(80) }),
      dive('c', { startTime: '2026-05-01T09:00:00+02:00' }), // senza profilo
    ]);

    const report = await syncArchive(store, sql);
    expect(report.pushed).toBe(3);
    expect(report.pushedProfiles).toBe(2);
    expect(report.pulled).toBe(0);

    const { rows } = await sql.execute('SELECT COUNT(*) AS n FROM dives');
    expect(Number(rows[0].n)).toBe(3);
    const s = await sql.execute('SELECT dive_id, count FROM dive_samples ORDER BY dive_id');
    expect(s.rows.map((r) => [r.dive_id, Number(r.count)])).toEqual([
      ['a', 150],
      ['b', 80],
    ]);

    // Il documento salvato NON contiene il profilo: sta nella sua tabella, e
    // duplicarlo raddoppierebbe il traffico a ogni sincronizzazione.
    const doc = await sql.execute("SELECT doc FROM dives WHERE id = 'a'");
    expect(JSON.parse(String(doc.rows[0].doc)).samples).toBeUndefined();
  });

  it('la seconda sincronizzazione di fila non fa niente', async () => {
    const store = memoryStore([dive('a', { samples: profile(150) }), dive('b')]);
    await syncArchive(store, sql);
    const second = await syncArchive(store, sql);
    expect(second).toMatchObject({ pushed: 0, pulled: 0, pushedProfiles: 0, pulledProfiles: 0 });
    expect(second.plan.unchanged).toBe(2);
  });

  it('scarica su un dispositivo vuoto ciò che un altro ha caricato', async () => {
    const source = memoryStore([dive('a', { samples: profile(150) }), dive('b')]);
    await syncArchive(source, sql);

    const fresh = memoryStore();
    const report = await syncArchive(fresh, sql);
    expect(report.pulled).toBe(2);
    expect(report.pulledProfiles).toBe(1);
    expect(await fresh.getSamples('a')).toHaveLength(150);
    expect(await fresh.getSamples('b')).toHaveLength(0);

    // …e a questo punto i due dispositivi sono fermi.
    expect(await syncArchive(fresh, sql)).toMatchObject({ pushed: 0, pulled: 0 });
    expect(await syncArchive(source, sql)).toMatchObject({ pushed: 0, pulled: 0 });
  });

  it('completa un profilo mancante senza toccare il riepilogo', async () => {
    // Lo scenario reale: la stessa immersione è entrata da Shearwater (con
    // profilo) su un dispositivo e da un export senza profilo sull'altro.
    const withProfile = memoryStore([dive('a', { samples: profile(300) })]);
    await syncArchive(withProfile, sql);

    const without = memoryStore([dive('a')]);
    const report = await syncArchive(without, sql);
    expect(report.plan.pull).toEqual([]); // riepilogo identico
    expect(report.pulledProfiles).toBe(1);
    expect(await without.getSamples('a')).toHaveLength(300);
    expect(await syncArchive(without, sql)).toMatchObject({ pushed: 0, pulled: 0, pulledProfiles: 0 });
  });

  it('scaricare un riepilogo non cancella il profilo locale', async () => {
    // Il remoto ha una versione più recente del riepilogo ma nessun profilo:
    // scaricarla deve arricchire l'immersione, non amputarla. Ed è anche il giro
    // in cui il profilo locale sale: le due direzioni convivono.
    const other = memoryStore([
      dive('a', { notes: 'da un altro dispositivo', updatedAt: '2027-01-01T00:00:00Z' }),
    ]);
    await syncArchive(other, sql);

    const mine = memoryStore([dive('a', { samples: profile(120), updatedAt: '2026-01-01T00:00:00Z' })]);
    const report = await syncArchive(mine, sql);
    expect(report.pulled).toBe(1);
    expect(report.pushedProfiles).toBe(1);
    expect((await mine.getDive('a'))?.notes).toBe('da un altro dispositivo');
    expect(await mine.getSamples('a')).toHaveLength(120);

    // Entrambi i dispositivi hanno ora nota e profilo, e si fermano.
    expect(await syncArchive(mine, sql)).toMatchObject({ pushed: 0, pulled: 0, pushedProfiles: 0 });
    const back = await syncArchive(other, sql);
    expect(back.pulledProfiles).toBe(1);
    expect(await other.getSamples('a')).toHaveLength(120);
    expect(await syncArchive(other, sql)).toMatchObject({ pushed: 0, pulled: 0, pulledProfiles: 0 });
  });

  it('due lati che toccano campi DIVERSI non si cancellano a vicenda', async () => {
    /*
     * ════════════════════════════════════════════════════════════════════════
     * IL CASO CHE NESSUN TEST COPRIVA, ED È IL CASO NORMALE DI DUE DISPOSITIVI.
     *
     * I test di `planSync` qui sopra verificano che i due dispositivi nominino
     * lo STESSO vincitore — cioè che la sincronizzazione converga — non che
     * cosa succede ai campi del perdente. E il perdente perdeva tutto: il
     * conflitto si risolveva per RECORD, e il documento del vincitore veniva
     * scritto sopra quello dell'altro senza fondere.
     *
     * Il Mac scrive le note dell'immersione il 1° agosto. L'iPhone, offline,
     * mette compagno e voto sulla STESSA immersione il 2 agosto. Si sincronizza
     * il Mac, poi l'iPhone, poi di nuovo il Mac: le note sparivano da entrambi
     * i dispositivi e dal database remoto. Il rapporto diceva `pulled: 1`, non
     * c'era cestino, non c'era avviso, e non restava nessun file da cui
     * rileggerle.
     * ════════════════════════════════════════════════════════════════════════
     */
    const mac = memoryStore([
      dive('a', { notes: 'corrente forte in uscita', updatedAt: '2026-08-01T00:00:00Z' }),
    ]);
    const iphone = memoryStore([dive('a', { buddy: 'Marco', rating: 5, updatedAt: '2026-08-02T00:00:00Z' })]);

    await syncArchive(mac, sql);
    await syncArchive(iphone, sql);
    await syncArchive(mac, sql);

    for (const [nome, store] of [
      ['mac', mac],
      ['iphone', iphone],
    ] as const) {
      const d = await store.getDive('a');
      expect(d?.notes, `note su ${nome}`).toBe('corrente forte in uscita');
      expect(d?.buddy, `compagno su ${nome}`).toBe('Marco');
      expect(d?.rating, `voto su ${nome}`).toBe(5);
    }

    // Anche il database condiviso tiene la versione fusa: un terzo dispositivo
    // che arrivasse adesso non riceverebbe una scheda amputata.
    const { rows } = await sql.execute("SELECT doc FROM dives WHERE id = 'a'");
    const remoto = JSON.parse(String(rows[0].doc));
    expect(remoto.notes).toBe('corrente forte in uscita');
    expect(remoto.buddy).toBe('Marco');

    // E la faccenda si chiude: fondere non deve far rimbalzare il record.
    for (const store of [mac, iphone]) {
      expect(await syncArchive(store, sql)).toMatchObject({ pushed: 0, pulled: 0 });
    }
  });

  it('scaricando la versione più recente non si perde il campo che c’è solo qui', async () => {
    // Lo stesso difetto visto dal ramo di SCARICO: il remoto vince per
    // `updatedAt`, ma il campo scritto solo qui non deve sparire scrivendogli
    // sopra. E la versione fusa risale nello stesso giro, altrimenti resterebbe
    // su questo dispositivo soltanto.
    const altro = memoryStore([dive('a', { buddy: 'Marco', updatedAt: '2026-08-02T00:00:00Z' })]);
    await syncArchive(altro, sql);

    const mio = memoryStore([dive('a', { notes: 'la mia nota', updatedAt: '2026-08-01T00:00:00Z' })]);
    const report = await syncArchive(mio, sql);
    expect(report.pulled).toBe(1);
    const d = await mio.getDive('a');
    expect(d?.notes).toBe('la mia nota');
    expect(d?.buddy).toBe('Marco');

    const back = await syncArchive(altro, sql);
    expect(back.pulled).toBe(1);
    expect((await altro.getDive('a'))?.notes).toBe('la mia nota');

    for (const store of [mio, altro]) {
      expect(await syncArchive(store, sql)).toMatchObject({ pushed: 0, pulled: 0 });
    }
  });

  it('fondere il riepilogo non ricalcola le metriche su un riepilogo senza campioni', async () => {
    /*
     * La fusione riguarda il RIEPILOGO, e due cose devono restarne fuori.
     *
     * Il PROFILO: quale tenere lo decide il piano, per conteggio di campioni, e
     * `mergeDive` lo deciderebbe con un altro criterio — i canali. Due giudici
     * sullo stesso dato fanno rimbalzare il profilo fra i dispositivi.
     *
     * Le METRICHE: `mergeDive` chiude sempre con `computeMetrics(out)`, che qui
     * girerebbe su un riepilogo senza campioni. Il risultato è plausibile e
     * sbagliato — `quality.sampleCount` a zero, assetto e velocità assenti — e
     * andrebbe a sostituire quelle buone in silenzio, a ogni sincronizzazione.
     */
    const metriche = { quality: { sampleCount: 120 } } as unknown as Dive['metrics'];
    const mio = memoryStore([
      dive('a', {
        samples: profile(120),
        notes: 'la mia nota',
        metrics: metriche,
        updatedAt: '2026-01-01T00:00:00Z',
      }),
    ]);
    await syncArchive(mio, sql);

    // L'altro vince per data e fonde: la nota entra, e con lei devono restare
    // in piedi le metriche calcolate sul profilo che sta scendendo.
    const altro = memoryStore([dive('a', { buddy: 'Marco', updatedAt: '2027-01-01T00:00:00Z' })]);
    await syncArchive(altro, sql);
    const fusaLi = await altro.getDive('a');
    expect(fusaLi?.notes).toBe('la mia nota');
    expect(fusaLi?.metrics?.quality?.sampleCount).toBe(120);

    await syncArchive(mio, sql);
    expect(await mio.getSamples('a')).toHaveLength(120);
    const qui = await mio.getDive('a');
    expect(qui?.buddy).toBe('Marco');
    expect(qui?.metrics?.quality?.sampleCount).toBe(120);
  });

  it('due archivi diversi convergono, e poi restano fermi', async () => {
    const alpha = memoryStore([
      dive('a', { samples: profile(150) }),
      dive('b', { startTime: '2026-07-01T09:00:00+02:00' }),
    ]);
    const beta = memoryStore([
      dive('b', { startTime: '2026-07-01T09:00:00+02:00', samples: profile(90) }),
      dive('c', { startTime: '2026-05-01T09:00:00+02:00' }),
    ]);

    await syncArchive(alpha, sql);
    await syncArchive(beta, sql);
    await syncArchive(alpha, sql); // alpha prende ciò che beta ha portato

    const ids = async (s: DiveStore) => (await s.listDives()).map((d) => d.id).sort();
    expect(await ids(alpha)).toEqual(['a', 'b', 'c']);
    expect(await ids(beta)).toEqual(['a', 'b', 'c']);
    expect(await alpha.getSamples('b')).toHaveLength(90);
    expect(await beta.getSamples('a')).toHaveLength(150);

    for (const s of [alpha, beta]) {
      expect(await syncArchive(s, sql)).toMatchObject({
        pushed: 0,
        pulled: 0,
        pushedProfiles: 0,
        pulledProfiles: 0,
      });
    }
  });

  it('non cancella niente da remoto quando un’immersione sparisce in locale', async () => {
    // Cancellare in locale e propagare la cancellazione richiederebbe un
    // registro delle eliminazioni. Finché non c'è, la scelta è dichiarata:
    // meglio un'immersione di troppo che una perduta.
    const store = memoryStore([dive('a'), dive('b')]);
    await syncArchive(store, sql);
    await store.deleteDive('b');
    const report = await syncArchive(store, sql);

    const { rows } = await sql.execute('SELECT COUNT(*) AS n FROM dives');
    expect(Number(rows[0].n)).toBe(2);
    expect(report.pulled).toBe(1); // torna indietro
    expect((await store.listDives()).map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  it('regge un archivio più grande di un blocco di caricamento', async () => {
    // PUSH_CHUNK è 25: con 60 immersioni si esercita la suddivisione in blocchi
    // e la costruzione dei segnaposto, che con un blocco solo non si vedrebbe.
    const many = Array.from({ length: 60 }, (_, i) =>
      dive(`d${String(i).padStart(3, '0')}`, {
        startTime: new Date(Date.UTC(2026, 0, 1 + i, 9, 0, 0)).toISOString(),
        samples: i % 3 === 0 ? profile(30) : undefined,
      }),
    );
    const source = memoryStore(many);
    await syncArchive(source, sql);

    const fresh = memoryStore();
    const report = await syncArchive(fresh, sql);
    expect(report.pulled).toBe(60);
    expect(report.pulledProfiles).toBe(20);
    expect((await fresh.listDives()).length).toBe(60);
    expect(await syncArchive(fresh, sql)).toMatchObject({ pushed: 0, pulled: 0 });
  });

  it('le impronte remote sono quelle locali, altrimenti il piano oscilla', async () => {
    const dives = [dive('a', { samples: profile(150) }), dive('b')];
    const store = memoryStore(dives);
    await syncArchive(store, sql);
    const remote = (await remoteFingerprints(sql)).sort((x, y) => x.id.localeCompare(y.id));
    const local = localFingerprints(await store.listDives(), await store.sampleCounts()).sort((x, y) =>
      x.id.localeCompare(y.id),
    );
    expect(remote).toEqual(local);
  });
});

describe('secondo profilo attraverso la sincronizzazione', () => {
  const dense = (n: number) => profile(n, 4);
  const sparse = (n: number) => profile(n, 10).map((s) => ({ ...s, ndlS: 600, ttsS: 120, cns: 2 }));

  it('viaggia insieme al principale', async () => {
    const sql = sqliteExecutor();
    const source = memoryStore([dive('a', { samples: sparse(240), altSamples: dense(600) })]);
    const report = await syncArchive(source, sql);
    expect(report.pushedProfiles).toBe(1);

    const fresh = memoryStore();
    await syncArchive(fresh, sql);
    // Entrambi i profili arrivano: senza il secondo, l'altro dispositivo
    // ricalcolerebbe assetto e velocità su un profilo più rado, peggiorandoli.
    expect(await fresh.getSamples('a')).toHaveLength(240);
    expect(await fresh.getAltSamples('a')).toHaveLength(600);
    expect(await syncArchive(fresh, sql)).toMatchObject({ pushed: 0, pulled: 0 });
  });

  it('un’immersione con un solo profilo non crea un secondo vuoto', async () => {
    const sql = sqliteExecutor();
    const source = memoryStore([dive('a', { samples: sparse(120) })]);
    await syncArchive(source, sql);
    const fresh = memoryStore();
    await syncArchive(fresh, sql);
    expect(await fresh.getAltSamples('a')).toHaveLength(0);
  });
});

/**
 * Cancellazioni e analisi: le due cose che la sincronizzazione perdeva.
 *
 * Erano difetti gemelli, e nessuno dei due dava errore: cancellavi un'immersione e
 * tornava, generavi un'analisi su un dispositivo e spariva. Entrambi si vedono solo
 * con DUE archivi che si parlano, che è la ragione per cui questi test montano due
 * `memoryStore` sullo stesso SQLite invece di uno solo.
 */
describe('cancellazioni fra due dispositivi', () => {
  let sql: ReturnType<typeof sqliteExecutor>;
  beforeEach(() => {
    sql = sqliteExecutor();
  });

  it('un’immersione cancellata su un dispositivo non torna dall’altro', async () => {
    const uno = memoryStore([dive('a', { samples: profile(120) }), dive('b')]);
    await syncArchive(uno, sql);

    const due = memoryStore([]);
    await syncArchive(due, sql);
    expect((await due.listDives()).map((d) => d.id).sort()).toEqual(['a', 'b']);

    // Cancellata su `uno`, con la lapide che `removeDive` scrive nell'app.
    await uno.deleteDive('a');
    await uno.setSetting(TOMBSTONE_KEY, [{ id: 'a', at: new Date().toISOString() }]);

    const report = await syncArchive(uno, sql);
    expect(report.deletionsPushed).toBe(1);
    // Non deve essere riscaricata: è questo il difetto che c'era.
    expect((await uno.listDives()).map((d) => d.id)).toEqual(['b']);
    const remote = await sql.execute("SELECT COUNT(*) AS n FROM dives WHERE id = 'a'");
    expect(Number(remote.rows[0].n)).toBe(0);

    // E sull'altro dispositivo sparisce alla prima sincronizzazione utile.
    const secondo = await syncArchive(due, sql);
    expect(secondo.deletionsApplied).toBe(1);
    expect((await due.listDives()).map((d) => d.id)).toEqual(['b']);
  });

  it('la lapide porta via anche i profili dal database remoto', async () => {
    const uno = memoryStore([dive('a', { samples: profile(120) })]);
    await syncArchive(uno, sql);
    await uno.deleteDive('a');
    await uno.setSetting(TOMBSTONE_KEY, [{ id: 'a', at: new Date().toISOString() }]);
    await syncArchive(uno, sql);
    const s = await sql.execute("SELECT COUNT(*) AS n FROM dive_samples WHERE dive_id = 'a'");
    expect(Number(s.rows[0].n)).toBe(0);
  });

  it('le lapidi non scadono fra una sincronizzazione e l’altra', async () => {
    const uno = memoryStore([dive('a')]);
    await syncArchive(uno, sql);
    await uno.deleteDive('a');
    await uno.setSetting(TOMBSTONE_KEY, [{ id: 'a', at: new Date().toISOString() }]);
    await syncArchive(uno, sql);

    // Un dispositivo rimasto indietro che riprova a caricare la stessa immersione
    // non deve riuscire a farla resuscitare.
    const tardivo = memoryStore([dive('a')]);
    await syncArchive(tardivo, sql);
    expect(await tardivo.listDives()).toHaveLength(0);
  });
});

describe('il cestino ferma la sincronizzazione in entrambi i versi', () => {
  let sql: ReturnType<typeof sqliteExecutor>;
  beforeEach(() => {
    sql = sqliteExecutor();
  });

  it('un’immersione nel cestino non si carica e non torna indietro', async () => {
    const uno = memoryStore([dive('a', { samples: profile(120) }), dive('b')]);
    await syncArchive(uno, sql);

    // Cancellata sul dispositivo `uno`: finisce nel cestino, SENZA lapide.
    const doc = (await uno.listDives()).find((d) => d.id === 'a')!;
    await uno.setSetting(TRASH_KEY, [{ dive: doc, at: new Date().toISOString() }]);
    await uno.deleteDive('a');

    const report = await syncArchive(uno, sql);
    // Non è stata riscaricata dal remoto — dove esiste ancora, ed è giusto così:
    // la cancellazione non è ancora definitiva e non deve propagarsi.
    expect((await uno.listDives()).map((d) => d.id)).toEqual(['b']);
    expect(report.deletionsPushed).toBe(0);
    const remote = await sql.execute("SELECT COUNT(*) AS n FROM dives WHERE id = 'a'");
    expect(Number(remote.rows[0].n)).toBe(1);
  });

  it('svuotato il cestino la lapide nasce e allora sì che si propaga', async () => {
    const uno = memoryStore([dive('a'), dive('b')]);
    await syncArchive(uno, sql);
    await uno.deleteDive('a');
    // È quello che fa `emptyTrash`: cestino vuoto, lapide scritta.
    await uno.setSetting(TRASH_KEY, []);
    await uno.setSetting(TOMBSTONE_KEY, [{ id: 'a', at: new Date().toISOString() }]);

    const report = await syncArchive(uno, sql);
    expect(report.deletionsPushed).toBe(1);
    const remote = await sql.execute("SELECT COUNT(*) AS n FROM dives WHERE id = 'a'");
    expect(Number(remote.rows[0].n)).toBe(0);
  });
});

describe('fusione delle analisi', () => {
  /*
   * Il campo si chiama `at`, ed è il nome che `StoredAnalysis` usa davvero.
   *
   * Il test precedente lo chiamava `createdAt` — lo stesso nome sbagliato che
   * usava il codice — e quindi confermava il difetto invece di trovarlo: due
   * errori uguali si annullano e il test passa verde su un comportamento che in
   * produzione non è mai successo. È il motivo per cui un test che costruisce da
   * sé il proprio dato deve costruirlo con la FORMA vera, non con una forma
   * comoda: qui la forma vera è quella che scrive `runAnalysis`.
   */
  it('tiene quelle di entrambi i dispositivi invece di sostituirle in blocco', () => {
    const locale = { 'dive:1': { at: '2026-01-01T00:00:00Z' } };
    const remoto = { 'dive:2': { at: '2026-02-01T00:00:00Z' } };
    const m = mergeAnalyses(locale, remoto);
    expect(Object.keys(m.value).sort()).toEqual(['dive:1', 'dive:2']);
    expect(m.changedLocally).toBe(true);
    expect(m.changedRemotely).toBe(true);
  });

  it('sulla stessa chiave vince l’analisi generata più tardi, non l’ultimo che sincronizza', () => {
    const vecchia = { 'dive:1': { at: '2026-01-01T00:00:00Z', text: 'vecchia' } };
    const nuova = { 'dive:1': { at: '2026-03-01T00:00:00Z', text: 'nuova' } };
    expect(mergeAnalyses(vecchia, nuova).value['dive:1']).toMatchObject({ text: 'nuova' });
    expect(mergeAnalyses(nuova, vecchia).value['dive:1']).toMatchObject({ text: 'nuova' });
    // E la propria più recente deve risalire, non restare ferma qui.
    expect(mergeAnalyses(nuova, vecchia).changedRemotely).toBe(true);
  });

  it('legge anche il nome vecchio del campo, per gli archivi già sincronizzati', () => {
    const vecchioNome = { 'dive:1': { createdAt: '2026-01-01T00:00:00Z', text: 'vecchia' } };
    const nuova = { 'dive:1': { at: '2026-03-01T00:00:00Z', text: 'nuova' } };
    expect(mergeAnalyses(vecchioNome, nuova).value['dive:1']).toMatchObject({ text: 'nuova' });
  });

  it('quando sono identiche non muove niente', () => {
    const same = { 'dive:1': { at: '2026-01-01T00:00:00Z' } };
    const m = mergeAnalyses(same, { ...same });
    expect(m.changedLocally).toBe(false);
    expect(m.changedRemotely).toBe(false);
  });
});

/**
 * I difetti di sincronizzazione trovati dalla revisione ostile.
 *
 * Tre di questi perdevano dati in silenzio, che è la categoria peggiore: nessun
 * errore, nessun avviso, e ci si accorge del buco settimane dopo.
 */
describe('difetti trovati dalla revisione', () => {
  let sql: ReturnType<typeof sqliteExecutor>;
  beforeEach(() => {
    sql = sqliteExecutor();
  });

  it('i piani salvati e l’attrezzatura si fondono invece di sostituirsi', async () => {
    // Prima: A salva un piano, B ne salva un altro senza aver sincronizzato in
    // mezzo, e alla prima sincronizzazione uno dei due spariva da entrambi i
    // dispositivi. `analyses` aveva già la fusione; queste due no.
    const uno = memoryStore([dive('a')]);
    const due = memoryStore([dive('a')]);
    await uno.setSetting('decoPlans', [{ name: 'Aria 30 m', savedAt: '2026-08-18T10:00:00Z', state: 1 }]);
    await uno.setSetting('decoPlans:at', '2026-08-18T10:00:00Z');
    await due.setSetting('decoPlans', [{ name: 'Trimix 60 m', savedAt: '2026-08-18T11:00:00Z', state: 2 }]);
    await due.setSetting('decoPlans:at', '2026-08-18T11:00:00Z');

    await syncArchive(uno, sql);
    await syncArchive(due, sql);
    await syncArchive(uno, sql);

    for (const store of [uno, due]) {
      const plans = (await store.getSetting<{ name: string }[]>('decoPlans')) ?? [];
      expect(plans.map((p) => p.name).sort()).toEqual(['Aria 30 m', 'Trimix 60 m']);
    }
  });

  it('mergeKeyed tiene entrambi, e sulla stessa chiave vince il timbro più recente', () => {
    const a = [{ id: 'g1', name: 'Erogatore', savedAt: '2026-01-01T00:00:00Z' }];
    const b = [
      { id: 'g1', name: 'Erogatore revisionato', savedAt: '2026-03-01T00:00:00Z' },
      { id: 'g2', name: 'Aladin' },
    ];
    const m = mergeKeyed(a, b, 'id');
    expect(m.value).toHaveLength(2);
    expect((m.value as { name: string }[]).find((x) => x.name.includes('revisionato'))).toBeDefined();
    // Senza timbro non si butta via niente: in caso di dubbio vince il locale.
    expect(mergeKeyed([{ id: 'g1', name: 'mio' }], [{ id: 'g1', name: 'suo' }], 'id').value).toEqual([
      { id: 'g1', name: 'mio' },
    ]);
  });

  it('un’immersione ripristinata dopo la lapide non viene ricancellata', async () => {
    // Prima: il cestino faceva il suo mestiere e poi la sincronizzazione
    // successiva riapplicava la lapide, facendo sparire l'immersione senza
    // passare dal cestino — cioè per sempre.
    const uno = memoryStore([dive('a', { samples: profile(120) }), dive('b')]);
    await syncArchive(uno, sql);
    await uno.deleteDive('a');
    await uno.setSetting(TOMBSTONE_KEY, [{ id: 'a', at: '2026-08-18T10:00:00Z' }]);
    await syncArchive(uno, sql);
    expect((await uno.listDives()).map((d) => d.id)).toEqual(['b']);

    // Ripristino: il documento torna con un timbro NUOVO, più recente della lapide.
    await uno.putDives([dive('a', { updatedAt: '2026-08-18T12:00:00Z' })]);
    await uno.setSetting(TOMBSTONE_KEY, []);

    const report = await syncArchive(uno, sql);
    expect(report.deletionsApplied).toBe(0);
    expect((await uno.listDives()).map((d) => d.id).sort()).toEqual(['a', 'b']);
    // E la lapide se n'è andata anche dal remoto, così non torna dall'altro capo.
    const remote = await sql.execute('SELECT COUNT(*) AS n FROM deletions');
    expect(Number(remote.rows[0].n)).toBe(0);
  });

  it('le lapidi già note al remoto non si rispediscono a ogni giro', async () => {
    const uno = memoryStore([dive('a'), dive('b')]);
    await syncArchive(uno, sql);
    await uno.deleteDive('a');
    await uno.setSetting(TOMBSTONE_KEY, [{ id: 'a', at: new Date().toISOString() }]);
    expect((await syncArchive(uno, sql)).deletionsPushed).toBe(1);
    expect((await syncArchive(uno, sql)).deletionsPushed).toBe(0);
    expect((await syncArchive(uno, sql)).deletionsPushed).toBe(0);
  });

  it('caricare un riepilogo senza profilo non nasconde il profilo che sta nel remoto', async () => {
    // Prima: `sample_count` veniva riscritto con il conteggio locale (zero), e da
    // quel momento un terzo dispositivo vedeva zero da entrambe le parti — il
    // profilo restava nel remoto e non lo scaricava più nessuno.
    const conProfilo = memoryStore([dive('x', { samples: profile(200) })]);
    await syncArchive(conProfilo, sql);

    const conNote = memoryStore([dive('x', { notes: 'aggiunte dopo', updatedAt: '2030-01-01T00:00:00Z' })]);
    await syncArchive(conNote, sql);

    const terzo = memoryStore([]);
    await syncArchive(terzo, sql);
    expect(await terzo.getSamples('x')).toHaveLength(200);
  });

  it('il secondo profilo viaggia anche quando il principale è già allineato', async () => {
    // È il caso normale: due dispositivi hanno lo stesso file Shearwater, uno solo
    // ha importato anche l'Aladin. Prima il profilo fitto non si muoveva.
    const conAlt = memoryStore([dive('y', { samples: profile(200), altSamples: profile(600) })]);
    await syncArchive(conAlt, sql);
    const senzaAlt = memoryStore([dive('y', { samples: profile(200) })]);
    await syncArchive(senzaAlt, sql);
    expect(await senzaAlt.getAltSamples('y')).toHaveLength(600);
  });
});

// ---------------------------------------------------------------------------
// Attrezzatura e segnalibri fra due dispositivi
// ---------------------------------------------------------------------------

/**
 * Questi due blocchi esistono per un difetto trovato usando l'app, non
 * leggendola: l'attrezzatura compilata sul Mac non compariva su iPhone, e un
 * computer subacqueo collegato al telefono avrebbe riletto la memoria intera.
 *
 * Il primo era invisibile per costruzione — la sincronizzazione girava, non
 * segnalava niente e non spostava niente — quindi il test non verifica «non
 * lancia eccezioni» ma **che il pezzo arrivi davvero dall'altra parte**.
 */
describe('attrezzatura e brevetti attraverso la sincronizzazione', () => {
  const attrezzo = (id: string, name: string, savedAt: string) => ({
    id,
    name,
    kind: 'suit',
    savedAt,
  });
  const brevetto = (id: string, name: string, savedAt: string) => ({ id, name, agency: 'PADI', savedAt });

  it('porta su quello del Mac e giù quello del telefono, senza perdere niente', async () => {
    const sql = sqliteExecutor();

    const mac = memoryStore([dive('a')]);
    await mac.setSetting('gear', {
      equipment: [attrezzo('e1', 'Muta 7 mm', '2026-01-01T00:00:00Z')],
      certifications: [brevetto('c1', 'Advanced', '2026-01-01T00:00:00Z')],
    });
    await mac.setSetting('gear:at', '2026-01-01T00:00:00Z');
    await syncArchive(mac, sql);

    const telefono = memoryStore([]);
    await telefono.setSetting('gear', {
      equipment: [attrezzo('e2', 'Stagna', '2026-02-01T00:00:00Z')],
      certifications: [],
    });
    await telefono.setSetting('gear:at', '2026-02-01T00:00:00Z');
    await syncArchive(telefono, sql);

    const quaggiu = (await telefono.getSetting<{
      equipment: { id: string }[];
      certifications: { id: string }[];
    }>('gear'))!;
    expect(quaggiu.equipment.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
    expect(quaggiu.certifications.map((c) => c.id)).toEqual(['c1']);

    // …e il pezzo del telefono deve risalire, altrimenti il Mac lo perderebbe
    // al prossimo giro.
    await syncArchive(mac, sql);
    const lassu = (await mac.getSetting<{ equipment: { id: string }[] }>('gear'))!;
    expect(lassu.equipment.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('a parità di identificativo vince il timbro più recente', async () => {
    const sql = sqliteExecutor();
    const mac = memoryStore([]);
    await mac.setSetting('gear', {
      equipment: [attrezzo('e1', 'Muta 5 mm', '2026-01-01T00:00:00Z')],
      certifications: [],
    });
    await mac.setSetting('gear:at', '2026-01-01T00:00:00Z');
    await syncArchive(mac, sql);

    const telefono = memoryStore([]);
    await telefono.setSetting('gear', {
      equipment: [attrezzo('e1', 'Muta 7 mm', '2026-03-01T00:00:00Z')],
      certifications: [],
    });
    await telefono.setSetting('gear:at', '2026-03-01T00:00:00Z');
    await syncArchive(telefono, sql);
    await syncArchive(mac, sql);

    const lassu = (await mac.getSetting<{ equipment: { name: string }[] }>('gear'))!;
    expect(lassu.equipment).toHaveLength(1);
    expect(lassu.equipment[0].name).toBe('Muta 7 mm');
  });
});

describe('segnalibri di scarico fra due dispositivi', () => {
  const MARKERS = 'bleMarkers';

  it('il telefono eredita fin dove era arrivato il Mac', async () => {
    const sql = sqliteExecutor();
    const mac = memoryStore([dive('a')]);
    await mac.setSetting(MARKERS, {
      'uwatec:63034502': { fingerprint: '117', at: '2026-08-20T10:00:00Z', dives: 117, model: 'Aladin' },
    });
    await mac.setSetting(`${MARKERS}:at`, '2026-08-20T10:00:00Z');
    await syncArchive(mac, sql);

    const telefono = memoryStore([]);
    await syncArchive(telefono, sql);

    const qui = (await telefono.getSetting<Record<string, { fingerprint: string }>>(MARKERS))!;
    expect(qui['uwatec:63034502'].fingerprint).toBe('117');
  });

  it('fra due segnalibri dello stesso computer vince quello scaricato più tardi', () => {
    const vecchio = { 'uwatec:1': { fingerprint: '100', at: '2026-08-01T00:00:00Z', dives: 100 } };
    const nuovo = { 'uwatec:1': { fingerprint: '117', at: '2026-08-20T00:00:00Z', dives: 117 } };
    expect(fondiSegnalibri(vecchio, nuovo).value['uwatec:1'].fingerprint).toBe('117');
    expect(fondiSegnalibri(nuovo, vecchio).value['uwatec:1'].fingerprint).toBe('117');
    // Il verso in cui il locale è già avanti deve chiedere di RISALIRE, non di
    // scendere: altrimenti il segnalibro buono non lascerebbe mai il Mac.
    expect(fondiSegnalibri(nuovo, vecchio).changedRemotely).toBe(true);
    expect(fondiSegnalibri(nuovo, vecchio).changedLocally).toBe(false);
  });

  it("«dimentica» si propaga invece di essere annullato dall'altro dispositivo", () => {
    const altrove = { 'uwatec:1': { fingerprint: '117', at: '2026-08-20T00:00:00Z', dives: 117 } };
    const dimenticato = { 'uwatec:1': { fingerprint: '', at: '2026-08-21T00:00:00Z', dives: 0 } };
    const fusi = fondiSegnalibri(dimenticato, altrove);
    expect(fusi.value['uwatec:1'].fingerprint).toBe('');
    expect(fusi.changedRemotely).toBe(true);
  });

  it('computer diversi non si sovrascrivono a vicenda', () => {
    const a = { 'uwatec:1': { fingerprint: 'x', at: '2026-08-01T00:00:00Z', dives: 3 } };
    const b = { 'shearwater:2': { fingerprint: 'y', at: '2026-08-02T00:00:00Z', dives: 4 } };
    expect(Object.keys(fondiSegnalibri(a, b).value).sort()).toEqual(['shearwater:2', 'uwatec:1']);
  });
});

describe("fusione dell'attrezzatura, casi limite", () => {
  it("un archivio mancante o malformato non cancella quello che c'è", () => {
    const mio = { equipment: [{ id: 'e1', savedAt: '2026-01-01T00:00:00Z' }], certifications: [] };
    expect(fondiAttrezzatura(mio, undefined).value).toEqual({
      equipment: mio.equipment,
      certifications: [],
    });
    expect(fondiAttrezzatura(mio, 'spazzatura').value).toEqual({
      equipment: mio.equipment,
      certifications: [],
    });
    expect(fondiAttrezzatura(undefined, mio).value).toEqual({
      equipment: mio.equipment,
      certifications: [],
    });
  });

  it('i piani salvati si fondono per NOME, che è la loro unica chiave', () => {
    const a = [{ name: 'Trimix 60', savedAt: '2026-01-01T00:00:00Z', state: 1 }];
    const b = [{ name: 'Nitrox 32', savedAt: '2026-01-02T00:00:00Z', state: 2 }];
    const fusi = mergeKeyed(a, b, 'name').value as { name: string }[];
    expect(fusi.map((p) => p.name).sort()).toEqual(['Nitrox 32', 'Trimix 60']);
    // Con la chiave sbagliata collassavano in uno solo: è il difetto che il
    // ripristino di un backup aveva.
    expect((mergeKeyed(a, b, 'id').value as unknown[]).length).toBe(1);
  });
});

describe('obiettivo e periodo, il punto di vista sui dati', () => {
  /*
   * Erano le uniche due chiavi presenti nel backup e assenti dalla
   * sincronizzazione. Non sono dati: sono la finestra da cui si guardano i
   * dati, e con finestre diverse lo stesso archivio racconta numeri diversi sui
   * due dispositivi — che è peggio di un dato mancante, perché sembra vero.
   */
  it('arrivano sul secondo dispositivo', async () => {
    const sql = sqliteExecutor();
    const mac = memoryStore([dive('a')]);
    await mac.setSetting('goal', 'deep');
    await mac.setSetting('goal:at', '2026-08-20T10:00:00Z');
    await mac.setSetting('period', 'all');
    await mac.setSetting('period:at', '2026-08-20T10:00:00Z');
    await syncArchive(mac, sql);

    const telefono = memoryStore([]);
    await syncArchive(telefono, sql);
    expect(await telefono.getSetting('goal')).toBe('deep');
    expect(await telefono.getSetting('period')).toBe('all');
  });

  it('senza timbro locale il valore remoto vincerebbe sempre: il timbro c’è', async () => {
    const sql = sqliteExecutor();
    const a = memoryStore([]);
    await a.setSetting('period', '6m');
    await a.setSetting('period:at', '2026-08-01T00:00:00Z');
    await syncArchive(a, sql);

    // Il secondo dispositivo sceglie DOPO: deve vincere lui, in entrambe le
    // direzioni e senza che il primo debba fare niente di speciale.
    const b = memoryStore([]);
    await b.setSetting('period', '24m');
    await b.setSetting('period:at', '2026-08-20T00:00:00Z');
    await syncArchive(b, sql);
    await syncArchive(a, sql);
    expect(await a.getSetting('period')).toBe('24m');
  });
});

describe('un’impostazione rotta non ferma le altre', () => {
  it('segnala la chiave che ha fallito e allinea comunque il resto', async () => {
    const sql = sqliteExecutor();
    await ensureRemoteSchema(sql);
    // Un documento malformato sul remoto: `JSON.parse` lancerà su questa chiave.
    await sql.execute('INSERT INTO settings (key, updated_at, doc) VALUES (?, ?, ?)', [
      'gear',
      '2026-08-20T10:00:00Z',
      '{ questo non è JSON',
    ]);
    await sql.execute('INSERT INTO settings (key, updated_at, doc) VALUES (?, ?, ?)', [
      'period',
      '2026-08-20T10:00:00Z',
      JSON.stringify('all'),
    ]);

    const store = memoryStore([dive('a')]);
    const report = await syncArchive(store, sql);

    expect(report.settingsErrors.some((e) => e.startsWith('gear:'))).toBe(true);
    // `period` viene DOPO `gear` nell'elenco: prima l'intero giro si fermava
    // alla prima eccezione e questa non veniva nemmeno tentata.
    expect(await store.getSetting('period')).toBe('all');
    // E le immersioni non c'entrano niente: quelle devono essere passate.
    expect(report.pushed).toBe(1);
  });
});

describe('passare a un account senza perdere niente', () => {
  /*
   * LA DOMANDA A CUI QUESTO TEST RISPONDE: «se domani accedo con un account, il
   * mio archivio di oggi che fine fa?»
   *
   * La risposta è che non serve nessuna migrazione, e questo test lo dimostra
   * invece di prometterlo. Un account nuovo significa un database nuovo, cioè
   * VUOTO; e verso un database vuoto la sincronizzazione fa quello che fa
   * sempre: carica tutto. Le immersioni, i profili, l'attrezzatura, i brevetti,
   * le lapidi dei cancellati, i segnalibri di scarico.
   *
   * Il punto delicato è l'ultimo elenco: se le lapidi NON salissero, le
   * immersioni cancellate tornerebbero al primo scarico dal computer subacqueo,
   * perché la memoria del computer le contiene ancora. È esattamente il caso
   * delle 52 immersioni di un altro subacqueo che stavano nell'archivio di
   * riferimento.
   */
  it('l’archivio locale sale intatto su un database appena creato', async () => {
    const locale = memoryStore([dive('a'), dive('b')]);
    await locale.setSetting('gear', {
      equipment: [{ id: 'e1', name: 'Muta 7 mm', kind: 'suit', savedAt: '2026-01-01T00:00:00Z' }],
      certifications: [{ id: 'c1', name: 'Advanced', agency: 'PADI', savedAt: '2026-01-01T00:00:00Z' }],
    });
    await locale.setSetting('gear:at', '2026-01-01T00:00:00Z');
    await locale.setSetting('period', '24m');
    await locale.setSetting('period:at', '2026-01-01T00:00:00Z');
    await locale.setSetting(BLE_MARKERS_KEY, { '63034502': { at: '2026-05-01T00:00:00Z' } });
    await locale.setSetting(`${BLE_MARKERS_KEY}:at`, '2026-01-01T00:00:00Z');
    await locale.setSetting(TOMBSTONE_KEY, [{ id: 'non-mia', at: '2026-01-01T00:00:00Z' }]);

    // Il database dell'account appena creato: vuoto, senza nemmeno le tabelle.
    const nuovo = sqliteExecutor();
    const report = await syncArchive(locale, nuovo);
    expect(report.pushed).toBe(2);

    // E adesso il controllo che conta: un secondo dispositivo che si collega a
    // QUEL database deve ritrovare tutto quanto.
    const altroDispositivo = memoryStore([]);
    await syncArchive(altroDispositivo, nuovo);

    expect((await altroDispositivo.listDives()).length).toBe(2);
    const attrezzatura = (await altroDispositivo.getSetting('gear')) as {
      equipment: unknown[];
      certifications: unknown[];
    };
    expect(attrezzatura.equipment.length).toBe(1);
    expect(attrezzatura.certifications.length).toBe(1);
    expect(await altroDispositivo.getSetting('period')).toBe('24m');
    expect(await altroDispositivo.getSetting(BLE_MARKERS_KEY)).toBeTruthy();

    // Le lapidi: senza queste, le immersioni cancellate tornerebbero al primo
    // scarico dal computer subacqueo, che nella sua memoria le ha ancora.
    const lapidi = (await altroDispositivo.getSetting(TOMBSTONE_KEY)) as { id: string }[];
    expect(lapidi.map((l) => l.id)).toContain('non-mia');
  });
});
