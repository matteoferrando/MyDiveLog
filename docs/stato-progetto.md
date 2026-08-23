# MyDiveLog — stato del progetto

Aggiornato: 23 agosto 2026

## Dove sta il codice

`~/Documents/Claude/Projects/MyDiveLog/mydivelog/` sul Mac, con `node_modules`
installato (`npm install` eseguito il 17 agosto per `@libsql/client`, `@types/node`
e `tsx`). La cartella `_to_delete` accanto contiene i vecchi zip e le cartelle di
staging degli aggiornamenti: si può cancellare a mano (il ponte verso il Mac non
può eliminare file).

## Decisioni prese

| Decisione | Scelta | Perché |
|---|---|---|
| Piattaforme | desktop macOS → iOS → web | ordine dichiarato dal proprietario |
| Stack | Tauri 2 + React + TypeScript | un solo codebase per le tre piattaforme; build macOS ~10 MB; Tauri 2 supporta iOS |
| Logica | tutta in `src/core`, senza dipendenze da piattaforma | evita di riscriverla per iOS e web |
| Storage | SQLite su desktop/iOS, IndexedDB sul web, dietro un'unica interfaccia | scelta automatica in base a `__TAURI_INTERNALS__` |
| Schema | colonne indicizzate per ordinare + documento JSON per il resto | il modello evolverà con i computer nuovi, senza una migrazione per campo |
| Profili | tabella separata, caricata solo aprendo una scheda | 2000 immersioni = ~700k campioni, impraticabili in lista su iPhone |
| Grafici | SVG a mano, nessuna libreria | il profilo di profondità nessuna libreria lo fa bene; bundle leggero per iOS |
| Deduplica | euristica di Subsurface (`dive::likely_same`) portata in TypeScript | la finestra temporale variabile gestisce gli orologi sfasati fra computer |
| Scelta del profilo nel merge | vince chi ha più **canali**, non più campioni | l'Aladin campiona a 4 s ma non sa niente della decompressione; il Peregrine a 10 s registra tetto, TTS, NDL, CNS. I dati deco pesano doppio |
| Il profilo perdente | conservato in `altSamples` se è più **fitto** | misurato sui dati reali: il profilo a 10 s legge l'oscillazione d'assetto **un terzo più bassa** di quello a 4 s sulla stessa immersione (rapporto mediano 0.66 su 38 coppie). Le velocità si misurano sempre sul profilo più fitto disponibile, così le immersioni restano confrontabili |
| Provenienza | `Dive.extraSources`, elenco di tutte le fonti | con un campo solo, un'immersione fusa da due computer sembrava venire da uno |
| Lettura SQLite e gzip | scritti a mano (`sqliteReader.ts`, `inflate.ts`) | evita `sql.js` (~1 MB di WASM) e mantiene sincrona l'interfaccia dei parser |
| Database condiviso | libSQL/Turso, sincronizzazione **esplicita** | le embedded replicas richiedono binding nativi (niente iOS/web) e legano l'apertura alla rete; il logbook si consulta in barca |

## Cosa è fatto

- **7 parser**: UDDF, Shearwater XML, **Shearwater Cloud `.db`**, Garmin FIT (via
  `@garmin/fitsdk`), **Scubapro LogTRAK**, Subsurface `.ssrf`, CSV di riepilogo.
  Rilevamento sul contenuto, non sull'estensione.
- **Decoder binario Uwatec Smart** (`parsers/uwatecSmart.ts`): il profilo dei
  computer Scubapro sta in un blob base64 dentro il JSON LogTRAK. Riscritto da
  `libdivecomputer/src/uwatec_smart_parser.c`; copre Galileo (152 byte di
  intestazione), G2/G3/Aladin Matrix (84 byte), Smart PRO/COM/TEC.
- **Decoder del log nativo Shearwater** (`parsers/shearwaterPnf.ts`): dentro il
  database di Shearwater Cloud ogni immersione porta un blob gzip che è la copia
  della memoria del computer (formato "sw-pnf", record da 32 byte, blocchi di
  apertura 0x10-0x19, chiusura 0x20-0x29, campioni 0x01, finale 0xFF). Da lì
  escono profilo, **tetto deco / TTS / NDL a ogni campione**, CNS, PPO2,
  **gradient factor impostati**, modello decompressivo, densità dell'acqua
  impostata, modalità, firmware, seriale, coordinate GPS. Riscritto da
  `libdivecomputer/src/shearwater_predator_parser.c`.
- **gzip e DEFLATE scritti a mano** (`parsers/inflate.ts`, RFC 1951/1952),
  verificati contro `zlib` di Node. `DecompressionStream` è asincrono e
  l'interfaccia dei parser è sincrona; una dipendenza per un solo `gunzip` stonava
  con un progetto che legge già SQLite e un bitstream Uwatec a mano.
- **Lettore SQLite puro TypeScript** (`parsers/sqliteReader.ts`): pagine b-tree,
  varint, catene di overflow, alias del rowid. Verificato cella per cella contro
  `sqlite3` su un database reale (2926 celle, 114 blob).
- **Deduplica** fra fonti diverse, con merge che non sovrascrive i campi compilati
  a mano, e **inferenza degli sfasamenti di orologio** (più gruppi: l'archivio
  reale ne ha uno a un'ora e uno a due).
- **Metriche**: RMV in L/min, oscillazione d'assetto a quota tenuta, velocità di
  risalita su finestra mobile di 30 s con violazioni distinte sopra/sotto i 10 m,
  sosta di sicurezza, tempo in deco e violazioni del tetto, riserva gas, PPO2 di
  picco, END. Ogni metrica dichiara la propria affidabilità e **nessun valore
  viene stimato** quando il dato non c'è.
- **Statistiche**: totali, attività mensile su 24 mesi, tendenze di
  consumo/assetto/risalita con regressione, fasce di profondità, siti, indicatori
  di disciplina con denominatore esplicito.
- **Piano di miglioramento**: 10 regole con priorità, evidenze numeriche,
  obiettivo misurabile ed esercizi; scheda di preparazione verso tecnico /
  profondo ricreativo / generale; debrief per singola immersione.
- **Scheda immersione**: profilo con tetto deco sovrapposto e cursore condiviso con
  i grafici sotto (temperatura, pressione bombola, velocità verticale con i limiti
  tracciati, TTS, NDL, CNS, PPO2, RBT); una card di impostazioni **per ogni
  computer** che ha registrato l'immersione; provenienza con tutte le fonti.
- **Statistiche**: una riga di mediane del periodo — consumo, assetto, velocità di
  risalita, GF99 all'uscita — ognuna con il numero di immersioni su cui si basa e la
  direzione della tendenza; oltre a totali e tendenze, correlazioni con grafici a dispersione
  (consumo/profondità, consumo/temperatura, assetto/consumo, zavorra/assetto),
  distribuzioni a istogramma, storia delle impostazioni GF nel tempo, stagionalità.
- **Finestra temporale** (`core/analysis/window.ts`): statistiche e piano si
  calcolano sugli **ultimi 12 mesi** per difetto, con selettore 6/12/24 mesi e
  archivio intero. Il logbook non è filtrato. La finestra parte da adesso e non si
  allunga da sé per riempirsi.
- **Analisi con Claude** (`src/ai/`): chiave API nelle impostazioni, modello scelto
  fra quelli che l'API dichiara (nessun nome nel codice), tre analisi — immersione,
  archivio, piano — con istruzioni che vietano di stimare i dati mancanti e
  impongono di distinguere ciò che ha calcolato il computer da ciò che ha calcolato
  l'app. Le analisi si conservano con data, modello e token consumati.
- **Pianificatore di gas** (`core/analysis/gasPlan.ts`, scheda *Gas*): **piano delle
  pressioni** — a che minuto devi avere quanti bar, con la curva e la tabella da
  portare in acqua, la pressione di rientro tradotta in un minuto, e il profilo
  disegnato sotto; **tempo alla profondità massima** come secondo tratto del fondo,
  con la profondità del resto imposta dalla media e non ipotizzata; preset delle
  bombole; esposizione all'ossigeno del piano (CNS %, OTU, minuti sopra 1.4 e 1.6);
  MOD doppia 1.4/1.6, miscela migliore, narcosi in pressione parziale d'azoto. **Due
  tempi in ingresso** — tempo di fondo e durata totale — con la distribuzione del profilo che
  ne discende (barra fondo/risalita/soste, profilo disegnato, velocità di risalita
  implicita, media dell'intera immersione che il computer scriverà a fine
  immersione), gas d'emergenza in quattro fasi dichiarate, tempo di
  fondo consentito dal gas, MOD/PPO2/END, e — la parte che un pianificatore generico
  non può avere — il **consumo misurato** dall'archivio (75° percentile per
  pianificare, mediana per sapere come vanno le cose) e il confronto con le pressioni
  d'uscita reali alle immersioni di profondità simile. Il gas del fondo si calcola
  sulla profondità **media**, precompilata dal rapporto medio/massima delle sue
  immersioni; la massima decide emergenza, PPO2 e narcosi. Due scuole entrambe
  supportate: riserva calcolata (rock bottom) o **riserva fissa in bar**, e regola di
  rientro a terzi, a metà o nessuna. Con la riserva fissa il gas d'emergenza non
  viene calcolato affatto. Non calcola la decompressione: le soste già pianificate si
  sommano come minuti aggiuntivi.
- **Identità**: marchio e icona sono il profilo di un'immersione — riempimento fra
  superficie e traccia, punto bianco sulla sosta di sicurezza, le stesse due regole
  del grafico dentro l'app (`src-tauri/icons/icon.svg`, `ui/components/Mark.tsx`).
  Rigenerabile con `npx tauri icon`. Il claim: *il meglio dei tuoi computer, in un
  logbook solo*.
- **Esposizione all'ossigeno** (`core/analysis/oxygen.ts`): CNS % e OTU calcolati
  dal profilo con le tabelle NOAA dei manuali TDI, per ogni immersione e accumulati
  **per giornata** — il CNS col dimezzamento ogni 90 minuti in superficie, le OTU
  additive perché non recuperano. Il valore che scrive il computer resta separato e
  affiancato: modello diverso, numero diverso. In più la **velocità sull'ultimo
  tratto**, dalla sosta alla superficie, misurata punto a punto perché la finestra
  mobile di 30 s la nasconde — è dove DAN misura una media reale di 60 m/min.
- **Bühlmann ZH-L16C con gradient factor** (`core/analysis/buhlmann.ts`): sedici
  compartimenti, azoto ed elio, GF99 e tetto con la formula di Baker, limiti di non
  decompressione. Serve a **rileggere** un'immersione fatta, non a pianificare la
  decompressione. **Validato** contro Shearwater: `npm run validate:gf` confronta i
  nostri GF99 con i suoi su 38 immersioni reali — scarto medio con segno −0.07
  punti, assoluto 0.79, caso peggiore +2.6. Vedi *Cosa ha trovato la validazione*.
- **Il Bühlmann collegato all'app** (`core/analysis/tissues.ts`): il modello non
  gira più a vuoto. La riparazione all'avvio percorre l'archivio in ordine
  cronologico e incatena i tessuti da un'immersione alla successiva, salvando in
  `metrics` il GF99 all'uscita, quello massimo, il compartimento che comanda,
  l'azoto residuo d'ingresso e — la cifra che si legge davvero — **quanto sarebbe
  uscita la stessa immersione partendo da tessuti puliti**, cioè il prezzo
  dell'intervallo di superficie. Il ricalcolo è incrementale: la seconda volta non
  rilegge nessun profilo. Da qui: GF99 su **tutte** le immersioni con un profilo e
  non solo su quelle Shearwater, il rigioco con altri gradient factor nella scheda
  immersione, e la curva di sicurezza nel pianificatore.
- **Pianificatore di decompressione** (`core/analysis/deco.ts`, scheda *Gas* →
  *Tecnica*): profili multi-livello, più miscele con cambio automatico alla MOD
  (1.4 al fondo, 1.6 in deco, arrotondata al metro così l'ossigeno serve ai sei),
  soste arrotondate al passo scelto, gradient factor interpolati fra prima sosta e
  superficie secondo Baker, ultima sosta e passo configurabili, consumo distinto
  fondo/deco per singola bombola in litri e in bar, CNS e OTU riga per riga,
  PPO2/EAD/END su ogni tratto, **controdiffusione isobarica** ai cambi gas con la
  regola dei quinti, circuito chiuso con setpoint, quota d'inizio desaturazione,
  tempo prima di poter volare, e le contingenze — più giù, più a lungo, entrambe,
  e un gas perso alla volta — con la differenza di runtime e di soste. La modalità
  *Ricreativa* resta quella di prima più la **curva di sicurezza**: a che minuto
  esattamente il piano esce dalla curva.
- **Cestino** (`storage/trash.ts`, scheda *Impostazioni*): cancellare mette
  l'immersione nel cestino con il suo profilo — sparisce dall'archivio, smette di
  sincronizzarsi, e resta recuperabile trenta giorni. La **lapide** che si propaga
  agli altri dispositivi nasce solo svuotando il cestino, a mano o alla scadenza.
  È la correzione di un difetto che avevamo introdotto noi: le lapidi avevano reso
  la cancellazione immediata e irrevocabile ovunque.
- **Secondo modello decompressivo: VPM-B** (`core/analysis/vpm.ts`): raggi critici,
  schiacciamento con ramo permeabile e impermeabile, compensazione di Boyle,
  algoritmo del volume critico con convergenza dichiarata, **algoritmo ripetitivo**
  (i nuclei si incatenano da un'immersione all'altra, non solo i tessuti) e
  **algoritmo di quota**. Nel pianificatore si
  sceglie fra Bühlmann-GF, VPM-B e **il più lungo dei due sosta per sosta**. Le
  soste scelte vengono poi *eseguite* dal motore di `deco.ts` (`imposedStops`), così
  gas, ossigeno, avvisi e contingenze si calcolano sulla tabella che si è scelta e
  non su un'altra. Riscontro esterno: schedule pubblicate (bwaite/vpmb,
  thetheoreticaldiver.org) — siamo dal 5 al 10% più corti di V-Planner, dichiarato
  nell'interfaccia. Misurato accendendo e spegnendo la sola subroutine dei nuclei:
  l'allungamento di una ripetitiva viene **quasi tutto dai tessuti**, non dai
  nuclei, che pesano solo sui profili intorno ai 30 metri (+6 minuti su 26). Resta
  approssimata la salita in quota, trattata come istantanea: per chi si immerge
  appena arrivato la tabella esce dal 2 al 4% più lunga di V-Planner.
- **Quota, acqua dolce e ripetitive nel pianificatore**: la quota entra da un punto
  solo (la pressione di superficie) e scende in ogni fase; l'acclimatazione conta
  (salire in quota è una decompressione, e chi arriva da poche ore parte carico); e
  si può ripartire dai tessuti di un'immersione dell'archivio con il suo intervallo
  di superficie. Quota e salinità restano campi separati — al lago di montagna
  valgono entrambe, ed è il caso in cui quasi tutti i pianificatori sbagliano.
- **Circuito chiuso**: setpoint per livello, diluente, consumo metabolico distinto
  fondo/deco, riempimento del circuito in discesa, bombola dell'ossigeno, e il
  **bailout** — la risalita a circuito aperto dalla fine del fondo, che è il momento
  peggiore, con la domanda che conta: il gas che porti basta?
- **Il foglio da portare in acqua**: il piano in testo semplice, da copiare o
  scaricare. Non un PDF: questa roba finisce su una lavagnetta.
- **Il grafico dei sedici compartimenti** in scheda immersione: azoto per
  compartimento, valore M, limite con i propri gradient factor, e quello che
  comanda evidenziato. È il grafico che ogni computer mostra sott'acqua e che
  nessun logbook mostra dopo.
- **Curva e obbligo minuto per minuto** in scheda immersione (`decoTimeline`):
  minuti residui in curva, tetto, TTS e GF99 istantaneo ricalcolati da noi lungo
  tutto il profilo, con il valore del computer **tratteggiato sullo stesso
  grafico** dove c'è. Esistevano già i grafici di NDL e TTS, ma disegnavano i campi
  che il computer aveva scritto nei campioni — solo gli Shearwater li scrivono.
  Adesso la curva c'è su ogni immersione campionata, e dove i due numeri
  coesistono si vede la distanza fra le due implementazioni. I minuti in curva sono
  calcolati dal carico che avevi in quel momento, non da tessuti puliti: è la
  differenza fra un computer e una tabella. Trenta millisecondi su un profilo da
  quaranta minuti.
- **Il piano tecnico si salva**, da sé mezzo secondo dopo l'ultima modifica, e con
  un nome quando lo si vuole ritrovare («il relitto a 45»). Viaggia anche fra
  dispositivi: un piano tecnico si compila in minuti, non in secondi.
- **La giornata, non l'immersione**: si pianifica la seconda immersione insieme
  alla prima, con l'intervallo di superficie, e si vede la seconda cambiare mentre
  si sposta la pausa. La prima non cambia mai — è la seconda a pagare.
- **Bailout da una quota qualunque**, non solo dalla fine del fondo: se il gas dal
  fondo non basta, la domanda diventa «da dove in su ce la faccio». Ogni tratto del
  piano porta con sé i tessuti con cui finisce, ed è quello che permette di
  ripartire da metà immersione senza rifare il piano.
- **Claude rilegge la tabella di decompressione** (`decoPlanContext`,
  `decoPlanAnalysis`): livelli, miscele, soste, gas, ossigeno e contingenze, con
  l'istruzione vincolante di **non riscrivere la tabella** — se una sosta non
  convince deve dire quale controllo la mette in dubbio, non proporne un'altra. Un
  modello linguistico che riscrive una tabella di decompressione sta inventando
  numeri.
- **Il prezzo delle ripetitive**, in statistiche e fra i suggerimenti: quanto costa
  il carico residuo in punti di GF99, mediana e caso peggiore, misurato rigiocando
  la stessa immersione da tessuti puliti. È l'unica cosa del progetto che si può
  dire solo guardando due immersioni insieme, e nessun computer subacqueo la dice.
  La regola riporta il numero e non prescrive quanto aspettare: la durata di una
  pausa la decidono la barca, il gruppo e il freddo.
- **Prima della prossima immersione** (`core/analysis/nextDive.ts`, in cima al
  *Logbook*): le cose che hanno una scadenza, in ordine di urgenza — pezzi
  scaduti, azoto e CNS ancora in circolo se scendessi adesso, pausa lunga
  dall'ultima uscita. Nessun semaforo complessivo: i fatti, e il giudizio a chi lo
  deve dare.
- **Export UDDF** (`core/export/uddf.ts`, scheda *Impostazioni*): tutto l'archivio
  in un file standard, con o senza profili, e l'elenco esplicito di ciò che UDDF non
  sa rappresentare. Il test che conta è il giro completo: esporta, reimporta,
  confronta.
- **Attrezzatura e scadenze** (`core/analysis/gear.ts`, scheda *Attrezzatura*):
  bombole, erogatori, brevetti, certificato medico. Scadenza da intervallo o
  esplicita, con l'aritmetica dei mesi che non fa slittare le date di fine mese.
- **Confronto fra due immersioni** (scheda *Confronta*): due profili sullo stesso
  asse dei tempi, senza riscalarli, e le stesse misure affiancate con la differenza.
- **Mappa dei luoghi** (in *Statistiche*): la disposizione reciproca dei siti, senza
  cartografia sotto e senza dipendenze nuove — e la pagina lo dichiara.
- **Riparazione dell'archivio all'avvio** (`storage/repair.ts`): ricalcola le
  metriche incoerenti e ripulisce i computer duplicati, senza chiedere un reimport.
- **Sincronizzazione con database condiviso** (`src/sync/`, scheda *Sincronizza*):
  piano senza rete in `plan.ts`, trasporto libSQL in `turso.ts`.
- **1092 test**, più tre script di verifica: `npm run screenshot` (fotografa ogni
  vista dalla build, incluso il percorso di errore della sincronizzazione),
  `npm run validate:logtrak <file>`, `npm run validate:pnf <database.db>`.
- **Dati dimostrativi**: `npm run demo` genera 6 file, 69 immersioni che diventano
  48 dopo la deduplica.

  Uno dei sei — `shearwater-peregrine-precedente.xml` — esiste per un motivo
  solo: porta gradient factor DIVERSI dagli altri, e senza di lui l'archivio non
  contiene nessun cambio di impostazioni del computer. La carta «Impostazioni
  del computer nel tempo» si disegna solo in quel caso, quindi non veniva
  disegnata da nessun controllo automatico — e il suo difetto (cinque colonne
  senza contenitore che scorre, cioè la pagina che si trascina di lato sul
  telefono) è stato trovato dall'utente sull'iPhone. **Un pezzo di interfaccia
  che i dati dimostrativi non attivano è un pezzo che nessuno guarda prima
  dell'utente**, ed è la stessa ragione per cui i siti dimostrativi hanno
  coordinate vere.

## Sincronizzazione

Database su Turso, creato il 17 agosto 2026:

- nome `mydivelog`, regione **AWS EU West (Ireland)**, TursoDB (riscrittura Rust)
  **non** attivata;
- indirizzo nella forma `libsql://<nome-database>-<utente>.<regione>.turso.io`;
  quello vero sta nelle impostazioni dell'app e non nel repository, perché un
  endpoint pubblicato è comunque un bersaglio anche quando serve un token
- **il token lo genera il proprietario del database** dalla dashboard Turso ("Create Token") e lo
  incolla nella scheda *Sincronizza*. Non passa da Claude e non entra nel
  repository: vive nella tabella delle impostazioni dell'archivio locale.

Regole, con la ragione:

- **Riepilogo e profilo si decidono separatamente** — il più recente per l'uno, il
  più ricco per l'altro. Il caso normale di questo archivio è la stessa immersione
  arrivata da due fonti: una col profilo, l'altra con le note. Una regola unica
  per tutto il record perderebbe una delle due.
- **A parità di data decide il contenuto** (confronto dell'impronta), non "prima
  il locale": così i due dispositivi nominano lo stesso vincitore e non si
  riscrivono il record a vicenda per sempre.
- **Nessuna cancellazione viene propagata.** Servirebbe un registro delle
  eliminazioni; senza, cancellare è locale e la sincronizzazione successiva
  riscarica l'immersione. Scelta dichiarata: meglio una di troppo che una perduta.
- **Sincronizzare due volte di fila non fa niente la seconda volta**: è la
  proprietà su cui insistono i test (19 test, di cui 9 contro un vero SQLite in
  memoria al posto del client di rete).

Da fare dopo aver incollato il token: la prima sincronizzazione reale
(crea le tabelle e carica le 104 immersioni), poi verificare che la seconda non
faccia niente.

## L'archivio di riferimento

Tutto quello che segue viene da un archivio personale reale, che **non è nel
repository**: le decisioni di questo progetto sono state prese guardando dati
veri, e vale la pena scrivere che cosa hanno mostrato anche senza pubblicarli.

Due fonti fuse — un export LogTRAK (app Scubapro) e un database Shearwater Cloud
dello stesso giorno. **104 immersioni su sei anni**, 76 ore sott'acqua, massima
45.6 m; 85 hanno il profilo campionato, 19 sono state inserite a mano e restano
senza. Mare e un lago, in Italia e all'estero: abbastanza varietà da far emergere
sia il caso dell'acqua dolce sia quello dei fusi orari.

**Due computer**: un Aladin Sport Matrix (Scubapro, `deviceTypeNumber` 0x17) e un
Peregrine (Shearwater) usato dall'ultimo anno e mezzo. Il file Shearwater non
aggiunge immersioni (0 nuove) ma **ne arricchisce 38**, che così hanno il profilo
del Peregrine con tetto deco, TTS, NDL e CNS campione per campione. È il caso
d'uso che giustifica l'esistenza dell'applicazione, ed è arrivato dai dati prima
che da un requisito.

Cosa è emerso dai log nativi del Peregrine:

- **ha cambiato i gradient factor**: 45/95 da maggio a settembre 2025, poi 20/85
  (due immersioni a ottobre 2025, poi stabilmente da marzo 2026). Confrontare il
  GF99 all'uscita fra periodi diversi senza saperlo porta a conclusioni sbagliate;
- **3 immersioni con tetto di decompressione reale** (6, 9 e 3 metri di tetto);
  zero superamenti;
- **4 immersioni arrivate a NDL 0**; TTS massimo osservato 11 minuti;
- CNS massimo 8%: l'orologio dell'ossigeno non è mai stato un vincolo;
- **densità dell'acqua lasciata a 1020 (mare) anche nelle immersioni in lago**:
  in acqua dolce con l'impostazione mare il computer legge la profondità circa 2%
  più bassa del vero.

Cosa dice l'analisi sull'insieme:

- consumo medio **20.1 L/min**, in miglioramento (20.7 → 19.4 fra prima e seconda
  metà dello storico);
- oscillazione a quota tenuta **2.8 m/min**, stabile (obiettivo sotto 2);
- **21%** delle immersioni con risalite fuori limite, concentrate sopra i 10 m;
- sosta di sicurezza completata nel **66%** dei casi;
- **43%** delle immersioni chiuse sotto i 50 bar;
- GF99 all'uscita: mediana 61, massimo 78 (ma vedi il cambio di GF sopra).

Nota sulla qualità del dato: le pressioni bombola in LogTRAK sono inserite a mano e
arrotondate a 10 bar, e una riga (200→5 bar) è quasi certamente un 50 digitato
male: è il motivo per cui ogni metrica dichiara la propria affidabilità invece di
fidarsi del dato.

## Bug trovati usando l'app sui dati veri, per memoria

Tutti e quattro sono stati visti prima usando l'app che dai test, e tutti e quattro
avevano la stessa forma: il codice era corretto in isolamento e sbagliato nel
contesto in cui gira.

- **Metriche ereditate invece che ricalcolate.** Fondendo due fonti, le metriche
  arrivavano dalla fonte che vinceva il profilo: la scheda mostrava 240 → 60 bar su
  12 litri e accanto "consumo non calcolabile". Ora si ricalcolano sull'immersione
  fusa, e le bombole si uniscono campo per campo.
- **Hook condizionale.** Un `useMemo` dopo un return anticipato: la scheda fa due
  render (senza campioni, poi con) e il numero di hook cambiava. Nessuna scheda si
  apriva più. C'è un test che monta il componente nelle due sequenze.
- **Misura della larghezza mai rieseguita.** `useRef` più effetto a dipendenze
  vuote: al primo render il contenitore del grafico non esiste, e quando compariva
  l'effetto non girava più. Profilo disegnato a 640 px dentro una carta larga il
  doppio. Risolto con un ref di callback.
- **Metriche non confrontabili fra computer diversi.** Preferendo il profilo del
  Peregrine (10 s) per le 38 immersioni recenti, l'oscillazione d'assetto risultava
  un terzo più bassa che sulle immersioni misurate col profilo Aladin (4 s): la
  tendenza mostrava un miglioramento che era solo un cambio di strumento. Ora si
  conservano entrambi i profili e le velocità si misurano sempre sul più fitto. Con
  la base uniforme la tendenza dell'assetto risulta **piatta** (2.84 → 2.75 m/min),
  non in miglioramento.
- **Fusione contro un archivio senza profili.** La lista in memoria non porta i
  campioni, quindi la versione in archivio valeva zero canali e qualunque cosa in
  arrivo sembrava migliore: reimportando si perdeva il profilo del Peregrine (con i
  dati deco) a favore di quello dell'Aladin, e il computer principale finiva
  duplicato nell'elenco. Ora i profili delle immersioni vicine nel tempo vengono
  caricati prima di fondere.

#### I manuali didattici, agosto 2026

Letti per intero quattro documenti TDI/PADI e confrontati con l'app: le note stanno
in `docs/didattica.md`, con le pagine. Ne sono usciti tre gruppi di cose — i numeri
presi (tabelle NOAA di CNS e OTU, MOD doppia, miscela migliore, narcosi in ata di
azoto), una correzione netta (l'END considerava narcotico solo l'azoto: la didattica
dice il contrario, e per il nitrox l'END è la profondità), e soprattutto la lista di
ciò che l'app fa e che i manuali **non** coprono — regola dei terzi, riserva fissa,
formula del rock bottom, tabella delle pressioni nel tempo. Quella lista serve a non
attribuire alla didattica cose che sono nostre.

### L'audit del pianificatore, agosto 2026

Il pianificatore è stato riletto da un revisore avversariale che eseguiva davvero il
codice invece di leggerlo. Ha trovato otto errori in una pagina che passava tutti i
test, e il più caro era un **doppio conteggio**: la profondità media veniva
precompilata col rapporto medio/massima dell'archivio — che è la media dell'*intera*
immersione, risalita compresa — mentre il calcolo fatturava la risalita a parte. Su un
profilo quadro a 30 m il piano sottostimava il gas del 12% e prometteva 15 bar in più
all'uscita, e la carta «il piano contro la realtà» dava la colpa al consumo di un
errore che era dell'aritmetica.

Da lì è venuta la riscrittura del modello dei tempi. Le altre sette: un tempo di fondo
consentito che restava positivo quando il gas non bastava; l'input mostrato diverso da
quello usato nel calcolo; la somma delle durate delle fasi che non faceva il totale;
un avviso che diceva «basta per 37 minuti, non 37»; la curva della profondità che
riscalava il piano in un modo e il campo in un altro; un andata-e-ritorno sulla
profondità che cambiava il piano in silenzio; e una sosta di sicurezza più profonda
del fondo dell'immersione. Tutte hanno ora un test.

Da qui è nato anche il **timbro di versione implicito** nella riparazione: quando si
aggiunge una grandezza calcolata, basta aggiungere la sua assenza fra le incoerenze e
gli archivi vecchi si aggiornano da soli al primo avvio, senza reimportare. Prima la
riparazione sapeva vedere le incoerenze strutturali, non che il codice era cambiato.

Due lezioni, oltre alle correzioni: **normalizzare gli input una volta sola e
restituirli** (`plan.input` è ciò con cui si è calcolato, ed è ciò che la pagina
mostra), e **una funzione sola per una trasformazione usata in due posti** — campo e
grafico che riscalavano il piano in due modi era un errore che nessun test dei tipi
poteva vedere.

### Il debug completo, agosto 2026

Una rilettura avversariale di tutto ciò che non era il pianificatore ha trovato otto
difetti dimostrabili con un input concreto. I tre che corrompevano dati veri:

- **Il CSV metteva le colonne nel campo sbagliato.** La corrispondenza parziale
  degli alias vinceva per ordine di dichiarazione, non per specificità: "Average
  Depth (m)" cadeva in `maxDepth` perché quell'alias contiene "depth", e siccome
  l'ultima colonna vince la profondità massima veniva **sostituita dalla media**.
  Stessa cosa per "Air Temp" che sovrascriveva la temperatura dell'acqua. Ora vince
  l'alias più lungo.
- **La PPO2 dei log Shearwater imperiali veniva convertita da PSI.** `imperialUnits`
  governa profondità e temperatura, non una pressione parziale: un'immersione a 1.30
  bar diventava 8.96, e l'app emetteva un allarme critico di ossigeno su
  un'immersione regolare.
- **La miscela non entrava nella fusione fra computer.** `mix` non è mai indefinito
  — i parser che non la conoscono mettono aria — quindi il ciclo che riempie i buchi
  non la copiava mai: su un'immersione in nitrox registrata da due computer vinceva
  l'aria di chi non la sapeva, e la PPO2 di picco usciva sottostimata di un terzo.

E il più diffuso: **gli orari erano sbagliati di un'ora per tutto l'anno.**
`wallClockToIso` fissa deliberatamente l'orologio su UTC, ma la formattazione lo
rileggeva nel fuso locale, annullando la scelta: un'immersione del 31 dicembre alle
23:30 finiva contata nell'anno dopo. Nessuno dei 322 test lo vedeva perché il
container gira in UTC.

Gli altri: il denominatore delle violazioni del tetto era l'intero archivio invece
delle immersioni in cui la verifica è possibile; il criterio "oltre i 24 m" contava
quelle oltre i 30; l'istogramma scartava in silenzio i valori sotto il primo
intervallo; una serie a valore costante veniva disegnata fuori dal riquadro.

## Le due grandi insidie dei formati, per memoria

**Il formato Uwatec non contiene NIENTE sulla decompressione** — né tetto, né NDL,
né TTS, né tempo in deco. Verificato sull'intero elenco dei tipi di record: ci sono
solo profondità, temperatura, pressione bombola (col trasmettitore), RBT, frequenza
cardiaca, bussola e allarmi. Le soste obbligatorie di quelle immersioni si
riconoscono dalla forma del profilo — oppure, ora, dal log del Peregrine.

**Le colonne leggibili di Shearwater Cloud sono quasi tutte vuote.** Su un archivio
reale sito, note, zavorra, GF, temperature sono `null`: l'app le riempie solo se
l'utente le scrive a mano. Tutto il resto sta nel blob compresso. Leggere solo le
colonne dava l'impressione che il database non contenesse niente.

## Due lingue e testi più corti, 23 agosto 2026

Due lavori fatti insieme perché toccano le stesse righe.

**L'inglese.** Meccanismo in stile gettext: la chiave del dizionario è la frase
italiana, si avvolge la stringa in `t()` e basta. Una frase non tradotta esce in
italiano — che è la chiave — quindi il programma resta usabile a dizionario
incompleto e non compaiono mai sigle al posto del testo. Il prezzo, dichiarato:
cambiando la frase italiana si perde la sua traduzione.

Tre file nuovi: `ui/lingua.tsx` (contesto, `useLingua()`, il pulsante `IT`/`EN`),
`ui/traduzioni.ts` (circa millecinquecento voci, raggruppate per scheda),
`ui/navigazione.tsx` (il «vai a quella scheda» che serviva agli stati vuoti).
Più `ui/components/Vuoto.tsx`, uno stato vuoto solo per tutte le pagine, **con un
pulsante**: prima ogni pagina diceva «importa un file per iniziare» e si fermava
lì, lasciando trovare la scheda giusta — che sul telefono sta dietro il menu.

Il dizionario arriva con un `import()` pigro e solo per chi sceglie l'inglese:
sono 89 kB, e il test del budget del primo avvio li avrebbe presi (li aveva
presi, la prima volta).

La scelta si ricorda in `localStorage` e non nell'archivio: è una preferenza di
*questo* dispositivo, e sincronizzarla vorrebbe dire che cambiando lingua sul
telefono cambia anche sul Mac.

**I testi.** Erano scritti per chi il programma lo stava scrivendo: perché l'UDDF
perde il collegamento fra bombole e miscele, come si deduce il volume da
`tank_summary`, perché React riconcilia per posizione. Sono cose vere e servono —
ai commenti, dove sono state spostate. A schermo è rimasta una riga per ciascuna.

**Due difetti presi durante il lavoro**, tutti e due dalla harness:

- il cambio lingua in barra portava il documento a 412 px su uno schermo da 390,
  cioè scorrimento orizzontale su **ogni** pagina, perché la barra c'è sempre.
  Sotto i 700 px scende dentro il menu, con bersagli da 44 px;
- lo stato vuoto dei suggerimenti, riscritto con `Vuoto`, cambiava l'elemento
  radice della pagina da `div.page` a un frammento. React riconcilia per
  posizione **e per tipo**: la regione live dell'annuncio veniva rimontata e
  taceva proprio nel momento in cui doveva parlare. Da lì la proprietà `nuda` di
  `Vuoto`. Il test c'era già e l'ha preso.

E uno preso prima, che vale la pena ricordare come metodo: consegnare al Mac un
tar dell'**intera** cartella `src/ui` dalla copia nel contenitore stava per
cancellare codice più recente scritto sul Mac — la paginazione del logbook, fra
l'altro. Da allora: prima si rilegge dal Mac, poi si modifica, e si consegnano i
file toccati.

**La harness** (`scripts/screenshot.mjs`) dichiara `locale: 'it-IT'`: senza,
Chromium diceva `en-US` e lo script cercava pulsanti italiani in un'interfaccia
inglese, fallendo alla prima attesa. In fondo fa un giro in inglese che fotografa
quattro schede e verifica che nessuna voce di navigazione sia rimasta italiana.

**Il sito** ha le schermate vere, in italiano su `/` e in inglese su `/en/`,
prodotte da `scripts/immagini-sito.mjs` dalla stessa build che gira sul Mac.

## CSV e KML, 23 agosto 2026

Tre formati d'uscita invece di uno, perché sono tre domande diverse. L'UDDF
porta le immersioni in un altro programma del settore; il **CSV** le porta in un
foglio di calcolo, dove si fa quello che questa app non fa (una pivot, un conto
per il club, un controllo a occhio su una colonna); il **KML** porta i siti su
una mappa vera — il grafico nelle statistiche dichiara di non esserlo, e alla
domanda «dov'è esattamente quel punto» non risponde.

Le insidie pagate una volta per tutte, tutte e tre invisibili a occhio:

- **il separatore del CSV.** Excel in italiano legge il punto e virgola, in
  inglese la virgola, e chi apre quello sbagliato si ritrova tutto in una
  colonna. Si scrive `sep=` in cima, che è l'unica dichiarazione che Excel legge
  davvero, e il separatore segue la lingua dell'interfaccia;
- **il separatore decimale**, che viaggia con il primo: in un foglio italiano
  `17.4` entra come TESTO e la colonna non si somma. Nessun errore, e si scopre
  alla fine;
- **l'ordine delle coordinate in KML**, che è longitudine prima di latitudine —
  l'inverso di come si scrivono. Invertite, le immersioni liguri finiscono in
  Somalia e il file si apre lo stesso.

Il KML raggruppa per **nome** del sito e non per coordinata: il GPS prende il
punto in superficie e la barca si sposta, quindi due immersioni allo stesso posto
non hanno mai la stessa coordinata al quinto decimale. Un segnaposto per
immersione darebbe trentadue bolle sovrapposte su Moregallo e nasconderebbe tutto
il resto.

Un difetto preso mentre si collegava all'interfaccia: la conferma diceva «7
immersioni esportate» dopo il KML, che conta siti. La frase è ora composta da chi
sa cosa sta contando — participio compreso, perché «7 siti esportate» è
sbagliato in italiano.

## Anche il nucleo parla inglese, 23 agosto 2026

La passata sull'interfaccia aveva lasciato fuori il testo prodotto da
`src/core`, `src/storage` e `src/sync`: gli avvisi dei parser nella tabella
dell'esito («PPO2 Shearwater riscalata di 100…»), le sette righe del registro di
sincronizzazione, i messaggi d'errore dell'archivio. In un'app impostata su EN
erano l'unica cosa che restava italiana, e comparivano proprio nel momento in
cui qualcosa non era andato liscio.

Il tipo `Traduci` è passato in `src/core/traduci.ts` — `src/core` non può
importare da `src/ui`, ed è il vincolo su cui è costruito tutto il progetto — e
`src/ui/format.ts` lo riesporta. Ogni funzione che produce testo lo riceve come
ultimo parametro, con l'identità come valore predefinito: **nessun chiamante si
è dovuto toccare, test compresi**, e infatti i 1211 test sono passati senza
correggere una sola aspettativa. È la prova che l'italiano prodotto è rimasto
identico carattere per carattere.

Due cose imparate:

- le frasi con dentro un numero vanno spezzate col numero FUORI dalla chiave,
  altrimenti servirebbe una voce di dizionario per ogni numero possibile;
- gli oggetti che vivono più a lungo di un render (`SqliteStore`,
  `IndexedDbStore`, `TauriBleTransport`) prendono la traduzione nel costruttore,
  e passargli la `t` del momento congelerebbe la lingua del primo avvio. Da lì
  `useTraduciStabile()` in `lingua.tsx`: una funzione fissa che dentro rilegge la
  lingua corrente.

Restano italiane, e sono dichiarate: le cinque note di `shearwaterPnf.ts` (la
traduzione andrebbe infilata in tutta la catena del decodificatore a bit) e i
messaggi che nessuno vede a schermo.

## Prossimi passi, in ordine

1. **Scarico Bluetooth dai computer**, Aladin per primo. Il decoder del formato
   Uwatec è già scritto e verificato: manca solo il trasporto BLE
   (`tauri-plugin-blec`, `libdivecomputer` come riferimento dei protocolli). È
   l'unico punto che richiede il computer in mano per essere provato.
2. **iOS sul telefono vero.** Sul simulatore l'app gira: layout a scheda sotto i
   600 px, navigazione a menu con l'hamburger, tooltip col dito, permessi al
   posto giusto.
   Il passo che manca e' l'iPhone fisico, che serve per l'unica cosa che il
   simulatore non puo' dare — il Bluetooth — e che richiede la firma con un
   account Apple. Le due insidie gia' pagate sono in README: CoreBluetooth va
   dichiarato in `tauri.conf.json` altrimenti il link fallisce con simboli
   indefiniti che non nominano il Bluetooth, e `tauri ios init` non riscrive un
   `project.yml` che esiste gia', quindi dice di aver rigenerato senza aver
   cambiato niente.
3. **Tarare le istruzioni delle analisi** su quello che producono davvero
   sull'archivio reale: le quattro modalità sono scritte al buio.
4. **libdivecomputer su iPhone**: la libreria si compila già per macOS da
   `build.rs`; mancano la compilazione incrociata per `aarch64-apple-ios`, il
   collegamento vero di `FlussoBle` a `blec`, e la scelta di marca e modello fra
   i 356 supportati.

## Cosa ha trovato la validazione del Bühlmann

Il confronto con i GF99 di Shearwater su 38 immersioni reali ha trovato due errori
che nessun test sintetico aveva visto. Vale la pena tenerne il verbale, perché il
modo in cui sono stati trovati conta quanto la correzione.

**Punto di partenza:** scarto medio con segno −2.76, assoluto 2.78. Le due cifre
quasi identiche dicono subito che non è rumore ma un errore sistematico in una sola
direzione — e la direzione era la peggiore possibile, cioè l'app raccontava più
margine di quello che c'era.

1. **Le ripetitive ripartivano da tessuti puliti.** Raggruppando per giornata:
   prime immersioni −1.93, ripetitive −4.02. `runProfile` non aveva modo di
   ricevere il carico residuo. Aggiunta `desaturate()` e incatenate le immersioni
   in ordine cronologico nel validatore: lo scarto delle ripetitive è sceso a
   −3.13, cioè il divario è sparito ma il fondo è rimasto.

2. **I coefficienti erano quelli della variante B.** Il file diceva ZH-L16C nel
   commento e portava i valori della B dal quinto compartimento in giù, più uno
   della A al tredicesimo. Un `a` più grande è un valore M più alto, cioè un
   gradiente ammesso più largo, cioè un GF99 più basso. Con la tabella C
   pubblicata: da −2.83 a −0.07 di scarto medio, assoluto 0.79.

**Cosa è stato provato e scartato:** usare la densità dichiarata dal computer
(1020 kg/m³, l'impostazione EN13319 del Peregrine) al posto della nostra costante
di 1030 peggiora — la scansione ha il minimo esattamente a 1030. Probabilmente i
1020 servono alla profondità a display e non al modello. Anche il vapore acqueo a
0.0567 bar (valore US Navy) peggiora: 0.0627 (Bühlmann) resta.

**Cosa protegge il risultato:** `tests/buhlmann.test.ts` ora inchioda i trentadue
coefficienti uno per uno, leggendoli indietro dal comportamento di `gf99`. Serviva,
perché i controlli sui limiti di non decompressione hanno intervalli larghi
abbastanza da accogliere sia la B sia la C: il test che c'era prima non poteva
accorgersene, e infatti non se n'è accorto per mesi.

## Difetti noti, sistemati

- **Cancellazioni che tornavano.** La sincronizzazione non aveva lapidi:
  cancellare un'immersione su un dispositivo significava vedersela rimandare
  indietro dall'altro. Ora c'è una tabella `deletions`, le lapidi salgono prima di
  qualunque altra cosa (se arrivassero dopo, l'immersione verrebbe scaricata e poi
  buttata, comparendo in elenco nel mezzo), e non scadono mai.
- **Analisi che sparivano.** `analyses` viaggiava come oggetto unico con «vince la
  più recente»: le analisi generate su un dispositivo venivano cancellate da
  quelle dell'altro. Ora si fondono chiave per chiave, e dentro una chiave vince
  l'analisi generata più tardi — non chi ha sincronizzato per ultimo.
- **La soglia inventata del dente di sega.** La regola diceva «profili puliti»
  sotto i 15 m/h di ridiscese, e quel quindici non veniva da nessun manuale. Al
  suo posto: quante immersioni stanno oltre il doppio del proprio terzo quartile,
  cioè quante sono anomale per chi le ha fatte.
- **«Parte profonda per prima» era un booleano.** Due metri di differenza fra le
  metà e venti davano lo stesso «no». Ora `depthTrendM` è una grandezza con segno,
  e il booleano si ricava da lei.
- **Confronto con le immersioni simili solo per profondità.** «A questa quota esci
  con 70 bar» mescolava una da venti minuti e una da cinquanta. Ora filtra anche
  sulla durata, con tolleranza di un terzo, e quando l'insieme si svuota torna al
  criterio largo **dichiarandolo**.

## Il debug generale di agosto 2026

Quattro revisioni avversarie in parallelo — motore, dati e sincronizzazione,
analisi, interfaccia — con l'obbligo di **eseguire** il codice e portare la
riproduzione, non l'opinione. Hanno trovato una trentina di difetti; quelli che
avrebbero prodotto un numero sbagliato in acqua sono questi.

### Motore

- **Il bailout leggeva i tessuti della discesa.** Su un profilo multilivello
  cercava il segmento d'inizio risalita con l'etichetta invece che col runtime di
  fondo, e su un'immersione che chiedeva 50 minuti di soste e 140 bar rispondeva
  «nessun obbligo, 11 bar». Ora parte da `bottomRuntimeMin`.
- **Il gas perso ricalcolava l'immersione con quello che restava**, senza
  rimappare gli indici: un'immersione a 60 m veniva ricalcolata sull'ossigeno
  puro, oppure andava in errore. Ora gli indici si rimappano.
- **`ndlMin` veniva dai tessuti puliti** anche sulle ripetitive: il pianificatore
  mostrava 42 minuti di curva dove ne restavano 20. Ora la curva si calcola dai
  tessuti che hai davvero, `remainingNoDecoMin()`.
- **VPM con impostazioni degeneri** (passo delle soste a zero) produceva `NaN` e
  quindi una tabella *senza soste*, che è il modo peggiore di fallire. I valori
  degeneri ora tornano ai predefiniti.
- **`tankL === 0` significava «non so»** invece di «vuota», e la verifica del gas
  non protestava.

### Dati e sincronizzazione

- **Il ripristino dal cestino veniva annullato dalla sincronizzazione
  successiva**: la lapide restava, e l'immersione tornava nel cestino da sola. Ora
  un'immersione modificata dopo la lapide cancella la lapide, non se stessa.
- **`decoPlans` e `gear` viaggiavano con «vince l'ultimo»**: i piani salvati su un
  dispositivo cancellavano quelli dell'altro. Ora si fondono per chiave.
- **Le date UDDF impossibili diventavano il 1970.** Ora l'immersione viene scartata
  con un avviso: una data sbagliata rompe la catena dei tessuti in silenzio.

### Analisi

- **La tabella delle pressioni non descriveva il piano che le stava sopra**: usava
  il tuo consumo invece di quello della squadra, ignorava la quota e addebitava al
  gas di fondo le soste pagate con lo stage. Sul caso peggiore l'ultima riga dava
  106 bar dove il piano prometteva 69, e il minuto di rientro sbagliava di tre.
  Le fasi ora portano il flag `fromStage` e la tabella legge consumo e persone
  dalla fase.
- **Due mediane per la stessa grandezza**: `quartilesOf` prendeva l'elemento
  centrale, che con un numero pari di valori non è la mediana (5.6 nei quartili,
  5.4 nelle pagine).
- **Un consumo mai misurato era «0 L/min»** nei criteri di prontezza, cioè un
  criterio superato. Ora è indefinito e la pagina scrive «non misurato» — la
  stessa regola che il prompt di sistema impone alle analisi.

### Interfaccia

- **La tabella delle miscele accettava 40/70**: il resto era azoto negativo e il
  motore lo calcolava senza protestare. Il vincolo sta ora in `withFraction`
  (`units.ts`), dove il numero entra.
- **«era 47» spariva subito**: `usePrevious` aggiornava il riferimento a ogni
  render, e il salvataggio automatico dell'input ne provocava uno. Ora il
  confronto è sul contenuto.
- **Contrasto sotto la soglia AA** su cinque colori: il grigio dei testi
  secondari a 3.5:1, il rosso degli errori a 3.3:1 sullo scuro, il giallo degli
  avvisi a 1.8:1 sul chiaro. La tavolozza è stata rifatta per tema, e
  `tests/contrast.test.ts` legge il foglio di stile e calcola i rapporti: nessuno
  può più abbassarne uno senza che un test lo dica.
- **La scelta del periodo faceva scorrere la pagina in orizzontale** a 390 px. Il
  controllo è ora nel `screenshot.mjs` (`TRABOCCO A 390 px`), su otto pagine.
- **«Violazioni del tetto deco: 0» col pallino verde su zero immersioni
  verificabili**: «non verificabile» veniva mostrato come «tutto a posto». Ora la
  riga mostra un trattino e dichiara il denominatore vuoto.
- **`40/undefined`** nei gradient factor: parecchi computer scrivono solo il GF
  basso. L'etichetta la scrive ora `gfOf`, cioè quello che il motore ha usato.
- Dodici caselle senza nome accessibile nella tabella delle miscele, «1
  immersioni» in una decina di punti, e due stati vuoti mancanti (archivio vuoto
  in Confronta, nessun risultato nel Logbook).

## Prova su un archivio che non è il suo

`tests/smoke.test.ts` percorre il giro intero — import da quattro formati con
sovrapposizioni, deduplica, riparazione, catena dei tessuti, statistiche,
suggerimenti, debrief, export UDDF e rientro — su un archivio costruito apposta con
i casi che quello di riferimento non ha: ripetitive nella stessa giornata, lago
freddo, immersioni decompressive, un'immersione senza sosta di sicurezza, e il
pianificatore spinto su profili estremi. Non verifica che i numeri siano giusti
(per quello ci sono i test dei moduli e il riscontro con Shearwater): verifica che
la catena non si rompa e non produca assurdità quando l'app la userà qualcun altro.

## Da verificare con file reali

- **`currentTime` di Shearwater XML** non ha unità documentate: il parser ricava la
  scala dal passo mediano fra campioni.
- **`averagePPO2` di Shearwater XML** viene riscalato di 100 quando supera i 3 bar,
  con un avviso. Assunzione non documentata.
- **Export JSON dell'app Suunto** (dalla 6.0.2): più dati del FIT ma struttura
  delle chiavi sconosciuta. Serve un file reale.
- **Offset 24 dell'intestazione Uwatec** = profondità media: libdivecomputer lo
  marca come sconosciuto, l'inferenza è confermata su 85 immersioni (differenza
  mediana 1 cm) ma resta un'inferenza.
- **GF99 campione per campione**: nel log del computer non c'è. Shearwater Cloud lo
  ricalcola da sé; noi leggiamo solo il valore all'uscita che scrive lui.
- **Ramo delle temperature negative** del log Shearwater (correzione +102 presa da
  libdivecomputer): non verificabile su questo archivio.
- **Byte non interpretati** nel campione Shearwater (10, 16, 17, 24-27, 29-31):
  libdivecomputer non li documenta e non vengono letti.

Il CSV di Shearwater non è supportato di proposito: le sue intestazioni non sono
documentate pubblicamente.
