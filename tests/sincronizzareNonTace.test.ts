/**
 * TRE SILENZI E UN CONSIGLIO SBAGLIATO.
 *
 * Trovati il 16 settembre 2026 leggendo la sincronizzazione e lo scarico
 * Bluetooth accanto alle regole che si erano già dati.
 *
 *  1. Un **profilo illeggibile** sul remoto usciva da `pullSamples` come un
 *     elenco vuoto, con scritto accanto «il piano successivo riprova».
 *     Riprovare riprovava, e rifalliva uguale, per sempre: fuori, la
 *     sincronizzazione si dichiarava riuscita a ogni giro.
 *  2. `genereErroreSync` classificava per sottostringa, e
 *     `SyntaxError: Unexpected token '<'` — cioè il database che risponde una
 *     pagina HTML — diventava **«la chiave è scaduta, esci e rientra»**. Chi lo
 *     legge esce dall'account, rientra, e il guasto è ancora lì.
 *  3. L'offerta di **ripartire dal segnalibro** chiedeva che le immersioni
 *     fossero *arrivate*, non che fossero *entrate in archivio*. Sotto il
 *     messaggio «sono arrivate ma non si sono potute salvare» compariva il
 *     riquadro che propone di saltarle.
 */

import { describe, expect, it } from 'vitest';
import { genereErroreSync } from '../src/sync/turso';
import {
  segnalibroDaSalvare,
  offertaDiRipartire,
  perchéNonSiOffre,
} from '../src/core/ble/segnalibroDaSalvare';

describe('il genere di un errore di sincronizzazione', () => {
  it('riconosce ancora quelli veri, altrimenti avrei solo spento il consiglio', () => {
    expect(genereErroreSync(new Error('401 Unauthorized'))).toBe('token');
    expect(genereErroreSync(new Error('SERVER ERROR: 403 forbidden'))).toBe('token');
    expect(genereErroreSync(new Error('the auth token is expired'))).toBe('token');
    expect(genereErroreSync(new Error('invalid token'))).toBe('token');
    expect(genereErroreSync(new Error('JWT validation failed'))).toBe('token');
    expect(genereErroreSync(new Error('TypeError: Failed to fetch'))).toBe('rete');
    expect(genereErroreSync(new Error('fetch failed'))).toBe('rete');
  });

  it('e legge il codice quando c’è, che è un numero e non una parola in una frase', () => {
    const conStato = Object.assign(new Error('qualcosa è andato storto'), { status: 401 });
    expect(genereErroreSync(conStato)).toBe('token');
    const conCodice = Object.assign(new Error('qualcosa è andato storto'), { code: 'ENOTFOUND' });
    expect(genereErroreSync(conCodice)).toBe('rete');
  });

  it('non scambia più un JSON rotto per una chiave scaduta', () => {
    /*
     * ► IL CUORE. ◄ È il messaggio esatto che si ottiene quando il database
     * risponde una pagina HTML invece che JSON: un guasto del server, o un
     * proxy di mezzo. Contiene «token», e diventava «esci e rientra».
     */
    const jsonRotto = new SyntaxError(`Unexpected token '<', "<html>..." is not valid JSON`);
    expect(genereErroreSync(jsonRotto)).toBe('altro');
  });

  it('e non scambia un numero dentro una frase per un codice di stato', () => {
    expect(genereErroreSync(new Error('immersione 1401 non trovata'))).toBe('altro');
    expect(genereErroreSync(new Error('4030 righe scritte'))).toBe('altro');
  });

  it('un errore che non riconosce resta «altro», invece di indovinare', () => {
    expect(genereErroreSync(new Error('database is locked'))).toBe('altro');
    expect(genereErroreSync(new Error(''))).toBe('altro');
  });
});

describe('l’offerta di ripartire dal segnalibro', () => {
  const pronto = { impronta: 'abc', completo: false, salvate: true, tutteTradotte: true };

  it('si fa quando le immersioni sono davvero entrate in archivio', () => {
    expect(offertaDiRipartire(pronto)).toBe(true);
    // E il segnalibro automatico no, perché lo scarico non è arrivato in fondo:
    // è l'unica condizione che le due regole non condividono.
    expect(segnalibroDaSalvare(pronto)).toBe(false);
  });

  it('NON si fa se l’archivio non ha confermato la scrittura', () => {
    // ► IL CUORE. ◄ Disco pieno: le immersioni sono arrivate e non sono
    // entrate. Accettare l'offerta le salterebbe per sempre, in silenzio.
    const nonSalvate = { ...pronto, salvate: false };
    expect(offertaDiRipartire(nonSalvate)).toBe(false);
    expect(perchéNonSiOffre(nonSalvate)).toContain('non ha confermato la scrittura');
  });

  it('NON si fa se un record non è diventato un’immersione', () => {
    // L'impronta della più recente potrebbe essere proprio quella scartata.
    const scartato = { ...pronto, tutteTradotte: false };
    expect(offertaDiRipartire(scartato)).toBe(false);
    expect(perchéNonSiOffre(scartato)).toContain('non è diventato');
  });

  it('NON si fa senza un’impronta su cui fermarsi', () => {
    const senzaImpronta = { ...pronto, impronta: undefined };
    expect(offertaDiRipartire(senzaImpronta)).toBe(false);
    expect(perchéNonSiOffre(senzaImpronta)).toContain('impronta');
  });

  it('e quando si fa, il motivo è vuoto: il diario non si riempie di «tutto a posto»', () => {
    expect(perchéNonSiOffre(pronto)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Il profilo che non scende, contro un SQLite vero
// ---------------------------------------------------------------------------

import { beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { syncArchive, type SqlExecutor } from '../src/sync/turso';
import type { Dive, Sample } from '../src/core/model';
import type { DiveStore } from '../src/storage';

function sqliteExecutor(): SqlExecutor & { db: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    async execute(sql: string, args: unknown[] = []) {
      if (!/^\s*select/i.test(sql)) {
        db.prepare(sql).run(...(args as never[]));
        return { rows: [] };
      }
      return { rows: db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[] };
    },
    close: () => db.close(),
  };
}

function memoryStore(seed: Dive[] = []): DiveStore {
  const dives = new Map<string, Dive>();
  const samples = new Map<string, Sample[]>();
  const altSamples = new Map<string, Sample[]>();
  const settings = new Map<string, unknown>();
  const put = (list: Dive[]) => {
    for (const d of list) {
      const { samples: s, altSamples: _a, ...rest } = d;
      dives.set(d.id, rest as Dive);
      if (s?.length) samples.set(d.id, s);
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
    async getSetting<T>(key: string) {
      return settings.get(key) as T | undefined;
    },
    async setSetting<T>(key: string, value: T) {
      settings.set(key, value);
    },
  } as DiveStore;
}

const immersione = (id: string, extra: Partial<Dive> = {}): Dive => ({
  id,
  startTime: '2026-06-14T10:38:00+02:00',
  durationS: 2520,
  maxDepth: 32.4,
  mode: 'oc',
  cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: 12, startBar: 220, endBar: 70 }],
  source: { format: 'uddf', file: 'a.uddf', importedAt: '2026-06-14T20:00:00Z' },
  tags: [],
  ...extra,
});

const profilo = (n: number): Sample[] =>
  Array.from({ length: n }, (_, i) => ({ t: i * 10, depth: 5 + (i % 20) }));

describe('un profilo che non scende non passa per «tutto a posto»', () => {
  let sql: ReturnType<typeof sqliteExecutor>;
  beforeEach(() => {
    sql = sqliteExecutor();
  });

  it('quando è leggibile scende, e il rapporto non ha niente da segnalare', async () => {
    // Il caso sano prima: se questo cadesse, quello sotto sarebbe verde per il
    // motivo sbagliato.
    const sorgente = memoryStore([immersione('a', { samples: profilo(150) })]);
    await syncArchive(sorgente, sql);
    const destinazione = memoryStore();
    const rapporto = await syncArchive(destinazione, sql);
    expect(rapporto.pulledProfiles).toBe(1);
    expect(rapporto.profileErrors).toEqual([]);
    expect((await destinazione.getSamples('a')).length).toBe(150);
  });

  for (const [nome, rotto] of [
    ['troncato a metà scrittura', '[{"t":0,"depth":5},{"t":10,'],
    ['una pagina HTML al posto del JSON', '<html><body>502</body></html>'],
    ['un documento che non è un elenco', '{"t":0,"depth":5}'],
  ] as const) {
    it(`quando è ${nome}, l’immersione scende e il rapporto lo DICE`, async () => {
      const sorgente = memoryStore([immersione('a', { samples: profilo(150) })]);
      await syncArchive(sorgente, sql);
      sql.db.prepare('UPDATE dive_samples SET doc = ? WHERE dive_id = ?').run(rotto, 'a');

      const destinazione = memoryStore();
      const rapporto = await syncArchive(destinazione, sql);

      // L'immersione entra lo stesso: un documento rotto su una non deve
      // fermare le altre cinquanta.
      expect(await destinazione.getDive('a')).toBeDefined();
      // ► IL CUORE. ◄ Prima: `pulledProfiles: 0` e nient'altro, a ogni giro,
      // per sempre, con la sincronizzazione che si dichiarava riuscita.
      expect(rapporto.profileErrors).toHaveLength(1);
      expect(rapporto.profileErrors[0]).toContain('a');
    });
  }
});
