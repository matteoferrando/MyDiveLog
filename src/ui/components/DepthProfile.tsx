/**
 * Profilo di profondità e serie allineate.
 *
 * L'asse Y del profilo è invertito — 0 in alto, il fondo in basso — perché è così
 * che un subacqueo legge un'immersione: il grafico ha la stessa forma del tuffo.
 *
 * Tre scelte di disegno che hanno una ragione, non un gusto:
 *
 *  - **una misura per grafico.** Temperatura, TTS, NDL, CNS e pressione non
 *    stanno sul profilo: hanno scale diverse e un secondo asse Y renderebbe le
 *    curve confrontabili solo per caso. Sono grafici separati, con lo STESSO asse
 *    dei tempi e lo stesso margine sinistro, così le creste si leggono in
 *    verticale — che è il confronto che serve ("quando sono scesa, il TTS è
 *    salito").
 *  - **cursore condiviso.** Passando il mouse su un grafico qualsiasi, tutti
 *    mostrano l'istante corrispondente. Senza questo, allineare a occhio due
 *    grafici da 50 minuti è un esercizio di fede.
 *  - **il gradiente del riempimento** va dal chiaro in superficie allo scuro sul
 *    fondo: dà la profondità come informazione visiva ridondante rispetto
 *    all'asse, e rende leggibile la forma anche in miniatura.
 */

import { useState } from 'react';
import type { Dive, Sample } from '../../core/model';
import { LIMITS } from '../../core/model';
import { formatDuration } from '../../core/units';
import { Legend, Tooltip, niceTicks, useWidth, type TooltipState } from './Charts';

/**
 * Margine sinistro condiviso da tutti i grafici della scheda: è ciò che allinea
 * gli assi dei tempi uno sotto l'altro. Se ogni grafico calcolasse il proprio in
 * base alla larghezza delle etichette, le curve non sarebbero confrontabili in
 * verticale.
 */
export const GUTTER = 46;

export interface CursorSync {
  /** Istante puntato, secondi. `null` quando il mouse è fuori. */
  t: number | null;
  onChange: (t: number | null) => void;
}

export function DepthProfile({
  dive,
  height = 300,
  cursor: sync,
}: {
  dive: Dive;
  height?: number;
  cursor?: CursorSync;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);

  const samples = dive.samples ?? [];
  if (samples.length < 2) {
    return (
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Questa immersione non ha un profilo campionato: il formato di origine conteneva solo i dati di
        sintesi.
      </p>
    );
  }

  const pad = { top: 14, right: 14, bottom: 24, left: GUTTER };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const maxT = samples[samples.length - 1].t || 1;
  const maxDepth = Math.max(dive.maxDepth, ...samples.map((s) => s.depth));
  // Poco margine sopra il massimo: con 1.06 un'immersione a 29 m si prendeva un
  // asse fino a 40, e il profilo sembrava schiacciato in cima.
  const depthTicks = niceTicks(0, maxDepth * 1.02, 4);
  const yMax = depthTicks[depthTicks.length - 1];

  const px = (t: number) => pad.left + (t / maxT) * plotW;
  const py = (d: number) => pad.top + (d / yMax) * plotH; // invertito: 0 in alto

  // Nessun `useMemo` qui, e non è una dimenticanza: questo codice sta DOPO un
  // return anticipato (l'immersione senza profilo), quindi un hook in questo punto
  // verrebbe chiamato in alcuni render e non in altri. React conta gli hook, e il
  // conteggio che cambia fa cadere il componente — è esattamente il bug per cui le
  // schede delle immersioni con profilo non si aprivano più: al primo render i
  // campioni non erano ancora caricati, al secondo sì, e il numero di hook passava
  // da 2 a 3. Costruire la stringa del percorso costa una frazione di millisecondo.
  const depthPath = samples
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${px(s.t).toFixed(1)} ${py(s.depth).toFixed(1)}`)
    .join(' ');
  const areaPath = `${depthPath} L${px(maxT).toFixed(1)} ${py(0)} L${px(0)} ${py(0)} Z`;

  const hasCeiling = samples.some((s) => (s.ceiling ?? s.stopDepth ?? 0) > 0);
  const ceilingLine = hasCeiling
    ? samples
        .map((s, i) => `${i === 0 ? 'M' : 'L'}${px(s.t).toFixed(1)} ${py(s.ceiling ?? s.stopDepth ?? 0).toFixed(1)}`)
        .join(' ')
    : null;
  const ceilingArea = ceilingLine
    ? `${ceilingLine} L${px(maxT).toFixed(1)} ${py(0)} L${px(0)} ${py(0)} Z`
    : null;

  const cursorSample = sync?.t != null ? nearest(samples, sync.t) : null;

  const hover = (evt: React.MouseEvent<SVGSVGElement>) => {
    const rect = evt.currentTarget.getBoundingClientRect();
    const t = ((evt.clientX - rect.left - pad.left) / plotW) * maxT;
    const sample = nearest(samples, t);
    if (!sample) return;
    sync?.onChange(sample.t);
    const rows: { label: string; value: string }[] = [
      { label: 'Profondità', value: `${sample.depth.toFixed(1)} m` },
    ];
    if (sample.tempC !== undefined) rows.push({ label: 'Temperatura', value: `${sample.tempC.toFixed(1)} °C` });
    const pressure = sample.pressureBar?.find((p) => p !== undefined);
    if (pressure !== undefined) rows.push({ label: 'Bombola', value: `${Math.round(pressure)} bar` });
    const ceiling = sample.ceiling ?? sample.stopDepth;
    if (ceiling) {
      rows.push({ label: 'Tetto', value: `${ceiling.toFixed(1)} m` });
      if (sample.stopTimeS) rows.push({ label: 'Tappa', value: `${Math.round(sample.stopTimeS / 60)} min` });
    } else if (sample.ndlS !== undefined) {
      rows.push({ label: 'NDL', value: `${Math.round(sample.ndlS / 60)} min` });
    }
    if (sample.ttsS !== undefined) rows.push({ label: 'TTS', value: `${Math.round(sample.ttsS / 60)} min` });
    if (sample.cns !== undefined && sample.cns > 0) rows.push({ label: 'CNS', value: `${sample.cns}%` });
    if (sample.ppo2 !== undefined) rows.push({ label: 'PPO2', value: `${sample.ppo2.toFixed(2)} bar` });
    if (sample.rbtMin !== undefined) rows.push({ label: 'RBT', value: `${sample.rbtMin} min` });
    if (sample.bearing !== undefined) rows.push({ label: 'Bussola', value: `${Math.round(sample.bearing)}°` });
    setTip({ x: px(sample.t), y: py(sample.depth), title: formatDuration(sample.t), rows });
  };

  const [lo, hi] = LIMITS.safetyStopBandM;
  const gradientId = `depth-fill-${dive.id.slice(0, 8)}`;

  return (
    <div className="chart" ref={ref}>
      <Legend
        items={[
          { label: 'Profondità', color: 'var(--series-1)', kind: 'area' },
          ...(hasCeiling
            ? [{ label: 'Tetto di decompressione letto dal computer', color: 'var(--series-2)', kind: 'line' as const }]
            : []),
          ...(dive.events?.length ? [{ label: 'Segnalibri sul computer', color: 'var(--series-3)', kind: 'line' as const }] : []),
        ]}
      />
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        style={{ display: 'block' }}
        onMouseMove={hover}
        onMouseLeave={() => {
          setTip(null);
          sync?.onChange(null);
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.04} />
          </linearGradient>
        </defs>

        {/* Fascia della sosta di sicurezza: contesto, non dato — quindi tenue e
            con l'etichetta, perché una banda colorata senza spiegazione è rumore. */}
        <rect x={pad.left} y={py(lo)} width={plotW} height={py(hi) - py(lo)} fill="var(--series-3)" opacity={0.07} />
        <text
          className="axis-label"
          x={width - pad.right - 4}
          y={py(lo) - 4}
          textAnchor="end"
          opacity={0.7}
        >
          sosta di sicurezza {lo}–{hi} m
        </text>

        {/* Griglia orizzontale e verticale, in tono recessivo. */}
        {depthTicks.map((t) => (
          <g key={`h${t}`}>
            <line x1={pad.left} x2={width - pad.right} y1={py(t)} y2={py(t)} stroke="var(--grid)" strokeWidth={1} />
            <text className="axis-label" x={pad.left - 8} y={py(t) + 3.5} textAnchor="end">
              {t === 0 ? '0 m' : t}
            </text>
          </g>
        ))}
        {timeTicks(maxT).map((t) => (
          <line
            key={`v${t}`}
            x1={px(t)}
            x2={px(t)}
            y1={pad.top}
            y2={pad.top + plotH}
            stroke="var(--grid)"
            strokeWidth={1}
            opacity={0.6}
          />
        ))}

        <path d={areaPath} fill={`url(#${gradientId})`} />
        {ceilingArea && <path d={ceilingArea} fill="var(--series-2)" opacity={0.1} />}
        {ceilingLine && (
          <path d={ceilingLine} fill="none" stroke="var(--series-2)" strokeWidth={1.75} strokeLinejoin="round" />
        )}
        <path
          d={depthPath}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Segnalibri: l'unico contenuto del profilo messo lì dal subacqueo. */}
        {dive.events?.map((e) => (
          <g key={`${e.t}-${e.label ?? ''}`}>
            <line
              x1={px(e.t)}
              x2={px(e.t)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="var(--series-3)"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.8}
            />
            <path
              d={`M${px(e.t) - 4} ${pad.top} L${px(e.t) + 4} ${pad.top} L${px(e.t)} ${pad.top + 6} Z`}
              fill="var(--series-3)"
            />
          </g>
        ))}

        {cursorSample && (
          <>
            <line
              x1={px(cursorSample.t)}
              x2={px(cursorSample.t)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="var(--axis)"
              strokeWidth={1}
            />
            <circle
              cx={px(cursorSample.t)}
              cy={py(cursorSample.depth)}
              r={4}
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          </>
        )}

        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + plotH}
          y2={pad.top + plotH}
          stroke="var(--axis)"
          strokeWidth={1}
        />
        {timeTicks(maxT).map((t) => (
          <text key={`l${t}`} className="axis-label" x={px(t)} y={height - 7} textAnchor="middle">
            {Math.round(t / 60)}′
          </text>
        ))}
      </svg>
      <Tooltip state={tip} containerWidth={width} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Serie secondaria allineata al profilo.
 *
 * Un solo asse, una sola serie. La scala si adatta ai dati con un margine del
 * 10%: prima partiva da tacche "belle" che includevano lo zero, e una temperatura
 * fra 19 e 28 °C finiva schiacciata in una fascia con metà del grafico vuota.
 */
export function MiniSeries({
  samples,
  pick,
  label,
  unit,
  height = 96,
  color = 'var(--series-1)',
  digits = 0,
  cursor: sync,
  /** Se vero, riempie l'area sotto la curva: utile per le grandezze cumulative. */
  fill = false,
  reference = [],
  compare,
}: {
  samples: Sample[];
  pick: (s: Sample, i: number) => number | undefined;
  /**
   * Una seconda curva sullo stesso grafico e sulla stessa scala.
   *
   * Serve a un caso solo, ed è quello per cui esiste: mettere accanto il valore
   * che ha scritto il computer e quello che abbiamo calcolato noi. Due
   * implementazioni dello stesso modello che divergono dicono qualcosa, e su due
   * grafici separati la divergenza non si vede.
   */
  compare?: { pick: (s: Sample, i: number) => number | undefined; label: string; color?: string };
  label: string;
  unit: string;
  height?: number;
  color?: string;
  digits?: number;
  cursor?: CursorSync;
  fill?: boolean;
  /** Linee di riferimento: limiti raccomandati, soglie, zero. */
  reference?: { value: number; label: string; color?: string }[];
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);

  const points = samples
    .map((s, i) => ({ t: s.t, v: pick(s, i) }))
    .filter((p): p is { t: number; v: number } => p.v !== undefined && Number.isFinite(p.v));

  const otherPoints = compare
    ? samples
        .map((s, i) => ({ t: s.t, v: compare.pick(s, i) }))
        .filter((p): p is { t: number; v: number } => p.v !== undefined && Number.isFinite(p.v))
    : [];

  if (points.length < 2) return null;

  const pad = { top: 10, right: 14, bottom: 14, left: GUTTER };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const maxT = samples[samples.length - 1].t || 1;

  // La scala comprende entrambe le curve: due grafici con assi diversi
  // sovrapposti sarebbero un modo elegante di mentire.
  const values = [...points.map((p) => p.v), ...otherPoints.map((p) => p.v)];
  // Le linee di riferimento entrano nella scala: una soglia fuori dal grafico non
  // serve a niente.
  const refValues = reference.map((r) => r.value);
  const dataLo = Math.min(...values, ...refValues);
  const dataHi = Math.max(...values, ...refValues);
  const span = dataHi - dataLo || Math.max(1, Math.abs(dataHi) * 0.1);
  // Se la grandezza non può essere negativa, l'asse non ci va.
  //
  // Il margine del dieci per cento sotto il minimo serve a non incollare la curva
  // al bordo, ma su una serie che parte da zero — minuti in curva, tetto, TTS,
  // CNS — produceva un asse da −50 a 150 per dei valori fra 0 e 99: metà grafico
  // sprecato a mostrare numeri che non esistono.
  const lowBound = dataLo >= 0 ? Math.max(0, dataLo - span * 0.1) : dataLo - span * 0.1;
  const ticks = niceTicks(lowBound, dataHi + span * 0.1, 3);
  const yLo = ticks[0];
  const yHi = ticks[ticks.length - 1];

  const px = (t: number) => pad.left + (t / maxT) * plotW;
  const py = (v: number) => pad.top + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.t).toFixed(1)} ${py(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${px(points[points.length - 1].t).toFixed(1)} ${py(yLo)} L${px(points[0].t).toFixed(1)} ${py(yLo)} Z`;
  const otherLine = otherPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.t).toFixed(1)} ${py(p.v).toFixed(1)}`)
    .join(' ');

  const cursorPoint =
    sync?.t != null
      ? points.reduce((a, b) => (Math.abs(b.t - sync.t!) < Math.abs(a.t - sync.t!) ? b : a), points[0])
      : null;

  return (
    <div className="chart" ref={ref}>
      <div className="mini-title">
        <span>
          {label} <span className="muted">({unit})</span>
          {compare && otherPoints.length > 1 && (
            <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>
              — tratteggiato: {compare.label}
            </span>
          )}
        </span>
        {/* Etichetta diretta sull'ultimo valore, invece di farlo cercare nell'asse. */}
        <span className="mini-last tabular">
          {cursorPoint ? cursorPoint.v.toFixed(digits) : points[points.length - 1].v.toFixed(digits)}
        </span>
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        style={{ display: 'block' }}
        onMouseMove={(evt) => {
          const rect = evt.currentTarget.getBoundingClientRect();
          const t = ((evt.clientX - rect.left - pad.left) / plotW) * maxT;
          const p = points.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a), points[0]);
          sync?.onChange(p.t);
          setTip({
            x: px(p.t),
            y: py(p.v),
            title: formatDuration(p.t),
            rows: [{ label: unit, value: p.v.toFixed(digits) }],
          });
        }}
        onMouseLeave={() => {
          setTip(null);
          sync?.onChange(null);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={py(t)} y2={py(t)} stroke="var(--grid)" strokeWidth={1} />
            <text className="axis-label" x={pad.left - 8} y={py(t) + 3.5} textAnchor="end">
              {t.toFixed(digits)}
            </text>
          </g>
        ))}
        {timeTicks(maxT).map((t) => (
          <line
            key={`v${t}`}
            x1={px(t)}
            x2={px(t)}
            y1={pad.top}
            y2={pad.top + plotH}
            stroke="var(--grid)"
            strokeWidth={1}
            opacity={0.5}
          />
        ))}
        {reference.map((r, i) => (
          <g key={r.label}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={py(r.value)}
              y2={py(r.value)}
              stroke={r.color ?? 'var(--critical)'}
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.7}
            />
            {/* Le etichette si alternano fra destra e sinistra: due limiti vicini
                fra loro — 6 e 10 m/min — si sovrapponevano illeggibilmente. */}
            <text
              className="axis-label"
              x={i % 2 === 0 ? width - pad.right - 2 : pad.left + 4}
              y={py(r.value) - 3}
              textAnchor={i % 2 === 0 ? 'end' : 'start'}
              opacity={0.9}
            >
              {r.label}
            </text>
          </g>
        ))}
        {fill && <path d={area} fill={color} opacity={0.12} />}
        {/* La curva di confronto va SOTTO, tratteggiata: quella che comanda la
            scala e l'etichetta è la principale. */}
        {otherLine && (
          <path
            d={otherLine}
            fill="none"
            stroke={compare?.color ?? 'var(--text-muted)'}
            strokeWidth={1.2}
            strokeDasharray="4 3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        {cursorPoint && (
          <>
            <line
              x1={px(cursorPoint.t)}
              x2={px(cursorPoint.t)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="var(--axis)"
              strokeWidth={1}
            />
            <circle cx={px(cursorPoint.t)} cy={py(cursorPoint.v)} r={3} fill={color} />
          </>
        )}
      </svg>
      <Tooltip state={tip} containerWidth={width} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function nearest(samples: Sample[], t: number): Sample | undefined {
  if (samples.length === 0) return undefined;
  let best = samples[0];
  let bestDist = Math.abs(best.t - t);
  for (const s of samples) {
    const d = Math.abs(s.t - t);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

/** Tacche temporali ogni 5, 10, 15 o 30 minuti secondo la durata. */
export function timeTicks(maxT: number): number[] {
  const minutes = maxT / 60;
  const step = minutes > 90 ? 1800 : minutes > 45 ? 900 : minutes > 20 ? 600 : 300;
  const out: number[] = [];
  for (let t = 0; t <= maxT; t += step) out.push(t);
  return out;
}
