/**
 * Il servizio che autentica e consegna le chiavi del proprio database.
 *
 * TRE ROTTE, E NIENT'ALTRO. Non è un'API sopra le immersioni: le immersioni
 * continuano a viaggiare direttamente fra l'app e il database, con lo stesso
 * motore di sincronizzazione di sempre. Questo servizio dice soltanto chi sei e
 * ti dà una chiave che apre il tuo database per due ore.
 *
 *   POST   /accesso   token di Apple o Google  →  sessione + indirizzo + chiave
 *   POST   /chiave    sessione                 →  indirizzo + chiave nuova
 *   DELETE /account   sessione                 →  il database non esiste più
 *
 * NON HA UNO STATO SUO, ed è la decisione di cui vado più fiero in questo file.
 * Non c'è nessuna tabella di utenti: il nome del database si RICAVA
 * dall'identità con una funzione — impronta del `provider:sub`, poi un prefisso.
 * Le conseguenze sono tutte buone: non c'è un elenco di iscritti da custodire,
 * non c'è niente da salvare, niente da migrare, e non esiste un file che colleghi
 * un'email a un archivio. L'unico registro di chi esiste è l'elenco dei database
 * su Turso, che sono nomi opachi.
 *
 * Il prezzo, dichiarato: non possiamo revocare una singola sessione prima della
 * scadenza, né sapere quanti utenti ci sono. La prima si compra con una lettura
 * per ogni chiamata, la seconda non serve a chi usa l'app.
 *
 * COSA NON FA, e va sistemato prima di aprirlo a chiunque: non limita la
 * frequenza delle richieste. Su Cloudflare quello si fa con una regola davanti
 * al Worker, non con del codice qui dentro — ma va fatto, perché `/accesso` è
 * una rotta che chiama Apple e Google e crea database.
 */

import { scambiaCodiceGoogle } from './googleScambio';
import { creaArchivioChiavi, verificaTokenIdentita } from './identita';
import { firmaSessione, idUtente, verificaSessione } from './sessione';
import { assicuraDatabase, cancellaDatabase, DURATA_TOKEN_DB_S, nomeDatabase, tokenDatabase } from './turso';

export interface Ambiente {
  /** Segreto per firmare le sessioni. Cambiarlo scollega tutti i dispositivi. */
  SESSION_KEY: string;
  /** Token dell'organizzazione Turso: crea, legge e cancella OGNI database. */
  TURSO_API_TOKEN: string;
  TURSO_ORG: string;
  TURSO_GROUP: string;
  /**
   * Gli identificativi dell'app presso i fornitori, **separati da virgola**.
   *
   * PERCHÉ PIÙ DI UNO. Google assegna un identificativo diverso per ogni tipo di
   * client: uno «iOS» e uno «Desktop app» sono due registrazioni distinte, con
   * due identificativi distinti, e il token che ciascuna emette porta il proprio
   * nel campo `aud`. Con un valore solo, l'accesso funzionerebbe su una
   * piattaforma e verrebbe rifiutato sull'altra — e il rifiuto sarebbe un 401
   * senza spiegazione, cioè la forma peggiore in cui questo difetto possa
   * presentarsi.
   *
   * Apple oggi ne ha uno solo, il bundle id, che vale per iPhone e Mac insieme
   * perché le due applicazioni lo condividono. È scritto come elenco lo stesso:
   * il giorno in cui servisse un Services ID per l'accesso via web, si aggiunge
   * senza toccare il codice.
   *
   * L'elenco NON è un allentamento del controllo: `aud` deve comunque combaciare
   * con una di queste voci, e ogni voce è una registrazione che abbiamo fatto
   * noi. Quello che si accetta è «una delle nostre app», non «una app
   * qualunque».
   */
  APPLE_CLIENT_ID: string;
  GOOGLE_CLIENT_ID: string;
  /**
   * Il client Google **di tipo Desktop**, l'unico che ha un segreto.
   *
   * È scritto a parte, e non dedotto dalla posizione nell'elenco qui sopra,
   * perché «il secondo della lista» è il genere di accordo implicito che si
   * rompe il giorno che qualcuno riordina una riga di configurazione — e si
   * romperebbe con un 401 senza spiegazione.
   */
  GOOGLE_CLIENT_DESKTOP: string;
  /**
   * Il segreto di quel client. Sta fra i segreti di Cloudflare, non nel
   * repository e non sul dispositivo: è tutta la ragione per cui lo scambio del
   * codice avviene qui invece che nell'app.
   */
  GOOGLE_SEGRETO_DESKTOP: string;
  /** Origini ammesse, separate da virgola. Vuoto = nessun controllo di origine. */
  ORIGINI_AMMESSE?: string;
}

const trovaChiave = creaArchivioChiavi();

/** Da «a, b» a `['a','b']`, saltando le voci vuote di chi lascia una virgola. */
function elenco(valore: string): string[] {
  return valore
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Le risposte non raccontano mai perché.
 *
 * «Token scaduto», «firma non valida», «destinatario sbagliato» sono tre
 * informazioni preziose per chi sta provando a indovinare, e nessuna è utile a
 * chi ha semplicemente un token vecchio: per lui la risposta giusta è una sola,
 * «rifai l'accesso». Quello che serve a noi per capire finisce nel registro del
 * Worker, che non esce da qui.
 */
function rifiuto(stato: number, messaggio: string, origine: string | null): Response {
  return new Response(JSON.stringify({ errore: messaggio }), {
    status: stato,
    headers: { 'Content-Type': 'application/json', ...intestazioniCors(origine) },
  });
}

function intestazioniCors(origine: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origine ?? '*',
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function risposta(dati: unknown, origine: string | null): Response {
  return new Response(JSON.stringify(dati), {
    headers: {
      'Content-Type': 'application/json',
      // Una chiave di database non deve finire in nessuna cache, di nessuno.
      'Cache-Control': 'no-store',
      ...intestazioniCors(origine),
    },
  });
}

/** La sessione dell'intestazione `Authorization`, o `null`. */
async function sessioneDiTurno(richiesta: Request, env: Ambiente): Promise<string | null> {
  const testa = richiesta.headers.get('Authorization') ?? '';
  if (!testa.startsWith('Bearer ')) return null;
  const sessione = await verificaSessione(testa.slice(7), env.SESSION_KEY);
  return sessione?.utente ?? null;
}

function configurazioneTurso(env: Ambiente) {
  return {
    organizzazione: env.TURSO_ORG,
    gruppo: env.TURSO_GROUP,
    apiToken: env.TURSO_API_TOKEN,
  };
}

export default {
  async fetch(richiesta: Request, env: Ambiente): Promise<Response> {
    const origine = richiesta.headers.get('Origin');
    const ammesse = (env.ORIGINI_AMMESSE ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    if (ammesse.length > 0 && origine && !ammesse.includes(origine)) {
      return rifiuto(403, 'origine non ammessa', null);
    }

    if (richiesta.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: intestazioniCors(origine) });
    }

    const percorso = new URL(richiesta.url).pathname;

    try {
      // --- accesso -------------------------------------------------------
      /*
       * Entra un CODICE, non un token d'identità.
       *
       * Il codice di autorizzazione è a uso singolo e da solo non apre niente:
       * senza il verificatore PKCE che l'app ha tenuto per sé, e senza il
       * segreto del client che sta qui, non si scambia. Il token d'identità di
       * Google, invece, resta interamente dentro questo Worker — l'app non lo
       * vede mai, e non ha niente da conservare tranne la propria sessione.
       */
      if (percorso === '/accesso' && richiesta.method === 'POST') {
        const corpo = (await richiesta.json().catch(() => ({}))) as {
          provider?: unknown;
          clientId?: unknown;
          codice?: unknown;
          verificatore?: unknown;
          ritorno?: unknown;
        };
        const provider = corpo.provider;
        if (
          provider !== 'google' ||
          typeof corpo.clientId !== 'string' ||
          typeof corpo.codice !== 'string' ||
          typeof corpo.verificatore !== 'string' ||
          typeof corpo.ritorno !== 'string'
        ) {
          /*
           * Solo Google, per ora. Apple resta supportata da `identita.ts` — la
           * verifica del token è già scritta e provata — ma il suo scambio
           * vuole un segreto che è a sua volta un JWT da firmare con la chiave
           * dello sviluppatore, e ogni sei mesi va rigenerato. Si aggiunge il
           * giorno che serve, non prima.
           */
          return rifiuto(400, 'richiesta incompleta', origine);
        }

        /*
         * Il client dichiarato dev'essere uno DEI NOSTRI. Senza questo
         * controllo, chi chiama potrebbe far scambiare al Worker un codice
         * ottenuto per un'applicazione qualunque, e presentarsi con
         * un'identità verificata da Google ma emessa per qualcun altro.
         */
        const clienti = elenco(env.GOOGLE_CLIENT_ID);
        if (!clienti.includes(corpo.clientId)) return rifiuto(401, 'accesso non riuscito', origine);

        const idToken = await scambiaCodiceGoogle({
          clientId: corpo.clientId,
          // Il segreto va SOLO al client che ne ha uno: mandarlo a un client
          // iOS, che segreto non ha, farebbe rifiutare lo scambio.
          clientSecret: corpo.clientId === env.GOOGLE_CLIENT_DESKTOP ? env.GOOGLE_SEGRETO_DESKTOP : undefined,
          codice: corpo.codice,
          verificatore: corpo.verificatore,
          ritorno: corpo.ritorno,
        });
        if (!idToken) return rifiuto(401, 'accesso non riuscito', origine);

        /*
         * Il token appena ricevuto si verifica lo stesso, firma compresa,
         * benché arrivi da una risposta di Google a una nostra richiesta. Non è
         * diffidenza verso Google: è che il controllo su `aud` e su `iss` vive
         * in un posto solo, e un ramo che lo salta «perché qui è sicuro» è il
         * ramo che un domani qualcuno riusa dove sicuro non è.
         */
        const identita = await verificaTokenIdentita(idToken, {
          provider,
          pubblico: clienti,
          trovaChiave: (kid) => trovaChiave(provider, kid),
        });
        if (!identita) return rifiuto(401, 'accesso non riuscito', origine);

        const utente = await idUtente(identita.provider, identita.sub);
        const db = await assicuraDatabase(configurazioneTurso(env), utente);
        const chiave = await tokenDatabase(configurazioneTurso(env), db.nome);

        return risposta(
          {
            sessione: await firmaSessione(utente, env.SESSION_KEY),
            /*
             * L'email esce da qui, e solo da qui, per una ragione precisa.
             *
             * Serve all'app per scrivere «sei entrato come…». L'app non
             * potrebbe nemmeno ricavarsela: il token d'identità non le arriva
             * più. Qui la firma l'abbiamo appena verificata, quindi l'indirizzo
             * che consegniamo è uno che Google ci ha detto davvero.
             *
             * Non viene conservata dal servizio: passa e basta. L'identità
             * resta il `sub`, e il nome del database si ricava da quello — per
             * cui chi cambia indirizzo email ritrova il proprio archivio.
             */
            email: identita.email ?? null,
            url: db.url,
            chiave,
            scadeIlS: Math.floor(Date.now() / 1000) + DURATA_TOKEN_DB_S,
          },
          origine,
        );
      }

      // --- rinnovo della chiave del database ------------------------------
      if (percorso === '/chiave' && richiesta.method === 'POST') {
        const utente = await sessioneDiTurno(richiesta, env);
        if (!utente) return rifiuto(401, 'sessione non valida', origine);

        const db = await assicuraDatabase(configurazioneTurso(env), utente);
        const chiave = await tokenDatabase(configurazioneTurso(env), db.nome);
        return risposta(
          { url: db.url, chiave, scadeIlS: Math.floor(Date.now() / 1000) + DURATA_TOKEN_DB_S },
          origine,
        );
      }

      // --- cancellazione dell'account -------------------------------------
      if (percorso === '/account' && richiesta.method === 'DELETE') {
        const utente = await sessioneDiTurno(richiesta, env);
        if (!utente) return rifiuto(401, 'sessione non valida', origine);

        await cancellaDatabase(configurazioneTurso(env), nomeDatabase(utente));
        return risposta({ cancellato: true }, origine);
      }

      return rifiuto(404, 'rotta inesistente', origine);
    } catch (err) {
      // Il dettaglio finisce nel registro del Worker; a chi chiama va una frase
      // che non dice niente di utile a chi sta provando.
      console.error('errore interno', err);
      return rifiuto(502, 'servizio non disponibile', origine);
    }
  },
};
