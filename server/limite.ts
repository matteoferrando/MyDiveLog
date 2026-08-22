/**
 * Il limite di frequenza, contato da noi.
 *
 * PERCHÉ NON QUELLO DI CLOUDFLARE. Il legame nativo `ratelimit` esiste, si
 * configura in tre righe, ed è stato provato: **non ha fermato niente.** Con un
 * limite dichiarato di 10 richieste al minuto, trentatré richieste dallo stesso
 * indirizzo nello stesso minuto hanno ricevuto tutte `success: true`. Non è un
 * difetto nascosto, è scritto nella sua documentazione — i contatori stanno nella
 * cache della macchina che esegue il Worker, si aggiornano in modo asincrono, e
 * l'API è «permissiva, coerente col tempo, e volutamente non pensata come
 * sistema di conteggio accurato».
 *
 * Per contare le visite va benissimo. Per difendere una rotta che chiama Google
 * e crea database, «volutamente non accurato» è la cosa sbagliata: il caso in cui
 * serve è esattamente quello in cui sbaglia.
 *
 * COME FUNZIONA QUESTO. Un Durable Object per chiave — cioè un oggetto per
 * indirizzo IP, non uno per tutti. Cloudflare garantisce che di quell'oggetto
 * esista **una sola istanza al mondo** e che le richieste ci arrivino una alla
 * volta: dentro, un contatore e una scadenza sono già abbastanza, e il conteggio
 * è esatto per costruzione, non per approssimazione.
 *
 * Un oggetto per chiave e non uno globale perché un contatore unico
 * serializzerebbe ogni accesso di ogni persona attraverso la stessa istanza:
 * corretto, e un collo di bottiglia messo apposta.
 *
 * NIENTE ARCHIVIO. Il contatore vive nella memoria dell'oggetto. Cloudflare può
 * spegnere un oggetto inattivo, e in quel caso il conteggio riparte da zero: nel
 * peggiore dei casi qualcuno ottiene una finestra in più. Scriverlo su disco
 * costerebbe una scrittura per ogni richiesta — cioè renderebbe la difesa più
 * cara dell'attacco.
 */

/**
 * La parte di un `DurableObjectNamespace` che ci serve davvero.
 *
 * Dichiarata qui, stretta, invece di prendere il tipo completo di Cloudflare:
 * così il codice che la usa si prova con venti righe di finzione, senza
 * accendere un Worker.
 */
export interface SpazioLimiti {
  idFromName(nome: string): unknown;
  get(id: unknown): { fetch(richiesta: Request): Promise<Response> };
}

export interface EsitoLimite {
  consentito: boolean;
  /** Fra quanti secondi la finestra si riapre. Va nell'intestazione `Retry-After`. */
  riprovaFraS: number;
}

/**
 * Il conteggio vero. Sta in una funzione a parte, senza niente attorno, perché
 * è la sola cosa di questo file che possa sbagliare — e così si prova da sola.
 */
export function conta(
  stato: { fino: number; conteggio: number },
  adessoMs: number,
  limite: number,
  finestraS: number,
): EsitoLimite {
  if (adessoMs >= stato.fino) {
    stato.fino = adessoMs + finestraS * 1000;
    stato.conteggio = 0;
  }
  stato.conteggio += 1;
  return {
    consentito: stato.conteggio <= limite,
    riprovaFraS: Math.max(1, Math.ceil((stato.fino - adessoMs) / 1000)),
  };
}

/**
 * L'oggetto che Cloudflare tiene in vita, uno per chiave.
 *
 * Volutamente stupido: riceve limite e finestra da chi chiama invece di
 * conoscerli. Le due rotte hanno tetti diversi, e un oggetto che li sapesse
 * dovrebbe essere due classi, due legami e due migrazioni per contare la stessa
 * cosa.
 */
export class LimiteFrequenza {
  private stato = { fino: 0, conteggio: 0 };

  async fetch(richiesta: Request): Promise<Response> {
    const { limite, finestraS } = (await richiesta.json()) as { limite: number; finestraS: number };
    const esito = conta(this.stato, Date.now(), limite, finestraS);
    return new Response(JSON.stringify(esito), { headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Chiede all'oggetto giusto se questa richiesta ci sta.
 *
 * `spazio` separa i contatori delle due rotte: senza, un dispositivo che rinnova
 * spesso la chiave consumerebbe il tetto dell'accesso, e viceversa.
 *
 * SE L'OGGETTO NON RISPONDE SI LASCIA PASSARE, ed è una scelta e non una
 * dimenticanza. Un guasto dell'infrastruttura del limite non deve diventare un
 * guasto del servizio: il danno di far entrare qualche richiesta in più è
 * piccolo e temporaneo, quello di bloccare tutti quanti perché un contatore non
 * risponde è grosso e immediato.
 */
export async function entroIlLimite(
  spazio: SpazioLimiti,
  ambito: string,
  chiave: string,
  limite: number,
  finestraS: number,
): Promise<EsitoLimite> {
  try {
    const oggetto = spazio.get(spazio.idFromName(`${ambito}:${chiave}`));
    const risposta = await oggetto.fetch(
      new Request('https://limite.interno/', {
        method: 'POST',
        body: JSON.stringify({ limite, finestraS }),
      }),
    );
    return (await risposta.json()) as EsitoLimite;
  } catch (err) {
    console.error('contatore non raggiungibile, si lascia passare', err);
    return { consentito: true, riprovaFraS: 0 };
  }
}
