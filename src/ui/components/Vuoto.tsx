/**
 * Quello che si vede quando non c'è ancora niente.
 *
 * UNO SOLO PER TUTTE LE PAGINE, e con un pulsante. Prima ogni pagina aveva il
 * suo riquadro che diceva «importa un file per iniziare» e si fermava lì: chi
 * legge doveva trovarsi da sé la scheda giusta, che su un telefono sta dietro
 * il menu. Un vicolo cieco cortese resta un vicolo cieco.
 *
 * Il testo è corto di proposito. Una pagina vuota non è il posto per spiegare
 * come funziona l'applicazione: è il posto per dire cosa fare adesso.
 */

import type { ReactNode } from 'react';
import { useLingua } from '../lingua';
import { useVaiA, type Vista } from '../navigazione';

export function Vuoto({
  titolo,
  children,
  azione,
  nuda = false,
}: {
  titolo: string;
  children: ReactNode;
  /** Dove mandare, e con che parola sul pulsante. */
  azione?: { vista: Vista; etichetta: string };
  /*
   * Senza il proprio involucro `.page`, perché lo mette chi chiama.
   *
   * Serve a un caso solo, ma vero: la scheda dei suggerimenti tiene una regione
   * live come PRIMO FIGLIO di `.page` in tutti e due i rami — quello pieno e
   * quello vuoto. React riconcilia per posizione e per tipo di elemento: se il
   * ramo vuoto tornasse `<Vuoto>` invece di `<div className="page">`, l'albero
   * verrebbe smontato e rimontato, e la regione live perderebbe l'annuncio
   * proprio nell'istante in cui deve darlo — cioè quando si passa da un ramo
   * all'altro.
   */
  nuda?: boolean;
}) {
  const { t } = useLingua();
  const vaiA = useVaiA();
  const contenuto = (
    <div className="empty">
      <h2>{t(titolo)}</h2>
      <p className="secondary" style={{ maxWidth: 420, margin: '0 auto' }}>
        {children}
      </p>
      {azione && (
        <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={() => vaiA(azione.vista)}>
          {t(azione.etichetta)}
        </button>
      )}
    </div>
  );
  return nuda ? contenuto : <div className="page">{contenuto}</div>;
}
