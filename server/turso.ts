/**
 * La Platform API di Turso: creare il database di un utente, e firmargli token
 * che valgono poco e solo per il suo.
 *
 * IL PUNTO DI TUTTO IL SERVIZIO STA QUI. L'isolamento fra utenti non è una
 * clausola `WHERE` che qualcuno può dimenticare in una query: è il fatto che il
 * token consegnato all'app apre **un database e nessun altro**. Anche se il
 * token sfugge, anche se l'app viene manomessa, anche se una nostra rotta ha un
 * difetto, quello che si raggiunge è l'archivio di una persona sola. Con un
 * database unico e una colonna «proprietario», ogni filtro dimenticato in
 * qualunque punto del codice sarebbe una fuga di dati fra utenti.
 *
 * LE DUE DURATE, che vanno tenute distinte. Il token di sessione dura settimane
 * e sta nel portachiavi; il token del database dura ORE e sta in memoria. Se il
 * secondo durasse quanto il primo non avremmo guadagnato niente rispetto a
 * incollare a mano un token eterno, che è la situazione da cui veniamo.
 *
 * IL SEGRETO CHE NON DEVE MAI USCIRE è `apiToken`: è il token dell'ORGANIZZAZIONE,
 * e chi ce l'ha crea, legge e cancella i database di tutti. Vive solo fra i
 * segreti del Worker, non viene mai restituito a nessuno, e non compare in
 * nessun messaggio d'errore — vedi `errore()` in fondo.
 */

/**
 * Quanto vale un token del database consegnato all'app.
 *
 * Due forme dello stesso numero: Turso vuole la durata scritta come «2h», il
 * lato TypeScript ha bisogno dei secondi per sapere quando rinnovare. Stanno una
 * accanto all'altra perché se divergono il sintomo è pessimo — l'app crede di
 * avere ancora tempo e si ritrova con un token già scaduto a metà
 * sincronizzazione — e un test le confronta.
 */
export const DURATA_TOKEN_DB = '2h';
export const DURATA_TOKEN_DB_S = 2 * 3600;

export interface ConfigurazioneTurso {
  organizzazione: string;
  gruppo: string;
  apiToken: string;
  /** Iniettabile per i test: qui non si parla con la rete vera. */
  fetchImpl?: typeof fetch;
}

export interface DatabaseUtente {
  nome: string;
  /** `libsql://…`, cioè quello che l'app passa a `connect()`. */
  url: string;
}

const BASE = 'https://api.turso.tech/v1';

/**
 * Il nome del database di un utente.
 *
 * Deve stare nelle regole di Turso — minuscole, cifre e trattini, non più di 64
 * caratteri — e non deve raccontare niente di chi ci sta dentro: l'identificativo
 * che riceve è già un'impronta, non un'email e non il `sub` del fornitore.
 */
export function nomeDatabase(utente: string): string {
  return `mdl-${utente.toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, 64);
}

async function chiama(
  cfg: ConfigurazioneTurso,
  metodo: string,
  percorso: string,
  corpo?: unknown,
): Promise<{ ok: boolean; stato: number; dati: Record<string, unknown> }> {
  const f = cfg.fetchImpl ?? fetch;
  const risposta = await f(`${BASE}${percorso}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${cfg.apiToken}`,
      ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
  let dati: Record<string, unknown> = {};
  try {
    dati = (await risposta.json()) as Record<string, unknown>;
  } catch {
    // Una risposta senza corpo non è un guasto: il DELETE ne ha uno minimo e
    // qualche errore di rete non ne ha affatto.
  }
  return { ok: risposta.ok, stato: risposta.status, dati };
}

/**
 * Il database dell'utente, creandolo se non c'è.
 *
 * IDEMPOTENTE DI PROPOSITO. Il primo accesso da un secondo dispositivo, un
 * accesso ripetuto perché la rete è caduta a metà, un utente che tocca due volte
 * il pulsante: tutti finiscono qui. Turso risponde con un conflitto se il nome
 * esiste già, e quel conflitto **è il risultato voluto**, non un errore — il
 * database c'è, che è quello che il chiamante voleva sapere. Trattarlo come
 * guasto significherebbe che al secondo accesso l'app dice «non è stato
 * possibile accedere» a una persona che ha tutto a posto.
 */
export async function assicuraDatabase(cfg: ConfigurazioneTurso, utente: string): Promise<DatabaseUtente> {
  const nome = nomeDatabase(utente);
  const creazione = await chiama(cfg, 'POST', `/organizations/${cfg.organizzazione}/databases`, {
    name: nome,
    group: cfg.gruppo,
  });

  if (creazione.ok) {
    const db = creazione.dati.database as { Hostname?: string } | undefined;
    if (db?.Hostname) return { nome, url: `libsql://${db.Hostname}` };
  }

  // Esisteva già (409), oppure la creazione è andata bene ma la risposta non
  // portava il nome host: in entrambi i casi si chiede.
  const lettura = await chiama(cfg, 'GET', `/organizations/${cfg.organizzazione}/databases/${nome}`);
  const db = lettura.dati.database as { Hostname?: string } | undefined;
  if (lettura.ok && db?.Hostname) return { nome, url: `libsql://${db.Hostname}` };

  /*
   * Qui la creazione è fallita E il database non esiste. È il caso di cui non
   * ci si accorge finché non arriva: **l'organizzazione ha esaurito i database
   * che il piano permette**. Il piano gratuito di Turso ne dà cento, e il
   * centunesimo utente riceverebbe un errore generico dopo aver fatto tutto il
   * giro dell'accesso, senza che nessuno sappia perché.
   *
   * Si distingue con un tipo suo perché è l'unico errore di questo file a cui il
   * chiamante può rispondere qualcosa di sensato: non «riprova», che non
   * servirebbe a niente, ma «il servizio è pieno, scrivi al titolare».
   */
  throw new ArchivioNonCreato(creazione.stato || lettura.stato);
}

/**
 * Non è stato possibile creare l'archivio, e non ce n'era già uno.
 *
 * Un tipo e non un messaggio perché i messaggi si riscrivono e si traducono,
 * mentre chi deve decidere che risposta dare a chi chiama ha bisogno di
 * riconoscere il caso, non di leggerlo.
 */
export class ArchivioNonCreato extends Error {
  constructor(readonly stato: number) {
    super(`Turso: archivio non creato (HTTP ${stato})`);
    this.name = 'ArchivioNonCreato';
  }
}

/**
 * Un token per QUEL database, che scade fra due ore.
 *
 * `full-access` e non `read-only` perché l'app deve poter scrivere: la
 * sincronizzazione carica le immersioni nuove. Il limite non è nei permessi, è
 * nel perimetro — quel token non nomina nessun altro database.
 */
export async function tokenDatabase(cfg: ConfigurazioneTurso, nome: string): Promise<string> {
  const risposta = await chiama(
    cfg,
    'POST',
    `/organizations/${cfg.organizzazione}/databases/${nome}/auth/tokens` +
      `?expiration=${DURATA_TOKEN_DB}&authorization=full-access`,
  );
  const jwt = risposta.dati.jwt;
  if (!risposta.ok || typeof jwt !== 'string' || !jwt) {
    throw errore('token non emesso', risposta.stato);
  }
  return jwt;
}

/**
 * Cancella il database di un utente.
 *
 * Non è una comodità: chi tiene i dati di altri deve poterli cancellare davvero
 * quando gli viene chiesto, e l'App Store lo pretende dentro l'applicazione. Un
 * database che non c'è più conta come cancellato — l'errore 404 qui è il
 * risultato voluto, non un guasto, perché la richiesta era «fai che non ci sia».
 */
export async function cancellaDatabase(cfg: ConfigurazioneTurso, nome: string): Promise<void> {
  const risposta = await chiama(cfg, 'DELETE', `/organizations/${cfg.organizzazione}/databases/${nome}`);
  if (!risposta.ok && risposta.stato !== 404) throw errore('cancellazione fallita', risposta.stato);
}

/**
 * Un errore che si può registrare e mostrare senza pentirsene.
 *
 * Il messaggio dice cosa non è riuscito e con quale stato HTTP, e **mai** il
 * corpo della risposta di Turso: quello può contenere il nome
 * dell'organizzazione, dettagli del piano, e in qualche caso frammenti della
 * richiesta — cioè il token. Un messaggio d'errore che finisce in un registro
 * condiviso è il modo più tranquillo di far uscire un segreto.
 */
function errore(cosa: string, stato: number): Error {
  return new Error(`Turso: ${cosa} (HTTP ${stato})`);
}
