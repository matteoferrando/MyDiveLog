/**
 * Il numero progressivo di un'immersione.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IL DIFETTO CHE QUESTO FILE CHIUDE, visto il 24 agosto 2026: le due immersioni
 * appena scaricate via Bluetooth comparivano nel logbook con un trattino al
 * posto del numero, mentre tutte quelle di prima ne avevano uno.
 *
 * La causa non era il Bluetooth. Era che **il numero veniva assegnato dentro il
 * lettore di LogTRAK**, contando le immersioni di quel file in ordine
 * cronologico. Nessuno dei due computer registra un numero progressivo — nel
 * loro log c'è solo un indice interno di memoria, che si riusa — e LogTRAK non
 * lo esporta. Quindi il numero esisteva solo per un accidente: l'archivio era
 * nato da un unico file letto tutto insieme.
 *
 * E nascondeva un difetto peggiore del trattino. Assegnandolo DENTRO il file,
 * importare un secondo export LogTRAK con dieci immersioni avrebbe dato loro i
 * numeri da 1 a 10, sopra a quelli già in archivio. Dieci doppioni, senza un
 * avviso: il numero è la cosa con cui un subacqueo cita la propria immersione a
 * qualcun altro, e due immersioni con lo stesso numero sono peggio di nessun
 * numero.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGOLA. Il numero è la **posizione nel logbook**, non una proprietà del
 * file né del computer. È così che funziona un logbook di carta: la 105ª pagina
 * è la 105ª immersione, qualunque bombola avessi e qualunque programma tu abbia
 * usato per arrivarci.
 *
 * Da cui due conseguenze che vale la pena scrivere:
 *
 *  - **si calcola, non si conserva.** Scriverlo in archivio significherebbe
 *    riscrivere centoquattro record ogni volta che ne arriva una vecchia, e
 *    ognuna di quelle riscritture porta con sé una data di modifica nuova che
 *    la sincronizzazione interpreta come «questo dispositivo ha cambiato
 *    qualcosa». Un numero derivato non è un dato: è una vista.
 *  - **le immersioni nel cestino non contano.** Sono fuori dall'archivio, e un
 *    buco nella numerazione sarebbe la prova che c'era qualcosa che adesso non
 *    c'è più — cioè esattamente l'informazione che il cestino esiste per non
 *    dare. Rimettendole a posto i numeri tornano da soli.
 */

import type { Dive } from './model';

/**
 * Da identificativo a numero progressivo, contando dalla più vecchia.
 *
 * @param dives l'archivio, in qualunque ordine. Le immersioni nel cestino non
 *   devono essere qui dentro: se ci sono, contano.
 * @param precedenti quante immersioni ci sono state PRIMA di questo archivio.
 *   Serve a chi ha un logbook di carta alle spalle: con 40, la prima registrata
 *   è la 41. Zero per chi ha registrato tutto da sempre.
 */
export function numeriProgressivi(dives: Dive[], precedenti = 0): Map<string, number> {
  /*
   * L'ordinamento è per orario e POI per identificativo. Il secondo criterio
   * non è pedanteria: due immersioni possono avere lo stesso istante di inizio
   * — succede con i dati inseriti a mano, dove l'ora si scrive al minuto — e
   * senza un criterio di spareggio l'ordine dipenderebbe da come l'archivio è
   * stato letto. Il numero cambierebbe da un avvio all'altro, sulla stessa
   * immersione, senza che nessuno abbia toccato niente.
   */
  const ordinate = [...dives].sort((a, b) => {
    const ta = Date.parse(a.startTime);
    const tb = Date.parse(b.startTime);
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const numeri = new Map<string, number>();
  ordinate.forEach((d, i) => numeri.set(d.id, precedenti + i + 1));
  return numeri;
}

/**
 * Le stesse immersioni, col numero progressivo scritto dentro.
 *
 * Serve alle uscite — CSV, UDDF, stampa, PDF — che ricevono immersioni e non
 * hanno modo di sapere in che archivio vivono. Una riga sola al punto di
 * chiamata, invece di un parametro in più su ogni firma.
 *
 * Sovrascrive `Dive.number`, che resta il numero DICHIARATO DALLA FONTE quando
 * ce n'era uno: sul foglio che consegni deve comparire il tuo numero, non
 * quello che aveva nel logbook di qualcun altro.
 */
export function conNumeri(dives: Dive[], numeri: Map<string, number>): Dive[] {
  return dives.map((d) => {
    const n = numeri.get(d.id);
    return n === undefined ? d : { ...d, number: n };
  });
}
