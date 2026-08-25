import { useEffect, useRef, useState } from 'react';
import { AREA_LABEL, GOALS, type Finding, type GoalId } from '../../core/analysis/coaching';
import { Meter } from '../components/Charts';
import { useDiveLog } from '../state';
import { PeriodPicker } from '../components/PeriodPicker';
import { imm, plural, SEVERITY_CLASS, SEVERITY_TEXT, type Traduci } from '../format';
import { Vuoto } from '../components/Vuoto';
import { useLingua } from '../lingua';

export function Coach() {
  const { plan, goalId, setGoalId, dives, aggregates, scope } = useDiveLog();
  const { t } = useLingua();

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
   *
   * SI TRADUCE A PEZZI. I numeri e il nome del periodo cambiano a ogni render:
   * una frase intera dentro `t()` sarebbe una voce di dizionario per ogni
   * combinazione possibile, cioè nessuna traduzione. Si traducono le parti fisse
   * e i numeri restano fuori, come fa la scheda di importazione.
   */
  const testoAnnuncio =
    scope.dives.length < 3
      ? `${t('Piano non calcolabile')}: ${imm(scope.dives.length, t)} ${t('nel periodo')} ` +
        `«${t(scope.period.label)}», ${dives.length} ${t('in tutto l’archivio')}, ${t('e ne servono almeno 3')}.`
      : `${t('Piano ricalcolato per l’obiettivo')} «${t(plan.readiness.goal.label)}»: ${t('prontezza')} ` +
        `${Math.round(plan.readiness.score * 100)}%, ${criteriSoddisfatti} ${t('criteri su')} ` +
        `${plan.readiness.items.length} ${t('soddisfatti')}, ${plan.focus.length} ${t('priorità su cui lavorare adesso')}, ` +
        `${dopo.length} ${t('punti dopo')}, ${plan.strengths.length} ${t('punti di forza')}. ${t('Calcolato su')} ` +
        `${imm(scope.dives.length, t)} ${t('del periodo')} «${t(scope.period.label)}».`;

  // Il piano si legge sulle immersioni della finestra: la soglia di "troppo poche"
  // guarda quelle, non l'archivio intero.
  if (scope.dives.length < 3) {
    return (
      <div className="page">
        {/* Vedi il commento gemello nel ramo pieno: stessa posizione, stesso
            elemento padre, altrimenti l'annuncio si perde nel rimontaggio. */}
        <AnnuncioPiano testo={testoAnnuncio} />
        <Vuoto
          nuda
          titolo="Servono più immersioni"
          azione={
            dives.length > scope.dives.length
              ? { vista: 'stats', etichetta: 'Vai a Statistiche' }
              : { vista: 'import', etichetta: 'Vai a Importa' }
          }
        >
          {t(
            dives.length > scope.dives.length
              ? 'Nel periodo scelto ce ne sono poche: allarga la finestra da Statistiche.'
              : 'I suggerimenti si basano su medie e tendenze: con poche immersioni sarebbero rumore. Importa lo storico e torna qui.',
          )}
        </Vuoto>
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
        <h1 className="page-title">{t('Piano di miglioramento')}</h1>
        <div className="filters">
          <label>
            {t('Obiettivo')}
            <select value={goalId} onChange={(e) => setGoalId(e.target.value as GoalId)}>
              {/* `GOALS` è una costante del cuore dell'applicazione: resta in
                  italiano lì — non deve rinascere a ogni render — e si traduce
                  qui, al disegno. */}
              {GOALS.map((g) => (
                <option key={g.id} value={g.id}>
                  {t(g.label)}
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
            <h2>{t(readiness.goal.label)}</h2>
            <p className="card-sub" style={{ marginBottom: 10 }}>
              {t(readiness.goal.description)}
            </p>
            <div className="row" style={{ gap: 12, marginBottom: 6 }}>
              <span className="hero" style={{ fontSize: 34 }}>
                {Math.round(readiness.score * 100)}%
              </span>
              {/* Il verdetto arriva già tradotto: `readinessFor` lo compone con
                  `frase()` e ci rimonta dentro le etichette dei criteri, che
                  passano dal dizionario lì. Qui non va toccato — un `t()` su una
                  frase già inglese non troverebbe niente. */}
              <span className="secondary" style={{ fontSize: 13, flex: 1 }}>
                {readiness.verdict}
              </span>
            </div>
            <Meter value={readiness.score} />
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="finding-section-label">{t('Criteri di riferimento')}</div>
          {/* Etichette e note dei criteri nascono in `core/analysis/coaching`:
              lì restano italiane, qui passano da `t()`. */}
          {readiness.items.map((i) => (
            <div className="readiness-row" key={i.label}>
              <span className={`dot ${i.met ? 'dot-good' : 'dot-warning'}`} />
              <span className="label">
                {t(i.label)}
                {i.note && (
                  <div className="muted" style={{ fontSize: 11 }}>
                    {t(i.note)}
                  </div>
                )}
              </span>
              <span className="value">
                {formatHave(i.have, i.unit, t)}{' '}
                <span className="muted">
                  / {t(i.lowerIsBetter ? 'non oltre' : 'almeno')} {formatHave(i.need, i.unit, t)}
                </span>
              </span>
              <span className="muted" style={{ fontSize: 11, width: 56, textAlign: 'right' }}>
                {t(i.met ? 'ok' : 'da fare')}
              </span>
            </div>
          ))}
        </div>

        {/*
         * La riga sotto diceva anche perché questi criteri non sono i
         * prerequisiti formali di una didattica: sono costruiti sulla pratica
         * corrente, e ogni agenzia ha i suoi. Vero, ma è una spiegazione da
         * manuale: a chi legge basta sapere a chi chiedere.
         */}
        <p className="muted" style={{ fontSize: 11, marginTop: 14, marginBottom: 0 }}>
          {t('Sono riferimenti, non i requisiti di un corso: quelli chiedili all’istruttore.')}
        </p>
      </div>

      {plan.focus.length > 0 && (
        <div className="stack">
          <div className="page-title-row">
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650 }}>{t('Su cosa lavorare adesso')}</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              {t('Tre alla volta: fare tutto insieme non funziona.')}
            </span>
          </div>
          {plan.focus.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </div>
      )}

      {dopo.length > 0 && (
        <div className="stack">
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650 }}>{t('Dopo, in ordine')}</h2>
          {dopo.map((f) => (
            <FindingCard key={f.id} finding={f} collapsed />
          ))}
        </div>
      )}

      {plan.strengths.length > 0 && (
        <div className="card">
          <h2>{t('Punti di forza')}</h2>
          <p className="card-sub">{t('Quello che già funziona, con i numeri che lo dicono.')}</p>
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

      {/*
       * Come è costruito il piano, in quattro righe invece di quattro paragrafi.
       *
       * Le regole vere: una valutazione tace sotto le sei immersioni che hanno il
       * dato che le serve; i numeri mostrati sono esattamente quelli entrati nel
       * giudizio, così si può contestare; le metriche derivate esistono solo dove
       * c'è il profilo campionato. Sono cose che servono a chi legge il codice
       * per capire perché una regola non compare — a chi si immerge basta
       * sapere che il conto è trasparente e che l'istruttore resta l'ultima parola.
       */}
      <div className="card">
        <h2>{t('Come è costruito questo piano')}</h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)' }}>
          <li>{t('Una valutazione tace finché non ha almeno sei immersioni con il dato che le serve.')}</li>
          <li>{t('I numeri che vedi sono quelli che hanno generato il giudizio.')}</li>
          <li>
            {aggregates.withProfile} {t('immersioni su')} {aggregates.count} {t('hanno il profilo')},{' '}
            {aggregates.rmv.length} {t('bastano per il consumo')}.
          </li>
          <li>{t('Sulla sicurezza il piano dice cosa guardare, non sostituisce l’istruttore.')}</li>
        </ul>
      </div>
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
  const { t } = useLingua();
  /*
   * Titolo, dettaglio, prove ed esercizi arrivano dalle regole con i numeri già
   * dentro («2,4 m/min su 18 immersioni»): sono frasi diverse a ogni archivio e
   * non hanno una chiave di dizionario. Si traduce quello che è fisso — l'area,
   * la gravità, le etichette delle sezioni — e il resto resta italiano finché le
   * regole non compongono le loro frasi a pezzi.
   */
  return (
    <div className="finding">
      <div className="finding-head">
        <span className={`dot ${SEVERITY_CLASS[f.severity]}`} style={{ marginTop: 6 }} />
        <h3>{f.headline}</h3>
        <span className="badge">
          {t(AREA_LABEL[f.area])} · {t(SEVERITY_TEXT[f.severity])}
        </span>
      </div>
      <p>{f.detail}</p>

      <div className="evidence">
        <div className="finding-section-label">
          {t('Su cosa si basa')} ({imm(f.basis, t)})
        </div>
        {f.evidence.map((e) => (
          <div key={e}>{e}</div>
        ))}
      </div>

      {f.target && (
        <div>
          <div className="finding-section-label">{t('Obiettivo')}</div>
          <p style={{ color: 'var(--text-primary)' }}>{f.target}</p>
        </div>
      )}

      {!collapsed && f.drills.length > 0 && (
        <div>
          <div className="finding-section-label">{t('Esercizi')}</div>
          <ul>
            {f.drills.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {collapsed && f.drills.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
            {plural(f.drills.length, 'esercizio', 'esercizi', t)}
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

// `t` come parametro con un ripiego, come in `format.ts`: questa non è una
// funzione componente e non può chiamare i ganci di React.
function formatHave(v: number | undefined, unit: string, t: Traduci = (s) => s): string {
  // Un criterio mai misurato si dichiara tale: scrivere «0 L/min» al posto di
  // «non misurato» farebbe sembrare raggiunto un obiettivo che nessuno ha mai
  // verificato.
  if (v === undefined) return t('non misurato');
  const n = Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (!unit) return n;
  // La percentuale si attacca al numero, le altre unità no.
  return unit === '%' ? `${n}%` : `${n} ${unit}`;
}
