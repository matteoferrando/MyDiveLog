/**
 * Quello che vale per tutte le prove, prima che comincino.
 *
 * ► IL MURO DI «act(...)». ◄ Una passata di `npm test` stampava **centinaia** di
 * righe uguali:
 *
 *     The current testing environment is not configured to support act(...)
 *
 * Una per ogni render dei test che montano componenti. Nessuna di quelle righe
 * segnalava un difetto: React chiede solo che l'ambiente si dichiari come
 * ambiente di prova, e nessuno gliel'aveva mai detto. Il costo però era vero, ed
 * è lo stesso dei quattordici avvisi di lint corretti l'1 settembre: **un output
 * che nessuno può leggere insegna a non leggere l'output.** In mezzo a quelle
 * righe c'erano, e ci sono, i messaggi veri — quello dell'archivio che rifiuta
 * di aprirsi, per esempio — e li copriva.
 *
 * `IS_REACT_ACT_ENVIRONMENT` è la bandiera che React legge per sapere di essere
 * dentro una prova: alzata, `act()` fa il suo mestiere — svuota la coda degli
 * effetti prima di restituire il controllo — invece di lamentarsi. Vale anche
 * per i test in ambiente Node, dove semplicemente non la guarda nessuno.
 */

/**
 * ► E UN `localStorage` CHE C'È SEMPRE, PERCHÉ ALTRIMENTI DIPENDE DA NODE. ◄
 *
 * Due prove scritte la notte del 15 settembre sono passate verdi nel contenitore
 * e **rosse sul Mac**, sullo stesso commit: `Cannot read properties of undefined
 * (reading 'clear')`. La differenza non era il codice ed era Node — 22 nel
 * contenitore, 26 sul Mac — perché le versioni recenti dichiarano un
 * `localStorage` proprio, che senza il suo argomento a riga di comando non vale
 * niente e che l'ambiente di prova non sovrascrive.
 *
 * *Il progetto lo sapeva già*: la stessa trappola era stata pagata in
 * `pinDelComputer.test.tsx` e il rimedio copiato in `metodoDiCollegamento.test.tsx`
 * — cioè messo in due file su due, e in nessun posto dove lo trovasse il terzo.
 * **Una lezione imparata dentro un file di prova protegge quel file.** Qui sta
 * dove la prendono tutte.
 *
 * Si installa **solo se serve**: dove l'ambiente ne offre uno che funziona —
 * jsdom, che il suo lo lega al documento — resta quello vero, perché sostituirlo
 * cambierebbe sotto i piedi a prove che oggi funzionano. La prova che «funziona»
 * è scriverci dentro, non chiedersi se esiste: un oggetto che c'è e lancia è
 * esattamente il caso che ci ha fatto perdere questa mezz'ora.
 */
function localStorageUtilizzabile(): boolean {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    if (!s) return false;
    s.setItem('mydivelog.prova', '1');
    s.removeItem('mydivelog.prova');
    return true;
  } catch {
    return false;
  }
}

if (!localStorageUtilizzabile()) {
  const memoria = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      get length() {
        return memoria.size;
      },
      clear: () => memoria.clear(),
      getItem: (k: string) => (memoria.has(k) ? memoria.get(k)! : null),
      key: (i: number) => [...memoria.keys()][i] ?? null,
      removeItem: (k: string) => void memoria.delete(k),
      setItem: (k: string, v: string) => void memoria.set(k, String(v)),
    } satisfies Storage,
  });
}

declare global {
  // `var` e non `let`: in TypeScript è l'unico modo di dichiarare qualcosa
  // sull'oggetto globale. (Qui c'era anche un'eccezione per `no-var` — tolta,
  // perché quella regola in questo progetto non è accesa: una direttiva che non
  // spegne niente è rumore che sembra una precauzione.)
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export {};
