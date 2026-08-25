/**
 * I pezzi comuni dei moduli a scheda: un campo con la sua etichetta, e la riga
 * dei bottoni in fondo.
 *
 * Stavano dentro `pages/Gear.tsx`, che è dove sono nati. Sono usciti quando i
 * brevetti si sono spostati nelle Impostazioni: la stessa scheda non poteva
 * importare due funzioni private di una pagina, e copiarle avrebbe creato due
 * versioni della conferma di eliminazione destinate a divergere al primo
 * ritocco. Un file solo, e chi cambia la conferma la cambia per tutti.
 */
import { useState, type ReactNode } from 'react';
import { useLingua } from '../lingua';

/**
 * L'identificativo di una riga nuova.
 *
 * Non è un UUID e non deve esserlo: serve solo a distinguere fra loro le righe
 * di un archivio personale — venti pezzi di attrezzatura, cinque brevetti — e a
 * fare da `key` a React. Il millisecondo davanti tiene l'ordine di creazione
 * leggibile a occhio quando si guarda un backup in JSON.
 */
export const nuovoId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * Un campo del modulo, con la sua etichetta.
 *
 * L'etichetta si traduce QUI e non a ogni chiamata: sono venti campi, e venti
 * `t(...)` sparsi sarebbero venti occasioni di dimenticarne uno. L'unità di
 * misura invece non passa da `t()`: `L`, `bar`, `kg` si scrivono uguali nelle
 * due lingue.
 */
export function Campo({
  etichetta,
  unita,
  children,
}: {
  etichetta: string;
  unita?: string;
  children: ReactNode;
}) {
  const { t } = useLingua();
  return (
    <label className="stack" style={{ gap: 4, fontSize: 12 }}>
      <span className="muted">
        {t(etichetta)} {unita && <span className="muted">({unita})</span>}
      </span>
      {children}
    </label>
  );
}

/**
 * Salva, annulla, elimina — con la conferma sull'eliminazione.
 *
 * Prima «Elimina» cancellava al primo clic, e su un elenco dove ogni riga apre
 * la scheda basta un tocco fuori bersaglio su un telefono per perdere la
 * matricola di una bombola che nessuno si ricorda a memoria. Non c'è un annulla,
 * perché l'attrezzatura non ha cestino: quindi la conferma serve.
 *
 * NON è un `window.confirm`: una finestra modale del browser blocca tutto il
 * thread e su iOS compare con un testo che non si può tradurre. Il bottone si
 * trasforma nella domanda, e chiunque clicchi altrove torna indietro da solo.
 */
export function BottoniScheda({
  onSave,
  onCancel,
  onDelete,
  cosa,
  salvabile,
}: {
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  cosa: string;
  /**
   * Falso quando la scheda non ha ancora un nome.
   *
   * Senza, «Salva» su una scheda vuota creava una riga «senza nome», e
   * ripetendolo se ne accumulavano di indistinguibili l'una dall'altra — con la
   * sola conferma di eliminazione a proteggerle. Il nome è l'unica cosa che
   * distingue un pezzo di attrezzatura da un altro: senza, la riga non serve a
   * niente e non si può nemmeno cancellare con cognizione.
   */
  salvabile?: boolean;
}) {
  const { t } = useLingua();
  const [conferma, setConferma] = useState(false);
  return (
    <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
      <button className="btn" onClick={onSave} disabled={salvabile === false}>
        {t('Salva')}
      </button>
      {salvabile === false && (
        <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
          {t('Serve un nome.')}
        </span>
      )}
      <button onClick={onCancel}>{t('Annulla')}</button>
      <span style={{ flex: 1 }} />
      {conferma ? (
        <>
          {/* `cosa` arriva già tradotto o è il nome scritto dall'utente: la
              domanda si compone a pezzi perché il nome sta in mezzo. */}
          <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
            {t('Elimino')} {cosa}? {t('Non si recupera.')}
          </span>
          <button onClick={() => setConferma(false)}>{t('No')}</button>
          <button onClick={onDelete} style={{ color: 'var(--critical)' }}>
            {t('Sì, elimina')}
          </button>
        </>
      ) : (
        <button onClick={() => setConferma(true)} style={{ color: 'var(--critical)' }}>
          {t('Elimina')}
        </button>
      )}
    </div>
  );
}
