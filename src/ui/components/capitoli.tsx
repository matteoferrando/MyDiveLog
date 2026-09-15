/**
 * IL REGISTRO DEI CAPITOLI DI UNA PAGINA, e chi è aperto.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ ESISTE, dal 15 settembre 2026. ◄
 *
 * `CartaApribile` sapeva già chi è aperto e chi no — una mappa di modulo — ma
 * quella mappa era **privata e muta**: nessuno da fuori poteva sapere quali
 * capitoli ci fossero in una pagina, né aprirne uno. Finché l'unico modo di
 * aprire un capitolo era toccarlo, andava bene.
 *
 * Poi è arrivato il navigatore laterale, che è un indice: deve elencare i
 * capitoli **nell'ordine in cui stanno a schermo**, dire in quale ci si trova, e
 * portarci dentro con un tocco — aprendolo, perché portare qualcuno davanti a un
 * riquadro chiuso è come consegnargli un libro alla pagina giusta ma sigillato.
 *
 * ► DUE CONTESTI E NON UNO, e non è pignoleria. ◄ Le carte consumano solo
 * `registra`, che non cambia mai; il navigatore consuma l'elenco, che cambia a
 * ogni montaggio. Con un contesto solo, registrare la diciottesima carta delle
 * Statistiche farebbe ridisegnare anche le diciassette di prima — diciotto volte
 * di fila all'apertura della pagina, cioè il contrario di quello che questa
 * pagina stava cercando di ottenere.
 *
 * ► L'ORDINE SI CHIEDE AL DOCUMENTO, non all'ordine di registrazione. ◄ Le due
 * cose coincidono quasi sempre e *quasi* non basta: una carta che compare dopo —
 * perché il suo dato è arrivato, perché un ramo condizionale si è acceso — si
 * registrerebbe in fondo pur stando in mezzo, e l'indice indicherebbe i capitoli
 * in un ordine che non è quello della pagina. `compareDocumentPosition` dice
 * dove stanno davvero.
 */

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export interface Capitolo {
  chiave: string;
  titolo: string;
  /** Il numero che il capitolo produce: il navigatore lo mostra insieme al nome. */
  sommario: ReactNode;
  nodo: HTMLElement;
}

/*
 * ────────────────────────────────────────────────────────────────────────────
 * CHI È APERTO
 *
 * Una mappa di modulo e non `localStorage`, come `memoriaDellElenco.ts`: chi
 * apre un riquadro lo ritrova aperto finché l'applicazione è accesa, e alla
 * riapertura si riparte dai valori predefiniti. Se un giorno servisse ricordarlo
 * anche dopo, il posto è `setSetting` dell'archivio — ma va deciso, perché una
 * scelta ricordata per sempre è una scelta che nessuno si ricorda di aver fatto.
 *
 * Gli ascoltatori sono la novità: senza, `apriCapitolo()` cambierebbe la mappa e
 * nessuno se ne accorgerebbe fino al prossimo render per altre ragioni. Il
 * navigatore porterebbe davanti a un riquadro ancora chiuso, che è il difetto
 * peggiore di tutti: *l'azione sembra fatta e non è successo niente.*
 */
const aperti = new Map<string, boolean>();
const ascoltatori = new Set<() => void>();

function avvisa(): void {
  for (const f of ascoltatori) f();
}

export function ascoltaAperture(f: () => void): () => void {
  ascoltatori.add(f);
  return () => {
    ascoltatori.delete(f);
  };
}

export function statoDiApertura(chiave: string): boolean | undefined {
  return aperti.get(chiave);
}

export function impostaApertura(chiave: string, valore: boolean): void {
  aperti.set(chiave, valore);
  avvisa();
}

/** Per le prove, che altrimenti si passerebbero lo stato l'una con l'altra. */
export function dimenticaSezioniAperte(): void {
  aperti.clear();
  avvisa();
}

/*
 * ────────────────────────────────────────────────────────────────────────────
 * IL REGISTRO
 */

type Registra = (c: Capitolo) => () => void;

/* Fuori da una provveditura non si registra niente e non si rompe niente: è il
   caso delle prove che montano una carta da sola, ed è anche il caso del
   desktop, dove il navigatore non esiste. */
const CONTESTO_REGISTRA = createContext<Registra>(() => () => {});
const CONTESTO_LISTA = createContext<Capitolo[]>([]);

export function ProvvedituraCapitoli({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Capitolo[]>([]);

  const registra = useCallback<Registra>((c) => {
    setLista((prima) => [...prima.filter((x) => x.chiave !== c.chiave), c]);
    return () => setLista((prima) => prima.filter((x) => x.chiave !== c.chiave));
  }, []);

  /*
   * L'ordine del DOCUMENTO, ricalcolato quando l'elenco cambia.
   *
   * `compareDocumentPosition` restituisce una maschera di bit: il bit 4
   * (`DOCUMENT_POSITION_FOLLOWING`) è acceso quando l'altro nodo viene DOPO.
   * Si ordina con quello invece che con l'ordine di arrivo, per la ragione
   * scritta in testa al file.
   */
  const ordinata = useMemo(
    () =>
      [...lista].sort((a, b) =>
        a.nodo.compareDocumentPosition(b.nodo) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      ),
    [lista],
  );

  return (
    <CONTESTO_REGISTRA.Provider value={registra}>
      <CONTESTO_LISTA.Provider value={ordinata}>{children}</CONTESTO_LISTA.Provider>
    </CONTESTO_REGISTRA.Provider>
  );
}

/** L'elenco dei capitoli della pagina, nell'ordine in cui stanno a schermo. */
export function useCapitoli(): Capitolo[] {
  return useContext(CONTESTO_LISTA);
}

/**
 * Registra un capitolo finché il suo riquadro è montato.
 *
 * `titolo` e `sommario` entrano nelle dipendenze perché cambiano davvero: il
 * primo con la lingua, il secondo a ogni ricalcolo della pagina. Un indice che
 * resta in italiano dopo aver premuto EN è il difetto che questa applicazione ha
 * già pagato altrove, e costa una riga di dipendenze evitarlo.
 */
export function useRegistraCapitolo(
  nodo: HTMLElement | null,
  chiave: string,
  titolo: string,
  sommario: ReactNode,
): void {
  const registra = useContext(CONTESTO_REGISTRA);
  /*
   * ► `useLayoutEffect` E NON `useEffect`, ed è una misura. ◄
   *
   * Con l'effetto normale la registrazione avviene DOPO che il browser ha
   * disegnato: `.main` compariva senza la classe `con-navigatore`, e un
   * fotogramma più tardi si stringeva di dieci pixel. Misurato: la sequenza di
   * `className` su `<main>` era `["main", "main con-navigatore"]` — cioè
   * Statistiche, Gas e la scheda di un'immersione facevano un salto laterale a
   * ogni apertura.
   *
   * Gli effetti di layout girano prima della pittura: la classe c'è già al primo
   * fotogramma e il salto non esiste.
   */
  useLayoutEffect(() => {
    if (!nodo) return;
    return registra({ chiave, titolo, sommario, nodo });
  }, [registra, nodo, chiave, titolo, sommario]);
}

/**
 * Lo stato aperto/chiuso di un capitolo, che segue anche le aperture altrui.
 *
 * `useSyncExternalStore` e non un `useState` con un effetto: è la forma che
 * React vuole per un dato che vive fuori dai suoi componenti, e l'unica che non
 * lascia una finestra in cui il riquadro è disegnato chiuso mentre la mappa dice
 * aperto.
 */
export function useApertura(chiave: string, apertoDiDefault: boolean): [boolean, () => void] {
  const aperto = useSyncExternalStore(
    ascoltaAperture,
    () => statoDiApertura(chiave) ?? apertoDiDefault,
    () => apertoDiDefault,
  );
  const cambia = useCallback(() => {
    impostaApertura(chiave, !(statoDiApertura(chiave) ?? apertoDiDefault));
  }, [chiave, apertoDiDefault]);
  return [aperto, cambia];
}
