/**
 * Scubapro LogTRAK (`.logtrak`).
 *
 * Il file è JSON — checksum, versione, un array `dives`, l'attrezzatura e i siti
 * — ma il profilo di profondità NON è nel JSON: sta in `diveLogBase64`, un blob
 * binario nel formato Uwatec Smart, decodificato da `uwatecSmart.ts`.
 *
 * Da qui la struttura di questo parser: legge tutto quello che può dal JSON, che
 * è leggibile e affidabile, e usa il blob solo per il profilo e per la
 * profondità media. Se un blob è illeggibile l'immersione entra comunque in
 * archivio con i suoi dati di sintesi, con un avviso: perdere il profilo è un
 * peccato, perdere l'immersione è un danno.
 *
 * Cosa il JSON dà e i formati concorrenti spesso no:
 *  - il VOLUME della bombola (`size: "l_15"`), che sblocca il consumo in L/min;
 *  - la zavorra in chilogrammi;
 *  - l'offset del fuso orario, quindi l'ora vera dell'immersione;
 *  - condizioni, valutazione, note e nomi dei compagni.
 *
 * Cosa non c'è, e non va inventato: nessun dato di decompressione (né tetto, né
 * NDL, né tempo in deco) esiste nel formato Uwatec Smart — verificato sull'intero
 * elenco dei tipi di record. Le immersioni con obbligo deco vanno riconosciute
 * dal profilo, non dal file.
 */

import {
  AIR,
  type Cylinder,
  type Dive,
  type DiveConditions,
  type DiveMode,
  type Sample,
  type Waves,
  type Weather,
} from '../model';
import { diveIdFor } from '../dedupe';
import { parseCylinderSpec } from '../cylinders';
import { computeMetrics } from '../analysis/metrics';
import {
  decodeUwatecSmart,
  trimSurface,
  uwatecModelName,
  uwatecSamplesToCanonical,
  type UwatecDive,
} from './uwatecSmart';
import type { DiveParser, ParseInput, ParseResult } from './types';

export const logtrakParser: DiveParser = {
  format: 'logtrak',
  label: 'Scubapro LogTRAK (.logtrak)',
  extensions: ['.logtrak', '.json'],

  detect(input: ParseInput) {
    if (!input.text) return false;
    const head = input.text.slice(0, 4000);
    if (!head.trimStart().startsWith('{')) return false;
    // Firma del formato: le tre chiavi insieme non compaiono altrove.
    return /"dives"\s*:/.test(head) && (/"diveLogBase64"/.test(input.text) || /"diveSites"\s*:/.test(head));
  },

  parse(input: ParseInput): ParseResult {
    const warnings: string[] = [];
    let root: LogtrakFile;
    try {
      root = JSON.parse(input.text ?? '') as LogtrakFile;
    } catch (err) {
      return {
        format: 'logtrak',
        dives: [],
        warnings: [`JSON non valido: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
    if (!Array.isArray(root.dives)) {
      return { format: 'logtrak', dives: [], warnings: ['Nessun array "dives" nel file.'] };
    }

    const importedAt = new Date().toISOString();
    const sites = new Map((root.diveSites ?? []).map((s) => [s.id, s]));
    const computers = new Map((root.equipment?.diveComputers ?? []).map((c) => [c.id, c]));

    // LogTRAK non esporta il numero progressivo dell'immersione: lo assegniamo
    // in ordine cronologico, che è quello che un logbook cartaceo riporta.
    const ordered = [...root.dives].sort(
      (a, b) => Date.parse(a.startTime ?? '') - Date.parse(b.startTime ?? ''),
    );

    const dives: Dive[] = [];
    let profileFailures = 0;
    let withoutProfile = 0;

    ordered.forEach((raw, i) => {
      const dive = readDive(raw, i + 1, sites, computers, input.fileName, importedAt, warnings);
      if (!dive) return;
      if (!raw.diveLogBase64) withoutProfile++;
      else if ((dive.samples?.length ?? 0) === 0) profileFailures++;
      dives.push(dive);
    });

    if (withoutProfile > 0) {
      warnings.push(
        `${withoutProfile} immersioni non hanno il profilo nel file (LogTRAK non lo esporta per le immersioni inserite a mano): restano i dati di sintesi.`,
      );
    }
    if (profileFailures > 0) {
      warnings.push(
        `${profileFailures} profili non decodificabili: le immersioni sono state importate senza profilo.`,
      );
    }
    if (dives.length === 0) warnings.push('Nessuna immersione valida nel file LogTRAK.');
    return { format: 'logtrak', dives, warnings };
  },
};

// ---------------------------------------------------------------------------

function readDive(
  raw: LogtrakDive,
  number: number,
  sites: Map<string, LogtrakSite>,
  computers: Map<string, LogtrakComputer>,
  fileName: string,
  importedAt: string,
  warnings: string[],
): Dive | null {
  if (!raw.startTime) return null;
  const startMs = Date.parse(raw.startTime);
  if (Number.isNaN(startMs)) return null;

  const endMs = raw.endTime ? Date.parse(raw.endTime) : NaN;
  let durationS = Number.isNaN(endMs) ? 0 : Math.round((endMs - startMs) / 1000);

  // --- profilo -----------------------------------------------------------
  let decoded: UwatecDive | undefined;
  let samples: Sample[] = [];
  if (raw.diveLogBase64) {
    try {
      const bytes = base64ToBytes(raw.diveLogBase64);
      decoded = decodeUwatecSmart(bytes, { model: raw.deviceTypeNumber ?? deviceModel(raw, computers) });
      samples = uwatecSamplesToCanonical(trimSurface(decoded.samples));
      for (const w of decoded.warnings) {
        if (!warnings.includes(w)) warnings.push(w);
      }
      if (decoded.durationS > 0) durationS = decoded.durationS;
    } catch (err) {
      warnings.push(
        `Profilo del ${raw.startTime.slice(0, 10)} illeggibile (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
  }

  const maxDepth = raw.depthMetersMax ?? decoded?.maxDepth ?? 0;
  if (!maxDepth || !durationS) return null;

  // --- bombole -----------------------------------------------------------
  const cylinders = readCylinders(raw, decoded);

  // --- sito --------------------------------------------------------------
  const site = readSite(raw, sites);

  const computer = computers.get(raw.diveComputerId ?? '');
  const firstTank = (raw.tankData ?? {})['tank1'];
  const base = {
    startTime: new Date(startMs).toISOString(),
    maxDepth: round1(maxDepth),
    durationS,
    computer: {
      model: computer ? prettyModel(computer) : undefined,
      serial: computer?.serialNumber,
      deviceId: computer?.serialNumber,
      // `raw.id` è l'identificativo LogTRAK dell'immersione: chiave di dedup forte.
      diveId: raw.id,
      firmware: computer?.swVersion,
      hwVersion: computer?.hwVersion,
      // I limiti di PPO2 stanno nei dati della bombola, non del computer, ma sono
      // un'impostazione del computer: è lui che allarma quando li supera.
      ppo2MaxBar: firstTank?.maxPp02Limit ?? undefined,
      ppo2MinBar: firstTank?.minPp02Limit ?? undefined,
    },
  };

  /*
   * Meteo e mare vanno nel loro campo, non fra i tag.
   *
   * Prima finivano in `tags` come etichette italiane: si vedevano e non si
   * contavano. `conditions` è la stessa informazione in una forma che si può
   * raggruppare — «consumo di più col mare agitato?» diventa una domanda con
   * una risposta. I tag restano quello che dovevano essere: le etichette che
   * ci metti tu.
   *
   * Quello che LogTRAK non sa dire resta un tag, così non si perde.
   */
  const conditions: DiveConditions = {};
  const tags: string[] = [];
  const meteo = raw.conditionWeather ? WEATHER_FROM_LOGTRAK[raw.conditionWeather] : undefined;
  if (meteo) conditions.weather = meteo;
  else if (raw.conditionWeather) tags.push(conditionLabel(raw.conditionWeather));
  const mare = raw.conditionWaves ? WAVES_FROM_LOGTRAK[raw.conditionWaves] : undefined;
  if (mare) conditions.waves = mare;
  else if (raw.conditionWaves) tags.push(conditionLabel(raw.conditionWaves));

  const dive: Dive = {
    id: diveIdFor(base),
    number,
    startTime: base.startTime,
    utcOffsetMinutes: raw.utcDifferenceMinutes ?? decoded?.utcOffsetMinutes,
    durationS,
    maxDepth: base.maxDepth,
    avgDepth: decoded?.avgDepth,
    minTempC: raw.waterTempCelsiusMin ?? decoded?.tempMinC,
    airTempC: decoded?.tempSurfaceC,
    site,
    /*
     * Compagno e guida in due campi, perché il file li tiene già separati.
     *
     * Finché finivano nella stessa stringa, «con chi mi immergo di solito» e
     * «chi mi ha portato» erano indistinguibili — ed è LogTRAK l'unica sorgente
     * che possiede il dato. Il campo `guide` è stato aggiunto proprio per
     * questo, e per un giro è rimasto vuoto mentre il dato passava di lì.
     */
    buddy: (raw.buddyNames ?? []).join(', ') || undefined,
    guide: (raw.guideNames ?? []).join(', ') || undefined,
    notes: raw.notes || undefined,
    mode: modeFor(raw, decoded),
    cylinders,
    salinity: raw.saltwaterCalibrated === false ? 'fresh' : (decoded?.salinity ?? 'salt'),
    computer: base.computer,
    source: { format: 'logtrak', file: fileName, importedAt },
    rating: raw.rating,
    visibilityM: raw.conditionVisibility ?? undefined,
    conditions: conditions.weather || conditions.waves ? conditions : undefined,
    weightKg: raw.weight,
    tags,
    samples,
  };

  dive.metrics = computeMetrics(dive);
  // La media dell'intestazione è più precisa di quella ricalcolata dal profilo
  // ritagliato, quindi la teniamo quando c'è; altrimenti vale quella calcolata.
  if (dive.avgDepth === undefined) dive.avgDepth = dive.metrics.avgDepth;
  return dive;
}

// ---------------------------------------------------------------------------

function readCylinders(raw: LogtrakDive, decoded: UwatecDive | undefined): Cylinder[] {
  const out: Cylinder[] = [];
  const tanks = raw.tankData ?? {};
  for (let i = 1; i <= 10; i++) {
    const t = tanks[`tank${i}`];
    if (!t) continue;
    const mix = decoded?.gasMixes.find((g) => g.index === i - 1);
    // Il JSON esprime le miscele in percentuale, il blob in frazione: qui si
    // converge su frazione. Il JSON ha la precedenza perché è quello che l'utente
    // vede e corregge in LogTRAK.
    const o2 = t.o2Mixture != null ? t.o2Mixture / 100 : (mix?.o2 ?? AIR.o2);
    const he = t.heMixture != null ? t.heMixture / 100 : (mix?.he ?? 0);
    out.push({
      description: tankDescription(t),
      sizeL: parseTankSize(t.size),
      material: tankMaterial(t.type),
      startBar: t.startPressure ?? mix?.startBar,
      endBar: t.endPressure ?? mix?.endBar,
      mix: { o2, he },
    });
  }
  if (out.length === 0 && decoded?.gasMixes.length) {
    for (const g of decoded.gasMixes) {
      out.push({ sizeL: undefined, startBar: g.startBar, endBar: g.endBar, mix: { o2: g.o2, he: g.he } });
    }
  }
  if (out.length === 0) out.push({ mix: AIR });
  return out;
}

/**
 * `"steel"`, `"alu"` → materiale della bombola.
 *
 * Serve al ragionamento sull'assetto: una bombola in alluminio da 12 L diventa
 * positiva di circa 2 kg quando si svuota, una in acciaio resta negativa. Se
 * l'oscillazione peggiora nella seconda metà dell'immersione, il materiale è una
 * delle prime cose da guardare.
 */
function tankMaterial(type: string | null | undefined): 'steel' | 'alu' | 'carbon' | undefined {
  const t = (type ?? '').toLowerCase();
  if (t.includes('steel') || t.includes('acciaio')) return 'steel';
  if (t.includes('alu') || t.includes('allum')) return 'alu';
  if (t.includes('carbon')) return 'carbon';
  return undefined;
}

/** `"l_15"` → 15 litri · `"cuft_80"` → 11.1 litri. */
export function parseTankSize(size: string | null | undefined): number | undefined {
  if (!size) return undefined;
  const m = /^(l|cuft|cf)_?(\d+(?:[.,]\d+)?)$/i.exec(size.trim());
  if (!m) {
    /*
     * IL RIPIEGO NON PUÒ ESSERE «TIENI LE CIFRE E BUTTA IL RESTO».
     *
     * Lo era, e su «S80» restituiva **80 litri**: sette volte il volume vero,
     * senza un avviso, e da lì ogni consumo calcolato su quella immersione era
     * sette volte più basso. Ora la stringa passa dal traduttore vero, che le
     * sigle le conosce e su quelle che non conosce non inventa niente.
     */
    return parseCylinderSpec(String(size))?.sizeL;
  }
  const value = Number(m[2].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  // Le bombole imperiali sono dichiarate in piedi cubi di gas a pressione di
  // lavoro (207 bar per una alluminio da 80): il volume d'acqua è un'altra cosa.
  if (/^c/i.test(m[1])) return round1((value * 28.316846592) / 206.8);
  return round1(value);
}

function tankDescription(t: LogtrakTank): string | undefined {
  const size = parseTankSize(t.size);
  const type = t.type === 'steel' ? 'acciaio' : t.type === 'alu' ? 'alluminio' : undefined;
  if (size === undefined && !type) return undefined;
  return [size !== undefined ? `${size} L` : undefined, type].filter(Boolean).join(' ');
}

function readSite(raw: LogtrakDive, sites: Map<string, LogtrakSite>): Dive['site'] {
  const fromId = raw.diveSiteId ? sites.get(raw.diveSiteId) : undefined;
  // Il `label` è il titolo che l'utente ha dato all'immersione, tipicamente
  // "Posto, Punto". Quando il sito non è collegato è la fonte migliore che c'è:
  // meglio il nome che l'utente ha scritto che nessun nome.
  const name = fromId?.name ?? raw.diveSiteName ?? raw.label ?? undefined;
  if (!name) return undefined;
  const lat = raw.locationLat ?? fromId?.lat ?? undefined;
  const lng = raw.locationLng ?? fromId?.lng ?? undefined;
  return {
    name: normaliseSiteName(name),
    lat: typeof lat === 'number' ? lat : undefined,
    lon: typeof lng === 'number' ? lng : undefined,
  };
}

/**
 * LogTRAK conserva le maiuscole così come sono state digitate, quindi lo stesso
 * posto compare come "RECCO, Gonzatti" e "Recco, Torretta". Normalizziamo le
 * parole tutte maiuscole, altrimenti le statistiche per sito li contano separati.
 */
export function normaliseSiteName(name: string): string {
  return name
    .trim()
    .split(/(\s*[,\-–]\s*)/)
    .map((part) =>
      /^[A-ZÀ-Ü'\s]+$/.test(part) && part.trim().length > 2
        ? part
            .toLowerCase()
            .replace(/(^|\s|')(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
        : part,
    )
    .join('');
}

function modeFor(raw: LogtrakDive, decoded: UwatecDive | undefined): DiveMode {
  if (decoded?.mode === 'freedive' || raw.diveMode === 'freediving' || raw.diveMode === 'apnea') {
    return 'freedive';
  }
  if (decoded?.mode === 'gauge' || raw.diveMode === 'gauge') return 'gauge';
  if (raw.diveMode === 'ccr' || raw.diveMode === 'rebreather') return 'ccr';
  return 'oc';
}

function deviceModel(raw: LogtrakDive, computers: Map<string, LogtrakComputer>): number | undefined {
  const c = computers.get(raw.diveComputerId ?? '');
  return c?.deviceTypeNumber;
}

function prettyModel(c: LogtrakComputer): string {
  // La tabella sta in `uwatecSmart.ts` perché la usa anche lo scarico via
  // Bluetooth: se i due producessero nomi diversi per lo stesso computer, la
  // stessa immersione arrivata dalle due strade non si riconoscerebbe.
  return uwatecModelName(c.deviceTypeNumber, c.deviceType ?? c.name ?? undefined);
}

/** I codici di LogTRAK, verso i nostri. Quello che non c'è resta un tag. */
const WEATHER_FROM_LOGTRAK: Record<string, Weather | undefined> = {
  sunny: 'sunny',
  cloudy: 'cloudy',
  overcast: 'overcast',
  rainy: 'rainy',
  snowy: 'snowy',
  windy: 'windy',
  foggy: 'fog',
};

const WAVES_FROM_LOGTRAK: Record<string, Waves | undefined> = {
  calm: 'calm',
  moderately: 'moderate',
  moderate: 'moderate',
  rough: 'rough',
  veryRough: 'veryRough',
};

const CONDITION_LABEL: Record<string, string> = {
  sunny: 'sole',
  cloudy: 'nuvoloso',
  overcast: 'coperto',
  rainy: 'pioggia',
  snowy: 'neve',
  calm: 'mare calmo',
  moderately: 'mare mosso',
  rough: 'mare agitato',
};

const conditionLabel = (v: string) => CONDITION_LABEL[v] ?? v;

/** Base64 → byte, funziona sia nel browser sia in Node. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  if (typeof atob === 'function') {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node: Buffer è un Uint8Array, ma normalizziamo la vista per sicurezza.
  const buf = (globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer?.from(
    clean,
    'base64',
  );
  if (!buf) throw new Error('Nessun decodificatore base64 disponibile.');
  return new Uint8Array(buf);
}

const round1 = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// Forma del file, descritta al minimo necessario.
// ---------------------------------------------------------------------------

interface LogtrakTank {
  o2Mixture?: number | null;
  heMixture?: number | null;
  startPressure?: number | null;
  endPressure?: number | null;
  size?: string | null;
  type?: string | null;
  /** Limiti di PPO2 impostati sul computer, bar. */
  maxPp02Limit?: number | null;
  minPp02Limit?: number | null;
  /**
   * Integrale della pressione ambiente nel tempo, in unità non documentate: sul
   * suo archivio vale circa 1046 mbar per campione da 4 s contro i 1000 attesi,
   * cioè coincide col nostro integrale entro il 5%. Non viene usato proprio per
   * questo: uno scarto del 5% su un dato che serve a calcolare il consumo non è
   * abbastanza per fidarsi, e il profilo dà lo stesso numero senza incertezze.
   */
  aggregatedAmbientPressure?: number | null;
}

interface LogtrakDive {
  id?: string;
  label?: string | null;
  notes?: string | null;
  rating?: number;
  weight?: number;
  buddyNames?: string[];
  guideNames?: string[];
  startTime?: string;
  endTime?: string;
  utcDifferenceMinutes?: number;
  depthMetersMax?: number;
  waterTempCelsiusMin?: number;
  waterTempCelsiusMax?: number;
  diveMode?: string;
  saltwaterCalibrated?: boolean;
  diveComputerId?: string | null;
  /** Presente in alcune varianti del file; altrimenti si risale dall'attrezzatura. */
  deviceTypeNumber?: number;
  diveSiteId?: string | null;
  diveSiteName?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  conditionWeather?: string | null;
  conditionWaves?: string | null;
  conditionVisibility?: number | null;
  diveLogBase64?: string | null;
  tankData?: Record<string, LogtrakTank | null>;
}

interface LogtrakSite {
  id: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
}

interface LogtrakComputer {
  id: string;
  name?: string;
  serialNumber?: string;
  swVersion?: string;
  hwVersion?: string;
  deviceType?: string;
  deviceTypeNumber?: number;
}

interface LogtrakFile {
  version?: number;
  dives?: LogtrakDive[];
  diveSites?: LogtrakSite[];
  equipment?: { diveComputers?: LogtrakComputer[] };
}
