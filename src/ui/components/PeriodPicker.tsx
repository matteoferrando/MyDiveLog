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
import { useLingua } from '../lingua';
import { useDiveLog } from '../state';

export function PeriodPicker() {
  const { period, setPeriod, scope, dives } = useDiveLog();
  const { t } = useLingua();
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
          <h2>{t('Periodo considerato')}</h2>
          {/*
            `PERIODS` è una tabella di costanti in `core/analysis/window.ts`:
            resta in italiano là — è la chiave del dizionario, e una costante non
            deve rinascere a ogni render — e si traduce qui, al disegno.
          */}
          <p className="card-sub" style={{ marginBottom: 0 }}>
            {t(scope.period.description)}
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
              {t(p.label)}
            </button>
          ))}
        </div>
      </div>

      {/*
        Le date e i conteggi restano fuori da `t()`: dentro una chiave ci
        andrebbe un numero, e una voce di dizionario per ogni numero non è una
        strada percorribile. Si traducono le parole che stanno intorno.
      */}
      <p className="muted" style={{ fontSize: 12, margin: '12px 0 0' }}>
        {imm(scope.dives.length, t)} {t('nel periodo')}
        {scope.from && scope.to
          ? ` · ${t('dal')} ${dateShort(scope.from)} ${t('al')} ${dateShort(scope.to)}`
          : ''}
        {scope.excluded > 0 ? ` · ${scope.excluded} ${t('più vecchie, fuori dai conti')}` : ''}
        {scope.excluded > 0 ? ` · ${t('il logbook le mostra comunque')}` : ''}
      </p>

      {/*
        Perché è fragile, e non lo diciamo più a schermo: con poche immersioni
        ogni singola immersione sposta media e tendenza. All'utente serve sapere
        cosa fare — allargare la finestra — non la statistica che c'è sotto.
      */}
      {thin && (
        <div className="notice" style={{ marginTop: 12 }}>
          {t('Poche immersioni: le medie sono fragili. Allarga la finestra.')}
        </div>
      )}
    </div>
  );
}
