/**
 * L'ORDINE DEI CAMPIONI, IN UN POSTO SOLO.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ ESISTE QUESTO FILE. ◄ Perché la stessa regola era scritta quattro
 * volte, in tre modi diversi, e in due posti non era scritta affatto.
 *
 * Nessuno garantisce che i campioni arrivino in ordine di tempo. `uddf.ts`
 * legge i `<waypoint>` come stanno scritti; un orologio che salta indietro a
 * metà immersione — succede, e ci sono file veri in cui succede — produce
 * campioni con `t` decrescente; e un lettore che consegna i blocchi nell'ordine
 * del documento può mettere la risalita prima del fondo.
 *
 * Il 15 settembre 2026 il difetto è stato chiuso nei due motori:
 * `computeMetrics` ordinava già, `runProfile` no, e col blocco di risalita
 * scritto per primo dichiarava **60.7 minuti di obbligo decompressivo su
 * un'immersione di 34.3 minuti**.
 *
 * ► E IL 16 SETTEMBRE SI È VISTO CHE I DUE DISEGNI ERANO RIMASTI FUORI. ◄
 * `diveProfileSvg` — il profilo stampato sul libretto che qualcuno
 * controfirma — prendeva l'istante iniziale da `punti[0].t`, cioè dal primo
 * campione DEL FILE. Misurato su un profilo di 31 punti con il blocco di
 * risalita scritto per primo: **15 punti su 31 finivano fuori dal riquadro**,
 * con ascisse negative, e la parte visibile era un disegno plausibile e falso.
 * `DepthProfile` faceva lo stesso con `samples[samples.length - 1].t` come
 * durata totale.
 *
 * *Un disegno sbagliato è peggio di un disegno assente: il posto dove manca si
 * vede, il posto dove mente no.*
 *
 * ► L'ORDINAMENTO È PER TEMPO E POI PER PROFONDITÀ. ◄ Due campioni allo stesso
 * istante — capitano nei file fatti a mano, dove l'ora si scrive al minuto —
 * senza un secondo criterio si disporrebbero come li ha letti il lettore, e il
 * risultato cambierebbe da un avvio all'altro senza che nessuno abbia toccato
 * niente. `metrics.ts` ordinava solo per tempo e `buhlmann.ts` anche per
 * profondità: sulla stessa immersione le due metà dell'analisi potevano vedere
 * due profili diversi.
 */

/** Il minimo che serve per stare su un grafico: un istante e una quota. */
export interface PuntoNelTempo {
  t: number;
  depth: number;
}

/**
 * Una copia dei campioni in ordine di tempo, senza quelli non numerici.
 *
 * Copia e non ordinamento sul posto: l'array arriva da `dive.samples`, che è la
 * scheda in archivio, e riordinarla sarebbe un effetto collaterale su un dato
 * che il chiamante non si aspetta cambi sotto i piedi.
 */
export function inOrdineDiTempo<T extends PuntoNelTempo>(campioni: readonly T[]): T[] {
  return campioni
    .filter((s) => s != null && Number.isFinite(s.t) && Number.isFinite(s.depth))
    .sort((a, b) => a.t - b.t || a.depth - b.depth);
}
