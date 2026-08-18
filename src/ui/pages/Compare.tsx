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
 * un'informazione.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Dive, Sample } from '../../core/model';
import { formatDuration } from '../../core/units';
import { useWidth } from '../components/Charts';
import { dateShort } from '../format';
import { useDiveLog } from '../state';

export function Compare({ onOpen }: { onOpen: (id: string) => void }) {
  const { dives, loadSamples } = useDiveLog();
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
    return (
      <div className="page">
        <div className="empty">
          <h2>{dives.length === 0 ? 'Ancora niente da confrontare' : 'Servono due immersioni'}</h2>
          <p className="secondary" style={{ maxWidth: 460, margin: '0 auto' }}>
            {dives.length === 0
              ? "L'archivio è vuoto: importa un export dal tuo computer subacqueo e questa pagina mette due profili sullo stesso grafico."
              : "C'è una sola immersione in archivio. Il confronto serve a mettere due profili sullo stesso grafico: importane un'altra e torna qui."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">Confronta</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          Due profili sullo stesso grafico, e le stesse misure una accanto all'altra.
        </span>
      </div>

      <div className="card">
        <div className="grid grid-2" style={{ gap: 12 }}>
          <DivePicker
            label="Prima immersione"
            dives={dives}
            value={leftId}
            onChange={setLeftId}
            colour="var(--series-1)"
          />
          <DivePicker
            label="Seconda immersione"
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
            <h2>I due profili</h2>
            <p className="card-sub">
              Stesso asse dei tempi, nessuno dei due riscalato: se una dura meno, si vede. La scala delle
              profondità è quella della più profonda delle due.
            </p>
            <TwoProfiles
              left={{ dive: left, samples: profiles[leftId] ?? [] }}
              right={{ dive: right, samples: profiles[rightId] ?? [] }}
            />
          </div>

          <div className="card">
            <h2>Le differenze</h2>
            <p className="card-sub">
              Dove un valore manca da una parte sola, la riga resta e lo dichiara: è la differenza più
              importante da vedere, perché significa che le due immersioni non sono confrontabili su quella
              misura.
            </p>
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
            {dateShort(d.startTime, d.utcOffsetMinutes)} · {d.site?.name ?? 'senza sito'} ·{' '}
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
            ? 'Nessuna delle due ha un profilo campionato.'
            : 'Una delle due non ha un profilo campionato: il confronto grafico mostra solo l’altra.'}
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
            <th>Misura</th>
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
            <th style={{ textAlign: 'right' }}>Differenza</th>
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
                <td>{row.label}</td>
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
                          : 'var(--warning)',
                  }}
                >
                  {delta === undefined
                    ? 'non confrontabile'
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
