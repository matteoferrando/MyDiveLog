# 1.8.30 — i computer subacquei, uno per uno

*La notte fra il 22 e il 23 settembre 2026 su una richiesta sola — «far
funzionare tutti i computer dalla 1.8.30 in poi» — più i tre giorni di lavoro
dalla 1.8.29, che stavano già aspettando un numero.*

Il metodo è quello di sempre, e qui conta più del solito perché di computer
subacquei in casa ce n'è uno: **leggere, per ogni famiglia, che cosa la libreria
si aspetta da noi e che cosa noi le davamo**, e mettere una prova su ogni
risposta. Quello che una prova non può dire — come si comporta la radio di un
modello che qui non c'è — sta scritto in fondo, con lo stesso peso del resto.

---

# Parte prima — i computer

## 1 — libdivecomputer dalla 0.9.0 al ramo principale

Commit `9e6c3c8` dell'11 settembre 2026, «0.10.0-devel»: ottantanove commit dopo
la 0.9.0 del 30 giugno 2025. Il tarball si ricava con `make dist` e la ricetta
per rifarlo sta in testa a `src-tauri/build.rs`, che adesso è anche **l'unico
posto dove la versione è scritta**: `scripts/libdivecomputer.mjs` la legge per
il catalogo e per le tre prove che prima ne tenevano ciascuna una copia.

**Cosa porta.** Dieci modelli Bluetooth nuovi — Perdix 3, Quad 2, Sirius L, Puck
Pro EZ, Puck Pro Ultra, Raffaello, Seac Tablet, OSTC 3, OSTC cR, OSTC Nano — e,
dentro backend che usavamo già:

| Famiglia | Prima | Adesso |
|---|---|---|
| Pelagic i330R/DSX | un codice d'accesso rifiutato (risposta 13) era «errore di protocollo», a ogni tentativo | `DC_STATUS_NOACCESS`, e la libreria chiede da sé il PIN nuovo |
| Halcyon Symbios | lo stato del protocollo Bluetooth 1.30 (36 byte) era «Unexpected packet length» | letto, 20 o 36 byte |
| Mares iconhd | un puntatore di fine profilo storto fermava la lettura | ignorato se fuori dai limiti |
| Seac | — | il Tablet via Bluetooth, e il segnalibro sul numero d'immersione |

Il catalogo passa da 105 a **115 voci** (110 → **116 descrittori BLE**, 20 → **21
marche**). La pagina del sito è rigenerata: 115 modelli via Bluetooth più gli
otto Garmin che passano da un file, Seac nel nastro delle marche. **Non
pubblicata** — e il § 8 dice perché il numero non è più 123.

**Il confine C, verificato e non supposto.** Gli enum degli eventi non sono
rinumerati (`SAMPLE_EVENT_HEADING` è solo segnato come deprecato); l'unione dei
campioni guadagna `dc_location_t` ma resta di 24 byte, perché la sosta di
decompressione era già così grande; `DC_SAMPLE_LOCATION` arriva in coda
all'enum e il nostro lettore lo ignora; `version.h` e `revision.h` escono giusti
da tutte e due le strade di compilazione — autotools e `cc` — e il workflow
«Windows, Android e Linux» è verde sul commit, con la tabella dei descrittori
nuova dentro il binario di Windows e dentro la libreria di Android.

## 2 — Il Perdix 3 sarebbe finito al driver sbagliato

Stessa famiglia del Peregrine, `shearwater_petrel`, e un altro protocollo:
servizio GATT `1aa44039-…`, niente intestazione di due byte sui pacchetti BLE,
cornice da cinque byte invece di quattro. La libreria lo sceglie dal numero di
modello, 14.

Da noi due porte lo mandavano al driver di casa, che parla V1: la scelta per
sola famiglia (`scelta.ts`) e il riconoscimento per prefisso («perdix» è l'inizio
di «Perdix 3»). Adesso `FAMIGLIE_CON_DRIVER` porta anche i **numeri di modello**
che il driver conosce, il riconoscimento esclude i nomi del protocollo V2, e una
prova elenca le voci del catalogo che la famiglia conosce e il driver no — oggi
solo il Perdix 3 — così la prossima rigenerazione obbliga a decidere invece di
promettere da sola. *Un modello nuovo non è una promessa del driver vecchio.*

## 3 — Le immersioni si leggono col modello che il computer dichiara

`traduci` costruiva il lettore con `dc_parser_new2`, cioè sul modello del
descrittore SCELTO. Per molte famiglie il modello decide come si leggono i byte
— la disposizione dei campioni dei Mares, hwOS 3 o hwOS 4 negli OSTC, gli schemi
della memoria Pelagic — e il modello scelto può non essere quello vero: chi ha un
Mares dietro il BlueLink sceglie fra sette nomi, chi ha un Ratio fra venticinque,
e con la libreria nuova tutti gli OSTC fino al Plus hanno il numero zero.

Adesso le immersioni si leggono **prima di chiudere il dispositivo**, con
`dc_parser_new`: il modello è quello che il computer ha dichiarato con
`DC_EVENT_DEVINFO`, che tutti i backend BLE mandano prima della prima immersione.
È la strada di Subsurface (`dive_cb`), cioè quella su cui la libreria è
collaudata davvero. Il diario scrive modello e firmware dichiarati — il seriale
no, il diario si allega alle segnalazioni — e dice quando la scelta era
un'altra. Il nome sulle immersioni si corregge **solo se il numero porta a un
nome solo**: i quattro Puck nuovi sono tutti 0x35, e sostituire un errore certo
con uno probabile non è una correzione.

## 4 — La chiave dell'i330R

**Il difetto.** La regola «dopo uno scarico fallito la chiave conservata si
butta» stava nel `catch` di `BleDownload.tsx`. Dalla 1.8.20 uno scarico fallito
non lancia più — torna col guasto dentro l'esito, per non perdere le immersioni
già arrivate — e nel `catch` arrivavano solo i guasti di PRIMA dello scarico:
collegamento, servizi, ponte. Cioè esattamente quelli in cui la chiave non era
mai stata presentata. *Buttava la chiave quando non c'entrava, e la teneva
quando c'entrava*: con la 0.9.0 un computer azzerato sarebbe rimasto chiuso per
sempre.

**Adesso** il guscio Rust sa quello che l'interfaccia poteva solo indovinare —
la chiave è stata presentata? il computer ne ha data una nuova? si è aperto? —
e lo manda come `chiaveNonAccettata`. La chiave si butta alla **seconda volta di
fila** (`contaRifiutoDellaChiave`): una chiave che non vale più non aprirà mai,
un collegamento che perde colpi prima o poi passa.

**E il giro nuovo della libreria, percorso da capo a fondo.** Un i330R finto a
cui si presenta una chiave vecchia risponde 13; la libreria chiede il PIN
attraverso il nostro trasporto, se ne fa dare una chiave nuova, la conserva e
riapre. Prova contro la libreria vera, comando per comando.

## 5 — La coda di una lettura vecchia, dall'altro lato

Il 22 settembre la coda arrivava prima del primo comando, e la cura è stata
**ascoltare prima di parlare**. Due buchi vicini, trovati rileggendo:

- **una coda che arriva DOPO** — più lunga del tetto dell'ascolto, o in ritardo:
  adesso un pacchetto Pelagic intero che risponde a un comando diverso
  dall'ultimo scritto si butta e si conta (`con_filtro_del_comando`). La
  libreria lo avrebbe rifiutato comunque, quindi buttarlo non può che aiutare;
- **un pacchetto cominciato nella stessa notifica del precedente** si consegnava
  a metà: la seconda lettura trovava l'inizio in cassa e non aspettava il resto.
  La lunghezza dichiarata ora si completa da tutte e due le strade.

## 6 — Il Mares giusto

`mares_iconhd_device_open` decide la forma dei pacchetti dal modello SCELTO —
`ISSIRIUS(model) ? VARIABLE : FIXED` — quindi un Mares proposto male non è
un'etichetta storta: è uno scarico che non parte. E «Puck Pro U», il nome che la
libreria elenca per il Puck Pro Ultra, contiene «Puck Pro», il Puck della
generazione prima, a pacchetto fisso.

Adesso chi annuncia «Mares bluelink pro» sceglie fra i Mares dell'adattatore,
chi ha il Bluetooth dentro fra i suoi (`MARES_BLE_NATIVI`, confrontato da una
prova con l'elenco a pacchetto variabile del ponte Rust), e un nome troncato
trova il modello di cui è l'inizio. In più: la regola del numero per l'Halcyon
(«H01…», «H07…»), e i nomi vecchi dei Cressi («GOA_», «CARESIO_») che Subsurface
conosce e i filtri della libreria no.

## 7 — L'ascolto delle notifiche si ritenta, come il collegamento

Accendere le notifiche vuol dire scrivere sul computer il descrittore che le
accende (il CCCD) e aspettarne la conferma; il plugin la aspetta cinque secondi,
poi dice «timeout during subscribe». Fino alla 1.8.29 lo scarico finiva lì — *«le
notifiche non si attivano»* — mentre il collegamento, dal 9 settembre, si
riprova tre volte.

Subsurface ha visto quella conferma arrivare ben oltre il secondo su Android,
mentre il sistema negozia MTU e parametri, o perdersi in silenzio; dal ramo
principale di `qt-ble.cpp` la ritenta tre volte. Adesso anche noi
(`iscrivi_con_ritentativi`), per i dati e per i crediti degli OSTC, con una riga
di diario per ogni tentativo andato male. Ritentare non raddoppia niente: il
plugin registra chi ascolta **solo dopo** un'iscrizione riuscita, e una prova
misura che una notifica arriva una volta sola anche dopo tre iscrizioni.

*Nessun diario nostro l'ha ancora mostrato*: è una lezione presa da chi ha più
computer in mano di noi, e quando tutto va costa zero.

## 8 — Il sito contava i Garmin fra quelli che si scaricano via Bluetooth

La pagina iniziale diceva «123 modelli che si scaricano via Bluetooth», e la
pagina dei computer e l'aiuto ripetevano il numero. Era 115 più gli otto Garmin
Descent, e i Descent via Bluetooth non si scaricano: la stessa pagina scriveva
«Solo dal file» accanto a ciascuno. **Il sito pubblicato oggi dice 113** — 105
più gli stessi otto — dal 15 settembre, e la guardia che doveva impedirlo
(`tests/sitoMarche.test.ts`) sommava i Garmin anche lei.

Adesso il numero si conta con `esitoPer`, la funzione che scrive la riga di ogni
modello: la pagina dei computer dà i due conti separati (115 via Bluetooth, 8 dal
file), l'aiuto dice 358 e 115, e la somma vecchia è vietata per nome. Anche il
banner di Play diceva «105 modelli via Bluetooth», scritto a mano: lo script
adesso lo conta dal catalogo, e una prova confronta quel conto con `esitoPer`.
Il PNG caricato su Play resta quello vecchio finché non si rigenera
(`npm run play:grafica`) e si ricarica.

## 9 — Il banco per famiglia: tutte e sedici

Di computer subacquei qui ce n'è uno. La domanda «si scarica?» ha due metà, e una
sola si misura da qui: se **il nostro trasporto** consegna alla libreria quello
che la libreria si aspetta — notifiche intere o spezzate, scritture della misura
giusta, l'ordine delle risposte. Tredici computer finti nuovi, uno per ogni
protocollo che il catalogo aveva e nessuna prova percorreva; parlano come scrive
il sorgente della libreria, passano dal `FlussoBle` vero, e scaricano contro la
libreria vera. Con l'Aladin, l'i330R e i Mares che c'erano già fanno **sedici
famiglie su sedici**:

| Finto | Cosa ha di suo | Notifiche |
|---|---|---|
| Perdix 3 | protocollo V2: niente intestazione BLE, cornice da cinque, SLIP, immersioni compresse (LRE + XOR) | 20, 182, 509 |
| Cressi Goa | versione letta da tre caratteristiche, risposte in pacchetti da 512, «EOT xmodem» in una lettura sola | 20, 182 |
| Seac Tablet | `dc_packet_open(244, 244)`, CRC-16, risposte da 2 056 byte | 20, 182, 244, 509 |
| Suunto EON Steel | HDLC a pezzi da 20, un file system, CRC-32, numero «magico» | 20, 182 |
| Aqualung i200C | stretta di mano con le cifre del nome Bluetooth, pacchetti da 20 numerati | 20 |
| Ratio iX3M 2021 | comandi con CRC-16, firmware vecchio e APOS4 (tre campioni per pacchetto, riempitivo dopo l'ultimo) | 20, 182 |
| OSTC 3 | eco + dati + «pronto», registro compatto da 4 096 byte, il numero dell'immersione scritto dopo l'eco | 20, 182 |
| Halcyon Symbios | CRC-8, blocchi da 200 con sequenza e ACK; lo stato da 20 e da 36 byte (Bluetooth 1.30, la correzione della libreria nuova) | una per pacchetto |
| Crest CR-4 (Deep Six) | un pacchetto intero per lettura con la sua somma, l'indice del firmware 6 | una per pacchetto |
| Divesoft Freedom | `dc_hdlc_open(244, 244)`, messaggi a più pacchetti numerati, CRC-16 X.25 | 20, 182 |
| Deepblu Cosmiq+ | righe di testo esadecimale, sei byte di dati per riga, una riga per notifica | una per riga |
| McLean Extreme | la prima risposta dopo secondi (vedi il § 10) | 182 |
| Oceans S1 | righe di testo, poi XMODEM-CRC: blocchi da 517 spezzati, 'C', ACK, EOT | 20, 182 |

Scaricano tutti, e le immersioni arrivano byte per byte come il finto le ha
messe in memoria. Ognuno è stato visto rosso con una mutazione — il resto di una
notifica buttato via (Seac), il nome Bluetooth storpiato (Oceanic), una
caratteristica letta al contrario (Cressi), un CRC o una somma sbagliati (quasi
tutti), lo XOR della compressione tolto e l'intestazione del protocollo vecchio
(Perdix 3). **Il Deepblu è l'unico dei tredici che diventa rosso se il trasporto
incolla due notifiche**: con l'Aladin, è la famiglia che custodisce la regola
«una notifica, una lettura».

*Un finto scritto leggendo la libreria non prova che la libreria abbia ragione
sul computer: prova che fra lei e noi non si perde niente.* L'altra metà resta
di chi ha il computer in mano.

## 10 — Il McLean Extreme si vedeva rimandare il primo comando

Trovato dal banco. `mclean_extreme.c` scrive che la prima risposta arriva dopo
*«about 6-8 seconds»*, e la libreria la aspetta da sé: letture da un secondo,
ripetute fino a quindici volte, senza rimandare niente. Il nostro ripiego sul
silenzio invece, alla prima lettura scaduta senza notifiche, rimandava il primo
comando nell'altra modalità di scrittura — giusto quando la modalità è sbagliata,
sbagliato quando il computer sta solo lavorando. Su un McLean finto che fa un
comando alla volta: due risposte al firmware, la seconda letta al posto del
numero di serie, *«Unexpected command byte»*.

Adesso per chi risponde adagio (`RISPONDONO_ADAGIO`, oggi solo il McLean) il
ripiego si spegne e il diario lo dice. Una prova da capo a fondo col ponte vero
e un'antenna che accetta tutte e due le modalità vede il firmware scritto una
volta sola; tolta la regola, lo vede scritto due volte. Il giro dei metodi fra
un tentativo e l'altro resta com'era.

---

# Parte seconda — il pianificatore e la scheda

- **Il ruolo «bailout» col circuito chiuso.** Il nucleo sapeva già cosa farne; il
  menu offriva solo fondo, transito e decompressione, mentre il suggerimento
  sotto la casella del rebreather ne parlava.
- **Gli indici del bailout.** Con una bombola di bailout il diluente esce
  dall'elenco dei gas a circuito aperto, e il piano numerava i gas di
  quell'elenco: sotto il consumo della bombola da undici litri la scheda
  scriveva «Ti serve Tx21/35», il diluente da tre.
- **Dati salvati senza forma.** Tessuti troncati a otto compartimenti, livelli o
  gas del pianificatore vuoti: il grafico disegnava coordinate NaN, la pagina
  cadeva, e una ripetitiva veniva calcolata con meno carico di quello vero.
- **L'ordine del tempo.** La velocità verticale e la linea della decompressione
  davano per scontato che i campioni del file fossero in ordine.
- **Il cursore dei gradient factor**, l'ultimo controllo sotto misura: 36 col
  mouse e 44 col dito, pallina da 20 e da 28.

# Parte terza — iPhone e Mac

I pacchetti Apple dichiarano italiano e inglese (`CFBundleLocalizations`, le
cartelle `.lproj`): i pezzi che il sistema disegna dentro l'app — Annulla, Fine,
Copia, Incolla — seguono la lingua del telefono, il perché del Bluetooth è
tradotto, e l'App Store smette di elencare l'app come solo inglese.

# Parte quarta — sotto il cofano

- **`noUncheckedIndexedAccess` acceso**: 1 680 punti guardati uno per uno, sei
  comportamenti cambiati, fra cui il lettore SQLite (Shearwater Cloud) che su un
  file troncato inventava colonne vuote invece di rifiutarlo.
- **Clippy nella catena**, con ogni avviso trattato da errore.
- **La prova del pool SQLx era un'estrazione a sorte**: una volta su una decina
  diventava rossa nel contenitore di lavoro. Trecento giri sotto carico hanno
  detto perché — due volte le tre istruzioni erano finite sulla stessa
  connessione, e lì il `ROLLBACK` annulla davvero — e hanno smentito la frase
  che la spiegava (SQLx non annulla da sé la transazione rimasta aperta: dove va
  un'istruzione lo decide il pool). La prova adesso ha due strade con un esito
  certo ciascuna.
- **Le schermate dell'App Store** si rifanno in un comando, in due lingue, e un
  controllo le misura contro l'elenco chiuso di Apple; lo stesso controllo ha
  trovato due schermate di Play identiche byte per byte.

---

# Quello che non è verificato, detto

- **Nessuno dei modelli nuovi è stato collegato.** Sono verdi contro la libreria
  vera e contro computer finti; l'elenco dei provati (`provati.ts`) resta di una
  riga, il Quad Ci del 16 settembre.
- **L'i330R dopo una caduta**: il ritentativo automatico non si collega più (tre
  «Timeout during execution of Connect», 53 secondi). Sembra che esca dal
  Bluetooth quando il collegamento cade; da chiedere a chi ce l'ha in mano prima
  di cambiare il ritentativo.
- **Il Perdix 3** passa da un protocollo entrato nella libreria il 13 luglio 2026:
  qui nessuno l'ha visto parlare.
- **L'iscrizione ritentata** (§ 7) cura un guasto che Subsurface ha visto e noi
  no: se un diario lo mostrerà, dirà anche se tre tentativi bastano.
