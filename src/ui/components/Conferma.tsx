/**
 * Chiedere conferma senza `window.confirm`.
 *
 * PERCHÉ ESISTE, e non è una preferenza di stile. Dentro la WKWebView di macOS
 * — cioè nell'applicazione vera, non nel browser — `window.confirm()` **non
 * mostra niente e restituisce `false`**: il pannello di sistema lo deve
 * implementare il guscio nativo, e se non lo fa la chiamata torna subito con un
 * «no». Il codice che segue è invariabilmente
 *
 *     if (!confirm('sei sicuro?')) return;
 *
 * quindi l'effetto è che il pulsante NON FA NIENTE. Nessun errore, nessuna
 * finestra, nessun messaggio: si preme «Sposta nel cestino» e non succede
 * niente, e l'unica conclusione possibile per chi guarda è che l'applicazione
 * sia rotta.
 *
 * Erano sei pulsanti su sei: cestino, cancella tutto, svuota il cestino,
 * cancellazione definitiva, ricostruisci l'archivio da zero, elimina
 * dall'immersione. Tutte le cose distruttive, tutte silenziosamente morte
 * nell'app desktop — e tutte funzionanti nel browser, che è il posto in cui
 * venivano provate.
 *
 * COME FUNZIONA. Il pulsante si arma: al primo clic diventa la domanda con due
 * risposte. Nessuna finestra modale, nessuna dipendenza dal guscio, e il testo
 * è nostro quindi è in italiano e dice cosa succede davvero. Chi clicca altrove
 * e torna dopo trova il pulsante disarmato, perché una domanda che resta
 * appesa è una domanda a cui si risponde per sbaglio.
 */

import { useEffect, useRef, useState } from 'react';

export function BottoneConferma({
  etichetta,
  domanda,
  conferma,
  onConferma,
  disabled,
  className,
  style,
}: {
  /** Il testo del pulsante a riposo, es. «Sposta nel cestino». */
  etichetta: string;
  /** La domanda per intero: cosa succede, e cosa NON si può disfare. */
  domanda: React.ReactNode;
  /** Il testo del pulsante che esegue, es. «Sì, sposta». */
  conferma: string;
  onConferma: () => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [armato, setArmato] = useState(false);
  const riquadro = useRef<HTMLDivElement>(null);

  /*
   * Si disarma da sé cliccando fuori o premendo Esc.
   *
   * Una conferma armata che resta lì è peggio di nessuna conferma: si torna
   * sulla pagina dieci minuti dopo, si vede un pulsante rosso che dice «Sì,
   * cancella» e non si ricorda più a cosa si riferisse.
   */
  useEffect(() => {
    if (!armato) return;
    const fuori = (e: PointerEvent) => {
      if (riquadro.current && !riquadro.current.contains(e.target as Node)) setArmato(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setArmato(false);
    };
    /*
     * `pointerdown` e non `mousedown`: col dito il secondo spesso non arriva.
     *
     * iOS sintetizza gli eventi del mouse solo sugli elementi che considera
     * cliccabili — un link, un pulsante, qualcosa con un gestore. Toccare il
     * testo di una carta, o uno spazio vuoto, non produce nessun `mousedown`,
     * quindi su iPhone questa via d'uscita non esisteva e la conferma restava
     * armata: esattamente la condizione che il commento qui sopra descrive come
     * pericolosa. `pointerdown` arriva per qualunque contatto.
     */
    document.addEventListener('pointerdown', fuori);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', fuori);
      document.removeEventListener('keydown', esc);
    };
  }, [armato]);

  if (!armato) {
    return (
      <button
        className={className}
        style={{ color: 'var(--critical)', ...style }}
        disabled={disabled}
        onClick={() => setArmato(true)}
      >
        {etichetta}
      </button>
    );
  }

  return (
    <div ref={riquadro} className="notice notice-error" role="alertdialog" style={{ margin: 0 }}>
      <div style={{ marginBottom: 8 }}>{domanda}</div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {/*
         * «Annulla» PRIMA e con l'aspetto del pulsante principale: chi preme
         * d'istinto il primo pulsante non deve cancellare niente.
         */}
        <button className="btn" onClick={() => setArmato(false)}>
          Annulla
        </button>
        <button
          disabled={disabled}
          style={{ color: 'var(--critical)' }}
          onClick={() => {
            setArmato(false);
            onConferma();
          }}
        >
          {conferma}
        </button>
      </div>
    </div>
  );
}
