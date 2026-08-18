/**
 * Client dell'API di Anthropic.
 *
 * SCELTE, E PERCHÉ.
 *
 * **La chiave sta sul dispositivo, nelle impostazioni dell'archivio locale.** Non
 * nel codice, non in un file del progetto, non in una variabile d'ambiente
 * compilata nel bundle. Chi apre il repository non trova credenziali.
 *
 * **La chiamata parte dall'app, senza un server in mezzo.** Richiede l'header
 * `anthropic-dangerous-direct-browser-access`, e il nome dell'header dice la
 * verità: in una pagina web pubblica la chiave finirebbe esposta a qualsiasi
 * script della pagina. In un'app desktop o iOS — dove il "browser" è una webview
 * che esegue solo il nostro codice — il rischio è quello di avere la chiave sul
 * proprio computer, che è lo stesso di un qualunque strumento a riga di comando.
 * Per questo l'interfaccia lo dice esplicitamente e sconsiglia di usare la chiave
 * nella versione web pubblicata.
 *
 * **Il modello non è scritto nel codice.** I nomi dei modelli cambiano nel tempo:
 * fissarne uno significa un'app che smette di funzionare a una data ignota.
 * `listModels` chiede all'API quali sono disponibili e l'interfaccia fa scegliere.
 *
 * **`fetch` è iniettabile** perché i test devono poter verificare le richieste —
 * header, corpo, gestione degli errori — senza rete e senza chiave.
 */

export interface AiCredentials {
  apiKey: string;
  /** Identificativo del modello, scelto fra quelli che l'API dichiara. */
  model?: string;
}

export interface AiModel {
  id: string;
  displayName?: string;
  createdAt?: string;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface AiResult {
  text: string;
  model: string;
  usage?: AiUsage;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const API = 'https://api.anthropic.com/v1';
const VERSION = '2023-06-01';
/** Oltre questo tempo la richiesta è considerata perduta. Le analisi sono lunghe. */
const TIMEOUT_MS = 180_000;

export class AiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

function headers(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': VERSION,
    // Senza questo header il browser blocca la richiesta per CORS.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

/** Modelli disponibili per questa chiave, dal più recente. */
export async function listModels(creds: AiCredentials, fetchImpl: FetchLike = fetch): Promise<AiModel[]> {
  const res = await withTimeout(
    fetchImpl(`${API}/models?limit=50`, { method: 'GET', headers: headers(creds.apiKey) }),
    30_000,
  );
  const body = await readJson(res);
  if (!res.ok) throw apiError(res.status, body);
  const data = Array.isArray((body as { data?: unknown[] }).data) ? (body as { data: unknown[] }).data : [];
  return data
    .map((m) => {
      const row = m as { id?: string; display_name?: string; created_at?: string };
      return { id: String(row.id ?? ''), displayName: row.display_name, createdAt: row.created_at };
    })
    .filter((m) => m.id);
}

export interface AskOptions {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Riceve il testo mentre arriva, per non lasciare l'interfaccia immobile. */
  onChunk?: (text: string) => void;
  fetchImpl?: FetchLike;
}

/**
 * Una domanda, una risposta in testo.
 *
 * In streaming quando c'è un `onChunk`: un'analisi di 1500 parole richiede
 * decine di secondi, e un'attesa muta è indistinguibile da un blocco.
 */
export async function ask(creds: AiCredentials, opts: AskOptions): Promise<AiResult> {
  if (!creds.apiKey) throw new AiError('Nessuna chiave API configurata.');
  const model = creds.model;
  if (!model) throw new AiError('Nessun modello selezionato.');

  const fetchImpl = opts.fetchImpl ?? fetch;
  const stream = Boolean(opts.onChunk);
  const res = await withTimeout(
    fetchImpl(`${API}/messages`, {
      method: 'POST',
      headers: headers(creds.apiKey),
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 4096,
        system: opts.system,
        stream,
        messages: [{ role: 'user', content: opts.prompt }],
      }),
    }),
    TIMEOUT_MS,
  );

  if (!res.ok) throw apiError(res.status, await readJson(res));

  if (!stream) {
    const body = (await readJson(res)) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    return {
      text: (body.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join(''),
      model: body.model ?? model,
      usage: { inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens },
    };
  }

  return readStream(res, model, opts.onChunk!);
}

/**
 * Legge un flusso di eventi SSE.
 *
 * Scritto a mano invece di usare una libreria per lo stesso motivo del resto del
 * progetto: sono quaranta righe e la dipendenza dovrebbe funzionare su tre
 * piattaforme. L'unica insidia è che un evento può arrivare spezzato a metà fra
 * due blocchi di rete, quindi il resto incompleto va conservato.
 */
async function readStream(res: Response, model: string, onChunk: (t: string) => void): Promise<AiResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new AiError('Risposta senza corpo.');
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const usage: AiUsage = {};

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // L'ultima riga può essere incompleta: resta nel buffer.
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      const type = event.type;
      if (type === 'content_block_delta') {
        const delta = event.delta as { type?: string; text?: string } | undefined;
        if (delta?.type === 'text_delta' && delta.text) {
          text += delta.text;
          onChunk(text);
        }
      } else if (type === 'message_start') {
        const message = event.message as { usage?: { input_tokens?: number } } | undefined;
        usage.inputTokens = message?.usage?.input_tokens;
      } else if (type === 'message_delta') {
        const u = event.usage as { output_tokens?: number } | undefined;
        usage.outputTokens = u?.output_tokens;
      } else if (type === 'error') {
        const err = event.error as { message?: string } | undefined;
        throw new AiError(err?.message ?? 'Errore durante la generazione.');
      }
    }
  }
  return { text, model, usage };
}

/** Verifica la chiave senza consumare token: chiede solo l'elenco dei modelli. */
export async function testKey(
  creds: AiCredentials,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true; models: AiModel[] } | { ok: false; error: string }> {
  try {
    const models = await listModels(creds, fetchImpl);
    if (!models.length) return { ok: false, error: 'La chiave è valida ma non dichiara nessun modello.' };
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/** Messaggi utili al posto di quelli dell'API. */
function apiError(status: number, body: unknown): AiError {
  const detail = (body as { error?: { message?: string }; raw?: string } | null)?.error?.message;
  if (status === 401) return new AiError('Chiave API non valida o revocata.', status);
  if (status === 403) return new AiError('Chiave senza permessi su questo modello.', status);
  if (status === 429) {
    return new AiError('Limite di richieste raggiunto: riprova fra qualche minuto.', status);
  }
  if (status === 400 && detail?.includes('credit')) {
    return new AiError('Credito insufficiente sull’account Anthropic.', status);
  }
  if (status >= 500) return new AiError(`L'API ha risposto ${status}: riprova.`, status);
  return new AiError(detail ?? `L'API ha risposto ${status}.`, status);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AiError(`Nessuna risposta entro ${Math.round(ms / 1000)} secondi.`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
