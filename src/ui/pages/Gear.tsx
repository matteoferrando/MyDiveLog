/**
 * Attrezzatura e scadenze.
 *
 * L'unica pagina dell'app in cui i dati si inseriscono a mano invece di arrivare
 * da un computer, e l'unica che guarda avanti invece che indietro: un collaudo
 * scaduto ferma la ricarica prima ancora che l'immersione cominci.
 */

import { useState } from 'react';
import {
  GEAR_LABEL,
  SUGGESTED_INTERVAL_MONTHS,
  gearChecks,
  gearSummary,
  type GearItem,
  type GearKind,
  type GearStatus,
} from '../../core/analysis/gear';
import { StatTile } from '../components/Charts';
import { dateShort } from '../format';
import { useDiveLog } from '../state';

const STATUS_TEXT: Record<GearStatus, string> = {
  expired: 'Scaduto',
  due: 'In scadenza',
  ok: 'A posto',
  unknown: 'Nessuna data',
};

const STATUS_DOT: Record<GearStatus, string> = {
  expired: 'dot-critical',
  due: 'dot-warning',
  ok: 'dot-good',
  unknown: '',
};

export function Gear() {
  const { gear, saveGear, dives } = useDiveLog();
  const [draft, setDraft] = useState<GearItem | null>(null);

  const checks = gearChecks(gear);
  const summary = gearSummary(gear);

  const upsert = (item: GearItem) => {
    const next = gear.some((g) => g.id === item.id)
      ? gear.map((g) => (g.id === item.id ? item : g))
      : [...gear, item];
    void saveGear(next);
    setDraft(null);
  };

  const remove = (id: string) => void saveGear(gear.filter((g) => g.id !== id));

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">Attrezzatura</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {gear.length} pezzi registrati · le date le scrivi tu, l'app calcola solo le scadenze
        </span>
      </div>

      {gear.length > 0 && (
        <div className="grid grid-tiles">
          <StatTile
            label="Scaduti"
            value={
              <span className="tabular" style={{ color: summary.expired ? 'var(--critical)' : undefined }}>
                {summary.expired}
              </span>
            }
            note={summary.next?.dueDate ? `il primo era il ${dateShort(summary.next.dueDate)}` : 'nessuno'}
          />
          <StatTile
            label="In scadenza"
            value={
              <span className="tabular" style={{ color: summary.due ? 'var(--warning)' : undefined }}>
                {summary.due}
              </span>
            }
            note="entro due mesi"
          />
          <StatTile
            label="Senza data"
            value={<span className="tabular">{summary.unknown}</span>}
            note="non sono a posto: sono sconosciuti"
          />
          <StatTile
            label="Prossima immersione"
            value={<span className="tabular">{dives.length ? '—' : '—'}</span>}
            note={
              summary.next?.dueDate
                ? `prima controlla: ${summary.next.item.name}`
                : 'niente in scadenza da controllare'
            }
          />
        </div>
      )}

      <div className="card">
        <div className="page-title-row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Il tuo materiale</h2>
          <button
            className="btn btn-primary"
            onClick={() =>
              setDraft({
                id: `g${Date.now().toString(36)}`,
                kind: 'regulator',
                name: '',
                intervalMonths: SUGGESTED_INTERVAL_MONTHS.regulator,
              })
            }
          >
            Aggiungi
          </button>
        </div>

        {gear.length === 0 && !draft && (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Bombole, erogatori, brevetti, certificato medico, assicurazione. Servono due date: quando è
            stata fatta l'ultima revisione e ogni quanti mesi va rifatta — oppure direttamente la
            scadenza, per i documenti. Gli intervalli proposti sono quelli comuni in Italia, non una
            regola: quanto duri una revisione lo decide il costruttore o la normativa.
          </p>
        )}

        {checks.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pezzo</th>
                  <th>Tipo</th>
                  <th>Ultima revisione</th>
                  <th>Scade</th>
                  <th style={{ textAlign: 'right' }}>Stato</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {checks.map(({ item, status, dueDate, daysLeft }) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ fontWeight: 550 }}>{item.name || '(senza nome)'}</div>
                      {item.serial && (
                        <div className="muted" style={{ fontSize: 11 }}>
                          matricola {item.serial}
                        </div>
                      )}
                    </td>
                    <td className="muted">{GEAR_LABEL[item.kind]}</td>
                    <td className="tabular muted">
                      {item.lastServiceDate ? dateShort(item.lastServiceDate) : '—'}
                    </td>
                    <td className="tabular">
                      {dueDate ? dateShort(dueDate) : '—'}
                      {daysLeft !== undefined && (
                        <div className="muted" style={{ fontSize: 11 }}>
                          {daysLeft < 0 ? `${-daysLeft} giorni fa` : `fra ${daysLeft} giorni`}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <span className={`dot ${STATUS_DOT[status]}`} />
                        {STATUS_TEXT[status]}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setDraft(item)}>
                        Modifica
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {draft && <GearForm item={draft} onSave={upsert} onCancel={() => setDraft(null)} onDelete={remove} />}
      </div>

      <div className="card">
        <h2>Come funzionano le scadenze</h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)' }}>
          <li>
            Una scadenza si può dare in due modi: <b>ultima revisione + intervallo</b>, che è come
            funzionano bombole ed erogatori, oppure <b>data di scadenza</b>, che è come funzionano
            documenti e certificati. Se ci sono entrambe vince la data esplicita.
          </li>
          <li>
            Gli intervalli proposti — 24 mesi per il collaudo delle bombole, 12 per la revisione degli
            erogatori — sono i valori comuni in Italia e vanno verificati: la normativa cambia da paese
            a paese e i costruttori hanno indicazioni proprie.
          </li>
          <li>
            Un pezzo senza date non è un pezzo a posto: resta in elenco come «nessuna data», perché
            un'informazione che manca non è una buona notizia.
          </li>
        </ul>
      </div>
    </div>
  );
}

function GearForm({
  item,
  onSave,
  onCancel,
  onDelete,
}: {
  item: GearItem;
  onSave: (item: GearItem) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState(item);
  const set = <K extends keyof GearItem>(key: K, value: GearItem[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="card" style={{ marginTop: 14, background: 'var(--surface-2)' }}>
      <div className="grid grid-3" style={{ gap: 10 }}>
        <label className="planner-field">
          <span className="planner-label">Tipo</span>
          <select
            value={draft.kind}
            onChange={(e) => {
              const kind = e.target.value as GearKind;
              setDraft((d) => ({
                ...d,
                kind,
                // L'intervallo proposto segue il tipo, finché non lo si tocca.
                intervalMonths: SUGGESTED_INTERVAL_MONTHS[kind] ?? d.intervalMonths,
              }));
            }}
          >
            {(Object.keys(GEAR_LABEL) as GearKind[]).map((k) => (
              <option key={k} value={k}>
                {GEAR_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="planner-field">
          <span className="planner-label">Nome</span>
          <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="D12 acciaio" />
        </label>
        <label className="planner-field">
          <span className="planner-label">Matricola</span>
          <input value={draft.serial ?? ''} onChange={(e) => set('serial', e.target.value || undefined)} />
        </label>
        <label className="planner-field">
          <span className="planner-label">Ultima revisione</span>
          <input
            type="date"
            value={draft.lastServiceDate ?? ''}
            onChange={(e) => set('lastServiceDate', e.target.value || undefined)}
          />
        </label>
        <label className="planner-field">
          <span className="planner-label">
            Intervallo <span className="muted">(mesi)</span>
          </span>
          <input
            type="number"
            min={0}
            max={120}
            value={draft.intervalMonths ?? 0}
            onChange={(e) => set('intervalMonths', Number(e.target.value) || undefined)}
          />
          <span className="planner-hint">Zero: non scade a intervalli.</span>
        </label>
        <label className="planner-field">
          <span className="planner-label">Oppure scade il</span>
          <input
            type="date"
            value={draft.expiresOn ?? ''}
            onChange={(e) => set('expiresOn', e.target.value || undefined)}
          />
          <span className="planner-hint">Per documenti e certificati. Vince sull'intervallo.</span>
        </label>
      </div>
      <label className="planner-field" style={{ marginTop: 10 }}>
        <span className="planner-label">Note</span>
        <input value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value || undefined)} />
      </label>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={() => onSave(draft)} disabled={!draft.name.trim()}>
          Salva
        </button>
        <button onClick={onCancel}>Annulla</button>
        <span style={{ flex: 1 }} />
        <button onClick={() => onDelete(draft.id)} style={{ color: 'var(--critical)' }}>
          Elimina
        </button>
      </div>
    </div>
  );
}
