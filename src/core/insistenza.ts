/**
 * Quante volte, e in che modo, si riprova da soli quando uno scarico fallisce.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► «RIPROVA» NON È UNA COSA SOLA: SONO DUE, E SONO OPPOSTE. ◄
 *
 * Fino a ieri, quando uno scarico non riusciva, l'applicazione offriva un
 * pulsante — «Riprova con un altro modo» — e cambiava combinazione. Sembra la
 * cosa generosa da fare, e in metà dei casi è **esattamente quella sbagliata**.
 *
 * Perché uno scarico fallito può voler dire due cose che non si somigliano:
 *
 *  - **non è arrivato niente.** Il metodo è sbagliato: stiamo scrivendo sulla
 *    caratteristica che non ascolta, o in una modalità che quel GATT non
 *    gradisce. Insistere uguale è inutile — va cambiato metodo.
 *  - **è arrivato tanto, e poi si è rotto.** Il metodo è *giusto*, l'ha appena
 *    dimostrato muovendo dei byte veri. Quello che si è rotto è il
 *    collegamento. Qui cambiare metodo è il danno: si abbandona l'unica
 *    combinazione che si sa funzionare per provarne una che non ha mai
 *    funzionato — e, se per caso quella "riesce" a portare a casa
 *    un'immersione sola, la si conserva pure per le volte dopo.
 *
 * I due diari veri del 9 settembre 2026 sono tutti e due il secondo caso, dallo
 * stesso telefono e dallo stesso Mares: **276 KB** ricevuti prima che una
 * conferma di scrittura scadesse, e **25 775 byte** prima di un errore di
 * protocollo. In tutte e due le occasioni l'applicazione ha offerto «prova un
 * altro modo», cioè ha consigliato di buttare via il metodo che funzionava.
 *
 * La domanda che separa i due casi è una sola e si può misurare: **il computer
 * ha risposto?** Da lì scende tutto il resto.
 */

/** Quanti tentativi automatici in tutto, prima di lasciare la parola a chi guarda. */
export const TENTATIVI_AUTOMATICI = 5;

/**
 * Quante volte di fila si riprova con lo STESSO metodo, quando ha dimostrato
 * di funzionare.
 *
 * Due, e il numero è una scelta fra due danni. Troppo pochi: si passa a un
 * altro metodo per una perdita di pacchetti passeggera, che è il difetto che
 * questo modulo esiste per togliere. Troppi: chi ha il computer in mano aspetta
 * cinque scarichi da tre minuti l'uno per sentirsi dire la stessa cosa, con la
 * batteria che cala. *Due è il punto in cui un guasto passeggero è quasi sempre
 * già passato e uno stabile non si è ancora fatto pagare troppo.*
 */
export const RIPROVE_STESSO_METODO = 2;

/** Com'è andato il tentativo appena finito. */
export type EsitoTentativo = {
  /** Almeno un'immersione è entrata in archivio. */
  riuscito: boolean;
  /**
   * Il computer ha risposto qualcosa: **il metodo funziona**.
   *
   * Non «lo scarico è andato bene»: proprio «da quella caratteristica sono
   * arrivate delle notifiche». È la sola prova che la combinazione di servizio,
   * caratteristiche e modalità è quella giusta.
   */
  haRisposto: boolean;
  /** Il metodo in corso, se il ponte è arrivato ad aprirlo. */
  metodo?: { indice: number; totale: number };
  /**
   * Da quale metodo era partito questo tentativo, se lo sappiamo.
   *
   * Serve nel caso in cui il ponte non si è nemmeno aperto — un collegamento
   * caduto prima di tutto — e quindi `metodo` non c'è: per riprovare «uguale»
   * bisogna sapere da dove si era partiti.
   */
  partitoDa?: number;
  /** Quanti tentativi automatici sono già stati spesi per questo scarico. */
  fatti: number;
  /** Quante volte di fila si è già riprovato con lo stesso metodo. */
  stesso: number;
  /** La persona ha chiesto di smettere. */
  fermato: boolean;
};

/** Che cosa fare adesso. */
export type Insistenza =
  | { cosa: 'smetti'; perche: string }
  | {
      cosa: 'stesso-metodo' | 'altro-metodo';
      /** Quale metodo provare. `undefined` vuol dire «quello che decidi tu», come al primo colpo. */
      tentativo: number | undefined;
      /** Lo stato da portarsi dietro nel tentativo successivo. */
      fatti: number;
      stesso: number;
    };

/**
 * Decide se e come riprovare.
 *
 * È una funzione pura apposta: la scelta fra «uguale» e «un altro» è la parte
 * che conta di tutta questa faccenda, e va potuta provare senza un Bluetooth,
 * senza un computer subacqueo e senza un browser.
 */
export function decidiComeInsistere(esito: EsitoTentativo): Insistenza {
  // Un'immersione arrivata chiude la partita: da qui in poi si conserva il
  // metodo e non si tocca più niente.
  if (esito.riuscito) return { cosa: 'smetti', perche: 'riuscito' };

  // ► LA VOLONTÀ DELLA PERSONA BATTE QUALUNQUE REGOLA. ◄ Se ha premuto
  // «Interrompi», insistere da soli è il modo più sicuro di far chiudere
  // l'applicazione — e un'app chiusa non lascia nemmeno il diario.
  if (esito.fermato) return { cosa: 'smetti', perche: 'fermato' };

  if (esito.fatti >= TENTATIVI_AUTOMATICI) {
    return { cosa: 'smetti', perche: 'troppi tentativi' };
  }

  /*
   * ► IL METODO HA RISPOSTO: SI RIPROVA UGUALE. ◄ Questa riga sta PRIMA di
   * quella che cambia metodo, ed è tutto il punto del modulo. Invertirle
   * vorrebbe dire, davanti a un computer che ha appena mandato 276 KB,
   * scegliere di parlargli in un altro modo.
   */
  if (esito.haRisposto && esito.stesso < RIPROVE_STESSO_METODO) {
    return {
      cosa: 'stesso-metodo',
      tentativo: esito.metodo?.indice ?? esito.partitoDa,
      fatti: esito.fatti + 1,
      stesso: esito.stesso + 1,
    };
  }

  // Il metodo non ha dimostrato niente (o l'abbiamo già ripetuto abbastanza):
  // si passa al prossimo dell'elenco, se c'è.
  if (esito.metodo && esito.metodo.indice + 1 < esito.metodo.totale) {
    return {
      cosa: 'altro-metodo',
      tentativo: esito.metodo.indice + 1,
      fatti: esito.fatti + 1,
      stesso: 0,
    };
  }

  /*
   * Nessun metodo aperto: il collegamento è caduto prima ancora di scegliere
   * come parlare. Il guscio Rust ci ha già provato tre volte da solo,
   * scollegando fra un tentativo e l'altro; da qui si concede **un** giro
   * intero in più, perché ripartire da zero ricrea anche le condizioni che il
   * ritentativo interno non può ricreare (una scansione nuova, uno stato del
   * sistema diverso). Uno solo: se anche quello cade, il computer è spento,
   * lontano, o già collegato a qualcos'altro — e nessuna insistenza lo
   * accende.
   */
  if (!esito.metodo && esito.stesso < 1) {
    return {
      cosa: 'stesso-metodo',
      tentativo: esito.partitoDa,
      fatti: esito.fatti + 1,
      stesso: esito.stesso + 1,
    };
  }

  return { cosa: 'smetti', perche: 'niente altro da provare' };
}
