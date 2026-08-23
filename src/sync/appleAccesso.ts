/**
 * L'accesso con Apple, dalla parte dell'applicazione.
 *
 * COSA CAMBIA RISPETTO A GOOGLE, in una tabella, perché sono tre differenze e
 * ognuna ha una conseguenza visibile in questo file:
 *
 * | | Google | Apple |
 * |---|---|---|
 * | PKCE | sì | **no**: il giro web di Apple non lo prevede |
 * | dove torna il browser | dritto nell'app | prima sul **Worker**, poi nell'app |
 * | come torna | redirect con i parametri in coda | **POST** `form_post` |
 *
 * PERCHÉ IL GIRO WEB E NON `ASAuthorization`. Apple offre anche un giro nativo,
 * col foglio di sistema che conosce già l'utente. È più bello e vuole codice
 * Swift nel guscio, due strade diverse fra iPhone e Mac, e un secondo modo di
 * verificare l'identità sul servizio. Il giro web riusa **tutto** quello che
 * funziona già per Google — l'apertura del browser di sistema, l'ascoltatore
 * locale sul Mac, lo schema URL su iPhone, la stessa rotta `/accesso` — e
 * l'unica cosa che si perde è un foglio più elegante. Si fa il nativo il giorno
 * che qualcuno lo chiede.
 *
 * PERCHÉ IL BROWSER PASSA DAL WORKER. Chiedendo il nome e l'email, Apple
 * pretende `response_mode=form_post` e risponde con una POST verso il Return
 * URL. Una POST non si può mandare né a `mydivelog://` né a una porta su
 * `127.0.0.1`, e il Return URL si registra sul portale come indirizzo `https`
 * esatto. Quindi il ritorno registrato è il Worker, che riceve la POST e
 * rimbalza il browser fin dentro l'app. Dove rimbalzare glielo dice lo `state`:
 * vedi `componiStato` qui sotto e `destinazionePermessa` in
 * `server/appleScambio.ts`, che è la metà che si rifiuta di seguire qualunque
 * altra destinazione.
 *
 * SU COSA POGGIA LA SICUREZZA, dato che PKCE non c'è. Su due cose, e vanno dette
 * per nome invece di lasciarle intuire: sul **segreto**, che vive solo sul
 * Worker e senza il quale il codice non si scambia; e sullo **`state`**, che
 * questo file genera e riconfronta al ritorno. Il secondo è quello che ferma
 * l'attacco vero: il punto di ritorno è una porta aperta — su iPhone uno schema
 * URL che qualunque app può rivendicare, sul Mac una porta a cui qualunque
 * programma può bussare — e un codice che arriva senza lo `state` giusto non
 * viene nemmeno guardato.
 */

import { casuale } from './pkce';

const AUTORIZZA = 'https://appleid.apple.com/auth/authorize';

/**
 * Gli ambiti chiesti.
 *
 * `name` ed `email` sono i due che Apple offre, e li chiediamo entrambi per una
 * ragione che non si può rimediare dopo: **quello che non si chiede al primo
 * accesso non si potrà chiedere più.** Apple manda nome e indirizzo una volta
 * sola nella vita, dentro la POST di ritorno della primissima autorizzazione.
 * Se al primo giro non li avessimo chiesti, l'unico modo di rimediare sarebbe
 * far revocare a mano l'app dalle impostazioni dell'ID Apple.
 *
 * Del nome oggi non facciamo niente; l'email serve a scrivere «sei entrato
 * come…». Chiedere `name` comunque costa una riga nel foglio di consenso e
 * salva la possibilità di usarlo un giorno.
 */
export const AMBITI_APPLE = 'name email';

export interface AccessoAppleIniziato {
  /** Da aprire nel browser di sistema. */
  indirizzo: string;
  /** Da confrontare col valore che torna: senza PKCE, è la difesa che resta. */
  state: string;
}

/**
 * `<casuale>.<destinazione in base64url>`.
 *
 * DUE METÀ IN DUE FILE. Questa compone, `leggiDestinazioneDalloStato` in
 * `server/appleScambio.ts` scompone, e le due non si possono importare a vicenda
 * — una finisce nel pacchetto dell'app, l'altra gira su Cloudflare. Quindi il
 * formato è scritto due volte, e a tenerle d'accordo c'è un test che fa il giro
 * completo: componi qui, leggi là, confronta. Se qualcuno cambia il separatore
 * da una parte sola, quel test cade.
 *
 * Il pezzo casuale davanti è lo `state` vero e proprio, quello che ferma un
 * ritorno falso. La destinazione dietro non è un segreto — è la porta su cui
 * questa app sta ascoltando — e non è nemmeno una cosa di cui fidarsi: il Worker
 * la ricontrolla prima di seguirla.
 */
export function componiStato(nonce: string, destinazione: string): string {
  let grezzo = '';
  for (const b of new TextEncoder().encode(destinazione)) grezzo += String.fromCharCode(b);
  return `${nonce}.${btoa(grezzo).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/**
 * Prepara la richiesta di autorizzazione.
 *
 * `ritornoRegistrato` è il Return URL del portale — il Worker — e deve
 * combaciare carattere per carattere con quello registrato, o Apple rifiuta
 * prima ancora di mostrare la pagina. `destinazione` è dove l'app di questo
 * dispositivo aspetta il rimbalzo, e viaggia dentro lo `state`.
 */
export function iniziaAccessoApple(
  servicesId: string,
  ritornoRegistrato: string,
  destinazione: string,
): AccessoAppleIniziato {
  const state = componiStato(casuale(32), destinazione);
  const parametri = new URLSearchParams({
    client_id: servicesId,
    redirect_uri: ritornoRegistrato,
    response_type: 'code',
    scope: AMBITI_APPLE,
    /*
     * OBBLIGATORIO quando si chiedono `name` o `email`. Senza, Apple risponde
     * `invalid_request` e la pagina di accesso non si apre nemmeno: è la prima
     * cosa da guardare se il pulsante sembra non fare niente.
     */
    response_mode: 'form_post',
    state,
  });
  return { indirizzo: `${AUTORIZZA}?${parametri}`, state };
}

export interface RitornoApple {
  codice: string;
  /**
   * Il JSON `user` di Apple, se c'era.
   *
   * C'è **solo alla primissima autorizzazione** di questa persona, mai più. Da
   * qui prosegue verso il Worker, che ne pesca l'email quando il token
   * d'identità non ne porta una. Non è un dato su cui poggi niente — l'identità
   * resta il `sub` firmato — è la frase «sei entrato come…» che altrimenti
   * resterebbe vuota per sempre.
   */
  utente?: string;
}

/**
 * Legge il rimbalzo del Worker, rifiutando tutto ciò che non torna.
 *
 * Il confronto sullo `state` è lo stesso di Google e ferma lo stesso attacco:
 * un altro programma che bussa alla nostra porta di ritorno con un codice
 * ottenuto altrove. Qui pesa di più, perché senza PKCE è l'unico legame fra il
 * giro che abbiamo iniziato noi e il codice che ci arriva.
 */
export function leggiRitornoApple(indirizzo: string, stateAtteso: string): RitornoApple | { errore: string } {
  let parametri: URLSearchParams;
  try {
    parametri = new URL(indirizzo).searchParams;
  } catch {
    return { errore: 'Il ritorno dall’accesso non è un indirizzo valido.' };
  }

  const negato = parametri.get('error');
  if (negato) {
    // `user_cancelled_authorize` è la persona che ha chiuso il foglio: non è un
    // guasto e non va presentato come tale.
    return {
      errore:
        negato === 'user_cancelled_authorize' || negato === 'access_denied'
          ? 'Accesso annullato.'
          : `Apple ha rifiutato l’accesso (${negato}).`,
    };
  }

  if (parametri.get('state') !== stateAtteso) {
    return { errore: 'Il ritorno dall’accesso non corrisponde alla richiesta: ignorato.' };
  }
  const codice = parametri.get('code');
  if (!codice) return { errore: 'Il ritorno dall’accesso non porta nessun codice.' };

  const utente = parametri.get('user');
  return utente ? { codice, utente } : { codice };
}
