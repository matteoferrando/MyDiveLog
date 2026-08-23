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
  useRef,
} from 'react';
import type { Dive, Sample } from '../core/model';
import { TRASH_KEY, filterDeleted, partitionTrash, type TrashedDive } from '../storage/trash';
import { BLE_MARKERS_KEY, type DownloadMarker } from '../core/ble/types';
import { computeMetrics } from '../core/analysis/metrics';
import { aggregate, type Aggregates } from '../core/analysis/aggregate';
import {
  contingencies,
  measuredRmv,
  planGas,
  similarDives,
  type GasPlanInput,
} from '../core/analysis/gasPlan';
import { storicoDi, buildPlan, type GoalId, type Plan } from '../core/analysis/coaching';
import { applyPeriod, DEFAULT_PERIOD, type PeriodId, type Scope } from '../core/analysis/window';
import { mergeDive, mergeImports } from '../core/dedupe';
import { buildBackup, planRestore, type BackupFile } from '../core/export/backup';
import { parseBrowserFile } from '../core/parsers';
import { useTraduciStabile } from './lingua';
import { getStore, type DiveStore } from '../storage';
import { openSecretStore, type SecretPlace } from '../storage/secrets';
import { hydrateForMerge, repairArchive } from '../storage/repair';
import { digestOf } from '../sync/plan';
import {
  connect,
  describeSyncError,
  syncArchive,
  fondiAttrezzatura,
  mergeKeyed,
  testConnection,
  TOMBSTONE_KEY,
  type SyncCredentials,
  type SyncReport,
} from '../sync/turso';
import { ask, testKey, type AiCredentials, type AiModel, type AiResult } from '../ai/client';
import {
  type AccountSalvato,
  cancellaAccount as chiudiAccountRemoto,
  ChiaviDelDatabase,
  type Fornitore,
  leggiAccountSalvato,
} from '../sync/account';
import { accediConFornitore } from '../sync/accessoPiattaforma';
import { SERVIZIO_ACCESSO } from '../sync/configurazione';
import { archiveContext, decoPlanContext, diveContext, gasPlanContext, planContext } from '../ai/context';
import {
  archiveAnalysis,
  decoPlanAnalysis,
  diveAnalysis,
  gasPlanAnalysis,
  planAnalysis,
} from '../ai/prompts';
import type { DecoContingency, DecoResult, DecoSettings, PlanGas, PlanLevel } from '../core/analysis/deco';

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
import { migrateGear, type GearArchive } from '../core/analysis/gear';

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
  /**
   * Che cosa è andato storto durante l'apertura, se è andato storto qualcosa.
   *
   * Nullo nel caso normale. Quando c'è, l'applicazione è partita LO STESSO ma
   * incompleta, e chi la usa deve saperlo prima di scriverci dentro: un archivio
   * che non si è aperto e uno vuoto si assomigliano troppo per lasciar
   * indovinare quale dei due si ha davanti.
   */
  initError: string | null;
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
  /**
   * Come `importFiles`, ma partendo da immersioni già decodificate.
   *
   * È la porta d'ingresso per lo scarico Bluetooth: dal computer subacqueo non
   * arriva un file, arrivano byte che il driver ha già trasformato in
   * immersioni. Tutto il resto — idratazione dei profili prima di fondere,
   * deduplica, sfasamenti d'orologio, salvataggio del solo cambiato — deve
   * essere ESATTAMENTE lo stesso: una seconda strada per entrare in archivio
   * sarebbe una seconda strada per perdere un profilo.
   */
  importDives: (dives: Dive[], origine: string) => Promise<ImportOutcome>;
  loadSamples: (id: string) => Promise<Sample[]>;
  /** Entrambi i profili: il principale e, quando c'è, quello più fitto. */
  loadProfiles: (id: string) => Promise<{ samples: Sample[]; altSamples?: Sample[] }>;
  saveDive: (dive: Dive) => Promise<void>;
  /**
   * Inserisce un'immersione scritta a mano. Restituisce `merged: true` quando
   * l'immersione esisteva già ed è stata arricchita invece che duplicata.
   */
  createDive: (dive: Dive) => Promise<{ merged: boolean }>;
  removeDive: (id: string) => Promise<void>;
  /**
   * Cancella più immersioni in una volta sola. Non è `removeDive` in ciclo: il
   * cestino si scrive UNA volta, altrimenti l'ultima scrittura sovrascrive le
   * precedenti e le immersioni non finiscono da nessuna parte.
   */
  removeDives: (ids: string[]) => Promise<void>;
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
  /** Rimette in archivio più immersioni in una scrittura sola. */
  restoreDives: (ids: string[]) => Promise<void>;
  purgeDive: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  /** Credenziali di sincronizzazione salvate nell'archivio locale, mai nel codice. */
  syncCredentials: SyncCredentials | null;
  saveSyncCredentials: (creds: SyncCredentials | null) => Promise<void>;
  testSync: (creds: SyncCredentials) => Promise<{ ok: true } | { ok: false; error: string }>;
  syncNow: (onProgress?: (message: string) => void) => Promise<SyncReport>;

  /*
   * L'ACCOUNT, che è un modo diverso di ottenere le stesse credenziali.
   *
   * Non sostituisce l'indirizzo e il token scritti a mano: li affianca. Chi ha
   * già un database suo continua a usarlo, chi accede ne riceve uno creato dal
   * servizio. La sincronizzazione non sa quale delle due strade sia stata
   * seguita — riceve un indirizzo e una chiave, e basta.
   */
  /**
   * Se c'è una sessione. È QUESTO che dice «sei entrato», non l'email.
   *
   * L'email è facoltativa — un fornitore può non darla — e usarla come
   * interruttore farebbe apparire disconnesso chi ha una sessione valida ma
   * nessun indirizzo da mostrare. Sono due domande diverse e stanno in due
   * campi diversi.
   */
  accountAttivo: boolean;
  /** L'email di chi è entrato, o `null`. Solo da mostrare. */
  accountEmail: string | null;
  /**
   * Il fornitore è un PARAMETRO: Apple e Google sono due pulsanti, non due
   * funzioni. La linea guida 4.8 dell'App Store impone di offrire Sign in with
   * Apple accanto a Google, e offrirli davvero alla pari significa che il resto
   * dell'applicazione non deve sapere quale dei due è stato premuto.
   */
  accediConAccount: (fornitore: Fornitore) => Promise<void>;
  esciDallAccount: () => Promise<void>;
  /** Cancella il database remoto. **Non** tocca l'archivio locale. */
  cancellaAccount: () => Promise<void>;

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
  /**
   * Dove stanno le credenziali su questo dispositivo: nel portachiavi di sistema
   * o, dove non esiste, nell'archivio locale in chiaro. Va mostrato, non dedotto.
   */
  secretPlace: SecretPlace;
  testAiKey: (
    creds: AiCredentials,
  ) => Promise<{ ok: true; models: AiModel[] } | { ok: false; error: string }>;
  /** Analisi già generate, per non farle pagare due volte. */
  analysis: (kind: AnalysisKind, subject?: string) => StoredAnalysis | undefined;
  runAnalysis: (
    kind: AnalysisKind,
    input: { dive?: Dive; gasInput?: GasPlanInput; deco?: DecoAnalysisInput },
    onChunk?: (text: string) => void,
  ) => Promise<StoredAnalysis>;
  clearAnalysis: (kind: AnalysisKind, subject?: string) => Promise<void>;

  /** Attrezzatura e scadenze: pochi record, salvati fra le impostazioni. */
  gear: GearArchive;
  saveGear: (archive: GearArchive) => Promise<void>;

  /**
   * Fin dove si era arrivati con ogni computer subacqueo, per seriale.
   *
   * Poche righe di testo, quindi stanno fra le impostazioni e viaggiano con la
   * sincronizzazione: collegando il Peregrine a un secondo dispositivo, quello
   * sa già cosa è stato scaricato e non rilegge tutta la memoria.
   */
  bleMarkers: Record<string, DownloadMarker>;
  saveBleMarker: (key: string, marker: DownloadMarker) => Promise<void>;
  forgetBleMarker: (key: string) => Promise<void>;

  /**
   * Esporta tutto l'archivio in UDDF. I profili si ricaricano qui uno per uno:
   * in memoria ci sono solo i riepiloghi, e un export senza profili sarebbe un
   * backup a metà senza dirlo.
   */
  exportArchive: (options?: { includeProfiles?: boolean }) => Promise<UddfExportResult>;
  /** Backup completo: immersioni con profili e ogni impostazione, credenziali escluse. */
  buildFullBackup: () => Promise<BackupFile>;
  /** Ripristina da un backup già verificato con `checkBackup`. */
  restoreBackup: (
    file: BackupFile,
    mode?: 'merge' | 'replace',
  ) => Promise<{ added: number; merged: number; onlyLocal: number; settings: number }>;
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

/**
 * Fonde una raccolta di impostazioni con quella già in archivio.
 *
 * `gear` sono due elenchi dentro un oggetto, `decoPlans` è un elenco: la forma
 * è diversa, la regola no — si fondono per identificativo e a parità vince il
 * timbro più recente, che è esattamente `mergeKeyed`, la funzione che la
 * sincronizzazione usa per lo stesso problema fra due dispositivi. Ripristinare
 * un backup è la stessa situazione: due versioni della stessa raccolta, e
 * nessuna delle due è «quella giusta» per intero.
 */
function fondiRaccolta(key: string, attuale: unknown, dalFile: unknown): unknown {
  /*
   * I piani salvati si fondono per NOME, non per `id`: non ce l'hanno.
   * `SavedDecoPlan` è `{ name, savedAt, state }`, e chiedere `id` a
   * `mergeKeyed` significava chiedere `String(undefined)` per ognuno — cioè la
   * stessa chiave per tutti. Ripristinare un backup con cinque piani ne
   * restituiva UNO. La sincronizzazione fra dispositivi usava già `name`: erano
   * due copie della stessa regola, e una delle due era sbagliata.
   */
  if (key === 'decoPlans') return mergeKeyed(attuale, dalFile, 'name').value;
  return fondiAttrezzatura(attuale, dalFile).value;
}

export function DiveLogProvider({ children }: { children: ReactNode }) {
  /*
   * LA TRADUZIONE CHE SCENDE SOTTO L'INTERFACCIA.
   *
   * Questo componente sta dentro `ProvvedituraLingua` (vedi `main.tsx`), quindi
   * la lingua ce l'ha; sotto di lui — parser, sincronizzazione, archivio — non
   * c'è React e non ci può essere: `src/core` non importa da `src/ui`, ed è il
   * vincolo su cui è costruito tutto il progetto. Quello che passa il confine è
   * una funzione sola, `Traduci`, dichiarata nel nucleo.
   *
   * STABILE e non la `t` del render: le liste di dipendenze qui sotto sono
   * lunghe e delicate, e una funzione che cambia identità a ogni cambio di
   * lingua le farebbe ricalcolare tutte. Soprattutto, `getStore()` la riceve
   * una volta sola per tutta la vita dell'applicazione — vedi
   * `useTraduciStabile`.
   */
  const traduci = useTraduciStabile();
  const [store, setStore] = useState<DiveStore | null>(null);
  const [dives, setDives] = useState<Dive[]>([]);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [goalId, setGoalIdState] = useState<GoalId>('general');
  const [period, setPeriodState] = useState<PeriodId>(DEFAULT_PERIOD);
  const [syncCredentials, setSyncCredentials] = useState<SyncCredentials | null>(null);
  /*
   * La sessione dell'account, e le chiavi che se ne ricavano.
   *
   * La SESSIONE sta nel portachiavi e dura settimane. Le CHIAVI del database
   * durano due ore e vivono solo qui, in un riferimento: non finiscono in uno
   * stato di React perché non devono innescare ridisegni, e soprattutto non
   * devono essere scritte da nessuna parte. Un archivio SQLite finisce nei
   * backup di sistema; una chiave scritta là dentro sopravvivrebbe alla sessione
   * che l'ha generata.
   */
  const [sessioneAccount, setSessioneAccount] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const chiaviAccount = useRef<ChiaviDelDatabase | null>(null);
  const [aiCredentials, setAiCredentials] = useState<AiCredentials | null>(null);
  const [gasInput, setGasInputState] = useState<GasPlanInput | null>(null);
  const [decoInput, setDecoInputState] = useState<unknown>(null);
  const [decoPlans, setDecoPlans] = useState<SavedDecoPlan[]>([]);
  const [gear, setGearState] = useState<GearArchive>({ equipment: [], certifications: [] });
  const [bleMarkers, setBleMarkers] = useState<Record<string, DownloadMarker>>({});
  /** Dove finiscono davvero le credenziali su QUESTO dispositivo. */
  const [secretPlace, setSecretPlace] = useState<SecretPlace>('archive');
  const [analyses, setAnalyses] = useState<Record<string, StoredAnalysis>>({});
  const [trash, setTrash] = useState<TrashedDive[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getStore(traduci);
      /*
       * L'ARCHIVIO SI REGISTRA SUBITO.
       *
       * Stava dopo il `Promise.all`, e quella riga di distanza era un guasto
       * serio: se UNA sola di quelle letture falliva — tipicamente un `read` di
       * un segreto, che è una chiamata al guscio nativo e quindi la più fragile
       * del gruppo — l'intera funzione saltava al `catch` finale, che metteva
       * `ready` a vero. Risultato: l'applicazione si apriva, dichiarava di
       * essere pronta, mostrava zero immersioni e `store` restava NULLO, cioè
       * ogni salvataggio successivo non scriveva da nessuna parte. Un archivio
       * pieno che sembra vuoto e che accetta scritture nel vuoto è il modo
       * peggiore in cui questa applicazione possa rompersi.
       *
       * L'archivio aperto è l'unica cosa che serve per non perdere dati: appena
       * c'è, si registra. Tutto quello che viene dopo sono preferenze, e una
       * preferenza che non si legge vale il suo valore predefinito.
       */
      if (cancelled) return;
      setStore(s);

      /*
       * Ogni lettura risponde per sé.
       *
       * `Promise.all` è tutto-o-niente, e qui non è la semantica giusta: che il
       * portachiavi non risponda non è un motivo per non mostrare le
       * immersioni. Ciascuna lettura torna `undefined` in caso di errore e il
       * motivo viene raccolto, così l'avvio parziale si può DIRE invece di
       * farlo sembrare un archivio vuoto.
       */
      const guasti: string[] = [];
      const prova = async <T,>(cosa: string, f: () => Promise<T>): Promise<T | undefined> => {
        try {
          return await f();
        } catch (err) {
          console.error(`Lettura fallita (${cosa}):`, err);
          guasti.push(cosa);
          return undefined;
        }
      };

      const segreti = await prova('portachiavi', () => openSecretStore(s));
      if (!cancelled && segreti) setSecretPlace(segreti.place);

      const [
        list,
        savedGoal,
        savedPeriod,
        savedSync,
        savedAi,
        savedSessione,
        savedAnalyses,
        savedGas,
        savedGear,
        savedMarkers,
      ] = await Promise.all([
        prova('immersioni', () => s.listDives()),
        prova('obiettivo', () => s.getSetting<GoalId>('goal')),
        prova('periodo', () => s.getSetting<PeriodId>('period')),
        // Le credenziali NON passano più da `getSetting`: le legge il negozio
        // dei segreti, che su macOS è il portachiavi di sistema e che al primo
        // avvio migra da solo quelle rimaste in chiaro nell'archivio.
        prova('credenziali di sincronizzazione', async () => segreti?.read<SyncCredentials>('sync')),
        prova('chiave dell’API', async () => segreti?.read<AiCredentials>('ai')),
        prova('sessione dell’account', async () => segreti?.read<AccountSalvato | string>('account')),
        prova('analisi', () => s.getSetting<Record<string, StoredAnalysis>>('analyses')),
        prova('piano gas', () => s.getSetting<GasPlanInput>('gasPlan')),
        prova('attrezzatura', () => s.getSetting<unknown>('gear')),
        prova('segnalibri Bluetooth', () => s.getSetting<Record<string, DownloadMarker>>(BLE_MARKERS_KEY)),
      ]);
      const savedDeco = await prova('piano deco', () => s.getSetting<unknown>('decoPlan'));
      const savedPlans =
        (await prova('piani salvati', () => s.getSetting<SavedDecoPlan[]>('decoPlans'))) ?? [];
      const savedTrash = (await prova('cestino', () => s.getSetting<TrashedDive[]>(TRASH_KEY))) ?? [];
      if (cancelled) return;
      if (guasti.length) {
        setInitError(
          `Alcune parti dell'archivio non si sono aperte: ${guasti.join(', ')}. Il resto funziona, ` +
            'ma prima di aggiungere immersioni conviene capire perché — la console del sistema ne ' +
            'riporta il motivo esatto.',
        );
      }

      // Riparazione all'avvio: se una correzione al calcolo delle metriche o alla
      // fusione fra due computer è arrivata dopo l'import, i numeri in archivio
      // sono vecchi. Ricalcolarli qui evita di chiedere all'utente di reimportare
      // per far tornare un dato che l'app ha già.
      const { report, dives: healed } = await repairArchive(s, list ?? []).catch((err) => {
        console.error('Riparazione dell’archivio non riuscita:', err);
        return { report: { checked: 0, repaired: 0, reasons: {} }, dives: list ?? [] };
      });
      if (report.repaired > 0) {
        console.info(`Metriche ricalcolate su ${report.repaired} immersioni:`, report.reasons);
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
      /*
       * La sessione dell'account sopravvive alla chiusura dell'app; la chiave
       * del database no, e viene richiesta al primo bisogno. È la ragione per
       * cui qui si ricostruisce il gestore delle chiavi invece di conservarne
       * una: quella di ieri sera è scaduta da un pezzo.
       */
      const conto = leggiAccountSalvato(savedSessione);
      if (conto) {
        setSessioneAccount(conto.sessione);
        setAccountEmail(conto.email);
        chiaviAccount.current = new ChiaviDelDatabase(
          { servizio: SERVIZIO_ACCESSO, t: traduci },
          conto.sessione,
        );
      }
      if (savedAnalyses) setAnalyses(savedAnalyses);
      if (savedGas?.depthM) setGasInputState(savedGas);
      if (savedDeco) setDecoInputState(savedDeco);
      if (savedPlans.length) setDecoPlans(savedPlans);
      // L'archivio dell'attrezzatura ha cambiato forma: prima era una lista
      // sola con dentro brevetti, certificati e bombole, ora sono due elenchi
      // distinti. `migrateGear` legge entrambe le forme, così chi aggiorna
      // l'applicazione non perde niente di quello che aveva scritto.
      setGearState(migrateGear(savedGear as never));
      if (savedMarkers) setBleMarkers(savedMarkers);
      setReady(true);
    })().catch((err) => {
      // Qui ci si arriva solo se `getStore()` stesso è fallito: l'archivio non
      // esiste proprio. Si parte lo stesso — con la barra di navigazione si
      // raggiunge almeno il pianificatore, che non ha bisogno di archivio — ma
      // il motivo si scrive a schermo, perché senza si vede una applicazione
      // vuota e nient'altro.
      console.error('Inizializzazione archivio fallita:', err);
      setInitError(
        `L'archivio locale non si è aperto: ${err instanceof Error ? err.message : String(err)}. ` +
          'Quello che aggiungi adesso NON viene salvato.',
      );
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [traduci]);

  /*
   * Obiettivo e periodo viaggiano fra dispositivi, e per farlo servono i TIMBRI.
   *
   * Erano le uniche due impostazioni presenti nel backup e assenti dalla
   * sincronizzazione: il Mac e il telefono potevano guardare finestre temporali
   * diverse, e lo stesso archivio raccontava statistiche diverse e dava consigli
   * diversi senza che niente lo dicesse.
   *
   * `${chiave}:at` non è un dettaglio implementativo che si può rimandare:
   * `syncSettings` arbitra fra due dispositivi confrontando quei timbri, e
   * senza il timbro locale il confronto è `'' > qualcosa`, cioè sempre falso —
   * vincerebbe SEMPRE il valore remoto, e la scelta appena fatta qui verrebbe
   * cancellata al primo allineamento.
   */
  const setGoalId = useCallback(
    (id: GoalId) => {
      setGoalIdState(id);
      void (async () => {
        await store?.setSetting('goal', id);
        await store?.setSetting('goal:at', new Date().toISOString());
      })().catch(() => undefined);
    },
    [store],
  );

  const setPeriod = useCallback(
    (id: PeriodId) => {
      setPeriodState(id);
      void (async () => {
        await store?.setSetting('period', id);
        await store?.setSetting('period:at', new Date().toISOString());
      })().catch(() => undefined);
    },
    [store],
  );

  /*
   * Toglie da un lotto in arrivo quello che è già stato cancellato.
   *
   * Vale per TUTTI i percorsi d'import — file e Bluetooth — e sta qui invece
   * che dentro `mergeImports` perché cestino e lapidi sono stato
   * dell'applicazione, non del nucleo: `src/core` non sa che esistono, ed è
   * giusto che continui a non saperlo.
   *
   * Le lapidi si rileggono dall'archivio a ogni import invece di tenerle in
   * memoria: sono poche righe, cambiano di rado, e una copia in memoria che si
   * disallinea qui significherebbe far risorgere un'immersione cancellata.
   */
  const scartaCancellate = useCallback(
    async (arrivate: Dive[]): Promise<{ keep: Dive[]; nota?: string }> => {
      const tombs = store
        ? ((await store.getSetting<{ id: string; at: string }[]>(TOMBSTONE_KEY).catch(() => [])) ?? [])
        : [];
      const { keep, inTrash, buried } = filterDeleted(arrivate, trash, tombs);
      if (!inTrash && !buried) return { keep };
      const pezzi: string[] = [];
      /*
       * Questa nota finisce nella STESSA tabella degli avvisi dei parser, quindi
       * segue la stessa regola: si traduce a pezzi, con i numeri fuori dalle
       * chiavi. «definitivamente» rientra dentro la chiave invece di restare
       * appeso in coda perché in inglese l'avverbio precede il participio
       * («permanently deleted»), e una coda fissa lo lascerebbe alla fine.
       */
      if (inTrash) {
        pezzi.push(`${inTrash} ${traduci(inTrash === 1 ? 'è nel cestino' : 'sono nel cestino')}`);
      }
      if (buried) {
        pezzi.push(
          `${buried} ${traduci(
            buried === 1 ? 'era stata cancellata definitivamente' : 'erano state cancellate definitivamente',
          )}`,
        );
      }
      const quante = inTrash + buried;
      return {
        keep,
        nota:
          `${quante} ${traduci(quante === 1 ? 'immersione non è stata reimportata' : 'immersioni non sono state reimportate')} ` +
          `${traduci('perché')} ${pezzi.join(` ${traduci('e')} `)}. ` +
          traduci('Per riaverle, rimettile a posto dal cestino in Impostazioni.'),
      };
    },
    [store, trash, traduci],
  );

  const importFiles = useCallback(
    async (files: File[]): Promise<ImportOutcome[]> => {
      const outcomes: ImportOutcome[] = [];
      // Parte dalla lista corrente e la fa crescere: così due file che
      // contengono la stessa immersione vengono deduplicati nello stesso batch.
      let current = dives;

      for (const file of files) {
        try {
          const parsed = await parseBrowserFile(file, traduci);
          const filtro = await scartaCancellate(parsed.dives);
          const result = { ...parsed, dives: filtro.keep };
          // I profili delle immersioni già in archivio vanno caricati PRIMA di
          // fondere: la fusione sceglie quale profilo tenere confrontando canali e
          // campioni, e un profilo non caricato conta zero — qualunque cosa
          // arrivasse sembrava migliore, anche quando era più povera.
          if (store) current = await hydrateForMerge(store, current, result.dives);
          const report = mergeImports(current, result.dives);
          current = report.dives;
          const warnings = [...result.warnings];
          if (filtro.nota) warnings.push(filtro.nota);
          for (const c of report.clockOffsets) {
            const hours = c.offsetMs / 3_600_000;
            warnings.push(
              `${traduci('Riconosciuto uno sfasamento di')} ${formatOffset(hours)} ` +
                `${traduci("fra l'orologio di questo computer e quello delle immersioni già in archivio")} ` +
                `(${traduci('su')} ${c.pairs} ${traduci('corrispondenze')}): ` +
                traduci('le immersioni sono state unite comunque.'),
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
    [dives, store, scartaCancellate, traduci],
  );

  /**
   * Immersioni che arrivano da qualcosa che non è un file.
   *
   * Ripercorre gli stessi passi di `importFiles` per un solo lotto. È scritta a
   * parte e non riusando quella — che vuole degli `File` — perché fabbricare un
   * finto `File` per far contenta una firma è il genere di scorciatoia che
   * poi qualcuno legge come «questi dati vengono da un file» e ci costruisce
   * sopra.
   */
  const importDives = useCallback(
    async (tutte: Dive[], origine: string): Promise<ImportOutcome> => {
      try {
        const filtro = await scartaCancellate(tutte);
        const arrivate = filtro.keep;
        let current = dives;
        if (store) current = await hydrateForMerge(store, current, arrivate);
        const report = mergeImports(current, arrivate);
        const warnings: string[] = [];
        if (filtro.nota) warnings.push(filtro.nota);
        for (const c of report.clockOffsets) {
          const hours = c.offsetMs / 3_600_000;
          warnings.push(
            `${traduci('Riconosciuto uno sfasamento di')} ${formatOffset(hours)} ` +
              `${traduci("fra l'orologio del computer e quello delle immersioni già in archivio")} ` +
              `(${traduci('su')} ${c.pairs} ${traduci('corrispondenze')}): ` +
              traduci('le immersioni sono state unite comunque.'),
          );
        }
        const previous = new Map(dives.map((d) => [d.id, d]));
        const changed = report.dives.filter((d) => previous.get(d.id) !== d);
        if (store && changed.length) await store.putDives(changed);
        setDives(report.dives.map(stripForList));
        return {
          fileName: origine,
          ok: true,
          found: tutte.length,
          added: report.added,
          merged: report.merged,
          duplicates: report.duplicates,
          warnings,
        };
      } catch (err) {
        return {
          fileName: origine,
          ok: false,
          found: tutte.length,
          added: 0,
          merged: 0,
          duplicates: 0,
          warnings: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [dives, store, scartaCancellate, traduci],
  );

  /*
   * Il segnalibro si scrive DOPO che le immersioni sono in archivio.
   *
   * L'ordine non è indifferente: se si salvasse prima e il salvataggio delle
   * immersioni fallisse, il prossimo scarico salterebbe proprio quelle che non
   * sono entrate, e non tornerebbero mai più — il protocollo non permette di
   * ripartire da metà. Chi chiama rispetta quest'ordine; il commento sta qui
   * perché è qui che si viene a cercare.
   */
  const saveBleMarker = useCallback(
    async (key: string, marker: DownloadMarker) => {
      const next = { ...bleMarkers, [key]: marker };
      setBleMarkers(next);
      if (store) {
        await store.setSetting(BLE_MARKERS_KEY, next);
        await store.setSetting(`${BLE_MARKERS_KEY}:at`, marker.at);
      }
    },
    [bleMarkers, store],
  );

  /**
   * «Dimentica»: al prossimo collegamento questo computer si rilegge da capo.
   *
   * NON cancella la riga, la SVUOTA — impronta vuota, data di adesso. La
   * differenza conta da quando i segnalibri viaggiano fra dispositivi: una riga
   * cancellata è indistinguibile da una riga che qui non è mai arrivata, e al
   * primo allineamento l'altro dispositivo rimanderebbe indietro il segnalibro
   * vecchio, annullando in silenzio quello che si era appena chiesto. Una riga
   * vuota e datata invece è un fatto, e come tutti i fatti più recenti vince.
   *
   * Chi legge i segnalibri tratta l'impronta vuota come «nessun segnalibro».
   */
  const forgetBleMarker = useCallback(
    async (key: string) => {
      const next = {
        ...bleMarkers,
        [key]: { ...bleMarkers[key], fingerprint: '', at: new Date().toISOString(), dives: 0 },
      };
      setBleMarkers(next);
      if (store) {
        await store.setSetting(BLE_MARKERS_KEY, next);
        await store.setSetting(`${BLE_MARKERS_KEY}:at`, new Date().toISOString());
      }
    },
    [bleMarkers, store],
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
  /**
   * Crea un'immersione inserita a mano.
   *
   * Separata da `saveDive` perché due cose sono diverse: qui l'id non esiste
   * ancora, e soprattutto va gestito il caso in cui esista GIÀ. `buildManualDive`
   * ricava l'id dalla stessa firma orario+profondità+durata dei parser, quindi
   * inserire a mano un'immersione che è già in archivio — perché il file era
   * stato importato e non ce se lo ricordava — non deve creare un doppione: si
   * fondono, con la stessa regola dell'import, che protegge i campi scritti a
   * mano. È il comportamento che chi scrive si aspetta senza saperlo.
   */
  const createDive = useCallback(
    async (dive: Dive): Promise<{ merged: boolean }> => {
      const existing = dives.find((d) => d.id === dive.id);
      let toSave = dive;
      let merged = false;
      if (existing) {
        const full = store ? { ...existing, samples: await store.getSamples(existing.id) } : existing;
        // L'immersione scritta a mano è quella "in arrivo": i suoi campi
        // compilati riempiono i buchi di quella già presente, e il profilo che
        // c'era resta dov'è.
        toSave = mergeDive(full, dive);
        merged = true;
      }
      const updated: Dive = { ...toSave, updatedAt: new Date().toISOString() };
      updated.metrics = computeMetrics(updated);
      if (store) await store.putDives([updated]);

      /*
       * Ripassare la catena, non solo salvare la riga.
       *
       * `computeMetrics` sa tutto di questa immersione e niente di quelle
       * intorno: il GF99, il carico residuo e l'intervallo di superficie nascono
       * dalla CATENA, che va da un'immersione all'altra in ordine di tempo.
       * Senza questo passaggio l'immersione appena inserita compariva in elenco
       * ma con la scheda della saturazione vuota, e — molto peggio — le
       * ripetitive che la seguono restavano coi numeri calcolati quando lei non
       * c'era, cioè più puliti del vero. Il buco che l'inserimento a mano esiste
       * per chiudere si sarebbe richiuso solo al riavvio successivo.
       *
       * `repairArchive` fa esattamente questo e riscrive solo ciò che cambia:
       * è già quello che gira all'avvio e dopo una sincronizzazione.
       */
      if (store) {
        const list = await store.listDives();
        const healed = await repairArchive(store, list).catch(() => ({ dives: list }));
        setDives(healed.dives);
      } else {
        setDives((prev) => {
          const stripped = stripForList(updated);
          return prev.some((d) => d.id === updated.id)
            ? prev.map((d) => (d.id === updated.id ? stripped : d))
            : [...prev, stripped];
        });
      }
      return { merged };
    },
    [dives, store],
  );

  /**
   * Cancella una o più immersioni, mettendole nel cestino.
   *
   * PRENDE UN ELENCO, e non è un vezzo: la versione che accettava un solo id
   * veniva chiamata in ciclo dalla modifica in blocco, e ogni chiamata leggeva
   * `trash` dalla CHIUSURA del render corrente — cioè sempre lo stesso valore,
   * quello di partenza. Ogni giro riscriveva la chiave del cestino da capo con
   * «vecchio + questa», e l'ultima scrittura vinceva: su tre immersioni
   * selezionate, l'archivio ne perdeva tre e il cestino ne conteneva UNA. Le
   * altre due non erano da nessuna parte, e il dialogo aveva appena promesso
   * trenta giorni di ripensamento. Sopravviveva al riavvio, perché il danno era
   * già sul disco.
   *
   * Un elenco solo, una scrittura sola, nessuna chiusura da cui leggere.
   */
  const removeDives = useCallback(
    async (ids: string[]) => {
      if (!store || !ids.length) {
        setDives((prev) => prev.filter((d) => !ids.includes(d.id)));
        return;
      }
      const daCancellare = dives.filter((d) => ids.includes(d.id));
      const nuovi: TrashedDive[] = [];
      for (const dive of daCancellare) {
        // Il profilo va salvato PRIMA di cancellare: dopo non c'è più da leggere.
        const [samples, altSamples] = await Promise.all([
          store.getSamples(dive.id).catch(() => [] as Sample[]),
          store.getAltSamples(dive.id).catch(() => [] as Sample[]),
        ]);
        const { samples: _s, altSamples: _a, ...doc } = dive;
        nuovi.push({
          dive: doc as Dive,
          ...(samples.length ? { samples } : {}),
          ...(altSamples.length ? { altSamples } : {}),
          at: new Date().toISOString(),
        });
      }
      const cancellati = new Set(nuovi.map((t) => t.dive.id));
      const next = [...trash.filter((t) => !cancellati.has(t.dive.id)), ...nuovi];
      await store.setSetting(TRASH_KEY, next);
      for (const id of cancellati) await store.deleteDive(id);
      setTrash(next);
      setDives((prev) => prev.filter((d) => !cancellati.has(d.id)));
    },
    [store, dives, trash],
  );

  const removeDive = useCallback((id: string) => removeDives([id]), [removeDives]);

  /**
   * Rimette in archivio una o più immersioni, esattamente com'erano, profilo
   * compreso.
   *
   * PERCHÉ IN BLOCCO E NON UNA ALLA VOLTA. Per lo stesso motivo per cui
   * `removeDives` prende un elenco: `trash` qui dentro è il valore della
   * CHIUSURA di questo render, sempre lo stesso. Chiamare la versione singola in
   * un ciclo fa riscrivere la chiave del cestino ogni giro partendo dallo stesso
   * elenco di partenza, e l'ultima scrittura vince — su cinquanta ripristini ne
   * sopravvive uno, e le altre quarantanove immersioni restano nel cestino pur
   * essendo ricomparse in archivio. Il caso non è teorico: è lo stesso difetto
   * che era già costato tre immersioni sulla cancellazione multipla.
   */
  const restoreDives = useCallback(
    async (ids: string[]) => {
      if (!store || !ids.length) return;
      const insieme = new Set(ids);
      const items = trash.filter((t) => insieme.has(t.dive.id));
      if (!items.length) return;
      // `updatedAt` a ORA, e la lapide via.
      //
      // Senza queste due righe il ripristino durava fino alla sincronizzazione
      // successiva: la lapide scritta dall'altro dispositivo — o dalla scadenza
      // del cestino qui — tornava ad applicarsi e l'immersione spariva di nuovo,
      // stavolta senza passare dal cestino. Il timbro nuovo è ciò che dice alla
      // sincronizzazione «questa è stata rimessa apposta, dopo».
      const adesso = new Date().toISOString();
      const restored: Dive[] = items.map((item) => ({
        ...item.dive,
        updatedAt: adesso,
        ...(item.samples ? { samples: item.samples } : {}),
        ...(item.altSamples ? { altSamples: item.altSamples } : {}),
      }));
      await store.putDives(restored);
      const rimesse = new Set(restored.map((d) => d.id));
      const next = trash.filter((t) => !rimesse.has(t.dive.id));
      await store.setSetting(TRASH_KEY, next);
      setTrash(next);
      const tombs = (await store.getSetting<{ id: string; at: string }[]>(TOMBSTONE_KEY)) ?? [];
      if (tombs.some((t) => rimesse.has(t.id))) {
        await store.setSetting(
          TOMBSTONE_KEY,
          tombs.filter((t) => !rimesse.has(t.id)),
        );
      }
      // In memoria si tiene il riepilogo senza profilo, come tutto il resto.
      const summaries = restored.map(({ samples: _s, altSamples: _a, ...rest }) => rest as Dive);
      /*
       * L'elenco si ricostruisce per ID, non si accoda.
       *
       * Accodando, un DOPPIO clic su «Rimetti a posto» — prima che `setTrash`
       * fosse applicato — aggiungeva la stessa immersione due volte: il logbook
       * ne mostrava 47 invece di 46, il conteggio in alto pure, e le statistiche
       * contavano quella riga due volte. Guariva solo ricaricando, e in
       * produzione React non avvisa nemmeno della chiave duplicata.
       */
      setDives((prev) => {
        const perId = new Map(prev.map((d) => [d.id, d]));
        for (const d of summaries) perId.set(d.id, d);
        return [...perId.values()].sort((a, b) => b.startTime.localeCompare(a.startTime));
      });
    },
    [store, trash],
  );

  const restoreDive = useCallback((id: string) => restoreDives([id]), [restoreDives]);

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
    for (const t of trash)
      if (!merged.some((x) => x.id === t.dive.id)) merged.push({ id: t.dive.id, at: now });
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
      // Nel portachiavi di sistema dove c'è, altrimenti nell'archivio locale.
      // Mai in un file del progetto: il token è una credenziale di chi usa
      // l'app, e nel repository non ci deve entrare in nessun caso.
      if (store) {
        const segreti = await openSecretStore(store);
        if (creds) await segreti.write('sync', creds);
        else await segreti.remove('sync');
      }
    },
    [store],
  );

  /*
   * L'accesso: dal pulsante alla sessione nel portachiavi.
   *
   * L'EMAIL VIENE SALVATA CON LA SESSIONE, e la scelta merita una riga perché
   * la prima versione faceva il contrario. Non salvarla sembrava più pulito —
   * un dato personale in meno sul disco — ma il risultato era che alla
   * riapertura dell'app la pagina diceva «accedi» a chi era già entrato: la
   * sessione c'era, la faccia da mostrare no. Il dato in più è la propria email
   * accanto alla propria sessione, nello stesso portachiavi di sistema, dove la
   * sessione è di gran lunga la cosa più preziosa delle due. Il fastidio
   * risparmiato è reale, il rischio aggiunto no.
   */
  const accediConAccount = useCallback(
    async (fornitore: Fornitore) => {
      const esito = await accediConFornitore(fornitore, traduci);
      setSessioneAccount(esito.sessione);
      setAccountEmail(esito.email);
      chiaviAccount.current = new ChiaviDelDatabase(
        { servizio: SERVIZIO_ACCESSO, t: traduci },
        esito.sessione,
      );
      if (store) {
        const segreti = await openSecretStore(store);
        const salvato: AccountSalvato = { sessione: esito.sessione, email: esito.email };
        await segreti.write('account', salvato);
      }
    },
    [store, traduci],
  );

  /*
   * Uscire NON cancella l'archivio locale, e nemmeno quello remoto.
   *
   * È il comportamento che ci si aspetta da un «esci»: smetti di sincronizzare,
   * il logbook resta dov'è. Cancellare i dati da un pulsante che dice
   * un'altra cosa sarebbe una sorpresa irreversibile.
   */
  const esciDallAccount = useCallback(async () => {
    setSessioneAccount(null);
    setAccountEmail(null);
    chiaviAccount.current = null;
    if (store) {
      const segreti = await openSecretStore(store);
      await segreti.remove('account');
    }
  }, [store]);

  const cancellaAccount = useCallback(async () => {
    if (!sessioneAccount) return;
    await chiudiAccountRemoto({ servizio: SERVIZIO_ACCESSO, t: traduci }, sessioneAccount);
    await esciDallAccount();
  }, [sessioneAccount, esciDallAccount, traduci]);

  const testSync = useCallback((creds: SyncCredentials) => testConnection(creds), []);

  const syncNow = useCallback(
    async (onProgress?: (message: string) => void) => {
      if (!store) throw new Error('Archivio non pronto.');
      /*
       * Due strade per la stessa cosa, e l'account ha la precedenza.
       *
       * Chi ha fatto l'accesso usa le chiavi del proprio database, rinnovate da
       * sé quando stanno per scadere. Chi non l'ha fatto continua con
       * l'indirizzo e il token scritti a mano, che restano una strada valida —
       * è quella con cui questo archivio è vissuto finora.
       */
      const credenziali = chiaviAccount.current ? await chiaviAccount.current.valida() : syncCredentials;
      if (!credenziali) {
        throw new Error('Accedi con Apple o con Google, oppure configura indirizzo e token del database.');
      }
      const sql = await connect(credenziali);
      try {
        const report = await syncArchive(store, sql, onProgress, traduci);
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
        /*
         * SI RILEGGE TUTTO QUELLO CHE VIAGGIA, non tre chiavi su otto.
         *
         * Ne rileggeva tre — piano gas, analisi, attrezzatura — e le altre
         * restavano quelle vecchie a schermo fino al riavvio successivo. Il
         * caso peggiore era il periodo delle statistiche: arrivato dall'altro
         * dispositivo, l'archivio è già cambiato sotto ma la pagina continua a
         * mostrare la finestra di prima, cioè numeri che non corrispondono più
         * a niente. L'elenco qui deve restare allineato a `SHARED_SETTINGS`.
         */
        if (report.settingsPulled > 0) {
          const [gas, saved, savedGear, deco, piani, segnalibri, obiettivo, periodoSalvato] =
            await Promise.all([
              store.getSetting<GasPlanInput>('gasPlan'),
              store.getSetting<Record<string, StoredAnalysis>>('analyses'),
              store.getSetting<unknown>('gear'),
              store.getSetting<unknown>('decoPlan'),
              store.getSetting<SavedDecoPlan[]>('decoPlans'),
              store.getSetting<Record<string, DownloadMarker>>(BLE_MARKERS_KEY),
              store.getSetting<GoalId>('goal'),
              store.getSetting<PeriodId>('period'),
            ]);
          if (gas?.depthM) setGasInputState(gas);
          if (saved) setAnalyses(saved);
          if (savedGear) setGearState(migrateGear(savedGear as never));
          if (deco) setDecoInputState(deco);
          if (piani) setDecoPlans(piani);
          if (segnalibri) setBleMarkers(segnalibri);
          if (obiettivo) setGoalIdState(obiettivo);
          if (periodoSalvato) setPeriodState(periodoSalvato);
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
    [store, syncCredentials, traduci],
  );

  const saveAiCredentials = useCallback(
    async (creds: AiCredentials | null) => {
      setAiCredentials(creds);
      if (store) {
        const segreti = await openSecretStore(store);
        if (creds) await segreti.write('ai', creds);
        else await segreti.remove('ai');
      }
    },
    [store],
  );

  const testAiKey = useCallback((creds: AiCredentials) => testKey(creds), []);

  const saveGear = useCallback(
    async (archive: GearArchive) => {
      // Ogni pezzo porta il proprio timbro, non solo la lista.
      //
      // Serve alla fusione fra dispositivi: senza una data per elemento, quando
      // lo stesso pezzo è stato modificato di qua e di là non c'è modo di sapere
      // quale versione è più recente, e l'unica alternativa sarebbe scegliere a
      // caso. Si timbra solo ciò che è davvero cambiato, altrimenti riaprire la
      // scheda basterebbe a far vincere questo dispositivo.
      const now = new Date().toISOString();
      const stamp = <T extends { id: string; savedAt?: string }>(next: T[], before: T[]): T[] =>
        next.map((item) => {
          const old = before.find((g) => g.id === item.id);
          const unchanged =
            old && JSON.stringify({ ...old, savedAt: null }) === JSON.stringify({ ...item, savedAt: null });
          return unchanged ? old : { ...item, savedAt: now };
        });
      const stamped: GearArchive = {
        equipment: stamp(archive.equipment, gear.equipment),
        certifications: stamp(archive.certifications, gear.certifications),
      };
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
      const full =
        includeProfiles && store
          ? await Promise.all(dives.map(async (d) => ({ ...d, samples: await store.getSamples(d.id) })))
          : dives;
      return exportUddf(full, { includeProfiles });
    },
    [dives, store],
  );

  /**
   * Il backup completo: tutto quello che l'applicazione sa, in un file.
   *
   * Diverso dall'export UDDF che sta accanto, e la differenza va detta a chi
   * preme: UDDF serve a far leggere le immersioni a un'altra applicazione e per
   * riuscirci perde una quindicina di campi più tutto ciò che sta fuori dalle
   * immersioni; questo non lo legge nessun altro programma e non perde niente.
   */
  const buildFullBackup = useCallback(async (): Promise<BackupFile> => {
    if (!store) throw new Error('Archivio non ancora aperto.');
    return buildBackup(store);
  }, [store]);

  /**
   * Ripristina da un backup.
   *
   * Due passaggi separati apposta: `checkBackup` verifica il file PRIMA che
   * l'archivio venga toccato, e `planRestore` dice che cosa succederà. Un
   * ripristino si lancia quando le cose sono già andate male, e un errore a metà
   * strada lascerebbe un archivio mezzo sovrascritto — cioè peggio del punto di
   * partenza.
   */
  const restoreBackup = useCallback(
    async (file: BackupFile, mode: 'merge' | 'replace' = 'merge') => {
      if (!store) throw new Error('Archivio non ancora aperto.');

      /*
       * I PROFILI SI IDRATANO PRIMA DI FONDERE.
       *
       * `dives` è la lista in memoria e per scelta architetturale NON contiene i
       * campioni. Passandola così a `planRestore`, `mergeDive` contava zero
       * canali sul profilo esistente e faceva vincere qualunque cosa arrivasse
       * dal file: un backup di gennaio, fatto quando c'era solo il profilo
       * dell'Aladin, cancellava il profilo del Peregrine importato a marzo — con
       * tetto, TTS e NDL — in modalità «Fondi», quella che l'interfaccia
       * descrive come «arricchite senza perdere niente».
       *
       * `hydrateForMerge` esiste da mesi esattamente per questo e l'import lo
       * usa già. Il ripristino se l'era dimenticato.
       */
      const idratate = await hydrateForMerge(store, dives, file.dives);
      const plan = planRestore(file, idratate, mode);

      /*
       * NON si cancella prima di scrivere.
       *
       * `clear()` seguito dalla riscrittura a blocchi lasciava l'archivio
       * mutilato quando la scrittura falliva a metà — disco pieno, quota
       * IndexedDB, scheda chiusa, app terminata da iOS: con 120 immersioni e un
       * guasto al terzo blocco ne restavano 25, e con un guasto al primo
       * restava un archivio VUOTO. Su un'operazione che si lancia per
       * recuperare, un punto di non ritorno lungo minuti è inaccettabile.
       *
       * Stessa semantica, ordine invertito: prima si scrive tutto il file, poi —
       * solo in `replace`, e solo se la scrittura è andata a buon fine — si
       * tolgono gli id che il file non contiene. Il punto di non ritorno dura
       * quanto le cancellazioni finali invece che quanto l'intero ripristino.
       */
      const daScrivere = [...plan.added, ...plan.merged];
      for (let i = 0; i < daScrivere.length; i += 25) {
        await store.putDives(daScrivere.slice(i, i + 25));
      }

      /*
       * Le lapidi degli id che stiamo rimettendo vanno revocate, e il timbro
       * aggiornato.
       *
       * Senza, un'immersione ripristinata da backup spariva alla prima
       * sincronizzazione — definitivamente e senza passare dal cestino — perché
       * il suo `updatedAt` è quello del FILE, cioè per costruzione precedente
       * alla cancellazione che ha prodotto la lapide. `restoreDive` fa già
       * queste due cose da tempo (vedi il commento lì sopra): qui mancavano.
       */
      const rimessi = new Set(daScrivere.map((d) => d.id));
      const now = new Date().toISOString();
      const timbrate = daScrivere.map((d) => ({ ...d, updatedAt: now }));
      for (let i = 0; i < timbrate.length; i += 25) {
        await store.putDives(timbrate.slice(i, i + 25));
      }
      const lapidi = (await store.getSetting<{ id: string; at: string }[]>(TOMBSTONE_KEY)) ?? [];
      const restano = lapidi.filter((t) => !rimessi.has(t.id));
      if (restano.length !== lapidi.length) await store.setSetting(TOMBSTONE_KEY, restano);

      // E via dal cestino ciò che è tornato in archivio: due verità sulla stessa
      // immersione sono peggio di nessuna delle due. Senza, «svuota il cestino»
      // avrebbe poi riscritto la lapide su un'immersione perfettamente viva.
      const cestinoDopo = trash.filter((t) => !rimessi.has(t.dive.id));
      if (cestinoDopo.length !== trash.length) {
        await store.setSetting(TRASH_KEY, cestinoDopo);
        setTrash(cestinoDopo);
      }

      if (mode === 'replace') {
        // Adesso, e non prima: quello che il file non contiene se ne va solo
        // quando il file è già tutto sul disco.
        const presenti = await store.listDives();
        for (const d of presenti) if (!rimessi.has(d.id)) await store.deleteDive(d.id);
      }

      for (const [key, value] of Object.entries(plan.settings)) {
        /*
         * Le raccolte si FONDONO, non si sostituiscono.
         *
         * È la stessa conclusione che la sincronizzazione ha già tratto e
         * scritto in `mergeKeyed`: chi salva un piano su un dispositivo e uno
         * sull'altro ne perdeva uno. La modalità che si chiama «Fondi» usava la
         * regola che la sincronizzazione ha abbandonato, e ripristinare un
         * backup di gennaio cancellava la muta stagna, il brevetto Rescue e il
         * piano compilato a giugno.
         */
        if (mode === 'merge' && (key === 'gear' || key === 'decoPlans')) {
          const attuale = await store.getSetting<unknown>(key);
          await store.setSetting(key, fondiRaccolta(key, attuale, value));
        } else if (mode === 'merge' && key === 'analyses') {
          const attuale = (await store.getSetting<Record<string, StoredAnalysis>>(key)) ?? {};
          await store.setSetting(key, { ...(value as Record<string, StoredAnalysis>), ...attuale });
        } else {
          await store.setSetting(key, value);
        }
      }

      // Rilettura e riparazione: le metriche e la catena dei tessuti vanno
      // ricalcolate sull'archivio come è adesso, non come era nel file.
      const list = await store.listDives();
      const healed = await repairArchive(store, list).catch(() => ({ dives: list }));
      setDives(healed.dives);

      /*
       * Si rilegge TUTTO quello che vive anche in memoria, `decoPlans` compreso.
       *
       * Mancava, e la conseguenza era muta: dopo il ripristino i piani a schermo
       * erano quelli di prima, sul disco quelli del file, e la divergenza si
       * manifestava al riavvio successivo — staccata dalla sua causa, cioè nel
       * modo in cui è più difficile capire cos'è successo.
       */
      const [savedGear, savedAnalyses, savedGas, savedPlans] = await Promise.all([
        store.getSetting<unknown>('gear'),
        store.getSetting<Record<string, StoredAnalysis>>('analyses'),
        store.getSetting<GasPlanInput>('gasPlan'),
        store.getSetting<SavedDecoPlan[]>('decoPlans'),
      ]);
      setGearState(migrateGear(savedGear as never));
      if (savedAnalyses) setAnalyses(savedAnalyses);
      if (savedGas?.depthM) setGasInputState(savedGas);
      if (savedPlans) setDecoPlans(savedPlans);

      return {
        added: plan.added.length,
        merged: plan.merged.length,
        onlyLocal: mode === 'replace' ? 0 : plan.onlyLocal,
        settings: Object.keys(plan.settings).length,
      };
    },
    [dives, store, trash],
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
  /*
   * I criteri di prontezza guardano TUTTO l'archivio, non la finestra.
   *
   * «Immersioni registrate» e «Immersioni oltre i 30 m» sono criteri di brevetto,
   * cioè totali storici: con la finestra predefinita di dodici mesi la prontezza
   * per il tecnico crollava dal 44% al 22% senza che niente lo spiegasse. Vedi
   * `storicoDi`.
   */
  const storico = useMemo(() => storicoDi(dives), [dives]);
  const plan = useMemo(
    () => buildPlan(scope.dives, aggregates, goalId, storico),
    [scope, aggregates, goalId, storico],
  );

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
        const context = diveContext(withSamples, gear.equipment);
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
        spec = archiveAnalysis(archiveContext(scope.dives, aggregates, scope.period.label, gear.equipment));
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
            // Lo STESSO filtro che si vede a schermo, durata compresa.
            //
            // Senza `bottomMin`, `sameLength()` è sempre vero e il contesto
            // dichiarava al modello `filtrateAncheSullaDurata: true` su un confronto
            // filtrato solo sulla profondità — mentre l'avvertenza scritta apposta
            // per quel caso non si attivava mai. Sul piano di prova: 20 minuti
            // pianificati contro una durata tipica di 51.
            similarDives(scope.dives, computed.input.depthM, 5, computed.input.bottomMin),
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
    [aiCredentials, aggregates, analyses, gear.equipment, goalId, period, plan, scope, store],
  );

  const value: DiveLogValue = {
    ready,
    initError,
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
    importDives,
    bleMarkers,
    saveBleMarker,
    forgetBleMarker,
    loadSamples,
    loadProfiles,
    saveDive,
    createDive,
    removeDive,
    removeDives,
    clearAll,
    trash,
    restoreDive,
    restoreDives,
    purgeDive,
    emptyTrash,
    syncCredentials,
    saveSyncCredentials,
    testSync,
    syncNow,
    accountAttivo: sessioneAccount !== null,
    accountEmail,
    accediConAccount,
    esciDallAccount,
    cancellaAccount,
    gasInput,
    decoInput,
    saveDecoInput,
    decoPlans,
    saveNamedDecoPlan,
    deleteNamedDecoPlan,
    saveGasInput,
    aiCredentials,
    saveAiCredentials,
    secretPlace,
    testAiKey,
    analysis,
    runAnalysis,
    clearAnalysis,
    gear,
    saveGear,
    exportArchive,
    buildFullBackup,
    restoreBackup,
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
