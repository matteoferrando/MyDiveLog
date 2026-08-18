/**
 * Deduplica delle immersioni importate.
 *
 * Il problema: la stessa immersione arriva da fonti diverse (l'export UDDF del
 * Peregrine, il FIT del Garmin al polso del compagno, il backup Subsurface di
 * tre anni fa) e i tre file non concordano su niente — nemmeno sull'orario, se
 * gli orologi dei computer sono sfasati.
 *
 * La soluzione adottata è la stessa euristica di Subsurface (`dive::likely_same`
 * in `core/dive.cpp`), portata in TypeScript. Vale la pena copiarla invece di
 * inventarne una: la finestra temporale VARIABILE (metà della durata della
 * immersione più lunga, minimo 60 s) è ciò che la fa funzionare con computer
 * il cui orologio va alla deriva, mentre i controlli su profondità e durata
 * evitano di fondere due immersioni ripetitive fatte sullo stesso sito.
 */

import type { ComputerInfo, Dive, GasMix, Sample, SourceInfo } from './model';
import { computeMetrics } from './analysis/metrics';

/**
 * `similar(a, b, tol)` — vero se i due valori differiscono per meno di `tol`
 * OPPURE per meno del 10% del maggiore. Il secondo ramo è ciò che rende la
 * tolleranza proporzionale sulle immersioni lunghe o profonde.
 */
export function similar(a: number, b: number, tolerance: number): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const max = Math.max(a, b);
  const diff = max - Math.min(a, b);
  return diff < tolerance || diff * 10 < max;
}

/** Corrispondenza forte: stesso computer, stesso identificativo interno. */
export function matchComputer(a: Dive, b: Dive): 1 | 0 | -1 {
  const ca = a.computer;
  const cb = b.computer;
  if (!ca?.model || !cb?.model) return 0;
  if (ca.model.toLowerCase() !== cb.model.toLowerCase()) return 0;
  if ((ca.deviceId ?? '') !== (cb.deviceId ?? '')) return 0;
  if (!ca.diveId || !cb.diveId) return 0;
  return ca.diveId === cb.diveId && epoch(a) === epoch(b) ? 1 : -1;
}

const TOLERANCE = {
  /** Profondità massima e media: 1 metro. */
  depthM: 1,
  /** Durata: 5 minuti. */
  durationS: 5 * 60,
};

/**
 * Vero se le due immersioni sono con ogni probabilità la stessa immersione.
 *
 * `clockOffsetMs` compensa uno sfasamento SISTEMATICO fra gli orologi delle due
 * fonti — vedi `inferClockOffset`. Vale `b + offset ≈ a`.
 */
export function likelySame(a: Dive, b: Dive, clockOffsetMs = 0): boolean {
  if (!similar(a.maxDepth, b.maxDepth, TOLERANCE.depthM)) return false;
  if (a.avgDepth && b.avgDepth && !similar(a.avgDepth, b.avgDepth, TOLERANCE.depthM)) {
    return false;
  }
  if (!a.durationS || !b.durationS) return false;
  if (!similar(a.durationS, b.durationS, TOLERANCE.durationS)) return false;

  if (matchComputer(a, b) > 0) return true;

  // Finestra temporale variabile: metà della durata della più lunga, minimo 60 s.
  const fuzz = Math.max(60, Math.max(a.durationS, b.durationS) / 2);
  const ta = epoch(a);
  const tb = epoch(b) + clockOffsetMs;
  return ta <= tb + fuzz * 1000 && ta >= tb - fuzz * 1000;
}

// ---------------------------------------------------------------------------
// Sfasamento fra gli orologi di due fonti
// ---------------------------------------------------------------------------

/** Tolleranze STRETTE, usate solo per stimare lo sfasamento. */
const TIGHT = {
  depthM: 1,
  durationS: 150,
};

/**
 * Stima uno sfasamento sistematico fra gli orologi di due archivi.
 *
 * Il problema è concreto e frequente: due computer allo stesso polso registrano
 * la stessa immersione, ma uno ha l'orologio su UTC e l'altro sull'ora locale,
 * oppure uno non ha ricevuto il cambio dell'ora legale. Un archivio Scubapro che
 * salva UTC più il fuso, accanto a un archivio Shearwater che salva la lettura
 * dell'orologio, differiscono di un'ora esatta su OGNI immersione — e la
 * deduplica, che confronta gli istanti, non ne riconosce nemmeno una.
 *
 * La stima non guarda una coppia sola, guarda la DISTRIBUZIONE: per ogni
 * immersione in arrivo cerca quelle già in archivio che coincidono per
 * profondità e durata con tolleranze strette, e raccoglie le differenze di
 * orario. Se molte differenze si accumulano attorno allo stesso valore, quello è
 * lo sfasamento degli orologi. Se sono sparse, non c'è nessuno sfasamento e non
 * si applica niente.
 *
 * È questo che rende il metodo sicuro: uno sfasamento accettato solo quando è
 * sistematico non può far fondere per caso due immersioni ripetitive dello
 * stesso giorno, perché quelle producono una differenza isolata.
 */
export interface ClockOffset {
  offsetMs: number;
  /** Su quante coppie di immersioni si basa questo sfasamento. */
  pairs: number;
}

/** Numero massimo di sfasamenti diversi accettati in un solo import. */
const MAX_OFFSETS = 4;

/** Oltre questo scarto non si parla più di orologi sfasati. */
const MAX_PLAUSIBLE_OFFSET_MS = 14 * 3600_000;

export function inferClockOffsets(
  existing: Dive[],
  incoming: Dive[],
  opts: { minPairs?: number; clusterMs?: number } = {},
): ClockOffset[] {
  const minPairs = opts.minPairs ?? 3;
  const clusterMs = opts.clusterMs ?? 5 * 60_000;
  if (existing.length === 0 || incoming.length === 0) return [];

  const deltas: number[] = [];
  for (const inc of incoming) {
    if (!inc.durationS || !inc.maxDepth) continue;
    for (const ex of existing) {
      if (!similar(ex.maxDepth, inc.maxDepth, TIGHT.depthM)) continue;
      if (!similar(ex.durationS, inc.durationS, TIGHT.durationS)) continue;
      const delta = epoch(ex) - epoch(inc);
      // Oltre le 14 ore non è più uno sfasamento di orologio: è un'altra
      // immersione che per caso somiglia a questa.
      if (Math.abs(delta) <= MAX_PLAUSIBLE_OFFSET_MS) deltas.push(delta);
    }
  }
  // Le coppie ambigue non vengono escluse, entrano tutte: è il
  // raggruppamento a separare il segnale dal rumore. Escluderle sembrava più
  // prudente e in pratica svuota il campione — su un archivio con molte
  // immersioni simili quasi ogni coppia è ambigua — e con pochi dati uno dei due
  // sfasamenti reali resta invisibile. Le differenze casuali si distribuiscono,
  // quelle vere si accumulano nello stesso punto.
  if (deltas.length < minPairs) return [];

  // Raggruppa le differenze vicine fra loro. Possono essere PIÙ DI UNA: nei dati
  // reali si trova un gruppo a un'ora e un gruppo a due ore, perché nel frattempo
  // l'orologio di un computer è stato corretto o è cambiata l'ora legale. Un solo
  // sfasamento globale lascerebbe fuori il secondo gruppo.
  deltas.sort((a, b) => a - b);
  const clusters: ClockOffset[] = [];
  let i = 0;
  while (i < deltas.length) {
    let j = i;
    let sum = 0;
    while (j < deltas.length && deltas[j] - deltas[i] <= clusterMs) {
      sum += deltas[j];
      j++;
    }
    const count = j - i;
    if (count >= minPairs) {
      const offsetMs = Math.round(sum / count);
      // Sotto i due minuti non è uno sfasamento di orologi, è il normale scarto
      // fra due computer che rilevano l'ingresso in acqua con un attimo di
      // differenza: la finestra ordinaria della deduplica lo copre già.
      if (Math.abs(offsetMs) >= 120_000) clusters.push({ offsetMs, pairs: count });
    }
    i = j;
  }
  return clusters.sort((a, b) => b.pairs - a.pairs).slice(0, MAX_OFFSETS);
}

/** Compatibilità: lo sfasamento più rappresentato, se ce n'è uno. */
export function inferClockOffset(
  existing: Dive[],
  incoming: Dive[],
  opts: { minPairs?: number; clusterMs?: number } = {},
): ClockOffset | null {
  return inferClockOffsets(existing, incoming, opts)[0] ?? null;
}

const epoch = (d: Dive) => new Date(d.startTime).getTime();

export interface MergeReport {
  /** Immersioni da salvare (nuove o arricchite). */
  dives: Dive[];
  added: number;
  merged: number;
  /** Immersioni scartate perché identiche a una già presente. */
  duplicates: number;
  /** Sfasamenti fra gli orologi riconosciuti e compensati, dal più rappresentato. */
  clockOffsets: ClockOffset[];
}

/**
 * Fonde le immersioni appena importate con quelle già in archivio.
 *
 * Politica di merge, in ordine:
 *  1. se l'immersione esistente non ha profilo e la nuova sì, il profilo vince;
 *  2. i campi vuoti dell'esistente vengono riempiti dalla nuova;
 *  3. i campi già valorizzati dall'utente (note, buddy, sito, rating, tag)
 *     NON vengono sovrascritti da un import automatico.
 *
 * `now` è un parametro e non `new Date()` preso qui dentro perché la funzione
 * resta così deterministica e verificabile: un merge con lo stesso istante dà lo
 * stesso risultato, e i test non dipendono dall'orologio.
 */
export function mergeImports(
  existing: Dive[],
  incoming: Dive[],
  now: string = new Date().toISOString(),
): MergeReport {
  const result = [...existing];
  const byId = new Map(result.map((d, i) => [d.id, i]));
  let added = 0;
  let merged = 0;
  let duplicates = 0;

  // Stimati una volta sull'intero lotto, non immersione per immersione: uno
  // sfasamento di orologi è una proprietà della coppia di dispositivi, non della
  // singola immersione.
  const clockOffsets = inferClockOffsets(existing, incoming);
  // Lo zero c'è sempre: la maggior parte degli import non ha nessuno sfasamento.
  const candidates = [0, ...clockOffsets.map((c) => c.offsetMs)];

  for (const dive of incoming) {
    const sameId = byId.get(dive.id);
    if (sameId !== undefined) {
      const before = result[sameId];
      const after = mergeDive(before, dive, now);
      if (after === before) {
        duplicates++;
      } else {
        result[sameId] = after;
        merged++;
      }
      continue;
    }

    const idx = findBestMatch(result, dive, candidates);
    if (idx >= 0) {
      const after = mergeDive(result[idx], dive, now);
      if (after === result[idx]) duplicates++;
      else {
        result[idx] = after;
        merged++;
      }
      continue;
    }

    // Un'immersione nuova nasce con la data di modifica: senza, la
    // sincronizzazione non avrebbe modo di sapere quale versione è più avanti
    // quando la stessa immersione viene poi ritoccata su un altro dispositivo.
    result.push(dive.updatedAt ? dive : { ...dive, updatedAt: now });
    byId.set(dive.id, result.length - 1);
    added++;
  }

  result.sort((a, b) => epoch(b) - epoch(a));
  return { dives: result, added, merged, duplicates, clockOffsets };
}

/**
 * Fra tutte le immersioni compatibili sceglie quella con lo scarto di orario più
 * piccolo, provando ciascuno degli sfasamenti candidati.
 *
 * Prendere la prima compatibile invece della migliore sarebbe un errore proprio
 * nel caso che conta: con due sfasamenti plausibili, un'immersione ripetitiva
 * dello stesso giorno può risultare compatibile sotto quello sbagliato.
 */
export function findBestMatch(pool: Dive[], dive: Dive, offsets: number[]): number {
  let bestIdx = -1;
  let bestResidual = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pool.length; i++) {
    for (const offset of offsets) {
      if (!likelySame(pool[i], dive, offset)) continue;
      const residual = Math.abs(epoch(pool[i]) - (epoch(dive) + offset));
      if (residual < bestResidual) {
        bestResidual = residual;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}

/** Restituisce `base` invariato se la nuova immersione non aggiunge niente. */
/**
 * Quanti canali distinti porta il profilo di un'immersione.
 *
 * Non è la stessa cosa del numero di campioni: due profili della stessa
 * immersione possono avere la stessa profondità e uno solo il tetto di
 * decompressione. Il conteggio serve a scegliere quale tenere quando la stessa
 * immersione arriva da due computer diversi.
 */
/** Due riferimenti allo stesso computer fisico. */
export function sameComputer(a: ComputerInfo | undefined, b: ComputerInfo | undefined): boolean {
  if (!a || !b) return false;
  if (a.serial && b.serial) return a.serial === b.serial;
  return (a.model ?? '') === (b.model ?? '');
}

/** Aggiunge un computer all'elenco solo se non c'è già. */
function addComputer(list: ComputerInfo[], candidate: ComputerInfo | undefined): ComputerInfo[] {
  if (!candidate) return dedupeComputers(list);
  return dedupeComputers([...list, candidate]);
}

export function dedupeComputers(list: ComputerInfo[]): ComputerInfo[] {
  const out: ComputerInfo[] = [];
  for (const c of list) {
    const existing = out.find((x) => sameComputer(x, c));
    // A pari computer si tengono i campi di entrambe le letture: una fonte può
    // avere il firmware e l'altra i limiti di PPO2.
    if (existing) Object.assign(existing, { ...c, ...existing });
    else out.push({ ...c });
  }
  return out;
}

/** Aria: quello che i parser mettono quando la miscela non è dichiarata. */
const isAir = (mix: GasMix) => Math.abs(mix.o2 - 0.21) < 0.005 && (mix.he ?? 0) < 0.005;

/**
 * Unione delle bombole campo per campo: nessun valore già presente viene
 * sovrascritto, ogni buco viene riempito dall'altra fonte.
 */
function mergeCylinders(
  base: Dive['cylinders'],
  incoming: Dive['cylinders'],
): { cylinders: Dive['cylinders']; changed: boolean } {
  if (!incoming.length) return { cylinders: base, changed: false };
  if (!base.length) return { cylinders: incoming, changed: true };

  let changed = false;
  const out = base.map((cyl, i) => {
    const other = incoming[i];
    if (!other) return cyl;
    const merged = { ...cyl };
    for (const key of [
      'sizeL',
      'workPressureBar',
      'startBar',
      'endBar',
      'material',
      'description',
    ] as const) {
      if (merged[key] === undefined && other[key] !== undefined) {
        // @ts-expect-error assegnazione per chiave omogenea
        merged[key] = other[key];
        changed = true;
      }
    }
    // La MISCELA non è un campo come gli altri: `mix` non è mai `undefined`
    // perché i parser che non la conoscono mettono aria. Quindi il ciclo qui
    // sopra non la copiava mai, e su un'immersione in nitrox registrata da due
    // computer vinceva l'aria di chi non la sapeva — a seconda dell'ordine di
    // import. Con la miscela sbagliata la PPO2 di picco esce sottostimata di un
    // terzo, cioè l'unico numero che direbbe se il limite d'ossigeno è stato
    // superato. Una miscela diversa dall'aria è un'informazione che qualcuno ha
    // davvero letto: vince su quella predefinita.
    if (isAir(merged.mix) && !isAir(other.mix)) {
      merged.mix = other.mix;
      changed = true;
    }
    return merged;
  });
  // Bombole in più nell'altra fonte (uno stage che il primo computer non vedeva).
  if (incoming.length > base.length) {
    out.push(...incoming.slice(base.length));
    changed = true;
  }
  return { cylinders: out, changed };
}

/** Passo medio fra campioni, secondi. `Infinity` se non è un profilo. */
function intervalOf(samples: Sample[]): number {
  if (samples.length < 3) return Infinity;
  return (samples[samples.length - 1].t - samples[0].t) / (samples.length - 1);
}

/** Il più fitto fra i profili candidati, cioè quello col passo minore. */
function denserOf(...candidates: (Sample[] | undefined)[]): Sample[] | undefined {
  let best: Sample[] | undefined;
  let bestInterval = Infinity;
  for (const c of candidates) {
    if (!c || c.length < 3) continue;
    const i = intervalOf(c);
    if (i < bestInterval) {
      best = c;
      bestInterval = i;
    }
  }
  return best;
}

export function profileChannels(dive: Dive): number {
  const samples = dive.samples;
  if (!samples?.length) return 0;
  const has = (test: (s: Sample) => boolean) => (samples.some(test) ? 1 : 0);
  return (
    1 + // la profondità c'è sempre
    has((s) => s.tempC !== undefined) +
    has((s) => s.pressureBar?.some((p) => p !== undefined) ?? false) +
    // I dati decompressivi contano DUE: sono quelli che nessun altro formato
    // ricostruisce, e la scelta del profilo deve pendere dalla loro parte.
    2 * has((s) => s.ceiling !== undefined || s.ndlS !== undefined || s.ttsS !== undefined) +
    has((s) => s.cns !== undefined) +
    has((s) => s.ppo2 !== undefined) +
    has((s) => s.heartRate !== undefined) +
    has((s) => s.gasIndex !== undefined)
  );
}

export function mergeDive(base: Dive, incoming: Dive, now: string = new Date().toISOString()): Dive {
  const out: Dive = { ...base };
  let changed = false;

  const takeIfEmpty = <K extends keyof Dive>(key: K) => {
    const current = out[key];
    const next = incoming[key];
    const empty =
      current === undefined ||
      current === null ||
      current === '' ||
      (Array.isArray(current) && current.length === 0);
    if (empty && next !== undefined && next !== null && next !== '') {
      out[key] = next;
      changed = true;
    }
  };

  // Quale profilo tenere. La regola ovvia — "il più fitto vince" — è sbagliata, e
  // si è visto su dati reali: un Aladin campiona ogni 4 s ma il formato Uwatec non
  // contiene NIENTE sulla decompressione, mentre un Peregrine campiona ogni 10 s e
  // registra tetto, TTS, NDL e CNS. A parità di immersione, tenere il profilo più
  // fitto butta via i soli dati decompressivi esistenti; e le metriche che
  // dipendono dalla densità di campionamento (velocità di risalita su finestra di
  // 30 s, assetto) funzionano bene anche a 10 s.
  //
  // Quindi si conta prima quanti CANALI porta il profilo, e solo a pari canali si
  // guarda quanti campioni. `metrics` e `computer` seguono il profilo scelto,
  // perché sono stati calcolati e letti su quello.
  const baseSamples = base.samples?.length ?? 0;
  const newSamples = incoming.samples?.length ?? 0;
  if (newSamples > 0) {
    const baseChannels = profileChannels(base);
    const newChannels = profileChannels(incoming);
    const better = newChannels !== baseChannels ? newChannels > baseChannels : newSamples > baseSamples;
    if (!better) {
      // Anche quando il profilo in arrivo non vince, può essere il più fitto.
      const candidate = denserOf(incoming.samples, out.altSamples, incoming.altSamples);
      if ((candidate?.length ?? 0) > (out.altSamples?.length ?? 0)) {
        out.altSamples = candidate;
        changed = true;
      }
    }
    if (better) {
      // Il profilo che perde non si butta: se è più FITTO del vincente, resta come
      // secondo profilo e le metriche di velocità e assetto verranno misurate su
      // di lui. Vedi `Dive.altSamples` e `analysis/metrics.ts`.
      out.altSamples = denserOf(out.samples, out.altSamples, incoming.altSamples);
      out.samples = incoming.samples;
      // Il computer del profilo diventa quello principale, ma l'altro NON si
      // perde: le sue impostazioni (limiti di PPO2, firmware, seriale) sono dati
      // veri che nessun'altra fonte porta. Vedi `otherComputers`.
      if (incoming.computer) {
        const others = addComputer(
          [...(out.otherComputers ?? []), ...(incoming.otherComputers ?? [])],
          out.computer,
        );
        out.computer = incoming.computer;
        // Il computer che diventa principale non deve restare anche nell'elenco
        // degli altri: reimportando gli stessi file, il vecchio principale e il
        // nuovo sono lo STESSO computer, e senza questo filtro la scheda mostrava
        // "Computer (3)" con il Peregrine due volte.
        out.otherComputers = others.filter((c) => !sameComputer(c, out.computer));
      }
      changed = true;
    }
  }

  (
    [
      'number',
      'avgDepth',
      'minTempC',
      'airTempC',
      'buddy',
      'notes',
      'site',
      'rating',
      'visibilityM',
      'salinity',
      'surfacePressureBar',
      'surfaceIntervalS',
      'computer',
      'weightKg',
      'suit',
      'utcOffsetMinutes',
    ] as const
  ).forEach(takeIfEmpty);

  // `reported` e `annotations` si fondono per chiave: due computer possono
  // contribuire pezzi diversi della stessa immersione, e prendere il primo blocco
  // intero butterebbe via quello che ha solo l'altro.
  const mergedReported = { ...(incoming.reported ?? {}), ...(out.reported ?? {}) };
  if (Object.keys(mergedReported).length > Object.keys(out.reported ?? {}).length) {
    out.reported = mergedReported;
    changed = true;
  }
  const mergedAnnotations = { ...(incoming.annotations ?? {}), ...(out.annotations ?? {}) };
  if (Object.keys(mergedAnnotations).length > Object.keys(out.annotations ?? {}).length) {
    out.annotations = mergedAnnotations;
    changed = true;
  }

  // Bombole: unione CAMPO PER CAMPO, non "tutto o niente".
  //
  // È il caso che ha fatto emergere il problema: LogTRAK porta volume e pressioni
  // (inserite a mano), il log del Peregrine porta le miscele effettivamente
  // respirate ma nessuna pressione, perché non ha il trasmettitore. Prendendo il
  // blocco intero da una parte sola, il consumo diventava incalcolabile pur
  // avendo tutti i dati necessari in casa.
  const mergedCylinders = mergeCylinders(out.cylinders ?? [], incoming.cylinders ?? []);
  if (mergedCylinders.changed) {
    out.cylinders = mergedCylinders.cylinders;
    changed = true;
  }

  const tags = new Set([...(out.tags ?? []), ...(incoming.tags ?? [])]);
  if (tags.size !== (out.tags?.length ?? 0)) {
    out.tags = [...tags];
    changed = true;
  }

  // Pulizia di archivi scritti da versioni precedenti: se l'elenco contiene il
  // computer principale, va tolto.
  if (out.otherComputers?.some((c) => sameComputer(c, out.computer))) {
    out.otherComputers = out.otherComputers.filter((c) => !sameComputer(c, out.computer));
    changed = true;
  }

  // Il computer che non ha vinto il profilo entra comunque nell'elenco.
  if (incoming.computer && !sameComputer(incoming.computer, out.computer)) {
    const merged = addComputer(
      [...(out.otherComputers ?? []), ...(incoming.otherComputers ?? [])],
      incoming.computer,
    );
    if (merged.length !== (out.otherComputers?.length ?? 0)) {
      out.otherComputers = merged;
      changed = true;
    }
  }

  // Traccia di tutte le fonti che hanno contribuito. Non è cosmetica: senza,
  // un'immersione fusa da due computer mostra la provenienza di uno solo e sembra
  // che i dati dell'altro non siano entrati.
  const sources = [out.source, ...(out.extraSources ?? [])];
  const arriving = [incoming.source, ...(incoming.extraSources ?? [])];
  const key = (s: SourceInfo) => `${s.format}|${s.file}`;
  const known = new Set(sources.map(key));
  const added = arriving.filter((s) => s && !known.has(key(s)));
  if (added.length) {
    out.extraSources = [...(out.extraSources ?? []), ...added];
    changed = true;
  }

  if (incoming.maxDepth > out.maxDepth) {
    out.maxDepth = incoming.maxDepth;
    changed = true;
  }
  if (incoming.durationS > out.durationS) {
    out.durationS = incoming.durationS;
    changed = true;
  }

  // Un secondo profilo più rado del principale non serve a niente: la sua unica
  // ragione di esistere è avere una base più fitta per le velocità.
  if (out.altSamples && out.altSamples.length <= (out.samples?.length ?? 0)) {
    const altInterval = intervalOf(out.altSamples);
    const mainInterval = intervalOf(out.samples ?? []);
    if (!(altInterval < mainInterval)) out.altSamples = undefined;
  }

  // Segnalibri premuti sul computer: si sommano, non si sostituiscono.
  if (incoming.events?.length) {
    const known = new Set((out.events ?? []).map((e) => `${e.t}|${e.bearing ?? ''}|${e.label ?? ''}`));
    const added = incoming.events.filter((e) => !known.has(`${e.t}|${e.bearing ?? ''}|${e.label ?? ''}`));
    if (added.length) {
      out.events = [...(out.events ?? []), ...added].sort((a, b) => a.t - b.t);
      changed = true;
    }
  }

  if (!changed) return base;

  // LE METRICHE SI RICALCOLANO. Prima venivano ereditate dalla fonte che aveva
  // vinto il profilo, e il risultato era assurdo: la scheda mostrava 240 → 60 bar
  // su una bombola da 12 litri e accanto "nessuna pressione bombola, consumo non
  // calcolabile", perché le metriche erano state calcolate sul record Shearwater —
  // che il profilo ce l'ha ma le pressioni no. L'immersione fusa è un dato nuovo:
  // le sue metriche vanno calcolate su di essa, non prese in prestito.
  out.metrics = computeMetrics(out);

  // Solo se qualcosa è davvero cambiato: marcare come modificata un'immersione
  // identica farebbe sembrare "più avanti" la copia di chi ha reimportato per
  // ultimo, e la sincronizzazione la propagherebbe senza motivo.
  out.updatedAt = now;
  return out;
}

/**
 * Hash deterministico (FNV-1a a 64 bit su due parole da 32).
 * Reimportare lo stesso file produce lo stesso id, quindi il reimport è idempotente.
 */
export function stableId(parts: (string | number | undefined)[]): string {
  const input = parts.map((p) => (p === undefined ? '' : String(p))).join('');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c << 3) | (i & 7)), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * Id di un'immersione. Usa l'identificativo interno del computer quando c'è
 * (è l'unica chiave davvero stabile), altrimenti la firma orario+profondità+durata.
 */
export function diveIdFor(d: {
  startTime: string;
  maxDepth: number;
  durationS: number;
  computer?: { model?: string; deviceId?: string; diveId?: string };
}): string {
  const c = d.computer;
  if (c?.diveId) return stableId(['dc', c.model, c.deviceId, c.diveId]);
  // Arrotonda al minuto: gli export ricalcolano a volte i secondi.
  const minute = Math.floor(new Date(d.startTime).getTime() / 60_000);
  return stableId(['sig', minute, Math.round(d.maxDepth * 10), Math.round(d.durationS / 60)]);
}
