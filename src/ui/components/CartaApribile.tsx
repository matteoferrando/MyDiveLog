/**
 * UN RIQUADRO CHE SUL TELEFONO PARTE CHIUSO, E SUL COMPUTER NO.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► DA DOVE VIENE. ◄ Il 15 settembre 2026, misurando l'applicazione a 402 px —
 * la larghezza vera dell'iPhone 16 Pro — è venuto fuori quanto si scorre:
 *
 *   Gas                14.2 schermate        Statistiche        9.0
 *   Logbook            12.0                  Scheda immersione  6.4
 *
 * Non è un difetto di CSS: è che sul telefono ogni riquadro diventa largo
 * quanto lo schermo e alto quanto serve, e otto riquadri da mille pixel fanno
 * undicimila pixel. Su un Mac stanno affiancati e si vedono insieme; su un
 * telefono stanno in colonna e si attraversano tutti per arrivare all'ultimo.
 *
 * ► PERCHÉ «SI APRE» E NON «SI TOGLIE». ◄ Perché quei numeri servono. La scelta
 * fatta è: *niente sparisce, ma non tutto è aperto insieme.*
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ► LA REGOLA CHE RENDE QUESTA COSA UTILE INVECE CHE FASTIDIOSA. ◄
 *
 * **Un riquadro chiuso deve dire abbastanza da far decidere se aprirlo.** Un
 * titolo con una freccetta accanto non basta: chi legge «Quanti bar devi avere,
 * e quando» non sa se il piano gli sta dentro, quindi apre — e allora tanto
 * valeva lasciarlo aperto, con in più un tocco.
 *
 * Per questo `sommario` non è facoltativo per comodità: è il numero che quel
 * riquadro produce, mostrato accanto al titolo quando è chiuso. «rientro a 163
 * bar» si legge senza aprire niente, e si apre solo chi vuole vedere come ci si
 * arriva. *Un riassunto che non dice il numero è un titolo con una freccia.*
 *
 * ► E SUL COMPUTER NON CAMBIA NIENTE. ◄ Sopra i 700 px — la stessa soglia che
 * `App.tsx` usa per il menu — questo componente disegna esattamente il riquadro
 * di prima: un `<h2>`, il sottotitolo, il contenuto. Nessun pulsante, niente da
 * aprire, niente che un lettore di schermo debba annunciare come richiudibile.
 * Il telefono ha un problema che il desktop non ha, e la soluzione resta dove
 * sta il problema.
 */

import { useEffect, useId, useState, type ReactNode } from 'react';
import { comeSta, type Traduci } from '../../core/traduci';

/**
 * Quali riquadri sono aperti, per questa sessione.
 *
 * Un modulo e non `localStorage`, come `memoriaDellElenco.ts`: chi apre un
 * riquadro lo ritrova aperto finché l'applicazione è accesa, e alla riapertura
 * si riparte dai valori predefiniti. Se un giorno servisse ricordarlo anche
 * dopo, il posto è `setSetting` dell'archivio — ma va deciso, perché una scelta
 * ricordata per sempre è una scelta che nessuno si ricorda di aver fatto.
 */
const aperti = new Map<string, boolean>();

/** Per le prove, che altrimenti si passerebbero lo stato l'una con l'altra. */
export function dimenticaSezioniAperte(): void {
  aperti.clear();
}

/**
 * Vero quando siamo sotto la soglia del telefono.
 *
 * ► SI ASCOLTA IL CAMBIO, e non è pedanteria da desktop. ◄ Su un iPhone la
 * larghezza cambia ruotando l'apparecchio: in orizzontale un 16 Pro fa 874 px
 * logici, cioè **sopra la soglia**. Senza l'ascolto, chi ruota il telefono si
 * ritrova i riquadri chiusi su uno schermo largo, con il pulsante che li apre
 * nascosto dal CSS. Il menu di `App.tsx` ha esattamente questo ascolto, per
 * esattamente questa ragione.
 */
function useTelefono(): boolean {
  /*
   * ► `matchMedia?.()` CON IL PUNTO INTERROGATIVO, e non è prudenza generica. ◄
   *
   * In jsdom — cioè dentro le prove — `window` c'è e `window.matchMedia` no.
   * Senza il punto interrogativo questa riga lancia, React smonta l'albero, e
   * ventinove prove di quattro file diversi diventano rosse con «matchMedia is
   * not a function»: il 15 settembre 2026 è successo esattamente così. Il
   * progetto lo scrive già con `?.` in `scorri.ts` e in `DiveDetail.tsx`, per
   * questa ragione.
   *
   * ► E IL RIPIEGO È «SCHERMO LARGO», cioè tutto aperto. ◄ Quando la larghezza
   * non si può misurare, l'unica risposta che non nasconde niente è non
   * nascondere niente: una pagina più lunga si scorre, un riquadro chiuso che
   * nessuno sa di poter aprire è contenuto sparito. *Una misura che manca non
   * autorizza a togliere: autorizza solo a non aggiungere.*
   */
  const [stretto, setStretto] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 701px)').matches === false,
  );
  useEffect(() => {
    const largo = window.matchMedia?.('(min-width: 701px)');
    if (!largo) return;
    const suCambio = () => setStretto(!largo.matches);
    suCambio();
    largo.addEventListener('change', suCambio);
    return () => largo.removeEventListener('change', suCambio);
  }, []);
  return stretto;
}

export interface CartaApribileProps {
  /**
   * La chiave con cui questo riquadro si ricorda di essere aperto. Deve essere
   * stabile fra un render e l'altro e diversa da quella di ogni altro riquadro:
   * due riquadri con la stessa chiave si aprono e si chiudono insieme.
   */
  chiave: string;
  titolo: string;
  /** Il sottotitolo, se c'è: quello che oggi sta in `<p className="card-sub">`. */
  sotto?: ReactNode;
  /**
   * Il numero che questo riquadro produce, da leggere SENZA aprirlo.
   *
   * Vedi il riquadro in testa al file: senza, chi legge apre per forza e il
   * risparmio si trasforma in un tocco in più. Se un riquadro non ha un numero
   * da riassumere, probabilmente non è un riquadro che conviene chiudere.
   */
  sommario?: ReactNode;
  /** Aperto anche sul telefono: per il riquadro principale della pagina. */
  apertoDiDefault?: boolean;
  t?: Traduci;
  children: ReactNode;
}

export function CartaApribile({
  chiave,
  titolo,
  sotto,
  sommario,
  apertoDiDefault = false,
  t = comeSta,
  children,
}: CartaApribileProps) {
  const telefono = useTelefono();
  const [aperto, setAperto] = useState(() => aperti.get(chiave) ?? apertoDiDefault);
  const idCorpo = useId();

  const cambia = () => {
    const nuovo = !aperto;
    aperti.set(chiave, nuovo);
    setAperto(nuovo);
  };

  // Sul computer il riquadro è quello di sempre: nessun pulsante, nessun
  // `aria-expanded`, niente che si possa chiudere per sbaglio.
  if (!telefono) {
    return (
      <div className="card">
        <h2>{titolo}</h2>
        {sotto ? <p className="card-sub">{sotto}</p> : null}
        {children}
      </div>
    );
  }

  return (
    <div className={`card carta-apribile${aperto ? ' aperta' : ''}`}>
      {/*
        Il titolo È il pulsante, e non «un pulsante accanto al titolo»: l'area
        da toccare deve essere tutta la riga, perché su un telefono una freccia
        di dodici pixel con le mani bagnate non si prende.
      */}
      <button
        type="button"
        className="apri-sezione"
        onClick={cambia}
        aria-expanded={aperto}
        aria-controls={idCorpo}
      >
        <span className="apri-sezione-testo">
          <span className="apri-sezione-titolo">{titolo}</span>
          {/*
            Il sommario si vede solo da chiusa: aperto sarebbe la ripetizione di
            un numero che sta due centimetri più sotto.
          */}
          {!aperto && sommario ? <span className="apri-sezione-sommario">{sommario}</span> : null}
        </span>
        <span className="apri-sezione-freccia" aria-hidden="true">
          {aperto ? '−' : '+'}
        </span>
      </button>
      {/*
        `hidden` e non `display: none` a mano: toglie il contenuto dal flusso,
        dalla navigazione con TAB e dall'albero di accessibilità in una volta
        sola, ed è la cosa che `aria-expanded` sta dichiarando.

        Il contenuto resta MONTATO: un grafico smontato e rimontato ricalcola e
        rianima a ogni apertura, e chi apre e chiude due volte lo vede
        lampeggiare. Costa memoria e non tempo, che su questa pagina è il verso
        giusto.
      */}
      <div id={idCorpo} hidden={!aperto}>
        {sotto ? <p className="card-sub">{sotto}</p> : null}
        {children}
      </div>
      {/* Per chi usa un lettore di schermo: lo stato a parole, non solo il segno. */}
      <span className="solo-lettori">{aperto ? t('sezione aperta') : t('sezione chiusa')}</span>
    </div>
  );
}
