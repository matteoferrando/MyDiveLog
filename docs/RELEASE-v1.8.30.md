## MyDiveLog 1.8.30 — i computer subacquei, uno per uno

Una notte su una domanda sola: *ogni computer che l’elenco promette si scarica
davvero?* Non si risponde provandoli tutti — qui ce n’è uno — ma leggendo, per
ciascuno, che cosa la libreria si aspetta da noi e che cosa noi le davamo.

### La libreria che legge i computer è aggiornata

libdivecomputer passa dalla 0.9.0 al suo ramo principale: ottantanove modifiche
in più di un anno. **Dieci modelli nuovi si collegano via Bluetooth** — Perdix 3,
Quad 2, Sirius L, Puck Pro EZ, Puck Pro Ultra, Raffaello, Seac Tablet, OSTC 3,
OSTC cR, OSTC Nano — e ci sono correzioni per computer che già si scaricavano:
l’**Halcyon** col protocollo Bluetooth 1.30 veniva rifiutato per la lunghezza di
una risposta, e i **Mares** potevano fermarsi su un puntatore di fine profilo
storto.

### Aqualung i330R

**La coda di una lettura vecchia.** Se uno scarico si era interrotto a metà, al
collegamento dopo il computer mandava il resto di quella lettura prima di
rispondere — un millisecondo dopo la prima domanda, cioè prima che la domanda
potesse arrivargli — e la libreria lo prendeva per la risposta e si fermava.
Adesso, prima del primo comando, si ascolta e si butta quello che non può essere
una risposta.

**Un codice che non vale più.** Se il computer è stato azzerato o accoppiato
con un altro telefono, risponde col codice d’errore 13 e mostra un PIN nuovo:
adesso l’applicazione lo chiede da sola e riparte, invece di fermarsi a ogni
tentativo.

**E la chiave conservata non si butta più per sbaglio.** La regola che la
dimenticava scattava solo per i guasti di prima dello scarico, quelli in cui la
chiave non era mai stata presentata. Adesso si butta quando il computer, per
due volte di fila, non l’ha accettata.

### Le immersioni si leggono col modello che il computer dichiara

Per molte marche il modello decide come si leggono i byte: la disposizione dei
campioni dei Mares, hwOS 3 o hwOS 4 negli OSTC, la memoria dei Pelagic.
Fino a oggi valeva il modello scelto dall’elenco; adesso vale quello che il
computer dichiara quando si collega, come in Subsurface. Se la scelta era
un’altra, il diario lo dice e **il nome sulle immersioni si corregge** — quando
il numero del modello porta a un nome solo.

### Il Mares giusto, e il Perdix 3 alla strada giusta

Per un Mares il modello scelto decide anche **come arrivano i pacchetti**, fissi
o variabili: proporre quello sbagliato non è un’etichetta storta, è uno scarico
che non parte. «Puck Pro U», il nome del Puck Pro Ultra, conteneva «Puck Pro», il
Puck della generazione prima. Adesso chi annuncia l’adattatore BlueLink sceglie
fra i Mares dell’adattatore, chi ha il Bluetooth dentro fra i suoi, e un nome
troncato trova il modello di cui è l’inizio.

Il **Perdix 3** è della famiglia del Peregrine ma parla un protocollo nuovo: va
alla libreria, che lo conosce, e non al lettore Shearwater scritto in casa.

### Il pianificatore

Col circuito chiuso **ogni gas tranne il diluente si può dichiarare «bailout»**:
il pianificatore sapeva già cosa farne, la pagina non lo lasciava scegliere.
Sotto il consumo della bombola di bailout compariva il nome del gas sbagliato.
Uno stato salvato incompleto — livelli vuoti, gas mancanti, tessuti troncati a
metà — non rompe più la pagina né sottostima il carico di una ripetitiva.

### E ancora

- **Il cursore dei gradient factor** era l’ultimo controllo sotto misura: ora è
  alto 36 col mouse e 44 col dito, con la pallina da 20 e da 28.
- **Su iPhone e sul Mac** i pezzi che il sistema disegna dentro l’app —
  Annulla, Fine, Copia, Incolla — parlano la lingua del telefono, e l’App Store
  elenca l’italiano.
- **La velocità verticale e la linea della decompressione** si disegnano giuste
  anche quando i campioni del file non sono in ordine di tempo.
- Un file di Shearwater Cloud troncato viene rifiutato con un messaggio,
  invece di produrre colonne vuote inventate.
- **Se il computer non conferma subito l’attivazione delle notifiche**, si
  riprova, come si riprova il collegamento: fino a oggi lo scarico finiva lì.
- **Il McLean Extreme**, che alla prima domanda risponde dopo qualche secondo,
  non si vede più rimandare la domanda mentre pensa.

---

Ogni correzione ha una prova, e ogni prova è stata rimessa alla prova rimettendo
il difetto: **2 972 controlli automatici in 193 file**, più **187** sul motore
nativo. Nessuno saltato.

**Hai uno dei modelli nuovi?** Collegalo e raccontaci com’è andata dalla
pagina delle segnalazioni del sito: da lì il modello entra nell’elenco dei
provati, e l’applicazione lo scrive sotto il suo nome.

### Impronte SHA-256

Calcolate sui file allegati a questa release, non su una compilazione
precedente: due compilazioni non danno lo stesso byte.

| Pacchetto | SHA-256 | byte |
|---|---|---|
| `MyDiveLog-macOS-arm64.dmg` | `8318f169460d2bcef6d6e9dab1ebf8b0ab34d3216f5fd8aef8faf8fbb01722a7` | 4.540.909 |
| `MyDiveLog-Windows-setup.exe` | `04b0180090bba9c20ea2d588e3d26e78cbf2f741cd10fe223b63b5d51a380b3a` | 3.269.848 |
| `MyDiveLog-Windows-portatile.exe` | `283329917dadef66d53bb4f9476da5d68e7f09ed650c56ec9b89452fa1018274` | 7.537.664 |
| `MyDiveLog-Android-arm64.apk` | `bcbf5fce8bffab01d0d063f644eafdaff9b2d0172cfa870233fcb2bd597b9526` | 11.148.038 |
| `MyDiveLog-Linux-amd64.deb` | `5dbf5c297da8f7f01c97f5d543ff7b6248b87e9157924daf3a5e4d6e43e1053c` | 3.833.928 |
