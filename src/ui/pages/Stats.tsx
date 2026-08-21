import { useMemo, useState, useRef } from 'react';
import { formatDuration, formatHours } from '../../core/units';
import {
  BarChart,
  ColumnChart,
  ScatterChart,
  StatTile,
  TimeSeriesChart,
  useWidth,
} from '../components/Charts';
import { useDiveLog } from '../state';
import { AnalysisCard } from '../components/Analysis';
import { PeriodPicker } from '../components/PeriodPicker';
import { dateShort, imm, int, pct } from '../format';
import { OTU_DAILY_MAX, OTU_DAILY_TDI } from '../../core/analysis/oxygen';
import {
  correlation,
  histogram,
  medianOf,
  pairsOf,
  settingsPeriods,
  tempByMonth,
  type SeriesPoint,
  type Trend,
} from '../../core/analysis/aggregate';
import { LIMITS, type Dive } from '../../core/model';
import { piastraDellImmersione, zavorraTotaleKg, type Equipment } from '../../core/analysis/gear';
import {
  consumoPerAttrezzo,
  mutaFuoriAbitudine,
  mutaPerTemperatura,
  nomeMuta,
  zavorraPerMutaEAcqua,
  type RigaZavorra,
} from '../../core/analysis/gearStats';
import { perMeteo, perStatoDelMare, perVisibilita, quanteConCondizioni } from '../../core/conditions';

type Series = 'rmv' | 'trim' | 'ascent' | 'gf99';

const SERIES_META: Record<
  Series,
  { label: string; unit: string; reference: number; referenceLabel: string; digits: number; blurb: string }
> = {
  rmv: {
    label: 'Consumo di superficie',
    unit: 'L/min',
    reference: 20,
    referenceLabel: 'obiettivo',
    digits: 1,
    blurb:
      'Litri al minuto riportati alla superficie. Confrontabile fra bombole e profondità diverse, a differenza dei bar/min. Calcolato solo dove il volume della bombola è noto.',
  },
  trim: {
    label: 'Oscillazione a quota tenuta',
    unit: 'm/min',
    reference: 2,
    referenceLabel: 'buon assetto',
    digits: 1,
    blurb:
      "Metri verticali percorsi al minuto nei tratti in cui tieni la quota — discesa e risalita sono escluse — al netto dello spostamento voluto in ciascun tratto. È il proxy più diretto del controllo d'assetto: sotto 2 m/min la quota è tenuta bene.",
  },
  ascent: {
    label: 'Velocità di risalita di picco',
    unit: 'm/min',
    reference: 10,
    referenceLabel: 'limite',
    digits: 0,
    blurb:
      'Il picco su finestra mobile di 30 secondi, non fra campioni adiacenti: evita di scambiare il rumore del sensore per una risalita rapida.',
  },
  gf99: {
    label: "GF99 all'uscita",
    unit: '%',
    reference: 75,
    referenceLabel: 'margine sottile',
    digits: 0,
    blurb:
      "Quanto eri sovrasaturo rispetto al gradiente ammesso nell'istante in cui sei arrivato in superficie. Lo calcoliamo noi dal profilo con Bühlmann ZH-L16C, tenendo conto dell'azoto residuo dall'immersione precedente: c'è su tutte le immersioni con un profilo, non solo su quelle dei computer che lo scrivono. Quanto sia accettabile dipende dai gradient factor che hai impostato.",
  },
};

export function Stats({ onOpen }: { onOpen: (id: string) => void }) {
  const { aggregates: a, dives, scope, gear } = useDiveLog();
  // Tutti i blocchi qui sotto usano le immersioni della FINESTRA, non l'archivio:
  // le aggregate arrivano già filtrate, e i grafici che ricevono le immersioni una
  // per una devono vedere lo stesso insieme, altrimenti la stessa pagina
  // mostrerebbe numeri calcolati su periodi diversi.
  const scoped = scope.dives;
  const [series, setSeries] = useState<Series>('rmv');

  if (dives.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <h2>Ancora nessun dato da analizzare</h2>
          <p className="secondary">Importa le immersioni e le statistiche appaiono qui.</p>
        </div>
      </div>
    );
  }

  const meta = SERIES_META[series];
  const points =
    series === 'rmv' ? a.rmv : series === 'trim' ? a.trim : series === 'gf99' ? a.gf99 : a.maxAscentRate;
  const trend =
    series === 'rmv'
      ? a.rmvTrend
      : series === 'trim'
        ? a.trimTrend
        : series === 'ascent'
          ? a.ascentTrend
          : undefined;

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">Statistiche</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {a.firstDive ? `dal ${dateShort(a.firstDive)}` : ''} · {a.withProfile} di {a.count} con profilo
        </span>
      </div>

      <PeriodPicker />

      {/* Un solo numero guida per la vista. */}
      <div className="card">
        <div className="spread">
          <div style={{ flex: '0 0 auto', minWidth: 200 }}>
            <div className="tile-label">Immersioni nel periodo</div>
            <div className="hero">{int(a.count)}</div>
            <div className="tile-note">
              {formatHours(a.totalS)} sott'acqua · media {formatDuration(a.avgDurationS)} a{' '}
              {a.avgMaxDepth.toFixed(1)} m
            </div>
          </div>
          <div className="grid grid-tiles" style={{ flex: '1 1 480px' }}>
            <StatTile
              label="Più profonda"
              value={`${a.maxDepthEver.toFixed(1)} m`}
              note={a.deepest?.site?.name ?? (a.deepest ? dateShort(a.deepest.startTime) : undefined)}
            />
            <StatTile
              label="Più lunga"
              value={a.longest ? formatDuration(a.longest.durationS) : '—'}
              note={a.longest?.site?.name ?? undefined}
            />
            <StatTile
              label="Ultimi 12 mesi"
              value={int(a.divesLast12m)}
              note={`${a.perMonthLast12m}/mese · ${a.divesLast90d} negli ultimi 90 giorni`}
            />
            <StatTile
              label="Ultima immersione"
              value={a.daysSinceLastDive !== undefined ? `${a.daysSinceLastDive} gg` : '—'}
              note={a.lastDive ? dateShort(a.lastDive) : undefined}
            />
          </div>
        </div>
      </div>

      {/* Le quattro misure che descrivono come ti immergi, sul periodo scelto.
          Stanno accanto ai totali perché sono la risposta alla stessa domanda —
          "come vanno le cose" — ma con i numeri che si possono migliorare invece
          di quelli che descrivono soltanto. Il valore è la MEDIANA: su serie
          piccole una singola immersione storta sposta la media e non la mediana,
          e qui la domanda è "di solito", non "in totale". */}
      <div className="card">
        <div className="page-title-row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Come ti immergi, di solito</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            Mediane sul periodo. Ogni tessera dichiara su quante immersioni si basa: dove il dato non c'è, il
            valore non viene stimato.
          </span>
        </div>
        <div className="grid grid-tiles">
          <MedianTile
            label="Consumo in superficie"
            points={a.rmv}
            unit="L/min"
            digits={1}
            trend={a.rmvTrend}
            extra={a.avgRmv !== undefined ? `media ${a.avgRmv.toFixed(1)}` : undefined}
            missing="Serve il volume della bombola e le due pressioni."
          />
          <MedianTile
            label="Assetto"
            points={a.trim}
            unit="m/min"
            digits={1}
            trend={a.trimTrend}
            extra={`${a.trim.filter((p) => p.value < LIMITS.goodTrimMpm).length} sotto i ${LIMITS.goodTrimMpm} m/min`}
            missing="Serve un profilo campionato."
          />
          <MedianTile
            label="Velocità di risalita"
            points={a.maxAscentRate}
            unit="m/min"
            digits={1}
            trend={a.ascentTrend}
            extra={a.fastAscentRate !== undefined ? `${pct(a.fastAscentRate)} oltre il limite` : undefined}
            missing="Serve un profilo campionato."
          />
          <MedianTile
            label="GF99 all'uscita"
            points={a.gf99}
            unit="%"
            digits={0}
            extra={gfLabel(scoped)}
            missing="Serve un profilo campionato."
          />
        </div>
      </div>

      {a.repetitiveDives > 0 && (
        <div className="card">
          <div className="page-title-row" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Le ripetitive</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              {a.repetitiveDives} immersioni del periodo sono cominciate con dell'azoto ancora in circolo.
            </span>
          </div>
          <p className="card-sub">
            Il costo è la differenza fra il GF99 con cui sei uscito e quello con cui saresti uscito facendo la{' '}
            <em>stessa identica immersione</em> da tessuti puliti. È un confronto fra due esecuzioni dello
            stesso profilo, non una stima — e nessun computer subacqueo può dirtelo, perché richiede di
            guardare due immersioni insieme.
          </p>
          <div className="grid grid-tiles">
            <StatTile
              label="Costo mediano"
              value={
                <span className="tabular">
                  +{(a.repetitiveCostMedian ?? 0).toFixed(1)} <small style={{ fontSize: 14 }}>punti</small>
                </span>
              }
              note="di GF99 all'uscita, rispetto a partire da pulito"
            />
            <StatTile
              label="Caso peggiore"
              value={
                <span
                  className="tabular"
                  style={{
                    color: (a.repetitiveCostWorst?.points ?? 0) >= 8 ? 'var(--warning-text)' : undefined,
                  }}
                >
                  +{(a.repetitiveCostWorst?.points ?? 0).toFixed(1)}
                </span>
              }
              note={
                a.repetitiveCostWorst
                  ? `${dateShort(a.repetitiveCostWorst.dive.startTime, a.repetitiveCostWorst.dive.utcOffsetMinutes)}${
                      a.repetitiveCostWorst.surfaceIntervalMin !== undefined
                        ? ` · ${a.repetitiveCostWorst.surfaceIntervalMin} min di pausa`
                        : ''
                    }`
                  : undefined
              }
            />
            <StatTile
              label="Pausa mediana"
              value={
                <span className="tabular">
                  {a.surfaceIntervalMedian ?? '—'} <small style={{ fontSize: 14 }}>min</small>
                </span>
              }
              note="fra un'immersione e la successiva della stessa giornata"
            />
          </div>
        </div>
      )}

      {a.oxygen.eligible > 0 && (
        <div className="card">
          <div className="page-title-row" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Esposizione all'ossigeno</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              Calcolata da noi sul profilo con le tabelle NOAA, su {a.oxygen.eligible} immersioni del periodo.
              Il valore che scrive il computer è un'altra cosa: modello diverso.
            </span>
          </div>
          <div className="grid grid-tiles">
            <StatTile
              label="Giornata peggiore, CNS"
              value={
                <span
                  className="tabular"
                  style={{
                    color: (a.oxygen.worstCnsDay?.peakCnsPercent ?? 0) >= 100 ? 'var(--critical)' : undefined,
                  }}
                >
                  {a.oxygen.worstCnsDay?.peakCnsPercent ?? 0}%
                </span>
              }
              note={
                a.oxygen.worstCnsDay
                  ? `${dateShort(a.oxygen.worstCnsDay.date)} · ${a.oxygen.worstCnsDay.dives} immersioni · limite 100%`
                  : undefined
              }
            />
            <StatTile
              label="Giornata peggiore, OTU"
              value={
                <span
                  className="tabular"
                  style={{
                    color: (a.oxygen.worstOtuDay?.otu ?? 0) > OTU_DAILY_MAX ? 'var(--critical)' : undefined,
                  }}
                >
                  {a.oxygen.worstOtuDay?.otu ?? 0}
                </span>
              }
              note={`riferimento ${OTU_DAILY_TDI} al giorno su più giorni, ${OTU_DAILY_MAX} in un giorno solo`}
            />
            <StatTile
              label="Giorni sopra 300 OTU"
              value={<span className="tabular">{a.oxygen.daysOverOtu300}</span>}
              note={`su ${a.oxygen.days.length} giornate di immersione nel periodo`}
            />
            <StatTile
              label="Velocità sull'ultimo tratto"
              value={
                <span className="tabular">
                  {a.finalAscent.length
                    ? `${medianOf(a.finalAscent.map((p) => p.value))!.toFixed(0)} m/min`
                    : '—'}
                </span>
              }
              note={
                a.finalAscent.length
                  ? // Contro il limite dell'app, non contro i 60 m/min che DAN
                    // MISURA come media dei subacquei: quella soglia non scatta
                    // quasi mai — ed è giusto così, perché superarla vuol dire
                    // andare più veloce di una popolazione che già va troppo
                    // veloce — ma una nota che dice sempre «0» si smette di
                    // leggere. Vedi `danFinalAscentMpm`.
                    `mediana dalla sosta alla superficie · ${a.finalAscentsOverAppLimit} oltre i ${LIMITS.ascentRateShallowMpm} m/min`
                  : 'serve un profilo campionato'
              }
            />
          </div>

          {a.oxygen.days.length > 1 && (
            <div style={{ marginTop: 16 }}>
              <div className="mini-title">
                <span>OTU per giornata di immersione</span>
                <span className="mini-last">{a.oxygen.days[a.oxygen.days.length - 1].otu} l'ultima</span>
              </div>
              <ColumnChart
                data={a.oxygen.days.map((d) => ({
                  key: d.date,
                  label: dateShort(d.date),
                  value: d.otu,
                }))}
                unit="OTU"
                height={150}
              />
            </div>
          )}

          <p className="muted" style={{ fontSize: 11, marginTop: 12, marginBottom: 0 }}>
            Il CNS della giornata tiene conto del dimezzamento ogni 90 minuti in superficie: la somma nuda
            sovrastimerebbe, l'ultimo valore sottostimerebbe. Le OTU invece non recuperano — né in giornata né
            fra un giorno e l'altro — ed è per questo che le due cose stanno insieme. Il tratto finale è
            misurato punto a punto e non su finestra mobile: dura pochi secondi, ed è esattamente il motivo
            per cui di solito non si vede.
          </p>
        </div>
      )}

      <SitesMap dives={scoped} onOpen={onOpen} />

      <div className="card">
        <h2>Attività mese per mese</h2>
        <p className="card-sub">
          Ultimi 24 mesi. I mesi vuoti sono lasciati visibili: la stagionalità e le pause sono parte
          dell'informazione.
        </p>
        <ColumnChart data={a.byMonth} unit="immersioni" height={170} />
      </div>

      <div className="card">
        <div className="filters" style={{ marginBottom: 12 }}>
          <label>
            Andamento di
            <select value={series} onChange={(e) => setSeries(e.target.value as Series)}>
              <option value="rmv">consumo di superficie</option>
              <option value="trim">assetto</option>
              <option value="ascent">velocità di risalita</option>
              {a.gf99.length > 0 && <option value="gf99">GF99 all'uscita</option>}
            </select>
          </label>
          {trend && (
            <span className="badge">
              <span
                className={`dot ${trend.direction === 'improving' ? 'dot-good' : trend.direction === 'worsening' ? 'dot-warning' : 'dot-serious'}`}
              />
              {trend.direction === 'improving'
                ? 'in miglioramento'
                : trend.direction === 'worsening'
                  ? 'in peggioramento'
                  : 'stabile'}
              : {trend.firstHalf.toFixed(meta.digits)} → {trend.secondHalf.toFixed(meta.digits)} {meta.unit}
            </span>
          )}
        </div>
        <h2>{meta.label}</h2>
        <p className="card-sub">
          {meta.blurb} Disponibile su {points.length} immersioni su {a.count}.
        </p>
        <TimeSeriesChart
          points={points}
          unit={meta.unit}
          reference={meta.reference}
          referenceLabel={meta.referenceLabel}
          format={(v) => v.toFixed(meta.digits)}
          onPick={onOpen}
        />
        {points.length > 0 && (
          <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
            Clicca un punto per aprire l'immersione.
          </p>
        )}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Fasce di profondità</h2>
          <p className="card-sub">Dove passi effettivamente il tempo.</p>
          <BarChart data={a.byDepthBand} unit="immersioni" />
        </div>
        <div className="card">
          <h2>Siti più frequentati</h2>
          <p className="card-sub">Per numero di immersioni.</p>
          <BarChart
            data={a.topSites.map((s) => ({ key: s.name, label: s.name, value: s.dives }))}
            unit="immersioni"
          />
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Disciplina</h2>
          <p className="card-sub">
            Le percentuali sono calcolate solo sulle immersioni in cui la verifica è possibile: il
            denominatore è indicato accanto a ciascuna riga.
          </p>
          <table>
            <tbody>
              <DisciplineRow
                label="Sosta di sicurezza completata"
                value={pct(a.safetyStopRate)}
                basis={`${a.safetyStopEligible} immersioni in curva sopra i 10 m`}
                eligible={a.safetyStopEligible}
                good={(a.safetyStopRate ?? 0) >= 0.9}
              />
              <DisciplineRow
                label="Immersioni con risalite fuori limite"
                value={pct(a.fastAscentRate)}
                basis={`${a.withProfile} immersioni con profilo`}
                eligible={a.withProfile}
                good={(a.fastAscentRate ?? 1) <= 0.1}
              />
              <DisciplineRow
                label="Uscite sotto i 50 bar"
                value={pct(a.lowReserveRate)}
                basis={`${a.lowReserveEligible} immersioni con pressione finale`}
                eligible={a.lowReserveEligible}
                good={(a.lowReserveRate ?? 1) <= 0.05}
              />
              <DisciplineRow
                label="Violazioni del tetto deco"
                value={int(a.ceilingViolations)}
                // Solo le immersioni il cui profilo porta il canale del tetto:
                // le altre non sono "senza violazioni", sono non verificabili.
                basis={`${a.ceilingEligible} immersioni con il tetto registrato`}
                eligible={a.ceilingEligible}
                good={a.ceilingViolations === 0}
              />
              <DisciplineRow
                label="Parte profonda per prima"
                value={pct(a.deepestFirstEligible ? a.deepestFirstDives / a.deepestFirstEligible : undefined)}
                basis={`${a.deepestFirstEligible} immersioni con profilo`}
                eligible={a.deepestFirstEligible}
                good={a.deepestFirstDives >= a.deepestFirstEligible * 0.8}
              />
              <DisciplineRow
                label="Con una sosta profonda"
                value={pct(a.deepStopEligible ? a.deepStopDives / a.deepStopEligible : undefined)}
                basis={`${a.deepStopEligible} immersioni oltre i 20 m`}
                eligible={a.deepStopEligible}
                // Non è un pass/fail: la regola pratica è del 2013 e la
                // letteratura successiva sulle soste profonde è discussa.
                good={undefined}
              />
              {a.badGasSwitches > 0 && (
                <DisciplineRow
                  label="Cambi di gas sotto la MOD"
                  value={int(a.badGasSwitches)}
                  basis="verificato sui profili con più di una bombola"
                  good={false}
                />
              )}
              {a.avgGf99 !== undefined && (
                <DisciplineRow
                  label="GF99 medio all'uscita"
                  value={`${a.avgGf99.toFixed(0)}%`}
                  basis={
                    a.gf99Agreement !== undefined
                      ? `${a.gf99.length} immersioni, calcolato da noi — sulle ${a.gf99AgreementCount} che hanno anche il valore del computer i due modelli distano ${a.gf99Agreement.toFixed(1)} punti`
                      : `${a.gf99.length} immersioni, calcolato da noi dal profilo`
                  }
                  good={a.avgGf99 <= 65}
                />
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Composizione dell'archivio</h2>
          <p className="card-sub">Configurazione, miscele, esposizione.</p>
          <table>
            <tbody>
              <tr>
                <td className="muted">Oltre i 30 m</td>
                <td className="num tabular">{int(a.deepDives30)}</td>
              </tr>
              <tr>
                <td className="muted">Oltre i 40 m</td>
                <td className="num tabular">{int(a.deepDives40)}</td>
              </tr>
              <tr>
                <td className="muted">Con obbligo decompressivo</td>
                <td className="num tabular">{int(a.decoDives)}</td>
              </tr>
              <tr>
                <td className="muted">In rebreather</td>
                <td className="num tabular">{int(a.ccrDives)}</td>
              </tr>
              <tr>
                <td className="muted">Sotto i 14 °C</td>
                <td className="num tabular">{int(a.coldDives)}</td>
              </tr>
              {a.byMix.slice(0, 4).map((b) => (
                <tr key={b.key}>
                  <td className="muted">{b.label}</td>
                  <td className="num tabular">{int(b.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Immersioni per anno</h2>
        <ColumnChart
          data={[...a.byYear].sort((x, y) => x.key.localeCompare(y.key))}
          unit="immersioni"
          height={150}
        />
      </div>

      <Correlations dives={scoped} onOpen={onOpen} inventario={gear.equipment} />
      <Condizioni dives={scoped} />
      <Attrezzatura dives={scoped} inventario={gear.equipment} />
      <Distributions dives={scoped} />
      <SettingsHistory dives={scoped} />
      <Seasonality dives={scoped} />

      <AnalysisCard
        kind="archive"
        title="Analisi dell'archivio con Claude"
        description="Legge tutte le immersioni una per una, non solo le medie: cambi di comportamento nel tempo, indicatori che si muovono insieme, immersioni fuori scala."
        currentFingerprint={`${scope.period.id}:${scope.dives.length}:${a.lastDive ?? ''}`}
      />
    </div>
  );
}

function DisciplineRow({
  label,
  value,
  basis,
  good,
  eligible,
}: {
  label: string;
  value: string;
  basis: string;
  /**
   * Su quante immersioni la verifica è stata possibile. A zero non esiste né un
   * valore né un giudizio: la riga mostrava «Violazioni del tetto deco: 0» con
   * il pallino verde su un denominatore vuoto, cioè trasformava «non
   * verificabile» in «tutto a posto» — esattamente l'errore che il
   * denominatore accanto a ogni riga esiste per evitare.
   */
  eligible?: number;
  /**
   * `undefined` significa "misura senza giudizio": non tutto ciò che si conta ha
   * un verso giusto, e dipingere di verde o di giallo un numero su cui la
   * didattica stessa non si pronuncia — le soste profonde, per esempio —
   * gli darebbe un'autorità che non ha.
   */
  good?: boolean;
}) {
  const measurable = eligible === undefined || eligible > 0;
  const verdict = measurable ? good : undefined;
  return (
    <tr>
      <td>
        <div className="row" style={{ gap: 7 }}>
          <span
            className={`dot ${verdict === undefined ? '' : verdict ? 'dot-good' : 'dot-warning'}`}
            style={verdict === undefined ? { background: 'var(--axis)' } : undefined}
          />
          <span>{label}</span>
        </div>
        <div className="muted" style={{ fontSize: 11, marginLeft: 15 }}>
          {measurable ? `su ${basis}` : `nessuna immersione verificabile: ${basis}`}
        </div>
      </td>
      <td className="num tabular" style={{ fontWeight: 650 }}>
        {measurable ? value : '—'}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Analisi che rispondono a "perché", non a "quanto"
// ---------------------------------------------------------------------------

/**
 * Relazioni fra due misure.
 *
 * Una media non dice se il consumo dipende dalla profondità o dalla temperatura:
 * per quello servono i punti, uno per immersione, con la retta di tendenza e il
 * coefficiente accanto. Il coefficiente è dichiarato per quello che è — una
 * correlazione osservata su questo archivio, non una causa.
 */
function Correlations({
  dives,
  onOpen,
  inventario,
}: {
  dives: Dive[];
  onOpen: (id: string) => void;
  inventario: Equipment[];
}) {
  const sets = [
    {
      title: 'Consumo e profondità media',
      hint: 'Se il consumo cresce con la profondità oltre l’effetto della pressione, di solito è affaticamento o assetto.',
      points: pairsOf(
        dives,
        (d) => d.avgDepth,
        (d) => d.metrics?.rmvLpm,
      ),
      xLabel: 'profondità media (m)',
      yLabel: 'consumo (L/min)',
    },
    {
      title: 'Consumo e temperatura',
      hint: 'Il freddo alza il consumo: quanto, su questi dati, si vede qui.',
      points: pairsOf(
        dives,
        (d) => d.minTempC,
        (d) => d.metrics?.rmvLpm,
      ),
      xLabel: 'temperatura minima (°C)',
      yLabel: 'consumo (L/min)',
    },
    {
      title: 'Assetto e consumo',
      hint: 'Muoversi in verticale costa gas: se i due si muovono insieme, lavorare sull’assetto abbassa anche il consumo.',
      points: pairsOf(
        dives,
        (d) => d.metrics?.bottomVerticalTravelMpm,
        (d) => d.metrics?.rmvLpm,
      ),
      xLabel: 'oscillazione a quota tenuta (m/min)',
      yLabel: 'consumo (L/min)',
    },
    {
      title: 'Zavorra e assetto',
      hint: 'La sovra-zavorra è la prima causa di assetto instabile, e questo grafico la mette alla prova.',
      points: pairsOf(
        dives,
        // La zavorra TOTALE, piastra compresa: leggendo il solo `weightKg` i
        // punti delle immersioni tecniche finivano tre o sei chili a sinistra di
        // dove stanno davvero, e la retta di tendenza con loro.
        (d) =>
          d.weightKg === undefined && piastraDellImmersione(d, inventario) === undefined
            ? undefined
            : zavorraTotaleKg(d, inventario),
        (d) => d.metrics?.bottomVerticalTravelMpm,
      ),
      xLabel: 'zavorra totale, piastra compresa (kg)',
      yLabel: 'oscillazione (m/min)',
    },
  ].filter((s) => s.points.length >= 5);

  if (!sets.length) return null;

  return (
    <div className="card">
      <h2>Cosa dipende da cosa</h2>
      <p className="card-sub">
        Ogni punto è un'immersione, e si può cliccare per aprirla. La retta tratteggiata è la tendenza dei
        minimi quadrati; <b>r</b> è il coefficiente di correlazione: 0 nessuna relazione, ±1 relazione
        perfetta. È una correlazione osservata su questo archivio, non una causa dimostrata.
      </p>
      <div className="grid grid-2">
        {sets.map((s) => {
          const r = correlation(s.points);
          return (
            <div key={s.title}>
              <div className="mini-title">
                <span>{s.title}</span>
                <span className="mini-last tabular">
                  {r === undefined ? '—' : `r ${r > 0 ? '+' : ''}${r.toFixed(2)}`}
                </span>
              </div>
              <ScatterChart
                points={s.points}
                xLabel={s.xLabel}
                yLabel={s.yLabel}
                onPick={onOpen}
                height={210}
              />
              <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
                {s.hint} Su {imm(s.points.length)}.
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Distribuzioni invece di medie.
 *
 * Sulle code si gioca la sicurezza: una velocità di risalita media dentro i limiti
 * può contenere tre immersioni a 18 m/min, e la media non lo dice. L'ultimo
 * intervallo è aperto verso l'alto proprio perché i casi peggiori non finiscano
 * fuori dal grafico.
 */
function Distributions({ dives }: { dives: Dive[] }) {
  const ascent = histogram(
    dives.map((d) => d.metrics?.maxAscentRateMpm).filter((v): v is number => v !== undefined),
    [0, 3, 6, 9, 12, 15, 18],
    '',
  );
  const rmv = histogram(
    dives.map((d) => d.metrics?.rmvLpm).filter((v): v is number => v !== undefined),
    [8, 12, 16, 20, 24, 28],
    '',
  );
  const reserve = histogram(
    dives.map((d) => d.metrics?.endPressureBar).filter((v): v is number => v !== undefined),
    [0, 30, 50, 70, 100, 150],
    '',
  );

  const blocks = [
    {
      title: `Velocità di risalita massima (m/min) — limite ${LIMITS.ascentRateDeepMpm}`,
      bins: ascent,
      note: 'Il valore massimo di ciascuna immersione, su finestra di 30 s.',
    },
    { title: 'Consumo di superficie (L/min)', bins: rmv, note: 'Solo dove volume e pressioni sono noti.' },
    {
      title: `Pressione all'uscita (bar) — riserva ${LIMITS.minReserveBar}`,
      bins: reserve,
      note: 'Le prime due colonne sono le uscite sotto la riserva.',
    },
  ].filter((b) => b.bins.some((x) => x.count > 0));

  if (!blocks.length) return null;

  return (
    <div className="card">
      <h2>Distribuzioni</h2>
      <p className="card-sub">
        Quante immersioni cadono in ciascun intervallo. È la vista che mostra le code, cioè i casi che una
        media nasconde.
      </p>
      <div className="grid grid-3">
        {blocks.map((b) => (
          <div key={b.title}>
            <div className="mini-title">
              <span>{b.title}</span>
            </div>
            <ColumnChart
              data={b.bins.map((x) => ({ key: x.label, label: x.label, value: x.count }))}
              unit="immersioni"
              height={150}
              labelEvery={1}
            />
            <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
              {b.note}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Come cambiano le cose col mare, col tempo e con la visibilità.
 *
 * PERCHÉ TABELLE E NON CORRELAZIONI. «Mare mosso» non è un numero: per metterlo
 * in una correlazione bisognerebbe ordinarlo da 1 a 4, cioè affermare che il
 * passo da calmo a mosso vale quanto quello da mosso ad agitato. Non lo sappiamo,
 * e quel coefficiente verrebbe poi letto come se lo sapessimo. Mediane per
 * gruppo, ognuna col proprio denominatore: si controlla a occhio, che su un
 * archivio personale conta più dell'eleganza.
 *
 * PERCHÉ NON DICE MAI PERCHÉ. Col mare agitato si esce dai posti riparati, quindi
 * si va in siti diversi, spesso più profondi e più freddi. Se il consumo sale,
 * sale insieme a tre cose insieme. La tabella dice cosa è successo; il perché lo
 * sa chi c'era — ed è il motivo per cui accanto al consumo ci sono anche la
 * profondità e la temperatura mediane di quel gruppo, che sono le prime due
 * spiegazioni alternative da guardare.
 */
/**
 * L'attrezzatura incrociata col resto del log.
 *
 * PERCHÉ STA IN STATISTICHE E NON IN ATTREZZATURA. La pagina attrezzatura
 * risponde a «cosa ho e quando va revisionato»: è un inventario. Queste tre
 * tabelle rispondono a domande sul comportamento in acqua — con quale muta,
 * quanti chili, quanto consumo — e per farlo hanno bisogno del profilo, della
 * temperatura e della salinità, cioè delle stesse cose di cui è fatta questa
 * pagina. Sono statistiche che parlano di attrezzi, non attrezzi che portano
 * qualche numero.
 *
 * Il calcolo sta in `core/analysis/gearStats.ts`, e le tre cautele scritte
 * accanto alle tabelle del consumo vengono da lì: non sono decorazione, sono la
 * frase che impedisce di leggere una correlazione come una causa.
 */
function Attrezzatura({ dives, inventario }: { dives: Dive[]; inventario: Equipment[] }) {
  const mute = useMemo(() => mutaPerTemperatura(dives), [dives]);
  const fuori = useMemo(() => mutaFuoriAbitudine(dives), [dives]);
  // La stessa soglia delle altre due tabelle della scheda: con soglie diverse
  // una muta compariva in una e non nelle altre, senza che nulla lo spiegasse.
  const zavorra = useMemo(() => zavorraPerMutaEAcqua(dives, 3, inventario), [dives, inventario]);
  const consumo = useMemo(() => consumoPerAttrezzo(dives), [dives]);

  /*
   * Una sezione vuota non si mostra, ma il silenzio si spiega UNA volta.
   *
   * Su un archivio importato da file l'attrezzatura non c'è quasi mai, e una
   * pagina che salta la sezione senza dire niente lascia credere che l'app non
   * la calcoli. Una riga che dice dove si compila vale più di tre tabelle
   * vuote.
   */
  if (!mute.length && !zavorra.length && !consumo.length) {
    const conMuta = dives.filter((d) => nomeMuta(d)).length;
    if (!conMuta) return null;
    return (
      <div className="card">
        <h2>Attrezzatura</h2>
        <p className="card-sub" style={{ marginBottom: 0 }}>
          L'attrezzatura è registrata su {imm(conMuta)} immersioni: troppo poche, o troppo sparse, perché un
          confronto significhi qualcosa. Queste tabelle si riempiono da sole man mano che compili muta,
          zavorra ed erogatori nella scheda delle immersioni — anche in blocco, dal logbook.
        </p>
      </div>
    );
  }

  const salLabel = (s: RigaZavorra['salinity']) =>
    s === 'salt' ? 'salata' : s === 'fresh' ? 'dolce' : 'non indicata';

  return (
    <div className="card">
      <h2>Attrezzatura</h2>
      <p className="card-sub">
        Quello che porti addosso incrociato con quello che il profilo misura. Nessuna di queste tabelle dice
        «meglio»: accanto a ogni riga trovi la profondità mediana e su quante immersioni è calcolata, che sono
        i due numeri con cui si smonta una correlazione finta. Un gruppo entra in tabella da{' '}
        <b>tre immersioni</b> in su: una mediana su due valori è il più fortunato dei due.
      </p>

      {mute.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="finding-section-label">Muta, temperatura e stagione</div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Muta</th>
                  <th className="num">Immersioni</th>
                  <th className="num">T mediana</th>
                  <th className="num">La più fredda</th>
                  <th className="num">La più calda</th>
                  <th className="num">Stagione</th>
                  <th className="num">Prof. mediana</th>
                </tr>
              </thead>
              <tbody>
                {mute.map((r) => (
                  <tr key={r.suit}>
                    <td style={{ fontWeight: 550 }}>{r.suit}</td>
                    <td className="num tabular">{r.dives}</td>
                    <td className="num tabular">
                      {r.medianTempC !== undefined ? (
                        <>
                          {r.medianTempC} <small className="muted">°C · su {r.tempBasis}</small>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    {/* Il minimo in evidenza: è il numero che dice fin dove quella muta ti ha portato. */}
                    <td className="num tabular" style={{ fontWeight: 550 }}>
                      {r.minTempC !== undefined ? `${r.minTempC} °C` : '—'}
                    </td>
                    <td className="num tabular muted">
                      {r.maxTempC !== undefined ? `${r.maxTempC} °C` : '—'}
                    </td>
                    <td className="num muted">{r.stagione}</td>
                    <td className="num tabular muted">
                      {r.medianMaxDepth !== undefined ? `${r.medianMaxDepth} m` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fuori.length > 0 && (
            <p className="planner-hint" style={{ marginTop: 8 }}>
              {fuori.length === 1 ? 'Un’immersione' : `${fuori.length} immersioni`} in cui eri vestito
              diversamente dalla tua abitudine per quella temperatura:{' '}
              {fuori
                .slice(0, 4)
                .map(
                  (f) =>
                    `${dateShort(f.dive.startTime, f.dive.utcOffsetMinutes)} — ${f.tempC} °C in ${f.suit}, di solito ${f.solita} (su ${f.base})`,
                )
                .join(' · ')}
              {fuori.length > 4 ? ` · e altre ${fuori.length - 4}` : ''}. Non è un errore: è un promemoria di
              quando hai fatto un'eccezione.
            </p>
          )}
        </div>
      )}

      {zavorra.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="finding-section-label">Zavorra, per muta e per tipo d'acqua</div>
          <p className="planner-hint" style={{ marginTop: 0 }}>
            Fra dolce e salata ci sono due o tre chili di differenza, e una mediana che le mescola non è
            giusta in nessuna delle due situazioni. I chili sono sempre il <b>totale</b>: zavorra più piastra,
            perché è quello che ti tira giù.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Muta</th>
                  <th>Acqua</th>
                  <th className="num">Zavorra mediana</th>
                  <th className="num">Intervallo</th>
                  <th className="num">Assetto</th>
                  <th className="num">Bombola</th>
                  <th className="num">Immersioni</th>
                </tr>
              </thead>
              <tbody>
                {zavorra.map((r) => (
                  <tr key={`${r.suit} ${r.salinity}`}>
                    <td style={{ fontWeight: 550 }}>{r.suit}</td>
                    <td className={r.salinity === 'unknown' ? 'muted' : undefined}>{salLabel(r.salinity)}</td>
                    <td className="num tabular" style={{ fontWeight: 550 }}>
                      {r.medianKg} kg
                      {r.withBackplate > 0 && (
                        <>
                          {' '}
                          <small className="muted">con piastra su {r.withBackplate}</small>
                        </>
                      )}
                    </td>
                    <td className="num tabular muted">
                      {r.minKg === r.maxKg ? 'sempre uguale' : `${r.minKg}–${r.maxKg} kg`}
                    </td>
                    <td className="num tabular">
                      {r.medianTrimMpm !== undefined ? (
                        <>
                          {r.medianTrimMpm} <small className="muted">m/min · su {r.trimBasis}</small>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num muted">
                      {r.bombolaPiuUsata ? (
                        <>
                          {r.bombolaPiuUsata} <small className="muted">· su {r.bombolaBase}</small>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num tabular">{r.dives}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {consumo.map((t) => (
        <div key={t.titolo} style={{ marginBottom: 18 }}>
          <div className="finding-section-label">
            Consumo per {t.titolo.toLowerCase()} — {t.conIlDato} immersioni con il dato su {dives.length} nel
            periodo
          </div>
          <p className="planner-hint" style={{ marginTop: 0 }}>
            {t.cautela}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t.titolo}</th>
                  <th className="num">Immersioni</th>
                  <th className="num">Consumo</th>
                  <th className="num">Prof. mediana</th>
                  {/* MEDIANA delle minime, non la più bassa: la tabella qui
                      sopra chiama «La più fredda» un vero minimo, e sulla stessa
                      muta le due dicevano 21 e 11 °C. */}
                  <th className="num">T mediana</th>
                  <th className="num">Durata</th>
                </tr>
              </thead>
              <tbody>
                {t.righe.map((r) => (
                  <tr key={r.etichetta}>
                    <td style={{ fontWeight: 550 }}>{r.etichetta}</td>
                    <td className="num tabular">{r.dives}</td>
                    <td className="num tabular">
                      {r.medianRmvLpm !== undefined ? (
                        <>
                          {r.medianRmvLpm} <small className="muted">L/min · su {r.rmvBasis}</small>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num tabular muted">
                      {r.medianMaxDepth !== undefined ? `${r.medianMaxDepth} m` : '—'}
                    </td>
                    <td className="num tabular muted">
                      {r.medianTempC !== undefined ? `${r.medianTempC} °C` : '—'}
                    </td>
                    <td className="num tabular muted">
                      {r.medianDurationMin !== undefined ? `${r.medianDurationMin} min` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function Condizioni({ dives }: { dives: Dive[] }) {
  const mare = useMemo(() => perStatoDelMare(dives), [dives]);
  const visibilita = useMemo(() => perVisibilita(dives), [dives]);
  const meteo = useMemo(() => perMeteo(dives), [dives]);
  const quante = useMemo(() => quanteConCondizioni(dives), [dives]);

  const tabelle = [
    { titolo: 'Stato del mare', righe: mare, con: quante.mare },
    { titolo: 'Visibilità', righe: visibilita, con: quante.visibilita },
    { titolo: 'Meteo', righe: meteo, con: quante.meteo },
  ].filter((t) => t.righe.length >= 2);

  /*
   * Con un solo gruppo non c'è niente da confrontare, e una tabella con una riga
   * sola invita a leggere quel numero come «il tuo consumo col mare calmo»
   * quando è semplicemente il tuo consumo. Sotto le due righe la tabella non
   * compare.
   */
  if (!tabelle.length) {
    const totale = quante.mare + quante.meteo + quante.visibilita;
    if (totale === 0) return null;
    return (
      <div className="card">
        <h2>Condizioni</h2>
        <p className="card-sub" style={{ marginBottom: 0 }}>
          Le condizioni sono registrate su poche immersioni, e con un gruppo solo non c'è niente da
          confrontare. Compilando mare, visibilità e meteo nella scheda di un'immersione — sono tre tendine —
          queste tabelle si riempiono da sole.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Quanto contano le condizioni</h2>
      <p className="card-sub">
        Le tue mediane, divise per come stava il mare, per quanto ci vedevi e per che tempo faceva. Accanto al
        consumo trovi profondità e temperatura mediane dello stesso gruppo: se il consumo sale insieme alla
        profondità, non sono state le onde. Solo i gruppi con almeno tre immersioni.
      </p>
      {tabelle.map((t) => (
        <div key={t.titolo} style={{ marginBottom: 18 }}>
          <div className="finding-section-label">
            {t.titolo} — {t.righe.reduce((n, r) => n + r.dives, 0)} immersioni in tabella su {t.con} con il
            dato, {dives.length} nel periodo
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t.titolo}</th>
                  <th className="num">Immersioni</th>
                  <th className="num">Consumo</th>
                  <th className="num">Assetto</th>
                  <th className="num">Prof. mediana</th>
                  <th className="num">Durata</th>
                  <th className="num">T minima</th>
                </tr>
              </thead>
              <tbody>
                {t.righe.map((r) => (
                  <tr key={r.chiave}>
                    <td>{r.etichetta}</td>
                    <td className="num tabular">{r.dives}</td>
                    {/*
                     * Il denominatore accanto a ogni mediana, non solo in cima.
                     * «17.2 L/min» su tre immersioni delle dodici del gruppo è
                     * un'altra affermazione rispetto a «17.2 su dodici», e senza
                     * il numero piccolo le due si leggono uguali.
                     */}
                    <td className="num tabular">
                      {r.medianRmvLpm !== undefined ? (
                        <>
                          {r.medianRmvLpm} <small className="muted">L/min · su {r.rmvBasis}</small>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num tabular">
                      {r.medianTrimMpm !== undefined ? (
                        <>
                          {r.medianTrimMpm} <small className="muted">m/min · su {r.trimBasis}</small>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num tabular">{r.medianMaxDepth} m</td>
                    <td className="num tabular">{r.medianDurationMin} min</td>
                    <td className="num tabular">
                      {r.medianTempC !== undefined ? (
                        <>
                          {r.medianTempC} <small className="muted">°C · su {r.tempBasis}</small>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="muted" style={{ fontSize: 11, margin: 0 }}>
        Nessuna di queste righe dice una causa. Le condizioni non arrivano da sole: col mare agitato si esce
        dai posti riparati, e quindi cambiano anche il sito, la profondità e la temperatura. Quello che la
        tabella può dire è che una differenza c'è — e dove guardare per capire da dove viene.
      </p>
    </div>
  );
}

/**
 * Storia delle impostazioni di decompressione.
 *
 * Serve a leggere correttamente la tendenza del GF99: quel valore dipende dai
 * gradient factor impostati, quindi una tendenza che attraversa un cambio di
 * impostazioni non misura un cambio di comportamento. Su questo archivio è
 * successo davvero.
 */
function SettingsHistory({ dives }: { dives: Dive[] }) {
  const periods = settingsPeriods(dives);
  if (periods.length < 2) return null;
  return (
    <div className="card">
      <h2>Impostazioni del computer nel tempo</h2>
      <p className="card-sub">
        Il GF99 all'uscita dipende da queste impostazioni: confrontarlo fra periodi diversi senza tenerne
        conto porta a conclusioni sbagliate.
      </p>
      {/* Cinque colonne con intestazioni lunghe: a 440 px non ci stanno, e senza
          contenitore a scorrere era la PAGINA. Questa carta compare solo se il
          computer ha cambiato impostazioni almeno una volta — per questo
          l'archivio dimostrativo non la mostrava e il controllo automatico
          non la vedeva. */}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Impostazione</th>
              <th>Dal</th>
              <th>Al</th>
              <th className="num">Immersioni</th>
              <th className="num">GF99 medio all'uscita</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={`${p.label}-${p.from}`}>
                <td style={{ fontWeight: 550 }}>{p.label}</td>
                <td className="tabular">{dateShort(p.from)}</td>
                <td className="tabular">{dateShort(p.to)}</td>
                <td className="num tabular">{p.dives}</td>
                <td className="num tabular">{p.avgGf99 !== undefined ? `${p.avgGf99.toFixed(0)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Stagionalità: temperatura minima media per mese. */
function Seasonality({ dives }: { dives: Dive[] }) {
  const months = tempByMonth(dives).filter((m) => m.value > 0);
  if (months.length < 3) return null;
  return (
    <div className="card">
      <h2>Temperatura per mese</h2>
      <p className="card-sub">
        Temperatura minima media delle immersioni fatte in ciascun mese: dice quando serve la muta più
        pesante, e va letta insieme al grafico consumo/temperatura qui sopra.
      </p>
      <ColumnChart data={months} unit="°C" height={150} labelEvery={1} />
    </div>
  );
}

/**
 * Una misura del periodo: mediana, quante immersioni la sostengono, e la
 * direzione della tendenza.
 *
 * La mediana e non la media perché la domanda è "di solito": su venti immersioni
 * una risalita sbagliata sposta la media di mezzo metro al minuto e la mediana di
 * niente. La media resta accanto quando c'è, così le due si possono confrontare —
 * quando divergono parecchio, è il segno che c'è un'immersione anomala da aprire.
 */
function MedianTile({
  label,
  points,
  unit,
  digits,
  trend,
  extra,
  missing,
}: {
  label: string;
  points: SeriesPoint[];
  unit: string;
  digits: number;
  trend?: Trend;
  extra?: string;
  missing: string;
}) {
  if (points.length === 0) {
    return (
      <div className="tile">
        <div className="tile-label">{label}</div>
        <div className="tile-value" style={{ color: 'var(--text-muted)' }}>
          —
        </div>
        <div className="tile-note">{missing}</div>
      </div>
    );
  }

  const sorted = [...points].map((p) => p.value).sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  // La direzione la decide il nucleo, che sa già per quali misure "più basso" sia
  // meglio: ricalcolarla qui sarebbe una seconda verità che può contraddire la
  // prima — l'errore che l'audit del pianificatore ha appena punito.
  const better = trend?.direction === 'improving';

  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value tabular">
        {median.toFixed(digits)} <small style={{ fontSize: 13, fontWeight: 500 }}>{unit}</small>
      </div>
      <div className="tile-note">
        {imm(points.length)}
        {extra ? ` · ${extra}` : ''}
      </div>
      {trend && trend.direction !== 'flat' && (
        <div className="row" style={{ gap: 5, marginTop: 4, fontSize: 11 }}>
          <span className={`dot ${better ? 'dot-good' : 'dot-warning'}`} />
          <span className="muted">
            {trend.firstHalf.toFixed(digits)} → {trend.secondHalf.toFixed(digits)} nel periodo
          </span>
        </div>
      )}
    </div>
  );
}

/** "GF 20/85 impostati" — e se sono cambiati nel periodo, lo dice. */
function gfLabel(dives: Dive[]): string | undefined {
  const periods = settingsPeriods(dives);
  if (periods.length === 0) return undefined;
  const last = periods[periods.length - 1].label;
  return periods.length > 1 ? `${last} (cambiati nel periodo)` : `${last} impostati`;
}

/**
 * Dove ti immergi.
 *
 * NON è una mappa: non c'è nessuna cartografia sotto, e va detto invece di
 * lasciarlo capire. È la disposizione reciproca dei siti, proiettata sul
 * rettangolo che li contiene tutti, con il numero di immersioni per bolla. Serve a
 * vedere i gruppi — quanto sei concentrato su pochi posti, e dove sono i viaggi —
 * e a raggiungere un sito con un clic.
 *
 * Una mappa vera richiederebbe una libreria di tessere: la prima dipendenza pesante
 * del progetto, per un valore che su un archivio di sessanta siti è soprattutto
 * estetico. Se un giorno servirà, questo componente è il posto dove sostituirla.
 */
function SitesMap({ dives, onOpen }: { dives: Dive[]; onOpen: (id: string) => void }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  /* Se la bolla era già selezionata PRIMA di questo tocco: vedi il commento
     sul cerchio più sotto. In un ref e non in uno stato perché serve dentro la
     stessa sequenza di eventi, prima che React ridisegni. */
  const eraAttivo = useRef(false);

  const sites = new Map<string, { name: string; lat: number; lon: number; dives: Dive[] }>();
  for (const d of dives) {
    if (d.site?.lat === undefined || d.site?.lon === undefined) continue;
    const key = d.site.name ?? `${d.site.lat},${d.site.lon}`;
    const found = sites.get(key);
    if (found) found.dives.push(d);
    else sites.set(key, { name: d.site.name ?? key, lat: d.site.lat, lon: d.site.lon, dives: [d] });
  }
  const list = [...sites.values()];
  const withCoords = list.length;
  const withoutCoords = new Set(
    dives.filter((d) => d.site?.name && d.site.lat === undefined).map((d) => d.site!.name!),
  ).size;

  if (withCoords < 2) return null;

  const height = 320;
  const pad = 26;
  const lats = list.map((s) => s.lat);
  const lons = list.map((s) => s.lon);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  // Proiezione equirettangolare con la longitudine compressa al coseno della
  // latitudine: senza, a 44 gradi le distanze est-ovest risultano gonfiate del 40%
  // e i gruppi appaiono più larghi di quanto sono.
  const kx = Math.cos((latMid * Math.PI) / 180);
  const xs = lons.map((l) => l * kx);
  const spanX = Math.max(0.0001, Math.max(...xs) - Math.min(...xs));
  const spanY = Math.max(0.0001, Math.max(...lats) - Math.min(...lats));
  const span = Math.max(spanX, spanY);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...lats) + Math.min(...lats)) / 2;
  const size = Math.min(width - pad * 2, height - pad * 2);
  const px = (lon: number) => width / 2 + ((lon * kx - cx) / span) * size;
  const py = (lat: number) => height / 2 - ((lat - cy) / span) * size;
  const maxDives = Math.max(...list.map((s) => s.dives.length));

  return (
    <div className="card">
      <div className="page-title-row" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>Dove ti immergi</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {withCoords} siti con coordinate{withoutCoords ? ` · ${withoutCoords} senza` : ''}
        </span>
      </div>
      <p className="card-sub">
        Non è una mappa: sotto non c'è nessuna cartografia. È la disposizione reciproca dei siti, con la
        grandezza della bolla proporzionale alle immersioni fatte lì. Serve a vedere i gruppi, non a navigare.
      </p>
      <div className="chart" ref={ref}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
          {list.map((site) => {
            const r = 5 + (site.dives.length / maxDives) * 16;
            const active = hover === site.name;
            return (
              <g key={site.name}>
                <circle
                  cx={px(site.lon)}
                  cy={py(site.lat)}
                  r={r}
                  fill="var(--series-1)"
                  opacity={active ? 0.55 : 0.3}
                  stroke="var(--series-1)"
                  strokeWidth={active ? 2 : 1}
                  style={{ cursor: 'pointer' }}
                  /*
                   * COL DITO SERVONO DUE TOCCHI, e non è un capriccio.
                   *
                   * Il nome del sito compariva solo su `onMouseEnter`, che iOS
                   * non manda mai: su un telefono ogni bolla era un cerchio
                   * anonimo tranne quella più frequentata, e toccarla portava
                   * dritti dentro un'immersione senza aver mai letto dove
                   * fosse. Cioè l'unica cosa che la mappa deve dire — quale
                   * sito è quale — sul telefono non si poteva sapere.
                   *
                   * `eraAttivo` registra se la bolla era GIÀ selezionata prima
                   * di questo tocco. Col mouse lo è sempre, perché il puntatore
                   * ci è passato sopra: il primo clic apre, come prima. Col
                   * dito il primo tocco scrive il nome e il secondo apre.
                   */
                  onPointerDown={() => {
                    eraAttivo.current = hover === site.name;
                    setHover(site.name);
                  }}
                  onPointerLeave={(e) => {
                    if (e.pointerType === 'mouse') setHover(null);
                  }}
                  /* Se il tocco si trasforma in uno scorrimento della pagina,
                     l'etichetta non deve restare accesa su una bolla che nessuno
                     ha scelto. */
                  onPointerCancel={() => setHover(null)}
                  onClick={() => {
                    if (eraAttivo.current) onOpen(site.dives[0].id);
                  }}
                />
                {/* L'etichetta solo sulla bolla puntata e sulla più frequentata:
                    i siti vicini fra loro si sovrappongono per davvero, e
                    scriverli tutti produceva un grumo illeggibile. */}
                {(active || site.dives.length === maxDives) && (
                  <text
                    x={px(site.lon)}
                    y={py(site.lat) - r - 5}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={active ? 700 : 550}
                    fill="var(--text-primary)"
                  >
                    {site.name} ({site.dives.length})
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
        Le coordinate arrivano dai file che le contengono: UDDF, Subsurface, il GPS dei Garmin e i log
        Shearwater dalla versione 17 in su. Clicca una bolla per aprire un'immersione fatta lì.
      </p>
    </div>
  );
}
