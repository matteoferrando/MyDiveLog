## MyDiveLog 1.8.24 — diciotto numeri che mentivano

Questa versione non aggiunge niente. Chiude **diciotto difetti** — sedici
trovati in due giorni di riletture avversariali, uno saltato fuori rigenerando
il sito, e uno segnalato da chi usa l'applicazione. Hanno tutti la stessa
forma: *un dato plausibile e falso*. Non errori che si vedono, non schermate
vuote, non messaggi rossi — numeri giusti nella loro casella e sbagliati
rispetto alla realtà, o alla casella accanto.

Sono elencati per quello che cambiano a chi si immerge, non per dove stanno nel
codice.

### I numeri che decidono

**Il consumo usciva gonfiato del 53% quando un file dichiarava una pressione di
superficie impossibile.** Quattro lettori possono scrivere uno zero in quel
campo. Con lo zero, su 20 m × 40 min, il consumo misurato passava da 12.3 a
18.8 L/min — e nessuna avvertenza scattava, perché il numero era finito, solo
sbagliato. Quel valore finisce nel pianificatore e decide quanti bar servono.
Sulla stessa immersione i sedici compartimenti uscivano **tutti oltre il valore
M**, il primo al 248%: un grafico rosso su un'uscita tranquilla a venti metri.

**La bombola di decompressione poteva diventare ossigeno puro.** Quando
libdivecomputer rifiuta una miscela a metà elenco, tutte quelle dopo scalavano
di uno: il campione che dice «respiro la miscela 2» trovava la 3. Misurato su
tre gas, la PPO2 di picco passava da 1.06 a **1.62**.

**Il CNS decideva su un numero e ne mostrava un altro.** A schermo «80%» senza
nessun avviso (il valore pieno era 79.9), e «100%» classificato come semplice
prudenza (99.9). Adesso la soglia guarda il numero che si legge, e al bordo
sceglie la severità.

**La profondità massima operativa del gas analizzato ignorava acqua e quota.**
In un lago a 2000 metri diceva 29.6 m dove sono 33.3 — l'unico numero di quella
schermata che non teneva conto di dove sei.

### I disegni

**Il profilo stampato sul libretto poteva essere falso.** Con i campioni
consegnati fuori ordine — un orologio che salta indietro, un lettore che
consegna i blocchi nell'ordine del documento — quindici punti su trentuno
finivano fuori dal riquadro, e quello che restava dentro era un disegno
credibile e sbagliato. Su un foglio che qualcuno controfirma. Stessa cosa per il
profilo a schermo, per gli otto grafici sotto di lui e per la descrizione che
uno screen reader legge al posto del grafico.

### Le date e i numeri progressivi

**Il 31 febbraio entrava come data certa.** Il controllo guardava il giorno
senza guardare il mese, e l'aritmetica del calendario non ha casi speciali: il
31 febbraio diventa il 3 marzo. La data entrava spostata fino a tre giorni e
dichiarata sicura, e da lì comanda l'ordine del logbook, il raggruppamento per
giornata di CNS e OTU e il libretto a valore legale.

**Il numero progressivo non era deterministico.** Con una data illeggibile in
archivio, le stesse quattro immersioni ricevevano tre numerazioni diverse a
seconda dell'ordine in cui arrivavano.

### La sincronizzazione

**Quattro cose tornavano indietro da sole.** Un campo svuotato a mano tornava e
il gesto spariva dall'archivio, quindi non si poteva più togliere. Una bombola
tolta a mano tornava dall'altro dispositivo, senza pressioni: consumo dichiarato
da 2.2 a **4.5 L/min**. E lo stesso tuffo scaricato in due fusi orari diversi —
col telefono in barca e col Mac a casa — diventava **due immersioni su tutti i
dispositivi**, per sempre, senza un avviso.

**Un profilo illeggibile sul remoto spariva in silenzio**, e la
sincronizzazione si dichiarava riuscita a ogni giro. Adesso lo dice.

**«La chiave del tuo database è scaduta, esci e rientra»** compariva anche
quando il problema era tutt'altro: bastava che il messaggio della libreria
contenesse la parola «token», e un JSON malformato la contiene. Chi seguiva il
consiglio perdeva la sessione e si teneva il guasto.

### Lo scarico Bluetooth

**Dopo «sono arrivate ma non si sono potute salvare»**, la stessa schermata
offriva di far ripartire il prossimo scarico da lì. Accettando, quelle
immersioni non sarebbero tornate mai più.

### E una segnalata da chi la usa

**Su Android «Esporta PDF» diceva «PDF salvato» e non salvava niente.** Dentro
la finestra dell'applicazione il download del browser non funziona e non dà
errore, quindi la conferma compariva su un file che non esisteva — ed era
proprio il difetto che questa applicazione aveva già chiuso una volta, sui
telefoni di Apple soltanto. Adesso il file si scrive davvero, e il messaggio
dice **in che cartella**: «la cartella dell'app» senza il percorso non aiuta a
trovare niente.

*Grazie a chi l'ha segnalato.* Una falsa conferma su un'esportazione non perde
un file: costruisce fiducia in un file che non c'è.

### Piccole

Il minimo e il massimo della zavorra non erano arrotondati come la mediana in
mezzo a loro: «6.699999999999999–9.5 kg». E la nota verde «Niente in circolo —
nessuna nota da leggere» finiva sopra alle note da leggere.

---

Ogni correzione ha una prova che è stata **mutata**: si rimette il difetto e si
guarda la prova diventare rossa. Una guardia che non si è mai vista rossa non è
una guardia. Le prove sono 2 769 su 165 file, più 135 sul lato Rust.
