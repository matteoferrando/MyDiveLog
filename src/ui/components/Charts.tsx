/**
 * Grafici.
 *
 * Costruiti in SVG a mano invece che con una libreria per tre ragioni:
 * il profilo di profondità (asse Y invertito, sovrapposizione del tetto deco)
 * nessuna libreria lo fa bene; il bundle resta leggero, che su iOS conta; e le
 * regole di stile (tratti sottili, spaziature, etichette selettive) si applicano
 * una volta qui invece di combattere i default di qualcun altro.
 *
 * Regole rispettate in tutti i grafici:
 *  - un solo asse Y per grafico, sempre. Due misure con scale diverse = due
 *    grafici affiancati, mai due scale sullo stesso disegno.
 *  - etichette selettive: il valore compare sull'estremo o sul massimo, non su
 *    ogni punto.
 *  - tooltip al passaggio del mouse su ogni grafico, non come extra.
 *  - griglia e assi in tono recessivo; il dato è l'unica cosa che urla.
 *  - il colore non è mai l'unico canale: legenda o etichette dirette sempre
 *    presenti quando ci sono due o più serie.
 */

import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Misura del contenitore: serve per disegnare in pixel reali invece di
// deformare i tratti con preserveAspectRatio.
// ---------------------------------------------------------------------------

/**
 * Larghezza reale del contenitore.
 *
 * `ref` è una FUNZIONE, non un oggetto, e non è un dettaglio stilistico: era un
 * bug vero. Con `useRef` più un effetto a dipendenze vuote, un componente che al
 * primo render NON monta il contenitore — il profilo di un'immersione i cui
 * campioni non sono ancora stati caricati mostra una frase e nient'altro — non
 * aveva niente da misurare, l'effetto usciva subito, e quando poi il contenitore
 * compariva l'effetto non veniva più eseguito. Risultato: il grafico restava
 * disegnato alla larghezza predefinita di 640 px dentro una carta larga il doppio,
 * disallineato rispetto ai grafici sotto, che invece si erano montati subito.
 *
 * Con un ref di callback l'effetto si riesegue nel momento in cui l'elemento
 * arriva, perché l'elemento è nello stato.
 */
export function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(640);

  useLayoutEffect(() => {
    if (!el) return;
    const update = () => {
      // `getBoundingClientRect` invece di `clientWidth`: dà la frazione di pixel e
      // non si perde con lo zoom della pagina.
      const measured = el.getBoundingClientRect().width || el.clientWidth;
      setWidth(Math.max(240, Math.round(measured)));
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  return { ref: setEl, width };
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export interface TooltipState {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string }[];
}

export function Tooltip({ state, containerWidth }: { state: TooltipState | null; containerWidth: number }) {
  if (!state) return null;
  // Evita che il riquadro esca dal bordo: sopra 80% della larghezza si ancora a destra.
  const clampedX = Math.min(Math.max(state.x, 70), containerWidth - 70);
  return (
    <div className="tooltip" style={{ left: clampedX, top: Math.max(state.y - 8, 34) }}>
      <b>{state.title}</b>
      {state.rows.map((r) => (
        <div className="tooltip-row" key={r.label}>
          <span className="muted">{r.label}</span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; kind?: 'line' | 'area' }[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span key={i.label}>
          <span
            className="legend-key"
            style={{
              background: i.color,
              height: i.kind === 'area' ? 10 : 3,
              opacity: i.kind === 'area' ? 0.35 : 1,
            }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tessere numeriche
// ---------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  note,
  children,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {note && <div className="tile-note">{note}</div>}
      {children}
    </div>
  );
}

export function Meter({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(1, value / max));
  const color = pct >= 0.85 ? 'var(--good)' : pct >= 0.5 ? 'var(--warning)' : 'var(--serious)';
  return (
    <div className="meter" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct * 100}%`, background: color }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Istogramma a colonne
// ---------------------------------------------------------------------------

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
}

export function ColumnChart({
  data,
  height = 160,
  unit = '',
  /** Mostra un'etichetta ogni N colonne, per non affollare l'asse. */
  labelEvery,
}: {
  data: ColumnDatum[];
  height?: number;
  unit?: string;
  /** Se omesso, il passo delle etichette si adatta alla larghezza disponibile. */
  labelEvery?: number;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);

  const pad = { top: 24, right: 4, bottom: 22, left: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const ticks = niceTicks(0, max, 3);
  const yMax = ticks[ticks.length - 1];
  const band = data.length ? plotW / data.length : plotW;
  // Marca sottile: mai più di 24px e mai tutta la banda, il resto è aria.
  const barW = Math.max(3, Math.min(24, band - Math.max(2, band * 0.3)));
  const peak = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]);
  // Un'etichetta ogni quanto: serve almeno ~46px per non farle collidere.
  const labelStep = labelEvery ?? Math.max(1, Math.ceil(46 / Math.max(1, band)));

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
        {ticks.map((t) => {
          const y = pad.top + plotH - (t / yMax) * plotH;
          return (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--grid)" strokeWidth={1} />
              <text className="axis-label" x={pad.left - 6} y={y + 3} textAnchor="end">
                {t}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / yMax) * plotH;
          const x = pad.left + i * band + (band - barW) / 2;
          const y = pad.top + plotH - h;
          return (
            <g key={d.key}>
              {/* Bersaglio di hover più grande della marca. */}
              <rect
                x={pad.left + i * band}
                y={pad.top}
                width={band}
                height={plotH}
                fill="transparent"
                onMouseEnter={() =>
                  setTip({
                    x: x + barW / 2,
                    y: Math.max(y, pad.top + 10),
                    title: d.label,
                    rows: [{ label: unit || 'valore', value: String(d.value) }],
                  })
                }
                onMouseLeave={() => setTip(null)}
              />
              {d.value > 0 && (
                <path d={roundedTopBar(x, y, barW, h, 4)} fill="var(--series-1)" />
              )}
              {i % labelStep === 0 && (
                <text
                  className="axis-label"
                  x={pad.left + i * band + band / 2}
                  y={height - 6}
                  textAnchor="middle"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
        {/* Etichetta diretta solo sul massimo: il resto lo legge l'asse. */}
        {peak && peak.value > 0 && (
          <text
            x={pad.left + data.indexOf(peak) * band + band / 2}
            y={pad.top + plotH - (peak.value / yMax) * plotH - 5}
            textAnchor="middle"
            fontSize={10}
            fontWeight={650}
            fill="var(--text-secondary)"
          >
            {peak.value}
          </text>
        )}
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + plotH}
          y2={pad.top + plotH}
          stroke="var(--axis)"
          strokeWidth={1}
        />
      </svg>
      <Tooltip state={tip} containerWidth={width} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barre orizzontali (siti, fasce di profondità)
// ---------------------------------------------------------------------------

export function BarChart({
  data,
  unit = '',
  maxRows = 10,
}: {
  data: ColumnDatum[];
  unit?: string;
  maxRows?: number;
}) {
  const rows = data.slice(0, maxRows);
  const max = Math.max(1, ...rows.map((d) => d.value));
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);

  const labelW = Math.min(160, Math.max(70, width * 0.32));
  const valueW = 40;
  const trackW = Math.max(20, width - labelW - valueW - 12);
  const rowH = 26;
  const barH = 14;

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={rows.length * rowH + 4}
        viewBox={`0 0 ${width} ${rows.length * rowH + 4}`}
        role="img"
      >
        {rows.map((d, i) => {
          const y = i * rowH + 4;
          const w = (d.value / max) * trackW;
          return (
            <g
              key={d.key}
              onMouseEnter={() =>
                setTip({
                  x: labelW + w,
                  y: y + barH,
                  title: d.label,
                  rows: [{ label: unit || 'valore', value: String(d.value) }],
                })
              }
              onMouseLeave={() => setTip(null)}
            >
              <rect x={0} y={y - 3} width={width} height={rowH - 2} fill="transparent" />
              <text x={0} y={y + barH - 2} fontSize={12} fill="var(--text-secondary)">
                {truncate(d.label, Math.floor(labelW / 6.6))}
              </text>
              <path d={roundedRightBar(labelW, y, Math.max(2, w), barH, 4)} fill="var(--series-1)" />
              <text
                x={labelW + Math.max(2, w) + 7}
                y={y + barH - 2}
                fontSize={12}
                fontWeight={600}
                fill="var(--text-secondary)"
                className="tabular"
              >
                {d.value}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip state={tip} containerWidth={width} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Serie temporale con punti
// ---------------------------------------------------------------------------

export interface TimePoint {
  at: number;
  value: number;
  id?: string;
}

export function TimeSeriesChart({
  points,
  height = 180,
  unit,
  /** Linea di riferimento orizzontale, es. l'obiettivo. */
  reference,
  referenceLabel,
  format = (v: number) => v.toFixed(1),
  onPick,
}: {
  points: TimePoint[];
  height?: number;
  unit: string;
  reference?: number;
  referenceLabel?: string;
  format?: (v: number) => string;
  onPick?: (id: string) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);

  if (points.length === 0) {
    return <p className="muted" style={{ fontSize: 12, margin: 0 }}>Nessun dato disponibile per questa serie.</p>;
  }

  const pad = { top: 16, right: 44, bottom: 22, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const xs = points.map((p) => p.at);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const spanX = maxX - minX || 1;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values, reference ?? Infinity);
  const hi = Math.max(...values, reference ?? -Infinity);
  const ticks = niceTicks(Math.max(0, lo - (hi - lo) * 0.15), hi + (hi - lo) * 0.15 || hi + 1, 3);
  const yLo = ticks[0];
  const yHi = ticks[ticks.length - 1];

  const px = (at: number) => pad.left + ((at - minX) / spanX) * plotW;
  const py = (v: number) => pad.top + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.at).toFixed(1)} ${py(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  // Oltre ~24 punti i pallini si toccano e la linea sembra tratteggiata: li
  // nascondiamo, ma il bersaglio invisibile per il tooltip resta su ognuno.
  const showDots = points.length <= 24;

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={py(t)} y2={py(t)} stroke="var(--grid)" strokeWidth={1} />
            <text className="axis-label" x={pad.left - 6} y={py(t) + 3} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}

        {reference !== undefined && (
          <>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={py(reference)}
              y2={py(reference)}
              stroke="var(--series-2)"
              strokeWidth={2}
              strokeDasharray="0"
              opacity={0.5}
            />
            {referenceLabel && (
              <text
                x={width - pad.right + 4}
                y={py(reference) + 3}
                fontSize={10}
                fill="var(--text-muted)"
              >
                {referenceLabel}
              </text>
            )}
          </>
        )}

        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p) => (
          <g key={`${p.at}-${p.value}`}>
            {showDots && (
              <circle
                cx={px(p.at)}
                cy={py(p.value)}
                r={4}
                fill="var(--series-1)"
                stroke="var(--surface-1)"
                strokeWidth={2}
              />
            )}
            {/* L'anello in colore superficie fa parte del bersaglio di hover. */}
            <circle
              cx={px(p.at)}
              cy={py(p.value)}
              r={11}
              fill="transparent"
              style={{ cursor: onPick && p.id ? 'pointer' : 'default' }}
              onMouseEnter={() =>
                setTip({
                  x: px(p.at),
                  y: py(p.value),
                  title: new Date(p.at).toLocaleDateString('it-IT', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  }),
                  rows: [{ label: unit, value: format(p.value) }],
                })
              }
              onMouseLeave={() => setTip(null)}
              onClick={() => onPick && p.id && onPick(p.id)}
            />
          </g>
        ))}

        {/* Etichetta diretta solo sull'ultimo punto, con la sua marca. */}
        <circle
          cx={px(last.at)}
          cy={py(last.value)}
          r={4}
          fill="var(--series-1)"
          stroke="var(--surface-1)"
          strokeWidth={2}
        />
        <text
          x={px(last.at) + 8}
          y={py(last.value) + 4}
          fontSize={11}
          fontWeight={650}
          fill="var(--text-secondary)"
        >
          {format(last.value)}
        </text>

        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + plotH}
          y2={pad.top + plotH}
          stroke="var(--axis)"
          strokeWidth={1}
        />
        <text className="axis-label" x={pad.left} y={height - 6}>
          {shortDate(minX)}
        </text>
        <text className="axis-label" x={width - pad.right} y={height - 6} textAnchor="end">
          {shortDate(maxX)}
        </text>
      </svg>
      <Tooltip state={tip} containerWidth={width} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Geometria e formattazione
// ---------------------------------------------------------------------------

/** Colonna con l'estremo del dato arrotondato di 4px e la base quadrata. */
export function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h);
  return [
    `M${x} ${y + h}`,
    `L${x} ${y + radius}`,
    `Q${x} ${y} ${x + radius} ${y}`,
    `L${x + w - radius} ${y}`,
    `Q${x + w} ${y} ${x + w} ${y + radius}`,
    `L${x + w} ${y + h}`,
    'Z',
  ].join(' ');
}

/** Barra orizzontale con l'estremo destro arrotondato. */
export function roundedRightBar(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, h / 2, w);
  return [
    `M${x} ${y}`,
    `L${x + w - radius} ${y}`,
    `Q${x + w} ${y} ${x + w} ${y + radius}`,
    `L${x + w} ${y + h - radius}`,
    `Q${x + w} ${y + h} ${x + w - radius} ${y + h}`,
    `L${x} ${y + h}`,
    'Z',
  ].join(' ');
}

/**
 * Tacche su numeri tondi: 0 / 5 / 10, non 0 / 4.3 / 8.6.
 *
 * L'ultima tacca DEVE essere >= `hi`: se si fermasse sotto, il valore massimo
 * cadrebbe fuori dall'area di disegno e la curva uscirebbe dal grafico. È un
 * errore silenzioso e si vede solo guardando il risultato — motivo per cui
 * `tests/charts.test.ts` lo verifica.
 */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  // Serie a valore costante: senza questo, `hi <= lo` faceva ripiegare su [0, 1]
  // e il punto finiva a migliaia di pixel fuori dal riquadro, con l'asse
  // etichettato 0–1 e il grafico apparentemente vuoto. Si apre un intervallo
  // attorno al valore invece di inventarne uno che non lo contiene.
  if (hi <= lo) {
    const pad = Math.max(Math.abs(hi) * 0.1, 0.5);
    lo = hi - pad;
    hi = hi + pad;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(lo / step) * step;
  const stop = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let v = start; v <= stop + step * 0.001; v += step) {
    out.push(Math.round(v * 1000) / 1000);
  }
  return out.length >= 2 ? out : [lo, hi];
}

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString('it-IT', { month: 'short', year: '2-digit' });

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

/** Hook per la chiusura del tooltip quando il puntatore lascia la finestra. */
export function useDismissOnLeave(clear: () => void) {
  const cb = useCallback(clear, [clear]);
  useEffect(() => {
    window.addEventListener('blur', cb);
    return () => window.removeEventListener('blur', cb);
  }, [cb]);
}

// ---------------------------------------------------------------------------
// Dispersione: due misure una contro l'altra
// ---------------------------------------------------------------------------

/**
 * Grafico a dispersione con retta di tendenza opzionale.
 *
 * È l'unico modo onesto di mostrare una relazione fra due misure: una media non
 * la mostra, e una curva che le sovrappone su due assi Y la suggerisce senza
 * mostrarla. Ogni punto è un'immersione e si può cliccare per aprirla — un valore
 * strano deve portare al dato, non restare un puntino.
 */
export function ScatterChart({
  points,
  xLabel,
  yLabel,
  height = 240,
  xFormat = (v: number) => v.toFixed(0),
  yFormat = (v: number) => v.toFixed(1),
  onPick,
  showFit = true,
}: {
  points: { x: number; y: number; diveId: string; label: string }[];
  xLabel: string;
  yLabel: string;
  height?: number;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  onPick?: (id: string) => void;
  showFit?: boolean;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);

  if (points.length < 3) {
    return (
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Servono almeno tre immersioni con entrambe le misure per confrontarle.
      </p>
    );
  }

  const pad = { top: 14, right: 16, bottom: 34, left: 46 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const xTicks = niceTicks(Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x)), 4);
  const yTicks = niceTicks(Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.y)), 3);
  const xLo = xTicks[0];
  const xHi = xTicks[xTicks.length - 1];
  const yLo = yTicks[0];
  const yHi = yTicks[yTicks.length - 1];

  const px = (v: number) => pad.left + ((v - xLo) / (xHi - xLo || 1)) * plotW;
  const py = (v: number) => pad.top + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH;

  // Retta dei minimi quadrati: descrive la tendenza, non predice niente.
  let fit: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (showFit) {
    const n = points.length;
    const mx = points.reduce((a, p) => a + p.x, 0) / n;
    const my = points.reduce((a, p) => a + p.y, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of points) {
      num += (p.x - mx) * (p.y - my);
      den += (p.x - mx) ** 2;
    }
    if (den > 0) {
      const slope = num / den;
      const intercept = my - slope * mx;
      fit = {
        x1: px(xLo),
        y1: py(slope * xLo + intercept),
        x2: px(xHi),
        y2: py(slope * xHi + intercept),
      };
    }
  }

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" style={{ display: 'block' }}>
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={pad.left} x2={width - pad.right} y1={py(t)} y2={py(t)} stroke="var(--grid)" strokeWidth={1} />
            <text className="axis-label" x={pad.left - 8} y={py(t) + 3.5} textAnchor="end">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} className="axis-label" x={px(t)} y={height - 16} textAnchor="middle">
            {xFormat(t)}
          </text>
        ))}

        {fit && (
          <line
            x1={fit.x1}
            y1={fit.y1}
            x2={fit.x2}
            y2={fit.y2}
            stroke="var(--series-2)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        )}

        {points.map((p) => (
          <circle
            key={`${p.diveId}-${p.x}-${p.y}`}
            cx={px(p.x)}
            cy={py(p.y)}
            r={3.4}
            fill="var(--series-1)"
            opacity={0.65}
            style={{ cursor: onPick ? 'pointer' : 'default' }}
            onMouseEnter={() =>
              setTip({
                x: px(p.x),
                y: py(p.y),
                title: p.label,
                rows: [
                  { label: xLabel, value: xFormat(p.x) },
                  { label: yLabel, value: yFormat(p.y) },
                ],
              })
            }
            onMouseLeave={() => setTip(null)}
            onClick={() => onPick?.(p.diveId)}
          />
        ))}

        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + plotH}
          y2={pad.top + plotH}
          stroke="var(--axis)"
          strokeWidth={1}
        />
        <text className="axis-label" x={width - pad.right} y={height - 3} textAnchor="end">
          {xLabel}
        </text>
        <text className="axis-label" x={pad.left} y={height - 3} textAnchor="start">
          {yLabel} ↑
        </text>
      </svg>
      <Tooltip state={tip} containerWidth={width} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Curva su asse X numerico (non temporale)
// ---------------------------------------------------------------------------

/**
 * Una funzione disegnata: come cambia un risultato al variare di un parametro.
 *
 * Serve alle viste di pianificazione, dove il numero singolo dice poco e la
 * *pendenza* dice tutto: sapere che il tempo di fondo consentito è 24 minuti a 30 m
 * è utile, vedere che a 35 m diventano 15 lo è di più. Il punto pianificato è
 * marcato ed etichettato, così la curva non è un'astrazione accanto al risultato:
 * è il risultato, in contesto.
 */
export function CurveChart({
  points,
  height = 170,
  xLabel,
  yLabel,
  xFormat = (v: number) => v.toFixed(0),
  yFormat = (v: number) => v.toFixed(0),
  marker,
  markerLabel,
  reference,
  referenceLabel,
  color = 'var(--series-1)',
  fill = true,
}: {
  points: { x: number; y: number }[];
  height?: number;
  xLabel: string;
  yLabel: string;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  /** Ascissa da marcare: il valore attualmente pianificato. */
  marker?: number;
  markerLabel?: string;
  reference?: number;
  referenceLabel?: string;
  color?: string;
  fill?: boolean;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  useDismissOnLeave(() => setTip(null));

  if (points.length < 2) {
    return (
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Dati insufficienti per disegnare la curva.
      </p>
    );
  }

  const pad = { top: 16, right: 14, bottom: 30, left: 40 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  if (reference !== undefined) ys.push(reference);
  // Lo zero resta nell'asse: su una curva di consumo, tagliarlo esagera le
  // differenze fra due profondità vicine.
  const yTicks = niceTicks(Math.min(0, ...ys), Math.max(...ys), 3);
  const xLo = Math.min(...xs);
  const xHi = Math.max(...xs);
  const yLo = yTicks[0];
  const yHi = yTicks[yTicks.length - 1];

  const px = (v: number) => pad.left + ((v - xLo) / (xHi - xLo || 1)) * plotW;
  const py = (v: number) => pad.top + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');
  const area = `${line} L${px(xHi).toFixed(1)},${py(yLo).toFixed(1)} L${px(xLo).toFixed(1)},${py(yLo).toFixed(1)} Z`;
  const nearest = (clientX: number, box: DOMRect) => {
    const x = clientX - box.left;
    let best = points[0];
    for (const p of points) if (Math.abs(px(p.x) - x) < Math.abs(px(best.x) - x)) best = p;
    return best;
  };
  const at = (x: number) => {
    let best = points[0];
    for (const p of points) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    return best;
  };
  const markPoint = marker !== undefined ? at(marker) : undefined;

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        onMouseMove={(e) => {
          const p = nearest(e.clientX, e.currentTarget.getBoundingClientRect());
          setTip({
            x: px(p.x),
            y: py(p.y),
            title: `${xLabel} ${xFormat(p.x)}`,
            rows: [{ label: yLabel, value: yFormat(p.y) }],
          });
        }}
        onMouseLeave={() => setTip(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={py(t)}
              y2={py(t)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text className="axis-label" x={pad.left - 6} y={py(t) + 3} textAnchor="end">
              {yFormat(t)}
            </text>
          </g>
        ))}

        {reference !== undefined && (
          <g>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={py(reference)}
              y2={py(reference)}
              stroke="var(--text-muted)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            {referenceLabel && (
              // A sinistra, non a destra: il marcatore del valore pianificato porta
              // già la sua etichetta e le due si sovrapponevano quando cadevano
              // vicine.
              <text className="axis-label" x={pad.left + 2} y={py(reference) - 4} textAnchor="start">
                {referenceLabel}
              </text>
            )}
          </g>
        )}

        {fill && <path d={area} fill={color} opacity={0.12} />}
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />

        {markPoint && (
          <g>
            <line
              x1={px(markPoint.x)}
              x2={px(markPoint.x)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="var(--series-2)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={px(markPoint.x)} cy={py(markPoint.y)} r={4} fill="var(--series-2)" />
            <text
              x={Math.min(width - pad.right, px(markPoint.x) + 6)}
              y={Math.max(pad.top + 9, py(markPoint.y) - 7)}
              fontSize={10}
              fontWeight={650}
              fill="var(--text-primary)"
              textAnchor={px(markPoint.x) > width - pad.right - 60 ? 'end' : 'start'}
            >
              {markerLabel ?? yFormat(markPoint.y)}
            </text>
          </g>
        )}

        {[xLo, (xLo + xHi) / 2, xHi].map((t) => (
          <text key={t} className="axis-label" x={px(t)} y={height - 14} textAnchor="middle">
            {xFormat(t)}
          </text>
        ))}
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + plotH}
          y2={pad.top + plotH}
          stroke="var(--axis)"
          strokeWidth={1}
        />
        <text className="axis-label" x={width - pad.right} y={height - 2} textAnchor="end">
          {xLabel}
        </text>
      </svg>
      <Tooltip state={tip} containerWidth={width} />
    </div>
  );
}
