# 1.8.26 — gli ultimi quattro della verifica esterna

*16 settembre 2026, sera. Chiude i difetti **1, 2, 7 e 9** di
`docs/VERIFICA-ESTERNA-16-SETTEMBRE.md`, che a questo punto è tutto chiuso.*

---

## 1 — La transazione che non era una transazione

`storage/sqlite.ts` mandava `BEGIN`, gli inserimenti e `COMMIT` come chiamate
separate. `tauri-plugin-sql` non tiene una connessione: tiene un **pool** SQLx.
`BEGIN` apriva una transazione su una connessione che tornava subito nel pool —
dove SQLx annulla da sé le transazioni rimaste aperte — gli inserimenti
arrivavano altrove in auto-commit, e `COMMIT` non trovava niente da chiudere.

Riprodotto dalla verifica con SQLx 0.8.6, la stessa di `Cargo.lock`:

```text
BEGIN    Ok(SqliteQueryResult { changes: 0 })
INSERT   Ok(SqliteQueryResult { changes: 1 })
ROLLBACK Ok(SqliteQueryResult { changes: 0 })
Righe dopo il rollback: 1
```

### Perché la cura sta in Rust

Dal lato TypeScript una transazione vera **non si può scrivere**: il plugin
espone `execute` e `select`, e nessuno dei due permette di dire «queste
istruzioni sulla stessa connessione». La connessione la si può tenere solo
dall'altra parte.

`src-tauri/src/archivio.rs` prende il `Pool<Sqlite>` che il plugin tiene nel suo
stato (`DbInstances`), apre una transazione e ci esegue dentro l'elenco di
istruzioni che riceve. **L'SQL resta in TypeScript**: di là non si sa niente di
immersioni, di profili e di tabelle. Il modulo sa una cosa sola — o tutte o
nessuna — e per questo serve anche a `deleteDive` e a `clear`.

Dipendenza nuova: `sqlx 0.8`, **la stessa versione del plugin**, perché due
copie di SQLx nel grafo darebbero due tipi `Pool<Sqlite>` diversi e il pool
preso dal plugin non entrerebbe nella nostra funzione.

Registrato su tutte e cinque le piattaforme, con la sua prova in
`gestoriPerPiattaforma`.

### Il cuore è separato dal comando perché si prova

Un `#[tauri::command]` vuole un `AppHandle`, e un `AppHandle` vuole
un'applicazione avviata: una prova che ne avesse bisogno non girerebbe in
`cargo test`. `in_transazione(pool, passi)` prende il pool e basta, quindi le
prove gli danno un archivio vero in un file temporaneo.

Cinque prove Rust, e una di loro **misura il difetto**:
`begin_e_rollback_sul_pool_non_annullano_niente` esegue la sequenza vecchia e
pretende che la riga resti. Se diventasse verde vorrebbe dire che SQLx è
cambiato e che il modulo si può togliere.

### La guardia che mi ha preso in fallo

Avevo scritto, prima della transazione, un `PRAGMA foreign_keys = ON`, con
accanto un commento che spiegava perché fosse indispensabile e perché dovesse
stare **prima** (il pragma vale per connessione, e dentro una transazione SQLite
lo ignora). Ragionamento giusto, conclusione sbagliata: **SQLx accende le chiavi
esterne da sé su ogni connessione che apre.**

Si è visto mutando: tolto il pragma, la prova che doveva difenderlo è rimasta
**verde**. *Una guardia che non si è mai vista rossa non è una guardia.*

La riga è stata tolta — non sostituita — e la prova riscritta perché misuri la
**proprietà**: un profilo senza il suo riepilogo viene respinto. Stesso
trattamento alla riga gemella in `sqlite.ts`, che accendeva i vincoli su una
connessione a caso del pool: era lo stesso difetto del `BEGIN`, nello stesso
file, mai notato perché non produceva niente di visibile.

---

## 2 e 7 — I due profili, e la direzione che avevano in comune

Sopra il secondo profilo, in `turso.ts`, c'era scritto: *«viaggia con il
principale, non per conto suo»*. Era vero, ed era il difetto.

`SyncPlan` aveva **una lista sola** per i profili, quindi una direzione sola. In
`planSync` le due decisioni erano una catena di `else if`: bastava che il
profilo principale fosse diverso perché quella sul secondo **non venisse mai
presa** — e il commento accanto diceva «con lo stesso criterio».

Misurato: remoto con 10 campioni principali e **100 alternativi**, locale con 20
e 5. Il piano diceva «sali» per via del principale, e salendo l'alternativo
remoto **scendeva da 100 a 5**.

**Adesso**: quattro liste (`pushSamples`, `pullSamples`, `pushAltSamples`,
`pullAltSamples`), due decisioni prese da due `if` separati, e un trasporto che
carica e scarica solo quello che è stato deciso.

Il **7** è la coda dello stesso nodo, nel ramo di scarico: il ciclo dei profili
su immersioni già allineate leggeva il principale e faceva `continue` se era
vuoto, quindi non arrivava mai al secondo. Il ramo di *carico* la stessa lezione
l'aveva già imparata, con tanto di commento lungo. *Una lezione imparata dentro
un percorso protegge quel percorso.*

### La prova che conta il traffico invece dei campioni

Lo scarico viene prima del carico: quando il piano chiede di far scendere il
secondo profilo, al momento di salire l'archivio locale ha già quello ricco e
rimandarlo su non perde niente. Il difetto quindi **non si vede più contando i
campioni** — la mutazione sul ramo di carico restava verde.

Si vede contando le scritture: una scrittura in rete per immersione, a ogni
sincronizzazione, su un database remoto a pagamento. *Quello che non è stato
deciso non si tocca* vale anche quando toccarlo non farebbe danno: è la regola
che rende il difetto impossibile, non la fortuna dell'ordine in cui girano i due
rami.

---

## 9 — La catena dei tessuti, e le cinque copie

Il carico residuo di azoto, il GF99 e l'intervallo di superficie nascono dalla
**catena**, che va da un'immersione all'altra in ordine di tempo. Ripassarla è
`repairArchive`, e quelle tre righe stavano in **tre posti su cinque**: l'avvio,
`createDive`, `restoreBackup`. Mancavano in `importFiles` e in `importDives`.

Misurato nell'interfaccia: dopo l'import, «serve un profilo campionato» accanto
a un profilo che c'era; dopo un ricaricamento, senza dati nuovi, **84% su 30
immersioni**.

Adesso è una funzione sola, `ripassaLaCatena`, chiamata da tutti e cinque i
posti. *Due copie della stessa regola sono una regola e la sua versione vecchia;
cinque sono quattro occasioni di dimenticarsene.*

La prova monta il provider vero e guarda **il numero**: la seconda immersione
della giornata deve cambiare quando arriva quella del mattino, perché prima era
stata calcolata coi tessuti puliti — cioè più tranquilla del vero. Accanto, una
guardia grossolana che legge il sorgente e pretende che tutte e due le strade
d'ingresso nominino `ripassaLaCatena`: non sa se la chiamata è nel punto giusto,
ma prende l'unico errore che si fa davvero — scriverne una terza e
dimenticarsene.

---

## Le mutazioni

| mutazione | prova che si accende |
|---|---|
| `putDives` torna a mandare `BEGIN` al plugin | `tutteONessuna` |
| i profili finiscono prima del riepilogo | `tutteONessuna` |
| il comando sparisce dal gestore di Windows e Linux | `gestoriPerPiattaforma` |
| la transazione diventa un giro di `execute` sul pool | `archivio::prove` (Rust) |
| via il `PRAGMA` delle chiavi esterne | **verde** → prova riscritta |
| la decisione sul secondo profilo torna in coda alla catena | `sync` |
| salendo, il secondo profilo riparte col principale | `sync` (conta le scritture) |
| scendendo, il secondo torna dentro l'`if` del principale | `sync` |
| il ciclo dei profili mancanti salta se il principale è vuoto | `sync` |
| l'import dal Bluetooth non ripassa la catena | `catenaDopoLImport` |
| l'import da file non ripassa la catena | `catenaDopoLImport` |

Catena: **2 829 prove in 170 file**, **140** Rust, tipi/lint/formato a zero.
