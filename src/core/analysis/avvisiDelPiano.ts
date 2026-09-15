/**
 * Gli avvisi dei due pianificatori, come modelli traducibili.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PER LA SESTA VOLTA IN UNA SETTIMANA, LO STESSO GUASTO. ◄
 *
 * Un testo che nasce in `core`, dove la lingua non si sa, e che veniva disegnato
 * **senza passare dal dizionario**. Prima il piano di miglioramento — novantuno
 * frasi rimaste in italiano. Poi le righe dell'avanzamento dello scarico. Poi le
 * avvertenze delle metriche. Poi la destinazione delle esportazioni, i mesi
 * degli assi, gli avvisi dell'inserimento a mano. Adesso questi: **trentatré
 * avvisi del pianificatore**, disegnati così come sono in cinque punti fra
 * `Planner.tsx` e `DecoPlan.tsx`.
 *
 * Con l'applicazione in inglese il riquadro diceva «Worth knowing:» e poi una
 * frase italiana intera. E non è una schermata qualsiasi: **qui il testo è una
 * regola di sicurezza** — PPO2 oltre il limite, END oltre i quaranta metri,
 * controdiffusione isobarica, GF99 all'uscita, orologio CNS, obbligo
 * decompressivo probabile. Chi legge l'app in inglese sta pianificando
 * un'immersione con avvisi che non può leggere.
 *
 * ► PERCHÉ NON BASTAVA AVVOLGERE LE FRASI IN `t()`. ◄ Perché sono tutte, o quasi,
 * **template literal con dei numeri dentro**:
 *
 *     `A ${depthM} m questa miscela supera il limite di PPO2 di ${maxPpo2} bar…`
 *
 * La chiave cambierebbe a ogni piano — «A 33.3 m…», «A 41 m…» — e nel dizionario
 * non ci sarebbe mai. È esattamente il difetto che ha tenuto fuori novantuno
 * frasi del piano di miglioramento per mesi. La cura è la stessa, ed è quella di
 * `core/frase.ts`: **il modello viaggia coi segnaposti, i numeri viaggiano a
 * parte, e la frase si compone dove la lingua si conosce**.
 *
 * ► PERCHÉ UN FILE A PARTE, E NON DENTRO `gasPlan.ts` E `deco.ts`. ◄ Perché una
 * prova possa **scorrerli tutti** e pretendere che ognuno abbia la sua voce nel
 * dizionario, con gli stessi segnaposti in tutte e due le lingue — la stessa
 * cura di `core/analysis/avvertenze.ts` e `core/ble/avanzamentoTesti.ts`. Sparsi
 * fra i due motori sarebbero raggiungibili solo con una ricerca a espressioni
 * regolari, e quella non vede quello nuovo che qualcuno aggiungerà domani.
 *
 * ► E PERCHÉ NON SI COMPONGONO QUI. ◄ Un avviso è `{ level, testo, valori }`, e
 * `testoAvvertenza` di `avvertenze.ts` lo compone senza sapere altro: la forma è
 * la stessa di un'`Avvertenza`, quindi il meccanismo è uno solo per tutta
 * l'applicazione invece di due che si somigliano. *Lo stesso motivo per cui
 * `avvertenzeComposte` è uscito dalla scheda dell'immersione.*
 *
 * ► LE COPPIE SINGOLARE/PLURALE E I RAMI OPZIONALI SONO MODELLI DISTINTI. ◄ Dove
 * la frase italiana cambiava verbo o aveva una coda condizionale — «, con 12
 * minuti sopra 1.4 bar» — ci sono due modelli interi invece di uno con un pezzo
 * cucito dentro. Chi traduce deve vedere la frase intera per poterla girare
 * nella propria lingua: in inglese quella coda può andare in un altro punto.
 */

// ---------------------------------------------------------------------------
// Il pianificatore del gas (`gasPlan.ts`)
// ---------------------------------------------------------------------------

/** Il tempo totale non basta nemmeno a risalire. `{0}` fondo, `{1}` soste, `{2}` quota, `{3}` minuti minimi. */
export const TEMPO_TOTALE_INSUFFICIENTE =
  'Il tempo totale non lascia nemmeno un minuto per risalire: {0} minuti di fondo più {1} di sosta riempiono già l’immersione. Per risalire da {2} m alla velocità massima consentita servono almeno {3} minuti in tutto.';

/** La risalita media supera il limite. `{0}` la velocità, `{1}` il limite, `{2}` i minuti minimi. */
export const RISALITA_TROPPO_VELOCE =
  'Con questi tempi la risalita viaggia a {0} m/min di media, oltre i {1} m/min raccomandati: porta il tempo totale ad almeno {2} minuti, o accorcia il fondo.';

/** La media chiesta non è compatibile col tempo. `{0}` media, `{1}` fondo, `{2}` quota, `{3}` e `{4}` il massimo. */
export const TEMPO_OLTRE_LA_MEDIA =
  'Con una media di {0} m su {1} minuti di fondo, il tempo massimo che puoi passare a {2} m è {3} minuti: oltre, il resto dell’immersione dovrebbe stare sopra la superficie per far tornare la media. Il piano usa {4}.';

/** La riserva fissa si mangia tutta la bombola. `{0}` i bar di riserva. */
export const RISERVA_FISSA_TROPPO_ALTA =
  'La riserva fissa di {0} bar è pari o superiore alla pressione di partenza: con questa bombola non resta gas da usare.';

/** Come sopra, ma con il gas minimo calcolato. `{0}` i bar. */
export const GAS_MINIMO_TROPPO_ALTO =
  'Il gas minimo per la risalita d’emergenza ({0} bar) è pari o superiore alla pressione di partenza: con questa bombola l’immersione non è pianificabile.';

/** La riserva fissa non scala con la quota. `{0}` la quota, `{1}` i bar. */
export const RISERVA_FISSA_NON_SCALA =
  'La riserva fissa non dipende dalla profondità: a {0} m gli stessi {1} bar durano molto meno che a 15 m. Sotto i 30 metri, o in due su una bombola, il gas minimo calcolato è la regola che risponde alla domanda giusta — si attiva qui sopra.';

/** Il gas basta per meno minuti di quelli chiesti. `{0}` quelli possibili, `{1}` quelli chiesti. */
export const GAS_PER_MENO_MINUTI =
  'Il gas basta per {0} minuti di fondo, non {1}: servono più litri, una pressione di partenza più alta, meno profondità o meno tempo.';

/** Il gas basta esattamente, senza margine. `{0}` i litri pianificati, `{1}` quelli disponibili. */
export const GAS_SENZA_MARGINE =
  'Il piano consuma tutto il gas utilizzabile senza lasciare margine: {0} L pianificati su {1} L disponibili oltre la riserva.';

/** La quota supera la MOD della miscela. `{0}` la quota, `{1}` il limite di PPO2, `{2}` la MOD. */
export const OLTRE_LA_MOD =
  'A {0} m questa miscela supera il limite di PPO2 di {1} bar che hai impostato sul computer: la profondità massima operativa è {2} m.';

/** Azoto oltre la fascia accettata. `{0}` la PPN2, `{1}` l'END. */
export const AZOTO_OLTRE_LA_FASCIA =
  'Pressione parziale dell’azoto {0} ata (END {1} m): oltre il limite superiore della fascia comunemente accettata, che va da 4.0 a 5.21 ata.';

/** Azoto dentro la fascia ma sopra i 4.0. `{0}` la PPN2, `{1}` l'END. */
export const AZOTO_SOPRA_QUATTRO =
  'Pressione parziale dell’azoto {0} ata (END {1} m): dentro la fascia accettata (4.0–5.21), ma sopra i 4.0 che la didattica indica come massimo in acqua fredda, buia o in ambiente ostruito.';

/** Esposizione CNS alta. `{0}` la percentuale. */
export const CNS_ALTO =
  'Esposizione all’ossigeno {0}% dell’orologio CNS: il limite è il 100% e va contato su tutte le immersioni della giornata, non solo su questa.';

/**
 * Come sopra, con i minuti sopra 1.4 bar. `{0}` la percentuale, `{1}` i minuti.
 *
 * Due modelli e non uno con la coda cucita dentro: in inglese quella coda può
 * andare in un altro punto della frase, e chi traduce deve vedere la frase
 * intera per poterla spostare.
 */
export const CNS_ALTO_CON_MINUTI =
  'Esposizione all’ossigeno {0}% dell’orologio CNS, con {1} minuti sopra 1.4 bar: il limite è il 100% e va contato su tutte le immersioni della giornata, non solo su questa.';

/** L'uscita prevista è sotto la riserva scelta. `{0}` l'uscita, `{1}` la riserva. */
export const USCITA_SOTTO_LA_RISERVA =
  'Uscita prevista a {0} bar, sotto la riserva di {1} bar che hai scelto: il piano consuma il gas che dovevi tenere da parte.';

/** L'uscita prevista è sotto il minimo assoluto. `{0}` l'uscita, `{1}` il minimo. */
export const USCITA_SOTTO_IL_MINIMO =
  'Uscita prevista a {0} bar, sotto la riserva di {1} bar: il piano non lascia margine per un imprevisto in superficie.';

/** Si pianifica col consumo del compagno. `{0}` il suo, `{1}` il tuo. */
export const CONSUMO_DEL_COMPAGNO =
  'Il piano usa il consumo del compagno ({0} L/min) invece del tuo ({1}): la didattica impone di pianificare sul respiro più alto della squadra, altrimenti è lui a girare prima e il piano non lo sa.';

/** La sosta è più profonda della quota di cambio. `{0}` la sosta, `{1}` la miscela, `{2}` la quota di cambio. */
export const SOSTA_SOTTO_IL_CAMBIO =
  'La sosta è a {0} m ma {1} si respira solo da {2} m in su: il piano paga le soste col gas di fondo. Sposta la sosta o cambia miscela di decompressione.';

/** Lo stage di deco non basta. `{0}` i bar richiesti, `{1}` i litri della bombola, `{2}` i litri di soste, `{3}` i bar dichiarati. */
export const STAGE_INSUFFICIENTE =
  'La bombola di decompressione non basta: servono {0} bar su {1} L ({2} L di soste × 1.5 di margine) e ne hai dichiarati {3}.';

/** Lo stage è ricco di ossigeno. `{0}` il nome della miscela, `{1}` la sua quota massima. */
export const STAGE_SERVIZIO_OSSIGENO =
  'Anche la bombola di decompressione ({0}) va pulita per il servizio ossigeno, e va etichettata con la sua profondità massima: {1} m.';

/** Il gas di fondo è oltre il 40% di ossigeno. `{0}` la percentuale. */
export const GAS_SERVIZIO_OSSIGENO =
  'Oltre il 40% di ossigeno serve attrezzatura pulita per il servizio ossigeno: erogatore, bombola e riempimento. Questa miscela è al {0}%.';

/** Profilo che con ogni probabilità prende un obbligo, e questo pianificatore non lo calcola. */
export const OBBLIGO_PROBABILE =
  'A questa profondità e con questo tempo di fondo un obbligo decompressivo è probabile: le soste vanno prese dal tuo piano o dal computer e inserite come minuti aggiuntivi, questo pianificatore non le calcola.';

// ---------------------------------------------------------------------------
// Il pianificatore della decompressione (`deco.ts`)
// ---------------------------------------------------------------------------

/** Nessun livello utilizzabile: il piano è vuoto perché non c'è niente da pianificare. */
export const NESSUN_LIVELLO =
  'Nessun livello utilizzabile: profondità o tempi mancanti, negativi o non numerici. Il piano qui sotto è vuoto perché non c’è niente da pianificare, non perché l’immersione non richieda soste.';

/** Profondità oltre il massimo pianificabile. `{0}` il limite, `{1}` la quota usata. */
export const OLTRE_IL_MASSIMO_PIANIFICABILE =
  'Profondità oltre i {0} m: il piano è stato calcolato a {1} m, che è già oltre il record mondiale a circuito aperto.';

/** Il ciclo della risalita non converge: qualcosa nei gas non torna. */
export const RISALITA_NON_CONVERGE =
  'La risalita non converge: con questi gas e questi gradient factor il modello non arriva in superficie. Controlla le miscele.';

/** PPO2 di decompressione oltre il limite. `{0}` la peggiore, `{1}` il limite. */
export const PPO2_DECO_OLTRE =
  'PPO2 fino a {0} bar in decompressione, oltre il limite di {1} che hai impostato.';

/** PPO2 di lavoro oltre il limite. `{0}` la peggiore, `{1}` il limite. */
export const PPO2_LAVORO_OLTRE =
  'PPO2 fino a {0} bar in fase di lavoro, oltre {1}: a questa quota non hai una miscela respirabile.';

/** PPO2 troppo BASSA: l'ipossica respirata dove non si può. `{0}` il valore, `{1}` la quota, `{2}` la soglia. */
export const PPO2_TROPPO_BASSA =
  'PPO2 di {0} bar a {1} m: sotto {2} la miscela non è respirabile. Per il tratto verso il fondo serve un gas di transito.';

/** END oltre i quaranta metri. `{0}` l'END peggiore. */
export const END_OLTRE_QUARANTA =
  'Profondità narcotica equivalente fino a {0} m: oltre i 40 m la didattica tecnica chiede l’elio.';

/** L'ossigeno del rebreather non basta. `{0}` i bar richiesti, `{1}` quelli disponibili. */
export const OSSIGENO_CCR_INSUFFICIENTE =
  'L’ossigeno del rebreather non basta: servono {0} bar su {1} disponibili.';

/** Un gas non basta. `{0}` l'etichetta, `{1}` i bar richiesti, `{2}` quelli disponibili. */
export const GAS_INSUFFICIENTE = 'Il gas {0} non basta: servono {1} bar su {2} disponibili.';

/** Un gas serve al piano ma la bombola è dichiarata vuota. `{0}` l'etichetta, `{1}` i litri. */
export const GAS_BOMBOLA_VUOTA = 'Il gas {0} serve al piano ({1} L) ma la bombola dichiarata è vuota.';

/** Controdiffusione isobarica. `{0}` la quota, `{1}` il gas lasciato, `{2}` quello preso, `{3}` l'azoto, `{4}` l'elio. */
export const CONTRODIFFUSIONE =
  'Controdiffusione a {0} m passando da {1} a {2}: l’azoto sale di {3} bar mentre l’elio scende di {4}. La regola dei quinti dice di non farlo.';

/** Si emerge oltre il valore M. `{0}` la percentuale. */
export const OLTRE_IL_VALORE_M =
  'Questo piano arriva in superficie al {0}% del valore M: oltre il cento per cento si emerge sopra il limite del modello, quali che siano i gradient factor impostati.';

/** GF99 all'uscita oltre il GF alto impostato. `{0}` il previsto, `{1}` l'impostato. */
export const GF99_OLTRE_IMPOSTATO =
  'GF99 previsto all’uscita {0}%, oltre il {1}% che hai impostato come GF alto.';

/** Orologio CNS oltre il cento per cento sulla singola esposizione. `{0}` la percentuale. */
export const CNS_OLTRE_IL_LIMITE = 'Orologio CNS al {0}%: oltre il limite per singola esposizione.';

/** Sopra 1.6 bar il CNS calcolato è una sottostima, e non si sa di quanto. */
export const CNS_FUORI_TABELLA =
  'Sopra 1.6 bar di PPO2 le tabelle NOAA non arrivano: il CNS qui sopra è calcolato come se fossero 1.6 bar, quindi è una SOTTOSTIMA. Il valore vero non lo sa nessuno, ed è la ragione per cui quel limite esiste.';

/** Oltre i quaranta metri senza nemmeno una sosta obbligata. */
export const QUARANTA_SENZA_SOSTE =
  'Oltre i 40 metri senza soste obbligate: verifica che il tuo computer, con i suoi gradient factor, sia d’accordo.';

/**
 * Tutti quanti, per la prova che li confronta col dizionario.
 *
 * Una costante nuova che non finisce in questo elenco sfugge alla guardia: è il
 * solo punto debole del meccanismo, ed è scritto qui perché chi aggiunge il
 * prossimo lo veda mentre lo fa.
 */
export const TESTI_DEGLI_AVVISI_DEL_PIANO = [
  TEMPO_TOTALE_INSUFFICIENTE,
  RISALITA_TROPPO_VELOCE,
  TEMPO_OLTRE_LA_MEDIA,
  RISERVA_FISSA_TROPPO_ALTA,
  GAS_MINIMO_TROPPO_ALTO,
  RISERVA_FISSA_NON_SCALA,
  GAS_PER_MENO_MINUTI,
  GAS_SENZA_MARGINE,
  OLTRE_LA_MOD,
  AZOTO_OLTRE_LA_FASCIA,
  AZOTO_SOPRA_QUATTRO,
  CNS_ALTO,
  CNS_ALTO_CON_MINUTI,
  USCITA_SOTTO_LA_RISERVA,
  USCITA_SOTTO_IL_MINIMO,
  CONSUMO_DEL_COMPAGNO,
  SOSTA_SOTTO_IL_CAMBIO,
  STAGE_INSUFFICIENTE,
  STAGE_SERVIZIO_OSSIGENO,
  GAS_SERVIZIO_OSSIGENO,
  OBBLIGO_PROBABILE,
  NESSUN_LIVELLO,
  OLTRE_IL_MASSIMO_PIANIFICABILE,
  RISALITA_NON_CONVERGE,
  PPO2_DECO_OLTRE,
  PPO2_LAVORO_OLTRE,
  PPO2_TROPPO_BASSA,
  END_OLTRE_QUARANTA,
  OSSIGENO_CCR_INSUFFICIENTE,
  GAS_INSUFFICIENTE,
  GAS_BOMBOLA_VUOTA,
  CONTRODIFFUSIONE,
  OLTRE_IL_VALORE_M,
  GF99_OLTRE_IMPOSTATO,
  CNS_OLTRE_IL_LIMITE,
  CNS_FUORI_TABELLA,
  QUARANTA_SENZA_SOSTE,
] as const;
