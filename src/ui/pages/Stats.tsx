import { useId, useMemo, useState, useRef } from 'react';
import { CartaApribile } from '../components/CartaApribile';
import { formatDuration, formatHours } from '../../core/units';
import {
  AnnuncioCursore,
  BarChart,
  ColumnChart,
  ScatterChart,
  StatTile,
  TimeSeriesChart,
  contornoFuoco,
  useCursoreDiScelta,
  useWidth,
} from '../components/Charts';
import { useDiveLog } from '../state';
import { PeriodPicker } from '../components/PeriodPicker';
import { dateShort, etichettaMese, etichettaSecchio, imm, int, pct, type Traduci } from '../format';
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
import { BENCHMARK, gf99ConMargine, percentuale } from '../../core/analysis/coaching';
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
import { temperaturaMinimaC } from '../../core/temperatura';
import { profonditaMedia } from '../../core/profondita';
// `frase()` e non un letterale interpolato: la chiave del dizionario è la frase
// intera, e una chiave che contiene un numero non ci sarà mai.
import { frase } from '../../core/frase';

type Series = 'rmv' | 'trim' | 'ascent' | 'gf99';

/**
 * La velocità oltre la quale l'ultimo tratto viene contato, tolleranza compresa.
 *
 * È la soglia vera di `finalAscentsOverAppLimit` in `aggregate.ts`, e va scritta
 * qui una volta sola perché la tessera non possa stampare un numero diverso da
 * quello con cui conta. Il perché della tolleranza sta su `finalAscentToleranceMpm`.
 */
const SOPRA_IL_LIMITE_FINALE = LIMITS.ascentRateShallowMpm + LIMITS.finalAscentToleranceMpm;

/**
 * La percentuale come la scrive il piano di miglioramento.
 *
 * `pct()` arrotonda sempre all'intero, e su una uscita sotto riserva ogni 250
 * immersioni stampava «0%»: lo zero è il valore più rassicurante che un numero
 * possa avere, e qui compariva proprio dove un caso c'era. `percentuale()` sta
 * in `coaching.ts` perché le due schermate scrivano la stessa cifra e decidano
 * su quella.
 */
const pctPiano = (v: number | undefined) => (v === undefined ? '—' : `${percentuale(v)}%`);

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
 *  - consumo di superficie (SCR per TDI; il campo si chiama `rmvLpm` per
 *    ragioni di compatibilità, vedi `model.ts`): si mostra in L/min riportati
 *    alla superficie e non in bar/min perché
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
    label: 'Oscillazione in quota',
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
    /*
     * «Il picco su finestra di 30 secondi» era tornato qui dopo essere già
     * stato tolto ad agosto. La finestra di 30 s è come il numero viene
     * calcolato, non che cosa significa: chi legge vuole sapere se sta salendo
     * troppo in fretta, e la media di tutta la risalita glielo nasconderebbe
     * dietro i tratti lenti. Il come sta nel codice che lo calcola.
     */
    blurb: 'Il momento più veloce della risalita, non la media.',
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
              {a.count > 0
                ? `${formatHours(a.totalS)} ${t('sott’acqua')} · ${t('media')} ${formatDuration(a.avgDurationS)} · ${a.avgMaxDepth.toFixed(1)} m`
                : t('nessuna immersione nel periodo scelto')}
            </div>
          </div>
          <div className="grid grid-tiles" style={{ flex: '1 1 480px' }}>
            {/*
              ► UNA FINESTRA VUOTA NON HA UNA PROFONDITÀ MASSIMA DI ZERO. ◄ La
              pagina usciva presto solo su `dives.length === 0`, non su
              `scope.dives.length === 0`: con un archivio pieno ma tutto fuori
              periodo, `aggregate([])` dava `maxDepthEver: 0` e la tessera
              scriveva «0.0 m» accanto a «Più lunga —». La stessa assenza,
              raccontata in due modi, e uno dei due era un numero.
            */}
            <StatTile
              label={t('Più profonda')}
              value={a.count > 0 ? `${a.maxDepthEver.toFixed(1)} m` : '—'}
              note={a.deepest?.site?.name ?? (a.deepest ? dateShort(a.deepest.startTime) : undefined)}
            />
            <StatTile
              label={t('Più lunga')}
              value={a.longest ? formatDuration(a.longest.durationS) : '—'}
              note={a.longest?.site?.name ?? undefined}
            />
            {/*
              ► LA TESSERA NOMINAVA UN PERIODO E NE MOSTRAVA UN ALTRO. ◄
              `aggregates` è calcolato su `scope.dives`, cioè sulla finestra già
              scelta: con «Ultimi 6 mesi» la tessera intitolata *Ultimi 12 mesi*
              mostrava un conteggio su sei. Adesso il titolo dice la finestra
              vera, come fa già il piano di miglioramento.
            */}
            <StatTile
              label={a.spanMonths >= 11.5 ? t('Ultimi 12 mesi') : t('Nel periodo scelto')}
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
      <CartaApribile
        chiave="stat-come-ti-immergi-di-solit"
        titolo={t('Come ti immergi, di solito')}
        /* Delle quattro mediane, il consumo è l'unica su cui si lavora e l'unica
           confrontabile con un obiettivo. Manca spesso — serve il volume della
           bombola — e allora si dice PERCHÉ manca, invece di scrivere «0.0». */
        sommario={
          a.rmv.length
            ? `${medianOf(a.rmv.map((punto) => punto.value))!.toFixed(1)} L/min`
            : t('serve un profilo campionato')
        }
      >
        <div className="page-title-row" style={{ marginBottom: 12 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {t('Mediane sul periodo. Ogni tessera dice su quante immersioni si basa.')}
          </span>
        </div>
        <div className="grid grid-tiles">
          <MedianTile
            label={t('Consumo di superficie')}
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
      </CartaApribile>

      {a.repetitiveDives > 0 && (
        <CartaApribile
          chiave="stat-le-ripetitive"
          /* «Le ripetitive» nominava un insieme; questa carta parla di quanto
             COSTANO, che è l'unica cosa che un logbook sa dire e un computer no. */
          titolo={t('Quanto ti costano le ripetitive')}
          sommario={
            a.repetitiveCostMedian !== undefined
              ? frase(t, '{0} ripetitive, +{1} GF99', a.repetitiveDives, a.repetitiveCostMedian.toFixed(1))
              : imm(a.repetitiveDives, t)
          }
        >
          <div className="page-title-row" style={{ marginBottom: 12 }}>
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
        </CartaApribile>
      )}

      {a.oxygen.eligible > 0 && (
        <CartaApribile
          chiave="stat-esposizione-all-ossigeno"
          titolo={t('Esposizione all’ossigeno')}
          /* La giornata PEGGIORE, non la media: il limite è 100%, e una media
             tranquilla su una giornata fuori scala è il modo più elegante di non
             dire niente. Stessa forma del sommario del pianificatore, di
             proposito: le due pagine devono dire l'ossigeno allo stesso modo.
             Il doppio controllo evita «CNS 0% · OTU 0» quando il dato manca. */
          sommario={
            a.oxygen.worstCnsDay && a.oxygen.worstOtuDay
              ? `CNS ${a.oxygen.worstCnsDay.peakCnsPercent}% · OTU ${a.oxygen.worstOtuDay.otu}`
              : imm(a.oxygen.eligible, t)
          }
        >
          <div className="page-title-row" style={{ marginBottom: 12 }}>
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
              label={t('Giornata peggiore, ossigeno sui polmoni (OTU)')}
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
                  ? /*
                     * Contro il limite dell'app, non contro i 60 m/min che DAN
                     * MISURA come media dei subacquei: quella soglia non scatta
                     * quasi mai — ed è giusto così, perché superarla vuol dire
                     * andare più veloce di una popolazione che già va troppo
                     * veloce — ma una nota che dice sempre «0» si smette di
                     * leggere. Vedi `danFinalAscentMpm`.
                     *
                     * ► E IL NUMERO STAMPATO DEV'ESSERE QUELLO DEL CONTO. ◄
                     * `finalAscentsOverAppLimit` conta sopra
                     * `ascentRateShallowMpm + finalAscentToleranceMpm`, cioè
                     * **6,5**, e qui si scriveva «> 6 m/min». Con otto
                     * immersioni tutte a 6,3 m/min sull'ultimo tratto la
                     * tessera diceva «**0 > 6 m/min**», falso otto volte su
                     * otto. È lo stesso difetto che `ruleFinalAscent` in
                     * `coaching.ts` aveva già chiuso dalla sua parte, con la
                     * stessa cura: stampare la soglia vera, tolleranza compresa.
                     */
                    `${t('mediana dalla sosta alla superficie')} · ${a.finalAscentsOverAppLimit} > ${SOPRA_IL_LIMITE_FINALE} m/min`
                  : t('serve un profilo campionato')
              }
            />
          </div>

          {a.oxygen.days.length > 1 && (
            <div style={{ marginTop: 16 }}>
              <div className="mini-title">
                <span>{t('OTU per giornata di immersione')}</span>
                <span className="mini-last">
                  {`${a.oxygen.days[a.oxygen.days.length - 1]!.otu} ${t('l’ultima')}`}
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
          <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
            {t('Il CNS si dimezza ogni 90 minuti in superficie; le OTU non recuperano mai.')}
          </p>
        </CartaApribile>
      )}

      <SitesMap dives={scoped} onOpen={onOpen} />

      <CartaApribile
        chiave="stat-attivit-mese-per-mese"
        titolo={t('Attività mese per mese')}
        /* Quanti mesi sono PIENI, non quante immersioni: la carta esiste per far
           vedere stagionalità e pause. `a.byMonth` ha sempre i suoi secchi anche
           con la finestra vuota, quindi senza il controllo su `a.count` si
           leggerebbe «0 mesi su 24» — un numero giusto per una domanda che
           nessuno ha fatto. */
        sommario={
          a.count > 0
            ? frase(
                t,
                '{0} mesi su {1} con immersioni',
                a.byMonth.filter((b) => b.value > 0).length,
                a.byMonth.length,
              )
            : t('nessuna immersione nel periodo scelto')
        }
      >
        {/* I mesi vuoti restano nel grafico: la stagionalità e le pause sono parte
            dell'informazione, e comprimerli farebbe sembrare continuo un anno in
            cui ci si è immersi due volte. */}
        <p className="card-sub">{t('Ultimi 24 mesi. I mesi vuoti restano visibili.')}</p>
        {/* Le etichette dei mesi passano dal dizionario: vedi `etichettaMese`. */}
        <ColumnChart
          data={a.byMonth.map((b) => ({ ...b, label: etichettaMese(b.label, t) }))}
          unit={t('immersioni')}
          height={170}
        />
      </CartaApribile>

      <div className="card">
        <div className="filters" style={{ marginBottom: 12 }}>
          <label>
            {/*
              Lo `<span>` non è decorativo: sul telefono `.filters label > span`
              gli dà una larghezza fissa e il menu prende il resto, così i tre
              bordi cadono sulla stessa verticale. Un nodo di testo nudo non si
              può dimensionare, e senza di lui a 320 px questa riga sforava di
              undici pixel — misurato il 15 settembre 2026. La regola c'era da
              mesi; era il markup che non la incontrava.
            */}
            <span>{t('Andamento di')}</span>
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
          /*
           * ► IL CAMPO SI CHIAMAVA `diveId` DA UNA PARTE E `id` DALL'ALTRA, E
           * NESSUNO DEI DUE LO SAPEVA. ◄
           *
           * `SeriesPoint` (in `analysis/aggregate.ts`) porta l'identificativo in
           * `diveId`; `TimePoint` (in `components/Charts.tsx`) lo cerca in `id`,
           * e lo dichiara **opzionale** perché ci sono serie che non aprono
           * niente. Qui si passava `points` così com'era: TypeScript non ha
           * detto niente — un campo opzionale che manca è legittimo — e
           * `onClick={() => onPick && p.id && onPick(p.id)}` trovava sempre
           * `undefined`. Risultato: **cliccare un punto di questo grafico non
           * apriva nessuna immersione, mai**, e sotto c'era scritto «Clicca un
           * punto per aprire l'immersione». `onPick` era passato, il cursore era
           * a manina, il riquadro compariva: tutto sembrava collegato.
           *
           * L'ha trovato la prova del cursore da tastiera (`promessaDaTastiera`):
           * premuto Invio su un punto scelto, non si apriva niente — e col mouse
           * non si apriva da prima. Si rinomina qui, dove i due nomi si
           * incontrano, invece di allargare `TimePoint`: un solo punto in cui
           * sbagliare, e la prova lo tiene.
           */
          points={points.map((p) => ({ at: p.at, value: p.value, id: p.diveId }))}
          unit={meta.unit}
          reference={meta.reference}
          referenceLabel={t(meta.referenceLabel)}
          format={(v) => v.toFixed(meta.digits)}
          onPick={onOpen}
        />
        {points.length > 0 && (
          /* ► L'ISTRUZIONE PROMETTEVA UNA COSA CHE DALLA TASTIERA NON SI POTEVA FARE. ◄
             Diceva soltanto «clicca», e i punti erano cerchi con `onClick` e
             nient'altro: chi naviga da tastiera leggeva la frase, provava, e non
             succedeva niente. Ora il cursore con le frecce c'è (vedi
             `useCursoreDiScelta`) e la frase lo dice — perché una funzione di
             cui nessuno viene informato è una funzione che non c'è, e una
             promessa che parla solo di clic resta falsa anche dopo che la
             tastiera funziona. */
          <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
            {t('Clicca un punto per aprire l’immersione — o Tab, frecce, Invio.')}
          </p>
        )}
      </div>

      <div className="grid grid-2">
        <CartaApribile
          chiave="stat-fasce-di-profondita"
          titolo={t('Fasce di profondità')}
          sotto={t('Dove passi il tempo.')}
          /* La fascia più battuta: «dove passi il tempo» ha una risposta sola, e
             questo è esattamente il numero che il grafico dentro disegna. */
          sommario={
            a.byDepthBand.some((b) => b.value > 0)
              ? /* `frase()` e non una concatenazione: concatenando usciva «18–24 m mostly»,
                   cioè l'ordine delle parole italiano imposto all'inglese. */
                frase(t, 'soprattutto {0}', a.byDepthBand.reduce((m, b) => (b.value > m.value ? b : m)).label)
              : t('nessuna immersione nel periodo scelto')
          }
        >
          <BarChart data={a.byDepthBand} unit={t('immersioni')} />
        </CartaApribile>
        <CartaApribile
          chiave="stat-siti-pi-frequentati"
          titolo={t('Siti più frequentati')}
          /* «Più frequentati» ha una risposta sola: quale, e quante volte. Su un
             archivio senza nome del sito l'elenco è vuoto, e «0 immersioni»
             sarebbe falso — le immersioni ci sono, manca il sito. */
          sommario={
            a.topSites.length
              ? `${a.topSites[0]!.name} · ${imm(a.topSites[0]!.dives, t)}`
              : t('nessun sito registrato')
          }
        >
          <p className="card-sub">{t('Per numero di immersioni.')}</p>
          <BarChart
            data={a.topSites.map((s) => ({ key: s.name, label: s.name, value: s.dives }))}
            unit={t('immersioni')}
          />
        </CartaApribile>
      </div>

      <div className="grid grid-2">
        <CartaApribile
          chiave="stat-disciplina"
          /* Una parola sola non diceva cosa viene misurato: il titolo adesso lo
             elenca. */
          titolo={t('Disciplina: soste, risalite, riserva')}
          /* Delle otto righe, la sosta di sicurezza ha il denominatore più grande
             ed è la sola che dipende soltanto da te. `pctPiano` è la stessa
             funzione che stampa la cifra dentro la tabella: il numero che si
             legge da chiusa e quello che si legge da aperta devono essere lo
             stesso numero, non due arrotondamenti diversi. */
          sommario={
            a.safetyStopEligible > 0
              ? `${pctPiano(a.safetyStopRate)} ${t('soste completate')}`
              : t('nessuna immersione verificabile')
          }
        >
          <p className="card-sub">
            {t(
              'Percentuali calcolate solo dove la verifica è possibile: il denominatore è accanto a ogni riga.',
            )}
          </p>
          <table>
            <tbody>
              {/*
                ► LE TRE RIGHE CHE IL PIANO GIUDICA ANCHE LUI. ◄ Soglie e
                arrotondamento arrivano da `coaching.ts`, non riscritti qui.
                Prima erano numeri a mano — `>= 0.9`, `<= 0.05` — contro un
                piano che usava `0.95` e `0.02`: con 35 soste su 37 questa
                tabella scriveva «nei limiti» e il piano «Da migliorare», sugli
                stessi dati e nella stessa applicazione. E il confronto passa
                dallo STESSO numero che si stampa (`percentuale`), così la
                pastiglia verde non può contraddire la cifra che ha accanto.
              */}
              <DisciplineRow
                label="Sosta di sicurezza completata"
                value={pctPiano(a.safetyStopRate)}
                basis={`${imm(a.safetyStopEligible, t)} ${t('in curva sopra i 10 m')}`}
                eligible={a.safetyStopEligible}
                good={percentuale(a.safetyStopRate ?? 0) >= percentuale(BENCHMARK.safetyStopRate)}
              />
              <DisciplineRow
                label="Immersioni con risalite fuori limite"
                value={pctPiano(a.fastAscentRate)}
                basis={`${imm(a.withProfile, t)} ${t('con profilo')}`}
                eligible={a.withProfile}
                good={percentuale(a.fastAscentRate ?? 1) <= percentuale(BENCHMARK.fastAscentRate)}
              />
              <DisciplineRow
                label="Uscite sotto i 50 bar"
                value={pctPiano(a.lowReserveRate)}
                basis={`${imm(a.lowReserveEligible, t)} ${t('con pressione finale')}`}
                eligible={a.lowReserveEligible}
                good={percentuale(a.lowReserveRate ?? 1) <= percentuale(BENCHMARK.lowReserveRate)}
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
                  label="Cambi di gas sotto la profondità massima operativa (MOD)"
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
                      ? /*
                          ► LO SCARTO SI DICHIARA SU QUANTE IMMERSIONI LO
                          PRODUCONO. ◄ Qui c'era `a.gf99.length`, cioè TUTTE le
                          immersioni con un GF99 calcolato da noi, mentre lo
                          scarto esiste solo dove esistono tutti e due i valori.
                          Con 48 immersioni di cui una sola confrontabile si
                          leggeva «su 48 immersioni · scarto dal computer 12.0
                          punti»: un numero misurato su una, dichiarato su
                          quarantotto. `aggregate` conta apposta
                          `gf99AgreementCount`, ed è quello che `ai/context.ts`
                          usa già dalla sua parte.
                        */
                        `${imm(a.gf99AgreementCount, t)} · ${t('scarto dal computer')} ${a.gf99Agreement.toFixed(1)} ${t('punti')}`
                      : `${imm(a.gf99.length, t)} · ${t('calcolato dal profilo')}`
                  }
                  /*
                    ► IL CRITERIO È QUELLO DEL PIANO, E NON UNA SOGLIA ASSOLUTA. ◄
                    `a.avgGf99 <= 65` giudicava il GF99 in assoluto: con un
                    computer impostato a 70/70 e un GF99 di 64 questa riga
                    diceva «nei limiti» mentre il piano diceva «margine
                    ridotto» — e 64 su 70 è il 91% del proprio limite. Il perché
                    per esteso, con la tabella dei due casi, sta in `ruleGf99`.
                  */
                  good={gf99ConMargine(a.avgGf99, a.gf99, scoped)}
                />
              )}
            </tbody>
          </table>
        </CartaApribile>

        <CartaApribile
          chiave="stat-composizione-dell-archiv"
          titolo={t('Composizione dell’archivio')}
          /* Profondità e obbligo decompressivo: delle cinque righe sono le due che
             dicono CHE TIPO di subacqueo sei. Qui lo zero è un dato vero e non
             un'assenza — il denominatore è noto — quindi non serve ripiego. */
          sommario={frase(t, '{0} oltre i 30 m, {1} con deco', a.deepDives30, a.decoDives)}
        >
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
              {/*
                ► «EAN32» È UN NOME, «ARIA» NO. ◄ Il commento che stava qui
                diceva che le miscele sono nomi e non si traducono, e per
                «EAN32» è vero; ma nello stesso elenco ci sono «Aria»,
                «Ossigeno» e «Sconosciuto», **che il dizionario traduce già** —
                il Logbook lo fa da sempre con `t(mixLabel(d))`. Con
                l'applicazione in inglese questa tabella diceva «Aria 30».
                `t()` su un nome proprio restituisce il nome: non c'è niente da
                perdere e c'è una parola da tradurre.
              */}
              {a.byMix.slice(0, 4).map((b) => (
                <tr key={b.key}>
                  <td className="muted">{t(b.label)}</td>
                  <td className="num tabular">{int(b.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CartaApribile>
      </div>

      <CartaApribile
        chiave="stat-immersioni-per-anno"
        titolo={t('Immersioni per anno')}
        /* Quanto è lungo l'archivio e qual è stato l'anno pieno. Il controllo sulla
           lunghezza non è decorativo: `Math.max()` su un elenco vuoto restituisce
           `-Infinity`, che a schermo diventa «-∞ in uno». */
        sommario={
          a.byYear.length
            ? frase(
                t,
                '{0} anni, fino a {1} in uno',
                a.byYear.length,
                Math.max(...a.byYear.map((b) => b.value)),
              )
            : t('nessuna immersione nel periodo scelto')
        }
      >
        <ColumnChart
          data={[...a.byYear].sort((x, y) => x.key.localeCompare(y.key))}
          unit={t('immersioni')}
          height={150}
        />
      </CartaApribile>

      <Correlations dives={scoped} onOpen={onOpen} inventario={gear.equipment} />
      <Condizioni dives={scoped} />
      <Attrezzatura dives={scoped} inventario={gear.equipment} />
      <Distributions dives={scoped} />
      <SettingsHistory dives={scoped} />
      <Seasonality dives={scoped} />
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
        <div className="row" style={{ gap: 8 }}>
          <span
            className={`dot ${verdict === undefined ? '' : verdict ? 'dot-good' : 'dot-warning'}`}
            style={verdict === undefined ? { background: 'var(--axis)' } : undefined}
            /*
             * ► IL COLORE NON PORTA MAI IL SIGNIFICATO DA SOLO. ◄ La regola è
             * scritta in `format.ts` — «accanto al pallino c'è sempre questa
             * etichetta testuale» — ed è rispettata nel Piano e nella riga dei
             * criteri. Questa tabella era l'unico punto che la violava: otto
             * righe in cui *se il numero sia buono o no* passava solo dal
             * verde contro l'ambra, su un cerchio di otto pixel.
             */
            aria-hidden="true"
          />
          <span>{t(label)}</span>
          {verdict !== undefined && (
            <span className="muted" style={{ fontSize: 12 }}>
              {t(verdict ? 'nei limiti' : 'da guardare')}
            </span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 12, marginLeft: 16 }}>
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
        (d) => profonditaMedia(d),
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
        (d) => temperaturaMinimaC(d),
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
    <CartaApribile
      chiave="stat-cosa-dipende-da-cosa"
      titolo={t('Cosa dipende da cosa')}
      /* La carta produce dei coefficienti: sapere che il legame più forte è 0.62
         invece di 0.08 è esattamente quello che fa decidere se aprirla. Il `?? 0`
         qui è corretto — una correlazione non calcolabile è davvero «nessun legame
         misurabile», e non deve vincere il massimo. */
      sommario={frase(
        t,
        '{0} relazioni, r fino a {1}',
        sets.length,
        Math.max(...sets.map((s) => Math.abs(correlation(s.points) ?? 0))).toFixed(2),
      )}
    >
      <p className="card-sub">
        {t(
          'Ogni punto è un’immersione: cliccala per aprirla, o scegli il punto con le frecce e premi Invio. La retta è la tendenza, r è la correlazione — 0 nessuna, ±1 perfetta. È una correlazione, non una causa.',
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
              <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                {/*
                  ► «assetto. su 30 immersioni» — una frase che ricomincia in
                  minuscolo dopo il punto. ◄ La spiegazione porta il punto perché
                  altrove sta da sola; qui le si attaccava il denominatore, e il
                  risultato era una riga che sembra tagliata male. Il punto si
                  toglie al momento di unire, e il denominatore arriva col punto
                  centrato — che è come l'applicazione lega un dato alla sua base
                  in ogni altro punto: «17.2 L/min · su 30 immersioni».
                */}
                {t(s.hint).replace(/\.$/, '')} · {t('su')} {imm(s.points.length, t)}
              </p>
            </div>
          );
        })}
      </div>
    </CartaApribile>
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
      note: t('Il valore massimo di ciascuna immersione.'),
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
    <CartaApribile
      chiave="stat-distribuzioni"
      /* «Distribuzioni» è una parola da statistica che non dice cosa ci si guarda.
         Il titolo nuovo è la frase con cui questo file spiega già la carta. */
      titolo={t('Le code che la media nasconde')}
      /*
       * La coda che conta è quella della riserva, e si conta sui secchi il cui
       * bordo ALTO sta sotto il limite.
       *
       * Non si usa quella delle risalite: i bordi sono 0-3-6-9-12-15-18 e il
       * limite è 10, quindi un filtro `from >= limite` salterebbe il secchio
       * [9,12) e conterebbe MENO del vero — un numero rassicurante e sbagliato.
       * E senza il controllo `some`, un archivio senza pressioni finali direbbe
       * «0 uscite sotto i 50 bar», che è la bugia più tranquilla che ci sia.
       */
      sommario={
        reserve.some((b) => b.count > 0)
          ? frase(
              t,
              '{0} uscite sotto i {1} bar',
              reserve.filter((b) => b.to <= LIMITS.minReserveBar).reduce((n, b) => n + b.count, 0),
              LIMITS.minReserveBar,
            )
          : t('serve un profilo campionato')
      }
    >
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
              /* La `key` resta l'etichetta ITALIANA: è un identificatore di riga,
                 e cambiarla con la lingua farebbe rimontare tutte le colonne a
                 ogni tocco su EN. Quella che si legge passa da `t()`. */
              data={b.bins.map((x) => ({
                key: x.label,
                label: etichettaSecchio(x.label, t),
                value: x.count,
              }))}
              unit={t('immersioni')}
              height={150}
              labelEvery={1}
            />
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              {b.note}
            </p>
          </div>
        ))}
      </div>
    </CartaApribile>
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
      <CartaApribile
        /* Chiave diversa dall'altro ramo, ed è la prova a chiederlo: i due non
           convivono mai a schermo — o ci sono i dati o non ci sono — ma
           «unica, tranne quando i due rami sono esclusivi» non è una regola che
           si possa verificare leggendo il sorgente. Una chiave in più costa
           zero e la regola torna vera com'è scritta. */
        chiave="stat-attrezzatura-senza-dati"
        titolo={t('Attrezzatura')}
        /* Questa carta non ha statistiche: ha una spiegazione del perché non ce ne
           sono. Il numero che fa decidere se aprirla è quante immersioni hanno la
           muta compilata, cioè la ragione del silenzio. */
        sommario={frase(t, 'solo {0} con l’attrezzatura', conMuta)}
      >
        <p className="card-sub" style={{ marginBottom: 0 }}>
          {`${imm(conMuta, t)} ${t('con l’attrezzatura registrata: troppo poche per un confronto. Compila muta, zavorra ed erogatori nella scheda dell’immersione.')}`}
        </p>
      </CartaApribile>
    );
  }

  const salLabel = (s: RigaZavorra['salinity']) =>
    s === 'salt' ? t('salata') : s === 'fresh' ? t('dolce') : t('non indicata');

  return (
    /* ► TRE TABELLE: era la sezione più alta della pagina, e l'unica rimasta
       sempre aperta. Le due carte gemelle — il ramo «dati insufficienti» qui
       sopra e questa — ora si comportano allo stesso modo, che è il minimo che
       ci si aspetti da due rami della stessa funzione. */
    <CartaApribile
      chiave="stat-attrezzatura"
      titolo={t('Attrezzatura')}
      /* Quante mute distinte hanno abbastanza immersioni per entrare in tabella:
         è la misura di quanto ha da dire questa carta. */
      sommario={frase(t, '{0} mute a confronto', mute.length)}
    >
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
                  <th className="num">{t('Consumo di superficie')}</th>
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
    </CartaApribile>
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
   * Tutti i consumi mediani dei gruppi, messi in fila.
   *
   * Serve al sommario, che da chiuso deve rispondere alla domanda del titolo —
   * «quanto contano le condizioni» — con l'escursione fra il gruppo che consuma
   * meno e quello che consuma di più. Il consumo mediano è facoltativo per
   * gruppo (un gruppo senza profili campionati non ce l'ha), e il filtro lo
   * toglie invece di farlo passare come zero: uno zero in un minimo diventa
   * «consumo da 0.0 a 18.7 L/min», cioè un'escursione inventata.
   */
  const consumiDeiGruppi = tabelle
    .flatMap((tab) => tab.righe.map((r) => r.medianRmvLpm))
    .filter((v): v is number => v !== undefined);

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
      <CartaApribile
        chiave="stat-condizioni"
        titolo={t('Condizioni')}
        /* Il massimo dei tre e non `totale`: quello è `mare + meteo + visibilità`,
           cioè conta tre volte la stessa immersione quando ha tutti e tre i campi,
           e su quattro immersioni complete direbbe «solo 12 con le condizioni
           registrate» in una carta che spiega che i dati sono POCHI. */
        sommario={frase(
          t,
          'solo {0} con le condizioni registrate',
          Math.max(quante.mare, quante.visibilita, quante.meteo),
        )}
      >
        <p className="card-sub" style={{ marginBottom: 0 }}>
          {t(
            'Le condizioni sono registrate su poche immersioni: con un gruppo solo non c’è niente da confrontare. Compila mare, visibilità e meteo nella scheda dell’immersione.',
          )}
        </p>
      </CartaApribile>
    );
  }

  return (
    <CartaApribile
      chiave="stat-quanto-contano-le-condiz"
      titolo={t('Quanto contano le condizioni')}
      /*
       * Il titolo fa una domanda, e il sommario risponde con l'escursione del
       * consumo fra i gruppi: è quella la misura di «quanto contano». Contare le
       * tabelle sarebbe stato più facile e avrebbe risposto a un'altra domanda —
       * *il numero che decide dev'essere il numero che si mostra.*
       *
       * Il consumo mediano è facoltativo per gruppo, e con meno di due valori
       * un'escursione non esiste: allora si dice quanti assi sono confrontabili.
       */
      sommario={
        consumiDeiGruppi.length >= 2
          ? frase(
              t,
              'consumo da {0} a {1} L/min',
              Math.min(...consumiDeiGruppi).toFixed(1),
              Math.max(...consumiDeiGruppi).toFixed(1),
            )
          : frase(t, '{0} condizioni a confronto', tabelle.length)
      }
    >
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
                  <th className="num">{t('Consumo di superficie')}</th>
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
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        {t(
          'Nessuna di queste righe dice una causa: col mare agitato cambiano anche sito, profondità e temperatura.',
        )}
      </p>
    </CartaApribile>
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
    <CartaApribile
      chiave="stat-impostazioni-del-compute"
      titolo={t('Impostazioni del computer nel tempo')}
      /* Quanti cambi e com'è messo ADESSO: è l'intero messaggio della carta, che
         esiste per avvisare quando una tendenza del GF99 attraversa un cambio di
         impostazioni. `periods.length >= 2` è garantito dall'uscita anticipata qui
         sopra, quindi «0 cambi» non può comparire. */
      sommario={frase(t, '{0} cambi, ora {1}', periods.length - 1, periods[periods.length - 1]!.label)}
    >
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
    </CartaApribile>
  );
}

/** Stagionalità: temperatura minima media per mese. */
function Seasonality({ dives }: { dives: Dive[] }) {
  const { t } = useLingua();
  // Si tolgono i mesi SENZA immersioni, non quelli con la media sotto zero:
  // vedi `tempByMonth`, dove l'assenza adesso è `undefined` e non uno zero.
  const months = tempByMonth(dives)
    .filter((m): m is { label: string; key: string; value: number } => m.value !== undefined)
    .map((m) => ({ label: etichettaMese(m.label, t), key: m.key, value: m.value }));
  if (months.length < 3) return null;
  return (
    <CartaApribile
      chiave="stat-temperatura-per-mese"
      titolo={t('Temperatura per mese')}
      sotto={t('Temperatura minima media per mese: dice quando serve la muta più pesante.')}
      /* Il mese più freddo e i suoi gradi: è la risposta alla domanda per cui
         questa carta esiste — quando serve la muta più pesante. */
      sommario={(() => {
        const piuFreddo = months.reduce((m, x) => (x.value < m.value ? x : m));
        return `${piuFreddo.label} ${piuFreddo.value.toFixed(1)} °C`;
      })()}
    >
      <ColumnChart data={months} unit="°C" height={150} labelEvery={1} serie="misure" />
    </CartaApribile>
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
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
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
        <div className="row" style={{ gap: 8, marginTop: 4, fontSize: 12 }}>
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
  const last = periods[periods.length - 1]!.label;
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
  const uid = useId();

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

  /*
   * ► LE BOLLE ERANO LO STESSO DIFETTO DEI PUNTI DEI GRAFICI. ◄
   *
   * `cursor: pointer`, `onClick`, e sotto la scritta «Clicca una bolla per
   * aprire un'immersione fatta lì»: da tastiera non si poteva né scegliere un
   * sito né aprirlo, e l'SVG non aveva nemmeno un nome — era un buco muto in
   * mezzo alla pagina. Stesso gancio dei grafici e non un secondo meccanismo:
   * chi ha imparato le frecce su una dispersione le ritrova qui.
   *
   * Da ovest a est, perché è il verso in cui il disegno le dispone: la freccia
   * destra deve muovere il cursore verso destra, altrimenti il tasto dice una
   * cosa e lo schermo ne fa un'altra.
   */
  const daOvest = [...list].sort((a, b) => a.lon - b.lon);
  // Un sito nasce con l'immersione che lo porta nell'elenco: `dives[0]` c'è sempre.
  const cursore = useCursoreDiScelta(daOvest, (s) => s.dives[0]!.id, onOpen);

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
  // Almeno due siti: `withCoords` è `list.length`, e sotto i due si è usciti prima.
  const piuFrequentato = list.reduce((a, b) => (b.dives.length > a.dives.length ? b : a), list[0]!);

  /* Il sito detto come lo dice l'etichetta sul disegno: nome e quante. */
  const etichettaSito = (sito: (typeof list)[number]) => `${sito.name}, ${imm(sito.dives.length, t)}`;
  const annuncioSito = (sito: (typeof list)[number]) =>
    frase(t, '{0}. Invio per aprire un’immersione fatta lì.', etichettaSito(sito));
  const nome = t('Disposizione dei siti di immersione');
  /* Il nome dice anche QUALE sito si aprirebbe: la regione viva dell'annuncio
     non si rilegge da sola, e chi torna qui col tabulatore deve risentire dove
     era rimasto. */
  const nomeAccessibile = cursore.punto ? `${nome} — ${annuncioSito(cursore.punto)}` : nome;
  /* Calcolata dai siti veri e non scritta a mano: una descrizione fissa
     resterebbe vera il giorno in cui è stata scritta e falsa alla prima
     importazione successiva, e chi la sente non ha modo di accorgersene. */
  const descrizione =
    frase(
      t,
      '{0} siti con coordinate, {1} in tutto. Il più frequentato è {2}.',
      withCoords,
      imm(
        list.reduce((n, sito) => n + sito.dives.length, 0),
        t,
      ),
      etichettaSito(piuFrequentato),
    ) +
    (cursore.attivo
      ? ' ' +
        t(
          'Frecce per scegliere un sito, Inizio e Fine agli estremi, Invio per aprire un’immersione fatta lì.',
        )
      : '');

  return (
    <CartaApribile
      chiave="stat-dove-ti-immergi"
      titolo={t('Dove ti immergi')}
      /* È lo stesso conteggio che il sottotitolo mostra da aperta, ed è giusto
         ripeterlo: da chiusa quel sottotitolo è `hidden`, cioè non esiste. */
      sommario={
        withoutCoords
          ? frase(t, '{0} siti · {1} senza coordinate', withCoords, withoutCoords)
          : `${withCoords} ${t('siti')}`
      }
    >
      <div className="page-title-row" style={{ marginBottom: 4 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {`${withCoords} ${t('siti con coordinate')}`}
          {withoutCoords ? ` · ${withoutCoords} ${t('senza')}` : ''}
        </span>
      </div>
      <p className="card-sub">
        {t('Non una mappa: la disposizione dei siti, con la bolla grande quanto le immersioni fatte lì.')}
      </p>
      <div className="chart" ref={ref}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={nomeAccessibile}
          aria-describedby={`${uid}-desc`}
          {...cursore.svg}
          style={contornoFuoco(cursore.fuoco)}
        >
          <title>{nomeAccessibile}</title>
          <desc id={`${uid}-desc`}>{descrizione}</desc>
          {list.map((site) => {
            const r = 5 + (site.dives.length / maxDives) * 16;
            /* Scelto col mouse OPPURE con le frecce: da qui in giù le due strade
               sono la stessa cosa — il nome compare, e l'Invio apre come il clic. */
            const scelto = cursore.punto?.name === site.name;
            const active = hover === site.name || scelto;
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
                    if (eraAttivo.current) onOpen(site.dives[0]!.id);
                  }}
                />
                {/* L'anello della bolla scelta dalle frecce: il contorno del
                    fuoco dice che si sta guidando la mappa, questo dice quale
                    bolla — e le bolle vicine si sovrappongono, quindi il solo
                    cambio di opacità non basterebbe a distinguerla. */}
                {scelto && (
                  <circle
                    aria-hidden="true"
                    cx={px(site.lon)}
                    cy={py(site.lat)}
                    r={r + 4}
                    fill="none"
                    stroke="var(--series-2)"
                    strokeWidth={2.5}
                  />
                )}
                {/* L'etichetta solo sulla bolla puntata e sulla più frequentata:
                    i siti vicini fra loro si sovrappongono per davvero, e
                    scriverli tutti produceva un grumo illeggibile. */}
                {(active || site.dives.length === maxDives) && (
                  <text
                    x={px(site.lon)}
                    /*
                      `Math.max` e non il valore nudo: una bolla vicina al bordo
                      superiore metteva la propria etichetta a `y` negativo, e il
                      testo veniva tagliato dal riquadro — misurato, «Moregallo
                      (8)» usciva di 10 px sopra. Undici è il corpo del carattere:
                      sotto quella soglia esce il tratto alto delle maiuscole.
                    */
                    y={Math.max(11, py(site.lat) - r - 5)}
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
      {/* Solo la mappa che ha il fuoco annuncia: vedi `useCursoreDiScelta`. */}
      {cursore.fuoco && (
        <AnnuncioCursore
          testo={cursore.punto ? annuncioSito(cursore.punto) : t('Cursore non posizionato: usa le frecce.')}
        />
      )}
      {/* Le coordinate arrivano solo dai formati che le contengono: UDDF,
          Subsurface, il GPS dei Garmin e i log Shearwater dalla versione 17 in
          su. Chi non le vede non ha sbagliato niente, gli manca il formato — ma
          a schermo quell'elenco non aiuta nessuno a fare qualcosa. */}
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
        {t('Clicca una bolla per aprire un’immersione fatta lì — o Tab, frecce, Invio.')}
      </p>
    </CartaApribile>
  );
}
