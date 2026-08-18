/**
 * Pianificazione della sincronizzazione.
 *
 * Separata dal trasporto di proposito: qui non c'è rete, solo il confronto fra
 * due elenchi di impronte. È la parte che può sbagliare in modo interessante —
 * far vincere la versione sbagliata, perdere un profilo, oscillare fra due
 * dispositivi — quindi è la parte che si testa senza mai aprire una connessione.
 *
 * La proprietà che conta e che i test verificano: **eseguire la
 * sincronizzazione due volte di fila non deve fare niente la seconda volta.**
 * Se un piano non è idempotente, due dispositivi si rimpallano le stesse
 * immersioni all'infinito.
 *
 * Perché non serve un vero algoritmo di risoluzione dei conflitti: le immersioni
 * hanno un `id` deterministico ricavato dal contenuto (vedi `dedupe.ts`), quindi
 * due dispositivi che importano lo stesso file producono lo stesso id. Non
 * esistono "due versioni della stessa immersione create indipendentemente": ne
 * esiste una, eventualmente arricchita in modo diverso.
 *
 * Riepilogo e profilo viaggiano SEPARATI, e non è un dettaglio di
 * implementazione. Il caso normale di questo archivio è la stessa immersione
 * entrata da due fonti: una col profilo campione per campione, l'altra col solo
 * riepilogo ma con le note scritte a mano. Se il profilo facesse vincere anche il
 * riepilogo, sincronizzare cancellerebbe le note; se il riepilogo più recente
 * facesse vincere anche il profilo, sincronizzare cancellerebbe il profilo. Con
 * due decisioni indipendenti l'immersione riceve entrambe le cose, che è quello
 * che l'utente si aspetta e che non richiede di scegliere quale dato perdere.
 */

export interface SyncFingerprint {
  id: string;
  /** ISO 8601. Assente su record vecchi: contano meno di chi ce l'ha. */
  updatedAt?: string;
  /** Numero di campioni del profilo. 0 = nessun profilo. */
  sampleCount: number;
  /**
   * Campioni del SECONDO profilo, quando due computer hanno registrato la stessa
   * immersione.
   *
   * Mancava, e il commento della sincronizzazione prometteva il contrario: il
   * secondo profilo «viaggia con il principale». Non viaggiava. Nel caso normale —
   * due dispositivi che hanno importato lo stesso file Shearwater, e uno solo che
   * ha importato anche l'Aladin — i due conteggi principali sono uguali, quindi
   * niente si muoveva e il profilo fitto restava su un dispositivo solo. Le
   * velocità e l'assetto si misurano su quello: senza, l'altro dispositivo
   * ricalcola metriche peggiori senza sapere perché.
   */
  altSampleCount?: number;
  /** Impronta del riepilogo, per accorgersi che è cambiato qualcosa. */
  digest: string;
}

export interface SyncPlan {
  /** Immersioni la cui versione locale va caricata. */
  push: string[];
  /** Immersioni la cui versione remota va scaricata. */
  pull: string[];
  /** Profili da caricare (il remoto non li ha o ne ha meno). */
  pushSamples: string[];
  /** Profili da scaricare. */
  pullSamples: string[];
  /** Quante immersioni erano già allineate. */
  unchanged: number;
}

export function planSync(local: SyncFingerprint[], remote: SyncFingerprint[]): SyncPlan {
  const byIdRemote = new Map(remote.map((r) => [r.id, r]));
  const byIdLocal = new Map(local.map((l) => [l.id, l]));

  const plan: SyncPlan = { push: [], pull: [], pushSamples: [], pullSamples: [], unchanged: 0 };

  for (const l of local) {
    const r = byIdRemote.get(l.id);
    if (!r) {
      plan.push.push(l.id);
      if (l.sampleCount > 0 || (l.altSampleCount ?? 0) > 0) plan.pushSamples.push(l.id);
      continue;
    }

    const winner = pickWinner(l, r);
    if (winner === 'local') plan.push.push(l.id);
    else if (winner === 'remote') plan.pull.push(l.id);
    else plan.unchanged++;

    // Il profilo viaggia per conto suo: può essere che il riepilogo sia
    // allineato ma il profilo esista solo da una parte. È il caso normale
    // quando la stessa immersione è entrata da due fonti diverse.
    if (l.sampleCount > r.sampleCount) plan.pushSamples.push(l.id);
    else if (r.sampleCount > l.sampleCount) plan.pullSamples.push(l.id);
    // Il secondo profilo si decide da sé, con lo stesso criterio.
    else if ((l.altSampleCount ?? 0) > (r.altSampleCount ?? 0)) plan.pushSamples.push(l.id);
    else if ((r.altSampleCount ?? 0) > (l.altSampleCount ?? 0)) plan.pullSamples.push(l.id);
  }

  for (const r of remote) {
    if (byIdLocal.has(r.id)) continue;
    plan.pull.push(r.id);
    if (r.sampleCount > 0 || (r.altSampleCount ?? 0) > 0) plan.pullSamples.push(r.id);
  }

  return plan;
}

/**
 * Chi vince fra due versioni dello stesso RIEPILOGO (il profilo si decide a
 * parte, per conteggio dei campioni).
 *
 *  1. impronte uguali → non c'è niente da decidere;
 *  2. **più recente vince**: `updatedAt` viene scritto da chi modifica, quindi è
 *     la sola informazione che dice davvero quale versione è più avanti;
 *  3. a pari data, vince l'impronta lessicograficamente maggiore.
 *
 * Il terzo criterio sembra arbitrario ed è la parte importante: dovendo scegliere
 * a caso, i due dispositivi devono scegliere lo STESSO a caso. Se qui ci fosse
 * "preferisci il locale", ogni dispositivo si vedrebbe vincente e i due si
 * riscriverebbero il record a vicenda per sempre, una richiesta di rete per
 * immersione a ogni sincronizzazione. Confrontando l'impronta — un dato che i due
 * condividono — entrambi nominano lo stesso vincitore e la faccenda si chiude al
 * primo giro. La parità si verifica solo su record vecchi senza `updatedAt`: da
 * quando lo scriviamo a ogni modifica, il criterio 2 basta.
 */
function pickWinner(local: SyncFingerprint, remote: SyncFingerprint): 'local' | 'remote' | 'equal' {
  if (local.digest === remote.digest) return 'equal';
  const lt = local.updatedAt ? Date.parse(local.updatedAt) : 0;
  const rt = remote.updatedAt ? Date.parse(remote.updatedAt) : 0;
  if (lt !== rt) return lt > rt ? 'local' : 'remote';
  return local.digest > remote.digest ? 'local' : 'remote';
}

/**
 * Impronta del riepilogo di un'immersione.
 *
 * Esclude di proposito `source`, `extraSources` e `updatedAt`: la stessa
 * immersione importata da due file diversi ha una provenienza diversa ma è lo
 * stesso dato, e considerarla cambiata farebbe rimbalzare il record fra i
 * dispositivi a ogni sincronizzazione. Esclude anche `samples`, contati a parte.
 */
export function digestOf(dive: Record<string, unknown>): string {
  const {
    samples: _s,
    source: _src,
    extraSources: _xs,
    updatedAt: _u,
    metrics: _m,
    ...rest
  } = dive as Record<string, unknown>;
  return fnv1a(stableStringify(rest));
}

/** JSON con le chiavi in ordine: senza questo l'impronta dipende dall'ordine di inserimento. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${parts.join(',')}}`;
}

function fnv1a(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c << 5) | (i & 15)), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
