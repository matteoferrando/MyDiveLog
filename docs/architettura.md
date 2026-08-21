# Architettura e roadmap

Aggiornato: 21 agosto 2026

Le decisioni prese, perché, e cosa resta. iOS è fatto — l'app gira su un iPhone
vero; il web resta la strada aperta e non percorsa.

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

Il guscio Rust (`src-tauri`) fa poche cose, e sono esattamente quelle che il web
non può fare: registra il plugin SQL, registra il Bluetooth verso i computer
subacquei, mette le credenziali nel portachiavi di sistema, e su iOS scrive i
file esportati nella cartella dell'app — perché lì il download del browser non
esiste. Tutto il resto sta in TypeScript.

Accanto c'è una seconda regola, imparata su iOS: **`src/piattaforma.ts` sta fuori
da `ui/`**, perché serve anche alla persistenza, e un modulo di storage che
importa dall'interfaccia è una dipendenza al contrario. Riconoscere la
piattaforma non è interfaccia. E si usa solo dove una funzione **non esiste**
altrove — la stampa, il download — mai per decidere l'aspetto: quello dipende
dalla larghezza della finestra, che vale anche per un Mac a metà schermo.

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
  Cancellare mette nel cestino: l'immersione sparisce dall'archivio locale, non
  viene più sincronizzata, e sugli altri dispositivi resta. La lapide — cioè la
  cancellazione che viaggia — nasce solo svuotando il cestino, a mano o dopo
  trenta giorni. Il prezzo è dichiarato: nella finestra dei trenta giorni i due
  dispositivi non concordano, ed è quello che si paga per poter tornare indietro.

Il conteggio dei campioni arriva dallo store (`sampleCounts()`) e non dai
riepiloghi in memoria, che i profili non li contengono: dedurlo da lì darebbe
zero per ogni immersione con profilo, e l'app riscaricherebbe a ogni giro profili
che ha già. Su SQLite è una colonna, su IndexedDB un cursore su un indice: in
entrambi i casi nessun campione viene deserializzato.

Il token vive nel portachiavi di sistema su Apple, inserito una volta
dall'interfaccia. Nel repository non c'è nessuna credenziale.

**E la CSP va letta come l'elenco dei servizi raggiungibili.** `connect-src` in
`tauri.conf.json` deve nominare Turso e l'API di Anthropic: senza, la webview
blocca le chiamate prima che partano, e il sintomo non è un errore di rete ma
«le credenziali non funzionano». Non si vede sviluppando, perché `npm run dev`
gira in un browser normale dove quella CSP non esiste — si vede solo nell'app
impacchettata. Ogni voce in più in quell'elenco è una porta aperta, quindi ci
stanno due nomi e nient'altro.

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

### iOS — fatto, e cosa ha insegnato

L'app gira su un iPhone vero. La previsione architetturale ha tenuto: il nucleo
non è stato toccato, `tauri-plugin-sql` apre lo stesso database, il frontend
compilato per `safari15` gira in WKWebView senza modifiche. Tutto quello che è
costato lavoro sta ai bordi — e vale la pena scrivere quali bordi, perché la
lezione si generalizza.

**La categoria di difetto che iOS produce**: funziona sul Mac, non fa niente sul
telefono, non lancia nessun errore. Tre casi veri, tutti scoperti usando l'app e
nessuno da un test:

| Cosa | Perché muto | Dove sta ora la difesa |
|---|---|---|
| Chiamate a Turso e all'API | `connect-src` della CSP non le elencava, e la webview rifiuta prima di partire | `tauri.conf.json`, e la CSP va letta come **l'elenco dei servizi raggiungibili** |
| Esportazione di file | `<a download>` in WKWebView non scrive e non lancia | `ui/esporta.ts`, unico punto, che **lancia** se non riesce |
| Riquadri e cursori dei grafici | `mousemove` non esiste sotto il dito, e `pointercancel` va gestito o resta tutto aperto | eventi del puntatore ovunque, con `tests/iosGuardie.test.ts` a leggerlo dalle sorgenti |

La difesa che si è rivelata utile non è un test di unità — non se ne può
scrivere uno che apra una WKWebView — ma un test che **legge le sorgenti** e
verifica che il costrutto sbagliato non rientri. È grossolano e copre la
distanza fra «compila» e «serve a qualcosa su un telefono».

**`src/piattaforma.ts` sta fuori da `ui/`** perché serve anche a `storage/ble.ts`
per dire dove si concede il permesso Bluetooth, e un modulo di persistenza che
importa dall'interfaccia è una dipendenza al contrario. Riconoscere la
piattaforma non è interfaccia. Va usato solo dove una funzione **non esiste**
altrove — la stampa, il download — mai per decidere l'aspetto: quello dipende
dalla larghezza della finestra, che è il criterio giusto e vale anche per un Mac
a metà schermo.

**La catena di build ha una regola sola**: `src-tauri/gen/apple` è generata e non
versionata, quindi tutto ciò che deve sopravvivere sta in `tauri.conf.json`
(permessi via `Info.ios.plist`, `frameworks`, `developmentTeam`) oppure in uno
script che gira dopo la generazione. Gli script `ios:*` fanno tre cose in fila:
generano, ricopiano le icone — che `tauri ios init` non aggiorna se esistono
già — e passano `scripts/pulisci-progetto-ios.mjs`, che toglie `libapp.a` dalle
risorse del pacchetto. Senza quest'ultimo l'app pesa 470 MB invece di 6, e con
due architetture compilate la build si ferma.

Quello che su iPhone **non c'è**: la stampa, perché `window.open` e
`window.print` non esistono in WKWebView. I pulsanti sono nascosti, non
lasciati a mostrare un errore che dà la colpa alla cosa sbagliata.

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

I sei punti che stavano qui — export UDDF, attrezzatura e scadenze, mappa dei
siti, scarico diretto dal computer, confronto fra immersioni, Bühlmann con
gradient factor — sono **tutti fatti**. Quello che resta, in ordine di rapporto
fra utilità e lavoro:

1. **Il Bluetooth dall'iPhone.** I due driver hanno scaricato da computer veri,
   ma sempre dal Mac. Sul telefono manca la prova, e il caso peggiore è muto: il
   permesso negato non produce nessun errore, perché `checkPermissions` di
   `tauri-plugin-blec` è implementato solo per Android. L'app può soltanto
   elencare le cause possibili dopo dodici secondi di ricerca a vuoto. Renderlo
   diagnosticabile davvero significa scrivere il pezzo di CoreBluetooth nel
   guscio Rust.
2. **Condividere un'immersione in sola lettura.** È la funzione che serve
   davvero quando si dice «multiutente»: un compagno, un istruttore, un medico
   iperbarico devono poter LEGGERE, non modificare, e non vedere il resto.
   Oggi l'unica strada è dare il token del database, che dà tutto e permette di
   cancellare. Costa un decimo di un sistema di account.
3. **Un secondo modello decompressivo verificato.** VPM-B è implementato ma non
   ha nessun riscontro indipendente: Bühlmann è stato validato contro Shearwater
   su 38 immersioni, VPM-B contro niente. Finché è così, l'app deve continuare a
   dichiararlo.
4. **Utenti veri con account.** Deciso di **no per ora** (21 agosto 2026); la
   ragione e l'architettura da usare quando si farà — un database per utente, e
   un servizio che autentica e firma token brevi, senza duplicare il nostro SQL
   in una API — stanno in `docs/stato-progetto.md`. Il vincolo da non violare è
   che il locale-prima resta: niente «accedi per vedere il tuo logbook».

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
