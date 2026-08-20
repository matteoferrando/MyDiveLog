/**
 * Modello canonico delle immersioni.
 *
 * Regola d'oro del progetto: OGNI parser converte nel modello qui sotto e in
 * QUESTE unità. Nessuna unità imperiale, nessun millimetro, nessun Pascal
 * sopravvive all'import. Le conversioni stanno tutte in `units.ts`.
 *
 *   profondità .... metri              (numero reale, positivo verso il basso)
 *   tempo ......... secondi            (interi, dall'inizio dell'immersione)
 *   pressione ..... bar
 *   temperatura ... gradi Celsius
 *   volume ........ litri
 *   frazioni gas .. 0..1               (0.21 = 21% O2, NON 21)
 *
 * Questo file non importa nulla: è condiviso senza modifiche fra desktop
 * (Tauri/macOS), iOS e web.
 */

export type SourceFormat =
  | 'uddf'
  | 'subsurface'
  | 'shearwater-xml'
  | 'shearwater-cloud'
  | 'garmin-fit'
  | 'logtrak'
  | 'csv'
  /*
   * Scaricata direttamente dal computer via Bluetooth.
   *
   * È una provenienza a sé e non «shearwater-cloud»: il contenuto è lo stesso
   * blob nativo, ma quello che ARRIVA È DIVERSO — dal computer non vengono
   * sito, compagno, note, zavorra e muta, che sono campi dell'applicazione del
   * costruttore e non del logbook. Dirlo nella provenienza è ciò che permette
   * alla scheda dell'immersione di spiegare perché quei campi sono vuoti, e
   * alla fusione di sapere che un file di Shearwater Cloud sulla stessa
   * immersione porta cose in più invece di essere un doppione.
   */
  | 'shearwater-ble'
  | 'uwatec-ble'
  // Inserita a mano, senza nessun file dietro. È una sorgente a tutti gli
  // effetti e non un caso speciale: l'immersione col computer a noleggio o
  // ricopiata dal libretto di carta vale quanto le altre, e soprattutto DEVE
  // stare nell'archivio perché la catena dei tessuti si calcola su di lui —
  // un buco non è una riga in meno, è il GF99 sbagliato su quella dopo.
  | 'manual';

export type DiveMode = 'oc' | 'ccr' | 'scr' | 'gauge' | 'freedive';

export type Salinity = 'salt' | 'fresh';

/** Miscela respiratoria. Frazioni 0..1. Il resto è azoto. */
export interface GasMix {
  o2: number;
  he: number;
}

export interface Cylinder {
  /** Etichetta libera: "D12 200", "S80", "stage 40%". */
  description?: string;
  /**
   * Materiale, quando la fonte lo dichiara. Non è un dettaglio da inventario:
   * acciaio e alluminio hanno assetto diverso a bombola vuota, ed è una delle
   * spiegazioni possibili di un'oscillazione che peggiora verso la fine.
   */
  material?: 'steel' | 'alu' | 'carbon';
  /** Volume d'acqua in litri (12 = bombola da 12 L). */
  sizeL?: number;
  workPressureBar?: number;
  startBar?: number;
  endBar?: number;
  mix: GasMix;
}

/**
 * Un campione del profilo. Tutti i campi oltre `t` e `depth` sono opzionali:
 * dipende da cosa il computer registra e da cosa il formato di export salva.
 */
/**
 * Un pezzo di attrezzatura usato in un'immersione.
 *
 * DUE CAMPI E NON UNO SOLO, e la ragione è che si contraddicono a vicenda nel
 * momento giusto. L'identificativo aggancia la voce all'inventario, e serve a
 * rispondere a «quante immersioni ha questo erogatore dall'ultima revisione» —
 * che è tutto il motivo per cui l'inventario esiste. Il nome è la copia
 * congelata di com'era chiamato allora, e serve quando l'aggancio si rompe:
 * attrezzo venduto, inventario ricostruito, archivio importato su un altro
 * dispositivo. Con il solo identificativo, quel giorno, l'immersione del 2023
 * direbbe «—»; col solo nome non si potrebbero contare le immersioni per
 * attrezzo.
 */
export interface GearRef {
  /** Identificativo nell'inventario attrezzatura, quando la voce viene da lì. */
  id?: string;
  /** Come si chiamava quando l'hai usato. Sempre presente. */
  name: string;
}

export type Weather = 'sunny' | 'cloudy' | 'overcast' | 'rainy' | 'snowy' | 'windy' | 'fog';
export type Waves = 'calm' | 'moderate' | 'rough' | 'veryRough';

export interface DiveConditions {
  weather?: Weather;
  waves?: Waves;
}

export interface DiveGear {
  /**
   * Gli erogatori, uno o due.
   *
   * Due sono la norma in configurazione tecnica — primo stadio principale e
   * secondo indipendente — e ognuno ha la sua revisione: contarli come uno solo
   * significa non sapere quale dei due è indietro di manutenzione.
   */
  regulators?: GearRef[];
  bcd?: GearRef;
  suit?: GearRef;
  /**
   * Il peso della piastra o dello schienalino, chilogrammi.
   *
   * Va tenuto SEPARATO dalla zavorra e sommato solo quando si ragiona di
   * assetto. Sono due cose che si comportano in modo diverso: la zavorra la
   * cambi a ogni immersione secondo muta e acqua, la piastra è fissa e te la
   * porti sempre dietro. Un subacqueo tecnico con una piastra d'acciaio da 3 kg
   * che scrive «2 kg di zavorra» ne porta cinque, e la storia della sua
   * zavorra letta senza questo campo dice il contrario di quello che succede.
   */
  backplateKg?: number;
  /** Torce, mulinelli, macchine fotografiche: quello che non ha un campo suo. */
  other?: GearRef[];
}

export interface Sample {
  /** Secondi dall'inizio dell'immersione. */
  t: number;
  /** Metri. */
  depth: number;
  tempC?: number;
  /** Pressione per bombola, indicizzata come `Dive.cylinders`. bar. */
  pressureBar?: (number | undefined)[];
  /** No-deco limit residuo, secondi. */
  ndlS?: number;
  /** Time to surface, secondi. */
  ttsS?: number;
  /** Profondità della prossima tappa deco, metri (0 = nessuna). */
  stopDepth?: number;
  /** Durata della prossima tappa deco, secondi. */
  stopTimeS?: number;
  /** Tetto di decompressione calcolato dal computer, metri. */
  ceiling?: number;
  inDeco?: boolean;
  /** Percentuale CNS, 0..100+. */
  cns?: number;
  /** PPO2 in bar (misurata o media celle). */
  ppo2?: number;
  /** Setpoint CCR in bar. */
  setpoint?: number;
  /**
   * Tempo di fondo residuo secondo il computer, minuti: quanto puoi restare a
   * questa profondità prima che la bombola scenda alla riserva. Lo calcolano solo
   * i computer con il trasmettitore collegato, e non è la stessa cosa dell'NDL —
   * quello è il limite della decompressione, questo è il limite del gas.
   */
  rbtMin?: number;
  /** Rilevamento della bussola, gradi. */
  bearing?: number;
  /** Indice in `Dive.cylinders` del gas respirato in questo istante. */
  gasIndex?: number;
  heartRate?: number;
}

/** Un istante marcato dal subacqueo durante l'immersione. */
export interface DiveEvent {
  /** Secondi dall'inizio. */
  t: number;
  /** Rilevamento della bussola al momento del segnalibro, gradi. */
  bearing?: number;
  /** Etichetta o valore numerico che il computer associa al segnalibro. */
  label?: string;
}

export interface DiveSite {
  name: string;
  region?: string;
  country?: string;
  lat?: number;
  lon?: number;
}

export interface ComputerInfo {
  model?: string;
  serial?: string;
  /** Identificativo del dispositivo così come lo scrive il formato sorgente. */
  deviceId?: string;
  /** Identificativo dell'immersione assegnato dal computer: chiave di dedup forte. */
  diveId?: string;
  /**
   * Impronta dei byte del PROFILO, quando la sorgente li porta.
   *
   * Serve a riconoscere due copie della stessa immersione quando l'orario non
   * si può usare: sull'archivio di prova ci sono due immersioni la cui data il
   * computer aveva sbagliato di 77 e di 118 giorni e che sono state corrette a
   * mano nell'applicazione del costruttore. Profondità e durata coincidono al
   * decimetro, ma quattro mesi di scarto sfondano qualunque finestra temporale:
   * senza questa impronta, riscaricando dal computer tornano come nuove a ogni
   * connessione, per sempre.
   *
   * Vale come prova POSITIVA e basta: due impronte uguali sono mille byte di
   * profilo identici, quindi la stessa immersione. Due impronte diverse non
   * affermano niente — le sorgenti che il profilo non ce l'hanno non ne hanno
   * nemmeno una — e si torna al confronto su orario, profondità e durata.
   */
  profileFingerprint?: string;
  firmware?: string;
  decoModel?: string;
  /**
   * Gradient factor IMPOSTATI sul computer per questa immersione.
   *
   * Non sono un dettaglio da collezionisti: il GF99 all'uscita e l'obbligo
   * decompressivo che il computer ha mostrato dipendono da questi due numeri.
   * Confrontare la disciplina in risalita fra due immersioni fatte con
   * impostazioni diverse senza saperlo porta a conclusioni sbagliate.
   */
  gfLow?: number;
  gfHigh?: number;
  /** Conservatorismo, per i modelli VPM-B. */
  conservatism?: number;
  /** Densità dell'acqua impostata sul computer, kg/m³ (1000 = dolce). */
  waterDensityKgM3?: number;
  /** Passo di campionamento del computer, secondi. */
  sampleIntervalS?: number;
  /** Versione del formato di log: serve a sapere quali campi aspettarsi. */
  logVersion?: number;
  /** Stato dell'integrazione aria, come lo descrive il computer. */
  aiMode?: string;
  /** Limiti di PPO2 impostati sul computer, bar. */
  ppo2MaxBar?: number;
  ppo2MinBar?: number;
  /** Versione hardware, quando la fonte la dichiara. */
  hwVersion?: string;
  /** Modalità impostata: circuito aperto ricreativo/tecnico, CCR, gauge, apnea. */
  computerMode?: string;
}

/**
 * Valori di sintesi che il COMPUTER ha calcolato, tenuti separati dalle nostre
 * `DiveMetrics`.
 *
 * La separazione è il punto: un tetto di decompressione letto dal computer e uno
 * dedotto da noi dal profilo sono due cose diverse, e mostrarli nella stessa
 * colonna renderebbe impossibile distinguerli. Qui dentro c'è solo ciò che è
 * stato letto, mai ciò che è stato calcolato.
 */
export interface ReportedSummary {
  /**
   * GF99 all'uscita: quanto il subacqueo era sovrasaturo rispetto al gradiente
   * ammesso, in percentuale, nel momento in cui è arrivato in superficie.
   * Lo calcolano i computer Shearwater; nessun altro formato qui supportato lo dà.
   */
  gf99End?: number;
  /** Obbligo decompressivo massimo incontrato, secondi. */
  maxDecoObligationS?: number;
  /** NDL minimo raggiunto, secondi. */
  minNdlS?: number;
  /** Consumo medio dichiarato dal computer, bar/min o L/min secondo la fonte. */
  avgSac?: string;
}

export interface SourceInfo {
  format: SourceFormat;
  /** Nome del file importato, per tracciabilità. */
  file: string;
  /** ISO 8601. */
  importedAt: string;
}

export interface Dive {
  /** Hash stabile e deterministico: reimportare lo stesso file dà lo stesso id. */
  id: string;
  /**
   * Quando questo record è cambiato l'ultima volta, ISO 8601.
   *
   * Serve alla sincronizzazione per decidere quale versione vince quando la
   * stessa immersione è stata toccata su due dispositivi. Lo scrive chi modifica
   * — import, modifica manuale, merge — e NON viene riscritto quando il record
   * arriva da remoto, altrimenti ogni sincronizzazione sembrerebbe una modifica.
   */
  updatedAt?: string;
  /** Numero progressivo dal computer/logbook sorgente. */
  number?: number;
  /** ISO 8601 con offset. Inizio immersione. */
  startTime: string;
  /**
   * Offset del fuso orario nel LUOGO dell'immersione, in minuti.
   *
   * Serve per mostrare l'ora che il computer subacqueo mostrava. Senza questo
   * campo un'immersione fatta alle 9 del mattino in Mar Rosso apparirebbe alle 8
   * a chi guarda il logbook dall'Italia, che per un logbook è un errore: l'orario
   * di un'immersione è quello del posto in cui l'hai fatta.
   */
  utcOffsetMinutes?: number;
  durationS: number;
  maxDepth: number;
  avgDepth?: number;
  minTempC?: number;
  airTempC?: number;
  site?: DiveSite;
  buddy?: string;
  notes?: string;
  mode: DiveMode;
  cylinders: Cylinder[];
  salinity?: Salinity;
  surfacePressureBar?: number;
  /** Intervallo di superficie dall'immersione precedente, secondi. */
  surfaceIntervalS?: number;
  computer?: ComputerInfo;
  /**
   * Gli altri computer che hanno registrato la stessa immersione.
   *
   * `computer` è quello da cui viene il profilo tenuto; questi sono gli altri, con
   * le loro impostazioni. Un Aladin dichiara i limiti di PPO2 e un Peregrine i
   * gradient factor: sono dati diversi sullo stesso tuffo, e tenere solo il
   * computer "vincente" ne butterebbe via metà.
   */
  otherComputers?: ComputerInfo[];
  /** La fonte da cui questo record è nato. */
  source: SourceInfo;
  /**
   * Le altre fonti che hanno contribuito, quando la stessa immersione è arrivata
   * da più file (vedi `dedupe.ts`).
   *
   * Serve perché senza questo campo un'immersione fusa da LogTRAK e da Shearwater
   * mostra una sola provenienza, e sembra che i dati dell'altro computer non siano
   * entrati. Sono entrati: questo elenco lo rende verificabile.
   */
  extraSources?: SourceInfo[];
  /** 1..5, dal logbook sorgente se presente. */
  rating?: number;
  /**
   * Il titolo che le dai tu: «notturna al relitto», «prova del secchio nuovo».
   *
   * Distinto dal sito e dalle note. Il sito è un luogo e si ripete decine di
   * volte; le note sono un testo lungo che nessuna riga di tabella può
   * mostrare. Il titolo è la riga che riconosci scorrendo l'elenco, ed è
   * l'unica cosa che distingue la terza immersione della settimana dalle altre
   * due fatte nello stesso posto.
   */
  title?: string;
  /**
   * La guida sub, tenuta separata dal compagno.
   *
   * Non è pignoleria: sono due ruoli diversi e rispondono a due domande
   * diverse. «Con chi mi immergo di solito» è il compagno; «chi mi ha portato»
   * è la guida, e in un centro cambia a ogni uscita. Metterli nello stesso
   * campo — che è quello che facevamo — rende inutilizzabili entrambe le
   * statistiche.
   */
  guide?: string;
  /**
   * Visibilità in metri. Con `visibilityMaxM`, è l'estremo BASSO di una fascia.
   *
   * Da solo resta quello che era: una stima puntuale. Il campo alto esiste
   * perché la visibilità non si misura, si stima a occhio in una fascia («fra
   * cinque e dieci metri»), e costringere a un numero solo fa scegliere a caso
   * fra i due estremi. Le statistiche continuano a usare questo, cioè
   * l'estremo prudente.
   */
  visibilityM?: number;
  /** L'estremo ALTO della fascia di visibilità, quando è una fascia. */
  visibilityMaxM?: number;
  /**
   * Le condizioni, in forma leggibile da una macchina.
   *
   * Fino a ieri meteo e mare finivano dentro `tags` come etichette italiane
   * («sole», «mare mosso»), che è quello che fa l'import da LogTRAK. Va bene
   * per mostrarle e non serve a niente per contarle: «le immersioni col mare
   * agitato consumano di più» è una domanda a cui una stringa non risponde.
   *
   * I dati vecchi non si migrano: `conditionsOf()` legge tutte e due le forme,
   * e la prima volta che si salva la scheda quella immersione passa alla nuova.
   */
  conditions?: DiveConditions;
  /**
   * L'attrezzatura usata in questa immersione, agganciata all'inventario.
   *
   * Vedi `DiveGear`: ogni voce porta con sé il nome oltre all'identificativo,
   * perché un'immersione di tre anni fa deve continuare a dire con che
   * erogatore l'hai fatta anche quando quell'erogatore è stato venduto e
   * cancellato dall'inventario.
   */
  gear?: DiveGear;
  /**
   * Zavorra usata, chilogrammi. La teniamo perché la sovra-zavorra è la prima
   * causa di assetto instabile e di consumo alto: avere il peso accanto
   * all'oscillazione misurata rende il consiglio verificabile.
   */
  weightKg?: number;
  /** Muta o sistema di protezione termica, come dichiarato dal logbook di origine. */
  suit?: string;
  /**
   * Annotazioni del logbook di origine che non hanno un posto nel modello:
   * carico di lavoro, comfort termico, tipo di uscita, problemi riscontrati.
   *
   * Un sacchetto libero invece di un campo per ciascuna, e non per pigrizia:
   * ogni produttore ne inventa di proprie, e mappare a forza "ThermalComfort:
   * Cool" in un campo nostro significherebbe scegliere una scala che non è la
   * loro. Così il dato arriva intatto e la scheda lo mostra come lo ha scritto
   * chi lo ha registrato.
   */
  annotations?: Record<string, string>;
  /** Valori di sintesi letti dal computer, distinti da quelli calcolati da noi. */
  reported?: ReportedSummary;
  /**
   * Segnalibri e rilevamenti registrati durante l'immersione premendo un tasto sul
   * computer. Sono gli unici dati del profilo messi lì dal subacqueo e non dal
   * sensore: marcano il punto in cui è successo qualcosa.
   */
  events?: DiveEvent[];
  tags: string[];
  /**
   * Profilo. Staccato dallo storage: la lista del logbook non lo carica mai,
   * la scheda immersione sì. Vedi `storage/types.ts`.
   *
   * Quando la stessa immersione arriva da due computer, questo è il profilo con
   * più CANALI — quello che porta tetto di decompressione, NDL, TTS, CNS.
   */
  samples?: Sample[];
  /**
   * Il secondo profilo, quando due computer hanno registrato la stessa immersione
   * e il perdente è più FITTO del vincente.
   *
   * Non è una copia di scorta: serve a misurare. L'oscillazione d'assetto dipende
   * dalla densità di campionamento, e sui dati reali di questo archivio un profilo
   * a 10 s la legge un terzo più bassa di uno a 4 s sulla stessa immersione. Se le
   * immersioni recenti usassero il profilo rado e quelle vecchie quello fitto, la
   * tendenza dell'assetto mostrerebbe un miglioramento che è solo un cambio di
   * strumento. Con entrambi i profili in archivio, le metriche che dipendono dalla
   * risoluzione si calcolano sempre sul più fitto disponibile.
   */
  altSamples?: Sample[];
  /** Calcolato da `analysis/metrics.ts`, salvato per non ricalcolare ogni volta. */
  metrics?: DiveMetrics;
}

/** Le tre fasi in cui l'analisi divide un'immersione. */
export interface DivePhases {
  descentEndS: number;
  ascentStartS: number;
  /** Secondi. */
  descentS: number;
  bottomS: number;
  ascentS: number;
}

export interface DiveMetrics {
  /**
   * Profondità media pesata sul tempo, metri.
   *
   * `undefined` quando non è ricavabile: senza profilo campionato e senza un
   * valore dichiarato dal computer non esiste. Stimarla come metà della
   * profondità massima sarebbe comodo e sbagliato — e siccome il consumo si
   * calcola da qui, un'ipotesi qui diventa un consumo credibile e falso.
   */
  avgDepth?: number;
  /** Pressione ambiente media durante l'immersione, in ATA. `undefined` se la media è ignota. */
  avgAta?: number;
  phases: DivePhases;

  // --- consumo gas ---
  /** Consumo di superficie (Respiratory Minute Volume), L/min. */
  rmvLpm?: number;
  /** SAC in bar/min sulla bombola principale (dipende dalla bombola: meno confrontabile). */
  sacBarPerMin?: number;
  /** Pressione a fine immersione sulla bombola principale, bar. */
  endPressureBar?: number;
  /** Frazione di gas rimasta: 50/200 = 0.25. */
  reserveFraction?: number;

  // --- controllo verticale ---
  /** Velocità media di discesa, m/min. */
  descentRateMpm?: number;
  /** Velocità media di risalita nella fase finale, m/min. */
  ascentRateMpm?: number;
  /** Picco di risalita su finestra mobile di 30 s, m/min. */
  maxAscentRateMpm?: number;
  /** Secondi passati a risalire oltre 10 m/min. */
  fastAscentS: number;
  /** Secondi passati a risalire oltre 6 m/min sopra i 10 m (la zona che conta). */
  fastShallowAscentS: number;

  // --- assetto ---
  /**
   * Metri verticali percorsi per minuto nei tratti in cui il subacqueo TIENE la
   * quota (esclusi discesa, risalita e ogni transito), al netto dello spostamento
   * voluto in ciascun tratto.
   *
   * Proxy diretto del controllo d'assetto: chi tiene la quota sta sotto 2 m/min.
   * Il nome resta `bottom...` per compatibilità con gli archivi già salvati.
   */
  bottomVerticalTravelMpm?: number;
  /** Deviazione standard della profondità nei tratti a quota tenuta, metri. */
  bottomDepthStdM?: number;
  /** Secondi su cui la misura d'assetto è stata calcolata (quota tenuta, non transito). */
  holdingS?: number;

  // --- sicurezza / deco ---
  /** Secondi nella finestra 3-6 m durante la risalita finale. */
  safetyStopS: number;
  didSafetyStop: boolean;
  /** Secondi con obbligo deco attivo. */
  decoS: number;
  /** Secondi in cui la profondità era inferiore al tetto (violazione). */
  ceilingViolationS: number;
  maxCeilingM?: number;
  cnsEndPct?: number;

  // --- esposizione ---
  minTempC?: number;
  /** Frazione massima di O2 respirata e relativa PPO2 di picco, bar. */
  maxPpo2?: number;
  /** Profondità equivalente in aria alla massima profondità, metri (solo trimix). */
  endM?: number;
  /**
   * Percentuale dell'orologio CNS accumulata in questa immersione, con i limiti
   * NOAA per singola esposizione. È un valore CALCOLATO da noi dal profilo: il
   * `cnsEndPct` qui sopra è invece quello che ha scritto il computer, con il suo
   * modello. Divergono, e vanno mostrati separati.
   */
  cnsPct?: number;
  /** OTU accumulate, dose polmonare cumulativa. */
  otu?: number;
  /** Minuti passati sopra 1.4 e sopra 1.6 bar di PPO2. */
  minutesAbovePpo214?: number;
  minutesAbovePpo216?: number;
  /**
   * Velocità media sull'ULTIMO tratto, dalla sosta di sicurezza alla superficie.
   *
   * Esiste come metrica a sé perché la finestra mobile di 30 secondi la nasconde:
   * cinque metri percorsi a 30 m/min durano dieci secondi, e dentro una finestra
   * di trenta si diluiscono in un valore innocuo. È il tratto in cui DAN misura
   * una media reale di 60 m/min (TDI Advanced Nitrox p. 38), cioè il difetto di
   * comportamento più diffuso e insieme il meno visibile.
   */
  finalAscentRateMpm?: number;
  /** Da che profondità è partito quel tratto finale, metri. */
  finalAscentFromM?: number;
  /** Secondi passati in sosta profonda, attorno a metà della profondità massima. */
  deepStopS: number;
  /** A che profondità è stata fatta, metri. */
  deepStopDepthM?: number;
  /**
   * Metri verticali "sprecati" in ridiscese dopo essere già risaliti, per ora di
   * immersione: l'indice del profilo a dente di sega, che la didattica dice di
   * evitare senza darne una soglia numerica. Va letto in relativo, confrontandolo
   * con le proprie immersioni, non contro un limite.
   */
  sawtoothMPerHour?: number;
  /**
   * Di quanti metri la prima metà dell'immersione è più profonda della seconda.
   *
   * Positivo è il verso raccomandato («deeper portion first»). Esiste come numero
   * e non solo come `deepestPartFirst` perché due metri di differenza e venti non
   * sono la stessa cosa, e un booleano li appiattiva sullo stesso giudizio.
   */
  depthTrendM?: number;
  /** Vero se la parte profonda dell'immersione viene per prima, come si raccomanda. */
  deepestPartFirst?: boolean;
  /** PPO2 minima respirata, bar: conta sui rebreather e sulle miscele ipossiche. */
  minPpo2?: number;
  /**
   * Cambi di gas fatti a una profondità superiore alla MOD del gas su cui si è
   * passati. È un errore grave e verificabile a posteriori.
   */
  badGasSwitches: number;

  // --- saturazione, dal nostro Bühlmann ---
  /**
   * GF99 all'uscita calcolato da noi, percentuale.
   *
   * Distinto da `reported.gf99End`, che è quello scritto dal computer: modelli
   * diversi, numeri diversi, e vanno letti separati. Questo però c'è su TUTTE le
   * immersioni con un profilo, anche quelle di computer che il GF99 non lo
   * scrivono, ed è calcolato tenendo conto del carico residuo dalla precedente.
   * Validato contro Shearwater su 38 immersioni: scarto medio 0.8 punti.
   */
  gf99Pct?: number;
  /** Il GF99 più alto toccato durante l'immersione, non solo all'uscita. */
  gf99MaxPct?: number;
  /**
   * Azoto in eccesso all'ingresso rispetto all'equilibrio in superficie, bar.
   *
   * Presente solo sulle ripetitive. Non è un GF99 d'ingresso: a un bar di
   * pressione non si è sovrasaturi quasi mai, ma l'azoto in più c'è, e si paga
   * riscendendo.
   */
  residualN2Bar?: number;
  /**
   * Quanto sarebbe uscita questa stessa immersione partendo da tessuti puliti.
   *
   * La differenza con `gf99Pct` è il prezzo dell'intervallo di superficie, ed è
   * l'unico modo di dire una cosa comprensibile sul carico residuo.
   */
  gf99CleanPct?: number;
  /** Compartimento che comandava all'uscita, 1-16. Basso = tessuto veloce. */
  leadingCompartment?: number;
  /** Minuti di superficie dalla precedente. Assente se la catena parte qui. */
  surfaceIntervalMin?: number;
  /**
   * Azoto ed elio nei sedici compartimenti a fine immersione, bar.
   *
   * Serve a incatenare la ripetitiva successiva senza rileggere questo profilo.
   * Sta dentro `metrics` di proposito: la sincronizzazione esclude le metriche dal
   * digest, quindi ricalcolarle non fa rispedire l'archivio intero.
   */
  tissuesEnd?: { n2: number[]; he: number[] };
  /**
   * Vero quando i tessuti non vengono da un profilo registrato ma da un profilo
   * QUADRO ricostruito da profondità media e durata.
   *
   * Serve alle immersioni senza campioni — inserite a mano, o arrivate da un CSV
   * di riepilogo. Prima la catena si spezzava su di loro e la ripetitiva dopo
   * ripartiva da tessuti puliti, cioè con un GF99 ottimista; ora il carico si
   * stima, ed è quasi sempre più vicino al vero di quanto lo sia lo zero. Ma
   * resta una STIMA, e ogni numero che ne discende deve dirlo: è la stessa
   * regola per cui nessuna metrica viene inventata quando il dato non c'è.
   */
  tissuesEstimated?: boolean;
  /**
   * Quanti campioni sono stati scartati perché illeggibili. Diverso da zero
   * significa che questi numeri descrivono un profilo con dei buchi.
   */
  skippedSamples?: number;

  /** Qualità del dato: quali metriche sono affidabili. */
  quality: MetricQuality;
}

export interface MetricQuality {
  /** Numero di campioni usati. */
  sampleCount: number;
  /** Intervallo medio fra campioni, secondi. Sopra 20 s le velocità sono grossolane. */
  sampleIntervalS: number;
  hasProfile: boolean;
  hasTankPressure: boolean;
  hasCylinderVolume: boolean;
  hasCeiling: boolean;
  /**
   * Passo del profilo su cui sono state calcolate le metriche che dipendono dalla
   * risoluzione (assetto, velocità verticali), secondi. Può essere diverso da
   * `sampleIntervalS` quando l'immersione ha due profili e il più fitto è il
   * secondo: è il dato che rende confrontabili fra loro immersioni registrate da
   * computer con passi diversi.
   */
  ratesIntervalS: number;
  /** Vero se le velocità vengono dal secondo profilo, più fitto del principale. */
  ratesFromAlt: boolean;
  /** Note leggibili sui limiti del calcolo, mostrate nella UI. */
  caveats: string[];
}

// ---------------------------------------------------------------------------
// Costanti di dominio. Cambiare qui, non nel codice di analisi.
// ---------------------------------------------------------------------------

export const AIR: GasMix = { o2: 0.21, he: 0 };

export const LIMITS = {
  /** Velocità di risalita massima raccomandata sotto i 10 m, m/min. */
  ascentRateDeepMpm: 10,
  /** Velocità di risalita massima raccomandata sopra i 10 m, m/min. */
  ascentRateShallowMpm: 6,
  /** Velocità di discesa oltre cui si parla di discesa "in caduta", m/min. */
  descentRateMpm: 20,
  /**
   * Durata minima di una sosta di sicurezza per considerarla fatta, secondi.
   *
   * Tre minuti, non due e mezzo: «the traditional shallow safety stop would also
   * be conducted for three to five minutes» (TDI Advanced Nitrox 2013, p. 76). La
   * soglia precedente di 150 s era più permissiva del manuale e faceva risultare
   * completa una sosta che la didattica considera corta.
   */
  safetyStopMinS: 180,
  /** Durata piena raccomandata: il limite superiore della fascia 3-5 minuti. */
  safetyStopFullS: 300,
  /**
   * Sosta profonda: la regola pratica è a metà della profondità massima per uno o
   * due minuti (TDI Advanced Nitrox 2013, pp. 75-76; il metodo Pyle in cinque
   * passi è in Decompression Procedures 2011, p. 70). La fascia è larga perché
   * nessuno la centra al metro, e la durata minima è un minuto.
   */
  deepStopBandFraction: [0.4, 0.6] as [number, number],
  deepStopMinS: 60,
  /**
   * Sotto questa PPO2 la miscela è pericolosa, sopra i 0.12 ata è potenzialmente
   * fatale (TDI Advanced Nitrox p. 30). Riguarda i rebreather e le miscele
   * ipossiche: su circuito aperto con aria non si raggiunge.
   */
  minPpo2Hazardous: 0.16,
  minPpo2Fatal: 0.12,
  /**
   * Velocità sul tratto dopo la sosta di sicurezza: **60 m/min**.
   *
   * VERIFICATO SULLA PAGINA, 19 agosto 2026. Il manuale *TDI Advanced Nitrox*
   * dice, nel paragrafo «Nitrogen Concerns»: «The Divers Alert Network has found
   * that the average ascent rate for divers after they have completed their
   * safety stop is 60 metres or 200 feet a minute».
   *
   * Il sospetto che ci fosse uno scambio fra metri e piedi era SBAGLIATO: il
   * manuale dà le due unità insieme, 60 m e 200 ft, e i conti tornano. Sono
   * davvero sessanta metri al minuto.
   *
   * Ma la lettura giusta è un'altra, ed è il motivo per cui questo numero non va
   * usato come soglia. Non è una velocità raccomandata: è la media che DAN ha
   * **misurato** su quello che i subacquei fanno davvero negli ultimi metri, ed
   * è citata in un paragrafo che parla di quanto l'ultimo tratto sia il punto in
   * cui si può fare meglio. È il comportamento medio, non il limite — e per
   * giunta un comportamento che il manuale porta come esempio di ciò che si
   * dovrebbe migliorare.
   *
   * Quindi: serve come **termine di paragone** («risali più o meno in fretta
   * della media misurata da DAN»), mai come criterio di violazione. Un contatore
   * costruito su questa soglia vale zero su un archivio normale, ed è giusto che
   * valga zero: chi la supera sta risalendo più veloce della media di una
   * popolazione che già risale troppo veloce. Il limite con cui l'app giudica
   * resta `ascentRateShallowMpm`.
   */
  danFinalAscentMpm: 60,
  /** Oltre questa frazione di ossigeno serve attrezzatura pulita per l'ossigeno (p. 55). */
  o2CleanThreshold: 0.4,
  safetyStopBandM: [3, 6] as [number, number],
  /** Riserva minima a fine immersione, bar. */
  minReserveBar: 50,
  /** Soglia di buon assetto: metri verticali per minuto a quota tenuta. */
  goodTrimMpm: 2,
  /** PPO2 massima in fase di fondo, bar. */
  maxPpo2Bottom: 1.4,
  /** PPO2 massima in deco, bar. */
  maxPpo2Deco: 1.6,
} as const;
