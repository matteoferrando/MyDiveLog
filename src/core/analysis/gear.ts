/**
 * Attrezzatura e scadenze.
 *
 * PERCHÉ IN UN LOGBOOK. Perché le date che contano si dimenticano tutte allo
 * stesso modo, e sono le uniche informazioni di questo progetto che hanno una
 * conseguenza *prima* dell'immersione invece che dopo: un collaudo scaduto ferma
 * la ricarica, un certificato medico scaduto ferma il corso. Il logbook sa già
 * quando ti immergi, quindi sa anche quali revisioni scadono prima della prossima
 * uscita — che è la sola forma utile di questa informazione.
 *
 * COSA NON FA. Non inventa gli intervalli: quanto duri una revisione lo decide il
 * costruttore o la normativa, cambia da paese a paese e da attrezzo ad attrezzo, e
 * qui si scrive a mano. I valori proposti sono quelli comuni in Italia, dichiarati
 * come proposte e non come regole.
 */

export type GearKind =
  | 'cylinder'
  | 'regulator'
  | 'bcd'
  | 'computer'
  | 'suit'
  | 'certification'
  | 'medical'
  | 'insurance'
  | 'other';

export const GEAR_LABEL: Record<GearKind, string> = {
  cylinder: 'Bombola',
  regulator: 'Erogatore',
  bcd: 'Jacket',
  computer: 'Computer',
  suit: 'Muta',
  certification: 'Brevetto',
  medical: 'Certificato medico',
  insurance: 'Assicurazione',
  other: 'Altro',
};

/**
 * Intervalli proposti, in mesi. Sono i valori comuni in Italia e non una regola:
 * il collaudo idraulico delle bombole segue la normativa vigente, la revisione
 * degli erogatori il costruttore. Si possono cambiare per ogni singolo pezzo.
 */
export const SUGGESTED_INTERVAL_MONTHS: Partial<Record<GearKind, number>> = {
  cylinder: 24,
  regulator: 12,
  bcd: 12,
  medical: 12,
  insurance: 12,
};

export interface GearItem {
  id: string;
  kind: GearKind;
  name: string;
  /** Numero di serie o matricola: sulle bombole è ciò che il centro ricarica legge. */
  serial?: string;
  /** Data dell'ultima revisione o del rilascio, `YYYY-MM-DD`. */
  lastServiceDate?: string;
  /** Ogni quanti mesi va rifatta. Zero o assente: non scade. */
  intervalMonths?: number;
  /** Scadenza dichiarata esplicitamente, quando non deriva da un intervallo. */
  expiresOn?: string;
  notes?: string;
  /**
   * Quando questo pezzo è stato scritto l'ultima volta, ISO 8601.
   *
   * Non serve a chi lo legge: serve alla sincronizzazione, che fonde le liste
   * pezzo per pezzo e senza una data non saprebbe quale delle due versioni dello
   * stesso erogatore tenere.
   */
  savedAt?: string;
}

export type GearStatus = 'ok' | 'due' | 'expired' | 'unknown';

export interface GearCheck {
  item: GearItem;
  status: GearStatus;
  /** Quando scade, `YYYY-MM-DD`. */
  dueDate?: string;
  /** Giorni da oggi: negativo se è già scaduta. */
  daysLeft?: number;
}

/** Entro quanti giorni una scadenza si considera imminente. */
export const DUE_SOON_DAYS = 60;

/** Somma mesi a una data ISO, tenendo i giorni impossibili dentro il mese giusto. */
export function addMonths(date: string, months: number): string | undefined {
  const [y, m, d] = date.split('-').map(Number);
  // Una data scritta male non deve far cadere l'intera schermata.
  //
  // `new Date(NaN).toISOString()` lancia `RangeError`, e l'eccezione usciva da
  // `gearChecks` fino a `nextDiveBriefing`, che sta in cima al logbook: un campo
  // compilato a mano con «giugno 2025» rendeva inutilizzabile la prima pagina.
  // Qui una data illeggibile diventa «nessuna scadenza», che è la verità.
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return undefined;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  // Il 31 gennaio più un mese è il 28 o il 29 febbraio, non il 3 marzo: senza
  // questo, una scadenza a fine mese slitterebbe di qualche giorno ogni volta.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function checkGear(item: GearItem, now = Date.now()): GearCheck {
  const dueDate =
    item.expiresOn ??
    (item.lastServiceDate && item.intervalMonths
      ? addMonths(item.lastServiceDate, item.intervalMonths)
      : undefined);

  if (!dueDate || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`))) {
    return { item, status: 'unknown' };
  }

  const daysLeft = Math.floor((Date.parse(`${dueDate}T00:00:00Z`) - now) / 86_400_000);
  const status: GearStatus = daysLeft < 0 ? 'expired' : daysLeft <= DUE_SOON_DAYS ? 'due' : 'ok';
  return { item, status, dueDate, daysLeft };
}

/**
 * Le scadenze in ordine di urgenza: prima le scadute, poi le imminenti.
 *
 * Quelle senza data restano in fondo e non spariscono: un pezzo senza scadenza
 * registrata non è un pezzo a posto, è un pezzo di cui non si sa niente.
 */
export function gearChecks(items: GearItem[], now = Date.now()): GearCheck[] {
  const order: Record<GearStatus, number> = { expired: 0, due: 1, ok: 2, unknown: 3 };
  return items
    .map((item) => checkGear(item, now))
    .sort((a, b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity);
    });
}

/** Quanti pezzi sono scaduti o stanno per scadere: il numero da mettere in evidenza. */
export function gearSummary(items: GearItem[], now = Date.now()): {
  expired: number;
  due: number;
  unknown: number;
  next?: GearCheck;
} {
  const checks = gearChecks(items, now);
  return {
    expired: checks.filter((c) => c.status === 'expired').length,
    due: checks.filter((c) => c.status === 'due').length,
    unknown: checks.filter((c) => c.status === 'unknown').length,
    next: checks.find((c) => c.status === 'due' || c.status === 'expired'),
  };
}
