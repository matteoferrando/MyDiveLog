## MyDiveLog 1.8.27 — il primo computer vero, e il secondo che si è fermato

Il 17 settembre 2026, nello stesso messaggio, due notizie.

### Un Mares Quad Ci ha scaricato davvero

*«Su Mares Quad Ci funziona adesso.»*

È il **primo computer subacqueo di terzi** che consegna immersioni attraverso
libdivecomputer in questa applicazione. Fino a ieri, sotto ogni modello di
quella strada, il selettore scriveva *«mai provato su questo modello»* — ed era
la verità, scritta apposta perché lo era.

Adesso sotto il Quad Ci c'è scritto **«provato su questo modello»**, e sotto
tutti gli altri no. L'etichetta si toglie **un modello per volta**, quando
qualcuno lo accende e racconta com'è andata: un modello provato non è una
famiglia provata, e la seconda metà dello stesso messaggio lo dimostra.

### Un Aqualung i330R si fermava a metà, e il difetto era nostro

Quaranta immersioni arrivate, poi «errore di protocollo». Nel diario:

```
libdivecomputer, errore: Invalid packet length (96).
```

Il computer manda pacchetti che dichiarano la propria lunghezza. Uno di quelli —
101 byte in tutto — era stato spezzato in due dalla radio, e l'applicazione ne
consegnava solo il primo pezzo: leggeva una notifica per volta e non aveva modo
di sapere che il pacchetto continuava.

**Adesso la lunghezza si legge dal pacchetto** invece di indovinarla dalla
dimensione delle notifiche. Vale per Aqualung i330R, i330R Console e Apeks DSX,
che parlano tutti lo stesso inquadramento.

Nello stesso giro: due pacchetti arrivati attaccati non vengono più incollati
insieme — era il difetto peggiore dei due, perché non dava nessun errore e si
vedeva solo molto dopo, come dati che non si tengono insieme.

### E una chiave che veniva buttata per niente

Quando uno scarico fallisce, il codice di accoppiamento conservato si dimentica:
se quella chiave non valesse più, terrebbe quel computer bloccato per sempre.

Ma nel diario del 17 settembre il secondo tentativo non era nemmeno arrivato a
collegarsi — tre volte «tempo scaduto» sulla radio — e la chiave, che si usa
*dopo* il collegamento, è stata buttata lo stesso. Sei cifre da ridigitare in
cambio di niente.

Adesso, quando il collegamento non si apre, la chiave resta dov'è.

---

*Grazie a chi ha scaricato, ha letto il diario e l'ha mandato. Da qui i computer
degli altri non si vedono: si vedono solo quando qualcuno li accende e racconta
cosa è successo.*

Ogni correzione ha una prova, e ogni prova è stata rimessa alla prova rimettendo
il difetto: **sette mutazioni, sette guardie rosse**. In tutto **2 839 controlli
automatici in 173 file**, più **149** sul motore nativo.

### Impronte SHA-256

| Pacchetto | SHA-256 | byte |
|---|---|---|
| `MyDiveLog-macOS-arm64.dmg` | `cd834d784890651d31ec510ac9361ce177fc06c58a8fa3e5bcbb58ef7661fddc` | 4.531.589 |
| `MyDiveLog-Windows-setup.exe` | `ed4f42409244bbc4bbc0486065abf81d765e5bc637f66ba555806ec9943d4272` | 3.264.192 |
| `MyDiveLog-Windows-portatile.exe` | `a5b0068a011cf639bcc24a1bd608fdab2b0bf87be6c7ee8b5245498e9f10a2dc` | 7.523.840 |
| `MyDiveLog-Android-arm64.apk` | `4184045ff776b9de02e380c66d18d9bc71b8be611cc8db311fbc2efdcea97e9d` | 11.133.302 |
| `MyDiveLog-Linux-amd64.deb` | `58d484188aaecc41bc2f4d120d3ed525018b70880f65e959b9ebda8d7402c60f` | 3.827.242 |

*Calcolate sui file allegati a questa release, non su una compilazione
precedente.*

> **Quello che non è stato provato su un apparecchio.** La correzione dell'i330R
> è verde sulle prove, che riproducono il pacchetto spezzato con i numeri esatti
> del diario — 96 byte di carico, 101 in tutto — ma **qui un i330R non c'è**. La
> conferma vera è il prossimo messaggio di chi l'ha segnalato.
>
> Lo stesso vale, come sempre, per il giro completo su Windows e Android:
> finestra, Bluetooth, archivio e stampa su quelle due piattaforme non sono mai
> stati percorsi a mano. Su Linux sì, meno il Bluetooth.
