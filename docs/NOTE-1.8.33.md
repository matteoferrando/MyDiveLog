# 1.8.33 — le pagine da 16 KB, che Google Play ha guardato prima di noi

*Il 2 ottobre 2026, poche ore dopo la 1.8.32. Anche questa è una versione per
Android: su Mac, Windows, Linux e iPhone non cambia niente. Esce su tutti i
canali come la 1.8.32, perché l'APK del sito aveva lo stesso difetto.*

## Il fatto

Caricando su Play l'`.aab` della 1.8.32 — quello con l'icona giusta — Play Console
ha detto: *«Your app does not support 16 KB memory page sizes»*. Da novembre 2025
Play lo pretende dalle app che puntano ad Android 15, e la nostra punta ad
Android 16 (API 36).

## La lettura, misurata

Dentro l'`.aab` e dentro l'APK della 1.8.32 c'è una sola libreria nativa,
`libmydivelog_lib.so` — Rust più libdivecomputer, collegati insieme. I suoi
quattro segmenti `PT_LOAD` hanno **`p_align` 0x1000**, cioè 4 KB. Lo zip dell'APK
invece era già a posto: la libreria è salvata senza compressione e comincia a un
multiplo di 16 KB, lo fa gradle da sé.

Il perché: l'NDK fissato nel workflow è il 27, che collega a 4 KB se non glielo
si dice (dal 28 il predefinito è 16 KB); e Tauri, alla sua versione 2.11.4, non
glielo dice — nel suo binario `max-page-size` non c'è.

*La seconda volta nello stesso giorno che Play guarda dentro il pacchetto una
cosa che noi non guardavamo.*

## Adesso

**La cura**, in `src-tauri/build.rs` (`pagine_da_16_kb`): per Android,
`cargo:rustc-link-arg=-Wl,-z,max-page-size=16384`. Al linker e non con un
`RUSTFLAGS`: Tauri passa a cargo i suoi flag (`-landroid`, `-llog`,
`-lOpenSLES`) attraverso le variabili d'ambiente, e cargo delle sorgenti di
RUSTFLAGS ne usa una sola — una nostra rischiava di togliere le sue. La riga del
build script arriva al collegamento finale in ogni caso.

**Il controllo**, `scripts/pagine-16k.py`, nel passo «Le librerie native reggono
le pagine da 16 KB?» dopo la build: apre l'APK e l'`.aab`, legge l'intestazione
ELF di ogni `.so` (32 e 64 bit) e pretende ogni `PT_LOAD` a 16 KB o più; nell'APK
pretende anche che una libreria salvata senza compressione cominci a un multiplo
di 16 KB. Zero librerie guardate è un errore. **Rosso sui pacchetti della
1.8.32**, tutti e due.

**Le prove** (`tests/pagine16k.test.ts`, 7): la riga per il linker c'è ed è solo
per Android; `main()` la chiama; il workflow guarda DOPO la build e solo fra i
pacchetti consegnati; e lo script, fatto girare su pacchetti costruiti apposta con
un ELF ridotto all'osso, passa a 16 KB nell'`.aab` e nell'APK, si accende a 4 KB
come la 1.8.32, si accende nell'APK con una libreria giusta messa nello zip fuori
posto, e si accende senza pacchetti.

> **► UNA DELLE GUARDIE ERA VERDE CON LA CURA SPENTA. ◄** La prima versione di
> «`main()` la chiama» cercava il testo `pagine_da_16_kb();`: con la chiamata
> commentata il testo c'è ancora, e la prova restava verde. L'ha detto la
> mutazione. Adesso si cerca una riga che COMINCIA con la chiamata, e lo stesso
> per la riga del linker e per i comandi del workflow — anche quelli della 1.8.32
> sull'icona, che avevano lo stesso buco. Sette mutazioni, sette rosse.

## Il numero

L'`.aab` della 1.8.32 è stato caricato su Play, quindi `1008032` è usato. La 1.8.33
è `1008033`.

## Quello che non è verificato, detto

- **Che Play accetti**: lo decide la revisione.
- **Un telefono con pagine da 16 KB**: qui non ce n'è. Si misura l'allineamento
  nel pacchetto costruito, che è quello che Play controlla.
