/**
 * L'accesso con Google, incollato alla piattaforma.
 *
 * Il giro OAuth è lo stesso ovunque — quello sta in `googleAccesso.ts`, senza
 * sapere niente di Tauri — ma **il ritorno dal browser arriva in due modi
 * diversi**, e questo file esiste solo per quello.
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
 * In entrambi i casi la difesa è la stessa e sta altrove: `leggiRitorno`
 * confronta lo `state`. Questi due canali sono aperti per costruzione — chiunque
 * sul computer può bussare alla porta, qualunque app può rivendicare lo schema —
 * e quello che arriva senza uno `state` che combacia non viene guardato.
 */

import { accedi, type EsitoAccesso } from './account';
import { clientGoogle, ritornoDaAccesso, schemaRitornoIOS, SERVIZIO_ACCESSO } from './configurazione';
import { iniziaAccesso, leggiRitorno } from './googleAccesso';
import { inApp, suIOS } from '../piattaforma';

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
 * Il giro completo, dal pulsante alla sessione.
 *
 * L'ordine dei primi due passi non è indifferente sul Mac: l'ascoltatore va
 * aperto PRIMA di mandare la persona sul browser, altrimenti un accesso molto
 * rapido — password già salvata, consenso già dato — potrebbe tornare su una
 * porta che non c'è ancora.
 */
export async function accediConGoogle(): Promise<EsitoAccesso> {
  if (!inApp()) {
    throw new Error(
      'L’accesso funziona solo nell’applicazione: nel browser non c’è modo di ricevere il ritorno da Google.',
    );
  }

  const clientId = clientGoogle();

  let ritorno: string;
  if (suIOS()) {
    ritorno = `${schemaRitornoIOS()}:/accesso`;
  } else {
    const { invoke } = await import('@tauri-apps/api/core');
    const porta = await invoke<number>('apri_ritorno_accesso');
    ritorno = ritornoDaAccesso(porta);
  }

  const avvio = await iniziaAccesso(clientId, ritorno);
  const attesa = attendiRitorno();

  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(avvio.indirizzo);

  const indirizzo = await attesa;
  if (!indirizzo) {
    throw new Error('L’accesso non è stato completato. Riprova quando vuoi.');
  }

  const esito = leggiRitorno(indirizzo, avvio.state);
  if ('errore' in esito) throw new Error(esito.errore);

  /*
   * Il codice va al NOSTRO servizio, non a Google: è lì che sta il segreto del
   * client desktop, senza il quale Google rifiuta lo scambio. Quello che torna
   * indietro è già la sessione — l'app non vede mai un token di Google.
   */
  return accedi({ servizio: SERVIZIO_ACCESSO }, 'google', {
    clientId,
    codice: esito.codice,
    verificatore: avvio.verificatore,
    ritorno,
  });
}
