## MyDiveLog 1.8.32 — su Android, l'icona giusta

Una versione per Android. **Su Mac, Windows, Linux e iPhone non cambia niente**
rispetto alla 1.8.31: chi la aggiorna ritrova la stessa applicazione.

### L'icona di MyDiveLog, al posto di quella di Tauri

Fino alla 1.8.31, installata su Android, l'app mostrava l'icona di fabbrica di
Tauri — il framework con cui è costruita — invece del profilo d'immersione di
MyDiveLog: dall'APK di questa pagina e da Google Play, che per questo ha fermato
la 1.8.31. Il pacchetto si costruiva senza che le nostre icone ci entrassero mai,
e nessun controllo guardava.

Adesso l'icona è quella del marchio, nella forma adattiva che Android ritaglia a
modo suo (cerchio, goccia, quadrato arrotondato) senza tagliare il profilo. E
prima che un pacchetto esca, un controllo lo apre e confronta l'icona che c'è
dentro con la nostra, pixel per pixel, a ogni densità.

### Se arrivi da una versione prima della 1.8.30

La 1.8.30 e la 1.8.31 portano il resto: dieci computer Bluetooth nuovi (Perdix 3,
Quad 2, Sirius L, Puck Pro EZ e Ultra, Raffaello, Seac Tablet, OSTC 3, OSTC cR,
OSTC Nano), le correzioni allo scarico, la schermata che dice quante immersioni
sono già salvate se lo scarico si interrompe. Le loro note stanno nelle release
[v1.8.30](https://github.com/matteoferrando/MyDiveLog/releases/tag/v1.8.30) e
[v1.8.31](https://github.com/matteoferrando/MyDiveLog/releases/tag/v1.8.31).

---

Ogni correzione ha una prova, e ogni prova è stata rimessa alla prova rimettendo
il difetto: **3 017 controlli automatici in 196 file**, più **187** sul motore
nativo. Nessuno saltato.

### Impronte SHA-256

Calcolate sui file allegati a questa release, non su una compilazione
precedente: due compilazioni non danno lo stesso byte.

*Le impronte si aggiungono quando i pacchetti allegati esistono.*
