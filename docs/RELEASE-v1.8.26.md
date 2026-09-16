## MyDiveLog 1.8.26 — quattro difetti che non si vedevano

Una revisione indipendente ha letto il progetto alla 1.8.24 e ha riprodotto nove
problemi. Cinque sono stati chiusi in giornata; questi sono **gli ultimi
quattro**, e hanno in comune una cosa sola: *nessuno di loro dava un errore*.

### «Tutte o nessuna» era scritto e non era vero

Ogni immersione che entra in archivio sono **tre scritture**: il riepilogo, il
profilo e l'eventuale secondo profilo. Dovevano essere una cosa sola — o tutte o
nessuna — e c'era scritto che lo fossero.

Non lo erano. Il motore di database dell'applicazione non tiene una connessione
sola: ne tiene un gruppo, e il comando che apriva la transazione finiva su una
connessione diversa da quello che scriveva. Tre risposte «fatto» e niente di
indivisibile.

**Cosa cambia per chi la usa.** Se l'applicazione viene chiusa dal sistema
mentre sta salvando — su un telefono succede quando serve memoria — adesso o
l'immersione è in archivio intera, col suo profilo, o non c'è affatto. Prima
poteva restare **un'immersione senza il suo profilo**, e su un dispositivo senza
account quel profilo non tornava più.

Vale anche per la cancellazione e per lo svuotamento dell'archivio, che avevano
lo stesso difetto.

### La sincronizzazione poteva accorciare un profilo già salvato

Quando la stessa immersione è stata scaricata da due computer, l'applicazione
tiene due profili. I due viaggiavano insieme: se il principale doveva salire,
saliva anche il secondo — **sopra a un secondo profilo più ricco già presente
sull'altro dispositivo**.

Misurato: un profilo alternativo di 100 campioni ridotto a 5 da una
sincronizzazione. In silenzio, senza un avviso.

Adesso i due profili si decidono da soli, ognuno per conto suo, e possono
benissimo andare in direzioni opposte. E il secondo profilo **scende anche
quando è l'unico che c'è**: prima, su un'immersione senza profilo principale,
non arrivava mai.

### Dopo un'importazione il carico di azoto mancava fino al riavvio

Subito dopo aver importato, la scheda della saturazione diceva *«serve un
profilo campionato»* accanto a un profilo che c'era. Bastava chiudere e riaprire
l'applicazione e compariva il numero, senza aver aggiunto niente.

Il carico residuo di azoto, il GF99 e l'intervallo di superficie non si
calcolano da una sola immersione: nascono dalla **catena**, che va da
un'immersione all'altra in ordine di tempo. Quel passaggio c'era all'avvio,
dopo l'inserimento a mano e dopo un ripristino — e mancava proprio nelle due
strade dell'importazione, cioè dove le immersioni arrivano a decine.

*Il numero non era sbagliato: era assente, e il messaggio ne dava la colpa alla
cosa sbagliata.*

---

Ogni correzione ha una prova, e ogni prova è stata rimessa alla prova rimettendo
il difetto: **dieci mutazioni, dieci guardie rosse**. Più un'undicesima che è
rimasta verde — e quella ha fatto correggere la prova, non il codice.

In tutto **2 829 controlli automatici in 170 file**, più **140** sul motore
nativo.

### Impronte SHA-256

| Pacchetto | SHA-256 | byte |
|---|---|---|
| `MyDiveLog-macOS-arm64.dmg` | `42590d6d2d6b86cf0f753dbf6e8935c7f561491d9fbb0e3614cce981aa95c140` | 4.530.771 |
| `MyDiveLog-Windows-setup.exe` | `6a8669cd89778ff60c9d24fa546f977769178430ff3e8babd0e911249f03932c` | 3.262.484 |
| `MyDiveLog-Windows-portatile.exe` | `a28036d9c502bd6e2b9fe89ae9634a2e0ae61bf6b2b56e8c270315aae1914ac1` | 7.522.816 |
| `MyDiveLog-Android-arm64.apk` | `53af341d11741d3dbfcd02a1bae5d32a5b9e702d62340123dbe1f94457e953da` | 11.131.966 |
| `MyDiveLog-Linux-amd64.deb` | `a7f49a58f22b08cd1b4bfde5c31f4895cb387327c8c05120c238b49ec4eb798b` | 3.826.114 |

*Calcolate sui file allegati a questa release, non su una compilazione
precedente. Il `.deb` e l'`.apk` vengono dal workflow, e i loro due controlli
hanno risposto giusto.*

> **Su Windows e Android il giro completo non l'ha provato nessuno.** Il codice
> del motore è lo stesso del Mac e dell'iPhone, con tutte le prove dietro, ma
> finestra, Bluetooth, archivio e stampa su quelle due piattaforme non sono mai
> stati percorsi a mano. Su Linux sì, meno il Bluetooth, che vuole un
> adattatore.
>
> Vale anche per il selettore di destinazione arrivato con la 1.8.25: la
> compilazione per Android è verde e dentro l'APK ci sono le classi che servono,
> ma **il selettore che si apre su un telefono non l'ha visto nessuno**.
