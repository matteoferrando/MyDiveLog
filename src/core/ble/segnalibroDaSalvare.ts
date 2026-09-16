/**
 * QUANDO IL SEGNALIBRO SI PUÒ SPOSTARE — una sola regola, un solo posto.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► COS'È IL SEGNALIBRO, E PERCHÉ SBAGLIARLO NON SI RECUPERA. ◄
 *
 * I computer subacquei consegnano le immersioni **dalla più recente alla più
 * vecchia**, e il modo per non rileggere ogni volta tutta la memoria è dire al
 * prossimo scarico «fermati quando arrivi a questa». Quella «questa» è il
 * segnalibro: l'impronta dell'immersione più recente che abbiamo in archivio.
 *
 * Da cui la proprietà che questo file esiste per difendere: **il segnalibro può
 * spostarsi solo su un'immersione che è davvero in archivio, e solo se tutte
 * quelle sotto di lei ci sono già.** Spostarlo un passo più in là di così
 * significa dire «da qui in giù ce l'ho tutto» quando non è vero — e da quel
 * momento il computer non offrirà mai più quelle immersioni. Non c'è un errore
 * da leggere, non c'è un tasto per riprovare: c'è un logbook con un buco che
 * nessuno può vedere, perché *il segnalibro non perde i dati che hai, perde i
 * dati che non sai di non avere*.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ È UNA FUNZIONE, E NON UN `if` DENTRO LA SCHERMATA. ◄
 *
 * Perché per mesi è stato un `if`, e gli `if` erano due: uno sulla strada dei
 * driver di casa e uno su quella di libdivecomputer. Il primo chiedeva anche
 * che il salvataggio in archivio fosse andato bene; il secondo no — e nessuno
 * se ne era accorto, perché ognuno dei due era corretto guardandolo da solo.
 *
 * Il 15 settembre 2026 una rilettura dei due percorsi affiancati l'ha trovato:
 * con il disco pieno, `importDives` falliva, la schermata diceva «sono arrivate
 * ma non si sono potute salvare» — e il segnalibro si spostava lo stesso.
 *
 * *Due copie della stessa regola sono una regola e la sua versione vecchia.*
 * Da qui in avanti ce n'è una, e quando si impara qualcosa si impara per
 * entrambe le strade insieme.
 */

/** Cosa sa la schermata quando deve decidere. Tutti campi già misurati: qui non si deduce niente. */
export interface EsitoPerSegnalibro {
  /**
   * L'impronta dell'immersione più recente vista in questo scarico. Senza,
   * non c'è niente da scrivere: `undefined` non è «nessuna novità», è
   * «non so su cosa fermarmi».
   */
  impronta?: string;
  /**
   * Lo scarico è arrivato in fondo alla lista. `false` vuol dire che abbiamo
   * in mano le più recenti e NON le più vecchie: è il caso in cui il
   * segnalibro fa il danno peggiore.
   */
  completo: boolean;
  /**
   * L'archivio ha confermato la scrittura. Non «le immersioni sono arrivate»:
   * arrivate e salvate sono due cose diverse, e il segnalibro guarda la
   * seconda.
   */
  salvate: boolean;
  /**
   * Ogni record consegnato dal computer è diventato un'immersione. Quando il
   * traduttore ne scarta uno — un record senza data, o senza né profondità né
   * durata — l'impronta della più recente può essere proprio quella scartata,
   * e allora fermarsi lì salterebbe lei e tutte quelle sotto.
   */
  tutteTradotte: boolean;
}

/**
 * Vero solo se tutte e quattro le condizioni valgono. Non c'è un ordine di
 * importanza fra loro: ciascuna, da sola, basta a perdere dati per sempre.
 */
export function segnalibroDaSalvare(e: EsitoPerSegnalibro): e is EsitoPerSegnalibro & { impronta: string } {
  return Boolean(e.impronta) && e.completo && e.salvate && e.tutteTradotte;
}

/**
 * Perché NO — per il diario dello scarico, che è la cosa che leggeremo quando
 * qualcuno ci scriverà «mi mancano delle immersioni».
 *
 * Restituisce stringa vuota quando il segnalibro si salva: chi chiama scrive la
 * riga solo se qui esce qualcosa, così il diario non si riempie di righe che
 * dicono «tutto a posto».
 */
export function perchéNonSiSalva(e: EsitoPerSegnalibro): string {
  if (!e.completo) return 'segnalibro non salvato: lo scarico non è arrivato in fondo alla lista';
  if (!e.salvate) return "segnalibro non salvato: l'archivio non ha confermato la scrittura";
  if (!e.tutteTradotte)
    return 'segnalibro non salvato: almeno un record del computer non è diventato un’immersione';
  if (!e.impronta) return 'segnalibro non salvato: il computer non ha dato un’impronta su cui fermarsi';
  return '';
}

/**
 * QUANDO SI PUÒ OFFRIRE DI RIPARTIRE DA QUI — l'altra faccia della stessa regola.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► COS'È L'OFFERTA. ◄ Quando uno scarico si rompe a metà dopo aver portato a
 * casa qualcosa, la schermata propone: «vuoi che il prossimo scarico riparta da
 * qui invece di ricominciare dalla più recente?». Accettare **sposta il
 * segnalibro**, con tutte le conseguenze descritte in cima a questo file.
 *
 * ► PERCHÉ NON BASTA `segnalibroDaSalvare`. ◄ Perché `completo` qui è falso per
 * costruzione: l'offerta esiste proprio perché lo scarico NON è arrivato in
 * fondo. È l'unica condizione che cade, e cade perché è chi guarda a prendersi
 * la responsabilità di quel salto — consapevolmente, leggendo quante immersioni
 * sono entrate.
 *
 * Tutte le altre restano, e una in particolare mancava.
 *
 * ► IL DIFETTO MISURATO IL 16 SETTEMBRE 2026. ◄ La condizione nella schermata
 * era «c'è stato un guasto e qualcosa era arrivato». *Arrivato* — non entrato
 * in archivio. Con il disco pieno, `importDives` fallisce e la stessa schermata
 * scrive «sono arrivate ma non si sono potute salvare»; **sotto quel messaggio
 * compariva il riquadro che propone di ripartire da lì.** Accettandolo, il
 * segnalibro si sposta su un'immersione che in archivio non c'è, e il prossimo
 * scarico dice «niente di nuovo».
 *
 * *È lo stesso difetto che questo file è nato per chiudere il 15 settembre,
 * sopravvissuto nell'offerta manuale che stava a ottanta righe di distanza —
 * dentro la stessa funzione.* Il `if` era uno solo, quindi nessuno l'ha
 * cercato: la regola era una, ma il posto dove si applicava era due.
 */
export function offertaDiRipartire(e: EsitoPerSegnalibro): boolean {
  return Boolean(e.impronta) && e.salvate && e.tutteTradotte;
}

/**
 * Perché l'offerta non si fa. Stesse parole della funzione sorella, meno la
 * riga sulla lista incompleta — che qui è la premessa, non un ostacolo.
 */
export function perchéNonSiOffre(e: EsitoPerSegnalibro): string {
  if (!e.salvate) return "ripartenza non offerta: l'archivio non ha confermato la scrittura";
  if (!e.tutteTradotte)
    return 'ripartenza non offerta: almeno un record del computer non è diventato un’immersione';
  if (!e.impronta) return 'ripartenza non offerta: il computer non ha dato un’impronta su cui fermarsi';
  return '';
}
