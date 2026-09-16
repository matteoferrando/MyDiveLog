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
| `MyDiveLog-macOS-arm64.dmg` | `c3fe424977a8b747dc00e542b20d98c7660011c89976c3f411da691439b4e0f8` | 4.521.208 |
| `MyDiveLog-Windows-setup.exe` | `5f37b051918181bd5b3796577a94414930e52e112160e9c23df9fb4bf817409c` | 3.257.539 |
| `MyDiveLog-Windows-portatile.exe` | `d40e564f345cdb03f436cc4a8311ac85c4200c772446ed15e74cb87277aa2fb1` | 7.507.968 |
| `MyDiveLog-Android-arm64.apk` | `ed5be25bd47d0870244271ab4971a725c3540d7a19bb2a96607a5c321d68debf` | 10.376.618 |
| `MyDiveLog-Linux-amd64.deb` | `83bdda81334637f5109dc8557971c07403cb9c7ca1cd841fcb64edaf66f7863d` | 3.816.910 |

*Calcolate sui file allegati a questa release, non su una compilazione
precedente. Il `.deb` e l'`.apk` non li ha costruiti nessun Mac: vengono dal
workflow, e i loro due controlli hanno risposto giusto — «nessuna traccia
dell'aggiornatore nel binario» per Linux, «firmati: 1 apk, 1 aab» per Android.*

> **Su Windows e Android il giro completo non l'ha provato nessuno.** Il codice
> del motore è lo stesso del Mac e dell'iPhone, con tutte le prove dietro, ma
> finestra, Bluetooth, archivio e stampa su quelle due piattaforme non sono mai
> stati percorsi a mano. Su Linux sì, meno il Bluetooth, che vuole un
> adattatore.
