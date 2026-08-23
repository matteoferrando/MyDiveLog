/**
 * Configurazione e uso del database condiviso (Turso / libSQL).
 *
 * Due cose, separate di proposito: l'accesso si fa una volta, la
 * sincronizzazione si lancia quando si vuole. Non c'è nessuna sincronizzazione
 * automatica all'avvio, e non è una mancanza: un logbook si apre anche in barca,
 * dove la rete non c'è, e un'app che all'apertura aspetta la rete è un'app che in
 * barca non si apre.
 *
 * L'ORDINE DELLA PAGINA È UNA DICHIARAZIONE. Prima l'accesso, poi il pulsante
 * per sincronizzare, e solo dopo — chiuso dentro «Avanzate» — il campo dove si
 * incollano indirizzo e token. Finché i due riquadri stavano affiancati
 * sembrava ci fosse una scelta da compiere; la scelta giusta invece è una sola,
 * e l'altra strada resta aperta per il giorno che la prima non funziona.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { esporta } from '../esporta';
import { suIOS } from '../../piattaforma';
import { useDiveLog } from '../state';
import { useLingua } from '../lingua';
import {
  cercaAggiornamento,
  descriviScaricamento,
  installaAggiornamento,
  type StatoAggiornamento,
  suMac,
} from '../../aggiornamento/aggiornamento';
import { TRASH_DAYS, TRASH_SOFT_LIMIT, daysLeft, sortTrash } from '../../storage/trash';
import { formatDuration } from '../../core/units';
import { dateShort, imm, plural } from '../format';
import {
  backupFileName,
  checkBackup,
  planRestore,
  restoreBlockers,
  type BackupFile,
  type RestorePlan,
} from '../../core/export/backup';
import type { Fornitore } from '../../sync/account';
import type { SyncReport } from '../../sync/turso';
import type { AiModel } from '../../ai/client';
import { BottoneConferma } from '../components/Conferma';

export function SyncPage() {
  const {
    dives,
    accountAttivo,
    syncCredentials,
    saveSyncCredentials,
    testSync,
    syncNow,
    storeLocation,
    aiCredentials,
    saveAiCredentials,
    testAiKey,
    exportArchive,
  } = useDiveLog();
  const { t, lingua } = useLingua();
  const [exporting, setExporting] = useState(false);
  /**
   * L'esito dell'ultima esportazione.
   *
   * `quante` è la frase INTERA — participio compreso — e non un numero, per due
   * ragioni che si sommano. La prima: le quattro esportazioni non contano la
   * stessa cosa. L'UDDF e il CSV contano immersioni, il KML conta SITI, e con un
   * numero solo la mappa dei sette siti confermava «7 immersioni esportate» su
   * un archivio di cinquanta — un numero giusto accanto alla parola sbagliata.
   * La seconda: in italiano il participio concorda con il genere, «7 siti
   * esportate» è sbagliato, e il pezzo che sa quale nome sta usando è chi compone
   * la frase, non chi la mostra.
   */
  const [exported, setExported] = useState<{ quante: string; omitted: string[]; dove: string } | null>(null);
  const [url, setUrl] = useState(syncCredentials?.url ?? '');
  const [token, setToken] = useState(syncCredentials?.authToken ?? '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const configured = Boolean(syncCredentials);
  const dirty = url.trim() !== (syncCredentials?.url ?? '') || token !== (syncCredentials?.authToken ?? '');
  /*
   * Si può sincronizzare per due strade, e all'interfaccia interessa solo se ce
   * n'è una aperta. L'account ha la precedenza (lo decide `syncNow`), quindi chi
   * è entrato con Google può premere Sincronizza anche con il campo manuale
   * vuoto — che è esattamente il caso normale da quando l'accesso esiste.
   */
  const pronto = accountAttivo || configured;

  const save = async () => {
    setTestResult(null);
    const trimmed = url.trim();
    if (!trimmed || !token.trim()) {
      await saveSyncCredentials(null);
      return;
    }
    await saveSyncCredentials({ url: trimmed, authToken: token.trim() });
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testSync({ url: url.trim(), authToken: token.trim() });
      setTestResult(result.ok ? { ok: true } : { ok: false, error: result.error });
    } finally {
      setTesting(false);
    }
  };

  /**
   * Il giro di ogni esportazione, scritto una volta.
   *
   * Le quattro esportazioni facevano la stessa danza — accendi «preparo»,
   * azzera l'esito, prova, scrivi l'errore, spegni — e la copiavano ognuna per
   * sé. Non è solo ripetizione: il `void` più il `catch` sono lì per un motivo
   * preciso, e in una copia dimenticata un export fallito diventa una promessa
   * scartata, cioè un pulsante che sembra non fare niente.
   */
  const scarica = (lavoro: () => Promise<{ quante: string; omitted: string[]; dove: string }>) => {
    void (async () => {
      setExporting(true);
      setExported(null);
      setError(null);
      try {
        setExported(await lavoro());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setExporting(false);
      }
    })();
  };

  const run = async () => {
    setBusy(true);
    setLog([]);
    setReport(null);
    setError(null);
    try {
      const result = await syncNow((m) => setLog((prev) => [...prev, m]));
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">{t('Impostazioni')}</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {imm(dives.length, t)} {t('in archivio')} · {t(storeLocation)}
        </span>
      </div>

      <AccountCard />

      <AggiornamentoCard />

      <div className="card">
        <h2>{t('Sincronizza ora')}</h2>
        {/*
         * COSA FA DAVVERO IL GIRO, detto qui e non a schermo: prima scarica e
         * poi carica, e non cancella mai niente. Le due copie si completano a
         * vicenda campo per campo — vince il riepilogo più recente e il profilo
         * più ricco, anche quando arrivano da dispositivi diversi. A chi preme
         * il pulsante serve sapere che non perde niente; il come è affare di
         * `syncNow`.
         */}
        <p className="card-sub">{t('Prima scarica, poi carica. Niente viene cancellato.')}</p>
        <div className="row">
          <button
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={busy || !pronto || (!accountAttivo && dirty)}
          >
            {busy ? t('Sincronizzazione in corso…') : t('Sincronizza')}
          </button>
          {!pronto && (
            <span className="muted" style={{ fontSize: 12 }}>
              {t('Accedi qui sopra e il pulsante si accende.')}
            </span>
          )}
          {/*
           * L'avviso sulle credenziali non salvate riguarda SOLO chi sincronizza
           * col campo manuale. A chi è entrato con l'account non si parla di
           * credenziali da salvare: non ne ha, e sarebbe un avviso su una cosa
           * che non lo tocca.
           */}
          {!accountAttivo && configured && dirty && (
            <span className="muted" style={{ fontSize: 12 }}>
              {t('Salva le credenziali prima di sincronizzare.')}
            </span>
          )}
        </div>

        {log.length > 0 && (
          <ul style={{ margin: '14px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)' }}>
            {log.map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ul>
        )}

        {error && <p style={{ marginTop: 12, fontSize: 13, color: 'var(--critical)' }}>{error}</p>}

        {report && (
          <table style={{ marginTop: 14 }}>
            <tbody>
              {/*
               * Le etichette restano in italiano qui e si traducono dentro
               * `Row`: sono frasi fisse, tradurle nel punto di disegno tiene le
               * chiamate leggibili — si vede cosa c'è scritto in tabella senza
               * saltare da nessuna parte — e concentra la traduzione in un
               * punto solo. Il `value` no: è un numero, o un numero più una
               * parola, e va composto qui.
               */}
              <Row label="Caricate" value={report.pushed} />
              <Row label="Scaricate" value={report.pulled} />
              <Row label="Profili caricati" value={report.pushedProfiles} />
              <Row label="Profili scaricati" value={report.pulledProfiles} />
              <Row label="Già allineate" value={report.plan.unchanged} />
              <Row
                label="Impostazioni condivise"
                value={`${report.settingsPushed} ${t('caricate')}, ${report.settingsPulled} ${t('scaricate')}`}
              />
              <Row label="Immersioni in archivio" value={report.total} />
              <Row label="Durata" value={`${(report.durationMs / 1000).toFixed(1)} s`} />
            </tbody>
          </table>
        )}
        {/*
         * Le impostazioni che non si sono allineate si DICHIARANO.
         *
         * Un'impostazione che non viaggia assomiglia in tutto e per tutto a
         * un'impostazione che non è mai cambiata: senza questa riga, la
         * differenza fra i due dispositivi si scopre settimane dopo, guardando
         * un numero che non torna.
         */}
        {report && report.settingsErrors.length > 0 && (
          <div className="notice notice-error" role="alert" style={{ marginTop: 12 }}>
            <b>{t('Queste impostazioni non si sono allineate.')}</b>{' '}
            {t('Le immersioni sì. Riprova, e se l’errore torna segnalalo.')}
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {report.settingsErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/*
       * IL CAMPO MANUALE È FINITO QUI SOTTO, E NON È STATO TOLTO.
       *
       * Da quando c'è l'accesso, incollare indirizzo e token è la strada di
       * pochi: chi entra con Google un database ce l'ha già, creato dal
       * servizio. Tenere due riquadri di pari dignità faceva sembrare che ci
       * fosse una scelta da compiere, quando la scelta giusta è una sola.
       *
       * Ma toglierlo del tutto sarebbe stato un errore diverso e peggiore: il
       * giorno che il servizio di accesso è irraggiungibile e la sessione è
       * scaduta, senza questo campo non si sincronizza in nessun modo, e
       * l'unico rimedio sarebbe ricompilare l'applicazione. Una via di scampo
       * che costa una riga di codice e un clic non si butta via per ordine.
       */}
      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          {t('Avanzate: collegare un database a mano')}
        </summary>
        {/*
         * Non è detto a schermo, ma è il motivo per cui i campi si lasciano
         * vuoti dopo l'accesso: le credenziali dell'account hanno comunque la
         * precedenza (lo decide `syncNow`), quindi quello che si incolla qui
         * verrebbe semplicemente ignorato.
         */}
        <p className="card-sub" style={{ marginTop: 12 }}>
          {t('Solo se il database te lo sei creato tu su Turso.')}{' '}
          <b>{t('Se hai fatto l’accesso, lascia questi campi vuoti.')}</b>
        </p>

        <div style={{ display: 'grid', gap: 12, maxWidth: 620 }}>
          <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('Indirizzo del database')}
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="libsql://nome-database-utente.regione.turso.io"
              spellCheck={false}
              autoComplete="off"
            />
          </label>

          <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('Token di accesso')}
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t('incolla qui il token di Turso')}
              spellCheck={false}
              autoComplete="off"
            />
            {/* Il token non è nel codice dell'applicazione e non passa da
             * nessun nostro servizio: dal campo va al negozio dei segreti di
             * questo dispositivo, e da lì solo a Turso. */}
            <span className="muted" style={{ fontSize: 11 }}>
              {t('Resta su questo dispositivo: va solo a Turso.')}
            </span>
          </label>
          <DoveStannoLeCredenziali />

          <div className="row">
            <button className="btn btn-primary" onClick={() => void save()} disabled={!dirty}>
              {configured ? t('Aggiorna credenziali') : t('Salva credenziali')}
            </button>
            <button
              className="btn"
              onClick={() => void test()}
              disabled={testing || !url.trim() || !token.trim()}
            >
              {testing ? t('Verifica…') : t('Prova la connessione')}
            </button>
            {configured && (
              <button
                className="btn btn-danger"
                onClick={() => {
                  setUrl('');
                  setToken('');
                  void saveSyncCredentials(null);
                }}
              >
                {t('Dimentica')}
              </button>
            )}
          </div>

          {testResult?.ok && (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              {t('Connessione riuscita.')}
            </p>
          )}
          {testResult && !testResult.ok && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--critical)' }}>{testResult.error}</p>
          )}
        </div>

        <h3 style={{ marginTop: 18 }}>{t('Come ottenere le credenziali')}</h3>
        {/* Un token per dispositivo è il consiglio giusto — se ne perdi uno
         * revochi solo quello — ma è un dettaglio da manuale: chi arriva qui la
         * prima volta ne genera comunque uno. */}
        <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13 }}>
          <li>
            {t('Su turso.tech apri il database e copia l’indirizzo')} <code>libsql://…</code>
          </li>
          <li>{t('Sempre lì, «Create Token»: compare una volta sola, copialo e incollalo qui sopra.')}</li>
          <li>{t('La prima sincronizzazione carica l’archivio; sugli altri dispositivi lo scarica.')}</li>
        </ol>
      </details>

      <ClaudeSettings credentials={aiCredentials} onSave={saveAiCredentials} onTest={testAiKey} />

      <TrashCard />

      <BackupCard />

      <div className="card">
        <h2>{t('Esporta l’archivio')}</h2>
        {/*
         * PERCHÉ L'UDDF NON È UN BACKUP, e perché lo diciamo qui in una riga.
         *
         * Il formato è lo standard che gli altri programmi leggono ed è lo
         * stesso che questa app importa: il giro si chiude e l'archivio non è
         * prigioniero di nessuno. Ma UDDF non sa esprimere una quindicina di
         * campi — modalità, compagno, voto, zavorra, muta, fuso, valori del
         * computer — e non porta niente di quello che sta fuori dalle
         * immersioni (attrezzatura, brevetti, piani, analisi). Chi vuole poter
         * tornare indietro usa il backup completo, non questo file.
         */}
        <p className="card-sub">
          {t('Tre strade per portare fuori le tue')} {imm(dives.length, t)}:{' '}
          {t('UDDF per un altro programma di immersioni, CSV per un foglio di calcolo, KML per una mappa.')}{' '}
          <b>{t('Non sono un backup')}</b>:{' '}
          {t('lasciano fuori parecchi campi. Per una copia completa usa il backup.')}
        </p>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            disabled={exporting || dives.length === 0}
            onClick={() =>
              scarica(async () => {
                const result = await exportArchive();
                const dove = await esporta(
                  `mydivelog-${new Date().toISOString().slice(0, 10)}.uddf`,
                  result.xml,
                );
                return {
                  quante: `${imm(result.dives, t)} ${t('esportate')}`,
                  omitted: result.omitted,
                  dove: dove.dove,
                };
              })
            }
          >
            {exporting ? t('Preparazione…') : t('Scarica UDDF')}
          </button>
          <button
            disabled={exporting || dives.length === 0}
            onClick={() =>
              scarica(async () => {
                const result = await exportArchive({ includeProfiles: false });
                const dove = await esporta(
                  `mydivelog-riepiloghi-${new Date().toISOString().slice(0, 10)}.uddf`,
                  result.xml,
                );
                return {
                  quante: `${imm(result.dives, t)} ${t('esportate')}`,
                  omitted: result.omitted,
                  dove: dove.dove,
                };
              })
            }
          >
            {t('Solo riepiloghi')}
          </button>
          {/*
           * CSV e KML stanno accanto all'UDDF, e non è disordine.
           *
           * Sono tre risposte a tre domande diverse: l'UDDF porta le immersioni
           * in un altro programma del settore, il CSV le porta in un foglio di
           * calcolo dove si può fare quello che questo programma non fa, il KML
           * porta i siti su una mappa vera. Metterli in tre schede separate
           * costringerebbe a cercare, quando la domanda di chi arriva qui è una
           * sola: «come porto fuori i miei dati».
           */}
          <button
            disabled={exporting || dives.length === 0}
            onClick={() =>
              scarica(async () => {
                const { esportaCsv } = await import('../../core/export/csv');
                /*
                 * Il separatore segue la lingua dell'interfaccia, e con lui il
                 * separatore decimale. Chi usa l'app in italiano ha quasi certamente
                 * un foglio italiano, che vuole il punto e virgola e la virgola nei
                 * decimali; chi la usa in inglese ha l'altra coppia. Sbagliare
                 * coppia non dà nessun errore: apre il file in una colonna sola,
                 * oppure fa entrare i numeri come testo.
                 */
                const { csv, righe } = esportaCsv(dives, {
                  separatore: lingua === 'it' ? ';' : ',',
                  lingua,
                });
                const dove = await esporta(
                  `mydivelog-${new Date().toISOString().slice(0, 10)}.csv`,
                  csv,
                  'text/csv;charset=utf-8',
                );
                return { quante: `${imm(righe, t)} ${t('esportate')}`, omitted: [], dove: dove.dove };
              })
            }
          >
            {t('Foglio di calcolo (CSV)')}
          </button>
          <button
            disabled={exporting || dives.length === 0}
            onClick={() =>
              scarica(async () => {
                const { esportaKml } = await import('../../core/export/kml');
                const { kml, siti, senzaCoordinate } = esportaKml(dives, { lingua });
                const dove = await esporta(
                  `mydivelog-siti-${new Date().toISOString().slice(0, 10)}.kml`,
                  kml,
                  'application/vnd.google-earth.kml+xml',
                );
                /*
                 * I siti senza coordinate entrano in `omitted`, cioè nella
                 * stessa riga che l'UDDF usa per dire cosa non è entrato. Senza,
                 * una mappa con quattro segnaposti su dodici siti sembra un
                 * difetto del programma invece che un dato che i formati di
                 * origine non contengono.
                 */
                return {
                  quante: `${plural(siti, 'sito', 'siti', t)} ${t('esportati')}`,
                  omitted: senzaCoordinate.length
                    ? [`${t('siti senza coordinate')}: ${senzaCoordinate.join(', ')}`]
                    : [],
                  dove: dove.dove,
                };
              })
            }
          >
            {t('Siti su mappa (KML)')}
          </button>
        </div>
        {exported && (
          <div className="notice" style={{ marginTop: 12 }}>
            <b>
              {exported.quante}, {exported.dove}.
            </b>{' '}
            {exported.omitted.length > 0 && (
              <>
                {t('Restano fuori')}: {exported.omitted.join('; ')}.
              </>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>{t('Cosa fa e cosa non fa')}</h2>
        {/*
         * QUESTO ELENCO ERA UN SAGGIO, ed è il posto giusto per tenerne le
         * ragioni. Quello che si è spostato qui dentro:
         *
         *  - il cestino non viaggia perché finché un'immersione è lì ripescarla
         *    dev'essere sempre possibile. Svuotandolo nasce la lapide — «questa
         *    è stata cancellata, e quando» — che è l'unica informazione capace
         *    di distinguere «non ce l'ho ancora» da «l'ho buttata via», e
         *    quella sì che si propaga;
         *  - non duplica perché l'identificativo dipende dal CONTENUTO
         *    dell'immersione, non da chi l'ha importata;
         *  - attrezzatura, brevetti, piani e analisi sono le uniche cose che
         *    nessun file di importazione porta con sé: cioè le uniche che
         *    altrimenti si ricompilano su ogni dispositivo. Le raccolte si
         *    fondono pezzo per pezzo, e a parità di pezzo vince la modifica più
         *    recente;
         *  - il segnalibro dello scarico Bluetooth si allinea IN FONDO al giro,
         *    dopo le immersioni: prima sarebbe una promessa che l'archivio non
         *    ha ancora mantenuto, e il collegamento dopo salterebbe immersioni
         *    mai arrivate;
         *  - le credenziali no: un token che viaggia dentro il proprio stesso
         *    database sarebbe un cerchio sciocco oltre che pericoloso.
         */}
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13 }}>
          <li>
            <b>{t('Le cancellazioni viaggiano, il cestino no.')}</b>{' '}
            {t('Finché un’immersione è nel cestino resta solo qui. Svuotandolo, sparisce ovunque.')}
          </li>
          <li>
            <b>{t('Non duplica.')}</b> {t('La stessa immersione importata su due dispositivi resta una.')}
          </li>
          <li>
            <b>{t('Viaggia anche quello che hai scritto a mano.')}</b>{' '}
            {t('Attrezzatura, brevetti, piani e analisi si fondono; a parità di voce vince la più recente.')}
          </li>
          <li>
            <b>{t('Viaggia anche fin dove sei arrivato con ogni computer.')}</b>{' '}
            {t('Se hai scaricato l’Aladin dal Mac, il telefono prende solo le immersioni nuove.')}
          </li>
          <li>
            <b>{t('Le credenziali no.')}</b> {t('Token e chiave API restano su ogni dispositivo.')}
          </li>
          <li>
            <b>{t('Riepilogo e profilo viaggiano separati.')}</b>{' '}
            {t('Dopo la sincronizzazione ogni dispositivo ha tutti e due.')}
          </li>
          <li>
            <b>{t('Sincronizzare due volte di fila non fa niente la seconda volta.')}</b>{' '}
            {t('Se il resoconto mostra ancora numeri diversi da zero, è un bug: segnalalo.')}
          </li>
        </ul>
      </div>
    </div>
  );
}

/**
 * Chiave dell'API di Anthropic e scelta del modello.
 *
 * Il modello NON è scritto nel codice: l'elenco arriva dall'API con la chiave
 * dell'utente. I nomi dei modelli cambiano nel tempo, e fissarne uno significa
 * un'app che smette di funzionare a una data ignota.
 */
function ClaudeSettings({
  credentials,
  onSave,
  onTest,
}: {
  credentials: { apiKey: string; model?: string } | null;
  onSave: (c: { apiKey: string; model?: string } | null) => Promise<void>;
  onTest: (c: {
    apiKey: string;
    model?: string;
  }) => Promise<{ ok: true; models: AiModel[] } | { ok: false; error: string }>;
}) {
  const { t } = useLingua();
  const [key, setKey] = useState(credentials?.apiKey ?? '');
  const [model, setModel] = useState(credentials?.model ?? '');
  const [models, setModels] = useState<AiModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    setOk(false);
    const result = await onTest({ apiKey: key.trim(), model: model || undefined });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setModels(result.models);
    setOk(true);
    // Al primo caricamento seleziona il modello più recente fra quelli disponibili.
    const chosen = model && result.models.some((m) => m.id === model) ? model : result.models[0].id;
    setModel(chosen);
    await onSave({ apiKey: key.trim(), model: chosen });
  };

  const dirty = key.trim() !== (credentials?.apiKey ?? '') || model !== (credentials?.model ?? '');

  return (
    <div className="card">
      <h2>{t('Analisi con Claude')}</h2>
      {/*
       * COSA RICEVE IL MODELLO, detto qui perché è una garanzia sul codice e
       * non un'istruzione per l'utente: gli si passano i valori calcolati
       * dall'app e quelli letti dai computer subacquei, tenuti distinti, con
       * l'istruzione esplicita di non stimare niente. A schermo basta la
       * promessa: i numeri restano quelli misurati.
       */}
      <p className="card-sub">
        {t('Con una chiave API di Anthropic puoi far analizzare una immersione, l’archivio o un piano.')}{' '}
        {t('Al modello vanno i numeri misurati, non stime.')}
      </p>

      <div style={{ display: 'grid', gap: 12, maxWidth: 620 }}>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
          {t('Chiave API')}
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-ant-…"
            spellCheck={false}
            autoComplete="off"
          />
          {/* Sulla versione web pubblicata una chiave che sta nel browser è
           * comunque esposta a chi apre gli strumenti di sviluppo: l'avviso
           * qui sotto è l'unica difesa possibile, perché il rimedio vero —
           * un server che tenga la chiave — questa app non ce l'ha. */}
          <span className="muted" style={{ fontSize: 11 }}>
            {t('Resta su questo dispositivo e va solo ad Anthropic. Sul web è meglio non metterla.')}
          </span>
        </label>
        <DoveStannoLeCredenziali />

        {models.length > 0 && (
          <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('Modello')}
            <select
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                void onSave({ apiKey: key.trim(), model: e.target.value });
              }}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName ?? m.id}
                </option>
              ))}
            </select>
            {/* Nessun nome di modello è scritto nel codice: i nomi cambiano nel
             * tempo, e fissarne uno vuol dire un'app che smette di funzionare a
             * una data ignota. L'elenco lo dà l'API con la chiave dell'utente. */}
            <span className="muted" style={{ fontSize: 11 }}>
              {t('L’elenco arriva dalla tua chiave.')}
            </span>
          </label>
        )}

        <div className="row">
          <button className="btn btn-primary" onClick={() => void load()} disabled={busy || !key.trim()}>
            {busy ? t('Verifica…') : models.length ? t('Aggiorna e salva') : t('Verifica e carica i modelli')}
          </button>
          {credentials?.apiKey && (
            <button
              className="btn btn-danger"
              onClick={() => {
                setKey('');
                setModel('');
                setModels([]);
                setOk(false);
                void onSave(null);
              }}
            >
              {t('Dimentica')}
            </button>
          )}
          {credentials?.model && !dirty && (
            <span className="muted" style={{ fontSize: 12 }}>
              {t('Pronta')}: {credentials.model}
            </span>
          )}
        </div>

        {ok && (
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            {t('Chiave valida')}, {models.length} {t('modelli disponibili')}.
          </p>
        )}
        {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--critical)' }}>{error}</p>}
      </div>
    </div>
  );
}

/**
 * Una riga del resoconto: etichetta a sinistra, numero a destra.
 *
 * L'ETICHETTA SI TRADUCE QUI, non nel punto di chiamata. Arriva sempre come
 * frase italiana scritta a mano nel JSX — mai come dato — quindi passarla dentro
 * `t()` in un posto solo è sicuro, tiene le otto chiamate leggibili a colpo
 * d'occhio e non lascia a nessuno la possibilità di dimenticarsene una. Il
 * `value` invece resta compito di chi chiama: è un numero, o un numero con una
 * parola, e va composto dove i pezzi ci sono.
 */
function Row({ label, value }: { label: string; value: number | string }) {
  const { t } = useLingua();
  return (
    <tr>
      <td>{t(label)}</td>
      <td className="num tabular">{value}</td>
    </tr>
  );
}

/**
 * Salvataggio di un file dal browser.
 *
 * Funziona sia nel browser sia dentro la webview di Tauri, dove il download passa
 * per il gestore del sistema. L'URL temporaneo va revocato: senza, il testo
 * dell'intero archivio resta in memoria fino alla chiusura dell'app.
 */
/**
 * Backup e ripristino.
 *
 * È una carta a parte e non il posto dell'export UDDF, perché rispondono a due
 * domande diverse: «voglio i miei dati altrove» e «voglio poter tornare
 * indietro». Averle confuse è il motivo per cui la carta dell'UDDF prometteva un
 * backup che non era, e per cui adesso dice in chiaro che backup non è.
 *
 * Il ripristino mostra il piano PRIMA di eseguirlo. Un'operazione che si lancia
 * quando le cose sono già andate male non può chiedere fiducia: deve dire quante
 * immersioni aggiunge, quante ne aggiorna e quante ne lascia dove sono.
 */
/**
 * Dove stanno le credenziali, detto e non lasciato intendere.
 *
 * Una riga sola, accanto ai campi in cui si incollano. Sta qui e non in una
 * pagina di documentazione perché è nel momento in cui incolli un token che ti
 * interessa sapere dove finirà, e perché la risposta cambia col dispositivo:
 * sull'app desktop è il portachiavi di macOS, nel browser è l'archivio locale in
 * chiaro. Dichiarare il caso peggiore quando è quello vero è l'unico modo di far
 * valere qualcosa la dichiarazione nel caso buono.
 *
 * La frase lunga di `describePlace()` non si usa più qui: spiegava PERCHÉ nel
 * browser non si cifra (una chiave che sta nella stessa pagina sarebbe teatro),
 * che è una ragione da codice e non una cosa che serve a chi sta incollando un
 * token. Quella funzione resta dov'è, per chi la vuole altrove.
 */
function DoveStannoLeCredenziali() {
  const { secretPlace } = useDiveLog();
  const { t } = useLingua();
  return (
    <p className="muted" style={{ fontSize: 11, marginTop: 12, marginBottom: 0 }}>
      <b>{secretPlace === 'keychain' ? t('Portachiavi di sistema.') : t('Archivio locale, in chiaro.')}</b>{' '}
      {secretPlace === 'keychain'
        ? t('Le legge solo questa app, e non finiscono nei backup.')
        : t('Nel browser non c’è un portachiavi. Sull’app desktop ci finiscono.')}
    </p>
  );
}

/**
 * L'accesso: la strada normale per avere un database condiviso.
 *
 * PERCHÉ STA IN CIMA E DA SOLA. Perché è quella che si sceglie: l'account crea
 * e gestisce il database per conto di chi accede, senza che nessuno debba aprire
 * la console di Turso e generare un token. L'altra strada — indirizzo e token
 * scritti a mano — non è stata tolta, è finita sotto «Avanzate», dove sta bene
 * una via di scampo che serve raramente e serve moltissimo quando serve.
 *
 * E soprattutto: **l'accesso non è obbligatorio per usare l'app.** Il logbook si
 * apre, importa e analizza senza, perché l'archivio è sul dispositivo. Questa
 * carta offre una comodità, non un cancello.
 */
function AccountCard() {
  const { accountAttivo, accountEmail, accediConAccount, esciDallAccount, cancellaAccount } = useDiveLog();
  const { t } = useLingua();
  // Quale dei due pulsanti sta lavorando, non «sto lavorando»: con un solo
  // stato entrambi i pulsanti direbbero «Accesso in corso…», e chi guarda non
  // saprebbe più quale ha premuto.
  const [lavoro, setLavoro] = useState<'idle' | 'apple' | 'google' | 'chiusura'>('idle');
  const [errore, setErrore] = useState<string | null>(null);

  const accedi = (fornitore: Fornitore) => {
    void (async () => {
      setLavoro(fornitore);
      setErrore(null);
      try {
        await accediConAccount(fornitore);
      } catch (err) {
        setErrore(err instanceof Error ? err.message : String(err));
      } finally {
        setLavoro('idle');
      }
    })();
  };

  return (
    <div className="card">
      <h2>{t('Accesso')}</h2>
      {/* Il logbook si apre, importa e analizza anche senza account, perché
       * l'archivio sta sul dispositivo: questa carta offre una comodità, non un
       * cancello, e il «non è obbligatorio» è lì per dirlo subito. */}
      <p className="card-sub">
        {t(
          'Con un account Apple o Google l’app crea un database tuo: gli altri dispositivi si allineano con lo stesso account.',
        )}{' '}
        <b>{t('Non è obbligatorio')}</b>: {t('il logbook funziona anche senza.')}
      </p>

      {accountAttivo ? (
        <>
          {/*
           * Con l'email si dice chi sei, senza si dice soltanto che sei
           * entrato. L'alternativa — nascondere tutto finché non si conosce
           * l'indirizzo — lascerebbe la pagina a mostrare «Accedi» a chi ha
           * appena fatto l'accesso, che è la bugia peggiore delle due.
           */}
          <p style={{ fontSize: 13, margin: '0 0 12px' }}>
            {accountEmail ? (
              <>
                {t('Sei entrato come')} <b>{accountEmail}</b>.
              </>
            ) : (
              t('Sei entrato. L’app sincronizza sul database del tuo account.')
            )}
          </p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => void esciDallAccount()}>{t('Esci')}</button>
            {/*
             * Cancellare l'account è distruttivo e irreversibile, quindi passa
             * dalla conferma armata come tutte le altre cose che non si possono
             * disfare. Quello che cancella è il database REMOTO: l'archivio su
             * questo dispositivo resta dov'è, ed è scritto qui sotto perché è
             * esattamente la domanda che si fa chi sta per premere.
             */}
            <BottoneConferma
              etichetta={t('Cancella l’account')}
              domanda={t(
                'Cancella il database remoto e le immersioni che contiene. Quelle su questo dispositivo restano.',
              )}
              conferma={t('Sì, cancella il database remoto')}
              onConferma={() => {
                setLavoro('chiusura');
                void cancellaAccount()
                  .catch((err) => setErrore(err instanceof Error ? err.message : String(err)))
                  .finally(() => setLavoro('idle'));
              }}
            />
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
            {t('Uscire smette solo di sincronizzare. Le immersioni di questo dispositivo')}{' '}
            <b>{t('restano')}</b> {t('in tutti e due i casi.')}
          </p>
        </>
      ) : (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {/*
           * APPLE PER PRIMO, e non è cortesia: la linea guida 4.8 dell'App
           * Store vuole che Sign in with Apple sia offerto in modo equivalente
           * agli altri accessi, e «equivalente» comprende la posizione. Metterlo
           * secondo, più piccolo o più scolorito è una delle cose che la
           * revisione guarda.
           *
           * L'ASPETTO LO DETTA APPLE, non noi. Sfondo nero (o bianco), il
           * marchio della mela, e la dicitura «Sign in with Apple» — che **non
           * si traduce**: è un marchio registrato, e nelle linee guida di Apple
           * la versione italiana è «Accedi con Apple» solo se si usa la loro
           * localizzazione ufficiale. Scriverne una nostra sarebbe una
           * traduzione del marchio di qualcun altro, quindi resta in inglese e
           * non passa dal dizionario.
           */}
          <button
            className="btn bottone-apple"
            onClick={() => accedi('apple')}
            disabled={lavoro !== 'idle'}
            aria-label="Sign in with Apple"
          >
            {/* `aria-hidden`: il marchio è decorativo, il nome del pulsante lo
                dice già il testo accanto. */}
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
              />
            </svg>
            {lavoro === 'apple' ? t('Accesso in corso…') : 'Sign in with Apple'}
          </button>
          <button className="btn btn-primary" onClick={() => accedi('google')} disabled={lavoro !== 'idle'}>
            {lavoro === 'google' ? t('Accesso in corso…') : t('Accedi con Google')}
          </button>
          <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
            {t('Si apre il browser di sistema: la password la scrivi al fornitore, non a noi.')}
          </span>
        </div>
      )}

      {errore && (
        <div className="notice notice-error" role="alert" style={{ marginTop: 12 }}>
          {errore}
        </div>
      )}
    </div>
  );
}

function BackupCard() {
  const { dives, buildFullBackup, restoreBackup, storeLocation } = useDiveLog();
  const { t } = useLingua();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [lavoro, setLavoro] = useState<'idle' | 'export' | 'restore'>('idle');
  const [errore, setErrore] = useState<string | null>(null);
  const [avvisi, setAvvisi] = useState<string[]>([]);
  const [candidato, setCandidato] = useState<BackupFile | null>(null);
  const [piano, setPiano] = useState<RestorePlan | null>(null);
  const [modo, setModo] = useState<'merge' | 'replace'>('merge');
  const [esito, setEsito] = useState<string | null>(null);

  const scarica = () => {
    void (async () => {
      setLavoro('export');
      setErrore(null);
      setEsito(null);
      try {
        const file = await buildFullBackup();
        /*
         * `esporta` LANCIA quando non scrive, ed è tutto il punto.
         *
         * Prima qui c'era un `download()` che non poteva fallire: dentro la
         * WKWebView di iOS non scriveva niente e non lo diceva, quindi la riga
         * qui sotto dichiarava «Backup scritto» a un utente che non aveva
         * nessun backup. La frase adesso arriva DOPO una scrittura riuscita, e
         * dice anche dove è finito il file — che su iPhone non è ovvio.
         */
        const dove = await esporta(backupFileName(), JSON.stringify(file), 'application/json');
        setEsito(
          `${t('Backup scritto')} ${dove.dove}: ${imm(file.summary.dives, t)}, ${file.summary.samples.toLocaleString('it')} ${t('campioni')}, ${file.summary.settings.length} ${t('impostazioni')}.`,
        );
      } catch (err) {
        setErrore(err instanceof Error ? err.message : String(err));
      } finally {
        setLavoro('idle');
      }
    })();
  };

  const leggi = (input: HTMLInputElement) => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    setErrore(null);
    setEsito(null);
    setCandidato(null);
    setPiano(null);
    void (async () => {
      try {
        const check = checkBackup(JSON.parse(await f.text()));
        setAvvisi(check.warnings);
        if (!check.ok || !check.file) {
          setErrore(check.errors.join(' '));
          return;
        }
        setCandidato(check.file);
        setPiano(planRestore(check.file, dives, modo));
      } catch (err) {
        setErrore(
          `${t('Il file non è JSON valido')}: ${err instanceof Error ? err.message : String(err)}. ${t('Se è un UDDF, va nella scheda Importa.')}`,
        );
      }
    })();
  };

  const cambiaModo = (m: 'merge' | 'replace') => {
    setModo(m);
    if (candidato) setPiano(planRestore(candidato, dives, m));
  };

  /*
   * Quello che il modo scelto rende impossibile, ricalcolato a ogni cambio.
   *
   * Non è un avviso: finché c'è, il bottone resta spento. Vedi
   * `restoreBlockers` per il perché un backup vuoto in «ricostruisci da zero»
   * non sia una scelta legittima da lasciar prendere.
   */
  const impedimenti = candidato ? restoreBlockers(candidato, modo, dives.length) : [];

  const ripristina = () => {
    if (!candidato || impedimenti.length) return;
    void (async () => {
      setLavoro('restore');
      setErrore(null);
      try {
        const r = await restoreBackup(candidato, modo);
        setEsito(
          `${t('Ripristino fatto')}: ${r.added} ${t('aggiunte')}, ${r.merged} ${t('aggiornate')}, ${r.settings} ${t('impostazioni riscritte')}.` +
            (r.onlyLocal > 0 ? ` ${r.onlyLocal} ${t('che avevi solo qui sono rimaste dov’erano.')}` : ''),
        );
        setCandidato(null);
        setPiano(null);
      } catch (err) {
        setErrore(err instanceof Error ? err.message : String(err));
      } finally {
        setLavoro('idle');
      }
    })();
  };

  return (
    <div className="card">
      <h2>{t('Backup completo e ripristino')}</h2>
      {/*
       * IL BACKUP NON LO LEGGE NESSUN ALTRO PROGRAMMA, ed è voluto: quel
       * mestiere lo fa l'UDDF: qui in cambio non si perde niente — immersioni
       * con i profili e i secondi profili, attrezzatura, brevetti, piani
       * salvati, analisi generate, obiettivo e periodo.
       *
       * Le credenziali di sincronizzazione e la chiave API restano fuori di
       * proposito: un backup finisce su un disco esterno, in una cartella
       * condivisa o nell'app File, e non deve portarsi dietro i segreti di chi
       * lo ha fatto.
       */}
      <p className="card-sub">
        {t('Un file JSON con')} <b>{t('tutto')}</b>:{' '}
        {t('immersioni, profili, attrezzatura, brevetti, piani e analisi. Le credenziali restano fuori.')}
      </p>
      {suIOS() && (
        // Su iOS le app non hanno una cartella Download: il file finisce nella
        // cartella dell'app dentro File, e da lì l'utente lo sposta su iCloud o
        // lo passa al Mac. Detto qui perché non è ovvio e non è colpa nostra.
        <p className="card-sub">
          {t('Su iPhone il file va nell’app File, in «Sul mio iPhone → MyDiveLog».')}
        </p>
      )}

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          disabled={lavoro !== 'idle' || dives.length === 0}
          onClick={scarica}
        >
          {lavoro === 'export' ? t('Preparazione…') : t('Scarica il backup')}
        </button>
        <button disabled={lavoro !== 'idle'} onClick={() => fileRef.current?.click()}>
          {t('Ripristina da un file…')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label={t('File di backup da ripristinare')}
          style={{ display: 'none' }}
          onChange={(e) => leggi(e.currentTarget)}
        />
      </div>

      {errore && (
        <div className="notice notice-error" role="alert" style={{ marginTop: 12 }}>
          {errore}
        </div>
      )}
      {avvisi.length > 0 && (
        <div className="notice" style={{ marginTop: 12 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {avvisi.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {candidato && piano && (
        <div className="notice" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {t('Backup del')} {dateShort(candidato.createdAt)} · {imm(candidato.summary.dives, t)} ·{' '}
            {candidato.summary.samples.toLocaleString('it')} {t('campioni')}
          </div>
          {/* Il piano PRIMA dell'esecuzione: senza, «ripristina» è un salto nel buio. */}
          <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
            <li>
              <b>{piano.added.length}</b> {t('immersioni verranno aggiunte')}
            </li>
            <li>
              <b>{piano.merged.length}</b> {t('già presenti verranno')}{' '}
              {modo === 'merge'
                ? t('arricchite, senza perdere quello che hai scritto tu')
                : t('sostituite con la versione del file')}
            </li>
            <li>
              <b>{piano.onlyLocal}</b> {t('che hai solo qui')}{' '}
              {modo === 'merge' ? t('resteranno dove sono') : <b>{t('verranno cancellate')}</b>}
            </li>
            <li>
              <b>{Object.keys(piano.settings).length}</b> {t('impostazioni verranno riscritte')}
            </li>
          </ul>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
            <label className="planner-check" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="radio" checked={modo === 'merge'} onChange={() => cambiaModo('merge')} />
              <span>{t('Fondi con quello che c’è (consigliato)')}</span>
            </label>
            <label className="planner-check" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="radio" checked={modo === 'replace'} onChange={() => cambiaModo('replace')} />
              <span style={{ color: modo === 'replace' ? 'var(--critical)' : undefined }}>
                {t('Ricostruisci da zero')}
              </span>
            </label>
          </div>
          {impedimenti.length > 0 && (
            <div className="notice notice-error" role="alert" style={{ marginBottom: 10 }}>
              {impedimenti.join(' ')}
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            {modo === 'replace' ? (
              <BottoneConferma
                className="btn"
                disabled={lavoro !== 'idle' || impedimenti.length > 0}
                etichetta={lavoro === 'restore' ? t('Ripristino…') : t('Ripristina')}
                conferma={t('Sì, ricostruisci da zero')}
                domanda={
                  <>
                    {t('Cancella le')} {imm(dives.length, t)} {t('che hai adesso,')}{' '}
                    <b>{t('comprese quelle che il backup non contiene')}</b>.{' '}
                    {t('Non passano dal cestino e non si torna indietro.')}
                  </>
                }
                onConferma={ripristina}
              />
            ) : (
              <button className="btn" disabled={lavoro !== 'idle'} onClick={ripristina}>
                {lavoro === 'restore' ? t('Ripristino…') : t('Ripristina')}
              </button>
            )}
            <button
              onClick={() => {
                setCandidato(null);
                setPiano(null);
                setAvvisi([]);
              }}
            >
              {t('Annulla')}
            </button>
          </div>
        </div>
      )}

      {esito && (
        <div className="notice" role="status" style={{ marginTop: 12 }}>
          {esito}
        </div>
      )}

      {/* Il senso di un backup è che stia ALTROVE: sullo stesso disco
       * dell'archivio non protegge da niente. */}
      <p className="muted" style={{ fontSize: 11, marginTop: 12, marginBottom: 0 }}>
        {t('L’archivio vive in')} {t(storeLocation)}. {t('Il backup è una copia da tenere altrove.')}
      </p>
    </div>
  );
}

/**
 * Il cestino.
 *
 * Sta nelle impostazioni e non nel logbook perché non è un posto in cui si passa:
 * è un posto in cui si va quando ci si accorge di aver sbagliato. La cifra che
 * conta in ogni riga è quanti giorni restano, perché è l'unica informazione con
 * una scadenza.
 */
function TrashCard() {
  const { trash, restoreDive, restoreDives, purgeDive, emptyTrash } = useDiveLog();
  const { t } = useLingua();
  const items = sortTrash(trash);

  if (!items.length) {
    return (
      <div className="card">
        <h2>{t('Cestino')}</h2>
        {/* Finché è nel cestino un'immersione sparisce dall'archivio e non si
         * sincronizza, ma non è perduta: è lo stato intermedio che rende
         * riparabile un errore. Passati i giorni, la cancellazione diventa
         * definitiva su tutti i dispositivi. */}
        <p className="card-sub" style={{ marginBottom: 0 }}>
          {t('Vuoto. Quello che cancelli resta qui')} {TRASH_DAYS}{' '}
          {t('giorni, poi la cancellazione diventa definitiva su tutti i dispositivi.')}
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0 }}>{t('Cestino')}</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            {plural(items.length, 'immersione cancellata', 'immersioni cancellate', t)},{' '}
            {t('col loro profilo. Finché sono qui, «Rimetti a posto» le riporta com’erano.')}
          </p>
        </div>
        <span className="row" style={{ gap: 8 }}>
          {/*
           * «Rimetti a posto tutte» non è una comodità: senza, riparare un
           * errore di valutazione fatto in blocco costa un clic per immersione.
           * È successo davvero — cinquantadue immersioni cancellate insieme
           * perché sembravano doppioni, e poi non lo erano.
           */}
          {items.length > 1 && (
            <BottoneConferma
              etichetta={t('Rimetti a posto tutte')}
              conferma={`${t('Sì, rimetti')} ${imm(items.length, t)}`}
              domanda={
                <>
                  {t('Rimettere in archivio')} {imm(items.length, t)}?{' '}
                  {t('Tornano com’erano, profilo compreso.')}
                </>
              }
              onConferma={() => void restoreDives(items.map((i) => i.dive.id))}
            />
          )}
          <BottoneConferma
            etichetta={t('Svuota il cestino')}
            conferma={`${t('Sì, cancella')} ${imm(items.length, t)}`}
            domanda={
              <>
                {t('Cancellare definitivamente')} {imm(items.length, t)}? {t('La cancellazione si propaga a')}{' '}
                <b>{t('tutti i dispositivi')}</b> {t('e non si torna indietro.')}
              </>
            }
            onConferma={() => void emptyTrash()}
          />
        </span>
      </div>

      {items.length > TRASH_SOFT_LIMIT && (
        <div className="notice" style={{ marginTop: 12 }}>
          {t('Il cestino contiene')} {imm(items.length, t)}{' '}
          {t('con i loro profili: svuotarlo libera spazio e rende definitive le cancellazioni.')}
        </div>
      )}

      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>{t('Immersione')}</th>
              <th className="num">{t('Cancellata')}</th>
              <th className="num">{t('Definitiva fra')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.dive.id}>
                <td>
                  <div style={{ fontWeight: 550 }}>
                    {item.dive.site?.name ?? t('senza sito')}{' '}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {dateShort(item.dive.startTime, item.dive.utcOffsetMinutes)}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {item.dive.maxDepth.toFixed(1)} m · {formatDuration(item.dive.durationS)} ·{' '}
                    {item.samples?.length
                      ? `${item.samples.length} ${t('campioni conservati')}`
                      : t('senza profilo')}
                  </div>
                </td>
                <td className="num tabular muted">{dateShort(item.at)}</td>
                <td
                  className="num tabular"
                  style={{ color: daysLeft(item) <= 3 ? 'var(--warning-text)' : undefined }}
                >
                  {daysLeft(item)} {t('giorni')}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => void restoreDive(item.dive.id)}
                    >
                      {t('Rimetti a posto')}
                    </button>
                    <BottoneConferma
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      etichetta={t('Elimina')}
                      conferma={t('Sì, cancella')}
                      domanda={t(
                        'Cancellare questa immersione su tutti i dispositivi? Non si torna indietro.',
                      )}
                      onConferma={() => void purgeDive(item.dive.id)}
                    />
                  </span>
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
 * L'aggiornamento dell'applicazione, sul Mac.
 *
 * ► NON COMPARE DOVE NON HA SENSO. ◄ Nel browser e su iPhone questa carta non
 * si disegna affatto: là gli aggiornamenti li distribuisce l'App Store, e una
 * carta che dice «sei aggiornato» in un posto dove non aggiorniamo niente è una
 * bugia gentile. Meglio il silenzio.
 *
 * ► CERCA DA SÉ, INSTALLA SU RICHIESTA. ◄ La ricerca parte all'apertura della
 * pagina: è una richiesta piccola, senza conseguenze, e serve a far sapere che
 * esiste una versione nuova a chi non andrebbe mai a controllare. Scaricare e
 * installare, invece, parte da un pulsante — come la sincronizzazione. Un
 * programma che si sostituisce da solo sotto le mani di chi lo sta usando è una
 * cosa che si subisce, non che si sceglie.
 *
 * La ricerca automatica NON mostra i propri errori. Se la rete manca, chi ha
 * aperto le impostazioni per tutt'altro non deve leggere un errore rosso su una
 * cosa che non ha chiesto. Quando invece è lui a premere «Controlla», l'errore
 * si vede eccome: ha fatto una domanda e ha diritto alla risposta vera, invece
 * di un «sei aggiornato» che non abbiamo verificato.
 */
function AggiornamentoCard() {
  const { t } = useLingua();
  const [stato, setStato] = useState<StatoAggiornamento>({ fase: 'fermo' });

  const cerca = useCallback((dichiaraErrori: boolean) => {
    setStato({ fase: 'cerco' });
    void cercaAggiornamento()
      .then((trovato) => setStato(trovato ? { fase: 'trovato', ...trovato } : { fase: 'nessuno' }))
      .catch((err) => {
        if (!dichiaraErrori) {
          setStato({ fase: 'fermo' });
          return;
        }
        setStato({ fase: 'errore', messaggio: err instanceof Error ? err.message : String(err) });
      });
  }, []);

  /*
   * Una volta sola all'apertura della pagina. `suMac()` è già stato controllato
   * da chi disegna la carta, ma la guardia resta anche qui: questo effetto non
   * deve dipendere da chi lo monta.
   */
  useEffect(() => {
    if (suMac()) cerca(false);
  }, [cerca]);

  const installa = () => {
    setStato({ fase: 'scarico', fatti: 0 });
    void installaAggiornamento((fatti, totali) => setStato({ fase: 'scarico', fatti, totali }))
      .then(() => setStato({ fase: 'installato' }))
      .catch((err) =>
        setStato({ fase: 'errore', messaggio: err instanceof Error ? err.message : String(err) }),
      );
  };

  if (!suMac()) return null;

  return (
    <div className="card">
      <h2>{t('Aggiornamenti')}</h2>
      <p className="card-sub">
        {t('L’app controlla se c’è una versione nuova. Scaricarla e installarla lo decidi tu.')}
      </p>

      {stato.fase === 'cerco' && <p style={{ fontSize: 13, margin: 0 }}>{t('Controllo…')}</p>}

      {stato.fase === 'nessuno' && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13 }}>{t('Sei alla versione più recente.')}</span>
          <button onClick={() => cerca(true)}>{t('Controlla di nuovo')}</button>
        </div>
      )}

      {stato.fase === 'fermo' && <button onClick={() => cerca(true)}>{t('Controlla')}</button>}

      {stato.fase === 'trovato' && (
        <>
          <div className="notice" role="status" style={{ marginBottom: 12 }}>
            {t('C’è la versione')} <b>{stato.versione}</b>.
          </div>
          {/*
           * Le note di versione le scrive chi pubblica e arrivano dalla rete:
           * si mostrano come TESTO, mai come markup, e in uno spazio limitato
           * con lo scorrimento — una nota lunga non deve spingere il pulsante
           * fuori dallo schermo.
           */}
          {stato.note && (
            <pre
              style={{
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                maxHeight: 160,
                overflow: 'auto',
                margin: '0 0 12px',
                color: 'var(--text-secondary)',
              }}
            >
              {stato.note}
            </pre>
          )}
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={installa}>
              {t('Installa e riavvia')}
            </button>
            <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
              {t('L’applicazione si chiude e si riapre da sola.')}
            </span>
          </div>
        </>
      )}

      {stato.fase === 'scarico' && (
        <p style={{ fontSize: 13, margin: 0 }} role="status">
          {descriviScaricamento(stato.fatti, stato.totali, t)}
        </p>
      )}

      {stato.fase === 'installato' && (
        <p style={{ fontSize: 13, margin: 0 }} role="status">
          {t('Installato. L’applicazione si sta riavviando.')}
        </p>
      )}

      {stato.fase === 'errore' && (
        <div className="notice notice-error" role="alert">
          {stato.messaggio}
        </div>
      )}
    </div>
  );
}
