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
import { numeroDaTesto } from '../numero';
import { pesoDelGav, type Equipment, type EquipmentKind, type GearArchive } from '../../core/analysis/gear';
import { ScegliAttrezzo, vocePerNome } from './ScegliAttrezzo';
import {
  FASCE_VISIBILITA,
  WAVES_LABEL,
  WEATHER_LABEL,
  conditionsOf,
  tagsSenzaCondizioni,
} from '../../core/conditions';
import { parseCylinderSpec } from '../../core/cylinders';
import type { Cylinder, Dive, DiveGear, GearRef, Waves, Weather } from '../../core/model';
import { useLingua } from '../lingua';
import { BottoneConferma } from './Conferma';

/** Un numero da un campo di testo, dove vuoto è «non lo so» e non zero. */
// La conversione sta in `ui/numero.ts`, in un posto solo: la virgola decimale
// è già costata due difetti in questo progetto. Vedi il commento là.
const numero = numeroDaTesto;

// ---------------------------------------------------------------------------

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
  const { t } = useLingua();
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
          <span className="muted">{t('Sigla o descrizione')}</span>
          <input
            type="text"
            placeholder="S80, D12, 15 L…"
            value={c.description ?? ''}
            onChange={(e) => onChange({ description: e.target.value })}
            onBlur={(e) => traduci(e.target.value)}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t("Litri d'acqua")}</span>
          <input
            type="text"
            inputMode="decimal"
            step="0.1"
            value={c.sizeL ?? ''}
            onChange={(e) => onChange({ sizeL: numero(e.target.value) })}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Materiale')}</span>
          <select
            value={c.material ?? ''}
            onChange={(e) => onChange({ material: (e.target.value || undefined) as Cylinder['material'] })}
          >
            <option value="">{t('non so')}</option>
            <option value="steel">{t('acciaio')}</option>
            <option value="alu">{t('alluminio')}</option>
            <option value="carbon">{t('carbonio')}</option>
          </select>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Ossigeno')} %</span>
          <input
            type="text"
            inputMode="decimal"
            step="1"
            value={Math.round(c.mix.o2 * 100) || ''}
            onChange={(e) => {
              const v = numero(e.target.value);
              onChange({ mix: { ...c.mix, o2: v === undefined ? 0.21 : v / 100 } });
            }}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Elio')} %</span>
          <input
            type="text"
            inputMode="decimal"
            step="1"
            value={Math.round(c.mix.he * 100) || ''}
            onChange={(e) => {
              const v = numero(e.target.value);
              onChange({ mix: { ...c.mix, he: v === undefined ? 0 : v / 100 } });
            }}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Inizio')} (bar)</span>
          <input
            type="text"
            inputMode="decimal"
            value={c.startBar ?? ''}
            onChange={(e) => onChange({ startBar: numero(e.target.value) })}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Fine')} (bar)</span>
          <input
            type="text"
            inputMode="decimal"
            value={c.endBar ?? ''}
            onChange={(e) => onChange({ endBar: numero(e.target.value) })}
          />
        </label>
      </div>
      {/*
        La nota arriva da `parseCylinderSpec`, in italiano e con dentro dei
        numeri: non passa da `t()` perché una chiave con un numero dentro non
        sarebbe mai nel dizionario. Va tradotta là, se e quando si tradurrà.
      */}
      {notaSigla && (
        <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
          {notaSigla}
        </p>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <span className="topbar-spacer" />
        <button type="button" className="btn btn-small" onClick={onRimuovi}>
          {t('Togli questa bombola')}
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
  onSporco,
}: {
  dive: Dive;
  gear: GearArchive;
  onSalvaAttrezzatura: (archivio: GearArchive) => Promise<void>;
  onSave: (d: Dive) => Promise<void>;
  onDelete: () => void;
  /**
   * Avvisa chi ospita la scheda che ci sono modifiche non salvate.
   *
   * Serve a una cosa sola: il pulsante che chiude la scheda si chiama «Chiudi»,
   * non «Annulla», e chi ha appena finito di scrivere il racconto
   * dell'immersione non ha nessun motivo di aspettarsi che chiuderlo lo
   * cancelli. La bozza vive in questo componente e muore con lo smontaggio,
   * senza una conferma e senza un avviso — verificato con l'app in mano: nota e
   * titolo spariscono anche solo cambiando pagina.
   */
  onSporco?: (sporco: boolean) => void;
}) {
  const { t } = useLingua();
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
    onSporco?.(true);
  };

  const toccaGear = (patch: Partial<DiveGear>) => {
    setDraft((d) => ({ ...d, gear: { ...(d.gear ?? {}), ...patch } }));
    setSaved(false);
    onSporco?.(true);
  };

  const condizioni = conditionsOf(draft);

  const aggiungiAllInventario = (kind: EquipmentKind, name: string): string => {
    const voce: Equipment = vocePerNome(kind, name);
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
      onSporco?.(false);
    });
  };

  return (
    <div className="card">
      <h2>{t('Modifica dati')}</h2>
      {/*
        Salvando, `state.tsx` ricalcola le metriche dell'immersione: non lo
        diciamo più a schermo perché è quello che deve succedere e basta. Quello
        che l'utente deve sapere è che un import successivo non gli cancella
        quello che ha scritto qui — vedi `mergeDive`.
      */}
      <p className="card-sub">
        {t('Quello che il computer non misura. Un import successivo')} <b>{t('non sovrascrive')}</b>{' '}
        {t('questi campi.')}
      </p>

      {/* ------------------------------------------------------ l'immersione */}
      <div className="finding-section-label">{t("L'immersione")}</div>
      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Titolo')}</span>
          <input
            type="text"
            placeholder={t('notturna al relitto')}
            value={draft.title ?? ''}
            onChange={(e) => tocca({ title: e.target.value || undefined })}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Sito')}</span>
          <input
            type="text"
            value={draft.site?.name ?? ''}
            onChange={(e) => tocca({ site: { ...(draft.site ?? { name: '' }), name: e.target.value } })}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Valutazione')}</span>
          <select value={draft.rating ?? ''} onChange={(e) => tocca({ rating: numero(e.target.value) })}>
            <option value="">{t('non data')}</option>
            <option value="1">★ — {t('da dimenticare')}</option>
            <option value="2">★★</option>
            <option value="3">★★★ — {t('normale')}</option>
            <option value="4">★★★★</option>
            <option value="5">★★★★★ — {t('di quelle che si raccontano')}</option>
          </select>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Compagno')}</span>
          <input
            type="text"
            value={draft.buddy ?? ''}
            onChange={(e) => tocca({ buddy: e.target.value || undefined })}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Guida sub')}</span>
          <input
            type="text"
            placeholder={t('chi vi ha portati')}
            value={draft.guide ?? ''}
            onChange={(e) => tocca({ guide: e.target.value || undefined })}
          />
        </label>
      </div>
      {/*
        Compagno e guida stanno in due campi perché sono due domande diverse —
        «con chi mi immergo di solito» e «chi mi ha portato» — e in un campo solo
        non se ne conta nessuna delle due. Lo dicono già i due nomi: a schermo
        era una spiegazione che nessuno deve leggere per compilare.
      */}
      {/* -------------------------------------------------------- condizioni */}
      <div className="finding-section-label">{t('Condizioni')}</div>
      <div className="grid grid-3" style={{ marginBottom: 14 }}>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Meteo')}</span>
          <select
            value={condizioni.weather ?? ''}
            onChange={(e) =>
              tocca({ conditions: { ...condizioni, weather: (e.target.value || undefined) as Weather } })
            }
          >
            <option value="">{t('non registrato')}</option>
            {/*
              `WEATHER_LABEL`, `WAVES_LABEL` e `FASCE_VISIBILITA` sono tabelle di
              costanti del core: restano in italiano là — sono le chiavi del
              dizionario — e si traducono qui, al disegno.
            */}
            {Object.entries(WEATHER_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Mare')}</span>
          <select
            value={condizioni.waves ?? ''}
            onChange={(e) =>
              tocca({ conditions: { ...condizioni, waves: (e.target.value || undefined) as Waves } })
            }
          >
            <option value="">{t('non registrato')}</option>
            {Object.entries(WAVES_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Acqua')}</span>
          <select
            value={draft.salinity ?? 'salt'}
            onChange={(e) => tocca({ salinity: e.target.value as 'salt' | 'fresh' })}
          >
            <option value="salt">{t('salata')}</option>
            <option value="fresh">{t('dolce (lago)')}</option>
          </select>
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Visibilità')}</span>
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
                ? `${draft.visibilityM} m (${t('dal file')})`
                : t('non registrata')}
            </option>
            {FASCE_VISIBILITA.map((f, i) => (
              <option key={f.etichetta} value={i}>
                {t(f.etichetta)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ----------------------------------------------------------- bombole */}
      <div className="finding-section-label">{t('Bombole')}</div>
      {/*
        L'80 di «S80» sono piedi cubi di GAS a pressione di lavoro; all'aritmetica
        del gas serve il volume d'ACQUA, che per una S80 è 11,1 L. La tabella e la
        formula stanno in `core/cylinders.ts`, e la nota sotto il campo dice da
        quale delle due viene il numero.
      */}
      <p className="muted" style={{ fontSize: 11, margin: '0 0 10px' }}>
        {t('Scrivi una sigla —')} <b>S80</b>, <b>S40</b>, <b>D12</b> —{' '}
        {t("e i litri d'acqua si compilano da soli.")}
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
        ＋ {t('Aggiungi una bombola')}
      </button>

      {/* ------------------------------------------------------ attrezzatura */}
      <div className="finding-section-label">{t('Attrezzatura')}</div>
      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <ScegliAttrezzo
          kind="suit"
          etichetta={t('Muta')}
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
          etichetta={t('GAV o sacco')}
          valore={draft.gear?.bcd}
          attrezzi={attrezzi}
          onChange={(v) => {
            /*
             * SCEGLIENDO IL GAV ARRIVA ANCHE IL PESO DELLA SUA PIASTRA.
             *
             * È il motivo per cui quei due campi stanno nell'inventario: la
             * piastra pesa lo stesso a ogni immersione, e ridigitarla ogni volta
             * significa non scriverla mai — e senza, la tabella della zavorra
             * racconta il contrario di quello che succede in acqua.
             *
             * Si propone SOLO se il campo è vuoto: un numero già scritto è una
             * scelta di chi c'era, e sovrascriverlo cambiando GAV cancellerebbe
             * in silenzio la configurazione di quel giorno.
             */
            const peso = pesoDelGav(attrezzi.find((a) => a.id === v?.id));
            toccaGear({
              bcd: v,
              backplateKg: draft.gear?.backplateKg ?? peso,
            });
          }}
          onAggiungiAllInventario={aggiungiAllInventario}
        />
        <ScegliAttrezzo
          kind="regulator"
          etichetta={t('Erogatore principale')}
          valore={erogatori[0]}
          attrezzi={attrezzi}
          onChange={(v) => setErogatore(0, v)}
          onAggiungiAllInventario={aggiungiAllInventario}
        />
        <ScegliAttrezzo
          kind="regulator"
          etichetta={t('Secondo erogatore')}
          valore={erogatori[1]}
          attrezzi={attrezzi}
          onChange={(v) => setErogatore(1, v)}
          onAggiungiAllInventario={aggiungiAllInventario}
        />
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Zavorra (kg)')}</span>
          <input
            type="text"
            inputMode="decimal"
            step="0.5"
            value={draft.weightKg ?? ''}
            onChange={(e) => tocca({ weightKg: numero(e.target.value) })}
          />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Piastra o schienalino (kg)')}</span>
          <input
            type="text"
            inputMode="decimal"
            step="0.1"
            placeholder="0"
            value={draft.gear?.backplateKg ?? ''}
            onChange={(e) => toccaGear({ backplateKg: numero(e.target.value) })}
          />
        </label>
      </div>
      {/*
        Nella tabella della zavorra per muta entra il TOTALE, non la sola zavorra:
        una piastra d'acciaio da 3 kg su «2 kg di zavorra» fanno cinque, e una
        tabella che conta due racconta il contrario di quello che succede in acqua.
      */}
      <p className="muted" style={{ fontSize: 11, margin: '0 0 14px' }}>
        {(() => {
          const totale = (draft.weightKg ?? 0) + (draft.gear?.backplateKg ?? 0);
          return draft.gear?.backplateKg
            ? `${t('Peso totale, zavorra più piastra:')} ${Math.round(totale * 10) / 10} kg`
            : t('Per l’assetto zavorra e piastra contano insieme: l’app le somma.');
        })()}
      </p>

      {/* -------------------------------------------------------------- note */}
      <label className="stack" style={{ gap: 4, fontSize: 12, marginBottom: 14 }}>
        <span className="muted">{t('Note')}</span>
        <textarea
          rows={5}
          placeholder={t('cosa hai visto, cosa è andato storto, cosa cambieresti')}
          value={draft.notes ?? ''}
          onChange={(e) => tocca({ notes: e.target.value })}
        />
      </label>

      <div className="row">
        <button className="btn btn-primary" onClick={salva}>
          {t('Salva')}
        </button>
        {saved && (
          <span className="muted" style={{ fontSize: 12 }}>
            {t('Salvato.')}
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
          etichetta={t('Sposta nel cestino')}
          conferma={t('Sì, sposta nel cestino')}
          domanda={
            <>
              {t('Recuperabile dalle')} <b>{t('Impostazioni')}</b>{' '}
              {t('per trenta giorni. Dopo sparisce da tutti i dispositivi.')}
            </>
          }
          onConferma={onDelete}
        />
      </div>
    </div>
  );
}
