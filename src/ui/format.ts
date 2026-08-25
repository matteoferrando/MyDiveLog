import type { Severity } from '../core/analysis/coaching';
import { comeSta, type Traduci } from '../core/traduci';

/**
 * Date e ore delle immersioni.
 *
 * `offsetMinutes` è il fuso del LUOGO dell'immersione. Quando c'è, formattiamo
 * spostando l'istante e leggendolo in UTC: è l'unico modo di mostrare l'ora che
 * il computer subacqueo mostrava. Senza questo accorgimento un'immersione fatta
 * alle 9 alle Maldive comparirebbe alle 6 del mattino a chi la guarda dall'Italia.
 */
function shifted(iso: string, offsetMinutes?: number): { date: Date; tz: string } {
  const ms = new Date(iso).getTime();
  // Senza fuso dichiarato si legge in UTC, non nel fuso di chi guarda.
  //
  // `wallClockToIso` fissa deliberatamente l'orario dell'orologio su UTC, perché
  // la maggior parte dei formati non salva il fuso e l'utente si aspetta di
  // rivedere l'ora che il computer segnava. Leggerlo in locale annullava proprio
  // quella scelta: per un utente italiano ogni immersione compariva un'ora o due
  // avanti, e un'immersione del 31 dicembre alle 23:30 finiva contata nell'anno
  // dopo.
  if (offsetMinutes === undefined) return { date: new Date(ms), tz: 'UTC' };
  return { date: new Date(ms + offsetMinutes * 60_000), tz: 'UTC' };
}

export const dateShort = (iso: string, offsetMinutes?: number) => {
  const { date, tz } = shifted(iso, offsetMinutes);
  return date.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    ...(tz === 'UTC' ? { timeZone: 'UTC' } : {}),
  });
};

export const dateLong = (iso: string, offsetMinutes?: number) => {
  const { date, tz } = shifted(iso, offsetMinutes);
  return date.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(tz === 'UTC' ? { timeZone: 'UTC' } : {}),
  });
};

export const timeShort = (iso: string, offsetMinutes?: number) => {
  const { date, tz } = shifted(iso, offsetMinutes);
  return date.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    ...(tz === 'UTC' ? { timeZone: 'UTC' } : {}),
  });
};

/** "UTC+2" — mostrato solo quando differisce dal fuso di chi guarda. */
export function tzLabel(offsetMinutes: number | undefined): string | undefined {
  if (offsetMinutes === undefined) return undefined;
  const localOffset = -new Date().getTimezoneOffset();
  if (offsetMinutes === localOffset) return undefined;
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}

/** 1284 → "1.284"; 12900 → "12,9 mila" solo dove serve compattare. */
export const int = (v: number) => v.toLocaleString('it-IT');

export const pct = (v: number | undefined) => (v === undefined ? '—' : `${Math.round(v * 100)}%`);

export const SEVERITY_CLASS: Record<Severity, string> = {
  critical: 'dot-critical',
  serious: 'dot-serious',
  warning: 'dot-warning',
  good: 'dot-good',
};

/**
 * Un colore di stato non porta mai il significato da solo: accanto al pallino
 * c'è sempre questa etichetta testuale.
 */
export const SEVERITY_TEXT: Record<Severity, string> = {
  critical: 'Critico',
  serious: 'Importante',
  warning: 'Da migliorare',
  good: 'Bene',
};

export const FORMAT_LABEL: Record<string, string> = {
  uddf: 'UDDF',
  subsurface: 'Subsurface',
  'shearwater-xml': 'Shearwater XML',
  'shearwater-cloud': 'Shearwater Cloud',
  'garmin-fit': 'Garmin FIT',
  logtrak: 'LogTRAK',
  csv: 'CSV',
  'shearwater-ble': 'Shearwater via Bluetooth',
  'uwatec-ble': 'Scubapro via Bluetooth',
  // Il nome della libreria e non «altro computer»: chi legge la provenienza di
  // un'immersione vuole sapere CHI l'ha letta, ed è l'unico modo di capire
  // perché le impostazioni di decompressione sono vuote.
  libdivecomputer: 'Bluetooth (libdivecomputer)',
  manual: 'Inserita a mano',
};

/**
 * Maiuscola solo sulla prima lettera. In italiano i nomi di mesi e giorni
 * vanno minuscoli: `text-transform: capitalize` scriverebbe "Giovedì 6 Agosto".
 */
export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * La funzione che traduce, quando c'è.
 *
 * Questo modulo non può chiamare `useLingua()`: non è un componente, e viene
 * usato anche dai test e dalle esportazioni, dove non esiste nessun contesto
 * React. Chi ha la traduzione la passa; chi non ce l'ha ottiene l'italiano, che
 * è la stessa cosa che fa `t()` per una frase non tradotta.
 *
 * IL TIPO ORA VIVE NEL NUCLEO — vedi `core/traduci.ts` — perché lo usano anche i
 * parser e la sincronizzazione, che non possono importare da `src/ui`. Qui viene
 * riesportato e non ridichiarato: due dichiarazioni identiche restano uguali
 * finché qualcuno non ne cambia una sola, e allora `Traduci` di qua e `Traduci`
 * di là smettono di essere lo stesso tipo senza che nessuno se ne accorga.
 */
export type { Traduci };

/**
 * Numero più sostantivo, con il singolare quando serve.
 *
 * «1 immersioni» compare in una decina di punti dell'interfaccia e ogni volta
 * fa sembrare il testo generato da un programma che non rilegge quello che
 * scrive. Sta qui e non in ogni pagina perché la regola è una sola.
 *
 * Si traduce il SOSTANTIVO, non la frase intera: le frasi intere sarebbero una
 * voce di dizionario per ogni numero possibile. Funziona perché in inglese la
 * regola del plurale è la stessa — uno o più di uno — e le due lingue scelgono
 * la stessa forma sullo stesso numero.
 */
export function plural(n: number, uno: string, molti: string, t: Traduci = comeSta): string {
  return `${n} ${t(n === 1 ? uno : molti)}`;
}

/** Il caso di gran lunga più frequente: un conteggio di immersioni. */
export const imm = (n: number, t: Traduci = comeSta) => plural(n, 'immersione', 'immersioni', t);

/**
 * Che cosa dice il piede di un elenco a finestra.
 *
 * Estratto dal componente perché sono due conti che si sbagliano in silenzio, e
 * sbagliati non rompono niente: dicono soltanto una cosa falsa.
 *
 *  - «tutte mostrate» deve comparire SOLO quando non è rimasto niente fuori. Con
 *    un `>=` al posto di un `===`, o con il confronto fatto sul totale
 *    dell'archivio invece che su quello filtrato, l'elenco dichiara di essere
 *    completo mentre sta nascondendo righe: chi cerca un'immersione e non la
 *    trova conclude che non c'è.
 *  - il numero sul pulsante è quanto MANCA, non il passo fisso. Alla penultima
 *    schermata «Mostra altre 50» quando ne restano sette è una promessa che non
 *    viene mantenuta, e al limite esatto — mostrate uguali alle totali — un
 *    pulsante «Mostra altre 0» è un bersaglio che non fa niente.
 */
export function descriviFinestra(
  mostrate: number,
  totali: number,
  perVolta = 50,
  t: Traduci = comeSta,
): { testo: string; altre: number } {
  const restanti = Math.max(0, totali - mostrate);
  return {
    testo:
      restanti === 0
        ? `${imm(totali, t)}, ${t('tutte mostrate')}`
        : `${mostrate} ${t('di')} ${imm(totali, t)}`,
    altre: Math.min(perVolta, restanti),
  };
}
