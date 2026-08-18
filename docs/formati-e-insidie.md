# Formati dei computer subacquei — cosa contengono e dove ingannano

Note operative raccolte lavorando su file reali di Matteo. Servono a chi tocca
i parser di MyDiveLog: sono le ragioni per cui un logbook fatto in casa dà
numeri sbagliati senza segnalare nessun errore.

## Chi ha cosa

| | profilo | deco (tetto/NDL) | volume bombola | GF impostati | GF99 | fuso orario |
|---|---|---|---|---|---|---|
| UDDF | sì | sì | sì | no | no | a volte |
| Shearwater XML | sì | sì | **no** | no | no | no |
| Shearwater Cloud `.db` | **sì, dal log nativo** | **sì, campione per campione** | a volte | **sì** | **sì** (all'uscita) | no |
| Garmin FIT | sì | sì | dedotto da `tank_summary` | no | no | no |
| Scubapro LogTRAK | sì (blob Uwatec) | **mai** | sì | no | no | sì |
| CSV | no | no | se c'è la colonna | no | no | no |

Conseguenza pratica: nessuna fonte è completa. Il valore della deduplica non è
togliere i doppioni, è **unire** — il profilo da una parte, la decompressione
dall'altra, il volume bombola da una terza.

E un corollario che ha cambiato il codice due volte. Primo: **"il profilo più fitto
vince" è sbagliato** — l'Aladin campiona ogni 4 s e non sa niente della
decompressione, il Peregrine campiona ogni 10 s e registra tetto, TTS, NDL e CNS,
quindi il merge conta i *canali* prima dei campioni, coi dati deco a peso doppio.

Secondo, ed è la parte meno ovvia: **anche il profilo che perde va conservato.**
L'oscillazione d'assetto dipende dalla densità di campionamento. Misurata sulle 38
immersioni registrate da entrambi i computer, la mediana è 2.86 m/min sul profilo a
4 s e 1.71 m/min su quello a 10 s: il rapporto mediano è **0.66**, con estremi 0.44
e 0.82. Sulla stessa immersione. La velocità di risalita di picco invece regge
(7.9 contro 7.7 m/min), perché è già calcolata su una finestra di 30 secondi.

La conseguenza pratica è peggiore del singolo numero: se le immersioni recenti
usano il profilo rado e quelle vecchie quello fitto, la *tendenza* mostra un
miglioramento dell'assetto che è solo un cambio di strumento. Quindi il profilo
perdente resta in `Dive.altSamples` quando è più fitto, e le metriche che dipendono
dalla risoluzione si misurano sempre su di lui. Con la base uniforme, sull'archivio
reale, la tendenza dell'assetto passa da "in miglioramento" a piatta.

## Le insidie, per formato

**UDDF** è interamente SI e va preso alla lettera: `<tankpressure>20000000</tankpressure>`
sono 200 bar, la temperatura è in Kelvin, il volume in metri cubi, le frazioni di
gas fra 0 e 1. L'export UDDF di Shearwater non collega le bombole alle miscele —
limite noto del loro export.

**Shearwater XML** salva la pressione bombola in **mezzi PSI**: il valore va
moltiplicato per 2, e il fattore non è nel nome del campo. `imperialUnits` decide
come leggere profondità e temperatura *dentro lo stesso file*.
`startSurfacePressure` è in millibar. `currentTime` non ha unità documentate: si
ricava dal passo mediano fra campioni.

**Subsurface** ha le unità dentro la stringa (`depth='18.3 m'`) e i campioni
**delta-codificati**: un attributo assente significa "come prima", non
"sconosciuto". `<divelog>` e `<diveLog>` (Shearwater) sono formati diversi — un
confronto case-insensitive manda i file nel parser sbagliato.

**Garmin FIT** non tiene la pressione bombola nei `record`: sta in messaggi
`tank_update` separati, da agganciare per timestamp. Il volume della bombola non
esiste: si deduce da `tank_summary` (volume_used / Δpressione).

**Scubapro LogTRAK** è JSON, ma il profilo è un blob binario Uwatec Smart in
`diveLogBase64`. Nel binario l'intestazione è little endian e i dati dentro un
record sono big endian; i campioni sono un bitstream con delta a 4 e 7 bit *con
segno* (`0x7F` è −1, non 127). `deviceTypeNumber` 21 e 23 sono computer diversi
con intestazioni da 152 e 84 byte, e LogTRAK chiama entrambi `aladin_sport`: va
usato il numero, non la stringa. Il computer registra anche i minuti in
superficie dopo la risalita — su un'immersione da 35 minuti se ne sono trovati 5
di zeri in coda, che abbassano la profondità media e falsano il consumo.

**Shearwater Cloud** è un file SQLite, e nasconde due trappole in fila.

La prima è nel formato SQLite: la soglia del payload locale va calcolata con
**aritmetica intera**. Con i float sbaglia di un byte su pagine da 512, il
puntatore alla pagina di overflow viene letto dal posto sbagliato e il blob esce
troncato *senza nessun errore*. Con un blob di soli zeri non si nota.

La seconda è più insidiosa perché non è un errore, è un'assenza: **le 57 colonne
"leggibili" di `dive_details` sono quasi tutte vuote.** Sito, note, zavorra,
temperature, GF: `null`. L'applicazione le riempie solo se l'utente scrive quei
campi a mano. Chi legge solo quelle colonne conclude che il database non contiene
niente. Contiene tutto, in `log_data.data_bytes_1`.

Il campo `DIVE_START_TIME` sembra un epoch UTC ed è la lettura dell'orologio: il
fuso non è salvato da nessuna parte.

## Il log nativo Shearwater ("sw-pnf")

`log_data.data_bytes_1` è la copia della memoria del computer per quell'immersione:
**4 byte di lunghezza in little-endian**, poi un flusso **gzip**, poi del
riempimento. Il riempimento è la trappola: il piede del gzip (CRC32 e lunghezza)
non sta in fondo al blob, sta dove finisce il flusso compresso. Leggere gli ultimi
quattro byte del buffer dà lunghezza zero.

Decompresso, è una sequenza di record da **32 byte** dove il primo byte è il tipo:
`0x01` campione, `0x10`–`0x19` blocchi di apertura, `0x20`–`0x29` di chiusura,
`0x30` eventi (bussola e segnalibri), `0xE1` pressioni della terza e quarta
bombola, `0xFF` blocco finale con modello, seriale e firmware. I record tutti a
zero sono memoria non usata e si saltano.

Cose da sapere, tutte prese da `libdivecomputer/src/shearwater_predator_parser.c`:

- i campi del campione sono **spostati di un byte** rispetto al vecchio formato
  Predator, perché davanti c'è il tipo di record;
- lo **stesso byte** porta i minuti di NDL quando non c'è tetto e la durata della
  tappa quando c'è: confonderli fa apparire "6 minuti di deco" su un'immersione
  tutta in curva;
- la pressione della bombola è in **unità di 2 psi**, con i 4 bit alti usati per lo
  stato della batteria del trasmettitore; da `0xFFF0` in su sono codici di errore
  (spento, non accoppiato, nessuna comunicazione), non pressioni;
- i **gradient factor** stanno nel blocco di apertura 0, byte 4 e 5, e hanno senso
  solo col modello di Bühlmann: con VPM-B quei byte contengono altro;
- il passo di campionamento è nel blocco di apertura 5 in millisecondi, ma solo
  dalla versione 9 del log; altrimenti è 10 s;
- le **coordinate GPS** esistono dalla versione 17 del log e vanno lette solo con
  un fix valido (2D o 3D): gli altri stati sono "nessun satellite" e
  "disabilitato", e leggerli come coordinate mette l'immersione a zero gradi zero;
- il **GF99 campione per campione non c'è**. Shearwater Cloud lo ricalcola con la
  propria implementazione di Bühlmann e salva il risultato in
  `calculated_values_from_samples`: quello è il valore da leggere, ricalcolarlo per
  conto nostro darebbe una colonna che sembra letta dal computer e non lo è.

Verifica: `calculated_values_from_samples` contiene profondità media e massima,
temperature min/max, durata e obbligo deco calcolati da Shearwater **dagli stessi
campioni**. Su 38 log reali coincidono tutti, ma solo dopo aver scoperto che la
media di Shearwater **esclude i campioni a profondità zero** — e lo stesso vale per
le temperature, dove un campione in superficie a 23 °C alzava il massimo di un
grado.

## Orologi sfasati

Due computer allo stesso polso possono avere l'ora impostata diversamente. Nei
dati reali di Matteo l'Aladin e il Peregrine differiscono di **un'ora** su 32
immersioni e di **due** sulle ultime 4, perché a un certo punto l'orologio è stato
corretto. Una deduplica che confronta gli istanti non ne riconosce nemmeno una.

`inferClockOffsets` stima gli scarti dalla *distribuzione* delle differenze fra
immersioni che coincidono per profondità e durata: quelle casuali si
distribuiscono, quelle vere si accumulano. Ne riconosce più di uno per import.
Escludere le coppie ambigue sembrava più prudente e in pratica svuota il campione:
su un archivio con molte immersioni simili quasi ogni coppia è ambigua, e uno dei
due sfasamenti reali resta invisibile.

## Verificare un parser senza avere la specifica

Il metodo che ha funzionato meglio: cercare nel file due fonti **indipendenti**
degli stessi numeri e confrontarle.

- LogTRAK: il JSON ha profondità massima, durata e temperature già calcolate dal
  computer, il profilo è un blob separato. Decodificare il blob e confrontare è
  un test di correttezza vero. Le **temperature** sono il segnale più forte:
  accumulate come delta con segno, divergono al primo bit sbagliato.
- Shearwater Cloud: il lettore SQLite si confronta cella per cella con `sqlite3`;
  il log nativo si confronta con i valori che l'applicazione calcola per conto suo.
- gzip e DEFLATE scritti a mano si confrontano con `zlib` di Node, su dati casuali
  e sui casi limite (blocchi non compressi, Huffman fisso e dinamico, riferimenti
  indietro *sovrapposti* — dove una copia a blocchi dà il risultato sbagliato).
- I dati di prova nei test sono **generati**, non registrati, con valori scelti:
  così il test verifica che il parser li ricostruisca. E devono essere non banali —
  un blob di zeri nasconde un troncamento.

Script pronti: `npm run validate:logtrak <file>`,
`npm run validate:pnf <database.db>`, `npm run screenshot`.
