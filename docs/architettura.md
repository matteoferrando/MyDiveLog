# Architettura e roadmap

Le decisioni prese, perché, e cosa serve per arrivare a iOS e al web.

---

## Il vincolo che ha guidato tutto

Un solo codice per desktop → iOS → web. Questo esclude di scrivere la logica
dentro i componenti dell'interfaccia, ed esclude di metterla nel guscio nativo:
finirebbe riscritta due volte.

Da qui la regola: **`src/core` non importa niente.** Non conosce React, non
conosce Tauri, non tocca il filesystem, non fa richieste di rete. Parser,
conversioni, metriche, deduplica e regole del piano sono funzioni pure su
strutture dati. È il 70% del progetto e viaggia identico su tutte e tre le
piattaforme.

Il guscio Rust (`src-tauri`) fa una cosa sola: registrare il plugin SQL. Se un
giorno servisse il download diretto dal computer subacqueo via USB o Bluetooth
— l'unica cosa che il web non potrà mai fare — è lì che andrebbe.

---

## Il modello canonico

Ogni parser converte in `src/core/model.ts` e in **queste** unità:

| grandezza | unità |
|---|---|
| profondità | metri (reale, positivo verso il basso) |
| tempo | secondi, dall'inizio dell'immersione |
| pressione | bar |
| temperatura | gradi Celsius |
| volume | litri |
| frazioni gas | 0..1 (`0.21`, non `21`) |

Nessuna unità imperiale, nessun millimetro, nessun Pascal sopravvive
all'import. Le conversioni stanno tutte in `units.ts`, in un posto solo, coperte
da test.

Questa è la decisione più importante del progetto. L'alternativa — tenere le
unità della sorgente e convertire al momento di mostrarle — sembra più flessibile
e in pratica garantisce che prima o poi due unità si mescolino in un calcolo.

---

## Perché i profili sono separati dai riepiloghi

Un archivio di 2000 immersioni campionate ogni 10 secondi sono circa 700.000
campioni. Caricarli per disegnare la lista del logbook renderebbe l'app
inutilizzabile su iPhone.

Quindi lo storage li tiene separati:

- `dives` — riepilogo **con le metriche già calcolate**. Sempre in memoria.
  Poche centinaia di byte per immersione, quindi le statistiche e il piano si
  ricalcolano istantaneamente a ogni filtro, senza una query.
- `dive_samples` — il profilo, una riga per immersione, letta solo quando si apre
  una scheda.

Le metriche sono calcolate **all'import** e salvate. Vengono ricalcolate solo
quando qualcosa cambia davvero: una modifica manuale al volume della bombola, o
un reimport con un profilo più fitto.

## Perché lo schema SQLite è "colonne + documento"

I campi che servono per ordinare e filtrare (`start_time`, `max_depth`, `site`)
sono colonne vere e indicizzate. Tutto il resto dell'immersione è un documento
JSON in una colonna `doc`.

Il motivo: il modello evolverà, perché i computer nuovi registrano campi nuovi.
Non voglio una migrazione per ogni campo aggiunto — ma voglio poter fare
`select … order by start_time` senza deserializzare 2000 documenti.

---

## Come si estende

**Aggiungere un formato.** Un file in `src/core/parsers/` che esporta un
`DiveParser` con `detect` e `parse`, e un'aggiunta all'array `PARSERS` in
`index.ts`. L'ordine conta: il rilevamento è sul contenuto, e il CSV va per
ultimo perché è il più permissivo. Poi un test che ci passi la stessa immersione
sintetica dei fixture e verifichi che torni identica.

**Aggiungere una regola al piano.** Una funzione `Rule` in `coaching.ts` e un
elemento nell'array `RULES`. La funzione riceve le aggregate e le immersioni e
restituisce un `Finding` o `null`. Deve dichiarare `basis` e riempire
`evidence`: sono i due campi che rendono il consiglio verificabile.

**Aggiungere una metrica.** Un campo in `DiveMetrics`, il calcolo in
`metrics.ts`, e — se è derivata dal profilo — una voce in `MetricQuality` che
dica quando non è affidabile.

---

## Il log nativo Shearwater, e la lezione che porta

Il database di Shearwater Cloud ha 57 colonne leggibili di annotazioni del
logbook. Su un archivio reale sono quasi tutte vuote: l'applicazione le riempie
solo se l'utente scrive quei campi a mano. Sito, note, zavorra, temperature,
gradient factor: `null`. Leggendo solo quelle colonne il database sembra non
contenere niente.

Contiene tutto, ma dentro un blob compresso per immersione: la copia esatta della
memoria del computer, formato nativo Shearwater. Da lì escono il profilo, il tetto
di decompressione, il TTS e l'NDL a ogni campione, il CNS, la PPO2, i gradient
factor impostati, il modello decompressivo, la densità dell'acqua, le coordinate
GPS. Sono esattamente i dati che il formato Uwatec dei computer Scubapro non ha
per costruzione.

Tre conseguenze di progetto:

- **Serviva uno scompattatore gzip.** `DecompressionStream` del browser è
  asincrono e l'interfaccia dei parser è sincrona; una dipendenza per tre `SELECT`
  e un `gunzip` stonava con un progetto che legge già SQLite e un bitstream Uwatec
  a mano. Quindi `parsers/inflate.ts`, verificato contro `zlib` di Node.
- **La regola "il profilo più fitto vince" era sbagliata.** L'Aladin campiona ogni
  4 s ma non sa niente della decompressione; il Peregrine campiona ogni 10 s e
  registra tetto, TTS, NDL e CNS. Ora `dedupe.ts` conta i CANALI del profilo prima
  dei campioni, e i dati decompressivi pesano doppio: sono i soli che nessun altro
  formato ricostruisce, mentre le metriche che dipendono dalla densità (risalita su
  finestra di 30 s, assetto) funzionano bene anche a 10 s.
- **La provenienza è un elenco, non un campo.** `Dive.extraSources` tiene tutte le
  fonti che hanno contribuito: mostrarne una sola faceva sembrare che i dati
  dell'altro computer non fossero entrati.

Come sempre in questo progetto, la verifica non si fonda sul fatto che il codice
gira: ogni log porta accanto i valori che Shearwater Cloud ha calcolato per conto
suo dagli stessi campioni, e su 38 log reali profondità media e massima,
temperatura minima e massima, durata e obbligo decompressivo coincidono tutti. Due
scoperte sono arrivate proprio da quel confronto: la media di Shearwater esclude i
campioni a profondità zero, e il piede del gzip non sta in fondo al blob perché
dopo il flusso compresso c'è del riempimento.

---

## La sincronizzazione, e perché non è un database remoto

Il database locale resta la fonte di verità; il database condiviso è una
destinazione con cui allinearsi quando c'è rete. La scelta ha un'alternativa
precisa che è stata scartata: le *embedded replicas* di libSQL, che tengono un
file locale allineato in automatico. Sono la cosa giusta su un server e quella
sbagliata qui, per due ragioni concrete — richiedono i binding nativi di libSQL,
che in una webview non girano (quindi niente iOS e niente web), e legano
l'apertura dell'archivio alla rete. Un logbook si consulta in barca.

Il pezzo che può sbagliare in modo interessante è la *decisione*, non il
trasporto: far vincere la versione peggiore, perdere un profilo, oscillare fra
due dispositivi. Per questo `sync/plan.ts` non conosce la rete — confronta due
elenchi di impronte e restituisce cosa spostare — e i suoi test verificano la
proprietà che conta: **sincronizzare due volte di fila non fa niente la seconda
volta.** Un piano non idempotente non si nota guardando l'interfaccia; si nota
dopo un mese, sul traffico.

Tre decisioni con la loro ragione:

- **Riepilogo e profilo si decidono separatamente.** Il riepilogo più recente
  vince, il profilo più ricco vince, e sono due confronti distinti. Il caso
  normale di questo archivio è la stessa immersione arrivata da due fonti — una
  con il profilo campione per campione, l'altra con le note scritte a mano: una
  regola unica per tutto il record perderebbe una delle due cose.
- **A parità, decide il contenuto e non la posizione.** Se due versioni hanno la
  stessa data di modifica si confronta l'impronta, che è un dato che i due
  dispositivi condividono: entrambi nominano lo stesso vincitore e la faccenda si
  chiude al primo giro. Con un "preferisci il locale", ciascun dispositivo si
  vedrebbe vincente e i due si riscriverebbero il record a vicenda per sempre.
- **Le cancellazioni si propagano con le lapidi, ma solo quelle definitive.**
  Senza un registro, cancellare non servirebbe a niente: la sincronizzazione
  successiva rimetterebbe l'immersione al suo posto, perché il remoto ce l'ha e
  il locale no. Ma la lapide — la cancellazione che viaggia — nasce solo
  **svuotando il cestino**, a mano o dopo trenta giorni: finché l'immersione è
  nel cestino sparisce da qui e non viene più sincronizzata, ma sugli altri
  dispositivi resta. Il prezzo è dichiarato: nella finestra dei trenta giorni i
  due dispositivi non concordano, ed è quello che si paga per poter tornare
  indietro. La data sulla lapide fa il resto: vale solo finché l'immersione non è
  stata toccata DOPO di lei — un `updatedAt` più recente significa che qualcuno
  l'ha rimessa apposta. Le lapidi non scadono, perché costano una riga di testo
  l'una e buttarle via significa vedersi tornare indietro un'immersione
  cancellata l'anno prima, senza nessun avviso.

Il conteggio dei campioni arriva dallo store (`sampleCounts()`) e non dai
riepiloghi in memoria, che i profili non li contengono: dedurlo da lì darebbe
zero per ogni immersione con profilo, e l'app riscaricherebbe a ogni giro profili
che ha già. Su SQLite è una colonna, su IndexedDB un cursore su un indice: in
entrambi i casi nessun campione viene deserializzato.

Il token vive nel portachiavi di sistema, non più nella tabella delle
impostazioni. Nel repository non c'è nessuna credenziale.

---

## L'accesso, e perché il servizio è quasi vuoto

Chi vuole un database condiviso ha due strade, ma non di pari dignità: si
**entra con Google** e il servizio crea il database, oppure — sotto la voce
«Avanzate», dove sta una via di scampo e non un'alternativa — si incollano
indirizzo e token di un database proprio. La seconda è arrivata per prima e non
è stata tolta: il giorno che il servizio di accesso non risponde e la sessione è
scaduta, senza quel campo non si sincronizza in nessun modo, e l'unico rimedio
sarebbe ricompilare l'applicazione. Il vincolo che ha guidato
tutto: l'accesso **non è obbligatorio**, perché l'archivio è locale e un logbook
che chiede di autenticarsi per mostrare le proprie immersioni sarebbe un logbook
peggiore.

**Un database per persona.** Non è un ripiego rispetto a una tabella con la
colonna del proprietario: è la scelta che tiene in piedi tutto il resto. Il
motore di sincronizzazione non cambia di una riga, perché ognuno ha già oggi un
database tutto suo; l'isolamento è fisico, quindi non esiste un filtro
dimenticato che diventi una fuga di dati; e la deduplica, le lapidi e la fusione
delle impostazioni restano dove sono invece di essere riscritte come endpoint di
una API. Provato e non affermato: con un servizio locale e un account di prova,
la chiave del database di prova risponde **401** su quello di qualcun altro.

**Il servizio non ha uno stato.** Nessuna tabella di utenti: il nome del
database si ricava dall'identità con un'impronta di `provider:sub`, troncata.
Non c'è un elenco di iscritti da custodire, non c'è niente da migrare, e non
esiste un file che colleghi un'email a un archivio. Il prezzo è dichiarato: non
si può revocare una singola sessione prima della scadenza, e non si sa quanti
utenti ci sono. La prima si comprerebbe con una lettura per ogni chiamata, la
seconda non serve a chi usa l'app.

**Due credenziali con due vite diverse.** La sessione dura settimane e sta nel
portachiavi; la chiave del database dura due ore e sta **solo in memoria**. La
distinzione non è formale: un archivio SQLite finisce nei backup di sistema e
nelle copie su disco esterno, e un token eterno scritto là dentro sopravvive a
chiunque l'abbia generato.

**Il ritorno dal browser è l'unica cosa scritta due volte.** Sul Mac
l'applicazione apre una porta su `127.0.0.1` per il tempo di un accesso; su
iPhone si registra uno schema URL, perché aprendo il browser l'app va in secondo
piano e il sistema può sospenderla — la porta non risponderebbe più. La
differenza non è un capriccio: il loopback è più stretto (lo tiene un processo
solo) e lo schema URL è l'unica cosa che iOS permette. In entrambi i casi la
difesa è la stessa e sta in un posto solo: quello che torna senza uno `state`
che combacia non viene guardato.

**Lo scambio del codice sta sul servizio, e ci è finito per forza.** La prima
versione lo faceva nell'app e su iPhone funzionava; sul Mac Google rispondeva
`client_secret is missing`, perché i client di tipo «Desktop app» — gli unici che
possono usare il loopback — il segreto lo pretendono anche con PKCE. Metterlo nel
pacchetto era la strada breve, e Google stesso dichiara che per le applicazioni
installate non è confidenziale; ma «non è davvero un segreto» è una frase che
invecchia male. Ora il codice va al Worker, il segreto sta fra i segreti di
Cloudflare, e l'app non vede mai un token di Google. Il guadagno inatteso è che
iPhone e Mac fanno la stessa identica strada: quel difetto era vivo su una
piattaforma sola, che è il posto peggiore dove nasconderne uno.

---

## Il pianificatore di gas, e cosa lo rende diverso

`core/analysis/gasPlan.ts` è aritmetica pura, e sarebbe banale se non fosse per da
dove prende il primo numero. Un pianificatore che parte da "20 L/min, valore da
manuale" produce numeri validi per un subacqueo medio che non esiste; questa app ha
il consumo reale di ogni immersione, calcolato da volume e pressioni, e usa il **75°
percentile** — non la media, perché pianificare sulla media significa che una volta
su due il gas basta appena.

Il resto delle scelte segue lo stesso criterio del resto del progetto: mostrare le
ipotesi invece del risultato. Il gas minimo non è un numero, sono quattro fasi con
la loro durata, la loro profondità media, la loro pressione ambiente e il loro
consumo — un numero unico non si può controllare, quattro sì. Le stesse fasi sono
disegnate come profilo, coi litri scritti dentro la fascia che li consuma, e la
geometria (`ascentGeometry`) è ricavata dalle fasi e testata, perché una figura che
racconta un piano diverso dalla tabella accanto sarebbe peggio di nessuna figura.

Le curve — tempo di fondo consentito al variare della profondità, gas minimo al
variare della profondità, tempo di fondo al variare del consumo — esistono perché la
*pendenza* dice quanto margine c'è, e un numero singolo no.

E poi c'è il pezzo che solo un logbook può avere: accanto al piano, come sono andate
davvero le immersioni a profondità simile. Se il piano promette un'uscita a 93 bar e
alle stesse profondità di solito si esce con 61, non è il piano a essere prudente: è
il consumo usato nel piano a essere troppo basso, e l'app lo dice con la differenza
in bar.

Due scelte restano dell'utente, perché sono due scuole e non due gradi di
correttezza. La **riserva** può essere il gas minimo calcolato (tecnica) o una
riserva fissa in bar (ricreativa, «esco con 50»); quando è fissa, il gas minimo
*non viene calcolato* — niente fasi, niente schema, nessun numero nascosto da
qualche parte, perché la casella dice "non voglio quel calcolo" e non "nascondilo".
Resta una riga, statica, che dice cosa quella scelta non vede: una riserva fissa non
dipende dalla profondità. La **regola di rientro** è terzi, metà o nessuna: su una
discesa lineare con risalita libera qualunque pressione di rientro sarebbe un numero
arbitrario, e `turnBar` è `undefined` invece di un valore inventato.

I tempi sono **due input, non uno**: tempo di fondo e durata totale. La differenza è
il budget della risalita, le soste hanno la precedenza — sono un obbligo, non
un'opzione che si taglia per rientrare nell'orario — e quello che resta è transito
verticale. Da lì esce la *velocità di risalita implicita*, che è il numero che dice se
il piano è eseguibile: 40 metri da risalire in due minuti sono 20 m/min, e l'app lo
dice invece di lasciarlo dentro un totale che sembra ragionevole. La velocità non si
imposta: si ricava. Quella impostabile è solo la velocità della risalita
d'**emergenza**, dove è lo standard a dettarla e il tempo è la conseguenza.

Un dettaglio che cambia i numeri più di quanto sembri: il gas del fondo si calcola
sulla profondità **media**, non sulla massima. Pianificare tutto il tempo di fondo
alla massima gonfia il consumo di circa un terzo, e chi controlla il conto con la
propria esperienza smette di fidarsi del pianificatore. La massima resta quella che
decide gas d'emergenza, PPO2 e narcosi — lì è il caso peggiore che conta. Il valore
medio viene precompilato dal rapporto mediano medio/massima delle sue immersioni
(`usualDepthRatio`), non da un rapporto da manuale — ma passando per
`bottomAvgForWholeAvg`, perché il computer registra la media dell'*intera*
immersione e il pianificatore chiede quella del solo tempo di fondo: usare la prima
al posto della seconda conta due volte la risalita e sottostima il gas del 12%.

Due invarianti tengono insieme il tutto, e sono nate da un audit che ha trovato otto
errori in una pagina con i test verdi. Primo: `planGas` **normalizza gli input e li
restituisce** in `plan.input` — media limitata alla massima, sosta non più profonda
del fondo, totale non inferiore a fondo più soste — e la pagina mostra quelli, mai lo
stato grezzo del modulo. Un numero mostrato diverso da quello calcolato è il modo più
rapido di perdere la fiducia di chi legge. Secondo: la somma delle durate delle fasi
vale **esattamente** la durata totale, quindi le fasi si possono disegnare in scala
senza sforare e la tabella non può contraddire la barra.

Cosa NON fa, e non per prudenza formale: **non calcola la decompressione.** Le soste
obbligatorie dipendono dal modello, dai gradient factor e dalla storia dei tessuti.
Sono il dominio del computer e del corso, non di una sottrazione. Le soste già
pianificate altrove si sommano come minuti aggiuntivi — l'aritmetica del gas la
facciamo, la decompressione no. Le avvertenze hanno due livelli proprio per questo:
"il piano non regge" e "da sapere" non sono la stessa cosa, e mostrarle con lo stesso
rosso insegna a ignorarle entrambe.

## Roadmap

### iOS

Tauri 2 supporta iOS come target. Il percorso:

```bash
npm run ios:init          # genera il progetto Xcode in src-tauri/gen/apple
npm run ios:dev           # simulatore
```

Serve Xcode e un account sviluppatore Apple per il dispositivo fisico. Il
frontend è già compilato per `safari15`, quindi WKWebView lo esegue senza
modifiche, e `tauri-plugin-sql` funziona su iOS con lo stesso database.

Cosa va rivisto nell'interfaccia — nessuno è un problema di architettura:

- **la tabella del logbook** va sostituita da una lista di righe impilate sotto i
  ~600 px: nove colonne su un iPhone non stanno, e lo scorrimento orizzontale è
  un ripiego, non una soluzione;
- **il tooltip dei grafici** oggi risponde a `mousemove`. Su iOS serve
  `touchmove`, con il riquadro spostato sopra il dito invece che sotto;
- **la navigazione** starebbe meglio come barra in basso, dentro la safe area
  (le variabili CSS `--safe-top` / `--safe-bottom` sono già in `styles.css`);
- **l'import da file** funziona con `<input type=file>`, che su iOS apre il
  selettore di iCloud Drive. Per prendere i file direttamente dall'app Shearwater
  servirebbe una share extension, che è lavoro nativo.

### Web

La build attuale è già una web app funzionante: `npm run build` produce `dist/`,
pubblicabile su qualsiasi hosting statico. Lo storage passa automaticamente a
IndexedDB, perché `storage/index.ts` sceglie in base alla presenza di
`__TAURI_INTERNALS__`.

Le due cose da decidere prima di pubblicarla:

- **la sincronizzazione** è fatta (vedi sopra) e vale identica sul web: il client
  libSQL usato è la build `web`, che parla HTTP e non ha binding nativi. Resta una
  scelta di prodotto — collegando un database condiviso i dati delle immersioni
  escono dal dispositivo — e per questo è facoltativa, spenta di default e
  configurata a mano.
- **il service worker**, per farla funzionare offline (che per un logbook
  consultato in barca conta più della sincronizzazione).

### Funzionalità in coda

In ordine di rapporto fra utilità e lavoro:

1. **Esportazione dell'archivio** in UDDF. Chiude il cerchio: i dati entrano da
   qualsiasi computer ed escono in un formato standard. È anche il backup, e
   togliere il timore del vendor lock-in su un archivio di anni vale molto.
2. **Attrezzatura e scadenze** — bombole, mute, revisioni erogatori, scadenze
   brevetti e certificato medico. Era una delle opzioni della v1 e non è entrata;
   il modello ha già `Cylinder`, servirebbe un'entità `Gear` con le date.
3. **Mappa dei siti.** Le coordinate arrivano già da UDDF, Subsurface e dal GPS
   dei Garmin. Serve una libreria di mappe, che è la prima dipendenza pesante che
   il progetto si prenderebbe.
4. **Download diretto dal computer subacqueo.** Per i computer Scubapro il pezzo
   difficile è già fatto: `uwatecSmart.ts` decodifica il formato dei record, che è
   lo stesso che il computer manda via Bluetooth. Mancherebbe solo il trasporto —
   che sul web non esiste (WASM non raggiunge USB né Bluetooth) e in Tauri
   richiederebbe un plugin BLE nativo. Per gli altri costruttori le strade sono
   invocare un binario esterno (`subsurface-downloader`, `divecmd`, che producono
   XML già leggibile dai parser esistenti) oppure il crate Rust
   `libdivecomputer` (maturità bassa).
5. **Confronto fra immersioni.** Due profili sovrapposti sullo stesso grafico,
   per vedere cosa è cambiato allo stesso sito a un anno di distanza.
6. **Modello di Bühlmann con gradient factor** nostro, da validare contro i valori
   di GF99 che Shearwater Cloud calcola sulle stesse immersioni: 38 confronti già
   disponibili. Servirebbe per pianificare la decompressione, che oggi il
   pianificatore di gas dichiara esplicitamente di non fare.

---

## Cosa non è stato fatto, e perché

- **Nessun router.** Le viste sono una manciata e lo stato di navigazione è una
  stringa. Dentro una webview senza barra degli indirizzi, un router aggiunge una
  dipendenza e non porta niente.
- **Nessuna libreria di grafici.** Il profilo di profondità — asse Y invertito,
  sovrapposizione del tetto deco, crosshair sul tempo — nessuna libreria lo fa
  bene, e le altre quattro forme sono cinquanta righe di SVG ciascuna. In cambio:
  bundle leggero (conta su iOS) e regole di stile applicate una volta invece di
  combattere i default di qualcun altro.
- **Nessuna gestione degli stati di caricamento oltre il minimo.** L'archivio si
  apre in una frazione di secondo e sta in memoria: gli spinner sarebbero
  decorazione.
- **GF99 campione per campione non viene ricostruito.** Nel log del computer non
  c'è: Shearwater Cloud lo ricalcola con la propria implementazione di Bühlmann, e
  quello che l'app mostra è il valore all'uscita che viene da lì. Calcolarlo per
  conto nostro darebbe una colonna che sembra letta dal computer e non lo è.
- **Nessuna dipendenza WASM per leggere SQLite.** Il database di Shearwater
  Cloud si legge, ma con un lettore di file SQLite scritto a mano
  (`parsers/sqliteReader.ts`, ~400 righe): pagine b-tree, varint, catene di
  overflow. L'alternativa era `sql.js`, ~1 MB di WASM su tre piattaforme per
  eseguire tre `SELECT`. Il lettore è verificato cella per cella contro
  `sqlite3` su un database reale.
- **Il decoder Uwatec non ricalcola la decompressione.** Il formato non contiene
  tetto, NDL né tempo in deco — non è una scelta del parser, quei campi non
  esistono nell'elenco dei tipi di record. Le soste obbligatorie di
  quelle immersioni si riconoscono dalla forma del profilo. Aggiungere un modello
  decompressivo (Bühlmann ZHL-16C con gradient factor) per ricostruirli a
  posteriori è possibile e non l'ho fatto: un tetto *calcolato da noi* mostrato
  accanto a uno *letto dal computer* sarebbe la stessa colonna con due
  significati diversi, e chi la legge non potrebbe distinguerli.
- **Nessun parser per l'export CSV di Shearwater.** Le sue intestazioni non sono
  documentate pubblicamente e non ho un file vero su cui verificarle: costruirlo
  a indovinare sarebbe un parser che sbaglia in silenzio. L'XML e l'UDDF sono la
  strada giusta.
- **Il volume delle bombole non viene inventato.** Dove il formato non lo porta
  (Shearwater XML, spesso il FIT senza `tank_summary`), l'app calcola i bar/min e
  dice che per i L/min serve quel dato. Un valore plausibile inventato
  produrrebbe un consumo credibile e falso, e finirebbe in un piano di gas.
