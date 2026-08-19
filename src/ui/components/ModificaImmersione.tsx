/**
 * Tutto quello che il computer non sa, e che sai solo tu.
 *
 * PERCHÉ È UNA SCHEDA GRANDE E NON QUATTRO CAMPI. Il computer subacqueo misura
 * profondità, tempo e temperatura, e su quello non si discute. Tutto il resto —
 * con chi eri, che muta avevi, quanti chili, che visibilità c'era, con che
 * erogatore — non lo misura nessuno: o lo scrivi, o quell'immersione fra tre
 * anni è una curva senza storia. E siccome scriverlo costa fatica, la scheda
 * deve chiedere il meno possibile e ricordarsi il più possibile: l'attrezzatura
 * si sceglie da un elenco che si costruisce da solo mentre la usi, la sigla
 * della bombola si traduce in litri da sé, le condizioni sono a tendina.
 *
 * PERCHÉ L'ATTREZZATURA È AGGANCIATA ALL'INVENTARIO E NON SCRITTA A MANO.
 * Perché la domanda che conta non è «cosa avevo addosso quel giorno» — quella
 * la ricordi — ma «quante immersioni ha questo erogatore dall'ultima
 * revisione», che nessuno riesce a contare a mano e che l'app può contare solo
 * se le due cose sono la stessa voce. Scrivendo il nome ogni volta, «Apeks
 * XTX50» e «apeks xtx 50» diventano due erogatori diversi e il conto non torna
 * più.
 *
 * Ma l'aggancio non basta da solo: ogni voce porta con sé ANCHE il nome, così
 * l'immersione del 2023 continua a dire con che erogatore l'hai fatta anche
 * quando quell'erogatore è stato venduto e cancellato dall'inventario. Vedi
 * `GearRef` in `model.ts`.
 */

import { useState } from 'react';
import {
  TYPICAL_SERVICE,
  type Equipment,
  type EquipmentKind,
  type GearArchive,
} from '../../core/analysis/gear';
import {
  FASCE_VISIBILITA,
  WAVES_LABEL,
  WEATHER_LABEL,
  conditionsOf,
  tagsSenzaCondizioni,
} from '../../core/conditions';
import { parseCylinderSpec } from '../../core/cylinders';
import type { Cylinder, Dive, DiveGear, GearRef, Waves, Weather } from '../../core/model';
import { BottoneConferma } from './Conferma';

const nuovoId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Un numero da un campo di testo, dove vuoto è «non lo so» e non zero. */
const numero = (v: string): number | undefined => {
  const t = v.trim().replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

// ---------------------------------------------------------------------------

/**
 * Il selettore di un pezzo di attrezzatura: scegli dall'elenco, o scrivi.
 *
 * Un campo di testo con l'elenco attaccato, e non una tendina, per una ragione
 * pratica: la tendina obbliga a mettere in inventario un attrezzo PRIMA di
 * poterlo usare, cioè a interrompere la compilazione della scheda, andare in
 * un'altra pagina, tornare. Qui si scrive il nome e basta; se è nuovo, compare
 * un pulsante che lo mette in inventario senza spostarsi da qui, e se non lo si
 * preme il nome resta comunque sull'immersione.
 *
 * Il riconoscimento è senza maiuscole e senza spazi ai bordi, così «apeks
 * xtx50» ritrova «Apeks XTX50» invece di crearne un secondo.
 */
function ScegliAttrezzo({
  kind,
  etichetta,
  valore,
  attrezzi,
  onChange,
  onAggiungiAllInventario,
}: {
  kind: EquipmentKind;
  etichetta: string;
  valore: GearRef | undefined;
  attrezzi: Equipment[];
  onChange: (v: GearRef | undefined) => void;
  onAggiungiAllInventario: (kind: EquipmentKind, name: string) => string;
}) {
  const disponibili = attrezzi.filter((a) => a.kind === kind && !a.retired);
  const listId = `attrezzi-${kind}-${etichetta.replace(/\W+/g, '')}`;
  const testo = valore?.name ?? '';
  const combacia = disponibili.find((a) => a.name.trim().toLowerCase() === testo.trim().toLowerCase());
  const nuovo = testo.trim().length > 0 && !combacia;

  return (
    <label className="stack" style={{ gap: 4, fontSize: 12 }}>
      <span className="muted">{etichetta}</span>
      <input
        type="text"
        list={listId}
        placeholder={disponibili.length ? 'scegli o scrivi' : 'scrivi il nome'}
        value={testo}
        onChange={(e) => {
          const name = e.target.value;
          if (!name.trim()) return onChange(undefined);
          const trovato = disponibili.find((a) => a.name.trim().toLowerCase() === name.trim().toLowerCase());
          onChange({ id: trovato?.id, name });
        }}
      />
      <datalist id={listId}>
        {disponibili.map((a) => (
          <option key={a.id} value={a.name} />
        ))}
      </datalist>
      {nuovo && (
        <button
          type="button"
          className="btn btn-small"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            const id = onAggiungiAllInventario(kind, testo.trim());
            onChange({ id, name: testo.trim() });
          }}
        >
          ＋ metti «{testo.trim()}» in attrezzatura
        </button>
      )}
      {combacia && (
        <span className="muted" style={{ fontSize: 11 }}>
          in inventario{combacia.serial ? ` · matricola ${combacia.serial}` : ''}
        </span>
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------

/** Una bombola, con la sigla che si traduce in litri da sé. */
function RigaBombola({
  c,
  onChange,
  onRimuovi,
}: {
  c: Cylinder;
  onChange: (patch: Partial<Cylinder>) => void;
  onRimuovi: () => void;
}) {
  const [notaSigla, setNotaSigla] = useState<string>('');

  /*
   * La sigla si traduce quando la scrivi, e la traduzione si VEDE.
   *
   * Riempire i litri in silenzio sarebbe peggio che non riempirli: chi scrive
   * «S80» non ha modo di accorgersi se l'app ha capito 11,1 o 10,9, e quella
   * differenza si porta dietro ogni consumo calcolato su quella immersione.
   * Quindi il campo dei litri resta scrivibile e la nota dice da dove viene il
   * numero — dato di targa o formula.
   */
  const traduci = (descrizione: string) => {
    const spec = parseCylinderSpec(descrizione);
    if (!spec) {
      setNotaSigla('');
      return;
    }
    setNotaSigla(spec.note);
    onChange({
      description: descrizione,
      sizeL: spec.sizeL,
      workPressureBar: spec.workPressureBar ?? c.workPressureBar,
      material: spec.material ?? c.material,
    });
  };

  return (
    <div className="card" style={{ padding: 12, marginBottom: 10 }}>
      {/*
       * Una griglia sola con sette celle, non tre più un annidamento.
       *
       * Mettendo «inizio» e «fine» dentro una riga dentro una cella, la colonna
       * si impila e le altre due restano vuote: campi che dovrebbero stare
       * affiancati finiscono uno sotto l'altro con del bianco accanto. Le celle
       * sono tutte allo stesso livello e si dispongono da sole.
       */}
      <div className="grid" style={{ gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Sigla o descrizione</span>
          <input
            type="text"
            placeholder="S80, D12, 15 L…"
            value={c.description ?? ''}
            onChange={(e) => onChange({ description: e.target.value })}
            onBlur={(e) => traduci(e.target.value)}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Litri d'acqua</span>
          <input
            type="number"
            step="0.1"
            value={c.sizeL ?? ''}
            onChange={(e) => onChange({ sizeL: numero(e.target.value) })}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Materiale</span>
          <select
            value={c.material ?? ''}
            onChange={(e) => onChange({ material: (e.target.value || undefined) as Cylinder['material'] })}
          >
            <option value="">non so</option>
            <option value="steel">acciaio</option>
            <option value="alu">alluminio</option>
            <option value="carbon">carbonio</option>
          </select>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Ossigeno %</span>
          <input
            type="number"
            step="1"
            value={Math.round(c.mix.o2 * 100) || ''}
            onChange={(e) => {
              const v = numero(e.target.value);
              onChange({ mix: { ...c.mix, o2: v === undefined ? 0.21 : v / 100 } });
            }}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Elio %</span>
          <input
            type="number"
            step="1"
            value={Math.round(c.mix.he * 100) || ''}
            onChange={(e) => {
              const v = numero(e.target.value);
              onChange({ mix: { ...c.mix, he: v === undefined ? 0 : v / 100 } });
            }}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Inizio (bar)</span>
          <input
            type="number"
            value={c.startBar ?? ''}
            onChange={(e) => onChange({ startBar: numero(e.target.value) })}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Fine (bar)</span>
          <input
            type="number"
            value={c.endBar ?? ''}
            onChange={(e) => onChange({ endBar: numero(e.target.value) })}
          />
        </label>
      </div>
      {notaSigla && (
        <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
          {notaSigla}
        </p>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <span className="topbar-spacer" />
        <button type="button" className="btn btn-small" onClick={onRimuovi}>
          Togli questa bombola
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ModificaImmersione({
  dive,
  gear,
  onSalvaAttrezzatura,
  onSave,
  onDelete,
}: {
  dive: Dive;
  gear: GearArchive;
  onSalvaAttrezzatura: (archivio: GearArchive) => Promise<void>;
  onSave: (d: Dive) => Promise<void>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Dive>(dive);
  const [saved, setSaved] = useState(false);
  /*
   * L'inventario si aggiorna in locale mentre si compila.
   *
   * `saveGear` è asincrono e passa dallo storage: aspettarlo prima di mostrare
   * il nuovo attrezzo nell'elenco farebbe sparire e ricomparire la voce appena
   * aggiunta. Si tiene la copia locale, si salva sullo sfondo.
   */
  const [attrezzi, setAttrezzi] = useState<Equipment[]>(gear.equipment);

  const tocca = (patch: Partial<Dive>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };

  const toccaGear = (patch: Partial<DiveGear>) => {
    setDraft((d) => ({ ...d, gear: { ...(d.gear ?? {}), ...patch } }));
    setSaved(false);
  };

  const condizioni = conditionsOf(draft);

  const aggiungiAllInventario = (kind: EquipmentKind, name: string): string => {
    const voce: Equipment = { id: nuovoId(), kind, name, service: TYPICAL_SERVICE[kind] };
    const prossimo = [...attrezzi, voce];
    setAttrezzi(prossimo);
    void onSalvaAttrezzatura({ ...gear, equipment: prossimo });
    return voce.id;
  };

  const erogatori = draft.gear?.regulators ?? [];
  const setErogatore = (i: number, v: GearRef | undefined) => {
    const prossimi = [...erogatori];
    if (v) prossimi[i] = v;
    else prossimi.splice(i, 1);
    toccaGear({ regulators: prossimi.filter(Boolean) });
  };

  const salva = () => {
    /*
     * Salvando si passa alla forma nuova delle condizioni, e i tag vecchi si
     * tolgono. Se restassero, la stessa immersione direbbe due cose — «sereno»
     * nel campo e «pioggia» fra le etichette — e nessuno saprebbe quale delle
     * due l'app usa per contare.
     */
    const pulita: Dive = {
      ...draft,
      conditions: condizioni.weather || condizioni.waves ? condizioni : undefined,
      tags: tagsSenzaCondizioni(draft.tags ?? []),
    };
    void onSave(pulita).then(() => {
      setDraft(pulita);
      setSaved(true);
    });
  };

  return (
    <div className="card">
      <h2>Modifica dati</h2>
      <p className="card-sub">
        Quello che il computer non misura: lo scrivi una volta e resta. Salvando, le metriche vengono
        ricalcolate, e un import successivo <b>non sovrascrive</b> i campi che compili qui.
      </p>

      {/* ------------------------------------------------------ l'immersione */}
      <div className="finding-section-label">L'immersione</div>
      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Titolo</span>
          <input
            type="text"
            placeholder="notturna al relitto"
            value={draft.title ?? ''}
            onChange={(e) => tocca({ title: e.target.value || undefined })}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Sito</span>
          <input
            type="text"
            value={draft.site?.name ?? ''}
            onChange={(e) => tocca({ site: { ...(draft.site ?? { name: '' }), name: e.target.value } })}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Valutazione</span>
          <select value={draft.rating ?? ''} onChange={(e) => tocca({ rating: numero(e.target.value) })}>
            <option value="">non data</option>
            <option value="1">★ — da dimenticare</option>
            <option value="2">★★</option>
            <option value="3">★★★ — normale</option>
            <option value="4">★★★★</option>
            <option value="5">★★★★★ — di quelle che si raccontano</option>
          </select>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Compagno</span>
          <input
            type="text"
            value={draft.buddy ?? ''}
            onChange={(e) => tocca({ buddy: e.target.value || undefined })}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Guida sub</span>
          <input
            type="text"
            placeholder="chi vi ha portati"
            value={draft.guide ?? ''}
            onChange={(e) => tocca({ guide: e.target.value || undefined })}
          />
        </label>
      </div>
      <p className="muted" style={{ fontSize: 11, margin: '0 0 14px' }}>
        Compagno e guida stanno in due campi perché sono due domande diverse: «con chi mi immergo di solito» e
        «chi mi ha portato». Nello stesso campo non se ne può contare nessuna delle due.
      </p>

      {/* -------------------------------------------------------- condizioni */}
      <div className="finding-section-label">Condizioni</div>
      <div className="grid grid-3" style={{ marginBottom: 14 }}>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Meteo</span>
          <select
            value={condizioni.weather ?? ''}
            onChange={(e) =>
              tocca({ conditions: { ...condizioni, weather: (e.target.value || undefined) as Weather } })
            }
          >
            <option value="">non registrato</option>
            {Object.entries(WEATHER_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Mare</span>
          <select
            value={condizioni.waves ?? ''}
            onChange={(e) =>
              tocca({ conditions: { ...condizioni, waves: (e.target.value || undefined) as Waves } })
            }
          >
            <option value="">non registrato</option>
            {Object.entries(WAVES_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Acqua</span>
          <select
            value={draft.salinity ?? 'salt'}
            onChange={(e) => tocca({ salinity: e.target.value as 'salt' | 'fresh' })}
          >
            <option value="salt">salata</option>
            <option value="fresh">dolce (lago)</option>
          </select>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Visibilità</span>
          <select
            value={
              FASCE_VISIBILITA.findIndex(
                (f) => f.min === draft.visibilityM && f.max === draft.visibilityMaxM,
              ) ?? -1
            }
            onChange={(e) => {
              const i = Number(e.target.value);
              const f = FASCE_VISIBILITA[i];
              tocca(
                f
                  ? { visibilityM: f.min, visibilityMaxM: f.max }
                  : { visibilityM: undefined, visibilityMaxM: undefined },
              );
            }}
          >
            <option value={-1}>
              {draft.visibilityM !== undefined && draft.visibilityMaxM === undefined
                ? `${draft.visibilityM} m (dal computer o dal file)`
                : 'non registrata'}
            </option>
            {FASCE_VISIBILITA.map((f, i) => (
              <option key={f.etichetta} value={i}>
                {f.etichetta}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ----------------------------------------------------------- bombole */}
      <div className="finding-section-label">Bombole</div>
      <p className="muted" style={{ fontSize: 11, margin: '0 0 10px' }}>
        Scrivendo una sigla — <b>S80</b>, <b>S40</b>, <b>D12</b> — i litri si compilano da soli quando esci
        dal campo, e la riga sotto dice da dove viene il numero. Il volume che serve all'aritmetica del gas è
        quello d'<em>acqua</em>: l'80 nel nome sono piedi cubi di gas, non litri.
      </p>
      {draft.cylinders.map((c, i) => (
        <RigaBombola
          key={i}
          c={c}
          onChange={(patch) =>
            tocca({ cylinders: draft.cylinders.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) })
          }
          onRimuovi={() => tocca({ cylinders: draft.cylinders.filter((_, idx) => idx !== i) })}
        />
      ))}
      <button
        type="button"
        className="btn btn-small"
        style={{ marginBottom: 14 }}
        onClick={() => tocca({ cylinders: [...draft.cylinders, { mix: { o2: 0.21, he: 0 } }] })}
      >
        ＋ Aggiungi una bombola
      </button>

      {/* ------------------------------------------------------ attrezzatura */}
      <div className="finding-section-label">Attrezzatura</div>
      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <ScegliAttrezzo
          kind="suit"
          etichetta="Muta"
          valore={draft.gear?.suit ?? (draft.suit ? { name: draft.suit } : undefined)}
          attrezzi={attrezzi}
          onChange={(v) => {
            toccaGear({ suit: v });
            // `suit` resta la fonte di verità per la tabella della zavorra e per
            // gli export: il riferimento all'inventario si aggiunge, non sostituisce.
            tocca({ suit: v?.name });
          }}
          onAggiungiAllInventario={aggiungiAllInventario}
        />
        <ScegliAttrezzo
          kind="bcd"
          etichetta="GAV o sacco"
          valore={draft.gear?.bcd}
          attrezzi={attrezzi}
          onChange={(v) => toccaGear({ bcd: v })}
          onAggiungiAllInventario={aggiungiAllInventario}
        />
        <ScegliAttrezzo
          kind="regulator"
          etichetta="Erogatore principale"
          valore={erogatori[0]}
          attrezzi={attrezzi}
          onChange={(v) => setErogatore(0, v)}
          onAggiungiAllInventario={aggiungiAllInventario}
        />
        <ScegliAttrezzo
          kind="regulator"
          etichetta="Secondo erogatore"
          valore={erogatori[1]}
          attrezzi={attrezzi}
          onChange={(v) => setErogatore(1, v)}
          onAggiungiAllInventario={aggiungiAllInventario}
        />
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Zavorra (kg)</span>
          <input
            type="number"
            step="0.5"
            value={draft.weightKg ?? ''}
            onChange={(e) => tocca({ weightKg: numero(e.target.value) })}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">Piastra o schienalino (kg)</span>
          <input
            type="number"
            step="0.1"
            placeholder="0"
            value={draft.gear?.backplateKg ?? ''}
            onChange={(e) => toccaGear({ backplateKg: numero(e.target.value) })}
          />
        </label>
      </div>
      <p className="muted" style={{ fontSize: 11, margin: '0 0 14px' }}>
        {(() => {
          const totale = (draft.weightKg ?? 0) + (draft.gear?.backplateKg ?? 0);
          return draft.gear?.backplateKg
            ? `Peso totale che ti tira giù: ${Math.round(totale * 10) / 10} kg. È questo — non la sola zavorra — che entra nella tabella per muta: una piastra d'acciaio da 3 kg su «2 kg di zavorra» fanno cinque.`
            : 'La piastra va in un campo suo perché non la cambi mai, mentre la zavorra la cambi a ogni immersione. Per l’assetto contano insieme, e l’app le somma.';
        })()}
      </p>

      {/* -------------------------------------------------------------- note */}
      <label className="stack" style={{ gap: 4, fontSize: 12, marginBottom: 14 }}>
        <span className="muted">Note</span>
        <textarea
          rows={5}
          placeholder="cosa hai visto, cosa è andato storto, cosa cambieresti"
          value={draft.notes ?? ''}
          onChange={(e) => tocca({ notes: e.target.value })}
        />
      </label>

      <div className="row">
        <button className="btn btn-primary" onClick={salva}>
          Salva
        </button>
        {saved && (
          <span className="muted" style={{ fontSize: 12 }}>
            Salvato e metriche ricalcolate.
          </span>
        )}
        <span className="topbar-spacer" />
        {/*
         * La conferma dice cosa succede DAVVERO: va nel cestino, si può
         * rimettere a posto, e diventa definitiva fra trenta giorni. Una
         * conferma che dice solo «sei sicuro?» non aggiunge informazione e si
         * clicca senza leggerla.
         */}
        <BottoneConferma
          className="btn btn-danger"
          etichetta="Sposta nel cestino"
          conferma="Sì, sposta nel cestino"
          domanda={
            <>
              L'immersione sparisce dall'archivio e smette di sincronizzarsi, ma resta recuperabile dalle{' '}
              <b>Impostazioni</b> per trenta giorni. Dopo, la cancellazione diventa definitiva su tutti i
              dispositivi.
            </>
          }
          onConferma={onDelete}
        />
      </div>
    </div>
  );
}
