/**
 * Parser Shearwater Cloud e deduplica fra fonti con orologi sfasati.
 *
 * Il database di prova è costruito qui con `node:sqlite`, riproducendo lo schema
 * reale: `dive_details` con le annotazioni del logbook e `log_data` con i JSON di
 * metadati. Nessun dato personale nel repository, e le colonne sono quelle vere —
 * comprese le insidie: pressioni in PSI scritte come testo con la virgola
 * decimale, e un timestamp che è la lettura dell'orologio e non un istante UTC.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  modelFromFileName,
  parseTankSize,
  parseTemperature,
  psiTextToBar,
  shearwaterCloudParser,
} from '../src/core/parsers/shearwaterCloud';
import { detectParser } from '../src/core/parsers';
import { inferClockOffsets, mergeImports } from '../src/core/dedupe';
import { aggregate } from '../src/core/analysis/aggregate';
import { buildPlan } from '../src/core/analysis/coaching';
import { logtrakParser } from '../src/core/parsers/logtrak';
import { encodePnf, encodeUwatecSmart, packPnfBlob, toLogtrak, type UwatecFixtureSpec } from './fixtures';
import type { Dive } from '../src/core/model';

const dir = mkdtempSync(join(tmpdir(), 'mydivelog-sw-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface SwDive {
  /** Lettura dell'orologio del computer, "YYYY-MM-DD HH:MM:SS". */
  clock: string;
  depth: number;
  durationS: number;
  avgDepth: number;
  gf99: number;
  decoMin: number;
  site?: string;
  location?: string;
  buddy?: string;
  weight?: number;
  dress?: string;
  weather?: string;
  workload?: string;
  tankSize?: string;
  startPsi?: string;
  endPsi?: string;
  o2?: number;
  /** Se vero, la riga porta anche il log nativo del computer come nei file veri. */
  withNativeLog?: boolean;
}

/**
 * Un profilo triangolare con la profondità massima e la durata della riga: non
 * serve che sia realistico, serve che sia RICONOSCIBILE quando il parser lo legge.
 */
function nativeProfile(d: SwDive): number[] {
  const n = Math.max(4, Math.round(d.durationS / 10));
  return Array.from({ length: n }, (_, i) => {
    const f = i / (n - 1);
    const depth = f < 0.5 ? d.depth * (f / 0.5) : d.depth * (1 - (f - 0.5) / 0.5);
    return Math.round(depth * 10) / 10;
  });
}

function buildShearwaterDb(name: string, dives: SwDive[]): Uint8Array {
  const path = join(dir, `${name}.db`);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = DELETE');
  db.exec(`create table dive_details (
    DiveId varchar, FileName varchar, DiveDate datetime, Depth varchar, SerialNumber varchar,
    DiveLengthTime varchar, Location varchar, Site varchar, Buddy varchar, DiveNumber varchar,
    Environment varchar, Visibility varchar, Weather varchar, Conditions varchar, Platform varchar,
    AirTemperature varchar, TankProfileData varchar, Tank1PressureStart varchar, Tank1PressureEnd varchar,
    AverageSAC varchar, TankSize varchar, Weight varchar, Dress varchar, Apparatus varchar,
    ThermalComfort varchar, Workload varchar, Problems varchar, Notes varchar
  )`);
  db.exec(`create table log_data (
    log_id varchar, format varchar, file_name varchar,
    calculated_values_from_samples varchar, data_bytes_1 BLOB, data_bytes_2 BLOB, data_bytes_3 BLOB
  )`);

  const det = db.prepare(
    `insert into dive_details values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const log = db.prepare('insert into log_data values (?,?,?,?,?,?,?)');

  dives.forEach((d, i) => {
    const id = `14332781617${String(487726 + i).padStart(6, '0')}`;
    const fileName = `Peregrine[A1B2C3D4]#${i + 1} ${d.clock.slice(0, 10)}.swlogzp`;
    // Il campo si chiama epoch ma contiene la lettura dell'orologio letta come UTC.
    const epochS = Math.round(Date.parse(`${d.clock.replace(' ', 'T')}Z`) / 1000);
    const tankProfile = JSON.stringify({
      GasProfiles: [
        {
          profileIndex: 0,
          O2Percent: d.o2 ?? 21,
          HePercent: 0,
          CircuitMode: 1,
          AverageDepthInMeters: d.avgDepth,
        },
      ],
      TankData: [
        {
          StartPressurePSI: d.startPsi ?? '',
          EndPressurePSI: d.endPsi ?? '',
          GasProfile: { profileIndex: 0, O2Percent: d.o2 ?? 21, HePercent: 0, CircuitMode: 1 },
          DiveTransmitter: { TankIndex: 0 },
        },
      ],
    });
    det.run(
      id,
      fileName,
      d.clock,
      String(d.depth),
      'A1B2C3D4',
      String(d.durationS),
      d.location ?? null,
      d.site ?? null,
      d.buddy ?? null,
      String(i + 1),
      d.weather ? 'Ocean/Sea' : null,
      null,
      d.weather ?? null,
      null,
      d.weather ? 'Small boat' : null,
      null,
      tankProfile,
      null,
      null,
      null,
      d.tankSize ?? null,
      d.weight !== undefined ? String(d.weight) : null,
      d.dress ?? null,
      'Single Tank',
      null,
      d.workload ?? null,
      null,
      null,
    );
    log.run(
      id,
      'sw-pnf',
      fileName,
      JSON.stringify({
        AverageDepth: d.avgDepth,
        AverageTemp: 19.3,
        MinTemp: 18,
        MaxTemp: 22,
        EndGF99: d.gf99,
        MinNDL: 99,
        MaxDecoObligation: d.decoMin,
      }),
      d.withNativeLog
        ? Buffer.from(
            packPnfBlob(
              encodePnf({
                // Un profilo grossolano ma coerente con il riepilogo della riga:
                // serve a verificare che il parser prenda il profilo dal log e
                // non dalle colonne.
                depths: nativeProfile(d),
                intervalS: 10,
                gfLow: 45,
                gfHigh: 95,
                cnsPct: nativeProfile(d).map((_, i) => Math.min(99, i)),
                ceilingM: nativeProfile(d).map((depth, i, all) =>
                  d.decoMin > 0 && i > all.length / 2 && depth < 12 ? 3 : 0,
                ),
                minutes: nativeProfile(d).map((depth, i, all) =>
                  d.decoMin > 0 && i > all.length / 2 && depth < 12 ? d.decoMin : 20,
                ),
              }),
            ),
          )
        : new Uint8Array([0x80, 0x33, 0, 0, 0x1f, 0x8b]),
      Buffer.from(JSON.stringify({ DIVE_NUMBER_KEY: i + 1, DIVE_START_TIME: epochS, DB_VERSION: 12 })),
      Buffer.from(
        JSON.stringify({
          StartTime: epochS,
          DiveTimeInSeconds: d.durationS,
          MaxDepth: d.depth,
          DiveNumber: i + 1,
          UnitSystem: 0,
          Mode: 6,
        }),
      ),
    );
  });
  db.close();
  return new Uint8Array(readFileSync(path));
}

const SW: SwDive[] = [
  {
    clock: '2025-05-31 10:15:02',
    depth: 33.8,
    durationS: 2890,
    avgDepth: 17.25,
    gf99: 67,
    decoMin: 0,
    site: 'Gonzatti',
    location: 'Recco',
    buddy: 'Miriam',
    weight: 8,
    dress: 'Wet Suit',
    weather: 'Sunny',
    workload: 'Light',
    tankSize: '15lt',
    startPsi: '2900',
    endPsi: '725',
  },
  {
    clock: '2025-05-31 12:49:34',
    depth: 34.5,
    durationS: 2879,
    avgDepth: 16.78,
    gf99: 66,
    decoMin: 0,
    site: 'Colombara',
    location: 'Recco',
  },
  {
    clock: '2025-06-01 10:11:32',
    depth: 43.5,
    durationS: 2121,
    avgDepth: 20.71,
    gf99: 69,
    decoMin: 2,
    site: 'Mohawk Deer',
    location: 'Arenzano',
  },
  { clock: '2025-06-14 10:07:00', depth: 40.6, durationS: 2447, avgDepth: 17.39, gf99: 59, decoMin: 0 },
  { clock: '2025-06-14 14:51:00', depth: 31.6, durationS: 2923, avgDepth: 16.52, gf99: 65, decoMin: 0 },
  { clock: '2025-07-05 10:16:00', depth: 39.9, durationS: 2940, avgDepth: 18.18, gf99: 78, decoMin: 3 },
  // Con il log nativo del computer, come sono i file veri.
  {
    clock: '2025-07-19 10:13:03',
    depth: 28.4,
    durationS: 2600,
    avgDepth: 14.2,
    gf99: 71,
    decoMin: 0,
    site: 'Punta Chiappa',
    withNativeLog: true,
  },
  {
    clock: '2025-07-23 11:09:56',
    depth: 36.2,
    durationS: 2200,
    avgDepth: 17.1,
    gf99: 74,
    decoMin: 4,
    site: 'Isuela',
    withNativeLog: true,
  },
];

describe('conversioni', () => {
  it('legge le pressioni PSI con virgola o punto decimale', () => {
    // Lo stesso database contiene entrambe le forme, secondo la lingua dell'app.
    expect(psiTextToBar('2900')).toBe(200);
    expect(psiTextToBar('2900,75')).toBe(200);
    expect(psiTextToBar('3335.87')).toBe(230);
    expect(psiTextToBar('')).toBeUndefined();
    expect(psiTextToBar('0')).toBeUndefined();
  });

  it('legge le taglie delle bombole', () => {
    expect(parseTankSize('15lt')).toBe(15);
    expect(parseTankSize('15 lt')).toBe(15);
    expect(parseTankSize('18lt')).toBe(18);
    expect(parseTankSize('80 cuft')!).toBeCloseTo(11, 0);
    expect(parseTankSize(undefined)).toBeUndefined();
  });

  it('legge il modello dal nome del file', () => {
    expect(modelFromFileName('Peregrine[A1B2C3D4]#30 2026-5-31 11-0-58.swl')).toBe('Peregrine');
    expect(modelFromFileName('Perdix 2[ABC]#1.swl')).toBe('Perdix 2');
    expect(modelFromFileName('senza-parentesi.swl')).toBeUndefined();
  });

  it('legge le temperature scritte a mano', () => {
    expect(parseTemperature('22')).toBe(22);
    expect(parseTemperature('23º')).toBe(23);
    expect(parseTemperature('72 F')!).toBeCloseTo(22.2, 1);
    expect(parseTemperature(undefined)).toBeUndefined();
  });
});

describe('parser Shearwater Cloud', () => {
  const bytes = buildShearwaterDb('base', SW);

  it('viene riconosciuto e non confuso con altri database SQLite', () => {
    expect(detectParser({ fileName: 'x.db', bytes })?.format).toBe('shearwater-cloud');
    // L'archivio di MyDiveLog è anch'esso SQLite e non deve essere riconosciuto qui.
    const other = buildShearwaterDb('altro', []);
    void other;
    const mine = (() => {
      const path = join(dir, 'mio.db');
      const db = new DatabaseSync(path);
      db.exec('create table dives (id text, doc text)');
      db.close();
      return new Uint8Array(readFileSync(path));
    })();
    expect(shearwaterCloudParser.detect({ fileName: 'mio.db', bytes: mine })).toBe(false);
  });

  it('importa i dati di sintesi e le annotazioni', () => {
    const { dives, warnings } = shearwaterCloudParser.parse({ fileName: 'sw.db', bytes });
    expect(dives).toHaveLength(SW.length);
    const d = dives.find((x) => x.maxDepth === 33.8)!;
    expect(d.durationS).toBe(2890);
    expect(d.avgDepth).toBeCloseTo(17.25, 2);
    expect(d.site?.name).toBe('Gonzatti');
    expect(d.site?.region).toBe('Recco');
    expect(d.buddy).toBe('Miriam');
    expect(d.weightKg).toBe(8);
    expect(d.suit).toBe('Wet Suit');
    expect(d.cylinders[0].sizeL).toBe(15);
    expect(d.cylinders[0].startBar).toBe(200);
    expect(d.cylinders[0].endBar).toBe(50);
    expect(d.computer?.model).toBe('Shearwater Peregrine');
    expect(d.computer?.serial).toBe('A1B2C3D4');
    expect(d.annotations?.['Carico di lavoro']).toBe('Light');
    expect(d.annotations?.Meteo).toBe('Sunny');
    expect(d.tags).toContain('sunny');
    // Questa riga non porta il log nativo: resta senza profilo, e va detto.
    expect(d.samples).toHaveLength(0);
    expect(warnings.join(' ')).toContain('dati di riepilogo');
  });

  it('tiene separati i valori letti dal computer da quelli calcolati', () => {
    const { dives } = shearwaterCloudParser.parse({ fileName: 'sw.db', bytes });
    const withDeco = dives.find((d) => d.reported?.maxDecoObligationS === 120)!;
    expect(withDeco).toBeDefined();
    expect(withDeco.reported!.gf99End).toBe(69);
    // Il tetto NON è nelle nostre metriche: il formato non lo contiene.
    expect(withDeco.metrics!.decoS).toBe(0);
    expect(withDeco.metrics!.maxCeilingM).toBeUndefined();
  });

  it("non registra il fondo scala dell'NDL come una misura", () => {
    // MinNDL = 99 significa "mai avvicinati al limite", non "il limite era 99'".
    const { dives } = shearwaterCloudParser.parse({ fileName: 'sw.db', bytes });
    expect(dives.every((d) => d.reported?.minNdlS === undefined)).toBe(true);
  });

  it('calcola il consumo dalla profondità media dichiarata, senza profilo', () => {
    const { dives } = shearwaterCloudParser.parse({ fileName: 'sw.db', bytes });
    const d = dives.find((x) => x.maxDepth === 33.8)!;
    // 150 bar su 15 L a ~2.7 ATA in 48 minuti.
    expect(d.metrics!.rmvLpm).toBeDefined();
    expect(d.metrics!.rmvLpm!).toBeGreaterThan(12);
    expect(d.metrics!.rmvLpm!).toBeLessThan(25);
  });

  it('sopravvive a un database senza le tabelle attese', () => {
    const path = join(dir, 'vuoto.db');
    const db = new DatabaseSync(path);
    db.exec('create table dive_details (DiveId text)');
    db.exec('create table log_data (log_id text)');
    db.close();
    const empty = new Uint8Array(readFileSync(path));
    const { dives, warnings } = shearwaterCloudParser.parse({ fileName: 'vuoto.db', bytes: empty });
    expect(dives).toHaveLength(0);
    expect(warnings.join(' ')).toContain('Nessuna immersione');
  });
});

// ---------------------------------------------------------------------------

/**
 * Costruisce un profilo che raggiunge `maxDepth` e ha esattamente la media
 * `targetMean`.
 *
 * Serve perché la deduplica confronta anche la profondità MEDIA, e un profilo
 * triangolare — la forma più ovvia da generare — ha media pari a metà del massimo,
 * che sulle immersioni reali non è quasi mai vero. Con una media sbagliata di due
 * metri le due fonti non si riconoscono più, e il test misurerebbe il fixture
 * invece del codice.
 *
 * Forma: discesa breve al massimo, risalita a un livello di sosta, lungo tratto a
 * quel livello, uscita. Il livello si cerca per bisezione finché la media
 * combacia.
 */
function profileWithMean(maxDepth: number, targetMean: number, steps: number): number[] {
  const build = (level: number): number[] =>
    Array.from({ length: steps + 1 }, (_, k) => {
      const f = k / steps;
      if (f < 0.06) return (maxDepth * f) / 0.06;
      if (f < 0.12) return maxDepth - (maxDepth - level) * ((f - 0.06) / 0.06);
      if (f < 0.92) return level;
      return level * (1 - (f - 0.92) / 0.08);
    });
  const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  let lo = 0.5;
  let hi = maxDepth;
  let best = build(targetMean);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    best = build(mid);
    if (meanOf(best) < targetMean) lo = mid;
    else hi = mid;
  }
  return best.map((v) => Math.round(v * 10) / 10);
}

/** Le stesse immersioni viste dal secondo computer, con l'orologio su UTC. */
function logtrakFor(dives: SwDive[], offsetHours: number[]): string {
  const specs: UwatecFixtureSpec[] = dives.map((d, i) => {
    const clockMs = Date.parse(`${d.clock.replace(' ', 'T')}Z`);
    const offset = offsetHours[i] ?? offsetHours[0];
    const depths = profileWithMean(d.depth, d.avgDepth, Math.round(d.durationS / 4));
    return {
      // LogTRAK salva UTC: la lettura dell'orologio meno il fuso.
      startTime: new Date(clockMs - offset * 3_600_000),
      utcOffsetMinutes: offset * 60,
      depths,
      temps: undefined,
      o2: (d.o2 ?? 21) / 100,
      startBar: 220,
      endBar: 70,
    };
  });
  void encodeUwatecSmart;
  return toLogtrak(specs);
}

describe('deduplica fra fonti con orologi sfasati', () => {
  it("riconosce le stesse immersioni nonostante un'ora di scarto", () => {
    const swBytes = buildShearwaterDb('sfasate', SW);
    const sw = shearwaterCloudParser.parse({ fileName: 'sw.db', bytes: swBytes }).dives;
    const lt = logtrakParser.parse({ fileName: 'lt.logtrak', text: logtrakFor(SW, [1]) }).dives;
    expect(lt).toHaveLength(SW.length);

    const offsets = inferClockOffsets(lt, sw);
    expect(offsets.length).toBeGreaterThanOrEqual(1);
    expect(offsets[0].offsetMs / 3_600_000).toBeCloseTo(-1, 1);

    const rep = mergeImports(lt, sw);
    // Nessuna immersione nuova: sono le stesse, riconosciute nonostante lo scarto.
    expect(rep.added).toBe(0);
    expect(rep.merged).toBe(SW.length);
    expect(rep.dives).toHaveLength(SW.length);
    expect(rep.clockOffsets[0].pairs).toBeGreaterThanOrEqual(3);
  });

  it('gestisce due sfasamenti diversi nello stesso lotto', () => {
    // Caso reale: a metà dello storico l'orologio di un computer viene corretto,
    // quindi metà delle immersioni sono sfasate di un'ora e metà di due.
    const offsets = [1, 1, 1, 2, 2, 2];
    const swBytes = buildShearwaterDb('due-sfasamenti', SW);
    const sw = shearwaterCloudParser.parse({ fileName: 'sw.db', bytes: swBytes }).dives;
    const lt = logtrakParser.parse({ fileName: 'lt.logtrak', text: logtrakFor(SW, offsets) }).dives;

    const found = inferClockOffsets(lt, sw, { minPairs: 2 });
    const hours = found.map((o) => Math.round(o.offsetMs / 3_600_000));
    expect(hours).toContain(-1);
    expect(hours).toContain(-2);

    const rep = mergeImports(lt, sw);
    expect(rep.dives).toHaveLength(SW.length);
    expect(rep.added).toBe(0);
  });

  it("non inventa uno sfasamento quando non c'è", () => {
    const swBytes = buildShearwaterDb('allineate', SW);
    const sw = shearwaterCloudParser.parse({ fileName: 'sw.db', bytes: swBytes }).dives;
    const lt = logtrakParser.parse({ fileName: 'lt.logtrak', text: logtrakFor(SW, [0]) }).dives;
    expect(inferClockOffsets(lt, sw)).toHaveLength(0);
    const rep = mergeImports(lt, sw);
    expect(rep.added).toBe(0);
    expect(rep.clockOffsets).toHaveLength(0);
  });

  it("non fonde immersioni diverse solo perché c'è uno sfasamento plausibile", () => {
    // Due immersioni ripetitive con profondità e durata ben diverse non devono
    // essere confuse fra loro nemmeno provando gli sfasamenti candidati.
    const swBytes = buildShearwaterDb('ripetitive', SW);
    const sw = shearwaterCloudParser.parse({ fileName: 'sw.db', bytes: swBytes }).dives;
    const lt = logtrakParser.parse({ fileName: 'lt.logtrak', text: logtrakFor(SW, [1]) }).dives;
    const rep = mergeImports(lt, sw);
    // Ogni immersione unita deve conservare la SUA profondità e il SUO GF99.
    for (const s of sw) {
      const host = rep.dives.find((d) => d.reported?.gf99End === s.reported?.gf99End);
      expect(host, `GF99 ${s.reported?.gf99End} deve stare su una sola immersione`).toBeDefined();
      expect(Math.abs(host!.maxDepth - s.maxDepth)).toBeLessThan(1.2);
    }
  });

  it('unendo le due fonti il profilo resta e i dati deco arrivano', () => {
    const swBytes = buildShearwaterDb('unione', SW);
    const sw = shearwaterCloudParser.parse({ fileName: 'sw.db', bytes: swBytes }).dives;
    const lt = logtrakParser.parse({ fileName: 'lt.logtrak', text: logtrakFor(SW, [1]) }).dives;
    const merged = mergeImports(lt, sw).dives;

    const withBoth = merged.filter((d) => (d.samples?.length ?? 0) > 2 && d.reported?.gf99End !== undefined);
    expect(withBoth.length).toBe(SW.length);

    // L'obbligo decompressivo del computer entra nel conteggio anche se il
    // profilo — che viene da un computer Uwatec — non contiene dati di deco.
    const agg = aggregate(merged);
    expect(agg.decoDives).toBe(SW.filter((d) => d.decoMin >= 1).length);
    // `gf99` è ora la serie calcolata da noi, che qui non c'è perché la catena
    // dei tessuti gira nella riparazione e non nell'import. Quello che questo
    // test deve provare è che il dato del COMPUTER sia sopravvissuto alla
    // fusione, ed è `gf99Reported`.
    expect(agg.gf99Reported).toHaveLength(SW.length);
    expect(Math.max(...agg.gf99Reported.map((p) => p.value))).toBeGreaterThan(50);

    const plan = buildPlan(merged, agg, 'tec');
    const decoItem = plan.readiness.items.find((i) => i.label.includes('decompressive'))!;
    expect(decoItem.have).toBe(SW.filter((d) => d.decoMin >= 1).length);
  });

  it('la modifica manuale non viene sovrascritta dal secondo import', () => {
    const swBytes = buildShearwaterDb('manuale', SW);
    const sw = shearwaterCloudParser.parse({ fileName: 'sw.db', bytes: swBytes }).dives;
    const lt = logtrakParser.parse({ fileName: 'lt.logtrak', text: logtrakFor(SW, [1]) }).dives;
    const edited: Dive[] = lt.map((d) => ({ ...d, notes: 'Nota mia', site: { name: 'Il mio nome' } }));
    const merged = mergeImports(edited, sw).dives;
    expect(merged.every((d) => d.notes === 'Nota mia')).toBe(true);
    expect(merged.every((d) => d.site?.name === 'Il mio nome')).toBe(true);
    // Ma i campi che l'utente non ha toccato arrivano comunque.
    expect(merged.some((d) => d.reported?.gf99End !== undefined)).toBe(true);
  });
});

describe('log nativo dentro il database', () => {
  const bytes = buildShearwaterDb('nativo', SW);

  it('prende il profilo dal log del computer, non dalle colonne', () => {
    const { dives, warnings } = shearwaterCloudParser.parse({ fileName: 'sw.db', bytes });
    const d = dives.find((x) => x.site?.name === 'Punta Chiappa')!;
    expect(d.samples?.length).toBeGreaterThan(200);
    expect(d.maxDepth).toBeCloseTo(28.4, 1);
    // Le impostazioni del computer arrivano solo dal log: nessuna colonna del
    // database le contiene.
    expect(d.computer?.gfLow).toBe(45);
    expect(d.computer?.gfHigh).toBe(95);
    expect(d.computer?.decoModel).toContain('Bühlmann');
    expect(d.computer?.firmware).toBe('v89');
    expect(d.computer?.sampleIntervalS).toBe(10);
    expect(d.surfacePressureBar).toBeCloseTo(1.013, 3);
    expect(d.salinity).toBe('salt');
    expect(warnings.join(' ')).toMatch(/log nativo/);
  });

  it('riconosce il tetto di decompressione letto dal computer', () => {
    const { dives } = shearwaterCloudParser.parse({ fileName: 'sw.db', bytes });
    const d = dives.find((x) => x.site?.name === 'Isuela')!;
    const withCeiling = (d.samples ?? []).filter((s) => (s.ceiling ?? 0) > 0);
    expect(withCeiling.length).toBeGreaterThan(0);
    expect(d.metrics?.decoS).toBeGreaterThan(0);
    // Il CNS cresce lungo l'immersione: è un canale che il formato Uwatec non ha.
    expect(Math.max(...(d.samples ?? []).map((s) => s.cns ?? 0))).toBeGreaterThan(0);
  });

  it('un log illeggibile non fa perdere l’immersione', () => {
    // La riga senza log nativo ha un blob finto di sei byte: deve produrre un
    // avviso e un'immersione senza profilo, non un import fallito.
    const { dives, warnings } = shearwaterCloudParser.parse({ fileName: 'sw.db', bytes });
    expect(dives.length).toBe(SW.length);
    expect(warnings.some((w) => /riepilogo/.test(w))).toBe(true);
  });
});
