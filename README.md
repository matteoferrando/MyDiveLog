# MyDiveLog

Logbook subacqueo che importa da computer diversi, calcola statistiche e ne
ricava un piano di miglioramento.

App desktop macOS (Tauri), con lo stesso codice pronto per iOS e per il web.

> **Non è un computer subacqueo e non sostituisce il tuo.**
> MyDiveLog contiene un'implementazione di Bühlmann ZH-L16C con gradient factor e
> una di VPM-B, usate per rileggere le immersioni già fatte e per preparare un
> piano in superficie. Il Bühlmann è confrontato con un Shearwater Peregrine su 38
> immersioni reali (scarto medio 0.8 punti di GF99, massimo 2.6); il VPM-B **non è
> ancora validato contro un'implementazione indipendente**. Nessuno dei due è
> certificato, nessuno dei due gira in acqua, e nessuno dei due sa che cosa stai
> facendo davvero: in immersione ha ragione il computer che hai al polso. Usa
> questi numeri per capire e per pianificare con la testa, mai come unica base di
> un'immersione decompressiva.

---

## Provalo in due minuti

```bash
npm install
npm run demo      # genera 6 file dimostrativi in demo/
npm run dev       # apre su http://localhost:1420
```

Trascina nella schermata **Importa** tutti i file della cartella `demo/`.
Sono 68 immersioni distribuite su cinque formati, ma in archivio ne entrano
**48**: le altre 20 sono la stessa immersione arrivata da fonti diverse, e
vengono riconosciute e unite invece che duplicate. È il comportamento che rende
utile un logbook multi-computer, e il modo più rapido di verificare che
funzioni.

`npm run dev` gira nel browser e salva i dati in IndexedDB. Per l'app desktop
vera, con database SQLite:

```bash
npm run desktop           # richiede Rust: https://rustup.rs
npm run desktop:build     # produce MyDiveLog.app e il .dmg
```

---

## Cosa fa

**Importa da più computer.** Il formato è riconosciuto dal *contenuto* del file,
non dall'estensione: un `.xml` può essere UDDF, Subsurface o Shearwater e i tre
vengono distinti correttamente.

| Formato | Cosa contiene | Come ottenerlo |
|---|---|---|
| **UDDF** | profilo, temperatura, tetto deco, PPO2, volume bombola | Shearwater Cloud Desktop → Export → UDDF |
| **Shearwater XML** | profilo completo, gas, GF | Shearwater Cloud Desktop → Export → XML |
| **Garmin FIT** | profilo, pressione dai trasmettitori T1/T2 | Garmin Connect, o cartella `ACTIVITY` del dispositivo |
| **Scubapro LogTRAK** | profilo, temperatura, volume e pressioni bombola, zavorra, fuso orario | app o desktop LogTRAK → Esporta (`.logtrak`) |
| **Shearwater Cloud** | il log nativo del computer: profilo, tetto deco, TTS, NDL, CNS, GF impostati, GPS | il database `.db` di Shearwater Cloud Desktop |
| **Subsurface** | tutto lo storico convertito da qualsiasi computer | Subsurface → Salva con nome (`.ssrf`) |
| **CSV** | riepilogo senza profilo | qualsiasi foglio di calcolo |

**Il logbook si sfoglia cinquanta immersioni alla volta**, con un pulsante
«Mostra altre» e un piede che dice sempre a che punto sei — anche quando non c'è
più niente da caricare, perché un elenco che finisce in silenzio lascia il dubbio
se sia finito l'archivio o solo la pagina. La casella «seleziona tutte» agisce su
ciò che è mostrato: la modifica in blocco non può toccare righe che non hai
davanti.

L'export FIT dell'app Suunto passa dallo stesso parser Garmin. È leggibile ma
povero: mancano il gas del trasmettitore e la composizione della miscela, che
vanno completati nella scheda immersione.

Il file LogTRAK è JSON, ma il profilo non è nel JSON: sta in un blob binario
Uwatec Smart dentro `diveLogBase64`, decodificato da
[`src/core/parsers/uwatecSmart.ts`](src/core/parsers/uwatecSmart.ts). Il formato
Uwatec **non contiene dati di decompressione** — né tetto, né NDL, né tempo in
deco: verificato sull'intero elenco dei tipi di record. Le soste obbligatorie
vengono riconosciute dal profilo, non lette dal file. Per verificare il decoder
su un export tuo:

```bash
npx tsx scripts/validate-logtrak.ts ~/Downloads/export.logtrak
```

Il JSON contiene profondità massima, durata e temperature già calcolate dal
computer, mentre il profilo è un blob separato: sono due fonti indipendenti degli
stessi numeri, quindi confrontarle è un test di correttezza vero. Su 104
immersioni reali di un Aladin Sport Matrix: temperature esatte al quanto del
sensore (0.4 °C), profondità massima entro 33 cm, zero byte residui.

Il database di **Shearwater Cloud** è un file SQLite, letto da
[`src/core/parsers/sqliteReader.ts`](src/core/parsers/sqliteReader.ts) — un
lettore scritto a mano, perché `sql.js` sono 1,5 MB di WebAssembly per fare
`SELECT * FROM due_tabelle`. Da qui arrivano due numeri che nessun altro formato
supportato fornisce: il **GF99 all'uscita** (quanto si è usciti sovrasaturi
rispetto al gradiente ammesso) e l'**obbligo decompressivo** effettivamente
incontrato. Il secondo cambia il quadro: le stesse immersioni importate da
LogTRAK sembravano tutte in curva, perché il formato Uwatec non contiene dati di
decompressione — unendo le due fonti se ne scoprono alcune con qualche minuto di
obbligo.

Il profilo di Shearwater Cloud invece non viene decodificato: è il formato binario
`sw-pnf` compresso, e per le stesse immersioni LogTRAK ha già un profilo
campionato più fitto (4 s contro 10 s). La deduplica tiene il profilo migliore e
prende da ciascuna fonte i campi che l'altra non ha.

**Calcola le metriche che dicono qualcosa.** Non solo profondità e durata:

- **consumo di superficie (RMV, L/min)** — confrontabile fra bombole e
  profondità diverse, a differenza dei bar/min;
- **oscillazione a quota tenuta (m/min verticali)** — metri verticali sprecati al
  minuto nei tratti in cui tieni la quota, discesa e risalita escluse. Il proxy
  più diretto del controllo d'assetto: sotto 2 m/min la quota è tenuta bene;
- **velocità di risalita** su finestra mobile di 30 s, con il tempo passato oltre
  i limiti, distinguendo sopra e sotto i 10 m;
- **sosta di sicurezza** effettivamente eseguita fra 3 e 6 m;
- **tempo in deco e violazioni del tetto**, con la durata di ciascuna;
- **riserva di gas all'uscita**, PPO2 di picco, END sulle miscele con elio.

Ogni metrica dichiara la propria affidabilità. Un profilo campionato ogni 30 s
non permette di misurare la velocità di risalita come uno a 2 s, e l'app lo dice
invece di far finta.

**Costruisce un piano.** Dieci regole valutano l'archivio e producono un elenco
ordinato per priorità, con: i numeri su cui si basa il giudizio, un obiettivo
misurabile, e gli esercizi da fare in acqua. Più una scheda di preparazione
verso un obiettivo (passaggio al tecnico, profondo ricreativo, miglioramento
generale) con i criteri soddisfatti e quelli mancanti.

Tre principi, perché un consiglio sbagliato è peggio di nessun consiglio:

1. **Niente diagnosi senza dati.** Ogni regola dichiara un minimo di immersioni
   valide sotto il quale non si pronuncia affatto.
2. **Ogni giudizio porta il suo numero**, così è verificabile e contestabile.
3. **Niente consigli che sostituiscano un istruttore.** Sulla decompressione e
   sulla progressione in profondità il piano indica cosa guardare, non cosa fare.

**Tiene un solo archivio su più dispositivi.** Facoltativo: un database
libSQL/Turso condiviso, con indirizzo e token inseriti una volta nella scheda
*Sincronizza*. Il database locale resta la fonte di verità e la sincronizzazione
è un'operazione che lanci tu — l'app si apre e funziona identica senza rete,
perché un logbook si consulta anche in barca.

Cosa garantisce, e cosa no:

- **Non duplica.** L'identificativo di un'immersione dipende dal suo contenuto:
  la stessa immersione importata su due dispositivi resta una.
- **Riepilogo e profilo viaggiano separati.** Se un dispositivo ha le note e
  l'altro il profilo campione per campione, dopo la sincronizzazione entrambi
  hanno entrambi. Una regola sola per tutto il record perderebbe uno dei due.
- **Non cancella.** Eliminare un'immersione da un dispositivo non la elimina
  dagli altri: propagare le cancellazioni richiede un registro di ciò che è
  stato eliminato, e finché non c'è la scelta è dichiarata — meglio
  un'immersione di troppo che una perduta.
- **Sincronizzare due volte di fila non fa niente la seconda volta.** È la
  proprietà su cui insistono i test: un piano non idempotente fa rimpallare le
  immersioni fra due dispositivi per sempre.

Il token non è nel codice e non è nel repository: vive nelle impostazioni
dell'archivio locale, sul dispositivo dove lo hai incollato.

---

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run dev` | sviluppo nel browser (dati in IndexedDB) |
| `npm run desktop` | app desktop in sviluppo (dati in SQLite) |
| `npm run desktop:build` | `.app` + `.dmg` per macOS (vedi la firma, sotto) |
| `npm test` | 1097 test su unità, parser, formati binari Uwatec e Shearwater, gzip/DEFLATE, lettore SQLite, metriche, deduplica, fusi orari, sincronizzazione, piano, grafici |
| `npm run validate:logtrak <file>` | verifica il decoder Uwatec contro un export LogTRAK reale |
| `npm run validate:pnf <file.db>` | verifica il decoder Shearwater contro un database di Shearwater Cloud reale |
| `npm run typecheck` | controllo dei tipi |
| `npm run demo` | rigenera i file dimostrativi in `demo/` |
| `npm run screenshot` | verifica visiva: apre la build e fotografa ogni vista |
| `npm run ios:init` | genera il progetto Xcode per iOS (vedi sotto) |
| `npm run ios:dev -- "iPhone 17 Pro"` | compila e lancia l'app sul simulatore |
| `npm run ios:build` | pacchetto `.ipa` firmato per un iPhone vero |
| `npm run ios:telefono` | compila, firma e lancia direttamente sul telefono collegato |

### L'app desktop, installata

`npm run desktop:build` produce `src-tauri/target/release/bundle/macos/MyDiveLog.app`
(circa 5 MB) e un `.dmg` accanto. L'app si trascina in `/Applications` e da li'
si apre come qualunque altra: **non serve il terminale, e non serve che Vite
giri.**

Usa lo stesso archivio della versione di sviluppo — stesso identificativo
`it.ferrando.mydivelog`, quindi stessa cartella
`~/Library/Application Support/it.ferrando.mydivelog/` — percio' non c'e' niente
da importare la prima volta che si apre.

**Firmarla conviene, e non per distribuirla.** Senza firma il bundle e' *ad hoc*:
funziona, ma la sua identita' cambia a ogni ricostruzione, e il portachiavi di
sistema riconosce le applicazioni proprio dalla firma — quindi ogni nuova build
ridiventa «un'altra app» che deve richiedere il permesso di leggere il token di
sincronizzazione e la chiave API. Con un certificato di sviluppo l'identita' e'
stabile e il permesso si concede una volta sola:

    APPLE_SIGNING_IDENTITY="Apple Development: <nome> (<ID>)" npm run desktop:build

Il nome esatto lo stampa `security find-identity -v -p codesigning`. Non sta in
`tauri.conf.json` di proposito: e' un dato personale, e questo repository e'
pubblico.

La notarizzazione — quella che serve perche' l'app si apra su un Mac **altrui**
senza avvisi — e' un passo ulteriore e richiede `APPLE_ID`, `APPLE_PASSWORD` e
`APPLE_TEAM_ID`. Per l'uso sulla propria macchina non serve.

---

## iOS

Il guscio iOS non e' una porta: e' lo stesso `src/` compilato dentro un progetto
Xcode che Tauri genera in `src-tauri/gen/apple/`. Quella cartella e' **generata e
non versionata**, e questo e' il fatto da cui discendono tutte le insidie qui
sotto: qualunque cosa si sistemi a mano dentro `gen/apple/` sparisce alla prima
rigenerazione, o semplicemente non esiste per chi clona il repository. La
configurazione deve stare a monte, in `src-tauri/tauri.conf.json` e in
`src-tauri/Info.ios.plist`, che sono versionati.

**CoreBluetooth va dichiarato, altrimenti non si arriva nemmeno a lanciare
l'app.** `btleplug` — il motore su cui poggia `tauri-plugin-blec` — chiama
CoreBluetooth via FFI: il codice Rust compila benissimo senza il framework,
perche' i simboli mancanti si scoprono solo al *link*. L'errore che si vede e'
`Undefined symbols for architecture arm64: _CBCentralManagerScanOptionAllowDuplicatesKey`
e simili, e non nomina ne' il Bluetooth ne' il plugin: sembra un guasto del
progetto Xcode. La cura sta in una riga di `tauri.conf.json`:

```json
"iOS": { "minimumSystemVersion": "14.0", "frameworks": ["CoreBluetooth"] }
```

Vale anche per il simulatore, che di CoreBluetooth ha solo la versione finta —
ma la versione finta va comunque linkata.

**`tauri ios init` non riscrive i file che trova gia' li'.** E' la trappola che
fa perdere piu' tempo: si aggiunge `frameworks` alla configurazione, si rilancia
`npm run ios:init`, il comando dice «Project generated successfully» e non e'
cambiato niente, perche' `gen/apple/project.yml` — il file dove finisce l'elenco
dei framework — esisteva gia'. Per far ripartire davvero la generazione bisogna
togliere di mezzo il file vecchio:

```sh
mv src-tauri/gen/apple/project.yml /tmp/project.yml.vecchio
npm run ios:init
```

e poi verificare che `- sdk: CoreBluetooth.framework` compaia davvero fra le
`dependencies` del target. In generale: dopo ogni modifica alla sezione `iOS`
della configurazione, controllare il `project.yml` risultante, non fidarsi del
messaggio di successo.

**Xcode «aggiorna alle impostazioni consigliate» e rompe la build.** Aprendo il
progetto, Xcode 26 propone l'aggiornamento e scrive nel `.xcodeproj`
`ENABLE_USER_SCRIPT_SANDBOXING = YES`. Con quella impostazione la fase «Build
Rust Code» gira in una sandbox che le lascia leggere solo i file dichiarati come
input, e `tauri ios xcode-script` deve leggere `project.pbxproj`: il messaggio
che si vede e' `failed to read project.pbxproj file: Operation not permitted (os
error 1)`, che sembra un problema di permessi del disco e non lo e'. Il
`.xcodeproj` e' generato, quindi la cura e' rigenerarlo — ed e' il motivo per cui
`npm run ios:dev` e `npm run ios:build` fanno `tauri ios init` prima di
compilare: costa dieci secondi e toglie di mezzo tutta la categoria di guasti in
cui Xcode modifica un progetto che non e' suo. Se Xcode lo propone, rispondere di
no.

**I permessi stanno in `src-tauri/Info.ios.plist`.** Tauri lo fonde con
l'`Info.plist` generato, ma **al momento della build, non dell'init**: subito
dopo `ios:init` il plist in `gen/apple/` non contiene ancora
`NSBluetoothAlwaysUsageDescription`, e questo e' normale. Si verifica dopo un
`ios:dev`, con
`plutil -p src-tauri/gen/apple/mydivelog_iOS/Info.plist | grep -i bluetooth`.
Senza quella chiave iOS 13+ non fa nemmeno partire CoreBluetooth, e il sintomo e'
l'app terminata dal sistema al primo scan: assomiglia a un crash nostro.

**Su iPhone i file non si «scaricano».** Dentro la WKWebView un `<a download>`
non fa niente e — questa e' la parte pericolosa — non lancia nessun errore: il
codice JavaScript non ha modo di accorgersene, quindi l'interfaccia dichiarava
«Backup scritto» senza aver scritto niente. Tutte le esportazioni passano ora da
`src/ui/esporta.ts`, che su iOS chiama un comando Rust
(`esporta_nei_documenti`) e scrive nella cartella Documenti dell'app — visibile
nell'app File grazie alle due chiavi di `Info.ios.plist` — e che **lancia**
quando non riesce. Un test di sorgente (`tests/iosGuardie.test.ts`) impedisce
che ne rinasca una quarta copia: era gia' successo tre volte.

**La CSP deve nominare i servizi esterni, o l'app impacchettata non li
raggiunge.** `app.security.csp` in `tauri.conf.json` diceva
`connect-src 'self' ipc: http://ipc.localhost`, e con quella riga la webview
BLOCCA ogni chiamata a Turso e all'API di Anthropic. Non si vedeva sviluppando,
perche' `npm run dev` gira in un browser normale dove quella CSP non esiste: si
vedeva solo nell'app vera, come credenziali «che non funzionano». Ora
`connect-src` elenca `https://*.turso.io` e `https://api.anthropic.com`, e non
deve elencare altro — la CSP e' la lista di dove l'app puo' parlare, e ogni voce
in piu' e' una porta aperta.

**Le icone iOS vanno QUADRATE.** Il marchio ha gli angoli arrotondati perche' su
macOS se li deve disegnare da se'; iOS applica la propria maschera a quadrato
stondato, quindi un'immagine gia' stondata viene stondata due volte e negli
angoli compare il colore con cui Tauri ha riempito la trasparenza — bianco, che
sul telefono si vede come un alone. `src-tauri/icons/ios/` contiene percio' i
render QUADRATI e opachi dello stesso disegno; `tauri ios init` non li ricopia
dentro `gen/apple` se ci sono gia' file, quindi la copia la fanno gli script
`ios:*`.

**`libapp.a` va tolta dalle risorse del progetto generato.** XcodeGen mette la
libreria statica di Rust in «Copy Bundle Resources» perche' la trova fra le
sorgenti: l'app pesava **470 MB** invece di 6, e con entrambe le architetture
presenti la build si fermava su `Multiple commands produce .../libapp.a`.
`scripts/pulisci-progetto-ios.mjs` toglie quella voce dopo ogni
`tauri ios init`; se un giorno Tauri lo risolve, lo script se ne accorge e non
fa niente.

**Mettere l'app su un iPhone vero.** Due comandi, e l'app resta sul telefono con
l'interfaccia impacchettata dentro — non dipende dal Mac acceso, a differenza di
`ios:dev` che serve la pagina da Vite:

    npm run ios:build -- --export-method debugging
    xcrun devicectl device install app --device <UDID> \
      src-tauri/gen/apple/build/arm64/MyDiveLog.ipa

C'e' anche `npm run ios:telefono` (`tauri ios run --release`), che farebbe tutto
in un colpo, ma **oggi non arriva in fondo**: sbaglia il percorso di un proprio
file temporaneo e muore con `Couldn't load -exportOptionsPlist`. Resta nello
script perche' e' un difetto del CLI di Tauri che prima o poi sara' corretto.

Due condizioni: sul telefono dev'essere attiva **Modalita' sviluppatore**
(Impostazioni → Privacy e sicurezza), obbligatoria da iOS 16, e il telefono
dev'essere **registrato sul team** prima della prima build. Quella registrazione
Tauri non sa farla: passa a Xcode `-allowProvisioningUpdates` ma non
`-allowProvisioningDeviceRegistration`, quindi anche col telefono collegato Apple
risponde `Your team has no devices from which to generate a provisioning
profile`. Si fa una volta sola, a mano, col telefono collegato:

    cd src-tauri/gen/apple
    xcodebuild -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
      -scheme mydivelog_iOS -workspace ./mydivelog.xcodeproj/project.xcworkspace/ \
      -sdk iphoneos -configuration release -destination "id=<UDID del telefono>" build

Quel comando fallisce alla fine — la fase «Build Rust Code» vuole il CLI di Tauri
che la orchestri — ma prima di fallire registra il dispositivo e fa emettere il
profilo, che e' tutto quello che serve. Da li' in poi bastano gli script npm.

**Quanto dura la firma.** Con l'Apple Developer Program a pagamento il profilo
vale **un anno**. Con un **Personal Team** — l'account gratuito — dura **sette
giorni**: dopo, l'app non si apre piu' e va reinstallata con gli stessi due
comandi. In entrambi i casi reinstallare SOPRA conserva l'archivio; cancellare
l'app lo butta, ed e' uno dei motivi per cui la sincronizzazione non e' un
accessorio.

**Su iPhone non si stampa, e il pulsante non c'e'.** La stampa apre una finestra
nuova col foglio impaginato e passa la parola alla finestra di stampa del
sistema: dentro la WKWebView non esiste ne' l'una ne' l'altra — `window.open`
restituisce null e `window.print()` non fa niente. I due pulsanti (scheda
immersione e piano) sono nascosti da `!suIOS()`: prima restavano visibili e,
premuti, davano la colpa al blocco dei popup, cioe' mandavano a cercare
un'impostazione inesistente per un problema che non era quello. Il foglio si
stampa dal Mac, dove l'archivio e' lo stesso.

**iOS non manda gli eventi del mouse.** `mousemove` e `mouseenter` non esistono
sotto il dito: un grafico che li usa non risponde e non segnala niente. Vale per
`onMouseMove`, `onMouseEnter`, `onMouseLeave` e anche per un
`addEventListener('mousedown')` sul documento, che iOS sintetizza solo sugli
elementi che considera cliccabili. Si usano gli eventi del puntatore, e lo
stesso test di sorgente lo verifica.

**Il permesso Bluetooth negato non produce nessun errore.**
`checkPermissions` di `tauri-plugin-blec` e' implementato solo per Android e
altrove risponde sempre di si'; lo stato dell'adattatore ha tre valori e nessuno
significa «non autorizzato». Chi tocca «Non consentire» si ritrova una ricerca
che gira a vuoto per sempre. Non potendo distinguerlo da «nessun computer acceso
qui intorno», dopo dodici secondi di ricerca infruttuosa l'app elenca le tre
cause possibili e dice dove si controlla il permesso — che su iPhone e'
Impostazioni → MyDiveLog → Bluetooth, non il pannello di macOS.

**Il simulatore non ha Bluetooth vero.** Serve a verificare layout, navigazione,
import da file e tutto il resto; per provare lo scarico da un computer subacqueo
serve un iPhone fisico, e quindi la firma con un account Apple.

---

## Struttura

```
src/
  core/                      ← logica pura, nessuna dipendenza da piattaforma
    model.ts                   modello canonico e unità di misura
    units.ts                   conversioni e fisica dell'immersione
    dedupe.ts                  riconoscimento della stessa immersione
    parsers/                   un file per formato + rilevamento
      uwatecSmart.ts             decoder del bitstream binario Scubapro/Uwatec
      shearwaterPnf.ts           decoder del log nativo dei computer Shearwater
      inflate.ts                 gzip e DEFLATE, senza dipendenze
      sqliteReader.ts            lettore di file SQLite, senza dipendenze
    analysis/
      metrics.ts               metriche per singola immersione
      aggregate.ts             statistiche, tendenze, correlazioni, distribuzioni
      coaching.ts              regole del piano di miglioramento
      window.ts                finestra temporale (12 mesi per difetto)
  storage/                   ← due implementazioni, una interfaccia
    sqlite.ts                  desktop e iOS
    indexeddb.ts               web
    repair.ts                  ricalcolo delle metriche incoerenti all'avvio
  sync/                      ← database condiviso, facoltativo
    plan.ts                    cosa spostare e in che direzione (senza rete)
    turso.ts                   trasporto libSQL + schema remoto
  ai/                        ← analisi con Claude, facoltativa
    client.ts                  API di Anthropic, modello scelto dall'utente
    context.ts                 i dati misurati, compattati per il prompt
    prompts.ts                 istruzioni: niente numeri inventati
  ui/                        ← React: pagine, grafici, stato
src-tauri/                   ← guscio nativo (solo il plugin SQL)
tests/                       ← test + generatore di immersioni sintetiche
```

Tutto quello che conta sta in `src/core`: non importa niente, non conosce React
né Tauri, e viene riusato identico su desktop, iOS e web. Il guscio nativo fa
una cosa sola — aprire un vero file SQLite — perché è l'unica che il web non può
fare.

Dettagli sulle scelte di architettura e sul percorso verso iOS e web:
[`docs/architettura.md`](docs/architettura.md).

---

## Le insidie dei formati, in breve

Documentate nei commenti di ciascun parser, perché sono la ragione per cui i
logbook fatti in casa danno numeri sbagliati:

- **UDDF è interamente SI.** `<tankpressure>20000000</tankpressure>` sono 200
  bar, non 20 milioni di qualcosa. La temperatura è in Kelvin, il volume in
  metri cubi, le frazioni di gas fra 0 e 1.
- **Shearwater salva la pressione bombola in MEZZI PSI.** Il valore va
  moltiplicato per 2 prima di convertirlo, e il fattore non è nel nome del
  campo. Il flag `imperialUnits` decide come leggere profondità e temperatura
  *nello stesso file*; `startSurfacePressure` è in millibar.
- **I campioni Subsurface sono delta-codificati.** Un attributo assente non vuol
  dire "sconosciuto", vuol dire "come prima". Un parser che non riporta avanti i
  valori produce profili di temperatura a buchi.
- **Nel FIT la pressione bombola non sta nei record.** Sta in messaggi
  `tank_update` separati, da agganciare per timestamp. E il volume della bombola
  non esiste: viene dedotto da `tank_summary`.
- **`<divelog>` e `<diveLog>` sono formati diversi.** Un confronto
  case-insensitive manda i file Shearwater nel parser Subsurface.
- **Nel binario Uwatec l'intestazione è little endian e i dati dentro un record
  sono big endian.** Non è un errore di trascrizione, sono davvero diversi. I
  campioni sono un bitstream a lunghezza variabile con delta a 4 e 7 bit *con
  segno*: `0x7F` è −1, non 127. Un bit letto male non dà errore, dà un profilo
  plausibile e falso.
- **`deviceTypeNumber` 21 e 23 sono due computer diversi con intestazioni di
  dimensione diversa** (152 e 84 byte), e LogTRAK chiama entrambi
  `aladin_sport`. Fidarsi della stringa invece del numero significa leggere i
  campioni dall'offset sbagliato.
- **Il computer registra anche i minuti passati in superficie dopo la risalita.**
  Su un'immersione da 35 minuti ho trovato 5 minuti di zeri in coda: lasciarli
  dentro abbassa la profondità media e falsa il consumo.

- **Nel formato dei record SQLite la soglia del payload locale va calcolata con
  aritmetica INTERA.** Riprodurla con i float sbaglia di un byte su pagine da 512,
  il puntatore alla pagina di overflow viene letto dal posto sbagliato e il blob
  esce troncato senza nessun errore. Con dati tutti a zero non si nota nemmeno.

La deduplica è la stessa euristica di Subsurface (`dive::likely_same`), portata
in TypeScript: finestra temporale variabile pari a metà della durata
dell'immersione più lunga, con un minimo di 60 secondi, più controlli
proporzionali su profondità e durata. La finestra variabile è ciò che la fa
funzionare con computer i cui orologi vanno alla deriva; i controlli su
profondità e durata sono ciò che evita di fondere due immersioni ripetitive
fatte sullo stesso sito.

A questo si aggiunge il riconoscimento degli **sfasamenti fra orologi**. Due
computer allo stesso polso possono avere l'ora impostata diversamente — uno su
UTC, l'altro sull'ora locale, o uno che non ha ricevuto il cambio dell'ora legale
— e in quel caso la stessa immersione risulta a un'ora di distanza in ogni
confronto. `inferClockOffsets` stima gli scarti guardando la *distribuzione* delle
differenze fra immersioni che coincidono per profondità e durata: se molte si
accumulano attorno allo stesso valore, quello è lo sfasamento. Ne riconosce anche
più di uno per import, perché nei dati reali accade che un orologio venga corretto
a metà dello storico.

---

## Test

```bash
npm test
```

Il test che conta di più: la stessa immersione sintetica, scritta in sei formati
con sei convenzioni di unità diverse, deve tornare identica nel modello canonico.
Se qualcuno dimentica il fattore 2 dei mezzi PSI o legge i Pascal come bar, il
test lo prende prima dell'utente.

Per il binario Uwatec i test fanno un round-trip: `tests/fixtures.ts` contiene un
encoder che produce blob validi con profondità e temperature *scelte*, e il
decoder deve restituirle. Più i controlli che valgono su qualunque file — byte
consumati pari a quelli dichiarati, unità dell'intestazione, estensione del segno
sui delta negativi.

I dati di prova sono generati, non registrati: `tests/fixtures.ts` costruisce
profili con consumo, assetto e velocità di risalita *scelti*, così i test
possono verificare che le metriche ricostruiscano i valori di partenza.

---

## Privacy

Nessun dato lascia il dispositivo, a meno che tu non colleghi un database
condiviso dalla scheda *Sincronizza*: in quel caso, e solo quando premi
**Sincronizza**, immersioni e profili vengono inviati al database che hai
indicato tu. Non c'è account, non c'è telemetria, non c'è nessun altro
destinatario. Il token resta nelle impostazioni dell'archivio locale e non è nel
repository.

Su desktop il database è un file SQLite nella cartella dati
dell'app: copiabile, versionabile e ispezionabile con qualsiasi strumento
SQLite. Il guscio nativo ha i permessi del solo plugin SQL — niente shell,
niente accesso al filesystem arbitrario.

---

## Licenza e riconoscimenti

MIT — vedi [LICENSE](LICENSE).

I decoder binari di `src/core/parsers/uwatecSmart.ts` (Uwatec Smart) e
`src/core/parsers/shearwaterPnf.ts` (log nativo Shearwater) sono stati riscritti
leggendo i sorgenti di [libdivecomputer](https://libdivecomputer.org), che è
LGPL-2.1: senza quel lavoro di reverse engineering, durato anni e fatto da altri,
questi formati sarebbero illeggibili. Il debito è dichiarato in testa ai due file.

L'algoritmo Bühlmann ZH-L16C è di Albert A. Bühlmann; l'interpolazione dei
gradient factor segue il lavoro di Erik Baker. VPM-B è di David E. Yount,
Eric B. Maiken e Erik C. Baker. Le tabelle CNS e OTU vengono dal NOAA Diving
Manual.
