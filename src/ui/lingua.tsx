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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { LOCALE_DELLA_LINGUA, registraLocale } from '../core/locale';
import type { Traduci } from '../core/traduci';

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
  return adotta(linguaSalvataOdiSistema());
}

function linguaSalvataOdiSistema(): Lingua {
  try {
    const salvata = localStorage.getItem(CHIAVE);
    if (salvata === 'it' || salvata === 'en') return salvata;
  } catch {
    // Un browser che nega l'archivio locale non è un motivo per non partire.
  }
  const sistema = typeof navigator !== 'undefined' ? navigator.language : 'it';
  return sistema?.toLowerCase().startsWith('it') ? 'it' : 'en';
}

/**
 * Scegliere una lingua vuol dire anche scegliere come si scrivono date e numeri.
 *
 * Le due cose erano separate e non dovevano esserlo: il dizionario traduceva le
 * frasi, ma «domenica 12 luglio 2026» non passa dal dizionario — la scrive ICU,
 * a cui bisogna dire il locale. Chi sceglieva EN si ritrovava le frasi inglesi e
 * le date italiane. Da qui in poi il locale si registra NELLO STESSO PUNTO in cui
 * la lingua viene decisa, così i due non possono più separarsi.
 *
 * Perché qui e non in un `useEffect`: un effetto gira dopo il primo disegno, e il
 * locale non è stato di React — nessuno ridisegnerebbe le date già scritte, e chi
 * apre l'app in inglese si terrebbe una prima schermata di date italiane. Qui
 * invece la registrazione avviene prima che i figli disegnino qualunque cosa. È
 * una scrittura, quindi impura in un inizializzatore di `useState`; ma è
 * idempotente — riscrivere lo stesso locale non fa niente — e questo la rende
 * innocua anche al doppio giro che StrictMode fa in sviluppo.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► E LA TERZA COSA CHE DIPENDE DALLA LINGUA: `<html lang>`. ◄
 *
 * Era l'unica delle tre a stare FUORI di qui — si scriveva solo dentro `cambia`,
 * cioè solo se qualcuno premeva il pulsante. Chi apriva l'applicazione con il
 * telefono in inglese leggeva «Dives logged» dentro un documento che continuava
 * a dichiarare `lang="it"` (`index.html`), e **uno screen reader legge l'inglese
 * con la fonetica italiana**: non è una sfumatura, è testo incomprensibile. Il
 * pulsante EN, per giunta, era già `aria-pressed="true"` — quindi chi avrebbe
 * potuto correggere la situazione premendolo non aveva nessun motivo di farlo.
 *
 * Adesso le tre conseguenze di «che lingua parliamo» — dizionario, locale ICU e
 * lingua dichiarata del documento — partono tutte dallo stesso punto, e non
 * possono più separarsi. È la stessa ragione per cui il locale è finito qui.
 */
function adotta(l: Lingua): Lingua {
  registraLocale(LOCALE_DELLA_LINGUA[l]);
  // Fuori dal browser — i test del nucleo, la generazione delle schermate — non
  // c'è nessun documento da dichiarare, e non averlo non è un errore.
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  return l;
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
    setLingua(adotta(l));
    try {
      localStorage.setItem(CHIAVE, l);
    } catch {
      // Come sopra: la scelta vale per questa sessione e amen.
    }
    // `<html lang>` non si scrive più qui: lo scrive `adotta`, insieme al locale
    // ICU, così vale anche per la lingua di partenza e non solo per il cambio.
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

/**
 * La stessa traduzione, ma con un'identità che non cambia mai.
 *
 * SERVE PER QUELLO CHE VIVE PIÙ A LUNGO DI UN RENDER. La `t` di `useLingua()` è
 * una funzione nuova ogni volta che cambia la lingua o il dizionario, ed è
 * giusto così: i componenti si devono ridisegnare. Ma alcune cose la ricevono
 * **una volta sola** e se la tengono — l'archivio, che `getStore()` costruisce
 * al primo avvio e poi restituisce sempre uguale; il trasporto Bluetooth, che è
 * un oggetto solo per tutta la sessione. A quelle, passare la `t` del momento
 * significa congelare la lingua di quel momento: si cambia lingua e i loro
 * messaggi restano in italiano per sempre.
 *
 * Questa invece è una scorza stabile attorno a un riferimento che si aggiorna a
 * ogni render: l'identità non cambia mai — quindi non fa ricostruire niente e
 * non muove nessuna lista di dipendenze — ma quando la si chiama legge la
 * lingua di ADESSO. È il classico «ref che insegue lo stato», e qui è il modo di
 * far convivere un oggetto di lunga vita con una preferenza che cambia.
 */
export function useTraduciStabile(): Traduci {
  const { t } = useLingua();
  const ultima = useRef(t);
  // L'aggiornamento sta in un effetto e non nel corpo del render: scrivere su un
  // ref durante il render è ciò che `react-hooks/refs` segnala, e qui non serve —
  // nessuno chiama la traduzione mentre si disegna, la chiamano gli avvisi di un
  // import e i messaggi di un errore, sempre dopo.
  useEffect(() => {
    ultima.current = t;
  }, [t]);
  return useCallback((italiano: string) => ultima.current(italiano), []);
}

export function useLingua(): Contesto {
  const c = useContext(CONTESTO);
  if (!c) {
    // Fuori dalla provveditura — succede nei test che montano un componente da
    // solo — si resta in italiano invece di far cadere il componente. Nemmeno il
    // locale si tocca: chi non è dentro la provveditura non ha scelto niente, e
    // sovrascrivere il registro da qui vorrebbe dire che montare un componente
    // isolato riporta in italiano le date di tutta l'applicazione.
    return { lingua: 'it', cambia: () => {}, t: (s) => s };
  }
  return c;
}

/**
 * La lingua come riga di impostazione, e non come interruttore nella barra.
 *
 * ► PERCHÉ NE È NATA UNA SECONDA VERSIONE, il 15 settembre 2026. ◄
 *
 * Sul telefono la coppia IT/EN stava in fondo al menu a comparsa, ed era
 * l'elemento più forte dello schermo: due caselle, una piena del colore
 * d'accento, sotto otto voci tutte uguali. Chi ha guardato l'app da fuori l'ha
 * detto subito — la cosa che si vede per prima aprendo il menu è la cosa che si
 * usa una volta nella vita dell'installazione. Un comando raro non può essere
 * il più appariscente.
 *
 * Qui dentro invece è una riga come le altre: titolo a sinistra, valore a
 * destra, alta quanto il resto. È il posto dove chiunque abbia usato un
 * telefono va a cercarla.
 *
 * ► ED È RIMASTA L'UNICA. ◄ Fino al 16 settembre 2026 sopra i 700 px c'era
 * anche la coppia IT/EN nella barra, e le due si vedevano insieme: stessa
 * `cambia()`, due vestiti diversi, sulla stessa schermata. Era la prima cosa
 * che chi usa l'applicazione ha segnalato guardando il desktop. Adesso il
 * comando è uno, e sta dove si cercano le impostazioni.
 *
 * ► I NOMI DELLE LINGUE NON SI TRADUCONO. ◄ «Italiano» e «English», sempre
 * così, in tutte e due le lingue dell'interfaccia. È la regola di ogni sistema
 * operativo, e la ragione è ovvia appena la si dice: chi cerca la propria
 * lingua in un elenco la cerca com'è scritta a casa sua — non sa come la
 * chiamano qui.
 */
export function RigaLingua() {
  const { lingua, cambia, t } = useLingua();
  return (
    <div className="card">
      <div className="riga-impostazione">
        <h2 style={{ margin: 0 }}>{t('Lingua')}</h2>
        <select
          value={lingua}
          onChange={(e) => cambia(e.target.value as Lingua)}
          /* L'etichetta porta tutte e due le parole: un lettore di schermo
             impostato in inglese su un'interfaccia italiana legge comunque
             qualcosa che si riconosce. */
          aria-label="Lingua / Language"
        >
          <option value="it">Italiano</option>
          <option value="en">English</option>
        </select>
      </div>
    </div>
  );
}
