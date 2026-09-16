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
