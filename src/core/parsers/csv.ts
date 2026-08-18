/**
 * CSV generico di riepilogo.
 *
 * Non serve a leggere i profili: serve a recuperare uno storico. Chi ha tenuto
 * il logbook su un foglio di calcolo (o esporta il riepilogo da Diving Log,
 * MacDive, divelogs.de, Shearwater Cloud) ha una riga per immersione e nessun
 * campionamento. Meglio importarle senza profilo che perderle.
 *
 * Le intestazioni non sono standardizzate, quindi la mappatura è per alias:
 * "date", "Data", "Dive date", "Datum" finiscono tutte nello stesso campo.
 * L'export CSV di Shearwater NON è documentato pubblicamente nelle sue
 * intestazioni, quindi qui lo trattiamo come un CSV qualsiasi e ci affidiamo
 * agli alias — non a posizioni fisse di colonna.
 */

import { AIR, type Cylinder, type Dive } from '../model';
import { feetToM, fahrenheitToC, isoFromParts, psiToBar, wallClockToIso } from '../units';
import { diveIdFor } from '../dedupe';
import { computeMetrics } from '../analysis/metrics';
import type { DiveParser, ParseInput, ParseResult } from './types';

/** Alias di intestazione → campo canonico. Confronto normalizzato e case-insensitive. */
const ALIASES: Record<string, string[]> = {
  number: ['number', 'dive number', 'divenumber', 'no', 'n', 'numero', 'num', '#'],
  date: ['date', 'dive date', 'divedate', 'data', 'datum', 'date time', 'datetime', 'start time', 'start'],
  time: ['time', 'ora', 'start time', 'entry time', 'zeit'],
  duration: ['duration', 'dive time', 'divetime', 'runtime', 'durata', 'tempo', 'bottom time', 'total time', 'minutes'],
  maxDepth: ['max depth', 'maxdepth', 'depth', 'profondita max', 'profondita massima', 'profondita', 'tiefe', 'max. depth'],
  avgDepth: ['avg depth', 'average depth', 'mean depth', 'profondita media'],
  site: ['site', 'dive site', 'divesite', 'location', 'place', 'sito', 'luogo', 'ort'],
  region: ['region', 'area', 'zona', 'regione', 'city'],
  country: ['country', 'paese', 'nazione', 'land'],
  buddy: ['buddy', 'partner', 'compagno', 'buddies'],
  notes: ['notes', 'note', 'comment', 'comments', 'remarks', 'description'],
  minTemp: ['min temp', 'water temp', 'temp', 'temperature', 'bottom temp', 'temperatura', 'temperatura acqua'],
  airTemp: ['air temp', 'air temperature', 'temperatura aria'],
  startBar: ['start pressure', 'pressure start', 'tank start', 'bar start', 'pressione iniziale', 'begin pressure'],
  endBar: ['end pressure', 'pressure end', 'tank end', 'bar end', 'pressione finale'],
  tankSize: ['tank size', 'cylinder size', 'tank volume', 'volume', 'litri', 'bombola'],
  o2: ['o2', 'oxygen', 'ean', 'nitrox', 'o2 %', 'fo2'],
  he: ['he', 'helium', 'elio', 'fhe'],
  rating: ['rating', 'stars', 'voto'],
  visibility: ['visibility', 'viz', 'visibilita'],
  tags: ['tags', 'tag', 'type', 'tipo', 'etichette'],
  weight: ['weight', 'zavorra', 'piombo'],
  suit: ['suit', 'muta', 'exposure'],
};

export const csvParser: DiveParser = {
  format: 'csv',
  label: 'CSV di riepilogo (foglio di calcolo, export logbook)',
  extensions: ['.csv', '.tsv', '.txt'],

  detect(input: ParseInput) {
    if (!input.text) return false;
    if (/^\s*</.test(input.text)) return false; // è XML
    const firstLine = input.text.split(/\r?\n/, 1)[0] ?? '';
    const delim = detectDelimiter(firstLine);
    const headers = splitRow(firstLine, delim).map(normalise);
    return headers.filter((h) => resolveField(h) !== undefined).length >= 3;
  },

  parse(input: ParseInput): ParseResult {
    const warnings: string[] = [];
    const text = (input.text ?? '').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return { format: 'csv', dives: [], warnings: ['CSV senza righe di dati.'] };

    const delim = detectDelimiter(lines[0]);
    const rawHeaders = splitRow(lines[0], delim);
    const fields = rawHeaders.map((h) => resolveField(normalise(h)));

    const unmapped = rawHeaders.filter((_, i) => fields[i] === undefined);
    if (unmapped.length) {
      warnings.push(`Colonne ignorate perché non riconosciute: ${unmapped.slice(0, 8).join(', ')}.`);
    }
    if (!fields.includes('date')) {
      return { format: 'csv', dives: [], warnings: [...warnings, 'Nessuna colonna di data riconosciuta.'] };
    }

    const importedAt = new Date().toISOString();
    const dives: Dive[] = [];

    for (let ln = 1; ln < lines.length; ln++) {
      const cells = splitRow(lines[ln], delim);
      const row: Record<string, string> = {};
      fields.forEach((f, i) => {
        if (f && cells[i] !== undefined && cells[i] !== '') row[f] = cells[i];
      });

      const dive = rowToDive(row, input.fileName, importedAt);
      if (dive) dives.push(dive);
      else warnings.push(`Riga ${ln + 1} scartata: data, durata o profondità non interpretabili.`);
    }

    if (dives.length) {
      warnings.push(
        `${dives.length} immersioni importate senza profilo: statistiche di consumo e assetto non disponibili per queste.`,
      );
    }
    return { format: 'csv', dives, warnings };
  },
};

// ---------------------------------------------------------------------------

function rowToDive(row: Record<string, string>, fileName: string, importedAt: string): Dive | null {
  const startTime = parseDateTime(row.date, row.time);
  const durationS = parseDurationCell(row.duration);
  const maxDepth = parseMeasure(row.maxDepth, 'depth');
  if (!startTime || !durationS || !maxDepth) return null;

  const o2 = parsePercent(row.o2);
  const he = parsePercent(row.he);
  const cylinder: Cylinder = {
    description: row.suit ? undefined : undefined,
    sizeL: parseNumber(row.tankSize),
    startBar: parseMeasure(row.startBar, 'pressure'),
    endBar: parseMeasure(row.endBar, 'pressure'),
    mix: { o2: o2 ?? AIR.o2, he: he ?? 0 },
  };

  const base = { startTime, maxDepth, durationS };
  const dive: Dive = {
    id: diveIdFor(base),
    number: parseNumber(row.number),
    startTime,
    durationS,
    maxDepth,
    avgDepth: parseMeasure(row.avgDepth, 'depth'),
    minTempC: parseMeasure(row.minTemp, 'temp'),
    airTempC: parseMeasure(row.airTemp, 'temp'),
    site: row.site
      ? { name: row.site, region: row.region, country: row.country }
      : undefined,
    buddy: row.buddy,
    notes: row.notes,
    mode: 'oc',
    cylinders: [cylinder],
    salinity: 'salt',
    source: { format: 'csv', file: fileName, importedAt },
    rating: parseNumber(row.rating),
    visibilityM: parseNumber(row.visibility),
    tags: (row.tags ?? '')
      .split(/[,;|]/)
      .map((t) => t.trim())
      .filter(Boolean),
    samples: [],
  };
  dive.metrics = computeMetrics(dive);
  return dive;
}

// ---------------------------------------------------------------------------
// Lettura CSV
// ---------------------------------------------------------------------------

export function detectDelimiter(line: string): string {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const c of candidates) {
    const count = splitRow(line, c).length;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

/** Split che rispetta le virgolette e il raddoppio `""`. */
export function splitRow(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delim) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const normalise = (h: string) =>
  h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\[\]().]/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function resolveField(header: string): string | undefined {
  for (const [field, aliases] of Object.entries(ALIASES)) {
    if (aliases.includes(header)) return field;
  }
  // Corrispondenza parziale come ripiego: "maximum depth reached" non è un alias
  // esatto ma contiene "depth".
  //
  // Vince l'alias PIÙ LUNGO, non il primo dichiarato. Prima l'ordine decideva
  // tutto: `maxDepth` porta l'alias "depth" ed è dichiarato prima di `avgDepth`,
  // quindi "average depth (m)" finiva in `maxDepth` — e siccome nel giro delle
  // colonne l'ultima vince, la profondità massima veniva SOSTITUITA dalla media.
  // Stessa cosa per "air temp" che cadeva in `minTemp` (alias "temp"). Il dato
  // usciva sbagliato in silenzio, che è peggio di un dato mancante.
  let best: { field: string; length: number } | undefined;
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      if (a.length > 3 && header.includes(a) && (!best || a.length > best.length)) {
        best = { field, length: a.length };
      }
    }
  }
  return best?.field;
}

// ---------------------------------------------------------------------------
// Interpretazione dei valori
// ---------------------------------------------------------------------------

/** Riconosce l'unità nella cella e converte: "60 ft" → 18.3, "3000 psi" → 207. */
function parseMeasure(raw: string | undefined, kind: 'depth' | 'pressure' | 'temp'): number | undefined {
  if (!raw) return undefined;
  const value = parseNumber(raw);
  if (value === undefined) return undefined;
  const lower = raw.toLowerCase();
  if (kind === 'depth') return /ft|feet|piedi/.test(lower) ? round1(feetToM(value)) : round1(value);
  if (kind === 'pressure') return /psi/.test(lower) ? Math.round(psiToBar(value)) : Math.round(value);
  return /°?\s*f\b|fahrenheit/.test(lower) ? round1(fahrenheitToC(value)) : round1(value);
}

export function parseNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  // Accetta sia "18.3" sia "18,3", ma non confonde "1,234" con "1.234".
  const cleaned = raw.replace(/[^\d.,-]/g, '');
  if (!cleaned) return undefined;
  const normalised =
    cleaned.includes(',') && !cleaned.includes('.') ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  const v = Number(normalised);
  return Number.isFinite(v) ? v : undefined;
}

function parsePercent(raw: string | undefined): number | undefined {
  const v = parseNumber(raw);
  if (v === undefined) return undefined;
  return v > 1 ? v / 100 : v;
}

/** "45", "45 min", "0:45", "45:30" → secondi. */
export function parseDurationCell(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const clean = raw.trim();
  if (clean.includes(':')) {
    const parts = clean.split(':').map((p) => Number(p.replace(/[^\d]/g, '')));
    if (parts.some((n) => !Number.isFinite(n))) return undefined;
    // Su un logbook "45:30" sono 45 minuti e 30 secondi.
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  const v = parseNumber(clean);
  return v === undefined ? undefined : Math.round(v * 60);
}

/**
 * Date nei formati che i logbook usano davvero, in ordine di tentativo:
 * ISO, gg/mm/aaaa (europeo, il default per un utente italiano), gg.mm.aaaa.
 * Il formato americano mm/gg/aaaa è ambiguo con quello europeo: preferiamo
 * l'europeo e disambiguiamo solo quando il primo numero è > 12.
 */
export function parseDateTime(dateRaw: string | undefined, timeRaw?: string): string | undefined {
  if (!dateRaw) return undefined;
  const raw = dateRaw.trim();

  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (isoMatch) {
    const [, y, mo, d, h, mi, s] = isoMatch;
    return build(+y, +mo, +d, h ? +h : undefined, mi ? +mi : undefined, s ? +s : undefined, timeRaw);
  }

  const euMatch = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (euMatch) {
    const [, a, b, yRaw, h, mi, s] = euMatch;
    const year = yRaw.length === 2 ? 2000 + +yRaw : +yRaw;
    // Convenzione europea: giorno prima del mese. Ma se il SECONDO numero non può
    // essere un mese mentre il primo sì, la riga è americana e leggerla
    // all'europea la scarterebbe: 03/25/2025 diventava "mese 25" e finiva nel
    // cestino. Si ricade sull'altra lettura solo quando è l'unica possibile,
    // perché su 05/06 nessuna delle due è dimostrabile e la scelta dichiarata
    // resta l'europea.
    const american = +b > 12 && +a <= 12;
    const day = american ? +b : +a;
    const month = american ? +a : +b;
    return build(year, month, day, h ? +h : undefined, mi ? +mi : undefined, s ? +s : undefined, timeRaw);
  }

  return wallClockToIso(raw);
}

function build(
  y: number,
  mo: number,
  d: number,
  h: number | undefined,
  mi: number | undefined,
  s: number | undefined,
  timeRaw?: string,
): string | undefined {
  let hh = h ?? 0;
  let mm = mi ?? 0;
  let ss = s ?? 0;
  if (h === undefined && timeRaw) {
    const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(timeRaw.trim());
    if (t) {
      hh = +t[1];
      mm = +t[2];
      ss = t[3] ? +t[3] : 0;
    }
  }
  // In UTC e non nel fuso della macchina: un foglio di calcolo non porta il fuso,
  // e la stessa riga deve dare lo stesso istante su qualunque dispositivo.
  return isoFromParts(y, mo, d, hh, mm, ss);
}

const round1 = (v: number) => Math.round(v * 10) / 10;
