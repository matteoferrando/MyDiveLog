/**
 * Lo scambio del codice con Google, fatto **qui** e non nell'applicazione.
 *
 * PERCHÉ SI È SPOSTATO. La prima versione scambiava il codice direttamente
 * dall'app, senza `client_secret`, e su iPhone funzionava. Sul Mac no:
 *
 *     Google non ha completato l'accesso: client_secret is missing.
 *
 * Non è un difetto nostro ed è inutile aggirarlo. Google assegna tipi diversi
 * di client, e le regole cambiano col tipo: quelli **iOS** non hanno segreto
 * (non avrebbe senso, il pacchetto è ispezionabile), quelli **Desktop app** ce
 * l'hanno e lo pretendono anche quando c'è PKCE. Il loopback su `127.0.0.1`,
 * che è la strada giusta sul Mac, esiste solo per i client di tipo Desktop.
 * Quindi: sul Mac serve un segreto.
 *
 * LE TRE STRADE, e perché questa.
 *
 * 1. *Mettere il segreto nell'app.* Google stesso dichiara che per le
 *    applicazioni installate non è confidenziale, ed è vero — ma finirebbe nel
 *    repository e in ogni copia del pacchetto, e «non è davvero un segreto» è
 *    una frase che invecchia male quando cambia chi legge il codice.
 * 2. *Usare il client iOS anche sul Mac,* con lo schema URL al posto della
 *    porta. Funzionerebbe, e costerebbe la sicurezza del ritorno: uno schema
 *    URL lo può rivendicare qualunque altro programma installato, una porta
 *    locale la tiene aperta solo questo processo.
 * 3. *Scambiare il codice qui.* Il segreto sta fra i segreti di Cloudflare,
 *    non è mai sul dispositivo, e l'app non tocca più nessun token di Google:
 *    manda un codice a uso singolo e riceve la propria sessione.
 *
 * La terza costa una rotta in più di rete e toglie un segreto da due posti.
 *
 * CONSEGUENZA CHE VALE LA PENA NOMINARE: adesso iPhone e Mac fanno la stessa
 * identica strada. Prima il telefono scambiava per conto suo e il computer no,
 * e una differenza del genere è esattamente il posto dove un difetto si nasconde
 * su una piattaforma sola — come è appena successo.
 */

const SCAMBIA = 'https://oauth2.googleapis.com/token';

export interface RichiestaScambio {
  clientId: string;
  /** Solo per i client che ne hanno uno: quelli iOS non lo mandano. */
  clientSecret?: string;
  codice: string;
  /** Il verificatore PKCE: è quello che lega il codice a chi ha iniziato il giro. */
  verificatore: string;
  /** Deve combaciare con quello della prima richiesta, o Google rifiuta. */
  ritorno: string;
}

/**
 * Restituisce il token d'identità, o `null` se Google non lo dà.
 *
 * `null` e non un'eccezione con dentro il messaggio di Google: il motivo per cui
 * uno scambio fallisce — codice già usato, verificatore sbagliato, client che
 * non combacia — è un'informazione utile a chi sta provando a indovinare e
 * inutile a chi ha semplicemente aspettato troppo. Il dettaglio finisce nel
 * registro del Worker, che non esce da qui.
 */
export async function scambiaCodiceGoogle(
  richiesta: RichiestaScambio,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const corpo = new URLSearchParams({
    client_id: richiesta.clientId,
    code: richiesta.codice,
    code_verifier: richiesta.verificatore,
    grant_type: 'authorization_code',
    redirect_uri: richiesta.ritorno,
  });
  // Niente campo vuoto quando il segreto non c'è: un `client_secret=` vuoto è
  // diverso da un `client_secret` assente, e Google lo rifiuta.
  if (richiesta.clientSecret) corpo.set('client_secret', richiesta.clientSecret);

  const risposta = await fetchImpl(SCAMBIA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo.toString(),
  });

  const dati = (await risposta.json().catch(() => ({}))) as { id_token?: unknown; error?: unknown };
  if (!risposta.ok) {
    console.error('scambio del codice rifiutato', risposta.status, dati.error);
    return null;
  }
  /*
   * Si tiene SOLO l'`id_token`. L'`access_token` che Google manda insieme
   * servirebbe a chiamare le sue API per conto della persona, e non ne chiamiamo
   * nessuna: tenerlo sarebbe una credenziale conservata senza motivo, e le
   * credenziali che non servono sono quelle che sfuggono.
   */
  return typeof dati.id_token === 'string' && dati.id_token ? dati.id_token : null;
}
