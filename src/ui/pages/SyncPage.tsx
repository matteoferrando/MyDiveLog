/**
 * Configurazione e uso del database condiviso (Turso / libSQL).
 *
 * Due cose, separate di proposito: le credenziali si inseriscono una volta, la
 * sincronizzazione si lancia quando si vuole. Non c'è nessuna sincronizzazione
 * automatica all'avvio, e non è una mancanza: un logbook si apre anche in barca,
 * dove la rete non c'è, e un'app che all'apertura aspetta la rete è un'app che in
 * barca non si apre.
 */

import { useRef, useState } from 'react';
import { esporta } from '../esporta';
import { suIOS } from '../../piattaforma';
import { useDiveLog } from '../state';
import { TRASH_DAYS, TRASH_SOFT_LIMIT, daysLeft, sortTrash } from '../../storage/trash';
import { formatDuration } from '../../core/units';
import { dateShort, imm } from '../format';
import { describePlace } from '../../storage/secrets';
import {
  backupFileName,
  checkBackup,
  planRestore,
  restoreBlockers,
  type BackupFile,
  type RestorePlan,
} from '../../core/export/backup';
import type { SyncReport } from '../../sync/turso';
import type { AiModel } from '../../ai/client';
import { BottoneConferma } from '../components/Conferma';

export function SyncPage() {
  const {
    dives,
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
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<{ dives: number; omitted: string[]; dove: string } | null>(null);
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
        <h1 className="page-title">Impostazioni</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {imm(dives.length)} in archivio · {storeLocation}
        </span>
      </div>

      <AccountCard />

      <div className="card">
        <h2>Database condiviso</h2>
        <p className="card-sub">
          Un solo archivio per tutti i dispositivi. L'app continua a funzionare offline: la sincronizzazione è
          un'operazione che lanci tu, non una condizione per aprire il logbook.
        </p>

        <div style={{ display: 'grid', gap: 12, maxWidth: 620 }}>
          <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
            Indirizzo del database
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
            Token di accesso
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="incolla qui il token generato su Turso"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="muted" style={{ fontSize: 11 }}>
              Resta su questo dispositivo. Non viene inviato a nessuno tranne che a Turso, e non è nel codice
              dell'applicazione.
            </span>
          </label>
          <DoveStannoLeCredenziali />

          <div className="row">
            <button className="btn btn-primary" onClick={() => void save()} disabled={!dirty}>
              {configured ? 'Aggiorna credenziali' : 'Salva credenziali'}
            </button>
            <button
              className="btn"
              onClick={() => void test()}
              disabled={testing || !url.trim() || !token.trim()}
            >
              {testing ? 'Verifica…' : 'Prova la connessione'}
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
                Dimentica
              </button>
            )}
          </div>

          {testResult?.ok && (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Connessione riuscita.
            </p>
          )}
          {testResult && !testResult.ok && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--critical)' }}>{testResult.error}</p>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Sincronizza ora</h2>
        <p className="card-sub">
          Prima scarica, poi carica. Niente viene cancellato: le immersioni si aggiungono e si completano a
          vicenda — il riepilogo più recente e il profilo più ricco, anche quando arrivano da dispositivi
          diversi.
        </p>
        <div className="row">
          <button
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={busy || !configured || dirty}
          >
            {busy ? 'Sincronizzazione in corso…' : 'Sincronizza'}
          </button>
          {!configured && (
            <span className="muted" style={{ fontSize: 12 }}>
              Inserisci indirizzo e token, poi salva.
            </span>
          )}
          {configured && dirty && (
            <span className="muted" style={{ fontSize: 12 }}>
              Hai modificato le credenziali: salvale prima di sincronizzare.
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
              <Row label="Caricate" value={report.pushed} />
              <Row label="Scaricate" value={report.pulled} />
              <Row label="Profili caricati" value={report.pushedProfiles} />
              <Row label="Profili scaricati" value={report.pulledProfiles} />
              <Row label="Già allineate" value={report.plan.unchanged} />
              <Row
                label="Impostazioni condivise"
                value={`${report.settingsPushed} caricate, ${report.settingsPulled} scaricate`}
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
            <b>Queste impostazioni non si sono allineate.</b> Le immersioni sì: il resto del giro è andato a
            buon fine. Riprova, e se l'errore torna uguale segnalalo — il testo è quello che serve per
            capirlo.
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {report.settingsErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <ClaudeSettings credentials={aiCredentials} onSave={saveAiCredentials} onTest={testAiKey} />

      <div className="card">
        <h2>Come ottenere le credenziali del database</h2>
        <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13 }}>
          <li>
            Su <b>turso.tech</b>, apri il database e copia l'indirizzo che comincia per <code>libsql://</code>
            .
          </li>
          <li>
            Sempre da lì, <b>Create Token</b>: il token compare una volta sola, copialo e incollalo qui sopra.
            Genera un token per dispositivo, così se ne perdi uno revochi solo quello.
          </li>
          <li>
            La prima sincronizzazione crea le tabelle e carica l'archivio. Sugli altri dispositivi le stesse
            credenziali scaricano tutto.
          </li>
        </ol>
      </div>

      <TrashCard />

      <BackupCard />

      <div className="card">
        <h2>Esporta l'archivio</h2>
        <p className="card-sub">
          Un file UDDF con tutte le {imm(dives.length)} e i loro profili. È il formato standard che gli altri
          programmi del settore leggono, ed è lo stesso che questa app importa: il giro si chiude, e
          l'archivio non è prigioniero di nessuno. <b>Non è un backup</b>: UDDF non sa esprimere una
          quindicina di campi — modalità, compagno, voto, zavorra, muta, fuso, valori del computer — e non
          porta niente di quello che sta fuori dalle immersioni. Per quello c'è la scheda qui sotto.
        </p>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            disabled={exporting || dives.length === 0}
            onClick={() => {
              // `void` più `catch`: un gestore `async` passato direttamente a
              // `onClick` fa scartare la promessa a React, e un export fallito
              // resterebbe una unhandled rejection con un bottone che sembra non
              // fare niente.
              void (async () => {
                setExporting(true);
                setExported(null);
                setError(null);
                try {
                  const result = await exportArchive();
                  const dove = await esporta(
                    `mydivelog-${new Date().toISOString().slice(0, 10)}.uddf`,
                    result.xml,
                  );
                  setExported({ dives: result.dives, omitted: result.omitted, dove: dove.dove });
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setExporting(false);
                }
              })();
            }}
          >
            {exporting ? 'Preparazione…' : 'Scarica UDDF'}
          </button>
          <button
            disabled={exporting || dives.length === 0}
            onClick={() => {
              void (async () => {
                setExporting(true);
                setExported(null);
                setError(null);
                try {
                  const result = await exportArchive({ includeProfiles: false });
                  const dove = await esporta(
                    `mydivelog-riepiloghi-${new Date().toISOString().slice(0, 10)}.uddf`,
                    result.xml,
                  );
                  setExported({ dives: result.dives, omitted: result.omitted, dove: dove.dove });
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setExporting(false);
                }
              })();
            }}
          >
            Solo riepiloghi
          </button>
        </div>
        {exported && (
          <div className="notice" style={{ marginTop: 12 }}>
            <b>
              {imm(exported.dives)} {exported.dives === 1 ? 'esportata' : 'esportate'}, {exported.dove}.
            </b>{' '}
            {exported.omitted.length > 0 && (
              <>
                Quello che UDDF non sa rappresentare resta fuori: {exported.omitted.join('; ')}. Per una copia
                completa dell'archivio serve la sincronizzazione, non questo file.
              </>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Cosa fa e cosa non fa</h2>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13 }}>
          <li>
            <b>Le cancellazioni viaggiano, il cestino no.</b> Finché un'immersione è nel cestino resta un
            fatto di questo dispositivo: non sale e non scende, così ripescarla è sempre possibile. Quando
            svuoti il cestino nasce la lapide — «questa è stata cancellata, e quando» — e quella sì che si
            propaga: è l'unica informazione che distingue «non ce l'ho ancora» da «l'ho buttata via».
          </li>
          <li>
            <b>Non duplica.</b> L'identificativo di un'immersione dipende dal suo contenuto: la stessa
            immersione importata su due dispositivi resta una.
          </li>
          <li>
            <b>Viaggia anche quello che hai scritto a mano.</b> Attrezzatura e brevetti, il modulo del
            pianificatore compilato, i piani salvati, le analisi pagate a token: sono le uniche cose
            dell'archivio che nessun file di importazione porta con sé, cioè le uniche che dovresti
            ricompilare due volte. Le raccolte si fondono pezzo per pezzo — un attrezzo aggiunto qui e uno
            aggiunto là ci sono tutti e due — e a parità di pezzo vince la modifica più recente.
          </li>
          <li>
            <b>Viaggia anche fin dove sei arrivato con ogni computer.</b> Se hai scaricato l'Aladin dal Mac,
            il telefono lo sa e al collegamento successivo prende solo le immersioni nuove invece di rileggere
            tutta la memoria — che via Bluetooth sono minuti. Il segnalibro si allinea in fondo al giro, dopo
            le immersioni: prima sarebbe una promessa che l'archivio non ha ancora mantenuto.
          </li>
          <li>
            <b>Le credenziali no.</b> Token di sincronizzazione e chiave API restano su ogni dispositivo: un
            token che viaggia dentro il proprio stesso database sarebbe un cerchio sciocco oltre che
            pericoloso.
          </li>
          <li>
            <b>Riepilogo e profilo viaggiano separati.</b> Un dispositivo può avere le note e l'altro il
            profilo campione per campione: dopo la sincronizzazione entrambi hanno entrambi.
          </li>
          <li>
            <b>Sincronizzare due volte di fila non fa niente la seconda volta.</b> Se il resoconto mostra
            numeri diversi da zero due volte in fila senza che tu abbia toccato niente, è un bug — vale la
            pena segnalarlo.
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
      <h2>Analisi con Claude</h2>
      <p className="card-sub">
        Con una chiave API di Anthropic l'app può far analizzare i dati veri — singola immersione, archivio,
        piano. I numeri restano quelli misurati: al modello vengono dati i valori calcolati dall'app e quelli
        letti dai computer, tenuti distinti, con l'istruzione di non stimare niente.
      </p>

      <div style={{ display: 'grid', gap: 12, maxWidth: 620 }}>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
          Chiave API
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-ant-…"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="muted" style={{ fontSize: 11 }}>
            Resta su questo dispositivo e viene inviata solo all'API di Anthropic. Non è nel codice
            dell'applicazione. Sulla versione web pubblicata una chiave nel browser sarebbe comunque esposta:
            lì è meglio non metterla.
          </span>
        </label>
        <DoveStannoLeCredenziali />

        {models.length > 0 && (
          <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
            Modello
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
            <span className="muted" style={{ fontSize: 11 }}>
              L'elenco arriva dalla tua chiave: nessun nome di modello è scritto nel codice.
            </span>
          </label>
        )}

        <div className="row">
          <button className="btn btn-primary" onClick={() => void load()} disabled={busy || !key.trim()}>
            {busy ? 'Verifica…' : models.length ? 'Aggiorna e salva' : 'Verifica e carica i modelli'}
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
              Dimentica
            </button>
          )}
          {credentials?.model && !dirty && (
            <span className="muted" style={{ fontSize: 12 }}>
              Pronta: {credentials.model}
            </span>
          )}
        </div>

        {ok && (
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Chiave valida, {models.length} modelli disponibili.
          </p>
        )}
        {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--critical)' }}>{error}</p>}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <tr>
      <td>{label}</td>
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
 * Sta sotto all'export UDDF e non al suo posto, perché rispondono a due domande
 * diverse: «voglio i miei dati altrove» e «voglio poter tornare indietro». Averle
 * confuse è il motivo per cui la frase qui sopra prometteva un backup che non era.
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
 */
function DoveStannoLeCredenziali() {
  const { secretPlace } = useDiveLog();
  return (
    <p className="muted" style={{ fontSize: 11, marginTop: 12, marginBottom: 0 }}>
      <b>{secretPlace === 'keychain' ? 'Portachiavi di sistema.' : 'Archivio locale, in chiaro.'}</b>{' '}
      {describePlace(secretPlace)}
    </p>
  );
}

/**
 * L'accesso con un account, che è l'alternativa a incollare un token a mano.
 *
 * PERCHÉ È UNA CARTA A PARTE E NON SOSTITUISCE QUELLA SOTTO. Perché sono due
 * strade valide verso la stessa cosa, e chi ha già un database suo non deve
 * essere costretto a cambiare. L'account crea e gestisce un database per conto
 * di chi accede; il campo qui sotto serve a chi il database se l'è fatto da sé.
 *
 * E soprattutto: **l'accesso non è obbligatorio per usare l'app.** Il logbook si
 * apre e funziona senza, perché l'archivio è locale. Questa carta offre una
 * comodità, non un cancello.
 */
function AccountCard() {
  const { accountAttivo, accountEmail, accediConAccount, esciDallAccount, cancellaAccount } = useDiveLog();
  const [lavoro, setLavoro] = useState<'idle' | 'accesso' | 'chiusura'>('idle');
  const [errore, setErrore] = useState<string | null>(null);

  const accedi = () => {
    void (async () => {
      setLavoro('accesso');
      setErrore(null);
      try {
        await accediConAccount();
      } catch (err) {
        setErrore(err instanceof Error ? err.message : String(err));
      } finally {
        setLavoro('idle');
      }
    })();
  };

  return (
    <div className="card">
      <h2>Accesso</h2>
      <p className="card-sub">
        Con un account Google l'app crea e gestisce un database tutto tuo: non devi più incollare indirizzi né
        token, e gli altri dispositivi si allineano accedendo con lo stesso account. <b>Non è obbligatorio</b>{' '}
        — il logbook si apre e funziona anche senza, perché l'archivio è sul dispositivo.
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
                Sei entrato come <b>{accountEmail}</b>.
              </>
            ) : (
              <>Sei entrato: l’app sincronizza sul database del tuo account.</>
            )}
          </p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => void esciDallAccount()}>Esci</button>
            {/*
             * Cancellare l'account è distruttivo e irreversibile, quindi passa
             * dalla conferma armata come tutte le altre cose che non si possono
             * disfare. Quello che cancella è il database REMOTO: l'archivio su
             * questo dispositivo resta dov'è, ed è scritto qui sotto perché è
             * esattamente la domanda che si fa chi sta per premere.
             */}
            <BottoneConferma
              etichetta="Cancella l’account"
              domanda="Il database remoto e le immersioni che ci sono sopra vengono eliminati. L’archivio su questo dispositivo resta."
              conferma="Sì, cancella il database remoto"
              onConferma={() => {
                setLavoro('chiusura');
                void cancellaAccount()
                  .catch((err) => setErrore(err instanceof Error ? err.message : String(err)))
                  .finally(() => setLavoro('idle'));
              }}
            />
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
            Uscire smette di sincronizzare e basta. Cancellare l'account elimina il database remoto e le
            immersioni che ci sono sopra: quelle su questo dispositivo <b>restano</b>, e da qui si possono
            ricaricare accedendo di nuovo.
          </p>
        </>
      ) : (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={accedi} disabled={lavoro !== 'idle'}>
            {lavoro === 'accesso' ? 'Accesso in corso…' : 'Accedi con Google'}
          </button>
          <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
            Si apre il browser di sistema: la password la scrivi a Google, non a noi.
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
          `Backup scritto ${dove.dove}: ${imm(file.summary.dives)}, ${file.summary.samples.toLocaleString('it')} campioni, ${file.summary.settings.length} impostazioni.`,
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
          `Il file non è JSON valido: ${err instanceof Error ? err.message : String(err)}. Se è un UDDF, va nella scheda Importa.`,
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
          `Ripristino fatto: ${r.added} aggiunte, ${r.merged} aggiornate, ${r.settings} impostazioni riscritte.` +
            (r.onlyLocal > 0 ? ` ${r.onlyLocal} che avevi solo qui sono rimaste dov'erano.` : ''),
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
      <h2>Backup completo e ripristino</h2>
      <p className="card-sub">
        Un file JSON con <b>tutto</b>: immersioni con i profili e i secondi profili, attrezzatura, brevetti,
        piani salvati, analisi generate, obiettivo e periodo. Non lo legge nessun altro programma — quel
        mestiere lo fa l'UDDF qui sopra — e in cambio non perde niente. Le credenziali di sincronizzazione e
        la chiave API restano fuori: un backup finisce su un disco esterno, in una cartella condivisa o
        nell'app File, e non deve portarsi dietro i tuoi segreti.
      </p>
      {suIOS() && (
        <p className="card-sub">
          Su iPhone il file viene scritto nella cartella dell'app dentro <b>File</b> («Sul mio iPhone →
          MyDiveLog»): da lì lo sposti su iCloud, lo mandi per email o lo passi al Mac. Non finisce nei
          Download, che su iOS non esistono per le app.
        </p>
      )}

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          disabled={lavoro !== 'idle' || dives.length === 0}
          onClick={scarica}
        >
          {lavoro === 'export' ? 'Preparazione…' : 'Scarica il backup'}
        </button>
        <button disabled={lavoro !== 'idle'} onClick={() => fileRef.current?.click()}>
          Ripristina da un file…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label="File di backup da ripristinare"
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
            Backup del {dateShort(candidato.createdAt)} · {imm(candidato.summary.dives)} ·{' '}
            {candidato.summary.samples.toLocaleString('it')} campioni
          </div>
          {/* Il piano PRIMA dell'esecuzione: senza, «ripristina» è un salto nel buio. */}
          <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
            <li>
              <b>{piano.added.length}</b> immersioni verranno aggiunte
            </li>
            <li>
              <b>{piano.merged.length}</b> già presenti verranno{' '}
              {modo === 'merge'
                ? 'arricchite senza perdere quello che hai scritto a mano'
                : 'sostituite con la versione del file'}
            </li>
            <li>
              <b>{piano.onlyLocal}</b> che hai solo qui{' '}
              {modo === 'merge' ? 'resteranno dove sono' : <b>verranno cancellate</b>}
            </li>
            <li>
              <b>{Object.keys(piano.settings).length}</b> impostazioni verranno riscritte
            </li>
          </ul>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
            <label className="planner-check" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="radio" checked={modo === 'merge'} onChange={() => cambiaModo('merge')} />
              <span>Fondi con quello che c'è (consigliato)</span>
            </label>
            <label className="planner-check" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="radio" checked={modo === 'replace'} onChange={() => cambiaModo('replace')} />
              <span style={{ color: modo === 'replace' ? 'var(--critical)' : undefined }}>
                Ricostruisci da zero
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
                etichetta={lavoro === 'restore' ? 'Ripristino…' : 'Ripristina'}
                conferma="Sì, ricostruisci da zero"
                domanda={
                  <>
                    Ricostruire l'archivio da zero cancella le {imm(dives.length)} immersioni che hai adesso,{' '}
                    <b>comprese quelle che il backup non contiene</b>. Non passano dal cestino e non si torna
                    indietro.
                  </>
                }
                onConferma={ripristina}
              />
            ) : (
              <button className="btn" disabled={lavoro !== 'idle'} onClick={ripristina}>
                {lavoro === 'restore' ? 'Ripristino…' : 'Ripristina'}
              </button>
            )}
            <button
              onClick={() => {
                setCandidato(null);
                setPiano(null);
                setAvvisi([]);
              }}
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      {esito && (
        <div className="notice" role="status" style={{ marginTop: 12 }}>
          {esito}
        </div>
      )}

      <p className="muted" style={{ fontSize: 11, marginTop: 12, marginBottom: 0 }}>
        L'archivio vive in {storeLocation}. Il backup è una copia di quel contenuto in un file che puoi tenere
        dove vuoi: il senso di averlo è che stia altrove.
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
  const items = sortTrash(trash);

  if (!items.length) {
    return (
      <div className="card">
        <h2>Cestino</h2>
        <p className="card-sub" style={{ marginBottom: 0 }}>
          Vuoto. Quello che cancelli finisce qui e resta recuperabile per {TRASH_DAYS} giorni: nel frattempo
          sparisce dall'archivio e non si sincronizza, ma non è ancora perduto. Passati i trenta giorni la
          cancellazione diventa definitiva su tutti i dispositivi.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0 }}>Cestino</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            {items.length} {items.length === 1 ? 'immersione cancellata' : 'immersioni cancellate'}, con il
            loro profilo. Sono fuori dall'archivio e fuori dalla sincronizzazione, ma non ancora perdute:
            finché sono qui, «Rimetti a posto» le riporta esattamente com'erano.
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
              etichetta="Rimetti a posto tutte"
              conferma={`Sì, rimetti le ${items.length}`}
              domanda={
                <>
                  Rimettere in archivio {imm(items.length)} immersioni? Tornano esattamente com'erano, profilo
                  compreso, e il cestino resta vuoto.
                </>
              }
              onConferma={() => void restoreDives(items.map((i) => i.dive.id))}
            />
          )}
          <BottoneConferma
            etichetta="Svuota il cestino"
            conferma={`Sì, cancella ${items.length === 1 ? "l'immersione" : `le ${items.length}`}`}
            domanda={
              <>
                Cancellare definitivamente {imm(items.length)}{' '}
                {items.length === 1 ? 'immersione' : 'immersioni'}? Da questo momento la cancellazione si
                propaga a <b>tutti i dispositivi sincronizzati</b> e non si può più tornare indietro.
              </>
            }
            onConferma={() => void emptyTrash()}
          />
        </span>
      </div>

      {items.length > TRASH_SOFT_LIMIT && (
        <div className="notice" style={{ marginTop: 12 }}>
          Il cestino contiene {imm(items.length)} con i loro profili: comincia a pesare sull'archivio locale.
          Svuotarlo libera lo spazio — e rende definitive le cancellazioni.
        </div>
      )}

      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Immersione</th>
              <th className="num">Cancellata</th>
              <th className="num">Definitiva fra</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.dive.id}>
                <td>
                  <div style={{ fontWeight: 550 }}>
                    {item.dive.site?.name ?? 'senza sito'}{' '}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {dateShort(item.dive.startTime, item.dive.utcOffsetMinutes)}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {item.dive.maxDepth.toFixed(1)} m · {formatDuration(item.dive.durationS)} ·{' '}
                    {item.samples?.length ? `${item.samples.length} campioni conservati` : 'senza profilo'}
                  </div>
                </td>
                <td className="num tabular muted">{dateShort(item.at)}</td>
                <td
                  className="num tabular"
                  style={{ color: daysLeft(item) <= 3 ? 'var(--warning-text)' : undefined }}
                >
                  {daysLeft(item)} giorni
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => void restoreDive(item.dive.id)}
                    >
                      Rimetti a posto
                    </button>
                    <BottoneConferma
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      etichetta="Elimina"
                      conferma="Sì, cancella"
                      domanda="Cancellare definitivamente questa immersione su tutti i dispositivi? Non si torna indietro."
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
