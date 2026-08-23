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
import { dateShort, imm, int, pct, type Traduci } from '../format';
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
import { Vuoto } from '../components/Vuoto';
import { useLingua } from '../lingua';

type Series = 'rmv' | 'trim' | 'ascent' | 'gf99';

/**
 * Le quattro serie che il grafico dell'andamento sa disegnare.
 *
 * TUTTO IN ITALIANO, e tradotto al disegno con `t()`. È una costante a modulo:
 * nasce una volta sola all'importazione del file, e riscriverla con le stringhe
 * già tradotte vorrebbe dire ricostruirla a ogni render e — peggio — legarla
 * alla lingua attiva nell'istante in cui il modulo è stato caricato. La chiave
 * del dizionario è la frase italiana, quindi quello che sta qui è già la chiave.
 *
 * Le `blurb` sono volutamente corte. Il dettaglio tecnico che c'era prima sta
 * qui sotto in commento, perché serve a chi legge il codice:
 *
 *  - RMV: si mostra in L/min riportati alla superficie e non in bar/min perché
 *    così è confrontabile fra bombole di volume diverso e fra profondità diverse.
 *    Senza il volume della bombola non si può calcolare, e non si stima.
 *  - assetto: sono i metri verticali percorsi al minuto nei soli tratti in cui la
 *    quota è tenuta — discesa e risalita escluse — al netto dello spostamento
 *    voluto in ciascun tratto. È il proxy più diretto del controllo d'assetto.
 *  - risalita: il picco si misura su finestra mobile di 30 secondi e non fra due
 *    campioni adiacenti, altrimenti il rumore del sensore diventa una risalita
 *    rapida.
 *  - GF99: lo calcoliamo noi dal profilo con Bühlmann ZH-L16C tenendo conto
 *    dell'azoto residuo dell'immersione precedente, così c'è su tutte le
 *    immersioni con un profilo e non solo su quelle dei computer che lo scrivono.
 */
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
    blurb: 'Litri al minuto riportati alla superficie. Solo dove il volume della bombola è noto.',
  },
  trim: {
    label: 'Oscillazione a quota tenuta',
    unit: 'm/min',
    reference: 2,
    referenceLabel: 'buon assetto',
    digits: 1,
    blurb: 'Metri verticali al minuto nei tratti in cui tieni la quota. Sotto 2 m/min è tenuta bene.',
  },
  ascent: {
    label: 'Velocità di risalita di picco',
    unit: 'm/min',
    reference: 10,
    referenceLabel: 'limite',
    digits: 0,
    blurb: 'Il picco su finestra di 30 secondi.',
  },
  gf99: {
    label: 'GF99 all’uscita',
    unit: '%',
    reference: 75,
    referenceLabel: 'margine sottile',
    digits: 0,
    blurb: 'Quanto eri sovrasaturo arrivando in superficie. Dipende dai gradient factor che hai impostato.',
  },
};

export function Stats({ onOpen }: { onOpen: (id: string) => void }) {
  const { aggregates: a, dives, scope, gear } = useDiveLog();
  const { t } = useLingua();
  // Tutti i blocchi qui sotto usano le immersioni della FINESTRA, non l'archivio:
  // le aggregate arrivano già filtrate, e i grafici che ricevono le immersioni una
  // per una devono vedere lo stesso insieme, altrimenti la stessa pagina
  // mostrerebbe numeri calcolati su periodi diversi.
  const scoped = scope.dives;
  const [series, setSeries] = useState<Series>('rmv');

  if (dives.length === 0) {
    return (
      <Vuoto
        titolo="Ancora nessun dato da analizzare"
        azione={{ vista: 'import', etichetta: 'Vai a Importa' }}
      >
        {t('Importa le immersioni e le statistiche appaiono qui.')}
      </Vuoto>
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
        <h1 className="page-title">{t('Statistiche')}</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {a.firstDive ? `${t('dal')} ${dateShort(a.firstDive)} · ` : ''}
          {`${a.withProfile}/${a.count} ${t('con profilo')}`}
        </span>
      </div>

      <PeriodPicker />

      {/* Un solo numero guida per la vista. */}
      <div className="card">
        <div className="spread">
          <div style={{ flex: '0 0 auto', minWidth: 200 }}>
            <div className="tile-label">{t('Immersioni nel periodo')}</div>
            <div className="hero">{int(a.count)}</div>
            <div className="tile-note">
              {`${formatHours(a.totalS)} ${t('sott’acqua')} · ${t('media')} ${formatDuration(a.avgDurationS)} · ${a.avgMaxDepth.toFixed(1)} m`}
            </div>
          </div>
          <div className="grid grid-tiles" style={{ flex: '1 1 480px' }}>
            <StatTile
              label={t('Più profonda')}
              value={`${a.maxDepthEver.toFixed(1)} m`}
              note={a.deepest?.site?.name ?? (a.deepest ? dateShort(a.deepest.startTime) : undefined)}
            />
            <StatTile
              label={t('Più lunga')}
              value={a.longest ? formatDuration(a.longest.durationS) : '—'}
              note={a.longest?.site?.name ?? undefined}
            />
            <StatTile
              label={t('Ultimi 12 mesi')}
              value={int(a.divesLast12m)}
              note={`${a.perMonthLast12m}/${t('mese')} · ${a.divesLast90d} ${t('negli ultimi 90 giorni')}`}
            />
            <StatTile
              label={t('Ultima immersione')}
              value={a.daysSinceLastDive !== undefined ? `${a.daysSinceLastDive} ${t('giorni')}` : '—'}
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
          <h2 style={{ margin: 0 }}>{t('Come ti immergi, di solito')}</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            {t('Mediane sul periodo. Ogni tessera dice su quante immersioni si basa.')}
          </span>
        </div>
        <div className="grid grid-tiles">
          <MedianTile
            label={t('Consumo in superficie')}
            points={a.rmv}
            unit="L/min"
            digits={1}
            trend={a.rmvTrend}
            extra={a.avgRmv !== undefined ? `${t('media')} ${a.avgRmv.toFixed(1)}` : undefined}
            missing={t('Serve il volume della bombola e le due pressioni.')}
          />
          <MedianTile
            label={t('Assetto')}
            points={a.trim}
            unit="m/min"
            digits={1}
            trend={a.trimTrend}
            extra={`${a.trim.filter((p) => p.value < LIMITS.goodTrimMpm).length} ${t('sotto')} ${LIMITS.goodTrimMpm} m/min`}
            missing={t('Serve un profilo campionato.')}
          />
          <MedianTile
            label={t('Velocità di risalita')}
            points={a.maxAscentRate}
            unit="m/min"
            digits={1}
            trend={a.ascentTrend}
            extra={
              a.fastAscentRate !== undefined ? `${pct(a.fastAscentRate)} ${t('oltre il limite')}` : undefined
            }
            missing={t('Serve un profilo campionato.')}
          />
          <MedianTile
            label={t('GF99 all’uscita')}
            points={a.gf99}
            unit="%"
            digits={0}
            extra={gfLabel(scoped, t)}
            missing={t('Serve un profilo campionato.')}
          />
        </div>
      </div>

      {a.repetitiveDives > 0 && (
        <div className="card">
          <div className="page-title-row" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>{t('Le ripetitive')}</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              {`${imm(a.repetitiveDives, t)} ${t('cominciate con azoto ancora in circolo')}`}
            </span>
          </div>
          {/* Il costo è un confronto fra due esecuzioni dello STESSO profilo — con
              e senza azoto residuo — non una stima. Nessun computer subacqueo può
              dirlo, perché richiede di guardare due immersioni insieme. */}
          <p className="card-sub">
            {t('Quanto GF99 in più ti sei portato a casa rispetto a fare la stessa immersione da pulito.')}
          </p>
          <div className="grid grid-tiles">
            <StatTile
              label={t('Costo mediano')}
              value={
                <span className="tabular">
                  +{(a.repetitiveCostMedian ?? 0).toFixed(1)}{' '}
                  <small style={{ fontSize: 14 }}>{t('punti')}</small>
                </span>
              }
              note={t('di GF99 all’uscita, rispetto a partire da pulito')}
            />
            <StatTile
              label={t('Caso peggiore')}
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
                        ? ` · ${t('pausa')} ${a.repetitiveCostWorst.surfaceIntervalMin} min`
                        : ''
                    }`
                  : undefined
              }
            />
            <StatTile
              label={t('Pausa mediana')}
              value={
                <span className="tabular">
                  {a.surfaceIntervalMedian ?? '—'} <small style={{ fontSize: 14 }}>min</small>
                </span>
              }
              note={t('fra due immersioni della stessa giornata')}
            />
          </div>
        </div>
      )}

      {a.oxygen.eligible > 0 && (
        <div className="card">
          <div className="page-title-row" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>{t('Esposizione all’ossigeno')}</h2>
            {/* Il valore che scrive il computer è un'altra cosa: modello diverso.
                Non lo diciamo a schermo perché non cambia niente di quello che
                l'utente deve fare. */}
            <span className="muted" style={{ fontSize: 12 }}>
              {`${imm(a.oxygen.eligible, t)} · ${t('calcolata sul profilo con le tabelle NOAA')}`}
            </span>
          </div>
          <div className="grid grid-tiles">
            <StatTile
              label={t('Giornata peggiore, CNS')}
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
                  ? `${dateShort(a.oxygen.worstCnsDay.date)} · ${imm(a.oxygen.worstCnsDay.dives, t)} · ${t('limite')} 100%`
                  : undefined
              }
            />
            <StatTile
              label={t('Giornata peggiore, OTU')}
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
              note={`${OTU_DAILY_MAX} ${t('il massimo in un giorno')} · ${OTU_DAILY_TDI} ${t('se ti immergi più giorni di fila')}`}
            />
            <StatTile
              label={t('Giorni sopra 300 OTU')}
              value={<span className="tabular">{a.oxygen.daysOverOtu300}</span>}
              note={`${a.oxygen.days.length} ${t('giornate di immersione nel periodo')}`}
            />
            <StatTile
              label={t('Velocità sull’ultimo tratto')}
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
                    `${t('mediana dalla sosta alla superficie')} · ${a.finalAscentsOverAppLimit} > ${LIMITS.ascentRateShallowMpm} m/min`
                  : t('serve un profilo campionato')
              }
            />
          </div>

          {a.oxygen.days.length > 1 && (
            <div style={{ marginTop: 16 }}>
              <div className="mini-title">
                <span>{t('OTU per giornata di immersione')}</span>
                <span className="mini-last">
                  {`${a.oxygen.days[a.oxygen.days.length - 1].otu} ${t('l’ultima')}`}
                </span>
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

          {/* Perché CNS e OTU stanno insieme: il CNS della giornata tiene conto del
              dimezzamento ogni 90 minuti in superficie — la somma nuda
              sovrastimerebbe, l'ultimo valore sottostimerebbe — mentre le OTU non
              recuperano, né in giornata né fra un giorno e l'altro. Il tratto
              finale è misurato punto a punto e non su finestra mobile: dura pochi
              secondi, ed è esattamente il motivo per cui di solito non si vede. */}
          <p className="muted" style={{ fontSize: 11, marginTop: 12, marginBottom: 0 }}>
            {t('Il CNS si dimezza ogni 90 minuti in superficie; le OTU non recuperano mai.')}
          </p>
        </div>
      )}

      <SitesMap dives={scoped} onOpen={onOpen} />

      <div className="card">
        <h2>{t('Attività mese per mese')}</h2>
        {/* I mesi vuoti restano nel grafico: la stagionalità e le pause sono parte
            dell'informazione, e comprimerli farebbe sembrare continuo un anno in
            cui ci si è immersi due volte. */}
        <p className="card-sub">{t('Ultimi 24 mesi. I mesi vuoti restano visibili.')}</p>
        <ColumnChart data={a.byMonth} unit={t('immersioni')} height={170} />
      </div>

      <div className="card">
        <div className="filters" style={{ marginBottom: 12 }}>
          <label>
            {t('Andamento di')}
            <select value={series} onChange={(e) => setSeries(e.target.value as Series)}>
              <option value="rmv">{t('consumo di superficie')}</option>
              <option value="trim">{t('assetto')}</option>
              <option value="ascent">{t('velocità di risalita')}</option>
              {a.gf99.length > 0 && <option value="gf99">{t('GF99 all’uscita')}</option>}
            </select>
          </label>
          {trend && (
            <span className="badge">
              <span
                className={`dot ${trend.direction === 'improving' ? 'dot-good' : trend.direction === 'worsening' ? 'dot-warning' : 'dot-serious'}`}
              />
              {trend.direction === 'improving'
                ? t('in miglioramento')
                : trend.direction === 'worsening'
                  ? t('in peggioramento')
                  : t('stabile')}
              : {trend.firstHalf.toFixed(meta.digits)} → {trend.secondHalf.toFixed(meta.digits)} {meta.unit}
            </span>
          )}
        </div>
        <h2>{t(meta.label)}</h2>
        <p className="card-sub">
          {t(meta.blurb)} {`${points.length}/${a.count} ${t('immersioni')}.`}
        </p>
        <TimeSeriesChart
          points={points}
          unit={meta.unit}
          reference={meta.reference}
          referenceLabel={t(meta.referenceLabel)}
          format={(v) => v.toFixed(meta.digits)}
          onPick={onOpen}
        />
        {points.length > 0 && (
          <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
            {t('Clicca un punto per aprire l’immersione.')}
          </p>
        )}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>{t('Fasce di profondità')}</h2>
          <p className="card-sub">{t('Dove passi il tempo.')}</p>
          <BarChart data={a.byDepthBand} unit={t('immersioni')} />
        </div>
        <div className="card">
          <h2>{t('Siti più frequentati')}</h2>
          <p className="card-sub">{t('Per numero di immersioni.')}</p>
          <BarChart
            data={a.topSites.map((s) => ({ key: s.name, label: s.name, value: s.dives }))}
            unit={t('immersioni')}
          />
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>{t('Disciplina')}</h2>
          <p className="card-sub">
            {t(
              'Percentuali calcolate solo dove la verifica è possibile: il denominatore è accanto a ogni riga.',
            )}
          </p>
          <table>
            <tbody>
              <DisciplineRow
                label="Sosta di sicurezza completata"
                value={pct(a.safetyStopRate)}
                basis={`${imm(a.safetyStopEligible, t)} ${t('in curva sopra i 10 m')}`}
                eligible={a.safetyStopEligible}
                good={(a.safetyStopRate ?? 0) >= 0.9}
              />
              <DisciplineRow
                label="Immersioni con risalite fuori limite"
                value={pct(a.fastAscentRate)}
                basis={`${imm(a.withProfile, t)} ${t('con profilo')}`}
                eligible={a.withProfile}
                good={(a.fastAscentRate ?? 1) <= 0.1}
              />
              <DisciplineRow
                label="Uscite sotto i 50 bar"
                value={pct(a.lowReserveRate)}
                basis={`${imm(a.lowReserveEligible, t)} ${t('con pressione finale')}`}
                eligible={a.lowReserveEligible}
                good={(a.lowReserveRate ?? 1) <= 0.05}
              />
              <DisciplineRow
                label="Violazioni del tetto deco"
                value={int(a.ceilingViolations)}
                // Solo le immersioni il cui profilo porta il canale del tetto:
                // le altre non sono "senza violazioni", sono non verificabili.
                basis={`${imm(a.ceilingEligible, t)} ${t('con il tetto registrato')}`}
                eligible={a.ceilingEligible}
                good={a.ceilingViolations === 0}
              />
              <DisciplineRow
                label="Parte profonda per prima"
                value={pct(a.deepestFirstEligible ? a.deepestFirstDives / a.deepestFirstEligible : undefined)}
                basis={`${imm(a.deepestFirstEligible, t)} ${t('con profilo')}`}
                eligible={a.deepestFirstEligible}
                good={a.deepestFirstDives >= a.deepestFirstEligible * 0.8}
              />
              <DisciplineRow
                label="Con una sosta profonda"
                value={pct(a.deepStopEligible ? a.deepStopDives / a.deepStopEligible : undefined)}
                basis={`${imm(a.deepStopEligible, t)} ${t('oltre i 20 m')}`}
                eligible={a.deepStopEligible}
                // Non è un pass/fail: la regola pratica è del 2013 e la
                // letteratura successiva sulle soste profonde è discussa.
                good={undefined}
              />
              {a.badGasSwitches > 0 && (
                <DisciplineRow
                  label="Cambi di gas sotto la MOD"
                  value={int(a.badGasSwitches)}
                  basis={t('profili con più di una bombola')}
                  good={false}
                />
              )}
              {a.avgGf99 !== undefined && (
                <DisciplineRow
                  label="GF99 medio all’uscita"
                  value={`${a.avgGf99.toFixed(0)}%`}
                  // Lo scarto dal valore del computer si mostra solo dove esiste:
                  // sono due modelli diversi, e dire di quanto distano è l'unico
                  // modo onesto di presentare un numero calcolato da noi.
                  basis={
                    a.gf99Agreement !== undefined
                      ? `${imm(a.gf99.length, t)} · ${t('scarto dal computer')} ${a.gf99Agreement.toFixed(1)} ${t('punti')}`
                      : `${imm(a.gf99.length, t)} · ${t('calcolato dal profilo')}`
                  }
                  good={a.avgGf99 <= 65}
                />
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>{t('Composizione dell’archivio')}</h2>
          <p className="card-sub">{t('Configurazione, miscele, esposizione.')}</p>
          <table>
            <tbody>
              <tr>
                <td className="muted">{t('Oltre i 30 m')}</td>
                <td className="num tabular">{int(a.deepDives30)}</td>
              </tr>
              <tr>
                <td className="muted">{t('Oltre i 40 m')}</td>
                <td className="num tabular">{int(a.deepDives40)}</td>
              </tr>
              <tr>
                <td className="muted">{t('Con obbligo decompressivo')}</td>
                <td className="num tabular">{int(a.decoDives)}</td>
              </tr>
              <tr>
                <td className="muted">{t('In rebreather')}</td>
                <td className="num tabular">{int(a.ccrDives)}</td>
              </tr>
              <tr>
                <td className="muted">{t('Sotto i 14 °C')}</td>
                <td className="num tabular">{int(a.coldDives)}</td>
              </tr>
              {/* Le miscele arrivano dai dati — «Aria», «EAN32» — e non sono frasi
                  da tradurre: sono nomi. */}
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
        <h2>{t('Immersioni per anno')}</h2>
        <ColumnChart
          data={[...a.byYear].sort((x, y) => x.key.localeCompare(y.key))}
          unit={t('immersioni')}
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
        title={t('Analisi dell’archivio con Claude')}
        description={t(
          'Legge le immersioni una per una, non solo le medie: cambi nel tempo, indicatori che si muovono insieme, immersioni fuori scala.',
        )}
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
  /** In italiano: è la chiave del dizionario, tradotta qui sotto al disegno. */
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
  const { t } = useLingua();
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
          <span>{t(label)}</span>
        </div>
        <div className="muted" style={{ fontSize: 11, marginLeft: 15 }}>
          {measurable ? `${t('su')} ${basis}` : `${t('nessuna immersione verificabile')}: ${basis}`}
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
  const { t } = useLingua();
  /*
   * Titoli, spiegazioni e nomi degli assi restano in italiano: sono le chiavi
   * del dizionario, e passano da `t()` solo dove vengono disegnati. Le chiavi di
   * React restano quelle italiane, così cambiare lingua non rimonta i grafici.
   */
  const sets = [
    {
      title: 'Consumo e profondità media',
      hint: 'Se il consumo cresce con la profondità, di solito è affaticamento o assetto.',
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
      hint: 'Il freddo alza il consumo: qui vedi di quanto.',
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
      hint: 'Muoversi in verticale costa gas: se salgono insieme, lavora sull’assetto.',
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
      hint: 'Troppa zavorra è la prima causa di assetto instabile.',
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
      <h2>{t('Cosa dipende da cosa')}</h2>
      <p className="card-sub">
        {t(
          'Ogni punto è un’immersione: cliccala per aprirla. La retta è la tendenza, r è la correlazione — 0 nessuna, ±1 perfetta. È una correlazione, non una causa.',
        )}
      </p>
      <div className="grid grid-2">
        {sets.map((s) => {
          const r = correlation(s.points);
          return (
            <div key={s.title}>
              <div className="mini-title">
                <span>{t(s.title)}</span>
                <span className="mini-last tabular">
                  {r === undefined ? '—' : `r ${r > 0 ? '+' : ''}${r.toFixed(2)}`}
                </span>
              </div>
              <ScatterChart
                points={s.points}
                xLabel={t(s.xLabel)}
                yLabel={t(s.yLabel)}
                onPick={onOpen}
                height={210}
              />
              <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
                {t(s.hint)} {`${t('su')} ${imm(s.points.length, t)}.`}
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
  const { t } = useLingua();
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

  /*
   * `id` è la chiave di React e resta un codice: il titolo ora dipende dalla
   * lingua, e usarlo come chiave farebbe smontare e rimontare i tre grafici a
   * ogni cambio di lingua.
   */
  const blocks = [
    {
      id: 'ascent',
      title: `${t('Velocità di risalita massima (m/min)')} — ${t('limite')} ${LIMITS.ascentRateDeepMpm}`,
      bins: ascent,
      note: t('Il valore massimo di ciascuna immersione, su finestra di 30 s.'),
    },
    {
      id: 'rmv',
      title: t('Consumo di superficie (L/min)'),
      bins: rmv,
      note: t('Solo dove volume e pressioni sono noti.'),
    },
    {
      id: 'reserve',
      title: `${t('Pressione all’uscita (bar)')} — ${t('riserva')} ${LIMITS.minReserveBar}`,
      bins: reserve,
      note: t('Le prime due colonne sono le uscite sotto la riserva.'),
    },
  ].filter((b) => b.bins.some((x) => x.count > 0));

  if (!blocks.length) return null;

  return (
    <div className="card">
      <h2>{t('Distribuzioni')}</h2>
      <p className="card-sub">
        {t('Quante immersioni per intervallo. Le code sono i casi che una media nasconde.')}
      </p>
      <div className="grid grid-3">
        {blocks.map((b) => (
          <div key={b.id}>
            <div className="mini-title">
              <span>{b.title}</span>
            </div>
            <ColumnChart
              data={b.bins.map((x) => ({ key: x.label, label: x.label, value: x.count }))}
              unit={t('immersioni')}
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
 * frase che impedisce di leggere una correlazione come una causa. Arrivano in
 * italiano, che è la chiave del dizionario, e passano da `t()` al disegno.
 */
function Attrezzatura({ dives, inventario }: { dives: Dive[]; inventario: Equipment[] }) {
  const { t } = useLingua();
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
        <h2>{t('Attrezzatura')}</h2>
        <p className="card-sub" style={{ marginBottom: 0 }}>
          {`${imm(conMuta, t)} ${t('con l’attrezzatura registrata: troppo poche per un confronto. Compila muta, zavorra ed erogatori nella scheda dell’immersione.')}`}
        </p>
      </div>
    );
  }

  const salLabel = (s: RigaZavorra['salinity']) =>
    s === 'salt' ? t('salata') : s === 'fresh' ? t('dolce') : t('non indicata');

  return (
    <div className="card">
      <h2>{t('Attrezzatura')}</h2>
      {/* Nessuna di queste tabelle dice «meglio». Accanto a ogni riga stanno la
          profondità mediana e il numero di immersioni su cui è calcolata: sono i
          due numeri con cui si smonta una correlazione finta, e per questo non
          si tolgono. */}
      <p className="card-sub">
        {t(
          'Quello che porti addosso incrociato con quello che il profilo misura. Un gruppo entra in tabella da tre immersioni in su.',
        )}
      </p>

      {mute.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="finding-section-label">{t('Muta, temperatura e stagione')}</div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Muta')}</th>
                  <th className="num">{t('Immersioni')}</th>
                  <th className="num">{t('T mediana')}</th>
                  <th className="num">{t('La più fredda')}</th>
                  <th className="num">{t('La più calda')}</th>
                  <th className="num">{t('Stagione')}</th>
                  <th className="num">{t('Prof. mediana')}</th>
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
                          {r.medianTempC}{' '}
                          <small className="muted">
                            °C · {t('su')} {r.tempBasis}
                          </small>
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
          {/* Non è un errore: è un promemoria di quando hai fatto un'eccezione.
              A schermo non serve dirlo — la riga non ha nessun pallino di
              giudizio, e la parola «eccezione» basta. */}
          {fuori.length > 0 && (
            <p className="planner-hint" style={{ marginTop: 8 }}>
              {`${imm(fuori.length, t)} ${t('in cui eri vestito diversamente dal solito per quella temperatura')}: `}
              {fuori
                .slice(0, 4)
                .map(
                  (f) =>
                    `${dateShort(f.dive.startTime, f.dive.utcOffsetMinutes)} · ${f.tempC} °C · ${f.suit} → ${t('di solito')} ${f.solita} (${t('su')} ${f.base})`,
                )
                .join(' · ')}
              {fuori.length > 4 ? ` · +${fuori.length - 4}` : ''}
            </p>
          )}
        </div>
      )}

      {zavorra.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="finding-section-label">{t('Zavorra, per muta e per tipo d’acqua')}</div>
          {/* Dolce e salata restano separate perché fra le due ci sono due o tre
              chili: una mediana che le mescola non è giusta in nessuna delle due
              situazioni. */}
          <p className="planner-hint" style={{ marginTop: 0 }}>
            {t('Dolce e salata sono contate a parte. I chili sono il totale, piastra compresa.')}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Muta')}</th>
                  <th>{t('Acqua')}</th>
                  <th className="num">{t('Zavorra mediana')}</th>
                  <th className="num">{t('Intervallo')}</th>
                  <th className="num">{t('Assetto')}</th>
                  <th className="num">{t('Bombola')}</th>
                  <th className="num">{t('Immersioni')}</th>
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
                          <small className="muted">
                            {t('con piastra su')} {r.withBackplate}
                          </small>
                        </>
                      )}
                    </td>
                    <td className="num tabular muted">
                      {r.minKg === r.maxKg ? t('sempre uguale') : `${r.minKg}–${r.maxKg} kg`}
                    </td>
                    <td className="num tabular">
                      {r.medianTrimMpm !== undefined ? (
                        <>
                          {r.medianTrimMpm}{' '}
                          <small className="muted">
                            m/min · {t('su')} {r.trimBasis}
                          </small>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num muted">
                      {r.bombolaPiuUsata ? (
                        <>
                          {r.bombolaPiuUsata}{' '}
                          <small className="muted">
                            · {t('su')} {r.bombolaBase}
                          </small>
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

      {consumo.map((tab) => (
        <div key={tab.titolo} style={{ marginBottom: 18 }}>
          <div className="finding-section-label">
            {`${t('Consumo per')} ${t(tab.titolo).toLowerCase()} — ${tab.conIlDato}/${dives.length} ${t('con il dato')}`}
          </div>
          <p className="planner-hint" style={{ marginTop: 0 }}>
            {t(tab.cautela)}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t(tab.titolo)}</th>
                  <th className="num">{t('Immersioni')}</th>
                  <th className="num">{t('Consumo')}</th>
                  <th className="num">{t('Prof. mediana')}</th>
                  {/* MEDIANA delle minime, non la più bassa: la tabella qui
                      sopra chiama «La più fredda» un vero minimo, e sulla stessa
                      muta le due dicevano 21 e 11 °C. */}
                  <th className="num">{t('T mediana')}</th>
                  <th className="num">{t('Durata')}</th>
                </tr>
              </thead>
              <tbody>
                {tab.righe.map((r) => (
                  <tr key={r.etichetta}>
                    <td style={{ fontWeight: 550 }}>{r.etichetta}</td>
                    <td className="num tabular">{r.dives}</td>
                    <td className="num tabular">
                      {r.medianRmvLpm !== undefined ? (
                        <>
                          {r.medianRmvLpm}{' '}
                          <small className="muted">
                            L/min · {t('su')} {r.rmvBasis}
                          </small>
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
  const { t } = useLingua();
  const mare = useMemo(() => perStatoDelMare(dives), [dives]);
  const visibilita = useMemo(() => perVisibilita(dives), [dives]);
  const meteo = useMemo(() => perMeteo(dives), [dives]);
  const quante = useMemo(() => quanteConCondizioni(dives), [dives]);

  // I titoli restano in italiano — sono le chiavi del dizionario e le chiavi di
  // React — e passano da `t()` al disegno.
  const tabelle = [
    { titolo: 'Stato del mare', righe: mare, con: quante.mare },
    { titolo: 'Visibilità', righe: visibilita, con: quante.visibilita },
    { titolo: 'Meteo', righe: meteo, con: quante.meteo },
  ].filter((tab) => tab.righe.length >= 2);

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
        <h2>{t('Condizioni')}</h2>
        <p className="card-sub" style={{ marginBottom: 0 }}>
          {t(
            'Le condizioni sono registrate su poche immersioni: con un gruppo solo non c’è niente da confrontare. Compila mare, visibilità e meteo nella scheda dell’immersione.',
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>{t('Quanto contano le condizioni')}</h2>
      <p className="card-sub">
        {t(
          'Le tue mediane divise per mare, visibilità e meteo. Accanto al consumo trovi profondità e temperatura dello stesso gruppo: se salgono insieme, non sono state le onde. Solo i gruppi da tre immersioni in su.',
        )}
      </p>
      {tabelle.map((tab) => (
        <div key={tab.titolo} style={{ marginBottom: 18 }}>
          <div className="finding-section-label">
            {`${t(tab.titolo)} — ${tab.righe.reduce((n, r) => n + r.dives, 0)} ${t('in tabella')} · ${tab.con} ${t('con il dato')} · ${dives.length} ${t('nel periodo')}`}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t(tab.titolo)}</th>
                  <th className="num">{t('Immersioni')}</th>
                  <th className="num">{t('Consumo')}</th>
                  <th className="num">{t('Assetto')}</th>
                  <th className="num">{t('Prof. mediana')}</th>
                  <th className="num">{t('Durata')}</th>
                  <th className="num">{t('T minima')}</th>
                </tr>
              </thead>
              <tbody>
                {tab.righe.map((r) => (
                  <tr key={r.chiave}>
                    {/* Le etichette dei gruppi — «mare mosso», «da 3 a 5 m» —
                        arrivano dalle costanti di `core/conditions.ts`, in
                        italiano: sono chiavi del dizionario come le altre. */}
                    <td>{t(r.etichetta)}</td>
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
                          {r.medianRmvLpm}{' '}
                          <small className="muted">
                            L/min · {t('su')} {r.rmvBasis}
                          </small>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num tabular">
                      {r.medianTrimMpm !== undefined ? (
                        <>
                          {r.medianTrimMpm}{' '}
                          <small className="muted">
                            m/min · {t('su')} {r.trimBasis}
                          </small>
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
                          {r.medianTempC}{' '}
                          <small className="muted">
                            °C · {t('su')} {r.tempBasis}
                          </small>
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
      {/* Le condizioni non arrivano da sole: col mare agitato si esce dai posti
          riparati, e quindi cambiano anche il sito, la profondità e la
          temperatura. La tabella dice che una differenza c'è, non da dove viene. */}
      <p className="muted" style={{ fontSize: 11, margin: 0 }}>
        {t(
          'Nessuna di queste righe dice una causa: col mare agitato cambiano anche sito, profondità e temperatura.',
        )}
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
  const { t } = useLingua();
  const periods = settingsPeriods(dives);
  if (periods.length < 2) return null;
  return (
    <div className="card">
      <h2>{t('Impostazioni del computer nel tempo')}</h2>
      <p className="card-sub">
        {t('Il GF99 all’uscita dipende da queste impostazioni: tienine conto quando confronti due periodi.')}
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
              <th>{t('Impostazione')}</th>
              <th>{t('Dal')}</th>
              <th>{t('Al')}</th>
              <th className="num">{t('Immersioni')}</th>
              <th className="num">{t('GF99 medio all’uscita')}</th>
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
  const { t } = useLingua();
  const months = tempByMonth(dives).filter((m) => m.value > 0);
  if (months.length < 3) return null;
  return (
    <div className="card">
      <h2>{t('Temperatura per mese')}</h2>
      <p className="card-sub">
        {t('Temperatura minima media per mese: dice quando serve la muta più pesante.')}
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
 *
 * `label`, `extra` e `missing` arrivano GIÀ tradotti da chi chiama: `extra` è
 * composto con dei numeri, quindi la traduzione andava fatta lì comunque, e
 * tenerla tutta dalla stessa parte evita di doversi chiedere ogni volta chi
 * traduce cosa.
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
  const { t } = useLingua();
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
        {imm(points.length, t)}
        {extra ? ` · ${extra}` : ''}
      </div>
      {trend && trend.direction !== 'flat' && (
        <div className="row" style={{ gap: 5, marginTop: 4, fontSize: 11 }}>
          <span className={`dot ${better ? 'dot-good' : 'dot-warning'}`} />
          <span className="muted">
            {trend.firstHalf.toFixed(digits)} → {trend.secondHalf.toFixed(digits)} {t('nel periodo')}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * "GF 20/85 impostati" — e se sono cambiati nel periodo, lo dice.
 *
 * Sta fuori dai componenti, quindi la traduzione arriva come parametro: è la
 * stessa convenzione di `src/ui/format.ts`.
 */
function gfLabel(dives: Dive[], t: Traduci): string | undefined {
  const periods = settingsPeriods(dives);
  if (periods.length === 0) return undefined;
  const last = periods[periods.length - 1].label;
  return periods.length > 1 ? `${last} (${t('cambiati nel periodo')})` : `${last} ${t('impostati')}`;
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
  const { t } = useLingua();
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
        <h2 style={{ margin: 0 }}>{t('Dove ti immergi')}</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {`${withCoords} ${t('siti con coordinate')}`}
          {withoutCoords ? ` · ${withoutCoords} ${t('senza')}` : ''}
        </span>
      </div>
      <p className="card-sub">
        {t(
          'Non è una mappa: sotto non c’è cartografia. È la disposizione dei siti, con la bolla grande quanto le immersioni fatte lì.',
        )}
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
      {/* Le coordinate arrivano solo dai formati che le contengono: UDDF,
          Subsurface, il GPS dei Garmin e i log Shearwater dalla versione 17 in
          su. Chi non le vede non ha sbagliato niente, gli manca il formato — ma
          a schermo quell'elenco non aiuta nessuno a fare qualcosa. */}
      <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
        {t('Clicca una bolla per aprire un’immersione fatta lì.')}
      </p>
    </div>
  );
}
