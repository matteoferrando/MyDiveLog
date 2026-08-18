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
 *  - **il cursore si muove anche con le frecce.** Il cursore condiviso era, fino
 *    a ieri, l'unico modo di leggere un valore in un istante preciso — e si
 *    guidava solo con il mouse. Chi naviga da tastiera aveva davanti un disegno
 *    muto: non un grafico meno comodo, proprio nessun accesso ai numeri. Le
 *    frecce spostano il cursore campione per campione e il valore corrente viene
 *    annunciato; il riassunto in testa all'SVG dice la forma dell'immersione
 *    prima ancora che si cominci a esplorarla.
 */

import { useId, useState } from 'react';
import type { Dive, Sample } from '../../core/model';
import { LIMITS } from '../../core/model';
import { formatDuration } from '../../core/units';
import {
  AnnuncioCursore,
  Legend,
  Tooltip,
  contornoFuoco,
  niceTicks,
  numeroBreve,
  quartili,
  useWidth,
  type TooltipState,
} from './Charts';

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
  // Il fuoco è tenuto in uno stato, e non è per disegnare un bordo: serve a
  // decidere CHI annuncia. Il cursore è condiviso fra il profilo e gli otto
  // grafici sotto, quindi se ognuno tenesse una regione viva ogni freccia
  // premuta produrrebbe nove annunci identici, e lo screen reader diventerebbe
  // inascoltabile. Annuncia solo il grafico che si sta guidando.
  const [fuoco, setFuoco] = useState(false);
  const uid = useId();

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

  /**
   * Spostamento del cursore da tastiera.
   *
   * Un passo è un campione, cioè il passo di registrazione del computer: quattro
   * o dieci secondi. Con Maiusc si salta di un minuto, perché su un'immersione da
   * cinquanta minuti attraversare il grafico un campione alla volta significa
   * quattrocento pressioni di tasto, e un accesso che si può ottenere solo con
   * quattrocento pressioni non è un accesso.
   *
   * Il primo tasto premuto quando il cursore non c'è ancora porta al punto più
   * profondo, non all'inizio: è l'istante che si va a cercare per primo, e
   * partire dal minuto zero — dove ogni immersione è identica a ogni altra —
   * costringerebbe ad attraversare tutta la discesa per arrivarci.
   */
  const spostaCursore = (evt: React.KeyboardEvent<SVGSVGElement>) => {
    if (!sync) return;
    const corrente = sync.t == null ? -1 : indiceVicino(samples, sync.t);
    const passo = evt.shiftKey ? Math.max(1, Math.round(60 / passoCampioniS(samples))) : 1;
    let prossimo: number | null = null;
    if (evt.key === 'ArrowRight') prossimo = corrente < 0 ? indiceMassimo(samples) : corrente + passo;
    else if (evt.key === 'ArrowLeft') prossimo = corrente < 0 ? indiceMassimo(samples) : corrente - passo;
    else if (evt.key === 'Home') prossimo = 0;
    else if (evt.key === 'End') prossimo = samples.length - 1;
    else if (evt.key === 'Escape') {
      sync.onChange(null);
      return;
    } else return;
    evt.preventDefault(); // altrimenti le frecce scorrono la pagina sotto il grafico
    sync.onChange(samples[Math.min(samples.length - 1, Math.max(0, prossimo))].t);
  };

  const [lo, hi] = LIMITS.safetyStopBandM;
  const gradientId = `depth-fill-${dive.id.slice(0, 8)}`;
  const nome = `Profilo di profondità dell'immersione`;
  // L'istruzione fa parte della descrizione, e non di una nota accanto al
  // grafico: una funzione che esiste ma che non viene annunciata da nessuna parte
  // è, per chi non vede lo schermo, una funzione che non esiste.
  const descrizione =
    riassuntoProfilo(dive) +
    (sync ? ' Frecce per muovere il cursore, Maiusc più freccia per saltare di un minuto, Inizio e Fine per gli estremi.' : '');

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
        aria-label={nome}
        aria-describedby={`${uid}-desc`}
        // Raggiungibile da tastiera SOLO quando c'è davvero un cursore da
        // muovere: una tappa nell'ordine di tabulazione che non porta a nessuna
        // azione è un ostacolo, non un servizio.
        tabIndex={sync ? 0 : undefined}
        style={{ display: 'block', ...contornoFuoco(fuoco) }}
        onKeyDown={spostaCursore}
        onFocus={() => setFuoco(true)}
        onBlur={() => {
          setFuoco(false);
          sync?.onChange(null);
        }}
        onMouseMove={hover}
        onMouseLeave={() => {
          setTip(null);
          sync?.onChange(null);
        }}
      >
        <title>{nome}</title>
        <desc id={`${uid}-desc`}>{descrizione}</desc>
        <defs aria-hidden="true">
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.04} />
          </linearGradient>
        </defs>

        {/* Fascia della sosta di sicurezza: contesto, non dato — quindi tenue e
            con l'etichetta, perché una banda colorata senza spiegazione è rumore. */}
        <g aria-hidden="true">
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
        </g>

        {/* Griglia orizzontale e verticale, in tono recessivo. */}
        {depthTicks.map((t) => (
          <g key={`h${t}`} aria-hidden="true">
            <line x1={pad.left} x2={width - pad.right} y1={py(t)} y2={py(t)} stroke="var(--grid)" strokeWidth={1} />
            <text className="axis-label" x={pad.left - 8} y={py(t) + 3.5} textAnchor="end">
              {t === 0 ? '0 m' : t}
            </text>
          </g>
        ))}
        {timeTicks(maxT).map((t) => (
          <line
            aria-hidden="true"
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

        <path aria-hidden="true" d={areaPath} fill={`url(#${gradientId})`} />
        {ceilingArea && <path aria-hidden="true" d={ceilingArea} fill="var(--series-2)" opacity={0.1} />}
        {ceilingLine && (
          <path aria-hidden="true" d={ceilingLine} fill="none" stroke="var(--series-2)" strokeWidth={1.75} strokeLinejoin="round" />
        )}
        <path
          aria-hidden="true"
          d={depthPath}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Segnalibri: l'unico contenuto del profilo messo lì dal subacqueo. */}
        {dive.events?.map((e) => (
          <g key={`${e.t}-${e.label ?? ''}`} aria-hidden="true">
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
          <g aria-hidden="true">
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
          </g>
        )}

        <g aria-hidden="true">
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
        </g>
      </svg>
      {/* Nessuna tabella equivalente qui, ed è una scelta: un profilo sono
          centinaia o migliaia di campioni, e leggerli uno per uno non è dare
          accesso al dato, è seppellirlo. Al posto della tabella c'è il riassunto
          nella descrizione e il cursore che si muove con le frecce, cioè lo
          stesso patto che ha chi guarda: la forma subito, il singolo istante su
          richiesta. */}
      {fuoco && <AnnuncioCursore testo={cursorSample ? annuncioCampione(cursorSample) : 'Cursore non posizionato: usa le frecce per esplorare il profilo.'} />}
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
  const [fuoco, setFuoco] = useState(false);
  const uid = useId();

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

  // Stesse regole del profilo: un passo è un campione, Maiusc salta di un minuto,
  // e senza cursore si parte dal valore ESTREMO della serie — il picco di CNS, il
  // minimo di NDL — che è l'istante per cui questi grafici esistono.
  const spostaCursore = (evt: React.KeyboardEvent<SVGSVGElement>) => {
    if (!sync) return;
    const corrente = sync.t == null ? -1 : indiceVicinoA(points, sync.t);
    const passo = evt.shiftKey ? Math.max(1, Math.round(60 / passoCampioniS(points))) : 1;
    let prossimo: number | null = null;
    if (evt.key === 'ArrowRight') prossimo = corrente < 0 ? indiceEstremo(points) : corrente + passo;
    else if (evt.key === 'ArrowLeft') prossimo = corrente < 0 ? indiceEstremo(points) : corrente - passo;
    else if (evt.key === 'Home') prossimo = 0;
    else if (evt.key === 'End') prossimo = points.length - 1;
    else if (evt.key === 'Escape') {
      sync.onChange(null);
      return;
    } else return;
    evt.preventDefault();
    sync.onChange(points[Math.min(points.length - 1, Math.max(0, prossimo))].t);
  };

  const nome = `${label} (${unit})`;
  const descrizione =
    riassuntoMiniSerie(points, { etichetta: label, unita: unit, digits }) +
    (sync ? ' Frecce per muovere il cursore.' : '');

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
        aria-label={nome}
        aria-describedby={`${uid}-desc`}
        tabIndex={sync ? 0 : undefined}
        style={{ display: 'block', ...contornoFuoco(fuoco) }}
        onKeyDown={spostaCursore}
        onFocus={() => setFuoco(true)}
        onBlur={() => {
          setFuoco(false);
          sync?.onChange(null);
        }}
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
        <title>{nome}</title>
        <desc id={`${uid}-desc`}>{descrizione}</desc>
        {ticks.map((t) => (
          <g key={t} aria-hidden="true">
            <line x1={pad.left} x2={width - pad.right} y1={py(t)} y2={py(t)} stroke="var(--grid)" strokeWidth={1} />
            <text className="axis-label" x={pad.left - 8} y={py(t) + 3.5} textAnchor="end">
              {t.toFixed(digits)}
            </text>
          </g>
        ))}
        {timeTicks(maxT).map((t) => (
          <line
            aria-hidden="true"
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
          <g key={r.label} aria-hidden="true">
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
        {fill && <path aria-hidden="true" d={area} fill={color} opacity={0.12} />}
        {/* La curva di confronto va SOTTO, tratteggiata: quella che comanda la
            scala e l'etichetta è la principale. */}
        {otherLine && (
          <path
            aria-hidden="true"
            d={otherLine}
            fill="none"
            stroke={compare?.color ?? 'var(--text-muted)'}
            strokeWidth={1.2}
            strokeDasharray="4 3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        <path aria-hidden="true" d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        {cursorPoint && (
          <g aria-hidden="true">
            <line
              x1={px(cursorPoint.t)}
              x2={px(cursorPoint.t)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="var(--axis)"
              strokeWidth={1}
            />
            <circle cx={px(cursorPoint.t)} cy={py(cursorPoint.v)} r={3} fill={color} />
          </g>
        )}
      </svg>
      {fuoco && (
        <AnnuncioCursore
          testo={
            cursorPoint
              ? `${label}: minuto ${formatDuration(cursorPoint.t)}, ${cursorPoint.v.toFixed(digits)} ${unit}`
              : `${label}: cursore non posizionato, usa le frecce.`
          }
        />
      )}
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

/** Indice del campione più vicino a un istante. */
function indiceVicino(samples: Sample[], t: number): number {
  let best = 0;
  for (let i = 1; i < samples.length; i++) {
    if (Math.abs(samples[i].t - t) < Math.abs(samples[best].t - t)) best = i;
  }
  return best;
}

function indiceVicinoA(punti: { t: number }[], t: number): number {
  let best = 0;
  for (let i = 1; i < punti.length; i++) {
    if (Math.abs(punti[i].t - t) < Math.abs(punti[best].t - t)) best = i;
  }
  return best;
}

/** Indice del campione più profondo: il punto da cui parte l'esplorazione. */
function indiceMassimo(samples: Sample[]): number {
  let best = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i].depth > samples[best].depth) best = i;
  return best;
}

/**
 * Indice del valore che si allontana di più dalla mediana della serie.
 *
 * Non «il massimo»: su NDL e RBT il valore interessante è il MINIMO, su CNS e TTS
 * è il massimo, e una regola sola per entrambi non può essere «il più grande».
 * L'estremo rispetto al centro funziona in tutti e due i casi senza sapere che
 * cosa la serie stia misurando.
 */
function indiceEstremo(punti: { t: number; v: number }[]): number {
  const centro = quartili(punti.map((p) => p.v))!.mediana;
  let best = 0;
  for (let i = 1; i < punti.length; i++) {
    if (Math.abs(punti[i].v - centro) > Math.abs(punti[best].v - centro)) best = i;
  }
  return best;
}

/** Passo di campionamento, secondi: la mediana degli intervalli fra due punti. */
function passoCampioniS(punti: { t: number }[]): number {
  if (punti.length < 2) return 10;
  const passi: number[] = [];
  for (let i = 1; i < punti.length; i++) passi.push(punti[i].t - punti[i - 1].t);
  return Math.max(1, quartili(passi)!.mediana);
}

/**
 * Il singolo istante, detto a voce.
 *
 * Le stesse righe del tooltip e nello stesso ordine — profondità, poi ciò che è
 * eccezionale (il tetto), poi il contorno. Se le due letture divergessero, chi
 * usa lo screen reader e chi usa il mouse starebbero guardando due immersioni
 * diverse, ed è esattamente quello che questo lavoro serve a evitare.
 */
export function annuncioCampione(s: Sample): string {
  const parti = [`minuto ${formatDuration(s.t)}`, `${s.depth.toFixed(1)} m`];
  const tetto = s.ceiling ?? s.stopDepth;
  if (tetto) parti.push(`tetto ${tetto.toFixed(1)} m`);
  else if (s.ndlS !== undefined) parti.push(`NDL ${Math.round(s.ndlS / 60)} min`);
  if (s.tempC !== undefined) parti.push(`${s.tempC.toFixed(1)} °C`);
  const pressione = s.pressureBar?.find((p) => p !== undefined);
  if (pressione !== undefined) parti.push(`${Math.round(pressione)} bar`);
  return parti.join(', ');
}

/**
 * Il profilo detto in una frase.
 *
 * Contiene ciò che un subacqueo guarda per primo in un profilo: quanto è durata,
 * quanto è andata giù e quando, quanto ci è stata in media, e se c'è stato un
 * obbligo di decompressione — con l'intervallo in cui c'è stato, che è la
 * differenza fra «ho sforato un minuto» e «ho passato mezz'ora in deco».
 *
 * Tutto calcolato dai campioni disegnati, non dai valori di sintesi
 * dell'immersione: se il computer dichiarasse una massima di 42 m e il profilo
 * salvato ne mostrasse 38, la descrizione deve dire quello che si vede nel
 * grafico — altrimenti descrive un disegno diverso da quello che sta accanto.
 */
export function riassuntoProfilo(dive: Dive): string {
  const samples = dive.samples ?? [];
  if (samples.length < 2) return 'Immersione senza profilo campionato.';

  const durataS = samples[samples.length - 1].t - samples[0].t;
  const piuProfondo = samples.reduce((a, b) => (b.depth > a.depth ? b : a));
  const parti = [
    `Profilo di ${Math.round(durataS / 60)} minuti su ${samples.length} campioni.`,
    `Massima ${piuProfondo.depth.toFixed(1)} m al minuto ${Math.round(piuProfondo.t / 60)}, media ${mediaPesata(samples).toFixed(1)} m.`,
  ];

  // Il tetto di decompressione: il PRIMO e l'ULTIMO istante in cui esiste, non
  // quanti campioni lo portano. Un obbligo che compare, sparisce e ricompare
  // resta un unico intervallo in cui l'immersione non era più in curva, ed è
  // così che lo racconterebbe chi guarda il grafico.
  const conTetto = samples.filter((s) => (s.ceiling ?? s.stopDepth ?? 0) > 0);
  if (conTetto.length > 0) {
    const piuAlto = conTetto.reduce((a, b) => ((b.ceiling ?? b.stopDepth ?? 0) > (a.ceiling ?? a.stopDepth ?? 0) ? b : a));
    parti.push(
      `Tetto di decompressione presente dal minuto ${Math.round(conTetto[0].t / 60)} al minuto ` +
        `${Math.round(conTetto[conTetto.length - 1].t / 60)}, il più profondo ` +
        `${(piuAlto.ceiling ?? piuAlto.stopDepth ?? 0).toFixed(1)} m.`,
    );
  } else {
    parti.push('Nessun obbligo di decompressione nel profilo.');
  }

  const temperature = samples.map((s) => s.tempC).filter((v): v is number => v !== undefined);
  if (temperature.length > 0) {
    const q = quartili(temperature)!;
    parti.push(`Temperatura da ${numeroBreve(q.min)} a ${numeroBreve(q.max)} °C.`);
  }
  const eventi = dive.events?.length ?? 0;
  if (eventi > 0) parti.push(`${eventi} ${eventi === 1 ? 'segnalibro' : 'segnalibri'} sul computer.`);
  return parti.join(' ');
}

/**
 * Profondità media pesata sul TEMPO, con i trapezi.
 *
 * La media aritmetica dei campioni sarebbe sbagliata ogni volta che il computer
 * cambia passo di registrazione — e lo fa, per esempio infittendo in risalita:
 * i campioni fitti della risalita peserebbero quanto quelli radi del fondo, e la
 * media verrebbe fuori più bassa del vero.
 */
function mediaPesata(samples: Sample[]): number {
  let area = 0;
  let tempo = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    if (dt <= 0) continue;
    area += ((samples[i].depth + samples[i - 1].depth) / 2) * dt;
    tempo += dt;
  }
  return tempo > 0 ? area / tempo : samples[0].depth;
}

/**
 * Una serie secondaria detta in una frase.
 *
 * Qui non servono i quartili: queste curve si leggono per gli estremi e per
 * dove cadono — il minimo di NDL e il minuto in cui è successo sono l'intera
 * ragione per cui il grafico esiste. Il valore finale c'è perché è quello
 * stampato in grande accanto al titolo, e le due cose devono coincidere.
 */
export function riassuntoMiniSerie(
  punti: { t: number; v: number }[],
  { etichetta, unita, digits = 0 }: { etichetta: string; unita: string; digits?: number },
): string {
  if (punti.length === 0) return `${etichetta}: nessun valore registrato.`;
  const min = punti.reduce((a, b) => (b.v < a.v ? b : a));
  const max = punti.reduce((a, b) => (b.v > a.v ? b : a));
  const durataMin = Math.round((punti[punti.length - 1].t - punti[0].t) / 60);
  return (
    `${etichetta} in ${unita}, ${punti.length} rilevazioni su ${durataMin} minuti. ` +
    `Minimo ${min.v.toFixed(digits)} al minuto ${Math.round(min.t / 60)}, ` +
    `massimo ${max.v.toFixed(digits)} al minuto ${Math.round(max.t / 60)}. ` +
    `Valore finale ${punti[punti.length - 1].v.toFixed(digits)}.`
  );
}

/** Tacche temporali ogni 5, 10, 15 o 30 minuti secondo la durata. */
export function timeTicks(maxT: number): number[] {
  const minutes = maxT / 60;
  const step = minutes > 90 ? 1800 : minutes > 45 ? 900 : minutes > 20 ? 600 : 300;
  const out: number[] = [];
  for (let t = 0; t <= maxT; t += step) out.push(t);
  return out;
}
