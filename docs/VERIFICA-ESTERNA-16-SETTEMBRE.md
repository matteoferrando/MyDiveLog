# La verifica esterna del 16 settembre — tutti e nove chiusi

Una revisione indipendente ha letto il progetto alla **1.8.24** (commit
`13a5947`) e ha riprodotto **nove problemi**, otto con prove locali e uno dal
codice nativo. **Sono chiusi tutti e nove**, nello stesso giorno: quattro la
mattina, uno il pomeriggio insieme a una segnalazione dal campo, quattro la
sera. Ha confrontato 332 file sorgente a fine lavoro senza trovare
differenze: non ha toccato niente.

*Le sue prove sono buone. Due di loro mi hanno preso in fallo su cose che
credevo di aver già chiuso.*

## Chiusi — commit `f4169f7`

| | Difetto | Cosa succedeva |
|---|---|---|
| 3 | **Il cestino perdeva il profilo** | `.catch(() => [])` su ogni lettura: un errore transitorio diventava «non ha profilo», il cestino riceveva la scheda nuda e la cancellazione andava avanti. |
| 8 | **Dopo il ripristino lo schermo diceva altro dal disco** | Due elenchi di rilettura, tre voci e sette; `subacqueo` in nessuno dei due. Il libretto usciva col nome di prima. |
| 6 | **Un archivio non apribile faceva partire l'app su un altro archivio** | `getStore()` ripiegava su IndexedDB su *qualunque* errore, compreso il rifiuto di aprire uno schema più recente. |
| 4 | **Accesso rotto su Windows e Android** | `http://tauri.localhost` non era fra le origini ammesse: 403 al preflight su due piattaforme su quattro. |

Ognuno con la sua prova, e ognuna **mutata**.

> ► **E UNA LEZIONE, CHE VALE PIÙ DELLE QUATTRO CORREZIONI.** La prima stesura
> della prova sul cestino chiedeva `rejects.toThrow`: cioè che la funzione *si
> lamentasse*. È rimasta **verde con il difetto rimesso**, perché lamentarsi e
> non cancellare sono due cose diverse — la versione col difetto poteva
> cancellare **e poi** lamentarsi lo stesso. Riscritta sui fatti osservabili —
> `deleteDive` non chiamato, cestino non scritto — diventa rossa.
>
> *Una guardia che non si è mai vista rossa non è una guardia. Questa si era
> vista verde su un difetto messo lì apposta, ed è peggio.*

## Chiuso nel pomeriggio, e non da qui — il 5

### 5 — P1: su Android il file finiva dove nessuno poteva vederlo

`document_dir()` su Android è `getExternalFilesDir(DIRECTORY_DOCUMENTS)`, cioè
`/storage/emulated/0/Android/data/<pacchetto>/files/Documents`: una cartella
**dell'applicazione**. Da Android 11 nessun gestore di file può entrare in
`Android/data` — la vede solo un PC collegato via USB — e alla disinstallazione
se ne va con l'applicazione. Per un PDF è un fastidio; **per un backup è la
negazione del backup**: una copia che muore con l'applicazione non è una copia.

► **LA CONFERMA NON È ARRIVATA DALLA VERIFICA, È ARRIVATA DA CHI USA IL
PROGRAMMA.** Poche ore dopo, dallo stesso Samsung della segnalazione del 15:

> *«Purtroppo il pdf non si genera ancora anche se è cambiato il messaggio.
> Forse perché si genera in una cartella che non risulta visibile se non da
> pc.»*

La seconda frase è la diagnosi esatta, e l'ha scritta una persona che non ha
mai visto questo codice. La correzione della mattina aveva smesso di mentire
senza ancora consegnare niente: *il file c'era, e non era raggiungibile.*

**Cosa fa adesso.** Il motore apre il selettore di sistema
(`ACTION_CREATE_DOCUMENT`, lo Storage Access Framework): chi esporta sceglie
Download, Drive, la scheda SD. Il file finisce in una cartella vera, sopravvive
alla disinstallazione, e — non ultimo — chi ha premuto sa dov'è, perché l'ha
scelto lui. E se chiude il selettore senza scegliere, non si scrive niente e lo
si dice: `EsportazioneAnnullata` è un terzo esito, non un successo e non un
guasto.

Due dipendenze nuove, `tauri-plugin-dialog` e `tauri-plugin-fs`, **solo per
Android** e usate solo dal lato Rust: nessuna capacità le espone alla WebView.

> **► QUELLO CHE ANCORA NON È MISURATO.** Qui non c'è un telefono Android, e la
> catena di compilazione locale non ha l'NDK: questa correzione è verde sulle
> prove e sulla compilazione della CI, non su un apparecchio. *Le due
> segnalazioni di ieri e di oggi dicono che è esattamente la condizione in cui
> un difetto sopravvive a una correzione.* La chiusura vera è il messaggio di
> chi l'ha segnalato.

## Chiusi la sera, nella 1.8.26 — gli ultimi quattro

*Commit `__COMMIT__`. Ognuno con la sua prova, e ognuna **mutata**: dieci
mutazioni, dieci guardie rosse — e un'undicesima che è rimasta verde e ha fatto
correggere la prova invece del codice.*

### 1 — P1: la transazione SQLite non era una transazione

`putDives()` mandava `BEGIN`, gli inserimenti e `COMMIT` come chiamate separate,
e `tauri-plugin-sql` non tiene una connessione: tiene un **pool** SQLx. `BEGIN`
apriva una transazione su una connessione che tornava subito nel pool — dove
SQLx annulla da sé le transazioni rimaste aperte — gli inserimenti arrivavano
altrove in auto-commit, e `COMMIT` non trovava niente da chiudere. Tre risposte
«Ok» e la riga resta.

**Cosa fa adesso.** Un comando Rust nuovo — `src-tauri/src/archivio.rs`,
`tutte_o_nessuna` — riceve l'elenco delle istruzioni e le esegue dentro una
transazione che possiede la sua connessione dall'inizio alla fine. L'SQL resta
in TypeScript: di là non si sa niente di immersioni. Registrato su **tutte e
cinque** le piattaforme, perché l'archivio SQLite c'è su tutte.

Vale anche per `deleteDive` e `clear`, che avevano lo stesso difetto e che
nessuno aveva guardato **perché non nominavano nessuna transazione**.

> ► **UNA PROVA CHE MISURA IL DIFETTO.**
> `begin_e_rollback_sul_pool_non_annullano_niente` esegue la sequenza vecchia su
> un archivio vero e pretende che la riga resti. Se un giorno diventasse rossa
> vorrebbe dire che SQLx è cambiato e che quel modulo si può togliere; finché è
> verde, toglierlo rimette il difetto.

> ► **E UNA GUARDIA CHE MI HA PRESO IN FALLO.** Avevo aggiunto un
> `PRAGMA foreign_keys = ON` con accanto un commento su perché fosse
> indispensabile. Togliendolo, la prova che doveva difenderlo **è rimasta
> verde**: le chiavi esterne le accende SQLx da sé su ogni connessione. La riga
> è stata tolta e la prova riscritta perché misuri la **proprietà** — un profilo
> senza la sua immersione viene respinto — invece della riga. Stesso trattamento
> alla riga gemella in `sqlite.ts`, che accendeva i vincoli su una connessione a
> caso. *Una guardia che non si è mai vista rossa non è una guardia.*

### 2 — P1: la sincronizzazione accorciava un profilo salvato

Sopra il secondo profilo c'era scritto *«viaggia con il principale, non per
conto suo»*. Era vero, ed era il difetto: piano e trasporto avevano **una lista
sola** per i profili, quindi una direzione sola — e i due profili possono averne
due diverse. Con remoto a 10 principali e 100 alternativi e locale a 20 e 5,
l'alternativo remoto scendeva **da 100 a 5**.

Adesso il piano ha quattro liste (`pushSamples`, `pullSamples`,
`pushAltSamples`, `pullAltSamples`) e due decisioni prese da due `if` separati,
non da una catena di `else if` in cui la seconda non partiva mai.

### 7 — P2: il profilo alternativo da solo non scendeva

Il ciclo che scarica i profili su immersioni già allineate leggeva il principale
e faceva `continue` se era vuoto: **non arrivava mai alla riga del secondo**. Il
ramo di *carico* questa lezione l'aveva già imparata; quello di *scarico* no —
*una lezione imparata dentro un percorso protegge quel percorso.*

### 9 — P2: la catena dei tessuti non si ripassava dopo l'import

Le tre righe che la ricalcolano c'erano in **tre posti su cinque** — l'avvio,
l'inserimento a mano, il ripristino da backup — e mancavano nelle **due strade
dell'import**, cioè dove le immersioni arrivano a decine. Subito dopo
un'importazione il GF99 diceva «serve un profilo campionato» accanto a un
profilo che c'era; dopo un ricaricamento, senza dati nuovi, compariva 84%.

Adesso la regola è una funzione sola — `ripassaLaCatena` — chiamata da tutti e
cinque i posti. *Cinque copie sono quattro occasioni di dimenticarsene.*

## Il resto della verifica

Ci sono anche indicazioni che non sono difetti e che vale la pena tenere:
matrice hardware pubblica e verificabile per ogni computer provato; validazione
indipendente dei modelli decompressivi (VPM-B è dichiarato non validato, e il
numero di prove non sostituisce un confronto); protezione delle credenziali su
Windows, Android e Linux, dove oggi si ricade su archivio in chiaro mentre su
Apple c'è il portachiavi; revoca delle sessioni, che durano trenta giorni senza
modo di revocarne una; prestazioni su archivi di migliaia di immersioni, mai
misurate.

E una che riguarda questi documenti: **una pagina di stato corrente e uno
storico separato**. Il README dichiara libdivecomputer disattivata mentre
`Cargo.toml` la abilita per default — *un documento che afferma un fatto va
rimisurato come il fatto*.
