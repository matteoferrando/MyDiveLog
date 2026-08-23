/**
 * Confronto fra due immersioni.
 *
 * Due profili sullo stesso grafico e le stesse metriche affiancate. Serve a una
 * domanda che il logbook da solo non risponde: *cosa è cambiato*. Lo stesso sito a
 * un anno di distanza, la stessa profondità con due assetti diversi, il prima e il
 * dopo di un corso.
 *
 * I due profili sono disegnati sullo stesso asse dei tempi ma NON riscalati alla
 * stessa durata: allungare quello più corto per farli combaciare renderebbe
 * confrontabili due cose che non lo sono. Le durate diverse si vedono, ed è
 * un'informazione. A schermo di questo ragionamento resta una riga sola: il
 * "perché" sta qui, dove serve a chi scrive il codice, non a chi si immerge.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Dive, Sample } from '../../core/model';
import { formatDuration } from '../../core/units';
import { useWidth } from '../components/Charts';
import { dateShort } from '../format';
import { useDiveLog } from '../state';
import { Vuoto } from '../components/Vuoto';
import { useLingua } from '../lingua';

export function Compare({ onOpen }: { onOpen: (id: string) => void }) {
  const { dives, loadSamples } = useDiveLog();
  const { t } = useLingua();
  const [leftId, setLeftId] = useState<string>(dives[0]?.id ?? '');
  const [rightId, setRightId] = useState<string>(dives[1]?.id ?? '');
  const [profiles, setProfiles] = useState<Record<string, Sample[]>>({});

  // I profili si caricano su richiesta: in memoria ci sono solo i riepiloghi.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const id of [leftId, rightId]) {
        if (!id || profiles[id]) continue;
        const samples = await loadSamples(id);
        if (cancelled) return;
        setProfiles((p) => ({ ...p, [id]: samples }));
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [leftId, rightId, loadSamples, profiles]);

  const left = dives.find((d) => d.id === leftId);
  const right = dives.find((d) => d.id === rightId);

  if (dives.length < 2) {
    // Due casi diversi con due risposte diverse: con l'archivio vuoto la cosa da
    // fare è importare, con una sola immersione è farne un'altra. Il messaggio
    // unico diceva «con una sola» anche quando non ce n'era nessuna.
    //
    // `Vuoto` traduce da sé titolo ed etichetta del pulsante: qui si passano in
    // italiano, che è la chiave del dizionario.
    return (
      <Vuoto
        titolo={dives.length === 0 ? 'Ancora niente da confrontare' : 'Servono due immersioni'}
        azione={{ vista: 'import', etichetta: 'Vai a Importa' }}
      >
        {t(
          dives.length === 0
            ? 'Importa le immersioni e qui metti due profili sullo stesso grafico.'
            : 'Ce n’è una sola. Il confronto mette due profili sullo stesso grafico.',
        )}
      </Vuoto>
    );
  }

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">{t('Confronta')}</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {t('Due profili sullo stesso grafico, e le stesse misure affiancate.')}
        </span>
      </div>

      <div className="card">
        <div className="grid grid-2" style={{ gap: 12 }}>
          <DivePicker
            label={t('Prima immersione')}
            dives={dives}
            value={leftId}
            onChange={setLeftId}
            colour="var(--series-1)"
          />
          <DivePicker
            label={t('Seconda immersione')}
            dives={dives}
            value={rightId}
            onChange={setRightId}
            colour="var(--series-2)"
          />
        </div>
      </div>

      {left && right && (
        <>
          <div className="card">
            <h2>{t('I due profili')}</h2>
            {/* Il perché della scelta — nessun riscalamento alla stessa durata —
                sta in cima al file. A schermo basta dire che le durate diverse
                si vedono. */}
            <p className="card-sub">{t('Nessuno dei due è riscalato: se una dura meno, si vede.')}</p>
            <TwoProfiles
              left={{ dive: left, samples: profiles[leftId] ?? [] }}
              right={{ dive: right, samples: profiles[rightId] ?? [] }}
            />
          </div>

          <div className="card">
            <h2>{t('Le differenze')}</h2>
            {/* Una misura che c'è da una parte sola non è una differenza piccola:
                vuol dire che le due immersioni non sono confrontabili su quella
                riga. Per questo la riga resta e lo dichiara invece di sparire. */}
            <p className="card-sub">{t('Dove un valore manca da una parte sola, la riga lo dichiara.')}</p>
            <ComparisonTable left={left} right={right} onOpen={onOpen} />
          </div>
        </>
      )}
    </div>
  );
}

function DivePicker({
  label,
  dives,
  value,
  onChange,
  colour,
}: {
  label: string;
  dives: Dive[];
  value: string;
  onChange: (id: string) => void;
  colour: string;
}) {
  const { t } = useLingua();
  return (
    <label className="planner-field">
      <span className="planner-label">
        <span
          className="legend-key"
          style={{ background: colour, height: 3, display: 'inline-block', width: 14, marginRight: 6 }}
        />
        {label}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {dives.map((d) => (
          <option key={d.id} value={d.id}>
            {dateShort(d.startTime, d.utcOffsetMinutes)} · {d.site?.name ?? t('senza sito')} ·{' '}
            {d.maxDepth.toFixed(0)} m · {formatDuration(d.durationS)}
          </option>
        ))}
      </select>
    </label>
  );
}

function TwoProfiles({
  left,
  right,
}: {
  left: { dive: Dive; samples: Sample[] };
  right: { dive: Dive; samples: Sample[] };
}) {
  const { t } = useLingua();
  const { ref, width } = useWidth<HTMLDivElement>();
  const height = 300;
  const pad = { left: 38, right: 12, top: 16, bottom: 28 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const maxT = Math.max(left.dive.durationS, right.dive.durationS, 1);
  const maxD = Math.max(left.dive.maxDepth, right.dive.maxDepth, 1);
  const x = (t: number) => pad.left + (t / maxT) * plotW;
  const y = (d: number) => pad.top + (d / maxD) * plotH;

  const path = (samples: Sample[]) =>
    samples.length
      ? samples.map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s.depth).toFixed(1)}`).join(' ')
      : '';

  const missing = !left.samples.length || !right.samples.length;

  return (
    <div className="chart" ref={ref}>
      {missing && (
        <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
          {!left.samples.length && !right.samples.length
            ? t('Nessuna delle due ha un profilo campionato.')
            : t('Una delle due non ha un profilo: il grafico mostra solo l’altra.')}
        </p>
      )}
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
        {[0, maxD / 2, maxD].map((d) => (
          <g key={d}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(d)}
              y2={y(d)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text className="axis-label" x={pad.left - 6} y={y(d) + 3} textAnchor="end">
              {Math.round(d)}
            </text>
          </g>
        ))}
        <path d={path(left.samples)} fill="none" stroke="var(--series-1)" strokeWidth={2} />
        <path d={path(right.samples)} fill="none" stroke="var(--series-2)" strokeWidth={2} />
        {[0, maxT / 2, maxT].map((t) => (
          <text key={t} className="axis-label" x={x(t)} y={height - 8} textAnchor="middle">
            {formatDuration(Math.round(t))}
          </text>
        ))}
        {/* Unità, non frase: "m ↓" resta uguale in tutte le lingue. */}
        <text className="axis-label" x={pad.left} y={height - 8 - 12} textAnchor="start">
          m ↓
        </text>
      </svg>
      <div className="chart-legend">
        <span>
          <span className="legend-key" style={{ background: 'var(--series-1)' }} />
          {dateShort(left.dive.startTime, left.dive.utcOffsetMinutes)}
        </span>
        <span>
          <span className="legend-key" style={{ background: 'var(--series-2)' }} />
          {dateShort(right.dive.startTime, right.dive.utcOffsetMinutes)}
        </span>
      </div>
    </div>
  );
}

/** Una riga per misura: valore a sinistra, valore a destra, differenza. */
function ComparisonTable({ left, right, onOpen }: { left: Dive; right: Dive; onOpen: (id: string) => void }) {
  const { t } = useLingua();
  /*
   * Le etichette restano in ITALIANO qui dentro e passano da `t()` solo al
   * disegno: sono la chiave del dizionario, e sono anche la chiave di React per
   * la riga — se cambiassero con la lingua, cambiare lingua smonterebbe e
   * rimonterebbe tutta la tabella. La stessa regola vale per le tabelle di
   * costanti in Statistiche.
   */
  const rows = useMemo(() => {
    const l = left.metrics;
    const r = right.metrics;
    return [
      { label: 'Profondità massima', unit: 'm', a: left.maxDepth, b: right.maxDepth, lower: null },
      { label: 'Profondità media', unit: 'm', a: l?.avgDepth, b: r?.avgDepth, lower: null },
      { label: 'Durata', unit: 'min', a: left.durationS / 60, b: right.durationS / 60, lower: null },
      { label: 'Consumo di superficie', unit: 'L/min', a: l?.rmvLpm, b: r?.rmvLpm, lower: true },
      {
        label: 'Assetto',
        unit: 'm/min',
        a: l?.bottomVerticalTravelMpm,
        b: r?.bottomVerticalTravelMpm,
        lower: true,
      },
      {
        label: 'Risalita di picco',
        unit: 'm/min',
        a: l?.maxAscentRateMpm,
        b: r?.maxAscentRateMpm,
        lower: true,
      },
      {
        label: 'Ultimo tratto',
        unit: 'm/min',
        a: l?.finalAscentRateMpm,
        b: r?.finalAscentRateMpm,
        lower: true,
      },
      {
        label: 'Sosta di sicurezza',
        unit: 'min',
        a: (l?.safetyStopS ?? 0) / 60,
        b: (r?.safetyStopS ?? 0) / 60,
        lower: false,
      },
      { label: 'CNS calcolato', unit: '%', a: l?.cnsPct, b: r?.cnsPct, lower: true },
      { label: 'OTU', unit: '', a: l?.otu, b: r?.otu, lower: true },
      { label: 'Temperatura minima', unit: '°C', a: left.minTempC, b: right.minTempC, lower: null },
    ];
  }, [left, right]);

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('Misura')}</th>
            <th style={{ textAlign: 'right' }}>
              <button className="linklike" onClick={() => onOpen(left.id)}>
                {dateShort(left.startTime, left.utcOffsetMinutes)}
              </button>
            </th>
            <th style={{ textAlign: 'right' }}>
              <button className="linklike" onClick={() => onOpen(right.id)}>
                {dateShort(right.startTime, right.utcOffsetMinutes)}
              </button>
            </th>
            <th style={{ textAlign: 'right' }}>{t('Differenza')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const both = row.a !== undefined && row.b !== undefined;
            const delta = both ? row.b! - row.a! : undefined;
            // Il verso "migliore" esiste solo per alcune misure: sulla profondità
            // massima non significa niente, e colorarla sarebbe un giudizio finto.
            const better =
              delta === undefined || row.lower === null || Math.abs(delta) < 0.05
                ? undefined
                : row.lower
                  ? delta < 0
                  : delta > 0;
            return (
              <tr key={row.label}>
                <td>{t(row.label)}</td>
                <td className="num tabular">{fmt(row.a, row.unit)}</td>
                <td className="num tabular">{fmt(row.b, row.unit)}</td>
                <td
                  className="num tabular"
                  style={{
                    fontWeight: 650,
                    color:
                      better === undefined
                        ? 'var(--text-muted)'
                        : better
                          ? 'var(--good-text)'
                          : 'var(--warning-text)',
                  }}
                >
                  {delta === undefined
                    ? t('non confrontabile')
                    : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}${row.unit ? ` ${row.unit}` : ''}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const fmt = (v: number | undefined, unit: string) =>
  v === undefined ? '—' : `${v.toFixed(1)}${unit ? ` ${unit}` : ''}`;
