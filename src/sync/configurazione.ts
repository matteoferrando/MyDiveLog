/**
 * Gli identificativi pubblici dell'accesso.
 *
 * PERCHÉ STANNO NEL REPOSITORY. Perché sono pubblici per costruzione: un client
 * id di Google e l'indirizzo di un servizio finiscono dentro ogni copia
 * dell'applicazione che viene distribuita, e chiunque li può leggere aprendo il
 * pacchetto. Nasconderli sarebbe teatro. Quello che NON sta qui — e non ci deve
 * entrare mai — è il segreto con cui il servizio firma le sessioni e il token
 * dell'organizzazione Turso: quelli vivono fra i segreti del Worker, dove
 * nemmeno chi li ha caricati li rivede.
 *
 * IL CLIENT DI GOOGLE DIPENDE DALLA PIATTAFORMA, e non è un capriccio nostro:
 * Google assegna una registrazione per tipo di client, e il token che ciascuna
 * emette porta il proprio identificativo nel campo che il servizio controlla.
 * Usare quello sbagliato non produce un errore comprensibile: produce un 401.
 */

import { suIOS } from '../piattaforma';

/** Il servizio che autentica e consegna le chiavi del proprio database. */
export const SERVIZIO_ACCESSO = 'https://mydivelog-accesso.mydivelog.workers.dev';

/** Registrazione «iOS» su Google Cloud, legata al bundle id. */
export const GOOGLE_CLIENT_IOS = '883995552043-2khev71oqkm7go3nilogqc82tunbito7.apps.googleusercontent.com';

/** Registrazione «Desktop app» su Google Cloud. */
export const GOOGLE_CLIENT_DESKTOP =
  '883995552043-fcsjcnlb5o6ih7af686bk0j7pls9k5bi.apps.googleusercontent.com';

/** Quello che vale su QUESTA piattaforma. */
export function clientGoogle(): string {
  return suIOS() ? GOOGLE_CLIENT_IOS : GOOGLE_CLIENT_DESKTOP;
}

/**
 * Lo schema URL con cui l'iPhone rientra nell'app dopo l'accesso.
 *
 * Google lo chiama «reversed client id» e non è un valore separato da
 * registrare: è il client id iOS letto al contrario, con il dominio davanti.
 * Si ricava invece di trascriverlo perché due stringhe che devono combaciare e
 * si scrivono a mano prima o poi non combaciano più — e il sintomo sarebbe
 * l'accesso che si apre, si completa, e poi resta appeso senza tornare
 * nell'app.
 */
export function schemaRitornoIOS(): string {
  const senzaDominio = GOOGLE_CLIENT_IOS.replace('.apps.googleusercontent.com', '');
  return `com.googleusercontent.apps.${senzaDominio}`;
}

/**
 * Dove torna l'accesso, che è la differenza vera fra le due piattaforme.
 *
 * Su iPhone il browser di sistema riconsegna all'app tramite lo schema URL qui
 * sopra. Sul Mac si usa il loopback: l'app apre una porta su `127.0.0.1`, il
 * browser ci atterra, e la porta si chiude subito dopo. È la strada che Google
 * raccomanda per le applicazioni desktop, non richiede nessuno schema
 * registrato, e ha il vantaggio di non lasciare in giro un'associazione fra uno
 * schema URL e l'app — che su un computer condiviso qualunque altro programma
 * potrebbe rivendicare.
 */
export function ritornoDaAccesso(portaLoopback: number): string {
  return suIOS() ? `${schemaRitornoIOS()}:/accesso` : `http://127.0.0.1:${portaLoopback}/accesso`;
}

/**
 * Dove comincia l'accesso con Apple: **un indirizzo nostro**, non quello di Apple.
 *
 * ► QUESTA RIGA È LA CORREZIONE DI UN GUASTO CHE NON SI VEDEVA. ◄ Prima l'app
 * apriva direttamente `appleid.apple.com/auth/authorize`. Sul Mac funziona; su
 * iPhone il browser si apre sulla propria pagina iniziale e l'accesso finisce
 * lì — nessun errore, nessuna pagina bianca, niente in nessun registro. Lo
 * stesso indirizzo aperto A MANO in quello stesso browser va benissimo, e
 * l'accesso con Google — stessa riga di codice, indirizzo diverso — pure. È il
 * dominio: `appleid.apple.com` è quello che iOS usa per il proprio «Accedi con
 * Apple», e quando un'applicazione gli chiede di aprirlo se lo prende il
 * sistema invece di passarlo al browser.
 *
 * Quindi l'app apre `mydivelog.site`, che nessuno ha motivo di intercettare, e
 * il Worker rimanda ad Apple con un 302 — che il browser segue da solo, perché
 * fra due indirizzi https non c'è niente di speciale. La pagina di Apple viene
 * composta là, in `server/appleScambio.ts`, insieme al Services ID, al Return
 * URL e agli ambiti: tutta quella roba adesso vive in un posto solo.
 */
export const APPLE_AVVIO = 'https://mydivelog.site/accesso-apple/vai';

/**
 * Lo schema con cui l'iPhone rientra nell'app dopo l'accesso **con Apple**.
 *
 * Google impone il proprio («reversed client id», ricavato dal client id).
 * Apple no: il rimbalzo lo fa il nostro Worker, quindi lo schema lo scegliamo
 * noi, e uno leggibile è meglio di uno ricavato. Deve combaciare con
 * `CFBundleURLSchemes` in `src-tauri/Info.ios.plist`, e c'è un test che lo
 * verifica — perché se divergono l'accesso si completa nel browser e poi non
 * torna mai, senza nessun errore da nessuna parte.
 */
export const SCHEMA_APP = 'mydivelog';

/**
 * Dove torna l'accesso con Apple su QUESTA piattaforma.
 *
 * È la «destinazione» che viaggia dentro lo `state` e che il Worker ricontrolla
 * prima di seguirla: sono le sole due forme che `destinazionePermessa` accetta.
 */
export function destinazioneApple(portaLoopback: number): string {
  return suIOS() ? `${SCHEMA_APP}://accesso` : `http://127.0.0.1:${portaLoopback}/accesso`;
}
