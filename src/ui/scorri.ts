/**
 * Portare a schermo la cosa che si è appena aperta.
 *
 * ► IL PROBLEMA NON È DI GRAFICA, È CHE IL PULSANTE SEMBRA ROTTO. ◄
 *
 * In questa applicazione gli elenchi hanno il modulo SOTTO, non dentro una
 * finestra che copre lo schermo. È una scelta voluta — una finestra modale su un
 * telefono nasconde proprio la riga che stai modificando, e chi compila vuole
 * vedere accanto il resto dell'elenco — ma ha un prezzo che si paga tutto in una
 * volta: premendo «Apri» sulla terza riga di una tabella di dodici, la scheda si
 * apre due schermate più giù e a schermo NON SUCCEDE NIENTE. Chi guarda non
 * pensa «si sarà aperta là sotto», pensa che il pulsante non funzioni. Su
 * iPhone, dove lo schermo è corto e le tabelle sono lunghe, succedeva quasi
 * sempre.
 *
 * La regola dell'applicazione è quindi una sola e vale ovunque: quando apri
 * qualcosa da modificare o da aggiungere, la pagina ti porta dove si scrivono i
 * dati. Questo aggancio è il modo di rispettarla senza riscriverla ogni volta,
 * ed è il motivo per cui sta in un file suo e non dentro una pagina: le pagine
 * che hanno un elenco con la scheda sotto sono cinque, e la sesta la scriverà
 * qualcuno che non ha letto le altre.
 *
 * ► PERCHÉ ASPETTA UN FOTOGRAMMA. ◄ L'effetto parte al montaggio, quando il nodo
 * esiste ma il disegno non è finito: le schede hanno griglie che si assestano e
 * campi che compaiono a seconda del tipo, e uno `scrollIntoView` calcolato su
 * un'altezza provvisoria manda la pagina in un punto che un istante dopo non è
 * più quello giusto. `requestAnimationFrame` aspetta che il browser abbia
 * disegnato davvero.
 *
 * ► PERCHÉ IL FUOCO SOLO CON UN PUNTATORE FINE. ◄ Mettere il cursore nel primo
 * campo è comodo con una tastiera vera. Su un telefono apre la tastiera a
 * schermo nello stesso istante in cui la pagina sta ancora scorrendo: la
 * finestra si accorcia di metà a metà viaggio, lo scorrimento in corso finisce
 * da un'altra parte, e ci si ritrova su un campo a caso con la tastiera aperta
 * che copre la scheda. Su un telefono si scorre e basta: il primo campo lo tocca
 * chi scrive, quando è pronto a scrivere.
 *
 * ► PERCHÉ `preventScroll`. ◄ Dare il fuoco a un campo porta il campo a schermo
 * per conto suo, e quello scorrimento arriva DOPO il nostro: senza questa
 * opzione la pagina si fermerebbe sul primo campo a metà schermo invece che
 * sull'intestazione della scheda, che è quella che dice cosa stai modificando.
 */
import { useEffect, useRef } from 'react';

/** Chi ha chiesto meno animazioni non vuole nemmeno questa: si arriva di colpo. */
function comeScorrere(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

/**
 * Il riferimento da mettere sul contenitore della scheda appena aperta.
 *
 * Senza `quando`, l'effetto parte al MONTAGGIO: va usato su un componente che
 * nasce quando la scheda si apre — montato dentro un `&&`, e con una `key`
 * legata all'id di ciò che si modifica, altrimenti aprire una seconda riga
 * riusa lo stesso componente e non succede niente. È il motivo per cui gli
 * elenchi mettono la `key`.
 *
 * Con `quando`, l'effetto parte a ogni cambio: è la forma per i riquadri che
 * restano montati e si limitano ad aprirsi.
 */
export function usePortaInVista<T extends HTMLElement = HTMLDivElement>(
  opzioni: {
    /**
     * Il momento in cui portare a schermo, per i riquadri che NON rinascono.
     *
     * Le schede degli elenchi si montano quando si aprono, e per loro va bene
     * il valore predefinito: l'effetto parte al montaggio. Altri riquadri —
     * «Nuova immersione», la firma della guida — restano montati e si limitano
     * a cambiare contenuto: lì il montaggio è avvenuto molto prima e non
     * segnala niente. Si passa la variabile che dice «adesso è aperto», e
     * l'effetto riparte quando cambia.
     */
    quando?: unknown;
    /** `false` dove il fuoco darebbe fastidio: un riquadro che non ha campi da riempire. */
    fuoco?: boolean;
    /** Dove fermarsi rispetto alla finestra. `start` = l'intestazione in cima. */
    punto?: ScrollLogicalPosition;
  } = {},
) {
  const { quando = true, fuoco = true, punto = 'start' } = opzioni;
  const rif = useRef<T>(null);

  useEffect(() => {
    // Chiudere non porta da nessuna parte: si resta dove si è.
    if (!quando) return;
    const nodo = rif.current;
    if (!nodo) return;
    const id = requestAnimationFrame(() => {
      // `scrollIntoView` non esiste in jsdom, dove le stesse schede vengono
      // montate dai test: l'assenza dello scorrimento non è un errore da
      // propagare, e il punto interrogativo costa meno di un try.
      nodo.scrollIntoView?.({ behavior: comeScorrere(), block: punto });
      if (!fuoco) return;
      if (!window.matchMedia?.('(pointer: fine)').matches) return;
      const primo = nodo.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
      );
      primo?.focus?.({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [quando, fuoco, punto]);

  return rif;
}
