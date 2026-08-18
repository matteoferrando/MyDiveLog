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
import { mixName } from '../../core/units';
import { AnalysisCard } from '../components/Analysis';
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
import { barometric } from '../../core/analysis/deco';
import { useDiveLog } from '../state';

export function Planner() {
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
    const t = setTimeout(() => saveGasInput(input), 500);
    return () => clearTimeout(t);
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
  // L'impronta del piano: se cambia, l'analisi salvata è vecchia e la carta lo dice.
  const fingerprint = useMemo(
    () => JSON.stringify(plan.input) + `|${scope.period.id}|${scope.dives.length}`,
    [plan.input, scope],
  );
  const turnAt = useMemo(() => turnMinute(plan), [plan]);

  const similar = useMemo(
    () => similarDives(scope.dives, planGas(input).input.depthM, 5, planGas(input).input.bottomMin),
    [scope.dives, input],
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
          gfLow: 0.4,
          gfHigh: 0.85,
          salinity: shown.salinity,
          surfacePressureBar: barometric(shown.altitudeM ?? 0),
        },
      ),
    [plan.planned, shown.mix, shown.avgDepthM, shown.depthM, shown.salinity, shown.altitudeM],
  );

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">Pianificatore di gas</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {rmv.n > 0
            ? `Consumo misurato su ${rmv.n} immersioni del periodo scelto.`
            : 'Nessuna immersione con pressioni: il consumo va inserito a mano.'}
        </span>
      </div>

      <PeriodPicker />

      <div className="card">
        <div className="spread" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Che immersione stai pianificando</h2>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              {mode === 'rec'
                ? 'Ricreativa: il piano deve restare dentro la curva di sicurezza, e l’app ti dice a che minuto ne esce.'
                : 'Tecnica: la decompressione è prevista, e l’app genera la tabella delle soste con i gas che porti.'}
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button
              className={mode === 'rec' ? 'btn btn-primary' : 'btn'}
              onClick={() => setMode('rec')}
            >
              Ricreativa
            </button>
            <button
              className={mode === 'tec' ? 'btn btn-primary' : 'btn'}
              onClick={() => setMode('tec')}
            >
              Tecnica
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Il tuo consumo</h2>
        <p className="card-sub">
          Calcolato da volume della bombola e pressioni, immersione per immersione. Non è una stima:
          dove le pressioni mancano, il valore non esiste e non viene inventato.
        </p>
        {rmv.n === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Nelle {scope.dives.length} immersioni del periodo non ce n'è nessuna con volume bombola e
            pressione di partenza e uscita: senza quei tre dati il consumo non è calcolabile. Inserisci
            le pressioni in una scheda immersione, oppure usa il valore predefinito qui sotto sapendo
            che non è tuo.
          </p>
        ) : (
          <div className="grid grid-tiles">
            <StatTile
              label="Di solito (mediana)"
              value={<span className="tabular">{rmv.median?.toFixed(1)}</span>}
              note="L/min in superficie"
            />
            <StatTile
              label="Per pianificare (75°)"
              value={<span className="tabular">{rmv.p75?.toFixed(1)}</span>}
              note="tre volte su quattro consumi meno di così"
            />
            <StatTile
              label="Il peggiore visto"
              value={<span className="tabular">{rmv.max?.toFixed(1)}</span>}
              note="una sola immersione"
            />
            <div className="tile">
              <div className="tile-label">Usa nel piano</div>
              <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                {(
                  [
                    ['Mediana', rmv.median],
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
                      {label}
                    </button>
                  ),
                )}
              </div>
              <div className="tile-note">
                In uso: {plan.planningRmvLpm.toFixed(1)} L/min
                {plan.buddyDrivesPlan && ' (del compagno)'}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Immersione pianificata</h2>
        <div className="grid grid-3" style={{ gap: 10 }}>
          <NumField
            label="Profondità massima"
            unit="m"
            value={input.depthM}
            step={1}
            min={3}
            max={100}
            hint="Decide il gas d'emergenza, la PPO2 e la narcosi: lì conta il caso peggiore. La media segue in proporzione."
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
            label="Profondità media"
            unit="m"
            value={input.avgDepthM}
            step={1}
            min={3}
            max={input.depthM}
            hint={
              depthRatio
                ? `È questa che consuma il gas del fondo. Nelle tue immersioni la media sta al ${Math.round(depthRatio * 100)}% della massima.`
                : 'È questa che consuma il gas del fondo, non la massima.'
            }
            onChange={setAvgDepth}
          />
          <NumField
            label="Tempo di fondo"
            unit="min"
            value={input.bottomMin}
            step={1}
            min={1}
            max={400}
            hint="Dall'ingresso in acqua all'inizio della risalita: comprende la discesa, come lo conta il computer."
            onChange={(v) =>
              // Il totale segue il fondo minuto per minuto: allungare il fondo
              // senza allungare l'immersione significherebbe accorciare in
              // silenzio la risalita, che è la parte che non si comprime.
              setInput((p) => ({ ...p, bottomMin: v, totalMin: Math.max(v, p.totalMin + (v - p.bottomMin)) }))
            }
          />
          <NumField
            label="Durata totale"
            unit="min"
            value={input.totalMin}
            step={1}
            min={input.bottomMin}
            max={500}
            hint="Dall'ingresso all'uscita. Quello che avanza dal fondo è il budget della risalita, e da lì esce la velocità."
            onChange={(v) => {
              // Il totale scelto a mano ridefinisce la velocità di riferimento.
              ascentRate.current = null;
              set('totalMin', v);
            }}
          />
          <NumField
            label="Tempo alla massima"
            unit="min"
            value={input.maxTimeMin}
            step={1}
            min={0}
            max={input.bottomMin}
            hint={
              plan.restDepthM !== undefined
                ? `Il resto del fondo sta a ${plan.restDepthM} m: lo impone la media, non è un'ipotesi. Massimo compatibile: ${plan.maxFeasibleTimeMin} min.`
                : `Zero significa "non lo so": il fondo viene trattato come un tratto solo alla media. Massimo compatibile con questa media: ${plan.maxFeasibleTimeMin} min.`
            }
            onChange={(v) => set('maxTimeMin', v)}
          />
          <div className="planner-field">
            <span className="planner-label">
              Bombola <span className="muted">(L)</span>
            </span>
            <div className="row" style={{ gap: 6 }}>
              <input
                type="number"
                aria-label="Volume in litri"
                value={input.tankL}
                min={1}
                max={60}
                step={1}
                onChange={(e) => set('tankL', Math.min(60, Math.max(1, Number(e.target.value) || 1)))}
                style={{ width: 74 }}
              />
              <span className="muted" style={{ fontSize: 11 }}>
                {input.startBar * input.tankL} L di gas
              </span>
            </div>
            <div className="row" style={{ gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
              {TANK_PRESETS.map((t) => (
                <button
                  key={t.label}
                  onClick={() => set('tankL', t.litres)}
                  aria-pressed={input.tankL === t.litres}
                  style={{ fontSize: 11, padding: '3px 7px' }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <NumField label="Pressione di partenza" unit="bar" value={input.startBar} step={10} min={50} max={350} onChange={(v) => set('startBar', v)} />
          <MixField mix={input.mix} onChange={(m) => set('mix', m)} />
          <label className="planner-field">
            <span className="planner-label">Acqua</span>
            <select value={input.salinity} onChange={(e) => set('salinity', e.target.value as GasPlanInput['salinity'])}>
              <option value="salt">Mare</option>
              <option value="fresh">Lago</option>
            </select>
            <span className="planner-hint">Cambia la pressione ambiente e quindi tutti i volumi.</span>
          </label>
          <NumField
            label="Quota del sito"
            unit="m slm"
            value={input.altitudeM ?? 0}
            step={50}
            min={0}
            max={4000}
            onChange={(v) => set('altitudeM', v)}
          />
        </div>
        {(input.altitudeM ?? 0) > 0 && (
          <p className="planner-hint" style={{ marginTop: 8 }}>
            A {input.altitudeM} m la pressione di superficie è {barometric(input.altitudeM ?? 0).toFixed(3)}{' '}
            bar invece di 1.013: a parità di profondità respiri meno gas, e la curva di sicurezza si
            accorcia. Quota e salinità sono campi separati di proposito — al lago di montagna valgono
            tutte e due.
          </p>
        )}

        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
            Risalita, soste e limite di PPO2
          </summary>
          <div className="grid grid-3" style={{ gap: 10, marginTop: 12 }}>
            <NumField
              label="Velocità di risalita in emergenza"
              unit="m/min"
              value={input.ascentRateMpm}
              step={1}
              min={3}
              max={18}
              hint="Solo per il gas d'emergenza. La velocità della risalita pianificata la decidi tu con la durata totale."
              onChange={(v) => set('ascentRateMpm', v)}
            />
            <label className="planner-field">
              <span className="planner-label">Sosta di sicurezza</span>
              <label className="planner-check" style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 32 }}>
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
                <span>{input.stopMin > 0 ? 'la faccio' : 'non la faccio'}</span>
              </label>
              <span className="planner-hint">
                Non è obbligatoria e nessun modello la impone: su un'immersione bassa il piano ci arriva
                in superficie senza fermarsi. Contarla serve perché tre minuti non calcolati sono tre
                minuti di gas non calcolato.
              </span>
            </label>
            {input.stopMin > 0 && (
              <>
                <NumField
                  label="Durata della sosta"
                  unit="min"
                  value={input.stopMin}
                  step={1}
                  min={1}
                  max={10}
                  onChange={(v) => setInput((p) => ({ ...p, stopMin: v, totalMin: p.totalMin + (v - p.stopMin) }))}
                />
                <NumField
                  label="Profondità della sosta"
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
              label="Soste deco pianificate"
              unit="min"
              value={input.extraStopMin}
              step={1}
              min={0}
              max={120}
              hint="Prese dal tuo piano o dal computer: qui vengono sommate, non calcolate. Allungano anche la durata totale."
              onChange={(v) =>
                setInput((p) => ({ ...p, extraStopMin: v, totalMin: p.totalMin + (v - p.extraStopMin) }))
              }
            />
            <NumField
              label="PPO2 massima"
              unit="bar"
              value={input.maxPpo2}
              step={0.1}
              min={1.1}
              max={1.6}
              hint="Lo stesso limite impostato sul computer."
              onChange={(v) => set('maxPpo2', v)}
            />
          </div>
        </details>
      </div>

      <div className="card">
        <h2>Riserva e regola di rientro</h2>
        <p className="card-sub">
          Due scuole, e la scelta è tua: il gas minimo calcolato della subacquea tecnica, o la riserva
          fissa di quella ricreativa. Se il gas minimo non lo vuoi, non viene calcolato — non è un
          numero nascosto da qualche parte.
        </p>

        <label className="planner-check">
          <input
            type="checkbox"
            data-check="rock-bottom"
            checked={input.reserveRule === 'rockBottom'}
            onChange={(e) => set('reserveRule', e.target.checked ? 'rockBottom' : 'fixedBar')}
          />
          <span>
            <strong>Calcola il gas minimo per l'emergenza</strong> (rock bottom)
            <span className="planner-hint" style={{ display: 'block' }}>
              Il gas per riportare due persone in superficie dal punto più profondo, condividendo una
              bombola. Dipende da profondità, tempo e respiro: è la regola della subacquea tecnica.
            </span>
          </span>
        </label>

        {input.reserveRule === 'rockBottom' ? (
          <div className="grid grid-3" style={{ gap: 10, marginTop: 12 }}>
            <NumField
              label="Consumo in emergenza"
              unit="L/min"
              value={input.stressRmvLpm}
              step={1}
              min={10}
              max={60}
              hint="Più alto del tuo: chi condivide gas respira male. 30 è il valore della didattica tecnica."
              onChange={(v) => set('stressRmvLpm', v)}
            />
            <NumField
              label="Persone sulla bombola"
              unit=""
              value={input.divers}
              step={1}
              min={1}
              max={3}
              hint="Due: tu e il compagno senza gas."
              onChange={(v) => set('divers', v)}
            />
            <NumField
              label="Consumo del compagno"
              unit="L/min"
              value={input.buddyRmvLpm}
              step={1}
              min={0}
              max={40}
              hint="Zero se scendi da solo. Se è più alto del tuo, il piano usa il suo: la didattica impone di pianificare sul respiro più alto della squadra."
              onChange={(v) => set('buddyRmvLpm', v)}
            />
            <NumField
              label="Gestione del problema"
              unit="min"
              value={input.problemMin}
              step={1}
              min={0}
              max={10}
              hint="Minuti sul fondo prima di iniziare a risalire."
              onChange={(v) => set('problemMin', v)}
            />
          </div>
        ) : (
          <div className="grid grid-3" style={{ gap: 10, marginTop: 12 }}>
            <NumField
              label="Riserva fissa"
              unit="bar"
              value={input.reserveBarFixed}
              step={5}
              min={0}
              max={150}
              hint="La regola ricreativa: esco con questa pressione, qualunque sia la profondità."
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
            <strong>Bombola di decompressione separata</strong>
            <span className="planner-hint" style={{ display: 'block' }}>
              Le soste si pagano con lei, alla sua profondità e col suo consumo. Il manuale impone un
              margine del 50% sul gas di deco: se una parte va al compagno o il respiro accelera, deve
              bastare comunque.
            </span>
          </span>
        </label>

        {input.decoMix && (
          <div className="grid grid-3" style={{ gap: 10, marginTop: 12 }}>
            <MixField mix={input.decoMix} onChange={(m) => set('decoMix', m)} />
            <NumField
              label="Bombola deco"
              unit="L"
              value={input.decoTankL}
              step={1}
              min={1}
              max={40}
              onChange={(v) => set('decoTankL', v)}
            />
            <NumField
              label="Pressione deco"
              unit="bar"
              value={input.decoStartBar}
              step={10}
              min={20}
              max={350}
              onChange={(v) => set('decoStartBar', v)}
            />
            <NumField
              label="Consumo in decompressione"
              unit="L/min"
              value={input.decoRmvLpm}
              step={1}
              min={0}
              max={40}
              hint="Fermi a 6 metri si respira meno che a lavorare sul fondo. Zero significa: come quello di fondo."
              onChange={(v) => set('decoRmvLpm', v)}
            />
            {plan.deco && (
              <div className="tile" style={{ gridColumn: 'span 2' }}>
                <div className="tile-label">Ti serve</div>
                <div className="tile-value tabular" style={{ color: plan.deco.short ? 'var(--critical)' : undefined }}>
                  {plan.deco.requiredBar} <small style={{ fontSize: 13, fontWeight: 500 }}>bar</small>
                </div>
                <div className="tile-note">
                  {plan.deco.minutes.toFixed(0)} min di sosta = {plan.deco.litres} L, ×1.5 di margine ={' '}
                  {plan.deco.requiredL} L. Si passa a {mixName(plan.deco.mix)} da{' '}
                  {plan.deco.switchDepthM.toFixed(1)} m in su.
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-3" style={{ gap: 10, marginTop: 12 }}>
          <label className="planner-field">
            <span className="planner-label">Regola di rientro</span>
            <select
              value={input.turnRule}
              onChange={(e) => set('turnRule', e.target.value as GasPlanInput['turnRule'])}
            >
              <option value="thirds">Terzi — subacquea tecnica</option>
              <option value="half">Metà — andata e ritorno</option>
              <option value="none">Nessuna — discesa lineare</option>
            </select>
            <span className="planner-hint">
              {input.turnRule === 'thirds'
                ? 'Si gira dopo un terzo dell’utilizzabile: il secondo terzo per il ritorno, il terzo di margine.'
                : input.turnRule === 'half'
                  ? 'Metà all’andata e metà al ritorno: la regola classica quando si torna sui propri passi.'
                  : 'Nessuna pressione di rientro: su una discesa lineare con risalita libera sarebbe un numero arbitrario.'}
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
            <div className="tile-label">Durata totale dell'immersione</div>
            <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
              <span className="hero tabular">{formatRuntime(plan.totalRuntimeMin)}</span>
              <span className="secondary" style={{ fontSize: 13 }}>
                {formatRuntime(plan.split.bottomMin)} di fondo + {formatRuntime(plan.split.ascentMin)} di
                risalita
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
              <small>risalita che ne risulta</small>
            </div>
            <div>
              <span className="tabular">{plan.wholeDiveAvgDepthM.toFixed(1)} m</span>
              <small>media dell'intera immersione</small>
            </div>
            <div>
              <span className="tabular">{formatRuntime(plan.minTotalMin)}</span>
              <small>durata minima possibile</small>
            </div>
          </div>
        </div>

        <TimeSplitBar plan={plan} />

        <p className="muted" style={{ fontSize: 11, margin: '10px 0 0' }}>
          La velocità di risalita non si imposta: si ricava. {formatRuntime(plan.split.travelMin)} per
          coprire {plan.input.depthM} m verticali fanno{' '}
          {plan.plannedAscentRateMpm === undefined ? '—' : `${plan.plannedAscentRateMpm.toFixed(1)} m/min`}
          , contro i {LIMITS.ascentRateDeepMpm} m/min massimi raccomandati. La media dell'intera
          immersione è quella che il computer scriverà a fine immersione: è il modo di verificare il
          piano dopo averlo eseguito.
        </p>
      </div>

      <div className="card">
        <h2>Il profilo pianificato</h2>
        <p className="card-sub">
          Il tempo di fondo è disegnato alla sua profondità media, non come una discesa: di quello che
          succede là sotto il piano conosce la media e il punto più profondo, e inventare la forma
          sarebbe disegnare un dato che non c'è. La riga tratteggiata è la massima.
        </p>
        <ProfileChart plan={plan} />
        <PhaseTable phases={plan.planned} total={plan.plannedL} tankL={shown.tankL} />
      </div>

      {mode === 'rec' ? (
        <CurveCard curve={curve} plan={plan} />
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
          label={input.reserveRule === 'rockBottom' ? 'Gas minimo (rock bottom)' : 'Riserva fissa'}
          value={
            <span className="tabular">
              {plan.reserveBar} <small style={{ fontSize: 14, fontWeight: 500 }}>bar</small>
            </span>
          }
          note={
            input.reserveRule === 'rockBottom'
              ? `${plan.reserveL} L per riportare ${shown.divers} ${shown.divers === 1 ? 'persona' : 'persone'} in superficie da ${shown.depthM} m`
              : 'scelta da te, indipendente dalla profondità'
          }
        />
        {plan.turnBar !== undefined && (
          <StatTile
            label="Pressione di rientro"
            value={
              <span className="tabular">
                {plan.turnBar} <small style={{ fontSize: 14, fontWeight: 500 }}>bar</small>
              </span>
            }
            note={
              input.turnRule === 'thirds'
                ? 'regola dei terzi sul gas utilizzabile'
                : 'metà del gas utilizzabile'
            }
          />
        )}
        <StatTile
          label="Uscita prevista"
          value={
            <span className="tabular" style={{ color: plan.expectedEndBar < Math.max(plan.reserveBar, LIMITS.minReserveBar) ? 'var(--critical)' : undefined }}>
              {plan.expectedEndBar} <small style={{ fontSize: 14, fontWeight: 500 }}>bar</small>
            </span>
          }
          note={`se tutto va come pianificato (${plan.plannedL} L consumati)`}
        />
        <StatTile
          label="Fondo consentito dal gas"
          value={
            <span className="tabular" style={{ color: plan.overBudget ? 'var(--critical)' : undefined }}>
              {plan.gasLimitedBottomMin.toFixed(0)} <small style={{ fontSize: 14, fontWeight: 500 }}>min</small>
            </span>
          }
          note={`${plan.overBudget ? 'hai pianificato' : 'pianificati'} ${input.bottomMin} min, a ${plan.input.avgDepthM} m di media`}
        />
      </div>

      {plan.warnings.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {/* Il rosso è riservato a "questo piano non si esegue": usarlo anche per
              gli avvisi di contesto insegnerebbe a ignorarli tutti. */}
          {plan.warnings.map((w) => (
            <div key={w.text} className={w.level === 'critical' ? 'notice notice-error' : 'notice'}>
              <strong style={{ fontWeight: 650 }}>
                {w.level === 'critical' ? 'Il piano non regge: ' : 'Da sapere: '}
              </strong>
              {w.text}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Bilancio della bombola</h2>
        <p className="card-sub">
          {shown.startBar} bar × {shown.tankL} L = {startL} L di gas a bordo.{' '}
          {input.reserveRule === 'rockBottom' ? 'Il gas minimo' : 'La riserva'} non è disponibile: è la
          parte che resta ferma perché serva se qualcosa va storto.
        </p>
        <PressureBudget plan={plan} />
      </div>

      {plan.reserve.length > 0 ? (
        <div className="card">
          <h2>Il gas minimo, fase per fase</h2>
          <p className="card-sub">
            Quattro fasi con le loro ipotesi: un numero unico non si può controllare, quattro sì. Ogni
            fase usa la pressione ambiente alla sua profondità media, e parte dalla profondità
            massima — in emergenza è da lì che si risale.
          </p>
          <AscentSchematic plan={plan} />
          <PhaseTable phases={plan.reserve} total={plan.reserveL} tankL={shown.tankL} />
        </div>
      ) : (
        <div className="card">
          <h2>Gas d'emergenza: non calcolato</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            Hai scelto la riserva fissa di {plan.reserveBar} bar, quindi il gas minimo per riportare
            due persone in superficie non viene calcolato e non compare da nessuna parte in questa
            pagina. Se vuoi sapere se {plan.reserveBar} bar bastano a {shown.depthM} m, la casella
            «calcola il gas minimo per l'emergenza» qui sopra risponde a quella domanda con un numero.
          </p>
        </div>
      )}

      <div className="card">
        <div className="page-title-row" style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>Quanti bar devi avere, e quando</h2>
          {turnAt !== undefined && (
            <span className="badge">
              rientro a {plan.turnBar} bar, intorno al minuto {turnAt.toFixed(0)}
            </span>
          )}
        </div>
        <p className="card-sub">
          La pressione che dovresti leggere sul manometro a ogni tappa, se respiri al consumo
          pianificato e stai sul profilo. Serve ad accorgersi di uno scostamento{' '}
          <em>mentre puoi ancora rimediare</em>: la pressione di rientro da sola dice se tornare
          adesso, non se stai consumando più del previsto.
        </p>
        <PressureTimeline plan={plan} schedule={schedule} turnAt={turnAt} />
        <ScheduleTable schedule={schedule} plan={plan} turnAt={turnAt} />
        <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
          Questa tabella non è una procedura standard. La didattica tecnica insegna due cose
          separate: il <em>run time schedule</em> — azione, profondità, sosta, tempo trascorso — che si
          porta sott'acqua su una lavagnetta e non ha nessuna colonna di pressione, e la{' '}
          <em>turn pressure</em>, che è un numero solo. La colonna dei bar è costruita con le formule
          del manuale (tempo × ATA medi × consumo) ma è un'aggiunta nostra.
        </p>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Se scendi più giù</h2>
          <p className="card-sub">
            Tempo di fondo che il gas consente, al variare della profondità. La media segue la massima
            in proporzione, come nel modulo; il resto del piano resta com'è.
          </p>
          <CurveChart
            points={byDepth.map((d) => ({ x: d.x, y: d.bottom }))}
            xLabel="m"
            yLabel="min"
            marker={shown.depthM}
            markerLabel={`${plan.gasLimitedBottomMin.toFixed(0)} min a ${shown.depthM} m`}
            reference={shown.bottomMin}
            referenceLabel={`pianificati ${shown.bottomMin} min`}
          />
        </div>
        {input.reserveRule === 'rockBottom' && (
          <div className="card">
            <h2>Gas minimo per profondità</h2>
            <p className="card-sub">
              Quanti bar restano bloccati per l'emergenza. Cresce più che linearmente: la risalita è più
              lunga e ogni minuto costa di più. È esattamente ciò che una riserva fissa non vede.
            </p>
            <CurveChart
              points={byDepth.map((d) => ({ x: d.x, y: d.reserve }))}
              xLabel="m"
              yLabel="bar"
              color="var(--series-2)"
              marker={shown.depthM}
              markerLabel={`${plan.reserveBar} bar`}
              reference={shown.startBar}
              referenceLabel="pressione di partenza"
            />
          </div>
        )}
        <div className="card">
          <h2>Quanto conta il tuo respiro</h2>
          <p className="card-sub">
            A {shown.depthM} m, tempo di fondo consentito al variare del consumo. La distanza fra la
            tua mediana e il tuo peggiore è la ragione per cui si pianifica sul 75° percentile.
          </p>
          <CurveChart
            points={byRmv}
            xLabel="L/min"
            yLabel="min"
            color="var(--series-3)"
            marker={shown.rmvLpm}
            markerLabel={`${plan.gasLimitedBottomMin.toFixed(0)} min`}
            reference={shown.bottomMin}
            referenceLabel="pianificati"
          />
        </div>
        <div className="card">
          <h2>Esposizione all'ossigeno</h2>
          <p className="card-sub">
            Tabelle NOAA come le riportano i manuali TDI. Il CNS è il rischio di crisi convulsiva e si
            dimezza ogni 90 minuti in superficie; gli OTU sono il danno polmonare cumulativo e non
            recuperano fra un'immersione e l'altra.
          </p>
          <div className="grid grid-tiles" style={{ gap: 10 }}>
            <StatTile
              label="Orologio CNS"
              value={
                <span
                  className="tabular"
                  style={{ color: plan.oxygen.cnsPercent >= 100 ? 'var(--critical)' : undefined }}
                >
                  {plan.oxygen.cnsPercent.toFixed(0)}%
                </span>
              }
              note="di questa sola immersione, sul limite del 100%"
            />
            <StatTile
              label="OTU"
              value={<span className="tabular">{plan.oxygen.otu.toFixed(0)}</span>}
              note={`dose giornaliera di riferimento ${OTU_DAILY_TDI} su più giorni`}
            />
            <StatTile
              label="Tempo sopra 1.4 bar"
              value={<span className="tabular">{plan.oxygen.minutesAbove14.toFixed(0)} min</span>}
              note={
                plan.oxygen.minutesAbove16 > 0
                  ? `di cui ${plan.oxygen.minutesAbove16.toFixed(0)} sopra 1.6`
                  : 'mai sopra 1.6'
              }
            />
          </div>
        </div>

        <div className="card">
          <h2>Ossigeno e narcosi</h2>
          <p className="card-sub">
            {mixName(shown.mix)} a {shown.depthM} m in {shown.salinity === 'salt' ? 'mare' : 'lago'}.
          </p>
          <div className="grid grid-tiles" style={{ gap: 10 }}>
            <StatTile
              label="PPO2 al fondo"
              value={
                <span className="tabular" style={{ color: plan.ppo2AtDepth > shown.maxPpo2 ? 'var(--critical)' : undefined }}>
                  {plan.ppo2AtDepth.toFixed(2)}
                </span>
              }
              note={`limite impostato ${shown.maxPpo2.toFixed(1)} bar`}
            />
            <StatTile
              label="Profondità massima operativa"
              value={<span className="tabular">{plan.modWorkM.toFixed(1)} m</span>}
              note={`a 1.4 bar in fase di lavoro · ${plan.modDecoM.toFixed(1)} m a 1.6 in deco`}
            />
            <StatTile
              label="Miscela migliore per questa quota"
              value={<span className="tabular">EAN{Math.round(plan.bestMixO2 * 100)}</span>}
              note={`Fg = 1.4 / ${(plan.ppo2AtDepth / shown.mix.o2).toFixed(2)} bar, troncato in giù`}
            />
            <StatTile
              label="Azoto e narcosi"
              value={<span className="tabular">{plan.ppn2AtDepth.toFixed(2)} ata</span>}
              note={`END ${plan.endM.toFixed(0)} m · la fascia accettata va da 4.0 a 5.21 ata`}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Il piano contro la realtà</h2>
        <p className="card-sub">
          Un pianificatore generico si ferma al numero. Qui accanto c'è come sono andate le immersioni a
          profondità simile (±5 m) nel periodo scelto: se il piano promette un'uscita più generosa di
          quelle, il piano è ottimista.
        </p>
        {similar.n === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Nessuna immersione con pressione d'uscita fra {Math.max(0, shown.depthM - 5)} e{' '}
            {shown.depthM + 5} m nel periodo scelto: niente con cui confrontare.
          </p>
        ) : (
          <>
            <div className="grid grid-tiles">
              <StatTile
                label="Immersioni simili"
                value={<span className="tabular">{similar.n}</span>}
                note={
                  similar.byDurationToo
                    ? `intorno ai ${shown.depthM} m e ai ${shown.bottomMin} min`
                    : `intorno ai ${shown.depthM} m — troppo poche per filtrare anche sulla durata`
                }
              />
              <StatTile
                label="Uscita tipica"
                value={<span className="tabular">{similar.medianEndBar} bar</span>}
                note={`il piano prevede ${plan.expectedEndBar} bar`}
              />
              <StatTile
                label="Uscita più bassa"
                value={
                  <span className="tabular" style={{ color: (similar.minEndBar ?? 999) < LIMITS.minReserveBar ? 'var(--warning)' : undefined }}>
                    {similar.minEndBar} bar
                  </span>
                }
                note={
                  similar.belowReserve > 0
                    ? `${similar.belowReserve} sotto i ${LIMITS.minReserveBar} bar di riserva`
                    : `mai sotto i ${LIMITS.minReserveBar} bar`
                }
              />
              <StatTile
                label="Durata tipica"
                value={<span className="tabular">{similar.medianBottomMin} min</span>}
                note={`il piano dura ${formatRuntime(plan.totalRuntimeMin)}`}
              />
            </div>
            {similar.medianEndBar !== undefined && plan.expectedEndBar > similar.medianEndBar + 15 && (
              <div className="notice" style={{ marginTop: 12 }}>
                Il piano prevede di uscire con {plan.expectedEndBar} bar, ma a questa profondità di solito
                esci con {similar.medianEndBar}: la differenza di {plan.expectedEndBar - similar.medianEndBar}{' '}
                bar dice che il consumo usato nel piano è più basso di quello reale in queste condizioni.
                Prova a pianificare col valore peggiore.
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>E se…</h2>
        <p className="card-sub">
          Gli schedule di contingenza che la didattica chiede di avere in tasca prima di entrare: lo
          stesso piano con un parametro cambiato. La domanda «e se resto giù cinque minuti in più» va
          fatta adesso, non a quaranta metri.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th style={{ textAlign: 'right' }}>Uscita prevista</th>
                <th style={{ textAlign: 'right' }}>Differenza</th>
                <th>Cosa cambia</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((c) => (
                <tr key={c.label}>
                  <td>
                    <div className="row" style={{ gap: 7 }}>
                      <span className={`dot ${c.fits ? 'dot-good' : 'dot-critical'}`} />
                      <span style={{ fontWeight: 550 }}>{c.label}</span>
                    </div>
                  </td>
                  <td className="num tabular" style={{ textAlign: 'right', fontWeight: 650, color: c.fits ? undefined : 'var(--critical)' }}>
                    {c.plan.expectedEndBar} bar
                  </td>
                  <td className="num tabular muted" style={{ textAlign: 'right' }}>
                    {c.endBarDelta > 0 ? `+${c.endBarDelta}` : c.endBarDelta}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{c.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
          Il pallino rosso significa che quello scenario consuma la riserva: non che sia vietato, ma
          che se succede il piano cambia e devi saperlo prima.
        </p>
      </div>

      <div className="card">
        <h2>Prima di scendere</h2>
        <p className="card-sub">
          Il controllo in cinque lettere della didattica tecnica. Non è un promemoria generico: ogni
          lettera corrisponde a qualcosa che si guarda insieme al compagno, in superficie.
        </p>
        <div className="stack" style={{ gap: 10 }}>
          {[
            ['S — Drill', 'Prova dell\'esaurimento gas e controllo delle bolle: erogatore di scorta in mano, non in teoria.'],
            ['T — Team', 'Controllo incrociato dell\'attrezzatura: chi ha cosa, dove, e come si apre.'],
            [
              'A — Aria',
              plan.turnBar !== undefined
                ? `Pressione di rientro di ciascuno, detta ad alta voce: la tua è ${plan.turnBar} bar${turnAt !== undefined ? `, intorno al minuto ${turnAt.toFixed(0)}` : ''}.`
                : 'Pressione di rientro di ciascuno, detta ad alta voce. In questo piano non ne hai scelta una.',
            ],
            ['R — Rotta', 'Dove si entra, dove si esce, che giro si fa e da che parte si torna.'],
            [
              'T — Tabelle',
              `Profondità massima ${shown.depthM} m, durata ${formatRuntime(plan.totalRuntimeMin)}, ${plan.split.stopsMin.toFixed(0)} minuti di sosta${plan.deco ? `, passaggio a ${mixName(plan.deco.mix)} a ${plan.deco.switchDepthM.toFixed(0)} m` : ''}.`,
            ],
          ].map(([letter, text]) => (
            <div key={letter} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontWeight: 700, minWidth: 78, fontSize: 13 }}>{letter}</span>
              <span className="secondary" style={{ fontSize: 13 }}>{text}</span>
            </div>
          ))}
        </div>
      </div>

      <AnalysisCard
        kind="gas"
        gasInput={input}
        title="Rilettura del piano con Claude"
        description="Non rifà i conti: guarda le ipotesi su cui il piano sta in piedi — il consumo usato, la media dichiarata, la regola di riserva — e dice cosa cambia se una di quelle è ottimistica. Confronta anche il piano con come sono andate davvero le immersioni simili."
        currentFingerprint={fingerprint}
      />

      <div className="card">
        <h2>Cosa questo pianificatore non fa</h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)' }}>
          <li>
            <strong>Non calcola la decompressione.</strong> Le soste obbligatorie dipendono dal modello,
            dai gradient factor e dalla storia dei tessuti: sono il dominio del computer e del corso, non
            di una sottrazione. Se il tuo piano prevede soste, inseriscile come minuti aggiuntivi e
            l'aritmetica del gas le include.
          </li>
          <li>
            Il gas di ogni fase è calcolato alla profondità media della fase. Non è un'approssimazione:
            la pressione ambiente è affine nella profondità, quindi la sua media nel tempo è esattamente
            il valore alla profondità media. È anche il motivo per cui non ti viene chiesta la velocità
            di discesa — non cambierebbe nessun risultato.
          </li>
          <li>
            La profondità narcotica considera narcotico anche l'ossigeno, non solo l'azoto: è la
            convenzione della didattica tecnica — «non immergerti col nitrox più in profondità di
            quanto faresti con l'aria» — e per una miscela senza elio l'END coincide con la
            profondità. La convenzione opposta, che conta solo l'azoto, dice che col nitrox sei meno
            narcotizzato: è la meno prudente delle due.
          </li>
          <li>
            Del tempo di fondo il piano conosce la media e il massimo, non la forma. Due profili diversi
            con la stessa media consumano lo stesso gas, quindi la forma non serve: serve però al
            computer per la decompressione, ed è un'altra ragione per cui le soste vengono da lui.
          </li>
          <li>
            La regola dei terzi presuppone un ritorno obbligato. Su un'immersione lineare con risalita
            libera è più severa del necessario: il numero utile lì è il gas minimo, non la pressione di
            rientro.
          </li>
          <li>
            Il consumo misurato viene dalle immersioni che avevano le pressioni:{' '}
            {rmv.n} su {scope.dives.length} nel periodo, {dives.length} in archivio. Un consumo calcolato
            su poche immersioni è un consumo poco conosciuto.
          </li>
        </ul>
      </div>
    </div>
  );
}

/**
 * "48 min", "1 h 12 min", "3.5 min".
 *
 * I minuti non interi si arrotondano solo sotto i dieci: "4.2 min" su un tratto di
 * risalita è un'informazione, "47.3 min" di durata totale è finta precisione.
 */
function formatRuntime(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '—';
  if (min < 10) return `${Math.round(min * 10) / 10} min`;
  const whole = Math.round(min);
  if (whole < 60) return `${whole} min`;
  return `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, '0')} min`;
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
  // Il campo tiene il testo, non il numero: altrimenti cancellare l'ultima cifra
  // riscriverebbe uno zero sotto le dita di chi sta digitando.
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // Solo quando il valore arriva da fuori (un pulsante, il caricamento).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label className="planner-field">
      <span className="planner-label">
        {label}
        {unit && <span className="muted"> ({unit})</span>}
      </span>
      <input
        type="number"
        inputMode="decimal"
        value={text}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) {
            const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
            onChange(clamped);
          }
        }}
        onBlur={() => setText(String(value))}
      />
      {hint && <span className="planner-hint">{hint}</span>}
    </label>
  );
}

/** Le bombole che si usano davvero, così il numero non va digitato ogni volta. */
const TANK_PRESETS: { label: string; litres: number }[] = [
  { label: '10 L', litres: 10 },
  { label: '12 L', litres: 12 },
  { label: '15 L', litres: 15 },
  { label: '18 L', litres: 18 },
  { label: '2×12', litres: 24 },
  { label: '2×15', litres: 30 },
];

const MIX_PRESETS: { label: string; mix: GasMix }[] = [
  { label: 'Aria', mix: { o2: 0.21, he: 0 } },
  { label: 'EAN32', mix: { o2: 0.32, he: 0 } },
  { label: 'EAN36', mix: { o2: 0.36, he: 0 } },
  { label: 'Tx 21/35', mix: { o2: 0.21, he: 0.35 } },
];

function MixField({ mix, onChange }: { mix: GasMix; onChange: (m: GasMix) => void }) {
  const pct = (v: number) => Math.round(v * 100);
  return (
    <div className="planner-field">
      <span className="planner-label">
        Miscela <span className="muted">({mixName(mix)})</span>
      </span>
      <div className="row" style={{ gap: 6 }}>
        <input
          type="number"
          aria-label="Ossigeno, percento"
          value={pct(mix.o2)}
          min={8}
          max={100}
          step={1}
          onChange={(e) => {
            const o2 = Math.min(100, Math.max(8, Number(e.target.value) || 0)) / 100;
            onChange({ o2, he: Math.min(mix.he, Math.max(0, 1 - o2)) });
          }}
          style={{ width: 64 }}
        />
        <span className="muted" style={{ fontSize: 12 }}>
          O₂
        </span>
        <input
          type="number"
          aria-label="Elio, percento"
          value={pct(mix.he)}
          min={0}
          max={80}
          step={1}
          onChange={(e) => {
            const he = Math.min(80, Math.max(0, Number(e.target.value) || 0)) / 100;
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
            {p.label}
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
  const reserveLabel = plan.input.reserveRule === 'rockBottom' ? 'gas minimo' : 'riserva';
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
          { label: 'margine', fill: 'var(--seq-100)' },
          { label: 'ritorno', fill: 'var(--seq-250)' },
          { label: 'andata', fill: 'var(--seq-450)' },
        ]
      : plan.input.turnRule === 'half'
        ? [
            { label: 'ritorno', fill: 'var(--seq-250)' },
            { label: 'andata', fill: 'var(--seq-450)' },
          ]
        : [{ label: 'utilizzabile', fill: 'var(--seq-450)' }];
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
      ? [{ bar: plan.turnBar, label: `rientro ${plan.turnBar}`, color: 'var(--text-primary)' }]
      : []),
    {
      bar: plan.expectedEndBar,
      label: `uscita prevista ${plan.expectedEndBar}`,
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
              <rect x={x(b.from)} y={pad.top} width={bw} height={trackH} fill={b.fill} stroke={b.stroke} strokeWidth={1} />
              {bw > 60 && (
                <text x={x(b.from) + bw / 2} y={pad.top + trackH / 2 + 4} textAnchor="middle" fontSize={10} fill="var(--text-primary)">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Scala in bar: zero a sinistra, partenza a destra. */}
        {[0, Math.round(start / 2), start].map((t) => (
          <text key={t} className="axis-label" x={x(t)} y={height - 6} textAnchor={t === 0 ? 'start' : t === start ? 'end' : 'middle'}>
            {t} bar
          </text>
        ))}

        {marks.map((m, i) => (
          <g key={m.label}>
            <line x1={x(m.bar)} x2={x(m.bar)} y1={pad.top - 7} y2={pad.top + trackH + 7} stroke={m.color} strokeWidth={1.5} />
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
        Utilizzabile {plan.usableBar} bar ({plan.usableL} L) sui {start} di partenza.
        {plan.input.turnRule !== 'none' &&
          ` Ogni ${plan.input.turnRule === 'thirds' ? 'terzo' : 'metà'} vale ${Math.round(step)} bar.`}
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
            <line x1={pad.left} x2={width - pad.right} y1={y(d)} y2={y(d)} stroke="var(--grid)" strokeWidth={1} />
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
              <line x1={x(s.startMin)} x2={x(s.startMin)} y1={pad.top} y2={y(0)} stroke="var(--axis)" strokeWidth={1} strokeDasharray="2 3" />
              <line x1={x(s.startMin)} x2={x(s.endMin)} y1={y(s.fromM)} y2={y(s.toM)} stroke="var(--series-1)" strokeWidth={2} />
              {w > 34 && (
                <text x={x(s.startMin) + w / 2} y={Math.max(pad.top + 10, midY - 8)} textAnchor="middle" fontSize={10} fontWeight={650} fill="var(--text-primary)">
                  {s.phase.litres} L
                </text>
              )}
              {w > 34 && (
                <text x={x(s.startMin) + w / 2} y={height - 16} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
                  {s.phase.minutes.toFixed(s.phase.minutes < 1 ? 1 : 0)}′
                </text>
              )}
            </g>
          );
        })}

        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth={1} />
        <text className="axis-label" x={pad.left} y={height - 3} textAnchor="start">
          m ↓ · {total.toFixed(0)} min di risalita
        </text>
        <text className="axis-label" x={width - pad.right} y={height - 3} textAnchor="end">
          {plan.reserveL} L in totale
        </text>
      </svg>
    </div>
  );
}

function PhaseTable({ phases, total, tankL }: { phases: GasPhase[]; total: number; tankL: number }) {
  return (
    <div className="table-scroll" style={{ marginTop: 12 }}>
      <table>
        <thead>
          <tr>
            <th>Fase</th>
            <th style={{ textAlign: 'right' }}>Durata</th>
            <th style={{ textAlign: 'right' }}>Prof. media</th>
            <th style={{ textAlign: 'right' }}>ATA</th>
            <th style={{ textAlign: 'right' }}>L/min</th>
            <th style={{ textAlign: 'right' }}>Persone</th>
            <th style={{ textAlign: 'right' }}>Litri</th>
          </tr>
        </thead>
        <tbody>
          {phases.map((p) => (
            <tr key={p.label}>
              <td>{p.label}</td>
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
            <td style={{ fontWeight: 650 }}>Totale</td>
            <td colSpan={5} className="muted" style={{ textAlign: 'right', fontSize: 12 }}>
              su una bombola da {tankL} L
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
  const { ref, width } = useWidth<HTMLDivElement>();
  const total = Math.max(0.1, plan.totalRuntimeMin);
  const parts = [
    { label: 'fondo', min: plan.split.bottomMin, fill: 'var(--seq-450)' },
    { label: 'risalita', min: plan.split.travelMin, fill: 'var(--seq-250)' },
    { label: 'soste', min: plan.split.stopsMin, fill: 'var(--seq-100)' },
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
                <text x={left + w / 2} y={barH / 2 + 4} textAnchor="middle" fontSize={11} fill="var(--text-primary)">
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
                <text x={left + w / 2} y={barH + 30} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
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
            <line x1={pad.left} x2={width - pad.right} y1={y(d)} y2={y(d)} stroke="var(--grid)" strokeWidth={1} />
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
        <text className="axis-label" x={width - pad.right} y={y(maxD) - 5} textAnchor="end" fill="var(--series-2)">
          massima {plan.input.depthM} m
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
                <text x={x(s.startMin) + w / 2} y={height - 18} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
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
          media {plan.wholeDiveAvgDepthM.toFixed(1)} m
        </text>

        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth={1} />
        <text className="axis-label" x={pad.left} y={height - 4} textAnchor="start">
          m ↓
        </text>
        <text className="axis-label" x={width - pad.right} y={height - 4} textAnchor="end">
          {formatRuntime(plan.totalRuntimeMin)} in tutto · {plan.plannedL} L
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

  const line = schedule.map((p, i) => `${i ? 'L' : 'M'}${x(p.runMin).toFixed(1)},${yBar(p.bar).toFixed(1)}`).join(' ');
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
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const at = ((e.clientX - box.left - pad.left) / plotW) * total;
          let best = schedule[0];
          for (const p of schedule) if (Math.abs(p.runMin - at) < Math.abs(best.runMin - at)) best = p;
          setTip({
            x: x(best.runMin),
            y: yBar(best.bar),
            title: `minuto ${best.runMin}`,
            rows: [
              { label: 'pressione attesa', value: `${best.bar} bar` },
              { label: 'profondità', value: `${best.depthM} m` },
              { label: 'fase', value: best.phase },
            ],
          });
        }}
        onMouseLeave={() => setTip(null)}
      >
        {/* La riserva: la fascia in cui il piano non deve entrare. */}
        <rect
          x={pad.left}
          y={yBar(plan.reserveBar)}
          width={plotW}
          height={Math.max(0, pad.top + barH - yBar(plan.reserveBar))}
          fill="var(--series-2-wash)"
        />
        <text className="axis-label" x={width - pad.right + 4} y={yBar(plan.reserveBar) + 10} fill="var(--series-2)">
          riserva
        </text>

        {[0, Math.round(start / 2), start].map((b) => (
          <g key={b}>
            <line x1={pad.left} x2={width - pad.right} y1={yBar(b)} y2={yBar(b)} stroke="var(--grid)" strokeWidth={1} />
            <text className="axis-label" x={pad.left - 6} y={yBar(b) + 3} textAnchor="end">
              {b}
            </text>
          </g>
        ))}

        {turnAt !== undefined && plan.turnBar !== undefined && (
          <g>
            <line x1={x(turnAt)} x2={x(turnAt)} y1={pad.top} y2={pad.top + barH} stroke="var(--text-primary)" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={x(turnAt) + 4} y={pad.top + 10} fontSize={10} fontWeight={650} fill="var(--text-primary)">
              rientro {plan.turnBar}
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

        {[0, total / 2, total].map((t) => (
          <text key={t} className="axis-label" x={x(t)} y={height - 6} textAnchor="middle">
            {Math.round(t)} min
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
  return (
    <div className="table-scroll" style={{ marginTop: 12 }}>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'right' }}>Minuto</th>
            <th style={{ textAlign: 'right' }}>Profondità</th>
            <th style={{ textAlign: 'right' }}>Pressione attesa</th>
            <th style={{ textAlign: 'right' }}>Consumati</th>
            <th>Cosa stai facendo</th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((p) => {
            const belowReserve = p.bar < plan.reserveBar;
            const atTurn = turnAt !== undefined && Math.abs(p.runMin - turnAt) < 0.51;
            return (
              <tr key={`${p.runMin}-${p.phase}`}>
                <td className="num tabular" style={{ textAlign: 'right', fontWeight: p.boundary ? 700 : 400 }}>
                  {p.runMin}
                </td>
                <td className="num tabular" style={{ textAlign: 'right' }}>
                  {p.depthM} m
                </td>
                <td
                  className="num tabular"
                  style={{ textAlign: 'right', fontWeight: 650, color: belowReserve ? 'var(--critical)' : undefined }}
                >
                  {p.bar} bar
                </td>
                <td className="num tabular muted" style={{ textAlign: 'right' }}>
                  {p.litres} L
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {p.phase}
                  {atTurn && <span className="badge" style={{ marginLeft: 6 }}>rientro</span>}
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
 * La curva di sicurezza del piano ricreativo.
 *
 * Il limite a profondità fissa risponde a «quanto posso stare a trenta metri»; un
 * piano vero scende, sta a una media, tocca la massima e risale, e il minuto in cui
 * esce dalla curva dipende da tutta quella forma. Qui il piano passa dentro lo
 * stesso Bühlmann che rilegge le immersioni fatte — quello validato contro
 * Shearwater — invece che dentro una tabella.
 */
function CurveCard({ curve, plan }: { curve: PlanCurveResult; plan: GasPlan }) {
  const shown = plan.input;
  const esce = curve.leavesCurveAtMin;
  const margine = curve.ndlAtAvgMin - shown.bottomMin;

  return (
    <div className="card">
      <h2>Curva di sicurezza</h2>
      <p className="card-sub">
        Bühlmann ZH-L16C con gradient factor 40/85, la scelta ricreativa più comune. Il gas del fondo
        per tutta la durata: se scendi con un computer impostato diversamente, i minuti cambiano, ed è
        il computer ad avere ragione.
      </p>
      <div className="grid grid-tiles">
        <StatTile
          label="Curva alla massima"
          value={<span className="tabular">{curve.ndlAtMaxMin.toFixed(0)} <small style={{ fontSize: 14 }}>min</small></span>}
          note={`fermo a ${shown.depthM} m con ${mixName(shown.mix)}`}
        />
        <StatTile
          label="Curva alla media"
          value={<span className="tabular">{curve.ndlAtAvgMin.toFixed(0)} <small style={{ fontSize: 14 }}>min</small></span>}
          note={`a ${shown.avgDepthM} m, la profondità a cui stai davvero`}
        />
        <StatTile
          label="Il tuo piano"
          value={
            <span className="tabular" style={{ color: esce !== undefined ? 'var(--critical)' : 'var(--good-text)' }}>
              {esce !== undefined ? `esce al ${esce.toFixed(0)}°` : 'in curva'}
            </span>
          }
          note={
            esce !== undefined
              ? `minuto, con ${curve.maxCeilingM.toFixed(0)} m di tetto e ${curve.decoMinutes} min di obbligo`
              : `${margine > 0 ? `${margine.toFixed(0)} minuti di margine` : 'appena dentro'}`
          }
        />
        <StatTile
          label="GF99 previsto"
          value={<span className="tabular">{curve.gf99EndPct.toFixed(0)}%</span>}
          note="quanto saresti sovrasaturo all'uscita"
        />
      </div>
      {esce !== undefined && (
        <div className="notice notice-error" style={{ marginTop: 12 }}>
          <strong style={{ fontWeight: 650 }}>Questo piano non è ricreativo. </strong>
          Al minuto {esce.toFixed(0)} prendi un obbligo di decompressione, e da lì risalire dritti non è
          più un'opzione. Accorcia il fondo, tira su la media, oppure passa alla modalità tecnica e
          pianifica le soste con i gas giusti — che è la cosa che richiede un corso, non un bottone.
        </div>
      )}
    </div>
  );
}
