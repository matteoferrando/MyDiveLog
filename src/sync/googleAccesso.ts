/**
 * L'accesso con Google, dalla parte dell'applicazione.
 *
 * IL GIRO, in quattro passi e due processi:
 *
 *  1. l'app prepara PKCE e un `state`, costruisce l'indirizzo di autorizzazione
 *     e lo apre nel **browser di sistema**;
 *  2. la persona accede lì dentro, su una pagina di Google;
 *  3. Google rimanda al nostro punto di ritorno con un `codice` e lo `state`;
 *  4. l'app scambia il codice per un token d'identità e lo consegna al nostro
 *     servizio, che lo verifica e restituisce le chiavi del database.
 *
 * PERCHÉ IL BROWSER DI SISTEMA E NON UNA FINESTRA NOSTRA. Perché una pagina di
 * accesso disegnata dentro l'applicazione è indistinguibile da una finta: chi la
 * guarda non può vedere l'indirizzo né il lucchetto, e non ha modo di sapere se
 * sta scrivendo la propria password a Google o a noi. Il browser di sistema
 * mostra il dominio vero, ha le password già salvate, e le regole di Google
 * ormai lo pretendono per le applicazioni installate. Non è una comodità: è
 * l'unico modo onesto di chiedere le credenziali di qualcun altro.
 *
 * IL PASSO 4 NON È QUI. Lo scambio del codice avviene sul nostro servizio, e il
 * motivo è che Google lo pretende: per i client di tipo «Desktop app» — quelli
 * che possono usare il loopback, cioè la strada giusta sul Mac — il
 * `client_secret` è obbligatorio anche con PKCE. Un segreto dentro un pacchetto
 * che chiunque può aprire non è un segreto, quindi non sta nell'app: sta fra i
 * segreti di Cloudflare, e il codice glielo passiamo. Vedi
 * `server/googleScambio.ts`.
 *
 * Conseguenza pratica per questo progetto: nel repository non entra nessuna
 * credenziale, l'app non conserva nessun token di Google, e iPhone e Mac fanno
 * la stessa identica strada.
 */

import { creaPkce, casuale } from './pkce';

const AUTORIZZA = 'https://accounts.google.com/o/oauth2/v2/auth';

/**
 * Gli ambiti chiesti, e perché così pochi.
 *
 * `openid` è quello che fa emettere il token d'identità, che è tutto ciò che ci
 * serve. `email` la chiediamo per poterla mostrare nelle impostazioni — «sei
 * entrato come…» — e non viene salvata da nessuna parte: l'identità la ricava il
 * servizio dal `sub`. Ogni ambito in più sarebbe una richiesta di permesso che
 * la persona legge, e che noi non sapremmo giustificare.
 */
export const AMBITI = 'openid email';

export interface AccessoIniziato {
  /** Da aprire nel browser di sistema. */
  indirizzo: string;
  /** Da conservare fino al ritorno: senza, il codice non si può scambiare. */
  verificatore: string;
  /** Da confrontare col valore che torna: è la difesa contro un ritorno falso. */
  state: string;
}

export async function iniziaAccesso(clientId: string, ritorno: string): Promise<AccessoIniziato> {
  const pkce = await creaPkce();
  const state = casuale(32);
  const parametri = new URLSearchParams({
    client_id: clientId,
    redirect_uri: ritorno,
    response_type: 'code',
    scope: AMBITI,
    code_challenge: pkce.sfida,
    code_challenge_method: pkce.metodo,
    state,
  });
  return { indirizzo: `${AUTORIZZA}?${parametri}`, verificatore: pkce.verificatore, state };
}

/**
 * Legge quello che torna dal browser, rifiutando tutto ciò che non torna.
 *
 * IL CONFRONTO SULLO `state` NON È UNA FORMALITÀ. Il punto di ritorno è una
 * porta aperta: su iPhone è uno schema URL che qualunque altra applicazione può
 * rivendicare, sul Mac è una porta locale a cui qualunque programma può
 * bussare. Senza questo controllo, chiunque può mandare all'app un codice
 * ottenuto altrove — magari il proprio — e farsi collegare l'archivio di chi sta
 * usando il computer. Il codice che arriva senza uno `state` che combacia con
 * quello che abbiamo generato noi non viene nemmeno guardato.
 */
export function leggiRitorno(
  indirizzo: string,
  stateAtteso: string,
): { codice: string } | { errore: string } {
  let parametri: URLSearchParams;
  try {
    parametri = new URL(indirizzo).searchParams;
  } catch {
    return { errore: 'Il ritorno dall’accesso non è un indirizzo valido.' };
  }

  const negato = parametri.get('error');
  if (negato) {
    // `access_denied` è la persona che ha annullato: non è un guasto e non va
    // presentato come tale.
    return {
      errore:
        negato === 'access_denied' ? 'Accesso annullato.' : `Google ha rifiutato l’accesso (${negato}).`,
    };
  }

  if (parametri.get('state') !== stateAtteso) {
    return { errore: 'Il ritorno dall’accesso non corrisponde alla richiesta: ignorato.' };
  }
  const codice = parametri.get('code');
  if (!codice) return { errore: 'Il ritorno dall’accesso non porta nessun codice.' };
  return { codice };
}
