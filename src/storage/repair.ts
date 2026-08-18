/**
 * Riparazione dell'archivio all'avvio.
 *
 * PERCHÉ ESISTE. Le metriche di un'immersione vengono calcolate una volta e
 * salvate accanto ai dati, per non ricalcolare 700.000 campioni a ogni apertura.
 * Il rovescio della medaglia è che una correzione al calcolo — o alla fusione di
 * due fonti — non tocca ciò che è già in archivio: i numeri restano quelli
 * sbagliati fino a un reimport, e chiedere all'utente di reimportare per far
 * tornare un numero è una richiesta che non va fatta.
 *
 * Il caso reale che ha portato a questo file: la stessa immersione registrata da
 * un Aladin (volume e pressioni bombola, inseriti a mano) e da un Peregrine
 * (profilo con i dati di decompressione, nessuna pressione perché non ha il
 * trasmettitore). Le metriche erano state calcolate sulla versione Shearwater,
 * quindi la scheda mostrava la bombola 240 → 60 bar su 12 litri e, accanto,
 * "nessuna pressione bombola: consumo non calcolabile".
 *
 * COME È FATTA: cerca le incoerenze fra i dati e le metriche salvate, ricalcola
 * solo quelle immersioni, e riscrive solo quelle. Non è una migrazione di schema e
 * non ha un numero di versione: è idempotente e si può eseguire a ogni avvio,
 * perché quando non trova incoerenze non scrive niente. Un contatore di versione
 * avrebbe richiesto di ricordare quali correzioni sono già passate, e sarebbe
 * un'altra cosa che può andare fuori sincrono.
 */

import type { Dive } from '../core/model';
import { computeMetrics } from '../core/analysis/metrics';
import { chainArchive } from '../core/analysis/tissues';
import { dedupeComputers, sameComputer } from '../core/dedupe';
import type { DiveStore } from './types';

export interface RepairReport {
  /** Immersioni esaminate. */
  checked: number;
  /** Immersioni le cui metriche sono state ricalcolate e riscritte. */
  repaired: number;
  /** Motivi trovati, con quante immersioni per motivo. */
  reasons: Record<string, number>;
}

/**
 * Toglie dall'elenco degli altri computer quello che è già il principale.
 *
 * Serve a riparare gli archivi scritti da una versione in cui reimportare lo stesso
 * file spostava il computer principale nell'elenco senza riconoscere che era lo
 * stesso apparecchio: la scheda mostrava "Computer (3)" con il Peregrine due volte.
 */
export function dedupeDiveComputers(dive: Dive): Dive | null {
  const others = dive.otherComputers;
  if (!others?.length) return null;
  // DUE pulizie, non una. La prima toglie dall'elenco il computer principale. La
  // seconda deduplica l'elenco CONTRO SE STESSO: mancava, e bastava che lo stesso
  // computer finisse due volte fra gli "altri" — con un serial letto in un caso e
  // no nell'altro — perché la scheda mostrasse due volte lo stesso strumento
  // senza che niente lo correggesse.
  const withoutPrimary = others.filter((c) => !sameComputer(c, dive.computer));
  const cleaned = dedupeComputers(withoutPrimary);
  if (cleaned.length === others.length) return null;
  return { ...dive, otherComputers: cleaned.length ? cleaned : undefined };
}

/**
 * La pulizia che ogni immersione deve attraversare, da qualunque parte arrivi.
 *
 * Nasce da un bug che si è ripresentato dopo una sincronizzazione: l'import
 * puliva, la riparazione all'avvio puliva, ma quello che **scendeva dalla rete**
 * veniva scritto nell'archivio così com'era. Bastava che sull'altro capo ci fosse
 * la versione vecchia di un'immersione perché il difetto tornasse, e la
 * riparazione non poteva accorgersene: era già girata all'avvio.
 *
 * Restituisce l'immersione invariata quando non c'è niente da correggere, così
 * chi chiama può capire se qualcosa è cambiato confrontando i riferimenti.
 */
export function normaliseDive(dive: Dive): Dive {
  return dedupeDiveComputers(dive) ?? dive;
}

/**
 * Vero se le metriche salvate non sono coerenti con i dati dell'immersione.
 *
 * Ogni controllo corrisponde a un'incoerenza *osservabile*, non a un sospetto: se
 * il volume e le pressioni ci sono e il consumo manca, o le metriche sono state
 * calcolate su dati diversi da questi. Non si ricalcola "per sicurezza", perché
 * ricalcolare tutto a ogni avvio su un archivio grande costa secondi di attesa
 * all'apertura.
 */
export function inconsistencies(dive: Dive, sampleCount: number, altCount = 0): string[] {
  const reasons: string[] = [];
  const m = dive.metrics;
  const cyl = dive.cylinders?.[0];

  if (sampleCount > 2 && !m) {
    reasons.push('profilo presente ma nessuna metrica');
    return reasons;
  }
  if (!m) return reasons;

  const hasGasData =
    cyl?.sizeL !== undefined && cyl.startBar !== undefined && cyl.endBar !== undefined;
  if (hasGasData && m.rmvLpm === undefined && dive.avgDepth !== undefined) {
    reasons.push('volume e pressioni noti ma consumo assente');
  }
  if (cyl?.endBar !== undefined && m.endPressureBar === undefined) {
    reasons.push('pressione finale nota ma non nelle metriche');
  }
  // Il conteggio dei campioni nelle metriche deve corrispondere al profilo
  // effettivamente salvato: se non torna, le metriche vengono da un altro profilo.
  // `quality` è obbligatorio nel tipo, ma un documento scritto da una versione
  // diversa dell'app e arrivato via sincronizzazione può non averlo. Senza questa
  // guardia bastava UN record così a far cadere `repairArchive`, e siccome la
  // chiamata sta dentro un `catch` all'avvio, la conseguenza non era un errore
  // visibile: era che NESSUNA immersione dell'archivio veniva più riparata, per
  // sempre, in silenzio.
  if (sampleCount > 2 && m.quality === undefined) {
    reasons.push('metriche senza indicazione di qualità: probabilmente scritte da un’altra versione');
    return reasons;
  }
  if (sampleCount > 2 && m.quality.sampleCount !== sampleCount) {
    reasons.push(`metriche calcolate su ${m.quality.sampleCount} campioni invece di ${sampleCount}`);
  }
  // C'è un secondo profilo più fitto ma le velocità non sono state misurate su di
  // lui: l'assetto risulta più basso di quanto è, e le immersioni non sono
  // confrontabili fra loro.
  if (altCount > 2 && !m.quality.ratesFromAlt) {
    reasons.push('velocità misurate sul profilo rado mentre esiste quello fitto');
  }
  // Metriche calcolate prima che la formula esistesse. È il caso che la
  // riparazione non sapeva riconoscere: sa vedere le incoerenze strutturali, non
  // che il codice è cambiato. Finché ogni nuova grandezza si aggiunge qui, un
  // archivio vecchio si aggiorna da solo al primo avvio, senza reimportare.
  if (sampleCount > 2 && m.cnsPct === undefined) {
    reasons.push('esposizione all’ossigeno non ancora calcolata');
  }
  if (sampleCount > 2 && m.deepStopS === undefined) {
    reasons.push('soste profonde e forma del profilo non ancora analizzate');
  }
  return reasons;
}

/**
 * Ricalcola le metriche delle immersioni incoerenti.
 *
 * I profili si leggono uno per uno e solo per le immersioni sospette: caricarli
 * tutti per controllare vorrebbe dire leggere l'intero archivio a ogni avvio.
 */
export async function repairArchive(
  store: DiveStore,
  dives: Dive[],
): Promise<{ report: RepairReport; dives: Dive[] }> {
  const counts = await store.sampleCounts();
  const altCounts = await store.altSampleCounts();
  const report: RepairReport = { checked: dives.length, repaired: 0, reasons: {} };
  const updated: Dive[] = [];
  const out = [...dives];

  for (let i = 0; i < out.length; i++) {
    let dive = out[i];

    // Computer duplicati: correzione indipendente dalle metriche, e senza bisogno
    // di leggere il profilo.
    const deduped = dedupeDiveComputers(dive);
    if (deduped) {
      dive = deduped;
      out[i] = deduped;
      updated.push(deduped);
      report.reasons['computer principale duplicato nell’elenco'] =
        (report.reasons['computer principale duplicato nell’elenco'] ?? 0) + 1;
      report.repaired++;
    }

    const sampleCount = counts.get(dive.id) ?? dive.samples?.length ?? 0;
    const altCount = altCounts.get(dive.id) ?? dive.altSamples?.length ?? 0;
    const reasons = inconsistencies(dive, sampleCount, altCount);
    if (!reasons.length) continue;

    const samples = dive.samples?.length ? dive.samples : await store.getSamples(dive.id);
    const altSamples = dive.altSamples?.length ? dive.altSamples : await store.getAltSamples(dive.id);
    // Se le metriche erano state calcolate sul secondo profilo — quello più fitto —
    // e quel profilo qui non c'è (per esempio su un dispositivo che ha ricevuto
    // l'immersione dalla sincronizzazione), ricalcolare le PEGGIOREREBBE: l'assetto
    // misurato su un profilo più rado esce più basso di quanto è. Meglio lasciare
    // le metriche buone che sostituirle con altre calcolate su meno dati.
    if (dive.metrics?.quality?.ratesFromAlt && !altSamples.length) continue;
    const withSamples: Dive = { ...dive, samples, ...(altSamples.length ? { altSamples } : {}) };
    const metrics = computeMetrics(withSamples);
    // Se il ricalcolo non cambia niente, non si riscrive: evita di marcare come
    // modificate immersioni che non lo sono, e con la sincronizzazione attiva
    // significherebbe rimandarle tutte al database remoto senza motivo.
    if (JSON.stringify(metrics) === JSON.stringify(dive.metrics)) continue;

    for (const r of reasons) report.reasons[r] = (report.reasons[r] ?? 0) + 1;
    // Se l'immersione era già stata contata per i computer duplicati, non si conta
    // due volte: è una sola immersione riparata.
    if (!deduped) report.repaired++;
    // Il record salvato NON porta i campioni: quelli stanno nella loro tabella.
    const { samples: _drop, ...rest } = withSamples;
    const repaired: Dive = { ...rest, metrics };
    out[i] = repaired;
    if (deduped) updated[updated.length - 1] = repaired;
    else updated.push(repaired);
  }

  // Secondo passaggio: la saturazione, che a differenza di tutto il resto non si
  // calcola da una sola immersione. Va dopo, perché ha bisogno delle metriche già
  // sistemate, e legge i profili solo delle immersioni che ne hanno bisogno.
  const chained = await chainArchive(out, (id) => store.getSamples(id));
  if (chained.report.computed > 0) {
    report.reasons['carico di azoto non ancora calcolato'] = chained.report.computed;
    // Un'immersione può essere già stata contata dal primo passaggio: `repaired` è
    // il numero di immersioni toccate, non la somma delle correzioni.
    const already = new Set(updated.map((d) => d.id));
    report.repaired += chained.updated.filter((d) => !already.has(d.id)).length;
    for (const dive of chained.updated) {
      const at = updated.findIndex((d) => d.id === dive.id);
      if (at >= 0) updated[at] = dive;
      else updated.push(dive);
    }
    for (let i = 0; i < out.length; i++) out[i] = chained.dives[i];
  }

  if (updated.length) await store.putDives(updated);
  return { report, dives: out };
}

// ---------------------------------------------------------------------------
// Profili in memoria prima di una fusione
// ---------------------------------------------------------------------------

/** Finestra attorno a ogni immersione in arrivo: copre anche orologi sfasati. */
const WINDOW_MS = 36 * 3600 * 1000;

/**
 * Carica i profili delle immersioni in archivio che potrebbero corrispondere a
 * quelle in arrivo.
 *
 * PERCHÉ SERVE. La lista in memoria contiene i riepiloghi SENZA profili — è la
 * scelta che rende l'app istantanea con migliaia di immersioni. Ma la fusione
 * decide quale profilo tenere confrontando quanti canali e quanti campioni hanno
 * le due versioni, e con i campioni non caricati la versione in archivio vale
 * zero: qualunque cosa arrivi sembra migliore.
 *
 * Il risultato osservato: reimportando gli stessi due file, il profilo del
 * Peregrine — con tetto di decompressione, TTS, NDL e CNS — poteva essere
 * sostituito da quello dell'Aladin, che ha più campioni ma nessun dato
 * decompressivo. E il computer principale veniva spostato nell'elenco degli altri,
 * duplicandolo.
 *
 * Non carica tutto l'archivio: solo le immersioni vicine nel tempo a quelle in
 * arrivo, con una finestra abbastanza larga per gli orologi sfasati. Il costo
 * resta proporzionale a quello che si importa, non all'archivio.
 */
export async function hydrateForMerge(
  store: DiveStore,
  existing: Dive[],
  incoming: Dive[],
): Promise<Dive[]> {
  if (!existing.length || !incoming.length) return existing;
  const counts = await store.sampleCounts();
  const times = incoming.map((d) => Date.parse(d.startTime)).filter((t) => Number.isFinite(t));
  if (!times.length) return existing;

  const near = (t: number) => times.some((x) => Math.abs(x - t) <= WINDOW_MS);
  const out = [...existing];
  for (let i = 0; i < out.length; i++) {
    const dive = out[i];
    if (dive.samples?.length) continue;
    if (!(counts.get(dive.id) ?? 0)) continue;
    if (!near(Date.parse(dive.startTime))) continue;
    out[i] = { ...dive, samples: await store.getSamples(dive.id) };
  }
  return out;
}
