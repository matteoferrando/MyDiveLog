/**
 * Attrezzatura e zavorra.
 *
 * Due sezioni e non un elenco unico, perché sono due cose che si consultano in
 * momenti diversi: l'attrezzatura prima di andare al centro ricarica, la zavorra
 * quando cambi muta.
 *
 * I BREVETTI SE NE SONO ANDATI, ad agosto 2026, e vale la pena dire perché: qui
 * ci stavano solo per forma — erano una lista di record con una data, come le
 * bombole — ma non c'entravano niente. L'attrezzatura è quello che porti in
 * acqua e che si revisiona; un brevetto non si revisiona, non scade e non lo
 * porti in acqua: dice chi sei, e il posto dove serve è il libretto. Ora stanno
 * nelle Impostazioni, sotto la carta che compone il libretto, in
 * `components/Brevetti.tsx`.
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
  EQUIPMENT_LABEL,
  SERVICE_LABEL,
  TYPICAL_INTERVAL_MONTHS,
  TYPICAL_SERVICE,
  configurationRows,
  serviceFacts,
  sortEquipment,
  equipmentUsage,
  pesoDelGav,
  weightingBySuit,
  type Equipment,
  type EquipmentKind,
  type ServiceKind,
} from '../../core/analysis/gear';
import { LIMITS } from '../../core/model';
import { useDiveLog } from '../state';
import { dateShort, imm, plural } from '../format';
import { useLingua } from '../lingua';
import { usePortaInVista } from '../scorri';
import { BottoniScheda, Campo, nuovoId } from '../components/moduli';

export function Gear() {
  const { gear, saveGear, dives } = useDiveLog();
  const { t } = useLingua();
  const [bozzaAttrezzo, setBozzaAttrezzo] = useState<Equipment | null>(null);
  const [mostraRitirati, setMostraRitirati] = useState(false);

  const attrezzi = useMemo(() => sortEquipment(gear.equipment), [gear.equipment]);
  const uso = useMemo(() => equipmentUsage(dives, gear.equipment), [dives, gear.equipment]);
  const visibili = mostraRitirati ? attrezzi : attrezzi.filter((a) => !a.retired);
  const ritirati = attrezzi.filter((a) => a.retired).length;
  // L'inventario serve a recuperare il peso della piastra sulle immersioni che
  // hanno il GAV ma non i chili scritti sopra. Vedi `piastraDellImmersione`.
  const zavorra = useMemo(() => weightingBySuit(dives, 2, gear.equipment), [dives, gear.equipment]);
  const configurazioni = useMemo(() => configurationRows(dives), [dives]);

  const salvaAttrezzo = (item: Equipment) => {
    const esiste = gear.equipment.some((g) => g.id === item.id);
    void saveGear({
      ...gear,
      equipment: esiste
        ? gear.equipment.map((g) => (g.id === item.id ? item : g))
        : [...gear.equipment, item],
    });
    setBozzaAttrezzo(null);
  };
  const eliminaAttrezzo = (id: string) => {
    void saveGear({ ...gear, equipment: gear.equipment.filter((g) => g.id !== id) });
    setBozzaAttrezzo(null);
  };

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">{t('Attrezzatura')}</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {t('Un archivio, non un promemoria: nessun avviso, nessuna scadenza che lampeggia.')}
        </span>
      </div>

      {/* ---------------------------------------------- 1. cosa porti in acqua */}
      <div className="card">
        <div className="spread" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>{t('Quello che porti in acqua')}</h2>
            {/*
             * La riga sotto spiegava anche da dove viene ogni scadenza: il
             * collaudo idraulico dalla normativa, la revisione dal libretto del
             * costruttore. È la ragione per cui l'intervallo è modificabile pezzo
             * per pezzo invece di essere fisso, e sta scritta qui perché serve a
             * chi tocca il codice, non a chi apre la scheda.
             */}
            <p className="card-sub" style={{ marginBottom: 0 }}>
              {t('Bombole, erogatori, sacco, computer, muta. L’intervallo di manutenzione lo decidi tu.')}
            </p>
          </div>
          <button
            className="btn"
            onClick={() =>
              setBozzaAttrezzo({
                id: nuovoId(),
                kind: 'regulator',
                name: '',
                service: 'overhaul',
                intervalMonths: 12,
              })
            }
          >
            {t('Aggiungi')}
          </button>
        </div>

        {visibili.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            {t(
              'Niente ancora. Comincia dalla bombola: matricola e data del collaudo sono quelle che ti chiedono al centro ricarica.',
            )}
          </p>
        ) : (
          /*
           * SUL TELEFONO QUESTA TABELLA NON SCORRE PIÙ DI LATO.
           *
           * Sette colonne su 390 px non ci stanno in nessun modo, e uno
           * scorrimento orizzontale dentro una pagina che scorre in verticale è
           * la cosa peggiore da toccare col pollice: si perde la colonna del
           * nome appena si guarda una data, e per tornare indietro bisogna
           * trascinare al contrario. `.tabella-adattiva` fa diventare ogni riga
           * una scheda con le etichette accanto ai valori — è per quello che ogni
           * cella porta un `data-eti`. Vedi il foglio di stile.
           */
          <div className="tabella-adattiva">
            <table>
              <thead>
                <tr>
                  <th>{t('Pezzo')}</th>
                  <th>{t('Matricola')}</th>
                  <th className="num">{t('Immersioni')}</th>
                  <th>{t('Manutenzione')}</th>
                  <th>{t('Ultima')}</th>
                  <th>{t('Prossima')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibili.map((a) => {
                  const f = serviceFacts(a);
                  return (
                    <tr key={a.id} className="clickable" onClick={() => setBozzaAttrezzo(a)}>
                      <td className="cella-titolo">
                        <div style={{ fontWeight: 550 }}>
                          {a.name || t('senza nome')}{' '}
                          {a.retired && <span className="muted">· {t('ritirato')}</span>}
                        </div>
                        {/* `EQUIPMENT_LABEL` e `SERVICE_LABEL` sono costanti del
                            cuore dell'applicazione: restano italiane lì e si
                            traducono qui, al disegno. */}
                        <div className="muted" style={{ fontSize: 11 }}>
                          {t(EQUIPMENT_LABEL[a.kind])}
                          {a.sizeL ? ` · ${a.sizeL} L` : ''}
                          {a.workingBar ? ` · ${a.workingBar} bar` : ''}
                        </div>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }} data-eti={t('Matricola')}>
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
                      <td className="num tabular" style={{ fontSize: 12 }} data-eti={t('Immersioni')}>
                        {(uso.get(a.id)?.dives ?? 0) === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          <>
                            {uso.get(a.id)?.dives}
                            {uso.get(a.id)?.divesSinceService !== undefined && (
                              <div className="muted" style={{ fontSize: 11 }}>
                                {uso.get(a.id)?.divesSinceService} {t('dall’ultima')}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }} data-eti={t('Manutenzione')}>
                        {t(SERVICE_LABEL[a.service])}
                        {a.service !== 'none' && a.intervalMonths
                          ? ` · ${t('ogni')} ${plural(a.intervalMonths, 'mese', 'mesi', t)}`
                          : ''}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }} data-eti={t('Ultima')}>
                        {a.lastServiceOn ? (
                          <>
                            {dateShort(a.lastServiceOn)}
                            {f.monthsSince !== undefined && (
                              <div style={{ fontSize: 11 }}>
                                {f.monthsSince === 0
                                  ? t('questo mese')
                                  : `${plural(f.monthsSince, 'mese', 'mesi', t)} ${t('fa')}`}
                              </div>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      {/* Nessun colore e nessun pallino: è una data, non un verdetto. */}
                      <td className="muted tabular" style={{ fontSize: 12 }} data-eti={t('Prossima')}>
                        {f.nextOn ? (
                          <>
                            {dateShort(f.nextOn)}
                            {f.monthsToNext !== undefined && (
                              <div style={{ fontSize: 11 }}>
                                {f.monthsToNext >= 0
                                  ? `${t('fra')} ${plural(f.monthsToNext, 'mese', 'mesi', t)}`
                                  : `${plural(-f.monthsToNext, 'mese', 'mesi', t)} ${t('indietro')}`}
                              </div>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="cella-azione" style={{ textAlign: 'right' }}>
                        <button style={{ fontSize: 11, padding: '3px 8px' }}>{t('Apri')}</button>
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
              {t('Mostra anche')} {plural(ritirati, 'pezzo ritirato', 'pezzi ritirati', t)}
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
          onCancel={() => setBozzaAttrezzo(null)}
        />
      )}

      {/* ---------------------------------------------- 2. zavorra e configurazione */}
      <div className="card">
        <h2>{t('Zavorra e configurazione')}</h2>
        {/*
         * Perché la zavorra sta accanto all'oscillazione d'assetto: la domanda
         * vera non è «quanti chili ho usato» ma «con quanti chili tengo meglio
         * la quota». È la ragione della colonna «Assetto», e sta qui perché a
         * schermo era un paragrafo che nessuno legge due volte.
         */}
        <p className="card-sub">
          {t('Non si compila: viene dalle immersioni, che portano già muta e chili.')}
        </p>

        {zavorra.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            {t(
              'Nessuna immersione ha insieme muta e zavorra. Scrivile nella scheda dell’immersione: da due in poi questa tabella dice qualcosa.',
            )}
          </p>
        ) : (
          <div className="tabella-adattiva">
            <table>
              <thead>
                <tr>
                  <th>{t('Muta')}</th>
                  <th className="num">{t('Zavorra mediana')}</th>
                  <th className="num">{t('Intervallo')}</th>
                  <th className="num">{t('Assetto')}</th>
                  {/*
                   * «Con zavorra», non «Immersioni»: qui contano solo quelle in
                   * cui i chili sono scritti, perché senza non c'è mediana da
                   * fare. Nell'inventario, sopra, la stessa muta ha un numero
                   * più alto — sono le immersioni fatte con lei, zavorra o no —
                   * e finché le due colonne si chiamavano allo stesso modo la
                   * differenza sembrava un errore di conto.
                   */}
                  <th className="num">{t('Con zavorra')}</th>
                </tr>
              </thead>
              <tbody>
                {zavorra.map((r) => (
                  <tr key={r.suit}>
                    <td className="cella-titolo" style={{ fontWeight: 550 }}>
                      {r.suit}
                    </td>
                    <td className="num tabular" data-eti={t('Zavorra mediana')}>
                      {r.medianKg} kg
                    </td>
                    <td className="num tabular muted" data-eti={t('Intervallo')}>
                      {r.minKg === r.maxKg ? t('sempre uguale') : `${r.minKg}–${r.maxKg} kg`}
                    </td>
                    <td className="num tabular" data-eti={t('Assetto')}>
                      {r.medianTrimMpm !== undefined ? (
                        <>
                          {r.medianTrimMpm.toFixed(1)} m/min
                          <div className="muted" style={{ fontSize: 11 }}>
                            {t(
                              r.medianTrimMpm <= LIMITS.goodTrimMpm
                                ? 'quota tenuta bene'
                                : 'quota da migliorare',
                            )}
                            {` · ${t('su')} ${r.trimBasis}`}
                          </div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num tabular muted" data-eti={t('Con zavorra')}>
                      {r.dives}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {configurazioni.length > 0 && (
          <>
            <div className="finding-section-label" style={{ marginTop: 16 }}>
              {t('Configurazione, contata sui log')}
            </div>
            {/*
             * È grossolana di proposito: distinguere un bibombola da due mono in
             * sidemount guardando il log non si può, e inventare la distinzione
             * sarebbe peggio che ammetterlo. A schermo basta dire da dove viene
             * il conto.
             */}
            <p className="planner-hint" style={{ marginTop: 0 }}>
              {t('Ricavata dal numero di bombole registrate e dalla modalità.')}
            </p>
            <table>
              <tbody>
                {configurazioni.map((c) => (
                  <tr key={c.label}>
                    {/* Le etichette fisse («Una bombola», «Rebreather a circuito
                        chiuso») stanno nel dizionario; quelle con dentro un
                        numero — «4 bombole» — restano italiane, perché una
                        chiave per ogni numero non è una traduzione. */}
                    <td>{t(c.label)}</td>
                    <td className="num tabular">{imm(c.dives, t)}</td>
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
  const { t } = useLingua();
  const [d, setD] = useState<Equipment>(item);
  const set = <K extends keyof Equipment>(k: K, v: Equipment[K]) => setD((p) => ({ ...p, [k]: v }));
  const rif = usePortaInVista<HTMLDivElement>();

  return (
    <div className="card" ref={rif}>
      <h2>{d.name || t('Nuovo pezzo')}</h2>
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
                {t(EQUIPMENT_LABEL[k])}
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
           *
           * Due campi e non uno perché piastra e contropiastra si cambiano
           * indipendentemente: quella d'alluminio per il viaggio, quella
           * d'acciaio a casa. Sull'immersione il valore proposto resta
           * modificabile, ed è per questo che qui si dice «proposti».
           */}
          <p className="muted" style={{ fontSize: 11, margin: '0 0 12px' }}>
            {pesoDelGav(d) !== undefined
              ? `${t('Questo GAV aggiunge')} ${pesoDelGav(d)} kg. ${t('Vengono proposti come piastra sulle immersioni in cui lo scegli, e li puoi cambiare lì.')}`
              : t('La somma viene proposta come piastra sulle immersioni fatte con questo GAV.')}
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
                {t(SERVICE_LABEL[k])}
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
        <span>{t('Non lo uso più (resta in archivio, fuori dall’elenco)')}</span>
      </label>

      <BottoniScheda
        cosa={d.name ? `«${d.name}»` : t('questo pezzo')}
        salvabile={!!d.name?.trim()}
        onSave={() => onSave(d)}
        onCancel={onCancel}
        onDelete={() => onDelete(d.id)}
      />
    </div>
  );
}
