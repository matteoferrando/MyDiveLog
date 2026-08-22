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

L'unico posto dove la stessa domanda non ha una risposta comoda è la
distribuzione su App Store, dove il binario lo firma Apple e nessuno può
rilinkare niente. È il motivo per cui `computer-esterni` è spenta di sua
iniziativa, ed è una questione aperta scritta in `README.md`.

Il debito verso libdivecomputer è dichiarato per intero, file per file, nella
sezione «Licenza e riconoscimenti» del README.
