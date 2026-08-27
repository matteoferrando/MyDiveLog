/**
 * Il servizio che autentica e consegna le chiavi del proprio database.
 *
 * QUATTRO ROTTE, E NIENT'ALTRO. Non è un'API sopra le immersioni: le immersioni
 * continuano a viaggiare direttamente fra l'app e il database, con lo stesso
 * motore di sincronizzazione di sempre. Questo servizio dice soltanto chi sei e
 * ti dà una chiave che apre il tuo database per due ore.
 *
 *   POST   /accesso                codice di Apple o Google  →  sessione + chiave
 *   POST   /accesso-apple/ritorno  la POST di Apple          →  rimbalzo nell'app
 *   POST   /chiave                 sessione                  →  chiave nuova
 *   DELETE /account                sessione                  →  il database non esiste più
 *
 * LA SECONDA È UN'ANOMALIA DICHIARATA: non la chiama l'applicazione, la chiama
 * il **browser** di chi sta accedendo, perché Apple — quando le si chiede nome
 * ed email — risponde con una POST invece che con un redirect, e una POST non si
 * può mandare a `mydivelog://` né a una porta su `127.0.0.1`. Quindi il Return
 * URL registrato sul portale di Apple è questo Worker, che riceve e rimbalza.
 * Tutto il ragionamento sta in `appleScambio.ts`.
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

import {
  destinazionePermessa,
  emailDalCampoUtente,
  indirizzoAutorizzazioneApple,
  leggiDestinazioneDalloStato,
  scambiaCodiceApple,
  segretoClientApple,
} from './appleScambio';
import { scambiaCodiceGoogle } from './googleScambio';
import { creaArchivioChiavi, verificaTokenIdentita } from './identita';
import { entroIlLimite, LimiteFrequenza, type SpazioLimiti } from './limite';
import { paginaRimbalzo } from './paginaRimbalzo';
import { firmaSessione, idUtente, verificaSessione } from './sessione';
import {
  ArchivioNonCreato,
  assicuraDatabase,
  cancellaDatabase,
  DURATA_TOKEN_DB_S,
  nomeDatabase,
  tokenDatabase,
} from './turso';

/**
 * L'archivio chiave-valore di Cloudflare, dichiarato per quel poco che ne usiamo.
 *
 * PERCHÉ NON I TIPI VERI. `@cloudflare/workers-types` porta dentro qualche
 * migliaio di dichiarazioni per descrivere una piattaforma intera, e qui servono
 * due metodi. È la stessa scelta già fatta per `SpazioLimiti` in `limite.ts`: si
 * scrive la forma che si usa, e il compilatore controlla quella. Il giorno che
 * servisse davvero il resto, quel pacchetto si aggiunge in una riga.
 */
export interface ArchivioChiaveValore {
  put(chiave: string, valore: string): Promise<void>;
  get(chiave: string): Promise<string | null>;
  list(opzioni?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
}

/**
 * Il contesto d'esecuzione di Cloudflare, ridotto all'unico metodo che serve.
 *
 * Stessa scelta di `ArchivioChiaveValore` qui sopra: si dichiara la forma che si
 * usa invece di tirare dentro i tipi della piattaforma intera. È facoltativo nel
 * `fetch` perché i test montano il Worker chiamandolo con due argomenti, e
 * perché senza contesto il travaso si fa comunque — solo aspettando.
 */
export interface ContestoEsecuzione {
  waitUntil(promessa: Promise<unknown>): void;
}

export interface Ambiente {
  /**
   * Dove finiscono le segnalazioni dal modulo del sito.
   *
   * Facoltativo di proposito: un Worker distribuito senza questo legame — una
   * copia di prova, un ambiente nuovo — deve continuare a fare l'accesso, che è
   * il suo mestiere. La rotta delle segnalazioni risponde che non c'è, e tutto
   * il resto funziona.
   */
  SEGNALAZIONI?: ArchivioChiaveValore;
  /**
   * ► IL FOGLIO DI GOOGLE: L'INDIRIZZO DELLO SCRIPT E IL GETTONE CHE PRETENDE. ◄
   *
   * `FOGLIO_SEGNALAZIONI` è l'indirizzo `/exec` dell'Apps Script pubblicato dal
   * foglio; `FOGLIO_GETTONE` è la parola d'ordine che quello script controlla
   * prima di scrivere una riga.
   *
   * ► PERCHÉ IL GETTONE ESISTE. ◄ Un Apps Script pubblicato «per CHIUNQUE» è un
   * indirizzo su Internet che aggiunge righe a un foglio, e chi lo scopre può
   * riempirlo. L'indirizzo non è segreto per costruzione — basta che finisca in
   * un log, in una segnalazione di errore, in uno screenshot — quindi non ci si
   * può appoggiare. Il gettone sì: sta qui come segreto del Worker, sta nello
   * script, e non passa da nessuna parte in mezzo. Chi conosce l'indirizzo e non
   * il gettone si prende un rifiuto.
   *
   * Tutti e due FACOLTATIVI, come `SEGNALAZIONI`: senza, la segnalazione si
   * salva lo stesso e resta marcata da travasare. Il foglio è **una copia**, non
   * l'archivio — se lo si scambiasse per l'archivio, un guasto di Google
   * diventerebbe una segnalazione persa.
   */
  FOGLIO_SEGNALAZIONI?: string;
  FOGLIO_GETTONE?: string;
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
   *
   * Anche Apple adesso ne ha due, e per lo stesso identico motivo: il **bundle
   * id** è l'identificativo del giro nativo, il **Services ID** quello del giro
   * web, e il token porta in `aud` quello del giro da cui è nato. Oggi si usa
   * solo il giro web, quindi in pratica arriva sempre il Services ID; il bundle
   * id resta elencato perché il giro nativo è la cosa che si aggiunge un
   * domani, e quel giorno non si deve scoprire questa riga con un 401 in mano.
   */
  APPLE_CLIENT_ID: string;
  GOOGLE_CLIENT_ID: string;
  /**
   * Il **Services ID**, cioè il `client_id` con cui si scambia il codice di
   * Apple. È uno dei due valori elencati in `APPLE_CLIENT_ID`, scritto a parte
   * perché lì è un elenco da confrontare e qui è il valore da usare — e «il
   * secondo della lista» è il genere di accordo implicito che si rompe il
   * giorno che qualcuno riordina una riga.
   */
  APPLE_SERVICES_ID: string;
  /** Il Team ID dello sviluppatore: finisce in `iss` dentro il segreto. */
  APPLE_TEAM_ID: string;
  /** L'identificativo della chiave `.p8`: finisce in `kid`. */
  APPLE_KEY_ID: string;
  /**
   * Il Return URL registrato sul portale di Apple. Deve combaciare carattere per
   * carattere con quello scritto là, con quello che l'app mette nella richiesta
   * di autorizzazione, e con quello che si manda allo scambio: Apple ricontrolla
   * tutti e tre.
   *
   * Sta qui e NON arriva dal corpo della richiesta apposta. Un punto di ritorno
   * che il client può dettare è una cosa in più di cui il servizio dovrebbe
   * fidarsi, e per Apple non serve: ce n'è uno solo, ed è nostro.
   */
  APPLE_RITORNO: string;
  /**
   * La chiave privata `.p8` di Apple, per intero.
   *
   * È l'unico segreto di Apple, e da sola non scade mai: il `client_secret` che
   * Apple pretende — un JWT ES256 con scadenza al massimo semestrale — lo firma
   * il Worker al volo a ogni richiesta, valido cinque minuti. È il motivo per
   * cui in questo progetto non c'è nessuna data da ricordare ogni sei mesi.
   * Vedi `appleScambio.ts`.
   *
   *     npx wrangler secret put APPLE_CHIAVE_P8 < AuthKey_XXXXXXXXXX.p8
   */
  APPLE_CHIAVE_P8: string;
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
  /**
   * Dove vivono i contatori del limite di frequenza.
   *
   * Uno spazio solo, e due tetti diversi applicati sopra: `/accesso` e `/chiave`
   * costano cose diverse. Il primo chiama Google, crea un database su Turso e
   * firma una sessione — è la rotta con cui si fa danno, e l'unica che un
   * estraneo raggiunge senza avere niente in mano. Il secondo lo chiama solo chi
   * ha già una sessione valida, per rinnovare una chiave ogni due ore: con
   * qualche dispositivo dietro la stessa uscita di rete il conto sale in fretta,
   * e strozzarlo vorrebbe dire far fallire una sincronizzazione a chi non ha
   * fatto niente di male.
   */
  LIMITI: SpazioLimiti;
}

/**
 * I due tetti, in un posto solo.
 *
 * Dieci accessi al minuto per indirizzo sono larghi per una persona — si entra
 * una volta per dispositivo — e stretti per uno script. Sessanta rinnovi al
 * minuto coprono una famiglia di dispositivi dietro la stessa linea senza mai
 * sfiorare il tetto in uso normale.
 */
const TETTO_ACCESSO = { limite: 10, finestraS: 60 };
const TETTO_CHIAVE = { limite: 60, finestraS: 60 };
/*
 * Le segnalazioni: sei al minuto dallo stesso indirizzo.
 *
 * Basso di proposito, e non è avarizia: una persona che segnala un difetto ne
 * manda una, forse due se si accorge di aver dimenticato un dettaglio. Sei è
 * già il triplo del caso peggiore onesto, e sotto quel tetto riempire l'archivio
 * a mano diventa un lavoro noioso — che è tutto quello che serve, visto che qui
 * non si chiede nessun account a nessuno.
 */
const TETTO_SEGNALAZIONE = { limite: 6, finestraS: 60 };

/**
 * Il percorso su cui atterra la POST di Apple.
 *
 * Scritto una volta e usato tre — l'esenzione dal controllo di origine, la
 * rotta, e il valore di `APPLE_RITORNO` che deve finire in coda a questo — perché
 * tre stringhe uguali scritte a mano diventano due uguali e una diversa.
 */
const AVVIO_APPLE = '/accesso-apple/vai';
const RITORNO_APPLE = '/accesso-apple/ritorno';

const trovaChiave = creaArchivioChiavi();

/**
 * Da chi arriva la richiesta, ai fini del limite.
 *
 * `CF-Connecting-IP` è messo da Cloudflare e non è falsificabile dal client: un
 * `X-Forwarded-For` scritto a mano non lo tocca. Quando manca — non dovrebbe, ma
 * un giorno potrebbe — si ripiega su una chiave unica per tutti, che è la scelta
 * prudente: nel dubbio si limita, non si lascia passare.
 */
function chiamante(richiesta: Request): string {
  return richiesta.headers.get('CF-Connecting-IP') ?? 'sconosciuto';
}

/**
 * Un limite superato NON è un errore da nascondere.
 *
 * Qui, a differenza di tutto il resto del file, la risposta dice esattamente
 * cosa è successo e quando riprovare: chi ha esagerato per sbaglio — uno script
 * che gira in tondo, un'app che riprova troppo in fretta — deve poter capire e
 * correggere. Non c'è niente da indovinare, quindi non c'è niente da proteggere.
 */
function troppeRichieste(origine: string | null, riprovaFraS: number): Response {
  return new Response(JSON.stringify({ errore: `troppe richieste: riprova fra ${riprovaFraS} secondi` }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      // Il tempo VERO che manca alla riapertura della finestra, non un numero
      // fisso: un client educato lo legge e aspetta esattamente quello.
      'Retry-After': String(riprovaFraS),
      ...intestazioniCors(origine),
    },
  });
}

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

/** Una segnalazione come sta nell'archivio. `foglio` dice se è già stata copiata. */
interface SegnalazioneSalvata {
  quando: string;
  tipo: string;
  dove: string;
  testo: string;
  contatto: string;
  pagina: string;
  foglio?: boolean;
}

/**
 * Copia una segnalazione nel foglio di Google, e segna sull'archivio se è
 * andata.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► L'ARCHIVIO È KV, IL FOGLIO È UNA COPIA. ◄ In quest'ordine, e l'ordine è
 * tutto il disegno. La segnalazione è già salvata quando questa funzione parte:
 * se Google è lento, se lo script è stato ripubblicato con un altro indirizzo,
 * se la rete cade a metà, non si perde niente — resta una riga con `foglio`
 * falso, che `scripts/travasa-segnalazioni.mjs` ritrova e riprova.
 *
 * Il contrario — scrivere nel foglio e considerarlo fatto — legherebbe la sorte
 * di quello che qualcuno si è preso la briga di scrivere alla disponibilità di
 * un servizio di terzi, per giunta in un momento in cui nessuno sta guardando.
 *
 * ► PERCHÉ NON GUARDA COSA RISPONDE LO SCRIPT. ◄ Lo guarda eccome: un Apps
 * Script risponde 200 anche quando ha rifiutato, perché il rifiuto è testo nel
 * corpo, non uno stato. Quindi si legge il corpo e si accetta solo `ok`. Senza
 * questo controllo un gettone sbagliato marcherebbe tutto come travasato
 * lasciando il foglio vuoto: **il modo peggiore di fallire, perché somiglia in
 * tutto al successo.**
 */
async function versaNelFoglio(env: Ambiente, chiave: string, dati: SegnalazioneSalvata): Promise<boolean> {
  if (!env.FOGLIO_SEGNALAZIONI || !env.SEGNALAZIONI) return false;
  try {
    /*
     * Otto secondi e poi si lascia perdere. Non è una scelta di prestazioni —
     * qui non aspetta nessuno, la risposta al sito è già partita — ma di igiene:
     * una chiamata senza scadenza, dentro un `waitUntil`, tiene in vita
     * l'esecuzione finché la piattaforma non la stronca, e allora il travaso
     * muore a metà senza lasciare traccia di esserci provato.
     */
    const taglio = AbortSignal.timeout(8000);
    const risposta = await fetch(env.FOGLIO_SEGNALAZIONI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...dati, gettone: env.FOGLIO_GETTONE ?? '' }),
      signal: taglio,
      // Apps Script risponde con un rimando a `script.googleusercontent.com`:
      // senza seguirlo si leggerebbe il corpo vuoto del 302 e ogni travaso
      // riuscito risulterebbe fallito.
      redirect: 'follow',
    });
    if (!risposta.ok) return false;
    if ((await risposta.text()).trim() !== 'ok') return false;
    await env.SEGNALAZIONI.put(chiave, JSON.stringify({ ...dati, foglio: true }));
    return true;
  } catch {
    // Nessun rilancio: chi chiama non ha niente da fare con l'errore, e la
    // segnalazione è al sicuro comunque. Resta `foglio` falso, che è il modo in
    // cui questo guasto si dichiara.
    return false;
  }
}

export default {
  async fetch(richiesta: Request, env: Ambiente, ctx?: ContestoEsecuzione): Promise<Response> {
    const origine = richiesta.headers.get('Origin');
    const percorso = new URL(richiesta.url).pathname;
    const ammesse = (env.ORIGINI_AMMESSE ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    /*
     * IL RITORNO DI APPLE È ESENTE dal controllo di origine, e non è una
     * scorciatoia.
     *
     * Quella POST non la manda l'applicazione: la manda il **browser** di chi
     * sta accedendo, per conto della pagina di Apple, e porta quindi
     * `Origin: https://appleid.apple.com`. Il giorno che `ORIGINI_AMMESSE`
     * venisse riempito con l'origine dell'app — che è la cosa giusta da fare, e
     * sta scritta come da fare nel README — questa rotta si spegnerebbe con un
     * 403, e il sintomo sarebbe «l'accesso con Apple non torna più»: nessun
     * errore nell'app, nessuna riga che nomini le origini.
     *
     * Non si perde niente: quello che protegge questa rotta non è l'origine —
     * che chiunque può mettere a mano — ma lo `state`, ricontrollato prima di
     * rimbalzare, e il limite di frequenza qui sotto.
     */
    if (
      ammesse.length > 0 &&
      origine &&
      !ammesse.includes(origine) &&
      percorso !== RITORNO_APPLE &&
      percorso !== AVVIO_APPLE
    ) {
      return rifiuto(403, 'origine non ammessa', null);
    }

    if (richiesta.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: intestazioniCors(origine) });
    }

    try {
      // --- segnalazioni dal sito ------------------------------------------
      /*
       * ► IL MODULO DEL SITO SCRIVE QUI. ◄
       *
       * Prima apriva la posta: quattro campi compilati con cura finivano in una
       * bozza di email che chi segnala doveva mandare a mano, e metà delle volte
       * non la manda. Un modulo che chiede di completare l'invio da un'altra
       * parte è un modulo che perde le segnalazioni proprio di chi si era preso
       * la briga di scriverle.
       *
       * NIENTE ORIGINE, NIENTE SESSIONE, NIENTE ACCOUNT. Chi ha un difetto da
       * segnalare non deve prima dimostrare chi è: la barriera più bassa
       * possibile è il punto di questa rotta. Quello che la protegge è il limite
       * di frequenza qui sotto e il taglio dei campi — non un permesso.
       *
       * `waitUntil` NON si usa: la risposta si dà dopo aver scritto. Rispondere
       * «ricevuta» e poi scoprire che la scrittura è fallita sarebbe la bugia
       * peggiore che questa rotta possa dire.
       */
      if (percorso === '/segnalazione' && richiesta.method === 'POST') {
        const limiteSegn = await entroIlLimite(
          env.LIMITI,
          'segnalazione',
          chiamante(richiesta),
          TETTO_SEGNALAZIONE.limite,
          TETTO_SEGNALAZIONE.finestraS,
        );
        if (!limiteSegn.consentito) return troppeRichieste(origine, limiteSegn.riprovaFraS);
        if (!env.SEGNALAZIONI) return rifiuto(503, 'archivio non configurato', origine);

        let corpo: Record<string, unknown> = {};
        try {
          corpo = (await richiesta.json()) as Record<string, unknown>;
        } catch {
          return rifiuto(400, 'corpo non leggibile', origine);
        }

        // Quattromila caratteri per campo: abbastanza per raccontare un difetto
        // con dentro un pezzo di registro, poco perché riempire l'archivio
        // diventi comodo.
        const taglia = (v: unknown) => String(v ?? '').slice(0, 4000);
        const testo = taglia(corpo.testo).trim();
        // Senza testo non c'è segnalazione: è la riga che tiene fuori le
        // richieste vuote di chi passa di lì a caso.
        if (!testo) return rifiuto(400, 'la segnalazione è vuota', origine);

        // La chiave porta la data davanti perché KV elenca in ordine di chiave:
        // così `list` restituisce già le segnalazioni in ordine di arrivo, senza
        // doverle ordinare dopo averle lette tutte.
        const quando = new Date().toISOString();
        const chiave = `s:${quando}:${crypto.randomUUID().slice(0, 8)}`;
        const dati: SegnalazioneSalvata = {
          quando,
          tipo: taglia(corpo.tipo),
          dove: taglia(corpo.dove),
          testo,
          contatto: taglia(corpo.contatto),
          pagina: taglia(corpo.pagina),
          // Nasce «non ancora nel foglio» e lo diventa se il travaso riesce. Il
          // valore predefinito è quello PESSIMISTA apposta: una segnalazione che
          // si dichiara copiata senza esserlo sparirebbe dai controlli.
          foglio: false,
        };
        await env.SEGNALAZIONI.put(chiave, JSON.stringify(dati));

        /*
         * ► IL FOGLIO SI RIEMPIE QUI, DOPO CHE LA RISPOSTA È GIÀ VERA. ◄
         *
         * Il commento in testa a questa rotta dice che `waitUntil` non si usa, e
         * vale ancora — per la scrittura in ARCHIVIO, che è quella che rende
         * vera la parola «ricevuta» e resta bloccante due righe più su.
         *
         * La copia nel foglio è un'altra cosa: quando parte, la segnalazione è
         * già salvata. Farla aspettare a chi ha premuto «invia» vorrebbe dire
         * far pagare a lui la lentezza di Google per un lavoro che non lo
         * riguarda, e in cambio di niente — perché comunque, se fallisse, la
         * risposta resterebbe «ok».
         *
         * Senza contesto d'esecuzione (i test, un ambiente che non lo passa) si
         * aspetta: meglio lento che saltato in silenzio.
         */
        const copia = versaNelFoglio(env, chiave, dati);
        if (ctx) ctx.waitUntil(copia);
        else await copia;

        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json', ...intestazioniCors(origine) },
        });
      }

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
        /*
         * Il limite si applica PRIMA di leggere il corpo e prima di chiamare
         * chiunque: se lo si mettesse dopo la verifica, ogni tentativo respinto
         * avrebbe comunque fatto partire una richiesta verso Google, che è
         * esattamente il costo da cui ci si vuole proteggere.
         */
        const limite = await entroIlLimite(
          env.LIMITI,
          'accesso',
          chiamante(richiesta),
          TETTO_ACCESSO.limite,
          TETTO_ACCESSO.finestraS,
        );
        if (!limite.consentito) return troppeRichieste(origine, limite.riprovaFraS);

        const corpo = (await richiesta.json().catch(() => ({}))) as {
          provider?: unknown;
          clientId?: unknown;
          codice?: unknown;
          verificatore?: unknown;
          ritorno?: unknown;
          utente?: unknown;
        };
        const provider = corpo.provider;
        if ((provider !== 'google' && provider !== 'apple') || typeof corpo.codice !== 'string') {
          return rifiuto(400, 'richiesta incompleta', origine);
        }

        /*
         * I due fornitori chiedono cose diverse, e la differenza è tutta qui.
         *
         * GOOGLE vuole il verificatore PKCE, il punto di ritorno della prima
         * richiesta, e il segreto solo se il client è quello desktop. APPLE non
         * ha PKCE nel giro web, ha un solo client e un solo punto di ritorno —
         * entrambi nostri, entrambi presi da `env` e non dal corpo — e un
         * segreto che non esiste finché non lo firmiamo, cinque minuti prima di
         * usarlo.
         *
         * Quello che i due rami hanno in comune comincia subito sotto, ed è la
         * parte che conta: la verifica del token, l'identità, il database.
         */
        let idToken: string | null;
        let clienti: string[];

        if (provider === 'apple') {
          clienti = elenco(env.APPLE_CLIENT_ID);
          idToken = await scambiaCodiceApple({
            clientId: env.APPLE_SERVICES_ID,
            segreto: await segretoClientApple({
              servicesId: env.APPLE_SERVICES_ID,
              teamId: env.APPLE_TEAM_ID,
              keyId: env.APPLE_KEY_ID,
              chiaveP8: env.APPLE_CHIAVE_P8,
            }),
            codice: corpo.codice,
            ritorno: env.APPLE_RITORNO,
          });
        } else {
          if (
            typeof corpo.clientId !== 'string' ||
            typeof corpo.verificatore !== 'string' ||
            typeof corpo.ritorno !== 'string'
          ) {
            return rifiuto(400, 'richiesta incompleta', origine);
          }
          /*
           * Il client dichiarato dev'essere uno DEI NOSTRI. Senza questo
           * controllo, chi chiama potrebbe far scambiare al Worker un codice
           * ottenuto per un'applicazione qualunque, e presentarsi con
           * un'identità verificata da Google ma emessa per qualcun altro.
           *
           * Con Apple lo stesso controllo non serve, perché non c'è niente da
           * controllare: il client non arriva da fuori, è `APPLE_SERVICES_ID`.
           */
          clienti = elenco(env.GOOGLE_CLIENT_ID);
          if (!clienti.includes(corpo.clientId)) return rifiuto(401, 'accesso non riuscito', origine);

          idToken = await scambiaCodiceGoogle({
            clientId: corpo.clientId,
            // Il segreto va SOLO al client che ne ha uno: mandarlo a un client
            // iOS, che segreto non ha, farebbe rifiutare lo scambio.
            clientSecret:
              corpo.clientId === env.GOOGLE_CLIENT_DESKTOP ? env.GOOGLE_SEGRETO_DESKTOP : undefined,
            codice: corpo.codice,
            verificatore: corpo.verificatore,
            ritorno: corpo.ritorno,
          });
        }
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
             *
             * IL RIPIEGO SU `utente` VALE SOLO PER APPLE, ed esiste perché Apple
             * manda nome e indirizzo **una volta sola nella vita**: dentro la
             * POST della primissima autorizzazione, e mai più. Chi non li
             * prende lì non li riavrà da nessuna parte, nemmeno rifacendo
             * l'accesso. Quel campo arriva dall'app e non da una firma, quindi
             * non regge niente — l'identità è il `sub` del token, che abbiamo
             * appena verificato — e il peggio che può fare chi lo falsifica è
             * scrivere un indirizzo sbagliato nelle proprie impostazioni.
             *
             * Un indirizzo `@privaterelay.appleid.com` è legittimo: è l'inoltro
             * che Apple crea per chi sceglie «Nascondi la mia email», e si
             * accetta come qualunque altro.
             */
            email: identita.email ?? emailDalCampoUtente(corpo.utente),
            url: db.url,
            chiave,
            scadeIlS: Math.floor(Date.now() / 1000) + DURATA_TOKEN_DB_S,
          },
          origine,
        );
      }

      // --- l'avvio dell'accesso con Apple, che apre il browser -------------
      /*
       * ANCHE QUESTA NON LA CHIAMA L'APPLICAZIONE: la apre il BROWSER, ed è la
       * primissima cosa che succede quando si preme «Sign in with Apple».
       *
       * ► PERCHÉ ESISTE. ◄ L'app apriva `appleid.apple.com` per conto suo. Sul
       * Mac funziona. Su iPhone il browser si apre sulla propria pagina
       * iniziale e l'accesso finisce lì: nessun errore, nessuna pagina bianca,
       * niente in nessun registro — il guasto più difficile che ci sia, perché
       * non lascia niente da leggere. Lo stesso indirizzo aperto A MANO in
       * quello stesso browser apre il foglio di Apple senza fare una piega, e
       * l'accesso con Google — stessa riga di codice, altro indirizzo — pure.
       * La differenza è il dominio: `appleid.apple.com` è quello che iOS usa
       * per il proprio «Accedi con Apple», e quando un'applicazione gli chiede
       * di aprirlo se lo prende il sistema invece di passarlo al browser.
       *
       * Quindi l'app apre questo indirizzo, su un dominio che nessuno ha motivo
       * di intercettare, e il salto verso Apple lo fa un 302 — che il browser
       * segue da solo, perché fra due https non c'è niente di speciale.
       *
       * QUI NON SI DECIDE NIENTE che non sia già deciso: il Services ID, il
       * Return URL e gli ambiti vengono dall'ambiente, e l'unica cosa che
       * arriva da fuori è lo `state`, che è dell'app e le deve tornare intero.
       * Lo si ricontrolla lo stesso — la destinazione che porta dentro deve
       * essere una di quelle che accetteremmo al ritorno — perché mandare
       * qualcuno da Apple con uno `state` che poi rifiuteremo vuol dire fargli
       * fare tutto il giro per niente.
       */
      if (percorso === AVVIO_APPLE && richiesta.method === 'GET') {
        const limite = await entroIlLimite(
          env.LIMITI,
          'accesso',
          chiamante(richiesta),
          TETTO_ACCESSO.limite,
          TETTO_ACCESSO.finestraS,
        );
        if (!limite.consentito) return troppeRichieste(origine, limite.riprovaFraS);

        const stato = new URL(richiesta.url).searchParams.get('state') ?? '';
        /*
         * Il tetto sulla lunghezza non è pignoleria: lo `state` finisce dentro
         * un'intestazione `Location`, e un valore lunghissimo diventa una
         * risposta lunghissima che qualcun altro dovrà pur digerire. Lo `state`
         * vero misura poco più di ottanta caratteri.
         */
        const destinazione = stato.length > 512 ? null : leggiDestinazioneDalloStato(stato);
        if (!destinazione || !destinazionePermessa(destinazione)) {
          console.error('avvio Apple con uno state che non riconosciamo');
          return rifiuto(400, 'avvio non valido', origine);
        }

        return new Response(null, {
          status: 302,
          headers: {
            Location: indirizzoAutorizzazioneApple(env.APPLE_SERVICES_ID, env.APPLE_RITORNO, stato),
            'Cache-Control': 'no-store',
          },
        });
      }

      // --- il ritorno di Apple, che arriva dal browser ---------------------
      /*
       * QUESTA ROTTA NON LA CHIAMA L'APPLICAZIONE. La chiama il browser di chi
       * sta accedendo, perché Apple — quando le si chiede nome ed email —
       * pretende `response_mode=form_post` e risponde con una POST
       * `application/x-www-form-urlencoded` invece che con un redirect. Una POST
       * non si può mandare a `mydivelog://` né a una porta su `127.0.0.1`, e il
       * Return URL si registra sul portale come indirizzo `https` esatto: quindi
       * atterra qui, e da qui si rimbalza dentro l'app.
       *
       * Il rimbalzo è l'unica cosa che questa rotta fa. Non scambia niente, non
       * verifica nessuna firma, non crea nessun database: il codice prosegue
       * fino all'app, che lo riporta a `/accesso` insieme allo `state` che aveva
       * generato. Sembra un giro lungo, ed è quello che tiene il confronto sullo
       * `state` dalla parte di chi l'ha generato — cioè l'unico posto in cui
       * quel confronto vuol dire qualcosa.
       */
      if (percorso === RITORNO_APPLE && richiesta.method === 'POST') {
        /*
         * Anche qui il limite, e per un motivo suo: è una rotta pubblica che
         * qualunque estraneo può chiamare senza avere niente in mano, e ogni
         * chiamata costa una risposta e una riga di registro. Condivide il
         * contatore di `/accesso` perché fa parte dello stesso giro — una
         * persona che entra passa da entrambe una volta sola.
         */
        const limite = await entroIlLimite(
          env.LIMITI,
          'accesso',
          chiamante(richiesta),
          TETTO_ACCESSO.limite,
          TETTO_ACCESSO.finestraS,
        );
        if (!limite.consentito) return troppeRichieste(origine, limite.riprovaFraS);

        const modulo = new URLSearchParams(await richiesta.text());
        const stato = modulo.get('state') ?? '';
        const destinazione = leggiDestinazioneDalloStato(stato);

        /*
         * ► LA RIGA CHE IMPEDISCE UN REDIRECT APERTO. ◄
         *
         * La destinazione arriva da fuori: è dentro lo `state`, che ha fatto un
         * giro da Apple ma nasce nel browser di chi accede. Un Worker che
         * rimanda dove gli si dice è un indirizzo su un dominio nostro e
         * credibile — `mydivelog.site` — che fa atterrare chi lo apre sul sito
         * di qualcun altro, per giunta con un codice di autorizzazione in coda.
         *
         * Quindi si RIFIUTA, con un errore, tutto quello che non è lo schema
         * dell'app o l'ascoltatore locale. Non si prova a correggere, non si
         * segue «tanto è probabilmente a posto». Il controllo vero sta in
         * `destinazionePermessa`, che analizza l'indirizzo invece di guardarne
         * l'inizio.
         */
        if (!destinazione || !destinazionePermessa(destinazione)) {
          console.error('ritorno Apple con una destinazione che non seguiamo');
          return rifiuto(400, 'ritorno non valido', origine);
        }

        const verso = new URL(destinazione);
        // Lo `state` torna INTERO: il pezzo che l'app riconfronta è quello, e
        // consegnarne una parte vorrebbe dire far fallire il confronto sempre.
        verso.searchParams.set('state', stato);

        const negato = modulo.get('error');
        if (negato) {
          // «Ho chiuso il foglio» non è un guasto: si riporta all'app com'è, ed
          // è lei a decidere che è un annullamento e non un errore da mostrare.
          verso.searchParams.set('error', negato);
        } else {
          const codice = modulo.get('code');
          if (!codice) return rifiuto(400, 'ritorno non valido', origine);
          verso.searchParams.set('code', codice);
          /*
           * `user` c'è SOLO alla primissima autorizzazione di quella persona, e
           * mai più. Se non lo si inoltra adesso, l'email non si riavrà da
           * nessuna parte: è l'unica occasione, e passa da questa riga.
           */
          const utente = modulo.get('user');
          if (utente) verso.searchParams.set('user', utente);
        }

        /*
         * ► DUE STRADE, E A SCEGLIERE È IL SISTEMA OPERATIVO, NON NOI. ◄
         *
         * Verso `127.0.0.1` — il Mac — si rimbalza col 303, che è la strada
         * corta e funziona. Verso `mydivelog://` — l'iPhone — il 303 NON arriva
         * da nessuna parte: i browser di iOS non seguono un rimando automatico
         * verso uno schema che non sia http o https, ed è una difesa, non un
         * difetto. Il sintomo è il peggiore possibile: la pagina resta bianca,
         * il browser non dice niente, qui non si registra nessun errore, e
         * l'accesso muore in silenzio. Visto su Chrome il 23 agosto 2026.
         *
         * Per quel caso si risponde con una pagina che ha un pulsante: il tocco
         * di una persona verso uno schema d'applicazione iOS lo esegue senza
         * discutere. Tutto il ragionamento sta in `paginaRimbalzo.ts`.
         *
         * Il controllo è `!== 'http:'` e non `=== 'mydivelog:'` apposta: chi
         * decide quali destinazioni esistono è `destinazionePermessa`, e questa
         * riga non deve diventare un secondo elenco da tenere allineato al
         * primo. Qui interessa una cosa sola — è un indirizzo che il browser sa
         * seguire da solo, sì o no.
         */
        if (verso.protocol !== 'http:') return paginaRimbalzo(verso.toString(), richiesta);

        /*
         * 303 e non 302: la richiesta in arrivo è una POST, e un 302 lascerebbe
         * al browser la libertà di ripeterla come POST verso l'app — che
         * ascolta una GET. Il 303 dice «vai lì, con una GET», che è esattamente
         * quello che serve.
         *
         * Il salto verso `mydivelog://` lo esegue il sistema operativo, non il
         * browser: è lo stesso meccanismo con cui tornano tutte le applicazioni
         * native dopo un accesso.
         */
        return new Response(null, {
          status: 303,
          headers: { Location: verso.toString(), 'Cache-Control': 'no-store' },
        });
      }

      // --- rinnovo della chiave del database ------------------------------
      if (percorso === '/chiave' && richiesta.method === 'POST') {
        const limite = await entroIlLimite(
          env.LIMITI,
          'chiave',
          chiamante(richiesta),
          TETTO_CHIAVE.limite,
          TETTO_CHIAVE.finestraS,
        );
        if (!limite.consentito) return troppeRichieste(origine, limite.riprovaFraS);

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
        // Cancellare passa dal contatore di `/chiave`: è raro per costruzione —
        // si chiude un account una volta — e non merita un ambito suo.
        const limite = await entroIlLimite(
          env.LIMITI,
          'chiave',
          chiamante(richiesta),
          TETTO_CHIAVE.limite,
          TETTO_CHIAVE.finestraS,
        );
        if (!limite.consentito) return troppeRichieste(origine, limite.riprovaFraS);

        const utente = await sessioneDiTurno(richiesta, env);
        if (!utente) return rifiuto(401, 'sessione non valida', origine);

        await cancellaDatabase(configurazioneTurso(env), nomeDatabase(utente));
        return risposta({ cancellato: true }, origine);
      }

      return rifiuto(404, 'rotta inesistente', origine);
    } catch (err) {
      /*
       * Un'eccezione sola merita di uscire con la sua faccia: il servizio non è
       * riuscito a creare l'archivio e non ne esisteva già uno. Chi la riceve non
       * deve «riprovare più tardi» — riproverebbe per sempre — deve sapere che il
       * servizio è al completo e che c'è un indirizzo a cui scrivere. È anche
       * l'unico errore che non dice niente a chi volesse indovinare qualcosa:
       * riguarda noi, non lui.
       */
      if (err instanceof ArchivioNonCreato) {
        console.error('archivio non creato', err.stato);
        return rifiuto(
          503,
          'il servizio non è al momento in grado di creare nuovi archivi: scrivi a matteozinin@protonmail.com',
          origine,
        );
      }
      // Per tutto il resto il dettaglio finisce nel registro del Worker; a chi
      // chiama va una frase che non dice niente di utile a chi sta provando.
      console.error('errore interno', err);
      return rifiuto(502, 'servizio non disponibile', origine);
    }
  },
};

/*
 * L'oggetto del limite si RIESPORTA da qui.
 *
 * Cloudflare cerca la classe di un Durable Object fra le esportazioni del modulo
 * principale, non fra quelle del file in cui l'hai scritta. Senza questa riga il
 * deploy passa, e il Worker fallisce alla prima richiesta con «class not
 * found» — un errore che non nomina né il file né l'esportazione mancante.
 */
export { LimiteFrequenza };
