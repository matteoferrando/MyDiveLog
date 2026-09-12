/**
 * Dove era arrivato l'elenco dell'archivio quando se n'è andato.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO, DETTO COME L'HA DETTO CHI L'HA TROVATO. ◄
 *
 * *«Quando apro un'immersione e poi torno indietro non mi metto in cima a
 * inizio pagina, ma all'altezza dove ero arrivato.»* Chiesto il 12 settembre
 * 2026, con centinaia di immersioni in archivio: guardarne tre di fila vuol
 * dire scorrere tre volte da zero, e il costo cresce proprio con l'archivio,
 * cioè con chi usa l'applicazione di più.
 *
 * ► PERCHÉ NON È UNO `useState` DENTRO `Logbook`. ◄ Perché `Logbook` **viene
 * smontato** quando si apre una scheda, e non per sbaglio: lo decide la `key`
 * dell'`ErrorBoundary` in `App.tsx`, che esiste perché un confine d'errore, una
 * volta scattato, non si azzera da solo — senza quella chiave da una scheda
 * rotta non si uscirebbe più. *Quella chiave protegge un guasto peggiore di
 * questo fastidio, quindi non si tocca:* è lo stato che deve sopravvivere a uno
 * smontaggio voluto, e uno stato così non appartiene all'albero dei componenti.
 *
 * ► E PERCHÉ L'ALTEZZA DA SOLA NON BASTA — LA TRAPPOLA. ◄ Smontando `Logbook`
 * muore anche la finestra delle righe: l'elenco ne disegna cinquanta per volta
 * e «mostra altre» ne aggiunge altrettante. Chi l'aveva premuto tre volte ed
 * era a riga centoquaranta, al ritorno troverebbe un elenco alto un terzo, e
 * **l'altezza salvata non esisterebbe più**: rimetterla com'era lo
 * scaraventerebbe in fondo alla lista. *Un rimedio che sembra funzionare su un
 * archivio corto e si rompe su quello lungo è peggio del difetto, perché il
 * difetto almeno era prevedibile.* Quindi qui dentro sta anche `quante`.
 *
 * ► E GIÀ CHE CI SIAMO, I FILTRI. ◄ Cercare «Puck», aprire la terza riga e
 * tornare a un elenco senza filtro è lo stesso difetto con un altro nome: hai
 * perso il posto, solo che stavolta l'hai perso in orizzontale. Una regola
 * sola — *l'elenco torna com'era* — invece di tre eccezioni.
 *
 * ► NON SOPRAVVIVE ALLA CHIUSURA DELL'APPLICAZIONE, ED È VOLUTO. ◄ Sta in
 * memoria e basta: niente `localStorage`. Riaprire il programma il giorno dopo
 * e ritrovarsi a metà elenco con un filtro che non ricordi di aver scritto non
 * è continuità, è un'applicazione che non parte da dove dice di partire.
 */

/** Le colonne per cui l'elenco si può ordinare. */
export type OrdineElenco = 'date' | 'depth' | 'duration' | 'rmv';

/** Tutto quello che serve per rimettere l'elenco come stava. */
export interface StatoElenco {
  query: string;
  luogo: string;
  profonditaMinima: string;
  ordine: OrdineElenco;
  /** Quante righe erano state caricate: senza, l'altezza qui sotto è irraggiungibile. */
  quante: number;
  /** `scrollTop` del contenitore che scorre, in pixel. */
  scorrimento: number;
}

let ricordo: StatoElenco | null = null;

/**
 * Si chiama **nell'istante in cui si apre una scheda**, non allo smontaggio.
 *
 * Allo smontaggio bisognerebbe leggere `scrollTop` da dentro una funzione di
 * pulizia, e quanto valga il DOM in quel momento è un dettaglio di come React
 * ordina il commit: oggi funzionerebbe, domani è una riga che nessuno sa più
 * spiegare. Al momento del tocco invece la pagina è ferma sotto il dito e la
 * misura è quella che si vede. *Si misura dove la cosa succede.*
 */
export function ricordaElenco(stato: StatoElenco): void {
  ricordo = stato;
}

/** Quello che c'era, o `null` la prima volta. Va letto UNA volta, al montaggio. */
export function elencoRicordato(): StatoElenco | null {
  return ricordo;
}

/** Per le prove, che altrimenti si passerebbero lo stato l'una con l'altra. */
export function dimenticaElenco(): void {
  ricordo = null;
}

/**
 * Il nodo che scorre davvero.
 *
 * ► NON È LA FINESTRA. ◄ In questa applicazione la barra laterale resta ferma e
 * a scorrere è `.main`: `window.scrollY` qui vale zero sempre, e un ripristino
 * scritto contro la finestra sarebbe una riga che non fallisce e non fa niente
 * — il genere di guasto che questo progetto raccoglie da settimane.
 *
 * Torna `null` dove quel nodo non c'è, che nelle prove è la normalità: chi
 * chiama non deve distinguere «non l'ho trovato» da «non c'è scorrimento», e
 * in tutti e due i casi la cosa giusta da fare è nessuna.
 */
export function contenitoreCheScorre(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.main');
}
