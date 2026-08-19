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
