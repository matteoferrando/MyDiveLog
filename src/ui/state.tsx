/**
 * Stato dell'applicazione.
 *
 * Tutte le immersioni (i soli riepiloghi, senza profili) stanno in memoria: con
 * qualche migliaio di immersioni sono pochi MB e permettono di ricalcolare
 * statistiche e piano istantaneamente a ogni filtro, senza query. I profili si
 * caricano su richiesta quando si apre una scheda.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Dive, Sample } from '../core/model';
import { TRASH_KEY, partitionTrash, type TrashedDive } from '../storage/trash';
import { computeMetrics } from '../core/analysis/metrics';
import { aggregate, type Aggregates } from '../core/analysis/aggregate';
import {
  contingencies,
  measuredRmv,
  planGas,
  similarDives,
  type GasPlanInput,
} from '../core/analysis/gasPlan';
import { buildPlan, type GoalId, type Plan } from '../core/analysis/coaching';
import {
  applyPeriod,
  DEFAULT_PERIOD,
  type PeriodId,
  type Scope,
} from '../core/analysis/window';
import { mergeImports } from '../core/dedupe';
import { parseBrowserFile } from '../core/parsers';
import { getStore, type DiveStore } from '../storage';
import { hydrateForMerge, repairArchive } from '../storage/repair';
import { digestOf } from '../sync/plan';
import {
  connect,
  describeSyncError,
  syncArchive,
  testConnection,
  TOMBSTONE_KEY,
  type SyncCredentials,
  type SyncReport,
} from '../sync/turso';
import { ask, testKey, type AiCredentials, type AiModel, type AiResult } from '../ai/client';
import { archiveContext, decoPlanContext, diveContext, gasPlanContext, planContext } from '../ai/context';
import { archiveAnalysis, decoPlanAnalysis, diveAnalysis, gasPlanAnalysis, planAnalysis } from '../ai/prompts';
import type {
  DecoContingency,
  DecoResult,
  DecoSettings,
  PlanGas,
  PlanLevel,
} from '../core/analysis/deco';

/** Un piano tecnico messo da parte con un nome. */
export interface SavedDecoPlan {
  name: string;
  savedAt: string;
  state: unknown;
}

/** Quello che serve per far rileggere un piano di decompressione. */
export interface DecoAnalysisInput {
  result: DecoResult;
  levels: PlanLevel[];
  gases: PlanGas[];
  settings: DecoSettings;
  contingencies: DecoContingency[];
  modelLabel: string;
}
import { exportUddf, type UddfExportResult } from '../core/export/uddf';
import type { GearItem } from '../core/analysis/gear';

export interface ImportOutcome {
  fileName: string;
  ok: boolean;
  found: number;
  added: number;
  merged: number;
  duplicates: number;
  warnings: string[];
  error?: string;
}

interface DiveLogValue {
  ready: boolean;
  /** Tutte le immersioni in archivio: il logbook mostra sempre tutto. */
  dives: Dive[];
  /**
   * La finestra temporale su cui vengono calcolate statistiche e piano. Il logbook
   * non la usa: lì il dato completo è il punto.
   */
  period: PeriodId;
  setPeriod: (id: PeriodId) => void;
  scope: Scope;
  storeKind: string;
  storeLocation: string;
  aggregates: Aggregates;
  plan: Plan;
  goalId: GoalId;
  setGoalId: (id: GoalId) => void;
  importFiles: (files: File[]) => Promise<ImportOutcome[]>;
  loadSamples: (id: string) => Promise<Sample[]>;
  /** Entrambi i profili: il principale e, quando c'è, quello più fitto. */
  loadProfiles: (id: string) => Promise<{ samples: Sample[]; altSamples?: Sample[] }>;
  saveDive: (dive: Dive) => Promise<void>;
  removeDive: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  /**
   * Il cestino: le immersioni cancellate ma non ancora perdute.
   *
   * Sta qui e non nell'archivio perché è uno stato di lavoro del dispositivo:
   * non si sincronizza, e la cancellazione diventa definitiva — cioè produce la
   * lapide che viaggia — solo svuotandolo.
   */
  trash: TrashedDive[];
  restoreDive: (id: string) => Promise<void>;
  purgeDive: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  /** Credenziali di sincronizzazione salvate nell'archivio locale, mai nel codice. */
  syncCredentials: SyncCredentials | null;
  saveSyncCredentials: (creds: SyncCredentials | null) => Promise<void>;
  testSync: (creds: SyncCredentials) => Promise<{ ok: true } | { ok: false; error: string }>;
  syncNow: (onProgress?: (message: string) => void) => Promise<SyncReport>;

  /**
   * Ultimo piano gas compilato. Salvato perché bombola, miscela e velocità di
   * risalita non cambiano fra un'immersione e l'altra: ricompilarle ogni volta
   * renderebbe il pianificatore un esercizio invece di uno strumento.
   */
  gasInput: GasPlanInput | null;
  saveGasInput: (input: GasPlanInput) => void;
  /**
   * Il piano tecnico: livelli, miscele, impostazioni di risalita, modello.
   *
   * Salvato per lo stesso motivo del piano di gas, e con più ragione: un piano
   * decompressivo si compila in cinque minuti fra livelli, bombole e profondità di
   * cambio, e perderlo cambiando scheda è il genere di cosa che fa smettere di
   * usare uno strumento. Il tipo è volutamente opaco qui — la forma la conosce il
   * pianificatore — perché l'archivio non deve sapere com'è fatto un piano.
   */
  decoInput: unknown;
  saveDecoInput: (input: unknown) => void;
  /**
   * Piani tecnici salvati con un nome.
   *
   * Il piano corrente si salva da sé; questi sono quelli che si vogliono
   * ritrovare — «il relitto a 45», «la parete in trimix» — perché un piano
   * tecnico è una configurazione che si riusa, non un modulo che si ricompila.
   */
  decoPlans: SavedDecoPlan[];
  saveNamedDecoPlan: (name: string, state: unknown) => Promise<void>;
  deleteNamedDecoPlan: (name: string) => Promise<void>;

  /** Chiave dell'API di Anthropic, salvata nell'archivio locale. */
  aiCredentials: AiCredentials | null;
  saveAiCredentials: (creds: AiCredentials | null) => Promise<void>;
  testAiKey: (creds: AiCredentials) => Promise<{ ok: true; models: AiModel[] } | { ok: false; error: string }>;
  /** Analisi già generate, per non farle pagare due volte. */
  analysis: (kind: AnalysisKind, subject?: string) => StoredAnalysis | undefined;
  runAnalysis: (
    kind: AnalysisKind,
    input: { dive?: Dive; gasInput?: GasPlanInput; deco?: DecoAnalysisInput },
    onChunk?: (text: string) => void,
  ) => Promise<StoredAnalysis>;
  clearAnalysis: (kind: AnalysisKind, subject?: string) => Promise<void>;

  /** Attrezzatura e scadenze: pochi record, salvati fra le impostazioni. */
  gear: GearItem[];
  saveGear: (items: GearItem[]) => Promise<void>;

  /**
   * Esporta tutto l'archivio in UDDF. I profili si ricaricano qui uno per uno:
   * in memoria ci sono solo i riepiloghi, e un export senza profili sarebbe un
   * backup a metà senza dirlo.
   */
  exportArchive: (options?: { includeProfiles?: boolean }) => Promise<UddfExportResult>;
}

export type AnalysisKind = 'dive' | 'archive' | 'plan' | 'gas' | 'deco';

export interface StoredAnalysis {
  kind: AnalysisKind;
  /** Id dell'immersione per le analisi singole, `-` per quelle globali. */
  subject: string;
  text: string;
  model: string;
  at: string;
  inputTokens?: number;
  outputTokens?: number;
  /**
   * Impronta dei dati su cui l'analisi è stata fatta: se cambia, l'analisi in
   * archivio è vecchia e l'interfaccia lo dice invece di mostrarla come attuale.
   */
  fingerprint: string;
}

const Ctx = createContext<DiveLogValue | null>(null);

export function DiveLogProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<DiveStore | null>(null);
  const [dives, setDives] = useState<Dive[]>([]);
  const [ready, setReady] = useState(false);
  const [goalId, setGoalIdState] = useState<GoalId>('general');
  const [period, setPeriodState] = useState<PeriodId>(DEFAULT_PERIOD);
  const [syncCredentials, setSyncCredentials] = useState<SyncCredentials | null>(null);
  const [aiCredentials, setAiCredentials] = useState<AiCredentials | null>(null);
  const [gasInput, setGasInputState] = useState<GasPlanInput | null>(null);
  const [decoInput, setDecoInputState] = useState<unknown>(null);
  const [decoPlans, setDecoPlans] = useState<SavedDecoPlan[]>([]);
  const [gear, setGearState] = useState<GearItem[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, StoredAnalysis>>({});
  const [trash, setTrash] = useState<TrashedDive[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getStore();
      const [list, savedGoal, savedPeriod, savedSync, savedAi, savedAnalyses, savedGas, savedGear] =
        await Promise.all([
          s.listDives(),
          s.getSetting<GoalId>('goal'),
          s.getSetting<PeriodId>('period'),
          s.getSetting<SyncCredentials>('sync'),
          s.getSetting<AiCredentials>('ai'),
          s.getSetting<Record<string, StoredAnalysis>>('analyses'),
          s.getSetting<GasPlanInput>('gasPlan'),
          s.getSetting<GearItem[]>('gear'),
        ]);
      const savedDeco = await s.getSetting<unknown>('decoPlan');
      const savedPlans = (await s.getSetting<SavedDecoPlan[]>('decoPlans')) ?? [];
      const savedTrash = (await s.getSetting<TrashedDive[]>(TRASH_KEY)) ?? [];
      if (cancelled) return;
      setStore(s);

      // Riparazione all'avvio: se una correzione al calcolo delle metriche o alla
      // fusione fra due computer è arrivata dopo l'import, i numeri in archivio
      // sono vecchi. Ricalcolarli qui evita di chiedere all'utente di reimportare
      // per far tornare un dato che l'app ha già.
      const { report, dives: healed } = await repairArchive(s, list).catch((err) => {
        console.error('Riparazione dell’archivio non riuscita:', err);
        return { report: { checked: 0, repaired: 0, reasons: {} }, dives: list };
      });
      if (report.repaired > 0) {
        console.info(
          `Metriche ricalcolate su ${report.repaired} immersioni:`,
          report.reasons,
        );
      }
      setDives(healed);

      // Le cancellazioni scadute diventano definitive all'avvio, non a mezzanotte
      // di un timer: qui c'è già lo store aperto, e una lapide scritta con un
      // giorno di ritardo non fa danno a nessuno.
      const { keep, purge } = partitionTrash(savedTrash);
      if (purge.length) {
        const tombs = (await s.getSetting<{ id: string; at: string }[]>(TOMBSTONE_KEY)) ?? [];
        const merged = [...tombs];
        for (const t of purge) {
          if (!merged.some((x) => x.id === t.dive.id)) merged.push({ id: t.dive.id, at: t.at });
        }
        await s.setSetting(TOMBSTONE_KEY, merged);
        await s.setSetting(TRASH_KEY, keep);
        console.info(`${purge.length} cancellazioni diventate definitive dopo trenta giorni.`);
      }
      setTrash(keep);

      if (savedGoal) setGoalIdState(savedGoal);
      if (savedPeriod) setPeriodState(savedPeriod);
      if (savedSync?.url && savedSync?.authToken) setSyncCredentials(savedSync);
      if (savedAi?.apiKey) setAiCredentials(savedAi);
      if (savedAnalyses) setAnalyses(savedAnalyses);
      if (savedGas?.depthM) setGasInputState(savedGas);
      if (savedDeco) setDecoInputState(savedDeco);
      if (savedPlans.length) setDecoPlans(savedPlans);
      if (savedGear?.length) setGearState(savedGear);
      setReady(true);
    })().catch((err) => {
      console.error('Inizializzazione archivio fallita:', err);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setGoalId = useCallback(
    (id: GoalId) => {
      setGoalIdState(id);
      store?.setSetting('goal', id).catch(() => undefined);
    },
    [store],
  );

  const setPeriod = useCallback(
    (id: PeriodId) => {
      setPeriodState(id);
      store?.setSetting('period', id).catch(() => undefined);
    },
    [store],
  );

  const importFiles = useCallback(
    async (files: File[]): Promise<ImportOutcome[]> => {
      const outcomes: ImportOutcome[] = [];
      // Parte dalla lista corrente e la fa crescere: così due file che
      // contengono la stessa immersione vengono deduplicati nello stesso batch.
      let current = dives;

      for (const file of files) {
        try {
          const result = await parseBrowserFile(file);
          // I profili delle immersioni già in archivio vanno caricati PRIMA di
          // fondere: la fusione sceglie quale profilo tenere confrontando canali e
          // campioni, e un profilo non caricato conta zero — qualunque cosa
          // arrivasse sembrava migliore, anche quando era più povera.
          if (store) current = await hydrateForMerge(store, current, result.dives);
          const report = mergeImports(current, result.dives);
          current = report.dives;
          const warnings = [...result.warnings];
          for (const c of report.clockOffsets) {
            const hours = c.offsetMs / 3_600_000;
            warnings.push(
              `Riconosciuto uno sfasamento di ${formatOffset(hours)} fra l'orologio di questo computer e quello delle immersioni già in archivio (su ${c.pairs} corrispondenze): le immersioni sono state unite comunque.`,
            );
          }
          outcomes.push({
            fileName: file.name,
            ok: true,
            found: result.dives.length,
            added: report.added,
            merged: report.merged,
            duplicates: report.duplicates,
            warnings,
          });
        } catch (err) {
          outcomes.push({
            fileName: file.name,
            ok: false,
            found: 0,
            added: 0,
            merged: 0,
            duplicates: 0,
            warnings: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Salva solo ciò che è nuovo o cambiato rispetto a quanto già in archivio.
      const previous = new Map(dives.map((d) => [d.id, d]));
      const changed = current.filter((d) => previous.get(d.id) !== d);
      if (store && changed.length) await store.putDives(changed);
      // In memoria la lista torna senza profili: è la ragione per cui l'app resta
      // istantanea con migliaia di immersioni.
      setDives(current.map(stripForList));
      return outcomes;
    },
    [dives, store],
  );

  const loadSamples = useCallback(
    async (id: string) => {
      if (!store) return [];
      return store.getSamples(id);
    },
    [store],
  );

  const loadProfiles = useCallback(
    async (id: string) => {
      if (!store) return { samples: [] as Sample[] };
      const [samples, altSamples] = await Promise.all([store.getSamples(id), store.getAltSamples(id)]);
      return { samples, altSamples: altSamples.length ? altSamples : undefined };
    },
    [store],
  );

  const saveDive = useCallback(
    async (dive: Dive) => {
      // Le modifiche manuali (volume bombola, pressioni, sito) cambiano le
      // metriche: le ricalcoliamo qui invece di lasciarle stantie.
      const samples = dive.samples ?? (store ? await store.getSamples(dive.id) : []);
      // La data di modifica è ciò che permette alla sincronizzazione di sapere
      // che questa versione è più avanti di quella sull'altro dispositivo.
      const updated: Dive = { ...dive, samples, updatedAt: new Date().toISOString() };
      updated.metrics = computeMetrics(updated);
      if (store) await store.putDives([updated]);
      setDives((prev) => prev.map((d) => (d.id === updated.id ? stripForList(updated) : d)));
    },
    [store],
  );

  /**
   * Cancella un'immersione mettendola nel cestino.
   *
   * NON scrive la lapide. La lapide è la cancellazione vera, quella che si
   * propaga agli altri dispositivi e non si può revocare: nasce quando il cestino
   * si svuota, non quando si preme «elimina». Nel frattempo l'immersione è fuori
   * dall'archivio e fuori dalla sincronizzazione, ma il suo documento e il suo
   * profilo sono al sicuro e si possono rimettere a posto.
   */
  const removeDive = useCallback(
    async (id: string) => {
      const dive = dives.find((d) => d.id === id);
      if (store && dive) {
        // Il profilo va salvato PRIMA di cancellare: dopo non c'è più da leggere.
        const [samples, altSamples] = await Promise.all([
          store.getSamples(id).catch(() => [] as Sample[]),
          store.getAltSamples(id).catch(() => [] as Sample[]),
        ]);
        const { samples: _s, altSamples: _a, ...doc } = dive;
        const item: TrashedDive = {
          dive: doc as Dive,
          ...(samples.length ? { samples } : {}),
          ...(altSamples.length ? { altSamples } : {}),
          at: new Date().toISOString(),
        };
        const next = [...trash.filter((t) => t.dive.id !== id), item];
        await store.setSetting(TRASH_KEY, next);
        await store.deleteDive(id);
        setTrash(next);
      }
      setDives((prev) => prev.filter((d) => d.id !== id));
    },
    [store, dives, trash],
  );

  /** Rimette un'immersione in archivio esattamente com'era, profilo compreso. */
  const restoreDive = useCallback(
    async (id: string) => {
      const item = trash.find((t) => t.dive.id === id);
      if (!store || !item) return;
      // `updatedAt` a ORA, e la lapide via.
      //
      // Senza queste due righe il ripristino durava fino alla sincronizzazione
      // successiva: la lapide scritta dall'altro dispositivo — o dalla scadenza
      // del cestino qui — tornava ad applicarsi e l'immersione spariva di nuovo,
      // stavolta senza passare dal cestino. Il timbro nuovo è ciò che dice alla
      // sincronizzazione «questa è stata rimessa apposta, dopo».
      const restored: Dive = {
        ...item.dive,
        updatedAt: new Date().toISOString(),
        ...(item.samples ? { samples: item.samples } : {}),
        ...(item.altSamples ? { altSamples: item.altSamples } : {}),
      };
      await store.putDives([restored]);
      const next = trash.filter((t) => t.dive.id !== id);
      await store.setSetting(TRASH_KEY, next);
      setTrash(next);
      const tombs = (await store.getSetting<{ id: string; at: string }[]>(TOMBSTONE_KEY)) ?? [];
      if (tombs.some((t) => t.id === id)) {
        await store.setSetting(
          TOMBSTONE_KEY,
          tombs.filter((t) => t.id !== id),
        );
      }
      // In memoria si tiene il riepilogo senza profilo, come tutto il resto.
      const { samples: _s, altSamples: _a, ...summary } = restored;
      setDives((prev) => [...prev, summary as Dive].sort((a, b) => b.startTime.localeCompare(a.startTime)));
    },
    [store, trash],
  );

  /**
   * Cancellazione definitiva di una sola immersione: qui nasce la lapide.
   *
   * Da questo momento la cancellazione viaggia, e non si torna indietro: è
   * l'unico punto del programma in cui si perde un dato per sempre, e per questo
   * è una funzione a sé con un nome che lo dice.
   */
  const purgeDive = useCallback(
    async (id: string) => {
      if (!store) return;
      const existing = (await store.getSetting<{ id: string; at: string }[]>(TOMBSTONE_KEY)) ?? [];
      if (!existing.some((t) => t.id === id)) {
        await store.setSetting(TOMBSTONE_KEY, [...existing, { id, at: new Date().toISOString() }]);
      }
      const next = trash.filter((t) => t.dive.id !== id);
      await store.setSetting(TRASH_KEY, next);
      setTrash(next);
    },
    [store, trash],
  );

  const emptyTrash = useCallback(async () => {
    if (!store) return;
    const existing = (await store.getSetting<{ id: string; at: string }[]>(TOMBSTONE_KEY)) ?? [];
    const now = new Date().toISOString();
    const merged = [...existing];
    for (const t of trash) if (!merged.some((x) => x.id === t.dive.id)) merged.push({ id: t.dive.id, at: now });
    await store.setSetting(TOMBSTONE_KEY, merged);
    await store.setSetting(TRASH_KEY, []);
    setTrash([]);
  }, [store, trash]);

  const clearAll = useCallback(async () => {
    if (store) await store.clear();
    setDives([]);
  }, [store]);

  const saveDecoInput = useCallback(
    (input: unknown) => {
      setDecoInputState(input);
      store?.setSetting('decoPlan', input).catch(() => undefined);
      store?.setSetting('decoPlan:at', new Date().toISOString()).catch(() => undefined);
    },
    [store],
  );

  const saveNamedDecoPlan = useCallback(
    async (name: string, state: unknown) => {
      const clean = name.trim();
      if (!clean) return;
      // Salvare con un nome che esiste già lo SOSTITUISCE: è quello che ci si
      // aspetta, e tenere due «relitto a 45» diversi non aiuterebbe nessuno.
      const next = [
        ...decoPlans.filter((p) => p.name !== clean),
        { name: clean, savedAt: new Date().toISOString(), state },
      ].sort((a, b) => a.name.localeCompare(b.name));
      setDecoPlans(next);
      await store?.setSetting('decoPlans', next);
      await store?.setSetting('decoPlans:at', new Date().toISOString());
    },
    [store, decoPlans],
  );

  const deleteNamedDecoPlan = useCallback(
    async (name: string) => {
      const next = decoPlans.filter((p) => p.name !== name);
      setDecoPlans(next);
      await store?.setSetting('decoPlans', next);
      await store?.setSetting('decoPlans:at', new Date().toISOString());
    },
    [store, decoPlans],
  );

  const saveSyncCredentials = useCallback(
    async (creds: SyncCredentials | null) => {
      setSyncCredentials(creds);
      // Nell'archivio locale, non in un file del progetto: il token è una
      // credenziale di chi usa l'app, e nel repository non ci deve entrare.
      if (store) await store.setSetting('sync', creds ?? null);
    },
    [store],
  );

  const testSync = useCallback((creds: SyncCredentials) => testConnection(creds), []);

  const syncNow = useCallback(
    async (onProgress?: (message: string) => void) => {
      if (!store) throw new Error('Archivio non pronto.');
      if (!syncCredentials) throw new Error('Configura prima indirizzo e token del database.');
      const sql = await connect(syncCredentials);
      try {
        const report = await syncArchive(store, sql, onProgress);
        // La lista in memoria è ora vecchia: la sincronizzazione ha scritto
        // direttamente nell'archivio, quindi la ricarichiamo da lì.
        //
        // E la ripariamo di nuovo. La riparazione gira all'avvio, la
        // sincronizzazione viene dopo: senza questo secondo giro, un'immersione
        // scaricata da un dispositivo con una versione più vecchia dell'app
        // entrerebbe con le sue metriche vecchie e resterebbe così fino al
        // riavvio successivo. Le correzioni vengono anche rispinte al prossimo
        // giro, perché cambiano l'impronta del riepilogo.
        const list = await store.listDives();
        const healed = await repairArchive(store, list).catch(() => ({ dives: list }));
        setDives(healed.dives);
        // Le impostazioni condivise possono essere arrivate dall'altro
        // dispositivo: senza rileggerle, la pagina mostrerebbe le vecchie fino al
        // riavvio.
        if (report.settingsPulled > 0) {
          const [gas, saved, savedGear] = await Promise.all([
            store.getSetting<GasPlanInput>('gasPlan'),
            store.getSetting<Record<string, StoredAnalysis>>('analyses'),
            store.getSetting<GearItem[]>('gear'),
          ]);
          if (gas?.depthM) setGasInputState(gas);
          if (saved) setAnalyses(saved);
          if (savedGear) setGearState(savedGear);
        }
        return report;
      } catch (err) {
        throw new Error(describeSyncError(err));
      } finally {
        try {
          sql.close?.();
        } catch {
          // La chiusura di un client già caduto non aggiunge informazione.
        }
      }
    },
    [store, syncCredentials],
  );

  const saveAiCredentials = useCallback(
    async (creds: AiCredentials | null) => {
      setAiCredentials(creds);
      if (store) await store.setSetting('ai', creds ?? null);
    },
    [store],
  );

  const testAiKey = useCallback((creds: AiCredentials) => testKey(creds), []);

  const saveGear = useCallback(
    async (items: GearItem[]) => {
      // Ogni pezzo porta il proprio timbro, non solo la lista.
      //
      // Serve alla fusione fra dispositivi: senza una data per elemento, quando
      // lo stesso pezzo è stato modificato di qua e di là non c'è modo di sapere
      // quale versione è più recente, e l'unica alternativa sarebbe scegliere a
      // caso. Si timbra solo ciò che è davvero cambiato, altrimenti riaprire la
      // scheda basterebbe a far vincere questo dispositivo.
      const now = new Date().toISOString();
      const stamped = items.map((item) => {
        const before = gear.find((g) => g.id === item.id);
        const unchanged = before && JSON.stringify({ ...before, savedAt: null }) === JSON.stringify({ ...item, savedAt: null });
        return unchanged ? before : { ...item, savedAt: now };
      });
      setGearState(stamped);
      if (store) {
        await store.setSetting('gear', stamped);
        await store.setSetting('gear:at', now);
      }
    },
    [store, gear],
  );

  const exportArchive = useCallback(
    async ({ includeProfiles = true }: { includeProfiles?: boolean } = {}) => {
      const full = includeProfiles && store
        ? await Promise.all(
            dives.map(async (d) => ({ ...d, samples: await store.getSamples(d.id) })),
          )
        : dives;
      return exportUddf(full, { includeProfiles });
    },
    [dives, store],
  );

  const saveGasInput = useCallback(
    (input: GasPlanInput) => {
      setGasInputState(input);
      // Fuoco e dimentica: se la scrittura non riesce si perde la comodità di
      // ritrovare il modulo compilato, non un dato dell'archivio.
      //
      // Il timbro accanto serve alla sincronizzazione: fra due dispositivi vince
      // l'ultima parola detta, e senza sapere QUANDO è stata detta l'unica regola
      // possibile sarebbe "vince chi sincronizza per ultimo".
      store?.setSetting('gasPlan', input).catch(() => undefined);
      store?.setSetting('gasPlan:at', new Date().toISOString()).catch(() => undefined);
    },
    [store],
  );

  // La finestra si applica QUI, una volta: aggregate e piano vedono lo stesso
  // insieme di immersioni, e non c'è modo che le due viste mostrino numeri
  // calcolati su periodi diversi.
  const scope = useMemo(() => applyPeriod(dives, period), [dives, period]);
  const aggregates = useMemo(() => aggregate(scope.dives), [scope]);
  const plan = useMemo(() => buildPlan(scope.dives, aggregates, goalId), [scope, aggregates, goalId]);

  const analysis = useCallback(
    (kind: AnalysisKind, subject = '-') => analyses[`${kind}:${subject}`],
    [analyses],
  );

  const clearAnalysis = useCallback(
    async (kind: AnalysisKind, subject = '-') => {
      const next = { ...analyses };
      delete next[`${kind}:${subject}`];
      setAnalyses(next);
      if (store) {
        await store.setSetting('analyses', next);
        await store.setSetting('analyses:at', new Date().toISOString());
      }
    },
    [analyses, store],
  );

  /**
   * Genera un'analisi e la conserva.
   *
   * Le analisi si pagano a token, quindi vengono salvate nell'archivio locale con
   * l'impronta dei dati su cui sono state fatte: riaprire la scheda non rigenera
   * niente, e se i dati intanto sono cambiati l'interfaccia lo segnala invece di
   * spacciare per attuale un testo vecchio.
   */
  const runAnalysis = useCallback(
    async (
      kind: AnalysisKind,
      input: { dive?: Dive; gasInput?: GasPlanInput; deco?: DecoAnalysisInput },
      onChunk?: (text: string) => void,
    ) => {
      if (!aiCredentials?.apiKey) throw new Error('Configura prima la chiave API nelle impostazioni.');
      if (!aiCredentials.model) throw new Error('Scegli prima il modello nelle impostazioni.');

      let spec;
      let subject = '-';
      let fingerprint: string;
      if (kind === 'dive') {
        const dive = input.dive;
        if (!dive) throw new Error('Nessuna immersione da analizzare.');
        // Il profilo serve all'analisi: se la scheda non lo ha ancora caricato, lo
        // prendiamo qui invece di analizzare mezza immersione.
        const withSamples =
          dive.samples?.length || !store ? dive : { ...dive, samples: await store.getSamples(dive.id) };
        subject = dive.id;
        const context = diveContext(withSamples);
        fingerprint = digestOf(withSamples as unknown as Record<string, unknown>);
        spec = diveAnalysis(context);
      } else if (kind === 'archive') {
        fingerprint = `${period}:${scope.dives.length}:${aggregates.lastDive ?? ''}:${digestOf({
          rmv: aggregates.avgRmv,
          trim: aggregates.avgTrim,
        } as Record<string, unknown>)}`;
        // Al modello va lo stesso insieme di immersioni che vede l'interfaccia,
        // con la finestra dichiarata: altrimenti descriverebbe come "l'archivio"
        // un sottoinsieme, o incrocerebbe righe di un periodo con medie di un altro.
        spec = archiveAnalysis(archiveContext(scope.dives, aggregates, scope.period.label));
      } else if (kind === 'deco') {
        const d = input.deco;
        if (!d) throw new Error('Nessun piano di decompressione da analizzare.');
        subject = 'deco';
        // L'impronta è la tabella prodotta, non i campi del modulo: due moduli
        // diversi che generano la stessa tabella sono lo stesso piano, e
        // rigenerare l'analisi per un campo che non ha spostato niente costa
        // token per nulla.
        fingerprint = digestOf({
          stops: JSON.stringify(d.result.stops),
          runtime: d.result.runtimeMin,
          gas: JSON.stringify(d.result.gasUsage),
          model: d.modelLabel,
        } as Record<string, unknown>);
        spec = decoPlanAnalysis(
          decoPlanContext(d.result, d.levels, d.gases, d.settings, d.contingencies, d.modelLabel),
        );
      } else if (kind === 'gas') {
        const gas = input.gasInput;
        if (!gas) throw new Error('Nessun piano da analizzare.');
        const computed = planGas(gas);
        subject = 'gas';
        fingerprint = digestOf(computed.input as unknown as Record<string, unknown>);
        spec = gasPlanAnalysis(
          gasPlanContext(
            computed,
            contingencies(gas),
            similarDives(scope.dives, computed.input.depthM),
            measuredRmv(scope.dives),
            scope.period.label,
          ),
        );
      } else {
        subject = goalId;
        fingerprint = `${goalId}:${period}:${scope.dives.length}:${plan.findings.length}:${plan.readiness.score.toFixed(2)}`;
        spec = planAnalysis(planContext(plan, aggregates, scope.period.label));
      }

      const result: AiResult = await ask(aiCredentials, {
        system: spec.system,
        prompt: spec.prompt,
        maxTokens: spec.maxTokens,
        onChunk,
      });

      const stored: StoredAnalysis = {
        kind,
        subject,
        text: result.text,
        model: result.model,
        at: new Date().toISOString(),
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        fingerprint,
      };
      const next = { ...analyses, [`${kind}:${subject}`]: stored };
      setAnalyses(next);
      if (store) {
        await store.setSetting('analyses', next);
        await store.setSetting('analyses:at', new Date().toISOString());
      }
      return stored;
    },
    [aiCredentials, aggregates, analyses, goalId, period, plan, scope, store],
  );

  const value: DiveLogValue = {
    ready,
    dives,
    period,
    setPeriod,
    scope,
    storeKind: store?.kind ?? '—',
    storeLocation: store?.location ?? 'Non inizializzato',
    aggregates,
    plan,
    goalId,
    setGoalId,
    importFiles,
    loadSamples,
    loadProfiles,
    saveDive,
    removeDive,
    clearAll,
    trash,
    restoreDive,
    purgeDive,
    emptyTrash,
    syncCredentials,
    saveSyncCredentials,
    testSync,
    syncNow,
    gasInput,
    decoInput,
    saveDecoInput,
    decoPlans,
    saveNamedDecoPlan,
    deleteNamedDecoPlan,
    saveGasInput,
    aiCredentials,
    saveAiCredentials,
    testAiKey,
    analysis,
    runAnalysis,
    clearAnalysis,
    gear,
    saveGear,
    exportArchive,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDiveLog(): DiveLogValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDiveLog richiede DiveLogProvider.');
  return v;
}

/**
 * "-1 h", "+2 h", "-5 h 30 min".
 *
 * Arrotondato al quarto d'ora perché è così che sono fatti i fusi orari: uno
 * scarto misurato di 59 minuti e 13 secondi è un'ora, e scriverlo "-0 h 59 min"
 * fa sembrare approssimativo un dato che è esatto.
 */
function formatOffset(hours: number): string {
  const quarters = Math.round(hours * 4) / 4;
  const sign = quarters < 0 ? '-' : '+';
  const abs = Math.abs(quarters);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  if (h === 0) return `${sign}${m} min`;
  return `${sign}${h} h${m ? ` ${m} min` : ''}`;
}

/** In lista non teniamo i profili: solo riepilogo e metriche. */
function stripForList(dive: Dive): Dive {
  const { samples: _samples, ...rest } = dive;
  return rest as Dive;
}
