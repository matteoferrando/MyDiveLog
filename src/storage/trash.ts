/**
 * Il cestino.
 *
 * PERCHÉ È NATO. Le lapidi della sincronizzazione hanno risolto un difetto reale —
 * un'immersione cancellata tornava indietro dall'altro dispositivo — e nel farlo ne
 * hanno creato uno peggiore: la cancellazione è diventata immediata, definitiva e
 * propagata ovunque. Un clic sbagliato su una scheda, e l'immersione spariva da
 * tutti i dispositivi senza modo di tornare indietro. Una conferma non basta:
 * le conferme si cliccano.
 *
 * COME FUNZIONA, E PERCHÉ COSÌ. Cancellare mette l'immersione nel cestino, con il
 * suo profilo: sparisce dall'archivio, non viene più sincronizzata, e non produce
 * ancora nessuna lapide. Finché è lì si può rimettere a posto esattamente com'era.
 * La lapide — cioè la cancellazione vera, quella che si propaga — nasce solo quando
 * il cestino si svuota, a mano o da sé dopo trenta giorni.
 *
 * IL PREZZO, DICHIARATO. Nella finestra dei trenta giorni l'immersione è ancora
 * presente sugli altri dispositivi: è il costo di poter tornare indietro, e
 * l'alternativa — propagare subito e poter «annullare» dopo — richiederebbe di
 * revocare una lapide già applicata altrove, che è una cosa che non si può fare
 * onestamente.
 *
 * IL CESTINO NON VIAGGIA. Sta sul dispositivo dove è avvenuta la cancellazione:
 * è uno stato di lavoro, non un dato dell'archivio, e sincronizzarlo significherebbe
 * far comparire su un altro dispositivo immersioni che lì non sono mai state
 * cancellate.
 */

import type { Dive, Sample } from '../core/model';

/** Chiave locale del cestino. Non è fra le `SHARED_SETTINGS`: non si sincronizza. */
export const TRASH_KEY = 'trash';

/** Dopo quanti giorni una cancellazione diventa definitiva da sé. */
export const TRASH_DAYS = 30;

/** Oltre questo numero il cestino comincia a costare in spazio: si avvisa. */
export const TRASH_SOFT_LIMIT = 50;

export interface TrashedDive {
  /** Il documento completo, senza profili: quelli stanno accanto. */
  dive: Dive;
  samples?: Sample[];
  altSamples?: Sample[];
  /** Quando è stata cestinata, ISO 8601. */
  at: string;
}

/** Giorni che restano prima che la cancellazione diventi definitiva. */
export function daysLeft(item: TrashedDive, now = Date.now()): number {
  const elapsed = (now - Date.parse(item.at)) / 86_400_000;
  return Math.max(0, Math.ceil(TRASH_DAYS - elapsed));
}

/** Vero se è ora che questa cancellazione diventi definitiva. */
export function expired(item: TrashedDive, now = Date.now()): boolean {
  return now - Date.parse(item.at) >= TRASH_DAYS * 86_400_000;
}

/**
 * Separa quello che resta recuperabile da quello che è scaduto.
 *
 * Funzione pura con `now` esplicito: la scadenza è metà del significato di questo
 * modulo, e una funzione che legge l'orologio da sola non si può provare.
 */
export function partitionTrash(
  items: TrashedDive[],
  now = Date.now(),
): { keep: TrashedDive[]; purge: TrashedDive[] } {
  const keep: TrashedDive[] = [];
  const purge: TrashedDive[] = [];
  for (const item of items) (expired(item, now) ? purge : keep).push(item);
  return { keep, purge };
}

/** Gli identificativi nel cestino: la sincronizzazione li deve saltare in entrambi i versi. */
export function trashedIds(items: TrashedDive[]): Set<string> {
  return new Set(items.map((t) => t.dive.id));
}

/** Il più recente per primo: nel cestino si cerca quello appena buttato. */
export function sortTrash(items: TrashedDive[]): TrashedDive[] {
  return [...items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
