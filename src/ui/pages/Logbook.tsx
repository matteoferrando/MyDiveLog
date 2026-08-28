import { useMemo, useState } from 'react';
import { formatDuration, mixName } from '../../core/units';
import { mixLabel, modeLabel } from '../../core/analysis/aggregate';
import { nextDiveBriefing, type NextDiveNote } from '../../core/analysis/nextDive';
import type { Dive, DiveConditions, DiveGear, GearRef, Waves, Weather } from '../../core/model';
import {
  conditionsOf,
  FASCE_VISIBILITA,
  tagsSenzaCondizioni,
  WAVES_LABEL,
  WEATHER_LABEL,
} from '../../core/conditions';
import { NewDive } from '../components/NewDive';
import { useDiveLog } from '../state';
import { dateShort, descriviFinestra, FORMAT_LABEL, imm, plural, timeShort } from '../format';
import { BottoneConferma } from '../components/Conferma';
import { ScegliAttrezzo, vocePerNome } from '../components/ScegliAttrezzo';
import { pesoDelGav, type EquipmentKind } from '../../core/analysis/gear';
import { Vuoto } from '../components/Vuoto';
import { useLingua } from '../lingua';

type SortKey = 'date' | 'depth' | 'duration' | 'rmv';

export function Logbook({ onOpen }: { onOpen: (id: string) => void }) {
  const { dives, numeri } = useDiveLog();
  const { t } = useLingua();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('date');
  /*
   * La selezione multipla.
   *
   * Serve alle immersioni inserite a mano e a quelle arrivate da un CSV di
   * riepilogo: sono quelle con più campi vuoti — sito, compagno, muta, zavorra —
   * e sono anche quelle che nessuno correggerà mai una per una, perché aprire
   * diciannove schede e riscrivere lo stesso nome diciannove volte è un lavoro
   * che semplicemente non si fa. Il risultato è che quei campi restano vuoti per
   * sempre, e con loro restano vuote le statistiche che ci si appoggiano.
   */
  const [selezione, setSelezione] = useState<Set<string>>(new Set());
  const [site, setSite] = useState('');
  const [minDepth, setMinDepth] = useState('');
  /*
   * «Scrivila a mano» premuto dalla schermata dell'archivio vuoto.
   *
   * Lo stato sta QUI e non dentro `NewDive` perché il pulsante che lo accende
   * sta nel riquadro vuoto, che è un altro componente: `NewDive` riceve la
   * richiesta e apre il modulo. Non torna mai a falso — se la persona chiude il
   * modulo, a chiuderlo è `NewDive` col proprio stato, e il riquadro
   * dell'invito resta lì aperto a un tocco di distanza.
   */
  const [scriviAMano, setScriviAMano] = useState(false);

  const sites = useMemo(
    () => [...new Set(dives.map((d) => d.site?.name).filter((s): s is string => !!s))].sort(),
    [dives],
  );

  /*
   * QUANTE RIGHE SI DISEGNANO, e perché non tutte.
   *
   * Con centoquattro immersioni la pagina è già lunga; con l'archivio di chi
   * immerge da vent'anni diventa una tabella da migliaia di righe che il
   * telefono deve costruire tutta prima di mostrarne la prima. Il costo non è
   * solo di scorrimento: è il tempo che passa fra il tocco su «Logbook» e il
   * momento in cui compare qualcosa.
   *
   * Si è scelto il pulsante «mostra altre» invece delle pagine numerate per una
   * ragione che riguarda proprio questa pagina: qui si SELEZIONA per modificare
   * in blocco, e con le pagine numerate la casella «seleziona tutte» diventa
   * ambigua — tutte quelle filtrate, o solo quelle di questa pagina? La finestra
   * che si allunga toglie l'ambiguità: quello che è caricato è quello che vedi,
   * e la selezione non può mai comprendere righe che non hai davanti.
   */
  const PER_VOLTA = 50;
  const [quante, setQuante] = useState(PER_VOLTA);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = Number(minDepth) || 0;
    const out = dives.filter((d) => {
      if (site && d.site?.name !== site) return false;
      if (min && d.maxDepth < min) return false;
      if (!q) return true;
      return [d.title, d.site?.name, d.buddy, d.guide, d.notes, d.computer?.model, ...d.tags]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    const by: Record<SortKey, (a: (typeof out)[0], b: (typeof out)[0]) => number> = {
      date: (a, b) => +new Date(b.startTime) - +new Date(a.startTime),
      depth: (a, b) => b.maxDepth - a.maxDepth,
      duration: (a, b) => b.durationS - a.durationS,
      rmv: (a, b) => (b.metrics?.rmvLpm ?? -1) - (a.metrics?.rmvLpm ?? -1),
    };
    return [...out].sort(by[sort]);
  }, [dives, query, site, minDepth, sort]);

  /*
   * Cambiare filtro riporta la finestra all'inizio.
   *
   * Senza questo, chi ha premuto tre volte «mostra altre» e poi cerca una parola
   * si ritrova centocinquanta righe di risultati: la finestra allargata per
   * scorrere l'archivio intero non ha nessun senso applicata a una ricerca che
   * ne trova quattro. E il caso opposto è peggio — restringere e poi allargare
   * il filtro lascerebbe fuori dei risultati senza dirlo.
   *
   * L'azzeramento avviene DURANTE il render e non dentro un effetto, che è la
   * forma che React documenta per «aggiusta uno stato quando ne cambia un
   * altro». Con l'effetto il browser disegnerebbe prima la finestra vecchia
   * applicata ai risultati nuovi e subito dopo quella corretta: un lampo di
   * righe sbagliate, oltre a un secondo giro di render. Così invece React
   * scarta il render in corso e riparte, senza mai mostrare lo stato
   * intermedio.
   */
  const criteri = `${query}\u0000${site}\u0000${minDepth}\u0000${sort}`;
  const [criteriPrecedenti, setCriteriPrecedenti] = useState(criteri);
  if (criteri !== criteriPrecedenti) {
    setCriteriPrecedenti(criteri);
    setQuante(PER_VOLTA);
  }

  /** La finestra visibile: è questa, non `filtered`, che comanda la selezione. */
  const mostrate = useMemo(() => filtered.slice(0, quante), [filtered, quante]);

  /*
   * L'ARCHIVIO VUOTO AVEVA UNA PORTA SOLA, e non era quella di tutti.
   *
   * Questo ramo mandava a Importa e si fermava lì. Ma Importa vuole un file da
   * un computer subacqueo o un collegamento Bluetooth, e chi arriva qui col
   * libretto di carta, col brevetto preso ieri, con un computer a noleggio o
   * con un modello che non si collega non ha nessuna delle due cose. Per loro
   * l'applicazione finiva sulla prima schermata.
   *
   * Peggio: `NewDive` — l'UNICO punto di tutta l'applicazione in cui si scrive
   * un'immersione a mano — stava sotto questo `return`, cioè era codice
   * irraggiungibile proprio nel momento in cui serviva di più. Si vedeva solo
   * quando l'archivio era già pieno, quando cioè una strada l'avevi già
   * trovata.
   *
   * Adesso le porte sono due, dichiarate insieme: il file, e la penna. E il
   * modulo è montato anche qui, così «Scrivila a mano» apre davvero il modulo
   * invece di rivelare un altro pulsante da premere.
   */
  if (dives.length === 0) {
    return (
      <div className="page">
        <Vuoto
          nuda
          titolo="Nessuna immersione in archivio"
          azione={{ vista: 'import', etichetta: 'Vai a Importa' }}
          secondaria={{ etichetta: 'Scrivila a mano', onClick: () => setScriviAMano(true) }}
        >
          {t(
            'Importa un file dal tuo computer subacqueo per iniziare. Puoi caricarne più di uno: le immersioni doppie vengono unite.',
          )}{' '}
          {t(
            "Se hai un libretto di carta o un computer che non si collega, l'immersione la scrivi tu: data, durata, profondità, e il resto quando vuoi.",
          )}
        </Vuoto>
        {/*
          IL MODULO COMPARE SOLO SE LO SI È CHIESTO, e non è timidezza.
          Montandolo sempre, questa schermata mostrava DUE volte la stessa
          porta: il pulsante «Scrivila a mano» qui sopra e, subito sotto, il
          riquadro richiuso «Aggiungi un'immersione a mano» con il suo pulsante.
          Due inviti identici a un passo di distanza non raddoppiano le
          possibilità: fanno rileggere per capire se sono la stessa cosa.

          La chiave è la stessa che porta nel ramo pieno. Salvando la prima
          immersione si passa da questo ramo a quello, e senza chiave React
          riconcilierebbe per posizione: `NewDive` verrebbe smontato e
          rimontato, portandosi via la riga «salvata, vai a vederla» proprio
          nell'istante in cui è appena comparsa. Con la chiave il componente è
          riconosciuto come lo stesso e l'esito sopravvive al salto.
        */}
        {scriviAMano && <NewDive key="nuova-immersione" onDone={onOpen} apriSubito />}
      </div>
    );
  }

  return (
    <div className="page">
      <NextDive dives={dives} />

      <NewDive key="nuova-immersione" onDone={onOpen} />

      <div className="page-title-row">
        <h1 className="page-title">{t('Logbook')}</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {filtered.length === dives.length
            ? imm(dives.length, t)
            : `${filtered.length} ${t('di')} ${imm(dives.length, t)}`}
        </span>
      </div>

      {/* I filtri stanno su una riga sola sopra il contenuto. */}
      <div className="filters">
        {/*
         * `aria-label` e non il solo `placeholder`: il segnaposto sparisce al
         * primo carattere digitato, quindi un lettore di schermo che torni sul
         * campo a metà ricerca annuncia «casella di testo» e basta. Il nome di
         * un controllo deve esistere anche quando il controllo è pieno.
         */}
        <input
          type="search"
          aria-label={t('Cerca fra le immersioni')}
          placeholder={t('Cerca sito, compagno, note…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 200 }}
        />
        <label>
          {/* Lo `<span>` non è decorativo: sul telefono gli dà una larghezza fissa,
              così i tre menu si allineano invece di iniziare ognuno dove capita.
              Un nodo di testo nudo non si può dimensionare. */}
          <span>{t('Sito')}</span>
          <select value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">{t('tutti')}</option>
            {sites.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          {/* Lo `<span>` non è decorativo: sul telefono gli dà una larghezza fissa,
              così i tre menu si allineano invece di iniziare ognuno dove capita.
              Un nodo di testo nudo non si può dimensionare. */}
          <span>{t('Oltre')}</span>
          <select value={minDepth} onChange={(e) => setMinDepth(e.target.value)}>
            <option value="">{t('qualsiasi profondità')}</option>
            <option value="18">18 m</option>
            <option value="30">30 m</option>
            <option value="40">40 m</option>
          </select>
        </label>
        <label>
          {/* Lo `<span>` non è decorativo: sul telefono gli dà una larghezza fissa,
              così i tre menu si allineano invece di iniziare ognuno dove capita.
              Un nodo di testo nudo non si può dimensionare. */}
          <span>{t('Ordina per')}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="date">{t('data')}</option>
            <option value="depth">{t('profondità')}</option>
            <option value="duration">{t('durata')}</option>
            <option value="rmv">{t('consumo di superficie')}</option>
          </select>
        </label>
      </div>

      {selezione.size > 0 && (
        <BulkEdit
          ids={[...selezione]}
          /*
           * Quante delle selezionate i filtri attuali NON mostrano.
           *
           * Selezionare e poi filtrare è un gesto legittimo, quindi la selezione
           * non si pota da sola; ma scrivere su cinquanta record senza vederli è
           * il rischio che questa carta dice di voler evitare, e il numero va
           * dichiarato insieme al modo di ridurre la selezione a ciò che si vede.
           */
          nascoste={[...selezione].filter((id) => !mostrate.some((d) => d.id === id)).length}
          onSoloVisibili={() =>
            setSelezione(new Set(mostrate.filter((d) => selezione.has(d.id)).map((d) => d.id)))
          }
          onDone={() => setSelezione(new Set())}
        />
      )}

      {/*
       * La spaziatura sta in `carta-logbook`, non in uno `style` qui.
       *
       * Uno stile in linea vince su qualunque regola del foglio, quindi finché
       * il padding stava scritto qui il telefono NON poteva toglierlo: sotto i
       * 600 px le righe diventano schede con la loro cornice, e restavano
       * incastrate dentro la cornice di questa carta — due bordi arrotondati
       * uno dentro l'altro, con 4 px sopra e 18 a sinistra. Due cornici
       * concentriche non aggiungono nessuna informazione, e quella spaziatura
       * asimmetrica si legge come un errore.
       */}
      <div className="card table-scroll carta-logbook">
        {/*
         * Sotto i 600 px questa tabella diventa un ELENCO, non una tabella che
         * scorre di lato. Le etichette delle colonne stanno su `data-col` e la
         * regola sta nel foglio di stile — un solo DOM, così le due forme non
         * possono divergere. Vedi `.tabella-logbook` in `styles.css`.
         */}
        <table className="tabella-logbook">
          <thead>
            <tr>
              <th style={{ width: 30 }}>
                <input
                  type="checkbox"
                  aria-label={t('Seleziona tutte le immersioni mostrate')}
                  checked={mostrate.length > 0 && mostrate.every((d) => selezione.has(d.id))}
                  ref={(el) => {
                    // Il trattino riguarda SOLO le righe mostrate: la condizione
                    // di prima era `selezione.size > 0`, quindi la casella diceva
                    // «alcune di queste» mentre la verità era «alcune altrove».
                    if (el) {
                      const scelte = mostrate.filter((d) => selezione.has(d.id)).length;
                      el.indeterminate = scelte > 0 && scelte < mostrate.length;
                    }
                  }}
                  onChange={(e) => {
                    // Aggiunge o toglie le righe MOSTRATE, senza toccare quello
                    // che è selezionato fuori dal filtro: prima spuntarla
                    // sostituiva l'intera selezione e toglierla la azzerava,
                    // buttando via scelte fatte con un filtro precedente.
                    const next = new Set(selezione);
                    for (const d of mostrate) {
                      if (e.target.checked) next.add(d.id);
                      else next.delete(d.id);
                    }
                    setSelezione(next);
                  }}
                />
              </th>
              <th className="num" style={{ width: 44 }}>
                #
              </th>
              <th>{t('Data')}</th>
              <th>{t('Sito')}</th>
              <th className="num">Max</th>
              <th className="num">{t('Durata')}</th>
              <th className="num">{t('Media')}</th>
              <th className="num">L/min</th>
              <th>Gas</th>
              <th>{t('Origine')}</th>
            </tr>
          </thead>
          <tbody>
            {/*
              I filtri possono non lasciare niente, e una tabella con le sole
              intestazioni non dice se il filtro è troppo stretto o se l'archivio
              è vuoto. La riga qui sotto lo dice, e offre la via d'uscita.
            */}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: '28px 4px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {t('Nessuna immersione con questi filtri')}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                    {imm(dives.length, t)} {t('in archivio. Prova ad allargare la ricerca.')}
                  </div>
                  <button
                    className="btn"
                    onClick={() => {
                      setQuery('');
                      setSite('');
                      setMinDepth('');
                    }}
                  >
                    {t('Azzera i filtri')}
                  </button>
                </td>
              </tr>
            )}
            {mostrate.map((d) => (
              <tr key={d.id} className="clickable" onClick={() => onOpen(d.id)}>
                {/* `stopPropagation`: la riga apre l'immersione, la casella no. */}
                <td className="cella-scelta" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`${t('Seleziona l’immersione del')} ${dateShort(d.startTime, d.utcOffsetMinutes)}`}
                    checked={selezione.has(d.id)}
                    onChange={(e) => {
                      const next = new Set(selezione);
                      if (e.target.checked) next.add(d.id);
                      else next.delete(d.id);
                      setSelezione(next);
                    }}
                  />
                </td>
                {/* `data-col="n."` NON si traduce: il foglio di stile ha un
                    selettore su questo valore esatto — `td[data-col='n.']` —
                    per mandare il progressivo in fondo alla scheda sul
                    telefono. È anche una sigla, non una frase. */}
                <td className="num muted" data-col="n.">
                  {/* Il numero è la posizione nel logbook, calcolata
                      sull'archivio: `d.number` è quello che l'immersione aveva
                      nella fonte da cui è arrivata, e non c'è per chi scarica
                      dal computer — i due Bluetooth un progressivo non lo
                      registrano affatto. Vedi `core/numerazione.ts`. */}
                  {numeri.get(d.id) ?? '—'}
                </td>
                {/*
                 * La data è un BOTTONE VERO, non una riga cliccabile e basta.
                 *
                 * `onClick` su un `<tr>` funziona col mouse e con niente altro:
                 * la riga non prende il fuoco, non risponde a Invio, e per chi
                 * usa la tastiera o un lettore di schermo il logbook era un
                 * elenco di dati senza modo di aprirne uno. Mettere `tabIndex`
                 * sulla riga avrebbe rotto la semantica della tabella; un
                 * bottone dentro la cella no, ed è anche quello che dà il nome
                 * all'azione — «apri l'immersione del 14 giugno» — invece di un
                 * «riga» muto. Il clic sulla riga resta, come comodità del
                 * mouse.
                 */}
                <td className="cella-data">
                  <button
                    className="cell-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(d.id);
                    }}
                  >
                    {dateShort(d.startTime, d.utcOffsetMinutes)}
                  </button>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {timeShort(d.startTime, d.utcOffsetMinutes)}
                  </div>
                </td>
                <td className="cella-sito">
                  <div style={{ fontWeight: 550 }}>{d.title || d.site?.name || '—'}</div>
                  {d.title && d.site?.name && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      {d.site.name}
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {/* `modeLabel` sta in `core`: la sua etichetta italiana si traduce
                        qui, dove viene disegnata. */}
                    {[d.buddy, d.mode !== 'oc' ? t(modeLabel(d)) : null].filter(Boolean).join(' · ') || ' '}
                  </div>
                </td>
                <td className="num tabular" data-col="Max">
                  {d.maxDepth.toFixed(1)} m
                </td>
                <td className="num tabular" data-col={t('Durata')}>
                  {formatDuration(d.durationS)}
                </td>
                <td className="num tabular muted" data-col={t('Media')}>
                  {d.avgDepth?.toFixed(1) ?? '—'}
                </td>
                <td className="num tabular" data-col="L/min">
                  {d.metrics?.rmvLpm?.toFixed(1) ?? '—'}
                </td>
                <td className="muted" data-col="Gas">
                  {d.cylinders[0] ? mixName(d.cylinders[0].mix) : t(mixLabel(d))}
                </td>
                <td className="muted cella-origine" data-col={t('Origine')} style={{ fontSize: 11 }}>
                  {/* Tutte le fonti, non solo la prima: un'immersione fusa da tre
                      file compariva come proveniente da una sola, e la scheda
                      dell'immersione diceva il contrario. */}
                  {[d.source, ...(d.extraSources ?? [])]
                    .map((src) => t(FORMAT_LABEL[src.format] ?? src.format))
                    .filter((label, i, all) => all.indexOf(label) === i)
                    .join(' + ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
       * IL PIEDE DELL'ELENCO DICE SEMPRE A CHE PUNTO SEI.
       *
       * Anche quando non c'è più niente da caricare. Un elenco che finisce senza
       * dire niente lascia il dubbio più fastidioso che ci sia in un archivio:
       * «le ha mostrate tutte o si è fermato?». La riga costa nulla e toglie
       * quella domanda, ed è anche il posto dove si scopre quante immersioni
       * corrispondono davvero al filtro appena impostato.
       */}
      {filtered.length > 0 && (
        <div className="piede-elenco">
          <span className="muted">
            {descriviFinestra(mostrate.length, filtered.length, PER_VOLTA, t).testo}
          </span>
          {descriviFinestra(mostrate.length, filtered.length, PER_VOLTA, t).altre > 0 && (
            <button className="btn" onClick={() => setQuante((q) => q + PER_VOLTA)}>
              {/* Numero in mezzo, non in coda: in inglese va prima del
                  sostantivo, e una chiave per ogni numero non è una strada. */}
              {t('Mostra')} {descriviFinestra(mostrate.length, filtered.length, PER_VOLTA, t).altre}{' '}
              {t('in più')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Quello che riguarda la PROSSIMA immersione, in cima al logbook.
 *
 * Sta qui e non in una scheda a sé perché è la prima cosa che si apre, e una
 * pagina che si deve andare a cercare per sapere che il collaudo è scaduto non
 * serve a niente. È chiusa per difetto quando non c'è nulla di urgente: una
 * schermata che grida sempre smette di essere letta.
 */
function NextDive({ dives }: { dives: Dive[] }) {
  const { t } = useLingua();
  const briefing = useMemo(() => nextDiveBriefing(dives, undefined, Date.now(), t), [dives, t]);
  const urgent = briefing.notes.filter((n) => n.level === 'critical' || n.level === 'warning');
  const [open, setOpen] = useState(urgent.length > 0);

  const shown = open ? briefing.notes : urgent;
  if (!shown.length && !open) {
    return (
      <div className="card" style={{ paddingTop: 10, paddingBottom: 10 }}>
        <div className="spread">
          <span className="row" style={{ gap: 8 }}>
            <span className="dot dot-good" />
            <b>{t('Prima della prossima immersione')}</b>
            <span className="muted">{t('niente in scadenza, niente in circolo')}</span>
          </span>
          <button style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setOpen(true)}>
            {t('Apri')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0 }}>{t('Prima della prossima immersione')}</h2>
          {/*
           * Il sottotitolo diceva anche PERCHÉ non c'è un semaforo complessivo
           * — i fatti, e il giudizio a chi lo deve dare. È una scelta di
           * progetto, non un'informazione per chi si immerge: sta qui.
           */}
          <p className="card-sub" style={{ marginBottom: 0 }}>
            {t('Quello che scade, dal più urgente.')}
          </p>
        </div>
        <button style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setOpen((v) => !v)}>
          {open ? t('Riduci') : t('Apri tutto')}
        </button>
      </div>

      <div className="stack" style={{ gap: 8, marginTop: 12 }}>
        {shown.map((n) => (
          <NoteRow key={n.id} note={n} />
        ))}
      </div>

      {briefing.daysSinceLast !== undefined && (
        <p className="planner-hint" style={{ marginTop: 10 }}>
          {/* Numero e sostantivo si compongono con `plural`, così «1 giorni fa»
              non può comparire e la frase non diventa una voce di dizionario
              per ogni numero possibile. */}
          {t('Ultima immersione')}{' '}
          {briefing.daysSinceLast === 0
            ? t('oggi')
            : `${plural(briefing.daysSinceLast, 'giorno', 'giorni', t)} ${t('fa')}`}
          {briefing.residualN2Bar !== undefined && briefing.residualN2Bar > 0
            ? ` · ${t('azoto residuo')} +${briefing.residualN2Bar.toFixed(2)} bar`
            : ''}
          {briefing.residualCnsPct !== undefined && briefing.residualCnsPct >= 1
            ? ` · CNS ${briefing.residualCnsPct.toFixed(0)}%`
            : ''}
          .
        </p>
      )}
    </div>
  );
}

const NOTE_DOT: Record<NextDiveNote['level'], string> = {
  critical: 'dot-critical',
  warning: 'dot-warning',
  info: '',
  good: 'dot-good',
};

function NoteRow({ note }: { note: NextDiveNote }) {
  return (
    <div className={note.level === 'critical' ? 'notice notice-error' : 'notice'}>
      <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        <span className={`dot ${NOTE_DOT[note.level]}`} />
        <b style={{ fontWeight: 650 }}>{note.headline}</b>
      </div>
      <div style={{ fontSize: 12, marginTop: 4 }}>{note.detail}</div>
    </div>
  );
}

/**
 * Modifica in blocco.
 *
 * Compare solo quando qualcosa è selezionato, e scrive SOLO i campi che tocchi.
 * È la regola che rende l'operazione usabile senza paura: una modifica in blocco
 * che riscrive tutto quello che ha in modulo cancellerebbe, su ogni immersione
 * selezionata, i campi che avevi compilato una per una — e siccome sono
 * cinquanta righe alla volta, nessuno se ne accorgerebbe finché non è tardi.
 *
 * Ogni campo ha quindi tre stati e non due: «non toccare» (predefinito),
 * «scrivi questo valore», «svuota». Il terzo esiste perché correggere un errore
 * fatto in blocco richiede di poterlo disfare in blocco.
 */
function BulkEdit({
  ids,
  nascoste,
  onSoloVisibili,
  onDone,
}: {
  ids: string[];
  nascoste: number;
  onSoloVisibili: () => void;
  onDone: () => void;
}) {
  const { dives, saveDive, removeDives, unisciImmersioni, gear, saveGear } = useDiveLog();
  const { t } = useLingua();
  const aggiungiAttrezzo = (kind: EquipmentKind, name: string): string => {
    const voce = vocePerNome(kind, name);
    void saveGear({ ...gear, equipment: [...gear.equipment, voce] });
    return voce.id;
  };
  const [sito, setSito] = useState('');
  const [compagno, setCompagno] = useState('');
  const [guida, setGuida] = useState('');
  /*
   * Meteo, mare e visibilità sono i campi PIÙ adatti alla modifica in blocco.
   *
   * Non è un caso: sono le uniche cose che valgono davvero uguali per otto
   * immersioni di fila — un viaggio, una settimana, la stessa guida e lo stesso
   * mare. Compilarle una per una nella scheda è il lavoro che nessuno fa, ed è
   * il motivo per cui poi le tabelle delle condizioni restano vuote.
   */
  const [meteo, setMeteo] = useState<'' | '-' | Weather>('');
  const [mare, setMare] = useState<'' | '-' | Waves>('');
  const [visibilita, setVisibilita] = useState<string>('');
  /*
   * L'ATTREZZATURA IN BLOCCO, che è il modo in cui si compila davvero.
   *
   * Un viaggio sono otto immersioni con lo stesso GAV, gli stessi due
   * erogatori e la stessa muta. Compilarli uno per uno nella scheda è il
   * lavoro che nessuno fa — ed è il motivo per cui la colonna «Immersioni»
   * dell'inventario, quella che dice quante ne ha fatte un erogatore dall'ultima
   * revisione, resterebbe a zero per sempre.
   */
  const [attrezzi, setAttrezzi] = useState<DiveGear>({});
  const [piastra, setPiastra] = useState('');
  const [muta, setMuta] = useState('');
  const [zavorra, setZavorra] = useState('');
  const [salinita, setSalinita] = useState<'' | 'salt' | 'fresh'>('');
  const [etichetta, setEtichetta] = useState('');
  const [lavoro, setLavoro] = useState(false);
  const [fatto, setFatto] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const scelte = dives.filter((d) => ids.includes(d.id));
  /** Il trattino significa «svuota», e va scritto perché non è indovinabile. */
  const VUOTA = '-';
  const valore = (v: string): string | undefined | null =>
    v.trim() === '' ? null : v.trim() === VUOTA ? undefined : v.trim();

  const qualcosaDaFare =
    [sito, compagno, guida, muta, zavorra, etichetta].some((v) => v.trim() !== '') ||
    salinita !== '' ||
    meteo !== '' ||
    mare !== '' ||
    visibilita !== '' ||
    piastra.trim() !== '' ||
    Object.values(attrezzi).some((v) => v !== undefined);
  /*
   * La zavorra deve essere un numero, o niente.
   *
   * `Number('sei chili')` è `NaN`, e finiva in archivio: la scheda mostrava
   * «Zavorra NaN kg» e quelle immersioni sparivano dalla tabella della zavorra
   * in Attrezzatura — cioè proprio da quella che il suggerimento qui sotto
   * invita a popolare. Un valore non numerico non entra.
   */
  const zavorraRotta =
    zavorra.trim() !== '' && zavorra.trim() !== VUOTA && !Number.isFinite(Number(zavorra.replace(',', '.')));

  const applica = () => {
    void (async () => {
      setLavoro(true);
      setErrore(null);
      try {
        let toccate = 0;
        for (const d of scelte) {
          const next = { ...d };
          const s = valore(sito);
          if (s !== null) next.site = s === undefined ? undefined : { ...(d.site ?? {}), name: s };
          const c = valore(compagno);
          if (c !== null) next.buddy = c;
          const gu = valore(guida);
          if (gu !== null) next.guide = gu;
          /*
           * Le condizioni si scrivono nel campo NUOVO, e i tag vecchi che
           * dicevano la stessa cosa si tolgono.
           *
           * Se restassero, la stessa immersione direbbe due cose — «sereno» nel
           * campo e «pioggia» fra le etichette — e nessuno saprebbe quale delle
           * due l'app usa per contare. Vale solo quando si tocca qualcosa delle
           * condizioni: le altre immersioni non vanno riscritte per niente.
           */
          if (meteo !== '' || mare !== '') {
            const attuali = conditionsOf(d);
            const prossime: DiveConditions = {
              weather: meteo === '' ? attuali.weather : meteo === '-' ? undefined : meteo,
              waves: mare === '' ? attuali.waves : mare === '-' ? undefined : mare,
            };
            next.conditions = prossime.weather || prossime.waves ? prossime : {};
            next.tags = tagsSenzaCondizioni(next.tags);
          }
          /*
           * L'attrezzatura si scrive PEZZO PER PEZZO, non a blocco.
           *
           * Prendendo l'oggetto intero, scrivere il solo GAV cancellerebbe gli
           * erogatori già registrati su quelle immersioni — e la modifica in
           * blocco promette in testa alla carta di toccare solo i campi
           * compilati. Il trattino è l'unico modo di togliere qualcosa, ed è
           * scritto.
           */
          const prossimo: DiveGear = { ...(d.gear ?? {}) };
          let toccatoGear = false;
          const applica = <K extends 'bcd' | 'suit'>(k: K) => {
            const v = attrezzi[k];
            if (!v) return;
            toccatoGear = true;
            prossimo[k] = v.name === VUOTA ? undefined : v;
          };
          applica('bcd');
          applica('suit');
          if (attrezzi.suit) next.suit = attrezzi.suit.name === VUOTA ? undefined : attrezzi.suit.name;
          if (attrezzi.regulators) {
            toccatoGear = true;
            const puliti = attrezzi.regulators.filter((r) => r.name !== VUOTA);
            prossimo.regulators = puliti.length ? puliti : undefined;
          }
          const kg = valore(piastra);
          if (kg !== null) {
            toccatoGear = true;
            const n = kg === undefined ? undefined : Number(kg.replace(',', '.'));
            if (n === undefined || Number.isFinite(n)) prossimo.backplateKg = n;
          }
          if (toccatoGear) {
            next.gear = Object.values(prossimo).some((v) => v !== undefined) ? prossimo : undefined;
          }

          if (visibilita !== '') {
            if (visibilita === '-') {
              next.visibilityM = undefined;
              next.visibilityMaxM = undefined;
            } else {
              const f = FASCE_VISIBILITA[Number(visibilita)];
              if (f) {
                next.visibilityM = f.min;
                next.visibilityMaxM = f.max;
              }
            }
          }
          const m = valore(muta);
          if (m !== null) {
            next.suit = m;
            /*
             * La muta sta in DUE posti e vanno tenuti allineati.
             *
             * `suit` è la stringa che leggono le statistiche della zavorra e gli
             * export; `gear.suit` è il riferimento all'inventario. La scheda di
             * una immersione li scrive tutti e due, questa carta ne scriveva
             * uno: «svuota» lasciava la muta agganciata all'inventario — quindi
             * la tabella della zavorra continuava a raggrupparla come prima — e
             * cambiarla faceva mostrare alla scheda un nome e alle statistiche
             * un altro.
             */
            next.gear =
              m === undefined
                ? next.gear && { ...next.gear, suit: undefined }
                : { ...(next.gear ?? {}), suit: { name: m } };
          }
          const z = valore(zavorra);
          if (z !== null) {
            const n = z === undefined ? undefined : Number(z.replace(',', '.'));
            if (n === undefined || Number.isFinite(n)) next.weightKg = n;
          }
          if (salinita !== '') next.salinity = salinita;
          /*
           * Il trattino qui NON svuota tutte le etichette.
           *
           * La regola generale della carta è «`-` svuota», ma questo campo si
           * chiama «Aggiungi etichetta», e con un carattere cancellava anche
           * `nitrox` e `trimix` — messe dai parser, usate da ricerca e
           * statistiche — su tutte le immersioni selezionate, senza conferma e
           * senza modo di tornare indietro. Un campo che aggiunge, aggiunge.
           */
          const e = valore(etichetta);
          if (e !== null && e !== undefined && !next.tags.includes(e)) next.tags = [...next.tags, e];
          await saveDive(next);
          toccate++;
        }
        setFatto(`${toccate} ${t(toccate === 1 ? 'immersione aggiornata' : 'immersioni aggiornate')}.`);
        onDone();
      } catch (err) {
        setErrore(err instanceof Error ? err.message : String(err));
      } finally {
        setLavoro(false);
      }
    })();
  };

  /*
   * L'UNIONE C'È SOLO QUANDO LE SELEZIONATE SONO DUE, e non è una restrizione
   * arbitraria: fondere tre schede vuol dire decidere due volte quale resta, e
   * la seconda decisione la si prenderebbe su un'immersione che nel frattempo è
   * cambiata. Due alla volta è l'unico gesto che si può spiegare in una riga e
   * annullare in una.
   */
  const dueScelte = scelte.length === 2 ? ([scelte[0], scelte[1]] as const) : undefined;
  const unisci = () => {
    if (!dueScelte) return;
    void (async () => {
      setLavoro(true);
      setErrore(null);
      try {
        await unisciImmersioni([dueScelte[0].id, dueScelte[1].id]);
        setFatto(t('Unite: la scheda assorbita è nel cestino.'));
        onDone();
      } catch (err) {
        setErrore(err instanceof Error ? err.message : String(err));
      } finally {
        setLavoro(false);
      }
    })();
  };

  const cestina = () => {
    void (async () => {
      setLavoro(true);
      try {
        // Una chiamata sola con tutti gli id: `removeDive` in ciclo faceva
        // finire nel cestino solo l'ultima, e le altre da nessuna parte.
        await removeDives(ids);
        onDone();
      } catch (err) {
        setErrore(err instanceof Error ? err.message : String(err));
      } finally {
        setLavoro(false);
      }
    })();
  };

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>
            {imm(ids.length, t)} {t(ids.length === 1 ? 'selezionata' : 'selezionate')}
          </h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            <b>{t('Si scrivono solo i campi che compili.')}</b> {t('Scrivi')} <code>{VUOTA}</code>{' '}
            {t('per svuotare un campo su tutte.')}
          </p>
        </div>
        <button onClick={onDone}>{t('Deseleziona')}</button>
      </div>

      {nascoste > 0 && (
        <div className="notice" style={{ marginBottom: 10 }}>
          <b>
            {nascoste} {t(nascoste === 1 ? 'selezionata non è in elenco' : 'selezionate non sono in elenco')}
          </b>{' '}
          {t('I filtri le nascondono, ma verranno modificate anche loro.')}{' '}
          <button style={{ marginLeft: 6 }} onClick={onSoloVisibili}>
            {t('Tieni solo quelle visibili')}
          </button>
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: 8 }}>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Sito')}</span>
          <input type="text" value={sito} onChange={(e) => setSito(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Compagno')}</span>
          <input type="text" value={compagno} onChange={(e) => setCompagno(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Guida sub')}</span>
          <input type="text" value={guida} onChange={(e) => setGuida(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Acqua')}</span>
          <select value={salinita} onChange={(e) => setSalinita(e.target.value as '' | 'salt' | 'fresh')}>
            <option value="">{t('non toccare')}</option>
            <option value="salt">{t('salata')}</option>
            <option value="fresh">{t('dolce (lago)')}</option>
          </select>
        </label>
      </div>
      <div className="grid grid-3" style={{ marginBottom: 8 }}>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Muta')}</span>
          <input
            type="text"
            list="mute-in-inventario"
            value={muta}
            onChange={(e) => setMuta(e.target.value)}
          />
          {/*
           * Con l'elenco attaccato, non un selettore intero: la muta esiste già
           * come stringa in `Dive.suit`, la leggono le statistiche della zavorra
           * e gli export, e trasformarla qui in un riferimento all'inventario
           * significherebbe scrivere due campi con due semantiche diverse dallo
           * stesso posto. L'elenco basta a non riscriverla ogni volta in modo
           * leggermente diverso.
           */}
          <datalist id="mute-in-inventario">
            {gear.equipment
              .filter((a) => a.kind === 'suit' && !a.retired)
              .map((a) => (
                <option key={a.id} value={a.name} />
              ))}
          </datalist>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Meteo')}</span>
          <select value={meteo} onChange={(e) => setMeteo(e.target.value as '' | '-' | Weather)}>
            <option value="">{t('non toccare')}</option>
            <option value="-">{t('svuota')}</option>
            {/* `WEATHER_LABEL` è una costante di `core`: resta in italiano lì e
                si traduce qui, al disegno. */}
            {Object.entries(WEATHER_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Mare')}</span>
          <select value={mare} onChange={(e) => setMare(e.target.value as '' | '-' | Waves)}>
            <option value="">{t('non toccare')}</option>
            <option value="-">{t('svuota')}</option>
            {Object.entries(WAVES_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Visibilità')}</span>
          <select value={visibilita} onChange={(e) => setVisibilita(e.target.value)}>
            <option value="">{t('non toccare')}</option>
            <option value="-">{t('svuota')}</option>
            {FASCE_VISIBILITA.map((f, i) => (
              <option key={f.etichetta} value={i}>
                {t(f.etichetta)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/*
       * L'ATTREZZATURA, che è il posto in cui questa carta serve di più.
       *
       * Un viaggio sono otto immersioni con lo stesso GAV, gli stessi due
       * erogatori e la stessa muta: è qui che si compila, non una scheda per
       * volta. E senza questo, la colonna «Immersioni» dell'inventario — quante
       * ne ha fatte un erogatore dall'ultima revisione, cioè il numero per cui
       * l'inventario esiste — resterebbe a zero per sempre.
       */}
      <div className="finding-section-label">{t('Attrezzatura')}</div>
      <div className="grid grid-3" style={{ marginBottom: 8 }}>
        <ScegliAttrezzo
          kind="bcd"
          etichetta={t('GAV o sacco')}
          valore={attrezzi.bcd}
          attrezzi={gear.equipment}
          segnoDiSvuota={VUOTA}
          onChange={(v) => {
            setAttrezzi((a) => ({ ...a, bcd: v }));
            // La piastra del GAV scelto si propone anche qui, se il campo è
            // vuoto: è lo stesso automatismo della scheda di una immersione.
            const peso = pesoDelGav(gear.equipment.find((x) => x.id === v?.id));
            if (!piastra.trim() && peso !== undefined) setPiastra(String(peso));
          }}
          onAggiungiAllInventario={aggiungiAttrezzo}
        />
        <ScegliAttrezzo
          kind="regulator"
          etichetta={t('Erogatore principale')}
          valore={attrezzi.regulators?.[0]}
          attrezzi={gear.equipment}
          segnoDiSvuota={VUOTA}
          onChange={(v) =>
            setAttrezzi((a) => ({
              ...a,
              regulators: [v, a.regulators?.[1]].filter((x): x is GearRef => !!x),
            }))
          }
          onAggiungiAllInventario={aggiungiAttrezzo}
        />
        <ScegliAttrezzo
          kind="regulator"
          etichetta={t('Secondo erogatore')}
          valore={attrezzi.regulators?.[1]}
          attrezzi={gear.equipment}
          segnoDiSvuota={VUOTA}
          onChange={(v) =>
            setAttrezzi((a) => ({
              ...a,
              regulators: [a.regulators?.[0], v].filter((x): x is GearRef => !!x),
            }))
          }
          onAggiungiAllInventario={aggiungiAttrezzo}
        />
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Piastra o schienalino (kg)')}</span>
          <input
            type="text"
            inputMode="decimal"
            value={piastra}
            onChange={(e) => setPiastra(e.target.value)}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Zavorra (kg)')}</span>
          <input
            type="text"
            inputMode="decimal"
            value={zavorra}
            onChange={(e) => setZavorra(e.target.value)}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Aggiungi etichetta')}</span>
          <input type="text" value={etichetta} onChange={(e) => setEtichetta(e.target.value)} />
        </label>
      </div>

      {/* PERCHÉ QUESTA RIGA C'È. Muta, zavorra e attrezzatura sono i campi che
          nessun computer registra, e sono quelli da cui escono le due tabelle
          della scheda Attrezzatura: quale configurazione ti fa tenere meglio la
          quota, e quante immersioni ha fatto ogni erogatore dall'ultima
          revisione. Un viaggio sono otto immersioni con lo stesso GAV e gli
          stessi erogatori: se non si compilano in blocco quelle tabelle restano
          vuote per sempre, perché una scheda per volta non lo fa nessuno.
          All'utente serve sapere solo che qui conviene compilarli. */}
      <p className="planner-hint" style={{ marginTop: 0 }}>
        {t('Muta, zavorra e attrezzatura non le registra nessun computer: compilale qui, in un colpo solo.')}
      </p>

      {errore && (
        <div className="notice notice-error" role="alert" style={{ marginTop: 10 }}>
          {errore}
        </div>
      )}
      {fatto && (
        <div className="notice" role="status" style={{ marginTop: 10 }}>
          {fatto}
        </div>
      )}

      {/* Senza questo controllo `Number('sei chili')` finiva in archivio come
          `NaN`: la scheda mostrava «Zavorra NaN kg» e quelle immersioni
          sparivano dalla tabella della zavorra in Attrezzatura. */}
      {zavorraRotta && (
        <div className="notice notice-error" role="alert" style={{ marginTop: 10 }}>
          {t('La zavorra deve essere un numero:')} «{zavorra}» {t('non lo è.')}
        </div>
      )}

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn" disabled={!qualcosaDaFare || zavorraRotta || lavoro} onClick={applica}>
          {lavoro ? t('Salvataggio in corso…') : `${t('Applica a')} ${ids.length}`}
        </button>
        {/*
         * ► UNISCI DUE SCHEDE. ◄
         *
         * Serve quando la deduplica non ce l'ha fatta — due letture dello
         * stesso tuffo entrate separate perché gli orologi dei due computer non
         * erano allineati. Prima non c'era rimedio: restavano due righe per
         * sempre, e l'unica strada era cancellarne una buttando via i dati che
         * solo quella aveva.
         *
         * La domanda dice PERCHÉ una delle due sparisce e dove finisce, perché
         * un'unione che «perde» una riga senza spiegare dove sia andata è
         * indistinguibile da una cancellazione.
         */}
        {dueScelte && (
          <BottoneConferma
            disabled={lavoro}
            etichetta={t('Unisci le due')}
            conferma={t('Sì, uniscile')}
            domanda={
              <>
                {t(
                  'Diventano una scheda sola: resta quella col profilo più ricco e l’altra va nel cestino, da dove si rimette a posto in un gesto.',
                )}
              </>
            }
            onConferma={unisci}
          />
        )}
        <span style={{ flex: 1 }} />
        {/* `BottoneConferma` non traduce da sé: le sue etichette arrivano già
            tradotte da qui. */}
        <BottoneConferma
          disabled={lavoro}
          etichetta={t('Sposta nel cestino')}
          conferma={`${t('Sì, sposta')} ${ids.length === 1 ? t('l’immersione') : `${t('le')} ${ids.length}`}`}
          domanda={
            <>
              {t('Spostare')} {imm(ids.length, t)} {t('nel cestino?')}{' '}
              {t('Restano recuperabili per 30 giorni, finché non svuoti il cestino.')}
            </>
          }
          onConferma={cestina}
        />
      </div>
    </div>
  );
}
