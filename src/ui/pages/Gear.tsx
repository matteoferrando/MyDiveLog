/**
 * Attrezzatura, brevetti, zavorra.
 *
 * Tre sezioni e non un elenco unico, perché sono tre cose che si consultano in
 * momenti diversi: l'attrezzatura prima di andare al centro ricarica, i brevetti
 * quando qualcuno te li chiede o quando il Coach valuta se sei pronto per un
 * passo in più, la zavorra quando cambi muta.
 *
 * E NIENTE AVVISI. La versione precedente accendeva pallini rossi sulle
 * scadenze, e nella card del logbook comparivano quattro note su cose che chi
 * legge sa benissimo. Qui i fatti stanno scritti — «ultima revisione 14 mesi fa,
 * la prossima cadrebbe a marzo» — e il giudizio lo dà chi ha il contesto per
 * darlo: se la bombola è ferma in garage o se l'erogatore ha fatto trenta
 * immersioni in Egitto, l'applicazione non lo sa e non deve fingere di saperlo.
 *
 * La terza sezione non ha un modulo da compilare: la zavorra si RICAVA dalle
 * immersioni, che già portano muta e chili, e viene mostrata accanto
 * all'oscillazione d'assetto misurata sul profilo. Chiedere di digitare a mano
 * quello che l'archivio contiene già sarebbe lavoro doppio con due verità.
 */

import { useMemo, useState } from 'react';
import { numeroDaTesto } from '../numero';
import {
  CERT_LEVEL_LABEL,
  EQUIPMENT_LABEL,
  SERVICE_LABEL,
  TYPICAL_INTERVAL_MONTHS,
  TYPICAL_SERVICE,
  configurationRows,
  highestLevel,
  serviceFacts,
  sortCertifications,
  sortEquipment,
  equipmentUsage,
  pesoDelGav,
  weightingBySuit,
  type CertLevel,
  type Certification,
  type Equipment,
  type EquipmentKind,
  type ServiceKind,
} from '../../core/analysis/gear';
import { LIMITS } from '../../core/model';
import { useDiveLog } from '../state';
import { dateShort, imm } from '../format';

const nuovoId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function Gear() {
  const { gear, saveGear, dives } = useDiveLog();
  const [bozzaAttrezzo, setBozzaAttrezzo] = useState<Equipment | null>(null);
  const [bozzaBrevetto, setBozzaBrevetto] = useState<Certification | null>(null);
  const [mostraRitirati, setMostraRitirati] = useState(false);

  /*
   * Una scheda alla volta.
   *
   * Con due stati indipendenti si arrivava ad avere il modulo di un erogatore e
   * quello di un brevetto aperti insieme, uno sopra l'altro, entrambi con il
   * bottone «Salva»: a quel punto quale dei due si stia modificando lo si capisce
   * solo leggendo i campi. Aprire una cosa ne chiude un'altra è il comportamento
   * che chiunque si aspetta da un elenco con un dettaglio sotto.
   */
  const apriAttrezzo = (a: Equipment | null) => {
    setBozzaBrevetto(null);
    setBozzaAttrezzo(a);
  };
  const apriBrevetto = (c: Certification | null) => {
    setBozzaAttrezzo(null);
    setBozzaBrevetto(c);
  };

  const attrezzi = useMemo(() => sortEquipment(gear.equipment), [gear.equipment]);
  const uso = useMemo(() => equipmentUsage(dives, gear.equipment), [dives, gear.equipment]);
  const visibili = mostraRitirati ? attrezzi : attrezzi.filter((a) => !a.retired);
  const ritirati = attrezzi.filter((a) => a.retired).length;
  const brevetti = useMemo(() => sortCertifications(gear.certifications), [gear.certifications]);
  // L'inventario serve a recuperare il peso della piastra sulle immersioni che
  // hanno il GAV ma non i chili scritti sopra. Vedi `piastraDellImmersione`.
  const zavorra = useMemo(() => weightingBySuit(dives, 2, gear.equipment), [dives, gear.equipment]);
  const configurazioni = useMemo(() => configurationRows(dives), [dives]);
  const livello = highestLevel(gear.certifications);

  const salvaAttrezzo = (item: Equipment) => {
    const esiste = gear.equipment.some((g) => g.id === item.id);
    void saveGear({
      ...gear,
      equipment: esiste
        ? gear.equipment.map((g) => (g.id === item.id ? item : g))
        : [...gear.equipment, item],
    });
    apriAttrezzo(null);
  };
  const eliminaAttrezzo = (id: string) => {
    void saveGear({ ...gear, equipment: gear.equipment.filter((g) => g.id !== id) });
    apriAttrezzo(null);
  };
  const salvaBrevetto = (item: Certification) => {
    const esiste = gear.certifications.some((g) => g.id === item.id);
    void saveGear({
      ...gear,
      certifications: esiste
        ? gear.certifications.map((g) => (g.id === item.id ? item : g))
        : [...gear.certifications, item],
    });
    apriBrevetto(null);
  };
  const eliminaBrevetto = (id: string) => {
    void saveGear({ ...gear, certifications: gear.certifications.filter((g) => g.id !== id) });
    apriBrevetto(null);
  };

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">Attrezzatura</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          Un archivio, non un promemoria: qui non ci sono avvisi né scadenze che lampeggiano.
        </span>
      </div>

      {/* ---------------------------------------------- 1. cosa porti in acqua */}
      <div className="card">
        <div className="spread" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>Quello che porti in acqua</h2>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              Bombole, erogatori, sacco, computer, muta. Dove ha senso c'è la manutenzione: il collaudo
              idraulico segue la normativa, la revisione il libretto del costruttore, e l'intervallo lo decidi
              tu pezzo per pezzo.
            </p>
          </div>
          <button
            className="btn"
            onClick={() =>
              apriAttrezzo({
                id: nuovoId(),
                kind: 'regulator',
                name: '',
                service: 'overhaul',
                intervalMonths: 12,
              })
            }
          >
            Aggiungi
          </button>
        </div>

        {visibili.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Niente ancora. Il pezzo che vale più la pena registrare è la bombola: la matricola e la data del
            collaudo sono le due cose che al centro ricarica ti chiedono e che non ti ricordi mai.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pezzo</th>
                  <th>Matricola</th>
                  <th className="num">Immersioni</th>
                  <th>Manutenzione</th>
                  <th>Ultima</th>
                  <th>Prossima</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibili.map((a) => {
                  const f = serviceFacts(a);
                  return (
                    <tr key={a.id} className="clickable" onClick={() => apriAttrezzo(a)}>
                      <td>
                        <div style={{ fontWeight: 550 }}>
                          {a.name || 'senza nome'} {a.retired && <span className="muted">· ritirato</span>}
                        </div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {EQUIPMENT_LABEL[a.kind]}
                          {a.sizeL ? ` · ${a.sizeL} L` : ''}
                          {a.workingBar ? ` · ${a.workingBar} bar` : ''}
                        </div>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {a.serial || '—'}
                      </td>
                      {/*
                       * È LA COLONNA PER CUI L'INVENTARIO ESISTE.
                       *
                       * Le date di revisione si tengono anche su un foglio. Quello
                       * che il foglio non sa dire è quante immersioni ha fatto
                       * questo pezzo da quando l'hai fatto revisionare — e l'usura
                       * conta le immersioni, mentre la norma conta i mesi. Un
                       * erogatore fermo un anno in cantina e uno che in un anno ha
                       * fatto tre viaggi hanno la stessa data e due condizioni
                       * diverse.
                       *
                       * Il numero c'è solo per gli attrezzi che hai collegato alle
                       * immersioni dalla scheda: senza quel collegamento non è zero,
                       * è ignoto, e scrivere «0» direbbe una cosa falsa.
                       */}
                      <td className="num tabular" style={{ fontSize: 12 }}>
                        {(uso.get(a.id)?.dives ?? 0) === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          <>
                            {uso.get(a.id)?.dives}
                            {uso.get(a.id)?.divesSinceService !== undefined && (
                              <div className="muted" style={{ fontSize: 11 }}>
                                {uso.get(a.id)?.divesSinceService} dall’ultima
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {SERVICE_LABEL[a.service]}
                        {a.service !== 'none' && a.intervalMonths ? ` · ogni ${a.intervalMonths} mesi` : ''}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {a.lastServiceOn ? (
                          <>
                            {dateShort(a.lastServiceOn)}
                            {f.monthsSince !== undefined && (
                              <div style={{ fontSize: 11 }}>
                                {f.monthsSince === 0 ? 'questo mese' : `${f.monthsSince} mesi fa`}
                              </div>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      {/* Nessun colore e nessun pallino: è una data, non un verdetto. */}
                      <td className="muted tabular" style={{ fontSize: 12 }}>
                        {f.nextOn ? (
                          <>
                            {dateShort(f.nextOn)}
                            {f.monthsToNext !== undefined && (
                              <div style={{ fontSize: 11 }}>
                                {f.monthsToNext >= 0
                                  ? `fra ${f.monthsToNext} mesi`
                                  : `${-f.monthsToNext} mesi indietro`}
                              </div>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button style={{ fontSize: 11, padding: '3px 8px' }}>Apri</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {ritirati > 0 && (
          <label
            className="planner-check"
            style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}
          >
            <input
              type="checkbox"
              data-check="ritirati"
              checked={mostraRitirati}
              onChange={(e) => setMostraRitirati(e.target.checked)}
            />
            <span>
              Mostra anche {ritirati} {ritirati === 1 ? 'pezzo ritirato' : 'pezzi ritirati'}
            </span>
          </label>
        )}
      </div>

      {/*
       * `key` NON è decorativo qui.
       *
       * La scheda copia l'oggetto in uno `useState` iniziale, e uno stato
       * iniziale si legge UNA VOLTA SOLA: al montaggio. Senza `key`, chi apre un
       * erogatore, lo chiude e ne apre un altro resta con i campi del primo —
       * React vede lo stesso componente nella stessa posizione e non rimonta
       * niente. Il titolo, che leggeva la prop, mostrava però il nome nuovo: due
       * pezzi diversi nello stesso riquadro, e il «Salva» scriveva sull'id
       * sbagliato. Con la chiave legata all'id, cambiare pezzo è un montaggio
       * nuovo e la bozza riparte dai dati giusti.
       */}
      {bozzaAttrezzo && (
        <SchedaAttrezzo
          key={bozzaAttrezzo.id}
          item={bozzaAttrezzo}
          onSave={salvaAttrezzo}
          onDelete={eliminaAttrezzo}
          onCancel={() => apriAttrezzo(null)}
        />
      )}

      {/* ------------------------------------------------------- 2. i brevetti */}
      <div className="card">
        <div className="spread" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>Brevetti</h2>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              Non hanno una scadenza e non si revisionano: dicono fino a dove sei addestrato. Il livello che
              scegli qui è l'unica cosa che l'applicazione legge — i nomi commerciali delle didattiche sono
              decine e non si possono mettere in fila.
            </p>
          </div>
          <button
            className="btn"
            onClick={() => apriBrevetto({ id: nuovoId(), agency: '', name: '', level: 'base' })}
          >
            Aggiungi
          </button>
        </div>

        {brevetti.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Nessun brevetto registrato. Serve per una cosa sola, ma concreta: la scheda di prontezza dei{' '}
            <b>Suggerimenti</b> confronta le tue immersioni con i prerequisiti del passo successivo, e senza
            sapere da dove parti non può dire quanto manca.
          </p>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Brevetto</th>
                    <th>Didattica</th>
                    <th>Livello</th>
                    <th>Data</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {brevetti.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => apriBrevetto(c)}>
                      <td>
                        <div style={{ fontWeight: 550 }}>{c.name || 'senza nome'}</div>
                        {(c.number || c.instructor) && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {[c.number, c.instructor].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {c.agency || '—'}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {CERT_LEVEL_LABEL[c.level]}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {c.issuedOn ? dateShort(c.issuedOn) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button style={{ fontSize: 11, padding: '3px 8px' }}>Apri</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {livello && (
              <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
                Livello più alto registrato: <b>{CERT_LEVEL_LABEL[livello]}</b>.
              </p>
            )}
          </>
        )}
      </div>

      {bozzaBrevetto && (
        <SchedaBrevetto
          key={bozzaBrevetto.id}
          item={bozzaBrevetto}
          onSave={salvaBrevetto}
          onDelete={eliminaBrevetto}
          onCancel={() => apriBrevetto(null)}
        />
      )}

      {/* ------------------------------------------ 3. zavorra e configurazione */}
      <div className="card">
        <h2>Zavorra e configurazione</h2>
        <p className="card-sub">
          Questa sezione non si compila: viene dalle immersioni, che portano già muta e chili. E sta accanto
          all'oscillazione d'assetto misurata sul profilo, perché la domanda vera non è «quanti chili ho
          usato» ma «con quanti chili tengo meglio la quota».
        </p>

        {zavorra.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Nessuna immersione porta insieme la muta e la zavorra. Sono due campi che i computer non
            registrano quasi mai: si scrivono nella scheda dell'immersione, e da due immersioni con la stessa
            muta questa tabella comincia a dire qualcosa.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Muta</th>
                  <th className="num">Zavorra mediana</th>
                  <th className="num">Intervallo</th>
                  <th className="num">Assetto</th>
                  {/*
                   * «Con zavorra», non «Immersioni»: qui contano solo quelle in
                   * cui i chili sono scritti, perché senza non c'è mediana da
                   * fare. Nell'inventario, sopra, la stessa muta ha un numero
                   * più alto — sono le immersioni fatte con lei, zavorra o no —
                   * e finché le due colonne si chiamavano allo stesso modo la
                   * differenza sembrava un errore di conto.
                   */}
                  <th className="num">Con zavorra</th>
                </tr>
              </thead>
              <tbody>
                {zavorra.map((r) => (
                  <tr key={r.suit}>
                    <td style={{ fontWeight: 550 }}>{r.suit}</td>
                    <td className="num tabular">{r.medianKg} kg</td>
                    <td className="num tabular muted">
                      {r.minKg === r.maxKg ? 'sempre uguale' : `${r.minKg}–${r.maxKg} kg`}
                    </td>
                    <td className="num tabular">
                      {r.medianTrimMpm !== undefined ? (
                        <>
                          {r.medianTrimMpm.toFixed(1)} m/min
                          <div className="muted" style={{ fontSize: 11 }}>
                            {r.medianTrimMpm <= LIMITS.goodTrimMpm
                              ? 'quota tenuta bene'
                              : 'quota da migliorare'}
                            {` · su ${r.trimBasis}`}
                          </div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num tabular muted">{r.dives}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {configurazioni.length > 0 && (
          <>
            <div className="finding-section-label" style={{ marginTop: 16 }}>
              Configurazione, contata sui log
            </div>
            <p className="planner-hint" style={{ marginTop: 0 }}>
              Ricavata dal numero di bombole registrate e dalla modalità. È grossolana di proposito:
              distinguere un bibombola da due mono in sidemount guardando il log non si può, e inventare la
              distinzione sarebbe peggio che ammetterlo.
            </p>
            <table>
              <tbody>
                {configurazioni.map((c) => (
                  <tr key={c.label}>
                    <td>{c.label}</td>
                    <td className="num tabular">{imm(c.dives)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Campo({
  etichetta,
  unita,
  children,
}: {
  etichetta: string;
  unita?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="stack" style={{ gap: 4, fontSize: 12 }}>
      <span className="muted">
        {etichetta} {unita && <span className="muted">({unita})</span>}
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
function BottoniScheda({
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
  const [conferma, setConferma] = useState(false);
  return (
    <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
      <button className="btn" onClick={onSave} disabled={salvabile === false}>
        Salva
      </button>
      {salvabile === false && (
        <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
          Serve un nome.
        </span>
      )}
      <button onClick={onCancel}>Annulla</button>
      <span style={{ flex: 1 }} />
      {conferma ? (
        <>
          <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
            Elimino {cosa}? Non si recupera.
          </span>
          <button onClick={() => setConferma(false)}>No</button>
          <button onClick={onDelete} style={{ color: 'var(--critical)' }}>
            Sì, elimina
          </button>
        </>
      ) : (
        <button onClick={() => setConferma(true)} style={{ color: 'var(--critical)' }}>
          Elimina
        </button>
      )}
    </div>
  );
}

function SchedaAttrezzo({
  item,
  onSave,
  onDelete,
  onCancel,
}: {
  item: Equipment;
  onSave: (item: Equipment) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Equipment>(item);
  const set = <K extends keyof Equipment>(k: K, v: Equipment[K]) => setD((p) => ({ ...p, [k]: v }));

  return (
    <div className="card">
      <h2>{d.name || 'Nuovo pezzo'}</h2>
      <div className="grid grid-3" style={{ marginBottom: 8 }}>
        <Campo etichetta="Tipo">
          <select
            value={d.kind}
            onChange={(e) => {
              // Cambiando tipo si propongono la manutenzione e l'intervallo
              // tipici, ma solo come punto di partenza: restano modificabili,
              // perché il libretto del costruttore vince su qualunque tabella.
              //
              // Volume e pressione d'esercizio si vedono SOLO sulle bombole, ma
              // restavano nell'oggetto anche dopo il cambio di tipo: un erogatore
              // che era stato per un istante una bombola si salvava con «12 L ·
              // 232 bar» attaccati, invisibili nel modulo e ben visibili nella
              // riga dell'elenco. Un campo che sparisce dallo schermo deve
              // sparire anche dal dato.
              const kind = e.target.value as EquipmentKind;
              setD((p) => ({
                ...p,
                kind,
                service: TYPICAL_SERVICE[kind],
                intervalMonths: TYPICAL_INTERVAL_MONTHS[kind],
                sizeL: kind === 'cylinder' ? p.sizeL : undefined,
                workingBar: kind === 'cylinder' ? p.workingBar : undefined,
                // Come sopra: i pesi della piastra restano solo se il pezzo è
                // ancora un GAV, altrimenti si porterebbero dietro tre chili
                // invisibili su un erogatore.
                plateKg: kind === 'bcd' ? p.plateKg : undefined,
                backplateKg: kind === 'bcd' ? p.backplateKg : undefined,
              }));
            }}
          >
            {(Object.keys(EQUIPMENT_LABEL) as EquipmentKind[]).map((k) => (
              <option key={k} value={k}>
                {EQUIPMENT_LABEL[k]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etichetta="Marca e modello">
          <input type="text" value={d.name} onChange={(e) => set('name', e.target.value)} />
        </Campo>
        <Campo etichetta="Matricola">
          <input
            type="text"
            value={d.serial ?? ''}
            onChange={(e) => set('serial', e.target.value || undefined)}
          />
        </Campo>
      </div>

      {d.kind === 'cylinder' && (
        <div className="grid grid-3" style={{ marginBottom: 8 }}>
          <Campo etichetta="Volume" unita="L">
            <input
              type="text"
              inputMode="decimal"
              step="0.5"
              value={d.sizeL ?? ''}
              onChange={(e) => set('sizeL', numeroDaTesto(e.target.value))}
            />
          </Campo>
          <Campo etichetta="Pressione di esercizio" unita="bar">
            <input
              type="text"
              inputMode="decimal"
              step="10"
              value={d.workingBar ?? ''}
              onChange={(e) => set('workingBar', numeroDaTesto(e.target.value))}
            />
          </Campo>
          <div />
        </div>
      )}

      {d.kind === 'bcd' && (
        <>
          <div className="grid grid-3" style={{ marginBottom: 4 }}>
            <Campo etichetta="Piastra" unita="kg">
              <input
                type="text"
                inputMode="decimal"
                step="0.1"
                value={d.plateKg ?? ''}
                onChange={(e) => set('plateKg', numeroDaTesto(e.target.value))}
              />
            </Campo>
            <Campo etichetta="Contropiastra o schienalino" unita="kg">
              <input
                type="text"
                inputMode="decimal"
                step="0.1"
                value={d.backplateKg ?? ''}
                onChange={(e) => set('backplateKg', numeroDaTesto(e.target.value))}
              />
            </Campo>
            <div />
          </div>
          {/*
           * PERCHÉ IL PESO STA SUL GAV E NON SOLO SULL'IMMERSIONE.
           *
           * Perché è una proprietà del pezzo, non della giornata: una piastra
           * d'acciaio pesa tre chili oggi come fra due anni. Scritta qui una
           * volta, ogni immersione fatta con questo GAV se la ritrova già
           * compilata — e l'alternativa è ridigitarla ogni volta, cioè non
           * scriverla mai e lasciare la tabella della zavorra a metà.
           */}
          <p className="muted" style={{ fontSize: 11, margin: '0 0 12px' }}>
            {pesoDelGav(d) !== undefined
              ? `Questo GAV aggiunge ${pesoDelGav(d)} kg, che vengono proposti come piastra sulle immersioni in cui lo scegli e si sommano alla zavorra. Sull'immersione puoi sempre cambiarli: la configurazione si cambia, la piastra d'alluminio per il viaggio e quella d'acciaio a casa.`
              : 'Due campi separati perché sono due pezzi che si cambiano indipendentemente. La somma viene proposta come piastra sulle immersioni fatte con questo GAV, e si somma alla zavorra dove si ragiona di assetto.'}
          </p>
        </>
      )}

      <div className="grid grid-3" style={{ marginBottom: 8 }}>
        <Campo etichetta="Manutenzione">
          <select
            value={d.service}
            onChange={(e) => {
              // Idem per la manutenzione: con «nessuna» le due date sparirebbero
              // dal modulo restando nel record, e la colonna «Ultima»
              // dell'elenco continuerebbe a mostrarle.
              const service = e.target.value as ServiceKind;
              setD((p) => ({
                ...p,
                service,
                lastServiceOn: service === 'none' ? undefined : p.lastServiceOn,
                intervalMonths: service === 'none' ? undefined : p.intervalMonths,
              }));
            }}
          >
            {(Object.keys(SERVICE_LABEL) as ServiceKind[]).map((k) => (
              <option key={k} value={k}>
                {SERVICE_LABEL[k]}
              </option>
            ))}
          </select>
        </Campo>
        {d.service !== 'none' ? (
          <>
            <Campo etichetta="Ultima fatta">
              <input
                type="date"
                value={d.lastServiceOn ?? ''}
                onChange={(e) => set('lastServiceOn', e.target.value || undefined)}
              />
            </Campo>
            <Campo etichetta="Ogni quanti mesi">
              <input
                type="text"
                inputMode="decimal"
                min={0}
                value={d.intervalMonths ?? ''}
                onChange={(e) => set('intervalMonths', numeroDaTesto(e.target.value))}
              />
            </Campo>
          </>
        ) : (
          <>
            <Campo etichetta="Comprato il">
              <input
                type="date"
                value={d.boughtOn ?? ''}
                onChange={(e) => set('boughtOn', e.target.value || undefined)}
              />
            </Campo>
            <div />
          </>
        )}
      </div>

      <Campo etichetta="Note">
        <textarea
          rows={2}
          value={d.notes ?? ''}
          onChange={(e) => set('notes', e.target.value || undefined)}
        />
      </Campo>

      <label
        className="planner-check"
        style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}
      >
        <input
          type="checkbox"
          checked={!!d.retired}
          onChange={(e) => set('retired', e.target.checked || undefined)}
        />
        <span>Non lo uso più (resta in archivio, fuori dall'elenco)</span>
      </label>

      <BottoniScheda
        cosa={d.name ? `«${d.name}»` : 'questo pezzo'}
        salvabile={!!d.name?.trim()}
        onSave={() => onSave(d)}
        onCancel={onCancel}
        onDelete={() => onDelete(d.id)}
      />
    </div>
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
  const [d, setD] = useState<Certification>(item);
  const set = <K extends keyof Certification>(k: K, v: Certification[K]) => setD((p) => ({ ...p, [k]: v }));

  return (
    <div className="card">
      <h2>{d.name || 'Nuovo brevetto'}</h2>
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
                {CERT_LEVEL_LABEL[k]}
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
        cosa={d.name ? `«${d.name}»` : 'questo brevetto'}
        salvabile={!!d.name?.trim()}
        onSave={() => onSave(d)}
        onCancel={onCancel}
        onDelete={() => onDelete(d.id)}
      />
    </div>
  );
}
