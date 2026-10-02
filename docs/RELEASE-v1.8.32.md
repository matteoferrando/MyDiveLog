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

| Pacchetto | SHA-256 | byte |
|---|---|---|
| `MyDiveLog-macOS-arm64.dmg` | `54ab618e5286303a3b2d2ff84af77144d1309216862a56e783a70dcc8cdf6214` | 4.540.931 |
| `MyDiveLog-Windows-setup.exe` | `e5d6df21a7eb38e266c227d6f3d1fb0f8f1fd29769d4559c161117e033be9cb9` | 3.267.981 |
| `MyDiveLog-Windows-portatile.exe` | `ae709b18f26fcf44019fc38620ada2fed4f469dc39852ffcf91615dc8ea45519` | 7.496.192 |
| `MyDiveLog-Android-arm64.apk` | `17e14fe13448f0211865ec5438bf6a49c09aee12ecf53d6b765e71bbf6e06c47` | 11.044.258 |
| `MyDiveLog-Linux-amd64.deb` | `797191adc13d891c53d9c084175657ee0e39bafaf49fc2ad9afa3e4b352baa4f` | 3.834.142 |
