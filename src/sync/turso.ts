/**
 * Sincronizzazione con un database libSQL remoto (Turso).
 *
 * SCELTA DI FONDO: il database locale resta la fonte di verità, e la
 * sincronizzazione è un'operazione esplicita — non un database remoto usato al
 * posto di quello locale.
 *
 * L'alternativa naturale sarebbero le *embedded replicas* di libSQL, che tengono
 * un file locale allineato in automatico. Sono la cosa giusta per un server, e la
 * cosa sbagliata qui per due ragioni concrete: richiedono i binding nativi di
 * libSQL, che in una webview non girano (quindi niente iOS e niente web), e
 * legano l'apertura dell'archivio alla rete. Un logbook si consulta in barca,
 * dove la rete non c'è: l'app deve funzionare identica offline e allinearsi
 * quando può.
 *
 * PERCHÉ NON SERVE UN VERO SISTEMA DI RISOLUZIONE DEI CONFLITTI: l'`id` di
 * un'immersione è deterministico e ricavato dal contenuto (`dedupe.ts`), quindi
 * due dispositivi che importano lo stesso file producono lo stesso id. Non
 * esistono due versioni create indipendentemente; esiste una immersione,
 * eventualmente arricchita in modo diverso. Riepilogo e profilo si decidono
 * separatamente — il più recente per l'uno, il più ricco per l'altro — e le regole
 * stanno in `plan.ts` con i loro test.
 *
 * IL TOKEN NON STA NEL CODICE. Vive nella tabella delle impostazioni del
 * database locale, inserito una volta dall'interfaccia. Nel repository non c'è
 * nessuna credenziale, e un `git push` distratto non ne può portare fuori.
 */

import type { Dive, Sample } from '../core/model';
import type { DiveStore } from '../storage';
import { normaliseDive } from '../storage/repair';
import { TRASH_KEY, trashedIds, type TrashedDive } from '../storage/trash';
import { digestOf, planSync, type SyncFingerprint, type SyncPlan } from './plan';

/**
 * Il minimo che serve da un client SQL. Definirlo qui invece di dipendere dal
 * tipo di `@libsql/client` permette ai test di iniettare un vero SQLite locale:
 * le query vengono eseguite davvero, senza rete e senza finzioni.
 */
export interface SqlExecutor {
  execute(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  close?(): void;
}

export interface SyncCredentials {
  /** `libsql://nome-org.regione.turso.io` */
  url: string;
  authToken: string;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS dives (
     id           TEXT PRIMARY KEY,
     start_time   TEXT NOT NULL,
     updated_at   TEXT,
     sample_count INTEGER NOT NULL DEFAULT 0,
     digest       TEXT NOT NULL,
     doc          TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_dives_start ON dives(start_time DESC)`,
  `CREATE TABLE IF NOT EXISTS dive_samples (
     dive_id TEXT PRIMARY KEY,
     count   INTEGER NOT NULL,
     doc     TEXT NOT NULL
   )`,
  // Il secondo profilo, quando due computer hanno registrato la stessa
  // immersione. Viaggia insieme al principale: le velocità e l'assetto vengono
  // misurati su di lui, quindi un dispositivo che riceve l'immersione senza questo
  // profilo non potrebbe ricalcolare le metriche senza peggiorarle.
  `CREATE TABLE IF NOT EXISTS dive_alt_samples (
     dive_id TEXT PRIMARY KEY,
     count   INTEGER NOT NULL,
     doc     TEXT NOT NULL
   )`,
  // Le impostazioni che ha senso condividere: il piano gas compilato e le analisi
  // già generate. NON le credenziali — quelle restano su ogni dispositivo, e un
  // token che viaggia dentro il proprio stesso database sarebbe un cerchio
  // sciocco oltre che pericoloso. Ogni chiave porta il suo `updated_at`, e vince
  // la più recente: sono impostazioni, non dati storici, e per loro "l'ultima
  // parola detta" è il criterio giusto.
  `CREATE TABLE IF NOT EXISTS settings (
     key        TEXT PRIMARY KEY,
     updated_at TEXT NOT NULL,
     doc        TEXT NOT NULL
   )`,
  // Le immersioni cancellate, e il perché di una tabella per una cosa che non
  // c'è più. Senza, cancellare un'immersione su un dispositivo non significava
  // niente: alla sincronizzazione successiva l'altro dispositivo la rimandava
  // indietro, e l'unico modo di liberarsene davvero era cancellarla ovunque nello
  // stesso momento. La lapide dice «questa è stata cancellata, e quando», ed è
  // l'unica informazione che permette di distinguere «non ce l'ho ancora» da
  // «l'ho buttata via».
  `CREATE TABLE IF NOT EXISTS deletions (
     id         TEXT PRIMARY KEY,
     deleted_at TEXT NOT NULL
   )`,
];

/** Chiave locale in cui si tengono le lapidi in attesa di essere spedite. */
export const TOMBSTONE_KEY = 'deletedDives';

export interface Tombstone {
  id: string;
  at: string;
}

/**
 * Le impostazioni che viaggiano, e perché queste.
 *
 * `gasPlan` e `decoPlan`: bombola, miscela, consumo del compagno, velocità di
 * risalita, livelli e gas di decompressione non cambiano da un dispositivo
 * all'altro, e ricompilare il modulo sul telefono renderebbe il pianificatore un
 * esercizio invece di uno strumento. Il piano tecnico pesa più degli altri:
 * compilarlo richiede minuti, non secondi.
 *
 * `analyses`: sono già state pagate a token. Riscaricarle costa una query;
 * rigenerarle costa denaro.
 */
const SHARED_SETTINGS = ['gasPlan', 'decoPlan', 'decoPlans', 'analyses', 'gear'] as const;

/** Quante immersioni per richiesta: i riepiloghi sono piccoli, i profili no. */
const PUSH_CHUNK = 25;

export interface SyncReport {
  plan: SyncPlan;
  pushed: number;
  pulled: number;
  pushedProfiles: number;
  pulledProfiles: number;
  /** Immersioni in archivio dopo la sincronizzazione. */
  total: number;
  /** Impostazioni condivise caricate e scaricate. */
  settingsPushed: number;
  settingsPulled: number;
  /** Cancellazioni spedite, e cancellazioni altrui applicate qui. */
  deletionsPushed: number;
  deletionsApplied: number;
  durationMs: number;
}

/**
 * Sincronizza le impostazioni condivise: vince la più recente.
 *
 * Ogni valore viaggia con il momento in cui è stato scritto localmente. Senza
 * quel timbro non ci sarebbe modo di sapere chi ha ragione, e l'alternativa —
 * "vince chi sincronizza per ultimo" — cancellerebbe in silenzio il lavoro fatto
 * sull'altro dispositivo.
 */
async function syncSettings(store: DiveStore, sql: SqlExecutor): Promise<{ pushed: number; pulled: number }> {
  let pushed = 0;
  let pulled = 0;
  const { rows } = await sql.execute('SELECT key, updated_at, doc FROM settings');
  const remote = new Map(rows.map((r) => [String(r.key), { at: String(r.updated_at), doc: String(r.doc) }]));

  for (const key of SHARED_SETTINGS) {
    const local = await store.getSetting<unknown>(key);
    const localAt = (await store.getSetting<string>(`${key}:at`)) ?? '';
    const there = remote.get(key);

    // Le analisi si FONDONO chiave per chiave, non si sostituiscono in blocco.
    //
    // Erano l'unica impostazione per cui «vince la più recente» era sbagliato:
    // ogni analisi è un oggetto a sé, pagato a token, e sostituire l'intera
    // raccolta con quella del dispositivo che ha scritto per ultimo cancellava le
    // analisi generate sull'altro. Con la fusione per chiave nessuna sparisce, e
    // quando la stessa chiave esiste da entrambe le parti vince quella generata
    // più tardi — che è un confronto fra le due analisi, non fra i due
    // dispositivi.
    // Le raccolte si FONDONO, non si sostituiscono.
    //
    // `analyses` aveva già la fusione per chiave. `decoPlans` (piani tecnici
    // salvati con un nome) e `gear` (attrezzatura) hanno la stessa identica forma
    // — liste di oggetti indipendenti creati a mano — ed erano rimaste su «vince
    // la più recente»: chi salvava un piano su un dispositivo e uno sull'altro
    // senza sincronizzare in mezzo ne perdeva uno, da entrambe le parti, senza
    // avviso e senza cestino.
    if ((key === 'decoPlans' || key === 'gear') && there) {
      const merged = mergeKeyed(local, JSON.parse(there.doc), key === 'gear' ? 'id' : 'name');
      if (merged.changedLocally) {
        await store.setSetting(key, merged.value);
        await store.setSetting(`${key}:at`, new Date().toISOString());
        pulled++;
      }
      if (merged.changedRemotely) {
        await sql.execute(
          'INSERT INTO settings (key, updated_at, doc) VALUES (?, ?, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at, doc = excluded.doc',
          [key, new Date().toISOString(), JSON.stringify(merged.value)],
        );
        pushed++;
      }
      continue;
    }

    if (key === 'analyses' && there) {
      const merged = mergeAnalyses(local, JSON.parse(there.doc));
      if (merged.changedLocally) {
        await store.setSetting(key, merged.value);
        await store.setSetting(`${key}:at`, new Date().toISOString());
        pulled++;
      }
      if (merged.changedRemotely) {
        await sql.execute(
          'INSERT INTO settings (key, updated_at, doc) VALUES (?, ?, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at, doc = excluded.doc',
          [key, new Date().toISOString(), JSON.stringify(merged.value)],
        );
        pushed++;
      }
      continue;
    }

    if (local !== undefined && (!there || localAt > there.at)) {
      const at = localAt || new Date().toISOString();
      await sql.execute(
        'INSERT INTO settings (key, updated_at, doc) VALUES (?, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at, doc = excluded.doc',
        [key, at, JSON.stringify(local)],
      );
      pushed++;
    } else if (there && there.at > localAt) {
      await store.setSetting(key, JSON.parse(there.doc));
      await store.setSetting(`${key}:at`, there.at);
      pulled++;
    }
  }
  return { pushed, pulled };
}

/** Analisi vista dalla sincronizzazione: solo il timbro, il resto non la riguarda. */
type AnalysisStamp = { at?: string; createdAt?: string };

/**
 * Quando è stata generata quest'analisi.
 *
 * QUI STAVA IL GUASTO. Questa funzione leggeva `createdAt`, ma `StoredAnalysis`
 * — la forma che l'applicazione scrive davvero — il campo lo chiama `at`. Su un
 * dato reale il confronto era quindi sempre `'' > ''`, cioè falso in entrambe le
 * direzioni: quando la stessa analisi esisteva su due dispositivi vinceva
 * SEMPRE quella locale, in silenzio, e `changedRemotely` non si accendeva mai,
 * quindi nemmeno la propria risaliva. Le analisi restavano ferme dove erano
 * state generate e nessuno se ne accorgeva, perché un'analisi che non arriva
 * assomiglia a un'analisi che non è mai stata fatta.
 *
 * `createdAt` resta come ripiego: costa una `??` e copre qualunque record
 * scritto da una versione che usava quel nome.
 */
const generataIl = (a: AnalysisStamp | undefined): string => a?.at ?? a?.createdAt ?? '';

/**
 * Unisce due raccolte di analisi chiave per chiave.
 *
 * Il criterio dentro una chiave è la data di generazione dell'analisi stessa,
 * non quella della sincronizzazione: quello che conta è quale delle due analisi
 * è più recente, e la data di sincronizzazione dice solo chi ha parlato per
 * ultimo.
 */
export function mergeAnalyses(
  localRaw: unknown,
  remoteRaw: unknown,
): { value: Record<string, AnalysisStamp>; changedLocally: boolean; changedRemotely: boolean } {
  const local = (localRaw ?? {}) as Record<string, AnalysisStamp>;
  const remote = (remoteRaw ?? {}) as Record<string, AnalysisStamp>;
  const out: Record<string, AnalysisStamp> = { ...local };
  let changedLocally = false;
  let changedRemotely = false;

  for (const [k, v] of Object.entries(remote)) {
    const mine = local[k];
    if (!mine) {
      out[k] = v;
      changedLocally = true;
    } else if (generataIl(v) > generataIl(mine)) {
      out[k] = v;
      changedLocally = true;
    } else if (generataIl(mine) > generataIl(v)) {
      changedRemotely = true;
    }
  }
  for (const k of Object.keys(local)) if (!(k in remote)) changedRemotely = true;

  return { value: out, changedLocally, changedRemotely };
}

/**
 * Scambia le cancellazioni.
 *
 * Tre movimenti. Le lapidi locali in attesa salgono e vengono applicate al
 * database remoto, cancellando l'immersione e i suoi profili. Le lapidi remote
 * scendono e cancellano qui quello che è stato buttato altrove. Alla fine l'elenco
 * completo delle cancellazioni note resta salvato in locale, perché un dispositivo
 * che si è perso una sincronizzazione possa comunque non far resuscitare niente.
 *
 * Le lapidi non scadono. Costano una riga di testo l'una e l'alternativa — buttarle
 * dopo N giorni — significa che un dispositivo rimasto spento più di N giorni
 * rimette in circolo tutto quello che era stato cancellato.
 */
export async function syncDeletions(
  store: DiveStore,
  sql: SqlExecutor,
): Promise<{ pushed: number; applied: number; ids: Set<string> }> {
  const known = (await store.getSetting<Tombstone[]>(TOMBSTONE_KEY)) ?? [];
  let pushed = 0;
  let applied = 0;

  // Solo le lapidi che il remoto non ha ancora.
  //
  // Prima si rispediva l'intero elenco a ogni sincronizzazione — quattro query
  // per lapide, per sempre: con duecento immersioni cancellate erano ottocento
  // viaggi di rete a ogni giro, anche quando non c'era niente da fare. E
  // `deletionsPushed` riportava duecento ogni volta, cioè un numero senza
  // significato.
  const { rows: already } = await sql.execute('SELECT id FROM deletions');
  const remoteKnown = new Set(already.map((r) => String(r.id)));
  const pending = known.filter((t) => !remoteKnown.has(t.id));

  for (const chunk of chunks(pending, PUSH_CHUNK)) {
    for (const t of chunk) {
      await sql.execute('INSERT INTO deletions (id, deleted_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING', [
        t.id,
        t.at,
      ]);
      await sql.execute('DELETE FROM dives WHERE id = ?', [t.id]);
      await sql.execute('DELETE FROM dive_samples WHERE dive_id = ?', [t.id]);
      await sql.execute('DELETE FROM dive_alt_samples WHERE dive_id = ?', [t.id]);
      pushed++;
    }
  }

  const { rows } = await sql.execute('SELECT id, deleted_at FROM deletions');
  const all: Tombstone[] = rows.map((r) => ({ id: String(r.id), at: String(r.deleted_at) }));
  const ids = new Set(all.map((t) => t.id));

  // Quello che è stato cancellato altrove va cancellato anche qui — MA una lapide
  // non può uccidere due volte.
  //
  // Il difetto: le lapidi non scadono e vengono riapplicate a ogni giro, quindi
  // ripristinare dal cestino o reimportare il file di un'immersione cancellata
  // funzionava fino alla sincronizzazione successiva, che la faceva sparire di
  // nuovo — stavolta senza passare dal cestino, cioè per sempre e senza un
  // avviso. Qui una lapide vale solo finché l'immersione non è stata toccata DOPO
  // di lei: `updatedAt` più recente della lapide significa che qualcuno l'ha
  // rimessa apposta, e allora è la lapide a doversene andare.
  const here = new Map((await store.listDives()).map((d) => [d.id, d]));
  const resurrected = new Set<string>();
  for (const t of all) {
    const dive = here.get(t.id);
    if (!dive) continue;
    if (dive.updatedAt && dive.updatedAt > t.at) {
      resurrected.add(t.id);
      continue;
    }
    await store.deleteDive(t.id);
    applied++;
  }

  for (const id of resurrected) {
    await sql.execute('DELETE FROM deletions WHERE id = ?', [id]);
    ids.delete(id);
  }

  await store.setSetting(
    TOMBSTONE_KEY,
    all.filter((t) => !resurrected.has(t.id)),
  );
  return { pushed, applied, ids };
}

/**
 * Unisce due elenchi di oggetti identificati da una chiave.
 *
 * Serve a `decoPlans` e a `gear`: liste che due dispositivi allungano
 * indipendentemente, in cui l'unica cosa sbagliata da fare è sostituire l'una con
 * l'altra. Quando la stessa chiave esiste da entrambe le parti vince la versione
 * con il timbro più recente, e se il timbro non c'è vince quella locale — perché
 * senza una data non c'è modo onesto di dire chi è più nuovo, e cancellare il
 * proprio lavoro in caso di dubbio è la scelta peggiore.
 */
export function mergeKeyed(
  localRaw: unknown,
  remoteRaw: unknown,
  keyField: string,
  stampField = 'savedAt',
): { value: unknown[]; changedLocally: boolean; changedRemotely: boolean } {
  const asList = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const local = asList(localRaw);
  const remote = asList(remoteRaw);
  const byKey = new Map(local.map((x) => [String(x[keyField]), x]));
  let changedLocally = false;
  let changedRemotely = false;

  for (const r of remote) {
    const k = String(r[keyField]);
    const mine = byKey.get(k);
    if (!mine) {
      byKey.set(k, r);
      changedLocally = true;
      continue;
    }
    const mineAt = String(mine[stampField] ?? '');
    const theirsAt = String(r[stampField] ?? '');
    if (theirsAt > mineAt) {
      byKey.set(k, r);
      changedLocally = true;
    } else if (JSON.stringify(mine) !== JSON.stringify(r)) {
      changedRemotely = true;
    }
  }
  for (const x of local)
    if (!remote.some((r) => String(r[keyField]) === String(x[keyField]))) changedRemotely = true;

  return { value: [...byKey.values()], changedLocally, changedRemotely };
}

export async function ensureRemoteSchema(sql: SqlExecutor): Promise<void> {
  for (const stmt of SCHEMA) await sql.execute(stmt);
}

/** Impronte delle immersioni remote, senza scaricare né documenti né profili. */
export async function remoteFingerprints(sql: SqlExecutor): Promise<SyncFingerprint[]> {
  const { rows } = await sql.execute(
    `SELECT d.id, d.updated_at, d.sample_count, d.digest,
            (SELECT count FROM dive_alt_samples a WHERE a.dive_id = d.id) AS alt_count
       FROM dives d`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
    sampleCount: Number(r.sample_count ?? 0),
    altSampleCount: Number(r.alt_count ?? 0),
    digest: String(r.digest ?? ''),
  }));
}

/**
 * Impronte locali.
 *
 * `counts` arriva da `store.sampleCounts()` e non dai `samples` dei riepiloghi,
 * che nella lista non ci sono: dedurre il conteggio dal riepilogo darebbe zero
 * per tutte le immersioni con profilo, e la sincronizzazione scaricherebbe ogni
 * volta profili che ha già.
 */
export function localFingerprints(
  dives: Dive[],
  counts: Map<string, number>,
  altCounts?: Map<string, number>,
): SyncFingerprint[] {
  return dives.map((d) => ({
    id: d.id,
    updatedAt: d.updatedAt,
    sampleCount: counts.get(d.id) ?? d.samples?.length ?? 0,
    altSampleCount: altCounts?.get(d.id) ?? d.altSamples?.length ?? 0,
    digest: digestOf(d as unknown as Record<string, unknown>),
  }));
}

/**
 * Esegue una sincronizzazione completa.
 *
 * L'ordine conta: prima si scarica, poi si carica. Se la connessione cade a metà,
 * il dispositivo si ritrova con più dati e non con meno — e la volta successiva
 * il piano ricalcola cosa manca. Nessun passaggio cancella niente: le immersioni
 * si aggiungono e si arricchiscono, mai si rimuovono. Cancellare da un
 * dispositivo e propagare la cancellazione richiede un registro delle
 * eliminazioni, che non c'è: per ora una cancellazione è locale, e la
 * sincronizzazione successiva la annulla riscaricando l'immersione. È una scelta
 * consapevole — meglio un'immersione di troppo che una perduta — ed è il primo
 * pezzo da aggiungere se un giorno serve.
 */
export async function syncArchive(
  store: DiveStore,
  sql: SqlExecutor,
  onProgress?: (message: string) => void,
): Promise<SyncReport> {
  const startedAt = Date.now();
  const say = (m: string) => onProgress?.(m);

  say('Preparazione del database remoto…');
  await ensureRemoteSchema(sql);

  // --- lapidi, prima di tutto il resto -------------------------------------
  //
  // Vanno scambiate PRIMA del piano di sincronizzazione, perché il piano si
  // costruisce su cosa c'è di qua e cosa c'è di là: se una cancellazione arriva
  // dopo, l'immersione viene prima scaricata e poi buttata via, e nel mezzo
  // compare in elenco.
  say('Cancellazioni…');
  const deleted = await syncDeletions(store, sql);
  if (deleted.applied) say(`${deleted.applied} immersioni cancellate altrove.`);

  // Il cestino non viaggia, ma la sincronizzazione lo deve rispettare in
  // ENTRAMBI i versi: quello che è nel cestino non si carica (l'abbiamo tolto qui)
  // e non si scarica (altrimenti tornerebbe indietro dal remoto il giorno dopo,
  // rendendo il cestino una finzione). La lapide vera nascerà solo svuotandolo.
  const inTrash = trashedIds((await store.getSetting<TrashedDive[]>(TRASH_KEY)) ?? []);

  const localDives = (await store.listDives()).filter((d) => !inTrash.has(d.id));
  const local = localFingerprints(localDives, await store.sampleCounts(), await store.altSampleCounts());
  const remote = (await remoteFingerprints(sql)).filter((f) => !deleted.ids.has(f.id) && !inTrash.has(f.id));
  const plan = planSync(local, remote);
  say(`${plan.push.length} da caricare, ${plan.pull.length} da scaricare, ${plan.unchanged} già allineate.`);

  // --- scarico -------------------------------------------------------------
  let pulled = 0;
  let pulledProfiles = 0;
  /*
   * Le immersioni che la pulizia ha corretto SCENDENDO, e che vanno rispedite su.
   *
   * IL DIFETTO CHE CHIUDE. `normaliseDive` cambia il documento in arrivo ma non
   * tocca `updatedAt`, e l'impronta salvata nella riga remota resta quella di
   * prima: al giro dopo le due impronte differiscono con `updatedAt` pari,
   * quindi decide il confronto lessicografico fra i digest — e quando perde il
   * locale, lo STESSO documento si riscarica a ogni sincronizzazione, per
   * sempre. Misurato: sei giri di fila con `pull=1, push=0`, e con un altro
   * identificativo la monetina cade dall'altra parte e converge in tre.
   *
   * Il rimedio è quello ovvio una volta visto: se la pulizia ha corretto
   * qualcosa, la correzione va propagata invece di essere rifatta ogni volta.
   * Termina da sé — dopo la riscrittura le due impronte coincidono — e non
   * tocca `updatedAt`, quindi non fa rimbalzare niente sugli altri dispositivi.
   */
  const daRimandareSu: Dive[] = [];
  if (plan.pull.length) {
    for (const chunk of chunks(plan.pull, PUSH_CHUNK)) {
      const { rows } = await sql.execute(
        `SELECT doc FROM dives WHERE id IN (${placeholders(chunk.length)})`,
        chunk,
      );
      // Normalizzate PRIMA di entrare nell'archivio: quello che scende dalla rete
      // attraversa la stessa pulizia di quello che arriva da un file. Senza,
      // bastava che l'altro capo avesse la versione vecchia di un'immersione
      // perché un difetto già corretto tornasse dentro — e la riparazione non
      // poteva vederlo, perché gira all'avvio e la sincronizzazione viene dopo.
      const dives = rows.map((r) => {
        const grezza = JSON.parse(String(r.doc)) as Dive;
        const pulita = normaliseDive(grezza);
        // Vedi `daRimandareSu`: se la pulizia ha cambiato qualcosa, il remoto
        // tiene ancora la versione sporca e va corretto in questo stesso giro.
        if (pulita !== grezza) daRimandareSu.push(pulita);
        return pulita;
      });
      // I profili arrivano solo per le immersioni che li hanno da scaricare.
      for (const dive of dives) {
        if (plan.pullSamples.includes(dive.id)) {
          dive.samples = await pullSamples(sql, dive.id);
          if (dive.samples.length) pulledProfiles++;
          const alt = await pullSamples(sql, dive.id, 'dive_alt_samples');
          if (alt.length) dive.altSamples = alt;
        }
      }
      await store.putDives(dives);
      pulled += dives.length;
      say(`Scaricate ${pulled} di ${plan.pull.length}…`);
    }
  }

  // Profili mancanti su immersioni il cui riepilogo era già allineato.
  for (const id of plan.pullSamples) {
    if (plan.pull.includes(id)) continue;
    const samples = await pullSamples(sql, id);
    if (!samples.length) continue;
    const dive = localDives.find((d) => d.id === id);
    if (!dive) continue;
    const alt = await pullSamples(sql, id, 'dive_alt_samples');
    await store.putDives([{ ...dive, samples, ...(alt.length ? { altSamples: alt } : {}) }]);
    pulledProfiles++;
  }

  // --- carico --------------------------------------------------------------
  let pushed = 0;
  let pushedProfiles = 0;
  const digests = new Map(local.map((f) => [f.id, f]));

  const remoteById = new Map(remote.map((r) => [r.id, r]));
  for (const id of plan.push) {
    const dive = localDives.find((d) => d.id === id);
    if (!dive) continue;
    const fp = digests.get(id)!;
    await sql.execute(
      `INSERT INTO dives (id, start_time, updated_at, sample_count, digest, doc)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         start_time = excluded.start_time,
         updated_at = excluded.updated_at,
         sample_count = excluded.sample_count,
         digest = excluded.digest,
         doc = excluded.doc`,
      // `sample_count` NON si abbassa mai caricando il solo riepilogo.
      //
      // Il difetto: A ha l'immersione senza profilo ma con le note aggiunte dopo,
      // quindi vince il riepilogo di A; caricandolo scriveva `sample_count = 0`
      // sulla riga di un'immersione il cui profilo da duecento campioni era già
      // nel remoto. Da quel momento un terzo dispositivo vedeva zero da entrambe
      // le parti, il piano non chiedeva niente, e quel profilo non lo scaricava
      // più nessuno. Il conteggio descrive il PROFILO, non il riepilogo che si
      // sta caricando.
      [
        id,
        dive.startTime,
        dive.updatedAt ?? null,
        Math.max(fp.sampleCount, remoteById.get(id)?.sampleCount ?? 0),
        fp.digest,
        JSON.stringify(stripSamples(dive)),
      ],
    );
    pushed++;
    if (pushed % 10 === 0) say(`Caricate ${pushed} di ${plan.push.length}…`);
  }

  // Le correzioni fatte scendendo tornano su, così il giro successivo trova le
  // due parti d'accordo invece di riscaricare lo stesso documento all'infinito.
  for (const dive of daRimandareSu) {
    const doc = stripSamples(dive);
    await sql.execute(`UPDATE dives SET digest = ?, doc = ? WHERE id = ?`, [
      digestOf(doc as unknown as Record<string, unknown>),
      JSON.stringify(doc),
      dive.id,
    ]);
  }

  for (const id of plan.pushSamples) {
    const samples = await store.getSamples(id);
    if (!samples.length) continue;
    await sql.execute(
      `INSERT INTO dive_samples (dive_id, count, doc) VALUES (?, ?, ?)
       ON CONFLICT(dive_id) DO UPDATE SET count = excluded.count, doc = excluded.doc`,
      [id, samples.length, JSON.stringify(samples)],
    );
    // Il secondo profilo viaggia con il principale, non per conto suo: è ciò che
    // permette all'altro dispositivo di ricalcolare le metriche senza peggiorarle.
    const alt = await store.getAltSamples(id);
    if (alt.length) {
      await sql.execute(
        `INSERT INTO dive_alt_samples (dive_id, count, doc) VALUES (?, ?, ?)
         ON CONFLICT(dive_id) DO UPDATE SET count = excluded.count, doc = excluded.doc`,
        [id, alt.length, JSON.stringify(alt)],
      );
    }
    // `sample_count` sul riepilogo deve restare coerente, altrimenti il piano
    // successivo ricaricherebbe lo stesso profilo all'infinito.
    await sql.execute('UPDATE dives SET sample_count = ? WHERE id = ?', [samples.length, id]);
    pushedProfiles++;
    say(`Caricati ${pushedProfiles} profili…`);
  }

  const total = (await store.listDives()).length;
  const settings = await syncSettings(store, sql).catch(() => ({ pushed: 0, pulled: 0 }));

  return {
    plan,
    deletionsPushed: deleted.pushed,
    deletionsApplied: deleted.applied,
    settingsPushed: settings.pushed,
    settingsPulled: settings.pulled,
    pushed,
    pulled,
    pushedProfiles,
    pulledProfiles,
    total,
    durationMs: Date.now() - startedAt,
  };
}

async function pullSamples(
  sql: SqlExecutor,
  diveId: string,
  table: 'dive_samples' | 'dive_alt_samples' = 'dive_samples',
): Promise<Sample[]> {
  const { rows } = await sql.execute(`SELECT doc FROM ${table} WHERE dive_id = ?`, [diveId]);
  if (!rows.length) return [];
  try {
    const parsed = JSON.parse(String(rows[0].doc));
    return Array.isArray(parsed) ? (parsed as Sample[]) : [];
  } catch {
    // Un profilo illeggibile non deve far fallire tutta la sincronizzazione:
    // l'immersione resta, senza profilo, e il piano successivo riprova.
    return [];
  }
}

function stripSamples(dive: Dive): Omit<Dive, 'samples'> {
  const { samples: _s, ...rest } = dive;
  return rest;
}

const placeholders = (n: number) => new Array(n).fill('?').join(', ');

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

// ---------------------------------------------------------------------------
// Trasporto
// ---------------------------------------------------------------------------

/**
 * Client libSQL su HTTP.
 *
 * Import dinamico: chi non usa la sincronizzazione non paga il peso della
 * libreria, e su iOS e web il bundle iniziale resta leggero. Usa la build `web`
 * esplicitamente — quella predefinita per Node tira dentro i binding nativi, che
 * in una webview non esistono.
 */
export async function connect(creds: SyncCredentials): Promise<SqlExecutor> {
  const { createClient } = await import('@libsql/client/web');
  const client = createClient({ url: creds.url, authToken: creds.authToken });
  return {
    async execute(sql: string, args?: unknown[]) {
      const result = await withTimeout(
        client.execute({ sql, args: (args ?? []) as never }),
        REQUEST_TIMEOUT_MS,
        'Il database non ha risposto entro 30 secondi.',
      );
      // Il client restituisce righe che sono array con le colonne anche come
      // proprietà: le normalizziamo in oggetti semplici.
      const rows = result.rows.map((row) => {
        const out: Record<string, unknown> = {};
        result.columns.forEach((col, i) => {
          out[col] = (row as unknown as unknown[])[i];
        });
        return out;
      });
      return { rows };
    },
    close: () => client.close(),
  };
}

/** Oltre questo tempo una richiesta è considerata perduta. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Un limite di tempo esplicito, perché senza di esso un indirizzo sbagliato non
 * dà un errore: dà un'attesa infinita. Un nome di host che non esiste, o una rete
 * che inghiotte i pacchetti senza rispondere, lasciano la promessa in sospeso e
 * l'interfaccia bloccata su "verifica in corso" per sempre. Meglio un messaggio
 * dopo mezzo minuto.
 *
 * La richiesta sottostante non viene interrotta — il client libSQL non espone un
 * modo per farlo — ma nessuno ne aspetta più il risultato.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Verifica credenziali e raggiungibilità senza modificare niente. */
export async function testConnection(
  creds: SyncCredentials,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let sql: SqlExecutor | undefined;
  try {
    sql = await connect(creds);
    await sql.execute('SELECT 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeSyncError(err) };
  } finally {
    try {
      sql?.close?.();
    } catch {
      // Chiudere un client che non si è mai connesso può a sua volta lanciare:
      // non è un errore che interessi a chi sta provando le credenziali.
    }
  }
}

/**
 * Messaggi utili al posto di quelli della libreria.
 *
 * "TypeError: Failed to fetch" non dice niente a chi ha solo sbagliato a
 * incollare l'indirizzo, ed è esattamente l'errore che si ottiene sia con un
 * indirizzo inesistente sia con la rete staccata.
 */
export function describeSyncError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|network|fetch failed|ENOTFOUND|EAI_AGAIN/i.test(raw)) {
    return `Non raggiungibile: controlla l'indirizzo del database e la connessione di rete. (${raw})`;
  }
  if (/401|403|unauthor|token/i.test(raw)) {
    return `Il token non è stato accettato: generane uno nuovo su Turso e reincollalo. (${raw})`;
  }
  return raw;
}
