/**
 * Esposizione all'ossigeno: CNS % e OTU.
 *
 * DA DOVE VENGONO QUESTI NUMERI. Sono le tabelle NOAA come le riportano i manuali
 * TDI: *Advanced Nitrox* (ed. 2013) p. 32 e p. 37, e *Decompression Procedures*
 * (ed. 2011) p. 56, p. 177 e p. 179. Non sono un modello: sono una tabella di
 * consultazione e una formula, e il valore di implementarle sta tutto nel
 * riportarle esatte.
 *
 * LE DUE COSE SONO DIVERSE. Il CNS misura il rischio di crisi convulsiva ed è
 * governato dalla PPO2 *e dal tempo a quella PPO2*; si dimezza ogni 90 minuti in
 * superficie. L'OTU misura il danno polmonare cumulativo, non ha nessun recupero
 * fra un'immersione e l'altra, e si somma di giorno in giorno. Un'app che ne
 * mostra uno solo racconta metà della storia.
 *
 * UNA CONTRADDIZIONE NEI MANUALI, RISOLTA E DICHIARATA. Per il CNS esistono due
 * colonne: il limite per singola esposizione e quello sulle 24 ore. A 1.6 bar la
 * prima dà 45 minuti, la seconda 150 — un fattore 3.3. *Decompression Procedures*
 * a p. 178 istruisce a calcolare il CNS% con la colonna delle 24 ore, ma la
 * tabella DSAT stampata sulle tabelle da immersione e tutti i computer subacquei
 * usano quella per singola esposizione. Qui si usa quella per **singola
 * esposizione**, perché è la convenzione con cui il numero sarà confrontato: chi
 * legge un 40% sul computer si aspetta lo stesso 40% qui. Il conteggio sulle 24
 * ore resta disponibile a parte, come vuole il manuale (*Advanced Nitrox* p. 37:
 * il limite giornaliero non ammette dimezzamenti, si somma e basta).
 */

import type { GasMix, Salinity, Sample } from '../model';
import { ambientBar } from '../units';

/**
 * Limiti NOAA per **singola esposizione**, minuti al 100%.
 * TDI *Decompression Procedures* p. 56 (colonna sinistra); identici alla tabella
 * DSAT stampata sulle tabelle PADI.
 */
export const CNS_SINGLE_LIMITS: [ppo2: number, minutes: number][] = [
  [0.6, 720],
  [0.7, 570],
  [0.8, 450],
  [0.9, 360],
  [1.0, 300],
  [1.1, 240],
  [1.2, 210],
  [1.3, 180],
  [1.4, 150],
  [1.5, 120],
  [1.6, 45],
];

/**
 * Limiti NOAA sulle **24 ore**, minuti al 100%.
 * TDI *Decompression Procedures* p. 56 (colonna destra) e p. 178.
 *
 * A 0.7 bar i due manuali non concordano: 570 minuti in *Decompression
 * Procedures* p. 56 e p. 178, 540 nella card di *Advanced Nitrox* p. 32. Tutte le
 * altre righe coincidono. Qui sta 570, che è il valore che compare due volte su
 * tre; la differenza vale l'1% di dose su un'ora a quella PPO2.
 */
export const CNS_DAILY_LIMITS: [ppo2: number, minutes: number][] = [
  [0.6, 720],
  [0.7, 570],
  [0.8, 450],
  [0.9, 360],
  [1.0, 300],
  [1.1, 270],
  [1.2, 240],
  [1.3, 210],
  [1.4, 180],
  [1.5, 180],
  [1.6, 150],
];

/** Sotto questa PPO2 i manuali non danno limiti: non si conta, e non si inventa. */
export const CNS_FLOOR_PPO2 = 0.6;
/** Oltre questa PPO2 la tabella finisce. */
export const CNS_TOP_PPO2 = 1.6;
/** Emivita del CNS in superficie, minuti (Advanced Nitrox p. 33-34, Deco p. 178). */
export const CNS_HALF_LIFE_MIN = 90;
/** Dose giornaliera adottata da TDI per giorni multipli (Advanced Nitrox p. 37). */
export const OTU_DAILY_TDI = 300;
/** Limite accettato dalla comunità tecnica in un giorno solo (p. 37). */
export const OTU_DAILY_MAX = 850;

/**
 * Percentuale di CNS accumulata in un minuto a una data PPO2.
 *
 * Fra un gradino e l'altro della tabella si arrotonda **al gradino superiore**,
 * che è la scelta prudente: a 1.35 bar si usa il limite di 1.4. I manuali non
 * dicono come interpolare, quindi non si interpola — si dichiara la scelta.
 */
export function cnsPercentPerMinute(ppo2: number, table = CNS_SINGLE_LIMITS): number {
  if (!Number.isFinite(ppo2) || ppo2 < CNS_FLOOR_PPO2) return 0;
  const row = table.find(([p]) => ppo2 <= p + 1e-9) ?? table[table.length - 1];
  return 100 / row[1];
}

/**
 * OTU accumulate in un minuto: `OTU = (0.5 / (PO2 − 0.5))^−0.833`.
 * Advanced Nitrox p. 35, Decompression Procedures p. 177. Sotto 0.6 bar il
 * manuale dice esplicitamente di non contare («If the oxygen partial pressure is
 * less than 0.6 bar, disregard», p. 36).
 */
export function otuPerMinute(ppo2: number): number {
  if (!Number.isFinite(ppo2) || ppo2 < CNS_FLOOR_PPO2) return 0;
  return Math.pow(0.5 / (ppo2 - 0.5), -0.833);
}

export interface OxygenExposure {
  /** Percentuale dell'orologio CNS, limite per singola esposizione. */
  cnsPercent: number;
  /** Percentuale sul limite delle 24 ore, che non ammette dimezzamenti. */
  cnsDailyPercent: number;
  otu: number;
  /** Minuti passati oltre 1.4 e oltre 1.6 bar: il tempo che il picco da solo non dice. */
  minutesAbove14: number;
  minutesAbove16: number;
  /** Vero se in qualche momento la PPO2 è uscita dalla tabella. */
  offTable: boolean;
}

const EMPTY: OxygenExposure = {
  cnsPercent: 0,
  cnsDailyPercent: 0,
  otu: 0,
  minutesAbove14: 0,
  minutesAbove16: 0,
  offTable: false,
};

/** Somma l'esposizione di una sequenza di tratti a PPO2 costante. */
export function exposureOfSegments(segments: { ppo2: number; minutes: number }[]): OxygenExposure {
  const out = { ...EMPTY };
  for (const { ppo2, minutes } of segments) {
    if (!(minutes > 0)) continue;
    out.cnsPercent += cnsPercentPerMinute(ppo2) * minutes;
    out.cnsDailyPercent += cnsPercentPerMinute(ppo2, CNS_DAILY_LIMITS) * minutes;
    out.otu += otuPerMinute(ppo2) * minutes;
    if (ppo2 > 1.4) out.minutesAbove14 += minutes;
    if (ppo2 > 1.6) out.minutesAbove16 += minutes;
    if (ppo2 > CNS_TOP_PPO2) out.offTable = true;
  }
  return round(out);
}

/**
 * Esposizione di un profilo campionato.
 *
 * I manuali calcolano l'esposizione «for the maximum depth of each phase of the
 * dive and then for each decompression stop» (Advanced Nitrox p. 33): un conto a
 * fasi, perché a mano non si può fare altro. Con un profilo campione per campione
 * si integra davvero, il che è più preciso di quanto il manuale chieda — e per
 * questo il risultato può essere leggermente più basso di un conto fatto a mano
 * sulla profondità massima.
 */
export function exposureOfProfile(
  samples: Sample[],
  mixOf: (s: Sample) => GasMix | undefined,
  salinity: Salinity = 'salt',
): OxygenExposure {
  if (samples.length < 2) return { ...EMPTY };
  const segments: { ppo2: number; minutes: number }[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const minutes = (cur.t - prev.t) / 60;
    if (!(minutes > 0)) continue;
    // La PPO2 letta dal computer ha la precedenza su quella ricostruita: su un
    // rebreather è l'unica vera, e su circuito aperto è comunque una misura.
    const measured = cur.ppo2 ?? prev.ppo2;
    const mix = mixOf(cur) ?? mixOf(prev);
    const meanDepth = (prev.depth + cur.depth) / 2;
    const ppo2 = measured ?? (mix ? mix.o2 * ambientBar(meanDepth, salinity) : undefined);
    if (ppo2 === undefined) continue;
    segments.push({ ppo2, minutes });
  }
  return exposureOfSegments(segments);
}

/**
 * Il CNS residuo dopo un intervallo di superficie: si dimezza ogni 90 minuti
 * (Advanced Nitrox p. 33-34, esempio esplicito: 40% + 90 min → 20%).
 *
 * Non vale per il conteggio sulle 24 ore, che è additivo e basta (p. 37).
 */
export function cnsAfterSurface(cnsPercent: number, surfaceMinutes: number): number {
  if (!(surfaceMinutes > 0)) return cnsPercent;
  return Math.round(cnsPercent * Math.pow(0.5, surfaceMinutes / CNS_HALF_LIFE_MIN) * 10) / 10;
}

function round(e: OxygenExposure): OxygenExposure {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    cnsPercent: r1(e.cnsPercent),
    cnsDailyPercent: r1(e.cnsDailyPercent),
    otu: r1(e.otu),
    minutesAbove14: r1(e.minutesAbove14),
    minutesAbove16: r1(e.minutesAbove16),
    offTable: e.offTable,
  };
}

// ---------------------------------------------------------------------------
// Accumulo su più immersioni
// ---------------------------------------------------------------------------

export interface OxygenDay {
  /** Giorno solare del LUOGO dell'immersione, `YYYY-MM-DD`. Vedi `giornoLocale`. */
  date: string;
  dives: number;
  /** OTU sommate: non hanno nessun recupero, né in giornata né fra un giorno e l'altro. */
  otu: number;
  /**
   * Il picco dell'orologio CNS raggiunto nella giornata, tenendo conto del
   * dimezzamento ogni 90 minuti negli intervalli di superficie. È il numero che
   * conta: la somma nuda sovrastima, l'ultimo valore sottostima.
   */
  peakCnsPercent: number;
  /** Percentuale sul limite delle 24 ore, che invece è additivo e basta. */
  dailyCnsPercent: number;
}

export interface OxygenLoad {
  days: OxygenDay[];
  /** Il giorno peggiore per ciascuna delle due dosi. */
  worstOtuDay?: OxygenDay;
  worstCnsDay?: OxygenDay;
  /** Quanti giorni hanno superato la dose TDI per giorni multipli. */
  daysOverOtu300: number;
  /** Su quante immersioni il calcolo è possibile: senza profilo non c'è esposizione. */
  eligible: number;
}

/**
 * Carico di ossigeno giorno per giorno.
 *
 * È la ragione per cui CNS e OTU esistono come coppia: il CNS guarda la singola
 * giornata e perdona — metà ogni novanta minuti in superficie — mentre le OTU si
 * accumulano e basta, e mordono nelle settimane di immersioni consecutive. Un'app
 * che ne mostrasse uno solo racconterebbe metà della storia.
 */
/**
 * Il giorno di calendario del LUOGO dell'immersione, `YYYY-MM-DD`.
 *
 * IL DIFETTO CHE CHIUDE. La giornata si costruiva sui primi dieci caratteri
 * dell'istante UTC, e una giornata di immersioni la mezzanotte UTC la
 * attraversa spesso: alle Maldive, a Kiritimati, ai Caraibi. Quattro immersioni
 * dello stesso giovedì diventavano due giornate da 160 OTU l'una — sotto la
 * dose di riferimento — invece di una da 320, che è sopra. Il coach dichiarava
 * la giornata peggiore su una data in cui il logbook non ha nessuna immersione,
 * e `daysOverOtu300` restava a zero. **L'errore è sempre verso il basso**:
 * spezzare una giornata non può che ridurre il picco e la somma, e questo è un
 * limite di esposizione, non una statistica.
 *
 * La stessa regola vale già in `analysis/gear.ts` per il conteggio delle
 * immersioni dall'ultima revisione, e per gli stessi motivi.
 */
function giornoLocale(d: { startTime: string; utcOffsetMinutes?: number }): string {
  const t = Date.parse(d.startTime);
  if (Number.isNaN(t)) return d.startTime.slice(0, 10);
  return new Date(t + (d.utcOffsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10);
}

export function oxygenLoad(
  dives: {
    startTime: string;
    durationS: number;
    utcOffsetMinutes?: number;
    metrics?: { cnsPct?: number; otu?: number };
  }[],
): OxygenLoad {
  const withData = dives
    .filter((d) => d.metrics?.cnsPct !== undefined || d.metrics?.otu !== undefined)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

  const byDay = new Map<string, typeof withData>();
  for (const d of withData) {
    const key = giornoLocale(d);
    const list = byDay.get(key) ?? [];
    list.push(d);
    byDay.set(key, list);
  }

  const days: OxygenDay[] = [];
  for (const [date, list] of byDay) {
    let residual = 0;
    let peak = 0;
    let otu = 0;
    let daily = 0;
    let previousEnd: number | undefined;
    for (const dive of list) {
      const start = Date.parse(dive.startTime);
      if (previousEnd !== undefined) {
        residual = cnsAfterSurface(residual, (start - previousEnd) / 60_000);
      }
      residual += dive.metrics?.cnsPct ?? 0;
      peak = Math.max(peak, residual);
      daily += dive.metrics?.cnsPct ?? 0;
      otu += dive.metrics?.otu ?? 0;
      previousEnd = start + dive.durationS * 1000;
    }
    days.push({
      date,
      dives: list.length,
      otu: Math.round(otu),
      peakCnsPercent: Math.round(peak),
      dailyCnsPercent: Math.round(daily),
    });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  return {
    days,
    worstOtuDay: days.reduce<OxygenDay | undefined>((a, d) => (!a || d.otu > a.otu ? d : a), undefined),
    worstCnsDay: days.reduce<OxygenDay | undefined>(
      (a, d) => (!a || d.peakCnsPercent > a.peakCnsPercent ? d : a),
      undefined,
    ),
    daysOverOtu300: days.filter((d) => d.otu > OTU_DAILY_TDI).length,
    eligible: withData.length,
  };
}
