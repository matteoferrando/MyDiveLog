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
