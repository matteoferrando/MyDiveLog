/**
 * La temperatura dell'acqua, presa da dove c'è.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO CHE QUESTO FILE CHIUDE, e lo ha trovato un subacqueo. ◄
 *
 * Nella scheda il riquadro «Temperatura minima» diceva **«—»**, e trenta
 * centimetri più sotto il grafico della temperatura disegnava una riga piatta a
 * **30,0 °C**. Lo stesso schermo, lo stesso dato, due risposte diverse.
 *
 * La causa: `Dive.minTempC` è la temperatura **dichiarata nel riepilogo** dal
 * computer o dal file, e ci sono formati che non la scrivono. Il profilo però
 * porta `tempC` su ogni campione, e `computeMetrics` lo sa da sempre —
 * `minTempC: dive.minTempC ?? minOf(samples)`. Il valore calcolato finiva in
 * `metrics`, e **nessuno lo leggeva**: la scheda, il PDF, il CSV,
 * l'esportazione UDDF, le statistiche e il confronto pescavano tutti dal campo
 * dichiarato. Per un'immersione senza riepilogo la temperatura, nel resto
 * dell'applicazione, semplicemente non esisteva.
 *
 * ► LE CONSEGUENZE ERANO PIÙ LARGHE DI UN RIQUADRO VUOTO. ◄
 *
 *  - `coldDives` conta le immersioni sotto i 14 °C con `(d.minTempC ?? 99)`:
 *    un'immersione fredda senza riepilogo **non è mai stata contata fredda**;
 *  - l'esportazione UDDF ometteva `<lowesttemperature>`, quindi riesportando si
 *    **perdeva** un dato che era in archivio;
 *  - il PDF del libretto — quello che si manda a un centro o a
 *    un'assicurazione — stampava un trattino.
 *
 * ► PERCHÉ UNA FUNZIONE E NON UNA RISCRITTURA DELL'ARCHIVIO. ◄ Perché il numero
 * **c'è già**: sta in `metrics.minTempC` di ogni immersione con un profilo, da
 * sempre. Leggerlo di lì fa comparire la temperatura su tutto l'archivio
 * esistente **senza ricalcolare niente e senza toccare un solo record**. Scrivere
 * il valore derivato dentro `minTempC` avrebbe anche confuso due cose che è bene
 * restino distinte: quello che il computer ha dichiarato e quello che noi
 * abbiamo deduito dal profilo.
 */

import type { Dive } from './model';

/**
 * La temperatura minima dell'acqua in °C: quella dichiarata, o quella misurata
 * sul profilo. `undefined` solo quando non c'è né l'una né l'altra.
 *
 * **L'ordine conta.** Prima il riepilogo del computer, che è una misura sua e in
 * genere è il minimo vero dell'immersione; poi il minimo dei campioni, che su un
 * profilo rado può cadere fra due letture. *Preferire il dichiarato non è
 * deferenza: è che quel numero l'ha calcolato l'apparecchio su tutti i suoi
 * campionamenti interni, non sui pochi che ha salvato.*
 */
export function temperaturaMinimaC(dive: Dive): number | undefined {
  return dive.minTempC ?? dive.metrics?.minTempC;
}
