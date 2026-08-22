/**
 * Il Worker visto dalla porta d'ingresso: che cosa risponde, a chi, e quando si
 * rifiuta di lavorare.
 *
 * PERCHÉ QUESTO FILE NASCE ADESSO. Finché l'accesso era per una persona sola,
 * quello che stava davanti alle tre rotte non contava: nessuno le raggiungeva.
 * Da quando l'applicazione può finire in mano ad altri, `/accesso` è una porta
 * su Internet che a ogni chiamata parla con Google e può creare un database — e
 * il modo in cui si difende va provato, non sperato.
 *
 * Le rotte non vengono percorse fino in fondo: per quello ci sono
 * `serverTurso`, `identita` e `sessione`. Qui si guarda il perimetro.
 */

import { afterEach, describe, expect, it } from 'vitest';
import worker, { type Ambiente } from '../server/worker';
import { conta, type EsitoLimite, type SpazioLimiti } from '../server/limite';

/**
 * Uno spazio di contatori finto: risponde sempre allo stesso modo e annota quali
 * chiavi gli sono state chieste.
 *
 * L'oggetto vero — un Durable Object — non si può montare in un test unitario, e
 * non serve: quello che deve valere qui è che la rotta CHIEDA, che chieda con la
 * chiave giusta, e che si fermi quando la risposta è no. Il conteggio in sé è
 * provato a parte, su `conta`.
 */
function contatori(consente: boolean) {
  const chiavi: string[] = [];
  const spazio: SpazioLimiti = {
    idFromName: (nome) => nome,
    get: (id) => ({
      fetch: async () => {
        chiavi.push(String(id));
        const esito: EsitoLimite = { consentito: consente, riprovaFraS: consente ? 0 : 37 };
        return new Response(JSON.stringify(esito));
      },
    }),
  };
  return { spazio, chiavi };
}

/*
 * `fetch` globale sostituito e RIMESSO A POSTO dopo ogni prova.
 *
 * Senza il ripristino ogni chiamata avvolgerebbe la precedente, e dopo dieci
 * prove il contatore direbbe dieci dove è passata una richiesta sola: un test
 * che si rompe da solo, e nel modo peggiore — continuando a passare.
 */
const fetchVero = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchVero;
});

function ambiente(consente = true): { env: Ambiente; reteUsata: () => number } {
  let usi = 0;
  const env: Ambiente = {
    SESSION_KEY: 'chiave-di-prova-lunga-abbastanza',
    TURSO_API_TOKEN: 'token-di-prova',
    TURSO_ORG: 'org',
    TURSO_GROUP: 'gruppo',
    APPLE_CLIENT_ID: 'it.esempio.app',
    GOOGLE_CLIENT_ID: 'ios.apps.googleusercontent.com,desktop.apps.googleusercontent.com',
    GOOGLE_CLIENT_DESKTOP: 'desktop.apps.googleusercontent.com',
    GOOGLE_SEGRETO_DESKTOP: 'segreto',
    LIMITI: contatori(consente).spazio,
  };
  // Se una rotta respinta parlasse comunque con Google, questo contatore lo
  // direbbe: è il difetto che rende inutile un limite di frequenza.
  globalThis.fetch = (async (...a: Parameters<typeof fetch>) => {
    usi++;
    return fetchVero(...a);
  }) as typeof fetch;
  return { env, reteUsata: () => usi };
}

const accesso = (corpo: unknown, ip = '203.0.113.7') =>
  new Request('https://servizio.example/accesso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(corpo),
  });

describe('il limite di frequenza', () => {
  it('oltre il limite risponde 429 e dice QUANDO riprovare', async () => {
    const { env } = ambiente(false);
    const risposta = await worker.fetch(accesso({ provider: 'google' }), env);

    expect(risposta.status).toBe(429);
    // Il tempo vero che manca alla riapertura, non un numero fisso: chi lo legge
    // aspetta esattamente quello invece di riprovare a caso.
    expect(risposta.headers.get('Retry-After')).toBe('37');
    /*
     * Questo messaggio, a differenza di tutti gli altri del Worker, dice
     * esattamente cosa è successo. Non c'è niente da indovinare in «hai
     * chiamato troppo», e chi ha esagerato per sbaglio deve poter capire.
     */
    expect(await risposta.json()).toEqual({ errore: 'troppe richieste: riprova fra 37 secondi' });
  });

  it('IL LIMITE VIENE PRIMA di qualunque chiamata verso l’esterno', async () => {
    /*
     * L'invariante che rende utile tutto il resto. Se il controllo stesse dopo
     * la lettura del corpo e dopo lo scambio del codice, ogni tentativo respinto
     * avrebbe comunque fatto partire una richiesta verso Google — cioè avrebbe
     * pagato esattamente il costo da cui ci si vuole proteggere, e un limite che
     * non risparmia niente non è un limite.
     */
    const { env, reteUsata } = ambiente(false);
    await worker.fetch(
      accesso({
        provider: 'google',
        clientId: 'ios.apps.googleusercontent.com',
        codice: 'c',
        verificatore: 'v',
        ritorno: 'http://127.0.0.1:1/accesso',
      }),
      env,
    );
    expect(reteUsata()).toBe(0);
  });

  it('conta per indirizzo di chi chiama, non per tutti insieme', async () => {
    // Un contatore unico farebbe spegnere il servizio a tutti nel momento in cui
    // uno solo esagera: il limite deve colpire chi lo supera.
    const { spazio, chiavi } = contatori(true);
    const { env } = ambiente();
    env.LIMITI = spazio;

    await worker.fetch(accesso({}, '198.51.100.1'), env);
    await worker.fetch(accesso({}, '198.51.100.2'), env);
    expect(chiavi).toEqual(['accesso:198.51.100.1', 'accesso:198.51.100.2']);
  });

  it('senza indirizzo si limita comunque, invece di lasciar passare', async () => {
    // Nel dubbio si stringe. Una chiave assente non deve diventare un varco.
    const { spazio, chiavi } = contatori(true);
    const { env } = ambiente();
    env.LIMITI = spazio;

    await worker.fetch(new Request('https://servizio.example/accesso', { method: 'POST', body: '{}' }), env);
    expect(chiavi).toEqual(['accesso:sconosciuto']);
  });

  it('le due rotte NON condividono il contatore', async () => {
    /*
     * Senza ambiti separati, un dispositivo che rinnova spesso la chiave
     * consumerebbe il tetto dell'accesso — e la persona si troverebbe a non
     * poter più entrare per colpa di una cosa che l'app fa da sola.
     */
    const { spazio, chiavi } = contatori(true);
    const { env } = ambiente();
    env.LIMITI = spazio;

    await worker.fetch(accesso({}, '198.51.100.9'), env);
    await worker.fetch(
      new Request('https://servizio.example/chiave', {
        method: 'POST',
        headers: { Authorization: 'Bearer x', 'CF-Connecting-IP': '198.51.100.9' },
      }),
      env,
    );
    expect(chiavi).toEqual(['accesso:198.51.100.9', 'chiave:198.51.100.9']);
  });

  it('anche il rinnovo della chiave ha il suo limite', async () => {
    const { env } = ambiente(false);
    const risposta = await worker.fetch(
      new Request('https://servizio.example/chiave', {
        method: 'POST',
        headers: { Authorization: 'Bearer qualcosa' },
      }),
      env,
    );
    expect(risposta.status).toBe(429);
  });
});

describe('il conteggio, che è la parte che può sbagliare', () => {
  /*
   * Queste righe esistono perché il limitatore NATIVO di Cloudflare è stato
   * provato e non ha fermato niente: con un tetto dichiarato di dieci al minuto,
   * trentatré richieste dallo stesso indirizzo nello stesso minuto sono passate
   * tutte. Sta scritto nella sua documentazione — «volutamente non pensata come
   * sistema di conteggio accurato» — e per difendere una rotta che chiama Google
   * e crea database è la cosa sbagliata.
   *
   * Da qui in giù si conta in casa, e lo si prova.
   */
  it('passa fino al tetto, e alla richiesta dopo no', () => {
    const stato = { fino: 0, conteggio: 0 };
    const esiti = Array.from({ length: 12 }, () => conta(stato, 1_000_000, 10, 60).consentito);
    expect(esiti.filter(Boolean).length).toBe(10);
    expect(esiti.slice(10)).toEqual([false, false]);
  });

  it('la finestra si riapre, e riparte da zero', () => {
    const stato = { fino: 0, conteggio: 0 };
    for (let i = 0; i < 15; i++) conta(stato, 1_000_000, 10, 60);
    expect(conta(stato, 1_000_000, 10, 60).consentito).toBe(false);
    // Un minuto e un istante dopo: finestra nuova.
    expect(conta(stato, 1_061_001, 10, 60).consentito).toBe(true);
  });

  it('dice quanto manca, e non dice mai zero', () => {
    /*
     * Un `Retry-After: 0` è un invito a riprovare subito, cioè il contrario di
     * quello che serve. All'ultimo istante della finestra il resto arrotondato
     * varrebbe zero: il minimo di un secondo è lì per quello.
     */
    const stato = { fino: 0, conteggio: 0 };
    conta(stato, 1_000_000, 10, 60);
    expect(conta(stato, 1_059_999, 10, 60).riprovaFraS).toBeGreaterThanOrEqual(1);
    expect(conta(stato, 1_030_000, 10, 60).riprovaFraS).toBe(30);
  });

  it('due chiavi diverse non si disturbano', () => {
    // Ogni chiave ha il suo oggetto e quindi il suo stato: qui si verifica che
    // il conteggio dipenda solo dallo stato che gli viene passato.
    const a = { fino: 0, conteggio: 0 };
    const b = { fino: 0, conteggio: 0 };
    for (let i = 0; i < 20; i++) conta(a, 1_000_000, 10, 60);
    expect(conta(b, 1_000_000, 10, 60).consentito).toBe(true);
  });
});

describe('il perimetro delle rotte', () => {
  it('una richiesta incompleta è 400, e non arriva a nessuno', async () => {
    const { env, reteUsata } = ambiente();
    const risposta = await worker.fetch(accesso({ provider: 'google' }), env);
    expect(risposta.status).toBe(400);
    expect(reteUsata()).toBe(0);
  });

  it('UN CLIENT CHE NON È NOSTRO viene respinto prima dello scambio', async () => {
    /*
     * Senza questo controllo, chiunque potrebbe far scambiare al Worker un
     * codice ottenuto per un'applicazione qualunque, e presentarsi con
     * un'identità verificata da Google ma emessa per qualcun altro.
     */
    const { env, reteUsata } = ambiente();
    const risposta = await worker.fetch(
      accesso({
        provider: 'google',
        clientId: 'app-di-un-altro.apps.googleusercontent.com',
        codice: 'c',
        verificatore: 'v',
        ritorno: 'http://127.0.0.1:1/accesso',
      }),
      env,
    );
    expect(risposta.status).toBe(401);
    expect(reteUsata()).toBe(0);
  });

  it('Apple non è attiva, e lo dice con un 400 e non con un guasto', async () => {
    const { env } = ambiente();
    const risposta = await worker.fetch(accesso({ provider: 'apple', idToken: 'x' }), env);
    expect(risposta.status).toBe(400);
  });

  it('una sessione inventata non apre niente', async () => {
    const { env } = ambiente();
    const risposta = await worker.fetch(
      new Request('https://servizio.example/chiave', {
        method: 'POST',
        headers: { Authorization: 'Bearer non-una-sessione' },
      }),
      env,
    );
    expect(risposta.status).toBe(401);
  });

  it('una rotta che non esiste è 404, non 500', async () => {
    const { env } = ambiente();
    const risposta = await worker.fetch(new Request('https://servizio.example/altro'), env);
    expect(risposta.status).toBe(404);
  });

  it('il volo di prova del browser passa senza toccare niente', async () => {
    const { env } = ambiente();
    const risposta = await worker.fetch(
      new Request('https://servizio.example/accesso', { method: 'OPTIONS' }),
      env,
    );
    expect(risposta.status).toBe(204);
    expect(risposta.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});
