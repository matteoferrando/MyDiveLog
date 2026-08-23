/**
 * Due lingue, un dizionario, nessuna libreria.
 *
 * COME FUNZIONA, ed è la scelta che rende possibile tradurre un'applicazione
 * già scritta senza riscriverla: **la chiave è la frase italiana**. Si avvolge
 * la stringa in `t()` e basta; il dizionario dice come si dice in inglese, e
 * quando una frase non c'è nel dizionario esce l'italiano — che è la chiave.
 *
 * Il prezzo è che cambiando una frase italiana si perde la sua traduzione. È il
 * prezzo giusto per questo progetto: l'alternativa — chiavi astratte tipo
 * `logbook.vuoto.titolo` — costringe a saltare in un altro file per sapere cosa
 * c'è scritto a schermo, e su un'applicazione che qualcuno scrive da solo
 * quello è un costo che si paga a ogni riga, per sempre.
 *
 * NIENTE LIBRERIA. i18next e compagnia portano pluralizzazione, formattazione
 * dei numeri, caricamento asincrono dei cataloghi: roba che serve a chi ha
 * venti lingue e un servizio di traduzione. Qui sono due lingue e un file.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lingua = 'it' | 'en';

/** Dove si ricorda la scelta. Sta nel browser e non nell'archivio: è una
 * preferenza di QUESTO dispositivo, e sincronizzarla vorrebbe dire che
 * cambiando lingua sul telefono cambia anche sul Mac. */
const CHIAVE = 'mydivelog.lingua';

/**
 * La lingua di partenza: quella del sistema, se la conosciamo.
 *
 * Chi apre l'app con un telefono in inglese si aspetta l'inglese, e chiederglielo
 * sarebbe una domanda a cui il sistema ha già risposto. L'italiano resta il
 * ripiego perché è la lingua in cui l'app è scritta: se il dizionario inglese
 * avesse un buco, in italiano quel buco non c'è.
 */
function linguaIniziale(): Lingua {
  try {
    const salvata = localStorage.getItem(CHIAVE);
    if (salvata === 'it' || salvata === 'en') return salvata;
  } catch {
    // Un browser che nega l'archivio locale non è un motivo per non partire.
  }
  const sistema = typeof navigator !== 'undefined' ? navigator.language : 'it';
  return sistema?.toLowerCase().startsWith('it') ? 'it' : 'en';
}

interface Contesto {
  lingua: Lingua;
  cambia: (l: Lingua) => void;
  /** Traduce, o restituisce la frase italiana così com'è. */
  t: (italiano: string) => string;
}

const CONTESTO = createContext<Contesto | null>(null);

export function ProvvedituraLingua({ children }: { children: ReactNode }) {
  const [lingua, setLingua] = useState<Lingua>(linguaIniziale);
  /*
   * IL DIZIONARIO ARRIVA A PARTE, e solo a chi legge inglese.
   *
   * Importato normalmente finiva nel pezzo di codice del primo avvio, che ha un
   * budget e lo sforava di trecento byte — il test lo ha preso. Ma il punto non
   * è il test: è che chi usa l'applicazione in italiano non ha nessun motivo di
   * scaricare le traduzioni inglesi, e chi la usa in inglese le scarica una
   * volta sola.
   *
   * Finché non è arrivato, `t()` restituisce l'italiano: è la stessa cosa che
   * fa per una frase non tradotta, quindi non serve nessuno stato di attesa e
   * non c'è niente che lampeggia — al massimo una frase resta italiana per
   * qualche millesimo di secondo.
   */
  const [dizionario, setDizionario] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (lingua !== 'en' || dizionario) return;
    let vivo = true;
    void import('./traduzioni').then((m) => {
      if (vivo) setDizionario(m.INGLESE);
    });
    return () => {
      vivo = false;
    };
  }, [lingua, dizionario]);

  const cambia = useCallback((l: Lingua) => {
    setLingua(l);
    try {
      localStorage.setItem(CHIAVE, l);
    } catch {
      // Come sopra: la scelta vale per questa sessione e amen.
    }
    if (typeof document !== 'undefined') document.documentElement.lang = l;
  }, []);

  const valore = useMemo<Contesto>(
    () => ({
      lingua,
      cambia,
      t: (italiano: string) => (lingua === 'it' ? italiano : (dizionario?.[italiano] ?? italiano)),
    }),
    [lingua, cambia, dizionario],
  );

  return <CONTESTO.Provider value={valore}>{children}</CONTESTO.Provider>;
}

export function useLingua(): Contesto {
  const c = useContext(CONTESTO);
  if (!c) {
    // Fuori dalla provveditura — succede nei test che montano un componente da
    // solo — si resta in italiano invece di far cadere il componente.
    return { lingua: 'it', cambia: () => {}, t: (s) => s };
  }
  return c;
}

/**
 * Il pulsante che cambia lingua.
 *
 * DUE SIGLE E NON UNA BANDIERA. Una bandiera dice «paese», non «lingua»: la
 * bandiera inglese esclude chi legge inglese e non è britannico, e la scelta di
 * quale bandiera usare per l'inglese è una discussione che non vale la pena
 * avere. `IT` e `EN` non hanno questo problema.
 */
export function CambiaLingua() {
  const { lingua, cambia } = useLingua();
  return (
    <div className="lingua" role="group" aria-label={lingua === 'it' ? 'Lingua' : 'Language'}>
      {(['it', 'en'] as const).map((l) => (
        <button
          key={l}
          onClick={() => cambia(l)}
          aria-pressed={lingua === l}
          className={lingua === l ? 'attiva' : undefined}
          title={l === 'it' ? 'Italiano' : 'English'}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
