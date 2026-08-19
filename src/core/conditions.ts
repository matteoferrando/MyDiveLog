/**
 * Meteo e mare: da etichetta scritta a dato contabile, senza migrazioni.
 *
 * PERCHÉ ESISTE. Fino a ieri le condizioni finivano dentro `Dive.tags` come
 * etichette italiane — «sole», «mare mosso» — perché è così che le traduce
 * l'import da LogTRAK. Per mostrarle va bene. Per rispondere a «consumo di più
 * col mare agitato?» non serve a niente: una stringa in un elenco di stringhe
 * non si raggruppa, non si ordina e non si confronta, e la domanda resta senza
 * risposta pur avendo il dato in archivio.
 *
 * PERCHÉ NON SI MIGRA. Un passaggio di migrazione su tutto l'archivio è codice
 * che gira una volta sola, che nessuno riesce a provare due volte, e che se
 * sbaglia sbaglia su tutto insieme. Qui non serve: `conditionsOf` legge tutte e
 * due le forme — il campo nuovo se c'è, le etichette vecchie altrimenti — e la
 * prima volta che si salva quella immersione dalla scheda, passa alla forma
 * nuova da sé. È lo stesso trucco di `migrateGear`, e il costo è una funzione
 * invece di un rischio.
 */

import type { Dive, DiveConditions, Waves, Weather } from './model';

export const WEATHER_LABEL: Record<Weather, string> = {
  sunny: 'sole',
  cloudy: 'nuvoloso',
  overcast: 'coperto',
  rainy: 'pioggia',
  snowy: 'neve',
  windy: 'vento',
  fog: 'nebbia',
};

export const WAVES_LABEL: Record<Waves, string> = {
  calm: 'mare calmo',
  moderate: 'mare mosso',
  rough: 'mare agitato',
  veryRough: 'mare molto agitato',
};

/**
 * Le fasce di visibilità da proporre a tendina.
 *
 * A fasce e non con un cursore, perché la visibilità non si misura: si stima a
 * occhio, e la precisione vera di quella stima è «più o meno questa fascia».
 * Un campo che chiede un numero singolo fa scrivere sempre le stesse tre cifre
 * tonde — 5, 10, 20 — e quei numeri sembrano misure senza esserlo.
 *
 * L'estremo BASSO è quello che finisce nelle statistiche: fra i due è il
 * prudente, ed è quello che descrive com'era nei momenti peggiori.
 */
export const FASCE_VISIBILITA: { min: number; max?: number; etichetta: string }[] = [
  { min: 0, max: 1, etichetta: 'meno di 1 m — non si vede niente' },
  { min: 1, max: 3, etichetta: 'da 1 a 3 m' },
  { min: 3, max: 5, etichetta: 'da 3 a 5 m' },
  { min: 5, max: 10, etichetta: 'da 5 a 10 m' },
  { min: 10, max: 15, etichetta: 'da 10 a 15 m' },
  { min: 15, max: 25, etichetta: 'da 15 a 25 m' },
  { min: 25, max: 40, etichetta: 'da 25 a 40 m' },
  { min: 40, etichetta: 'oltre 40 m — acqua tropicale' },
];

/** Le etichette vecchie, per ritrovare il codice da quello che c'è nei tag. */
const DA_ETICHETTA = new Map<string, DiveConditions>([
  ...Object.entries(WEATHER_LABEL).map(
    ([k, v]) => [v, { weather: k as Weather }] as [string, DiveConditions],
  ),
  ...Object.entries(WAVES_LABEL).map(([k, v]) => [v, { waves: k as Waves }] as [string, DiveConditions]),
  // Le forme che LogTRAK produceva prima della tabella di traduzione: arrivavano
  // grezze dal JSON, ed esistono in archivio.
  ['calm', { waves: 'calm' }],
  ['moderately', { waves: 'moderate' }],
  ['rough', { waves: 'rough' }],
  ['sunny', { weather: 'sunny' }],
  ['cloudy', { weather: 'cloudy' }],
  ['overcast', { weather: 'overcast' }],
  ['rainy', { weather: 'rainy' }],
  ['snowy', { weather: 'snowy' }],
]);

/**
 * Le condizioni di un'immersione, dal campo nuovo o dalle etichette vecchie.
 *
 * Il campo nuovo vince sempre, anche se è vuoto: se qualcuno ha aperto la
 * scheda e ha tolto il meteo, quel vuoto è una scelta e non va riempito da un
 * tag rimasto indietro.
 */
export function conditionsOf(dive: Pick<Dive, 'conditions' | 'tags'>): DiveConditions {
  if (dive.conditions) return dive.conditions;
  const out: DiveConditions = {};
  for (const t of dive.tags ?? []) {
    const trovato = DA_ETICHETTA.get(t.trim().toLowerCase());
    if (trovato?.weather && !out.weather) out.weather = trovato.weather;
    if (trovato?.waves && !out.waves) out.waves = trovato.waves;
  }
  return out;
}

/** I tag che descrivono le condizioni, da togliere quando si passa alla forma nuova. */
export function tagsSenzaCondizioni(tags: string[]): string[] {
  return tags.filter((t) => !DA_ETICHETTA.has(t.trim().toLowerCase()));
}

/** Come si legge la visibilità: «da 5 a 10 m», «12 m», «—». */
export function visibilitaTesto(dive: Pick<Dive, 'visibilityM' | 'visibilityMaxM'>): string {
  const min = dive.visibilityM;
  const max = dive.visibilityMaxM;
  if (min === undefined && max === undefined) return '—';
  if (min !== undefined && max !== undefined && max > min) return `da ${min} a ${max} m`;
  return `${min ?? max} m`;
}

/** Come si leggono le condizioni tutte insieme, per una riga di tabella. */
export function condizioniTesto(dive: Pick<Dive, 'conditions' | 'tags'>): string {
  const c = conditionsOf(dive);
  const pezzi = [
    c.weather ? WEATHER_LABEL[c.weather] : undefined,
    c.waves ? WAVES_LABEL[c.waves] : undefined,
  ];
  return pezzi.filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------
// Quanto le condizioni cambiano quello che fai
// ---------------------------------------------------------------------------

/**
 * PERCHÉ È UN CONFRONTO FRA GRUPPI E NON UNA CORRELAZIONE.
 *
 * Il resto delle statistiche usa Pearson, che vuole due grandezze numeriche.
 * «Mare mosso» non è un numero: è una categoria, e ordinarla da 1 a 4 per poterci
 * calcolare una correlazione significherebbe affermare che il passo da calmo a
 * mosso vale quanto quello da mosso ad agitato. Non lo sappiamo, e quel numero
 * poi verrebbe letto come se lo sapessimo.
 *
 * Quindi: mediane per gruppo, ognuna col proprio denominatore. È meno elegante e
 * si può controllare a occhio, che su un archivio personale conta di più.
 *
 * PERCHÉ NON DICE MAI «PERCHÉ». Col mare agitato si esce dai posti riparati,
 * quindi si va in siti diversi, spesso più profondi, spesso più freddi. Se il
 * consumo sale, sale insieme a tre cose insieme e attribuirlo alle onde è una
 * congettura. Le righe dicono cosa è successo; il perché lo sa chi c'era.
 */
export interface GruppoCondizione {
  chiave: string;
  etichetta: string;
  dives: number;
  /** Consumo mediano, L/min, e su quante immersioni lo si è potuto calcolare. */
  medianRmvLpm?: number;
  rmvBasis: number;
  /** Oscillazione mediana a quota tenuta, m/min. */
  medianTrimMpm?: number;
  trimBasis: number;
  medianMaxDepth: number;
  medianDurationMin: number;
  /** Temperatura minima mediana, °C. */
  medianTempC?: number;
  tempBasis: number;
}

const mediana = (v: number[]): number | undefined => {
  if (!v.length) return undefined;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const arrotonda = (v: number | undefined, cifre = 1) =>
  v === undefined ? undefined : Math.round(v * 10 ** cifre) / 10 ** cifre;

/**
 * Raggruppa le immersioni per una chiave e ne riassume le misure.
 *
 * `minDives` esiste perché una mediana su due immersioni è un numero, non una
 * misura: mostrarla accanto a una calcolata su quaranta le fa sembrare
 * confrontabili. Il gruppo scartato non sparisce in silenzio — chi chiama sa
 * quante immersioni sono rimaste fuori guardando il totale.
 */
export function raggruppaPerCondizione(
  dives: Dive[],
  chiave: (d: Dive) => string | undefined,
  etichetta: (k: string) => string,
  minDives = 3,
): GruppoCondizione[] {
  const per = new Map<string, Dive[]>();
  for (const d of dives) {
    const k = chiave(d);
    if (k === undefined) continue;
    const g = per.get(k) ?? [];
    g.push(d);
    per.set(k, g);
  }

  const out: GruppoCondizione[] = [];
  for (const [k, g] of per) {
    if (g.length < minDives) continue;
    const rmv = g.map((d) => d.metrics?.rmvLpm).filter((v): v is number => v !== undefined && v > 0);
    const trim = g
      .map((d) => d.metrics?.bottomVerticalTravelMpm)
      .filter((v): v is number => v !== undefined && Number.isFinite(v));
    const temp = g.map((d) => d.minTempC).filter((v): v is number => v !== undefined);
    out.push({
      chiave: k,
      etichetta: etichetta(k),
      dives: g.length,
      medianRmvLpm: arrotonda(mediana(rmv)),
      rmvBasis: rmv.length,
      medianTrimMpm: arrotonda(mediana(trim)),
      trimBasis: trim.length,
      medianMaxDepth: arrotonda(mediana(g.map((d) => d.maxDepth)) ?? 0) ?? 0,
      medianDurationMin: Math.round((mediana(g.map((d) => d.durationS)) ?? 0) / 60),
      medianTempC: arrotonda(mediana(temp)),
      tempBasis: temp.length,
    });
  }
  return out.sort((a, b) => b.dives - a.dives);
}

/** L'ordine in cui il mare va mostrato: dal calmo all'agitato, non per frequenza. */
const ORDINE_MARE: Waves[] = ['calm', 'moderate', 'rough', 'veryRough'];

export function perStatoDelMare(dives: Dive[], minDives = 3): GruppoCondizione[] {
  return raggruppaPerCondizione(
    dives,
    (d) => conditionsOf(d).waves,
    (k) => WAVES_LABEL[k as Waves] ?? k,
    minDives,
    // Un elenco ordinato per frequenza nasconde l'unica cosa che questa tabella
    // deve far vedere: se una misura peggiora quando il mare peggiora. L'ordine
    // è quello della scala.
  ).sort((a, b) => ORDINE_MARE.indexOf(a.chiave as Waves) - ORDINE_MARE.indexOf(b.chiave as Waves));
}

export function perMeteo(dives: Dive[], minDives = 3): GruppoCondizione[] {
  return raggruppaPerCondizione(
    dives,
    (d) => conditionsOf(d).weather,
    (k) => WEATHER_LABEL[k as Weather] ?? k,
    minDives,
  );
}

/**
 * Per fascia di visibilità.
 *
 * La fascia si ricava dall'estremo basso, che è quello che finisce in archivio e
 * quello prudente. Le immersioni importate da file hanno spesso un numero solo,
 * scritto a mano in un'altra applicazione: rientra nella sua fascia come le
 * altre, ed è giusto — la fascia è più grossolana del numero, quindi non
 * inventa precisione che non c'è.
 */
export function perVisibilita(dives: Dive[], minDives = 3): GruppoCondizione[] {
  const fascia = (d: Dive): string | undefined => {
    const v = d.visibilityM;
    if (v === undefined) return undefined;
    const f = [...FASCE_VISIBILITA].reverse().find((x) => v >= x.min);
    return f?.etichetta;
  };
  return raggruppaPerCondizione(dives, fascia, (k) => k, minDives).sort((a, b) => {
    const i = (e: string) => FASCE_VISIBILITA.findIndex((f) => f.etichetta === e);
    return i(a.chiave) - i(b.chiave);
  });
}

/** Quante immersioni hanno un dato sulle condizioni: il denominatore delle tabelle. */
export function quanteConCondizioni(dives: Dive[]): { mare: number; meteo: number; visibilita: number } {
  let mare = 0;
  let meteo = 0;
  let visibilita = 0;
  for (const d of dives) {
    const c = conditionsOf(d);
    if (c.waves) mare++;
    if (c.weather) meteo++;
    if (d.visibilityM !== undefined) visibilita++;
  }
  return { mare, meteo, visibilita };
}
