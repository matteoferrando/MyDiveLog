/**
 * Saturazione: quello che il computer non ti dice più, a immersione finita.
 *
 * Tre cose che qui si possono fare e in acqua no. La prima è avere il GF99 anche
 * quando il computer non lo scrive — solo Shearwater lo salva, ma il profilo ce
 * l'hanno tutti, e da un profilo il modello si rigioca. La seconda è il carico
 * residuo: quanto è pesato l'intervallo di superficie sulla seconda immersione
 * della giornata, che è una domanda che si può porre solo guardando le due insieme.
 * La terza è il *e se*: quanto margine avresti avuto con gradient factor diversi,
 * cioè l'unica prova che si può fare su un'immersione già fatta senza rifarla.
 *
 * COSA NON FA. Non pianifica la decompressione e non corregge il computer. Il
 * numero del computer resta accanto al nostro, dichiarato come suo: sono due
 * implementazioni dello stesso modello, e sulle 38 immersioni di controllo
 * divergono di 0.8 punti in media. Quella divergenza è il motivo per cui i due
 * numeri non si fondono in uno.
 */

import { useId, useMemo, useState } from 'react';
import type { Dive } from '../../core/model';
import { entryStateFor, gfOf, whatIfGf } from '../../core/analysis/tissues';
import { compartments, type CompartmentState } from '../../core/analysis/buhlmann';
import { StatTile, TabellaEquivalente, useWidth } from './Charts';

/** Coppie che vale la pena confrontare: dalla tecnica alla ricreativa larga. */
const PRESETS: { low: number; high: number; label: string }[] = [
  { low: 20, high: 80, label: 'prudente' },
  { low: 30, high: 70, label: 'sosta profonda' },
  { low: 40, high: 85, label: 'comune' },
  { low: 50, high: 95, label: 'permissivo' },
];

export function SaturationCard({ dive, dives }: { dive: Dive; dives: Dive[] }) {
  const m = dive.metrics;
  // `dive.samples ?? []` creava un array NUOVO a ogni render, e finiva nelle
  // dipendenze dei due `useMemo` qui sotto: si ricalcolavano sempre, non a ogni
  // spostamento del cursore. Il commento accanto diceva che il costo «è niente»,
  // e la stima era giusta — sbagliata era la premessa su quanto spesso succede.
  // Trovato da eslint-plugin-react-hooks.
  const samples = useMemo(() => dive.samples ?? [], [dive.samples]);
  const actual = gfOf(dive);
  const [low, setLow] = useState(Math.round(actual.low * 100));
  const [high, setHigh] = useState(Math.round(actual.high * 100));

  const entry = useMemo(() => entryStateFor(dive, dives), [dive, dives]);

  // Il rigioco costa un passaggio sul profilo per coppia: qualche centinaio di
  // campioni per sedici compartimenti, cioè niente. Si ricalcola a ogni
  // spostamento del cursore senza accorgersene.
  const custom = useMemo(
    () =>
      samples.length > 2
        ? whatIfGf(dive, samples, entry.state, [{ low: low / 100, high: high / 100 }])[0]
        : undefined,
    [dive, samples, entry.state, low, high],
  );
  const presets = useMemo(
    () =>
      samples.length > 2
        ? whatIfGf(
            dive,
            samples,
            entry.state,
            PRESETS.map((p) => ({ low: p.low / 100, high: p.high / 100 })),
          )
        : [],
    [dive, samples, entry.state],
  );

  if (m?.gf99Pct === undefined) {
    // Senza profilo campionato non c'è niente da rigiocare, e dirlo è meglio che
    // mostrare una card vuota con dei trattini.
    return null;
  }

  const theirs = dive.reported?.gf99End;
  const costo = m.gf99CleanPct !== undefined ? Math.round((m.gf99Pct - m.gf99CleanPct) * 10) / 10 : undefined;

  return (
    <div className="card">
      <h2>Saturazione</h2>
      <p className="card-sub">
        {m.tissuesEstimated
          ? 'Questa immersione non ha un profilo registrato: i numeri qui sotto vengono da un profilo RICOSTRUITO, non da quello vero.'
          : "Il profilo riletto con Bühlmann ZH-L16C, tenendo conto dell'azoto che ti sei portato dietro dall'immersione precedente. È il nostro calcolo, non quello del computer: sulle immersioni in cui si possono confrontare i due numeri distano meno di un punto."}
      </p>

      {/*
        La stima si dichiara SEMPRE e in cima, non in una nota a piè di card.
        Un GF99 stimato e uno misurato si scrivono nello stesso modo — due cifre e
        un simbolo di percentuale — e senza questo riquadro nessuno potrebbe
        distinguerli. La regola vale per tutta l'applicazione: nessun valore
        ricostruito deve poter passare per misurato.
      */}
      {m.tissuesEstimated && (
        <div className="notice" style={{ marginBottom: 14 }}>
          <b>Numeri stimati.</b> Senza campioni, il carico si calcola su un profilo quadro — discesa,
          permanenza alla profondità media, risalita — costruito da durata e profondità media. È il modello
          con cui si pianifica un'immersione a tavolino, e sbaglia molto meno che considerarti a tessuti
          puliti: prima di questa stima l'immersione spezzava la catena e la successiva risultava più pulita
          del vero. Ma resta una ricostruzione, e più la tua immersione si allontana da un quadro —
          multilivello, yo-yo — più si allontana anche questo numero.{' '}
          {dive.avgDepth === undefined && (
            <>
              Qui manca anche la profondità media, quindi è stato usato il 70% della massima: scriverla nella
              scheda migliora subito la stima, e con lei il calcolo delle ripetitive che seguono.
            </>
          )}
        </div>
      )}

      <div className="grid grid-tiles">
        <StatTile
          label="GF99 all'uscita"
          value={<span className="tabular">{m.gf99Pct.toFixed(0)}%</span>}
          note={
            theirs !== undefined
              ? `il computer scrive ${theirs}% (${fmtDelta(m.gf99Pct - theirs)})`
              : 'il tuo computer non lo registra'
          }
        />
        <StatTile
          label="GF99 massimo"
          value={<span className="tabular">{(m.gf99MaxPct ?? m.gf99Pct).toFixed(0)}%</span>}
          note="il picco durante l'immersione, non solo all'uscita"
        />
        <StatTile
          label="Compartimento che comanda"
          value={<span className="tabular">{m.leadingCompartment ?? '—'}</span>}
          note={compartmentNote(m.leadingCompartment)}
        />
        <StatTile
          label="Azoto d'ingresso"
          value={
            <span className="tabular">
              {m.residualN2Bar !== undefined ? `+${m.residualN2Bar.toFixed(2)}` : '—'}
            </span>
          }
          note={
            m.residualN2Bar !== undefined
              ? `bar sopra l'equilibrio, dopo ${fmtInterval(m.surfaceIntervalMin)} di superficie`
              : 'entrata con i tessuti a riposo'
          }
        />
      </div>

      {costo !== undefined && m.gf99CleanPct !== undefined && (
        <div className="notice" style={{ marginTop: 12 }}>
          {costo >= 0.5 ? (
            <>
              <b>L'intervallo di superficie è costato {costo.toFixed(1)} punti.</b> Con{' '}
              {fmtInterval(m.surfaceIntervalMin)} di pausa sei entrato con {m.residualN2Bar?.toFixed(2)} bar
              di azoto in più e sei uscito al {m.gf99Pct.toFixed(0)}%: la stessa identica immersione fatta da
              tessuti puliti sarebbe finita al {m.gf99CleanPct.toFixed(0)}%.
            </>
          ) : (
            <>
              <b>Il residuo non ha inciso.</b> {capitalise(fmtInterval(m.surfaceIntervalMin))} di superficie
              sono bastati: partendo da tessuti puliti saresti uscito al {m.gf99CleanPct.toFixed(0)}% invece
              del {m.gf99Pct.toFixed(0)}%.
            </>
          )}
        </div>
      )}

      {m.tissuesEnd && (
        <>
          <h3 style={{ margin: '18px 0 4px', fontSize: 14 }}>I sedici compartimenti all'uscita</h3>
          <p className="card-sub">
            È il grafico che ogni computer subacqueo mostra sott'acqua e che nessun logbook mostra dopo. Ogni
            barra è un compartimento, dal più veloce (4 minuti) al più lento (635): l'altezza è l'azoto che
            contiene, la tacca scura è il valore M — il limite del modello — e la tacca chiara è il limite che
            ti sei imposto con i tuoi gradient factor. La barra che arriva più vicina alla sua tacca è quella
            che comanda.
          </p>
          <TissueBars
            state={m.tissuesEnd}
            surfaceBar={dive.surfacePressureBar ?? 1.01325}
            gfHigh={actual.high}
            leading={m.leadingCompartment}
          />
        </>
      )}

      <h3 style={{ margin: '18px 0 4px', fontSize: 14 }}>E se avessi usato altri gradient factor?</h3>
      <p className="card-sub">
        Il GF99 non compare qui sotto perché non cambia: misura quanto eri sovrasaturo rispetto al modello
        nudo, e i gradient factor non spostano il modello — spostano il limite che ti imponi. Quello che
        cambia è il tetto, e quindi se questa immersione sarebbe stata in curva o no.
      </p>

      <div className="grid grid-2" style={{ gap: 12, marginTop: 10 }}>
        <GfSlider
          label="GF basso"
          value={low}
          min={5}
          max={100}
          onChange={(v) => setLow(Math.min(v, high))}
        />
        <GfSlider
          label="GF alto"
          value={high}
          min={30}
          max={100}
          onChange={(v) => setHigh(Math.max(v, low))}
        />
      </div>

      {custom && (
        <div className="notice" style={{ marginTop: 12 }}>
          Con{' '}
          <b>
            {low}/{high}
          </b>
          {low === Math.round(actual.low * 100) && high === Math.round(actual.high * 100) && (
            <span className="muted"> (quelli che avevi davvero impostato)</span>
          )}{' '}
          {custom.wouldHaveDeco ? (
            <>
              saresti uscito dalla curva: tetto più profondo <b>{custom.maxCeilingM.toFixed(0)} m</b>,{' '}
              <b>{custom.decoMinutes} min</b> con un obbligo attivo.
            </>
          ) : (
            <>
              questa immersione sarebbe rimasta <b>in curva</b>, senza nessun obbligo.
            </>
          )}
        </div>
      )}

      {presets.length > 0 && (
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Impostazione</th>
                <th className="num">Tetto</th>
                <th className="num">Minuti in obbligo</th>
                <th style={{ textAlign: 'right' }}>Esito</th>
              </tr>
            </thead>
            <tbody>
              {presets.map((r, i) => (
                <tr key={`${r.gfLow}/${r.gfHigh}`}>
                  <td>
                    <b className="tabular">
                      {r.gfLow}/{r.gfHigh}
                    </b>{' '}
                    <span className="muted">{PRESETS[i].label}</span>
                  </td>
                  <td className="num tabular">{r.maxCeilingM > 0 ? `${r.maxCeilingM.toFixed(0)} m` : '—'}</td>
                  <td className="num tabular">{r.decoMinutes > 0 ? r.decoMinutes : '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <span className={`dot ${r.wouldHaveDeco ? 'dot-warning' : 'dot-good'}`} />
                      {r.wouldHaveDeco ? 'fuori curva' : 'in curva'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GfSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="planner-field">
      <span className="planner-label">
        {label} <b className="tabular">{value}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/**
 * Cosa significa il numero del compartimento.
 *
 * Senza questa riga è un intero senza senso. Con questa riga dice qual è il tipo di
 * immersione che hai fatto: un tessuto veloce comanda dopo un'immersione corta e
 * profonda, uno lento dopo una lunga o una ripetitiva.
 */
function compartmentNote(n: number | undefined): string {
  if (n === undefined) return 'non calcolato';
  if (n <= 3) return 'tessuto velocissimo: immersione corta e profonda';
  if (n <= 6) return 'tessuto veloce: il caso più comune in ricreativa';
  if (n <= 10) return 'tessuto medio: immersione lunga, o ripetitiva';
  return 'tessuto lento: esposizione prolungata o più giorni di fila';
}

function fmtInterval(min: number | undefined): string {
  if (min === undefined) return 'nessuna pausa registrata';
  if (min < 90) return `${min} minuti`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} ore`;
}

const fmtDelta = (d: number) => `${d >= 0 ? '+' : ''}${d.toFixed(1)}`;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Le sedici barre dette in una frase.
 *
 * Il disegno risponde a tre domande in un colpo d'occhio — chi comanda, quanto è
 * vicino al suo limite, e se qualcuno lo ha superato — e sono le stesse tre a cui
 * risponde questo testo, nello stesso ordine. Il compartimento che comanda arriva
 * per primo perché è quello che decide il tetto: sapere che è il 5 invece del 12
 * dice che tipo di immersione è stata, corta e profonda oppure lunga o ripetitiva.
 *
 * Il superamento del limite è nominato per ultimo ma nominato SEMPRE, anche
 * quando non c'è: «nessuno oltre il limite» è un'informazione, e il silenzio su
 * un dato di sicurezza si legge come un dato mancante.
 */
export function riassuntoCompartimenti(
  list: CompartmentState[],
  { comanda }: { comanda?: number } = {},
): string {
  if (list.length === 0) return 'Nessun compartimento calcolato.';
  // Se chi ci chiama non dichiara il compartimento che comanda, lo si deduce dal
  // gradiente usato — è la stessa definizione con cui viene scelto altrove, e
  // dedurlo è meglio che tacerlo.
  const capo =
    list.find((c) => c.index === comanda) ?? list.reduce((a, b) => (b.percent > a.percent ? b : a));
  const piuCarico = list.reduce((a, b) => (b.total > a.total ? b : a));
  const oltre = list.filter((c) => c.total > c.limit);
  const parti = [
    `${list.length} compartimenti.`,
    `Comanda il ${capo.index}, semiperiodo ${capo.halfTimeMin} minuti: ${capo.total.toFixed(2)} bar ` +
      `contro un limite di ${capo.limit.toFixed(2)} e un valore M di ${capo.mValue.toFixed(2)}, ` +
      `cioè il ${capo.percent.toFixed(0)}% del gradiente ammesso.`,
    `Il più carico in assoluto è il ${piuCarico.index} con ${piuCarico.total.toFixed(2)} bar.`,
    oltre.length === 0
      ? 'Nessun compartimento oltre il proprio limite.'
      : `Oltre il limite: ${oltre.map((c) => c.index).join(', ')}.`,
  ];
  return parti.join(' ');
}

/**
 * Le sedici barre.
 *
 * Scala verticale in bar assoluti, comune a tutti i compartimenti: è l'unico modo
 * di vedere che il compartimento veloce è quasi vuoto e il lento è ancora pieno.
 * Normalizzare ogni barra sulla propria percentuale renderebbe il disegno più
 * ordinato e cancellerebbe la sola cosa che si voleva mostrare.
 */
function TissueBars({
  state,
  surfaceBar,
  gfHigh,
  leading,
}: {
  state: { n2: number[]; he: number[] };
  surfaceBar: number;
  gfHigh: number;
  leading?: number;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const uid = useId();
  const list: CompartmentState[] = compartments(state, surfaceBar, gfHigh);

  const height = 190;
  const pad = { left: 34, right: 10, top: 12, bottom: 24 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const maxY = Math.max(surfaceBar * 1.05, ...list.map((c) => Math.max(c.total, c.mValue))) * 1.05;
  const y = (v: number) => pad.top + plotH - (v / maxY) * plotH;
  const slot = plotW / list.length;
  const barW = Math.max(4, slot * 0.62);

  const nome = "I sedici compartimenti di Bühlmann all'uscita";
  const descrizione = riassuntoCompartimenti(list, { comanda: leading });

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={nome}
        aria-describedby={`${uid}-desc`}
      >
        <title>{nome}</title>
        <desc id={`${uid}-desc`}>{descrizione}</desc>
        {[0, maxY / 2, maxY].map((v) => (
          <g key={v} aria-hidden="true">
            <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
            <text className="axis-label" x={pad.left - 6} y={y(v) + 3} textAnchor="end">
              {v.toFixed(1)}
            </text>
          </g>
        ))}

        {/* La pressione ambiente in superficie: sotto questa riga non si è sovrasaturi. */}
        <line
          aria-hidden="true"
          x1={pad.left}
          x2={width - pad.right}
          y1={y(surfaceBar)}
          y2={y(surfaceBar)}
          stroke="var(--text-muted)"
          strokeDasharray="3 3"
        />

        {list.map((c, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2;
          const isLeading = leading === c.index;
          const over = c.total > c.limit;
          return (
            // Il gruppo è nascosto agli screen reader — sedici barre più le loro
            // tacche sono cinquanta nodi senza testo — ma il `<title>` interno
            // resta, perché è il suggerimento che il browser mostra al passaggio
            // del mouse. Ciò che qui viene tolto alla voce è restituito, per
            // intero e in forma leggibile, dalla tabella qui sotto.
            <g key={c.index} aria-hidden="true">
              <title>
                {`Compartimento ${c.index} (${c.halfTimeMin} min): ${c.total.toFixed(2)} bar, ` +
                  `valore M ${c.mValue.toFixed(2)}, limite con i tuoi GF ${c.limit.toFixed(2)} — ${c.percent.toFixed(0)}%`}
              </title>
              <rect
                x={x}
                y={y(c.total)}
                width={barW}
                height={Math.max(0, y(0) - y(c.total))}
                fill={over ? 'var(--critical)' : isLeading ? 'var(--series-1)' : 'var(--series-2)'}
                opacity={isLeading || over ? 1 : 0.55}
                rx={1}
              />
              {/* Valore M: il limite del modello nudo. */}
              <line
                x1={x - 1}
                x2={x + barW + 1}
                y1={y(c.mValue)}
                y2={y(c.mValue)}
                stroke="var(--text)"
                strokeWidth={1.5}
              />
              {/* Limite con i gradient factor impostati. */}
              <line
                x1={x - 1}
                x2={x + barW + 1}
                y1={y(c.limit)}
                y2={y(c.limit)}
                stroke="var(--warning)"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              {(c.index === 1 || c.index % 4 === 0) && (
                <text className="axis-label" x={x + barW / 2} y={height - 8} textAnchor="middle">
                  {c.index}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {/* Sedici righe: corte da ascoltare e piene di significato, con il valore M
          e il limite accanto al carico — cioè i tre numeri che stanno nel disegno
          come altezza della barra e posizione delle due tacche. */}
      <TabellaEquivalente
        didascalia={nome}
        intestazioni={[
          'Compartimento',
          'Semiperiodo (min)',
          'Carico (bar)',
          'Valore M (bar)',
          `Limite con GF ${Math.round(gfHigh * 100)} (bar)`,
          'Gradiente usato (%)',
        ]}
        righe={list.map((c) => [
          c.index === leading ? `${c.index} (comanda)` : c.index,
          c.halfTimeMin,
          c.total.toFixed(2),
          c.mValue.toFixed(2),
          c.limit.toFixed(2),
          c.percent.toFixed(0),
        ])}
      />
      <div className="chart-legend">
        <span>
          <span className="legend-key" style={{ background: 'var(--series-1)' }} />
          comanda
        </span>
        <span>
          <span className="legend-key" style={{ background: 'var(--text)' }} />
          valore M
        </span>
        <span>
          <span className="legend-key" style={{ background: 'var(--warning)' }} />
          limite con GF {Math.round(gfHigh * 100)}
        </span>
        <span>
          <span className="legend-key" style={{ background: 'var(--text-muted)' }} />
          pressione in superficie
        </span>
      </div>
    </div>
  );
}
