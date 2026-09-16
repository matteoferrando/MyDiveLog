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

### 5 — P1: il backup Android sparisce disinstallando l'app

`document_dir()` su Android è `getExternalFilesDir(DIRECTORY_DOCUMENTS)`, cioè
una cartella **dell'applicazione**: disinstallando, i file se ne vanno con lei.

*Questa è la coda del difetto chiuso stamattina.* La correzione della 1.8.24 ha
smesso di mentire e scrive il file davvero — ma lo scrive lì. Per un PDF è un
fastidio; **per un backup è la negazione del backup**: una copia che muore con
l'applicazione non è una copia. Serve il selettore di sistema (Storage Access
Framework) o la condivisione, e la conferma che il file resti dov'è.

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
