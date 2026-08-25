# Perché in questo progetto ci sono due licenze

MyDiveLog è **MIT**, e il testo sta in [`../LICENSE`](../LICENSE). Vale per tutto
tranne le eccezioni elencate qui sotto, che sono **LGPL-2.1-or-later**.

| Cosa | Perché non è MIT |
|---|---|
| `src-tauri/vendor/libdivecomputer-0.9.0.tar.gz` | È libdivecomputer, e la sua licenza è la sua. Viene compilata solo con la funzionalità cargo `computer-esterni`. |

**L'eccezione era due, ed è tornata una.** `src/core/parsers/uwatecSmart.ts` è
stato LGPL per qualche ora: un audit riga per riga aveva mostrato che il suo
nucleo era una traduzione di `uwatec_smart_parser.c`. È stato riscritto —
`uwatecBitstream.ts`, derivato dalla specifica pubblica del formato, che lo
descrive come un codice a prefissi invece che come una tabella di numeri — e
verificato campione per campione contro la versione precedente. Ora è MIT di
nuovo, e la storia sta scritta in testa al file perché non si ripeta senza che
qualcuno se ne accorga.

**Le due licenze convivono senza forzature, ed è il caso per cui la LGPL è
stata scritta.** Un programma con qualunque licenza può usare un modulo LGPL, a
una condizione: che chi riceve il programma possa sostituire quel modulo con una
propria versione e rimettere insieme il tutto. Qui la condizione è soddisfatta
nel modo più semplice possibile — **tutto il sorgente è pubblico e si ricompila
con un comando**, quindi chiunque può cambiare quel file, o quella libreria, e
rifare l'applicazione.

**Su App Store la funzionalità non entra**, e la ragione è tecnica: nessun
computer subacqueo di terzi è mai stato collegato a questo codice. La catena si
compila e si prova a pezzi — il trasporto contro un flusso finto, l'accorpamento
dei campioni, la traduzione contro immersioni sintetiche — ma il primo
apparecchio vero non è ancora esistito. Accenderla prima di quella prova vuol
dire spedire un pulsante «Scarica» che potrebbe non funzionare, e in un logbook
una lettura sbagliata non dà errore: dà un profilo plausibile e falso.

**Come teniamo la libreria, e perché in questo modo.** Sono scelte prese per
ragioni tecniche che valgono anche come impegni verso chi l'ha scritta:

1. **Il sorgente dell'applicazione è pubblico**, sotto MIT.
2. **Il sorgente ESATTO della libreria contro cui si compila è disponibile.** Il
   tarball è versionato in `src-tauri/vendor/` e la build lo scompatta da lì, non
   da una copia scaricata al momento: chi ha il repository ha gli **stessi byte**
   contro cui è stato compilato il binario pubblicato. Sostituirlo con un
   sottomodulo o con un download in fase di build romperebbe questa proprietà.
3. **Le correzioni di protocollo e le scoperte tornano a monte.** Quello che
   abbiamo trovato e non abbiamo ancora proposto è elencato nel README.
4. **L'attribuzione è dichiarata per intero**, file per file, nel README — e va
   portata dentro l'applicazione il giorno in cui `computer-esterni` verrà accesa
   in una build di rilascio: chi installa un pacchetto il README non lo vede.

Il debito verso libdivecomputer è dichiarato per intero, file per file, nella
sezione «Licenza e riconoscimenti» del README.
