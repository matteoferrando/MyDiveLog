/**
 * Lo scambio del codice con Apple, e le due cose che lo rendono diverso da
 * Google: un segreto che non esiste finché non lo firmiamo noi, e un ritorno che
 * arriva qui invece che nell'app.
 *
 * PERCHÉ ESISTE. La linea guida 4.8 dell'App Store dice che un'applicazione che
 * offre l'accesso con Google deve offrire anche Sign in with Apple. Non è una
 * preferenza: senza, l'app non passa la revisione. Il resto di questo file è
 * quello che Apple pretende in cambio.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. IL SEGRETO DEL CLIENT SI FIRMA A OGNI RICHIESTA, E NON SI CONSERVA.
 *
 * Google dà una password: la carichi una volta fra i segreti e finisce lì. Apple
 * no. Apple dà una **chiave privata** (il file `.p8`, scaricabile una volta sola
 * dal portale) e pretende che il `client_secret` sia un JWT ES256 che firmi tu,
 * con dentro il tuo Team ID, il tuo Services ID e una scadenza che per
 * regolamento non può superare i sei mesi.
 *
 * Ci sono due modi di stare a queste regole:
 *
 *   a. firmarne uno a mano, incollarlo fra i segreti, e mettersi in calendario
 *      un promemoria ogni sei mesi. Il giorno che quel promemoria viene
 *      rimandato, l'accesso smette di funzionare per tutti — e il sintomo è un
 *      401 di Apple che non nomina la scadenza;
 *   b. firmarlo **al volo**, valido cinque minuti, dentro la richiesta che lo
 *      usa. La chiave privata resta l'unico segreto da custodire, non scade, e
 *      la scadenza da ricordare semplicemente non esiste più.
 *
 * Qui si fa (b), ed è la ragione per cui in questo progetto non c'è nessuna data
 * segnata da qualche parte. Cinque minuti e non un giorno perché il segreto vive
 * il tempo di una chiamata: più a lungo vale, più a lungo vale per chi lo
 * intercettasse.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. LA FIRMA DI WEBCRYPTO È GIÀ NEL FORMATO CHE SERVE. NON CONVERTIRLA.
 *
 * Questo è l'errore che costa un pomeriggio, quindi sta scritto qui.
 *
 * ES256 di JWS vuole la firma come **r‖s grezzi**: due interi da 32 byte,
 * concatenati, 64 byte in tutto. Le librerie del mondo OpenSSL — e quindi buona
 * parte del codice che si trova in giro — producono invece una struttura **DER**
 * (`SEQUENCE { INTEGER r, INTEGER s }`), di lunghezza variabile, e devono
 * convertirla. `crypto.subtle.sign` con `ECDSA` restituisce **già** r‖s grezzi:
 * lo dice la specifica Web Cryptography. Aggiungere una conversione da DER
 * significa smontare byte che non sono DER, e il risultato è un
 * `invalid_client` da Apple che non spiega niente.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 3. APPLE NON SUPPORTA PKCE NEL GIRO WEB.
 *
 * Con Google il codice è legato a chi ha iniziato il giro da un verificatore che
 * l'app tiene per sé. Con Apple quel meccanismo non c'è: `code_challenge` non è
 * fra i parametri accettati dal giro web, e mandarlo non fa niente. Quindi va
 * detto esplicitamente su cosa poggia la sicurezza qui, invece di lasciare il
 * dubbio a chi legge:
 *
 *   - **il segreto**, che è l'unica cosa senza la quale il codice non si
 *     scambia, e che vive SOLO qui dentro. Un codice intercettato sul
 *     dispositivo non basta a nessuno: manca la chiave `.p8`, che sta fra i
 *     segreti di Cloudflare e non è mai stata sul telefono di nessuno;
 *   - **lo `state`**, generato dall'app e riconfrontato dall'app al ritorno. È
 *     quello che impedisce a un codice ottenuto altrove di essere infilato nel
 *     giro di qualcun altro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 4. APPLE RISPONDE CON UN POST, NON CON UN REDIRECT — e da lì nasce il resto.
 *
 * Chiedendo `scope=name email` Apple pretende `response_mode=form_post`: invece
 * di rimandare il browser al punto di ritorno con i parametri in coda
 * all'indirizzo, manda una **POST** `application/x-www-form-urlencoded` con
 * `code`, `state` e — solo la primissima volta che quella persona autorizza
 * questa app — un campo `user` col nome e l'email.
 *
 * Una POST non si può mandare a `mydivelog://` né a una porta su `127.0.0.1`:
 * il punto di ritorno registrato deve essere un indirizzo `https` vero. Quindi
 * il Return URL è **questo Worker**, che riceve la POST e rimbalza il browser
 * verso l'app. Il rimbalzo è il pezzo delicato: vedi `destinazionePermessa`.
 */

/** Dove si scambia il codice. */
const SCAMBIA = 'https://appleid.apple.com/auth/token';

/**
 * Il destinatario del segreto del client: Apple, sempre, senza barra finale.
 *
 * Non è il nostro Services ID — quello è il `sub`. Chi li scambia ottiene un
 * `invalid_client` che non dice quale dei due campi è sbagliato.
 */
const PUBBLICO_SEGRETO = 'https://appleid.apple.com';

/**
 * Quanto vale il segreto firmato. Cinque minuti.
 *
 * Il massimo consentito da Apple è sei mesi; il minimo utile è il tempo di una
 * chiamata. Si sceglie il minimo utile, con un margine largo per un orologio che
 * non sia perfettamente in orario.
 */
export const DURATA_SEGRETO_S = 300;

/** Quello che serve per firmare, tutto pubblico tranne l'ultimo campo. */
export interface ChiaveSviluppatoreApple {
  /**
   * Il **Services ID**, non il bundle id.
   *
   * È il `client_id` del giro web, l'identificativo che si registra sul portale
   * sotto «Services IDs» insieme al Return URL. Il bundle id vale per il giro
   * nativo (`ASAuthorization`), che qui non si usa. Sono due stringhe simili e
   * non intercambiabili: scambiarle dà `invalid_client`.
   */
  servicesId: string;
  /** Il Team ID dello sviluppatore: finisce in `iss`. */
  teamId: string;
  /** L'identificativo della chiave `.p8`: finisce in `kid`, non nel corpo. */
  keyId: string;
  /**
   * Il contenuto del file `.p8`, con o senza le righe `-----BEGIN…`.
   *
   * È l'unico vero segreto di questo file. Sta fra i segreti di Cloudflare
   * (`npx wrangler secret put APPLE_CHIAVE_P8`), non nel repository e non nel
   * pacchetto dell'applicazione. Apple lo lascia scaricare **una volta sola**:
   * perso, si revoca e se ne fa un altro.
   */
  chiaveP8: string;
}

function base64url(byte: Uint8Array): string {
  let s = '';
  for (const b of byte) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function byteDaBase64(testo: string): Uint8Array<ArrayBuffer> {
  const grezzo = atob(testo);
  // `new ArrayBuffer(...)` esplicito, come in `identita.ts`: il tipo che
  // `crypto.subtle` accetta è quello appoggiato a un ArrayBuffer vero.
  const out = new Uint8Array(new ArrayBuffer(grezzo.length));
  for (let i = 0; i < grezzo.length; i++) out[i] = grezzo.charCodeAt(i);
  return out;
}

/**
 * Dal file `.p8` a una chiave che `crypto.subtle` sa usare.
 *
 * Il `.p8` di Apple è una chiave **PKCS#8** su curva **P-256**, in PEM. Del PEM
 * si butta via tutto tranne il base64: le righe `BEGIN`/`END`, gli a-capo, e
 * ogni spazio che ci si è infilato passando dal pannello dei segreti — quello è
 * il dettaglio che rompe le cose senza dirlo, perché un segreto incollato con un
 * a-capo in più è indistinguibile a occhio da uno pulito.
 */
async function importaChiaveP8(p8: string): Promise<CryptoKey> {
  const soloBase64 = p8
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  return crypto.subtle.importKey(
    'pkcs8',
    byteDaBase64(soloBase64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/**
 * Il `client_secret` per Apple: un JWT ES256 firmato adesso, valido cinque minuti.
 *
 * Le rivendicazioni, e cosa sono davvero:
 *
 * | campo | valore | perché |
 * |---|---|---|
 * | `iss` | Team ID | chi firma |
 * | `sub` | Services ID | per quale client vale |
 * | `aud` | `https://appleid.apple.com` | a chi si presenta |
 * | `iat`/`exp` | adesso, adesso+300 | la scadenza che sparisce dal calendario |
 *
 * Il `kid` sta nell'intestazione e non nel corpo: è così che Apple sa quale
 * delle chiavi del team deve usare per verificare.
 */
export async function segretoClientApple(
  chiave: ChiaveSviluppatoreApple,
  adessoS: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const testa = base64url(
    new TextEncoder().encode(JSON.stringify({ alg: 'ES256', kid: chiave.keyId, typ: 'JWT' })),
  );
  const corpo = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: chiave.teamId,
        iat: adessoS,
        exp: adessoS + DURATA_SEGRETO_S,
        aud: PUBBLICO_SEGRETO,
        sub: chiave.servicesId,
      }),
    ),
  );

  const firma = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await importaChiaveP8(chiave.chiaveP8),
    new TextEncoder().encode(`${testa}.${corpo}`),
  );

  /*
   * Nessuna conversione da DER. Vedi il punto 2 in testa al file: quello che
   * `crypto.subtle` restituisce per ECDSA è GIÀ r‖s grezzo, cioè esattamente
   * quello che ES256 vuole. Una conversione qui sarebbe un `invalid_client`.
   */
  return `${testa}.${corpo}.${base64url(new Uint8Array(firma))}`;
}

export interface RichiestaScambioApple {
  /** Il Services ID: lo stesso che sta in `sub` dentro il segreto. */
  clientId: string;
  /** Il JWT appena firmato da `segretoClientApple`. */
  segreto: string;
  codice: string;
  /**
   * Il Return URL **registrato sul portale**, non la destinazione dentro l'app.
   *
   * Apple lo riconfronta con quello della prima richiesta e rifiuta se differisce
   * di un carattere. È il Worker, non `mydivelog://…`: vedi il punto 4 in testa
   * al file.
   */
  ritorno: string;
}

/**
 * Restituisce il token d'identità, o `null` se Apple non lo dà.
 *
 * Stessa forma di `scambiaCodiceGoogle`, e per la stessa ragione: il motivo per
 * cui uno scambio fallisce — codice già usato, segreto scaduto, client che non
 * combacia — è utile a chi sta provando a indovinare e inutile a chi ha
 * semplicemente aspettato troppo. Il dettaglio finisce nel registro del Worker,
 * che non esce da qui.
 */
export async function scambiaCodiceApple(
  richiesta: RichiestaScambioApple,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const corpo = new URLSearchParams({
    client_id: richiesta.clientId,
    client_secret: richiesta.segreto,
    code: richiesta.codice,
    grant_type: 'authorization_code',
    redirect_uri: richiesta.ritorno,
  });

  const risposta = await fetchImpl(SCAMBIA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo.toString(),
  });

  const dati = (await risposta.json().catch(() => ({}))) as { id_token?: unknown; error?: unknown };
  if (!risposta.ok) {
    console.error('scambio del codice Apple rifiutato', risposta.status, dati.error);
    return null;
  }
  /*
   * Si tiene SOLO l'`id_token`. Il `refresh_token` che Apple manda insieme
   * servirebbe a verificare più tardi che l'account esista ancora, e non lo
   * facciamo: sarebbe una credenziale conservata a lungo termine, e questo
   * servizio non conserva niente di nessuno — nemmeno una riga di utenti.
   */
  return typeof dati.id_token === 'string' && dati.id_token ? dati.id_token : null;
}

/**
 * ► LA RIGA DI SICUREZZA DI QUESTO FILE. ◄
 *
 * Il Worker riceve la POST di Apple e deve rimandare il browser dentro
 * l'applicazione. Dove, glielo dice lo `state`, cioè un valore che gli arriva da
 * fuori. Un Worker che rimanda il browser dove gli si dice è un **redirect
 * aperto**: si costruisce un indirizzo che comincia con `mydivelog.site`, un
 * dominio nostro e credibile, e si fa atterrare chi lo apre su un sito di
 * qualcun altro — con in coda, per giunta, un codice di autorizzazione.
 *
 * Quindi qui non si «pulisce» niente e non si segue niente per difetto: passano
 * **solo** due forme, che sono le due in cui l'applicazione può ricevere il
 * ritorno.
 *
 *   - `mydivelog://…`   — lo schema dell'app, su iPhone;
 *   - `http://127.0.0.1:<porta>/…` — l'ascoltatore locale, sul Mac.
 *
 * Tutto il resto si RIFIUTA con un errore. Non si segue, non si registra come
 * caso strano da guardare dopo, non si prova a correggere.
 *
 * Perché il confronto è su `URL` e non su `startsWith`: `startsWith('http://127.0.0.1')`
 * accetta `http://127.0.0.1@attaccante.example/`, che il browser interpreta come
 * l'host `attaccante.example` con `127.0.0.1` come nome utente. Analizzarlo con
 * `URL` e guardare `hostname` è l'unico confronto che vede la stessa cosa che
 * vedrà il browser.
 */
export function destinazionePermessa(destinazione: string): boolean {
  let indirizzo: URL;
  try {
    indirizzo = new URL(destinazione);
  } catch {
    return false;
  }
  if (indirizzo.protocol === 'mydivelog:') return true;
  // La porta è obbligatoria: l'ascoltatore ne apre una effimera, e `127.0.0.1`
  // senza porta vorrebbe dire la 80, che su un Mac nessuno di noi tiene aperta.
  return indirizzo.protocol === 'http:' && indirizzo.hostname === '127.0.0.1' && indirizzo.port !== '';
}

/**
 * La destinazione nascosta dentro lo `state`, o `null`.
 *
 * PERCHÉ LA DESTINAZIONE VIAGGIA NELLO `STATE` e non in un parametro suo. Perché
 * il Return URL è registrato sul portale di Apple carattere per carattere:
 * `https://mydivelog.site/accesso-apple/ritorno` e basta, senza query. Lo `state`
 * è l'unico campo che Apple accetta di trasportare e restituire intatto, quindi
 * è lì che si mette l'unica cosa che il Worker non può sapere da sé: su quale
 * porta, o con quale schema, l'app di QUESTO dispositivo sta aspettando.
 *
 * La forma è `<casuale>.<destinazione in base64url>`, e la costruisce
 * `src/sync/appleAccesso.ts`. Due file, un formato solo: la coppia è tenuta
 * insieme da un test che fa il giro completo, `tests/appleAccesso.test.ts`.
 *
 * Il pezzo casuale davanti resta quello che l'app riconfronta al ritorno, e
 * questa funzione non lo guarda nemmeno: qui interessa solo dove rimbalzare, e
 * il confronto sullo `state` intero è compito di chi l'ha generato.
 */
export function leggiDestinazioneDalloStato(stato: string): string | null {
  /*
   * SI TAGLIA SULL'ULTIMO PUNTO, e la differenza non è di stile.
   *
   * Il pezzo casuale davanti nasce da `casuale()`, che pesca dall'alfabeto
   * ammesso da PKCE — e quell'alfabeto **contiene il punto**. Su 32 caratteri, la
   * probabilità che almeno uno sia un punto è del 40%: tagliando sul PRIMO, due
   * accessi su cinque leggevano una destinazione troncata e finivano rifiutati,
   * senza nessuna regolarità visibile. La parte dietro è base64url, che il punto
   * non ce l'ha nel suo alfabeto: l'ultimo punto è quindi sempre il separatore.
   *
   * Preso dalla CI, non dalla prova in locale: la stessa suite era passata verde
   * qui sopra pochi minuti prima. È un difetto che si manifesta a caso, ed è la
   * ragione per cui il test qui sotto forza un pezzo casuale con i punti dentro
   * invece di sperare che capitino.
   */
  const punto = stato.lastIndexOf('.');
  if (punto <= 0 || punto === stato.length - 1) return null;
  try {
    const pieno = stato
      .slice(punto + 1)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    return new TextDecoder().decode(byteDaBase64(pieno + '='.repeat((4 - (pieno.length % 4)) % 4)));
  } catch {
    return null;
  }
}

/**
 * L'email dentro il campo `user`, quando c'è.
 *
 * APPLE LA MANDA UNA VOLTA SOLA NELLA VITA. Non «una volta per dispositivo» né
 * «finché non si revoca»: la primissima volta che quella persona autorizza
 * questa applicazione, dentro la POST di ritorno, e mai più. Chi non la prende
 * lì non la riavrà da nessuna parte.
 *
 * Può essere un indirizzo `@privaterelay.appleid.com`: è l'indirizzo di inoltro
 * che Apple crea per chi sceglie «Nascondi la mia email». È legittimo, funziona,
 * e si accetta come qualunque altro — trattarlo diversamente vorrebbe dire
 * punire chi usa una funzione che Apple offre apposta.
 */
export function emailDalCampoUtente(valore: unknown): string | null {
  if (typeof valore !== 'string' || !valore) return null;
  try {
    const dati = JSON.parse(valore) as { email?: unknown };
    return typeof dati.email === 'string' && dati.email ? dati.email : null;
  } catch {
    return null;
  }
}
