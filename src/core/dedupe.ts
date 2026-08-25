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

/**
 * Tutte le impronte di profilo che un'immersione porta, principale e altri.
 *
 * PERCHÉ NON BASTA `computer.profileFingerprint`. Quando il profilo in arrivo
 * vince — più canali — il blocco `computer` viene sostituito in blocco e quello
 * vecchio finisce fra gli «altri», impronta compresa. Guardando solo il
 * principale, l'unico criterio capace di riconoscere l'immersione la cui data è
 * stata corretta a mano si spegneva appena si importava un secondo computer:
 * misurato sull'archivio reale, 137 immersioni con impronta scendevano a 99, e
 * la copia con 118 giorni di scarto rientrava come nuova a ogni scarico
 * Bluetooth, per sempre.
 */
function improntePresenti(d: Dive): string[] {
  const out: string[] = [];
  if (d.computer?.profileFingerprint) out.push(d.computer.profileFingerprint);
  for (const c of d.otherComputers ?? []) if (c.profileFingerprint) out.push(c.profileFingerprint);
  return out;
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
  /*
   * L'IMPRONTA DEL PROFILO DECIDE DA SOLA, e viene prima di tutto il resto.
   *
   * Sono mille byte di campioni identici: due immersioni diverse non li hanno.
   * Sta prima dei controlli su profondità e durata perché quelli, pur
   * combaciando, non basterebbero — il criterio che fallisce è la finestra
   * temporale, e la fallisce di mesi quando l'orologio del computer era
   * sbagliato e la data è stata corretta a mano nell'applicazione. È il caso
   * documentato su due immersioni dell'archivio di prova.
   *
   * Solo in positivo: se le impronte ci sono e coincidono, è la stessa
   * immersione. Se mancano o differiscono, questa riga non dice niente e si
   * passa al criterio di sempre — le sorgenti senza profilo un'impronta non ce
   * l'hanno affatto.
   */
  const impronteA = improntePresenti(a);
  const impronteB = improntePresenti(b);
  if (impronteA.some((x) => impronteB.includes(x))) return true;

  /*
   * IL VETO: stesso computer, identificativi interni diversi.
   *
   * `matchComputer` sa già rispondere «stesso apparecchio, immersioni DIVERSE»
   * con −1, e questo controllo guardava solo il caso positivo. Il risultato,
   * riprodotto su un archivio finto ma verosimile: con un orario di bordo
   * regolare — tre tuffi al giorno alle 09:00, 11:30 e 14:30 per cinque giorni
   * — le differenze fra tuffi diversi dello STESSO giorno si accumulano tutte
   * sugli stessi valori, `inferClockOffsets` le scambia per uno sfasamento
   * d'orologio sistematico, e un'immersione in più che una sola fonte possiede
   * viene inghiottita da una ripetitiva. L'archivio non cresce e il rapporto
   * dell'import dice «arricchita».
   *
   * Il veto vale solo quando ENTRAMBE portano un identificativo interno dello
   * stesso apparecchio: se lo stesso computer ha numerato le due immersioni in
   * modo diverso, sono due immersioni. Non è un'euristica, è il computer che
   * lo dichiara.
   */
  if (matchComputer(a, b) < 0) return false;

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
  opts: {
    minPairs?: number;
    clusterMs?: number;
    /** Quante coppie bastano quando concordano dentro la finestra stretta. */
    minPairsStrette?: number;
    /** La finestra stretta: due letture dello stesso tuffo concordano al secondo. */
    clusterStrettoMs?: number;
  } = {},
): ClockOffset[] {
  const minPairs = opts.minPairs ?? 3;
  const clusterMs = opts.clusterMs ?? 5 * 60_000;
  /*
   * DUE COPPIE BASTANO, SE CONCORDANO AL SECONDO.
   *
   * IL DIFETTO CHE CHIUDE, misurato su due immersioni vere del 24 agosto 2026.
   * Lo stesso tuffo scaricato dai due computer è entrato in archivio due volte,
   * con uno scarto d'orario di 3565 s sulla prima coppia e 3567 s sulla
   * seconda. Uno sfasamento d'orologio scritto in fronte — e `inferClockOffsets`
   * l'ha ignorato, perché ne pretende tre di coppie e uno scarico incrementale
   * ne porta due. L'archivio è cresciuto di quattro righe invece che di due,
   * senza un avviso.
   *
   * Tre coppie non erano una soglia arbitraria: servivano a non scambiare per
   * sfasamento le differenze fra tuffi DIVERSI di un orario di bordo regolare —
   * 09:00, 11:30, 14:30 tutti i giorni — che si accumulano sugli stessi valori.
   * Abbassarla a due e basta rimetterebbe in piedi proprio quel difetto.
   *
   * Ma quelle differenze finte si somigliano al MINUTO, non al secondo: nessuno
   * entra in acqua allo stesso istante due giorni di fila. Due letture dello
   * stesso tuffo sì — i due computer vedono lo stesso ingresso, e i due scarti
   * qui sopra distano due secondi.
   *
   * Quindi la seconda coppia si accetta solo dentro una finestra molto più
   * stretta. Non è una soglia più permissiva: è una soglia diversa, che misura
   * una cosa diversa.
   */
  const coppieStrette = opts.minPairsStrette ?? 2;
  const clusterStrettoMs = opts.clusterStrettoMs ?? 120_000;
  if (existing.length === 0 || incoming.length === 0) return [];

  /*
   * LE IMMERSIONI CHE COMBACIANO GIÀ SENZA SFASAMENTO NON PARLANO.
   *
   * IL DIFETTO CHE CHIUDE, riprodotto su un archivio verosimile: con un orario
   * di bordo regolare — tre tuffi al giorno alle 09:00, 11:30 e 14:30 per
   * cinque giorni — le differenze fra tuffi DIVERSI dello stesso giorno si
   * accumulano tutte sugli stessi valori (−2h30, −3h, −5h30) e superano
   * `minPairs`. Il commento qui sotto sosteneva che uno sfasamento sistematico
   * non può nascere per caso «perché le ripetitive producono una differenza
   * isolata»: non è vero, un orario regolare le rende sistematiche. Da lì
   * un'immersione che una sola fonte possiede veniva inghiottita da una
   * ripetitiva dello stesso giorno, e l'import annunciava «arricchita».
   *
   * Il rimedio è di principio, non una soglia in più: una coppia che combacia
   * GIÀ a sfasamento zero è spiegata, e usarla anche per costruire uno
   * sfasamento diverso è contarla due volte. Restano solo le immersioni che a
   * zero non trovano niente — che sono esattamente quelle di cui ha senso
   * chiedersi se l'orologio fosse sbagliato. Il caso vero non si perde: quando
   * un archivio è tutto spostato di un'ora, a zero non combacia NIENTE e ogni
   * coppia continua a votare.
   */
  const giaSpiegate = new Set<Dive>();
  for (const inc of incoming) {
    if (existing.some((ex) => likelySame(ex, inc, 0))) giaSpiegate.add(inc);
  }

  const deltas: number[] = [];
  for (const inc of incoming) {
    if (!inc.durationS || !inc.maxDepth) continue;
    if (giaSpiegate.has(inc)) continue;
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
  if (deltas.length < Math.min(minPairs, coppieStrette)) return [];

  // Raggruppa le differenze vicine fra loro. Possono essere PIÙ DI UNA: nei dati
  // reali si trova un gruppo a un'ora e un gruppo a due ore, perché nel frattempo
  // l'orologio di un computer è stato corretto o è cambiata l'ora legale. Un solo
  // sfasamento globale lascerebbe fuori il secondo gruppo.
  deltas.sort((a, b) => a - b);
  const clusters: ClockOffset[] = [];
  const visto = new Set<number>();
  // Prima la finestra stretta, poi quella larga: un gruppo compatto è la
  // spiegazione migliore di uno sparso che lo contiene, e trovandolo per primo
  // non viene assorbito dall'altro.
  for (const [finestra, quante] of [
    [clusterStrettoMs, coppieStrette],
    [clusterMs, minPairs],
  ] as const) {
    let i = 0;
    while (i < deltas.length) {
      let j = i;
      let sum = 0;
      while (j < deltas.length && deltas[j] - deltas[i] <= finestra) {
        sum += deltas[j];
        j++;
      }
      const count = j - i;
      if (count >= quante) {
        const offsetMs = Math.round(sum / count);
        // Sotto i due minuti non è uno sfasamento di orologi, è il normale scarto
        // fra due computer che rilevano l'ingresso in acqua con un attimo di
        // differenza: la finestra ordinaria della deduplica lo copre già.
        if (Math.abs(offsetMs) >= 120_000 && !visto.has(offsetMs)) {
          visto.add(offsetMs);
          clusters.push({ offsetMs, pairs: count });
        }
      }
      i = j;
    }
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
  /** Immersioni aggiunte che somigliano a una già in archivio. Vedi `Sospetto`. */
  sospetti: Sospetto[];
}

/**
 * Un'immersione aggiunta che somiglia troppo a una che c'era già.
 *
 * ► PERCHÉ QUESTO TIPO ESISTE. ◄
 *
 * Il 24 agosto 2026 due immersioni scaricate da due computer sono entrate in
 * archivio quattro volte. La deduplica aveva davanti due coppie che collimavano
 * su profondità e durata e discordavano di un'ora — e ha aggiunto quattro righe
 * **in silenzio**, dicendo soltanto «2 aggiunte». Da fuori, un archivio che
 * cresce del doppio e un rapporto che non se ne accorge.
 *
 * Il difetto peggiore non era non unirle: era non dirlo. Unire due immersioni
 * diverse è un danno, quindi la deduplica ha ragione a essere prudente — ma la
 * prudenza che tace è indistinguibile dalla svista. Quando i numeri combaciano
 * e a non tornare è solo l'orologio, si aggiunge e SI DICE, con lo scarto
 * misurato: chi legge capisce in un secondo se ha davanti due tuffi o due
 * letture dello stesso.
 */
export interface Sospetto {
  aggiunta: Dive;
  simile: Dive;
  /** Scarto d'orario fra le due, in millisecondi. Positivo se l'aggiunta è dopo. */
  scartoMs: number;
}

/** Il quarto d'ora più vicino, in millisecondi. */
const QUARTO_MS = 15 * 60_000;

/**
 * Vero se questo scarto ha la FORMA di un orologio sbagliato.
 *
 * I fusi orari e l'ora legale si muovono a quarti d'ora: un orologio impostato
 * male sbaglia di 30, 60, 120 minuti, non di 39. Due immersioni ripetitive
 * dello stesso giorno, invece, distano un'ora e trentotto — un numero che con i
 * quarti d'ora non c'entra niente.
 *
 * È il filtro che tiene l'avviso raro e quindi credibile. Sui dati veri del
 * 24 agosto separa esattamente le due coppie giuste (59′25″ e 59′27″, cioè a
 * mezzo minuto dall'ora tonda) dall'accoppiamento sbagliato fra la prima
 * immersione di un computer e la seconda dell'altro (39′10″, lontano da
 * qualunque quarto d'ora).
 */
function formaDiOrologio(scartoMs: number): boolean {
  const assoluto = Math.abs(scartoMs);
  if (assoluto < 120_000 || assoluto > MAX_PLAUSIBLE_OFFSET_MS) return false;
  const residuo = Math.abs(assoluto - Math.round(assoluto / QUARTO_MS) * QUARTO_MS);
  return residuo <= 120_000;
}

/**
 * Fra le immersioni già in archivio, quella che somiglia troppo a questa.
 *
 * Cerca solo fra computer DIVERSI, e non è un dettaglio: due immersioni dello
 * stesso apparecchio con identificativi interni diversi sono due immersioni —
 * lo dice il computer, ed è il veto di `likelySame`. La stessa immersione letta
 * due volte dallo stesso apparecchio si riconosce già per chiave o per
 * impronta. Resta solo il caso che conta: due computer al polso della stessa
 * persona.
 */
function sospettoPer(dive: Dive, pool: Dive[]): Sospetto | undefined {
  let migliore: Sospetto | undefined;
  for (const altra of pool) {
    if (altra === dive) continue;
    const ca = altra.computer;
    const cb = dive.computer;
    const stessoApparecchio =
      !!ca?.model &&
      !!cb?.model &&
      ca.model.toLowerCase() === cb.model.toLowerCase() &&
      (ca.deviceId ?? '') === (cb.deviceId ?? '');
    if (stessoApparecchio) continue;
    if (!similar(altra.maxDepth, dive.maxDepth, TOLERANCE.depthM)) continue;
    if (!altra.durationS || !dive.durationS) continue;
    if (!similar(altra.durationS, dive.durationS, TOLERANCE.durationS)) continue;
    const scartoMs = epoch(dive) - epoch(altra);
    if (!formaDiOrologio(scartoMs)) continue;
    if (!migliore || Math.abs(scartoMs) < Math.abs(migliore.scartoMs)) {
      migliore = { aggiunta: dive, simile: altra, scartoMs };
    }
  }
  return migliore;
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
  const aggiunte: Dive[] = [];

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
    const nata = dive.updatedAt ? dive : { ...dive, updatedAt: now };
    result.push(nata);
    byId.set(dive.id, result.length - 1);
    aggiunte.push(nata);
    added++;
  }

  /*
   * I sospetti si cercano ALLA FINE, sull'archivio completo.
   *
   * Farlo dentro il ciclo guarderebbe un archivio a metà: la seconda immersione
   * di un lotto non vedrebbe la prima, e su uno scarico da due — che è
   * esattamente il caso che ha prodotto il difetto — sarebbe cieca proprio dove
   * serve.
   */
  const sospetti: Sospetto[] = [];
  for (const nata of aggiunte) {
    const s = sospettoPer(nata, result);
    if (s) sospetti.push(s);
  }

  result.sort((a, b) => epoch(b) - epoch(a));
  return { dives: result, added, merged, duplicates, clockOffsets, sospetti };
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
/**
 * Due letture dello stesso computer in una sola, prendendo di ciascuna i campi
 * che all'altra mancano.
 *
 * Restituisce `base` invariato — lo stesso riferimento — quando non c'è niente
 * da aggiungere, così chi chiama sa se qualcosa è cambiato senza confrontare
 * campo per campo. Chi la usa deve avere già deciso che i due riferimenti sono
 * lo STESSO apparecchio: questa funzione non lo verifica.
 */
export function fondiComputer(base: ComputerInfo, altro: ComputerInfo): ComputerInfo {
  let fuso: ComputerInfo | undefined;
  for (const k of Object.keys(altro) as (keyof ComputerInfo)[]) {
    if (base[k] === undefined && altro[k] !== undefined) {
      fuso ??= { ...base };
      (fuso as Record<string, unknown>)[k] = altro[k];
    }
  }
  return fuso ?? base;
}

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
    /*
     * A pari computer si tengono i campi di entrambe le letture: una fonte può
     * avere il firmware e l'altra i limiti di PPO2.
     *
     * Prima era `Object.assign(existing, { ...c, ...existing })`, e lo spread
     * copia anche le chiavi il cui valore è `undefined` ESPLICITO: tutti i
     * lettori costruiscono il blocco `computer` con le chiavi sempre presenti,
     * quindi bastava che la prima voce avesse `serial: undefined` per
     * cancellare il seriale vero dell'altra — e il risultato dipendeva
     * dall'ordine dell'elenco. Questa funzione gira a ogni avvio e su ogni
     * immersione che scende dalla sincronizzazione, quindi il dato mutilato
     * diventava quello definitivo. `fondiComputer` guarda i valori.
     */
    if (existing) Object.assign(existing, fondiComputer(existing, c));
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
    /*
     * ════════════════════════════════════════════════════════════════════════
     * ► UN PROFILO MAI VERIFICATO NON SCALZA UNO VERIFICATO. ◄
     *
     * `libdivecomputer` è una sorgente diversa dalle altre, e non per la
     * qualità della libreria — che legge questi formati da vent'anni — ma per
     * quello che sappiamo NOI di questa applicazione: nessun computer di terzi
     * è mai stato collegato a questo ponte. I due driver scritti in casa hanno
     * letto centinaia di immersioni con l'apparecchio in mano; questa strada
     * zero.
     *
     * Senza questa riga il confronto dei canali basta a farla vincere: i dati
     * decompressivi valgono due punti, e un profilo che porta un `ceiling` o un
     * `ndlS` scalza quello del Peregrine. Il 25 agosto 2026 succedeva davvero —
     * una costante trascritta male dava `ceiling: 0` a OGNI campione in curva,
     * e quel profilo vinceva sempre.
     *
     * Il difetto è stato corretto, ma la struttura che l'ha reso possibile no:
     * finché la sorgente non è verificata sul campo, il caso peggiore
     * dev'essere **un'immersione nuova sbagliata** — che si vede, e si
     * corregge — e mai **un'immersione giusta sovrascritta in silenzio**. La
     * seconda non la segnala nessuno: il profilo resta plausibile, il grafico
     * si disegna, e l'archivio è rovinato senza un sintomo.
     *
     * NON impedisce a quelle immersioni di ENTRARE: una immersione che
     * l'archivio non ha arriva normalmente, con tutto il suo profilo. Impedisce
     * solo di **sostituire** un profilo che c'è già e viene da una strada
     * provata. E non è per sempre: si toglie il giorno in cui questa strada
     * viene verificata contro un apparecchio vero, insieme all'etichetta «mai
     * provato su questo modello» nel selettore.
     * ════════════════════════════════════════════════════════════════════════
     */
    const nonVerificata = incoming.source?.format === 'libdivecomputer';
    const baseVerificata = base.source?.format !== 'libdivecomputer';
    const better =
      nonVerificata && baseVerificata
        ? false
        : newChannels !== baseChannels
          ? newChannels > baseChannels
          : newSamples > baseSamples;
    if (!better) {
      // Anche quando il profilo in arrivo non vince, può essere il più fitto.
      const candidate = denserOf(incoming.samples, out.altSamples, incoming.altSamples);
      /*
       * Deve essere più fitto del PRINCIPALE, non solo del secondo che c'è già.
       *
       * Senza il primo confronto, reimportare lo stesso identico file creava un
       * secondo profilo lungo quanto il primo (`200 > 0`), accendeva `changed`,
       * e più sotto il secondo profilo veniva ributtato via — ma `changed`
       * restava acceso. Da lì l'immersione veniva riscritta con metriche
       * ricalcolate da `computeMetrics`, che della catena dei tessuti non sa
       * niente: **la saturazione spariva da tutto l'archivio a ogni reimport**,
       * e con lo scarico Bluetooth — che ripresenta sempre l'intera memoria del
       * computer — succedeva a ogni collegamento.
       */
      const piuFitto =
        (candidate?.length ?? 0) > (out.altSamples?.length ?? 0) &&
        (candidate?.length ?? 0) > (out.samples?.length ?? 0);
      if (piuFitto) {
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
      'visibilityMaxM',
      'title',
      'guide',
      'salinity',
      'surfacePressureBar',
      'surfaceIntervalS',
      'weightKg',
      'suit',
    ] as const
  ).forEach(takeIfEmpty);

  /*
   * ► IL FUSO NON SI PRENDE DA UN'IMMERSIONE CON UN ALTRO ORARIO. ◄
   *
   * `utcOffsetMinutes` stava nell'elenco qui sopra, e sembra un campo come gli
   * altri. Non lo è: il fuso non è un dato per conto suo, è la SECONDA METÀ di
   * `startTime`. I due insieme dicono «quel computer segnava le 09:24»;
   * prendere il fuso da una scheda e l'istante da un'altra produce un orario
   * che non è mai esistito su nessun quadrante.
   *
   * Il caso vero, e sarebbe capitato al primo uso dell'unione manuale: le due
   * letture del 24 agosto 2026 avevano `startTime` a un'ora di distanza —
   * Peregrine 09:24:02Z senza fuso, Aladin 08:24:35Z con fuso +60. Tutte e due
   * mostravano le 09:24. Fondendole, la scheda che resta è quella col profilo
   * più ricco (il Peregrine) e da lì `takeIfEmpty` le avrebbe attaccato il +60
   * dell'Aladin: 09:24 + 60 = **10:24**, un'ora che nessuno dei due computer ha
   * mai segnato. Riparando un difetto se ne sarebbe visto nascere un altro,
   * peggiore perché visibile.
   *
   * Quindi il fuso si prende solo quando i due orari sono LO STESSO orario. Un
   * quarto d'ora è la soglia giusta perché è il passo minimo di un fuso: sotto
   * c'è solo lo scarto fra due computer che si accorgono dell'ingresso in acqua
   * a mezzo minuto di distanza; sopra si sta parlando di due letture diverse
   * dell'orologio, e allora il fuso dell'altra non descrive questa.
   */
  if (
    base.utcOffsetMinutes === undefined &&
    incoming.utcOffsetMinutes !== undefined &&
    Math.abs(epoch(base) - epoch(incoming)) < QUARTO_MS
  ) {
    out.utcOffsetMinutes = incoming.utcOffsetMinutes;
    changed = true;
  }

  /*
   * IL BLOCCO `computer` SI FONDE CAMPO PER CAMPO, non tutto o niente.
   *
   * Stava nell'elenco qui sopra, cioè si prendeva solo quando in archivio non
   * c'era NESSUN computer. Sembra prudente e invece perdeva esattamente il dato
   * che serviva di più. Il caso reale: l'archivio conteneva le immersioni
   * importate dal file di LogTRAK PRIMA che il lettore imparasse a calcolare
   * l'impronta del profilo. Quelle righe avevano un `computer` — modello,
   * seriale — e quindi `takeIfEmpty` non toccava niente; reimportare lo stesso
   * file con il lettore nuovo NON scriveva l'impronta. Risultato: l'unico
   * criterio capace di riconoscere una copia con la data corretta a mano
   * restava spento proprio sull'archivio per cui era stato scritto.
   *
   * Si fonde solo quando è lo STESSO computer fisico. Un'immersione registrata
   * da due computer diversi tiene i due blocchi separati — quello che non vince
   * il profilo finisce in `otherComputers` poco più sotto — perché firmware,
   * seriale e impostazioni dell'uno non sono quelli dell'altro.
   */
  if (out.computer && incoming.computer && sameComputer(out.computer, incoming.computer)) {
    const fuso = fondiComputer(out.computer, incoming.computer);
    if (fuso !== out.computer) {
      out.computer = fuso;
      changed = true;
    }
  } else if (!out.computer && incoming.computer) {
    out.computer = incoming.computer;
    changed = true;
  }

  /*
   * `conditions` e `gear` si fondono CAMPO PER CAMPO, non tutto o niente.
   *
   * PERCHÉ NON BASTAVA L'ELENCO QUI SOPRA. `takeIfEmpty` prende il blocco intero
   * quando quello esistente è indefinito: un'immersione che ha già il meteo ma
   * non il mare non prenderebbe il mare dall'altra. Sono due campi che arrivano
   * da strade diverse — il meteo da LogTRAK, il mare scritto a mano dopo — ed è
   * il caso normale, non l'eccezione.
   *
   * E IL COSTO DI SBAGLIARE QUI È ALTO. Il modulo «Aggiungi a mano» costruisce
   * l'identificativo dell'immersione con orario, profondità e durata proprio per
   * riconoscere quella già scaricata dal computer, e quando la riconosce
   * FONDE. Finché questi campi non erano in elenco, ogni titolo, guida,
   * condizione e attrezzatura appena digitati venivano buttati via mentre
   * l'interfaccia annunciava «arricchita».
   */
  /*
   * SI CONTANO I VALORI, NON LE CHIAVI.
   *
   * `{ ...incoming, ...out }` fa vincere l'`undefined` ESPLICITO di `out`, e il
   * confronto sul numero di chiavi non se ne accorge perché la chiave c'era già.
   * Non è un caso di scuola: la modifica in blocco del logbook scrive sempre
   * `weather` E `waves` — anche a `undefined` — e lo stesso fanno il modulo a
   * mano e `manual.ts`. Bastava impostare in blocco il solo meteo perché il mare
   * portato dal file di LogTRAK non entrasse più, cioè esattamente lo scenario
   * che il commento qui sopra dichiara di risolvere.
   */
  const fondiOggetto = <T extends object>(
    esistente: T | undefined,
    arrivo: T | undefined,
  ): { valore: T | undefined; cambiato: boolean } => {
    if (!arrivo) return { valore: esistente, cambiato: false };
    const fuso: Record<string, unknown> = {};
    let cambiato = false;
    for (const k of new Set([...Object.keys(arrivo), ...Object.keys(esistente ?? {})])) {
      const mio = (esistente as Record<string, unknown> | undefined)?.[k];
      const suo = (arrivo as Record<string, unknown>)[k];
      if (mio !== undefined) {
        fuso[k] = mio;
      } else if (suo !== undefined) {
        fuso[k] = suo;
        cambiato = true;
      }
    }
    return { valore: (Object.keys(fuso).length ? fuso : undefined) as T | undefined, cambiato };
  };

  const cond = fondiOggetto(out.conditions, incoming.conditions);
  if (cond.cambiato) {
    out.conditions = cond.valore;
    changed = true;
  }
  const attr = fondiOggetto(out.gear, incoming.gear);
  if (attr.cambiato) {
    out.gear = attr.valore;
    changed = true;
  }

  // `reported` e `annotations` si fondono per chiave: due computer possono
  // contribuire pezzi diversi della stessa immersione, e prendere il primo blocco
  // intero butterebbe via quello che ha solo l'altro.
  const rep = fondiOggetto(out.reported, incoming.reported);
  if (rep.cambiato) {
    out.reported = rep.valore;
    changed = true;
  }
  const ann = fondiOggetto(out.annotations, incoming.annotations);
  if (ann.cambiato) {
    out.annotations = ann.valore;
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
    /*
     * Il confronto è sul CONTENUTO, non sulla lunghezza.
     *
     * Con `merged.length !== out.otherComputers.length` l'arricchimento si
     * perdeva proprio nel caso utile: quando il computer in arrivo si FONDE con
     * una voce già presente invece di aggiungersene una, la lunghezza non
     * cambia, l'assegnazione non avveniva, e seriale, firmware e passo di
     * campionamento venivano scartati — mentre `extraSources` continuava a
     * dichiarare che quella fonte aveva contribuito.
     */
    if (JSON.stringify(merged) !== JSON.stringify(out.otherComputers ?? [])) {
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
