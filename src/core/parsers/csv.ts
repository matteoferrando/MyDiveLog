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
import { parseCylinderSpec } from '../cylinders';
import { INTESTAZIONI_ESPORTATE } from '../export/csv';
import { feetToM, fahrenheitToC, isoFromParts, psiToBar, wallClockToIso } from '../units';
import { comeSta, type Traduci } from '../traduci';
import { diveIdFor } from '../dedupe';
import { computeMetrics } from '../analysis/metrics';
import type { DiveParser, ParseInput, ParseResult } from './types';

/** Alias di intestazione → campo canonico. Confronto normalizzato e case-insensitive. */
/**
 * GLI ALIAS DELLE COLONNE — i nostri, più quelli che scriviamo noi stessi.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL CSV CHE L'APPLICAZIONE ESPORTA, L'APPLICAZIONE NON LO SAPEVA RILEGGERE. ◄
 *
 * Misurato il 15 settembre 2026: esportare l'archivio in CSV e trascinarlo
 * nell'importazione dava **zero immersioni** e l'avviso «colonne ignorate
 * perché non riconosciute: Prof. max (m), Prof. media (m), T minima (°C)…».
 * L'esportazione scrive «Prof. max (m)»; qui sotto c'erano `max depth` e
 * `profondita max`, non `prof max`. Due elenchi di nomi per la stessa colonna,
 * scritti in due file diversi da due persone diverse in due momenti diversi.
 *
 * Adesso l'esportazione dichiara, colonna per colonna, quale campo del lettore
 * le corrisponde (`campo` in `export/csv.ts`), e quei nomi arrivano qui da soli.
 * Chi aggiunge una colonna all'esportazione la rende leggibile senza saperlo.
 *
 * Gli alias scritti a mano restano e vengono PRIMA: servono per i file degli
 * altri — Diving Log, MacDive, Subsurface, divelogs.de — che è il caso per cui
 * questo lettore esiste.
 */
const ALIAS_SCRITTI: Record<string, string[]> = {
  number: ['number', 'dive number', 'divenumber', 'no', 'n', 'numero', 'num', '#'],
  date: ['date', 'dive date', 'divedate', 'data', 'datum', 'date time', 'datetime', 'start time', 'start'],
  time: ['time', 'ora', 'start time', 'entry time', 'zeit'],
  duration: [
    'duration',
    'dive time',
    'divetime',
    'runtime',
    'durata',
    'tempo',
    'bottom time',
    'total time',
    'minutes',
  ],
  maxDepth: [
    'max depth',
    'maxdepth',
    'depth',
    'profondita max',
    'profondita massima',
    'profondita',
    'tiefe',
    'max. depth',
  ],
  avgDepth: ['avg depth', 'average depth', 'mean depth', 'profondita media'],
  site: ['site', 'dive site', 'divesite', 'location', 'place', 'sito', 'luogo', 'ort'],
  region: ['region', 'area', 'zona', 'regione', 'city'],
  country: ['country', 'paese', 'nazione', 'land'],
  buddy: ['buddy', 'partner', 'compagno', 'buddies'],
  notes: ['notes', 'note', 'comment', 'comments', 'remarks', 'description'],
  minTemp: [
    'min temp',
    'water temp',
    'temp',
    'temperature',
    'bottom temp',
    'temperatura',
    'temperatura acqua',
  ],
  airTemp: ['air temp', 'air temperature', 'temperatura aria'],
  startBar: [
    'start pressure',
    'pressure start',
    'tank start',
    'bar start',
    'pressione iniziale',
    'begin pressure',
  ],
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

/*
 * Costruito alla prima richiesta e non all'apertura del modulo: `normalise` è
 * dichiarato più in basso, e un `const` non si può usare prima della sua riga.
 * Il valore non cambia mai, quindi si calcola una volta e si tiene.
 */
let aliasCache: Record<string, string[]> | undefined;
function alias(): Record<string, string[]> {
  if (aliasCache) return aliasCache;
  aliasCache = Object.fromEntries(
    [...new Set([...Object.keys(ALIAS_SCRITTI), ...Object.keys(INTESTAZIONI_ESPORTATE)])].map(
      (campo) => [
        campo,
        [
          ...(ALIAS_SCRITTI[campo] ?? []),
          ...(INTESTAZIONI_ESPORTATE[campo] ?? []).map(normalise),
        ].filter((a, i, tutti) => a && tutti.indexOf(a) === i),
      ],
    ),
  );
  return aliasCache;
}

export const csvParser: DiveParser = {
  format: 'csv',
  label: 'CSV di riepilogo (foglio di calcolo, export logbook)',
  extensions: ['.csv', '.tsv', '.txt'],

  detect(input: ParseInput) {
    if (!input.text) return false;
    if (/^\s*</.test(input.text)) return false; // è XML
    /*
     * ► IL BACKUP DELL'APPLICAZIONE NON È UN CSV, E RIVENDICARLO È PEGGIO CHE
     *   NON RICONOSCERLO. ◄
     *
     * `SyncPage` scrive il backup con `JSON.stringify` compatto: **una riga
     * sola**, lunghissima, che contiene `"durationS":`, `"maxdepth":`,
     * `"notes":` e altre trenta parole che `resolveField` riconosce come
     * intestazioni. Tre bastavano: il file veniva rivendicato da questo lettore
     * e usciva «CSV senza righe di dati», zero immersioni.
     *
     * Misurato il 15 settembre 2026 trascinando nell'importazione il backup che
     * l'applicazione stessa aveva appena scritto — che è precisamente il gesto
     * che la pagina dei computer suggerisce di fare.
     */
    if (/^\s*\{\s*"[a-zA-Z]+"\s*:/.test(input.text)) return false;
    const testa = intestazioneCsv(input.text);
    if (!testa) return false;
    const headers = splitRow(testa, detectDelimiter(testa)).map(normalise);
    return headers.filter((h) => resolveField(h) !== undefined).length >= 3;
  },

  parse(input: ParseInput, t: Traduci = comeSta): ParseResult {
    const warnings: string[] = [];
    const text = (input.text ?? '').replace(/^﻿/, '');
    /*
     * I RECORD SI SPEZZANO SAPENDO CHE LE VIRGOLETTE ESISTONO.
     *
     * Era `text.split(/\r?\n/)`, che non sa niente di virgolette: una nota su
     * due righe — prevista da RFC 4180 e normale negli export di logbook —
     * spezzava il record in due, la seconda metà finiva fra le righe scartate e
     * compariva un avviso su una riga che nel file non esiste. Misurato il 15
     * settembre 2026.
     */
    const tutte = righeCsv(text).filter((l) => l.trim().length > 0);
    /*
     * ► L'INTESTAZIONE NON È PER FORZA LA PRIMA RIGA. ◄
     *
     * Il CSV che questa stessa applicazione esporta comincia con `sep=;` — la
     * riga che dice a Excel quale separatore usare — e non si rileggeva:
     * «formato non riconosciuto» su un file scritto da noi, cinque minuti
     * prima. Diving Log e MacDive ci mettono spesso un titolo. Si cercano le
     * prime righe finché non se ne trova una che somigli a un'intestazione.
     */
    const inizio = tutte.findIndex((riga, i) => i < 5 && somigliaAIntestazione(riga));
    const lines = inizio > 0 ? tutte.slice(inizio) : tutte;
    if (lines.length < 2) return { format: 'csv', dives: [], warnings: [t('CSV senza righe di dati.')] };

    const delim = detectDelimiter(lines[0]);
    const rawHeaders = splitRow(lines[0], delim);
    const fields = rawHeaders.map((h) => resolveField(normalise(h)));
    // Vedi `unitaDellIntestazione`: «Max Depth (ft)» dice l'unità una volta sola,
    // in cima alla colonna, e ogni cella sotto la eredita.
    const unitaColonna = rawHeaders.map(unitaDellIntestazione);
    const imperiali = rawHeaders.filter((_, i) => unitaColonna[i] !== undefined);
    if (imperiali.length) {
      warnings.push(
        `${t("Unità dichiarate nell'intestazione e applicate a tutta la colonna:")} ${imperiali.join(', ')}.`,
      );
    }

    const unmapped = rawHeaders.filter((_, i) => fields[i] === undefined);
    if (unmapped.length) {
      warnings.push(`${t('Colonne ignorate perché non riconosciute:')} ${unmapped.slice(0, 8).join(', ')}.`);
    }
    if (!fields.includes('date')) {
      return {
        format: 'csv',
        dives: [],
        warnings: [...warnings, t('Nessuna colonna di data riconosciuta.')],
      };
    }

    const importedAt = new Date().toISOString();
    const dives: Dive[] = [];
    const scartate: number[] = [];

    for (let ln = 1; ln < lines.length; ln++) {
      const cells = splitRow(lines[ln], delim);
      const row: Record<string, string> = {};
      fields.forEach((f, i) => {
        if (!f || cells[i] === undefined || cells[i] === '') return;
        const unita = unitaColonna[i];
        row[f] = unita && !cellaHaUnita(cells[i]) ? `${cells[i]} ${unita}` : cells[i];
      });

      const dive = rowToDive(row, input.fileName, importedAt);
      if (dive) dives.push(dive);
      else scartate.push(ln + 1 + inizio);
    }
    /*
     * ► GLI AVVISI HANNO UN TETTO, E IL NUMERO DI RIGA È QUELLO DEL FILE. ◄
     *
     * Prima ogni riga scartata produceva il suo avviso, e il numero di riga era
     * contato sull'elenco GIÀ ripulito dalle righe vuote — un file con un buco
     * a metà diceva «riga 2» per un problema alla riga 5. Un CSV da cinquantamila
     * righe illeggibili produceva cinquantamila avvisi, 3.3 MB di testo, e la
     * schermata di importazione li disegnava tutti dentro una cella di tabella.
     *
     * Adesso: una riga sola con il conteggio e i primi numeri, e i numeri sono
     * quelli che si leggono aprendo il file.
     */
    if (scartate.length) {
      const primi = scartate.slice(0, 10).join(', ');
      warnings.push(
        `${scartate.length} ${t('righe scartate: data, durata o profondità non interpretabili.')} ` +
          `${t('Righe')}: ${primi}${scartate.length > 10 ? '…' : ''}`,
      );
    }

    if (dives.length) {
      warnings.push(
        `${dives.length} ${t('immersioni importate senza profilo: statistiche di consumo e assetto non disponibili per queste.')}`,
      );
    }
    return { format: 'csv', dives, warnings };
  },
};

// ---------------------------------------------------------------------------

function rowToDive(row: Record<string, string>, fileName: string, importedAt: string): Dive | null {
  const startTime = parseDateTime(row.date, row.time);
  // Un secondo di durata minima e ventiquattro ore di massima; mezzo metro e
  // 350, che è oltre il record mondiale in circuito aperto. Vedi `plausibile`.
  const durationS = plausibile(parseDurationCell(row.duration), 1, 86_400);
  const maxDepth = plausibile(parseMeasure(row.maxDepth, 'depth'), 0.5, 350);
  if (!startTime || !durationS || !maxDepth) return null;
  // L'anno: dal 1900 — la subacquea con l'autorespiratore comincia nel 1943 — a
  // uno in avanti, per chi ha l'orologio del computer avanti di qualche mese.
  const anno = new Date(startTime).getUTCFullYear();
  if (!(anno >= 1900 && anno <= new Date().getUTCFullYear() + 1)) return null;

  const o2 = parsePercent(row.o2);
  const he = parsePercent(row.he);
  // Aria più elio non possono superare il tutto: se lo fanno, la miscela non si
  // è capita e vale di più dirlo che indovinare.
  const miscelaCredibile = (o2 ?? 0) + (he ?? 0) <= 1;
  const cylinder: Cylinder = {
    // «AL80» non è una misura: vedi `core/cylinders.ts`. `parseNumber` ne
    // avrebbe ricavato 80 litri, sette volte il volume vero.
    sizeL: parseCylinderSpec(row.tankSize)?.sizeL,
    // Zero bar è una bombola vuota e capita; 500 è oltre qualunque bombola.
    startBar: plausibile(parseMeasure(row.startBar, 'pressure'), 0, 500),
    endBar: plausibile(parseMeasure(row.endBar, 'pressure'), 0, 500),
    mix: miscelaCredibile ? { o2: o2 ?? AIR.o2, he: he ?? 0 } : AIR,
  };

  const base = { startTime, maxDepth, durationS };
  const dive: Dive = {
    id: diveIdFor(base),
    number: parseNumber(row.number),
    startTime,
    durationS,
    maxDepth,
    avgDepth: parseMeasure(row.avgDepth, 'depth'),
    // L'acqua liquida sta fra −2 °C (mare polare) e 40 °C; l'aria arriva a 55.
    minTempC: plausibile(parseMeasure(row.minTemp, 'temp'), -2, 40),
    airTempC: plausibile(parseMeasure(row.airTemp, 'temp'), -40, 55),
    site: row.site ? { name: row.site, region: row.region, country: row.country } : undefined,
    buddy: row.buddy,
    notes: row.notes,
    /*
     * ► ZAVORRA E MUTA ERANO RICONOSCIUTE E POI BUTTATE. ◄ Gli alias ci sono
     * fra le colonne (`weight`/`zavorra`/`piombo`, `suit`/`muta`/`exposure`) e
     * il modello ha i campi, ma `rowToDive` non li scriveva. E siccome le
     * colonne venivano **riconosciute**, non finivano nemmeno nell'avviso
     * «colonne ignorate perché non riconosciute»: sparivano in silenzio, che è
     * peggio di non averle mai capite.
     */
    /*
     * ► LA ZAVORRA PASSAVA DA `parseNumber`, CHE L'UNITÀ NON LA GUARDA. ◄ Il
     * file dichiara «Weight (lbs)», l'applicazione RISPONDE all'utente «Unità
     * dichiarate nell'intestazione e applicate a tutta la colonna: Weight
     * (lbs)», e poi 14 libbre entravano in archivio come 14 chili. Una promessa
     * scritta a schermo e non mantenuta è peggio di nessuna promessa: chi la
     * legge smette di controllare. Sono 6.4 kg diventati 14, cioè il doppio del
     * piombo su ogni immersione di uno storico importato.
     */
    weightKg: parseMeasure(row.weight, 'weight'),
    suit: row.suit,
    mode: 'oc',
    cylinders: [cylinder],
    salinity: 'salt',
    source: { format: 'csv', file: fileName, importedAt },
    rating: plausibile(parseNumber(row.rating), 0, 5),
    // Stessa storia della zavorra, e con lo stesso avviso a schermo: il campo si
    // chiama `visibilityM`, quindi «Visibility (ft)» va convertita come
    // qualunque altra profondità. 30 piedi salvati come 30 metri non sono un
    // arrotondamento: sono tre volte la visibilità vera.
    visibilityM: parseMeasure(row.visibility, 'depth'),
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

/**
 * Spezza il testo in RECORD, non in righe: un a capo dentro le virgolette non
 * chiude il record.
 *
 * `splitRow` le virgolette le conosce già, ma lavora su una riga sola — e a
 * quel punto il danno è fatto. RFC 4180 prevede il campo su più righe, e le
 * note di un logbook lo usano di continuo.
 */
export function righeCsv(text: string): string[] {
  const out: string[] = [];
  let corrente = '';
  let dentro = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // `""` dentro un campo quotato è una virgoletta letterale, non la fine.
      if (dentro && text[i + 1] === '"') {
        corrente += '""';
        i++;
        continue;
      }
      dentro = !dentro;
      corrente += c;
    } else if (!dentro && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      out.push(corrente);
      corrente = '';
    } else {
      corrente += c;
    }
  }
  out.push(corrente);
  return out;
}

/**
 * Questa riga può essere l'intestazione di un CSV di immersioni?
 *
 * Tre colonne riconosciute: la stessa soglia di `detect`, e la stessa ragione —
 * due sole capitano per caso in un titolo qualunque, tre no.
 */
export function somigliaAIntestazione(riga: string): boolean {
  if (!riga.trim() || /^sep=./i.test(riga.trim())) return false;
  const celle = splitRow(riga, detectDelimiter(riga)).map(normalise);
  return celle.filter((h) => resolveField(h) !== undefined).length >= 3;
}

/** La prima riga che somiglia a un'intestazione, fra le prime cinque. */
export function intestazioneCsv(text: string): string | undefined {
  const righe = righeCsv(text.replace(/^\ufeff/, ''))
    .filter((l) => l.trim().length > 0)
    .slice(0, 5);
  return righe.find(somigliaAIntestazione);
}

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
    .replace(/[[\]().]/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * L'unità dichiarata NELL'INTESTAZIONE, quando la cella non ce l'ha.
 *
 * IL DIFETTO CHE CHIUDE. `parseMeasure` cercava l'unità solo dentro la cella,
 * mentre `resolveField` l'unità l'aveva già vista — è proprio grazie a «max
 * depth ft» che riconosce la colonna. Un export imperiale con le unità in
 * intestazione (la forma normale in Diving Log, MacDive, divelogs.de) entrava
 * tutto in metrico **senza un solo avviso**: 98 piedi diventavano 98 metri,
 * 3000 psi diventavano 3000 bar, 52 °F diventavano 52 °C e il consumo usciva a
 * 613 L/min.
 *
 * La cella eredita l'unità dell'intestazione solo se non ne porta una sua: una
 * colonna «Depth (ft)» con dentro «12 m» resta 12 metri, perché il valore
 * scritto accanto al numero è più specifico dell'etichetta della colonna.
 */
export function unitaDellIntestazione(header: string): string | undefined {
  const h = normalise(header);
  if (/\b(ft|feet|piedi)\b/.test(h)) return 'ft';
  if (/\bpsi\b/.test(h)) return 'psi';
  /*
   * ► LE LIBBRE NON ERANO NELL'ELENCO, E L'AVVISO LO DICEVA LO STESSO. ◄
   * «Weight (lbs)» è la forma normale di un export imperiale, ma qui dentro non
   * c'era nessuna riga che la riconoscesse: la colonna non entrava fra le
   * `imperiali`, quindi l'avviso «unità dichiarate nell'intestazione e applicate
   * a tutta la colonna» nemmeno la nominava — e la cella arrivava a
   * `parseMeasure` senza unità, cioè come chili. Il numero restava lo stesso e
   * cambiava di significato: 14 libbre di piombo diventavano 14 chili.
   */
  if (/\b(lb|lbs|libbre)\b/.test(h)) return 'lb';
  if (/\b(f|fahrenheit)\b/.test(h)) return '°F';
  return undefined;
}

/** Vero se la cella dichiara già un'unità sua. */
function cellaHaUnita(cella: string): boolean {
  return /[a-z°]/i.test(cella.replace(/[eE](?=[+-]?\d)/g, ''));
}

function resolveField(header: string): string | undefined {
  for (const [field, aliases] of Object.entries(alias())) {
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
  for (const [field, aliases] of Object.entries(alias())) {
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

/**
 * Un chilo in libbre. Sta qui e non in `core/units.ts` perché le libbre entrano
 * nell'applicazione in un punto solo: la colonna della zavorra di un foglio
 * imperiale. È il valore esatto della libbra internazionale, non un'approssimazione.
 */
const LB_TO_KG = 0.45359237;

/** Riconosce l'unità nella cella e converte: "60 ft" → 18.3, "3000 psi" → 207, "14 lbs" → 6.4. */
function parseMeasure(
  raw: string | undefined,
  kind: 'depth' | 'pressure' | 'temp' | 'weight',
): number | undefined {
  if (!raw) return undefined;
  const value = parseNumber(raw);
  if (value === undefined) return undefined;
  const lower = raw.toLowerCase();
  if (kind === 'depth') return /ft|feet|piedi/.test(lower) ? round1(feetToM(value)) : round1(value);
  if (kind === 'pressure') return /psi/.test(lower) ? Math.round(psiToBar(value)) : Math.round(value);
  // `\b` in coda e non `lbs?`: senza, «14 lb» starebbe dentro «14 lbs» ma anche
  // dentro una parola qualunque che cominci per lb.
  if (kind === 'weight') return /\blbs?\b|libbre/.test(lower) ? round1(value * LB_TO_KG) : round1(value);
  return /°?\s*f\b|fahrenheit/.test(lower) ? round1(fahrenheitToC(value)) : round1(value);
}

export function parseNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ► `1e9` DIVENTAVA 19, E NON ERA UN RIFIUTO: ERA UNA SOSTITUZIONE. ◄
   *
   * `raw.replace(/[^\d.,-]/g, '')` cancella ogni lettera, e la `e` della
   * notazione scientifica è una lettera. Misurato il 15 settembre 2026:
   *
   *   "1e9"    → 19        "3.05e1" → 3.051     "1.4E5" → 1.45
   *   "0x1F"   → 1         "2e-3"   → undefined
   *
   * Una cella `1e9` nelle colonne di durata e profondità produceva
   * **un'immersione di 19 minuti a 19 metri**, importata senza un avviso.
   * Non un valore scartato: un valore plausibile messo al posto di uno assurdo,
   * che è il modo più efficace di far entrare un dato falso in un archivio.
   *
   * E il codice sapeva che la notazione scientifica esiste: `cellaHaUnita` la
   * riconosce apposta con `/[eE](?=[+-]?\d)/`. Sapeva, e la distruggeva due
   * funzioni più in là.
   *
   * ADESSO: si estrae il numero con una espressione che la notazione
   * scientifica la contempla, e se dopo il numero resta qualcosa che non è
   * un'unità di misura si restituisce `undefined` — perché una cella che non si
   * è capita è un dato mancante, e un dato mancante si dichiara.
   */
  const testo = raw.trim();
  const m = /^[^\d+-]*([+-]?(?:\d[\d.,]*)(?:[eE][+-]?\d+)?)/.exec(testo);
  if (!m) return undefined;
  const grezzo = m[1];
  // Accetta sia "18.3" sia "18,3", ma non confonde "1,234" con "1.234".
  const normalised =
    grezzo.includes(',') && !grezzo.includes('.') ? grezzo.replace(',', '.') : grezzo.replace(/,/g, '');
  const v = Number(normalised);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * I VALORI CHE NON POSSONO ESISTERE — un filtro di plausibilità, una volta sola.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Il solo controllo che c'era, in `rowToDive`, era
 * `if (!startTime || !durationS || !maxDepth) return null` — e un numero
 * negativo è *truthy*. Misurato il 15 settembre 2026, tutto accettato senza un
 * avviso: durata −2400 s, profondità −30.5 m, temperatura −273 °C, pressione
 * −200 bar, voto 99 su 5, anno 9999.
 *
 * E la miscela non aveva tetto: `parsePercent` fa `v > 1 ? v/100 : v`, quindi
 * un refuso `3200` diventava una frazione di **32**, cioè il 3200% di ossigeno.
 * Il motore decompressivo si difende — sostituisce aria — ma l'esposizione
 * all'ossigeno no: lo stesso file con `o2=2100` dava CNS 70.4% e OTU 2470
 * invece di 10.9% e 28.7.
 *
 * Gli intervalli sono larghi apposta: devono lasciar passare tutto quello che
 * un subacqueo può aver fatto davvero, e fermare solo quello che non è un
 * dato — un campo vuoto letto come zero, una virgola fuori posto, una colonna
 * scambiata.
 */
export function plausibile(
  v: number | undefined,
  min: number,
  max: number,
): number | undefined {
  return v !== undefined && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
}

function parsePercent(raw: string | undefined): number | undefined {
  const v = parseNumber(raw);
  if (v === undefined) return undefined;
  const frazione = v > 1 ? v / 100 : v;
  // Oltre il 100% non è una miscela: è un refuso. Vedi `plausibile`.
  return plausibile(frazione, 0, 1);
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
