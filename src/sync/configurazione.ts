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
