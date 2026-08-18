import { useEffect, useRef, useState } from 'react';
import { AREA_LABEL, GOALS, type Finding, type GoalId } from '../../core/analysis/coaching';
import { Meter } from '../components/Charts';
import { useDiveLog } from '../state';
import { AnalysisCard } from '../components/Analysis';
import { PeriodPicker } from '../components/PeriodPicker';
import { imm, SEVERITY_CLASS, SEVERITY_TEXT } from '../format';

export function Coach() {
  const { plan, goalId, setGoalId, dives, aggregates, scope } = useDiveLog();

  // I risultati che non sono né fra le tre priorità né fra i punti di forza.
  // Calcolati una volta sola perché servono tre volte: due nel corpo della
  // pagina e una nell'annuncio.
  const dopo = plan.findings.filter((f) => f.severity !== 'good' && !plan.focus.includes(f));
  const criteriSoddisfatti = plan.readiness.items.filter((i) => i.met).length;

  /*
   * Cosa è cambiato nel piano, in una frase.
   *
   * Cambiare obiettivo nel menu a tendina, o periodo dalla scheda del periodo,
   * riscrive TUTTA questa pagina: la percentuale di prontezza, i criteri, le tre
   * priorità, l'ordine di quelle dopo. Guardando lo schermo il cambiamento è
   * evidente; con uno screen reader il fuoco resta sul menu e sotto non succede
   * niente di udibile — si sceglie «Immersioni tecniche» e non si ha modo di
   * sapere che il giudizio è passato dal 78% al 41% se non ripercorrendo tutta la
   * pagina a mano.
   *
   * La frase dice i numeri nuovi, non «piano aggiornato»: sono la ragione stessa
   * per cui si è cambiato obiettivo.
   */
  const testoAnnuncio =
    scope.dives.length < 3
      ? `Piano non calcolabile: nel periodo «${scope.period.label}» ci sono ${imm(scope.dives.length)}, ` +
        `${dives.length} in tutto l'archivio, e ne servono almeno 3.`
      : `Piano ricalcolato per l'obiettivo «${plan.readiness.goal.label}»: prontezza ` +
        `${Math.round(plan.readiness.score * 100)}%, ${criteriSoddisfatti} criteri su ` +
        `${plan.readiness.items.length} soddisfatti, ${plan.focus.length} priorità su cui lavorare adesso, ` +
        `${dopo.length} punti dopo, ${plan.strengths.length} punti di forza. Calcolato su ` +
        `${imm(scope.dives.length)} del periodo «${scope.period.label}».`;

  // Il piano si legge sulle immersioni della finestra: la soglia di "troppo poche"
  // guarda quelle, non l'archivio intero.
  if (scope.dives.length < 3) {
    return (
      <div className="page">
        <AnnuncioPiano testo={testoAnnuncio} />
        <div className="empty">
          <h2>Servono più immersioni</h2>
          <p className="secondary" style={{ maxWidth: 480, margin: '0 auto' }}>
            Il piano si basa su medie e tendenze: con meno di una manciata di immersioni ogni giudizio
            sarebbe rumore. {dives.length > scope.dives.length
              ? `Nel periodo scelto ce ne sono ${scope.dives.length} su ${dives.length} in archivio: allarga la finestra dalla scheda Statistiche o immergiti di più.`
              : 'Importa lo storico e torna qui.'}
          </p>
        </div>

      </div>
    );
  }

  const { readiness } = plan;

  return (
    <div className="page">
      {/*
        Sta come primo figlio della pagina in ENTRAMBI i rami — questo e quello
        delle troppo poche immersioni — perché React confronta i figli per
        posizione: essendo lo stesso componente allo stesso posto, non viene
        smontato quando si passa da un ramo all'altro, e l'annuncio del passaggio
        («adesso ce ne sono due, il piano non si calcola») sopravvive al cambio
        invece di essere inghiottito dal rimontaggio.
      */}
      <AnnuncioPiano testo={testoAnnuncio} />
      <div className="page-title-row">
        <h1 className="page-title">Piano di miglioramento</h1>
        <div className="filters">
          <label>
            Obiettivo
            <select value={goalId} onChange={(e) => setGoalId(e.target.value as GoalId)}>
              {GOALS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <PeriodPicker />

      <div className="card">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h2>{readiness.goal.label}</h2>
            <p className="card-sub" style={{ marginBottom: 10 }}>
              {readiness.goal.description}
            </p>
            <div className="row" style={{ gap: 12, marginBottom: 6 }}>
              <span className="hero" style={{ fontSize: 34 }}>
                {Math.round(readiness.score * 100)}%
              </span>
              <span className="secondary" style={{ fontSize: 13, flex: 1 }}>
                {readiness.verdict}
              </span>
            </div>
            <Meter value={readiness.score} />
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="finding-section-label">Criteri di riferimento</div>
          {readiness.items.map((i) => (
            <div className="readiness-row" key={i.label}>
              <span className={`dot ${i.met ? 'dot-good' : 'dot-warning'}`} />
              <span className="label">
                {i.label}
                {i.note && (
                  <div className="muted" style={{ fontSize: 11 }}>
                    {i.note}
                  </div>
                )}
              </span>
              <span className="value">
                {formatHave(i.have, i.unit)}{' '}
                <span className="muted">
                  / {i.lowerIsBetter ? 'non oltre' : 'almeno'} {formatHave(i.need, i.unit)}
                </span>
              </span>
              <span className="muted" style={{ fontSize: 11, width: 56, textAlign: 'right' }}>
                {i.met ? 'ok' : 'da fare'}
              </span>
            </div>
          ))}
        </div>

        <p className="muted" style={{ fontSize: 11, marginTop: 14, marginBottom: 0 }}>
          Questi criteri sono riferimenti costruiti sulla pratica didattica corrente, non i prerequisiti
          formali di una didattica specifica: quelli vanno verificati con l'agenzia e con l'istruttore.
        </p>
      </div>

      {plan.focus.length > 0 && (
        <div className="stack">
          <div className="page-title-row">
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650 }}>Su cosa lavorare adesso</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              Tre priorità: fare tutto insieme non funziona.
            </span>
          </div>
          {plan.focus.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </div>
      )}

      {dopo.length > 0 && (
        <div className="stack">
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650 }}>Dopo, in ordine</h2>
          {dopo.map((f) => (
            <FindingCard key={f.id} finding={f} collapsed />
          ))}
        </div>
      )}

      {plan.strengths.length > 0 && (
        <div className="card">
          <h2>Punti di forza da mantenere</h2>
          <p className="card-sub">Quello che già funziona, con i numeri che lo dicono.</p>
          <div className="stack" style={{ gap: 10 }}>
            {plan.strengths.map((f) => (
              <div key={f.id} className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
                <span className="dot dot-good" style={{ marginTop: 6 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 550, fontSize: 13 }}>{f.headline}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {f.evidence[0]}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Come è costruito questo piano</h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)' }}>
          <li>
            Ogni valutazione dichiara su quante immersioni si basa. Sotto le sei immersioni con il dato
            necessario, la regola non si pronuncia affatto.
          </li>
          <li>
            I numeri mostrati sono quelli che hanno generato il giudizio, così è verificabile — e
            contestabile.
          </li>
          <li>
            Le metriche derivate esistono solo dove c'è il dato: {aggregates.withProfile} immersioni su{' '}
            {aggregates.count} hanno un profilo campionato, {aggregates.rmv.length} permettono di calcolare
            il consumo.
          </li>
          <li>
            Sulle scelte che riguardano la sicurezza — decompressione, progressione in profondità — questo
            piano indica cosa guardare, non sostituisce il confronto con l'istruttore.
          </li>
        </ul>
      </div>

      <AnalysisCard
        kind="plan"
        title="Rilettura del piano con Claude"
        description="Non ripete i risultati delle regole: li mette in ordine di importanza, li collega fra loro e li trasforma in un programma per le prossime dieci immersioni."
        currentFingerprint={`${goalId}:${scope.period.id}:${scope.dives.length}:${plan.findings.length}`}
      />
    </div>
  );
}

/**
 * Il piano che cambia, detto a voce.
 *
 * MUTO AL PRIMO GIRO. Aprendo la scheda il piano non è «cambiato»: è arrivato,
 * insieme al titolo e a tutto il resto, e chi legge con lo screen reader sta già
 * scorrendo la pagina dall'inizio. Annunciarlo lì significherebbe interrompere la
 * lettura del titolo per ripetere in sintesi ciò che sta per essere letto per
 * intero. L'annuncio serve solo dal secondo passaggio in poi, cioè quando è stata
 * un'azione a riscrivere la pagina: la scelta di un obiettivo, di un periodo, o
 * un import che ha aggiunto immersioni mentre la scheda era aperta.
 *
 * Il testo arriva già confezionato dal chiamante invece di essere costruito qui,
 * perché è il chiamante a sapere quale dei due rami della pagina si sta
 * mostrando — e sono due frasi che dicono cose diverse.
 */
function AnnuncioPiano({ testo }: { testo: string }) {
  const [annuncio, setAnnuncio] = useState('');
  const primoGiro = useRef(true);

  useEffect(() => {
    if (primoGiro.current) {
      primoGiro.current = false;
      return;
    }
    setAnnuncio(testo);
  }, [testo]);

  // `polite`: un piano ricalcolato non è un'emergenza, e chi ha appena scelto una
  // voce dal menu spesso sta ancora ascoltando il nome della voce scelta —
  // interromperlo per anticipare la percentuale sarebbe rumore, non servizio.
  return (
    <div className="solo-lettori" role="status" aria-live="polite" aria-atomic="true">
      {annuncio}
    </div>
  );
}

function FindingCard({ finding: f, collapsed = false }: { finding: Finding; collapsed?: boolean }) {
  return (
    <div className="finding">
      <div className="finding-head">
        <span className={`dot ${SEVERITY_CLASS[f.severity]}`} style={{ marginTop: 6 }} />
        <h3>{f.headline}</h3>
        <span className="badge">
          {AREA_LABEL[f.area]} · {SEVERITY_TEXT[f.severity]}
        </span>
      </div>
      <p>{f.detail}</p>

      <div className="evidence">
        <div className="finding-section-label">Su cosa si basa ({imm(f.basis)})</div>
        {f.evidence.map((e) => (
          <div key={e}>{e}</div>
        ))}
      </div>

      {f.target && (
        <div>
          <div className="finding-section-label">Obiettivo</div>
          <p style={{ color: 'var(--text-primary)' }}>{f.target}</p>
        </div>
      )}

      {!collapsed && f.drills.length > 0 && (
        <div>
          <div className="finding-section-label">Esercizi</div>
          <ul>
            {f.drills.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {collapsed && f.drills.length > 0 && (
        <details>
          <summary
            style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}
          >
            {f.drills.length} esercizi
          </summary>
          <ul style={{ marginTop: 6 }}>
            {f.drills.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function formatHave(v: number | undefined, unit: string): string {
  // Un criterio mai misurato si dichiara tale: scrivere «0 L/min» al posto di
  // «non misurato» farebbe sembrare raggiunto un obiettivo che nessuno ha mai
  // verificato.
  if (v === undefined) return 'non misurato';
  const n = Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (!unit) return n;
  // La percentuale si attacca al numero, le altre unità no.
  return unit === '%' ? `${n}%` : `${n} ${unit}`;
}
