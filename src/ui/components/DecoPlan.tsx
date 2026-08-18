/**
 * Il pianificatore in modalità tecnica: la tabella di decompressione.
 *
 * PERCHÉ È UNA MODALITÀ E NON UNA PAGINA A PARTE. Perché la domanda «resto in
 * curva o accetto la deco» è una decisione che si prende all'inizio e cambia tutto
 * quello che viene dopo: in ricreativa il vincolo è il limite di non
 * decompressione e il gas serve a rispettarlo, in tecnica il vincolo è il gas e la
 * decompressione è la conseguenza. Due pagine avrebbero costretto a scegliere
 * prima di sapere; una modalità permette di scoprire, con gli stessi numeri
 * davanti, che il piano ricreativo non ci sta.
 *
 * COSA MOSTRA. Livelli multipli, più miscele con cambio automatico alla MOD,
 * tabella delle soste con runtime, consumo per bombola in litri e in bar, CNS e
 * OTU, PPO2/EAD/END riga per riga, controdiffusione isobarica ai cambi gas, le
 * contingenze (più giù, più a lungo, gas perso) e il tempo prima di poter volare.
 *
 * COSA NON SOSTITUISCE. Un corso. La tabella si genera per qualunque profilo, e
 * questo è esattamente il motivo per cui non basta averla.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_DECO,
  afterSurfaceInterval,
  bailoutPlan,
  barometric,
  planSeries,
  decoTableText,
  SAFETY_STOP_MIN_DEPTH_M,
  decoContingencies,
  label as gasLabel,
  planDeco,
  switchDepthOf,
  tissuesAtAltitude,
  type DecoSettings,
  type PlanGas,
  type PlanLevel,
} from '../../core/analysis/deco';
import { DEFAULT_VPM, planVpm, type VpmStop } from '../../core/analysis/vpm';
import type { Dive } from '../../core/model';
import { dateShort } from '../format';
import { OTU_DAILY_TDI } from '../../core/analysis/oxygen';
import type { GasMix, Salinity } from '../../core/model';
import { withFraction } from '../../core/units';
import { StatTile } from './Charts';
import { AnalysisCard } from './Analysis';

export interface DecoSeed {
  depthM: number;
  bottomMin: number;
  mix: GasMix;
  tankL: number;
  startBar: number;
  rmvLpm: number;
  salinity: Salinity;
  maxPpo2: number;
}

/** Le bombole di decompressione che si portano davvero, precompilate. */
const STAGE = { tankL: 11, startBar: 200 };

/**
 * Tutto quello che compone un piano tecnico, in una forma sola.
 *
 * Sta insieme perché si salva insieme: livelli senza le miscele con cui li hai
 * pensati, o soste senza i gradient factor che le hanno prodotte, non sono un
 * piano — sono dei numeri.
 */
export interface DecoPlanState {
  levels: PlanLevel[];
  gases: PlanGas[];
  base: DecoSettings;
  model: 'buhlmann' | 'vpm' | 'both';
  conservatism: number;
  ccr: boolean;
  setpoint: number;
  altitudeM: number;
  hoursAtAltitude: number;
  salinity: Salinity;
  previousId: string;
  surfaceMin: number;
  /** La seconda immersione della giornata, quando la si pianifica insieme. */
  second?: { depthM: number; minutes: number; surfaceMin: number } | null;
  /** Quota da cui provare il bailout, invece che dal fondo. */
  bailFrom?: number | null;
}

export function DecoPlanner({
  seed,
  dives = [],
  saved,
  onChange,
  savedPlans = [],
  onSavePlan,
  onLoadPlan,
  onDeletePlan,
}: {
  seed: DecoSeed;
  dives?: Dive[];
  saved?: DecoPlanState | null;
  onChange?: (state: DecoPlanState) => void;
  savedPlans?: { name: string; savedAt: string; state: unknown }[];
  onSavePlan?: (name: string, state: DecoPlanState) => void | Promise<void>;
  onLoadPlan?: (state: unknown) => void;
  onDeletePlan?: (name: string) => void | Promise<void>;
}) {
  // Quota, acqua e immersione precedente: tre cose che cambiano la tabella prima
  // ancora di scrivere il primo livello, e che quasi tutti i pianificatori
  // trattano come impostazioni nascoste invece che come parte del piano.
  const [altitudeM, setAltitudeM] = useState(saved?.altitudeM ?? 0);
  const [hoursAtAltitude, setHoursAtAltitude] = useState(saved?.hoursAtAltitude ?? 12);
  const [salinity, setSalinity] = useState<Salinity>(saved?.salinity ?? seed.salinity);
  const [previousId, setPreviousId] = useState(saved?.previousId ?? '');
  const [surfaceMin, setSurfaceMin] = useState(saved?.surfaceMin ?? 60);
  // La seconda immersione della giornata, pianificata insieme alla prima e non
  // dopo: è il momento in cui serve saperlo.
  const [second, setSecond] = useState<{ depthM: number; minutes: number; surfaceMin: number } | null>(
    saved?.second ?? null,
  );
  // Da che quota si abbandona il circuito, per il bailout.
  const [bailFrom, setBailFrom] = useState<number | null>(saved?.bailFrom ?? null);
  const [planName, setPlanName] = useState('');
  // Circuito chiuso: spento per difetto, perché la stragrande maggioranza delle
  // immersioni è a circuito aperto e una colonna «setpoint» sempre visibile
  // sarebbe rumore per chi il rebreather non ce l'ha.
  const [ccr, setCcr] = useState(saved?.ccr ?? false);
  const [setpoint, setSetpoint] = useState(saved?.setpoint ?? 1.3);
  // Quale modello decide le soste. Bühlmann con gradient factor è lo standard di
  // fatto e resta il predefinito; VPM-B è un modello a bolle e mette le soste più
  // in profondità; «il più lungo dei due» è il compromesso che usa Baltic, e prende
  // punto per punto la sosta più lunga fra i due.
  const [model, setModel] = useState<DecoPlanState['model']>(saved?.model ?? 'buhlmann');
  const [conservatism, setConservatism] = useState(saved?.conservatism ?? DEFAULT_VPM.conservatism);
  const [levels, setLevels] = useState<PlanLevel[]>(
    saved?.levels ?? [{ depthM: seed.depthM, minutes: seed.bottomMin }],
  );
  const [gases, setGases] = useState<PlanGas[]>(
    saved?.gases ?? [
      { mix: seed.mix, role: 'bottom', tankL: seed.tankL, startBar: seed.startBar },
      { mix: { o2: 0.5, he: 0 }, role: 'deco', ...STAGE },
    ],
  );
  const [base, setBase] = useState<DecoSettings>(
    saved?.base ?? {
      ...DEFAULT_DECO,
      salinity: seed.salinity,
      rmvLpm: seed.rmvLpm,
      decoRmvLpm: Math.round(seed.rmvLpm * 0.85),
      maxPpo2Work: seed.maxPpo2,
    },
  );

  // Le immersioni dell'archivio da cui si può ripartire: servono i tessuti finali,
  // che ci sono solo dove il profilo è stato analizzato.
  const repeatable = useMemo(
    () =>
      [...dives]
        .filter((d) => d.metrics?.tissuesEnd)
        .sort((a, b) => b.startTime.localeCompare(a.startTime))
        .slice(0, 12),
    [dives],
  );
  const previous = repeatable.find((d) => d.id === previousId);

  const settings: DecoSettings = useMemo(() => {
    const surfacePressureBar = barometric(altitudeM);
    // I tessuti di partenza si compongono: prima la quota (salire È una
    // decompressione), poi l'eventuale immersione precedente con il suo intervallo
    // di superficie. Le due cose si sommano davvero — chi fa la seconda immersione
    // al lago di montagna le ha entrambe addosso.
    const atAltitude = tissuesAtAltitude(altitudeM, hoursAtAltitude);
    const initial = previous?.metrics?.tissuesEnd
      ? afterSurfaceInterval(previous.metrics.tissuesEnd, surfaceMin, surfacePressureBar)
      : atAltitude;
    return { ...base, salinity, surfacePressureBar, initial };
  }, [base, salinity, altitudeM, hoursAtAltitude, previous, surfaceMin]);

  // Il setpoint entra dai livelli, non dalle impostazioni: su un rebreather si
  // cambia in acqua, ed è normale scendere a 0.7 e passare a 1.3 sul fondo.
  const effectiveLevels = useMemo(
    () =>
      ccr
        ? levels.map((l) => ({ ...l, setpointBar: l.setpointBar ?? setpoint }))
        : levels.map(({ setpointBar: _s, ...l }) => l),
    [levels, ccr, setpoint],
  );

  // VPM-B gira sempre, anche quando non comanda: il confronto fra i due modelli è
  // una delle cose più istruttive che questa pagina possa mostrare, e costa poco.
  const vpm = useMemo(() => {
    const bottomMix = gases[0]?.mix ?? { o2: 0.21, he: 0 };
    return planVpm(
      effectiveLevels.map((l) => ({
        depthM: l.depthM,
        minutes: l.minutes,
        mix: gases[l.gasIndex ?? 0]?.mix ?? bottomMix,
      })),
      gases
        .filter((g) => g.role === 'deco')
        .map((g) => ({ mix: g.mix, switchDepthM: switchDepthOf(g, settings) })),
      {
        conservatism,
        ascentRateMpm: settings.ascentRateMpm,
        descentRateMpm: settings.descentRateMpm,
        lastStopM: settings.lastStopM,
        stopIntervalM: settings.stopIntervalM,
        salinity: settings.salinity,
        surfacePressureBar: settings.surfacePressureBar,
        initial: settings.initial,
      },
    );
  }, [effectiveLevels, gases, settings, conservatism]);

  const buhlmann = useMemo(
    () => planDeco(effectiveLevels, gases, settings),
    [effectiveLevels, gases, settings],
  );

  /**
   * La tabella che comanda davvero.
   *
   * Con VPM-B o con «il più lungo dei due» le soste arrivano da fuori e questo
   * motore le esegue: consumo per bombola, CNS, avvisi e contingenze si calcolano
   * sulla tabella scelta, non su quella di Bühlmann. Senza questo passaggio la
   * pagina mostrerebbe le soste di un modello e il gas di un altro.
   */
  const plan = useMemo(() => {
    if (model === 'buhlmann') return buhlmann;
    const stops = model === 'vpm' ? vpm.stops : longestOf(buhlmann.stops, vpm.stops);
    if (!stops.length) return buhlmann;
    return planDeco(effectiveLevels, gases, { ...settings, imposedStops: stops });
  }, [model, buhlmann, vpm, effectiveLevels, gases, settings]);
  const bailout = useMemo(
    () => (ccr ? bailoutPlan(effectiveLevels, gases, settings, bailFrom ?? undefined) : undefined),
    [ccr, effectiveLevels, gases, settings, bailFrom],
  );

  /** La giornata intera, quando si pianificano due immersioni insieme. */
  const giornata = useMemo(
    () =>
      second
        ? planSeries(
            [
              { levels: effectiveLevels, gases, surfaceIntervalMin: 0 },
              {
                levels: [{ depthM: second.depthM, minutes: second.minutes }],
                gases,
                surfaceIntervalMin: second.surfaceMin,
              },
            ],
            settings,
          )
        : undefined,
    [second, effectiveLevels, gases, settings],
  );
  // Il piano si salva da sé, mezzo secondo dopo l'ultima modifica: compilarlo
  // richiede minuti, e perderlo cambiando scheda è il genere di cosa che fa
  // smettere di usare uno strumento. `initial` NON entra nello stato salvato — è
  // uno stato di tessuti, si ricalcola — e per questo si salva `base` e non
  // `settings`.
  useEffect(() => {
    if (!onChange) return;
    const t = setTimeout(
      () =>
        onChange({
          levels,
          gases,
          base,
          model,
          conservatism,
          ccr,
          setpoint,
          altitudeM,
          hoursAtAltitude,
          salinity,
          previousId,
          surfaceMin,
          second,
          bailFrom,
        }),
      500,
    );

    return () => clearTimeout(t);
  }, [
    onChange,
    levels,
    gases,
    base,
    model,
    conservatism,
    ccr,
    setpoint,
    altitudeM,
    hoursAtAltitude,
    salinity,
    previousId,
    surfaceMin,
    second,
    bailFrom,
  ]);

  /** Lo stato completo, per salvarlo con un nome. */
  const current = (): DecoPlanState => ({
    levels,
    gases,
    base,
    model,
    conservatism,
    ccr,
    setpoint,
    altitudeM,
    hoursAtAltitude,
    salinity,
    previousId,
    surfaceMin,
    second,
    bailFrom,
  });

  const tableText = useMemo(
    () => decoTableText(plan, effectiveLevels, gases, settings),
    [plan, effectiveLevels, gases, settings],
  );
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [tableText]);

  // Il piano di un attimo fa, per dire di quanto è cambiato.
  const before = usePrevious({
    runtime: plan.runtimeMin,
    deco: plan.decoMin,
    ndl: plan.ndlMin,
    gf99: plan.gf99EndPct,
  });

  const contingenze = useMemo(
    () => decoContingencies(effectiveLevels, gases, settings),
    [effectiveLevels, gases, settings],
  );

  const setLevel = (i: number, patch: Partial<PlanLevel>) =>
    setLevels((p) => p.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const setGas = (i: number, patch: Partial<PlanGas>) =>
    setGases((p) => p.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  /** Il vincolo «la somma delle frazioni non supera 1» sta in `units.ts`. */
  const setMix = (i: number, gas: PlanGas, key: 'o2' | 'he', percent: number) =>
    setGas(i, { mix: withFraction(gas.mix, key, percent / 100) });
  const set = <K extends keyof DecoSettings>(key: K, value: DecoSettings[K]) =>
    setBase((p) => ({ ...p, [key]: value }));

  return (
    <>
      <div className="card">
        <h2>Dove sei, e cosa hai fatto prima</h2>
        <p className="card-sub">
          Quota e immersione precedente cambiano la tabella prima ancora di scrivere il primo livello, e si
          sommano: chi fa la seconda immersione a un lago di montagna se le porta addosso entrambe. La
          salinità resta un campo a sé — immergersi in quota quasi sempre vuol dire acqua dolce, e trattarla
          come acqua di mare è la scorciatoia che prendono quasi tutti i pianificatori.
        </p>
        <div className="grid grid-3" style={{ gap: 10 }}>
          <NumField
            label="Quota del sito"
            unit="m slm"
            value={altitudeM}
            min={0}
            max={4000}
            step={50}
            onChange={setAltitudeM}
          />
          <NumField
            label="Ore già passate in quota"
            unit="h"
            value={hoursAtAltitude}
            min={0}
            max={72}
            step={1}
            onChange={setHoursAtAltitude}
          />
          <label className="planner-field">
            <span className="planner-label">Acqua</span>
            <select value={salinity} onChange={(e) => setSalinity(e.target.value as Salinity)}>
              <option value="salt">salata</option>
              <option value="fresh">dolce</option>
            </select>
          </label>
          <label className="planner-field">
            <span className="planner-label">Immersione precedente</span>
            <select value={previousId} onChange={(e) => setPreviousId(e.target.value)}>
              <option value="">nessuna — parto da tessuti puliti</option>
              {repeatable.map((d) => (
                <option key={d.id} value={d.id}>
                  {dateShort(d.startTime, d.utcOffsetMinutes)} · {d.site?.name ?? 'senza sito'} ·{' '}
                  {d.maxDepth.toFixed(0)} m
                </option>
              ))}
            </select>
            {repeatable.length === 0 && (
              <span className="planner-hint">
                Nessuna immersione con i tessuti calcolati: servono profili in archivio.
              </span>
            )}
          </label>
          {previousId && (
            <NumField
              label="Intervallo di superficie"
              unit="min"
              value={surfaceMin}
              min={5}
              max={1440}
              step={5}
              onChange={setSurfaceMin}
            />
          )}
        </div>
        {(altitudeM > 0 || previousId) && (
          <div className="notice" style={{ marginTop: 12 }}>
            {altitudeM > 0 && (
              <>
                A {altitudeM} m la pressione di superficie è {barometric(altitudeM).toFixed(3)} bar invece di
                1.013: il gas che consumi cala, la decompressione si allunga.
                {hoursAtAltitude < 12 && (
                  <>
                    {' '}
                    Con sole {hoursAtAltitude} ore in quota non sei ancora acclimatato, e questo entra nel
                    conto.
                  </>
                )}{' '}
              </>
            )}
            {previous && (
              <>
                Riparti dai tessuti del {dateShort(previous.startTime, previous.utcOffsetMinutes)} dopo{' '}
                {surfaceMin} minuti di superficie.
              </>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>I livelli</h2>
        <p className="card-sub">
          Il tempo del primo livello comprende la discesa, come su ogni computer e ogni manuale: «quaranta
          metri per venticinque minuti» conta da quando lasci la superficie. Sui livelli successivi il
          transito è in più.
        </p>
        {levels.map((level, i) => (
          <div key={i} className="grid grid-3" style={{ gap: 10, marginBottom: 8 }}>
            <NumField
              label={i === 0 ? 'Profondità' : `Profondità ${i + 1}`}
              unit="m"
              value={level.depthM}
              min={3}
              max={150}
              step={1}
              onChange={(v) => setLevel(i, { depthM: v })}
            />
            <NumField
              label="Minuti"
              unit="min"
              value={level.minutes}
              min={0}
              max={300}
              step={1}
              onChange={(v) => setLevel(i, { minutes: v })}
            />
            <div className="planner-field" style={{ justifyContent: 'flex-end' }}>
              <span className="planner-label">&nbsp;</span>
              <div className="row" style={{ gap: 6 }}>
                {levels.length > 1 && (
                  <button onClick={() => setLevels((p) => p.filter((_, k) => k !== i))}>Togli</button>
                )}
                {i === levels.length - 1 && (
                  <button
                    onClick={() =>
                      setLevels((p) => [...p, { depthM: Math.max(3, level.depthM - 10), minutes: 10 }])
                    }
                  >
                    Aggiungi livello
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0 }}>La seconda immersione della giornata</h2>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              Si pianifica adesso, insieme alla prima, perché è adesso che serve saperlo: la pausa la decidi a
              colazione, non quando risali. Stessa attrezzatura e stesse miscele — se cambi anche quelle,
              conviene farne due piani separati.
            </p>
          </div>
          <button
            onClick={() =>
              setSecond((p) =>
                p ? null : { depthM: Math.max(6, levels[0].depthM - 10), minutes: 40, surfaceMin: 90 },
              )
            }
          >
            {second ? 'Togli' : 'Aggiungi'}
          </button>
        </div>

        {second && (
          <>
            <div className="grid grid-3" style={{ gap: 10, marginTop: 12 }}>
              <NumField
                label="Intervallo di superficie"
                unit="min"
                value={second.surfaceMin}
                min={10}
                max={600}
                step={5}
                onChange={(v) => setSecond((p) => p && { ...p, surfaceMin: v })}
              />
              <NumField
                label="Profondità"
                unit="m"
                value={second.depthM}
                min={3}
                max={150}
                step={1}
                onChange={(v) => setSecond((p) => p && { ...p, depthM: v })}
              />
              <NumField
                label="Minuti"
                unit="min"
                value={second.minutes}
                min={1}
                max={300}
                step={1}
                onChange={(v) => setSecond((p) => p && { ...p, minutes: v })}
              />
            </div>
            {giornata && (
              <div className="table-scroll" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Immersione</th>
                      <th className="num">Runtime</th>
                      <th className="num">Deco</th>
                      <th className="num">GF99</th>
                      <th>Soste</th>
                    </tr>
                  </thead>
                  <tbody>
                    {giornata.map((g, i) => (
                      <tr key={i}>
                        <td>
                          <b>{i === 0 ? 'Prima' : 'Seconda'}</b>{' '}
                          <span className="muted">
                            {i === 0
                              ? `${levels[0].depthM} m × ${levels[0].minutes} min`
                              : `${second.depthM} m × ${second.minutes} min, dopo ${second.surfaceMin} min`}
                          </span>
                        </td>
                        <td className="num tabular">{g.runtimeMin.toFixed(0)}</td>
                        <td className="num tabular">{g.decoMin}</td>
                        <td className="num tabular">{g.gf99EndPct.toFixed(0)}%</td>
                        <td className="tabular" style={{ fontSize: 11 }}>
                          {g.stops.map((x) => `${x.depthM}/${x.minutes}`).join(' · ') || 'in curva'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="planner-hint" style={{ marginTop: 8 }}>
              Sposta l'intervallo di superficie e guarda la riga di sotto: è il modo più diretto di vedere
              quanto vale un'ora in più di pausa. La prima immersione non cambia mai — è la seconda a pagare.
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2>Le miscele</h2>
        <p className="card-sub">
          La profondità di cambio è calcolata dalla MOD — 1.4 bar per i gas di fondo, 1.6 per quelli di
          decompressione — e si può correggere. In risalita il piano passa da solo al gas più ricco
          respirabile a quella quota: è la regola che evita di dimenticarsi l'ultimo cambio.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Ruolo</th>
                <th className="num">O₂ %</th>
                <th className="num">He %</th>
                <th className="num">Cambio</th>
                <th className="num">Litri</th>
                <th className="num">Bar</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {gases.map((gas, i) => (
                <tr key={i}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{gasLabel(gas)}</div>
                    <select
                      value={gas.role}
                      aria-label={`Ruolo di ${gasLabel(gas)}`}
                      onChange={(e) => setGas(i, { role: e.target.value as PlanGas['role'] })}
                      style={{ fontSize: 11, marginTop: 2 }}
                    >
                      <option value="bottom">fondo</option>
                      <option value="travel">transito</option>
                      <option value="deco">decompressione</option>
                    </select>
                  </td>
                  <td className="num">
                    <Cell
                      label={`Ossigeno di ${gasLabel(gas)}, percento`}
                      value={Math.round(gas.mix.o2 * 100)}
                      min={5}
                      max={100}
                      onChange={(v) => setMix(i, gas, 'o2', v)}
                    />
                  </td>
                  <td className="num">
                    <Cell
                      label={`Elio di ${gasLabel(gas)}, percento`}
                      value={Math.round(gas.mix.he * 100)}
                      min={0}
                      max={90}
                      onChange={(v) => setMix(i, gas, 'he', v)}
                    />
                  </td>
                  <td className="num">
                    <Cell
                      label={`Profondità di cambio di ${gasLabel(gas)}, metri`}
                      value={gas.switchDepthM ?? switchDepthOf(gas, settings)}
                      min={3}
                      max={150}
                      onChange={(v) => setGas(i, { switchDepthM: v })}
                    />
                    <div className="muted" style={{ fontSize: 10 }}>
                      m
                    </div>
                  </td>
                  <td className="num">
                    <Cell
                      label={`Capacità della bombola di ${gasLabel(gas)}, litri`}
                      value={gas.tankL ?? 0}
                      min={0}
                      max={40}
                      onChange={(v) => setGas(i, { tankL: v })}
                    />
                  </td>
                  <td className="num">
                    <Cell
                      label={`Pressione di partenza di ${gasLabel(gas)}, bar`}
                      value={gas.startBar ?? 0}
                      min={0}
                      max={300}
                      onChange={(v) => setGas(i, { startBar: v })}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {gases.length > 1 && (
                      <button
                        style={{ fontSize: 11, padding: '3px 8px' }}
                        onClick={() => setGases((p) => p.filter((_, k) => k !== i))}
                      >
                        Togli
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button onClick={() => setGases((p) => [...p, { mix: { o2: 1, he: 0 }, role: 'deco', ...STAGE }])}>
            Aggiungi ossigeno
          </button>
          <button
            onClick={() => setGases((p) => [...p, { mix: { o2: 0.32, he: 0 }, role: 'travel', ...STAGE }])}
          >
            Aggiungi gas di transito
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Come risali</h2>
        <div className="grid grid-3" style={{ gap: 10 }}>
          <NumField
            label="GF basso"
            unit="%"
            value={Math.round(base.gfLow * 100)}
            min={5}
            max={100}
            step={5}
            onChange={(v) => set('gfLow', v / 100)}
          />
          <NumField
            label="GF alto"
            unit="%"
            value={Math.round(base.gfHigh * 100)}
            min={30}
            max={100}
            step={5}
            onChange={(v) => set('gfHigh', v / 100)}
          />
          <NumField
            label="Risalita"
            unit="m/min"
            value={base.ascentRateMpm}
            min={3}
            max={18}
            step={1}
            onChange={(v) => set('ascentRateMpm', v)}
          />
          <NumField
            label="Discesa"
            unit="m/min"
            value={base.descentRateMpm}
            min={6}
            max={40}
            step={1}
            onChange={(v) => set('descentRateMpm', v)}
          />
          <NumField
            label="Ultima sosta"
            unit="m"
            value={base.lastStopM}
            min={3}
            max={9}
            step={3}
            onChange={(v) => set('lastStopM', v)}
          />
          <NumField
            label="Passo fra le soste"
            unit="m"
            value={base.stopIntervalM}
            min={1}
            max={6}
            step={1}
            onChange={(v) => set('stopIntervalM', v)}
          />
          <NumField
            label="Consumo al fondo"
            unit="L/min"
            value={base.rmvLpm}
            min={8}
            max={40}
            step={1}
            onChange={(v) => set('rmvLpm', v)}
          />
          <NumField
            label="Consumo in deco"
            unit="L/min"
            value={base.decoRmvLpm}
            min={8}
            max={40}
            step={1}
            onChange={(v) => set('decoRmvLpm', v)}
          />
          <NumField
            label="Tempo di cambio gas"
            unit="min"
            value={base.switchMin}
            min={0}
            max={5}
            step={1}
            onChange={(v) => set('switchMin', v)}
          />
        </div>

        <label
          className="planner-check"
          style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}
        >
          <input
            type="checkbox"
            checked={base.safetyStop !== null}
            onChange={(e) => set('safetyStop', e.target.checked ? { depthM: 5, minutes: 3 } : null)}
          />
          <span>Sosta di sicurezza</span>
        </label>
        {base.safetyStop && (
          <>
            <div className="grid grid-3" style={{ gap: 10, marginTop: 8 }}>
              <NumField
                label="Profondità della sosta"
                unit="m"
                value={base.safetyStop.depthM}
                min={3}
                max={9}
                step={1}
                onChange={(v) => set('safetyStop', { ...base.safetyStop!, depthM: v })}
              />
              <NumField
                label="Durata"
                unit="min"
                value={base.safetyStop.minutes}
                min={1}
                max={15}
                step={1}
                onChange={(v) => set('safetyStop', { ...base.safetyStop!, minutes: v })}
              />
            </div>
            <p className="planner-hint" style={{ marginTop: 6 }}>
              Non è obbligatoria e nessun modello la impone: su un'immersione bassa il piano che esce dal
              modello arriva in superficie senza fermarsi. La si conta perché quasi tutti la fanno, e tre
              minuti non calcolati sono tre minuti di gas non calcolato. L'app non la aggiunge quando il
              modello impone già una sosta a quella quota o più bassa — in decompressione l'ultima sosta fa
              già quel mestiere — né sotto i {SAFETY_STOP_MIN_DEPTH_M} metri di profondità massima.
            </p>
          </>
        )}

        <div className="grid grid-2" style={{ gap: 10, marginTop: 14 }}>
          <label className="planner-field">
            <span className="planner-label">Modello decompressivo</span>
            <select value={model} onChange={(e) => setModel(e.target.value as typeof model)}>
              <option value="buhlmann">Bühlmann ZH-L16C con gradient factor</option>
              <option value="vpm">VPM-B (modello a bolle)</option>
              <option value="both">Il più lungo dei due, sosta per sosta</option>
            </select>
          </label>
          {model !== 'buhlmann' && (
            <NumField
              label="Conservatorismo VPM"
              unit="0-5"
              value={conservatism}
              min={0}
              max={5}
              step={1}
              onChange={setConservatism}
            />
          )}
        </div>
        {model !== 'buhlmann' && (
          <div className="notice" style={{ marginTop: 10 }}>
            <strong style={{ fontWeight: 650 }}>Due cose da sapere sul nostro VPM-B. </strong>
            Le tabelle escono dal 5 al 10 per cento più corte di V-Planner e MultiDeco a parità di
            conservatorismo — il confronto con le schedule pubblicate sta nei test, e se vuoi allinearti al
            tuo pianificatore alza di un livello. E soprattutto: <b>manca l'algoritmo ripetitivo del VPM</b>,
            quindi sulla seconda immersione della giornata il modello è ottimista. Con Bühlmann il carico
            residuo invece è tenuto in conto.
            {vpm.iterations >= 12 && (
              <>
                {' '}
                <b>Su questo profilo il volume critico non è arrivato a convergenza</b> ({vpm.iterations}{' '}
                iterazioni): la tabella non va usata.
              </>
            )}
          </div>
        )}

        <label
          className="planner-check"
          style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}
        >
          <input type="checkbox" checked={ccr} onChange={(e) => setCcr(e.target.checked)} />
          <span>Circuito chiuso (rebreather)</span>
        </label>
        {ccr && (
          <>
            <p className="planner-hint" style={{ marginTop: 6 }}>
              Con il circuito chiuso il gas non se ne va con la ventilazione ma con il metabolismo, che della
              profondità non sa niente: è il motivo per cui un rebreather fa immersioni lunghe e profonde con
              bombole piccole. Il primo gas dell'elenco diventa il diluente; i gas marcati «bailout» non si
              usano nel piano ma entrano nella risalita d'emergenza qui sotto.
            </p>
            <div className="grid grid-3" style={{ gap: 10, marginTop: 10 }}>
              <NumField
                label="Setpoint"
                unit="bar"
                value={setpoint}
                min={0.4}
                max={1.6}
                step={0.1}
                onChange={setSetpoint}
              />
              <NumField
                label="Consumo O₂ al fondo"
                unit="L/min"
                value={base.morLpm}
                min={0.3}
                max={2}
                step={0.1}
                onChange={(v) => set('morLpm', v)}
              />
              <NumField
                label="Consumo O₂ in deco"
                unit="L/min"
                value={base.decoMorLpm}
                min={0.3}
                max={2}
                step={0.1}
                onChange={(v) => set('decoMorLpm', v)}
              />
              <NumField
                label="Volume del circuito"
                unit="L"
                value={base.loopVolumeL}
                min={2}
                max={12}
                step={1}
                onChange={(v) => set('loopVolumeL', v)}
              />
              <NumField
                label="Bombola O₂"
                unit="L"
                value={base.ccrO2TankL ?? 3}
                min={1}
                max={10}
                step={1}
                onChange={(v) => set('ccrO2TankL', v)}
              />
              <NumField
                label="O₂ di partenza"
                unit="bar"
                value={base.ccrO2StartBar ?? 200}
                min={50}
                max={300}
                step={10}
                onChange={(v) => set('ccrO2StartBar', v)}
              />
            </div>
          </>
        )}
        <p className="planner-hint" style={{ marginTop: 8 }}>
          Consumo al fondo e in decompressione sono due numeri diversi perché lo sono davvero: fermo a sei
          metri si respira meno che nuotando a quaranta, e usare lo stesso valore gonfia il gas di
          decompressione di un buon venti per cento.
        </p>
      </div>

      <div className="grid grid-tiles">
        <StatTile
          label="Runtime"
          value={
            <span className="tabular">
              {plan.runtimeMin.toFixed(0)} <small style={{ fontSize: 14 }}>min</small>
              <Was before={before?.runtime} now={plan.runtimeMin} />
            </span>
          }
          note={`di cui ${plan.ascentMin.toFixed(0)} di risalita`}
        />
        <StatTile
          label="Decompressione"
          value={
            <span
              className="tabular"
              style={{ color: plan.decoMin > 0 ? 'var(--warning)' : 'var(--good-text)' }}
            >
              {plan.decoMin} <small style={{ fontSize: 14 }}>min</small>
              <Was before={before?.deco} now={plan.decoMin} />
            </span>
          }
          note={
            plan.noDeco
              ? plan.safetyStopMin > 0
                ? `in curva, più ${plan.safetyStopMin} min di sosta di sicurezza`
                : 'il piano resta in curva'
              : `prima sosta a ${plan.firstStopM} m`
          }
        />
        <StatTile
          label="Curva al primo livello"
          value={
            <span className="tabular">
              {plan.ndlMin.toFixed(0)} <small style={{ fontSize: 14 }}>min</small>
              <Was before={before?.ndl} now={plan.ndlMin} />
            </span>
          }
          note="quanto potresti restare senza prendere obblighi"
        />
        <StatTile
          label="GF99 previsto"
          value={
            <span className="tabular">
              {plan.gf99EndPct.toFixed(0)}%
              <Was before={before?.gf99} now={plan.gf99EndPct} />
            </span>
          }
          note={`all'uscita, con GF ${Math.round(settings.gfLow * 100)}/${Math.round(settings.gfHigh * 100)}`}
        />
      </div>

      {plan.warnings.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {plan.warnings.map((w) => (
            <div key={w.text} className={w.level === 'critical' ? 'notice notice-error' : 'notice'}>
              <strong style={{ fontWeight: 650 }}>
                {w.level === 'critical'
                  ? 'Il piano non regge: '
                  : w.level === 'warning'
                    ? 'Attenzione: '
                    : 'Da sapere: '}
              </strong>
              {w.text}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>La tabella</h2>
        <p className="card-sub">
          Una riga per tratto, con il runtime a fine tratto: è il numero che si scrive sulla lavagnetta,
          perché in acqua si guarda l'orologio, non il cronometro delle singole soste.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tratto</th>
                <th className="num">Quota</th>
                <th className="num">Min</th>
                <th className="num">RT</th>
                <th>Gas</th>
                <th className="num">PPO2</th>
                <th className="num">EAD/END</th>
                <th className="num">CNS</th>
              </tr>
            </thead>
            <tbody>
              {plan.segments.map((seg, i) => (
                <tr key={i} style={{ background: seg.kind === 'stop' ? 'var(--surface-2)' : undefined }}>
                  <td>{KIND_LABEL[seg.kind]}</td>
                  <td className="num tabular">
                    {seg.fromM === seg.toM ? `${seg.toM} m` : `${seg.fromM}→${seg.toM} m`}
                  </td>
                  <td className="num tabular">{seg.minutes.toFixed(seg.minutes % 1 ? 1 : 0)}</td>
                  <td className="num tabular" style={{ fontWeight: 650 }}>
                    {seg.runtimeMin.toFixed(0)}
                  </td>
                  <td>{gasLabel(gases[seg.gasIndex])}</td>
                  <td
                    className="num tabular"
                    style={{
                      color:
                        seg.ppo2 > settings.maxPpo2Deco + 0.05
                          ? 'var(--critical)'
                          : seg.ppo2 > settings.maxPpo2Work
                            ? 'var(--warning)'
                            : undefined,
                    }}
                  >
                    {seg.ppo2.toFixed(2)}
                  </td>
                  <td className="num tabular">
                    {seg.eadM.toFixed(0)}/{seg.endM.toFixed(0)}
                  </td>
                  <td className="num tabular">{seg.cnsTotal.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {plan.offgassingFromM !== undefined && (
          <p className="planner-hint" style={{ marginTop: 8 }}>
            La desaturazione comincia a {plan.offgassingFromM} m: sopra quella quota i tessuti che comandano
            scaricano invece di caricare.
          </p>
        )}
      </div>

      <div className="card">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0 }}>Da portare in acqua</h2>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              {plan.stops.length > 0
                ? 'Le soste con il runtime a cui arrivarci, e sotto il piano in testo semplice: si copia sulla lavagnetta, si incolla in un messaggio, si stampa.'
                : 'Il piano resta in curva, ma il foglio serve lo stesso: gas, limiti e avvisi in testo semplice.'}
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(tableText).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              {copied ? 'Copiato' : 'Copia'}
            </button>
            <button
              onClick={() =>
                downloadText(tableText, `piano-${levels[0]?.depthM ?? 0}m-${levels[0]?.minutes ?? 0}min.txt`)
              }
            >
              Scarica
            </button>
          </div>
        </div>

        <pre
          style={{
            marginTop: 12,
            padding: 12,
            background: 'var(--surface-2)',
            borderRadius: 8,
            fontSize: 12,
            overflowX: 'auto',
            whiteSpace: 'pre',
          }}
        >
          {tableText}
        </pre>
      </div>

      {plan.stops.length > 0 && (
        <div className="card">
          <h2>Le soste, in tabella</h2>
          <p className="card-sub">Le stesse righe del foglio, per leggerle sullo schermo.</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="num">Quota</th>
                  <th className="num">Minuti</th>
                  <th className="num">Runtime</th>
                  <th>Gas</th>
                </tr>
              </thead>
              <tbody>
                {plan.stops.map((s) => (
                  <tr key={`${s.depthM}-${s.mandatory}`}>
                    <td className="num tabular" style={{ fontWeight: 650 }}>
                      {s.depthM} m
                    </td>
                    <td className="num tabular">{s.minutes}</td>
                    <td className="num tabular">{s.runtimeMin}</td>
                    <td>
                      {gasLabel(gases[s.gasIndex])}
                      {!s.mandatory && <span className="muted"> · sicurezza, non obbligatoria</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <h2>Il gas che serve</h2>
          <p className="card-sub">
            In litri e, dove la bombola è nota, in bar. La riserva non è compresa: questo è il consumo del
            piano, non quello che devi avere a bordo.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Gas</th>
                  <th className="num">Litri</th>
                  <th className="num">Bar</th>
                  <th className="num">A bordo</th>
                </tr>
              </thead>
              <tbody>
                {plan.gasUsage
                  .filter((u) => u.litres > 0)
                  .map((u) => (
                    <tr key={u.gasIndex}>
                      <td>{gasLabel(gases[u.gasIndex])}</td>
                      <td className="num tabular">{u.litres}</td>
                      <td
                        className="num tabular"
                        style={{ color: u.insufficient ? 'var(--critical)' : undefined }}
                      >
                        {u.bar ?? '—'}
                      </td>
                      <td className="num tabular muted">{u.startBar ?? '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Ossigeno e ritorno a casa</h2>
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
              note="di questa sola immersione"
            />
            <StatTile
              label="OTU"
              value={<span className="tabular">{plan.oxygen.otu.toFixed(0)}</span>}
              note={`riferimento giornaliero ${OTU_DAILY_TDI}`}
            />
            <StatTile
              label="Prima di volare"
              value={
                <span className="tabular">
                  {plan.timeToFlyH !== undefined ? `${plan.timeToFlyH} h` : '—'}
                </span>
              }
              note="secondo il modello, non secondo le didattiche"
            />
          </div>
          <p className="planner-hint" style={{ marginTop: 10 }}>
            Le ore prima del volo sono l'uscita di un modello: dicono quando il tetto scende sotto la quota di
            cabina. Le 12, 18 o 24 ore che insegnano i corsi sono regole costruite su statistiche di
            incidenti, e sono l'unica cosa a cui attenersi. Il numero qui sopra serve a capire perché quelle
            regole esistono, non a scavalcarle.
          </p>
        </div>
      </div>

      {plan.ccr && (
        <div className="card">
          <h2>Il circuito chiuso</h2>
          <p className="card-sub">
            L'ossigeno metabolico non dipende dalla profondità; il diluente serve solo a riempire il circuito
            scendendo, perché risalendo il gas in eccesso esce dalla valvola e non si consuma.
          </p>
          <div className="grid grid-tiles" style={{ gap: 10 }}>
            <StatTile
              label="Ossigeno metabolico"
              value={
                <span
                  className="tabular"
                  style={{ color: plan.ccr.insufficientO2 ? 'var(--critical)' : undefined }}
                >
                  {plan.ccr.o2Litres} <small style={{ fontSize: 14 }}>L</small>
                </span>
              }
              note={
                plan.ccr.o2Bar !== undefined
                  ? `${plan.ccr.o2Bar} bar sulla bombola da ${base.ccrO2TankL ?? 3} L`
                  : 'bombola non dichiarata'
              }
            />
            <StatTile
              label="Diluente"
              value={
                <span className="tabular">
                  {plan.ccr.diluentLitres} <small style={{ fontSize: 14 }}>L</small>
                </span>
              }
              note="solo per riempire il circuito in discesa"
            />
            <StatTile
              label="Runtime"
              value={
                <span className="tabular">
                  {plan.runtimeMin.toFixed(0)} <small style={{ fontSize: 14 }}>min</small>
                </span>
              }
              note={`${plan.decoMin} min di decompressione`}
            />
          </div>

          {bailout && (
            <>
              <h3 style={{ margin: '18px 0 4px', fontSize: 14 }}>Bailout</h3>
              <p className="card-sub">
                Il circuito si chiude e si esce a circuito aperto. Dal fondo è il caso peggiore ed è quello da
                guardare per primo; se il gas non basta, la domanda diventa «da dove in su ce la faccio», e
                quella si risponde solo provando quote diverse.
              </p>
              <label className="planner-field" style={{ maxWidth: 320, marginBottom: 10 }}>
                <span className="planner-label">Il guasto avviene a</span>
                <select
                  value={bailFrom ?? ''}
                  onChange={(e) => setBailFrom(e.target.value === '' ? null : Number(e.target.value))}
                >
                  <option value="">fine del fondo — il caso peggiore</option>
                  {plan.stops.map((st) => (
                    <option key={st.depthM} value={st.depthM}>
                      alla sosta dei {st.depthM} m
                    </option>
                  ))}
                  {[Math.round(Math.max(...effectiveLevels.map((l) => l.depthM)) / 2)].map((d) => (
                    <option key={`half-${d}`} value={d}>
                      a metà risalita, {d} m
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-tiles" style={{ gap: 10 }}>
                <StatTile
                  label="Risalita d'emergenza"
                  value={
                    <span className="tabular">
                      {bailout.runtimeMin.toFixed(0)} <small style={{ fontSize: 14 }}>min</small>
                    </span>
                  }
                  note={`${bailout.decoMin} min di soste, prima a ${bailout.firstStopM ?? '—'} m`}
                />
                {bailout.gasUsage
                  .filter((u) => u.litres > 0)
                  .map((u) => (
                    <StatTile
                      key={u.gasIndex}
                      label={`Ti serve ${gasLabel(gases[u.gasIndex])}`}
                      value={
                        <span
                          className="tabular"
                          style={{ color: u.insufficient ? 'var(--critical)' : undefined }}
                        >
                          {u.bar ?? u.litres}{' '}
                          <small style={{ fontSize: 14 }}>{u.bar !== undefined ? 'bar' : 'L'}</small>
                        </span>
                      }
                      note={u.startBar !== undefined ? `su ${u.startBar} a bordo` : `${u.litres} litri`}
                    />
                  ))}
              </div>
              {bailout.warnings
                .filter((w) => w.level === 'critical')
                .map((w) => (
                  <div key={w.text} className="notice notice-error" style={{ marginTop: 10 }}>
                    <strong style={{ fontWeight: 650 }}>Il bailout non regge: </strong>
                    {w.text}
                  </div>
                ))}
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2>I due modelli a confronto</h2>
        <p className="card-sub">
          Stesso profilo, stessi gas, due teorie diverse su cosa succede alle bolle. Bühlmann conta la
          sovrasaturazione dei tessuti e lascia risalire finché sta sotto una soglia; VPM-B conta i nuclei
          gassosi e li vuole schiacciati presto, quindi mette le soste più in profondità e ne toglie in
          superficie. Non c'è un vincitore: c'è che vederli affiancati dice quanto di quello che stai per fare
          dipende dal modello e non dalla fisica.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Modello</th>
                <th className="num">Prima sosta</th>
                <th className="num">Minuti di soste</th>
                <th>Tabella</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: model === 'buhlmann' ? 'var(--surface-2)' : undefined }}>
                <td>
                  <b>Bühlmann-GF</b>{' '}
                  <span className="muted">
                    {Math.round(settings.gfLow * 100)}/{Math.round(settings.gfHigh * 100)}
                  </span>
                </td>
                <td className="num tabular">{buhlmann.firstStopM ?? '—'}</td>
                <td className="num tabular">{buhlmann.decoMin}</td>
                <td className="tabular" style={{ fontSize: 11 }}>
                  {buhlmann.stops.map((x) => `${x.depthM}/${x.minutes}`).join(' · ') || 'in curva'}
                </td>
              </tr>
              <tr style={{ background: model === 'vpm' ? 'var(--surface-2)' : undefined }}>
                <td>
                  <b>VPM-B</b> <span className="muted">cons. {conservatism}</span>
                </td>
                <td className="num tabular">{vpm.firstStopM ?? '—'}</td>
                <td className="num tabular">{vpm.decoMin}</td>
                <td className="tabular" style={{ fontSize: 11 }}>
                  {vpm.stops.map((x) => `${x.depthM}/${x.minutes}`).join(' · ') || 'in curva'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Piani messi da parte</h2>
        <p className="card-sub">
          Il piano su cui stai lavorando si salva da sé. Questi sono quelli che vuoi ritrovare: un piano
          tecnico è una configurazione che si riusa — il relitto, la parete, il corso — non un modulo da
          ricompilare ogni volta.
        </p>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label className="planner-field" style={{ flex: 1, maxWidth: 320 }}>
            <span className="planner-label">Nome</span>
            <input
              value={planName}
              placeholder="Relitto a 45 con Tx21/35"
              onChange={(e) => setPlanName(e.target.value)}
            />
          </label>
          <button
            className="btn btn-primary"
            disabled={!planName.trim()}
            onClick={() => {
              void onSavePlan?.(planName.trim(), current());
              setPlanName('');
            }}
          >
            Metti da parte
          </button>
        </div>

        {savedPlans.length > 0 && (
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th className="num">Salvato</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {savedPlans.map((p) => (
                  <tr key={p.name}>
                    <td style={{ fontWeight: 550 }}>{p.name}</td>
                    <td className="num tabular muted">{dateShort(p.savedAt)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          onClick={() => onLoadPlan?.(p.state)}
                        >
                          Carica
                        </button>
                        <button
                          style={{ fontSize: 11, padding: '3px 8px', color: 'var(--critical)' }}
                          onClick={() => void onDeletePlan?.(p.name)}
                        >
                          Elimina
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnalysisCard
        kind="deco"
        deco={{
          result: plan,
          levels: effectiveLevels,
          gases,
          settings,
          contingencies: contingenze,
          modelLabel:
            model === 'buhlmann'
              ? `Bühlmann ZH-L16C con GF ${Math.round(settings.gfLow * 100)}/${Math.round(settings.gfHigh * 100)}`
              : model === 'vpm'
                ? `VPM-B, conservatorismo ${conservatism}`
                : `il più lungo fra Bühlmann-GF ${Math.round(settings.gfLow * 100)}/${Math.round(settings.gfHigh * 100)} e VPM-B conservatorismo ${conservatism}, sosta per sosta`,
        }}
        title="Fai rileggere il piano a Claude"
        description="Un piano tecnico si controlla in due: si scrive, si passa al compagno, e quello guarda se torna. Qui va tutto — livelli, miscele, soste, gas, ossigeno, contingenze — con l'istruzione esplicita di NON riscrivere la tabella: se una sosta non convince, deve dire quale controllo la mette in dubbio, non proporne un'altra."
        currentFingerprint={tableText}
      />

      <div className="card">
        <h2>Se qualcosa cambia</h2>
        <p className="card-sub">
          Le quattro cose che succedono: sei sceso più giù, sei rimasto più a lungo, tutt'e due, e hai perso
          un gas. Il momento di sapere quanto costano è adesso.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th className="num">Runtime</th>
                <th className="num">Deco</th>
                <th className="num">Prima sosta</th>
                <th style={{ textAlign: 'right' }}>Gas</th>
              </tr>
            </thead>
            <tbody>
              {contingenze.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div style={{ fontWeight: 550 }}>{c.label}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {c.description}
                    </div>
                  </td>
                  <td className="num tabular">
                    {c.result.runtimeMin.toFixed(0)}{' '}
                    <span className="muted">
                      ({c.extraRuntimeMin >= 0 ? '+' : ''}
                      {c.extraRuntimeMin})
                    </span>
                  </td>
                  <td className="num tabular">
                    {c.result.decoMin}{' '}
                    <span className="muted">
                      ({c.extraDecoMin >= 0 ? '+' : ''}
                      {c.extraDecoMin})
                    </span>
                  </td>
                  <td className="num tabular">{c.result.firstStopM ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <span className={`dot ${c.breaks ? 'dot-critical' : 'dot-good'}`} />
                      {c.breaks ? 'non basta' : 'basta'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const KIND_LABEL: Record<string, string> = {
  descent: 'discesa',
  level: 'fondo',
  ascent: 'risalita',
  stop: 'sosta',
  switch: 'cambio gas',
};

function NumField({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="planner-field">
      <span className="planner-label">
        {label} {unit && <span className="muted">({unit})</span>}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
      />
    </label>
  );
}

function Cell({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  /**
   * Nome accessibile della casella. In una tabella l'intestazione di colonna non
   * basta: chi naviga con la tastiera o con uno screen reader sente «campo
   * numerico» dodici volte di seguito senza sapere se sta cambiando l'ossigeno
   * della prima bombola o i bar della terza.
   */
  label: string;
}) {
  return (
    <input
      type="number"
      aria-label={label}
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
      }}
      style={{ width: 64, textAlign: 'right' }}
    />
  );
}

/** Scarica un testo come file: il piano finisce dove serve, non solo a schermo. */
function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Il valore di un attimo fa.
 *
 * PERCHÉ NON BASTA IL NUMERO NUOVO. Perché pianificare è un'operazione a tentativi:
 * si sposta la profondità di tre metri e si guarda cosa succede. Con il solo valore
 * aggiornato bisogna ricordarsi quello di prima, e nessuno se lo ricorda — si
 * finisce per spostare il numero avanti e indietro per capire di quanto è cambiato.
 * È la cosa che chi usa Baltic cita per prima quando spiega perché lo ha comprato.
 *
 * Aggiorna DOPO il disegno, così quello che si legge è la differenza fra prima e
 * adesso e non fra adesso e adesso.
 */
/**
 * L'ultimo valore DIVERSO da quello attuale.
 *
 * La versione con `useEffect` senza dipendenze aggiornava il riferimento a ogni
 * render, e il pianificatore ne fa parecchi che non c'entrano col piano — il
 * salvataggio automatico dell'input ne provoca uno subito dopo il calcolo. Il
 * risultato era che «era 47» compariva per una frazione di secondo e spariva.
 * Qui il confronto è sul contenuto e avviene durante il render: finché il piano
 * non cambia davvero, il valore precedente resta quello e la scritta resta
 * leggibile.
 */
function usePrevious<T>(value: T): T | undefined {
  const key = JSON.stringify(value);
  const current = useRef<{ key: string; value: T } | undefined>(undefined);
  const previous = useRef<T | undefined>(undefined);
  if (!current.current) current.current = { key, value };
  else if (current.current.key !== key) {
    previous.current = current.current.value;
    current.current = { key, value };
  }
  return previous.current;
}

/** «era 47» accanto al numero, e niente quando non è cambiato. */
function Was({ before, now, digits = 0 }: { before?: number; now: number; digits?: number }) {
  if (before === undefined) return null;
  if (Math.abs(before - now) < Math.pow(10, -digits) / 2) return null;
  return (
    <small className="muted" style={{ fontSize: 12, fontWeight: 500, marginLeft: 6 }}>
      era {before.toFixed(digits)}
    </small>
  );
}

/**
 * Il più lungo dei due, sosta per sosta.
 *
 * È la strategia che Baltic chiama VPM-B/GFS: non si sceglie un modello, si prende
 * per ogni quota la sosta più lunga fra le due tabelle. Il risultato non è la
 * tabella di nessuno dei due modelli — ed è il motivo per cui va detto: è una
 * scelta di prudenza, non una teoria.
 */
function longestOf(a: VpmStop[], b: VpmStop[]): VpmStop[] {
  const byDepth = new Map<number, number>();
  for (const s of [...a, ...b]) {
    byDepth.set(s.depthM, Math.max(byDepth.get(s.depthM) ?? 0, s.minutes));
  }
  return [...byDepth.entries()]
    .map(([depthM, minutes]) => ({ depthM, minutes }))
    .sort((x, y) => y.depthM - x.depthM);
}
