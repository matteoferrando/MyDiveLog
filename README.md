# MyDiveLog

Logbook subacqueo che importa da computer diversi, calcola statistiche e ne
ricava un piano di miglioramento.

App desktop macOS (Tauri), con lo stesso codice pronto per iOS e per il web.

---

## Provalo in due minuti

```bash
npm install
npm run demo      # genera 5 file dimostrativi in demo/
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
| `npm run desktop:build` | `.app` + `.dmg` per macOS |
| `npm test` | 262 test su unità, parser, formati binari Uwatec e Shearwater, gzip/DEFLATE, lettore SQLite, metriche, deduplica, fusi orari, sincronizzazione, piano, grafici |
| `npm run validate:logtrak <file>` | verifica il decoder Uwatec contro un export LogTRAK reale |
| `npm run validate:pnf <file.db>` | verifica il decoder Shearwater contro un database di Shearwater Cloud reale |
| `npm run typecheck` | controllo dei tipi |
| `npm run demo` | rigenera i file dimostrativi in `demo/` |
| `npm run screenshot` | verifica visiva: apre la build e fotografa ogni vista |
| `npm run ios:init` | inizializza il progetto Xcode per iOS (vedi sotto) |

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
