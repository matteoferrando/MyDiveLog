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
    APPLE_CLIENT_ID: 'it.esempio.app,it.esempio.app.accesso',
    APPLE_SERVICES_ID: 'it.esempio.app.accesso',
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_KEY_ID: 'KEY1234567',
    APPLE_RITORNO: 'https://esempio.example/accesso-apple/ritorno',
    // Una chiave che NON si importa, apposta: qui non si prova la firma — quella
    // sta in `serverApple.test.ts` con una P-256 vera — e ogni prova che
    // arrivasse a firmare vorrebbe dire che una difesa a monte non ha fermato
    // una richiesta che doveva fermare.
    APPLE_CHIAVE_P8: 'non-una-chiave',
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

  it('un fornitore che non conosciamo è 400, e non arriva a nessuno', async () => {
    const { env, reteUsata } = ambiente();
    const risposta = await worker.fetch(accesso({ provider: 'facebook', codice: 'c' }), env);
    expect(risposta.status).toBe(400);
    expect(reteUsata()).toBe(0);
  });

  it('Apple senza codice è 400, e NON arriva a firmare nessun segreto', async () => {
    /*
     * L'ordine conta: firmare il segreto vuol dire importare la chiave `.p8` e
     * fare crittografia, e una richiesta vuota non deve costare niente. Se il
     * controllo stesse dopo, questa prova esploderebbe — la chiave dell'ambiente
     * di prova non è importabile apposta — invece di rispondere 400.
     */
    const { env, reteUsata } = ambiente();
    const risposta = await worker.fetch(accesso({ provider: 'apple' }), env);
    expect(risposta.status).toBe(400);
    expect(reteUsata()).toBe(0);
  });

  it('Google senza verificatore è 400: PKCE lì non è facoltativo', async () => {
    // Con Apple non c'è, con Google sì, e i due rami non devono confondersi:
    // una richiesta Google senza verificatore non deve passare «perché tanto
    // adesso esiste un fornitore che non ne ha uno».
    const { env, reteUsata } = ambiente();
    const risposta = await worker.fetch(
      accesso({
        provider: 'google',
        clientId: 'ios.apps.googleusercontent.com',
        codice: 'c',
        ritorno: 'http://127.0.0.1:1/accesso',
      }),
      env,
    );
    expect(risposta.status).toBe(400);
    expect(reteUsata()).toBe(0);
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

/*
 * L'avvio dell'accesso con Apple: la rotta che apre il browser.
 *
 * Esiste per un guasto che non lasciava traccia da nessuna parte: aprendo
 * `appleid.apple.com` direttamente dall'applicazione, su iOS il browser si apre
 * sulla propria pagina iniziale e l'accesso finisce lì. Nessun errore, nessuna
 * pagina bianca, niente nel registro del Worker. Il dominio di Apple è quello
 * che iOS usa per il proprio «Accedi con Apple», e se lo prende il sistema.
 * Quindi l'app apre un indirizzo NOSTRO e il salto verso Apple lo fa un 302.
 */
describe('l’avvio dell’accesso con Apple', () => {
  const destinazione = 'mydivelog://accesso';

  function stato(dove = destinazione, casuale = 'nonce-1'): string {
    let grezzo = '';
    for (const b of new TextEncoder().encode(dove)) grezzo += String.fromCharCode(b);
    return `${casuale}.${btoa(grezzo).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  }

  const avvio = (query: string, ip = '203.0.113.9') =>
    new Request(`https://servizio.example/accesso-apple/vai${query}`, {
      headers: { 'CF-Connecting-IP': ip },
    });

  it('rimanda ad Apple con il Services ID, il Return URL e lo state intero', async () => {
    const { env } = ambiente();
    const s = stato();
    const risposta = await worker.fetch(avvio(`?state=${encodeURIComponent(s)}`), env);

    expect(risposta.status).toBe(302);
    const dove = new URL(risposta.headers.get('Location')!);
    expect(dove.origin + dove.pathname).toBe('https://appleid.apple.com/auth/authorize');
    expect(dove.searchParams.get('client_id')).toBe(env.APPLE_SERVICES_ID);
    expect(dove.searchParams.get('redirect_uri')).toBe(env.APPLE_RITORNO);
    expect(dove.searchParams.get('response_mode')).toBe('form_post');
    // Intero: è il pezzo che l'app riconfronta al ritorno.
    expect(dove.searchParams.get('state')).toBe(s);
  });

  it('senza state non manda nessuno da Apple', async () => {
    // Un giro che comincia senza `state` è un giro che al ritorno rifiuteremmo:
    // tanto vale fermarlo qui, dove si sa ancora cos'è successo.
    const { env } = ambiente();
    const risposta = await worker.fetch(avvio(''), env);
    expect(risposta.status).toBe(400);
    expect(risposta.headers.get('Location')).toBeNull();
  });

  it('con una destinazione che non seguiremmo non fa nemmeno partire il giro', async () => {
    const { env } = ambiente();
    for (const cattiva of ['https://attaccante.example/accesso', 'http://127.0.0.1/accesso']) {
      const risposta = await worker.fetch(avvio(`?state=${encodeURIComponent(stato(cattiva))}`), env);
      expect(risposta.status, cattiva).toBe(400);
      expect(risposta.headers.get('Location'), cattiva).toBeNull();
    }
  });

  it('uno state spropositato viene rifiutato invece che rimandato ad Apple', async () => {
    // Finirebbe dentro un'intestazione `Location`: quello che entra qui esce di
    // là, e una risposta lunga a piacere la deve digerire qualcun altro.
    const { env } = ambiente();
    const risposta = await worker.fetch(avvio(`?state=${'a'.repeat(2000)}`), env);
    expect(risposta.status).toBe(400);
  });
});

/**
 * Il ritorno di Apple: la rotta che il BROWSER chiama, non l'applicazione.
 *
 * Apple, quando le si chiedono nome ed email, risponde con una POST
 * `application/x-www-form-urlencoded` invece che con un redirect. Una POST non
 * si può mandare a `mydivelog://` né a una porta su `127.0.0.1`, quindi atterra
 * sul Worker, che rimbalza il browser dentro l'app.
 *
 * È la rotta più esposta del servizio: pubblica, senza sessione, e con dentro
 * una destinazione che arriva da fuori. Metà di queste prove sono lì per
 * verificare che quella destinazione non venga seguita quando non è nostra.
 */
describe('il ritorno di Apple', () => {
  const destinazione = 'http://127.0.0.1:51000/accesso';

  /** Lo `state` nella forma che l'app produce: `<casuale>.<destinazione>`. */
  function stato(dove = destinazione, casuale = 'nonce-1'): string {
    let grezzo = '';
    for (const b of new TextEncoder().encode(dove)) grezzo += String.fromCharCode(b);
    return `${casuale}.${btoa(grezzo).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  }

  const ritorno = (campi: Record<string, string>, ip = '203.0.113.7') =>
    new Request('https://servizio.example/accesso-apple/ritorno', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // È il browser a mandarla, per conto della pagina di Apple.
        Origin: 'https://appleid.apple.com',
        'CF-Connecting-IP': ip,
      },
      body: new URLSearchParams(campi).toString(),
    });

  it('rimbalza dove dice lo state, con il codice e lo state interi', async () => {
    const { env } = ambiente();
    const s = stato();
    const risposta = await worker.fetch(ritorno({ code: 'cod-1', state: s }), env);

    // 303 e non 302: la richiesta in arrivo è una POST, e l'app ascolta una GET.
    expect(risposta.status).toBe(303);
    const dove = new URL(risposta.headers.get('Location')!);
    expect(dove.origin + dove.pathname).toBe('http://127.0.0.1:51000/accesso');
    expect(dove.searchParams.get('code')).toBe('cod-1');
    // Intero: il pezzo che l'app riconfronta è tutto lo `state`, non una metà.
    expect(dove.searchParams.get('state')).toBe(s);
  });

  it('verso lo schema dell’app NON rimbalza: risponde con la pagina col pulsante', async () => {
    /*
     * ► La prova che tiene in piedi l'accesso su iPhone. ◄
     *
     * Un 303 verso `mydivelog://` i browser di iOS non lo seguono — è una
     * difesa loro, non un difetto nostro — e il modo in cui non lo seguono è
     * il peggiore che ci sia: pagina bianca, nessun errore da nessuna parte,
     * accesso morto in silenzio. Se qualcuno un giorno «semplifica» questa
     * riga rimettendo il 303 per tutti, il Mac continuerà a funzionare e
     * l'iPhone smetterà, senza che nessun altro test se ne accorga.
     */
    const { env } = ambiente();
    const risposta = await worker.fetch(ritorno({ code: 'cod-1', state: stato('mydivelog://accesso') }), env);

    expect(risposta.status).toBe(200);
    expect(risposta.headers.get('Location')).toBeNull();
    expect(risposta.headers.get('Content-Type')).toContain('text/html');
    // Il codice sta nella pagina: non deve finire in nessuna cache.
    expect(risposta.headers.get('Cache-Control')).toBe('no-store');

    const pagina = await risposta.text();
    // Il pulsante È il collegamento: senza `href` non c'è niente da toccare.
    expect(pagina).toContain('href="mydivelog://accesso?');
    expect(pagina).toContain('code=cod-1');
  });

  it('la pagina del rimbalzo non si lascia iniettare dello script', async () => {
    /*
     * Il codice lo scrive Apple, la destinazione la scrive il browser di chi
     * accede: nessuno dei due è nostro, e tutti e due finiscono dentro l'HTML.
     * Qui si passa un `code` che prova a chiudere l'attributo e ad aprire uno
     * script, e si pretende che nella pagina non ce ne sia traccia eseguibile.
     */
    const { env } = ambiente();
    const cattivo = '"><script>alert(1)</script>';
    const risposta = await worker.fetch(ritorno({ code: cattivo, state: stato('mydivelog://accesso') }), env);
    const pagina = await risposta.text();

    expect(pagina).not.toContain('<script>alert(1)</script>');
    expect(pagina).not.toContain('"><script');
    // E la CSP col nonce resta la rete sotto il trapezio.
    expect(risposta.headers.get('Content-Security-Policy')).toContain("script-src 'nonce-");
  });

  it('RIFIUTA `https://attaccante.example` invece di seguirlo', async () => {
    /*
     * ► La prova che questa rotta non è un redirect aperto. ◄
     *
     * Senza questo controllo si costruisce un indirizzo che comincia con un
     * dominio nostro e credibile, e chi lo apre atterra sul sito di qualcun
     * altro — con in coda un codice di autorizzazione. Non si segue, non si
     * corregge: si rifiuta.
     */
    const { env } = ambiente();
    for (const cattiva of [
      'https://attaccante.example',
      'https://attaccante.example/accesso',
      'http://127.0.0.1@attaccante.example/',
      'http://127.0.0.1/accesso',
    ]) {
      const risposta = await worker.fetch(ritorno({ code: 'cod-1', state: stato(cattiva) }), env);
      expect(risposta.status, cattiva).toBe(400);
      expect(risposta.headers.get('Location'), cattiva).toBeNull();
    }
  });

  it('senza state non rimbalza da nessuna parte', async () => {
    const { env } = ambiente();
    const risposta = await worker.fetch(ritorno({ code: 'cod-1' }), env);
    expect(risposta.status).toBe(400);
    expect(risposta.headers.get('Location')).toBeNull();
  });

  it('con una destinazione buona ma senza codice non rimbalza a vuoto', async () => {
    // Rimbalzare senza `code` porterebbe l'app a un errore generico dopo aver
    // riaperto la finestra: meglio fermarsi qui, dove si sa cosa è successo.
    const { env } = ambiente();
    const risposta = await worker.fetch(ritorno({ state: stato() }), env);
    expect(risposta.status).toBe(400);
  });

  it('inoltra il campo `user`, che arriva una volta sola nella vita', async () => {
    /*
     * Apple manda nome e indirizzo alla PRIMISSIMA autorizzazione e mai più. Se
     * non passa da questa riga, l'email non si riavrà da nessuna parte.
     */
    const { env } = ambiente();
    const utente = JSON.stringify({ email: 'tizio@privaterelay.appleid.com' });
    const risposta = await worker.fetch(ritorno({ code: 'c', state: stato(), user: utente }), env);
    expect(new URL(risposta.headers.get('Location')!).searchParams.get('user')).toBe(utente);
  });

  it('«ho annullato» torna all’app com’è, e non diventa un guasto qui', async () => {
    const { env } = ambiente();
    const risposta = await worker.fetch(ritorno({ error: 'user_cancelled_authorize', state: stato() }), env);
    expect(risposta.status).toBe(303);
    expect(new URL(risposta.headers.get('Location')!).searchParams.get('error')).toBe(
      'user_cancelled_authorize',
    );
  });

  it('anche questa rotta ha il limite di frequenza', async () => {
    // È pubblica e la raggiunge chiunque senza avere niente in mano: senza un
    // tetto sarebbe la rotta più facile da tempestare di tutto il servizio.
    const { env } = ambiente(false);
    const risposta = await worker.fetch(ritorno({ code: 'c', state: stato() }), env);
    expect(risposta.status).toBe(429);
  });

  it('NON viene fermata dal controllo di origine, che la spegnerebbe', async () => {
    /*
     * Il giorno che `ORIGINI_AMMESSE` verrà riempito con l'origine dell'app —
     * ed è scritto come da fare nel README — questa rotta si spegnerebbe con un
     * 403: la sua POST porta `Origin: https://appleid.apple.com`, che
     * nell'elenco non ci sarà mai. Il sintomo sarebbe «l'accesso con Apple non
     * torna più», senza nessuna riga che nomini le origini.
     */
    const { env } = ambiente();
    env.ORIGINI_AMMESSE = 'https://mydivelog.site';
    const risposta = await worker.fetch(ritorno({ code: 'c', state: stato() }), env);
    expect(risposta.status).toBe(303);
  });

  it('ma le ALTRE rotte il controllo di origine lo sentono ancora', async () => {
    // L'esenzione vale per un percorso solo: se allentasse tutto, sarebbe un
    // buco aperto per comodità.
    const { env } = ambiente();
    env.ORIGINI_AMMESSE = 'https://mydivelog.site';
    const richiesta = new Request('https://servizio.example/accesso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://appleid.apple.com' },
      body: '{}',
    });
    expect((await worker.fetch(richiesta, env)).status).toBe(403);
  });
});
