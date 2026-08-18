/**
 * Scelta della finestra temporale per statistiche e piano.
 *
 * Sta in un componente unico usato dalle due viste perché la finestra è una sola:
 * se statistiche e piano potessero avere periodi diversi, il piano direbbe cosa
 * fare in base a numeri che non sono quelli mostrati accanto.
 *
 * Mostra sempre quante immersioni entrano e quante restano fuori. Una finestra
 * temporale che nasconde silenziosamente metà dell'archivio è il modo più rapido
 * di far leggere una media come se riguardasse tutto.
 */

import { MIN_DIVES_FOR_ANALYSIS, PERIODS, type PeriodId } from '../../core/analysis/window';
import { dateShort, imm } from '../format';
import { useDiveLog } from '../state';

export function PeriodPicker() {
  const { period, setPeriod, scope, dives } = useDiveLog();
  const thin = scope.dives.length < MIN_DIVES_FOR_ANALYSIS && dives.length > scope.dives.length;

  return (
    <div className="card">
      {/*
        Il gruppo dei bottoni deve poter andare a capo: con `flexShrink: 0` la sua
        larghezza restava quella dei quattro bottoni in fila — «Ultimi 6 mesi …
        Tutto l'archivio» sono circa 380 px da soli — e su un telefono da 390 px
        la pagina intera diventava scorrevole in orizzontale. Il blocco di
        testo prende `minWidth: 0` perché altrimenti nemmeno lui accetta di
        stringersi sotto la lunghezza della sua riga più lunga.
      */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <h2>Periodo considerato</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            {scope.period.description}
          </p>
        </div>
        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          {PERIODS.map((p) => (
            <button
              key={p.id}
              className="btn"
              aria-pressed={p.id === period}
              onClick={() => setPeriod(p.id as PeriodId)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12, margin: '12px 0 0' }}>
        {imm(scope.dives.length)} nel periodo
        {scope.from && scope.to ? ` · dal ${dateShort(scope.from)} al ${dateShort(scope.to)}` : ''}
        {scope.excluded > 0 ? ` · ${scope.excluded} più vecchie escluse dai calcoli` : ''}
        {scope.excluded > 0 ? ' · il logbook continua a mostrarle tutte' : ''}
      </p>

      {thin && (
        <div className="notice" style={{ marginTop: 12 }}>
          Con {imm(scope.dives.length)} le medie e le tendenze di questo periodo sono fragili: ogni singola
          immersione le sposta. Per un giudizio più solido allarga la finestra.
        </div>
      )}
    </div>
  );
}
