/**
 * Il selettore di un pezzo di attrezzatura, usato da più moduli.
 *
 * Sta in un file suo perché lo usano sia la scheda di un'immersione già in
 * archivio sia l'inserimento a mano: due copie dello stesso campo divergono al
 * primo ritocco, e la parte che diverge per prima è proprio quella che conta —
 * il riconoscimento senza maiuscole, senza il quale «apeks xtx50» e «Apeks
 * XTX50» diventano due erogatori e il conto delle immersioni per attrezzo non
 * torna più.
 */

import { TYPICAL_SERVICE, type Equipment, type EquipmentKind } from '../../core/analysis/gear';
import type { GearRef } from '../../core/model';

/** Un identificativo nuovo per una voce dell'inventario. */
export const nuovoIdAttrezzo = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Crea la voce d'inventario per un nome scritto a mano. */
export function vocePerNome(kind: EquipmentKind, name: string): Equipment {
  return { id: nuovoIdAttrezzo(), kind, name, service: TYPICAL_SERVICE[kind] };
}

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
export function ScegliAttrezzo({
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
