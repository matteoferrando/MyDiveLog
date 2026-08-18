import { useEffect, useMemo, useState } from 'react';
import { LIMITS, type ComputerInfo, type Dive, type Sample } from '../../core/model';
import { formatDuration, mixName } from '../../core/units';
import { modeLabel, positionAgainst, quartilesOf } from '../../core/analysis/aggregate';
import { debriefDive } from '../../core/analysis/coaching';
import { logbookHtml } from '../../core/export/logbookPrint';
import { DepthProfile, MiniSeries } from '../components/DepthProfile';
import { RATE_WINDOW_S, windowedRates } from '../../core/analysis/metrics';
import { StatTile } from '../components/Charts';
import { useDiveLog } from '../state';
import { AnalysisCard } from '../components/Analysis';
import { SaturationCard } from '../components/Saturation';
import { decoTimeline, entryStateFor, gfOf, type DecoPoint } from '../../core/analysis/tissues';
import {
  capitalise,
  dateLong,
  FORMAT_LABEL,
  SEVERITY_CLASS,
  SEVERITY_TEXT,
  timeShort,
  tzLabel,
} from '../format';

export function DiveDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { dives, loadProfiles, saveDive, removeDive } = useDiveLog();
  const summary = dives.find((d) => d.id === id);
  const [dive, setDive] = useState<Dive | undefined>(summary);
  const [editing, setEditing] = useState(false);
  // Istante puntato dal mouse, condiviso da tutti i grafici della scheda: è ciò
  // che permette di leggere in verticale "quando sono scesa, il TTS è salito".
  const [cursorT, setCursorT] = useState<number | null>(null);
  // Quale dei due profili mostrare, quando l'immersione è stata registrata da due
  // computer: quello con i dati decompressivi o quello più fitto.
  const [showAlt, setShowAlt] = useState(false);
  // Vero solo quando `window.open` è stato rifiutato dal blocco dei popup. Un
  // bottone che non fa niente e non dice perché è peggio di un bottone assente:
  // qui la ragione è sempre la stessa, e si può spiegare in una riga.
  const [stampaBloccata, setStampaBloccata] = useState(false);

  useEffect(() => {
    if (!summary) return;
    setDive(summary);
    let cancelled = false;
    void loadProfiles(summary.id).then(({ samples, altSamples }) => {
      if (!cancelled) setDive({ ...summary, samples, altSamples });
    });
    return () => {
      cancelled = true;
    };
  }, [summary, loadProfiles]);

  const observations = useMemo(() => (dive ? debriefDive(dive) : []), [dive]);

  // Curva, tetto e TTS ricalcolati da noi lungo tutta l'immersione. Costa una
  // trentina di millisecondi su un profilo da quaranta minuti, e si rifà solo
  // quando cambia il profilo mostrato.
  const timeline = useMemo(() => {
    if (!dive?.samples?.length) return [];
    return decoTimeline(dive, dive.samples, { initial: entryStateFor(dive, dives).state });
  }, [dive, dives]);

  if (!dive) {
    return (
      <div className="page">
        <div className="empty">
          <h2>Immersione non trovata</h2>
          <button className="btn" onClick={onBack}>
            Torna al logbook
          </button>
        </div>
      </div>
    );
  }

  const m = dive.metrics;
  const hasAlt = (dive.altSamples?.length ?? 0) > 2;
  // Il profilo mostrato può essere il secondo, su richiesta. Le metriche NON
  // cambiano: sono calcolate una volta sul dato migliore disponibile, e mostrarle
  // diverse a seconda della curva visualizzata sarebbe fuorviante.
  const shown: Dive = showAlt && hasAlt ? { ...dive, samples: dive.altSamples } : dive;
  const samples = shown.samples ?? [];
  // Velocità verticale sulla stessa finestra di 30 s con cui vengono contate le
  // violazioni: il grafico e il giudizio devono venire dal medesimo calcolo,
  // altrimenti la scheda dice "8 m/min di picco" e la curva ne mostra 14.
  const rates = windowedRates(samples, RATE_WINDOW_S);
  const hasPressure = samples.some((s) => s.pressureBar?.some((p) => p !== undefined));

  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">
            {dive.site?.name ?? 'Immersione'}
            {dive.number !== undefined && <span className="muted" style={{ fontWeight: 400 }}> · #{dive.number}</span>}
          </h1>
          <div className="secondary" style={{ fontSize: 13 }}>
            {capitalise(dateLong(dive.startTime, dive.utcOffsetMinutes))} ·{' '}
            {timeShort(dive.startTime, dive.utcOffsetMinutes)}
            {tzLabel(dive.utcOffsetMinutes) && (
              <span className="muted"> ({tzLabel(dive.utcOffsetMinutes)}, ora locale del sito)</span>
            )}
          </div>
        </div>
        <div className="row">
          <button className="btn btn-quiet" onClick={onBack}>
            ← Logbook
          </button>
          <button className="btn" onClick={() => setStampaBloccata(!apriStampa(dive))}>
            Stampa questa immersione
          </button>
          <button className="btn" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Chiudi modifica' : 'Modifica dati'}
          </button>
        </div>
      </div>

      {stampaBloccata && (
        <div className="notice">
          La finestra di stampa non si è aperta: il browser ha bloccato l’apertura di una nuova
          finestra. Consentila per questo sito e riprova — la stampa non modifica nulla
          nell’archivio, apre soltanto una copia del foglio da stampare.
        </div>
      )}

      <div className="grid grid-tiles">
        <StatTile label="Profondità massima" value={`${dive.maxDepth.toFixed(1)} m`} note={m?.avgDepth !== undefined ? `media ${m.avgDepth.toFixed(1)} m` : 'media non disponibile'} />
        <StatTile label="Durata" value={formatDuration(dive.durationS)} note={m ? `fondo ${formatDuration(m.phases.bottomS)}` : undefined} />
        <StatTile
          label="Consumo di superficie"
          value={m?.rmvLpm !== undefined ? `${m.rmvLpm.toFixed(1)}` : '—'}
          note={m?.rmvLpm !== undefined ? 'L/min' : 'serve volume e pressione bombola'}
        />
        <StatTile
          label="Oscillazione a quota tenuta"
          value={m?.bottomVerticalTravelMpm !== undefined ? m.bottomVerticalTravelMpm.toFixed(1) : '—'}
          note={
            m?.bottomVerticalTravelMpm !== undefined
              ? `m/min verticali su ${formatDuration(m.holdingS ?? 0)} di quota tenuta`
              : 'serve un profilo campionato'
          }
        />
        <StatTile
          label="Risalita di picco"
          value={m?.maxAscentRateMpm !== undefined ? `${m.maxAscentRateMpm.toFixed(0)}` : '—'}
          note="m/min su 30 s"
        />
        <StatTile
          label="Temperatura minima"
          value={dive.minTempC !== undefined ? `${dive.minTempC.toFixed(1)} °C` : '—'}
          note={dive.airTempC !== undefined ? `aria ${dive.airTempC.toFixed(0)} °C` : undefined}
        />
      </div>

      <div className="card">
        <h2>Profilo</h2>
        <div className="spread" style={{ alignItems: 'flex-start', gap: 12 }}>
          <p className="card-sub">
            Profondità in metri, tempo in minuti.{' '}
            {samples.length > 2
              ? `${samples.length} campioni, uno ogni ${stepOf(samples)} s${
                  showAlt ? ' — secondo computer' : ''
                }.`
              : 'Nessun campionamento nel file di origine.'}
            {hasAlt && !showAlt && m?.quality.ratesFromAlt
              ? ` Velocità e assetto sono misurati sul profilo più fitto, a ${m.quality.ratesIntervalS} s, del secondo computer.`
              : ''}
          </p>
          {hasAlt && (
            <div className="row" style={{ gap: 6, flexShrink: 0 }}>
              <button className="btn" aria-pressed={!showAlt} onClick={() => setShowAlt(false)}>
                {dive.computer?.model ?? 'Profilo principale'}
              </button>
              <button className="btn" aria-pressed={showAlt} onClick={() => setShowAlt(true)}>
                {dive.otherComputers?.[0]?.model ?? 'Secondo profilo'}
              </button>
            </div>
          )}
        </div>
        <DepthProfile dive={shown} cursor={{ t: cursorT, onChange: setCursorT }} />
        {samples.some((s) => s.tempC !== undefined) && (
          <div style={{ marginTop: 10 }}>
            <MiniSeries
              samples={samples}
              pick={(s) => s.tempC}
              label="Temperatura"
              unit="°C"
              digits={1}
              color="var(--series-3)"
              cursor={{ t: cursorT, onChange: setCursorT }}
            />
          </div>
        )}
        {hasPressure && (
          <div style={{ marginTop: 6 }}>
            <MiniSeries
              samples={samples}
              pick={(s) => s.pressureBar?.find((p) => p !== undefined)}
              label="Pressione bombola"
              unit="bar"
              color="var(--series-2)"
              cursor={{ t: cursorT, onChange: setCursorT }}
              fill
            />
          </div>
        )}
        {/* Canali che solo i log Shearwater portano: quando ci sono, valgono un
            grafico ciascuno — il CNS e il tempo di risalita raccontano due cose
            diverse e sovrapporli su un asse solo li renderebbe illeggibili. */}
        {samples.length > 4 && (
          <div style={{ marginTop: 6 }}>
            <MiniSeries
              samples={samples}
              pick={(_s, i) => {
                const r = rates[i];
                return r === undefined ? undefined : Math.round(r * 10) / 10;
              }}
              label={`Velocità verticale su ${RATE_WINDOW_S} s — positiva in risalita`}
              unit="m/min"
              digits={1}
              color="var(--series-1)"
              cursor={{ t: cursorT, onChange: setCursorT }}
              reference={[
                { value: LIMITS.ascentRateDeepMpm, label: `limite ${LIMITS.ascentRateDeepMpm} sotto i 10 m` },
                { value: LIMITS.ascentRateShallowMpm, label: `limite ${LIMITS.ascentRateShallowMpm} sopra i 10 m`, color: 'var(--warning)' },
              ]}
            />
          </div>
        )}
        {samples.some((s) => s.rbtMin !== undefined) && (
          <div style={{ marginTop: 6 }}>
            <MiniSeries
              samples={samples}
              pick={(s) => s.rbtMin}
              label="Tempo di fondo residuo dal trasmettitore (RBT)"
              unit="min"
              color="var(--series-2)"
              cursor={{ t: cursorT, onChange: setCursorT }}
            />
          </div>
        )}
        {samples.some((s) => s.ttsS !== undefined) && (
          <div style={{ marginTop: 6 }}>
            <MiniSeries
              samples={samples}
              pick={(s) => (s.ttsS === undefined ? undefined : s.ttsS / 60)}
              label="Tempo di risalita (TTS) letto dal computer"
              unit="min"
              color="var(--series-2)"
              cursor={{ t: cursorT, onChange: setCursorT }}
            />
          </div>
        )}
        {samples.some((s) => s.ndlS !== undefined) && (
          <div style={{ marginTop: 6 }}>
            <MiniSeries
              samples={samples}
              pick={(s) => (s.ndlS === undefined ? undefined : s.ndlS / 60)}
              label="Minuti residui in curva (NDL)"
              unit="min"
              color="var(--series-1)"
              cursor={{ t: cursorT, onChange: setCursorT }}
            />
          </div>
        )}
        {samples.some((s) => (s.cns ?? 0) > 0) && (
          <div style={{ marginTop: 6 }}>
            <MiniSeries
              samples={samples}
              pick={(s) => s.cns}
              label="Orologio dell'ossigeno (CNS)"
              unit="%"
              color="var(--series-3)"
              cursor={{ t: cursorT, onChange: setCursorT }}
              fill
            />
          </div>
        )}
        {samples.some((s) => s.ppo2 !== undefined) && (
          <div style={{ marginTop: 6 }}>
            <MiniSeries
              samples={samples}
              pick={(s) => s.ppo2}
              label="PPO2"
              unit="bar"
              digits={2}
              color="var(--series-2)"
              cursor={{ t: cursorT, onChange: setCursorT }}
            />
          </div>
        )}
      </div>

      {observations.length > 0 && (
        <div className="card">
          <h2>Debrief</h2>
          <p className="card-sub">Osservazioni ricavate dal profilo di questa immersione.</p>
          <div className="stack" style={{ gap: 7 }}>
            {observations.map((o) => (
              <div key={o.text} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <span className={`dot ${SEVERITY_CLASS[o.severity]}`} style={{ marginTop: 6 }} />
                <span style={{ flex: 1, fontSize: 13 }}>
                  <span className="muted" style={{ fontSize: 11, fontWeight: 650, marginRight: 6 }}>
                    {SEVERITY_TEXT[o.severity]}
                  </span>
                  {o.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <h2>Dettagli</h2>
          <table>
            <tbody>
              <Row label="Modalità" value={modeLabel(dive)} />
              <Row label="Acqua" value={dive.salinity === 'fresh' ? 'Dolce' : 'Salata'} />
              <Row label="Compagno" value={dive.buddy ?? '—'} />
              <Row label="Zavorra" value={dive.weightKg !== undefined ? `${dive.weightKg} kg` : '—'} />
              <Row label="Muta" value={dive.suit ?? '—'} />
              <Row
                label="Visibilità"
                value={dive.visibilityM !== undefined ? `${dive.visibilityM} m` : '—'}
              />
              <Row label="Condizioni" value={dive.tags.length ? dive.tags.join(' · ') : '—'} />
              <Row
                label="Fasi"
                value={
                  m
                    ? `discesa ${formatDuration(m.phases.descentS)} · fondo ${formatDuration(m.phases.bottomS)} · risalita ${formatDuration(m.phases.ascentS)}`
                    : '—'
                }
              />
              <Row
                label="Sosta di sicurezza"
                value={m ? (m.safetyStopS > 0 ? formatDuration(m.safetyStopS) : 'nessuna') : '—'}
              />
              <Row label="Tempo in deco" value={m && m.decoS > 0 ? formatDuration(m.decoS) : 'nessuno'} />
              <Row
                label="PPO2 di picco"
                value={
                  m?.maxPpo2 !== undefined
                    ? `${m.maxPpo2.toFixed(2)} bar${
                        m.minutesAbovePpo214
                          ? ` · ${m.minutesAbovePpo214.toFixed(0)} min sopra 1.4`
                          : ''
                      }`
                    : '—'
                }
              />
              {/* Due CNS, e la differenza va detta: quello del computer viene dal
                  suo modello, il nostro dalle tabelle NOAA applicate al profilo.
                  Sovrapporli nasconderebbe che sono due misure diverse. */}
              <Row
                label="CNS del computer"
                value={m?.cnsEndPct !== undefined ? `${m.cnsEndPct.toFixed(0)}%` : '—'}
              />
              <Row
                label="CNS calcolato (NOAA)"
                value={m?.cnsPct !== undefined ? `${m.cnsPct.toFixed(0)}%` : '—'}
              />
              <Row label="OTU" value={m?.otu !== undefined ? m.otu.toFixed(0) : '—'} />
              <Row
                label="Velocità sull'ultimo tratto"
                value={
                  m?.finalAscentRateMpm !== undefined
                    ? `${m.finalAscentRateMpm.toFixed(0)} m/min da ${m.finalAscentFromM?.toFixed(1)} m`
                    : '—'
                }
              />
              <Row label="END" value={m?.endM !== undefined ? `${m.endM.toFixed(1)} m` : '—'} />
              <Row
                label="Sosta profonda"
                value={
                  m === undefined
                    ? '—'
                    : m.deepStopS > 0
                      ? `${formatDuration(m.deepStopS)} a ${m.deepStopDepthM?.toFixed(0)} m`
                      : 'nessuna'
                }
              />
              <Row
                label="Forma del profilo"
                value={
                  m?.sawtoothMPerHour === undefined
                    ? '—'
                    : `${m.sawtoothMPerHour.toFixed(0)} m/h di ridiscese${
                        shapeNote(m.sawtoothMPerHour, dives) ?? ''
                      }${
                        m.depthTrendM !== undefined
                          ? m.depthTrendM >= 0
                            ? ` · prima metà ${m.depthTrendM.toFixed(1)} m più profonda, come si raccomanda`
                            : ` · seconda metà ${(-m.depthTrendM).toFixed(1)} m più profonda della prima`
                          : ''
                      }`
                }
              />
              {m !== undefined && m.badGasSwitches > 0 && (
                <Row
                  label="Cambi di gas sotto la MOD"
                  value={`${m.badGasSwitches} — errore di procedura`}
                />
              )}
              {m?.minPpo2 !== undefined && m.minPpo2 < 0.21 && (
                <Row label="PPO2 minima" value={`${m.minPpo2.toFixed(2)} bar`} />
              )}
              <ComputersRow dive={dive} />
              <SourcesRow dive={dive} />
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Bombole e miscele</h2>
          <p className="card-sub">
            Il volume in litri è ciò che permette di calcolare il consumo in L/min: senza di esso resta
            solo bar/min, che non è confrontabile fra bombole diverse.
          </p>
          <table>
            <thead>
              <tr>
                <th>Gas</th>
                <th className="num">Litri</th>
                <th className="num">Inizio</th>
                <th className="num">Fine</th>
                <th className="num">Usati</th>
              </tr>
            </thead>
            <tbody>
              {dive.cylinders.map((c, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 550 }}>{mixName(c.mix)}</td>
                  <td className="num tabular">{c.sizeL?.toFixed(1) ?? '—'}</td>
                  <td className="num tabular">{c.startBar ?? '—'}</td>
                  <td className="num tabular">{c.endBar ?? '—'}</td>
                  <td className="num tabular">
                    {c.startBar !== undefined && c.endBar !== undefined ? c.startBar - c.endBar : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {m?.quality.caveats.length ? (
            <div className="notice" style={{ marginTop: 12 }}>
              {m.quality.caveats.map((c) => (
                <div key={c}>{c}</div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {timeline.length > 2 && <DecoTimelineCard dive={dive} timeline={timeline} cursorT={cursorT} setCursorT={setCursorT} />}

      <SaturationCard dive={dive} dives={dives} />

      <ComputerSettings dive={dive} />

      {(dive.reported || dive.annotations) && (
        <div className="grid grid-2">
          {dive.reported && (
            <div className="card">
              <h2>Letto dal computer</h2>
              <p className="card-sub">
                Valori che il computer ha calcolato durante l'immersione, tenuti distinti da quelli
                ricavati qui dal profilo.
              </p>
              <table>
                <tbody>
                  <Row
                    label="GF99 all'uscita"
                    value={dive.reported.gf99End !== undefined ? `${dive.reported.gf99End}%` : '—'}
                  />
                  <Row
                    label="Obbligo decompressivo"
                    value={
                      dive.reported.maxDecoObligationS !== undefined
                        ? dive.reported.maxDecoObligationS > 0
                          ? formatDuration(dive.reported.maxDecoObligationS)
                          : 'nessuno'
                        : '—'
                    }
                  />
                  <Row
                    label="NDL minimo"
                    value={dive.reported.minNdlS !== undefined ? formatDuration(dive.reported.minNdlS) : '—'}
                  />
                  <Row label="Consumo dichiarato" value={dive.reported.avgSac ?? '—'} />
                </tbody>
              </table>
            </div>
          )}
          {dive.annotations && (
            <div className="card">
              <h2>Annotazioni del logbook</h2>
              <p className="card-sub">Come le hai registrate nel logbook di origine.</p>
              <table>
                <tbody>
                  {Object.entries(dive.annotations).map(([k, v]) => (
                    <Row key={k} label={k} value={v} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editing && <EditPanel dive={dive} onSave={saveDive} onDelete={() => void removeDive(dive.id).then(onBack)} />}

      <AnalysisCard
        kind="dive"
        dive={dive}
        title="Analisi di questa immersione con Claude"
        description="Legge il profilo campione per campione insieme alle metriche e ai valori del computer, e dice cosa provare la prossima volta."
        currentFingerprint={dive.updatedAt ?? dive.id}
      />

      {dive.notes && (
        <div className="card">
          <h2>Note</h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>{dive.notes}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Apre il foglio da stampare in una finestra nuova e chiede la stampa al sistema.
 *
 * PERCHÉ UNA FINESTRA E NON UN FILE SCARICATO. Perché stampare deve poter essere
 * un ripensamento: si guarda l'anteprima, si decide che non serve, si chiude. Un
 * download lascia invece un file nella cartella dell'utente che nessuno gli ha
 * chiesto se voleva, e che poi tocca a lui cancellare. Questo bottone non tocca
 * l'archivio, non scrive su disco e non fa niente di irreversibile: apre una
 * copia del foglio e passa la parola alla finestra di stampa del sistema, dove
 * su macOS c'è anche «Esporta come PDF» per chi il file lo vuole davvero.
 *
 * La chiamata a `print()` è la UI che chiede al sistema, non il documento che si
 * stampa da solo: `logbookHtml` resta un documento HTML e basta, senza script
 * dentro, ed è anche ciò che lo rende verificabile con test puri.
 *
 * Restituisce `false` quando il blocco dei popup ha rifiutato la finestra: è
 * l'unico modo in cui questa operazione può fallire, e chi chiama lo dice.
 */
function apriStampa(dive: Dive): boolean {
  const html = logbookHtml([dive], new Map([[dive.id, dive.samples ?? []]]), {
    title: 'Logbook',
  });
  const finestra = window.open('', '_blank');
  if (!finestra) return false;
  finestra.document.open();
  finestra.document.write(html);
  finestra.document.close();
  // Con `document.write` il documento è quasi sempre già completo quando `close()`
  // ritorna, ma «quasi sempre» non basta: chiedere la stampa di un documento non
  // ancora impaginato produce un foglio vuoto. Si stampa quando è pronto, e si
  // gestiscono entrambi i casi invece di sperare in uno dei due.
  const stampa = () => {
    finestra.focus();
    finestra.print();
  };
  if (finestra.document.readyState === 'complete') stampa();
  else finestra.addEventListener('load', stampa, { once: true });
  return true;
}

/**
 * Tutte le provenienze, non solo la prima.
 *
 * Quando la stessa immersione arriva da due computer, mostrarne una sola dà
 * l'impressione che i dati dell'altro non siano entrati — ed è stata la prima cosa
 * che è saltata all'occhio guardando una scheda di un'immersione fusa.
 */
function SourcesRow({ dive }: { dive: Dive }) {
  const all = [dive.source, ...(dive.extraSources ?? [])];
  return (
    <tr>
      <td className="muted" style={{ width: '38%' }}>
        {all.length > 1 ? `Origine (${all.length} fonti)` : 'Origine'}
      </td>
      <td>
        {all.map((s) => (
          <div key={`${s.format}|${s.file}`}>
            {FORMAT_LABEL[s.format] ?? s.format} · {s.file}
          </div>
        ))}
      </td>
    </tr>
  );
}

/**
 * Le impostazioni con cui il computer ha calcolato la decompressione.
 *
 * Non è una curiosità da collezionisti: il GF99 all'uscita e l'obbligo
 * decompressivo che il computer ha mostrato dipendono da questi numeri, e
 * confrontare due immersioni fatte con impostazioni diverse senza saperlo porta a
 * conclusioni sbagliate. La scheda compare solo se il formato di origine li porta
 * davvero — oggi il log nativo Shearwater.
 */
/**
 * Tutti i computer che hanno registrato l'immersione, non solo quello da cui viene
 * il profilo: due computer allo stesso polso registrano cose diverse, e mostrarne
 * uno solo era la ragione per cui sembrava che i dati dell'altro non fossero
 * entrati.
 */
function ComputersRow({ dive }: { dive: Dive }) {
  const all = [dive.computer, ...(dive.otherComputers ?? [])].filter(Boolean) as ComputerInfo[];
  if (!all.length) return <Row label="Computer" value="—" />;
  return (
    <tr>
      <td className="muted" style={{ width: '38%' }}>
        {all.length > 1 ? `Computer (${all.length})` : 'Computer'}
      </td>
      <td>
        {all.map((c, i) => (
          <div key={`${c.model ?? ''}-${c.serial ?? i}`}>
            {[c.model, c.decoModel].filter(Boolean).join(' · ') || '—'}
            {i === 0 && all.length > 1 && <span className="muted"> · profilo da qui</span>}
          </div>
        ))}
      </td>
    </tr>
  );
}

function ComputerSettings({ dive }: { dive: Dive }) {
  const all = [dive.computer, ...(dive.otherComputers ?? [])].filter(Boolean) as ComputerInfo[];
  if (all.length > 1) {
    return (
      <div className="grid grid-2">
        {all.map((c, i) => (
          <SingleComputerSettings
            key={`${c.model ?? ''}-${c.serial ?? i}`}
            computer={c}
            surfacePressureBar={i === 0 ? dive.surfacePressureBar : undefined}
            title={c.model ?? `Computer ${i + 1}`}
          />
        ))}
      </div>
    );
  }
  return (
    <SingleComputerSettings
      computer={all[0]}
      surfacePressureBar={dive.surfacePressureBar}
      title="Impostazioni del computer"
    />
  );
}

function SingleComputerSettings({
  computer: c,
  surfacePressureBar,
  title,
}: {
  computer: ComputerInfo | undefined;
  surfacePressureBar?: number;
  title: string;
}) {
  if (!c) return null;
  const rows: [string, string][] = [];
  if (c.gfLow !== undefined && c.gfHigh !== undefined) {
    rows.push(['Gradient factor impostati', `${c.gfLow} / ${c.gfHigh}`]);
  }
  if (c.decoModel) rows.push(['Modello decompressivo', c.decoModel]);
  if (c.conservatism !== undefined) rows.push(['Conservatorismo', `+${c.conservatism}`]);
  if (c.computerMode) rows.push(['Modalità', COMPUTER_MODE[c.computerMode] ?? c.computerMode]);
  if (c.waterDensityKgM3) {
    rows.push([
      'Densità impostata',
      `${c.waterDensityKgM3} kg/m³ (${c.waterDensityKgM3 <= 1005 ? 'acqua dolce' : 'acqua salata'})`,
    ]);
  }
  if (c.ppo2MaxBar) rows.push(['Limite di PPO2 impostato', `${c.ppo2MaxBar.toFixed(2)} bar`]);
  if (surfacePressureBar) {
    rows.push(['Pressione in superficie', `${surfacePressureBar.toFixed(3)} bar`]);
  }
  if (c.sampleIntervalS) rows.push(['Passo di campionamento', `${c.sampleIntervalS} s`]);
  if (c.aiMode) rows.push(['Integrazione aria', c.aiMode]);
  if (c.firmware) rows.push(['Firmware', c.firmware]);
  if (c.hwVersion) rows.push(['Versione hardware', c.hwVersion]);
  if (c.serial) rows.push(['Numero di serie', c.serial]);
  if (c.logVersion !== undefined) rows.push(['Versione del log', String(c.logVersion)]);
  if (!rows.length) return null;

  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="card-sub">
        Lette dal log del computer, non inserite a mano. Il GF99 e l'obbligo decompressivo che vedi
        sopra sono stati calcolati con queste impostazioni.
      </p>
      <table>
        <tbody>
          {rows.map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COMPUTER_MODE: Record<string, string> = {
  'oc-rec': 'circuito aperto, ricreativo',
  'oc-tec': 'circuito aperto, tecnico',
  ccr: 'circuito chiuso',
  ccr2: 'circuito chiuso',
  scr: 'semichiuso',
  gauge: 'profondimetro',
  ppo2: 'solo PPO2',
  freedive: 'apnea',
};

/** Passo medio fra i campioni mostrati, arrotondato. */
function stepOf(samples: { t: number }[]): number | string {
  if (samples.length < 2) return '—';
  return Math.round((samples[samples.length - 1].t - samples[0].t) / (samples.length - 1));
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="muted" style={{ width: '38%' }}>
        {label}
      </td>
      <td>{value}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------

function EditPanel({
  dive,
  onSave,
  onDelete,
}: {
  dive: Dive;
  onSave: (d: Dive) => Promise<void>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Dive>(dive);
  const [saved, setSaved] = useState(false);

  const setCylinder = (i: number, patch: Partial<Dive['cylinders'][number]>) => {
    setDraft((d) => ({
      ...d,
      cylinders: d.cylinders.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    }));
    setSaved(false);
  };

  return (
    <div className="card">
      <h2>Modifica dati</h2>
      <p className="card-sub">
        Salvando, le metriche di questa immersione vengono ricalcolate. Un import successivo non
        sovrascrive i campi che compili qui.
      </p>

      <div className="grid grid-3" style={{ marginBottom: 14 }}>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Sito</span>
          <input
            type="text"
            value={draft.site?.name ?? ''}
            onChange={(e) => {
              setDraft((d) => ({ ...d, site: { ...(d.site ?? { name: '' }), name: e.target.value } }));
              setSaved(false);
            }}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Compagno</span>
          <input
            type="text"
            value={draft.buddy ?? ''}
            onChange={(e) => {
              setDraft((d) => ({ ...d, buddy: e.target.value }));
              setSaved(false);
            }}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Acqua</span>
          <select
            value={draft.salinity ?? 'salt'}
            onChange={(e) => {
              setDraft((d) => ({ ...d, salinity: e.target.value as 'salt' | 'fresh' }));
              setSaved(false);
            }}
          >
            <option value="salt">salata</option>
            <option value="fresh">dolce (lago)</option>
          </select>
        </label>
      </div>

      <div className="finding-section-label">Bombole</div>
      <table style={{ marginBottom: 14 }}>
        <thead>
          <tr>
            <th>Gas</th>
            <th className="num">Litri</th>
            <th className="num">Inizio (bar)</th>
            <th className="num">Fine (bar)</th>
          </tr>
        </thead>
        <tbody>
          {draft.cylinders.map((c, i) => (
            <tr key={i}>
              <td>{mixName(c.mix)}</td>
              <td className="num">
                <input
                  type="number"
                  step="0.1"
                  style={{ width: 76 }}
                  value={c.sizeL ?? ''}
                  onChange={(e) => setCylinder(i, { sizeL: e.target.value ? Number(e.target.value) : undefined })}
                />
              </td>
              <td className="num">
                <input
                  type="number"
                  style={{ width: 76 }}
                  value={c.startBar ?? ''}
                  onChange={(e) => setCylinder(i, { startBar: e.target.value ? Number(e.target.value) : undefined })}
                />
              </td>
              <td className="num">
                <input
                  type="number"
                  style={{ width: 76 }}
                  value={c.endBar ?? ''}
                  onChange={(e) => setCylinder(i, { endBar: e.target.value ? Number(e.target.value) : undefined })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <label className="stack" style={{ gap: 4, fontSize: 12, marginBottom: 14 }}>
        <span className="muted">Note</span>
        <textarea
          rows={4}
          value={draft.notes ?? ''}
          onChange={(e) => {
            setDraft((d) => ({ ...d, notes: e.target.value }));
            setSaved(false);
          }}
        />
      </label>

      <div className="row">
        <button
          className="btn btn-primary"
          onClick={() => {
            void onSave(draft).then(() => setSaved(true));
          }}
        >
          Salva
        </button>
        {saved && <span className="muted" style={{ fontSize: 12 }}>Salvato e metriche ricalcolate.</span>}
        <span className="topbar-spacer" />
        <button
          className="btn btn-danger"
          onClick={() => {
            // La conferma dice cosa succede DAVVERO: va nel cestino, si può
            // rimettere a posto, e diventa definitiva fra trenta giorni. Una
            // conferma che dice solo «sei sicuro?» non aggiunge informazione e si
            // clicca senza leggerla.
            if (
              confirm(
                'Sposta questa immersione nel cestino.\n\nSparisce dall’archivio e smette di sincronizzarsi, ma resta recuperabile dalle Impostazioni per trenta giorni. Dopo, la cancellazione diventa definitiva su tutti i dispositivi.',
              )
            ) {
              onDelete();
            }
          }}
        >
          Sposta nel cestino
        </button>
      </div>
    </div>
  );
}

/**
 * Dove cade il dente di sega di questa immersione rispetto alle altre.
 *
 * Il numero da solo non si legge: nessuno sa se quattordici metri all'ora di
 * ridiscese siano tanti. Rispetto alle proprie immersioni sì.
 */
function shapeNote(value: number, dives: Dive[]): string | undefined {
  const ref = quartilesOf(
    dives.map((d) => d.metrics?.sawtoothMPerHour).filter((v): v is number => v !== undefined),
  );
  const where = positionAgainst(value, ref);
  return where ? ` — ${where}` : undefined;
}

/**
 * Curva, obbligo e tempo di risalita minuto per minuto.
 *
 * PERCHÉ NON BASTAVANO I GRAFICI CHE C'ERANO GIÀ. Perché quelli disegnano i campi
 * che il computer ha scritto nei campioni, e li scrive solo qualche computer: NDL e
 * TTS stanno nei log Shearwater, l'Aladin non li registra, un UDDF esportato da un
 * altro programma quasi mai, un CSV mai. Il profilo però ce l'hanno tutte le
 * immersioni campionate, e da un profilo il modello si rigioca — quindi questa
 * carta c'è su ogni immersione, non solo su quelle di uno strumento.
 *
 * Dove il computer i suoi numeri li ha scritti, compaiono tratteggiati sullo stesso
 * grafico. Non per correggerlo: era lui in acqua, ed è lui ad aver ragione. Perché
 * due implementazioni dello stesso modello che divergono dicono qualcosa, e su due
 * grafici separati la divergenza non si vede.
 */
function DecoTimelineCard({
  dive,
  timeline,
  cursorT,
  setCursorT,
}: {
  dive: Dive;
  timeline: DecoPoint[];
  cursorT: number | null;
  setCursorT: (t: number | null) => void;
}) {
  // I punti della linea temporale hanno la forma di campioni, così i grafici
  // esistenti li disegnano senza saperne niente.
  const points = timeline.map((p) => ({ t: p.t, depth: p.depthM })) as Sample[];
  const at = (i: number) => timeline[i];
  const cursor = { t: cursorT, onChange: setCursorT };

  // Il valore del computer all'istante più vicino: i due campionamenti non
  // coincidono, e interpolare darebbe una precisione che non c'è.
  const nearest = (t: number) =>
    (dive.samples ?? []).reduce(
      (a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a),
      (dive.samples ?? [])[0],
    );
  const hasComputer = (pick: (s: Sample) => number | undefined) =>
    (dive.samples ?? []).some((s) => pick(s) !== undefined);

  // L'etichetta la scrive `gfOf`, cioè esattamente quello che il motore ha usato.
  // Costruirla a mano dai campi del computer produceva «40/undefined» sui
  // parecchi computer che scrivono solo il GF basso, e faceva dichiarare 30/85
  // anche quando il calcolo era stato fatto con 40/85.
  const gfUsed = gfOf(dive);
  const gf = `${Math.round(gfUsed.low * 100)}/${Math.round(gfUsed.high * 100)}`;
  const maxCeiling = Math.max(...timeline.map((p) => p.ceilingM));

  return (
    <div className="card">
      <h2>Curva e obbligo, minuto per minuto</h2>
      <p className="card-sub">
        Ricalcolati da noi sul profilo con Bühlmann ZH-L16C e i gradient factor {gf}, tenendo conto
        dell'azoto residuo dall'immersione precedente. Dove il tuo computer ha scritto i suoi, li trovi
        tratteggiati sullo stesso grafico: non per correggerlo — era lui in acqua — ma perché due
        implementazioni che divergono dicono qualcosa.
      </p>

      <MiniSeries
        samples={points}
        pick={(_s, i) => at(i)?.ndlMin}
        label="Minuti residui in curva, calcolati da noi"
        unit="min"
        color="var(--series-1)"
        cursor={cursor}
        compare={
          hasComputer((s) => s.ndlS)
            ? {
                pick: (s) => {
                  const c = nearest(s.t);
                  return c?.ndlS === undefined ? undefined : c.ndlS / 60;
                },
                label: 'il tuo computer',
              }
            : undefined
        }
        reference={[{ value: 0, label: 'fuori curva', color: 'var(--warning)' }]}
      />

      <div style={{ marginTop: 6 }}>
        <MiniSeries
          samples={points}
          pick={(_s, i) => at(i)?.ceilingM}
          label={maxCeiling > 0 ? 'Tetto di decompressione, calcolato da noi' : 'Tetto di decompressione: mai comparso'}
          unit="m"
          color="var(--critical)"
          cursor={cursor}
          fill
          compare={
            hasComputer((s) => s.ceiling)
              ? {
                  pick: (s) => nearest(s.t)?.ceiling,
                  label: 'il tuo computer',
                }
              : undefined
          }
        />
      </div>

      <div style={{ marginTop: 6 }}>
        <MiniSeries
          samples={points}
          pick={(_s, i) => at(i)?.ttsMin}
          label="Tempo per arrivare in superficie (TTS), calcolato da noi"
          unit="min"
          color="var(--series-2)"
          cursor={cursor}
          compare={
            hasComputer((s) => s.ttsS)
              ? {
                  pick: (s) => {
                    const c = nearest(s.t);
                    return c?.ttsS === undefined ? undefined : c.ttsS / 60;
                  },
                  label: 'il tuo computer',
                }
              : undefined
          }
        />
      </div>

      <div style={{ marginTop: 6 }}>
        <MiniSeries
          samples={points}
          pick={(_s, i) => at(i)?.gf99}
          label="Sovrasaturazione istantanea (GF99)"
          unit="%"
          color="var(--series-3)"
          cursor={cursor}
          fill
          reference={
            dive.computer?.gfHigh
              ? [{ value: dive.computer.gfHigh, label: `GF alto ${dive.computer.gfHigh}`, color: 'var(--warning)' }]
              : []
          }
        />
      </div>

      <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)' }}>
        <li>
          I minuti in curva sono calcolati <b>dal carico che avevi in quel momento</b>, non da tessuti
          puliti: è la differenza fra un computer e una tabella. Il limite è tagliato a 99 minuti, come
          fanno i computer — oltre il centinaio smette di essere un limite e diventa «tanto».
        </li>
        <li>
          Il TTS suppone risalita a 9 m/min, soste di un minuto e <b>nessun cambio di gas</b>: è il
          conto pessimista, lo stesso che fa un computer che non sa cosa ti sei portato dietro.
        </li>
        <li>
          Se il tuo computer aveva gradient factor diversi da {gf}, i suoi numeri e i nostri divergono
          per costruzione — e la distanza fra le due curve è esattamente quella differenza.
        </li>
      </ul>
    </div>
  );
}
