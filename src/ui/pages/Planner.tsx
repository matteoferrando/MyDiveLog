/**
 * Pianificatore di gas.
 *
 * La differenza fra questa pagina e un pianificatore qualunque è una sola: il
 * consumo di partenza è misurato sulle immersioni in archivio, non scelto da una
 * tabella. Tutto il resto della pagina esiste per rendere il numero
 * controllabile — le fasi separate, lo schema della risalita, le curve al variare
 * della profondità, e il confronto con com'è andata davvero le ultime volte.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { suIOS } from '../../piattaforma';
import {
  ascentGeometry,
  atDepth,
  bottomAvgForWholeAvg,
  DEFAULT_PLAN,
  phaseGeometry,
  measuredRmv,
  contingencies,
  planGas,
  pressureSchedule,
  type SchedulePoint,
  similarDives,
  turnMinute,
  usualDepthRatio,
  usualSetup,
  type GasPhase,
  type GasPlan,
  type GasPlanInput,
} from '../../core/analysis/gasPlan';
import { LIMITS, type GasMix } from '../../core/model';
import { OTU_DAILY_TDI } from '../../core/analysis/oxygen';
import { formatRuntime, mixName } from '../../core/units';
import {
  CurveChart,
  StatTile,
  Tooltip,
  useDismissOnLeave,
  useWidth,
  type TooltipState,
} from '../components/Charts';
import { PeriodPicker } from '../components/PeriodPicker';
import { DecoPlanner, type DecoPlanState } from '../components/DecoPlan';
import { curveOfPlan, type PlanCurve as PlanCurveResult } from '../../core/analysis/tissues';
import { barometric, planDeco, type DecoResult } from '../../core/analysis/deco';
import { pianoHtml, type FoglioPiano } from '../../core/export/planPrint';
import { foglioDelPiano } from '../../core/export/planSheet';
import { useDiveLog } from '../state';
import { InputNumerico } from '../components/InputNumerico';
import { useLingua } from '../lingua';
import { imm, plural } from '../format';

/**
 * I gradient factor della modalità ricreativa: 40/85.
 *
 * Non sono `DEFAULT_GF` (30/85), che è il valore con cui si rileggono le
 * immersioni già fatte quando il computer non dichiara i suoi. Qui si sta
 * pianificando, e 40/85 è la coppia che i computer ricreativi montano di
 * fabbrica: un piano calcolato con parametri diversi da quelli che avrai al
 * polso dice minuti che non vedrai.
 *
 * Erano scritti a mano in due punti diversi — nel calcolo e nel testo della
 * scheda — e ora che li usa anche il calcolo delle soste sarebbero tre. Un
 * numero solo in un posto solo.
 */
const GF_RICREATIVI = { low: 40, high: 85 };

export function Planner() {
  const { t } = useLingua();
  const {
    dives,
    scope,
    gasInput,
    saveGasInput,
    decoInput,
    saveDecoInput,
    decoPlans,
    saveNamedDecoPlan,
    deleteNamedDecoPlan,
  } = useDiveLog();

  // Il consumo si legge sulla finestra scelta: pianificare col respiro di tre
  // anni fa non descrive il subacqueo di adesso.
  const rmv = useMemo(() => measuredRmv(scope.dives), [scope.dives]);
  const setup = useMemo(() => usualSetup(scope.dives), [scope.dives]);
  // Quanto sta la media sotto la massima, nelle SUE immersioni: serve a
  // precompilare la profondità media invece di far indovinare un rapporto.
  const depthRatio = useMemo(() => usualDepthRatio(scope.dives), [scope.dives]);

  const [input, setInput] = useState<GasPlanInput>(() => {
    const base: GasPlanInput = {
      ...DEFAULT_PLAN,
      // Il 75° percentile: pianificare sulla mediana significa che una volta su
      // due il gas basta appena.
      rmvLpm: rmv.p75 ?? 20,
      tankL: setup.tankL ?? DEFAULT_PLAN.tankL,
      startBar: setup.startBar ?? DEFAULT_PLAN.startBar,
      mix: setup.mix ?? DEFAULT_PLAN.mix,
      // Il modulo salvato si sovrappone ai valori predefiniti, non li sostituisce:
      // un piano salvato prima che un campo esistesse non deve arrivare qui con un
      // buco al posto di un numero.
      ...(gasInput ?? {}),
    };
    if (gasInput?.avgDepthM) return base;
    // La media del fondo si ricava da quella dell'intera immersione — che è quella
    // che registra il computer — applicata alla profondità di QUESTO piano. Usare
    // il rapporto dell'archivio direttamente come media del fondo conterebbe due
    // volte la risalita e sottostimerebbe il gas.
    const suggested = bottomAvgForWholeAvg(base, (depthRatio ?? 0.7) * base.depthM);
    const filled = suggested === undefined ? base : { ...base, avgDepthM: suggested };
    // Normalizzato subito: un piano salvato può contenere combinazioni che il
    // calcolo corregge (media sotto il fondo, totale più corto delle soste), e
    // partire con lo stato d'accordo col calcolo evita che il modulo mostri un
    // numero e i risultati ne usino un altro.
    return planGas(filled).input;
  });

  // Il modulo compilato viene conservato, ma non a ogni tasto premuto: mezzo
  // secondo di quiete e poi si scrive.
  useEffect(() => {
    const attesa = setTimeout(() => saveGasInput(input), 500);
    return () => clearTimeout(attesa);
  }, [input, saveGasInput]);

  const set = <K extends keyof GasPlanInput>(key: K, value: GasPlanInput[K]) =>
    setInput((p) => ({ ...p, [key]: value }));

  // Il rapporto fra media e massima, conservato esatto: ricavarlo ogni volta dal
  // valore arrotondato mostrato nel campo faceva derivare la media a ogni
  // passaggio (30 → 3 → 30 restituiva 21 invece di 20.6).
  const avgRatio = useRef<number | null>(null);
  // Stessa ragione per la velocità di risalita: è la grandezza che si conserva
  // cambiando profondità, e ricavarla ogni volta dal totale arrotondato la
  // degraderebbe a ogni passaggio.
  const ascentRate = useRef<number | null>(null);
  // Quanti minuti di sosta rimettere riaccendendo la casella: spegnerla non deve
  // far dimenticare che ne facevi cinque.
  const lastStopMin = useRef(3);
  const setAvgDepth = (v: number) =>
    setInput((p) => {
      avgRatio.current = v / Math.max(1, p.depthM);
      return { ...p, avgDepthM: Math.min(v, p.depthM) };
    });

  const plan = useMemo(() => planGas(input), [input]);
  // `input` è lo stato del modulo, `shown` è ciò con cui si è davvero calcolato.
  // Tutto quello che la pagina SCRIVE viene da qui: mostrare un numero diverso da
  // quello usato è il modo più rapido di perdere la fiducia di chi legge.
  const shown = plan.input;
  const schedule = useMemo(() => pressureSchedule(plan), [plan]);
  const plans = useMemo(() => contingencies(input), [input]);
  const turnAt = useMemo(() => turnMinute(plan), [plan]);

  // La DURATA TOTALE del piano, non il suo tempo di fondo: `similarDives` filtra
  // sulla durata completa delle immersioni in archivio, e passargli il tempo di
  // fondo confrontava due grandezze diverse. Con 25 minuti di fondo (45 di
  // durata) sceglieva le uscite corte da 22-28 minuti e dichiarava «uscita
  // tipica 120 bar» accanto a un piano che ne prevede 70.
  const similar = useMemo(
    () => similarDives(scope.dives, plan.input.depthM, 5, plan.totalRuntimeMin),
    [scope.dives, plan],
  );

  // Le curve: lo stesso piano ricalcolato al variare di un parametro. È il pezzo
  // che un numero singolo non può dare — la pendenza dice quanto margine c'è.
  const byDepth = useMemo(() => {
    const out: { x: number; bottom: number; reserve: number }[] = [];
    for (let d = 10; d <= 60; d += 2) {
      const p = planGas(atDepth(input, d, undefined, plan.plannedAscentRateMpm));
      out.push({ x: d, bottom: p.gasLimitedBottomMin, reserve: p.reserveBar });
    }
    return out;
  }, [input, plan.plannedAscentRateMpm]);

  const byRmv = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    for (let r = 10; r <= 32; r += 1) {
      out.push({ x: r, y: planGas({ ...input, rmvLpm: r }).gasLimitedBottomMin });
    }
    return out;
  }, [input]);

  const startL = shown.startBar * shown.tankL;

  // Ricreativa o tecnica: è la prima decisione, e cambia il significato di tutto
  // quello che viene dopo. In ricreativa il vincolo è la curva di sicurezza e il
  // gas serve a rispettarla; in tecnica il vincolo è il gas e la decompressione è
  // la conseguenza. Il pianificatore di gas resta identico nelle due modalità:
  // cambia cosa gli si mette accanto.
  const [mode, setMode] = useState<'rec' | 'tec'>('rec');
  // Caricare un piano salvato rimonta il pianificatore: i suoi campi si
  // inizializzano dallo stato salvato, e cambiare la chiave è il modo pulito di
  // dirgli «riparti da questi» senza duplicare in Planner ogni singolo campo.
  const [decoKey, setDecoKey] = useState(0);

  // La curva del piano ricreativo: quanto tempo hai, e a che minuto lo finisci.
  const curve = useMemo(
    () =>
      curveOfPlan(
        phaseGeometry(plan.planned).map((seg) => ({
          fromM: seg.fromM,
          toM: seg.toM,
          minutes: seg.phase.minutes,
        })),
        {
          mix: shown.mix,
          avgDepthM: shown.avgDepthM,
          maxDepthM: shown.depthM,
          gfLow: GF_RICREATIVI.low / 100,
          gfHigh: GF_RICREATIVI.high / 100,
          salinity: shown.salinity,
          surfacePressureBar: barometric(shown.altitudeM ?? 0),
        },
      ),
    [plan.planned, shown.mix, shown.avgDepthM, shown.depthM, shown.salinity, shown.altitudeM],
  );

  /*
   * LE SOSTE, QUANDO IL PIANO RICREATIVO ESCE DALLA CURVA.
   *
   * Fino a ieri qui c'era una riga che diceva «inserisci le soste come minuti
   * aggiuntivi»: cioè chiedeva a chi pianifica di fare a mano il conto che
   * l'applicazione sa già fare — il motore Bühlmann è lo stesso che disegna la
   * curva due riquadri più sopra, ed è stato verificato su trentotto immersioni
   * vere contro quello che lo Shearwater aveva calcolato al polso.
   *
   * Si calcola solo quando serve: se il piano resta in curva, `planDeco` darebbe
   * un risultato senza soste e la carta non comparirebbe comunque. Con gli
   * stessi gradient factor della curva (40/85), perché due numeri diversi nella
   * stessa pagina sono peggio di un numero solo.
   */
  const soste = useMemo(() => {
    if (mode !== 'rec' || curve.leavesCurveAtMin === undefined) return undefined;
    return planDeco(
      [{ depthM: shown.avgDepthM, minutes: shown.bottomMin }],
      [{ mix: shown.mix, role: 'bottom', tankL: shown.tankL, startBar: shown.startBar }],
      {
        // Gli STESSI gradient factor della curva qui sopra. Due numeri diversi
        // nella stessa pagina sono peggio di un numero solo: chi legge non ha
        // modo di sapere quale dei due descrive l'immersione che farà.
        gfLow: GF_RICREATIVI.low / 100,
        gfHigh: GF_RICREATIVI.high / 100,
        salinity: shown.salinity,
        surfacePressureBar: barometric(shown.altitudeM ?? 0),
        rmvLpm: plan.planningRmvLpm,
      },
    );
  }, [
    mode,
    curve.leavesCurveAtMin,
    shown.avgDepthM,
    shown.bottomMin,
    shown.mix,
    shown.tankL,
    shown.startBar,
    shown.salinity,
    shown.altitudeM,
    plan.planningRmvLpm,
  ]);

  const [stampaBloccata, setStampaBloccata] = useState(false);

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">{t('Pianificatore di gas')}</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {rmv.n > 0
            ? `${t('Consumo misurato su')} ${imm(rmv.n, t)}.`
            : t('Nessuna immersione con pressioni: scrivi il consumo a mano.')}
        </span>
      </div>

      <PeriodPicker />

      <div className="card">
        <div className="spread" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>{t('Che immersione stai pianificando')}</h2>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              {mode === 'rec'
                ? t('Ricreativa: il piano resta in curva, e ti diciamo a che minuto ne esce.')
                : t('Tecnica: la deco è prevista, con la tabella delle soste e i gas che porti.')}
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className={mode === 'rec' ? 'btn btn-primary' : 'btn'} onClick={() => setMode('rec')}>
              {t('Ricreativa')}
            </button>
            <button className={mode === 'tec' ? 'btn btn-primary' : 'btn'} onClick={() => setMode('tec')}>
              {t('Tecnica')}
            </button>
            {/*
             * La stampa esiste perché in barca il telefono non c'è: sta nel
             * sacco, o è scarico, o è nel gommone mentre tu sei in acqua. Il
             * foglio è la lavagnetta della didattica tecnica, con gli stessi
             * numeri di quelli appena calcolati e senza il passaggio in cui si
             * ricopia a mano una cifra sbagliata.
             *
             * E proprio per questo su iPhone il pulsante non c'è: dentro la
             * WKWebView `window.open` restituisce null e `window.print()` non
             * fa niente, quindi il foglio non si può produrre. Restava un
             * pulsante che, premuto, dava la colpa al blocco dei popup — cioè
             * mandava a cercare un'impostazione inesistente per un problema che
             * non era quello. Il piano si stampa dal Mac, o si copia negli
             * appunti col pulsante qui accanto.
             */}
            {!suIOS() && (
              <button
                className="btn"
                onClick={() =>
                  setStampaBloccata(
                    !apriStampaPiano(
                      foglioDelPiano({
                        plan,
                        schedule,
                        curve,
                        soste,
                        contingenze: plans,
                        mode,
                        turnAt,
                        gf: GF_RICREATIVI,
                      }),
                    ),
                  )
                }
              >
                {t('Stampa il piano (PDF)')}
              </button>
            )}
          </div>
        </div>
      </div>
      {/*
       * DUE MOTIVI DIVERSI PER CUI LA STAMPA NON PARTE, e all'utente ne diciamo
       * solo il rimedio.
       *
       * Su iOS il foglio si apre in una finestra separata e la stampa la fa il
       * sistema: dentro la WKWebView non esiste né l'una né l'altra, quindi il
       * rimedio è il Mac (stessi dati, sincronizzati) e non un'impostazione.
       * Altrove l'unico modo in cui `window.open` fallisce è il blocco dei
       * popup, e lì il rimedio è consentirli. Spiegare la WKWebView a chi vuole
       * un foglio in barca non serve a niente.
       */}
      {stampaBloccata && (
        <div className="notice">
          {suIOS()
            ? t('Su iPhone e iPad la stampa non c’è. Stampa il piano dal Mac: i dati sono gli stessi.')
            : t('Il browser ha bloccato la finestra di stampa. Consenti i popup per questo sito e riprova.')}
        </div>
      )}

      <div className="card">
        <h2>{t('Il tuo consumo')}</h2>
        {/* Non è una stima: servono volume bombola, pressione di partenza e
            pressione d'uscita. Se manca uno dei tre il valore non esiste, e non
            lo inventiamo con una tabella. */}
        <p className="card-sub">
          {t('Calcolato dalle tue pressioni, immersione per immersione. Dove mancano, il valore non c’è.')}
        </p>
        {rmv.n === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            {t(
              'Nessuna immersione del periodo ha bombola e pressioni. Scrivile in una scheda immersione, oppure tieni il valore predefinito qui sotto.',
            )}
          </p>
        ) : (
          <div className="grid grid-tiles">
            <StatTile
              label={t('Di solito (mediana)')}
              value={<span className="tabular">{rmv.median?.toFixed(1)}</span>}
              note={t('L/min in superficie')}
            />
            <StatTile
              label={t('Per pianificare (75°)')}
              value={<span className="tabular">{rmv.p75?.toFixed(1)}</span>}
              note={t('tre volte su quattro consumi meno di così')}
            />
            <StatTile
              label={t('Il peggiore visto')}
              value={<span className="tabular">{rmv.max?.toFixed(1)}</span>}
              note={t('una sola immersione')}
            />
            <div className="tile">
              <div className="tile-label">{t('Usa nel piano')}</div>
              <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                {(
                  [
                    ['Mediana', rmv.median],
                    /* «75°» è il percentile: in inglese si scrive «75th», quindi
                       passa dal dizionario come tutto il resto. */
                    ['75°', rmv.p75],
                    ['Peggiore', rmv.max],
                  ] as const
                ).map(([label, v]) =>
                  v === undefined ? null : (
                    <button
                      key={label}
                      onClick={() => set('rmvLpm', v)}
                      aria-pressed={Math.abs(input.rmvLpm - v) < 0.05}
                      style={{ fontSize: 12, padding: '4px 8px' }}
                    >
                      {t(label)}
                    </button>
                  ),
                )}
              </div>
              <div className="tile-note">
                {t('In uso')}: {plan.planningRmvLpm.toFixed(1)} L/min
                {plan.buddyDrivesPlan && ` (${t('del compagno')})`}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>{t('Immersione pianificata')}</h2>
        <div className="grid grid-3" style={{ gap: 10 }}>
          <NumField
            label={t('Profondità massima')}
            unit="m"
            value={input.depthM}
            step={1}
            min={3}
            max={100}
            hint={t('Decide gas d’emergenza, ppO2 e narcosi. La media segue in proporzione.')}
            onChange={(v) =>
              // La media e il tempo di risalita seguono la massima, con la stessa
              // funzione che usano le curve: così la curva a 40 m e il campo a 40 m
              // danno lo stesso numero.
              setInput((p) => {
                ascentRate.current ??= planGas(p).plannedAscentRateMpm ?? null;
                return atDepth(p, v, avgRatio.current ?? undefined, ascentRate.current ?? undefined);
              })
            }
          />
          <NumField
            label={t('Profondità media')}
            unit="m"
            value={input.avgDepthM}
            step={1}
            min={3}
            max={input.depthM}
            hint={
              depthRatio
                ? `${t('È questa che consuma il gas del fondo. Nelle tue immersioni sta al')} ${Math.round(depthRatio * 100)}% ${t('della massima')}.`
                : t('È questa che consuma il gas del fondo, non la massima.')
            }
            onChange={setAvgDepth}
          />
          <NumField
            label={t('Tempo di fondo')}
            unit="min"
            value={input.bottomMin}
            step={1}
            min={1}
            max={400}
            hint={t(
              'Dall’ingresso all’inizio della risalita, discesa compresa: è come lo conta il computer.',
            )}
            onChange={(v) =>
              // Il totale segue il fondo minuto per minuto: allungare il fondo
              // senza allungare l'immersione significherebbe accorciare in
              // silenzio la risalita, che è la parte che non si comprime.
              setInput((p) => ({ ...p, bottomMin: v, totalMin: Math.max(v, p.totalMin + (v - p.bottomMin)) }))
            }
          />
          <NumField
            label={t('Durata totale')}
            unit="min"
            value={input.totalMin}
            step={1}
            min={input.bottomMin}
            max={500}
            hint={t('Dall’ingresso all’uscita. Quello che avanza dal fondo è la risalita.')}
            onChange={(v) => {
              // Il totale scelto a mano ridefinisce la velocità di riferimento.
              ascentRate.current = null;
              set('totalMin', v);
            }}
          />
          <NumField
            label={t('Tempo alla massima')}
            unit="min"
            value={input.maxTimeMin}
            step={1}
            min={0}
            max={input.bottomMin}
            /* Il resto del fondo non è un'ipotesi: data la media e i minuti alla
               massima, la profondità del tratto rimanente è determinata. Zero
               vuol dire «non lo so», e allora il fondo vale tutto alla media. */
            hint={
              plan.restDepthM !== undefined
                ? `${t('Il resto del fondo sta a')} ${plan.restDepthM} m. ${t('Massimo')}: ${plan.maxFeasibleTimeMin} min.`
                : `${t('Zero: il fondo vale tutto alla media.')} ${t('Massimo')}: ${plan.maxFeasibleTimeMin} min.`
            }
            onChange={(v) => set('maxTimeMin', v)}
          />
          <div className="planner-field">
            <span className="planner-label">
              {t('Bombola')} <span className="muted">(L)</span>
            </span>
            <div className="row" style={{ gap: 6 }}>
              <input
                type="number"
                aria-label={t('Volume in litri')}
                value={input.tankL}
                min={1}
                max={60}
                step={1}
                onChange={(e) => set('tankL', Math.min(60, Math.max(1, Number(e.target.value) || 1)))}
                style={{ width: 74 }}
              />
              <span className="muted" style={{ fontSize: 11 }}>
                {input.startBar * input.tankL} L {t('di gas')}
              </span>
            </div>
            <div className="row" style={{ gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
              {TANK_PRESETS.map((bombola) => (
                <button
                  key={bombola.label}
                  onClick={() => set('tankL', bombola.litres)}
                  aria-pressed={input.tankL === bombola.litres}
                  style={{ fontSize: 11, padding: '3px 7px' }}
                >
                  {bombola.label}
                </button>
              ))}
            </div>
          </div>
          <NumField
            label={t('Pressione di partenza')}
            unit="bar"
            value={input.startBar}
            step={10}
            min={50}
            max={350}
            onChange={(v) => set('startBar', v)}
          />
          <MixField mix={input.mix} onChange={(m) => set('mix', m)} />
          <label className="planner-field">
            <span className="planner-label">{t('Acqua')}</span>
            <select
              value={input.salinity}
              onChange={(e) => set('salinity', e.target.value as GasPlanInput['salinity'])}
            >
              <option value="salt">{t('Mare')}</option>
              <option value="fresh">{t('Lago')}</option>
            </select>
            <span className="planner-hint">{t('Cambia la pressione ambiente, e quindi i volumi.')}</span>
          </label>
          <NumField
            label={t('Quota del sito')}
            unit={t('m slm')}
            value={input.altitudeM ?? 0}
            step={50}
            min={0}
            max={4000}
            onChange={(v) => set('altitudeM', v)}
          />
        </div>
        {(input.altitudeM ?? 0) > 0 && (
          /* Quota e salinità restano campi separati perché al lago di montagna
             valgono tutte e due: l'una sposta la pressione di superficie,
             l'altra la densità dell'acqua. */
          <p className="planner-hint" style={{ marginTop: 8 }}>
            {t('Pressione di superficie')} {barometric(input.altitudeM ?? 0).toFixed(3)} bar{' '}
            {t('invece di 1.013: respiri meno gas, e la curva si accorcia.')}
          </p>
        )}

        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
            {t('Risalita, soste e limite di PPO2')}
          </summary>
          <div className="grid grid-3" style={{ gap: 10, marginTop: 12 }}>
            <NumField
              label={t('Velocità di risalita in emergenza')}
              unit="m/min"
              value={input.ascentRateMpm}
              step={1}
              min={3}
              max={18}
              hint={t('Solo per il gas d’emergenza: quella pianificata la decide la durata totale.')}
              onChange={(v) => set('ascentRateMpm', v)}
            />
            <label className="planner-field">
              <span className="planner-label">{t('Sosta di sicurezza')}</span>
              <label
                className="planner-check"
                style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 32 }}
              >
                <input
                  type="checkbox"
                  data-check="safety-stop"
                  checked={input.stopMin > 0}
                  onChange={(e) =>
                    // Spegnendola i minuti vanno a zero e la durata totale si
                    // accorcia di conseguenza; riaccendendola tornano i tre minuti
                    // di prassi. Senza la casella l'unico modo di toglierla era
                    // scrivere zero in un campo che chiede dei minuti, e nessuno
                    // pensa di farlo.
                    setInput((p) => {
                      const next = e.target.checked ? lastStopMin.current : 0;
                      if (!e.target.checked) lastStopMin.current = p.stopMin || 3;
                      return { ...p, stopMin: next, totalMin: p.totalMin + (next - p.stopMin) };
                    })
                  }
                />
                <span>{input.stopMin > 0 ? t('la faccio') : t('non la faccio')}</span>
              </label>
              {/* Nessun modello la impone — su un'immersione bassa il piano
                  arriva in superficie senza fermarsi — ma va contata lo stesso:
                  tre minuti non calcolati sono tre minuti di gas non calcolato. */}
              <span className="planner-hint">
                {t('Non è obbligatoria, ma tre minuti non contati sono tre minuti di gas non contato.')}
              </span>
            </label>
            {input.stopMin > 0 && (
              <>
                <NumField
                  label={t('Durata della sosta')}
                  unit="min"
                  value={input.stopMin}
                  step={1}
                  min={1}
                  max={10}
                  onChange={(v) =>
                    setInput((p) => ({ ...p, stopMin: v, totalMin: p.totalMin + (v - p.stopMin) }))
                  }
                />
                <NumField
                  label={t('Profondità della sosta')}
                  unit="m"
                  value={input.stopDepthM}
                  step={1}
                  min={3}
                  max={Math.min(9, input.depthM)}
                  onChange={(v) => set('stopDepthM', Math.min(v, input.depthM))}
                />
              </>
            )}
            <NumField
              label={t('Soste deco pianificate')}
              unit="min"
              value={input.extraStopMin}
              step={1}
              min={0}
              max={120}
              hint={t('Qui vengono sommate, non calcolate. Allungano la durata totale.')}
              onChange={(v) =>
                setInput((p) => ({ ...p, extraStopMin: v, totalMin: p.totalMin + (v - p.extraStopMin) }))
              }
            />
            <NumField
              label={t('PPO2 massima')}
              unit="bar"
              value={input.maxPpo2}
              step={0.1}
              min={1.1}
              max={1.6}
              hint={t('Lo stesso limite impostato sul computer.')}
              onChange={(v) => set('maxPpo2', v)}
            />
          </div>
        </details>
      </div>

      <div className="card">
        <h2>{t('Riserva e regola di rientro')}</h2>
        {/* Se il gas minimo non lo si chiede non viene calcolato: non è un
            numero nascosto che compare altrove nella pagina. */}
        <p className="card-sub">
          {t('Due scuole: il gas minimo calcolato (rock bottom), o la riserva fissa. Scegli tu.')}
        </p>

        <label className="planner-check">
          <input
            type="checkbox"
            data-check="rock-bottom"
            checked={input.reserveRule === 'rockBottom'}
            onChange={(e) => set('reserveRule', e.target.checked ? 'rockBottom' : 'fixedBar')}
          />
          <span>
            <strong>{t('Calcola il gas minimo per l’emergenza')}</strong> (rock bottom)
            <span className="planner-hint" style={{ display: 'block' }}>
              {t(
                'Il gas per riportare due persone in superficie dal punto più profondo, con una bombola sola.',
              )}
            </span>
          </span>
        </label>

        {input.reserveRule === 'rockBottom' ? (
          <div className="grid grid-3" style={{ gap: 10, marginTop: 12 }}>
            <NumField
              label={t('Consumo in emergenza')}
              unit="L/min"
              value={input.stressRmvLpm}
              step={1}
              min={10}
              max={60}
              hint={t('Più alto del tuo: chi condivide gas respira male. La didattica dice 30.')}
              onChange={(v) => set('stressRmvLpm', v)}
            />
            <NumField
              label={t('Persone sulla bombola')}
              unit=""
              value={input.divers}
              step={1}
              min={1}
              max={3}
              hint={t('Due: tu e il compagno senza gas.')}
              onChange={(v) => set('divers', v)}
            />
            <NumField
              label={t('Consumo del compagno')}
              unit="L/min"
              value={input.buddyRmvLpm}
              step={1}
              min={0}
              max={40}
              /* Il piano usa il respiro più alto della squadra: è la didattica,
                 e con due consumi diversi il gas finisce sul più affamato. */
              hint={t('Zero se scendi da solo. Se è più alto del tuo, il piano usa il suo.')}
              onChange={(v) => set('buddyRmvLpm', v)}
            />
            <NumField
              label={t('Gestione del problema')}
              unit="min"
              value={input.problemMin}
              step={1}
              min={0}
              max={10}
              hint={t('Minuti sul fondo prima di iniziare a risalire.')}
              onChange={(v) => set('problemMin', v)}
            />
          </div>
        ) : (
          <div className="grid grid-3" style={{ gap: 10, marginTop: 12 }}>
            <NumField
              label={t('Riserva fissa')}
              unit="bar"
              value={input.reserveBarFixed}
              step={5}
              min={0}
              max={150}
              hint={t('Esci con questa pressione, qualunque sia la profondità.')}
              onChange={(v) => set('reserveBarFixed', v)}
            />
          </div>
        )}

        <label className="planner-check" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            data-check="deco-mix"
            checked={input.decoMix !== undefined}
            onChange={(e) => set('decoMix', e.target.checked ? { o2: 1, he: 0 } : undefined)}
          />
          <span>
            <strong>{t('Bombola di decompressione separata')}</strong>
            {/* Il margine del 50% sul gas di deco è del manuale: se una parte
                va al compagno o il respiro accelera, deve bastare comunque. */}
            <span className="planner-hint" style={{ display: 'block' }}>
              {t('Le soste si pagano con lei, alla sua profondità e col suo consumo. Margine del 50%.')}
            </span>
          </span>
        </label>

        {input.decoMix && (
          <div className="grid grid-3" style={{ gap: 10, marginTop: 12 }}>
            <MixField mix={input.decoMix} onChange={(m) => set('decoMix', m)} />
            <NumField
              label={t('Bombola deco')}
              unit="L"
              value={input.decoTankL}
              step={1}
              min={1}
              max={40}
              onChange={(v) => set('decoTankL', v)}
            />
            <NumField
              label={t('Pressione deco')}
              unit="bar"
              value={input.decoStartBar}
              step={10}
              min={20}
              max={350}
              onChange={(v) => set('decoStartBar', v)}
            />
            <NumField
              label={t('Consumo in decompressione')}
              unit="L/min"
              value={input.decoRmvLpm}
              step={1}
              min={0}
              max={40}
              hint={t('Fermi si respira meno che sul fondo. Zero: come quello di fondo.')}
              onChange={(v) => set('decoRmvLpm', v)}
            />
            {plan.deco && (
              <div className="tile" style={{ gridColumn: 'span 2' }}>
                <div className="tile-label">{t('Ti serve')}</div>
                <div
                  className="tile-value tabular"
                  style={{ color: plan.deco.short ? 'var(--critical)' : undefined }}
                >
                  {plan.deco.requiredBar} <small style={{ fontSize: 13, fontWeight: 500 }}>bar</small>
                </div>
                <div className="tile-note">
                  {plan.deco.minutes.toFixed(0)} {t('min di sosta')} = {plan.deco.litres} L, ×1.5 ={' '}
                  {plan.deco.requiredL} L. {t('Si passa a')} {mixName(plan.deco.mix)} {t('da')}{' '}
                  {plan.deco.switchDepthM.toFixed(1)} m.
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-3" style={{ gap: 10, marginTop: 12 }}>
          <label className="planner-field">
            <span className="planner-label">{t('Regola di rientro')}</span>
            <select
              value={input.turnRule}
              onChange={(e) => set('turnRule', e.target.value as GasPlanInput['turnRule'])}
            >
              <option value="thirds">{t('Terzi — subacquea tecnica')}</option>
              <option value="half">{t('Metà — andata e ritorno')}</option>
              <option value="none">{t('Nessuna — discesa lineare')}</option>
            </select>
            {/* Senza regola non si mostra nessuna pressione di rientro: su una
                discesa lineare con risalita libera sarebbe un numero arbitrario. */}
            <span className="planner-hint">
              {input.turnRule === 'thirds'
                ? t('Un terzo all’andata, uno al ritorno, uno di margine.')
                : input.turnRule === 'half'
                  ? t('Metà all’andata, metà al ritorno.')
                  : t('Nessuna pressione di rientro.')}
            </span>
          </label>
        </div>
      </div>

      {/* La durata e la sua distribuzione: il numero grande, e subito sotto dove
          vanno a finire quei minuti. La barra è l'unico posto in cui si vede che
          la risalita è una fetta del tempo, non un'appendice. */}
      <div className="card">
        <div className="runtime">
          <div>
            <div className="tile-label">{t('Durata totale dell’immersione')}</div>
            <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
              <span className="hero tabular">{formatRuntime(plan.totalRuntimeMin)}</span>
              <span className="secondary" style={{ fontSize: 13 }}>
                {formatRuntime(plan.split.bottomMin)} {t('di fondo')} + {formatRuntime(plan.split.ascentMin)}{' '}
                {t('di risalita')}
              </span>
            </div>
          </div>
          <div className="runtime-parts">
            <div>
              <span className="tabular">
                {plan.plannedAscentRateMpm === undefined
                  ? '—'
                  : `${plan.plannedAscentRateMpm.toFixed(1)} m/min`}
              </span>
              <small>{t('risalita che ne risulta')}</small>
            </div>
            <div>
              <span className="tabular">{plan.wholeDiveAvgDepthM.toFixed(1)} m</span>
              <small>{t('media dell’intera immersione')}</small>
            </div>
            <div>
              <span className="tabular">{formatRuntime(plan.minTotalMin)}</span>
              <small>{t('durata minima possibile')}</small>
            </div>
          </div>
        </div>

        <TimeSplitBar plan={plan} />

        {/* La media dell'intera immersione è quella che il computer scrive a
            fine immersione: è il numero con cui si verifica il piano dopo
            averlo eseguito, e per questo sta accanto alla velocità ricavata. */}
        <p className="muted" style={{ fontSize: 11, margin: '10px 0 0' }}>
          {t('La risalita non si imposta: si ricava.')}{' '}
          {plan.plannedAscentRateMpm === undefined ? '—' : `${plan.plannedAscentRateMpm.toFixed(1)} m/min`},{' '}
          {t('contro i')} {LIMITS.ascentRateDeepMpm} m/min {t('raccomandati')}.
        </p>
      </div>

      <div className="card">
        <h2>{t('Il profilo pianificato')}</h2>
        {/* Del fondo il piano conosce la media e il punto più profondo, non la
            forma: disegnare una discesa sarebbe inventare un dato che non c'è. */}
        <p className="card-sub">
          {t('Il fondo è disegnato alla sua profondità media. La riga tratteggiata è la massima.')}
        </p>
        <ProfileChart plan={plan} />
        <PhaseTable phases={plan.planned} total={plan.plannedL} tankL={shown.tankL} />
      </div>

      {mode === 'rec' ? (
        <>
          <CurveCard curve={curve} plan={plan} />
          {soste && <SosteCard soste={soste} plan={plan} />}
        </>
      ) : (
        <DecoPlanner
          key={decoKey}
          dives={dives}
          saved={(decoInput as DecoPlanState | null) ?? null}
          onChange={saveDecoInput}
          savedPlans={decoPlans}
          onSavePlan={(name, state) => saveNamedDecoPlan(name, state)}
          onLoadPlan={(state) => {
            saveDecoInput(state);
            setDecoKey((k) => k + 1);
          }}
          onDeletePlan={(name) => deleteNamedDecoPlan(name)}
          seed={{
            depthM: shown.depthM,
            bottomMin: shown.bottomMin,
            mix: shown.mix,
            tankL: shown.tankL,
            startBar: shown.startBar,
            rmvLpm: shown.rmvLpm,
            salinity: shown.salinity,
            maxPpo2: shown.maxPpo2,
          }}
        />
      )}

      <div className="grid grid-tiles">
        <StatTile
          label={input.reserveRule === 'rockBottom' ? t('Gas minimo (rock bottom)') : t('Riserva fissa')}
          value={
            <span className="tabular">
              {plan.reserveBar} <small style={{ fontSize: 14, fontWeight: 500 }}>bar</small>
            </span>
          }
          note={
            input.reserveRule === 'rockBottom'
              ? `${plan.reserveL} L ${t('per riportare')} ${plural(shown.divers, 'persona', 'persone', t)} ${t('in superficie da')} ${shown.depthM} m`
              : t('scelta da te, indipendente dalla profondità')
          }
        />
        {plan.turnBar !== undefined && (
          <StatTile
            label={t('Pressione di rientro')}
            value={
              <span className="tabular">
                {plan.turnBar} <small style={{ fontSize: 14, fontWeight: 500 }}>bar</small>
              </span>
            }
            note={
              input.turnRule === 'thirds'
                ? t('regola dei terzi sul gas utilizzabile')
                : t('metà del gas utilizzabile')
            }
          />
        )}
        <StatTile
          label={t('Uscita prevista')}
          value={
            <span
              className="tabular"
              style={{
                color:
                  plan.expectedEndBar < Math.max(plan.reserveBar, LIMITS.minReserveBar)
                    ? 'var(--critical)'
                    : undefined,
              }}
            >
              {plan.expectedEndBar} <small style={{ fontSize: 14, fontWeight: 500 }}>bar</small>
            </span>
          }
          note={`${t('se tutto va come previsto')} (${plan.plannedL} L)`}
        />
        <StatTile
          label={t('Fondo consentito dal gas')}
          value={
            <span className="tabular" style={{ color: plan.overBudget ? 'var(--critical)' : undefined }}>
              {plan.gasLimitedBottomMin.toFixed(0)}{' '}
              <small style={{ fontSize: 14, fontWeight: 500 }}>min</small>
            </span>
          }
          note={`${plan.overBudget ? t('hai pianificato') : t('pianificati')} ${input.bottomMin} min ${t('a')} ${plan.input.avgDepthM} m ${t('di media')}`}
        />
      </div>

      {plan.warnings.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {/* Il rosso è riservato a "questo piano non si esegue": usarlo anche per
              gli avvisi di contesto insegnerebbe a ignorarli tutti. */}
          {plan.warnings.map((w) => (
            <div key={w.text} className={w.level === 'critical' ? 'notice notice-error' : 'notice'}>
              <strong style={{ fontWeight: 650 }}>
                {w.level === 'critical' ? `${t('Il piano non regge')}: ` : `${t('Da sapere')}: `}
              </strong>
              {w.text}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>{t('Bilancio della bombola')}</h2>
        <p className="card-sub">
          {shown.startBar} bar × {shown.tankL} L = {startL} L {t('a bordo')}.{' '}
          {input.reserveRule === 'rockBottom' ? t('Il gas minimo') : t('La riserva')}{' '}
          {t('non è disponibile: resta ferma se qualcosa va storto.')}
        </p>
        <PressureBudget plan={plan} />
      </div>

      {plan.reserve.length > 0 ? (
        <div className="card">
          <h2>{t('Il gas minimo, fase per fase')}</h2>
          {/* Quattro fasi e non un numero solo perché un numero solo non si può
              controllare. Ogni fase usa la pressione ambiente alla sua
              profondità media; si parte dalla massima perché in emergenza è da
              lì che si risale. */}
          <p className="card-sub">
            {t(
              'Quattro fasi, ognuna con le sue ipotesi. Si parte dalla massima: in emergenza è da lì che si risale.',
            )}
          </p>
          <AscentSchematic plan={plan} />
          <PhaseTable phases={plan.reserve} total={plan.reserveL} tankL={shown.tankL} />
        </div>
      ) : (
        <div className="card">
          <h2>{t('Gas d’emergenza: non calcolato')}</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            {t('Hai scelto la riserva fissa di')} {plan.reserveBar} bar. {t('Per sapere se bastano a')}{' '}
            {shown.depthM} m, {t('accendi «calcola il gas minimo per l’emergenza» qui sopra.')}
          </p>
        </div>
      )}

      <div className="card">
        <div className="page-title-row" style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>{t('Quanti bar devi avere, e quando')}</h2>
          {turnAt !== undefined && (
            <span className="badge">
              {t('rientro a')} {plan.turnBar} bar, {t('minuto')} {turnAt.toFixed(0)}
            </span>
          )}
        </div>
        {/* La pressione di rientro da sola dice se tornare adesso, non se stai
            consumando più del previsto: per quello serve la tabella intera. */}
        <p className="card-sub">
          {t(
            'La pressione che dovresti leggere sul manometro a ogni tappa. Serve ad accorgersi di uno scostamento',
          )}{' '}
          <em>{t('mentre puoi ancora rimediare')}</em>.
        </p>
        <PressureTimeline plan={plan} schedule={schedule} turnAt={turnAt} />
        <ScheduleTable schedule={schedule} plan={plan} turnAt={turnAt} />
        {/*
         * QUESTA TABELLA NON È UNA PROCEDURA STANDARD. La didattica tecnica
         * insegna due cose separate: il *run time schedule* — azione,
         * profondità, sosta, tempo trascorso — che si porta sott'acqua su una
         * lavagnetta e non ha nessuna colonna di pressione, e la *turn
         * pressure*, che è un numero solo. La colonna dei bar è costruita con
         * le formule del manuale (tempo × ATA medi × consumo), ma metterla
         * riga per riga è un'aggiunta nostra e va dichiarata.
         */}
        <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
          {t('La colonna dei bar non fa parte della tabella di risalita che insegnano i corsi: è in più.')}
        </p>
      </div>

      <div className="grid grid-2-fill">
        <div className="card">
          <h2>{t('Se scendi più giù')}</h2>
          {/* La media segue la massima in proporzione, con la stessa funzione
              del modulo: così la curva a 40 m e il campo a 40 m concordano. */}
          <p className="card-sub">{t('Tempo di fondo che il gas consente, al variare della profondità.')}</p>
          <CurveChart
            points={byDepth.map((d) => ({ x: d.x, y: d.bottom }))}
            xLabel="m"
            yLabel="min"
            marker={shown.depthM}
            markerLabel={`${plan.gasLimitedBottomMin.toFixed(0)} min ${t('a')} ${shown.depthM} m`}
            reference={shown.bottomMin}
            referenceLabel={`${t('pianificati')} ${shown.bottomMin} min`}
          />
        </div>
        {input.reserveRule === 'rockBottom' && (
          <div className="card">
            <h2>{t('Gas minimo per profondità')}</h2>
            {/* Cresce più che linearmente perché la risalita è più lunga E ogni
                minuto costa di più: le due cose si moltiplicano. */}
            <p className="card-sub">
              {t(
                'Quanti bar restano bloccati per l’emergenza. Cresce più che linearmente: è quello che una riserva fissa non vede.',
              )}
            </p>
            <CurveChart
              points={byDepth.map((d) => ({ x: d.x, y: d.reserve }))}
              xLabel="m"
              yLabel="bar"
              color="var(--series-2)"
              marker={shown.depthM}
              markerLabel={`${plan.reserveBar} bar`}
              reference={shown.startBar}
              referenceLabel={t('pressione di partenza')}
            />
          </div>
        )}
        <div className="card">
          <h2>{t('Quanto conta il tuo respiro')}</h2>
          {/* La distanza fra mediana e peggiore è la ragione per cui il modulo
              parte dal 75° percentile e non dalla media. */}
          <p className="card-sub">
            {t('A')} {shown.depthM} m, {t('tempo di fondo consentito al variare del consumo.')}
          </p>
          <CurveChart
            points={byRmv}
            xLabel="L/min"
            yLabel="min"
            color="var(--series-3)"
            marker={shown.rmvLpm}
            markerLabel={`${plan.gasLimitedBottomMin.toFixed(0)} min`}
            reference={shown.bottomMin}
            referenceLabel={t('pianificati')}
          />
        </div>
        <div className="card">
          <h2>{t('Esposizione all’ossigeno')}</h2>
          {/* Il CNS è il rischio di crisi convulsiva e si dimezza ogni 90
              minuti in superficie; gli OTU sono il danno polmonare cumulativo e
              non recuperano fra un'immersione e l'altra. Tabelle NOAA come le
              riportano i manuali TDI. */}
          <p className="card-sub">
            {t('Tabelle NOAA. Il CNS si dimezza ogni 90 minuti in superficie, gli OTU no.')}
          </p>
          <div className="grid grid-tiles" style={{ gap: 10 }}>
            <StatTile
              label={t('Orologio CNS')}
              value={
                <span
                  className="tabular"
                  style={{ color: plan.oxygen.cnsPercent >= 100 ? 'var(--critical)' : undefined }}
                >
                  {plan.oxygen.cnsPercent.toFixed(0)}%
                </span>
              }
              note={t('di questa immersione, sul limite del 100%')}
            />
            <StatTile
              label="OTU"
              value={<span className="tabular">{plan.oxygen.otu.toFixed(0)}</span>}
              note={`${t('dose giornaliera di riferimento')} ${OTU_DAILY_TDI}`}
            />
            <StatTile
              label={t('Tempo sopra 1.4 bar')}
              value={<span className="tabular">{plan.oxygen.minutesAbove14.toFixed(0)} min</span>}
              note={
                plan.oxygen.minutesAbove16 > 0
                  ? `${t('di cui')} ${plan.oxygen.minutesAbove16.toFixed(0)} ${t('sopra 1.6')}`
                  : t('mai sopra 1.6')
              }
            />
          </div>
        </div>

        <div className="card">
          <h2>{t('Ossigeno e narcosi')}</h2>
          <p className="card-sub">
            {mixName(shown.mix)} {t('a')} {shown.depthM} m{' '}
            {shown.salinity === 'salt' ? t('in mare') : t('in lago')}.
          </p>
          <div className="grid grid-tiles" style={{ gap: 10 }}>
            <StatTile
              label={t('PPO2 al fondo')}
              value={
                <span
                  className="tabular"
                  style={{ color: plan.ppo2AtDepth > shown.maxPpo2 ? 'var(--critical)' : undefined }}
                >
                  {plan.ppo2AtDepth.toFixed(2)}
                </span>
              }
              note={`${t('limite impostato')} ${shown.maxPpo2.toFixed(1)} bar`}
            />
            <StatTile
              label={t('Profondità massima operativa')}
              value={<span className="tabular">{plan.modWorkM.toFixed(1)} m</span>}
              note={`${t('a 1.4 bar')} · ${plan.modDecoM.toFixed(1)} m ${t('a 1.6 in deco')}`}
            />
            <StatTile
              label={t('Miscela migliore per questa profondità')}
              value={<span className="tabular">EAN{Math.round(plan.bestMixO2 * 100)}</span>}
              /* Fg = 1.4 / pressione assoluta alla massima, troncato in giù:
                 arrotondare per eccesso sforerebbe la ppO2 di un soffio. */
              note={`${t('per 1.4 bar a')} ${shown.depthM} m`}
            />
            <StatTile
              label={t('Azoto e narcosi')}
              value={<span className="tabular">{plan.ppn2AtDepth.toFixed(2)} ata</span>}
              note={`END ${plan.endM.toFixed(0)} m · ${t('accettabile fino a 5.21 ata')}`}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>{t('Il piano contro la realtà')}</h2>
        {/* È la parte che un pianificatore generico non può avere: il confronto
            con l'archivio. Se il piano promette un'uscita più generosa di
            quelle vere, il consumo usato è ottimista. */}
        <p className="card-sub">
          {t(
            'Come sono andate le tue immersioni a profondità simile (±5 m). Se il piano promette di più, è ottimista.',
          )}
        </p>
        {similar.n === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            {t('Nessuna immersione simile con la pressione d’uscita: niente da confrontare.')}
          </p>
        ) : (
          <>
            <div className="grid grid-tiles">
              <StatTile
                label={t('Immersioni simili')}
                value={<span className="tabular">{similar.n}</span>}
                note={
                  similar.byDurationToo
                    ? `${t('intorno ai')} ${shown.depthM} m ${t('e ai')} ${Math.round(plan.totalRuntimeMin)} min`
                    : `${t('intorno ai')} ${shown.depthM} m — ${t('troppo poche per filtrare sulla durata')}`
                }
              />
              <StatTile
                label={t('Uscita tipica')}
                value={<span className="tabular">{similar.medianEndBar} bar</span>}
                note={`${t('il piano prevede')} ${plan.expectedEndBar} bar`}
              />
              <StatTile
                label={t('Uscita più bassa')}
                value={
                  <span
                    className="tabular"
                    style={{
                      color:
                        (similar.minEndBar ?? 999) < LIMITS.minReserveBar ? 'var(--warning-text)' : undefined,
                    }}
                  >
                    {similar.minEndBar} bar
                  </span>
                }
                note={
                  similar.belowReserve > 0
                    ? `${similar.belowReserve} ${t('sotto i')} ${LIMITS.minReserveBar} bar ${t('di riserva')}`
                    : `${t('mai sotto i')} ${LIMITS.minReserveBar} bar`
                }
              />
              <StatTile
                label={t('Durata tipica')}
                value={<span className="tabular">{similar.medianDurationMin} min</span>}
                note={`${t('il piano dura')} ${formatRuntime(plan.totalRuntimeMin)}`}
              />
            </div>
            {similar.medianEndBar !== undefined && plan.expectedEndBar > similar.medianEndBar + 15 && (
              <div className="notice" style={{ marginTop: 12 }}>
                {t('Il piano esce con')} {plan.expectedEndBar} bar, {t('ma di solito esci con')}{' '}
                {similar.medianEndBar}. {t('Prova a pianificare col consumo peggiore.')}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>{t('E se…')}</h2>
        {/* Sono gli schedule di contingenza che la didattica chiede di avere in
            tasca prima di entrare: lo stesso piano con un parametro cambiato. */}
        <p className="card-sub">
          {t(
            'Lo stesso piano con un parametro cambiato. «E se resto giù cinque minuti in più» va chiesto adesso, non a quaranta metri.',
          )}
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('Scenario')}</th>
                <th style={{ textAlign: 'right' }}>{t('Uscita prevista')}</th>
                <th style={{ textAlign: 'right' }}>{t('Differenza')}</th>
                <th>{t('Cosa cambia')}</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((c) => (
                <tr key={c.label}>
                  <td>
                    <div className="row" style={{ gap: 7 }}>
                      <span className={`dot ${c.fits ? 'dot-good' : 'dot-critical'}`} />
                      <span style={{ fontWeight: 550 }}>{t(c.label)}</span>
                    </div>
                  </td>
                  <td
                    className="num tabular"
                    style={{
                      textAlign: 'right',
                      fontWeight: 650,
                      color: c.fits ? undefined : 'var(--critical)',
                    }}
                  >
                    {c.plan.expectedEndBar} bar
                  </td>
                  <td className="num tabular muted" style={{ textAlign: 'right' }}>
                    {c.endBarDelta > 0 ? `+${c.endBarDelta}` : c.endBarDelta}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {t(c.change)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Rosso non vuol dire vietato: vuol dire che se succede il piano
            cambia, e va saputo prima di entrare in acqua. */}
        <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
          {t('Il pallino rosso: quello scenario consuma la riserva.')}
        </p>
      </div>

      <div className="card">
        <h2>{t('Prima di scendere')}</h2>
        <p className="card-sub">
          {t('Il controllo in cinque lettere, da fare in superficie insieme al compagno.')}
        </p>
        <div className="stack" style={{ gap: 10 }}>
          {[
            ['S — Drill', t('Prova dell’esaurimento gas e controllo bolle, erogatore di scorta in mano.')],
            ['T — Team', t('Controllo incrociato: chi ha cosa, dove, e come si apre.')],
            [
              'A — Aria',
              plan.turnBar !== undefined
                ? `${t('Pressione di rientro di ciascuno, detta ad alta voce: la tua è')} ${plan.turnBar} bar${turnAt !== undefined ? `, ${t('minuto')} ${turnAt.toFixed(0)}` : ''}.`
                : t('Pressione di rientro di ciascuno, detta ad alta voce. Qui non ne hai scelta una.'),
            ],
            ['R — Rotta', t('Dove si entra, dove si esce, che giro si fa e da che parte si torna.')],
            [
              'T — Tabelle',
              `${t('Massima')} ${shown.depthM} m, ${formatRuntime(plan.totalRuntimeMin)}, ${plan.split.stopsMin.toFixed(0)} ${t('minuti di sosta')}${plan.deco ? `, ${mixName(plan.deco.mix)} ${t('da')} ${plan.deco.switchDepthM.toFixed(0)} m` : ''}.`,
            ],
          ].map(([letter, text]) => (
            <div key={letter} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontWeight: 700, minWidth: 78, fontSize: 13 }}>{t(letter)}</span>
              <span className="secondary" style={{ fontSize: 13 }}>
                {text}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/*
       * LE NOTE, E PERCHÉ SONO CORTE.
       *
       * Quello che segue è il *perché* di ogni riga dell'elenco qui sotto. Sta
       * in un commento e non a schermo: chi apre il pianificatore vuole sapere
       * di quanto può fidarsi del numero, non leggere la giustificazione di
       * ogni scelta di modello.
       *
       *  - LE SOSTE. Bühlmann ZH-L16C con gradient factor, lo stesso modello
       *    del computer, confrontato con quello che lo Shearwater ha calcolato
       *    al polso su 38 immersioni vere: scarto medio 0,79 punti di GF99,
       *    massimo 2,6. In ricreativa le soste compaiono quando il piano esce
       *    dalla curva; in tecnica c'è la tabella completa con i cambi di gas e
       *    il bailout. Restano un piano, non un permesso: in acqua ha ragione
       *    il computer, che ricalcola sul profilo fatto davvero.
       *
       *  - LA MEDIA DI FASE non è un'approssimazione. La pressione ambiente è
       *    affine nella profondità, quindi la sua media nel tempo è esattamente
       *    il valore alla profondità media. Da qui discende anche che la
       *    velocità di discesa non serve chiederla: non cambia nessun risultato.
       *
       *  - L'END CONTA NARCOTICO ANCHE L'OSSIGENO. È la convenzione della
       *    didattica tecnica — «non immergerti col nitrox più in profondità di
       *    quanto faresti con l'aria» — e per una miscela senza elio l'END
       *    coincide con la profondità. La convenzione opposta, che conta solo
       *    l'azoto, dice che col nitrox sei meno narcotizzato: è la meno
       *    prudente delle due, e qui si sceglie la più prudente.
       *
       *  - LA FORMA DEL FONDO non entra nel gas — due profili con la stessa
       *    media consumano uguale — ma entra nella decompressione: le soste
       *    sono calcolate sul fondo alla profondità MEDIA, e un profilo che
       *    passa più tempo in fondo ne chiederà di più.
       *
       *  - I TERZI presuppongono un ritorno obbligato. Su un'immersione lineare
       *    con risalita libera sono più severi del necessario: lì il numero
       *    utile è il gas minimo, non la pressione di rientro.
       */}
      <div className="card">
        <h2>{t('Note')}</h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)' }}>
          <li>
            <strong>{t('Le soste le calcola.')}</strong>{' '}
            {t(
              'Bühlmann ZH-L16C con gradient factor, come il tuo computer. Restano un piano: in acqua ha ragione lui.',
            )}
          </li>
          <li>{t('Il gas di ogni fase è calcolato alla sua profondità media.')}</li>
          <li>
            {t(
              'La profondità narcotica equivalente (END) conta narcotico anche l’ossigeno: è la convenzione più prudente.',
            )}
          </li>
          <li>
            {t(
              'Le soste sono calcolate sul fondo alla profondità media: un profilo più profondo ne chiede di più.',
            )}
          </li>
          <li>{t('La regola dei terzi vale se il ritorno è obbligato. Altrimenti conta il gas minimo.')}</li>
          <li>
            {t('Consumo misurato su')} {rmv.n} {t('immersioni su')} {scope.dives.length} {t('del periodo')},{' '}
            {dives.length} {t('in archivio')}.
          </li>
        </ul>
      </div>
    </div>
  );
}

/**
 * Apre la finestra di stampa del piano.
 *
 * Restituisce `false` quando il blocco dei popup l'ha rifiutata: è l'unico modo
 * in cui questa operazione può fallire, e chi chiama lo dice invece di lasciare
 * un pulsante che non fa niente.
 */
function apriStampaPiano(foglio: FoglioPiano): boolean {
  const finestra = window.open('', '_blank');
  if (!finestra) return false;
  finestra.document.open();
  finestra.document.write(pianoHtml(foglio));
  finestra.document.close();
  // Chiedere la stampa di un documento non ancora impaginato produce un foglio
  // vuoto: si aspetta che sia pronto, gestendo entrambi i casi.
  const stampa = () => {
    finestra.focus();
    finestra.print();
  };
  if (finestra.document.readyState === 'complete') stampa();
  else finestra.addEventListener('load', stampa, { once: true });
  return true;
}

// ---------------------------------------------------------------------------
// Campi
// ---------------------------------------------------------------------------

function NumField({
  label,
  unit,
  value,
  onChange,
  step = 1,
  min,
  max,
  hint,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
}) {
  return (
    <label className="planner-field">
      <span className="planner-label">
        {label}
        {unit && <span className="muted"> ({unit})</span>}
      </span>
      {/* Il comportamento del campo, e i due difetti che ha chiuso, stanno in
          `InputNumerico`. Qui resta solo l'etichetta. */}
      <InputNumerico value={value} onChange={onChange} min={min} max={max} step={step} />
      {hint && <span className="planner-hint">{hint}</span>}
    </label>
  );
}

/**
 * Le bombole che si usano davvero, così il numero non va digitato ogni volta.
 *
 * Costanti di modulo, non ricostruite a ogni render: le etichette restano in
 * italiano qui e passano da `t()` al disegno.
 */
const TANK_PRESETS: { label: string; litres: number }[] = [
  { label: '10 L', litres: 10 },
  { label: '12 L', litres: 12 },
  { label: '15 L', litres: 15 },
  { label: '18 L', litres: 18 },
  { label: '2×12', litres: 24 },
  { label: '2×15', litres: 30 },
];

/** Come sopra: costante, tradotta al disegno. */
const MIX_PRESETS: { label: string; mix: GasMix }[] = [
  { label: 'Aria', mix: { o2: 0.21, he: 0 } },
  { label: 'EAN32', mix: { o2: 0.32, he: 0 } },
  { label: 'EAN36', mix: { o2: 0.36, he: 0 } },
  { label: 'Tx 21/35', mix: { o2: 0.21, he: 0.35 } },
];

function MixField({ mix, onChange }: { mix: GasMix; onChange: (m: GasMix) => void }) {
  const { t } = useLingua();
  const pct = (v: number) => Math.round(v * 100);
  return (
    <div className="planner-field">
      <span className="planner-label">
        {t('Miscela')} <span className="muted">({mixName(mix)})</span>
      </span>
      <div className="row" style={{ gap: 6 }}>
        <InputNumerico
          ariaLabel={t('Ossigeno, percento')}
          value={pct(mix.o2)}
          min={8}
          max={100}
          step={1}
          onChange={(v) => {
            const o2 = v / 100;
            onChange({ o2, he: Math.min(mix.he, Math.max(0, 1 - o2)) });
          }}
          style={{ width: 64 }}
        />
        <span className="muted" style={{ fontSize: 12 }}>
          O₂
        </span>
        <InputNumerico
          ariaLabel={t('Elio, percento')}
          value={pct(mix.he)}
          min={0}
          max={80}
          step={1}
          onChange={(v) => {
            const he = v / 100;
            onChange({ o2: Math.min(mix.o2, Math.max(0.08, 1 - he)), he });
          }}
          style={{ width: 64 }}
        />
        <span className="muted" style={{ fontSize: 12 }}>
          He
        </span>
      </div>
      <div className="row" style={{ gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
        {MIX_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.mix)}
            aria-pressed={p.mix.o2 === mix.o2 && p.mix.he === mix.he}
            style={{ fontSize: 11, padding: '3px 7px' }}
          >
            {t(p.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bilancio della bombola
// ---------------------------------------------------------------------------

/**
 * La bombola vista come una barra di pressione, dall'alto in basso: il gas
 * utilizzabile diviso in terzi, il gas minimo bloccato in fondo, e i due segni
 * che contano — dove girare e dove il piano prevede di uscire.
 *
 * È il grafico che rende la regola dei terzi una cosa che si vede: la riserva non
 * è "un po' di gas alla fine", è una fetta che parte da zero e sale.
 */
function PressureBudget({ plan }: { plan: GasPlan }) {
  const { t } = useLingua();
  const { ref, width } = useWidth<HTMLDivElement>();
  // Due segni sulla barra, uno sopra e uno sotto: quando cadono vicini le
  // etichette si sovrapponevano, e su questa barra i due numeri che si
  // confrontano sono proprio quelli.
  const height = 116;
  const pad = { left: 8, right: 8, top: 30, bottom: 46 };
  const trackH = height - pad.top - pad.bottom;
  const w = Math.max(10, width - pad.left - pad.right);
  // Mai zero: con una pressione di partenza nulla ogni coordinata dell'SVG
  // diventava NaN e il grafico spariva senza dire perché.
  const start = Math.max(1, plan.input.startBar);
  const x = (bar: number) => pad.left + (Math.max(0, Math.min(start, bar)) / start) * w;

  const usable = plan.usableBar;
  const reserveLabel = plan.input.reserveRule === 'rockBottom' ? t('gas minimo') : t('riserva');
  const reserveBand = {
    from: 0,
    to: plan.reserveBar,
    fill: 'var(--series-2-wash)',
    stroke: 'var(--series-2)',
    label: reserveLabel,
  };
  // Le fasce dell'utilizzabile seguono la regola scelta: con i terzi sono tre, con
  // la metà due, senza regola una sola. Disegnare tre fasce a chi ha scelto la
  // riserva fissa mostrerebbe una regola che non ha chiesto.
  const parts =
    plan.input.turnRule === 'thirds'
      ? [
          { label: t('margine'), fill: 'var(--seq-100)' },
          { label: t('ritorno'), fill: 'var(--seq-250)' },
          { label: t('andata'), fill: 'var(--seq-450)' },
        ]
      : plan.input.turnRule === 'half'
        ? [
            { label: t('ritorno'), fill: 'var(--seq-250)' },
            { label: t('andata'), fill: 'var(--seq-450)' },
          ]
        : [{ label: t('utilizzabile'), fill: 'var(--seq-450)' }];
  const step = usable / parts.length;
  const bands = [
    reserveBand,
    ...parts.map((p, i) => ({
      from: plan.reserveBar + i * step,
      to: plan.reserveBar + (i + 1) * step,
      fill: p.fill,
      stroke: 'transparent',
      label: p.label,
    })),
  ];

  const marks = [
    ...(plan.turnBar !== undefined
      ? [{ bar: plan.turnBar, label: `${t('rientro')} ${plan.turnBar}`, color: 'var(--text-primary)' }]
      : []),
    {
      bar: plan.expectedEndBar,
      label: `${t('uscita prevista')} ${plan.expectedEndBar}`,
      color:
        plan.expectedEndBar < Math.max(plan.reserveBar, LIMITS.minReserveBar)
          ? 'var(--critical)'
          : 'var(--good-text)',
    },
  ].filter((m) => m.bar > 0 && m.bar < start);

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
        {bands.map((b) => {
          const bw = Math.max(0, x(b.to) - x(b.from));
          if (bw < 0.5) return null;
          return (
            <g key={b.label}>
              <rect
                x={x(b.from)}
                y={pad.top}
                width={bw}
                height={trackH}
                fill={b.fill}
                stroke={b.stroke}
                strokeWidth={1}
              />
              {bw > 60 && (
                <text
                  x={x(b.from) + bw / 2}
                  y={pad.top + trackH / 2 + 4}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--text-primary)"
                >
                  {b.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Scala in bar: zero a sinistra, partenza a destra. */}
        {[0, Math.round(start / 2), start].map((tacca) => (
          <text
            key={tacca}
            className="axis-label"
            x={x(tacca)}
            y={height - 6}
            textAnchor={tacca === 0 ? 'start' : tacca === start ? 'end' : 'middle'}
          >
            {tacca} bar
          </text>
        ))}

        {marks.map((m, i) => (
          <g key={m.label}>
            <line
              x1={x(m.bar)}
              x2={x(m.bar)}
              y1={pad.top - 7}
              y2={pad.top + trackH + 7}
              stroke={m.color}
              strokeWidth={1.5}
            />
            <text
              x={Math.min(width - 4, Math.max(4, x(m.bar)))}
              y={i === 0 ? pad.top - 11 : pad.top + trackH + 19}
              textAnchor={x(m.bar) > width * 0.75 ? 'end' : x(m.bar) < width * 0.25 ? 'start' : 'middle'}
              fontSize={10}
              fontWeight={650}
              fill={m.color}
            >
              {m.label}
            </text>
          </g>
        ))}
      </svg>
      <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
        {t('Utilizzabile')} {plan.usableBar} bar ({plan.usableL} L) {t('sui')} {start} {t('di partenza')}.
        {plan.input.turnRule !== 'none' &&
          ` ${t('Ogni')} ${plan.input.turnRule === 'thirds' ? t('terzo') : t('metà')} ${t('vale')} ${Math.round(step)} bar.`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schema della risalita d'emergenza
// ---------------------------------------------------------------------------

/**
 * Le quattro fasi disegnate come profilo: tempo in orizzontale, profondità in
 * verticale, e i litri scritti dentro la fascia che li consuma. Confrontare
 * l'area col numero è il modo più rapido di accorgersi di un'ipotesi sbagliata —
 * una sosta di sicurezza che costa più della risalita, per esempio.
 */
function AscentSchematic({ plan }: { plan: GasPlan }) {
  const { t } = useLingua();
  const { ref, width } = useWidth<HTMLDivElement>();
  const height = 190;
  const pad = { left: 34, right: 10, top: 14, bottom: 30 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const total = plan.reserve.reduce((a, p) => a + p.minutes, 0) || 1;
  const maxD = Math.max(1, plan.input.depthM);
  const x = (min: number) => pad.left + (min / total) * plotW;
  const y = (d: number) => pad.top + (d / maxD) * plotH;

  const segments = ascentGeometry(plan);

  return (
    <div className="chart" ref={ref}>
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

        {segments.map((s, i) => {
          const w = Math.max(1, x(s.endMin) - x(s.startMin));
          const area = [
            `M${x(s.startMin)},${y(s.fromM)}`,
            `L${x(s.endMin)},${y(s.toM)}`,
            `L${x(s.endMin)},${y(0)}`,
            `L${x(s.startMin)},${y(0)}`,
            'Z',
          ].join(' ');
          const midY = y((s.fromM + s.toM) / 2);
          return (
            <g key={s.phase.label}>
              <path d={area} fill="var(--series-1)" opacity={0.1 + i * 0.05} />
              <line
                x1={x(s.startMin)}
                x2={x(s.startMin)}
                y1={pad.top}
                y2={y(0)}
                stroke="var(--axis)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <line
                x1={x(s.startMin)}
                x2={x(s.endMin)}
                y1={y(s.fromM)}
                y2={y(s.toM)}
                stroke="var(--series-1)"
                strokeWidth={2}
              />
              {w > 34 && (
                <text
                  x={x(s.startMin) + w / 2}
                  y={Math.max(pad.top + 10, midY - 8)}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={650}
                  fill="var(--text-primary)"
                >
                  {s.phase.litres} L
                </text>
              )}
              {w > 34 && (
                <text
                  x={x(s.startMin) + w / 2}
                  y={height - 16}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--text-muted)"
                >
                  {s.phase.minutes.toFixed(s.phase.minutes < 1 ? 1 : 0)}′
                </text>
              )}
            </g>
          );
        })}

        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth={1} />
        <text className="axis-label" x={pad.left} y={height - 3} textAnchor="start">
          m ↓ · {total.toFixed(0)} {t('min di risalita')}
        </text>
        <text className="axis-label" x={width - pad.right} y={height - 3} textAnchor="end">
          {plan.reserveL} L {t('in totale')}
        </text>
      </svg>
    </div>
  );
}

function PhaseTable({ phases, total, tankL }: { phases: GasPhase[]; total: number; tankL: number }) {
  const { t } = useLingua();
  return (
    <div className="table-scroll" style={{ marginTop: 12 }}>
      <table>
        <thead>
          <tr>
            <th>{t('Fase')}</th>
            <th style={{ textAlign: 'right' }}>{t('Durata')}</th>
            <th style={{ textAlign: 'right' }}>{t('Prof. media')}</th>
            <th style={{ textAlign: 'right' }}>ATA</th>
            <th style={{ textAlign: 'right' }}>L/min</th>
            <th style={{ textAlign: 'right' }}>{t('Persone')}</th>
            <th style={{ textAlign: 'right' }}>{t('Litri')}</th>
          </tr>
        </thead>
        <tbody>
          {phases.map((p) => (
            <tr key={p.label}>
              <td>{t(p.label)}</td>
              <td className="tabular" style={{ textAlign: 'right' }}>
                {p.minutes.toFixed(p.minutes < 10 ? 1 : 0)} min
              </td>
              <td className="tabular" style={{ textAlign: 'right' }}>
                {p.meanDepthM.toFixed(1)} m
              </td>
              <td className="tabular" style={{ textAlign: 'right' }}>
                {p.meanAta.toFixed(2)}
              </td>
              <td className="tabular" style={{ textAlign: 'right' }}>
                {p.rmvLpm}
              </td>
              <td className="tabular" style={{ textAlign: 'right' }}>
                {p.divers}
              </td>
              <td className="tabular" style={{ textAlign: 'right', fontWeight: 600 }}>
                {p.litres}
              </td>
            </tr>
          ))}
          <tr>
            <td style={{ fontWeight: 650 }}>{t('Totale')}</td>
            <td colSpan={5} className="muted" style={{ textAlign: 'right', fontSize: 12 }}>
              {t('su una bombola da')} {tankL} L
            </td>
            <td className="tabular" style={{ textAlign: 'right', fontWeight: 700 }}>
              {total} L · {Math.ceil(total / tankL)} bar
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Come si distribuisce la durata dell'immersione: fondo, transito, soste.
 *
 * Una barra e non tre numeri perché la domanda vera non è "quanti minuti dura la
 * risalita" ma "che fetta dell'immersione è". Su un'immersione profonda e corta la
 * risalita è metà del tempo, e vederlo cambia il piano.
 */
function TimeSplitBar({ plan }: { plan: GasPlan }) {
  const { t } = useLingua();
  const { ref, width } = useWidth<HTMLDivElement>();
  const total = Math.max(0.1, plan.totalRuntimeMin);
  const parts = [
    { label: t('fondo'), min: plan.split.bottomMin, fill: 'var(--seq-450)' },
    { label: t('risalita'), min: plan.split.travelMin, fill: 'var(--seq-250)' },
    { label: t('soste'), min: plan.split.stopsMin, fill: 'var(--seq-100)' },
  ].filter((p) => p.min > 0);

  const height = 58;
  const barH = 26;
  let x = 0;

  return (
    <div className="chart" ref={ref} style={{ marginTop: 14 }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
        {parts.map((p) => {
          const w = (p.min / total) * width;
          const left = x;
          x += w;
          return (
            <g key={p.label}>
              <rect x={left} y={0} width={Math.max(0, w - 1)} height={barH} fill={p.fill} rx={3} />
              {w > 64 && (
                <text
                  x={left + w / 2}
                  y={barH / 2 + 4}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--text-primary)"
                >
                  {p.label}
                </text>
              )}
              {w > 40 && (
                <text
                  x={left + w / 2}
                  y={barH + 16}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={650}
                  fill="var(--text-secondary)"
                >
                  {formatRuntime(p.min)}
                </text>
              )}
              {w > 40 && (
                <text
                  x={left + w / 2}
                  y={barH + 30}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--text-muted)"
                >
                  {Math.round((p.min / total) * 100)}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Il profilo pianificato: profondità contro tempo, con i litri di ogni fase.
 *
 * Il tempo di fondo è un blocco alla profondità media con la massima tratteggiata
 * sopra, perché è esattamente quello che il piano sa: la media e il punto più
 * profondo. Disegnare una discesa e un fondo piatto sarebbe inventare una forma
 * che nessuno ha dichiarato — e siccome il gas dipende solo dalla media, quella
 * forma non esiste nemmeno nel calcolo.
 */
function ProfileChart({ plan }: { plan: GasPlan }) {
  const { t } = useLingua();
  const { ref, width } = useWidth<HTMLDivElement>();
  const height = 220;
  const pad = { left: 36, right: 12, top: 16, bottom: 34 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const segments = phaseGeometry(plan.planned);
  const total = Math.max(0.1, plan.totalRuntimeMin);
  const maxD = Math.max(1, plan.input.depthM);
  const x = (min: number) => pad.left + (min / total) * plotW;
  const y = (d: number) => pad.top + (d / maxD) * plotH;

  return (
    <div className="chart" ref={ref}>
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

        {/* La massima: dichiarata, ma non raggiunta da nessuna linea del disegno. */}
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={y(maxD)}
          y2={y(maxD)}
          stroke="var(--series-2)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
        <text
          className="axis-label"
          x={width - pad.right}
          y={y(maxD) - 5}
          textAnchor="end"
          fill="var(--series-2)"
        >
          {t('massima')} {plan.input.depthM} m
        </text>

        {segments.map((s, i) => {
          const w = Math.max(0, x(s.endMin) - x(s.startMin));
          if (w <= 0) return null;
          const area = [
            `M${x(s.startMin)},${y(s.fromM)}`,
            `L${x(s.endMin)},${y(s.toM)}`,
            `L${x(s.endMin)},${y(0)}`,
            `L${x(s.startMin)},${y(0)}`,
            'Z',
          ].join(' ');
          return (
            <g key={`${s.phase.label}-${i}`}>
              <path d={area} fill="var(--series-1)" opacity={0.1 + i * 0.04} />
              <line
                x1={x(s.startMin)}
                x2={x(s.endMin)}
                y1={y(s.fromM)}
                y2={y(s.toM)}
                stroke="var(--series-1)"
                strokeWidth={2.5}
              />
              {w > 44 && (
                <text
                  x={x(s.startMin) + w / 2}
                  y={Math.max(pad.top + 10, y((s.fromM + s.toM) / 2) - 8)}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={650}
                  fill="var(--text-primary)"
                >
                  {s.phase.litres} L
                </text>
              )}
              {w > 44 && (
                <text
                  x={x(s.startMin) + w / 2}
                  y={height - 18}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--text-muted)"
                >
                  {formatRuntime(s.phase.minutes)}
                </text>
              )}
            </g>
          );
        })}

        {/* La media dell'intera immersione: una riga sola, che dopo l'immersione si
            confronta con quella che scrive il computer. */}
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={y(plan.wholeDiveAvgDepthM)}
          y2={y(plan.wholeDiveAvgDepthM)}
          stroke="var(--text-muted)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        <text className="axis-label" x={pad.left + 2} y={y(plan.wholeDiveAvgDepthM) - 4} textAnchor="start">
          {t('media')} {plan.wholeDiveAvgDepthM.toFixed(1)} m
        </text>

        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth={1} />
        <text className="axis-label" x={pad.left} y={height - 4} textAnchor="start">
          m ↓
        </text>
        <text className="axis-label" x={width - pad.right} y={height - 4} textAnchor="end">
          {formatRuntime(plan.totalRuntimeMin)} {t('in tutto')} · {plan.plannedL} L
        </text>
      </svg>
    </div>
  );
}

/**
 * La pressione attesa nel tempo, con la profondità sotto.
 *
 * Due grandezze sullo stesso asse dei tempi, non sovrapposte: la pressione sopra,
 * il profilo sotto, allineati. Sovrapporle su due assi Y suggerirebbe una
 * relazione che c'è ma non è quella che si legge — la pendenza della pressione
 * dipende dalla profondità, e affiancarle lo mostra senza doverlo scrivere.
 */
function PressureTimeline({
  plan,
  schedule,
  turnAt,
}: {
  plan: GasPlan;
  schedule: SchedulePoint[];
  turnAt?: number;
}) {
  const { t } = useLingua();
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  useDismissOnLeave(() => setTip(null));

  const height = 200;
  const pad = { left: 40, right: 44, top: 14, bottom: 26 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const barH = (height - pad.top - pad.bottom) * 0.62;
  const depthH = (height - pad.top - pad.bottom) * 0.38;
  const total = Math.max(0.1, plan.totalRuntimeMin);
  const start = Math.max(1, plan.input.startBar);

  const x = (min: number) => pad.left + (min / total) * plotW;
  const yBar = (bar: number) => pad.top + barH - (bar / start) * barH;
  const maxD = Math.max(1, plan.input.depthM);
  const yDepth = (d: number) => pad.top + barH + 10 + (d / maxD) * (depthH - 10);

  const line = schedule
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.runMin).toFixed(1)},${yBar(p.bar).toFixed(1)}`)
    .join(' ');
  const depthLine = schedule
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.runMin).toFixed(1)},${yDepth(p.depthM).toFixed(1)}`)
    .join(' ');

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const at = ((e.clientX - box.left - pad.left) / plotW) * total;
          let best = schedule[0];
          for (const p of schedule) if (Math.abs(p.runMin - at) < Math.abs(best.runMin - at)) best = p;
          setTip({
            x: x(best.runMin),
            y: yBar(best.bar),
            title: `${t('minuto')} ${best.runMin}`,
            rows: [
              { label: t('pressione attesa'), value: `${best.bar} bar` },
              { label: t('profondità'), value: `${best.depthM} m` },
              { label: t('fase'), value: t(best.phase) },
            ],
          });
        }}
        onPointerLeave={() => setTip(null)}
        /* Vedi `DepthProfile`: scorrere la pagina non deve aprire un riquadro. */
        onPointerCancel={() => setTip(null)}
      >
        {/* La riserva: la fascia in cui il piano non deve entrare. */}
        <rect
          x={pad.left}
          y={yBar(plan.reserveBar)}
          width={plotW}
          height={Math.max(0, pad.top + barH - yBar(plan.reserveBar))}
          fill="var(--series-2-wash)"
        />
        <text
          className="axis-label"
          x={width - pad.right + 4}
          y={yBar(plan.reserveBar) + 10}
          fill="var(--series-2)"
        >
          {t('riserva')}
        </text>

        {[0, Math.round(start / 2), start].map((b) => (
          <g key={b}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={yBar(b)}
              y2={yBar(b)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text className="axis-label" x={pad.left - 6} y={yBar(b) + 3} textAnchor="end">
              {b}
            </text>
          </g>
        ))}

        {turnAt !== undefined && plan.turnBar !== undefined && (
          <g>
            <line
              x1={x(turnAt)}
              x2={x(turnAt)}
              y1={pad.top}
              y2={pad.top + barH}
              stroke="var(--text-primary)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text
              x={x(turnAt) + 4}
              y={pad.top + 10}
              fontSize={10}
              fontWeight={650}
              fill="var(--text-primary)"
            >
              {t('rientro')} {plan.turnBar}
            </text>
          </g>
        )}

        <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2.5} strokeLinejoin="round" />
        {schedule
          .filter((p) => p.boundary)
          .map((p) => (
            <circle key={`b${p.runMin}`} cx={x(p.runMin)} cy={yBar(p.bar)} r={3} fill="var(--series-1)" />
          ))}

        {/* Il profilo, sotto e allineato: la pressione scende più in fretta dove
            la traccia sta in basso, e i due disegni lo mostrano insieme. */}
        <path
          d={`${depthLine} L${x(total).toFixed(1)},${yDepth(0).toFixed(1)} L${x(0).toFixed(1)},${yDepth(0).toFixed(1)} Z`}
          fill="var(--series-1)"
          opacity={0.12}
        />
        <path d={depthLine} fill="none" stroke="var(--series-1)" strokeWidth={1.5} opacity={0.7} />
        <text className="axis-label" x={pad.left - 6} y={yDepth(maxD)} textAnchor="end">
          {Math.round(maxD)}
        </text>

        {[0, total / 2, total].map((tacca) => (
          <text key={tacca} className="axis-label" x={x(tacca)} y={height - 6} textAnchor="middle">
            {Math.round(tacca)} min
          </text>
        ))}
        <text className="axis-label" x={width - pad.right + 4} y={pad.top + 8} fill="var(--text-muted)">
          bar
        </text>
      </svg>
      <Tooltip state={tip} containerWidth={width} />
    </div>
  );
}

/**
 * La tabella da portare in acqua.
 *
 * Le colonne sono quelle del run time schedule della didattica — azione,
 * profondità, tempo trascorso — più quella delle pressioni, che è l'aggiunta di
 * questa app. Le righe di confine fra una fase e l'altra sono in evidenza: sono
 * i momenti in cui succede qualcosa, il resto è riempimento regolare.
 */
function ScheduleTable({
  schedule,
  plan,
  turnAt,
}: {
  schedule: SchedulePoint[];
  plan: GasPlan;
  turnAt?: number;
}) {
  const { t } = useLingua();
  return (
    <div className="table-scroll" style={{ marginTop: 12 }}>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'right' }}>{t('Minuto')}</th>
            <th style={{ textAlign: 'right' }}>{t('Profondità')}</th>
            <th style={{ textAlign: 'right' }}>{t('Pressione attesa')}</th>
            <th style={{ textAlign: 'right' }}>{t('Consumati')}</th>
            <th>{t('Cosa stai facendo')}</th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((p) => {
            const belowReserve = p.bar < plan.reserveBar;
            const atTurn = turnAt !== undefined && Math.abs(p.runMin - turnAt) < 0.51;
            return (
              <tr key={`${p.runMin}-${p.phase}`}>
                <td
                  className="num tabular"
                  style={{ textAlign: 'right', fontWeight: p.boundary ? 700 : 400 }}
                >
                  {p.runMin}
                </td>
                <td className="num tabular" style={{ textAlign: 'right' }}>
                  {p.depthM} m
                </td>
                <td
                  className="num tabular"
                  style={{
                    textAlign: 'right',
                    fontWeight: 650,
                    color: belowReserve ? 'var(--critical)' : undefined,
                  }}
                >
                  {p.bar} bar
                </td>
                <td className="num tabular muted" style={{ textAlign: 'right' }}>
                  {p.litres} L
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {t(p.phase)}
                  {atTurn && (
                    <span className="badge" style={{ marginLeft: 6 }}>
                      {t('rientro')}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Le soste, quando un piano ricreativo esce dalla curva.
 *
 * PERCHÉ ADESSO C'È, E PRIMA NO. Prima questa pagina diceva: «non calcola la
 * decompressione, se il tuo piano prevede soste inseriscile come minuti
 * aggiuntivi». Cioè chiedeva di fare a mano il conto che l'applicazione sa già
 * fare da un'altra parte — il motore Bühlmann che disegna la curva due riquadri
 * più sopra è lo stesso, ed è stato confrontato con quello che lo Shearwater ha
 * calcolato al polso su trentotto immersioni vere: scarto medio 0,79 punti di
 * GF99, massimo 2,6.
 *
 * Rifiutarsi di mostrarlo non rendeva nessuno più prudente: rendeva soltanto
 * più probabile che quel conto lo facesse una tabella stampata in barca, o
 * nessuno.
 *
 * QUELLO CHE QUESTA CARTA NON È. Non è l'autorizzazione a fare l'immersione. Un
 * obbligo decompressivo cambia la categoria di quello che stai pianificando —
 * servono gas di riserva pensati per le soste, un compagno addestrato, e la
 * procedura per quando qualcosa va storto a dodici metri con venti minuti di
 * tetto sopra la testa. Il riquadro rosso lo dice, e resta rosso anche quando i
 * conti tornano.
 *
 * A schermo di tutto questo resta il minimo indispensabile: con che parametri
 * sono calcolate, quanto durano, quanto gas costano.
 */
function SosteCard({ soste, plan }: { soste: DecoResult; plan: GasPlan }) {
  const { t } = useLingua();
  const obbligo = soste.stops.filter((s) => s.mandatory);
  const gas = soste.gasUsage[0];
  const restano = gas?.bar !== undefined ? plan.input.startBar - gas.bar : undefined;

  return (
    <div className="card">
      <h2>{t('Le soste che questo piano impone')}</h2>
      <p className="card-sub">
        {t('Stessi gradient factor della curva qui sopra')} ({GF_RICREATIVI.low}/{GF_RICREATIVI.high}),{' '}
        {t('sul gas del fondo. È il piano minimo: con un gas di deco dedicato sarebbero più corte.')}
      </p>

      <div className="grid grid-tiles" style={{ marginBottom: 12 }}>
        <StatTile
          label={t('Obbligo totale')}
          value={
            <span className="tabular" style={{ color: 'var(--critical)' }}>
              {soste.decoMin.toFixed(0)} <small style={{ fontSize: 14 }}>min</small>
            </span>
          }
          note={
            obbligo.length ? `${t('prima sosta a')} ${soste.firstStopM} m` : t('nessuna sosta obbligatoria')
          }
        />
        <StatTile
          label={t('Durata totale')}
          value={<span className="tabular">{formatRuntime(soste.runtimeMin)}</span>}
          note={`${formatRuntime(soste.ascentMin)} ${t('dalla fine del fondo alla superficie')}`}
        />
        <StatTile
          label={t('Gas necessario')}
          value={
            <span className="tabular" style={{ color: gas?.insufficient ? 'var(--critical)' : undefined }}>
              {gas?.bar !== undefined ? `${Math.round(gas.bar)} bar` : `${Math.round(gas?.litres ?? 0)} L`}
            </span>
          }
          note={
            restano !== undefined
              ? gas?.insufficient
                ? t('più di quello che porti')
                : `${t('usciresti con')} ${Math.round(restano)} bar, ${t('riserva esclusa')}`
              : t('soste comprese')
          }
        />
        <StatTile
          label={t('GF99 all’uscita')}
          value={<span className="tabular">{soste.gf99EndPct.toFixed(0)}%</span>}
          note={t('rispettando ogni sosta')}
        />
      </div>

      {obbligo.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('Sosta')}</th>
                <th className="num">{t('Durata')}</th>
                <th className="num">{t('Ci arrivi al minuto')}</th>
              </tr>
            </thead>
            <tbody>
              {soste.stops.map((s, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: s.mandatory ? 650 : 400 }}>
                    {s.depthM} m {s.mandatory ? '' : `— ${t('sosta di sicurezza')}`}
                  </td>
                  <td className="num tabular">{s.minutes} min</td>
                  <td className="num tabular">{s.runtimeMin.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {soste.warnings.map((w, i) => (
        <div
          key={i}
          className={w.level === 'critical' ? 'notice notice-error' : 'notice'}
          style={{ marginTop: 10 }}
        >
          {w.text}
        </div>
      ))}

      <p className="muted" style={{ fontSize: 11, margin: '10px 0 0' }}>
        {t('Con la modalità')} <b>{t('Tecnica')}</b>{' '}
        {t('aggiungi un gas di deco, più livelli e il bailout da ogni quota.')}
      </p>
    </div>
  );
}

/**
 * La curva di sicurezza del piano ricreativo.
 *
 * Il limite a profondità fissa risponde a «quanto posso stare a trenta metri»; un
 * piano vero scende, sta a una media, tocca la massima e risale, e il minuto in cui
 * esce dalla curva dipende da tutta quella forma. Qui il piano passa dentro lo
 * stesso Bühlmann che rilegge le immersioni fatte — quello validato contro
 * Shearwater — invece che dentro una tabella.
 */
function CurveCard({ curve, plan }: { curve: PlanCurveResult; plan: GasPlan }) {
  const { t } = useLingua();
  const shown = plan.input;
  const esce = curve.leavesCurveAtMin;
  const margine = curve.ndlAtAvgMin - shown.bottomMin;

  return (
    <div className="card">
      <h2>{t('Curva di sicurezza')}</h2>
      {/* 40/85 è la coppia che i computer ricreativi montano di fabbrica: vedi
          `GF_RICREATIVI` in cima al file per il perché non è `DEFAULT_GF`. */}
      <p className="card-sub">
        {t(
          'Bühlmann ZH-L16C con gradient factor 40/85, sul gas del fondo. Se il tuo computer è impostato diversamente i minuti cambiano, e ha ragione lui.',
        )}
      </p>
      <div className="grid grid-tiles">
        <StatTile
          label={t('Curva alla massima')}
          value={
            <span className="tabular">
              {curve.ndlAtMaxMin.toFixed(0)} <small style={{ fontSize: 14 }}>min</small>
            </span>
          }
          note={`${t('fermo a')} ${shown.depthM} m ${t('con')} ${mixName(shown.mix)}`}
        />
        <StatTile
          label={t('Curva alla media')}
          value={
            <span className="tabular">
              {curve.ndlAtAvgMin.toFixed(0)} <small style={{ fontSize: 14 }}>min</small>
            </span>
          }
          note={`${t('a')} ${shown.avgDepthM} m, ${t('la profondità a cui stai davvero')}`}
        />
        <StatTile
          label={t('Il tuo piano')}
          value={
            <span
              className="tabular"
              style={{ color: esce !== undefined ? 'var(--critical)' : 'var(--good-text)' }}
            >
              {esce !== undefined ? `${t('esce al')} ${esce.toFixed(0)}°` : t('in curva')}
            </span>
          }
          note={
            esce !== undefined
              ? `${t('minuto')} · ${curve.maxCeilingM.toFixed(0)} m ${t('di tetto')} · ${curve.decoMinutes} min ${t('di obbligo')}`
              : margine > 0
                ? plural(Math.round(margine), 'minuto di margine', 'minuti di margine', t)
                : t('appena dentro')
          }
        />
        <StatTile
          label={t('GF99 previsto')}
          value={<span className="tabular">{curve.gf99EndPct.toFixed(0)}%</span>}
          note={t('quanto saresti sovrasaturo all’uscita')}
        />
      </div>
      {esce !== undefined && (
        <div className="notice notice-error" style={{ marginTop: 12 }}>
          <strong style={{ fontWeight: 650 }}>{t('Questo piano non è ricreativo.')} </strong>
          {t('Al minuto')} {esce.toFixed(0)}{' '}
          {t(
            'prendi un obbligo di decompressione. Accorcia il fondo, tira su la media, o passa alla modalità tecnica.',
          )}
        </div>
      )}
    </div>
  );
}
