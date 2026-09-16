## MyDiveLog 1.8.25 — il file che c'era e non si trovava

Due cose, tutte e due arrivate da chi usa l'applicazione. La prima è la coda di
un difetto che la 1.8.24 aveva chiuso a metà.

### Su Android il file adesso lo scegli tu

Ieri «Esporta PDF» diceva «PDF salvato» e non salvava niente. La 1.8.24 ha
smesso di mentire e ha cominciato a scrivere il file davvero — ma lo scriveva
dentro la cartella privata dell'applicazione, che **da Android 11 nessun
gestore di file può aprire** e che la disinstallazione porta via.

> *«Purtroppo il pdf non si genera ancora anche se è cambiato il messaggio.
> Forse perché si genera in una cartella che non risulta visibile se non da
> pc.»*

La diagnosi è di chi l'ha segnalato, ed era giusta. *Il file c'era, e non era
raggiungibile.*

Adesso l'applicazione **apre il selettore di sistema** e chiede dove: Download,
Drive, la scheda SD, quello che vuoi. Il file finisce in una cartella vera,
sopravvive alla disinstallazione, e sai dov'è perché l'hai scelto tu. Se chiudi
il selettore senza scegliere, non viene scritto niente e l'applicazione lo
dice — *annullare non è né riuscire né fallire.*

Vale per tutte le esportazioni: PDF della scheda, PDF del piano, backup JSON,
UDDF, CSV, KML, byte grezzi del computer subacqueo.

Su iPhone non cambia niente: là la cartella dell'applicazione si vede già
nell'app File, sotto «Sul mio iPhone → MyDiveLog».

### La numerazione riparte da dove finisce il tuo logbook di carta

> *«Ho scaricato dal mio computer 148 immersioni e l'ultima mi compare
> immersione #148 ma in realtà sarebbe la #183.»*

In **Profilo → Dati per il LogBook** c'è una casella nuova: *«Immersioni fatte
prima di questo archivio»*. Ci si scrive quante ne contiene il logbook di
carta, e sotto compare subito il risultato — *«In archivio ci sono 148
immersioni: numerate dalla #36 alla #183»* — così non c'è da indovinare se
scrivere 35 o 36.

Il numero nuovo vale **ovunque**: elenco, scheda, PDF, libretto, CSV, UDDF. E
viaggia con la sincronizzazione, perché è un fatto su di te e non su un
dispositivo: il telefono e il computer numerano allo stesso modo.

Chi ha registrato tutto da sempre non deve toccare niente.

---

*Grazie a chi ha segnalato tutte e due le cose, e ha avuto la pazienza di
riprovare e di dirmi che la prima correzione non bastava. Una segnalazione che
arriva due volte vale più di dieci riletture: la seconda diceva esattamente
dove guardare.*

---

Ogni correzione ha una prova, e ogni prova è stata rimessa alla prova
rimettendo il difetto — **sei mutazioni, sei guardie rosse**. In tutto
**2 805 controlli automatici in 168 file**, più **135** sul motore di lettura
dei computer subacquei.

### Impronte SHA-256

| Pacchetto | SHA-256 | byte |
|---|---|---|
| `MyDiveLog-macOS-arm64.dmg` | `0b7341a2d60666262882afb298867ae72dc76da99a1739dbc4aa0b6ded33c19b` | 4.521.110 |
| `MyDiveLog-Windows-setup.exe` | `b4c6534c1f36b2a4a872ed2154d42b46bb004259e663ede2ecc8dd9818eab8ad` | 3.257.536 |
| `MyDiveLog-Windows-portatile.exe` | `9346417db466a856d15164f5e7b64d12774c8cfa8b9a05e948d12b57a6f4b951` | 7.507.456 |
| `MyDiveLog-Android-arm64.apk` | `f854306877d4fb0e395bf097964f87a690e64245c6c14edc3d02bb25a4008c36` | 11.112.006 |
| `MyDiveLog-Linux-amd64.deb` | `424d1423b581f518d7276a07a730b5a56758d3c648b6f2ac9bb49470ce013549` | 3.818.044 |

*Calcolate sui file allegati a questa release, non su una compilazione
precedente. Il `.deb` e l'`.apk` non li ha costruiti nessun Mac: vengono dal
workflow, e i loro due controlli hanno risposto giusto — «nessuna traccia
dell'aggiornatore nel binario» per Linux, l'APK firmato con la chiave del
proprietario per Android.*

> **► LA PARTE ANDROID NON È STATA PROVATA SU UN TELEFONO.** Qui non ce n'è
> uno, e sul Mac non c'è l'NDK. Quello che è stato misurato: la compilazione
> per Android sulla CI, e il fatto che dentro l'APK ci siano davvero le classi
> dei due plugin (`DialogPlugin`, `FsPlugin`, `saveFileDialog`,
> `getFileDescriptor`) e il comando nel binario nativo. *Il selettore che si
> apre davvero, no.* Se lo provi e qualcosa non va, scrivilo dal modulo di
> segnalazione dentro l'applicazione: è così che sono arrivate tutte e due le
> cose corrette qui.

> **Su Windows e Android il giro completo non l'ha provato nessuno.** Il codice
> del motore è lo stesso del Mac e dell'iPhone, con tutte le prove dietro, ma
> finestra, Bluetooth, archivio e stampa su quelle due piattaforme non sono mai
> stati percorsi a mano. Su Linux sì, meno il Bluetooth, che vuole un
> adattatore.
