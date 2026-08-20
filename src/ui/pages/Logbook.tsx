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
import { dateShort, FORMAT_LABEL, imm, timeShort } from '../format';
import { BottoneConferma } from '../components/Conferma';
import { ScegliAttrezzo, vocePerNome } from '../components/ScegliAttrezzo';
import { pesoDelGav, type EquipmentKind } from '../../core/analysis/gear';

type SortKey = 'date' | 'depth' | 'duration' | 'rmv';

export function Logbook({ onOpen }: { onOpen: (id: string) => void }) {
  const { dives } = useDiveLog();
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

  const sites = useMemo(
    () => [...new Set(dives.map((d) => d.site?.name).filter((s): s is string => !!s))].sort(),
    [dives],
  );

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

  if (dives.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <h2>Nessuna immersione in archivio</h2>
          <p className="secondary" style={{ maxWidth: 460, margin: '0 auto' }}>
            Importa un export dal tuo computer subacqueo per iniziare. Puoi caricare file da computer diversi:
            le immersioni doppie vengono riconosciute e unite.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <NextDive dives={dives} />

      <NewDive onDone={onOpen} />

      <div className="page-title-row">
        <h1 className="page-title">Logbook</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {filtered.length === dives.length
            ? imm(dives.length)
            : `${filtered.length} di ${imm(dives.length)}`}
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
          aria-label="Cerca fra le immersioni"
          placeholder="Cerca sito, compagno, note…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 200 }}
        />
        <label>
          Sito
          <select value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">tutti</option>
            {sites.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Oltre
          <select value={minDepth} onChange={(e) => setMinDepth(e.target.value)}>
            <option value="">qualsiasi profondità</option>
            <option value="18">18 m</option>
            <option value="30">30 m</option>
            <option value="40">40 m</option>
          </select>
        </label>
        <label>
          Ordina per
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="date">data</option>
            <option value="depth">profondità</option>
            <option value="duration">durata</option>
            <option value="rmv">consumo</option>
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
          nascoste={[...selezione].filter((id) => !filtered.some((d) => d.id === id)).length}
          onSoloVisibili={() =>
            setSelezione(new Set(filtered.filter((d) => selezione.has(d.id)).map((d) => d.id)))
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
                  aria-label="Seleziona tutte le immersioni mostrate"
                  checked={filtered.length > 0 && filtered.every((d) => selezione.has(d.id))}
                  ref={(el) => {
                    // Il trattino riguarda SOLO le righe mostrate: la condizione
                    // di prima era `selezione.size > 0`, quindi la casella diceva
                    // «alcune di queste» mentre la verità era «alcune altrove».
                    if (el) {
                      const scelte = filtered.filter((d) => selezione.has(d.id)).length;
                      el.indeterminate = scelte > 0 && scelte < filtered.length;
                    }
                  }}
                  onChange={(e) => {
                    // Aggiunge o toglie le righe MOSTRATE, senza toccare quello
                    // che è selezionato fuori dal filtro: prima spuntarla
                    // sostituiva l'intera selezione e toglierla la azzerava,
                    // buttando via scelte fatte con un filtro precedente.
                    const next = new Set(selezione);
                    for (const d of filtered) {
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
              <th>Data</th>
              <th>Sito</th>
              <th className="num">Max</th>
              <th className="num">Durata</th>
              <th className="num">Media</th>
              <th className="num">L/min</th>
              <th>Gas</th>
              <th>Origine</th>
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
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Nessuna immersione con questi filtri</div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                    {imm(dives.length)} in archivio: prova ad allargare la ricerca.
                  </div>
                  <button
                    className="btn"
                    onClick={() => {
                      setQuery('');
                      setSite('');
                      setMinDepth('');
                    }}
                  >
                    Azzera i filtri
                  </button>
                </td>
              </tr>
            )}
            {filtered.map((d) => (
              <tr key={d.id} className="clickable" onClick={() => onOpen(d.id)}>
                {/* `stopPropagation`: la riga apre l'immersione, la casella no. */}
                <td className="cella-scelta" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Seleziona l'immersione del ${dateShort(d.startTime, d.utcOffsetMinutes)}`}
                    checked={selezione.has(d.id)}
                    onChange={(e) => {
                      const next = new Set(selezione);
                      if (e.target.checked) next.add(d.id);
                      else next.delete(d.id);
                      setSelezione(next);
                    }}
                  />
                </td>
                <td className="num muted" data-col="n.">
                  {d.number ?? '—'}
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
                    {[d.buddy, d.mode !== 'oc' ? modeLabel(d) : null].filter(Boolean).join(' · ') || ' '}
                  </div>
                </td>
                <td className="num tabular" data-col="Max">
                  {d.maxDepth.toFixed(1)} m
                </td>
                <td className="num tabular" data-col="Durata">
                  {formatDuration(d.durationS)}
                </td>
                <td className="num tabular muted" data-col="Media">
                  {d.avgDepth?.toFixed(1) ?? '—'}
                </td>
                <td className="num tabular" data-col="L/min">
                  {d.metrics?.rmvLpm?.toFixed(1) ?? '—'}
                </td>
                <td className="muted" data-col="Gas">
                  {d.cylinders[0] ? mixName(d.cylinders[0].mix) : mixLabel(d)}
                </td>
                <td className="muted cella-origine" data-col="Origine" style={{ fontSize: 11 }}>
                  {/* Tutte le fonti, non solo la prima: un'immersione fusa da tre
                      file compariva come proveniente da una sola, e la scheda
                      dell'immersione diceva il contrario. */}
                  {[d.source, ...(d.extraSources ?? [])]
                    .map((src) => FORMAT_LABEL[src.format] ?? src.format)
                    .filter((label, i, all) => all.indexOf(label) === i)
                    .join(' + ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const briefing = useMemo(() => nextDiveBriefing(dives, undefined), [dives]);
  const urgent = briefing.notes.filter((n) => n.level === 'critical' || n.level === 'warning');
  const [open, setOpen] = useState(urgent.length > 0);

  const shown = open ? briefing.notes : urgent;
  if (!shown.length && !open) {
    return (
      <div className="card" style={{ paddingTop: 10, paddingBottom: 10 }}>
        <div className="spread">
          <span className="row" style={{ gap: 8 }}>
            <span className="dot dot-good" />
            <b>Prima della prossima</b>
            <span className="muted">niente in scadenza, niente in circolo</span>
          </span>
          <button style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setOpen(true)}>
            Apri
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0 }}>Prima della prossima immersione</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            Le cose che hanno una scadenza, in ordine di quanto stringe il tempo. Nessun semaforo complessivo:
            i fatti, e il giudizio a chi lo deve dare.
          </p>
        </div>
        <button style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setOpen((v) => !v)}>
          {open ? 'Riduci' : 'Apri tutto'}
        </button>
      </div>

      <div className="stack" style={{ gap: 8, marginTop: 12 }}>
        {shown.map((n) => (
          <NoteRow key={n.id} note={n} />
        ))}
      </div>

      {briefing.daysSinceLast !== undefined && (
        <p className="planner-hint" style={{ marginTop: 10 }}>
          Ultima immersione {briefing.daysSinceLast === 0 ? 'oggi' : `${briefing.daysSinceLast} giorni fa`}
          {briefing.residualN2Bar !== undefined && briefing.residualN2Bar > 0
            ? ` · azoto residuo +${briefing.residualN2Bar.toFixed(2)} bar`
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
  const { dives, saveDive, removeDives, gear, saveGear } = useDiveLog();
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
        setFatto(`${toccate} ${toccate === 1 ? 'immersione aggiornata' : 'immersioni aggiornate'}.`);
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
            {imm(ids.length)} {ids.length === 1 ? 'selezionata' : 'selezionate'}
          </h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            Vengono scritti <b>solo i campi che compili</b>: quelli lasciati vuoti restano come sono,
            immersione per immersione. Scrivi <code>{VUOTA}</code> per svuotare un campo su tutte.
          </p>
        </div>
        <button onClick={onDone}>Deseleziona</button>
      </div>

      {nascoste > 0 && (
        <div className="notice" style={{ marginBottom: 10 }}>
          <b>
            {nascoste}{' '}
            {nascoste === 1
              ? 'immersione selezionata non è mostrata'
              : 'immersioni selezionate non sono mostrate'}
          </b>{' '}
          dai filtri attuali. Applicando, verranno modificate anche quelle.{' '}
          <button style={{ marginLeft: 6 }} onClick={onSoloVisibili}>
            Tieni solo quelle visibili
          </button>
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: 8 }}>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Sito</span>
          <input type="text" value={sito} onChange={(e) => setSito(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Compagno</span>
          <input type="text" value={compagno} onChange={(e) => setCompagno(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Guida sub</span>
          <input type="text" value={guida} onChange={(e) => setGuida(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Acqua</span>
          <select value={salinita} onChange={(e) => setSalinita(e.target.value as '' | 'salt' | 'fresh')}>
            <option value="">non toccare</option>
            <option value="salt">salata</option>
            <option value="fresh">dolce (lago)</option>
          </select>
        </label>
      </div>
      <div className="grid grid-3" style={{ marginBottom: 8 }}>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Muta</span>
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
          <span className="muted">Meteo</span>
          <select value={meteo} onChange={(e) => setMeteo(e.target.value as '' | '-' | Weather)}>
            <option value="">non toccare</option>
            <option value="-">svuota</option>
            {Object.entries(WEATHER_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Mare</span>
          <select value={mare} onChange={(e) => setMare(e.target.value as '' | '-' | Waves)}>
            <option value="">non toccare</option>
            <option value="-">svuota</option>
            {Object.entries(WAVES_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Visibilità</span>
          <select value={visibilita} onChange={(e) => setVisibilita(e.target.value)}>
            <option value="">non toccare</option>
            <option value="-">svuota</option>
            {FASCE_VISIBILITA.map((f, i) => (
              <option key={f.etichetta} value={i}>
                {f.etichetta}
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
      <div className="finding-section-label">Attrezzatura</div>
      <div className="grid grid-3" style={{ marginBottom: 8 }}>
        <ScegliAttrezzo
          kind="bcd"
          etichetta="GAV o sacco"
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
          etichetta="Erogatore principale"
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
          etichetta="Secondo erogatore"
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
          <span className="muted">Piastra o schienalino (kg)</span>
          <input
            type="text"
            inputMode="decimal"
            value={piastra}
            onChange={(e) => setPiastra(e.target.value)}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Zavorra (kg)</span>
          <input
            type="text"
            inputMode="decimal"
            value={zavorra}
            onChange={(e) => setZavorra(e.target.value)}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Aggiungi etichetta</span>
          <input type="text" value={etichetta} onChange={(e) => setEtichetta(e.target.value)} />
        </label>
      </div>

      {/* Muta e zavorra insieme non sono un dettaglio: sono i due campi da cui
          la scheda Attrezzatura ricava quale configurazione ti fa tenere meglio
          la quota, e sono anche i due che i computer non registrano mai. */}
      <p className="planner-hint" style={{ marginTop: 0 }}>
        Muta, zavorra e attrezzatura sono i campi che nessun computer registra, e sono proprio quelli da cui
        escono le due tabelle di <b>Attrezzatura</b>: quale configurazione ti fa tenere meglio la quota, e
        quante immersioni ha fatto ogni erogatore dall'ultima revisione. Un viaggio sono otto immersioni con
        lo stesso GAV e gli stessi erogatori: compilarle qui in un colpo è il modo in cui quelle tabelle si
        riempiono davvero — una scheda per volta non lo fa nessuno.
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

      {zavorraRotta && (
        <div className="notice notice-error" role="alert" style={{ marginTop: 10 }}>
          La zavorra deve essere un numero: «{zavorra}» non lo è. Senza questo controllo finiva in archivio
          come <code>NaN</code>, e quelle immersioni sparivano dalla tabella della zavorra.
        </div>
      )}

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn" disabled={!qualcosaDaFare || zavorraRotta || lavoro} onClick={applica}>
          {lavoro ? 'Scrivo…' : `Applica a ${ids.length}`}
        </button>
        <span style={{ flex: 1 }} />
        <BottoneConferma
          disabled={lavoro}
          etichetta="Sposta nel cestino"
          conferma={`Sì, sposta ${ids.length === 1 ? "l'immersione" : `le ${ids.length}`}`}
          domanda={
            <>
              Spostare {imm(ids.length)} {ids.length === 1 ? 'immersione' : 'immersioni'} nel cestino? Restano
              recuperabili per 30 giorni: la cancellazione diventa definitiva solo svuotando il cestino.
            </>
          }
          onConferma={cestina}
        />
      </div>
    </div>
  );
}
