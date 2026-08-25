/**
 * Il catalogo delle didattiche e dei loro brevetti.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ ESISTE. ◄
 *
 * Il campo «brevetto» era testo libero, e il testo libero su un dato del genere
 * produce archivi che non si possono leggere: «Advanced», «AOW», «Advanced Open
 * Water Diver», «advanced padi» sono la stessa cosa scritta in quattro modi, e
 * nessuno dei quattro dice fino a che profondità quella persona sia addestrata.
 * Da qui in poi si sceglie la didattica, e poi il brevetto FRA I SUOI: il nome
 * è quello vero, e con il nome arrivano i fatti che la didattica dichiara.
 *
 * ► LA REGOLA CHE VALE PIÙ DI TUTTE: NON SI INVENTANO NUMERI. ◄
 *
 * `profonditaM` è `undefined` per un brevetto su tre, e non è una svista. Un
 * Enriched Air non parla di profondità: il limite lo dà la miscela, non il
 * brevetto. Un Rescue Diver non autorizza a scendere più giù di prima. Un
 * Divemaster PADI non ha un limite proprio pubblicato. In tutti questi casi
 * mettere «40» perché è il tetto ricreativo sarebbe scrivere, nel logbook di
 * qualcuno, un'autorizzazione che nessuno gli ha dato. **Dove la didattica tace,
 * qui c'è `undefined` e a schermo non compare niente.**
 *
 * Vale anche al contrario: i numeri che ci sono vengono dagli standard
 * ufficiali, non dal senso comune. Tre esempi che il senso comune sbaglia:
 *
 *  - **CMAS ha riscritto gli standard nel 2023-2024.** Il Two Star era 40 m e
 *    adesso è 30; il Three Star era 56 m ed è 40, e ha smesso di essere un
 *    livello di conduzione. I valori vecchi sono ancora ovunque in rete, e
 *    persino su una pagina divulgativa di cmas.org.
 *  - **FIPSAS non è un alias di CMAS.** Sono equipollenti ma i metri no: P1 = 18
 *    contro 20, P3 = 42 contro 40. Sono due voci separate apposta.
 *  - **RAID ha rinominato il brevetto base.** Non è più «Open Water 20» a 20 m:
 *    è «Open Water» a 18 m. Il vecchio nome resta fra gli alias, ma con i metri
 *    giusti.
 *
 * ► PERCHÉ IL LIVELLO E LA PROFONDITÀ SONO DUE CAMPI. ◄
 *
 * `livello` è il nostro scalino — cinque gradini che valgono per tutte le
 * didattiche — e serve a rispondere «fin dove sei addestrato» quando i brevetti
 * vengono da tre scuole diverse. `profonditaM` è quello che dichiara QUELLA
 * didattica per QUEL brevetto. Un CMAS One Star e un PADI Open Water sono
 * tutti e due `base`, ma uno dice 20 metri e l'altro 18. Tenere un campo solo
 * vorrebbe dire scegliere quale delle due verità buttare.
 *
 * ► E PERCHÉ IL RUOLO È UN TERZO CAMPO. ◄
 *
 * Soccorso, guida, istruttore non sono scalini di profondità: un Rescue Diver
 * non scende più giù di prima. Metterli nella stessa classifica dei metri è
 * esattamente l'errore che l'applicazione ha già fatto una volta con il Nitrox,
 * quando rispondeva «Nitrox» a chi chiedeva fin dove fosse addestrato. Due assi,
 * due domande, due risposte.
 *
 * ► LE FONTI. ◄ Ogni didattica porta la sua. Dove lo standard ufficiale è
 * scaricabile — TDI, GUE, NAUI, SDI, CMAS, FIPSAS — i numeri vengono da lì.
 * Dove la didattica pubblica solo le pagine dei corsi — PADI, IANTD, RAID, PSAI,
 * NADD — vengono da quelle, che sono ufficiali ma più sintetiche: è il motivo per cui
 * lì i campi vuoti sono di più.
 */

import type { CertLevel, RuoloBrevetto } from './gear';

/** Una voce del catalogo: un brevetto di una didattica. */
export interface BrevettoCatalogo {
  /**
   * Il nome ufficiale, SENZA la sigla della didattica davanti.
   *
   * «Deep Diver», non «PADI Deep Diver»: la didattica si aggiunge al disegno,
   * così la stessa voce si scrive una volta sola e l'elenco resta leggibile.
   */
  nome: string;
  /** Il nostro scalino, quello che vale fra didattiche diverse. */
  livello: CertLevel;
  /** Cosa aggiunge oltre alla profondità. Assente per i brevetti di sola profondità. */
  ruolo?: RuoloBrevetto;
  /**
   * La profondità che QUESTA didattica dichiara per QUESTO brevetto, in metri.
   *
   * `undefined` quando la didattica non la dichiara — ed è il caso di un
   * brevetto su tre. Vedi il commento in testa al file: qui non si inventa.
   */
  profonditaM?: number;
  /** Vero se il brevetto prevede immersioni con decompressione pianificata. */
  decompressione?: boolean;
  /**
   * Nomi vecchi o alternativi.
   *
   * Servono a ritrovare un brevetto già salvato quando la didattica cambia
   * nome a un corso — è successo a RAID con «Open Water 20» — senza che chi
   * l'aveva scelto se lo veda sparire dalla tendina.
   */
  alias?: string[];
}

/** Una didattica, con la sua scala. */
export interface Didattica {
  /**
   * L'identificativo stabile. NON si cambia mai.
   *
   * Finisce nell'archivio e nei backup: rinominarlo scollegherebbe i brevetti
   * già salvati dalla loro didattica. È la stessa regola degli `id` degli
   * obiettivi del Coach: un'etichetta si cambia, una chiave d'archivio no.
   */
  id: string;
  /** La sigla, quella che si legge nella tendina e che finisce sul libretto. */
  sigla: string;
  /** Il nome per esteso, per chi la sigla non la conosce. */
  nome: string;
  tipo: 'ricreativa' | 'tecnica';
  /** Da dove vengono i dati, in chiaro: chi controlla deve poterlo fare. */
  fonte: string;
  brevetti: BrevettoCatalogo[];
}

/** L'identificativo della voce «Altro»: nome e campi liberi. */
export const DIDATTICA_ALTRO = 'altro';

// ---------------------------------------------------------------------------
// Le didattiche ricreative
// ---------------------------------------------------------------------------

const PADI: Didattica = {
  id: 'padi',
  sigla: 'PADI',
  nome: 'Professional Association of Diving Instructors',
  tipo: 'ricreativa',
  fonte: 'padi.com e blog.padi.com, agosto 2026',
  brevetti: [
    { nome: 'Scuba Diver', livello: 'intro', profonditaM: 12 },
    { nome: 'Open Water Diver', livello: 'base', profonditaM: 18 },
    { nome: 'Adventure Diver', livello: 'base' },
    {
      nome: 'Advanced Open Water Diver',
      livello: 'advanced',
      profonditaM: 30,
      alias: ['AOWD', 'Advanced Open Water'],
    },
    // Il Deep Diver è la specialità che porta al tetto ricreativo: 40 m.
    { nome: 'Deep Diver', livello: 'deep', profonditaM: 40 },
    // Non dichiara profondità: il limite lo dà la miscela, non il brevetto.
    { nome: 'Enriched Air Diver', livello: 'nitrox', alias: ['Nitrox Diver', 'Enriched Air (Nitrox) Diver'] },
    { nome: 'Rescue Diver', livello: 'base', ruolo: 'soccorso' },
    // Riconoscimento, non corso: la profondità resta quella dei brevetti che lo compongono.
    { nome: 'Master Scuba Diver', livello: 'advanced' },
    { nome: 'Divemaster', livello: 'advanced', ruolo: 'guida' },
    { nome: 'Assistant Instructor', livello: 'advanced', ruolo: 'assistente' },
    {
      nome: 'Open Water Scuba Instructor',
      livello: 'advanced',
      ruolo: 'istruttore',
      alias: ['OWSI', 'Instructor'],
    },
    { nome: 'Master Scuba Diver Trainer', livello: 'advanced', ruolo: 'istruttore' },
    { nome: 'IDC Staff Instructor', livello: 'advanced', ruolo: 'istruttore' },
    { nome: 'Master Instructor', livello: 'advanced', ruolo: 'istruttore' },
    { nome: 'Course Director', livello: 'advanced', ruolo: 'istruttore' },
    // ── la linea tecnica TecRec, che resta PADI ──────────────────────────────
    { nome: 'Tec 40', livello: 'tech', profonditaM: 40, decompressione: true },
    { nome: 'Tec 45', livello: 'tech', profonditaM: 45, decompressione: true },
    { nome: 'Tec 50', livello: 'tech', profonditaM: 50, decompressione: true },
    { nome: 'Tec Trimix 65', livello: 'tech', profonditaM: 65, decompressione: true },
    { nome: 'Tec Trimix', livello: 'tech', profonditaM: 90, decompressione: true },
    { nome: 'Tec 40 CCR', livello: 'tech', profonditaM: 40, decompressione: true },
    { nome: 'Tec 60 CCR', livello: 'tech', profonditaM: 60, decompressione: true },
    { nome: 'Tec 100 CCR', livello: 'tech', profonditaM: 100, decompressione: true },
  ],
};

const SSI: Didattica = {
  id: 'ssi',
  sigla: 'SSI',
  nome: 'Scuba Schools International',
  tipo: 'ricreativa',
  fonte: 'training.divessi.com (standard EMS) e divessi.com, agosto 2026',
  brevetti: [
    { nome: 'Scuba Diver', livello: 'intro', profonditaM: 12 },
    { nome: 'Open Water Diver', livello: 'base', profonditaM: 18 },
    { nome: 'Advanced Adventurer', livello: 'advanced', profonditaM: 30 },
    { nome: 'Deep Diving', livello: 'deep', profonditaM: 40, alias: ['Deep Diver'] },
    // SSI ha DUE brevetti nitrox distinti, per percentuale massima.
    { nome: 'Enriched Air Nitrox 32', livello: 'nitrox', alias: ['Enriched Air Nitrox'] },
    { nome: 'Enriched Air Nitrox 40', livello: 'nitrox' },
    {
      nome: 'Diver Stress & Rescue',
      livello: 'base',
      ruolo: 'soccorso',
      alias: ['Stress & Rescue', 'Diver Stress and Rescue'],
    },
    // Negli standard SSI è un RICONOSCIMENTO, non un corso: nessuna profondità propria.
    { nome: 'Advanced Open Water Diver', livello: 'advanced' },
    { nome: 'Master Diver', livello: 'advanced' },
    { nome: 'Dive Guide', livello: 'deep', profonditaM: 40, ruolo: 'guida' },
    { nome: 'Divemaster', livello: 'deep', profonditaM: 40, ruolo: 'guida' },
    { nome: 'Assistant Instructor', livello: 'deep', profonditaM: 40, ruolo: 'assistente' },
    { nome: 'Open Water Instructor', livello: 'deep', profonditaM: 40, ruolo: 'istruttore' },
    { nome: 'Instructor Trainer', livello: 'deep', ruolo: 'istruttore' },
    // ── la linea XR, Extended Range ─────────────────────────────────────────
    { nome: 'Extended Range Foundations', livello: 'advanced' },
    { nome: 'Extended Range Nitrox Diving', livello: 'tech', profonditaM: 40, decompressione: true },
    { nome: 'Extended Range', livello: 'tech', profonditaM: 45, decompressione: true },
    { nome: 'Technical Extended Range', livello: 'tech', profonditaM: 60, decompressione: true },
    { nome: 'Hypoxic Trimix', livello: 'tech', profonditaM: 100, decompressione: true },
  ],
};

const CMAS: Didattica = {
  id: 'cmas',
  sigla: 'CMAS',
  nome: 'Confédération Mondiale des Activités Subaquatiques',
  tipo: 'ricreativa',
  fonte: 'cmas.org, standard 2023-2024 (BOD 204, 208, 223, 233)',
  brevetti: [
    // ATTENZIONE ai numeri: sono quelli degli standard 2023-2024, non quelli
    // che circolano in rete. Il Two Star era 40 m fino al 2013, adesso è 30.
    { nome: 'One Star Diver', livello: 'base', profonditaM: 20, alias: ['P1', '1*', 'One Star'] },
    { nome: 'Two Star Diver', livello: 'advanced', profonditaM: 30, alias: ['P2', '2*', 'Two Star'] },
    // E il Three Star, dal 2023, dichiara esplicitamente di NON abilitare alla
    // conduzione: niente ruolo di guida, che invece prima gli veniva attribuito.
    { nome: 'Three Star Diver', livello: 'deep', profonditaM: 40, alias: ['P3', '3*', 'Three Star'] },
    { nome: 'Four Star Diver', livello: 'deep', alias: ['P4', '4*'] },
    { nome: 'Nitrox Diver', livello: 'nitrox' },
    { nome: 'Advanced Nitrox Diver', livello: 'tech', profonditaM: 40, decompressione: true },
    { nome: 'Divemaster', livello: 'deep', ruolo: 'guida' },
    { nome: 'One Star Instructor', livello: 'deep', ruolo: 'istruttore', alias: ['M1'] },
    { nome: 'Two Star Instructor', livello: 'deep', ruolo: 'istruttore', alias: ['M2'] },
    { nome: 'Three Star Instructor', livello: 'deep', ruolo: 'istruttore', alias: ['M3'] },
  ],
};

const FIPSAS: Didattica = {
  id: 'fipsas',
  sigla: 'FIPSAS',
  nome: 'Federazione Italiana Pesca Sportiva e Attività Subacquee',
  tipo: 'ricreativa',
  fonte: 'fipsas.it, Percorso Didattico Subacqueo 2025 (ver. C, 31/10/2025)',
  brevetti: [
    // I metri FIPSAS non sono quelli CMAS pur essendo brevetti equipollenti:
    // P1 = 18 contro 20, P3 = 42 contro 40. Due voci separate apposta.
    { nome: 'Turistico AR', livello: 'intro', profonditaM: 10, alias: ['P0'] },
    { nome: '1° Grado AR', livello: 'base', profonditaM: 18, alias: ['P1', 'Primo grado'] },
    { nome: '2° Grado AR', livello: 'advanced', profonditaM: 30, alias: ['P2', 'Secondo grado'] },
    // I 42 m e la deco entro 5-10 minuti li dichiara il percorso didattico.
    {
      nome: '3° Grado AR',
      livello: 'deep',
      profonditaM: 42,
      decompressione: true,
      alias: ['P3', 'Terzo grado'],
    },
    { nome: 'Nitrox Base', livello: 'nitrox', alias: ['PNx1'] },
    { nome: 'Nitrox Avanzato', livello: 'nitrox', alias: ['PNx2'] },
    { nome: 'Assistente Istruttore AR', livello: 'deep', ruolo: 'guida', alias: ['PAiAr'] },
    { nome: 'Istruttore AR', livello: 'deep', ruolo: 'istruttore' },
    // Attestati di esperienza, non abilitazioni: nessuna profondità.
    { nome: 'Sommozzatore Esperto AR Bronzo', livello: 'deep' },
    { nome: 'Sommozzatore Esperto AR Argento', livello: 'deep' },
    { nome: 'Sommozzatore Esperto AR Oro', livello: 'deep' },
  ],
};

const NAUI: Didattica = {
  id: 'naui',
  sigla: 'NAUI',
  nome: 'National Association of Underwater Instructors',
  tipo: 'ricreativa',
  fonte: 'NAUI Standards and Policies Manual, edizione 2026 v2.0',
  brevetti: [
    { nome: 'Scuba Diver', livello: 'intro', profonditaM: 12 },
    { nome: 'Open Water Scuba Diver', livello: 'base', profonditaM: 18 },
    // Lo standard 2026 fissa 40 m per le immersioni del corso Advanced: è più
    // dei 30 m che si trovano altrove, e viene dal manuale, non dal sito.
    { nome: 'Advanced Open Water Scuba Diver', livello: 'deep', profonditaM: 40 },
    { nome: 'Deep Diver', livello: 'deep', profonditaM: 40 },
    { nome: 'Enriched Air Nitrox (EANx) Diver', livello: 'nitrox', alias: ['Nitrox Diver', 'EANx Diver'] },
    { nome: 'Rescue Scuba Diver', livello: 'base', ruolo: 'soccorso', alias: ['Rescue Diver'] },
    { nome: 'Master Scuba Diver', livello: 'deep', profonditaM: 40 },
    { nome: 'Divemaster', livello: 'deep', ruolo: 'guida' },
    { nome: 'Assistant Instructor', livello: 'deep', ruolo: 'assistente' },
    { nome: 'Instructor', livello: 'deep', ruolo: 'istruttore' },
  ],
};

const SDI: Didattica = {
  id: 'sdi',
  sigla: 'SDI',
  nome: 'Scuba Diving International',
  tipo: 'ricreativa',
  fonte: 'tdisdi.com, SDI Standards and Procedures parti 2-4, 2026',
  brevetti: [
    { nome: 'Open Water Scuba Diver', livello: 'base', profonditaM: 18 },
    { nome: 'Advanced Adventure Diver', livello: 'advanced', profonditaM: 30 },
    { nome: 'Deep Diver', livello: 'deep', profonditaM: 40 },
    { nome: 'Computer Nitrox Diver', livello: 'nitrox', alias: ['Nitrox Diver'] },
    { nome: 'Rescue Diver', livello: 'base', ruolo: 'soccorso' },
    // «Advanced Diver» e «Advanced Adventure Diver» sono DUE cose diverse in
    // SDI: il primo è un riconoscimento per accumulo, il secondo un corso.
    { nome: 'Advanced Diver', livello: 'advanced' },
    { nome: 'Master Scuba Diver', livello: 'advanced' },
    { nome: 'Divemaster', livello: 'deep', profonditaM: 40, ruolo: 'guida' },
    { nome: 'Assistant Instructor', livello: 'deep', ruolo: 'assistente' },
    {
      nome: 'Open Water Scuba Diver Instructor',
      livello: 'deep',
      ruolo: 'istruttore',
      alias: ['Instructor'],
    },
  ],
};

const RAID: Didattica = {
  id: 'raid',
  sigla: 'RAID',
  nome: 'Rebreather Association of International Divers',
  tipo: 'ricreativa',
  fonte: 'diveraid.com, pagine corso ufficiali, agosto 2026',
  brevetti: [
    { nome: 'Scuba Diver', livello: 'intro', profonditaM: 12 },
    // RAID ha rinominato il brevetto base: non è più «Open Water 20» a 20 m, è
    // «Open Water» a 18. Il vecchio nome resta come alias, con i metri giusti.
    { nome: 'Open Water', livello: 'base', profonditaM: 18, alias: ['Open Water 20'] },
    { nome: 'Explorer 30', livello: 'advanced', profonditaM: 30 },
    { nome: 'Advanced 35', livello: 'advanced', profonditaM: 35 },
    { nome: 'Deep 40', livello: 'deep', profonditaM: 40 },
    { nome: 'Nitrox', livello: 'nitrox', alias: ['Nitrox Diver'] },
    // RAID non ha un «Rescue» separato dal «Master Rescue».
    { nome: 'Master Rescue', livello: 'base', ruolo: 'soccorso', alias: ['Rescue', 'Master Rescue Diver'] },
    { nome: 'Master Diver', livello: 'advanced' },
    { nome: 'Divemaster', livello: 'deep', ruolo: 'guida' },
    {
      nome: 'Open Circuit Instructor',
      livello: 'deep',
      ruolo: 'istruttore',
      alias: ['Instructor', 'Openwater Instructor'],
    },
  ],
};

const SNSI: Didattica = {
  id: 'snsi',
  sigla: 'SNSI',
  nome: 'Scuba Nitrox Safety International',
  tipo: 'ricreativa',
  fonte: 'scubasnsi.com, agosto 2026',
  brevetti: [
    { nome: 'Scuba Diver', livello: 'intro', profonditaM: 12 },
    { nome: 'Open Water Diver', livello: 'base', profonditaM: 18 },
    { nome: 'Advanced Adventure Diver', livello: 'advanced', profonditaM: 30 },
    // 39 e non 40: è la conversione dai 130 piedi, e SNSI la scrive così.
    { nome: 'Advanced Open Water Diver', livello: 'deep', profonditaM: 39 },
    { nome: 'Recreational Nitrox Diver', livello: 'nitrox', alias: ['Nitrox Diver'] },
    { nome: 'Rescue Diver', livello: 'base', ruolo: 'soccorso' },
    { nome: 'Divemaster', livello: 'deep', ruolo: 'guida' },
    { nome: 'Scuba Instructor', livello: 'deep', ruolo: 'istruttore', alias: ['Instructor'] },
  ],
};

const ESA: Didattica = {
  id: 'esa',
  sigla: 'ESA',
  nome: 'Eco Scuba Agency',
  tipo: 'ricreativa',
  fonte: 'esaweb.net, agosto 2026',
  brevetti: [
    { nome: 'New Diver', livello: 'intro', profonditaM: 12 },
    { nome: 'Open Water Diver', livello: 'base', profonditaM: 18 },
    { nome: 'Advanced Diver', livello: 'advanced', profonditaM: 30 },
    { nome: 'Nitrox Diver', livello: 'nitrox' },
    { nome: 'Rescue Diver', livello: 'base', ruolo: 'soccorso' },
    { nome: 'Diveleader', livello: 'deep', ruolo: 'guida' },
    { nome: 'Assistant Instructor', livello: 'deep', ruolo: 'assistente' },
    { nome: 'Open Water Instructor', livello: 'deep', ruolo: 'istruttore' },
    { nome: 'Master Instructor', livello: 'deep', ruolo: 'istruttore' },
    { nome: 'Instructor Course Director', livello: 'deep', ruolo: 'istruttore' },
  ],
};

/*
  ► NADD, E PERCHÉ QUI DENTRO C'È SOLO METÀ DEL SUO CATALOGO. ◄

  NADD è italiana, e il suo catalogo è largo il doppio di tutti gli altri di
  questo file: oltre alla subacquea insegna apnea, nuoto e mermaiding, e nella
  subacquea affianca alla scala ordinaria una linea di archeologia che nessun'altra
  didattica ha. Metterlo tutto in una tendina voleva dire seppellire l'Open Water
  sotto sessanta voci. Le scelte, dichiarate una per una perché ognuna toglie
  qualcosa che sul sito c'è:

   - **Niente apnea, niente nuoto.** Non è una gerarchia di valore, è che qui la
     scala è `CertLevel`, che misura fin dove si scende CON LE BOMBOLE. Un
     «Apnea 2° livello — 18 m» messo su quella scala direbbe una cosa falsa, e
     non c'è un gradino giusto dove metterlo. Il giorno che l'applicazione
     saprà leggere un'immersione in apnea, quella scala nascerà insieme.
   - **Niente BLS, BLSD, Oxygen Provider, gas blender, operatore compressore.**
     Sono qualifiche vere e utili, ma non sono brevetti subacquei: non
     autorizzano niente sott'acqua. Il guaio non è filosofico — `livello` è
     obbligatorio, e qualunque gradino gli si desse finirebbe nel calcolo del
     «livello più alto raggiunto». Un gas blender che risulta subacqueo tecnico
     è esattamente il genere di bugia che questo file esiste per non dire.
     Chi le vuole nel libretto usa «Altro», che è lì per questo.
   - **Niente Scuba Experience e niente Scuba Review.** Lo dice NADD stessa:
     l'Experience «non prevede un corso e il rilascio di un brevetto», e la
     Review è un ripasso. Un catalogo di brevetti che contiene cose che
     brevetti non sono smette di essere un catalogo di brevetti.

  ► I NUMERI. ◄ Dieci brevetti su trentacinque dichiarano una profondità, e sono
  questi dieci e basta. Il resto — tutte le specialità, tutta la linea grotta,
  tutta la scala professionale — non la dichiara, e qui resta vuoto.

  ► IL REBREATHER NON C'È PERCHÉ NON HA UN NOME. ◄ La pagina dei corsi tecnici
  dice che NADD «ha sviluppato specifici corsi per gli apparati di respirazione
  a Circuito Chiuso e Semi Chiuso», e poi si ferma: non un livello, non una
  sigla, non un metro. Non si può mettere in tendina un brevetto di cui non si
  conosce il nome, e inventarne uno plausibile — «CCR Diver Level 1», che è
  quello che avrebbero tutte le altre — sarebbe scrivere nel logbook di
  qualcuno un brevetto che non esiste. Quando NADD lo pubblicherà, si aggiunge.
  Stessa storia per il livello di mezzo della linea grotta: il sito dice «tre
  livelli», ne nomina due, e qui ce ne sono due.

  ► IL NOME PER ESTESO È UN NOME PROPRIO. ◄ «NADD Global Diving Agency» sembra
  una sigla non sciolta, e lo è: la didattica non scioglie mai l'acronimo, da
  nessuna parte. Scrivere qui una nostra espansione — «National Association of
  Diving Development» o simili, che in rete circola — vorrebbe dire attribuirle
  un nome che non ha mai usato.
*/
const NADD: Didattica = {
  id: 'nadd',
  sigla: 'NADD',
  // Non è una sigla lasciata a metà: vedi il commento qui sopra.
  nome: 'NADD Global Diving Agency',
  tipo: 'ricreativa',
  fonte:
    'naddeurope.com — corsi ricreativi, tecnici, professionali, di emergenza e la pagina Training Programs, agosto 2026',
  brevetti: [
    // ── la scala ricreativa ──────────────────────────────────────────────────
    // I due programmi in piscina: brevetti veri, ma senza una profondità
    // dichiarata, perché una piscina non ne ha una da dichiarare.
    { nome: 'Indoor Diver', livello: 'intro' },
    { nome: 'Baby Dolphin', livello: 'intro' },
    { nome: 'Scuba Diver', livello: 'intro', profonditaM: 12 },
    { nome: 'Open Water Diver', livello: 'base', profonditaM: 18 },
    /*
      Tre grafie per lo stesso brevetto, tutte e tre sul sito ufficiale:
      «Advanced Open Water Diver» nella pagina dei corsi ricreativi, «Advanced
      Diver» nell'elenco Training Programs, «Advanced Scuba Diver» nella pagina
      «impara a immergerti». Qui la prima fa da nome e le altre due da alias,
      così chi ha scritto a mano una qualunque delle tre se la ritrova.
    */
    {
      nome: 'Advanced Open Water Diver',
      livello: 'advanced',
      profonditaM: 30,
      alias: ['Advanced Diver', 'Advanced Scuba Diver', 'AOWD'],
    },
    // «entro i 40 metri ed entro la curva di sicurezza»: la deco è esclusa a parole.
    { nome: 'Deep Diver', livello: 'deep', profonditaM: 40, decompressione: false },
    { nome: 'Rescue Diver', livello: 'base', ruolo: 'soccorso' },
    { nome: 'Nitrox Diver', livello: 'nitrox' },
    /*
      ── le specialità ──────────────────────────────────────────────────────
      Nessuna dichiara una profondità: qui `profonditaM` è vuoto per tutte, e
      non è una mancanza da colmare. `livello` invece è obbligatorio, e vale
      `base` perché è il prerequisito che NADD chiede per accedervi — dice «hai
      almeno l'Open Water», che è vero, e non dice niente di più.
    */
    { nome: 'Wreck Diver', livello: 'base' },
    { nome: 'Night Diver', livello: 'base' },
    { nome: 'Underwater Navigation', livello: 'base' },
    { nome: 'Digital Underwater Photographer', livello: 'base', alias: ['Scuba Photographer'] },
    { nome: 'Dry Suit', livello: 'base' },
    { nome: 'Altitude Diver', livello: 'base' },
    { nome: 'Naturalist Diver', livello: 'base' },
    { nome: 'Advanced Buoyancy Diver', livello: 'base', alias: ['Performance Buoyancy'] },
    { nome: 'Drift Diver', livello: 'base' },
    { nome: 'Search And Recovery', livello: 'base' },
    { nome: 'Shark Awareness', livello: 'base' },
    { nome: 'Propulsion Vehicle', livello: 'base', alias: ['Diving Propulsion Vehicle', 'DPV'] },
    { nome: 'Dive Buddy for Disabled Diver', livello: 'base' },
    { nome: 'Full Face Mask', livello: 'base' },
    { nome: 'Side Mount', livello: 'base' },
    /*
      ── la linea di archeologia ────────────────────────────────────────────
      È la parte che NADD ha e le altre didattiche di questo file no. Quattro
      gradini, nessuno con una profondità dichiarata.

      «Archeology Guide» NON prende `ruolo: 'guida'`. In questo file quel ruolo
      vuol dire conduzione di subacquei, e qui la parola guida un cantiere
      archeologico: attribuirle l'altro significato le farebbe dire, nel
      libretto di chi ce l'ha, un'abilitazione che non le risulta.
    */
    { nome: 'Archeology Experience', livello: 'base' },
    { nome: 'Archeology Guide', livello: 'base' },
    { nome: 'Archeology Operator', livello: 'base' },
    { nome: 'Archeology Instructor', livello: 'advanced', ruolo: 'istruttore' },
    { nome: 'Archeology Instructor Trainer', livello: 'advanced', ruolo: 'istruttore' },
    /*
      ── la linea tecnica ───────────────────────────────────────────────────
      I 42 m del Light Deco vengono da «Durante il corso potrai raggiungere i
      42 metri (137 feet) come massima profondità»: è la profondità del corso,
      non un limite operativo scritto altrove — NADD altrove non lo scrive. Il
      titolo della sezione dice 45, ma quel titolo copre due corsi insieme
      («LIGHT DECO DIVER & DECOMPRESSION PROCEDURES») e i 45 sono del secondo.

      Per i Trimix 80 e 100 il numero sta nel nome del corso, con la conversione
      in piedi che la mette il sito («Trimix 80m (262 feet) e Trimix 100m (328
      feet)»). È una base più fragile di quella dell'Extended Range, che ha una
      frase intera dedicata, ed è comunque una dichiarazione di NADD e non una
      nostra deduzione.
    */
    { nome: 'Light Deco Diver', livello: 'tech', profonditaM: 42, decompressione: true },
    {
      nome: 'Decompression Procedures',
      livello: 'tech',
      profonditaM: 45,
      decompressione: true,
      alias: ['Decompression Procedures Diver'],
    },
    { nome: 'Extended Range', livello: 'tech', profonditaM: 54, decompressione: true },
    {
      nome: 'Trimix 60m',
      livello: 'tech',
      profonditaM: 60,
      decompressione: true,
      alias: ['Trimix 60', 'Trimix Normossico'],
    },
    { nome: 'Trimix 80m', livello: 'tech', profonditaM: 80, decompressione: true, alias: ['Trimix 80'] },
    {
      nome: 'Trimix 100m',
      livello: 'tech',
      profonditaM: 100,
      decompressione: true,
      alias: ['Trimix 100'],
    },
    // Grotta: due nomi su tre livelli annunciati. Il terzo NADD non lo nomina.
    { nome: 'Cavern', livello: 'tech' },
    { nome: 'Full Cave', livello: 'tech' },
    /*
      ── la scala professionale ─────────────────────────────────────────────
      Nessuno di questi livelli dichiara una profondità propria — NADD non la
      scrive da nessuna parte, e i 40 m che hanno i divemaster SSI qui sarebbero
      copiati da un'altra didattica.
    */
    { nome: 'Divemaster', livello: 'advanced', ruolo: 'guida', alias: ['Dive Master'] },
    { nome: 'Assistant Instructor', livello: 'advanced', ruolo: 'assistente' },
    { nome: 'Open Water Instructor', livello: 'advanced', ruolo: 'istruttore' },
    { nome: 'Advanced Instructor', livello: 'advanced', ruolo: 'istruttore' },
    { nome: 'Specialty Instructor', livello: 'advanced', ruolo: 'istruttore' },
    { nome: 'Tek Instructor', livello: 'tech', ruolo: 'istruttore' },
    {
      nome: 'I.T.C. Staff Instructor',
      livello: 'advanced',
      ruolo: 'istruttore',
      alias: ['ITC Staff Instructor'],
    },
    { nome: 'Instructor Trainer', livello: 'advanced', ruolo: 'istruttore' },
  ],
};

// ---------------------------------------------------------------------------
// Le didattiche tecniche
// ---------------------------------------------------------------------------

const TDI: Didattica = {
  id: 'tdi',
  sigla: 'TDI',
  nome: 'Technical Diving International',
  tipo: 'tecnica',
  fonte: 'tdisdi.com, TDI Diver Standards Part 2, versione 0126',
  brevetti: [
    { nome: 'Nitrox Diver', livello: 'nitrox' },
    { nome: 'Advanced Nitrox Diver', livello: 'nitrox', profonditaM: 40 },
    { nome: 'Intro to Tech', livello: 'advanced' },
    { nome: 'Decompression Procedures Diver', livello: 'tech', profonditaM: 45, decompressione: true },
    { nome: 'Extended Range Diver', livello: 'tech', profonditaM: 55, decompressione: true },
    { nome: 'Helitrox Diver', livello: 'tech', profonditaM: 45, decompressione: true },
    { nome: 'Trimix Diver', livello: 'tech', profonditaM: 60, decompressione: true },
    { nome: 'Advanced Trimix Diver', livello: 'tech', profonditaM: 100, decompressione: true },
    { nome: 'Advanced Wreck Diver', livello: 'tech', profonditaM: 55, decompressione: true },
    { nome: 'Cavern Diver', livello: 'deep', profonditaM: 40 },
    { nome: 'Intro to Cave Diver', livello: 'deep', profonditaM: 40, alias: ['Introductory Cave Diver'] },
    { nome: 'Full Cave Diver', livello: 'deep', profonditaM: 40 },
    { nome: 'Air Diluent CCR Diver', livello: 'tech', profonditaM: 40 },
    {
      nome: 'Air Diluent CCR Decompression Procedures Diver',
      livello: 'tech',
      profonditaM: 40,
      decompressione: true,
    },
    { nome: 'Mixed Gas CCR Diver', livello: 'tech', profonditaM: 60, decompressione: true },
  ],
};

const IANTD: Didattica = {
  id: 'iantd',
  sigla: 'IANTD',
  nome: 'International Association of Nitrox and Technical Divers',
  tipo: 'tecnica',
  fonte: 'iantd.com, pagine corso ufficiali, agosto 2026',
  brevetti: [
    { nome: 'EANx Diver', livello: 'nitrox', alias: ['Nitrox Diver'] },
    { nome: 'Deep Diver', livello: 'deep', profonditaM: 40 },
    { nome: 'Advanced EANx Diver', livello: 'tech', profonditaM: 45, decompressione: true },
    // Il nome dice «Recreational» ma la pagina ufficiale parla di tappe di
    // decompressione obbligatorie: qui vale quello che fa, non come si chiama.
    { nome: 'Advanced Recreational Trimix Diver', livello: 'tech', profonditaM: 45, decompressione: true },
    { nome: 'Technical Diver', livello: 'tech', profonditaM: 55, decompressione: true },
    { nome: 'Normoxic Trimix Diver', livello: 'tech', profonditaM: 60, decompressione: true },
    { nome: 'Trimix Diver', livello: 'tech', profonditaM: 100, decompressione: true },
    { nome: 'Cave Diver', livello: 'tech', profonditaM: 45 },
  ],
};

const GUE: Didattica = {
  id: 'gue',
  sigla: 'GUE',
  nome: 'Global Underwater Explorers',
  tipo: 'tecnica',
  fonte: 'gue.com, Standards v10.1 e v10.2',
  brevetti: [
    // Dagli Standards v10 il vecchio Fundamentals con «rec pass» e «tech pass»
    // non esiste più: sono due corsi distinti. I due nomi vecchi restano come
    // alias, perché chi li ha presi ce li ha ancora sulla tessera.
    { nome: 'Basic Fundamentals', livello: 'base', profonditaM: 18, alias: ['Fundamentals (Rec Pass)'] },
    {
      nome: 'Technical Fundamentals',
      livello: 'advanced',
      profonditaM: 30,
      alias: ['Fundamentals (Tech Pass)'],
    },
    {
      nome: 'Technical Diver Level 1',
      livello: 'tech',
      profonditaM: 51,
      decompressione: true,
      alias: ['Tech 1'],
    },
    {
      nome: 'Technical Diver Level 2',
      livello: 'tech',
      profonditaM: 75,
      decompressione: true,
      alias: ['Tech 2'],
    },
    {
      nome: 'Technical Diver Level 3',
      livello: 'tech',
      profonditaM: 100,
      decompressione: true,
      alias: ['Tech 3'],
    },
    { nome: 'Cave Diver Level 1', livello: 'advanced', profonditaM: 30, alias: ['Cave 1'] },
    // Cave 2 NON è più profondo di Cave 1: aggiunge complessità e deco, non metri.
    { nome: 'Cave Diver Level 2', livello: 'tech', profonditaM: 30, decompressione: true, alias: ['Cave 2'] },
    {
      nome: 'Cave Diver Level 3',
      livello: 'tech',
      profonditaM: 100,
      decompressione: true,
      alias: ['Cave 3'],
    },
  ],
};

const PSAI: Didattica = {
  id: 'psai',
  sigla: 'PSAI',
  nome: 'Professional Scuba Association International',
  tipo: 'tecnica',
  fonte: 'psai.com, pagine corso ufficiali, agosto 2026',
  brevetti: [
    { nome: 'Advanced Nitrox Diver', livello: 'tech', decompressione: true },
    { nome: 'Extended Range Nitrox Diver', livello: 'tech', profonditaM: 55, decompressione: true },
    { nome: 'Trimix Fundamentals Diver', livello: 'tech', profonditaM: 60, decompressione: true },
    { nome: 'Expedition Trimix Diver', livello: 'tech', profonditaM: 75, decompressione: true },
    { nome: 'Explorer Trimix Diver', livello: 'tech', profonditaM: 100, decompressione: true },
    { nome: 'Advanced Mixed Gas CCR Diver', livello: 'tech', profonditaM: 76, decompressione: true },
  ],
};

/**
 * Tutte, nell'ordine in cui compaiono nella tendina.
 *
 * Le ricreative prima e per diffusione in Italia, non in ordine alfabetico: chi
 * apre la tendina cerca la sua, e la sua è quasi sempre fra le prime tre. Le
 * tecniche dopo, in un gruppo a parte, perché chi le cerca sa già cosa cerca.
 */
export const DIDATTICHE: Didattica[] = [
  PADI,
  SSI,
  CMAS,
  FIPSAS,
  SNSI,
  ESA,
  NADD,
  NAUI,
  SDI,
  RAID,
  TDI,
  IANTD,
  GUE,
  PSAI,
];

/** La didattica con questo id, se la conosciamo. */
export function didatticaPerId(id: string | undefined): Didattica | undefined {
  return id ? DIDATTICHE.find((d) => d.id === id) : undefined;
}

/**
 * Il brevetto con questo nome dentro questa didattica.
 *
 * Guarda anche gli alias, perché le didattiche rinominano i corsi: chi aveva
 * scelto «Open Water 20» quando RAID lo chiamava così deve continuare a
 * ritrovarlo, e non vederselo degradare a «scritto a mano».
 */
export function brevettoPerNome(
  didattica: Didattica | undefined,
  nome: string,
): BrevettoCatalogo | undefined {
  if (!didattica) return undefined;
  const cercato = nome.trim().toLowerCase();
  if (!cercato) return undefined;
  return didattica.brevetti.find(
    (b) => b.nome.toLowerCase() === cercato || (b.alias ?? []).some((a) => a.toLowerCase() === cercato),
  );
}

/** La didattica di cui questa sigla è il nome, per riconoscere quelle già scritte a mano. */
export function didatticaPerSigla(sigla: string): Didattica | undefined {
  const cercata = sigla.trim().toLowerCase();
  if (!cercata) return undefined;
  return DIDATTICHE.find((d) => d.sigla.toLowerCase() === cercata || d.nome.toLowerCase() === cercata);
}
