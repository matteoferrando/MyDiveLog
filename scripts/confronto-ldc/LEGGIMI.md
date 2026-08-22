# Il nostro decoder Uwatec contro libdivecomputer

**Tre** implementazioni dello stesso formato binario, messe una accanto all'altra
sugli stessi byte. Se divergono, una delle tre sbaglia, e questo confronto dice
subito quale immersione guardare.

1. `src/core/parsers/uwatecSmart.ts`, il nostro decoder in TypeScript;
2. libdivecomputer, il codice C;
3. `src-tauri/src/trasporto_ldc.rs`, la nostra traduzione dell'uscita di
   libdivecomputer nel modello canonico.

La terza sembra ridondante e non lo è: verifica una cosa che le prime due non
toccano. libdivecomputer **non consegna record completi** — manda un istante e
poi, uno alla volta, i valori che a quell'istante sono cambiati — e chi non li
accorpa si ritrova un campione per grandezza invece che per istante. Il conteggio
dei campioni è la spia che lo prende.

## Perché esiste

Il decoder Uwatec è la parte più delicata dell'applicazione: il flusso dei
campioni è un bitstream a lunghezza variabile in cui i valori sono delta con
segno accumulati su uno stato. Un errore in un punto qualsiasi non produce un
errore — produce **un profilo plausibile e falso**, che scorre a caso da lì in
poi. Non c'è controllo interno che lo prenda, e a occhio non si vede.

libdivecomputer legge lo stesso formato da vent'anni ed è usata da mezzo mondo.
Confrontarsi con lei è il riscontro più forte disponibile, e costa un pomeriggio
una volta sola.

## Il risultato, al 22 agosto 2026

Sulle **85 immersioni con profilo** dell'archivio di riferimento (un Aladin Sport
Matrix, esportate da LogTRAK):

| Cosa | Divergenze |
|---|---|
| durata dichiarata | 0 |
| profondità massima | 0 |
| temperatura minima e massima | 0 |
| numero di campioni | 0 |
| ultimo istante registrato | 0 |
| **64 706 campioni di profondità, uno per uno** | **0** |

Scarto massimo: **0.00 m**. Lo stesso vale fra il TypeScript e la traduzione in
Rust: **64 706 campioni, zero divergenze**, numero di campioni compreso.

Due conseguenze, e la seconda vale più della prima. La prima: il nostro decoder
è giusto. La seconda: **le due strade sono intercambiabili**, quindi il giorno
che si volesse far leggere gli Uwatec a libdivecomputer invece che a noi, i
numeri non cambierebbero di un centimetro — e questo toglie il rischio da una
decisione che altrimenti sarebbe un salto nel buio.

Non è tutto uguale, e le differenze sono spiegate:

- **`profMedia`**: libdivecomputer non legge la profondità media, noi sì (offset
  24, un'inferenza verificata a parte). Non è una divergenza, è un campo in più.
- **L'ora di inizio**: libdivecomputer restituisce l'ora **locale** del computer
  subacqueo, noi restituiamo UTC più l'offset del fuso in un campo separato.
  Stesso istante, due convenzioni.

## Come si rifà

Serve un file `.logtrak` esportato da LogTRAK, che contiene i blob binari in
base64 dentro `diveLogBase64`, e libdivecomputer compilata — cioè quella che la
funzionalità cargo `computer-esterni` compila già in `src-tauri/target`.

```sh
node scripts/confronto-ldc/estrai.mjs percorso/al/file.logtrak   # → /tmp/blob/*.bin
cc scripts/confronto-ldc/serie.c -I<include-di-libdivecomputer> \
   -o /tmp/serie <percorso>/libdivecomputer.a -lm
/tmp/serie /tmp/blob/*.bin                                       # → /tmp/serie-ldc.txt
node scripts/confronto-ldc/confronta.mjs                         # il verdetto
```

Per la terza implementazione, quella in Rust, la prova sta dentro `cargo test` ed
è saltata quando non le si dà da mangiare:

```sh
node scripts/confronto-ldc/estrai.mjs percorso/al/file.logtrak
cd src-tauri && MDL_BLOB=/tmp/blob cargo test --features computer-esterni la_traduzione -- --nocapture
```

Scrive `/tmp/serie-rust.txt` nello stesso formato, così le tre serie si
confrontano a due a due.

**Il file `.logtrak` non sta nel repository e non ci deve stare**: sono le
immersioni di una persona. Il confronto si rifà quando serve, con i propri dati.
