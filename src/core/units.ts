/**
 * Conversioni di unità e fisica dell'immersione.
 *
 * Tutti i parser passano da qui. Se una conversione è sbagliata lo è in un
 * posto solo, e i test in `tests/units.test.ts` la coprono.
 */

import type { GasMix, Salinity } from './model';

// --- lunghezze -------------------------------------------------------------

export const FEET_TO_M = 0.3048;
export const M_TO_FEET = 1 / FEET_TO_M;

export const feetToM = (ft: number) => ft * FEET_TO_M;
export const mmToM = (mm: number) => mm / 1000;

// --- temperature -----------------------------------------------------------

export const KELVIN_OFFSET = 273.15;

export const fahrenheitToC = (f: number) => ((f - 32) * 5) / 9;
export const kelvinToC = (k: number) => k - KELVIN_OFFSET;
export const cToKelvin = (c: number) => c + KELVIN_OFFSET;

// --- pressioni -------------------------------------------------------------

export const PSI_PER_BAR = 14.5037738007;

export const psiToBar = (psi: number) => psi / PSI_PER_BAR;
export const barToPsi = (bar: number) => bar * PSI_PER_BAR;
export const pascalToBar = (pa: number) => pa / 100_000;
export const barToPascal = (bar: number) => bar * 100_000;
export const mbarToBar = (mbar: number) => mbar / 1000;

/**
 * Shearwater salva la pressione bombola come PSI/2 in un intero.
 * Il fattore 2 è documentato nell'XSLT di Subsurface e si perde facilmente.
 */
export const shearwaterTankToBar = (halfPsi: number) => psiToBar(halfPsi * 2);

// --- volumi ----------------------------------------------------------------

export const CUBIC_M_TO_L = 1000;
export const cubicMToL = (m3: number) => m3 * CUBIC_M_TO_L;
export const cubicFtToL = (cuft: number) => cuft * 28.316846592;

// --- fisica ----------------------------------------------------------------

/** Densità in kg/m³. */
export const DENSITY: Record<Salinity, number> = {
  salt: 1030,
  fresh: 1000,
};

export const G = 9.80665;

/** Pressione atmosferica standard al livello del mare, bar. */
export const ATM_BAR = 1.01325;

/**
 * LA PRESSIONE DI SUPERFICIE, RESA CREDIBILE — un solo posto, per tutti.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ ESISTE, E PERCHÉ NON BASTAVA `?? ATM_BAR`. ◄
 *
 * Perché `??` non intercetta lo zero. E lo zero arriva davvero: quattro lettori
 * di file possono produrlo da un campo azzerato del computer
 * (`shearwaterPnf.ts`, `shearwater.ts`, `uddf.ts`, `subsurface.ts`), e da lì
 * finisce in archivio e viene riletto a ogni apertura della scheda.
 *
 * Con zero, l'azoto d'equilibrio dei tessuti diventa **negativo**: si parte più
 * vuoti del vuoto. Sulla singola immersione l'errore è verso l'alto — GF99
 * gonfiato, innocuo — ma sull'INTERVALLO DI SUPERFICIE è verso il basso, e lì
 * vale tutto: misurato il 15 settembre 2026, un'ora di superficie lavava i
 * tessuti fino a un GF99 di **0** dove il valore vero era 35.6. Cioè la
 * ripetitiva partiva da pulito quando non lo era.
 *
 * La protezione esisteva già, ma in un punto solo — dentro `surfacedTissues` —
 * mentre `desaturate` e il calcolo della pressione ambiente prendevano il
 * numero grezzo. *Una lezione imparata dentro una funzione protegge quella
 * funzione.* Da qui in avanti ce n'è una, e la chiamano tutti.
 *
 * L'intervallo [0.3, 1.2] bar è lo stesso che il pianificatore già applica:
 * 0.3 bar sono circa novemila metri di quota — sopra l'Everest — e 1.2 bar non
 * si raggiungono al livello del mare nemmeno con l'anticiclone più solido.
 * Fuori da lì non è una pressione: è un campo non compilato.
 */
export function pressioneDiSuperficie(valore: number | undefined): number {
  return Number.isFinite(valore) && (valore as number) >= 0.3 && (valore as number) <= 1.2
    ? (valore as number)
    : ATM_BAR;
}

/**
 * Pressione idrostatica della colonna d'acqua, in bar.
 * Salato: ~0.1010 bar/m (10.06 m per bar). Dolce: ~0.0981 bar/m.
 */
export function hydrostaticBar(depthM: number, salinity: Salinity = 'salt'): number {
  return (DENSITY[salinity] * G * depthM) / 100_000;
}

/** Pressione ambiente assoluta a una data profondità, bar. */
export function ambientBar(
  depthM: number,
  salinity: Salinity = 'salt',
  surfaceBar: number = ATM_BAR,
): number {
  return surfaceBar + hydrostaticBar(depthM, salinity);
}

/** Pressione ambiente in ATA (multipli dell'atmosfera in superficie). */
export function ambientAta(
  depthM: number,
  salinity: Salinity = 'salt',
  surfaceBar: number = ATM_BAR,
): number {
  return ambientBar(depthM, salinity, surfaceBar) / surfaceBar;
}

/** Profondità corrispondente a una pressione assoluta, metri. */
export function depthFromAbsoluteBar(
  absBar: number,
  salinity: Salinity = 'salt',
  surfaceBar: number = ATM_BAR,
): number {
  const hydro = Math.max(0, absBar - surfaceBar);
  return (hydro * 100_000) / (DENSITY[salinity] * G);
}

// --- gas -------------------------------------------------------------------

/**
 * IL CNS COME LO LEGGE CHI GUARDA: L'INTERO.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL NUMERO CHE DECIDE DEV'ESSERE IL NUMERO CHE SI MOSTRA. ◄
 *
 * Il CNS si mostra dappertutto con `toFixed(0)` e si confrontava dappertutto
 * col valore pieno. Le due cose non coincidono, e nella fascia che conta
 * divergono sempre. Misurato il 16 settembre 2026:
 *
 *   99.6 % → a schermo **«100%»**, ma il piano lo classifica `caution`: il
 *            lettore vede il numero del limite e accanto un avviso che dice
 *            che il limite non è superato;
 *   79.6 % → a schermo **«80%»**, e **nessun avviso**, perché la soglia degli
 *            avvisi è 80 e il valore pieno non ci arriva.
 *
 * *Un avviso che si contraddice dentro la propria frase non insegna niente, e
 * insegna a saltare quelli veri.* È lo stesso guasto della MOD che diceva «a
 * 33.3 m superi il limite: la massima operativa è 33.3 m», e la stessa
 * medicina: **la soglia si confronta con la cosa mostrata.**
 *
 * Al bordo si sceglie la severità: 99.6 diventa 100 e quindi critico. Non è
 * una tolleranza in più, è l'unica scelta coerente con quello che c'è scritto
 * a schermo — e per un avviso di tossicità è anche quella prudente.
 *
 * Vale per il CNS pianificato, per quello del residuo e per il colore rosso
 * della casella: una sola regola, perché due copie della stessa regola sono
 * una regola e la sua versione vecchia.
 */
export function cnsMostrato(percent: number): number {
  return Math.round(percent);
}

export const n2Fraction = (mix: GasMix) => Math.max(0, 1 - mix.o2 - mix.he);

/*
 * LA PRESSIONE DI SUPERFICIE ARRIVA FIN QUI.
 *
 * Queste funzioni la assumevano pari a `ATM_BAR`, mentre i loro chiamanti la
 * conoscono: `deco.ts` e `gasPlan.ts` gliela avrebbero passata. Il risultato era
 * che sulla stessa schermata di un piano in quota tre riquadri usavano due
 * pressioni diverse — i litri la tenevano in conto e MOD, PPO2, END, EAD e CNS
 * no. A 2000 metri, con EAN32 a 40 m in acqua dolce: PPO2 vera 1.51 bar, il
 * piano ne dichiarava 1.58; MOD vera 36.5 m, il piano 34.3. La direzione è
 * prudente, ma è la stessa pagina che dichiara di tenere conto della quota.
 *
 * Il valore predefinito resta l'atmosfera al livello del mare, quindi chi non
 * passa niente ottiene esattamente i numeri di prima.
 */

/** PPO2 alla profondità data, bar. */
export function ppo2At(
  mix: GasMix,
  depthM: number,
  salinity: Salinity = 'salt',
  surfaceBar: number = ATM_BAR,
): number {
  return mix.o2 * ambientBar(depthM, salinity, surfaceBar);
}

/** Maximum Operating Depth per una PPO2 limite, metri. */
export function mod(
  mix: GasMix,
  maxPpo2 = 1.4,
  salinity: Salinity = 'salt',
  surfaceBar: number = ATM_BAR,
): number {
  /*
   * ► UNA MISCELA SENZA OSSIGENO NON HA UNA PROFONDITÀ MASSIMA: NON SI
   *   RESPIRA. ◄
   *
   * `maxPpo2 / 0` vale `Infinity`, e da lì la MOD usciva infinita — cioè «puoi
   * andare a qualunque profondità» su un gas che non si respira nemmeno in
   * superficie. Misurato il 15 settembre 2026 passando `o2 = 0` al
   * pianificatore. Il confronto `profondita > mod` con `Infinity` è sempre
   * falso, quindi l'avviso di profondità massima superata non compariva mai.
   *
   * Zero è il valore giusto: una MOD di zero metri dice «non puoi portarlo
   * sotto», che è vero, e fa scattare ogni controllo che confronta con lei.
   * Un gas con meno dell'1% di ossigeno esiste — è un gas di viaggio
   * ipossico — ma la sua MOD vera è comunque enorme e il limite qui sotto non
   * la tocca.
   */
  if (!(mix.o2 > 0) || !Number.isFinite(maxPpo2)) return 0;
  const absBar = maxPpo2 / mix.o2;
  return depthFromAbsoluteBar(absBar, salinity, surfaceBar);
}

/**
 * Equivalent Narcotic Depth, metri.
 *
 * DUE CONVENZIONI, e la differenza non è accademica.
 *
 * Con `oxygenNarcotic: true` (predefinito) si considerano narcotici sia l'azoto
 * sia l'ossigeno, e solo l'elio no. È la convenzione della didattica tecnica:
 * «Oxygen is thought to carry with it narcosis properties as well, perhaps even
 * slightly greater than that of nitrogen. The easy rule of thumb is to not dive
 * nitrox deeper than you would dive with air» (TDI Advanced Nitrox, p. 40).
 * Conseguenza: per una miscela senza elio l'END è uguale alla profondità reale —
 * l'EAN32 a 35 m narcotizza come l'aria a 35 m, non come l'aria a 31.
 *
 * Con `oxygenNarcotic: false` si conta solo l'azoto, come fanno Bühlmann e
 * diversi computer. È una scelta legittima, ma dice al subacqueo che col nitrox è
 * meno narcotizzato: è la meno prudente delle due, e per questo non è quella
 * predefinita.
 */
export function end(
  mix: GasMix,
  depthM: number,
  salinity: Salinity = 'salt',
  { oxygenNarcotic = true, surfaceBar = ATM_BAR }: { oxygenNarcotic?: boolean; surfaceBar?: number } = {},
): number {
  const abs = ambientBar(depthM, salinity, surfaceBar);
  const narcoticFraction = oxygenNarcotic ? 1 - mix.he : n2Fraction(mix);
  const airFraction = oxygenNarcotic ? 1 : n2Fraction({ o2: 0.21, he: 0 });
  return depthFromAbsoluteBar((abs * narcoticFraction) / airFraction, salinity, surfaceBar);
}

/**
 * Pressione parziale dell'azoto, ATA: la grandezza in cui la didattica tecnica
 * esprime davvero il limite di narcosi — «the generally accepted range for
 * nitrogen narcosis exposure is between 4.0 and 5.21 ata of N2... There is no set
 * rule» (TDI Advanced Nitrox, p. 39), con 4.0 come massimo in ambiente ostruito o
 * in acqua fredda e buia (p. 40).
 */
export function ppn2At(
  mix: GasMix,
  depthM: number,
  salinity: Salinity = 'salt',
  surfaceBar: number = ATM_BAR,
): number {
  return ambientBar(depthM, salinity, surfaceBar) * n2Fraction(mix);
}

/**
 * Miscela migliore per una profondità, frazione di O2 fra 0 e 1: `Fg = Pg / P`
 * (TDI Advanced Nitrox p. 49, Decompression Procedures p. 147).
 *
 * Troncata in giù al punto percentuale, come fa il manuale: 1.4 / 4.5 = 0.3111 →
 * 31%, non 32. Arrotondare per eccesso darebbe una miscela la cui MOD è più bassa
 * della profondità pianificata.
 */
export function bestMix(
  depthM: number,
  maxPpo2 = 1.4,
  salinity: Salinity = 'salt',
  surfaceBar: number = ATM_BAR,
): number {
  const abs = ambientBar(depthM, salinity, surfaceBar);
  /*
   * ► IL TETTO A 1, E L'APPLICAZIONE CONSIGLIAVA «EAN106». ◄ Senza, a tre metri
   * `1.4 / 1.32` dà **1.06**, e il pianificatore — che il campo profondità lo
   * accetta da 3 m in su — stampava `EAN{Math.round(1.06*100)}`, cioè una
   * miscela che non esiste. Sopra l'ossigeno puro non c'è niente da respirare.
   */
  return Math.min(1, Math.floor((maxPpo2 / abs) * 100) / 100);
}

/** Equivalent Air Depth, metri. */
export function ead(
  mix: GasMix,
  depthM: number,
  salinity: Salinity = 'salt',
  surfaceBar: number = ATM_BAR,
): number {
  const abs = ambientBar(depthM, salinity, surfaceBar);
  const airN2 = n2Fraction({ o2: 0.21, he: 0 });
  return depthFromAbsoluteBar((abs * n2Fraction(mix)) / airN2, salinity, surfaceBar);
}

/**
 * Cambia una componente della miscela senza far sforare il 100%.
 *
 * L'azoto è quello che resta, quindi non è un campo che si digita: è la
 * differenza. Senza questo vincolo l'interfaccia accettava 40/70, il resto
 * diventava azoto negativo, e il motore lo prendeva sul serio — pressione
 * parziale sotto zero, nessun obbligo di decompressione, un piano che invita a
 * fare un'immersione che non esiste. Il valore in eccesso viene tagliato a
 * quello che ci sta, così chi digita vede subito il limite.
 */
export function withFraction(mix: GasMix, key: 'o2' | 'he', fraction: number): GasMix {
  const other = key === 'o2' ? mix.he : mix.o2;
  const value = Math.max(0, Math.min(fraction, 1 - other));
  return key === 'o2' ? { o2: value, he: mix.he } : { o2: mix.o2, he: value };
}

/** Nome umano di una miscela: "Aria", "EAN32", "Tx21/35", "Ossigeno". */
export function mixName(mix: GasMix): string {
  const o2 = Math.round(mix.o2 * 100);
  const he = Math.round(mix.he * 100);
  if (he > 0) return `Tx${o2}/${he}`;
  if (o2 >= 99) return 'Ossigeno';
  if (o2 === 21) return 'Aria';
  return `EAN${o2}`;
}

// --- formattazione ---------------------------------------------------------

/** 3720 -> "1:02:00", 930 -> "15:30". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`;
}

/** 3720 -> "62 min". Per le statistiche aggregate. */
export function formatMinutes(seconds: number): string {
  return `${Math.round(seconds / 60)} min`;
}

/** Ore totali arrotondate: 90000 -> "25 h". */
export function formatHours(seconds: number): string {
  const h = seconds / 3600;
  return h < 10 ? `${h.toFixed(1)} h` : `${Math.round(h)} h`;
}

export function formatDepth(m: number | undefined, digits = 1): string {
  return m === undefined ? '—' : `${m.toFixed(digits)} m`;
}

export function formatNum(v: number | undefined, digits = 1, unit = ''): string {
  if (v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(digits)}${unit ? ' ' + unit : ''}`;
}

// ---------------------------------------------------------------------------
// Date e orari senza fuso
// ---------------------------------------------------------------------------

/**
 * Interpreta una data-ora SENZA fuso orario come lettura di un orologio, non come
 * ora locale della macchina.
 *
 * Questa è una correzione di un bug vero, trovato facendo girare i test su un Mac
 * in Europe/Rome invece che in UTC: `new Date('2026-06-14T10:38:00')` usa il fuso
 * del COMPUTER su cui gira il codice. Lo stesso file Subsurface importato a Genova
 * e a Londra produceva quindi due istanti diversi, e quindi:
 *
 *  - due identificativi diversi per la stessa immersione, perché l'id è ricavato
 *    dal contenuto — e con il database condiviso significa la stessa immersione
 *    duplicata fra due dispositivi;
 *  - la deduplica che non riconosce più la stessa immersione arrivata da due
 *    computer, perché gli istanti differiscono di ore.
 *
 * La lettura giusta per un logbook: quei numeri sono l'ora che l'orologio del
 * computer subacqueo mostrava, e il fuso NON è nel file. Li fissiamo su UTC —
 * scelta arbitraria ma deterministica e identica su ogni macchina — e lasciamo
 * `utcOffsetMinutes` non valorizzato, perché non lo sappiamo. Così l'orario
 * mostrato è quello letto, che è ciò che l'utente si aspetta di rivedere.
 *
 * Le stringhe che PORTANO il fuso (`...Z`, `...+02:00`) sono un'altra cosa e
 * vengono rispettate.
 */
export function wallClockToIso(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;

  // Con fuso esplicito ci si fida della stringa.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const withZone = new Date(text.replace(' ', 'T'));
    return Number.isNaN(withZone.getTime()) ? undefined : withZone.toISOString();
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    return isoFromParts(+y, +mo, +d, +h, +mi, s ? +s : 0);
  }
  // Solo la data.
  const onlyDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (onlyDate) {
    const [, y, mo, d] = onlyDate;
    return isoFromParts(+y, +mo, +d, 0, 0, 0);
  }
  return undefined;
}

/** Costruisce un istante dai componenti di un orologio, sempre in UTC. */
export function isoFromParts(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
): string | undefined {
  const ms = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  if (Number.isNaN(ms)) return undefined;
  const d = new Date(ms);
  // `Date.UTC` accetta valori fuori intervallo e li normalizza (mese 13 → gennaio
  // dell'anno dopo): un file con una data impossibile non deve diventare
  // un'immersione con una data plausibile e sbagliata.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return undefined;
  }
  return d.toISOString();
}

/**
 * Minuti in una durata leggibile: «48 min», «1 h 12 min», «3.5 min».
 *
 * I minuti non interi si arrotondano solo sotto i dieci: «4.2 min» su un tratto
 * di risalita è un'informazione, «47.3 min» di durata totale è finta precisione.
 *
 * Sta qui e non nel pianificatore perché lo usa anche il foglio da stampare, e
 * due formattatori diversi per la stessa grandezza fanno comparire due durate
 * scritte in modo diverso nella stessa pagina.
 */
export function formatRuntime(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '—';
  if (min < 10) return `${Math.round(min * 10) / 10} min`;
  const whole = Math.round(min);
  if (whole < 60) return `${whole} min`;
  return `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, '0')} min`;
}

/**
 * Una frazione di gas, da un numero che potrebbe essere una percentuale.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ ESISTE, E PERCHÉ SBAGLIARLA È PEGGIO DI NON AVERE IL DATO. ◄
 *
 * `0.21` e `21` vogliono dire la stessa cosa scritte in due scale, e i file li
 * portano tutti e due: UDDF pretende la frazione ma i file scritti a mano ci
 * mettono spesso la percentuale, e il campo di Shearwater si chiama `fraction`
 * ed è salvato in percentuale.
 *
 * Con una frazione maggiore di uno la frazione inerte diventa zero: i tessuti
 * **non caricano mai**, e l'immersione decompressiva più pesante dell'archivio
 * esce con GF99 zero, tetto zero e zero minuti di obbligo. *Si presenta come la
 * più tranquilla di tutte*, senza un errore da nessuna parte.
 *
 * La soglia è 1 e non 1.5 o 2: una frazione di ossigeno vale al massimo 1 —
 * ossigeno puro — quindi qualunque numero sopra 1 è una percentuale, e non c'è
 * ambiguità da risolvere. Il caso limite, `o2 = 1`, resta ossigeno puro, che è
 * la lettura giusta: `100` come percentuale dà lo stesso risultato.
 */
export function frazioneDiGas(v: number | undefined): number | undefined {
  if (v === undefined || !Number.isFinite(v) || v < 0) return undefined;
  return v > 1 ? v / 100 : v;
}
