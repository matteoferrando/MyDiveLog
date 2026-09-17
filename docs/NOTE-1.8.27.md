# 1.8.27 — la segnalazione del 16 settembre, letta riga per riga

*Un messaggio, due notizie opposte, e tre difetti nostri.*

---

## Quello che il diario diceva

```
esito: errore — scarico non riuscito (stato -8, errore di protocollo)
libdivecomputer, errore: Invalid packet length (96). [pelagic_i330r.c:214]
immersioni: 40
metodo 1 di 4: senza conferma, notifiche una per volta
scambio: 55 scritture, 1961 notifiche (notifiche da 6 a 101 byte)
letture: 1961, di cui 1961 corte e 0 vuote; pacchetti lasciati a metà: 0
```

## 1 — «Invalid packet length (96)»

Quella riga, nel sorgente vendorizzato, è:

```c
unsigned int length = packet[4];
if (length + 5 > transferred) { ERROR ("Invalid packet length (%u).", length); ... }
```

Il pacchetto dichiarava **96 byte di carico** — 101 in tutto — e `transferred`,
cioè quello che il nostro trasporto gli aveva consegnato, era meno di 101. Il
diario dice anche la dimensione delle notifiche, *«da 6 a 101 byte»*: il
pacchetto pieno è proprio 101, e quella volta era arrivato spezzato.

La politica in uso era `Riassemblaggio::UnaNotifica` — «notifiche una per
volta», lo dice il diario due righe sopra. Consegna una notifica per lettura e
non ne unisce mai due. Finché ogni pacchetto sta in una notifica va bene:
quaranta immersioni sono passate così.

**Tornano anche i numeri che non si sono mossi.** `pacchetti lasciati a metà: 0`
e `pausa colmata: 0 ms` sono i contatori del riassemblaggio: con quella politica
quel codice non gira affatto, quindi dicevano zero davanti a un pacchetto
lasciato a metà per davvero. *Un contatore che non può salire non è una misura.*

### Perché non è bastato accendere `PacchettoIntero`

Quella politica unisce «finché ogni notifica arriva **piena**», dove piena vuol
dire «grande come la più grande vista finora». È una regola del **trasporto**:
vera quando a spezzare è l'MTU, muta quando a spezzare è qualcos'altro.

Su un pacchetto completo da 101 byte che è anche il più grande mai visto, la
condizione è soddisfatta: si aspetterebbe 250 ms un seguito che non esiste, e se
nel frattempo arriva il pacchetto *dopo* se lo tira dentro. Quello è il danno
peggiore dei due, perché **non dà nessun errore**: chi riceve legge la lunghezza
del primo, prende quei byte e butta il resto.

### La regola che c'era già, scritta nel pacchetto

L'inquadramento della famiglia Pelagic è
`CD <bandiera> <comando> <checksum> <lunghezza>`: il totale è **`lunghezza + 5`**.
Non è dedotto dal sorgente della libreria — è **misurato sui pacchetti veri del
diario**, quattro scritture e una notifica:

| primi cinque byte | lungo | `packet[4] + 5` |
|---|---|---|
| `cd 40 fa f6 09` | 14 | 14 |
| `cd 80 fa 92 10` | 21 | 21 |
| `cd 80 fb 94 06` | 11 | 11 |
| `cd 00 0d be 09` | 14 | 14 |
| `cd c0 fa 94 02` | 7 | 7 |

Da cui `Riassemblaggio::LunghezzaDichiarata`: si legge l'intestazione, si aspetta
finché i byte dichiarati non ci sono tutti, e si consegna **esattamente quel
pacchetto** — il resto, se è arrivato attaccato, resta in cassa per la lettura
dopo.

*Dove il protocollo dice la lunghezza, indovinarla è una scelta — ed è la scelta
sbagliata.*

Si applica ai tre modelli con `famiglia: 'pelagic_i330r'` in catalogo: Apeks DSX,
Aqualung i330R e i330R Console. `famigliaPelagic.test.ts` accosta l'elenco Rust a
quello generato: un quarto modello in catalogo rende rossa la prova prima che
qualcuno se ne accorga con un computer in mano.

### E adesso il fuori sincronia lo dice libdivecomputer

Un avanzo che non comincia per `CD` non è un pacchetto a metà: è un avanzo fuori
sincronia. Tenerselo per «riallinearsi» vorrebbe dire fermarsi ad aspettare
frammenti a ogni lettura fino alla fine dello scarico, e nascondere l'unica
informazione utile — che la libreria dà per intero: «Unexpected packet start
byte (%02x)», col byte che ha trovato.

---

## 2 — La chiave buttata per un guasto che non la riguarda

Secondo tentativo del diario:

```
collegamento non riuscito dopo 3 tentativi: … Timeout during execution of Connect
lo scarico è fallito con una chiave conservata: chiave dimenticata
```

La chiave **non era mai stata presentata**: si usa dopo il collegamento, e il
collegamento non si era aperto.

La regola resta giusta per uno scarico fallito — una chiave che non vale più
bloccherebbe quel computer per sempre, perché con una chiave in mano il driver
salta del tutto il ramo del PIN — ma su un collegamento che non si apre il
beneficio è **zero** e resta solo il costo. *Una cura che non può curare questo
guasto, applicata a questo guasto, non è prudenza: è un fastidio.*

La frase che distingue i due casi è **nostra** — la scrive `ponte_blec.rs` — ed è
quindi un'interfaccia fra due metà dello stesso programma, non un dettaglio di
una libreria. Per questo è una costante esportata e una prova legge il sorgente
Rust per controllare che ci sia ancora.

---

## 3 — Due commenti che avevano smesso di essere veri

In `Cargo.toml` e in testa a `trasporto_ldc.rs` c'era scritto che *«nessun
computer subacqueo di terzi è mai stato collegato a questo codice»* e che *«il
primo apparecchio vero non è ancora esistito»*. Sono stati veri per tre
settimane. Il Mares Quad Ci li ha smentiti.

*Un commento che afferma un fatto va rimisurato come il fatto.*

Al loro posto c'è quello che resta vero, ed è la lezione dello stesso giorno:
**un modello provato non è una famiglia provata**. L'elenco di quelli accesi
davvero sta in `src/core/ble/provati.ts`, con la data e da dove arriva la
notizia, e l'etichetta del selettore lo legge da lì.

`provatiSulCampo.test.ts` sorveglia l'errore opposto, che adesso è quello
possibile: dichiarare «provato» qualcosa che nessuno ha acceso. Ogni voce deve
corrispondere a un modello in catalogo e portare data e provenienza.

---

## Le mutazioni

| mutazione | prova che si accende |
|---|---|
| il ramo della lunghezza dichiarata non gira più | `trasporto_ldc::prove` (Rust) |
| la consegna non si ferma più al confine del pacchetto | `trasporto_ldc::prove` (Rust) |
| la lunghezza si legge senza contare l'intestazione | `trasporto_ldc::prove` (Rust) |
| i Pelagic tornano a una notifica per lettura | `ponte_blec::prove` (Rust) |
| un modello sparisce dall'elenco dei Pelagic | `famigliaPelagic` |
| la chiave si butta anche se il collegamento non si è aperto | `chiaveECollegamento` |
| un modello si dichiara provato senza che nessuno l'abbia acceso | `provatiSulCampo` |

Sette, sette rosse.

Catena: **2 839 prove in 173 file**, **149** Rust, tipi/lint/formato a zero.

---

## Quello che resta da chiedere

Chi ha segnalato scrive **i300R** nel messaggio e il diario dice **i330R**. Nel
catalogo l'i300R non c'è, quindi potrebbe aver scelto il nome più vicino. Non
cambia la diagnosi — quaranta immersioni lette dicono che il protocollo è quello
giusto, e un errore di inquadramento non dipende dalla mappa di memoria — ma se è
un i300R spiegherebbe i dodici avvisi *«Profiles are not continuous»* che vengono
prima dell'errore, e allora andrebbe aggiunto al catalogo come modello suo.

**E la correzione non è provata su un i330R**, perché qui non ce n'è uno. È verde
sulle prove, che riproducono il pacchetto spezzato con i numeri esatti del
diario. La conferma vera è il prossimo messaggio di chi l'ha segnalato.
