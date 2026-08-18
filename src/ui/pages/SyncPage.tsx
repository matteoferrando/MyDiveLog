/**
 * Configurazione e uso del database condiviso (Turso / libSQL).
 *
 * Due cose, separate di proposito: le credenziali si inseriscono una volta, la
 * sincronizzazione si lancia quando si vuole. Non c'è nessuna sincronizzazione
 * automatica all'avvio, e non è una mancanza: un logbook si apre anche in barca,
 * dove la rete non c'è, e un'app che all'apertura aspetta la rete è un'app che in
 * barca non si apre.
 */

import { useState } from 'react';
import { useDiveLog } from '../state';
import { TRASH_DAYS, TRASH_SOFT_LIMIT, daysLeft, sortTrash } from '../../storage/trash';
import { formatDuration } from '../../core/units';
import { dateShort, imm } from '../format';
import type { SyncReport } from '../../sync/turso';
import type { AiModel } from '../../ai/client';

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
  const [exported, setExported] = useState<{ dives: number; omitted: string[] } | null>(null);
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

      <div className="card">
        <h2>Database condiviso</h2>
        <p className="card-sub">
          Un solo archivio per tutti i dispositivi. L'app continua a funzionare offline: la
          sincronizzazione è un'operazione che lanci tu, non una condizione per aprire il logbook.
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
              Resta su questo dispositivo, nell'archivio locale ({storeLocation}). Non viene inviato a
              nessuno tranne che a Turso, e non è nel codice dell'applicazione.
            </span>
          </label>

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
          Prima scarica, poi carica. Niente viene cancellato: le immersioni si aggiungono e si
          completano a vicenda — il riepilogo più recente e il profilo più ricco, anche quando arrivano
          da dispositivi diversi.
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
      </div>

      <ClaudeSettings
        credentials={aiCredentials}
        onSave={saveAiCredentials}
        onTest={testAiKey}
        storeLocation={storeLocation}
      />

      <div className="card">
        <h2>Come ottenere le credenziali del database</h2>
        <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13 }}>
          <li>
            Su <b>turso.tech</b>, apri il database e copia l'indirizzo che comincia per{' '}
            <code>libsql://</code>.
          </li>
          <li>
            Sempre da lì, <b>Create Token</b>: il token compare una volta sola, copialo e incollalo qui
            sopra. Genera un token per dispositivo, così se ne perdi uno revochi solo quello.
          </li>
          <li>
            La prima sincronizzazione crea le tabelle e carica l'archivio. Sugli altri dispositivi le
            stesse credenziali scaricano tutto.
          </li>
        </ol>
      </div>

      <TrashCard />

      <div className="card">
        <h2>Esporta l'archivio</h2>
        <p className="card-sub">
          Un file UDDF con tutte le {dives.length} immersioni e i loro profili. È il formato standard
          che gli altri programmi del settore leggono, ed è lo stesso che questa app importa: il giro
          si chiude, e l'archivio non è prigioniero di nessuno. Questo file è anche il backup.
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
                  download(result.xml, `mydivelog-${new Date().toISOString().slice(0, 10)}.uddf`);
                  setExported({ dives: result.dives, omitted: result.omitted });
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
                  download(result.xml, `mydivelog-riepiloghi-${new Date().toISOString().slice(0, 10)}.uddf`);
                  setExported({ dives: result.dives, omitted: result.omitted });
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
            <b>{imm(exported.dives)} {exported.dives === 1 ? 'esportata' : 'esportate'}.</b>{' '}
            {exported.omitted.length > 0 && (
              <>
                Quello che UDDF non sa rappresentare resta fuori: {exported.omitted.join('; ')}. Per una
                copia completa dell'archivio serve la sincronizzazione, non questo file.
              </>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Cosa fa e cosa non fa</h2>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13 }}>
          <li>
            <b>Non cancella.</b> Se elimini un'immersione su un dispositivo, la sincronizzazione
            successiva la riscarica: propagare le cancellazioni richiede tenere un registro di ciò che è
            stato eliminato, e finché non c'è la scelta è dichiarata — meglio un'immersione di troppo che
            una perduta. Per cancellarla davvero, eliminala e poi rimuovila anche dal database remoto.
          </li>
          <li>
            <b>Non duplica.</b> L'identificativo di un'immersione dipende dal suo contenuto: la stessa
            immersione importata su due dispositivi resta una.
          </li>
          <li>
            <b>Viaggiano anche il piano gas e le analisi già generate.</b> Il modulo del
            pianificatore compilato e le analisi pagate a token si ritrovano sull'altro dispositivo,
            e fra due versioni vince la più recente. Le credenziali no: token e chiave API restano su
            ogni dispositivo, e un token che viaggia dentro il proprio stesso database sarebbe un
            cerchio sciocco oltre che pericoloso.
          </li>
          <li>
            <b>Riepilogo e profilo viaggiano separati.</b> Un dispositivo può avere le note e l'altro il
            profilo campione per campione: dopo la sincronizzazione entrambi hanno entrambi.
          </li>
          <li>
            <b>Sincronizzare due volte di fila non fa niente la seconda volta.</b> Se il resoconto
            mostra numeri diversi da zero due volte in fila senza che tu abbia toccato niente, è un bug —
            vale la pena segnalarlo.
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
  storeLocation,
}: {
  credentials: { apiKey: string; model?: string } | null;
  onSave: (c: { apiKey: string; model?: string } | null) => Promise<void>;
  onTest: (c: { apiKey: string; model?: string }) => Promise<{ ok: true; models: AiModel[] } | { ok: false; error: string }>;
  storeLocation: string;
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
        Con una chiave API di Anthropic l'app può far analizzare i dati veri — singola immersione,
        archivio, piano. I numeri restano quelli misurati: al modello vengono dati i valori calcolati
        dall'app e quelli letti dai computer, tenuti distinti, con l'istruzione di non stimare niente.
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
            Resta su questo dispositivo, nell'archivio locale ({storeLocation}), e viene inviata solo
            all'API di Anthropic. Non è nel codice dell'applicazione. Sulla versione web pubblicata,
            invece, una chiave nel browser sarebbe esposta: lì è meglio non metterla.
          </span>
        </label>

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

        {ok && <p className="muted" style={{ margin: 0, fontSize: 12 }}>Chiave valida, {models.length} modelli disponibili.</p>}
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
function download(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const { trash, restoreDive, purgeDive, emptyTrash } = useDiveLog();
  const items = sortTrash(trash);

  if (!items.length) {
    return (
      <div className="card">
        <h2>Cestino</h2>
        <p className="card-sub" style={{ marginBottom: 0 }}>
          Vuoto. Quello che cancelli finisce qui e resta recuperabile per {TRASH_DAYS} giorni: nel
          frattempo sparisce dall'archivio e non si sincronizza, ma non è ancora perduto. Passati i
          trenta giorni la cancellazione diventa definitiva su tutti i dispositivi.
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
            {items.length} {items.length === 1 ? 'immersione cancellata' : 'immersioni cancellate'}, con
            il loro profilo. Sono fuori dall'archivio e fuori dalla sincronizzazione, ma non ancora
            perdute: finché sono qui, «Rimetti a posto» le riporta esattamente com'erano.
          </p>
        </div>
        <button
          style={{ color: 'var(--critical)' }}
          onClick={() => {
            if (
              confirm(
                `Cancellare definitivamente ${items.length} ${items.length === 1 ? 'immersione' : 'immersioni'}?\n\nDa questo momento la cancellazione si propaga a tutti i dispositivi sincronizzati e non si può più tornare indietro.`,
              )
            ) {
              void emptyTrash();
            }
          }}
        >
          Svuota il cestino
        </button>
      </div>

      {items.length > TRASH_SOFT_LIMIT && (
        <div className="notice" style={{ marginTop: 12 }}>
          Il cestino contiene {imm(items.length)} con i loro profili: comincia a pesare
          sull'archivio locale. Svuotarlo libera lo spazio — e rende definitive le cancellazioni.
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
                <td className="num tabular" style={{ color: daysLeft(item) <= 3 ? 'var(--warning)' : undefined }}>
                  {daysLeft(item)} giorni
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => void restoreDive(item.dive.id)}>
                      Rimetti a posto
                    </button>
                    <button
                      style={{ fontSize: 11, padding: '3px 8px', color: 'var(--critical)' }}
                      onClick={() => {
                        if (confirm('Cancellare definitivamente questa immersione su tutti i dispositivi?')) {
                          void purgeDive(item.dive.id);
                        }
                      }}
                    >
                      Elimina
                    </button>
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
