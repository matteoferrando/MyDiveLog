/**
 * La profondità media, presa da dove c'è.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► È LO STESSO IDENTICO DIFETTO DI `temperatura.ts`, E L'HA TROVATO LO STESSO
 * SUBACQUEO. ◄
 *
 * Il 14 settembre 2026, su un archivio di 110 immersioni scaricate da uno
 * Shearwater: **la scheda dell'immersione scriveva «media 29.4 m» e l'elenco,
 * sulla stessa identica immersione, scriveva «—»**. Lo stesso schermo, lo stesso
 * dato, due risposte diverse — parola per parola la frase con cui si apre
 * `temperatura.ts`, scritta per il riquadro della temperatura contro il grafico
 * della temperatura.
 *
 * La causa ha la stessa forma. `Dive.avgDepth` è la media **dichiarata nel
 * riepilogo** dalla sorgente, e ci sono formati che non la scrivono: il parser
 * Shearwater dentro libdivecomputer **non implementa `DC_FIELD_AVGDEPTH`
 * affatto** — cercato nel sorgente di `shearwater_predator_parser.c`, zero
 * occorrenze, mentre durata, profondità massima, miscele, bombole, salinità e
 * modalità ci sono tutte. Il profilo però porta la profondità su ogni campione, e
 * `computeMetrics` ne fa la media pesata sul tempo da sempre. Quel valore
 * finiva in `metrics` e **quasi nessuno lo leggeva**.
 *
 * ► CHI LEGGEVA IL CAMPO SBAGLIATO, e cosa ne veniva fuori. ◄
 *
 *  - **l'elenco del logbook** scriveva «—» su ogni immersione scaricata via
 *    libdivecomputer, che è la maggioranza dell'archivio;
 *  - il **PDF della singola immersione** — quello che si manda a un centro —
 *    stampava un trattino;
 *  - il grafico **«consumo e profondità media»** delle statistiche scartava quei
 *    punti in silenzio, e il grafico sembrava semplicemente più povero;
 *  - l'**esportazione UDDF** ometteva `<averagedepth>`, quindi riesportando si
 *    perdeva un dato che era in archivio.
 *
 * Mentre la scheda, il confronto fra due immersioni e l'esportazione CSV
 * leggevano quello giusto. *Nessuna prova poteva accorgersene, e non per
 * mancanza di prove: ognuno dei due lettori era corretto rispetto al campo che
 * leggeva.* Il difetto non stava in una riga — stava nel fatto che le righe
 * fossero due.
 *
 * ► PERCHÉ UNA FUNZIONE E NON UNA RISCRITTURA DELL'ARCHIVIO. ◄ La stessa
 * ragione di `temperatura.ts`: il numero **c'è già**, sta in `metrics.avgDepth`
 * di ogni immersione con un profilo, e leggerlo di lì fa comparire la
 * profondità media su tutto l'archivio esistente **senza ricalcolare niente e
 * senza toccare un solo record**. *Che è anche l'unico rimedio possibile per le
 * 110 immersioni già scaricate: quelle non si possono riparare all'importazione,
 * perché sono già entrate.*
 */

import type { Dive } from './model';

/**
 * La profondità media in metri: quella misurata sul profilo, o quella dichiarata
 * dalla sorgente. `undefined` solo quando non c'è né l'una né l'altra.
 *
 * **L'ordine è l'OPPOSTO di `temperaturaMinimaC`, ed è voluto.** Là vince il
 * dichiarato, perché il minimo di temperatura l'apparecchio lo calcola su tutti
 * i suoi campionamenti interni mentre noi lo cerchiamo fra i pochi che ha
 * salvato. Qui vince il misurato, perché una media pesata sul tempo si ricostruisce
 * bene anche da un profilo rado, e soprattutto perché è la regola che questo
 * progetto applica ovunque: *il valore dichiarato non sovrascrive mai quello
 * letto dallo strumento.* La stessa riga che decide la miscela analizzata e il
 * consumo di superficie scritto a mano.
 *
 * Non è una scelta nuova presa qui: `computeMetrics` fa già esattamente questo
 * — `hasProfile ? mediaPesata(campioni) : dive.avgDepth`. Questa funzione non
 * decide niente, **espone** quella decisione a chi legge, più il ripiego per
 * un'immersione a cui le metriche non sono ancora state calcolate.
 */
export function profonditaMedia(dive: Dive): number | undefined {
  return dive.metrics?.avgDepth ?? dive.avgDepth;
}
