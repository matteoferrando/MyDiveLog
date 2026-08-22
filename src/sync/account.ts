/**
 * L'account visto dall'app: sessione lunga, chiave del database corta.
 *
 * COSA CAMBIA RISPETTO A OGGI. Oggi il token del database lo incolli a mano
 * nelle impostazioni e vale per sempre. Con l'account il token lo chiede l'app,
 * vale due ore, e quello che resta sul dispositivo è la SESSIONE — che apre il
 * servizio, non il database. La differenza pratica: un token eterno copiato da
 * un backup o letto da uno schermo apre l'archivio per sempre; una sessione
 * scade, e la chiave che ne deriva scade da sola in due ore.
 *
 * LE DUE COSE NON SI CONFONDONO, e stanno in posti diversi apposta:
 *
 * | | dove vive | quanto dura |
 * |---|---|---|
 * | sessione | portachiavi di sistema | settimane |
 * | chiave del database | **solo in memoria** | due ore |
 *
 * La chiave non si scrive da nessuna parte. Non è prudenza teorica: l'archivio
 * SQLite finisce nei backup di sistema e nelle copie su disco esterno, e una
 * chiave scritta là dentro sopravvive alla sessione che l'ha generata.
 *
 * QUESTO FILE NON SA NIENTE DI TAURI né di React: prende `fetch` e restituisce
 * dati. È l'unico modo di provarlo davvero — il giro di rinnovo, la scadenza, il
 * rifiuto — senza aprire un'applicazione.
 */

import type { SyncCredentials } from './turso';

export type Fornitore = 'apple' | 'google';

/** Quello che il servizio restituisce quando consegna una chiave. */
export interface ChiaveDatabase extends SyncCredentials {
  /** Quando la chiave smette di valere, in secondi dall'epoca. */
  scadeIlS: number;
}

export interface EsitoAccesso {
  /** Da mettere nel portachiavi. È l'unica cosa che sopravvive alla chiusura. */
  sessione: string;
  /**
   * L'email di chi è entrato, **solo da mostrare**, e `null` se il fornitore
   * non l'ha data.
   *
   * Arriva dal servizio e non dal token letto in casa: il servizio la firma
   * l'ha appena verificata, l'app no. Decodificare un token senza verificarlo
   * per pescarne un campo è un'abitudine che comincia con un'email da scrivere
   * in una frase e finisce su un campo da cui dipende qualcosa.
   *
   * È `null` e non stringa vuota perché «non lo so» e «è vuota» sono due cose
   * diverse, e l'interfaccia deve poterle distinguere.
   */
  email: string | null;
  chiave: ChiaveDatabase;
}

/**
 * La sessione non vale più: va rifatto l'accesso.
 *
 * Un tipo suo e non un errore qualunque perché è l'unico caso in cui
 * l'interfaccia deve fare qualcosa di diverso da «riprova»: deve riportare al
 * pulsante di accesso. Distinguerlo dal messaggio è fragile — i messaggi si
 * traducono e si riscrivono — mentre un tipo regge alle riscritture.
 */
export class SessioneScaduta extends Error {
  constructor() {
    super('La sessione è scaduta: rifai l’accesso.');
    this.name = 'SessioneScaduta';
  }
}

/**
 * Quanto prima della scadenza si chiede una chiave nuova.
 *
 * Cinque minuti, e non zero, per una ragione misurata su questo progetto: una
 * sincronizzazione completa dura secondi, ma uno scarico Bluetooth seguito da un
 * allineamento può durare minuti. Rinnovare all'ultimo istante significa che la
 * chiave scade **a metà** di un'operazione lunga, che è il momento peggiore.
 */
export const MARGINE_RINNOVO_S = 300;

export interface OpzioniAccount {
  /** L'indirizzo del servizio, senza barra finale. */
  servizio: string;
  fetchImpl?: typeof fetch;
  /** Iniettabile per i test. */
  adessoS?: () => number;
}

async function chiedi(
  opzioni: OpzioniAccount,
  percorso: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const f = opzioni.fetchImpl ?? fetch;
  let risposta: Response;
  try {
    risposta = await f(`${opzioni.servizio}${percorso}`, init);
  } catch (err) {
    /*
     * Senza rete non si accede, e va detto così: «servizio non raggiungibile» è
     * un'informazione, «errore» no. E soprattutto NON è una sessione scaduta —
     * mandare al pulsante di accesso chi è semplicemente in barca senza campo
     * gli farebbe perdere la sessione che ha.
     */
    throw new Error(
      `Servizio di accesso non raggiungibile: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (risposta.status === 401) throw new SessioneScaduta();
  const dati = (await risposta.json().catch(() => ({}))) as Record<string, unknown>;
  if (!risposta.ok) {
    const detto = typeof dati.errore === 'string' ? dati.errore : `HTTP ${risposta.status}`;
    throw new Error(`Accesso non riuscito: ${detto}`);
  }
  return dati;
}

function leggiChiave(dati: Record<string, unknown>): ChiaveDatabase {
  const { url, chiave, scadeIlS } = dati;
  if (typeof url !== 'string' || typeof chiave !== 'string' || typeof scadeIlS !== 'number') {
    throw new Error('Il servizio ha risposto in un modo che non conosciamo.');
  }
  return { url, authToken: chiave, scadeIlS };
}

/**
 * Quello che finisce nel portachiavi sotto la voce `account`.
 *
 * Sono due campi e non uno perché la sessione da sola non basta a scrivere «sei
 * entrato come…»: dentro c'è un identificativo opaco, non un indirizzo. La
 * forma è dichiarata qui, accanto a chi la produce, così chi la legge non deve
 * indovinarla.
 */
export interface AccountSalvato {
  sessione: string;
  email: string | null;
}

/**
 * Legge la voce del portachiavi, accettando anche la forma vecchia.
 *
 * PERCHÉ IL RAMO SULLA STRINGA. Nella prima versione lì dentro c'era la sola
 * sessione, scritta come stringa. Chi ha fatto l'accesso prima di questo
 * cambiamento ha quella nel portachiavi, e trovarsi disconnessi dopo un
 * aggiornamento — dovendo rifare il giro col browser — è il genere di piccolo
 * tradimento che non vale i due rami di codice risparmiati. Il ramo costa poco
 * e si potrà togliere quando non ci sarà più nessuno con la forma vecchia.
 */
export function leggiAccountSalvato(
  valore: AccountSalvato | string | null | undefined,
): AccountSalvato | null {
  if (!valore) return null;
  if (typeof valore === 'string') return { sessione: valore, email: null };
  if (typeof valore.sessione !== 'string' || !valore.sessione) return null;
  return { sessione: valore.sessione, email: typeof valore.email === 'string' ? valore.email : null };
}

/**
 * Quello che l'app consegna al servizio per entrare.
 *
 * NON C'È NESSUN TOKEN QUI DENTRO. Il codice di autorizzazione è a uso singolo e
 * da solo non apre niente: senza il verificatore PKCE — che l'app ha generato e
 * tenuto per sé — e senza il segreto del client, che sta sul servizio, non si
 * scambia. Il token d'identità di Google l'app non lo vede mai.
 */
export interface CodiceDiRitorno {
  /** Quale delle nostre registrazioni ha iniziato il giro: iPhone o Mac. */
  clientId: string;
  codice: string;
  verificatore: string;
  /** Lo stesso punto di ritorno della prima richiesta, o Google rifiuta. */
  ritorno: string;
}

/** Primo accesso: si consegna il codice appena tornato, si riceve la sessione. */
export async function accedi(
  opzioni: OpzioniAccount,
  provider: Fornitore,
  ritorno: CodiceDiRitorno,
): Promise<EsitoAccesso> {
  const dati = await chiedi(opzioni, '/accesso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, ...ritorno }),
  });
  const sessione = dati.sessione;
  if (typeof sessione !== 'string' || !sessione) {
    throw new Error('Il servizio non ha restituito una sessione.');
  }
  // Un'email mancante non è un guasto: l'accesso è riuscito lo stesso, e
  // l'unica conseguenza è una frase in meno nelle impostazioni.
  const email = typeof dati.email === 'string' && dati.email ? dati.email : null;
  return { sessione, email, chiave: leggiChiave(dati) };
}

/** Una chiave nuova per il proprio database, partendo dalla sessione. */
export async function rinnovaChiave(opzioni: OpzioniAccount, sessione: string): Promise<ChiaveDatabase> {
  return leggiChiave(
    await chiedi(opzioni, '/chiave', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessione}` },
    }),
  );
}

/**
 * Cancella l'account: il database non esiste più.
 *
 * L'archivio LOCALE non viene toccato, ed è voluto: chi chiude l'account smette
 * di sincronizzare, non perde il proprio logbook. Cancellare anche quello
 * sarebbe una sorpresa irreversibile innescata da un pulsante che dice
 * un'altra cosa.
 */
export async function cancellaAccount(opzioni: OpzioniAccount, sessione: string): Promise<void> {
  await chiedi(opzioni, '/account', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${sessione}` },
  });
}

/**
 * Tiene la chiave valida, chiedendone una nuova solo quando serve.
 *
 * PERCHÉ UNA CLASSE E NON UNA FUNZIONE. Perché c'è uno stato da conservare fra
 * una chiamata e l'altra — la chiave in corso — e deve stare in memoria e in un
 * posto solo. Con una variabile globale due schede dell'interfaccia
 * chiederebbero due chiavi; con nessuna cache si chiederebbe una chiave a ogni
 * sincronizzazione, cioè si trasformerebbe un servizio da tre rotte in un
 * servizio da chiamare di continuo.
 */
export class ChiaviDelDatabase {
  private inCorso: ChiaveDatabase | null = null;
  private richiesta: Promise<ChiaveDatabase> | null = null;

  constructor(
    private readonly opzioni: OpzioniAccount,
    private readonly sessione: string,
  ) {}

  private adesso(): number {
    return this.opzioni.adessoS ? this.opzioni.adessoS() : Math.floor(Date.now() / 1000);
  }

  /** La chiave buona adesso: quella in memoria, o una nuova. */
  async valida(): Promise<SyncCredentials> {
    if (this.inCorso && this.inCorso.scadeIlS - MARGINE_RINNOVO_S > this.adesso()) {
      return { url: this.inCorso.url, authToken: this.inCorso.authToken };
    }
    /*
     * Una richiesta alla volta, anche se chiamano in dieci.
     *
     * All'avvio la sincronizzazione e la pagina delle impostazioni possono
     * chiedere la chiave nello stesso istante: senza questa promessa condivisa
     * partirebbero due richieste, il servizio emetterebbe due token, e il primo
     * resterebbe in giro fino alla scadenza senza che nessuno lo usi.
     */
    if (!this.richiesta) {
      this.richiesta = rinnovaChiave(this.opzioni, this.sessione)
        .then((chiave) => {
          this.inCorso = chiave;
          return chiave;
        })
        .finally(() => {
          this.richiesta = null;
        });
    }
    const chiave = await this.richiesta;
    return { url: chiave.url, authToken: chiave.authToken };
  }

  /**
   * Da chiamare quando il database rifiuta la chiave: la butta e ne chiede una.
   *
   * Serve perché le due scadenze non sono d'accordo per forza — l'orologio del
   * dispositivo può essere avanti, il token può essere stato revocato — e senza
   * questo l'app resterebbe convinta di avere una chiave valida fino al margine,
   * fallendo ogni sincronizzazione nel frattempo.
   */
  scarta(): void {
    this.inCorso = null;
  }
}
