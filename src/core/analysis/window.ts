/**
 * Finestra temporale dell'analisi.
 *
 * PERCHÉ ESISTE. Statistiche e piano di miglioramento hanno senso su un periodo
 * recente. Un consumo medio calcolato su sei anni mescola il subacqueo di oggi con
 * quello del primo anno di brevetto, e la media che ne esce non descrive nessuno
 * dei due: nasconde i progressi e giudica il presente sul passato. Lo stesso vale
 * per il piano, che dovrebbe dire cosa fare adesso.
 *
 * La finestra predefinita è **dodici mesi**: abbastanza lunga da coprire tutte le
 * stagioni — l'acqua fredda cambia il consumo — e abbastanza corta da descrivere
 * come si immerge una persona oggi.
 *
 * L'ARCHIVIO NON VIENE FILTRATO. Il logbook mostra sempre tutto: lì il dato
 * completo è il punto. La finestra riguarda solo ciò che viene *interpretato*.
 */

import type { Dive } from '../model';

export type PeriodId = '6m' | '12m' | '24m' | 'all';

export interface Period {
  id: PeriodId;
  label: string;
  /** Mesi indietro, `undefined` per tutto l'archivio. */
  months?: number;
  description: string;
}

export const PERIODS: Period[] = [
  {
    id: '6m',
    label: 'Ultimi 6 mesi',
    months: 6,
    description: 'La stagione in corso. Poche immersioni, quindi tendenze fragili.',
  },
  {
    id: '12m',
    label: 'Ultimi 12 mesi',
    months: 12,
    description: 'Un anno completo: copre tutte le stagioni e descrive come ti immergi adesso.',
  },
  {
    id: '24m',
    label: 'Ultimi 24 mesi',
    months: 24,
    description: 'Due stagioni a confronto: utile per vedere se un cambiamento è durato.',
  },
  {
    id: 'all',
    label: 'Tutto l’archivio',
    description:
      'Tutte le immersioni. Le medie mescolano periodi diversi della tua storia, quindi descrivono la storia e non il presente.',
  },
];

export const DEFAULT_PERIOD: PeriodId = '12m';

export function periodOf(id: PeriodId): Period {
  return PERIODS.find((p) => p.id === id) ?? PERIODS[1];
}

export interface Scope {
  period: Period;
  dives: Dive[];
  /** Immersioni escluse dalla finestra. */
  excluded: number;
  /** Estremi effettivi delle immersioni incluse, ISO. */
  from?: string;
  to?: string;
}

/**
 * Applica la finestra.
 *
 * Il taglio parte da ADESSO e non dall'ultima immersione: se non ti immergi da
 * otto mesi, "ultimi 12 mesi" deve contenere quattro mesi di attività e dirlo, non
 * spostare silenziosamente la finestra indietro fino a trovare dei dati. Un
 * periodo che si allunga da sé per riempirsi non è una finestra temporale, è un
 * numero di immersioni con un'etichetta sbagliata.
 */
export function applyPeriod(dives: Dive[], id: PeriodId, now: number = Date.now()): Scope {
  const period = periodOf(id);
  const sorted = [...dives].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  if (period.months === undefined) {
    return {
      period,
      dives: sorted,
      excluded: 0,
      from: sorted[0]?.startTime,
      to: sorted[sorted.length - 1]?.startTime,
    };
  }
  // `setMonth` normalizza le date impossibili: eseguito il 31 agosto, "ultimi 6
  // mesi" passa per il 31 febbraio e finisce al 3 marzo, accorciando la finestra
  // di tre giorni senza dirlo. Qui il giorno viene riportato all'ultimo giorno
  // valido del mese di arrivo, che è ciò che "sei mesi fa" significa.
  const ref = new Date(now);
  const targetMonth = ref.getUTCMonth() - period.months;
  const lastDayOfTarget = new Date(Date.UTC(ref.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
  const cutoffMs = Date.UTC(
    ref.getUTCFullYear(),
    targetMonth,
    Math.min(ref.getUTCDate(), lastDayOfTarget),
    ref.getUTCHours(),
    ref.getUTCMinutes(),
    ref.getUTCSeconds(),
  );
  const kept = sorted.filter((d) => Date.parse(d.startTime) >= cutoffMs);
  return {
    period,
    dives: kept,
    excluded: sorted.length - kept.length,
    from: kept[0]?.startTime,
    to: kept[kept.length - 1]?.startTime,
  };
}

/**
 * Sotto questa soglia una finestra non regge un'analisi, e conviene dirlo invece
 * di mostrare medie costruite su tre immersioni.
 */
export const MIN_DIVES_FOR_ANALYSIS = 8;
