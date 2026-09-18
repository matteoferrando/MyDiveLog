## MyDiveLog 1.8.29 — le proporzioni, contate invece che guardate

Due notti di lavoro su una domanda sola: *l’applicazione è bella?* Non si
risponde guardandola, perché l’occhio si abitua. Si risponde contando — centoventi
viste, dodici larghezze (dall’iPhone SE da 320 px al Linux da 1920), dieci
schede, tema chiaro e scuro, italiano e inglese. Poi un debug a tappeto su
tutto il resto.

### Ogni controllo ha la stessa altezza, e sul telefono si preme davvero

Misurato a 1280 px: un pulsante era alto 35,5 px, un campo di testo 33,5, un
menu a tendina 31. **Tre altezze per tre cose che stanno nella stessa riga di
filtri** — nessuna sbagliata di suo, ognuna nata dal proprio riempimento, e
proprio per questo mai viste.

Sul telefono la differenza cambiava di segno e diventava un problema vero: i
campi salivano a 38 px e i pulsanti restavano a 35,5, cioè **sotto i 44 px che
iOS chiede a un bersaglio da premere col dito**, nella stessa schermata dove la
barra in basso era già a 44.

Adesso è una misura dichiarata: **36 col puntatore, 44 col dito**, per ogni
pulsante, campo e menu dell’applicazione. Anche i riquadri apribili
(«Avanzate», «3 esercizi», «Risalita, soste e limite di PPO2»), che erano
bersagli alti diciotto pixel.

### Il pianificatore non scrive più numeri impossibili

Con una bombola da zero litri la tabella dei gas diceva **«EAN32 1.719
Infinity 220»**. E sotto il campo della bombola si leggeva **«3982.0000000000005
L di gas»**: il valore era giusto — in binario `220 × 18,1` fa esattamente
quello — ma chi legge non vede i binari, vede un’applicazione che non sa
contare il gas che si porta sott’acqua.

Quattordici punti di disegno passano ora da un arrotondamento che vale solo per
quello che si legge; i conti dentro restano esatti.

### Su Android l’applicazione parlava di un’altra piattaforma

Nella schermata di importazione c’era scritto **«Trascina qui i file, o scegli
dal disco»**: un gesto impossibile e un posto che sul telefono non esiste. La
correzione per iPhone c’era da tre settimane; Android è un telefono esattamente
quanto l’altro, e lì era rimasta la frase del computer.

E quando la ricerca Bluetooth non trova niente, l’applicazione dice dove si
concede il permesso: su Android dava il percorso di macOS, che lì non esiste —
e il permesso non si chiama nemmeno Bluetooth, da Android 12 il gruppo è
**Dispositivi nelle vicinanze**.

### La scheda dell’immersione, sul telefono

«Esporta PDF» e «Modifica dati» stavano su metà schermo, con il secondo che
andava a capo dentro il pulsante. Adesso prendono metà larghezza ciascuno, alti
uguale, e il ritorno al logbook sta sulla sua riga.

### La scelta del periodo si vede

I quattro pulsanti — 6, 12, 24 mesi, tutto l’archivio — a schermo stretto
andavano a capo due e due, allineati a destra e sfrangiati a sinistra in mezzo a
una carta allineata a sinistra. Adesso sono una griglia due per due a tutta
larghezza, e **quello acceso si distingue per il bordo blu** invece che per tre
punti di grigio.

### Quattro etichette dentro i grafici venivano tagliate

«54:00» sull’asse dei tempi del confronto, «obiettivo» sulla linea di
riferimento, il nome del sito più frequentato, l’unità sotto l’asse. Un testo
dentro un disegno non ha i puntini di sospensione: o ci sta, o sparisce un
pezzo, e non lo segnala niente. E **«sosta di sicurezza 2.5–7.5 m»** perdeva
l’ultima parola sotto la riga della risalita, che passa per quella fascia per
costruzione: adesso è disegnata sopra la curva, con l’alone, come le quote di
una carta nautica.

In inglese ne uscivano altre due, perché le frasi cambiano lunghezza. *Misurare
in una lingua sola è misurare mezza applicazione.*

### Sotto il cofano

**Il controllo dei tipi non guardava il servizio dell’accesso.** Gli otto file
che scambiano il codice con Apple e con Google, tengono le sessioni e parlano
col database non erano dentro `tsconfig.json`: nessun controllo li aveva mai
letti. Adesso ci sono, insieme ai nove programmi di supporto e alla
configurazione della build — e in uno di quelli c’era un errore vero.

**La catena di rilascio misurava il pacchetto di ieri.** I controlli sul peso e
sulla divisione della build leggono la cartella costruita, e la catena non
costruiva: su una copia pulita non giravano affatto, e altrove giravano sulla
build della versione precedente. Adesso si costruisce per prima cosa, e cinque
controlli che non partivano partono.

**Le prestazioni, misurate fino a diecimila immersioni** — il doppio di quante
ne avevamo mai contate: tutto resta sotto il decimo di secondo tranne il
ricalcolo completo delle metriche (0,6 s) e l’import di cinquanta immersioni in
un archivio da diecimila (0,3 s).

E sul motore nativo: una costante misurata sul campo — l’intervallo della radio
Bluetooth — che serviva a giustificare un’attesa e che **nessuno leggeva**.
Adesso il compilatore controlla la relazione fra i due numeri.

---

Ogni correzione ha una prova, e ogni prova è stata rimessa alla prova rimettendo
il difetto: **2 884 controlli automatici in 183 file**, più **149** sul motore
nativo. Nessuno saltato.

### Impronte SHA-256

Calcolate sui file allegati a questa release, non su una compilazione
precedente: due compilazioni non danno lo stesso byte.

| Pacchetto | SHA-256 | byte |
|---|---|---|
| `MyDiveLog-macOS-arm64.dmg` | `ac7293ac4b7599b786d7a50683b7b19bfe77aeeb41f1395214a2a5648a164923` | 4.531.066 |
| `MyDiveLog-Windows-setup.exe` | `2da3e25e58aa9188f9239e3dd2059a691b247390d0049f46caf09b9261df3c69` | 3.263.728 |
| `MyDiveLog-Windows-portatile.exe` | `abfb84640db7dae5b1ad260f2c2dfac91f84b3d015d745f0c9dd7343ba06632f` | 7.523.840 |
| `MyDiveLog-Android-arm64.apk` | `209da036138535b63049357680e3df2a0419dde9a637a6f72f42f085c5545ecb` | 11.133.158 |
| `MyDiveLog-Linux-amd64.deb` | `f04c9e30b06b1283965f12d4fd42216950e1cdc30c562f7c4c5f92f60b55310f` | 3.827.112 |
