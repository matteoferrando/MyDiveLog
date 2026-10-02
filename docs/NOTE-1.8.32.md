# 1.8.32 — l'icona che Google Play ha guardato prima di noi

*Il 2 ottobre 2026, su un rifiuto di Google Play. È una versione per Android:
su Mac, Windows, Linux e iPhone non cambia niente rispetto alla 1.8.31. Esce su
tutti i canali per scelta del proprietario — Play, l'APK del sito, GitHub, la
cask — perché l'APK del sito aveva lo stesso difetto.*

## Il fatto

Play Console, *Issue details*, norma **Misleading Claims**: *«App store listing
mismatch — Your app's installed icon or name differs from its store listing»*.
Come prova, due immagini: l'icona della scheda (`it-IT`), che è il nostro
profilo d'immersione, e l'icona installata, che sono **i due anelli giallo e
azzurro di Tauri**. Applicato il 2 ottobre; la versione precedente resta su
Play.

Aveva ragione. Non c'era niente da contestare: c'era da guardare dentro il
pacchetto, cosa che nessuno aveva mai fatto per l'icona.

## La lettura, misurata

- **Dentro `MyDiveLog-1.8.31-play.aab`**: `base/res/mipmap-*-v4/ic_launcher.png`
  è l'icona di Tauri (aperta e guardata), e non c'è nessun
  `mipmap-anydpi-v26/ic_launcher.xml`. **Dentro l'APK del sito** i nomi delle
  risorse sono accorciati (`res/-B.png`): cercando per pixel, nessuna delle
  nostre.
- **Il perché**: il workflow rigenera il progetto Android a ogni giro con
  `tauri android init --ci`, che ci mette l'icona del suo modello. Le nostre
  stavano in `src-tauri/icons/android/` e nessun passo le copiava. `git log -S`
  sul workflow dice che quel passo **non c'è mai stato**, dal 25 agosto, quando
  è nato il lavoro Android: quindi l'icona di Tauri c'era in ogni APK e in ogni
  `.aab` costruiti fin qui. Aperti sono stati quelli della 1.8.31; per gli
  altri lo dice la storia del workflow.

*È lo schema della firma che mancava, il 29 agosto: una cosa che il modello di
Tauri non fa, nessun comando che fallisce, il workflow verde, e nessuno che
guardi dentro il pacchetto.*

## Adesso, in tre pezzi

**1. L'icona adattiva, disegnata apposta** — `scripts/icone-android.mjs`. Le
icone che scrive `tauri icon` non bastavano: mettono l'icona INTERA nello strato
davanti, su uno sfondo bianco. Ma Android mostra solo i 72 dp centrali dei 108
di un'icona adattiva, ritagliati con la maschera che sceglie il telefono: dell'
icona intera si sarebbe visto il terzo di mezzo, ingrandito, col profilo tagliato
ai lati — un'icona diversa da quella della scheda, di nuovo, solo meno diversa.

Qui il disegno di `icon.svg` si rimpicciolisce di 72/108 attorno al centro e si
divide in due strati: l'acqua fino al bordo dietro, il profilo trasparente
intorno davanti. La finestra che il telefono mostra contiene esattamente l'icona
del negozio, e la maschera la mette lui. Fotografato da Chromium accanto all'icona
della scheda, con le tre maschere più comuni — cerchio, goccia, quadrato
arrotondato: lo stesso disegno, con il bordo del telefono.

**2. La copia nel progetto generato** — `scripts/icone-progetto-android.mjs`,
nel passo «Le nostre icone nel progetto Android», fra `tauri android init` e la
build. Rilegge ogni file copiato byte per byte, e si ferma se il progetto non è
stato generato, se non ha copiato niente o se manca l'icona adattiva.

**3. Il controllo dentro il pacchetto** — `scripts/icona-nel-pacchetto.py`, nel
passo «L'icona nel pacchetto è la nostra?», dopo la build. Apre l'APK e l'`.aab`
e confronta, densità per densità e pixel per pixel, i due strati e l'icona di una
volta con quelli del repository. Pixel e non byte, perché gradle ricomprime i PNG.

- Il decodificatore PNG scritto a mano è stato confrontato con **Pillow** su
  **tutti i 434 PNG** dei due pacchetti della 1.8.31 — scala di grigi, RGB,
  tavolozza a 2, 4 e 8 bit, grigio con alfa, RGBA: **434 uguali**.
- **Rosso** sui pacchetti veri della 1.8.31, a ogni densità, tutti e due.
- **Verde** sugli stessi pacchetti con dentro le nostre icone **ricodificate**
  (15 su 15 con byte diversi, pixel uguali), una volta a nome pieno come
  nell'`.aab` e una volta a nome accorciato come nell'APK.
- **Rosso di nuovo cambiando un pixel** dello sfondo `xxhdpi`.
- Zero pacchetti guardati è un errore, come per la firma.

**Le prove** (`tests/iconaAndroid.test.ts`, 27): l'icona adattiva prende i due
strati nostri e non lo sfondo bianco di `tauri icon`; i due strati hanno la misura
giusta a ogni densità; lo sfondo è pieno fino al bordo; il profilo sta tutto
dentro il cerchio di 66 dp, l'unica parte che nessuna maschera taglia; il
workflow copia DOPO `init` e PRIMA della build, e guarda nel pacchetto DOPO la
build; la copia si ferma nei tre casi; e lo script del pacchetto, fatto girare
davvero su bundle costruiti apposta, passa con le nostre e si accende con uno
strato scambiato o senza l'icona adattiva. Quattro mutazioni, quattro rosse: lo
sfondo che torna un colore, lo strato davanti che torna un quadrato pieno, il
passo della copia tolto dal workflow, il controllo spostato prima della build.

## Il numero

Play non accetta due volte lo stesso `versionCode`, e la 1.8.31 ha usato
`1008031`. La 1.8.32 è `1008032`.

## Quello che non è verificato, detto

- **Che Play accetti**: lo decide la revisione.
- **Come la disegna un telefono vero**: misurata su fotografie di Chromium con le
  tre maschere più comuni, non su un apparecchio. Su Android il ritaglio lo fa il
  launcher.
- **L'icona a tema di Android 13** (lo strato monocromatico) non c'è: come la
  disegna un telefono con le icone a tema accese lo decide il suo launcher.
