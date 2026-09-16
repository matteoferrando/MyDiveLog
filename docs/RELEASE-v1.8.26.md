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
