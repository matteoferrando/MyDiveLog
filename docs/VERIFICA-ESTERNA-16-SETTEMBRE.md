# La verifica esterna del 16 settembre — cosa è chiuso e cosa no

Una revisione indipendente ha letto il progetto alla **1.8.24** (commit
`13a5947`) e ha riprodotto **nove problemi**, otto con prove locali e uno dal
codice nativo. Ha confrontato 332 file sorgente a fine lavoro senza trovare
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

## Aperti, in ordine di quanto pesano

### 1 — P1: la transazione SQLite non è atomica

`src/storage/sqlite.ts:207–216`. `putDives()` manda `BEGIN`, gli inserimenti e
`COMMIT`/`ROLLBACK` come chiamate separate; il plugin le esegue su un **pool**
SQLx, che non le lega alla stessa connessione. La verifica l'ha riprodotto con
lo stesso `Pool<Sqlite>` e SQLx 0.8.6: `BEGIN` → inserimento → `ROLLBACK`
rispondono tutti successo, e la riga resta.

*«Tutte o nessuna» è scritto e non è vero.* Serve una transazione vera in Rust
che possieda una connessione per tutta l'operazione, esposta come **un solo
comando** al frontend. È l'intervento più grosso dei nove e va provato con un
guasto simulato fra riepilogo e campioni.

### 2 — P1: la sincronizzazione può accorciare un profilo già salvato

`src/sync/plan.ts:88–92`, `src/sync/turso.ts:1130–1148`. Il piano confronta
prima il profilo principale e guarda l'alternativo solo negli `else if`; il
trasferimento scrive entrambi nella stessa direzione. Misurato: remoto con
10 principali e **100 alternativi**, locale con 20 e 5 → dopo la
sincronizzazione l'alternativo remoto scende a **5**.

Serve una decisione per ciascun profilo, separata, con la garanzia che nessuno
dei due venga degradato.

### 7 — P2: il profilo alternativo da solo non scende

`src/sync/turso.ts:951–958`. Quando il riepilogo è già allineato il ciclo legge
il principale e fa `continue` se è vuoto: non arriva mai all'alternativo, anche
se il piano ha chiesto proprio quello. Misurato: 100 campioni alternativi sul
remoto, zero in locale dopo la sincronizzazione.

### 9 — P2: la catena dei tessuti manca subito dopo l'importazione

`src/ui/state.tsx:738–741`, `778–779`. L'import da file e quello via Bluetooth
salvano e aggiornano l'elenco senza il ricalcolo che l'avvio fa. Misurato
nell'interfaccia: subito dopo l'import le statistiche dicono «30/30 immersioni
con profilo» e il GF99 dice «serve un profilo campionato»; dopo un ricaricamento,
senza dati nuovi, compare **84% su 30 immersioni**.

*Il numero non è sbagliato: è assente, e il messaggio ne dà la colpa alla cosa
sbagliata.*

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
