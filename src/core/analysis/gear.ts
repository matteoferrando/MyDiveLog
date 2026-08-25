/**
 * Attrezzatura, brevetti e configurazione.
 *
 * RIFATTO DA ZERO ad agosto 2026, e vale la pena scrivere perché.
 *
 * La prima versione era una lista sola con nove tipi dentro — bombola, erogatore,
 * jacket, computer, muta, brevetto, certificato medico, assicurazione, altro — e
 * un solo meccanismo: «ultima data + ogni quanti mesi = scadenza», con un pallino
 * rosso quando era passata. Sembra economico e invece era sbagliato due volte.
 *
 * Sbagliato perché metteva nella stessa riga cose che non hanno niente in comune.
 * Un brevetto NON scade e non si revisiona: è ciò che ti autorizza a fare certe
 * immersioni, e il posto dove serve è la scheda di prontezza del Coach, non un
 * elenco di manutenzioni. Un erogatore si revisiona ma non ha una scadenza secca:
 * ha un intervallo consigliato dal costruttore, e superarlo di due mesi non è
 * come dimenticare di rinnovare un'assicurazione. Chiedere all'utente di
 * esprimere entrambe le cose con «lastServiceDate + intervalMonths» significava
 * costringerlo a mentire su una delle due.
 *
 * E sbagliato perché trasformava un archivio in un elenco di rimproveri. Le
 * scadenze scadono, e un'applicazione che apri per guardare le tue immersioni ti
 * accoglieva con tre pallini rossi su cose che sai benissimo. Questa versione non
 * ha avvisi: registra e mostra i fatti — quando è stata l'ultima revisione,
 * quanto tempo è passato — e lascia il giudizio a chi legge, che è l'unico ad
 * avere il contesto per darlo.
 *
 * Tre gruppi, tre forme diverse, perché sono tre cose diverse:
 *
 *  - `Equipment`: quello che porti in acqua e che si collauda o si revisiona.
 *  - `Certification`: i brevetti. Nessuna data di scadenza, e un livello che il
 *    Coach può leggere.
 *  - La configurazione di zavorra NON è una terza lista da compilare: si RICAVA
 *    dalle immersioni, che già portano `weightKg` e `suit`. Vedi `weightingBySuit`.
 */

import type { Dive } from '../model';

// ---------------------------------------------------------------------------
// 1. Quello che porti in acqua
// ---------------------------------------------------------------------------

export type EquipmentKind = 'cylinder' | 'regulator' | 'bcd' | 'computer' | 'suit' | 'light' | 'other';

export const EQUIPMENT_LABEL: Record<EquipmentKind, string> = {
  cylinder: 'Bombola',
  regulator: 'Erogatore',
  bcd: 'Jacket o sacco',
  computer: 'Computer',
  suit: 'Muta',
  light: 'Illuminazione',
  other: 'Altro',
};

/**
 * Che tipo di manutenzione vuole questo pezzo. Non «ogni quanti mesi»: che
 * COSA. La differenza conta perché i tre casi si comportano diversamente e
 * l'interfaccia deve chiedere cose diverse.
 */
export type ServiceKind =
  /** Collaudo idraulico: obbligatorio per legge, ha una periodicità di norma. */
  | 'hydro'
  /** Revisione del costruttore: consigliata, non obbligatoria. */
  | 'overhaul'
  /** Batteria o cambio pile: si fa quando serve, non a calendario. */
  | 'battery'
  /** Niente: una muta o una torcia non si revisionano. */
  | 'none';

export const SERVICE_LABEL: Record<ServiceKind, string> = {
  hydro: 'Collaudo idraulico',
  overhaul: 'Revisione',
  battery: 'Batteria',
  none: 'Nessuna manutenzione periodica',
};

/**
 * La manutenzione TIPICA per tipo, come suggerimento di partenza. Non una regola
 * e non un obbligo: il collaudo delle bombole segue la normativa del paese, la
 * revisione degli erogatori il libretto del costruttore, e ogni pezzo può dire
 * la sua.
 */
export const TYPICAL_SERVICE: Record<EquipmentKind, ServiceKind> = {
  cylinder: 'hydro',
  regulator: 'overhaul',
  bcd: 'overhaul',
  computer: 'battery',
  suit: 'none',
  light: 'battery',
  other: 'none',
};

/** Ogni quanti mesi, tipicamente. Solo un valore iniziale del modulo. */
export const TYPICAL_INTERVAL_MONTHS: Partial<Record<EquipmentKind, number>> = {
  cylinder: 24,
  regulator: 12,
  bcd: 12,
};

export interface Equipment {
  id: string;
  kind: EquipmentKind;
  /** Marca e modello, come lo chiami tu: «Apeks XTX50», «D12 200 bar». */
  name: string;
  /** Matricola: sulle bombole è quello che il centro ricarica legge. */
  serial?: string;
  /** Quando l'hai preso, `YYYY-MM-DD`. Facoltativo, e non genera niente. */
  boughtOn?: string;
  service: ServiceKind;
  /** Ultima manutenzione fatta, `YYYY-MM-DD`. */
  lastServiceOn?: string;
  /** Ogni quanti mesi andrebbe rifatta, secondo il costruttore o la norma. */
  intervalMonths?: number;
  /** Litri, per le bombole. */
  sizeL?: number;
  /**
   * Peso della PIASTRA, chilogrammi. Solo per i GAV.
   *
   * PERCHÉ STA SULL'ATTREZZO E NON SULL'IMMERSIONE. Perché è una proprietà del
   * pezzo, non della giornata: una piastra d'acciaio pesa tre chili oggi come
   * fra due anni. Scritta qui una volta, ogni immersione fatta con quel GAV la
   * eredita — e l'alternativa è ridigitarla ogni volta, cioè non scriverla mai.
   *
   * Sull'immersione resta comunque il suo campo, perché la configurazione si
   * cambia: la piastra d'alluminio per il viaggio, quella d'acciaio a casa.
   * Quello che c'è scritto sull'immersione vince sempre su questo.
   */
  plateKg?: number;
  /**
   * Peso della CONTROPIASTRA o schienalino, chilogrammi.
   *
   * Separata dalla piastra perché sono due pezzi che si cambiano
   * indipendentemente: si tiene la stessa piastra e si toglie lo schienalino,
   * o viceversa. Sommarli in un campo solo vorrebbe dire rifare il conto a mano
   * ogni volta che se ne cambia uno.
   */
  backplateKg?: number;
  /** Pressione di esercizio in bar, per le bombole. */
  workingBar?: number;
  notes?: string;
  /** Vero se non lo usi più: resta in archivio ma fuori dall'elenco attivo. */
  retired?: boolean;
  /** Solo per la sincronizzazione: senza, non saprebbe quale versione tenere. */
  savedAt?: string;
}

// ---------------------------------------------------------------------------
// 2. I brevetti
// ---------------------------------------------------------------------------

/**
 * Il livello, in una scala che il Coach possa leggere.
 *
 * Le didattiche hanno nomi diversi per la stessa cosa — Advanced Open Water,
 * Two Star, Advanced Diver — e mettere in ordine trenta nomi commerciali è una
 * battaglia persa. Quello che serve al Coach è: fino a che profondità sei
 * addestrato, e sai gestire una decompressione. Questi cinque scalini rispondono.
 */
export type CertLevel = 'intro' | 'base' | 'advanced' | 'deep' | 'nitrox' | 'tech';

/*
 * ► LE ETICHETTE PORTANO I METRI, MA I METRI VERI STANNO ALTROVE. ◄
 *
 * «fino a 18 m» è il tipico, non il vangelo: un CMAS One Star dice 20, un
 * FIPSAS 3° Grado dice 42, un SNSI Advanced Open Water dice 39. Il numero che
 * conta per un singolo brevetto è quello che dichiara la SUA didattica, e sta
 * nel catalogo (`didattiche.ts`) e sul brevetto salvato. Questo scalino serve a
 * un'altra cosa: mettere a confronto brevetti di scuole diverse quando la
 * domanda è «fin dove è addestrato», e lì cinque gradini bastano.
 *
 * Le cinque frasi storiche NON si toccano: sono chiavi del dizionario e, per i
 * brevetti scritti a mano, anche il valore salvato sul libretto. Cambiarne una
 * scollegherebbe quello che qualcuno ha già scelto.
 */
export const CERT_LEVEL_LABEL: Record<CertLevel, string> = {
  intro: 'Introduttivo (solo con guida)',
  base: 'Primo livello (fino a 18 m)',
  advanced: 'Avanzato (fino a 30 m)',
  deep: 'Profondo (fino a 40 m)',
  nitrox: 'Nitrox / miscele',
  tech: 'Tecnico (decompressione)',
};

/**
 * Quello che un brevetto aggiunge OLTRE alla profondità.
 *
 * Un Rescue Diver non scende più giù di prima; un Divemaster nemmeno. Sono
 * qualifiche su un altro asse, e tenerle nella classifica dei metri è
 * esattamente l'errore già pagato con il Nitrox, quando l'applicazione
 * rispondeva «Nitrox» a chi chiedeva fin dove fosse addestrato.
 *
 * `assistente` sta fra `guida` e `istruttore` perché è lì che sta in quasi
 * tutte le didattiche: l'Assistant Instructor si prende dopo il Divemaster e
 * prima dell'Istruttore.
 */
export type RuoloBrevetto = 'soccorso' | 'guida' | 'assistente' | 'istruttore';

export const RUOLO_LABEL: Record<RuoloBrevetto, string> = {
  soccorso: 'Soccorso',
  guida: 'Guida subacquea',
  assistente: 'Assistente istruttore',
  istruttore: 'Istruttore',
};

const SCALA_RUOLI: RuoloBrevetto[] = ['soccorso', 'guida', 'assistente', 'istruttore'];

export interface Certification {
  id: string;
  /** PADI, SSI, CMAS, TDI, FIPSAS… la sigla, scelta dall'elenco o scritta a mano. */
  agency: string;
  /**
   * L'id della didattica del catalogo, quando il brevetto è stato SCELTO da lì.
   *
   * È la differenza fra un nome di cui ci si può fidare e uno digitato a mano.
   * Con questo campo pieno, `name` è il nome ufficiale di un corso vero e può
   * finire sul libretto così com'è; senza, `name` è quello che ha scritto una
   * persona — e la storia dice che ci scrive il proprio, di nome.
   */
  didatticaId?: string;
  /** Il nome commerciale, come sta scritto sulla tessera. */
  name: string;
  level: CertLevel;
  /** Soccorso, guida, istruttore: quello che aggiunge oltre ai metri. */
  ruolo?: RuoloBrevetto;
  /**
   * La profondità che la didattica dichiara per questo brevetto, in metri.
   *
   * Assente quando la didattica NON la dichiara, che è il caso di un brevetto
   * su tre — un Enriched Air non parla di profondità, un Rescue nemmeno. Vedi
   * il commento in testa a `didattiche.ts`: qui non si inventa un numero
   * perché il campo sarebbe più bello pieno.
   */
  profonditaM?: number;
  /** Vero se il brevetto prevede immersioni con decompressione pianificata. */
  decompressione?: boolean;
  /** Quando l'hai preso, `YYYY-MM-DD`. */
  issuedOn?: string;
  /** Numero della tessera. */
  number?: string;
  instructor?: string;
  notes?: string;
  savedAt?: string;
}

// ---------------------------------------------------------------------------
// 3. Zavorra e configurazione, ricavate dalle immersioni
// ---------------------------------------------------------------------------

export interface WeightingRow {
  /** La muta come l'hai scritta nelle immersioni. */
  suit: string;
  dives: number;
  /** Zavorra mediana con questa muta, kg. */
  medianKg: number;
  minKg: number;
  maxKg: number;
  /**
   * Oscillazione mediana a quota tenuta con questa configurazione, m/min.
   *
   * È il motivo per cui questa tabella esiste e non è un modulo da compilare:
   * l'app misura già l'assetto su ogni immersione con un profilo, quindi può
   * dire quale zavorra ti ha fatto tenere meglio la quota — che è la domanda
   * vera, e nessun elenco di attrezzatura può risponderla.
   */
  medianTrimMpm?: number;
  /** Su quante immersioni si basa l'assetto: può essere meno di `dives`. */
  trimBasis: number;
  /**
   * Quante di queste immersioni portavano anche una piastra o uno schienalino.
   *
   * Serve a leggere la riga: se la mediana è di 3 kg e su metà delle
   * immersioni c'era una piastra d'acciaio dentro il conto, la dispersione fra
   * minimo e massimo non è incoerenza tua — sono due configurazioni diverse
   * finite nella stessa riga.
   */
  withBackplate: number;
}

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * La zavorra usata con ciascuna muta, misurata sulle immersioni fatte.
 *
 * Non chiede niente a nessuno: `weightKg` e `suit` sono già nel modello e i
 * parser li leggono quando ci sono. Le immersioni senza uno dei due restano
 * fuori, e la riga dichiara quante ne ha usate — perché «6 kg» su tre immersioni
 * e «6 kg» su quaranta sono due affermazioni diverse.
 */
export function weightingBySuit(
  dives: Dive[],
  minDives = 2,
  inventario?: Pick<Equipment, 'id' | 'plateKg' | 'backplateKg'>[],
): WeightingRow[] {
  /*
   * LA CHIAVE È IL NOME NORMALIZZATO, e la priorità è quella di tutto il resto.
   *
   * Due difetti sovrapposti, entrambi introdotti ieri sistemandone un terzo.
   * Il primo: qui vinceva il testo libero e in `gearStats` il riferimento
   * all'inventario — priorità opposte per la stessa grandezza, quindi la stessa
   * muta compariva con due nomi e due mediane in due pagine. Il secondo: qui si
   * raggruppava sulla stringa così com'è, quindi «Muta Umida 5mm» e «muta umida
   * 5 mm» erano due mute, e sei immersioni identiche diventavano due gruppi da
   * due che scendevano sotto soglia e sparivano dalla tabella — mentre
   * l'inventario, due sezioni più su nella stessa pagina, ne contava sei.
   */
  const byS = new Map<string, { nome: string; kg: number[]; trim: number[]; piastre: number }>();
  for (const d of dives) {
    const nome = d.gear?.suit?.name?.trim() || d.suit?.trim();
    if (!nome) continue;
    const suit = normalizzaNome(nome);
    /*
     * LA SOGLIA È SUL TOTALE, non sulla sola zavorra.
     *
     * Scartare chi non ha `weightKg` buttava via proprio le configurazioni in
     * cui la piastra è quasi tutto il peso: chi scende con una piastra d'acciaio
     * da 6 kg e zero piombo addosso ha una zavorra totale di 6 kg — un dato
     * vero — e finiva fuori tabella come se non avesse scritto niente.
     */
    const piastra = piastraDellImmersione(d, inventario);
    if (d.weightKg === undefined && piastra === undefined) continue;
    const totale = zavorraTotaleKg(d, inventario);
    if (!(totale > 0)) continue;
    const row = byS.get(suit) ?? { nome, kg: [], trim: [], piastre: 0 };
    row.kg.push(totale);
    if (piastra) row.piastre++;
    const trim = d.metrics?.bottomVerticalTravelMpm;
    if (trim !== undefined && Number.isFinite(trim)) row.trim.push(trim);
    byS.set(suit, row);
  }
  return [...byS.entries()]
    .filter(([, r]) => r.kg.length >= minDives)
    .map(([, r]) => ({
      // Si mostra il nome scritto dall'utente, non la forma normalizzata.
      suit: r.nome,
      dives: r.kg.length,
      medianKg: Math.round(median(r.kg) * 10) / 10,
      minKg: Math.min(...r.kg),
      maxKg: Math.max(...r.kg),
      medianTrimMpm: r.trim.length ? Math.round(median(r.trim) * 10) / 10 : undefined,
      trimBasis: r.trim.length,
      withBackplate: r.piastre,
    }))
    .sort((a, b) => b.dives - a.dives);
}

/**
 * Quante immersioni ha fatto ogni attrezzo, e quante dall'ultima manutenzione.
 *
 * È LA DOMANDA PER CUI L'INVENTARIO ESISTE. Un elenco di attrezzi con le date di
 * revisione lo si può tenere su un foglio; quello che il foglio non sa dire è
 * «questo erogatore ha fatto sessanta immersioni da quando l'ho fatto
 * revisionare», che è il numero con cui si decide davvero — la norma parla di
 * mesi, l'usura conta le immersioni, e un erogatore fermo in cantina per un anno
 * non è nella stessa condizione di uno che ha fatto tre viaggi.
 *
 * Fatti, nessun giudizio: non c'è nessuna soglia oltre la quale l'app dica «vai
 * a revisionarlo». Quel giudizio lo dà chi sa in che acqua l'ha usato e come
 * l'ha risciacquato.
 *
 * L'aggancio è per identificativo — ed è il motivo per cui la scheda immersione
 * fa scegliere dall'elenco invece di far scrivere il nome ogni volta. Per la
 * muta, e solo quando il riferimento manca del tutto, vale anche il nome
 * scritto a mano: le immersioni importate da LogTRAK la portano come testo, e
 * ignorarle faceva dire all'inventario «1 immersione» accanto a una muta usata
 * sei volte. Il dettaglio sta in `equipmentUsage`.
 */
export interface EquipmentUsage {
  id: string;
  dives: number;
  /** Immersioni fatte DOPO l'ultima manutenzione. Assente se non è mai stata fatta. */
  divesSinceService?: number;
  /** L'ultima immersione con questo attrezzo, ISO. */
  lastUsedOn?: string;
}

/**
 * Il nome di un attrezzo ridotto alla sua forma confrontabile: minuscolo, senza
 * accenti e senza spazi. Serve solo all'aggancio per nome — quello che si vede
 * resta il nome scritto dall'utente.
 *
 * Gli spazi si tolgono tutti, non si compattano: «Muta Umida 5 mm» e «Muta
 * Umida 5mm» sono la stessa muta, e «Apeks XTX 50» lo stesso erogatore di
 * «Apeks XTX50». Due voci davvero diverse che si riducono alla stessa forma non
 * fanno danno — chi le usa spegne l'aggancio per nome su entrambe.
 */
export function normalizzaNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** Il giorno di calendario del LUOGO dell'immersione, `YYYY-MM-DD`. */
function giornoLocale(d: Pick<Dive, 'startTime' | 'utcOffsetMinutes'>): string {
  const t = Date.parse(d.startTime);
  if (Number.isNaN(t)) return d.startTime.slice(0, 10);
  return new Date(t + (d.utcOffsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10);
}

export function equipmentUsage(dives: Dive[], equipment: Equipment[]): Map<string, EquipmentUsage> {
  const out = new Map<string, EquipmentUsage>();
  for (const e of equipment) out.set(e.id, { id: e.id, dives: 0 });

  /*
   * Con due voci dello stesso identificativo vince quella che HA la data.
   *
   * `new Map(...)` tiene l'ultima, e se l'ultima è la copia senza revisione il
   * contatore mostra «0 dall'ultima» su un attrezzo che ne ha fatte dieci. Un
   * inventario con id ripetuti non dovrebbe esistere, ma nasce da solo
   * ripristinando un backup su un archivio che ha già le stesse voci.
   */
  const service = new Map<string, string | undefined>();
  for (const e of equipment) {
    if (e.lastServiceOn || !service.has(e.id)) service.set(e.id, e.lastServiceOn ?? service.get(e.id));
  }

  /*
   * L'AGGANCIO PER NOME, per le immersioni che non hanno un riferimento.
   *
   * L'aggancio buono è l'identificativo, e la scheda immersione fa scegliere
   * dall'elenco proprio per produrlo. Ma un archivio vero non nasce così: le
   * immersioni importate da LogTRAK, o scritte prima che l'inventario
   * esistesse, hanno la muta come TESTO — `dive.suit`, «Muta Umida 5mm» — e
   * nessun riferimento. Contando i soli riferimenti, l'inventario diceva «1
   * immersione» accanto a una muta che la tabella della zavorra, che il testo lo
   * guarda, contava sei volte. Due numeri diversi per la stessa muta nella
   * stessa pagina: uno dei due è per forza sbagliato, e chi legge non sa quale.
   *
   * Quindi: se l'immersione non ha il riferimento, si guarda il nome. Il
   * confronto normalizza maiuscole e spazi — «Muta umida 5 mm» e «MUTA UMIDA
   * 5MM» sono la stessa muta — e non inventa somiglianze: o il nome combacia
   * dopo la normalizzazione, o non conta. Se due voci dell'inventario si
   * normalizzano allo stesso nome l'aggancio per nome si spegne per quel nome,
   * perché non c'è modo di sapere quale delle due intendesse.
   */
  const perNome = new Map<string, string | null>();
  for (const e of equipment) {
    const chiave = `${e.kind}\u0000${normalizzaNome(e.name)}`;
    perNome.set(chiave, perNome.has(chiave) ? null : e.id);
  }
  const idDalNome = (kind: EquipmentKind, nome: string | undefined): string | undefined => {
    if (!nome?.trim()) return undefined;
    return perNome.get(`${kind}\u0000${normalizzaNome(nome)}`) ?? undefined;
  };

  for (const d of dives) {
    const g = d.gear;
    const riferimenti = [...(g?.regulators ?? []), g?.bcd, g?.suit, ...(g?.other ?? [])];
    // La muta scritta a mano vale come riferimento quando il riferimento manca.
    if (!g?.suit?.id) {
      const id = idDalNome('suit', d.suit);
      if (id) riferimenti.push({ id, name: d.suit ?? '' });
    }
    // Lo stesso attrezzo citato due volte nella stessa immersione conta UNA
    // volta: un erogatore messo per sbaglio in entrambi i campi raddoppierebbe
    // il conto delle sue immersioni, e quel numero deve poter essere creduto.
    for (const id of new Set(riferimenti.map((r) => r?.id).filter((x): x is string => !!x))) {
      const u = out.get(id);
      if (!u) continue;
      u.dives++;
      if (!u.lastUsedOn || d.startTime > u.lastUsedOn) u.lastUsedOn = d.startTime;
      const dal = service.get(id);
      if (dal) {
        /*
         * IL CONFRONTO È SUL GIORNO DEL LUOGO, non su quello UTC.
         *
         * `startTime` è sempre in UTC — lo scrivono così tutti i parser — mentre
         * `lastServiceOn` è un giorno di calendario scritto a mano. Prendendo i
         * primi dieci caratteri dell'istante UTC, un'immersione fatta alle nove
         * del mattino a Kiritimati (UTC+14) cade nel giorno PRECEDENTE, e una
         * fatta alle otto di sera alle Hawaii nel giorno successivo. Il conto
         * delle immersioni dall'ultima revisione — che è il numero per cui
         * l'inventario esiste — saltava di uno, e in quale direzione dipendeva da
         * dove si era andati a immergersi.
         */
        if (giornoLocale(d) > dal) u.divesSinceService = (u.divesSinceService ?? 0) + 1;
      }
    }
  }

  // Zero immersioni dall'ultima revisione è un'informazione; `undefined` è
  // un'altra cosa e vuol dire «revisione mai registrata».
  for (const e of equipment) {
    if (e.lastServiceOn) {
      const u = out.get(e.id);
      if (u && u.divesSinceService === undefined) u.divesSinceService = 0;
    }
  }
  return out;
}

/**
 * Il peso che un GAV aggiunge: piastra più contropiastra.
 *
 * `undefined` quando non è stato scritto niente, e non zero: zero significa
 * «questo GAV non pesa niente in acqua», che è un'affermazione, e riempirebbe
 * il campo dell'immersione impedendo a quello vero di entrarci.
 */
export function pesoDelGav(e: Pick<Equipment, 'plateKg' | 'backplateKg'> | undefined): number | undefined {
  if (!e) return undefined;
  if (e.plateKg === undefined && e.backplateKg === undefined) return undefined;
  return Math.round(((e.plateKg ?? 0) + (e.backplateKg ?? 0)) * 10) / 10;
}

/**
 * Il peso che ti tira giù DAVVERO: zavorra più piastra.
 *
 * Sono due campi separati perché si comportano in modo diverso — la zavorra la
 * cambi a ogni immersione secondo muta e acqua, la piastra è fissa e te la porti
 * sempre — ma per l'assetto contano insieme, e vanno sommati ovunque si
 * ragioni di quanto peso avevi addosso.
 *
 * Tenerli separati e poi dimenticarsi di sommarli è il difetto peggiore dei due
 * campi: chi ha una piastra d'acciaio da 3 kg e scrive «2 kg di zavorra» ne
 * porta cinque, e una statistica che legge solo `weightKg` racconta il
 * contrario di quello che succede in acqua.
 */
export function zavorraTotaleKg(
  dive: Pick<Dive, 'weightKg' | 'gear'>,
  inventario?: Pick<Equipment, 'id' | 'plateKg' | 'backplateKg'>[],
): number {
  return (dive.weightKg ?? 0) + (piastraDellImmersione(dive, inventario) ?? 0);
}

/**
 * I chili di piastra di un'immersione: quelli scritti su di lei, oppure quelli
 * del GAV che portava.
 *
 * PERCHÉ NON BASTA IL CAMPO SULL'IMMERSIONE. Il peso della piastra si scrive
 * sul GAV nell'inventario, e da lì viene proposto sull'immersione nel momento
 * in cui scegli quel GAV. Va benissimo per le immersioni future e non fa
 * niente per quelle passate: chi compila il peso della piastra oggi ha già
 * cento immersioni con quel GAV e nessun chilo scritto sopra, e ogni statistica
 * sulla zavorra continua a raccontarle senza. Il ripiego sull'inventario
 * chiude il buco senza toccare i dati.
 *
 * L'ORDINE È QUELLO DICHIARATO ALTROVE e non cambia: quello che c'è scritto
 * sull'immersione vince sempre, perché la configurazione si cambia — la piastra
 * d'alluminio per il viaggio, quella d'acciaio a casa — e la scelta del giorno
 * non deve essere sovrascritta da una proprietà generale del pezzo.
 */
export function piastraDellImmersione(
  dive: Pick<Dive, 'gear'>,
  inventario?: Pick<Equipment, 'id' | 'plateKg' | 'backplateKg'>[],
): number | undefined {
  if (dive.gear?.backplateKg !== undefined) return dive.gear.backplateKg;
  const id = dive.gear?.bcd?.id;
  if (!id || !inventario) return undefined;
  return pesoDelGav(inventario.find((e) => e.id === id));
}

/**
 * La configurazione usata, ricavata dal numero di bombole per immersione.
 *
 * Grossolana di proposito: distinguere un bibombola da due mono in sidemount
 * guardando il log non si può, e inventare la distinzione sarebbe peggio che
 * ammetterla. Serve a rispondere «quante immersioni ho fatto con più di una
 * bombola», che è l'unica cosa che il log sa davvero.
 */
export function configurationRows(dives: Dive[]): { label: string; dives: number }[] {
  const counts = new Map<string, number>();
  for (const d of dives) {
    const n = d.cylinders.length;
    const label =
      d.mode === 'ccr'
        ? 'Rebreather a circuito chiuso'
        : d.mode === 'scr'
          ? 'Rebreather semichiuso'
          : n === 0
            ? 'Bombole non registrate'
            : n === 1
              ? 'Una bombola'
              : n === 2
                ? 'Due bombole'
                : `${n} bombole`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, dives]) => ({ label, dives })).sort((a, b) => b.dives - a.dives);
}

// ---------------------------------------------------------------------------
// Fatti sulla manutenzione, senza giudizio
// ---------------------------------------------------------------------------

/** Somma mesi a una data ISO, tenendo i giorni impossibili dentro il mese giusto. */
export function addMonths(date: string, months: number): string | undefined {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return undefined;
  const d = new Date(t);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

export interface ServiceFacts {
  /** Mesi passati dall'ultima manutenzione. Assente se non c'è una data. */
  monthsSince?: number;
  /** Quando cadrebbe la prossima, secondo l'intervallo dichiarato. */
  nextOn?: string;
  /** Mesi da oggi alla prossima: negativo se è già passata. */
  monthsToNext?: number;
}

/**
 * I fatti sulla manutenzione di un pezzo.
 *
 * Restituisce NUMERI e non uno stato — niente `'ok' | 'due' | 'expired'`. È la
 * differenza fra questa versione e quella prima: uno stato è un giudizio, e per
 * darlo servirebbe sapere cose che l'applicazione non sa (se la bombola è ferma
 * in garage da un anno, se l'erogatore l'hai usato in piscina o in Egitto, se il
 * tuo centro fa la revisione ogni due anni). Chi legge ha quel contesto; questa
 * funzione gli dà i numeri e sta zitta.
 */
export function serviceFacts(item: Equipment, now = Date.now()): ServiceFacts {
  if (item.service === 'none' || !item.lastServiceOn) return {};
  const last = Date.parse(item.lastServiceOn);
  if (Number.isNaN(last)) return {};
  const MONTH = 30.44 * 24 * 3600 * 1000;
  const monthsSince = Math.max(0, Math.round((now - last) / MONTH));
  if (!item.intervalMonths || item.intervalMonths <= 0) return { monthsSince };
  const nextOn = addMonths(item.lastServiceOn, item.intervalMonths);
  const monthsToNext = nextOn ? Math.round((Date.parse(nextOn) - now) / MONTH) : undefined;
  return { monthsSince, nextOn, monthsToNext };
}

/** In quale ordine mostrare i pezzi: prima quelli in uso, poi per tipo e nome. */
export function sortEquipment(items: Equipment[]): Equipment[] {
  const order: EquipmentKind[] = ['cylinder', 'regulator', 'bcd', 'computer', 'suit', 'light', 'other'];
  return [...items].sort((a, b) => {
    if (!!a.retired !== !!b.retired) return a.retired ? 1 : -1;
    const k = order.indexOf(a.kind) - order.indexOf(b.kind);
    return k !== 0 ? k : a.name.localeCompare(b.name, 'it');
  });
}

/** Dal più recente: un brevetto si legge in ordine di conquista, al contrario. */
export function sortCertifications(items: Certification[]): Certification[] {
  return [...items].sort((a, b) => (b.issuedOn ?? '').localeCompare(a.issuedOn ?? ''));
}

/**
 * Quanto in giù ti autorizza ad andare ciascun livello.
 *
 * ► NON È L'ORDINE IN CUI I CINQUE VALORI STANNO SCRITTI NEL TIPO. ◄ E per mesi
 * lo è stato: `['base','advanced','deep','nitrox','tech']` usato come classifica
 * diceva che il Nitrox viene dopo il Profondo, e a chi aveva tutti e due
 * l'applicazione mostrava «livello più alto registrato: Nitrox / miscele».
 * Falso, e falso nel verso pericoloso: sembra una promozione e invece è la
 * risposta a un'altra domanda.
 *
 * Il Nitrox non è uno scalino di profondità. Insegna a calcolare la PPO2 e a
 * leggere una EAD, non a scendere più giù — anzi, con l'EAN32 la profondità
 * operativa massima è PIÙ BASSA che in aria (circa 33 m a PPO2 1,4), perché il
 * limite non è più l'azoto ma l'ossigeno. Un brevetto Nitrox, da solo, non dice
 * niente su fin dove sei addestrato: qui vale quanto il primo livello, non fa
 * punteggio per conto suo e non deve mai scavalcare un Avanzato o un Profondo.
 *
 * Vale quanto `base` e non zero perché serve una risposta anche a chi ha SOLO
 * quello: `undefined` vorrebbe dire «non hai brevetti», che è un'altra cosa e
 * sarebbe una bugia detta a una persona che un brevetto ce l'ha.
 */
const PROFONDITA_DEL_LIVELLO: Record<CertLevel, number> = {
  // Un brevetto introduttivo non autorizza a immergersi da soli: sta sotto a
  // tutto, e non deve scavalcare niente.
  intro: 0,
  base: 1,
  nitrox: 1,
  advanced: 2,
  deep: 3,
  tech: 4,
};

/**
 * Il livello più alto raggiunto, per il Coach.
 *
 * `undefined` quando non c'è nessun brevetto registrato: la scheda di prontezza
 * deve poter dire «non lo so» invece di assumere il primo livello, che sarebbe
 * un'affermazione su di te che nessuno ha fatto.
 */
export function highestLevel(certs: Certification[]): CertLevel | undefined {
  let migliore: CertLevel | undefined;
  for (const c of certs) {
    const grado = PROFONDITA_DEL_LIVELLO[c.level];
    // Un livello che non conosciamo — un archivio vecchio, un backup ritoccato a
    // mano — si salta invece di far finta che valga zero.
    if (grado === undefined) continue;
    if (migliore === undefined) {
      migliore = c.level;
      continue;
    }
    const attuale = PROFONDITA_DEL_LIVELLO[migliore];
    if (grado > attuale) migliore = c.level;
    // A pari grado vince quello che parla di profondità: fra `base` e `nitrox`
    // la risposta utile alla domanda «fin dove sei addestrato» è `base`.
    else if (grado === attuale && c.level === 'base') migliore = 'base';
  }
  return migliore;
}

/**
 * Se fra i brevetti c'è qualcosa che autorizza le miscele.
 *
 * Esiste perché `highestLevel` ha smesso di dirlo: il Nitrox è uscito dalla
 * classifica delle profondità, ma resta un'informazione che chi legge vuole
 * vedere. Il tecnico la comprende: non si arriva alla decompressione senza
 * passare dalle miscele.
 */
export function haMiscele(certs: Certification[]): boolean {
  return certs.some((c) => c.level === 'nitrox' || c.level === 'tech');
}

/**
 * Il brevetto in una riga: DIDATTICA e LIVELLO. «PADI Profondo (fino a 40 m)».
 *
 * Sta qui e non nella pagina perché la STESSA stringa serve in due posti — la
 * tendina della carta del libretto e il valore salvato che poi si stampa — e se
 * i due la componessero ognuno per conto suo, al primo ritocco la tendina
 * smetterebbe di riconoscere il valore già salvato e comparirebbe vuota.
 *
 * ► PERCHÉ NON IL NOME SULLA TESSERA. ◄ La prima versione metteva nome +
 * didattica, e sul primo archivio vero è uscita sbagliata all'istante. Il campo
 * «Nome sulla tessera» invita a scriverci il nome DI CHI HA la tessera — che è
 * quello che c'è scritto sopra, in effetti — e quattro brevetti diversi
 * portavano tutti e quattro «Matteo Ferrando — PADI». La tendina, che scarta i
 * doppioni perché due voci identiche non si possono distinguere, ne mostrava
 * UNA SOLA. Non è un caso limite: il campo si compila così quasi sempre.
 *
 * Didattica e livello invece sono sempre pieni — il livello è obbligatorio, la
 * didattica la si ricorda — sono diversi fra un brevetto e l'altro, e sono le
 * due cose che dicono qualcosa a chi legge il libretto: fin dove sei addestrato
 * e chi te l'ha insegnato. Il nome commerciale, che nessuno ricorda per esteso,
 * resta nell'elenco per chi lo consulta.
 *
 * ► PERCHÉ LA STRINGA RESTA ITALIANA ANCHE IN INGLESE. ◄ Questa è la chiave
 * SALVATA, non il testo mostrato: la tendina traduce al disegno. Salvando la
 * versione tradotta, cambiare lingua renderebbe irriconoscibile il brevetto già
 * scelto e la tendina comparirebbe vuota — con il valore vecchio degradato a
 * «scritto a mano». È la stessa regola degli `id` degli obiettivi: un'etichetta
 * si traduce, una chiave d'archivio no.
 */
export function etichettaBrevetto(c: Certification): string {
  const didattica = c.agency.trim();
  const nome = c.name.trim();
  /*
   * Il NOME vale come etichetta solo se viene dal catalogo.
   *
   * Se è stato scelto da un elenco è il nome ufficiale di un corso — «Deep
   * Diver», «3° Grado AR» — ed è la cosa migliore che si possa scrivere sul
   * libretto. Se è stato digitato, non si sa cosa sia: sul primo archivio vero
   * quattro brevetti diversi avevano tutti e quattro il nome del subacqueo,
   * perché il campo si chiama «Nome sulla tessera» e sulla tessera il nome
   * c'è davvero. Lì si torna al livello, che almeno è scelto da una lista.
   */
  if (c.didatticaId && nome) return [didattica, nome].filter(Boolean).join(' ');
  return [didattica, CERT_LEVEL_LABEL[c.level]].filter(Boolean).join(' ');
}

/**
 * La qualifica più alta fra i brevetti registrati, se ce n'è una.
 *
 * Separata da `highestLevel` perché risponde a un'altra domanda: non «fin dove
 * scendi» ma «cosa sei abilitato a fare». Un istruttore può benissimo non
 * avere il Profondo, e un Profondo non è una guida.
 */
export function ruoloPiuAlto(certs: Certification[]): RuoloBrevetto | undefined {
  let migliore = -1;
  for (const c of certs) {
    const i = c.ruolo ? SCALA_RUOLI.indexOf(c.ruolo) : -1;
    if (i > migliore) migliore = i;
  }
  return migliore < 0 ? undefined : SCALA_RUOLI[migliore];
}

/**
 * La profondità più alta DICHIARATA dai brevetti registrati, in metri.
 *
 * `undefined` quando nessuno dei brevetti ne dichiara una — e succede: chi ha
 * solo brevetti scritti a mano non ha nessun numero da nessuna parte, e
 * inventarne uno partendo dal livello vorrebbe dire attribuirgli
 * un'autorizzazione che nessuna didattica gli ha dato.
 */
export function profonditaDichiarata(certs: Certification[]): number | undefined {
  let massima: number | undefined;
  for (const c of certs) {
    if (c.profonditaM === undefined) continue;
    if (massima === undefined || c.profonditaM > massima) massima = c.profonditaM;
  }
  return massima;
}

/** Se fra i brevetti ce n'è almeno uno che prevede la decompressione. */
export function haDecompressione(certs: Certification[]): boolean {
  return certs.some((c) => c.decompressione === true);
}

// ---------------------------------------------------------------------------
// Migrazione dalla versione vecchia
// ---------------------------------------------------------------------------

/** La forma vecchia, tenuta solo per poterla leggere e convertire. */
export interface LegacyGearItem {
  id: string;
  kind: string;
  name: string;
  serial?: string;
  lastServiceDate?: string;
  intervalMonths?: number;
  expiresOn?: string;
  notes?: string;
  savedAt?: string;
}

export interface GearArchive {
  equipment: Equipment[];
  certifications: Certification[];
}

/**
 * Converte l'elenco unico della versione vecchia nei due elenchi nuovi.
 *
 * Le voci che erano brevetti diventano brevetti; certificato medico e
 * assicurazione — che nella versione nuova non esistono più come categoria,
 * perché l'utente ha chiesto di non essere avvisato di niente — NON si buttano:
 * finiscono fra le attrezzature con `service: 'none'` e la loro data nelle note,
 * così nessun dato scritto a mano va perduto. Buttare silenziosamente qualcosa
 * che qualcuno ha digitato è il modo più rapido di far perdere fiducia a
 * un'applicazione.
 */
export function migrateGear(legacy: LegacyGearItem[] | GearArchive | null | undefined): GearArchive {
  if (!legacy) return { equipment: [], certifications: [] };
  if (!Array.isArray(legacy)) return legacy;

  const equipment: Equipment[] = [];
  const certifications: Certification[] = [];

  for (const old of legacy) {
    if (old.kind === 'certification') {
      certifications.push({
        id: old.id,
        agency: '',
        name: old.name,
        // Il livello non si può indovinare dal nome commerciale: si mette il
        // primo e si lascia correggere. Fingere di saperlo sarebbe peggio.
        level: 'base',
        issuedOn: old.lastServiceDate,
        number: old.serial,
        notes: old.notes,
        savedAt: old.savedAt,
      });
      continue;
    }
    const kind: EquipmentKind = (
      ['cylinder', 'regulator', 'bcd', 'computer', 'suit', 'light'] as string[]
    ).includes(old.kind)
      ? (old.kind as EquipmentKind)
      : 'other';
    const scaduto = old.kind === 'medical' || old.kind === 'insurance';
    const scadenza =
      old.expiresOn ??
      (old.lastServiceDate && old.intervalMonths
        ? addMonths(old.lastServiceDate, old.intervalMonths)
        : undefined);
    equipment.push({
      id: old.id,
      kind,
      name: scaduto
        ? `${old.kind === 'medical' ? 'Certificato medico' : 'Assicurazione'} — ${old.name}`
        : old.name,
      serial: old.serial,
      service: scaduto ? 'none' : TYPICAL_SERVICE[kind],
      lastServiceOn: scaduto ? undefined : old.lastServiceDate,
      intervalMonths: scaduto ? undefined : old.intervalMonths,
      notes:
        [
          old.notes,
          scaduto && scadenza ? `Scadenza registrata nella versione precedente: ${scadenza}` : undefined,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      savedAt: old.savedAt,
    });
  }
  return { equipment, certifications };
}
