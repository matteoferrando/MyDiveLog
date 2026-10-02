## MyDiveLog 1.8.33 — su Android, le pagine di memoria da 16 KB

Un'altra versione per Android, il giorno stesso della 1.8.32. **Su Mac, Windows,
Linux e iPhone non cambia niente**: chi la aggiorna ritrova la stessa
applicazione.

### La parte nativa, allineata a 16 KB

La parte dell'app scritta in Rust e in C — quella che parla coi computer
subacquei — era allineata alle pagine di memoria da 4 KB. Google Play pretende 16
KB dalle app per Android 15 e successivi, e i telefoni che usano pagine da 16 KB
ne hanno bisogno: per questo Play ha fermato anche la 1.8.32. Adesso è allineata
a 16 KB, e prima che un pacchetto esca un controllo lo apre e lo verifica,
libreria per libreria.

### Se arrivi da una versione prima della 1.8.32

La 1.8.32 ha messo su Android l'icona di MyDiveLog al posto di quella di Tauri. La
1.8.30 e la 1.8.31 portano il resto: dieci computer Bluetooth nuovi, le
correzioni allo scarico, la schermata che dice quante immersioni sono già salvate
se lo scarico si interrompe. Le note stanno nelle release
[v1.8.32](https://github.com/matteoferrando/MyDiveLog/releases/tag/v1.8.32),
[v1.8.31](https://github.com/matteoferrando/MyDiveLog/releases/tag/v1.8.31) e
[v1.8.30](https://github.com/matteoferrando/MyDiveLog/releases/tag/v1.8.30).

---

Ogni correzione ha una prova, e ogni prova è stata rimessa alla prova rimettendo
il difetto: **3 024 controlli automatici in 197 file**, più **187** sul motore
nativo. Nessuno saltato.

### Impronte SHA-256

Calcolate sui file allegati a questa release, non su una compilazione
precedente: due compilazioni non danno lo stesso byte.

*Le impronte si aggiungono quando i pacchetti allegati esistono.*
