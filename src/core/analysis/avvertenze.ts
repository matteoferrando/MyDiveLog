/**
 * Le avvertenze che accompagnano le metriche di un'immersione.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ STANNO QUI E NON DOVE VENGONO SCRITTE. ◄
 *
 * Per la **terza volta in una settimana** lo stesso guasto: un testo che nasce
 * in `core`, dove la lingua non si sa, e che veniva disegnato **senza passare
 * dal dizionario**. Prima il piano di miglioramento — novantuno frasi rimaste
 * in italiano. Poi le righe dell'avanzamento dello scarico, la riga più letta
 * di tutto il trasferimento. Adesso queste: `{m.quality.caveats.map((c) => <div>{c}</div>)}`,
 * nove frasi disegnate così come sono.
 *
 * **Con l'applicazione in inglese uscivano tutte in italiano**, e nessuna prova
 * se ne lamentava — perché `tests/dizionario.test.ts` scorre il sorgente
 * cercando `t()` e `frase()`, e qui non c'era né l'uno né l'altro. *Una guardia
 * che cerca una forma non vede il testo che quella forma non ce l'ha.*
 *
 * ► E PERCHÉ SONO COSTANTI ESPORTATE. ◄ Perché una prova possa **scorrerle
 * tutte** e pretendere che ognuna abbia la sua voce nel dizionario, con gli
 * stessi segnaposti in tutte e due le lingue. È la stessa cura di
 * `core/ble/avanzamentoTesti.ts`, e per la stessa ragione: scritte sul posto
 * sarebbero raggiungibili solo con una ricerca a espressioni regolari, e quella
 * non vede quella nuova che qualcuno aggiungerà domani.
 *
 * ► I NUMERI VIAGGIANO A PARTE. ◄ Tre di queste frasi contengono una cifra. Se
 * il numero entrasse nel testo prima del dizionario, la chiave cambierebbe a
 * ogni immersione — «Campionamento a 30 s», «a 10 s», «a 2 s» — e nel
 * dizionario non ci sarebbe mai. Quindi il modello viaggia coi segnaposti, i
 * valori viaggiano accanto, e la frase si compone dove la lingua si conosce.
 * Vedi `core/frase.ts`.
 */

import type { Avvertenza } from '../model';
import { frase } from '../frase';

/** Non c'è profilo: le metriche vengono dai soli dati di sintesi. */
export const SENZA_PROFILO = 'Nessun profilo campionato: disponibili solo i dati di sintesi.';

/** Il profilo è rado: `{0}` è l'intervallo fra due campioni, in secondi. */
export const CAMPIONAMENTO_RADO =
  'Campionamento a {0} s: velocità verticali e sosta di sicurezza sono approssimate.';

/**
 * Velocità e assetto misurati sul profilo dell'altro computer, più fitto.
 * `{0}` è l'intervallo usato, `{1}` quello del profilo mostrato.
 */
export const PROFILO_ALTERNATIVO =
  'Velocità e assetto misurati sul profilo a {0} s del secondo computer, più fitto di quello mostrato ({1} s): un profilo più rado leggerebbe l’oscillazione più bassa di quanto è.';

/** Il consumo di superficie mostrato è quello scritto a mano. */
export const CONSUMO_A_MANO =
  'Il consumo di superficie mostrato l’hai scritto tu: non viene dalle pressioni della bombola.';

/** Senza profondità media il consumo in L/min non si può calcolare. */
export const SENZA_MEDIA_NIENTE_RMV =
  'Profondità media sconosciuta (nessun profilo campionato): l’RMV in L/min non è calcolabile, resta il consumo in bar/min.';

/** Più bombole: due grandezze su due insiemi diversi. */
export const PIU_BOMBOLE =
  'Più bombole: l’RMV in L/min è calcolato sul totale di tutte, mentre il consumo in bar/min, la pressione finale e la frazione di riserva riguardano SOLO la prima bombola — i bar di bombole di volume diverso non si sommano.';

/**
 * Una bombola ha consumato gas senza dichiarare il litraggio.
 *
 * Due modelli e non uno con il numero davanti: in italiano «1 bombola ha» e
 * «2 bombole hanno» cambiano il verbo, e in inglese cambia il sostantivo. *Chi
 * traduce deve vedere la frase intera per poterla girare nella propria lingua*,
 * che è la stessa ragione per cui `avanzamentoTesti.ts` tiene due modelli per
 * la ripresa dello scarico.
 */
export const UNA_BOMBOLA_SENZA_VOLUME =
  'Una bombola ha consumato gas ma non ha il litraggio: i suoi litri NON sono nel consumo in L/min, che quindi è più basso del vero. Scrivi il volume e il numero si corregge.';

/** Come sopra, da due bombole in su. `{0}` è quante sono. */
export const BOMBOLE_SENZA_VOLUME =
  '{0} bombole hanno consumato gas ma non hanno il litraggio: i loro litri NON sono nel consumo in L/min, che quindi è più basso del vero. Scrivi i volumi e il numero si corregge.';

/** C'è la pressione ma non il volume: si può dare solo il consumo in bar/min. */
export const SENZA_VOLUME =
  'Volume bombola non indicato: calcolabile solo il consumo in bar/min, non l’RMV in L/min.';

/** Senza pressioni non si calcola nessun consumo. */
export const SENZA_PRESSIONE = 'Nessuna pressione bombola: consumo gas non calcolabile.';

/**
 * Tutte quante, per la prova che le confronta col dizionario.
 *
 * Una costante nuova che non finisce in questo elenco sfugge alla guardia: è il
 * solo punto debole del meccanismo, ed è scritto qui perché chi aggiunge la
 * prossima lo veda mentre lo fa.
 */
export const TESTI_DELLE_AVVERTENZE = [
  SENZA_PROFILO,
  CAMPIONAMENTO_RADO,
  PROFILO_ALTERNATIVO,
  CONSUMO_A_MANO,
  SENZA_MEDIA_NIENTE_RMV,
  PIU_BOMBOLE,
  UNA_BOMBOLA_SENZA_VOLUME,
  BOMBOLE_SENZA_VOLUME,
  SENZA_VOLUME,
  SENZA_PRESSIONE,
] as const;

/**
 * Un'avvertenza, composta e tradotta.
 *
 * Regge tutte e due le forme: l'oggetto `{ testo, valori }` che scrive
 * `computeMetrics` da oggi, e la **stringa già composta** che sta negli archivi
 * salvati prima del 14 settembre 2026. Su una stringa nuda `frase()` fa
 * esattamente quello che faceva `t()` — cerca la chiave nel dizionario e, non
 * trovandola, la restituisce com'è — quindi il testo vecchio continua a
 * leggersi in italiano invece di sparire. *Non si migra quello che non si può
 * ricalcolare: si continua a saperlo leggere.*
 *
 * `traduci` arriva da fuori perché la lingua la sa chi disegna. Dove non c'è una
 * lingua — il contesto che si passa all'analisi, che è in italiano — si passa
 * l'identità.
 */
export function testoAvvertenza(a: string | Avvertenza, traduci: (s: string) => string): string {
  return typeof a === 'string' ? frase(traduci, a) : frase(traduci, a.testo, ...(a.valori ?? []));
}

/**
 * Tutte le avvertenze di un'immersione, composte e tradotte, nell'ordine.
 *
 * Esiste perché i posti che le disegnano sono due — la scheda dell'immersione e
 * il contesto che si passa all'analisi — e una `map` copiata due volte è una
 * regola e la sua versione vecchia. *Lo stesso motivo per cui
 * `applicaAvanzamento` è uscito da `BleDownload.tsx`.*
 */
export function avvertenzeComposte(
  caveats: readonly (string | Avvertenza)[],
  traduci: (s: string) => string,
): string[] {
  return caveats.map((c) => testoAvvertenza(c, traduci));
}
