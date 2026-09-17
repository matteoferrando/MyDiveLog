/**
 * I brevetti.
 *
 * ► PERCHÉ NON STANNO IN ATTREZZATURA. ◄ Ci sono nati per comodità — erano una
 * lista di record con una data, come le bombole — ma non c'entravano niente.
 * L'attrezzatura è quello che porti in acqua e che si revisiona: la apri prima
 * di andare al centro ricarica. Un brevetto non si revisiona, non scade e non lo
 * porti in acqua: dice chi sei, e il posto dove serve è il libretto — la lettera
 * b) dell'art. 12, comma 8 della legge 70/2026. Ora sta accanto a quello, nelle
 * Impostazioni, sotto la carta che compone il libretto.
 *
 * ► SI SCEGLIE, NON SI SCRIVE. ◄ Prima erano tre campi liberi, e il testo libero
 * su un dato del genere produce archivi illeggibili: «Advanced», «AOW»,
 * «Advanced Open Water Diver» sono la stessa cosa scritta in tre modi, e nessuno
 * dei tre dice fino a che profondità quella persona sia addestrata. Adesso si
 * sceglie la didattica, e poi il brevetto fra i suoi: arriva il nome ufficiale, e
 * con il nome i fatti che quella didattica dichiara. Vedi `didattiche.ts`.
 *
 * ► E RESTA LA VIA LIBERA. ◄ Le didattiche sono decine e il catalogo ne ha
 * tredici. «Altro» apre i campi come prima — nome della scuola, nome del corso,
 * livello scelto a mano — perché un elenco chiuso su una realtà aperta non è
 * rigore, è un muro davanti a chi ha il brevetto sbagliato.
 */
import { useMemo, useState } from 'react';
import {
  CERT_LEVEL_LABEL,
  CERT_LEVEL_NOME,
  RUOLO_LABEL,
  haDecompressione,
  haMiscele,
  highestLevel,
  profonditaDichiarata,
  ruoloPiuAlto,
  sortCertifications,
  type CertLevel,
  type Certification,
  type RuoloBrevetto,
} from '../../core/analysis/gear';
import {
  DIDATTICHE,
  DIDATTICA_ALTRO,
  brevettoPerNome,
  didatticaPerId,
  didatticaPerSigla,
  type BrevettoCatalogo,
  type Didattica,
} from '../../core/analysis/didattiche';
import { useDiveLog } from '../state';
import { dateShort } from '../format';
import { useLingua } from '../lingua';
import { usePortaInVista } from '../scorri';
import { BottoniScheda, Campo, nuovoId } from './moduli';

/**
 * Il valore della tendina che vuol dire «questo corso non è in elenco».
 *
 * ► IL CARATTERE ZERO SI SCRIVE `\u0000`, NON SI INCOLLA. ◄ Fino al 16
 * settembre 2026 qui dentro c'era il byte zero VERO, battuto nel sorgente. Il
 * valore che ne esce è lo stesso — serve un testo che nessun corso potrà mai
 * avere — ma un file con un byte di controllo dentro **smette di essere testo**
 * per gli strumenti: `grep` lo salta dicendo «binary file matches» senza
 * mostrare la riga, e `git diff` scrive «Binary files differ» invece del
 * cambiamento. Cioè questo file era invisibile a ogni ricerca fatta nel
 * progetto e illeggibile in ogni revisione, e non lo diceva nessuno.
 *
 * Con l'escape il valore a runtime non cambia di un bit e il file torna testo.
 * `tests/sorgentiDiTesto.test.ts` tiene la porta chiusa.
 */
const NON_IN_ELENCO = '\u0000libero';

export function Brevetti() {
  const { gear, saveGear } = useDiveLog();
  const { t } = useLingua();
  const [bozza, setBozza] = useState<Certification | null>(null);

  const brevetti = useMemo(() => sortCertifications(gear.certifications), [gear.certifications]);
  const livello = highestLevel(gear.certifications);
  const miscele = haMiscele(gear.certifications);
  const ruolo = ruoloPiuAlto(gear.certifications);
  const profondita = profonditaDichiarata(gear.certifications);
  const deco = haDecompressione(gear.certifications);

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
                'Scegli la didattica e il corso: il nome e i limiti arrivano da soli. Quelli che registri qui sono quelli che puoi mettere sul libretto.',
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
                    <th className="num">{t('Profondità')}</th>
                    <th>{t('Data')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {brevetti.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => setBozza(c)}>
                      {/* `data-eti` è l'intestazione che sul telefono torna
                          accanto al valore: lì la tabella diventa un elenco di
                          schede e le colonne non ci sono più. */}
                      <td className="cella-titolo">
                        <div style={{ fontWeight: 550 }}>{c.name || t('senza nome')}</div>
                        {(c.number || c.instructor) && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {[c.number, c.instructor].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }} data-eti={t('Didattica')}>
                        {c.agency || '—'}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }} data-eti={t('Livello')}>
                        {t(CERT_LEVEL_LABEL[c.level])}
                        {/* Il ruolo è un'altra cosa dai metri, e si legge sotto
                            invece che al posto del livello: un istruttore che
                            non ha il Profondo resta un istruttore senza il
                            Profondo, e il Coach deve poterlo sapere. */}
                        {c.ruolo && <div style={{ fontSize: 12 }}>{t(RUOLO_LABEL[c.ruolo])}</div>}
                      </td>
                      <td className="muted tabular" style={{ fontSize: 12 }} data-eti={t('Profondità')}>
                        {c.profonditaM !== undefined ? `${c.profonditaM} m` : '—'}
                        {c.decompressione && <div style={{ fontSize: 12 }}>{t('con decompressione')}</div>}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }} data-eti={t('Data')}>
                        {c.issuedOn ? dateShort(c.issuedOn) : '—'}
                      </td>
                      <td className="cella-azione" style={{ textAlign: 'right' }}>
                        {/*
                         * ► IL NOME DELLA RIGA STA DENTRO IL PULSANTE. ◄ Con
                         * la sola parola «Apri», una tabella di dodici righe
                         * dà a chi usa un lettore di schermo dodici pulsanti
                         * identici, e l'unico modo di sapere quale si sta per
                         * premere è tornare indietro a leggere la riga. Il
                         * testo visibile resta «Apri», che accanto alla riga
                         * si capisce da solo; il nome accessibile dice anche
                         * di che cosa.
                         */}
                        <button
                          style={{ fontSize: 12, padding: '3px 8px' }}
                          aria-label={`${t('Apri')} ${c.name || t('senza nome')}`}
                        >
                          {t('Apri')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Riepilogo
              livello={livello}
              ruolo={ruolo}
              profondita={profondita}
              miscele={miscele}
              deco={deco}
            />
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

/**
 * Le due righe sotto la tabella: cosa dicono, messi insieme, i tuoi brevetti.
 *
 * Quattro fatti su assi diversi, e stanno separati apposta. La profondità del
 * LIVELLO è il nostro scalino, che serve a confrontare scuole diverse; la
 * profondità in METRI è quella che dichiara la didattica, e può non esserci.
 * Le miscele e il ruolo non sono profondità e non entrano nella classifica: è
 * l'errore già pagato una volta, quando il Nitrox scavalcava il Profondo.
 */
function Riepilogo({
  livello,
  ruolo,
  profondita,
  miscele,
  deco,
}: {
  livello?: CertLevel;
  ruolo?: RuoloBrevetto;
  profondita?: number;
  miscele: boolean;
  deco: boolean;
}) {
  const { t } = useLingua();
  if (!livello) return null;
  return (
    <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
      {t('Livello più alto registrato')}: <b>{t(CERT_LEVEL_LABEL[livello])}</b>.
      {profondita !== undefined && (
        <>
          {' '}
          {t('La profondità più alta che le tue didattiche dichiarano è')} <b>{profondita} m</b>.
        </>
      )}
      {miscele && livello !== 'nitrox' && <> {t('Con brevetto miscele.')}</>}
      {deco && <> {t('Con brevetti che prevedono la decompressione.')}</>}
      {ruolo && (
        <>
          {' '}
          {t('Qualifica più alta')}: <b>{t(RUOLO_LABEL[ruolo])}</b>.
        </>
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------
// La scheda
// ---------------------------------------------------------------------------

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

  /*
   * Quale voce è selezionata nella prima tendina.
   *
   * Un brevetto vecchio, scritto a mano quando le tendine non c'erano, porta
   * solo la sigla: se la riconosciamo la riproponiamo SELEZIONATA — chi riapre
   * un «PADI» trova già PADI e deve solo scegliere il corso — ma non tocchiamo
   * niente finché non sceglie. Riconoscere non è convertire: convertire di
   * nascosto vorrebbe dire cambiargli il brevetto sul libretto senza dirglielo.
   */
  const [scelta, setScelta] = useState<string>(() => {
    if (item.didatticaId) return item.didatticaId;
    const nota = didatticaPerSigla(item.agency);
    if (nota) return nota.id;
    return item.agency ? DIDATTICA_ALTRO : '';
  });

  const didattica = didatticaPerId(scelta);
  const voce = didattica ? brevettoPerNome(didattica, d.name) : undefined;
  // Il nome viene dal catalogo solo se TUTTE E DUE le cose sono vere: la
  // didattica è salvata sul brevetto, e il nome corrisponde a un corso suo.
  const dalCatalogo = !!d.didatticaId && !!voce;

  const cambiaDidattica = (v: string) => {
    setScelta(v);
    const nuova = didatticaPerId(v);
    setD((p) => ({
      ...p,
      // Cambiando scuola, il corso di prima non esiste più: si azzera tutto
      // quello che veniva dal catalogo, invece di lasciare un «Deep Diver»
      // appeso a una didattica che non ce l'ha.
      didatticaId: undefined,
      agency: nuova ? nuova.sigla : v === DIDATTICA_ALTRO ? p.agency : '',
      name: nuova || v === '' ? '' : p.name,
      ruolo: undefined,
      profonditaM: undefined,
      decompressione: undefined,
    }));
  };

  const scegliBrevetto = (v: string) => {
    if (!didattica) return;
    if (v === NON_IN_ELENCO || v === '') {
      setD((p) => ({
        ...p,
        didatticaId: undefined,
        name: v === '' ? '' : p.name,
        ruolo: undefined,
        profonditaM: undefined,
        decompressione: undefined,
      }));
      return;
    }
    const b = brevettoPerNome(didattica, v);
    if (!b) return;
    setD((p) => ({
      ...p,
      didatticaId: didattica.id,
      agency: didattica.sigla,
      name: b.nome,
      level: b.livello,
      ruolo: b.ruolo,
      profonditaM: b.profonditaM,
      decompressione: b.decompressione,
    }));
  };

  return (
    <div className="card" ref={rif}>
      <h2>{d.name || t('Nuovo brevetto')}</h2>

      <div className="grid grid-2" style={{ marginBottom: 8 }}>
        <Campo etichetta="Didattica">
          <select value={scelta} onChange={(e) => cambiaDidattica(e.target.value)}>
            <option value="">{t('— scegli —')}</option>
            {/* Due gruppi, perché sono due mondi: chi cerca la tecnica sa già
                cosa cerca, e chi non la fa non deve scorrerla. */}
            <optgroup label={t('Ricreative')}>
              {DIDATTICHE.filter((x) => x.tipo === 'ricreativa').map((x) => (
                <option key={x.id} value={x.id}>
                  {x.sigla}
                </option>
              ))}
            </optgroup>
            <optgroup label={t('Tecniche')}>
              {DIDATTICHE.filter((x) => x.tipo === 'tecnica').map((x) => (
                <option key={x.id} value={x.id}>
                  {x.sigla}
                </option>
              ))}
            </optgroup>
            <option value={DIDATTICA_ALTRO}>{t('Altro (scrivo io)')}</option>
          </select>
        </Campo>

        {scelta === DIDATTICA_ALTRO ? (
          <Campo etichetta="Nome della didattica">
            <input
              type="text"
              placeholder="BSAC, ANDI, PSS…"
              value={d.agency}
              onChange={(e) => set('agency', e.target.value)}
            />
          </Campo>
        ) : (
          <Campo etichetta="Brevetto">
            <select
              value={dalCatalogo ? d.name : didattica ? NON_IN_ELENCO : ''}
              onChange={(e) => scegliBrevetto(e.target.value)}
              disabled={!didattica}
            >
              <option value="">{t('— scegli —')}</option>
              {(didattica?.brevetti ?? []).map((b) => (
                <option key={b.nome} value={b.nome}>
                  {b.nome}
                </option>
              ))}
              <option value={NON_IN_ELENCO}>{t('Altro (scrivo io)')}</option>
            </select>
          </Campo>
        )}
      </div>

      {/* Il nome a mano compare SOLO quando non arriva dal catalogo: due campi
          per la stessa cosa, uno pieno e uno vuoto, sono la ricetta per
          salvarne quello sbagliato. */}
      {!dalCatalogo && (
        <div className="grid grid-2" style={{ marginBottom: 8 }}>
          <Campo etichetta="Nome sul brevetto">
            <input
              type="text"
              placeholder={t('come si chiama il corso')}
              value={d.name}
              onChange={(e) => set('name', e.target.value)}
            />
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
      )}

      {dalCatalogo && voce && didattica && <FattiDelBrevetto voce={voce} didattica={didattica} />}

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
    </div>
  );
}

/**
 * Cosa dice la didattica di questo brevetto.
 *
 * Non è decorazione: è il motivo per cui il catalogo esiste. E dichiara sempre
 * la propria fonte, anche quando la fonte tace — «questa didattica non pubblica
 * una profondità per questo brevetto» è un'informazione, mentre un campo vuoto
 * senza spiegazione sembra un difetto dell'applicazione.
 */
export function FattiDelBrevetto({ voce, didattica }: { voce: BrevettoCatalogo; didattica: Didattica }) {
  const { t } = useLingua();
  /*
   * Il nome dello scalino SENZA i metri tipici quando la didattica i suoi li
   * dichiara: due numeri diversi sulla stessa riga — «Primo livello (fino a
   * 18 m) · 20 m» — si leggono come un errore, non come due fatti. Vedi
   * `CERT_LEVEL_NOME` in `core/analysis/gear.ts`.
   */
  const scalino = voce.profonditaM === undefined ? CERT_LEVEL_LABEL : CERT_LEVEL_NOME;
  const pezzi: string[] = [t(scalino[voce.livello])];
  if (voce.profonditaM !== undefined) pezzi.push(`${voce.profonditaM} m`);
  if (voce.decompressione) pezzi.push(t('con decompressione'));
  if (voce.ruolo) pezzi.push(t(RUOLO_LABEL[voce.ruolo]));

  return (
    <div className="planner-hint" style={{ marginTop: 0, marginBottom: 10 }}>
      <div>{pezzi.join(' · ')}</div>
      <div style={{ marginTop: 2 }}>
        {voce.profonditaM === undefined
          ? t('Questa didattica non dichiara una profondità per questo brevetto.')
          : `${t('Profondità dichiarata da')} ${didattica.sigla}.`}{' '}
        {t('Se non ti torna, scegli «Altro (scrivo io)» e compila a mano.')}
      </div>
    </div>
  );
}
