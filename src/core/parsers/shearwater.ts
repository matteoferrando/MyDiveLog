/**
 * Shearwater XML (export "XML" di Shearwater Cloud Desktop).
 *
 * Struttura: `/dive/diveLog` con un blocco di intestazione e
 * `diveLogRecords/diveLogRecord` per i campioni.
 *
 * Le unità di Shearwater sono la parte insidiosa e sono la ragione per cui
 * questo parser è lungo:
 *
 *  - `imperialUnits` è un flag che decide COME leggere profondità e temperatura
 *    nello stesso file. Ignorarlo significa registrare 30 m come 30 ft.
 *  - `startSurfacePressure` è in MILLIBAR, non bar.
 *  - `tank0pressurePSI` è in MEZZI PSI: il valore va moltiplicato per 2 prima di
 *    convertirlo. Il fattore 2 non è nel nome del campo ed è documentato solo
 *    nell'XSLT di Subsurface.
 *  - `currentTime` non ha unità documentate. Invece di indovinare, la ricaviamo
 *    dal passo mediano fra campioni (vedi `detectTimeScale`): un passo di 10000
 *    sono millisecondi, uno di 10 sono secondi.
 *
 * Per l'export CSV di Shearwater non esiste documentazione pubblica delle
 * intestazioni, quindi non lo supportiamo: l'XML e l'UDDF hanno identificatori
 * stabili e sono la strada giusta.
 */

import { AIR, type Cylinder, type Dive, type DiveMode, type GasMix, type Sample } from '../model';
import { fahrenheitToC, feetToM, mbarToBar, shearwaterTankToBar, wallClockToIso } from '../units';
import { diveIdFor } from '../dedupe';
import { computeMetrics } from '../analysis/metrics';
import { comeSta, type Traduci } from '../traduci';
import { child, children, num, parseXmlSalvando, text } from './xml';
import { conDettaglio } from '../ble/causaGuasto';
import type { DiveParser, ParseInput, ParseResult } from './types';

export const shearwaterParser: DiveParser = {
  format: 'shearwater-xml',
  label: 'Shearwater Cloud (export XML)',
  extensions: ['.xml'],

  detect(input: ParseInput) {
    return !!input.text && /<diveLog[\s>]/.test(input.text);
  },

  parse(input: ParseInput, t: Traduci = comeSta): ParseResult {
    const warnings: string[] = [];
    /*
     * IL FILE POTREBBE ESSERE TRONCATO, e in quel caso si salva il salvabile
     * invece di perdere tutto. Vedi `parseXmlSalvando`: taglia all'ultima
     * `</diveLog>` chiusa bene e richiude i tag rimasti aperti.
     */
    let root: Record<string, unknown>;
    try {
      const letto = parseXmlSalvando(input.text ?? '', 'diveLog');
      root = letto.root;
      if (letto.tagliato) {
        warnings.push(
          t(
            'Il file finisce a metà: sono state lette le immersioni complete, quelle dopo il punto di rottura no. Riesportalo dal programma che l’ha scritto.',
          ),
        );
      }
    } catch (err) {
      /*
       * Il motivo grezzo della libreria — «readTagExp returned undefined at
       * position 742510» — non dice niente a chi legge, e prima finiva a
       * schermo tale e quale accanto al nome del file. `conDettaglio` lo tiene
       * per il diario e mostra la frase umana.
       */
      return {
        format: 'shearwater-xml',
        dives: [],
        warnings: [
          conDettaglio(t('Questo file non è un XML leggibile: sembra incompleto o danneggiato.'), err),
        ],
      };
    }
    const importedAt = new Date().toISOString();

    // Un file può contenere un solo <dive> o una raccolta.
    const logs = [
      ...children(child(root, 'dive'), 'diveLog'),
      ...children(root, 'diveLog'),
      ...children(child(root, 'dives'), 'diveLog'),
    ];

    const dives: Dive[] = [];
    for (const log of logs) {
      const dive = readLog(log, input.fileName, importedAt, warnings, t);
      if (dive) dives.push(dive);
    }
    // Il nome del tag XML è per chi scrive il parser; a schermo vale la stessa
    // forma degli altri lettori: si dice che cosa non si è trovato, non dove.
    if (dives.length === 0) warnings.push(t('Nessuna immersione valida trovata nel file Shearwater.'));
    return { format: 'shearwater-xml', dives, warnings };
  },
};

// ---------------------------------------------------------------------------

function readLog(
  log: unknown,
  fileName: string,
  importedAt: string,
  warnings: string[],
  t: Traduci = comeSta,
): Dive | null {
  const imperial = (num(child(log, 'imperialUnits')) ?? 0) === 1;
  const depth = (v: number | undefined) => (v === undefined ? undefined : imperial ? feetToM(v) : v);
  const temp = (v: number | undefined) => (v === undefined ? undefined : imperial ? fahrenheitToC(v) : v);

  const startDate = text(child(log, 'startDate'));
  if (!startDate) {
    warnings.push(t('Un’immersione del file è stata saltata: manca la data.'));
    return null;
  }
  const startTime = parseShearwaterDate(startDate);
  if (!startTime) {
    // Si scarta con un avviso, come per lo `startDate` mancante qui sopra e
    // come fa `uddf.ts` per la stessa ragione: senza questo ramo l'immersione
    // entrava con la data del 1970 e si fondeva con le sue vicine.
    warnings.push(
      `${t('Immersione scartata: data')} «${startDate}» ${t('in un formato che non so leggere.')} ` +
        t(
          'Shearwater scrive «2026-06-14 10:38:00»: se il tuo file la scrive altrimenti, riesportalo dall’applicazione di origine.',
        ),
    );
    return null;
  }

  const records = children(child(log, 'diveLogRecords'), 'diveLogRecord');
  const timeScale = detectTimeScale(records.map((r) => num(child(r, 'currentTime'))));
  if (timeScale === null && records.length > 2) {
    warnings.push(
      t('Passo di campionamento Shearwater non riconosciuto: i tempi sono interpretati come secondi.'),
    );
  }
  const divisor = timeScale ?? 1;

  // Prima passata: censimento delle miscele usate, per costruire la lista bombole.
  const mixKey = (m: GasMix) => `${Math.round(m.o2 * 100)}/${Math.round(m.he * 100)}`;
  const mixOrder: GasMix[] = [];
  const mixIndex = new Map<string, number>();
  for (const r of records) {
    const mix = readMix(r);
    if (!mix) continue;
    const key = mixKey(mix);
    if (!mixIndex.has(key)) {
      mixIndex.set(key, mixOrder.length);
      mixOrder.push(mix);
    }
  }
  const cylinders: Cylinder[] = (mixOrder.length ? mixOrder : [AIR]).map((mix) => ({ mix }));

  let ppo2NeedsScaling = false;
  const samples: Sample[] = [];
  for (const r of records) {
    const rawTime = num(child(r, 'currentTime'));
    const d = depth(num(child(r, 'currentDepth')));
    if (rawTime === undefined || d === undefined) continue;

    const mix = readMix(r);
    const gasIndex = mix ? mixIndex.get(mixKey(mix)) : undefined;

    const tank0 = num(child(r, 'tank0pressurePSI'));
    const tank1 = num(child(r, 'tank1pressurePSI'));
    const pressures: (number | undefined)[] = [];
    if (tank0 !== undefined && tank0 > 0) pressures[0] = round1(shearwaterTankToBar(tank0));
    if (tank1 !== undefined && tank1 > 0) pressures[1] = round1(shearwaterTankToBar(tank1));

    const rawPpo2 = num(child(r, 'averagePPO2'));
    let ppo2: number | undefined;
    if (rawPpo2 !== undefined && rawPpo2 > 0) {
      // `imperialUnits` governa profondità e temperatura, NON questo campo: una
      // pressione parziale è in bar (o bar×100) qualunque sia l'unità del resto
      // del file. Convertirla da PSI dava 8.96 bar su un'immersione a 1.30, e
      // siccome è oltre il limite di deco l'app emetteva un allarme critico di
      // ossigeno su un'immersione perfettamente regolare.
      if (rawPpo2 > 3) {
        // Valori sopra 3 bar sono impossibili: il campo è scalato ×100.
        ppo2 = rawPpo2 / 100;
        ppo2NeedsScaling = true;
      } else ppo2 = rawPpo2;
    }

    const stopDepth = depth(num(child(r, 'firstStopDepth')));
    const ceiling = depth(num(child(r, 'decoCeiling')));

    samples.push({
      t: Math.round(rawTime / divisor),
      depth: round1(d),
      tempC: roundOrUndef(temp(num(child(r, 'waterTemp'))), 1),
      pressureBar: pressures.length ? pressures : undefined,
      ndlS: minutesToSeconds(num(child(r, 'currentNdl'))),
      stopDepth,
      stopTimeS: minutesToSeconds(num(child(r, 'firstStopTime'))),
      ceiling: ceiling && ceiling > 0 ? ceiling : undefined,
      /*
       * ► DUE CAMPI SEPARATI, E SI LEGGEVA QUELLO SBAGLIATO. ◄
       *
       * Shearwater esporta `decoCeiling` e `firstStopDepth` distinti perché
       * sono cose distinte: il primo è **l'obbligo**, il secondo è **la prima
       * sosta che il computer propone** — e quella la propone anche quando
       * obbligo non ce n'è, per la sosta di sicurezza e per la sosta profonda,
       * se è attivata. Il tetto qui sopra lo prende già da `decoCeiling`; era
       * `inDeco` a prendersi l'altro.
       *
       * La conseguenza si vedeva nella scheda: **«Tempo in deco»** contava
       * minuti in cui il computer non aveva imposto niente.
       */
      inDeco: (ceiling ?? 0) > 0,
      cns: num(child(r, 'CNSPercent')),
      ppo2: roundOrUndef(ppo2, 2),
      gasIndex,
    });
  }
  if (ppo2NeedsScaling) {
    // A schermo si dice il RISULTATO, non il fattore: che il numero sia in bar
    // è tutto quello che serve per fidarsi della colonna PPO2 nella scheda.
    warnings.push(t('Le PPO2 di questo file sono state riportate in bar.'));
  }

  const maxDepth =
    depth(num(child(log, 'maxDepth'))) ??
    (samples.length ? Math.max(...samples.map((s) => s.depth)) : undefined);
  const durationS =
    normaliseDuration(num(child(log, 'maxTime')), samples) ??
    (samples.length ? samples[samples.length - 1]!.t : undefined);

  if (durationS && profiloTroncato(durationS, samples)) {
    warnings.push(
      t(
        'Il profilo di almeno un’immersione finisce prima della fine dichiarata, e in profondità: il file potrebbe essere incompleto.',
      ),
    );
  }

  if (!maxDepth || !durationS) {
    // Spezzata perché una chiave con la data dentro sarebbe una voce di
    // dizionario diversa per ogni immersione. Vale per tutte quelle che seguono.
    warnings.push(
      `${t('Immersione Shearwater del')} ${startDate} ${t('scartata: durata o profondità mancanti.')}`,
    );
    return null;
  }

  const circuit = records.length ? num(child(records[0], 'currentCircuitSetting')) : undefined;
  const mode: DiveMode = circuit !== undefined && circuit > 0 ? 'ccr' : 'oc';

  const base = {
    startTime,
    maxDepth: round1(maxDepth),
    durationS: Math.round(durationS),
    computer: {
      model: text(child(log, 'computerModel')) ?? text(child(log, 'product')),
      serial: text(child(log, 'computerSerial')),
      deviceId: text(child(log, 'computerSerial')),
      diveId: text(child(log, 'number')),
      firmware: text(child(log, 'computerFirmware')),
      decoModel: text(child(log, 'decoModel')),
      gfLow: num(child(log, 'gfMin')),
      gfHigh: num(child(log, 'gfMax')),
    },
  };

  const dive: Dive = {
    id: diveIdFor(base),
    number: num(child(log, 'number')),
    startTime,
    durationS: base.durationS,
    maxDepth: base.maxDepth,
    minTempC: minOf(samples.map((s) => s.tempC)),
    mode,
    cylinders,
    salinity: 'salt',
    surfacePressureBar: roundOrUndef(mapDefined(num(child(log, 'startSurfacePressure')), mbarToBar), 3),
    computer: base.computer,
    source: { format: 'shearwater-xml', file: fileName, importedAt },
    tags: [],
    samples,
  };
  /*
   * ► LE BOMBOLE SI RIEMPIONO **PRIMA** DELLE METRICHE. ◄
   *
   * Erano invertite: `computeMetrics` girava sulle bombole ancora senza
   * pressioni e poi le pressioni arrivavano. Le metriche salvate non erano
   * quelle della scheda che veniva salvata — `endPressureBar` 60.3 invece di
   * 60, `sacBarPerMin` 3.8 invece di 3.81 — e non è il mezzo decimale il
   * problema: è che `repairArchive` confronta le metriche salvate col
   * ricalcolo, quindi **ogni immersione Shearwater XML era candidata a essere
   * riscritta** al primo avvio che trovasse un altro motivo per ricalcolare.
   *
   * *Un lettore che produce una scheda le cui metriche non sono le sue è un
   * lettore che non è idempotente, e l'archivio se ne accorge da solo.*
   */
  cylinders.forEach((cyl, i) => {
    const values = samples
      .map((s) => s.pressureBar?.[i])
      .filter((p): p is number => p !== undefined && p > 0);
    if (values.length >= 2) {
      cyl.startBar = Math.round(values[0]!);
      cyl.endBar = Math.round(values[values.length - 1]!);
    }
  });

  dive.metrics = computeMetrics(dive);
  dive.avgDepth = dive.metrics.avgDepth;

  return dive;
}

// ---------------------------------------------------------------------------

/**
 * Ricava il fattore di scala del campo `currentTime` dal passo fra campioni.
 * Shearwater campiona a 2 / 5 / 10 / 20 / 30 / 60 s: se il passo mediano è
 * 10000 il campo è in millisecondi, se è 10 in secondi.
 * Restituisce il divisore per ottenere secondi, o `null` se non riconosciuto.
 */
export function detectTimeScale(raw: (number | undefined)[]): number | null {
  const values = raw.filter((v): v is number => v !== undefined && Number.isFinite(v));
  if (values.length < 3) return 1;
  const deltas: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d > 0) deltas.push(d);
  }
  if (deltas.length === 0) return 1;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)]!;

  const plausibleIntervals = [1, 2, 5, 10, 15, 20, 30, 60];
  for (const divisor of [1, 1000]) {
    const seconds = median / divisor;
    if (plausibleIntervals.some((i) => Math.abs(seconds - i) < 0.51)) return divisor;
  }
  return null;
}

/**
 * `maxTime` non dichiara l'unità: si deduce dal profilo.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO CHIUSO IL 15 SETTEMBRE 2026: QUARANTA MINUTI DIVENTAVANO
 *   QUARANTA SECONDI. ◄
 *
 * La regola era una sola: se l'ultimo campione (in secondi) sta fra 30 e 90
 * volte `maxTime`, allora `maxTime` è in minuti. Funziona — finché il profilo
 * c'è tutto. Ma si appoggia proprio alla cosa che manca quando il file è
 * troncato: con sessanta record su duecentoquarantuno, l'ultimo campione sta a
 * 590 secondi, il rapporto con 40 vale 14.75, e l'immersione entrava in archivio
 * **con durata 40 secondi** e profondità 30 metri. Senza un avviso. E con un
 * identificativo diverso da quella intera, quindi affiancata all'originale
 * invece che riconosciuta.
 *
 * La regola nuova non deduce: **osserva un'impossibilità.** `maxTime` è la
 * durata totale dell'immersione; non può essere più corta dell'istante
 * dell'ultimo campione registrato. Se letta in secondi lo è, in secondi non è.
 *
 * Il caso intero continua a passare dalla prima regola, che resta la primaria
 * perché è quella validata sugli export veri; la seconda copre solo i casi in
 * cui la prima non si pronuncia.
 */
function normaliseDuration(maxTime: number | undefined, samples: Sample[]): number | undefined {
  if (maxTime === undefined || maxTime <= 0) return undefined;
  if (samples.length === 0) return maxTime;
  const lastT = samples[samples.length - 1]!.t;
  if (lastT <= 0) return maxTime;
  const ratio = lastT / maxTime;
  if (ratio > 30 && ratio < 90) return Math.round(maxTime * 60); // maxTime in minuti
  // Letto in secondi sarebbe più corto del profilo che descrive: impossibile.
  if (maxTime < lastT) return Math.round(maxTime * 60);
  return Math.round(maxTime);
}

/**
 * Il profilo finisce prima della fine dell'immersione, e per giunta in
 * profondità: il file è quasi certamente incompleto, e va detto.
 *
 * `uddf.ts` emette da mesi lo stesso avviso per la stessa ragione; qui mancava,
 * e un'immersione troncata entrava in archivio con l'aria di una intera.
 */
function profiloTroncato(durationS: number, samples: Sample[]): boolean {
  if (samples.length === 0) return false;
  const ultimo = samples[samples.length - 1]!;
  // Trenta secondi di tolleranza: molti computer smettono di registrare poco
  // prima dell'emersione, e quello non è un file troncato.
  return ultimo.t < durationS - 30 && ultimo.depth > 2;
}

/** NDL e tempi di sosta Shearwater sono in minuti. */
const minutesToSeconds = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 60));

function readMix(record: unknown): GasMix | undefined {
  const o2 = num(child(record, 'fractionO2'));
  const he = num(child(record, 'fractionHe'));
  if (o2 === undefined) return undefined;
  // Il campo si chiama "fraction" ma è salvato in percentuale.
  return {
    o2: o2 > 1 ? o2 / 100 : o2,
    he: he === undefined ? 0 : he > 1 ? he / 100 : he,
  };
}

/**
 * "2026-06-14 10:38:00" o ISO. `undefined` se non è nessuna delle due.
 *
 * Shearwater scrive la lettura dell'orologio senza fuso: fissata su UTC per non
 * far dipendere l'istante dal fuso della macchina. Vedi `wallClockToIso`.
 *
 * ► PERCHÉ NON C'È PIÙ UN RIPIEGO. ◄
 *
 * Qui c'era `?? new Date(0).toISOString()`, cioè il 1° gennaio 1970 per
 * qualunque data che `wallClockToIso` non riconosce — e ne riconosce una sola
 * forma, `YYYY-MM-DD…`: bastava un file con `08/11/2019 9:35:00 AM` o
 * `11.08.2019 09:35` per cadere sul ripiego, in silenzio e su TUTTE le
 * immersioni del file.
 *
 * Il danno non era la data sbagliata — è lo stesso difetto già chiuso in
 * `uddf.ts`, con le stesse parole: era che tutte le immersioni finivano allo
 * STESSO istante, e a quel punto la deduplica, che riconosce come la stessa
 * immersione due tuffi vicini nel tempo e simili per profondità e durata, ne
 * fondeva a due a due. Ogni gruppo di tuffi simili collassava in uno solo, e la
 * schermata di import diceva «duplicati» invece di dire che non aveva capito la
 * data.
 *
 * Un istante finto è peggio di un'immersione dichiaratamente illeggibile: la
 * seconda si vede e si segnala, il primo entra in archivio e ci resta.
 */
export function parseShearwaterDate(raw: string): string | undefined {
  return wallClockToIso(raw);
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function roundOrUndef(v: number | undefined, digits = 1): number | undefined {
  if (v === undefined) return undefined;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function mapDefined<T, R>(v: T | undefined, fn: (v: T) => R): R | undefined {
  return v === undefined ? undefined : fn(v);
}

function minOf(values: (number | undefined)[]): number | undefined {
  const nums = values.filter((v): v is number => v !== undefined);
  return nums.length ? Math.min(...nums) : undefined;
}
