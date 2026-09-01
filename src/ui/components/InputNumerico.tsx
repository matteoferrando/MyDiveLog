import { useEffect, useRef, useState } from 'react';
import { entroLimiti, numeroDaTesto } from '../numero';

/**
 * Un campo per un numero digitato a mano, che non combatte con chi digita.
 *
 * DUE DIFETTI, LA STESSA CASELLA. Sono stati trovati con l'app in mano, ed
 * erano entrambi invisibili ai test perché i test scrivono nei campi con
 * `fill()`, cioè in un colpo solo — mentre una persona batte una cifra alla
 * volta.
 *
 * 1. LA LIMITAZIONE A OGNI TASTO. Il campo limitava il valore a ogni battuta e
 *    rimandava il risultato al genitore, che tornava indietro e riscriveva il
 *    testo sotto le dita. Con un minimo di 3, chi digitava «18» vedeva la prima
 *    cifra diventare 3 e la seconda accodarsi: **38**. Nel pianificatore
 *    questo voleva dire un piano a 38 metri per chi ne aveva chiesti 18, e nel
 *    campo dell'ossigeno un EAN81 per chi aveva digitato 21 — con la MOD, le
 *    soste e il gas ricalcolati su quel numero, tutti plausibili e tutti
 *    sbagliati.
 *
 *    Rimedio in tre parti: mentre il campo ha il fuoco il testo non viene MAI
 *    riscritto da fuori; un valore fuori intervallo non viene emesso affatto —
 *    il genitore tiene l'ultimo valido invece di ricevere un numero che
 *    l'utente non ha finito di scrivere; e la limitazione avviene all'uscita
 *    dal campo, che è il momento in cui la cifra è finita.
 *
 * 2. LA VIRGOLA. Vedi `ui/numero.ts`: `type="number"` accetta solo il
 *    separatore della lingua della webview. Qui il campo è di testo con
 *    `inputMode="decimal"`, così la tastiera del telefono resta quella
 *    numerica e la stringa arriva intera.
 */
export function InputNumerico({
  value,
  onChange,
  min,
  max,
  step,
  ariaLabel,
  style,
  className,
  id,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  /** Solo per la spaziatura logica: un campo di testo non ha spinnerine. */
  step?: number;
  /**
   * Quello che sente chi non vede il campo. Arriva GIÀ TRADOTTO da chi chiama:
   * il nome del campo lo sa solo lui, e qui una seconda `t()` cercherebbe nel
   * dizionario una frase inglese che non è una chiave.
   */
  ariaLabel?: string;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
}) {
  const [testo, setTesto] = useState(String(value));
  const attivo = useRef(false);

  useEffect(() => {
    // Le dita di chi scrive vincono su qualunque valore arrivi da fuori: è
    // esattamente il conflitto che produceva «38» al posto di «18».
    if (attivo.current) return;
    // Il sistema esterno qui è LA TASTIERA: `attivo` dice che qualcuno sta scrivendo, e in quel
    // caso il valore che arriva da fuori non deve toccare il campo. È il conflitto che
    // produceva «38» al posto di «18», ed è la ragione per cui questo non si può derivare
    // durante il render — durante il render non si sa se le dita sono sul tasto.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (numeroDaTesto(testo) !== value) setTesto(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      id={id}
      aria-label={ariaLabel}
      className={className}
      style={style}
      value={testo}
      data-step={step}
      onFocus={() => (attivo.current = true)}
      onChange={(e) => {
        setTesto(e.target.value);
        const n = numeroDaTesto(e.target.value);
        if (n === undefined) return;
        // Fuori intervallo si aspetta: «1» di «18» non deve diventare un piano.
        if (min !== undefined && n < min) return;
        if (max !== undefined && n > max) return;
        onChange(n);
      }}
      onBlur={() => {
        attivo.current = false;
        const n = numeroDaTesto(testo);
        const finale = n === undefined ? value : entroLimiti(n, min, max);
        setTesto(String(finale));
        if (finale !== value) onChange(finale);
      }}
    />
  );
}
