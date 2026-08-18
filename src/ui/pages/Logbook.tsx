import { useMemo, useState } from 'react';
import { formatDuration, mixName } from '../../core/units';
import { mixLabel, modeLabel } from '../../core/analysis/aggregate';
import { nextDiveBriefing, type NextDiveNote } from '../../core/analysis/nextDive';
import type { Dive } from '../../core/model';
import { NewDive } from '../components/NewDive';
import { useDiveLog } from '../state';
import { dateShort, FORMAT_LABEL, imm, timeShort } from '../format';

type SortKey = 'date' | 'depth' | 'duration' | 'rmv';

export function Logbook({ onOpen }: { onOpen: (id: string) => void }) {
  const { dives } = useDiveLog();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('date');
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
      return [d.site?.name, d.buddy, d.notes, d.computer?.model, ...d.tags]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    const by: Record<SortKey, (a: typeof out[0], b: typeof out[0]) => number> = {
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
            Importa un export dal tuo computer subacqueo per iniziare. Puoi caricare file da computer
            diversi: le immersioni doppie vengono riconosciute e unite.
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
        <input
          type="search"
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

      <div className="card table-scroll" style={{ padding: '4px 18px 8px' }}>
        <table>
          <thead>
            <tr>
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
                <td colSpan={9} style={{ padding: '28px 4px', textAlign: 'center' }}>
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
                <td className="num muted">{d.number ?? '—'}</td>
                <td>
                  <div>{dateShort(d.startTime, d.utcOffsetMinutes)}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {timeShort(d.startTime, d.utcOffsetMinutes)}
                  </div>
                </td>
                <td>
                  <div style={{ fontWeight: 550 }}>{d.site?.name ?? '—'}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {[d.buddy, d.mode !== 'oc' ? modeLabel(d) : null].filter(Boolean).join(' · ') || ' '}
                  </div>
                </td>
                <td className="num tabular">{d.maxDepth.toFixed(1)}</td>
                <td className="num tabular">{formatDuration(d.durationS)}</td>
                <td className="num tabular muted">{d.avgDepth?.toFixed(1) ?? '—'}</td>
                <td className="num tabular">{d.metrics?.rmvLpm?.toFixed(1) ?? '—'}</td>
                <td className="muted">{d.cylinders[0] ? mixName(d.cylinders[0].mix) : mixLabel(d)}</td>
                <td className="muted" style={{ fontSize: 11 }}>
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
            Le cose che hanno una scadenza, in ordine di quanto stringe il tempo. Nessun semaforo
            complessivo: i fatti, e il giudizio a chi lo deve dare.
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
