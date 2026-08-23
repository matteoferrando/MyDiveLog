/**
 * L'accesso, incollato alla piattaforma. Vale per tutti e due i fornitori.
 *
 * Il giro OAuth è lo stesso ovunque — quello sta in `googleAccesso.ts` e in
 * `appleAccesso.ts`, senza che nessuno dei due sappia niente di Tauri — ma **il
 * ritorno dal browser arriva in due modi diversi**, e questo file esiste solo
 * per quello.
 *
 * | | Mac | iPhone |
 * |---|---|---|
 * | dove torna | porta su `127.0.0.1` | schema URL dell'app |
 * | chi ascolta | un ascoltatore nel guscio Rust | il plugin dei deep link |
 * | quanto dura | il tempo di un accesso | permanente |
 *
 * PERCHÉ NON LO STESSO MECCANISMO SU ENTRAMBE. Sul Mac il loopback è meglio: lo
 * schema URL si registra nel sistema e qualunque altro programma può
 * rivendicare lo stesso, mentre una porta la tiene aperta questo processo e
 * nessun altro, per il tempo di un accesso. Su iPhone il loopback non è
 * praticabile: aprendo il browser l'applicazione va in secondo piano e il
 * sistema può sospenderla, quindi la porta non risponderebbe più. Le due strade
 * non sono un capriccio, sono quello che ciascun sistema permette.
 *
 * In entrambi i casi la difesa è la stessa e sta altrove: `leggiRitorno` (o
 * `leggiRitornoApple`) confronta lo `state`. Questi due canali sono aperti per
 * costruzione — chiunque sul computer può bussare alla porta, qualunque app può
 * rivendicare lo schema — e quello che arriva senza uno `state` che combacia non
 * viene guardato.
 *
 * IL FORNITORE È UN PARAMETRO, e non due funzioni copiate. Quello che cambia fra
 * Apple e Google sono tre righe — come si costruisce l'indirizzo, quale schema
 * URL usa l'iPhone, cosa si consegna alla rotta `/accesso` — mentre tutto il
 * resto (aprire l'ascoltatore PRIMA del browser, l'attesa con la scadenza, il
 * rifiuto fuori dall'applicazione) è identico e va sbagliato una volta sola.
 */

import { accedi, type EsitoAccesso, type Fornitore } from './account';
import { iniziaAccessoApple, leggiRitornoApple } from './appleAccesso';
import {
  APPLE_RITORNO_REGISTRATO,
  APPLE_SERVICES_ID,
  clientGoogle,
  destinazioneApple,
  ritornoDaAccesso,
  SERVIZIO_ACCESSO,
} from './configurazione';
import { iniziaAccesso, leggiRitorno } from './googleAccesso';
import { inApp, suIOS } from '../piattaforma';
import { comeSta, type Traduci } from '../core/traduci';

/** Quanto si aspetta il ritorno prima di rinunciare, lato interfaccia. */
const ATTESA_MS = 300_000;

/**
 * Aspetta che il browser riconsegni l'indirizzo di ritorno.
 *
 * Restituisce `null` quando l'attesa scade: un accesso abbandonato — la
 * finestra chiusa, il telefono messo in tasca — non deve lasciare l'interfaccia
 * a girare per sempre su «attendo…».
 */
async function attendiRitorno(): Promise<string | null> {
  const { listen } = await import('@tauri-apps/api/event');

  return new Promise<string | null>((risolvi) => {
    let chiuso = false;
    const finisci = (valore: string | null) => {
      if (chiuso) return;
      chiuso = true;
      clearTimeout(scadenza);
      void spegni.then((f) => f());
      risolvi(valore);
    };

    const scadenza = setTimeout(() => finisci(null), ATTESA_MS);

    const spegni = suIOS()
      ? import('@tauri-apps/plugin-deep-link').then(({ onOpenUrl }) =>
          onOpenUrl((indirizzi) => finisci(indirizzi[0] ?? null)),
        )
      : listen<string>('accesso-ritorno', (evento) => {
          // Il guscio Rust manda una stringa vuota quando la sua attesa scade:
          // è un «nessuno è tornato», non un indirizzo da leggere.
          finisci(evento.payload || null);
        });
  });
}

/**
 * Apre la strada del ritorno e dice dove sarà.
 *
 * SUL MAC L'ORDINE NON È INDIFFERENTE: l'ascoltatore va aperto PRIMA di mandare
 * la persona sul browser, altrimenti un accesso molto rapido — password già
 * salvata, consenso già dato — potrebbe tornare su una porta che non c'è ancora.
 * Per questo la porta si chiede qui, all'inizio, e non quando serve l'indirizzo.
 *
 * Su iPhone lo schema dipende dal fornitore: Google impone il proprio
 * («reversed client id»), mentre con Apple il rimbalzo lo fa il nostro Worker e
 * lo schema lo scegliamo noi.
 */
async function apriRitorno(fornitore: Fornitore): Promise<string> {
  /*
   * Su iPhone non c'è nessuna porta da aprire — il ritorno arriva da uno schema
   * URL — e il numero che si passa qui sotto non viene guardato. Lo zero non è
   * un valore finto da interpretare: è «non pertinente su questa piattaforma»,
   * ed è la stessa forma che `ritornoDaAccesso` ha sempre avuto.
   */
  let porta = 0;
  if (!suIOS()) {
    const { invoke } = await import('@tauri-apps/api/core');
    porta = await invoke<number>('apri_ritorno_accesso');
  }
  return fornitore === 'apple' ? destinazioneApple(porta) : ritornoDaAccesso(porta);
}

/**
 * Il giro completo, dal pulsante alla sessione.
 *
 * I due rami si separano tardi apposta: l'ascoltatore, l'apertura del browser e
 * l'attesa con la scadenza sono gli stessi, e sono la parte in cui si sbaglia.
 * Quello che cambia è come si costruisce l'indirizzo di autorizzazione e cosa si
 * consegna alla rotta `/accesso` — con Apple niente verificatore, perché PKCE
 * nel giro web non c'è, e niente punto di ritorno, perché lo conosce il Worker.
 */
export async function accediConFornitore(fornitore: Fornitore, t: Traduci = comeSta): Promise<EsitoAccesso> {
  if (!inApp()) {
    throw new Error(
      t(
        'L’accesso funziona solo nell’applicazione: nel browser non c’è modo di ricevere il ritorno dal fornitore.',
      ),
    );
  }

  const ritorno = await apriRitorno(fornitore);

  if (fornitore === 'apple') {
    /*
     * Il punto di ritorno che Apple conosce è il Worker, non `ritorno`: quello
     * viaggia dentro lo `state` ed è dove il Worker rimbalzerà il browser dopo
     * aver ricevuto la POST. Vedi `src/sync/appleAccesso.ts`.
     */
    const avvio = iniziaAccessoApple(APPLE_SERVICES_ID, APPLE_RITORNO_REGISTRATO, ritorno);
    const indirizzo = await conBrowser(avvio.indirizzo, t);
    const esito = leggiRitornoApple(indirizzo, avvio.state);
    if ('errore' in esito) throw new Error(esito.errore);
    return accedi({ servizio: SERVIZIO_ACCESSO, t }, 'apple', {
      codice: esito.codice,
      utente: esito.utente,
    });
  }

  const clientId = clientGoogle();
  const avvio = await iniziaAccesso(clientId, ritorno);
  const indirizzo = await conBrowser(avvio.indirizzo, t);
  const esito = leggiRitorno(indirizzo, avvio.state);
  if ('errore' in esito) throw new Error(esito.errore);

  /*
   * Il codice va al NOSTRO servizio, non a Google: è lì che sta il segreto del
   * client desktop, senza il quale Google rifiuta lo scambio. Quello che torna
   * indietro è già la sessione — l'app non vede mai un token di Google.
   */
  return accedi({ servizio: SERVIZIO_ACCESSO, t }, 'google', {
    clientId,
    codice: esito.codice,
    verificatore: avvio.verificatore,
    ritorno,
  });
}

/**
 * Apre il browser e restituisce l'indirizzo con cui si è tornati.
 *
 * L'attesa parte PRIMA dell'apertura, per la stessa ragione per cui
 * l'ascoltatore si apre prima ancora: fra il momento in cui il browser si apre e
 * quello in cui si comincia ad ascoltare non ci deve stare niente, o un accesso
 * istantaneo torna a vuoto.
 */
async function conBrowser(indirizzoAutorizzazione: string, t: Traduci): Promise<string> {
  const attesa = attendiRitorno();
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(indirizzoAutorizzazione);

  const indirizzo = await attesa;
  if (!indirizzo) throw new Error(t('L’accesso non è stato completato. Riprova quando vuoi.'));
  return indirizzo;
}
