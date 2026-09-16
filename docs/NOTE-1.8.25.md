# 1.8.25 — quello che è cambiato, e perché

*16 settembre 2026, pomeriggio. Due segnalazioni dalla stessa persona, a un
giorno di distanza, dallo stesso Samsung. La seconda dice una cosa che nessuna
prova di questo progetto poteva dire.*

---

## 1. Android: il file c'era e non era raggiungibile

### Cosa succedeva

Il 15 settembre: *«premendo "Esporta PDF" compare "PDF salvato dove il sistema
mette i download", ma il file non compare né in Download né in Recenti né
cercando tutti i PDF.»* — chiuso in giornata: dentro una WebView il click su
`<a download>` non scarica niente e non lancia niente, e il ramo nativo esisteva
**solo per iOS**.

Il 16, con la versione nuova in mano:

> *«Purtroppo il pdf non si genera ancora anche se è cambiato il messaggio.
> Forse perché si genera in una cartella che non risulta visibile se non da
> pc.»*

La seconda frase è la diagnosi, e l'ha scritta chi non ha mai visto questo
codice. `document_dir()` su Android vale
`getExternalFilesDir(DIRECTORY_DOCUMENTS)`, cioè
`/storage/emulated/0/Android/data/<pacchetto>/files/Documents`:

- da **Android 11** nessun gestore di file può entrare in `Android/data`: la
  vede solo un PC collegato via USB — che è esattamente quello che lui aveva
  capito da solo;
- la **disinstallazione** la porta via con tutto il contenuto.

*La correzione della mattina aveva smesso di mentire senza ancora consegnare
niente.* Per un PDF è un fastidio; per un backup è la negazione del backup.

### Cosa fa adesso

`esporta_nei_documenti` su Android apre il **selettore di sistema**
(`ACTION_CREATE_DOCUMENT`, lo Storage Access Framework), che è l'unico modo con
cui un'applicazione senza permessi speciali scrive in una cartella dell'utente.
Quello che torna è un `content://…`: il descrittore per scriverci lo si chiede
ad Android tramite `tauri_plugin_fs`.

Tre esiti e non più due, perché il selettore ne crea uno che prima non poteva
esistere:

| esito | cosa vede chi ha premuto |
|---|---|
| scritto | «PDF salvato dove l'hai scelto tu.» |
| **annullato** | «Non hai scelto dove salvare: non è stato scritto niente.» |
| guasto | «Il PDF non è stato salvato: … Controlla lo spazio libero e riprova.» |

*Annullare non è né riuscire né fallire.* Ridurlo al primo sarebbe la bugia che
`ui/esporta.ts` esiste per impedire; ridurlo al terzo manderebbe a cercare un
guasto che non c'è, che è un modo più lento di mentire. Da cui
`EsportazioneAnnullata`, e una guardia che legge i sorgenti e pretende che ogni
file che chiama `esporta` sappia riconoscerla.

**Quello che NON si fa**: ripiegare sulla cartella privata quando l'utente
annulla. Sarebbe scrivere dove non guarda dopo che ha detto di no — il difetto
di partenza rimesso in piedi con un'altra scusa. Una prova lo misura.

### Dipendenze

`tauri-plugin-dialog` e `tauri-plugin-fs`, **solo** per `target_os = "android"`
e usate solo dal lato Rust: nessuna capacità in `capabilities/` le espone alla
WebView. Sul desktop `dialog` si porterebbe dietro `rfd`, e `fs` raggiungibile
dalla pagina sarebbe un accesso al filesystem aperto. Una prova legge
`Cargo.toml` e pretende che restino dichiarate lì.

### Quello che ancora non è misurato

Qui non c'è un telefono Android, e sul Mac non c'è l'NDK: `cargo check` per quel
bersaglio non parte. Questa correzione è verde sulle prove e sulla compilazione
della CI — che è l'unico posto che compila davvero per Android, ed è quello che
ieri ha preso `esporta_nei_documenti` registrata ma non compilata. **Su un
apparecchio vero non l'ha provata nessuno.**

*Le due segnalazioni di ieri e di oggi dicono che è esattamente la condizione in
cui un difetto sopravvive alla sua correzione.*

---

## 2. La numerazione che riparte dalla carta

> *«Dovresti inserire la possibilità di cambiare la numerazione delle
> immersioni. Ad esempio io ho scaricato dal mio computer 148 immersioni e
> l'ultima mi compare immersione #148 ma in realtà sarebbe la #183.»*

### Il motore lo sapeva già fare

`numeriProgressivi(dives, precedenti = 0)` ha quel parametro dal giorno in cui è
nata, con la sua prova: *«chi ha un logbook di carta alle spalle parte da dove è
arrivato»*. Quello che mancava era **il filo**: nessuna casella, e nessuno che
passasse il valore.

*Una funzione giusta che nessuno può chiamare non è una funzione: è una funzione
in attesa.* È la stessa specie di difetto del gestore che registra un comando
non compilato — visto dall'altro capo.

### Dove sta il dato

`Subacqueo.immersioniPrecedenti`, cioè **dentro `subacqueo`**, che è una
impostazione condivisa. Non è una questione di ordine: se stesse fra le
impostazioni locali, la stessa immersione avrebbe due numeri diversi sul
telefono e sul computer della stessa persona — cioè il difetto che
`core/numerazione.ts` esiste per impedire, ricreato da un'altra parte.

### Dove entra

In `ui/state.tsx`, nel `useMemo` che costruisce la mappa dei numeri una volta
per tutta l'applicazione. Nessuna pagina sa che esiste uno scarto, ed è la
ragione per cui non se lo può dimenticare nessuna: elenco, scheda, PDF,
libretto, CSV e UDDF leggono tutti quella mappa.

### La casella, e la riga sotto

`Profilo → Dati per il LogBook`. La riga sotto la casella non è decorazione:
«quante immersioni prima?» è ambiguo di suo — si scrive 35 o 36? — e invece di
spiegarlo, la casella **mostra il risultato**: *«In archivio ci sono 148
immersioni: numerate dalla #36 alla #183»*. Chi guarda smette di ragionare e
confronta col proprio libretto.

`scartoDiNumerazione` ripulisce quello che arriva — casella vuota, meno
scappato, decimale incollato, cifra tenuta premuta — e sta **dentro**
`numeriProgressivi`, non al punto di immissione: i punti di immissione si
moltiplicano, quella funzione è una sola.

---

## Le guardie, e la loro prova

Sei mutazioni, tutte e sei rosse:

| mutazione | prova che si accende |
|---|---|
| lo scarto non arriva più a `numeriProgressivi` | `numerazioneDaCarta` |
| lo scarto non è fra le dipendenze del `useMemo` | `numerazioneDaCarta` |
| `scartoDiNumerazione` non viene applicata | `numerazione` |
| Android torna a scrivere nella cartella privata | `esportareDaiTelefoni` |
| un chiamante smette di distinguere annullata da guasto | `esportareDaiTelefoni` |
| il selettore finisce fra le dipendenze di tutte le piattaforme | `esportareDaiTelefoni` |

*Una guardia che non si è mai vista rossa non è una guardia.*

La terza prova di `numerazioneDaCarta` merita una riga a parte: monta il
provider vero, cambia l'impostazione e guarda **il numero**, non il fatto che il
salvataggio sia riuscito. È la lezione della prova sul cestino di stamattina —
una guardia che chiede «si è lamentata?» resta verde su un difetto che si lamenta
e cancella lo stesso.

Catena: **2 805 controlli in 168 file**, **135** sul motore Rust.
