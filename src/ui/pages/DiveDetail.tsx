import { useEffect, useMemo, useRef, useState } from 'react';
import { suIOS } from '../../piattaforma';
import { BottoneConferma } from '../components/Conferma';
import { LIMITS, type ComputerInfo, type Dive, type Sample } from '../../core/model';
import { formatDuration, mixName } from '../../core/units';
import { descriviAnalisi, descriviScarto, scartiDiAnalisi } from '../../core/analisiGas';
import { modeLabel, positionAgainst, quartilesOf } from '../../core/analysis/aggregate';
import { debriefDive } from '../../core/analysis/coaching';
import { logbookHtml } from '../../core/export/logbookPrint';
import { schedePdf } from '../../core/export/pdf';
import { conNumeri } from '../../core/numerazione';
import { esporta } from '../esporta';
import type { Subacqueo } from '../../core/libretto';
import { descriviFirma, firmaPath, firmaVuota } from '../../core/firma';
import { RiquadroFirma } from '../components/FirmaGuida';
import { DepthProfile, MiniSeries } from '../components/DepthProfile';
import { RATE_WINDOW_S, windowedRates } from '../../core/analysis/metrics';
import { StatTile } from '../components/Charts';
import { useDiveLog } from '../state';
import { SaturationCard } from '../components/Saturation';
import { decoTimeline, entryStateFor, gfOf, type DecoPoint } from '../../core/analysis/tissues';
import { ModificaImmersione } from '../components/ModificaImmersione';
import { condizioniTesto, visibilitaTesto } from '../../core/conditions';
import { piastraDellImmersione, zavorraTotaleKg, type Equipment } from '../../core/analysis/gear';
import {
  capitalise,
  dateLong,
  FORMAT_LABEL,
  SEVERITY_CLASS,
  SEVERITY_TEXT,
  timeShort,
  tzLabel,
} from '../format';
import { useLingua } from '../lingua';
import { usePortaInVista } from '../scorri';

export function DiveDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { dives, loadProfiles, saveDive, removeDive, gear, saveGear, subacqueo, numeri } = useDiveLog();
  const { t } = useLingua();
  const summary = dives.find((d) => d.id === id);
  /* La posizione nel logbook, non il numero che l'immersione aveva nella fonte. */
  const numero = numeri.get(id);
  const [dive, setDive] = useState<Dive | undefined>(summary);
  const [editing, setEditing] = useState(false);
  // Vero quando la scheda di modifica ha qualcosa di non salvato. Vedi il
  // pulsante «Chiudi modifica» più sotto.
  const [sporco, setSporco] = useState(false);
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
  const [esitoPdf, setEsitoPdf] = useState<string | null>(null);

  /*
   * ► LA MODIFICA SI APRE SOTTO GLI OCCHI. ◄
   *
   * La scheda di modifica sta in fondo alla pagina, dopo il profilo, le
   * tabelle e i grafici. Premendo «Modifica dati» in cima non succedeva
   * NIENTE di visibile: la scheda si apriva due schermate più giù e bisognava
   * andarla a cercare scorrendo. Su iPhone, dove lo schermo è corto e la
   * pagina lunga, sembrava che il pulsante non funzionasse.
   *
   * E vale anche al contrario: chiudendo dal fondo si restava dove la scheda
   * non c'è più, cioè in un punto qualunque della pagina. Si torna alla barra
   * dei pulsanti, che è da dove si era partiti.
   */
  const rifModifica = useRef<HTMLDivElement>(null);
  const rifAzioni = useRef<HTMLDivElement>(null);
  const eraInModifica = useRef(false);
  useEffect(() => {
    // Chi ha chiesto meno animazioni non vuole nemmeno questa: lo scorrimento
    // avviene lo stesso, di colpo. La destinazione conta, il viaggio no.
    const modo: ScrollBehavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';
    if (editing) rifModifica.current?.scrollIntoView({ behavior: modo, block: 'start' });
    else if (eraInModifica.current) rifAzioni.current?.scrollIntoView({ behavior: modo, block: 'center' });
    eraInModifica.current = editing;
  }, [editing]);

  /*
   * Il nome del file lo legge una persona in un elenco: data prima, poi il
   * sito. «MyDiveLog-2026-07-11-Camogli.pdf» si riconosce; «scheda.pdf» no, e
   * dopo tre esportazioni sono tre file uguali.
   */
  const esportaPdf = async () => {
    // Il guardiano di `dive` sta più sotto, nel corpo del componente: qui siamo
    // in una funzione che vive più a lungo del ramo che lo controlla, e senza
    // questa riga TypeScript ha ragione a lamentarsi. Se l'immersione non c'è
    // il pulsante nemmeno si vede, quindi non serve dire niente all'utente.
    if (!dive) return;
    setEsitoPdf(null);
    try {
      const campioni = dive.samples ?? (await loadProfiles(dive.id)).samples;
      // Sul foglio che consegni deve comparire il tuo numero di immersione.
      const pdf = schedePdf(conNumeri([dive], numeri), new Map([[dive.id, campioni]]), {
        subacqueo,
        etichetteFormato: FORMAT_LABEL,
      });
      const giorno = dive.startTime.slice(0, 10);
      const sito = (dive.site?.name ?? 'immersione').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 30);
      const esito = await esporta(`MyDiveLog-${giorno}-${sito}.pdf`, pdf, 'application/pdf');
      setEsitoPdf(`${t('PDF salvato')} ${esito.dove}.`);
    } catch (err) {
      setEsitoPdf(err instanceof Error ? err.message : String(err));
    }
  };

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
          <h2>{t('Immersione non trovata')}</h2>
          <button className="btn" onClick={onBack}>
            {t('Torna al logbook')}
          </button>
        </div>
      </div>
    );
  }

  /**
   * Il pulsante che apre e chiude la modifica.
   *
   * È una funzione perché lo stesso controllo compare in DUE posti: nella barra
   * in alto, dove lo si preme la prima volta, e in fondo alla scheda di
   * modifica, dove si è quando si ha finito. Duplicarne il codice vorrebbe dire
   * duplicare anche la conferma sulle modifiche non salvate, che è la parte che
   * non si può sbagliare.
   */
  const controlloModifica = () =>
    editing && sporco ? (
      <BottoneConferma
        etichetta={t('Chiudi modifica')}
        conferma={t('Sì, butta via le modifiche')}
        domanda={<>{t('Ci sono modifiche non salvate: chiudendo vanno perse.')}</>}
        onConferma={() => {
          setSporco(false);
          setEditing(false);
        }}
      />
    ) : (
      <button
        className="btn"
        onClick={() => {
          setSporco(false);
          setEditing((v) => !v);
        }}
      >
        {editing ? t('Chiudi modifica') : t('Modifica dati')}
      </button>
    );

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
            {/*
             * Il titolo vince sul sito, quando c'è. È l'unica cosa che
             * distingue la terza immersione della settimana dalle altre due
             * fatte nello stesso posto; il sito resta nella riga sotto.
             */}
            {dive.title || dive.site?.name || t('Immersione')}
            {numero !== undefined && (
              <span className="muted" style={{ fontWeight: 400 }}>
                {' '}
                · #{numero}
              </span>
            )}
          </h1>
          <div className="secondary" style={{ fontSize: 13 }}>
            {capitalise(dateLong(dive.startTime, dive.utcOffsetMinutes))} ·{' '}
            {timeShort(dive.startTime, dive.utcOffsetMinutes)}
            {tzLabel(dive.utcOffsetMinutes) && (
              <span className="muted">
                {' '}
                ({tzLabel(dive.utcOffsetMinutes)}, {t('ora locale del sito')})
              </span>
            )}
          </div>
        </div>
        <div className="row" ref={rifAzioni}>
          <button className="btn btn-quiet" onClick={onBack}>
            ← {t('Logbook')}
          </button>
          {/*
           * SU IPHONE IL PULSANTE NON C'È, e non è una rinuncia.
           *
           * La stampa apre una finestra nuova con il foglio impaginato e passa
           * la parola alla finestra di stampa del sistema. Dentro la WKWebView
           * di iOS non esiste né l'una né l'altra: `window.open` restituisce
           * null e `window.print()` non fa niente. Il pulsante restava lì,
           * identico agli altri, e premendolo compariva un avviso che dava la
           * colpa al blocco dei popup — mandava cioè a cercare un'impostazione
           * che non esiste, per un problema che non era quello.
           *
           * Un pulsante che non può funzionare è peggio della sua assenza:
           * promette una funzione e poi mente sul perché non c'è. Il foglio si
           * stampa dal Mac, dove l'archivio è lo stesso.
           */}
          {!suIOS() && (
            <button
              className="btn"
              onClick={() => setStampaBloccata(!apriStampa(dive, gear.equipment, subacqueo, numeri))}
            >
              {t('Stampa questa immersione')}
            </button>
          )}
          {/*
           * ► IL PDF C'È DOVE LA STAMPA NON C'È, ed è il punto. ◄
           *
           * Su iPhone non esiste una finestra di stampa da cui «esportare come
           * PDF»: il foglio da mandare a chi lo chiede — un centro, un
           * istruttore, un'assicurazione — si poteva fare solo dal computer di
           * casa, cioè nel momento sbagliato. Quello giusto è in barca, cinque
           * minuti dopo l'immersione.
           *
           * Il pulsante c'è anche sul Mac perché lì fa una cosa diversa e utile
           * lo stesso: un file, subito, senza passare dalla finestra di stampa.
           */}
          <button className="btn" onClick={() => void esportaPdf()}>
            {t('Esporta PDF')}
          </button>
          {/*
           * Chiudere con modifiche non salvate CHIEDE conferma.
           *
           * Il pulsante si chiama «Chiudi», non «Annulla», e la bozza vive nella
           * scheda: chiuderla la cancellava in silenzio, senza avviso e senza
           * ritorno. Verificato con l'app in mano — nota e titolo appena scritti
           * sparivano, e sparivano anche solo cambiando pagina. Con la scheda
           * pulita il pulsante resta quello di prima, senza domande inutili.
           */}
          {controlloModifica()}
        </div>
      </div>

      {/*
       * PERCHÉ I DUE TESTI SONO DIVERSI. Dentro la WKWebView di iOS `window.open`
       * torna null e `window.print()` non fa niente: non è il blocco dei popup,
       * ed è inutile mandare a cercare un'impostazione che lì non esiste. Nel
       * browser invece la causa è sempre e solo il blocco dei popup.
       */}
      {stampaBloccata && (
        <div className="notice">
          {suIOS()
            ? t('Su iPhone e iPad non si stampa. Il foglio si stampa dal Mac: i dati sono gli stessi.')
            : t('Il browser ha bloccato la finestra di stampa. Consentila per questo sito e riprova.')}
        </div>
      )}

      {/*
       * L'esito dell'esportazione si dice sempre, e nello stesso posto.
       *
       * Su iPhone il file finisce nella cartella dell'app dentro File, che è un
       * luogo che va nominato: senza una riga che lo dica, il pulsante sembra
       * non aver fatto niente. Se invece qualcosa è andato storto, qui compare
       * il messaggio dell'errore vero, non un «riprova» generico.
       */}
      {esitoPdf && <div className="notice">{esitoPdf}</div>}

      <div className="grid grid-tiles">
        {/* `StatTile` non traduce da sé: etichette e note arrivano tradotte da qui. */}
        <StatTile
          label={t('Profondità massima')}
          value={`${dive.maxDepth.toFixed(1)} m`}
          note={
            m?.avgDepth !== undefined
              ? `${t('media')} ${m.avgDepth.toFixed(1)} m`
              : t('media non disponibile')
          }
        />
        <StatTile
          label={t('Durata')}
          value={formatDuration(dive.durationS)}
          note={m ? `${t('fondo')} ${formatDuration(m.phases.bottomS)}` : undefined}
        />
        <StatTile
          label={t('Consumo di superficie')}
          value={m?.rmvLpm !== undefined ? `${m.rmvLpm.toFixed(1)}` : '—'}
          note={m?.rmvLpm !== undefined ? 'L/min' : t('servono volume e pressione della bombola')}
        />
        <StatTile
          label={t('Oscillazione a quota tenuta')}
          value={m?.bottomVerticalTravelMpm !== undefined ? m.bottomVerticalTravelMpm.toFixed(1) : '—'}
          note={
            m?.bottomVerticalTravelMpm !== undefined
              ? `m/min ${t('su')} ${formatDuration(m.holdingS ?? 0)} ${t('di quota tenuta')}`
              : t('serve un profilo campionato')
          }
        />
        <StatTile
          label={t('Risalita di picco')}
          value={m?.maxAscentRateMpm !== undefined ? `${m.maxAscentRateMpm.toFixed(0)}` : '—'}
          note={`m/min ${t('su')} 30 s`}
        />
        <StatTile
          label={t('Temperatura minima')}
          value={dive.minTempC !== undefined ? `${dive.minTempC.toFixed(1)} °C` : '—'}
          note={dive.airTempC !== undefined ? `${t('aria')} ${dive.airTempC.toFixed(0)} °C` : undefined}
        />
      </div>

      <div className="card">
        <h2>{t('Profilo')}</h2>
        <div className="spread" style={{ alignItems: 'flex-start', gap: 12 }}>
          <p className="card-sub">
            {t('Profondità in metri, tempo in minuti.')}{' '}
            {samples.length > 2
              ? `${samples.length} ${t('campioni, uno ogni')} ${stepOf(samples)} s${
                  showAlt ? ` — ${t('secondo computer')}` : ''
                }.`
              : t('Nessun campionamento nel file di origine.')}
            {hasAlt && !showAlt && m?.quality.ratesFromAlt
              ? ` ${t('Velocità e assetto vengono dal profilo più fitto del secondo computer, a')} ${m.quality.ratesIntervalS} s.`
              : ''}
          </p>
          {hasAlt && (
            /*
             * `scelta-computer` e non `row`: i nomi dei computer sono lunghi.
             *
             * «Scubapro Aladin Sport Matrix» su un iPhone non ci sta accanto a
             * «Shearwater Peregrine», e con `flexShrink: 0` — che serviva a non
             * far schiacciare i pulsanti sul Mac — il secondo usciva dal bordo
             * della carta. Il nome NON si può accorciare: è l'unica cosa che
             * dice quale dei due profili stai guardando, ed è il motivo per cui
             * questi pulsanti esistono. Quindi vanno a capo e, sul telefono,
             * occupano una riga intera ciascuno.
             */
            <div className="scelta-computer">
              <button className="btn" aria-pressed={!showAlt} onClick={() => setShowAlt(false)}>
                {dive.computer?.model ?? t('Profilo principale')}
              </button>
              <button className="btn" aria-pressed={showAlt} onClick={() => setShowAlt(true)}>
                {dive.otherComputers?.[0]?.model ?? t('Secondo profilo')}
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
              label={t('Temperatura')}
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
              label={t('Pressione bombola')}
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
              label={`${t('Velocità verticale su')} ${RATE_WINDOW_S} s — ${t('positiva in risalita')}`}
              unit="m/min"
              digits={1}
              color="var(--series-1)"
              cursor={{ t: cursorT, onChange: setCursorT }}
              reference={[
                {
                  value: LIMITS.ascentRateDeepMpm,
                  label: `${t('limite')} ${LIMITS.ascentRateDeepMpm} ${t('sotto i 10 m')}`,
                },
                {
                  value: LIMITS.ascentRateShallowMpm,
                  label: `${t('limite')} ${LIMITS.ascentRateShallowMpm} ${t('sopra i 10 m')}`,
                  color: 'var(--warning)',
                },
              ]}
            />
          </div>
        )}
        {samples.some((s) => s.rbtMin !== undefined) && (
          <div style={{ marginTop: 6 }}>
            <MiniSeries
              samples={samples}
              pick={(s) => s.rbtMin}
              label={t('Tempo di fondo residuo (RBT)')}
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
              label={t('Tempo di risalita (TTS) del computer')}
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
              label={t('Minuti residui in curva (NDL)')}
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
              label={t('Orologio dell’ossigeno (CNS)')}
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
          <p className="card-sub">{t('Cosa dice il profilo di questa immersione.')}</p>
          <div className="stack" style={{ gap: 7 }}>
            {observations.map((o) => (
              <div key={o.text} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <span className={`dot ${SEVERITY_CLASS[o.severity]}`} style={{ marginTop: 6 }} />
                <span style={{ flex: 1, fontSize: 13 }}>
                  <span className="muted" style={{ fontSize: 11, fontWeight: 650, marginRight: 6 }}>
                    {/* `SEVERITY_TEXT` vive in `format.ts`: si traduce al disegno. */}
                    {t(SEVERITY_TEXT[o.severity])}
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
          <h2>{t('Dettagli')}</h2>
          <table>
            <tbody>
              {/* `modeLabel` sta in `core` e torna l'etichetta italiana: si
                  traduce qui, dove viene disegnata. */}
              <Row label={t('Modalità')} value={t(modeLabel(dive))} />
              <Row label={t('Acqua')} value={t(dive.salinity === 'fresh' ? 'Dolce' : 'Salata')} />
              <Row label={t('Compagno')} value={dive.buddy ?? '—'} />
              <Row label={t('Guida sub')} value={dive.guide ?? '—'} />
              {/* Le due lettere del libretto che si scrivono a mano: si mostrano
                  solo quando ci sono, perché una riga «Centro: —» su ogni
                  immersione fatta fra amici è rumore. */}
              {dive.center && <Row label={t('Centro di immersione')} value={dive.center} />}
              {dive.plannedMaxDepth !== undefined && (
                <Row label={t('Profondità programmata')} value={`${dive.plannedMaxDepth} m`} />
              )}
              {/*
               * La zavorra si mostra col TOTALE quando c'è una piastra, e con la
               * scomposizione accanto. Il solo `weightKg` racconterebbe il
               * contrario di quello che succede in acqua: 2 kg scritti più una
               * piastra d'acciaio da 3 fanno cinque.
               */}
              <Row
                label={t('Zavorra')}
                value={
                  zavorraTotaleKg(dive, gear.equipment) > 0
                    ? piastraDellImmersione(dive, gear.equipment)
                      ? `${Math.round(zavorraTotaleKg(dive, gear.equipment) * 10) / 10} kg (${dive.weightKg ?? 0} ${t('di zavorra')} + ${piastraDellImmersione(dive, gear.equipment)} ${t('di piastra')})`
                      : `${dive.weightKg} kg`
                    : '—'
                }
              />
              <Row label={t('Muta')} value={dive.gear?.suit?.name ?? dive.suit ?? '—'} />
              <Row
                label={t('Erogatori')}
                value={
                  dive.gear?.regulators?.length ? dive.gear.regulators.map((r) => r.name).join(' · ') : '—'
                }
              />
              <Row label="GAV" value={dive.gear?.bcd?.name ?? '—'} />
              <Row label={t('Visibilità')} value={visibilitaTesto(dive)} />
              {/* `condizioniTesto` incolla le etichette di `core` con ' · ':
                  si traduce pezzo per pezzo, che è come stanno nel dizionario. */}
              <Row
                label={t('Condizioni')}
                value={
                  condizioniTesto(dive)
                    .split(' · ')
                    .map((p) => t(p))
                    .join(' · ') || '—'
                }
              />
              <Row label={t('Etichette')} value={dive.tags.length ? dive.tags.join(' · ') : '—'} />
              <Row
                label={t('Fasi')}
                value={
                  m
                    ? `${t('discesa')} ${formatDuration(m.phases.descentS)} · ${t('fondo')} ${formatDuration(m.phases.bottomS)} · ${t('risalita')} ${formatDuration(m.phases.ascentS)}`
                    : '—'
                }
              />
              <Row
                label={t('Sosta di sicurezza')}
                value={m ? (m.safetyStopS > 0 ? formatDuration(m.safetyStopS) : t('nessuna')) : '—'}
              />
              <Row
                label={t('Tempo in deco')}
                value={m && m.decoS > 0 ? formatDuration(m.decoS) : t('nessuno')}
              />
              <Row
                label={t('PPO2 di picco')}
                value={
                  m?.maxPpo2 !== undefined
                    ? `${m.maxPpo2.toFixed(2)} bar${
                        m.minutesAbovePpo214
                          ? ` · ${m.minutesAbovePpo214.toFixed(0)} min ${t('sopra 1.4')}`
                          : ''
                      }`
                    : '—'
                }
              />
              {/* Due CNS, e la differenza va detta: quello del computer viene dal
                  suo modello, il nostro dalle tabelle NOAA applicate al profilo.
                  Sovrapporli nasconderebbe che sono due misure diverse. */}
              <Row
                label={t('CNS del computer')}
                value={m?.cnsEndPct !== undefined ? `${m.cnsEndPct.toFixed(0)}%` : '—'}
              />
              <Row
                label={t('CNS calcolato (NOAA)')}
                value={m?.cnsPct !== undefined ? `${m.cnsPct.toFixed(0)}%` : '—'}
              />
              <Row label="OTU" value={m?.otu !== undefined ? m.otu.toFixed(0) : '—'} />
              <Row
                label={t('Velocità sull’ultimo tratto')}
                value={
                  m?.finalAscentRateMpm !== undefined
                    ? `${m.finalAscentRateMpm.toFixed(0)} m/min ${t('da')} ${m.finalAscentFromM?.toFixed(1)} m`
                    : '—'
                }
              />
              <Row label="END" value={m?.endM !== undefined ? `${m.endM.toFixed(1)} m` : '—'} />
              <Row
                label={t('Sosta profonda')}
                value={
                  m === undefined
                    ? '—'
                    : m.deepStopS > 0
                      ? `${formatDuration(m.deepStopS)} ${t('a')} ${m.deepStopDepthM?.toFixed(0)} m`
                      : t('nessuna')
                }
              />
              <Row
                label={t('Forma del profilo')}
                value={
                  m?.sawtoothMPerHour === undefined
                    ? '—'
                    : `${m.sawtoothMPerHour.toFixed(0)} m/h ${t('di ridiscese')}${
                        shapeNote(m.sawtoothMPerHour, dives) ?? ''
                      }${
                        m.depthTrendM !== undefined
                          ? m.depthTrendM >= 0
                            ? ` · ${t('prima metà')} ${m.depthTrendM.toFixed(1)} ${t('m più profonda, come si raccomanda')}`
                            : ` · ${t('seconda metà')} ${(-m.depthTrendM).toFixed(1)} ${t('m più profonda della prima')}`
                          : ''
                      }`
                }
              />
              {m !== undefined && m.badGasSwitches > 0 && (
                <Row
                  label={t('Cambi di gas sotto la MOD')}
                  value={`${m.badGasSwitches} — ${t('errore di procedura')}`}
                />
              )}
              {m?.minPpo2 !== undefined && m.minPpo2 < 0.21 && (
                <Row label={t('PPO2 minima')} value={`${m.minPpo2.toFixed(2)} bar`} />
              )}
              <ComputersRow dive={dive} />
              <SourcesRow dive={dive} />
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>{t('Bombole e miscele')}</h2>
          {/* Il volume in litri serve al consumo in L/min: senza, resta bar/min,
              che non si confronta fra bombole di taglia diversa. */}
          <p className="card-sub">{t('Senza i litri della bombola il consumo in L/min non si calcola.')}</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Gas</th>
                  <th className="num">{t('Litri')}</th>
                  <th className="num">{t('Inizio')}</th>
                  <th className="num">{t('Fine')}</th>
                  <th className="num">{t('Usati')}</th>
                  {/* La colonna compare solo se almeno una bombola è stata
                      analizzata: su un archivio dove nessuno lo fa sarebbe una
                      colonna di trattini larga quanto le altre. */}
                  {dive.cylinders.some((c) => c.analisi) && <th>{t('Analizzato')}</th>}
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
                    {dive.cylinders.some((x) => x.analisi) && (
                      <td>{c.analisi ? descriviAnalisi(c.analisi) : '—'}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/*
           * ► QUANDO L'ETICHETTA E L'ANALIZZATORE NON VANNO D'ACCORDO. ◄
           *
           * È il momento in cui registrare l'analisi serve davvero. Tutto ciò
           * che l'applicazione ha calcolato — MOD, PPO2, esposizione
           * all'ossigeno — è appoggiato alla miscela DICHIARATA: se quella non
           * è la miscela che hai respirato, quei numeri sono sbagliati, e lo
           * sono nella direzione che conta.
           *
           * L'avviso nomina le due MOD e non le due percentuali: «due punti
           * percentuali» non dice niente a nessuno, «trentasette metri invece
           * di quaranta» dice tutto.
           */}
          {scartiDiAnalisi(dive.cylinders).map((s) => (
            <div key={s.bombola} className="notice" style={{ marginTop: 12 }}>
              <b>
                {t('Bombola')} {s.bombola + 1}
              </b>{' '}
              — {descriviScarto(s, t)}
            </div>
          ))}
          {m?.quality.caveats.length ? (
            <div className="notice" style={{ marginTop: 12 }}>
              {m.quality.caveats.map((c) => (
                <div key={c}>{c}</div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {timeline.length > 2 && (
        <DecoTimelineCard dive={dive} timeline={timeline} cursorT={cursorT} setCursorT={setCursorT} />
      )}

      <SaturationCard dive={dive} dives={dives} />

      <ComputerSettings dive={dive} />

      <CartaFirma dive={dive} onSalva={(d) => void saveDive(d)} />

      {(dive.reported || dive.annotations) && (
        <div className="grid grid-2">
          {dive.reported && (
            <div className="card">
              <h2>{t('Letto dal computer')}</h2>
              {/* Restano distinti da quelli che ricaviamo noi dal profilo: due
                  misure diverse, e sovrapporle nasconderebbe la differenza. */}
              <p className="card-sub">{t('Quello che ha calcolato il computer durante l’immersione.')}</p>
              <table>
                <tbody>
                  <Row
                    label={t('GF99 all’uscita')}
                    value={dive.reported.gf99End !== undefined ? `${dive.reported.gf99End}%` : '—'}
                  />
                  <Row
                    label={t('Obbligo decompressivo')}
                    value={
                      dive.reported.maxDecoObligationS !== undefined
                        ? dive.reported.maxDecoObligationS > 0
                          ? formatDuration(dive.reported.maxDecoObligationS)
                          : t('nessuno')
                        : '—'
                    }
                  />
                  <Row
                    label={t('NDL minimo')}
                    value={dive.reported.minNdlS !== undefined ? formatDuration(dive.reported.minNdlS) : '—'}
                  />
                  <Row label={t('Consumo dichiarato')} value={dive.reported.avgSac ?? '—'} />
                </tbody>
              </table>
            </div>
          )}
          {dive.annotations && (
            <div className="card">
              <h2>{t('Annotazioni del logbook')}</h2>
              <p className="card-sub">{t('Come le hai scritte nel logbook di origine.')}</p>
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

      {editing && (
        <div ref={rifModifica}>
          <ModificaImmersione
            dive={dive}
            gear={gear}
            onSalvaAttrezzatura={saveGear}
            onSave={saveDive}
            onDelete={() => void removeDive(dive.id).then(onBack)}
            onSporco={setSporco}
            /* Lo stesso controllo della barra in alto, qui in fondo: quando si
               ha finito si è QUI, e risalire tutta la pagina per chiudere è
               una fatica che il pulsante può risparmiare. */
            chiudi={controlloModifica()}
          />
        </div>
      )}

      {dive.notes && (
        <div className="card">
          <h2>{t('Note')}</h2>
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
function apriStampa(
  dive: Dive,
  inventario: Equipment[],
  subacqueo: Subacqueo,
  numeri: Map<string, number>,
): boolean {
  const html = logbookHtml(conNumeri([dive], numeri), new Map([[dive.id, dive.samples ?? []]]), {
    title: 'Logbook',
    // Nome e brevetto: le lettere a) e b) del libretto. Vengono dalle
    // impostazioni, non dall'immersione, e senza restano due trattini.
    subacqueo,
    // Senza l'inventario il foglio da firmare dichiara la sola zavorra e non la
    // piastra, sulle immersioni che il peso della piastra non ce l'hanno scritto
    // sopra. Vedi `piastraDellImmersione`.
    inventario,
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
  const { t } = useLingua();
  const all = [dive.source, ...(dive.extraSources ?? [])];
  return (
    <tr>
      <td className="muted" style={{ width: '38%' }}>
        {all.length > 1 ? `${t('Origine')} (${all.length} ${t('fonti')})` : t('Origine')}
      </td>
      <td>
        {/* `FORMAT_LABEL` sta in `format.ts`: costante in italiano lì, tradotta
            qui al disegno. Il nome del file no: non è una frase. */}
        {all.map((s) => (
          <div key={`${s.format}|${s.file}`}>
            {t(FORMAT_LABEL[s.format] ?? s.format)} · {s.file}
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
  const { t } = useLingua();
  const all = [dive.computer, ...(dive.otherComputers ?? [])].filter(Boolean) as ComputerInfo[];
  if (!all.length) return <Row label={t('Computer')} value="—" />;
  return (
    <tr>
      <td className="muted" style={{ width: '38%' }}>
        {all.length > 1 ? `${t('Computer')} (${all.length})` : t('Computer')}
      </td>
      <td>
        {all.map((c, i) => (
          <div key={`${c.model ?? ''}-${c.serial ?? i}`}>
            {[c.model, c.decoModel].filter(Boolean).join(' · ') || '—'}
            {i === 0 && all.length > 1 && <span className="muted"> · {t('profilo da qui')}</span>}
          </div>
        ))}
      </td>
    </tr>
  );
}

function ComputerSettings({ dive }: { dive: Dive }) {
  const { t } = useLingua();
  const all = [dive.computer, ...(dive.otherComputers ?? [])].filter(Boolean) as ComputerInfo[];
  if (all.length > 1) {
    return (
      <div className="grid grid-2">
        {all.map((c, i) => (
          <SingleComputerSettings
            key={`${c.model ?? ''}-${c.serial ?? i}`}
            computer={c}
            surfacePressureBar={i === 0 ? dive.surfacePressureBar : undefined}
            title={c.model ?? `${t('Computer')} ${i + 1}`}
          />
        ))}
      </div>
    );
  }
  return (
    <SingleComputerSettings
      computer={all[0]}
      surfacePressureBar={dive.surfacePressureBar}
      title={t('Impostazioni del computer')}
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
  const { t } = useLingua();
  if (!c) return null;
  // Le etichette si traducono qui: sono righe costruite a mano, non una
  // costante, quindi il posto in cui nascono è anche quello in cui si disegnano.
  const rows: [string, string][] = [];
  if (c.gfLow !== undefined && c.gfHigh !== undefined) {
    rows.push([t('Gradient factor impostati'), `${c.gfLow} / ${c.gfHigh}`]);
  }
  if (c.decoModel) rows.push([t('Modello decompressivo'), c.decoModel]);
  if (c.conservatism !== undefined) rows.push([t('Conservatorismo'), `+${c.conservatism}`]);
  if (c.computerMode) rows.push([t('Modalità'), t(COMPUTER_MODE[c.computerMode] ?? c.computerMode)]);
  if (c.waterDensityKgM3) {
    rows.push([
      t('Densità impostata'),
      `${c.waterDensityKgM3} kg/m³ (${t(c.waterDensityKgM3 <= 1005 ? 'acqua dolce' : 'acqua salata')})`,
    ]);
  }
  if (c.ppo2MaxBar) rows.push([t('Limite di PPO2 impostato'), `${c.ppo2MaxBar.toFixed(2)} bar`]);
  if (surfacePressureBar) {
    rows.push([t('Pressione in superficie'), `${surfacePressureBar.toFixed(3)} bar`]);
  }
  if (c.sampleIntervalS) rows.push([t('Passo di campionamento'), `${c.sampleIntervalS} s`]);
  if (c.aiMode) rows.push([t('Integrazione aria'), c.aiMode]);
  if (c.firmware) rows.push(['Firmware', c.firmware]);
  if (c.hwVersion) rows.push([t('Versione hardware'), c.hwVersion]);
  if (c.serial) rows.push([t('Numero di serie'), c.serial]);
  if (c.logVersion !== undefined) rows.push([t('Versione del log'), String(c.logVersion)]);
  if (!rows.length) return null;

  return (
    <div className="card">
      <h2>{title}</h2>
      {/* Il GF99 e l'obbligo decompressivo mostrati sopra sono stati calcolati
          dal computer con queste impostazioni: confrontare due immersioni fatte
          con impostazioni diverse senza saperlo porta a conclusioni sbagliate. */}
      <p className="card-sub">{t('Lette dal log del computer, non inserite a mano.')}</p>
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

/*
 * Le modalità del computer. Costante, non ricostruita a ogni render: resta in
 * italiano qui e si traduce con `t()` dove viene disegnata.
 */
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
  const { t } = useLingua();
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
      <h2>{t('Curva e obbligo, minuto per minuto')}</h2>
      {/* I numeri del computer compaiono tratteggiati non per correggerlo — era
          lui in acqua, ed è lui ad avere ragione — ma perché due
          implementazioni dello stesso modello che divergono dicono qualcosa, e
          su due grafici separati la divergenza non si vedrebbe. */}
      <p className="card-sub">
        {t('Ricalcolati sul profilo con Bühlmann ZH-L16C e gradient factor')} {gf},{' '}
        {t('con l’azoto residuo dell’immersione precedente. Tratteggiati, i numeri del tuo computer.')}
      </p>

      <MiniSeries
        samples={points}
        pick={(_s, i) => at(i)?.ndlMin}
        label={t('Minuti residui in curva')}
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
                label: t('il tuo computer'),
              }
            : undefined
        }
        reference={[{ value: 0, label: t('fuori curva'), color: 'var(--warning)' }]}
      />

      <div style={{ marginTop: 6 }}>
        <MiniSeries
          samples={points}
          pick={(_s, i) => at(i)?.ceilingM}
          label={maxCeiling > 0 ? t('Tetto di decompressione') : t('Tetto di decompressione: mai comparso')}
          unit="m"
          color="var(--critical)"
          cursor={cursor}
          fill
          compare={
            hasComputer((s) => s.ceiling)
              ? {
                  pick: (s) => nearest(s.t)?.ceiling,
                  label: t('il tuo computer'),
                }
              : undefined
          }
        />
      </div>

      <div style={{ marginTop: 6 }}>
        <MiniSeries
          samples={points}
          pick={(_s, i) => at(i)?.ttsMin}
          label={t('Tempo per arrivare in superficie (TTS)')}
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
                  label: t('il tuo computer'),
                }
              : undefined
          }
        />
      </div>

      <div style={{ marginTop: 6 }}>
        <MiniSeries
          samples={points}
          pick={(_s, i) => at(i)?.gf99}
          label={t('Sovrasaturazione istantanea (GF99)')}
          unit="%"
          color="var(--series-3)"
          cursor={cursor}
          fill
          reference={
            dive.computer?.gfHigh
              ? [
                  {
                    value: dive.computer.gfHigh,
                    label: `${t('GF alto')} ${dive.computer.gfHigh}`,
                    color: 'var(--warning)',
                  },
                ]
              : []
          }
        />
      </div>

      <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)' }}>
        {/*
         * Le tre note dicevano anche PERCHÉ: il carico invece dei tessuti
         * puliti è la differenza fra un computer e una tabella; il taglio a 99
         * minuti è quello che fanno i computer, perché oltre il centinaio non è
         * più un limite; il TTS pessimista è quello di un computer che non sa
         * cosa ti sei portato dietro. All'utente serve il fatto.
         */}
        <li>
          {t('I minuti in curva partono')} <b>{t('dal carico che avevi in quel momento')}</b>,{' '}
          {t('non da tessuti puliti. Il limite è tagliato a 99 minuti.')}
        </li>
        <li>
          {t('Il TTS suppone risalita a 9 m/min, soste di un minuto e')} <b>{t('nessun cambio di gas')}</b>.
        </li>
        <li>
          {t('Se il tuo computer aveva gradient factor diversi da')} {gf},{' '}
          {t('la distanza fra le due curve è quella differenza.')}
        </li>
      </ul>
    </div>
  );
}

/**
 * La firma della guida sulla singola immersione.
 *
 * ► PERCHÉ NON È SEMPRE APERTA. ◄ Un riquadro da firmare vuoto su OGNI scheda
 * sarebbe rumore: la stragrande maggioranza delle immersioni non verrà mai
 * controfirmata, e chi rilegge il suo logbook di dieci anni fa non deve
 * scavalcare un modulo a ogni pagina. Si apre quando serve, e quando c'è una
 * firma si vede la firma.
 *
 * ► SU IPHONE È PIÙ UTILE CHE SUL MAC, ed è l'unica superficie di questa
 * applicazione di cui si può dire. La guida firma col dito, in barca, sul
 * telefono che hai in mano — non davanti a un computer a casa. Per questo il
 * riquadro esiste su tutte e due le piattaforme e non è nascosto sul Mac: ma è
 * il telefono il posto per cui è disegnato.
 */
function CartaFirma({ dive, onSalva }: { dive: Dive; onSalva: (d: Dive) => void }) {
  const { t } = useLingua();
  const [aperto, setAperto] = useState(false);
  const firmata = !firmaVuota(dive.firmaGuida);
  /*
   * `fuoco: false`: qui non c'è un campo da riempire ma una lavagna su cui si
   * firma col dito. Un cursore che lampeggia da qualche parte, e su iPhone la
   * tastiera che si apre, sarebbero solo di intralcio a chi ha il telefono in
   * mano in barca.
   */
  const rif = usePortaInVista<HTMLDivElement>({ quando: aperto, fuoco: false });

  return (
    <div className="card" ref={rif}>
      <h2>{t('Firma della guida')}</h2>
      <p className="card-sub">
        {t('È la lettera o) del libretto: l’unica delle tredici che non è un dato ma un gesto.')}
      </p>

      {firmata && !aperto && (
        <div className="stack" style={{ gap: 8 }}>
          <svg
            className="firma-mostrata"
            viewBox={`0 0 ${dive.firmaGuida!.larghezza} ${dive.firmaGuida!.altezza}`}
            role="img"
            aria-label={t('La firma raccolta per questa immersione')}
          >
            <path
              d={firmaPath(dive.firmaGuida!, dive.firmaGuida!.larghezza, dive.firmaGuida!.altezza)}
              className="tratto-firma"
            />
          </svg>
          <span className="muted" style={{ fontSize: 12 }}>
            {descriviFirma(dive.firmaGuida!, t)}
          </span>
          <div className="row" style={{ gap: 10 }}>
            <button onClick={() => setAperto(true)}>{t('Rifai la firma')}</button>
          </div>
        </div>
      )}

      {!firmata && !aperto && (
        <button className="btn" onClick={() => setAperto(true)}>
          {t('Fai firmare')}
        </button>
      )}

      {aperto && (
        <RiquadroFirma
          firma={dive.firmaGuida}
          nomeProposto={dive.guide}
          onFirma={(firma) => {
            onSalva({ ...dive, firmaGuida: firma });
            setAperto(false);
          }}
          onCancella={() => {
            onSalva({ ...dive, firmaGuida: undefined });
            setAperto(false);
          }}
        />
      )}
    </div>
  );
}
