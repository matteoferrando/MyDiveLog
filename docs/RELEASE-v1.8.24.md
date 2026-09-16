## MyDiveLog 1.8.24 — diciotto numeri che mentivano

Questa versione non aggiunge niente e non tocca l'interfaccia. Chiude
**diciotto difetti**: sedici trovati in due giorni di riletture avversariali,
uno saltato fuori rigenerando il sito, e **uno segnalato da chi usa
l'applicazione**.

Hanno tutti la stessa forma — *un dato plausibile e falso*. Non errori che si
vedono, non schermate vuote: numeri giusti nella loro casella e sbagliati
rispetto alla realtà.

### I numeri che decidono

| | prima | adesso |
|---|---|---|
| Consumo con una pressione di superficie impossibile in archivio | 18.8 L/min | **12.3** |
| PPO2 di picco quando il computer non consegna una miscela | 1.62 | **1.06** |
| Punti del profilo stampato fuori dal riquadro, coi campioni fuori ordine | 15 su 31 | **0** |
| 31 febbraio | data certa, spostata al 3 marzo | **«senza data»** |
| Stesso tuffo scaricato in due fusi orari | due immersioni su ogni dispositivo | **una** |

- Il **consumo in litri al minuto** usciva gonfiato fino al 53% quando un file
  dichiara una pressione di superficie impossibile — uno zero che quattro
  lettori possono produrre. Quel valore finisce nel pianificatore.
- Sulla stessa immersione i **sedici compartimenti di Bühlmann** uscivano tutti
  oltre il valore M, il primo al 248%: un grafico rosso su un'uscita tranquilla
  a venti metri.
- L'**esposizione CNS** decideva su un numero e ne mostrava un altro: «80%»
  senza nessun avviso, «100%» classificato come semplice prudenza.
- La **MOD del gas analizzato** ignorava acqua e quota: in un lago a 2000 m
  diceva 29.6 m dove sono 33.3.

### Il profilo, le date, la sincronizzazione

- Il **profilo stampato sul libretto** poteva essere un disegno credibile e
  sbagliato quando i campioni arrivano fuori ordine. Vale anche per il grafico
  a schermo, per gli otto grafici sotto di lui e per la descrizione che uno
  screen reader legge al posto del grafico.
- Il **numero progressivo** dell'immersione poteva cambiare da un avvio
  all'altro con una data illeggibile in archivio.
- Un **campo svuotato a mano** e una **bombola tolta a mano** tornavano indietro
  dall'altro dispositivo, per sempre.
- Un **profilo illeggibile** sul server spariva in silenzio mentre la
  sincronizzazione si dichiarava riuscita.
- «La chiave del tuo database è scaduta» compariva anche quando il problema era
  tutt'altro: bastava che il messaggio della libreria contenesse la parola
  «token», e un JSON malformato la contiene.

### E una segnalata da chi la usa

**Su Android «Esporta PDF» diceva «PDF salvato» e non salvava niente.** Dentro
la finestra dell'applicazione il download del browser non funziona e non dà
errore, quindi la conferma compariva su un file che non esisteva — ed era
proprio il difetto che questa applicazione aveva già chiuso una volta, sui
telefoni di Apple soltanto. Adesso il file si scrive davvero, e il messaggio
dice **in che cartella**.

*Grazie a chi l'ha segnalato.* Una falsa conferma su un'esportazione non perde
un file: costruisce fiducia in un file che non c'è.

---

Ogni correzione ha una prova che è stata rimessa alla prova rimettendo il
difetto: **2 769 controlli automatici in 165 file**, più **135** sul motore di
lettura dei computer subacquei, verdi anche con l'orologio a UTC+14 e a UTC−11.

### Impronte SHA-256

| Pacchetto | SHA-256 | byte |
|---|---|---|
| `MyDiveLog-macOS-arm64.dmg` | `DA-RIEMPIRE` | |
| `MyDiveLog-Windows-setup.exe` | `DA-RIEMPIRE` | |
| `MyDiveLog-Windows-portatile.exe` | `DA-RIEMPIRE` | |
| `MyDiveLog-Android-arm64.apk` | `DA-RIEMPIRE` | |
| `MyDiveLog-Linux-amd64.deb` | `eeb37815ca55beb6ded52d41a24d93bc93677678a245f5719cef8743a1810c01` | 3.843.180 |

*L'impronta del `.deb` è quella del pacchetto costruito il 16 settembre nella
sessione in cloud, con gli stessi comandi del workflow. Se allegi quello uscito
da GitHub Actions, ricalcolala: due compilazioni non danno lo stesso byte.*

> **Su Windows e Android il giro completo non l'ha provato nessuno.** Il codice
> del motore è lo stesso del Mac e dell'iPhone, con tutte le prove dietro, ma
> finestra, Bluetooth, archivio e stampa su quelle due piattaforme non sono mai
> stati percorsi a mano. Su Linux sì, meno il Bluetooth, che vuole un
> adattatore.
