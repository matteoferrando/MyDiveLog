/**
 * Shearwater Cloud — il database dell'applicazione desktop (`.db`).
 *
 * È un vero file SQLite, letto da `sqliteReader.ts` senza dipendenze esterne.
 * Due tabelle contano:
 *
 *  - `dive_details`: 57 colonne di annotazioni del logbook — sito, compagno,
 *    condizioni, muta, zavorra, carico di lavoro, problemi riscontrati;
 *  - `log_data`: una riga per immersione con il profilo compresso in
 *    `data_bytes_1`, due blocchi JSON di metadati e — la parte che interessa
 *    davvero — `calculated_values_from_samples`.
 *
 * PERCHÉ QUESTO FORMATO VALE LA PENA anche quando la stessa immersione c'è già
 * da un'altra fonte: `calculated_values_from_samples` contiene due numeri che
 * nessun altro formato qui supportato fornisce.
 *
 *  - **EndGF99**: quanto il subacqueo era sovrasaturo, in percentuale del
 *    gradiente ammesso, nell'istante in cui è arrivato in superficie. È la
 *    misura di quanto "al limite" è stata chiusa l'immersione.
 *  - **MaxDecoObligation**: l'obbligo decompressivo massimo incontrato. Il
 *    formato Uwatec dei computer Scubapro non contiene NIENTE sulla
 *    decompressione, quindi per le immersioni che arrivano da LogTRAK questo
 *    dato non esiste: unendo le due fonti si scopre che alcune immersioni
 *    ritenute "tutte in curva" avevano un obbligo di qualche minuto.
 *
 * IL PROFILO NATIVO. `data_bytes_1` è un blob gzip che contiene la copia esatta
 * della memoria del computer per quella immersione (formato "sw-pnf"), e viene
 * decodificato da `shearwaterPnf.ts`. È la fonte più ricca dell'intero progetto:
 * tetto di decompressione, TTS e NDL a ogni campione, CNS, PPO2, gradient factor
 * impostati, modello decompressivo, coordinate GPS di ingresso e uscita.
 *
 * ATTENZIONE a una trappola scoperta a caro prezzo: le colonne "leggibili" di
 * `dive_details` sono quasi tutte VUOTE su un archivio reale — Shearwater Cloud
 * le riempie solo se l'utente scrive quei campi a mano nell'app. Sito, note,
 * zavorra, GF, temperature: tutto null. Leggere solo quelle colonne dà
 * l'impressione che il database non contenga niente, mentre contiene tutto: sta
 * nel blob.
 */

import {
  AIR,
  type Cylinder,
  type Dive,
  type DiveMode,
  type ReportedSummary,
  type Salinity,
} from '../model';
import { psiToBar, wallClockToIso } from '../units';
import { diveIdFor } from '../dedupe';
import { computeMetrics } from '../analysis/metrics';
import { isSqlite, readSqliteTables, sqliteTableNames, type SqlRow } from './sqliteReader';
import { decodePnfBlob, isPnfBlob, type PnfLog } from './shearwaterPnf';
import type { DiveParser, ParseInput, ParseResult } from './types';

export const shearwaterCloudParser: DiveParser = {
  format: 'shearwater-cloud',
  label: 'Shearwater Cloud (database .db)',
  extensions: ['.db', '.sqlite', '.sqlite3'],

  detect(input: ParseInput) {
    if (!input.bytes || !isSqlite(input.bytes)) return false;
    // La firma SQLite da sola non basta: anche l'archivio di MyDiveLog è un file
    // SQLite. Leggiamo lo schema — costa pochi millisecondi — invece di cercare i
    // nomi come testo nei primi byte, che non funziona: nel database di
    // Shearwater Cloud lo schema comincia a pagina 10.
    try {
      const names = new Set(sqliteTableNames(input.bytes).map((n) => n.toLowerCase()));
      return names.has('dive_details') && names.has('log_data');
    } catch {
      return false;
    }
  },

  parse(input: ParseInput): ParseResult {
    const warnings: string[] = [];
    if (!input.bytes) return { format: 'shearwater-cloud', dives: [], warnings: ['File vuoto.'] };

    let tables;
    try {
      tables = readSqliteTables(input.bytes, ['dive_details', 'log_data']);
    } catch (err) {
      return {
        format: 'shearwater-cloud',
        dives: [],
        warnings: [`Database non leggibile: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    const details = tables.get('dive_details')?.rows ?? [];
    const logs = new Map(
      (tables.get('log_data')?.rows ?? []).map((r) => [String(r.log_id ?? ''), r] as const),
    );
    if (details.length === 0) {
      return { format: 'shearwater-cloud', dives: [], warnings: ['Nessuna immersione in dive_details.'] };
    }

    const importedAt = new Date().toISOString();
    const dives: Dive[] = [];
    const eventCodes = new Set<string>();
    let withoutTiming = 0;

    for (const row of details) {
      const log = logs.get(String(row.DiveId ?? ''));
      const dive = readDive(row, log, input.fileName, importedAt, warnings, eventCodes);
      if (dive) dives.push(dive);
      else withoutTiming++;
    }

    const withProfile = dives.filter((d) => (d.samples?.length ?? 0) > 0).length;
    warnings.push(
      withProfile === dives.length
        ? `${dives.length} immersioni con il profilo completo letto dal log nativo del computer: tetto deco, TTS, NDL, CNS e impostazioni GF.`
        : `${withProfile} di ${dives.length} immersioni hanno il profilo dal log nativo del computer; per le altre restano i soli dati di riepilogo.`,
    );
    if (withoutTiming > 0) {
      warnings.push(`${withoutTiming} righe scartate: data o durata non interpretabili.`);
    }
    if (eventCodes.size) {
      warnings.push(
        `Eventi del log non documentati, letti e non interpretati: codici ${[...eventCodes]
          .sort((a, b) => +a - +b)
          .join(', ')}.`,
      );
    }
    return { format: 'shearwater-cloud', dives, warnings };
  },
};

// ---------------------------------------------------------------------------

function readDive(
  row: SqlRow,
  log: SqlRow | undefined,
  fileName: string,
  importedAt: string,
  warnings: string[],
  eventCodes: Set<string>,
): Dive | null {
  const meta = parseJson(log?.data_bytes_2);
  const header = parseJson(log?.data_bytes_3);
  const calc = parseJson(log?.calculated_values_from_samples);

  // L'istante esatto è l'epoch Unix nei metadati; `DiveDate` è lo stesso momento
  // scritto in ora LOCALE del posto. La differenza fra i due dà il fuso, che
  // altrimenti non sarebbe recuperabile.
  const epochS = num(meta?.DIVE_START_TIME) ?? num(header?.StartTime);
  const localText = str(row.DiveDate);
  const localMs = localText ? Date.parse(`${localText.replace(' ', 'T')}Z`) : NaN;

  let startMs: number;
  let utcOffsetMinutes: number | undefined;
  if (epochS !== undefined && epochS > 0) {
    startMs = epochS * 1000;
    if (Number.isFinite(localMs)) {
      utcOffsetMinutes = Math.round((localMs - startMs) / 60_000 / 15) * 15;
    }
  } else if (Number.isFinite(localMs)) {
    // Senza l'epoch resta solo l'ora locale: la interpretiamo come tale, senza
    // inventare un fuso.
    // Lettura d'orologio senza fuso: fissata su UTC, non nel fuso della macchina.
    startMs = Date.parse(wallClockToIso(localText!) ?? '');
  } else {
    return null;
  }

  const durationS = Math.round(num(row.DiveLengthTime) ?? num(header?.DiveTimeInSeconds) ?? 0);
  const maxDepth = num(row.Depth) ?? num(header?.MaxDepth) ?? 0;
  if (!durationS || !maxDepth) return null;

  const tankProfile = parseJson(row.TankProfileData);
  const cylinders = readCylinders(row, tankProfile);

  // Il log nativo del computer, se c'è: è la fonte più affidabile di tutto ciò
  // che segue, e quando c'è vince su qualsiasi colonna del database.
  const native = readNativeLog(log, warnings, localText, eventCodes);

  const model = modelFromFileName(str(log?.file_name) ?? str(row.FileName));
  const serial = str(row.SerialNumber);
  const base = {
    startTime: new Date(startMs).toISOString(),
    maxDepth: round1(maxDepth),
    durationS,
    computer: {
      model: native?.computer.model ?? (model ? `Shearwater ${model}` : 'Shearwater'),
      serial: native?.computer.serial ?? serial,
      deviceId: native?.computer.serial ?? serial,
      diveId: str(row.DiveId),
      firmware: native?.computer.firmware,
      decoModel: native?.settings.decoModel,
      gfLow: native?.settings.gfLow,
      gfHigh: native?.settings.gfHigh,
      conservatism: native?.settings.conservatism,
      waterDensityKgM3: native?.settings.waterDensity,
      sampleIntervalS: native?.settings.sampleIntervalS,
      logVersion: native?.settings.logVersion,
      aiMode: native?.settings.aiMode,
      computerMode: native?.settings.mode,
    },
  };

  const reported = readReported(calc, row);
  const annotations = readAnnotations(row);

  const dive: Dive = {
    id: diveIdFor(base),
    number: num(row.DiveNumber) ?? num(header?.DiveNumber),
    startTime: base.startTime,
    utcOffsetMinutes,
    durationS,
    maxDepth: base.maxDepth,
    avgDepth: roundOr(num(calc?.AverageDepth) ?? nativeAvgDepth(native), 2),
    minTempC: roundOr(num(calc?.MinTemp) ?? nativeMinTemp(native), 1),
    airTempC: parseTemperature(str(row.AirTemperature)),
    site: readSite(row, native),
    buddy: joinNonEmpty([str(row.Buddy)]),
    notes: joinNonEmpty([str(row.Notes), str(row.EnvironmentNotes), str(row.IssueNotes)], '\n'),
    mode: nativeMode(native) ?? readMode(row, tankProfile),
    cylinders: nativeCylinders(native, cylinders),
    salinity: nativeSalinity(native) ?? 'salt',
    surfacePressureBar: native?.settings.surfacePressureBar,
    computer: base.computer,
    source: { format: 'shearwater-cloud', file: fileName, importedAt },
    weightKg: num(row.Weight),
    suit: str(row.Dress),
    annotations: Object.keys(annotations).length ? annotations : undefined,
    reported: Object.keys(reported).length ? reported : undefined,
    tags: readTags(row),
    events: nativeEvents(native),
    samples: native?.samples ?? [],
  };

  // La profondità massima del blocco di chiusura è quella che il computer ha
  // visto campionando al secondo: è più precisa del massimo dei campioni salvati
  // ogni 10 s, che può mancare il picco di qualche decimetro.
  if (native?.maxDepth) dive.maxDepth = round1(Math.max(native.maxDepth, dive.maxDepth));
  if (native?.durationS) dive.durationS = native.durationS;

  dive.metrics = computeMetrics(dive);
  if (dive.avgDepth === undefined) {
    warnings.push(`Immersione del ${base.startTime.slice(0, 10)} senza profondità media: consumo non calcolabile.`);
  }
  return dive;
}

// ---------------------------------------------------------------------------

/**
 * I valori che il computer ha calcolato dai campioni, non ricavati da noi.
 * Restano in `Dive.reported` per non mescolarsi con le nostre metriche.
 */
function readReported(calc: Record<string, unknown> | undefined, row: SqlRow): ReportedSummary {
  const out: ReportedSummary = {};
  const gf = num(calc?.EndGF99);
  if (gf !== undefined && gf > 0) out.gf99End = Math.round(gf);

  const deco = num(calc?.MaxDecoObligation);
  if (deco !== undefined && deco >= 0) out.maxDecoObligationS = Math.round(deco * 60);

  const ndl = num(calc?.MinNDL);
  // 99 è il valore di fondo scala del computer: significa "non ci siamo mai
  // avvicinati al limite", non "il limite era 99 minuti". Registrarlo come dato
  // darebbe l'impressione di una misura dove non c'è.
  if (ndl !== undefined && ndl > 0 && ndl < 99) out.minNdlS = Math.round(ndl * 60);

  const sac = str(row.AverageSAC);
  if (sac) out.avgSac = sac;
  return out;
}

function readCylinders(row: SqlRow, tankProfile: Record<string, unknown> | undefined): Cylinder[] {
  const gasProfiles = asArray(tankProfile?.GasProfiles);
  const tankData = asArray(tankProfile?.TankData);
  const sizeL = parseTankSize(str(row.TankSize));

  const out: Cylinder[] = [];
  const count = Math.max(gasProfiles.length, tankData.length);
  for (let i = 0; i < count; i++) {
    const gas = (gasProfiles[i] ?? asRecord(tankData[i]?.GasProfile)) as Record<string, unknown> | undefined;
    const tank = tankData[i];
    const o2 = num(gas?.O2Percent);
    const he = num(gas?.HePercent);
    out.push({
      sizeL: i === 0 ? sizeL : undefined,
      // Le pressioni sono in PSI anche quando tutto il resto è metrico, e il
      // numero arriva come testo con la virgola o il punto decimale secondo la
      // lingua dell'applicazione: "2900,75" e "3335.87" nello stesso database.
      startBar: psiTextToBar(str(tank?.StartPressurePSI) ?? str(row.Tank1PressureStart)),
      endBar: psiTextToBar(str(tank?.EndPressurePSI) ?? str(row.Tank1PressureEnd)),
      mix: { o2: o2 !== undefined ? o2 / 100 : AIR.o2, he: he !== undefined ? he / 100 : 0 },
    });
  }
  if (out.length === 0) {
    out.push({
      sizeL,
      startBar: psiTextToBar(str(row.Tank1PressureStart)),
      endBar: psiTextToBar(str(row.Tank1PressureEnd)),
      mix: AIR,
    });
  }
  return out;
}

/** `"2900,75"` e `"3335.87"` sono entrambi PSI: 200 e 230 bar. */
export function psiTextToBar(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.');
  const v = Number(cleaned);
  if (!Number.isFinite(v) || v <= 0) return undefined;
  return Math.round(psiToBar(v));
}

/** `"15lt"`, `"15 lt"`, `"18lt"` → litri. */
export function parseTankSize(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = /(\d+(?:[.,]\d+)?)/.exec(text);
  if (!m) return undefined;
  const v = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return undefined;
  // Se il testo parla di piedi cubi, il numero è volume di GAS e non d'acqua.
  if (/cu\s?ft|cf\b/i.test(text)) return Math.round(((v * 28.316846592) / 206.8) * 10) / 10;
  return v;
}

/** `"Peregrine[988B023F]#30 2026-5-31 11-0-58.swl"` → `"Peregrine"`. */
export function modelFromFileName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const m = /^([A-Za-z][A-Za-z0-9 ]*?)\s*\[/.exec(name.trim());
  return m ? m[1].trim() : undefined;
}

function readSite(row: SqlRow, native: PnfLog | undefined): Dive['site'] {
  const site = str(row.Site);
  const location = str(row.Location);
  const name = site ?? location;
  // Le coordinate arrivano dal GPS del computer (Tern, Peregrine TX e successivi):
  // sono di ingresso, che per un sito è il punto giusto. Un'immersione senza nome
  // ma con coordinate vale comunque la pena di essere geolocalizzata.
  const coords = native?.entry ?? native?.exit;
  if (!name) return coords ? { name: 'Posizione dal GPS del computer', lat: coords.lat, lon: coords.lon } : undefined;
  return {
    name,
    region: site && location ? location : undefined,
    lat: coords?.lat,
    lon: coords?.lon,
  };
}

// ---------------------------------------------------------------------------
// Il log nativo del computer
// ---------------------------------------------------------------------------

/**
 * Decodifica `data_bytes_1`, con la regola che un log illeggibile non fa perdere
 * l'immersione: si tiene ciò che dicono le colonne e si avvisa. Un archivio di
 * anni non deve diventare non importabile per un blob danneggiato.
 */
function readNativeLog(
  log: SqlRow | undefined,
  warnings: string[],
  when: string | undefined,
  eventCodes: Set<string>,
): PnfLog | undefined {
  const blob = log?.data_bytes_1;
  if (!(blob instanceof Uint8Array) || !isPnfBlob(blob)) return undefined;
  try {
    const decoded = decodePnfBlob(blob);
    // Gli avvisi che si ripetono identici su decine di immersioni vanno riassunti,
    // non elencati: sedici righe uguali seppelliscono quelle che contano.
    for (const note of decoded.notes) {
      const grouped = /^Eventi non documentati/.test(note);
      if (grouped) {
        // I codici visti si accumulano in un elenco unico: dire QUALI sono è
        // l'informazione utile, ripeterla per ogni immersione no.
        for (const code of note.match(/\d+/g) ?? []) eventCodes.add(code);
      }
      else warnings.push(`${when ?? 'Immersione'}: ${note}`);
    }
    return decoded;
  } catch (err) {
    warnings.push(
      `${when ?? 'Immersione'}: log nativo del computer non decodificabile (${
        err instanceof Error ? err.message : String(err)
      }). Restano i dati di riepilogo.`,
    );
    return undefined;
  }
}

/**
 * I segnalibri premuti sul computer durante l'immersione.
 *
 * Sono l'unico contenuto del profilo messo lì dal subacqueo e non da un sensore:
 * marcano l'istante in cui è successo qualcosa. Vale la pena portarli fino alla
 * scheda anche quando sono pochi.
 */
function nativeEvents(native: PnfLog | undefined): Dive['events'] {
  const marks = native?.bookmarks ?? [];
  if (!marks.length) return undefined;
  return marks.map((m) => ({
    t: m.t,
    bearing: m.bearing,
    label: m.value !== undefined && m.value !== 0 ? `segnalibro ${m.value}` : undefined,
  }));
}

/** Media sui soli campioni in acqua: è così che la calcola anche Shearwater. */
function nativeAvgDepth(native: PnfLog | undefined): number | undefined {
  const wet = (native?.samples ?? []).filter((s) => s.depth > 0);
  if (!wet.length) return undefined;
  return wet.reduce((a, s) => a + s.depth, 0) / wet.length;
}

function nativeMinTemp(native: PnfLog | undefined): number | undefined {
  const temps = (native?.samples ?? [])
    .filter((s) => s.depth > 0 && s.tempC !== undefined)
    .map((s) => s.tempC as number);
  return temps.length ? Math.min(...temps) : undefined;
}

/**
 * La modalità dichiarata dal computer batte quella dedotta dalla colonna
 * `Apparatus`, che è testo libero scritto a mano.
 */
function nativeMode(native: PnfLog | undefined): DiveMode | undefined {
  switch (native?.settings.mode) {
    case 'ccr':
    case 'ccr2':
      return 'ccr';
    case 'scr':
      return 'scr';
    case 'oc-tec':
    case 'oc-rec':
      return 'oc';
    case 'gauge':
    case 'ppo2':
      return 'gauge';
    case 'freedive':
      return 'freedive';
    default:
      return undefined;
  }
}

/**
 * L'acqua: il computer registra la densità IMPOSTATA, non quella misurata. 1000
 * è dolce; i valori intorno a 1020-1030 sono mare. Fra i due c'è
 * l'impostazione "EN13319", che i computer usano come compromesso: la
 * trattiamo come acqua salata perché è così che si comporta il calcolo.
 */
function nativeSalinity(native: PnfLog | undefined): Salinity | undefined {
  const density = native?.settings.waterDensity;
  if (density === undefined || density === 0) return undefined;
  return density <= 1005 ? 'fresh' : 'salt';
}

/**
 * Bombole: le pressioni del trasmettitore, quando c'è, sostituiscono quelle
 * inserite a mano — sono misurate. Le miscele del log sostituiscono quelle del
 * profilo gas perché sono quelle effettivamente respirate, nell'ordine che
 * `Sample.gasIndex` indicizza.
 */
function nativeCylinders(native: PnfLog | undefined, fallback: Cylinder[]): Cylinder[] {
  if (!native) return fallback;
  const gases = native.gases;
  if (!gases.length) return fallback;

  return gases.map((mix, i) => {
    const tank = native.tanks[i];
    const previous = fallback[i];
    return {
      ...previous,
      mix,
      sizeL: previous?.sizeL,
      startBar: tank?.startBar !== undefined ? Math.round(tank.startBar) : previous?.startBar,
      endBar: tank?.endBar !== undefined ? Math.round(tank.endBar) : previous?.endBar,
      workPressureBar:
        tank?.maxPressureBar && tank.maxPressureBar > 0
          ? Math.round(tank.maxPressureBar)
          : previous?.workPressureBar,
    };
  });
}

function readMode(row: SqlRow, tankProfile: Record<string, unknown> | undefined): DiveMode {
  const apparatus = (str(row.Apparatus) ?? '').toLowerCase();
  if (/rebreather|ccr|closed/.test(apparatus)) return 'ccr';
  if (/semi|scr/.test(apparatus)) return 'scr';
  // `CircuitMode` nei profili gas: 1 sui suoi dati, tutti a circuito aperto.
  // La corrispondenza per gli altri valori è una lettura naturale ma NON
  // verificata su file reali, quindi non la usiamo per contraddire `Apparatus`.
  const mode = num(asRecord(asArray(tankProfile?.GasProfiles)[0])?.CircuitMode);
  if (mode !== undefined && mode >= 2) return 'ccr';
  return 'oc';
}

/**
 * Le annotazioni del logbook che non hanno un campo nel modello canonico,
 * conservate con l'etichetta originale tradotta.
 */
function readAnnotations(row: SqlRow): Record<string, string> {
  const MAP: [keyof typeof row & string, string][] = [
    ['Environment', 'Ambiente'],
    ['Weather', 'Meteo'],
    ['Conditions', 'Condizioni'],
    ['Platform', 'Tipo di uscita'],
    ['Visibility', 'Visibilità'],
    ['Apparatus', 'Configurazione'],
    ['ThermalComfort', 'Comfort termico'],
    ['Workload', 'Carico di lavoro'],
    ['Problems', 'Problemi'],
    ['Malfunctions', 'Guasti'],
    ['Symptoms', 'Sintomi'],
    ['ExposureToAltitude', 'Esposizione in quota'],
    ['GasNotes', 'Note sul gas'],
    ['GearNotes', 'Note attrezzatura'],
  ];
  const out: Record<string, string> = {};
  for (const [key, label] of MAP) {
    const v = str(row[key]);
    if (v) out[label] = v;
  }
  return out;
}

function readTags(row: SqlRow): string[] {
  const raw = [str(row.Environment), str(row.Weather), str(row.Platform), str(row.Conditions)];
  return [...new Set(raw.filter((v): v is string => !!v).map((v) => v.toLowerCase()))];
}

/** `"22"`, `"23º"`, `"25º"` → gradi Celsius. */
export function parseTemperature(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = /(-?\d+(?:[.,]\d+)?)/.exec(text);
  if (!m) return undefined;
  const v = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(v)) return undefined;
  return /f\b|fahrenheit/i.test(text) ? Math.round((((v - 32) * 5) / 9) * 10) / 10 : v;
}

// ---------------------------------------------------------------------------

function parseJson(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  let text: string;
  if (typeof value === 'string') text = value;
  else if (value instanceof Uint8Array) text = new TextDecoder('utf-8').decode(value);
  else return undefined;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const v = Number(value.trim().replace(',', '.'));
    return Number.isFinite(v) ? v : undefined;
  }
  return undefined;
}

function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t.length ? t : undefined;
}

function joinNonEmpty(parts: (string | undefined)[], sep = ', '): string | undefined {
  const kept = parts.filter((p): p is string => !!p);
  return kept.length ? kept.join(sep) : undefined;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function roundOr(v: number | undefined, digits: number): number | undefined {
  if (v === undefined) return undefined;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
