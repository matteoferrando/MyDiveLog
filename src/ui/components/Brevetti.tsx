/**
 * I brevetti.
 *
 * ► PERCHÉ NON STANNO PIÙ IN ATTREZZATURA. ◄ Ci sono nati per comodità — erano
 * una lista di record con una data, come le bombole — ma non c'entravano
 * niente. L'attrezzatura è quello che porti in acqua e che si revisiona: la
 * apri prima di andare al centro ricarica, e la domanda che ti fai è «quando
 * l'ho fatto revisionare». Un brevetto non si revisiona, non scade e non lo
 * porti in acqua: dice chi sei, e il posto dove serve è il libretto — la
 * lettera b) dell'art. 12, comma 8 della legge 70/2026. Ora sta accanto a
 * quello, nelle Impostazioni, sotto la carta che compone il libretto: chi
 * compila il nome e il brevetto trova l'elenco da cui sceglierlo subito sotto,
 * invece che in un'altra scheda dell'applicazione.
 *
 * ► DEI BREVETTI L'APPLICAZIONE LEGGE SOLO IL LIVELLO. ◄ I nomi commerciali
 * delle didattiche sono decine — Advanced Open Water, Two Star, Advanced Diver
 * — e metterli in fila è una battaglia persa. Il resto (didattica, numero,
 * istruttore) è archivio per chi lo consulta.
 */
import { useMemo, useState } from 'react';
import {
  CERT_LEVEL_LABEL,
  haMiscele,
  highestLevel,
  sortCertifications,
  type CertLevel,
  type Certification,
} from '../../core/analysis/gear';
import { useDiveLog } from '../state';
import { dateShort } from '../format';
import { useLingua } from '../lingua';
import { usePortaInVista } from '../scorri';
import { BottoniScheda, Campo, nuovoId } from './moduli';

export function Brevetti() {
  const { gear, saveGear } = useDiveLog();
  const { t } = useLingua();
  const [bozza, setBozza] = useState<Certification | null>(null);

  const brevetti = useMemo(() => sortCertifications(gear.certifications), [gear.certifications]);
  const livello = highestLevel(gear.certifications);
  const miscele = haMiscele(gear.certifications);

  const salva = (item: Certification) => {
    const esiste = gear.certifications.some((g) => g.id === item.id);
    void saveGear({
      ...gear,
      certifications: esiste
        ? gear.certifications.map((g) => (g.id === item.id ? item : g))
        : [...gear.certifications, item],
    });
    setBozza(null);
  };
  const elimina = (id: string) => {
    void saveGear({ ...gear, certifications: gear.certifications.filter((g) => g.id !== id) });
    setBozza(null);
  };

  return (
    <>
      <div className="card">
        <div className="spread" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>{t('I tuoi brevetti')}</h2>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              {t(
                'Quelli che scrivi qui sono quelli che puoi scegliere qui sopra per il libretto. Il campo che conta è il livello.',
              )}
            </p>
          </div>
          <button
            className="btn"
            onClick={() => setBozza({ id: nuovoId(), agency: '', name: '', level: 'base' })}
          >
            {t('Aggiungi')}
          </button>
        </div>

        {brevetti.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            {t('Nessun brevetto registrato. Servono ai')} <b>{t('Suggerimenti')}</b>{' '}
            {t('per dirti quanto manca al passo successivo.')}
          </p>
        ) : (
          <>
            <div className="tabella-adattiva">
              <table>
                <thead>
                  <tr>
                    <th>{t('Brevetto')}</th>
                    <th>{t('Didattica')}</th>
                    <th>{t('Livello')}</th>
                    <th>{t('Data')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {brevetti.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => setBozza(c)}>
                      {/* `data-eti` è l'intestazione che sul telefono torna
                          accanto al valore: lì la tabella diventa un elenco di
                          schede e le colonne non ci sono più. Vedi
                          `.tabella-adattiva` nel foglio di stile. */}
                      <td data-eti={t('Brevetto')}>
                        <div style={{ fontWeight: 550 }}>{c.name || t('senza nome')}</div>
                        {(c.number || c.instructor) && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {[c.number, c.instructor].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }} data-eti={t('Didattica')}>
                        {c.agency || '—'}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }} data-eti={t('Livello')}>
                        {t(CERT_LEVEL_LABEL[c.level])}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }} data-eti={t('Data')}>
                        {c.issuedOn ? dateShort(c.issuedOn) : '—'}
                      </td>
                      <td className="cella-azione" style={{ textAlign: 'right' }}>
                        <button style={{ fontSize: 11, padding: '3px 8px' }}>{t('Apri')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {livello && (
              <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
                {t('Livello più alto registrato')}: <b>{t(CERT_LEVEL_LABEL[livello])}</b>.
                {/*
                 * Le miscele si dicono a parte e non nella stessa frase: sono
                 * un'altra cosa, e finché stavano nella stessa classifica il
                 * Nitrox scavalcava il Profondo. Vedi `highestLevel`.
                 */}
                {miscele && livello !== 'nitrox' && <> {t('Con brevetto miscele.')}</>}
              </p>
            )}
          </>
        )}
      </div>

      {/*
       * `key` NON è decorativa: la scheda copia l'oggetto in uno `useState`
       * iniziale, che si legge una volta sola al montaggio. Senza, aprire un
       * brevetto dopo un altro lascerebbe i campi del primo — e serve anche a
       * `usePortaInVista`, che porta a schermo la scheda proprio al montaggio.
       */}
      {bozza && (
        <SchedaBrevetto
          key={bozza.id}
          item={bozza}
          onSave={salva}
          onDelete={elimina}
          onCancel={() => setBozza(null)}
        />
      )}
    </>
  );
}

function SchedaBrevetto({
  item,
  onSave,
  onDelete,
  onCancel,
}: {
  item: Certification;
  onSave: (item: Certification) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLingua();
  const [d, setD] = useState<Certification>(item);
  const set = <K extends keyof Certification>(k: K, v: Certification[K]) => setD((p) => ({ ...p, [k]: v }));
  const rif = usePortaInVista<HTMLDivElement>();

  return (
    <div className="card" ref={rif}>
      <h2>{d.name || t('Nuovo brevetto')}</h2>
      <div className="grid grid-3" style={{ marginBottom: 8 }}>
        <Campo etichetta="Didattica">
          <input
            type="text"
            placeholder="PADI, SSI, CMAS, TDI…"
            value={d.agency}
            onChange={(e) => set('agency', e.target.value)}
          />
        </Campo>
        <Campo etichetta="Nome sulla tessera">
          <input type="text" value={d.name} onChange={(e) => set('name', e.target.value)} />
        </Campo>
        <Campo etichetta="Livello">
          <select value={d.level} onChange={(e) => set('level', e.target.value as CertLevel)}>
            {(Object.keys(CERT_LEVEL_LABEL) as CertLevel[]).map((k) => (
              <option key={k} value={k}>
                {t(CERT_LEVEL_LABEL[k])}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <div className="grid grid-3" style={{ marginBottom: 8 }}>
        <Campo etichetta="Preso il">
          <input
            type="date"
            value={d.issuedOn ?? ''}
            onChange={(e) => set('issuedOn', e.target.value || undefined)}
          />
        </Campo>
        <Campo etichetta="Numero">
          <input
            type="text"
            value={d.number ?? ''}
            onChange={(e) => set('number', e.target.value || undefined)}
          />
        </Campo>
        <Campo etichetta="Istruttore">
          <input
            type="text"
            value={d.instructor ?? ''}
            onChange={(e) => set('instructor', e.target.value || undefined)}
          />
        </Campo>
      </div>
      <Campo etichetta="Note">
        <textarea
          rows={2}
          value={d.notes ?? ''}
          onChange={(e) => set('notes', e.target.value || undefined)}
        />
      </Campo>
      <BottoniScheda
        cosa={d.name ? `«${d.name}»` : t('questo brevetto')}
        salvabile={!!d.name?.trim()}
        onSave={() => onSave(d)}
        onCancel={onCancel}
        onDelete={() => onDelete(d.id)}
      />
      {/*
       * Il nome sul cartellino è quello che finisce sulla riga del libretto:
       * detto qui, dove si scrive, e non nella carta sopra, dove si sceglie.
       */}
      <p className="muted" style={{ fontSize: 11, margin: '10px 0 0' }}>
        {t('Sul libretto finiscono didattica e livello, non il nome sulla tessera.')}
      </p>
    </div>
  );
}
