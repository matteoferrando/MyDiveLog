# Perché in questo progetto ci sono due licenze

MyDiveLog è **MIT**, e il testo sta in [`../LICENSE`](../LICENSE). Vale per tutto
tranne le eccezioni elencate qui sotto, che sono **LGPL-2.1-or-later**.

| Cosa | Perché non è MIT |
|---|---|
| `src/core/parsers/uwatecSmart.ts` | Il nucleo è una traduzione di `uwatec_smart_parser.c` e `array.c`. Un confronto riga per riga, fatto apposta, non lascia margini: chiamarlo MIT sarebbe stata una dichiarazione comoda e falsa. |
| `src-tauri/vendor/libdivecomputer-0.9.0.tar.gz` | È libdivecomputer, e la sua licenza è la sua. Viene compilata solo con la funzionalità cargo `computer-esterni`. |

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
