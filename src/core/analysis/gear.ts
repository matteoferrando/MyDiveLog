/**
 * Attrezzatura, brevetti e configurazione.
 *
 * RIFATTO DA ZERO ad agosto 2026, e vale la pena scrivere perché.
 *
 * La prima versione era una lista sola con nove tipi dentro — bombola, erogatore,
 * jacket, computer, muta, brevetto, certificato medico, assicurazione, altro — e
 * un solo meccanismo: «ultima data + ogni quanti mesi = scadenza», con un pallino
 * rosso quando era passata. Sembra economico e invece era sbagliato due volte.
 *
 * Sbagliato perché metteva nella stessa riga cose che non hanno niente in comune.
 * Un brevetto NON scade e non si revisiona: è ciò che ti autorizza a fare certe
 * immersioni, e il posto dove serve è la scheda di prontezza del Coach, non un
 * elenco di manutenzioni. Un erogatore si revisiona ma non ha una scadenza secca:
 * ha un intervallo consigliato dal costruttore, e superarlo di due mesi non è
 * come dimenticare di rinnovare un'assicurazione. Chiedere all'utente di
 * esprimere entrambe le cose con «lastServiceDate + intervalMonths» significava
 * costringerlo a mentire su una delle due.
 *
 * E sbagliato perché trasformava un archivio in un elenco di rimproveri. Le
 * scadenze scadono, e un'applicazione che apri per guardare le tue immersioni ti
 * accoglieva con tre pallini rossi su cose che sai benissimo. Questa versione non
 * ha avvisi: registra e mostra i fatti — quando è stata l'ultima revisione,
 * quanto tempo è passato — e lascia il giudizio a chi legge, che è l'unico ad
 * avere il contesto per darlo.
 *
 * Tre gruppi, tre forme diverse, perché sono tre cose diverse:
 *
 *  - `Equipment`: quello che porti in acqua e che si collauda o si revisiona.
 *  - `Certification`: i brevetti. Nessuna data di scadenza, e un livello che il
 *    Coach può leggere.
 *  - La configurazione di zavorra NON è una terza lista da compilare: si RICAVA
 *    dalle immersioni, che già portano `weightKg` e `suit`. Vedi `weightingBySuit`.
 */

import type { Dive } from '../model';

// ---------------------------------------------------------------------------
// 1. Quello che porti in acqua
// ---------------------------------------------------------------------------

export type EquipmentKind = 'cylinder' | 'regulator' | 'bcd' | 'computer' | 'suit' | 'light' | 'other';

export const EQUIPMENT_LABEL: Record<EquipmentKind, string> = {
  cylinder: 'Bombola',
  regulator: 'Erogatore',
  bcd: 'Jacket o sacco',
  computer: 'Computer',
  suit: 'Muta',
  light: 'Illuminazione',
  other: 'Altro',
};

/**
 * Che tipo di manutenzione vuole questo pezzo. Non «ogni quanti mesi»: che
 * COSA. La differenza conta perché i tre casi si comportano diversamente e
 * l'interfaccia deve chiedere cose diverse.
 */
export type ServiceKind =
  /** Collaudo idraulico: obbligatorio per legge, ha una periodicità di norma. */
  | 'hydro'
  /** Revisione del costruttore: consigliata, non obbligatoria. */
  | 'overhaul'
  /** Batteria o cambio pile: si fa quando serve, non a calendario. */
  | 'battery'
  /** Niente: una muta o una torcia non si revisionano. */
  | 'none';

export const SERVICE_LABEL: Record<ServiceKind, string> = {
  hydro: 'Collaudo idraulico',
  overhaul: 'Revisione',
  battery: 'Batteria',
  none: 'Nessuna manutenzione periodica',
};

/**
 * La manutenzione TIPICA per tipo, come suggerimento di partenza. Non una regola
 * e non un obbligo: il collaudo delle bombole segue la normativa del paese, la
 * revisione degli erogatori il libretto del costruttore, e ogni pezzo può dire
 * la sua.
 */
export const TYPICAL_SERVICE: Record<EquipmentKind, ServiceKind> = {
  cylinder: 'hydro',
  regulator: 'overhaul',
  bcd: 'overhaul',
  computer: 'battery',
  suit: 'none',
  light: 'battery',
  other: 'none',
};

/** Ogni quanti mesi, tipicamente. Solo un valore iniziale del modulo. */
export const TYPICAL_INTERVAL_MONTHS: Partial<Record<EquipmentKind, number>> = {
  cylinder: 24,
  regulator: 12,
  bcd: 12,
};

export interface Equipment {
  id: string;
  kind: EquipmentKind;
  /** Marca e modello, come lo chiami tu: «Apeks XTX50», «D12 200 bar». */
  name: string;
  /** Matricola: sulle bombole è quello che il centro ricarica legge. */
  serial?: string;
  /** Quando l'hai preso, `YYYY-MM-DD`. Facoltativo, e non genera niente. */
  boughtOn?: string;
  service: ServiceKind;
  /** Ultima manutenzione fatta, `YYYY-MM-DD`. */
  lastServiceOn?: string;
  /** Ogni quanti mesi andrebbe rifatta, secondo il costruttore o la norma. */
  intervalMonths?: number;
  /** Litri, per le bombole. */
  sizeL?: number;
  /** Pressione di esercizio in bar, per le bombole. */
  workingBar?: number;
  notes?: string;
  /** Vero se non lo usi più: resta in archivio ma fuori dall'elenco attivo. */
  retired?: boolean;
  /** Solo per la sincronizzazione: senza, non saprebbe quale versione tenere. */
  savedAt?: string;
}

// ---------------------------------------------------------------------------
// 2. I brevetti
// ---------------------------------------------------------------------------

/**
 * Il livello, in una scala che il Coach possa leggere.
 *
 * Le didattiche hanno nomi diversi per la stessa cosa — Advanced Open Water,
 * Two Star, Advanced Diver — e mettere in ordine trenta nomi commerciali è una
 * battaglia persa. Quello che serve al Coach è: fino a che profondità sei
 * addestrato, e sai gestire una decompressione. Questi cinque scalini rispondono.
 */
export type CertLevel = 'base' | 'advanced' | 'deep' | 'nitrox' | 'tech';

export const CERT_LEVEL_LABEL: Record<CertLevel, string> = {
  base: 'Primo livello (fino a 18 m)',
  advanced: 'Avanzato (fino a 30 m)',
  deep: 'Profondo (fino a 40 m)',
  nitrox: 'Nitrox / miscele',
  tech: 'Tecnico (decompressione)',
};

export interface Certification {
  id: string;
  /** PADI, SSI, CMAS, TDI, FIPSAS… testo libero: le didattiche sono decine. */
  agency: string;
  /** Il nome commerciale, come sta scritto sulla tessera. */
  name: string;
  level: CertLevel;
  /** Quando l'hai preso, `YYYY-MM-DD`. */
  issuedOn?: string;
  /** Numero della tessera. */
  number?: string;
  instructor?: string;
  notes?: string;
  savedAt?: string;
}

// ---------------------------------------------------------------------------
// 3. Zavorra e configurazione, ricavate dalle immersioni
// ---------------------------------------------------------------------------

export interface WeightingRow {
  /** La muta come l'hai scritta nelle immersioni. */
  suit: string;
  dives: number;
  /** Zavorra mediana con questa muta, kg. */
  medianKg: number;
  minKg: number;
  maxKg: number;
  /**
   * Oscillazione mediana a quota tenuta con questa configurazione, m/min.
   *
   * È il motivo per cui questa tabella esiste e non è un modulo da compilare:
   * l'app misura già l'assetto su ogni immersione con un profilo, quindi può
   * dire quale zavorra ti ha fatto tenere meglio la quota — che è la domanda
   * vera, e nessun elenco di attrezzatura può risponderla.
   */
  medianTrimMpm?: number;
  /** Su quante immersioni si basa l'assetto: può essere meno di `dives`. */
  trimBasis: number;
  /**
   * Quante di queste immersioni portavano anche una piastra o uno schienalino.
   *
   * Serve a leggere la riga: se la mediana è di 3 kg e su metà delle
   * immersioni c'era una piastra d'acciaio dentro il conto, la dispersione fra
   * minimo e massimo non è incoerenza tua — sono due configurazioni diverse
   * finite nella stessa riga.
   */
  withBackplate: number;
}

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * La zavorra usata con ciascuna muta, misurata sulle immersioni fatte.
 *
 * Non chiede niente a nessuno: `weightKg` e `suit` sono già nel modello e i
 * parser li leggono quando ci sono. Le immersioni senza uno dei due restano
 * fuori, e la riga dichiara quante ne ha usate — perché «6 kg» su tre immersioni
 * e «6 kg» su quaranta sono due affermazioni diverse.
 */
export function weightingBySuit(dives: Dive[], minDives = 2): WeightingRow[] {
  const byS = new Map<string, { kg: number[]; trim: number[]; piastre: number }>();
  for (const d of dives) {
    const suit = d.suit?.trim() || d.gear?.suit?.name?.trim();
    if (!suit || d.weightKg === undefined || !(d.weightKg > 0)) continue;
    const row = byS.get(suit) ?? { kg: [], trim: [], piastre: 0 };
    row.kg.push(zavorraTotaleKg(d));
    if (d.gear?.backplateKg) row.piastre++;
    const trim = d.metrics?.bottomVerticalTravelMpm;
    if (trim !== undefined && Number.isFinite(trim)) row.trim.push(trim);
    byS.set(suit, row);
  }
  return [...byS.entries()]
    .filter(([, r]) => r.kg.length >= minDives)
    .map(([suit, r]) => ({
      suit,
      dives: r.kg.length,
      medianKg: Math.round(median(r.kg) * 10) / 10,
      minKg: Math.min(...r.kg),
      maxKg: Math.max(...r.kg),
      medianTrimMpm: r.trim.length ? Math.round(median(r.trim) * 10) / 10 : undefined,
      trimBasis: r.trim.length,
      withBackplate: r.piastre,
    }))
    .sort((a, b) => b.dives - a.dives);
}

/**
 * Quante immersioni ha fatto ogni attrezzo, e quante dall'ultima manutenzione.
 *
 * È LA DOMANDA PER CUI L'INVENTARIO ESISTE. Un elenco di attrezzi con le date di
 * revisione lo si può tenere su un foglio; quello che il foglio non sa dire è
 * «questo erogatore ha fatto sessanta immersioni da quando l'ho fatto
 * revisionare», che è il numero con cui si decide davvero — la norma parla di
 * mesi, l'usura conta le immersioni, e un erogatore fermo in cantina per un anno
 * non è nella stessa condizione di uno che ha fatto tre viaggi.
 *
 * Fatti, nessun giudizio: non c'è nessuna soglia oltre la quale l'app dica «vai
 * a revisionarlo». Quel giudizio lo dà chi sa in che acqua l'ha usato e come
 * l'ha risciacquato.
 *
 * L'aggancio è per identificativo, e per identificativo soltanto: due voci
 * scritte «Apeks XTX50» e «apeks xtx 50» sarebbero due attrezzi diversi, ed è il
 * motivo per cui la scheda immersione fa scegliere dall'elenco invece di far
 * scrivere il nome ogni volta.
 */
export interface EquipmentUsage {
  id: string;
  dives: number;
  /** Immersioni fatte DOPO l'ultima manutenzione. Assente se non è mai stata fatta. */
  divesSinceService?: number;
  /** L'ultima immersione con questo attrezzo, ISO. */
  lastUsedOn?: string;
}

/** Il giorno di calendario del LUOGO dell'immersione, `YYYY-MM-DD`. */
function giornoLocale(d: Pick<Dive, 'startTime' | 'utcOffsetMinutes'>): string {
  const t = Date.parse(d.startTime);
  if (Number.isNaN(t)) return d.startTime.slice(0, 10);
  return new Date(t + (d.utcOffsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10);
}

export function equipmentUsage(dives: Dive[], equipment: Equipment[]): Map<string, EquipmentUsage> {
  const out = new Map<string, EquipmentUsage>();
  for (const e of equipment) out.set(e.id, { id: e.id, dives: 0 });

  /*
   * Con due voci dello stesso identificativo vince quella che HA la data.
   *
   * `new Map(...)` tiene l'ultima, e se l'ultima è la copia senza revisione il
   * contatore mostra «0 dall'ultima» su un attrezzo che ne ha fatte dieci. Un
   * inventario con id ripetuti non dovrebbe esistere, ma nasce da solo
   * ripristinando un backup su un archivio che ha già le stesse voci.
   */
  const service = new Map<string, string | undefined>();
  for (const e of equipment) {
    if (e.lastServiceOn || !service.has(e.id)) service.set(e.id, e.lastServiceOn ?? service.get(e.id));
  }

  for (const d of dives) {
    const g = d.gear;
    if (!g) continue;
    const riferimenti = [...(g.regulators ?? []), g.bcd, g.suit, ...(g.other ?? [])];
    // Lo stesso attrezzo citato due volte nella stessa immersione conta UNA
    // volta: un erogatore messo per sbaglio in entrambi i campi raddoppierebbe
    // il conto delle sue immersioni, e quel numero deve poter essere creduto.
    for (const id of new Set(riferimenti.map((r) => r?.id).filter((x): x is string => !!x))) {
      const u = out.get(id);
      if (!u) continue;
      u.dives++;
      if (!u.lastUsedOn || d.startTime > u.lastUsedOn) u.lastUsedOn = d.startTime;
      const dal = service.get(id);
      if (dal) {
        /*
         * IL CONFRONTO È SUL GIORNO DEL LUOGO, non su quello UTC.
         *
         * `startTime` è sempre in UTC — lo scrivono così tutti i parser — mentre
         * `lastServiceOn` è un giorno di calendario scritto a mano. Prendendo i
         * primi dieci caratteri dell'istante UTC, un'immersione fatta alle nove
         * del mattino a Kiritimati (UTC+14) cade nel giorno PRECEDENTE, e una
         * fatta alle otto di sera alle Hawaii nel giorno successivo. Il conto
         * delle immersioni dall'ultima revisione — che è il numero per cui
         * l'inventario esiste — saltava di uno, e in quale direzione dipendeva da
         * dove si era andati a immergersi.
         */
        if (giornoLocale(d) > dal) u.divesSinceService = (u.divesSinceService ?? 0) + 1;
      }
    }
  }

  // Zero immersioni dall'ultima revisione è un'informazione; `undefined` è
  // un'altra cosa e vuol dire «revisione mai registrata».
  for (const e of equipment) {
    if (e.lastServiceOn) {
      const u = out.get(e.id);
      if (u && u.divesSinceService === undefined) u.divesSinceService = 0;
    }
  }
  return out;
}

/**
 * Il peso che ti tira giù DAVVERO: zavorra più piastra.
 *
 * Sono due campi separati perché si comportano in modo diverso — la zavorra la
 * cambi a ogni immersione secondo muta e acqua, la piastra è fissa e te la porti
 * sempre — ma per l'assetto contano insieme, e vanno sommati ovunque si
 * ragioni di quanto peso avevi addosso.
 *
 * Tenerli separati e poi dimenticarsi di sommarli è il difetto peggiore dei due
 * campi: chi ha una piastra d'acciaio da 3 kg e scrive «2 kg di zavorra» ne
 * porta cinque, e una statistica che legge solo `weightKg` racconta il
 * contrario di quello che succede in acqua.
 */
export function zavorraTotaleKg(dive: Pick<Dive, 'weightKg' | 'gear'>): number {
  return (dive.weightKg ?? 0) + (dive.gear?.backplateKg ?? 0);
}

/**
 * La configurazione usata, ricavata dal numero di bombole per immersione.
 *
 * Grossolana di proposito: distinguere un bibombola da due mono in sidemount
 * guardando il log non si può, e inventare la distinzione sarebbe peggio che
 * ammetterla. Serve a rispondere «quante immersioni ho fatto con più di una
 * bombola», che è l'unica cosa che il log sa davvero.
 */
export function configurationRows(dives: Dive[]): { label: string; dives: number }[] {
  const counts = new Map<string, number>();
  for (const d of dives) {
    const n = d.cylinders.length;
    const label =
      d.mode === 'ccr'
        ? 'Rebreather a circuito chiuso'
        : d.mode === 'scr'
          ? 'Rebreather semichiuso'
          : n === 0
            ? 'Bombole non registrate'
            : n === 1
              ? 'Una bombola'
              : n === 2
                ? 'Due bombole'
                : `${n} bombole`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, dives]) => ({ label, dives })).sort((a, b) => b.dives - a.dives);
}

// ---------------------------------------------------------------------------
// Fatti sulla manutenzione, senza giudizio
// ---------------------------------------------------------------------------

/** Somma mesi a una data ISO, tenendo i giorni impossibili dentro il mese giusto. */
export function addMonths(date: string, months: number): string | undefined {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return undefined;
  const d = new Date(t);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

export interface ServiceFacts {
  /** Mesi passati dall'ultima manutenzione. Assente se non c'è una data. */
  monthsSince?: number;
  /** Quando cadrebbe la prossima, secondo l'intervallo dichiarato. */
  nextOn?: string;
  /** Mesi da oggi alla prossima: negativo se è già passata. */
  monthsToNext?: number;
}

/**
 * I fatti sulla manutenzione di un pezzo.
 *
 * Restituisce NUMERI e non uno stato — niente `'ok' | 'due' | 'expired'`. È la
 * differenza fra questa versione e quella prima: uno stato è un giudizio, e per
 * darlo servirebbe sapere cose che l'applicazione non sa (se la bombola è ferma
 * in garage da un anno, se l'erogatore l'hai usato in piscina o in Egitto, se il
 * tuo centro fa la revisione ogni due anni). Chi legge ha quel contesto; questa
 * funzione gli dà i numeri e sta zitta.
 */
export function serviceFacts(item: Equipment, now = Date.now()): ServiceFacts {
  if (item.service === 'none' || !item.lastServiceOn) return {};
  const last = Date.parse(item.lastServiceOn);
  if (Number.isNaN(last)) return {};
  const MONTH = 30.44 * 24 * 3600 * 1000;
  const monthsSince = Math.max(0, Math.round((now - last) / MONTH));
  if (!item.intervalMonths || item.intervalMonths <= 0) return { monthsSince };
  const nextOn = addMonths(item.lastServiceOn, item.intervalMonths);
  const monthsToNext = nextOn ? Math.round((Date.parse(nextOn) - now) / MONTH) : undefined;
  return { monthsSince, nextOn, monthsToNext };
}

/** In quale ordine mostrare i pezzi: prima quelli in uso, poi per tipo e nome. */
export function sortEquipment(items: Equipment[]): Equipment[] {
  const order: EquipmentKind[] = ['cylinder', 'regulator', 'bcd', 'computer', 'suit', 'light', 'other'];
  return [...items].sort((a, b) => {
    if (!!a.retired !== !!b.retired) return a.retired ? 1 : -1;
    const k = order.indexOf(a.kind) - order.indexOf(b.kind);
    return k !== 0 ? k : a.name.localeCompare(b.name, 'it');
  });
}

/** Dal più recente: un brevetto si legge in ordine di conquista, al contrario. */
export function sortCertifications(items: Certification[]): Certification[] {
  return [...items].sort((a, b) => (b.issuedOn ?? '').localeCompare(a.issuedOn ?? ''));
}

/**
 * Il livello più alto raggiunto, per il Coach.
 *
 * `undefined` quando non c'è nessun brevetto registrato: la scheda di prontezza
 * deve poter dire «non lo so» invece di assumere il primo livello, che sarebbe
 * un'affermazione su di te che nessuno ha fatto.
 */
export function highestLevel(certs: Certification[]): CertLevel | undefined {
  const rank: CertLevel[] = ['base', 'advanced', 'deep', 'nitrox', 'tech'];
  let best = -1;
  for (const c of certs) {
    const i = rank.indexOf(c.level);
    if (i > best) best = i;
  }
  return best < 0 ? undefined : rank[best];
}

// ---------------------------------------------------------------------------
// Migrazione dalla versione vecchia
// ---------------------------------------------------------------------------

/** La forma vecchia, tenuta solo per poterla leggere e convertire. */
export interface LegacyGearItem {
  id: string;
  kind: string;
  name: string;
  serial?: string;
  lastServiceDate?: string;
  intervalMonths?: number;
  expiresOn?: string;
  notes?: string;
  savedAt?: string;
}

export interface GearArchive {
  equipment: Equipment[];
  certifications: Certification[];
}

/**
 * Converte l'elenco unico della versione vecchia nei due elenchi nuovi.
 *
 * Le voci che erano brevetti diventano brevetti; certificato medico e
 * assicurazione — che nella versione nuova non esistono più come categoria,
 * perché l'utente ha chiesto di non essere avvisato di niente — NON si buttano:
 * finiscono fra le attrezzature con `service: 'none'` e la loro data nelle note,
 * così nessun dato scritto a mano va perduto. Buttare silenziosamente qualcosa
 * che qualcuno ha digitato è il modo più rapido di far perdere fiducia a
 * un'applicazione.
 */
export function migrateGear(legacy: LegacyGearItem[] | GearArchive | null | undefined): GearArchive {
  if (!legacy) return { equipment: [], certifications: [] };
  if (!Array.isArray(legacy)) return legacy;

  const equipment: Equipment[] = [];
  const certifications: Certification[] = [];

  for (const old of legacy) {
    if (old.kind === 'certification') {
      certifications.push({
        id: old.id,
        agency: '',
        name: old.name,
        // Il livello non si può indovinare dal nome commerciale: si mette il
        // primo e si lascia correggere. Fingere di saperlo sarebbe peggio.
        level: 'base',
        issuedOn: old.lastServiceDate,
        number: old.serial,
        notes: old.notes,
        savedAt: old.savedAt,
      });
      continue;
    }
    const kind: EquipmentKind = (
      ['cylinder', 'regulator', 'bcd', 'computer', 'suit', 'light'] as string[]
    ).includes(old.kind)
      ? (old.kind as EquipmentKind)
      : 'other';
    const scaduto = old.kind === 'medical' || old.kind === 'insurance';
    const scadenza =
      old.expiresOn ??
      (old.lastServiceDate && old.intervalMonths
        ? addMonths(old.lastServiceDate, old.intervalMonths)
        : undefined);
    equipment.push({
      id: old.id,
      kind,
      name: scaduto
        ? `${old.kind === 'medical' ? 'Certificato medico' : 'Assicurazione'} — ${old.name}`
        : old.name,
      serial: old.serial,
      service: scaduto ? 'none' : TYPICAL_SERVICE[kind],
      lastServiceOn: scaduto ? undefined : old.lastServiceDate,
      intervalMonths: scaduto ? undefined : old.intervalMonths,
      notes:
        [
          old.notes,
          scaduto && scadenza ? `Scadenza registrata nella versione precedente: ${scadenza}` : undefined,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      savedAt: old.savedAt,
    });
  }
  return { equipment, certifications };
}
