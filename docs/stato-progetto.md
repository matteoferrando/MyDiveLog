# MyDiveLog — stato del progetto

Aggiornato: **1 settembre 2026, sera** — commit `2602e11` su `main`, albero
pulito, **CI verde** (run `33506132662`, 7m51s), **1749 prove in 98 file**, e il
lint che per la prima volta **non ha niente da dire: 0 errori e 0 avvisi**, dove
per settimane ne stavano quattordici. Nel repository c'è la **1.7.1**, e **le
piattaforme sono cinque**: il 31 agosto è entrata **Linux**, con un `.deb`. È l'unica delle
tre che non si costruiscono sul Mac ad essere stata **fatta partire davvero**
prima di essere pubblicata — vedi «Linux, la quinta piattaforma».

*(Il 29 e il 31 agosto ci sono state tre giornate sul solo sito, raccontate in
«Il sito, il 29 agosto» e nei documenti di progetto. L'1 settembre l'apertura è
diventata una scena animata: due schermate e una tendina, solo su desktop.)*

**► E LA 1.7.1 È SUI DUE NEGOZI APPLE. ◄** Su **App Store per iPhone** dal **28
agosto alle 21:25:04 UTC** — misurato col `lookup` e con l'anti-cache in coda,
non dedotto — e sul **Mac App Store**, dichiarato dal proprietario l'1 settembre.
Quindi la voce «consegnare la 1.7.1 ai due negozi», che stava in testa ai
prossimi passi, **è chiusa**: per la prima volta da quando esistono, i tre numeri
che contano — quello nel repository, quello che il negozio iOS consegna a un
estraneo e quello del Mac App Store — **dicono tutti e tre 1.7.1**.

> ### ► IL SITO NON SI RILASCIA: SI RIPUBBLICA — ED È STATO RIPUBBLICATO ◄
>
> Questo riquadro, fino alla sera dell'1 settembre, diceva che il sito era
> **indietro**: sul disco `b425e252`, e la pagina servita senza la scena
> dell'apertura. **Adesso non è più vero, e la differenza si misura invece di
> crederla.** Impronta sul disco e impronta servita coincidono su
> **`8b2ca48d`**, la pagina pubblicata contiene `class="scena"`, e `/aiuto`
> risponde `200` — cioè anche le due pagine nuove sono là fuori.
>
> ```
> npx wrangler pages deploy sito --project-name mydivelog-sito
> curl -s "https://mydivelog.site/?t=$(date +%s)" | grep -o 'stile.css?v=[0-9a-f]*'
> curl -s -o /dev/null -w "%{http_code}\n" https://mydivelog.site/aiuto
> ```
>
> **Il riquadro resta scritto anche adesso che la risposta è quella giusta**, e
> non è pigrizia: *l'impronta che serve a far scadere la cache è la stessa che
> risponde gratis alla domanda «cosa c'è pubblicato»*, e un documento che
> cancella la domanda appena la risposta gli piace lascia chi legge senza il modo
> di rifarla. Il giorno che quel comando risponde qualcos'altro, il sito è di
> nuovo indietro.

### Su Mac si installa anche con Homebrew, da un tap nostro

```
brew tap matteoferrando/mydivelog
brew install --cask mydivelog
```

**Non è in `homebrew-cask` ufficiale, ed è una scelta obbligata.** La policy di
Homebrew chiede una prova di interesse pubblico oltre l'autore: **30 fork, 30
watcher o 75 stelle** se la cask la propone qualcun altro, **90 fork, 90 watcher
o 225 stelle** se la propone il proprietario del repository. In più, un
repository più giovane di **trenta giorni** di norma non è ammissibile. Misurato
l'1 settembre: **0 stelle, 0 fork, 0 watcher**, repository creato il 18 agosto.
Proporla oggi vuol dire un rifiuto, e un rifiuto resta nella memoria dei
manutentori. Un tap non ha soglie, e la cask è la stessa: si sposta senza
riscriverla.

**Quello che era già a posto e conta:** la policy pretende che l'applicazione
passi Gatekeeper senza disattivare protezioni, e il `.dmg` è firmato Developer ID
e notarizzato.

**La cask è generata**, da `npm run cask`. L'impronta viene dall'API di GitHub —
cioè è calcolata sul file che GitHub sta davvero servendo, non su quello
costruito in locale — e con `--dmg` si pretende che le due combacino. Una cask
scritta a mano prima o poi porta la versione nuova e l'impronta della precedente,
e a scoprirlo è chi prova a installare.

> **brew è l'unico giudice che conta, e va interpellato prima di pubblicare.** La
> prima versione passava le nostre sette prove, e brew alla prima lettura ha
> segnalato una forma deprecata — `depends_on macos: ">= :monterey"` invece del
> simbolo nudo — che avrebbe stampato un avviso a ogni comando di chiunque.
> *Nessuna prova di testo sa quali forme Homebrew abbia deprecato la settimana
> scorsa.*

Verificato dall'esterno, non dedotto: `brew info` legge versione, `auto_updates`
e i due requisiti (arm64, macOS ≥ 12); `brew fetch` **scarica il file e conferma
l'impronta**; `brew audit --cask --online` non trova niente ed esce zero.

### Cosa è stato corretto nella documentazione l'1 settembre

Tre cose che questo repository **raccontava male**, tutte trovate cercandole di
proposito e nessuna delle quali era un difetto del programma:

- Il README diceva «**non c'è un pacchetto per Mac Intel né per Linux**» mentre
  la CI ne costruiva uno, il sito lo linkava e *questo* documento scriveva che le
  piattaforme sono cinque. Due file dello stesso repository che si
  contraddicono, e quello che la gente legge per primo era quello che negava.
- L'accesso **«Accedi con Apple»** — 155 righe nell'app, 441 nel Worker, 531 di
  prove — non era nominato **da nessuna parte** nella documentazione principale:
  la sezione si chiamava «Accesso con Google, facoltativo» e l'albero dei file
  elencava `googleAccesso.ts` e non `appleAccesso.ts`. Era documentato solo in
  `server/README.md`, dentro una sottocartella. Chi l'ha cercato non l'ha
  trovato.
- Il commento in testa a `src/core/ble/catalogo.ts` diceva «restano **110
  modelli** e 20 marche, un elenco di **110 voci**»: le voci sono **105**. Il 110
  è vero — sono i descrittori BLE della libreria — ma un nome commerciale porta
  più numeri di modello e nell'elenco compare una volta sola. Due cose diverse
  chiamate con lo stesso numero.

Da qui due file di prove nuovi, perché **nessun comando legge i commenti e
nessun comando legge il README**:

- `tests/documentazione.test.ts` — per ogni pacchetto che i workflow
  costruiscono davvero, il README lo nomina; per ogni fornitore d'accesso che il
  servizio implementa davvero, il **titolo** della sezione lo nomina; nessuna
  frase nega una piattaforma che esiste. Non chiede «il README dica Linux»:
  chiede che il racconto combaci coi fatti, e vale anche per la piattaforma che
  verrà dopo.
- In `tests/catalogoComputer.test.ts`, i numeri scritti nei commenti vengono
  confrontati con l'array vero.

*Un numero che nessuno verifica è un aggettivo travestito.*

### La sera dell'1 settembre: le azioni deprecate, e un travaso che non si leggeva

Due cose, e la seconda vale più della prima.

**Le GitHub Actions deprecate salgono di versione**, ed è **`v6` e non `v5`** il
punto: `actions/upload-artifact@v5` gira **ancora su Node 20**, ed è la v6 la
prima a passare a node24. *Il salto ovvio — quello che verrebbe da fare leggendo
«esiste la v5» — non avrebbe tolto l'avviso, e avrebbe lasciato addosso la
sensazione di averlo tolto.* Con lui `setup-java@v5`, e `checkout@v5` nel flusso
del tap. Una prova nuova in `documentazione.test.ts` impedisce che rientri dalla
porta di dietro: **la stessa azione non può comparire a due versioni diverse fra
i flussi.** Non sa quale sia quella giusta — non può saperlo, la risposta sta su
GitHub e cambia — ma sa che due versioni della stessa azione sono comunque un
errore, perché una delle due è vecchia.

**E il travaso delle segnalazioni.** Il comando è partito davvero, ha letto
l'archivio, ha detto «da travasare: 1», ha chiamato Google e ha risposto:

```
✗ 2026-08-26T…  →  401 «<!DOCTYPE html>… <title>Pagina non trovata</title>…
(e altre novecento righe di HTML)
```

**Due guasti, e nessuno dei due era il travaso.**

Il primo: l'indirizzo finiva per **`/dev`** invece che per **`/exec`**. Sono i
due indirizzi a cui Google pubblica ogni Apps Script, si somigliano fino
all'ultimo pezzo, e quello sbagliato è **proprio quello che l'editor tiene sotto
mano** — risponde solo al proprietario dentro un browser collegato, e da uno
script non risponde mai. Adesso si controlla **prima** della chiamata, e il
messaggio nomina `/dev` e nomina `/exec`: *un «indirizzo non valido» avrebbe
rimandato a cercare nel posto sbagliato esattamente come faceva il 401.*

Il secondo, che è quello costato di più: la riga d'errore **riversava nel
terminale la pagina HTML intera**, che scorrendo cancellava tutto quello che
c'era prima — compreso l'elenco delle segnalazioni. Di quella pagina l'unica cosa
che informava erano quattro parole dentro un `<title>`, ed erano **l'unica cosa
invisibile**. Adesso di una risposta HTML si tiene il titolo e si butta il resto.

Undici prove nuove in `tests/travasoSegnalazioni.test.ts`, tutte viste rosse su
una mutazione ciascuna. **Due non guardano il comportamento ma il codice**: che
il controllo dell'indirizzo stia *prima* del `fetch` e non dopo, e che la riga
d'errore usi il riassunto e non il corpo grezzo. *Una funzione giusta che nessuno
chiama è una funzione che non esiste.* E lo script adesso esporta le due funzioni
pure e lancia `main()` **solo se è stato eseguito**: importato da una prova non
deve mettersi a parlare con Cloudflare.

---

## Il 28 agosto: il primo utente esterno, e le due cose che ha trovato in una riga

**Ha installato l'app sull'iPhone, ha premuto «Cerca il computer» avendo negato
il permesso Bluetooth, e ha letto a schermo questo:**

```
La ricerca non è partita: Btleplug error: Permission denied
```

**Quella riga smentisce da sola un limite che questo documento dichiarava da
mesi.** Fra i **limiti noti** c'era scritto che «il permesso Bluetooth negato è
indistinguibile da _nessun computer qui intorno_». Non è vero: l'errore esiste,
ha un nome, e lo lancia **`scan()`**. Non lo danno né `getAdapterState` né
`checkPermissions` — per quei due il ragionamento vecchio resta valido, e sono
esattamente i due posti in cui si era guardato. _Si erano guardati i due posti in
cui l'informazione non c'era, e non il terzo in cui c'era_ — e la conclusione era
finita scritta in **due commenti del codice come se fosse stata misurata**.

> ### ► NESSUN TEST POTEVA PRENDERLO ◄
>
> Per vedere quella riga serve un telefono su cui qualcuno abbia detto di no, e
> su quelli di casa era stato detto di sì **una volta per sempre**. Non è un buco
> della copertura e non è una svista di chi scrive le prove: è il genere di
> difetto che si vede solo quando lo tocca **una persona che non sa cosa sta per
> fare**. Ci sono voluti mesi e un estraneo.

**E sotto ce n'era un secondo, indipendente e più generale — e più grave del
primo.** Quel messaggio mostrava **il nome di una libreria**, `Btleplug`, a una
persona, in inglese, dentro un'app italiana. Chi legge non impara niente e non sa
cosa fare: non gli si dice che ha negato un permesso, non gli si dice dove
riaccenderlo, non gli si dice nemmeno che il problema è suo e risolvibile.
_Sembra soltanto che l'app si sia rotta._ Il permesso negato è solo il caso che
ha fatto emergere la regola: **il nome di una dipendenza non è mai una risposta a
una domanda di un utente.**

**La macchina per rispondere bene c'era già, e nessuno l'aveva accesa.** Il tipo
`BleUnavailable` ha `denied` e `off` **da sempre**, e i loro testi erano già
tradotti, col percorso delle impostazioni giusto per ogni sistema. Il ramo della
ricerca fallita, invece, metteva `unsupported` fisso e ci appendeva `err.message`
— cioè scartava la classificazione che aveva in casa e stampava la stringa della
libreria. _Non mancava il codice per dare la risposta giusta: mancava chi la
chiamasse._

**La correzione è il commit `29b51a0`.** Un modulo nuovo,
`src/core/ble/causaGuasto.ts` — `causaDelGuasto()` che riconosce la causa vera,
`dettaglioLeggibile()` che decide cosa si può mostrare, `NOMI_INTERNI` che è
l'elenco di quello che non esce mai — e un test nuovo,
`tests/permessoBluetooth.test.ts`, **nove prove, viste rosse rimettendo il ramo
di prima**. Per il caso che non si riesce a classificare il dettaglio tecnico
viene ripulito, e **se non si può ripulire non si mostra affatto**: meglio una
frase in italiano che non spiega tutto, che una riga inglese che non spiega
niente e spaventa.

> **La guardia nuova si è accesa due volte su sé stessa, e aveva ragione il
> codice.** Nella sua prima forma pretendeva che l'elenco dei nomi da nascondere
> coprisse **tutte le dipendenze di `package.json`**, ed è diventata rossa due
> volte di fila:
>
> - su **`@garmin/fitsdk`** — ma «garmin» nel catalogo dei computer è una
>   **marca**, che nominiamo apposta, e a chi cerca il suo Descent la parola
>   Garmin dobbiamo dirla;
> - su «rust», che si accendeva dentro «t**hrust**», in una frase inglese del
>   piano di miglioramento.
>
> La regola è diventata più stretta e più vera: **si nascondono i livelli sotto
> l'interfaccia, non le dipendenze.** Con due eccezioni dichiarate, ciascuna col
> suo motivo scritto: **`libdivecomputer`**, perché l'attribuzione LGPL deve
> restare visibile e l'etichetta «via libdivecomputer, mai provato su questo
> modello» dice a chi sceglie una cosa vera e utile; e **`SQLite`**, per la riga
> che dice dove stanno i dati. _Una guardia che si accende su un nome che
> vogliamo dire non è severa: è sbagliata, e insegna a spegnerla._

---

## Dove sta il codice

Su GitHub: `matteoferrando/MyDiveLog`, pubblico, MIT.

**I pacchetti firmati per i negozi stanno fuori dal repository**, e sono tenuti
separati perché **le firme non sono intercambiabili**: quella del negozio non si
installa sul telefono, quella di sviluppo non si carica su App Store Connect.
Stanno fuori perché `src-tauri/gen/apple/` viene rigenerata a ogni build, e il
pacchetto che c'è dentro viene sovrascritto dalla compilazione successiva, dieci
minuti dopo. Le versioni già consegnate si conservano ma **non si ricaricano**:
App Store Connect rifiuta un numero di versione già visto.

> **La differenza fra i due pacchetti iOS è verificabile, e conviene farlo invece
> di fidarsi del nome del file.** Estraendo `embedded.mobileprovision` dal `.ipa`
> e leggendolo con `security cms -D`, quello del telefono è `iOS Team
> Provisioning Profile` con l'UDID dell'iPhone elencato e `get-task-allow: true`;
> quello del negozio è `iOS Team Store Provisioning Profile`, **nessun
> dispositivo elencato** e `get-task-allow: false`. È `get-task-allow` — il
> permesso di attaccare un debugger — **il campo che fa rifiutare da Transporter
> un pacchetto di sviluppo**; nell'altra direzione è la lista dei dispositivi
> vuota a rendere impossibile installare a mano un pacchetto del negozio.
>
> Il nome del file è un'etichetta scritta a mano, e un'etichetta può essere
> sbagliata: quando la risposta conta, si guarda dentro.

CI «Controlli» a ogni push: Tipi → Formato → Lint → Test → Test fusi orari →
Build.

**Stato dei controlli, misurato l'1 settembre sul commit `2602e11`:**

| Comando | Esito |
| --- | --- |
| `npx vitest run` | **1749 test in 98 file, tutti verdi** |
| `npx tsc --noEmit` | pulito, nessuna riga in uscita |
| `npx prettier --check .` | _All matched files use Prettier code style!_ |
| `npm run lint` | **0 errori e 0 avvisi** — erano quattordici |

> **I quattordici avvisi non sono stati messi a tacere: sono stati letti**, ed è
> il motivo per cui questa riga vale la pena di essere guardata. Dentro quel
> mucchio, che da settimane si scorreva senza fermarsi perché «sono i soliti
> quattordici», stava **un orologio fermo**: `Logbook.tsx` calcolava il briefing
> della prossima immersione con un `Date.now()` congelato al primo disegno, e
> dopo sei ore di applicazione aperta continuava a dire mezz'ora. _Il numero
> quattordici era diventato il modo di non leggerli._

_(Il 26 agosto erano 1523 test in 82 file; il 27 sera 1540 in 85 — i sei aggiunti
quella sera, e il file in più, erano `tests/macNegozio.test.ts`. I nove aggiunti
il 28 mattina e il file in più sono `tests/permessoBluetooth.test.ts`; le quattro
guardie del pomeriggio portano a 1607 in 90. **Il 29 le trentaquattro prove di
`tests/sitoNavigazione.test.ts` portano a 1641 in 91, e le otto di
`tests/androidNegozio.test.ts` a 1649 in 92.** Gli avvisi del lint sono
rimasti 14 per tutto il tragitto: se diventano quindici, qualcuno ne ha aggiunto
uno.)_

> **Attenzione a `npx prettier --check .` sui documenti: passa a vuoto.**
> `.prettierignore` contiene `*.md` e `docs`, quindi quel verde non dice niente
> sul markdown — dice solo che i file che prettier guarda sono a posto. _Una
> verifica che esclude quello che si sta cambiando risponde verde con la stessa
> faccia di una che lo controlla._

---

## Il Mac App Store: il secondo negozio

Il `.pkg` del negozio e il `.dmg` del sito **non sono lo stesso programma con un
involucro diverso**: firma da negozio invece di Developer ID, **sandbox accesa**
con sette entitlements, e **l'aggiornatore tolto alla compilazione** — la feature
Rust `senza-aggiornamenti` spegne il plugin, `VITE_SENZA_AGGIORNAMENTI=1` spegne
il pulsante. Una copia del negozio che si aggiorna da sola è motivo di rifiuto, e
un pulsante «cerca aggiornamenti» che non fa niente è peggio di nessun pulsante.
Tutto si costruisce con `scripts/pubblica-mac-negozio.sh`, che scambia
`tauri.conf.json` e lo ripristina con un `trap` anche se muore a metà.

**Le prime due consegne sono state respinte, e non da un revisore: da un
controllo automatico, dopo una compilazione intera.**

1. **«supports arm64 but not Intel… deployment target must be 12.0 or higher».**
   `minimumSystemVersion` diceva `10.15` mentre il binario è solo arm64. **La
   parte grave non è il rifiuto**: quel numero era falso **da sempre**, e il
   `.dmg` sul sito lo dichiarava agli utenti da settimane. Su un Mac Intel — o su
   un Mac fermo al Catalina — quel download **installa e non si apre**. Non l'ha
   scoperto un utente, non un test, non una rilettura: l'ha scoperto Apple, per
   un motivo che col sito non c'entrava niente. _Un numero scritto a mano che
   descrive il binario sbagliato è una bugia che non fa rumore._
2. **ITMS-91109: `com.apple.quarantine` sul profilo di provisioning.** Scaricato
   con Chrome, `cp` ne conserva gli attributi estesi, e la quarantena è finita
   **dentro** il pacchetto firmato. Ora `xattr -cr` dopo aver copiato il profilo
   e **prima** di firmare — l'ordine è tutto — con una verifica che stampa
   _nessuna quarantena nel pacchetto_.
3. **Consegna riuscita**, con **«Conformità mancante»**: la domanda doganale
   sulla crittografia, fatta a mano perché il pacchetto non portava la risposta
   dentro.

> **► LA RIGA CHE VALEVA PER DUE NEGOZI ERA SCRITTA IN UN FILE SOLO. ◄**
> `ITSAppUsesNonExemptEncryption` stava in `src-tauri/Info.ios.plist` da mesi,
> difesa da un test. Nel plist di macOS non c'era mai stata, e non se n'era
> accorto nessuno perché fino a quella sera **su macOS non si caricava niente**:
> a un `.dmg` la dogana non chiede niente. _Una dichiarazione che manca non
> produce un errore: produce un'attesa._
>
> Corretta nel commit `8e7964f`, e messa sotto guardia:
> **`tests/macNegozio.test.ts`**, sei prove, **tutte viste rosse mutando i file**
> prima di crederle. Le tre che non esistevano la sera prima sarebbero costate,
> ciascuna, quello che sono costate: una compilazione e una consegna a testa.

---

## Le segnalazioni dal sito: entravano in un cassetto senza maniglia

Il modulo del sito scriveva nel Worker, il Worker salvava in KV, e **il foglio di
Google non lo riempiva nessuno**: `sito/segnalazioni.gs` erano settantun righe di
Apps Script che nessuno chiamava. Il difetto vero però è un altro:
`wrangler.toml` rimandava «alla rotta `/segnalazioni.csv` in worker.ts», e
**quella rotta non è mai esistita**. Le segnalazioni entravano e non usciva
niente — che da fuori è indistinguibile da un modulo rotto.

Adesso il Worker, **dopo** aver salvato in KV e solo dopo, manda una copia
all'Apps Script del foglio: l'archivio è la verità, il foglio è la copia comoda
da leggere, quindi un guasto di Google costa una copia mancata e non una
segnalazione persa. La copia è protetta da una parola d'ordine che lo script
controlla **prima ancora di aprire il foglio**, e il Worker **legge il corpo
della risposta, non lo stato**, perché Apps Script risponde 200 anche quando
rifiuta. L'indirizzo dello script e la parola d'ordine sono segreti del Worker e
non entrano nel repository.

**La catena è stata collaudata e funziona.** Misurato il 27 agosto sull'archivio
vero: **due segnalazioni in tutto**, e quella arrivata quel giorno porta
`foglio: true`.

**E l'1 settembre è stata travasata anche l'altra**, la prova del 26 agosto, che
nel suo record non aveva proprio il campo `foglio`. Fino a quel giorno **non
travasarla era una decisione del proprietario**, ed era scritta qui apposta,
perché un contatore fermo su un numero diverso da zero senza una riga che dica
perché, in tre mesi, diventa un guasto da cercare. *La decisione è stata
ribaltata da chi l'aveva presa, e la riga che la spiegava se ne va con lei* —
resta qui, in questa forma, perché una riga che sparisce senza traccia lascia chi
rilegge senza sapere se sia stata chiusa o dimenticata.

Il travaso è **dichiarato dal proprietario, non misurato da qui**. Il controllo
costa un comando che non tocca niente — senza `--scrivi` non scrive — e da oggi
deve rispondere `da travasare: 0`:

```
node scripts/travasa-segnalazioni.mjs
```

`scripts/travasa-segnalazioni.mjs` recupera quello che è rimasto indietro,
girando dal Mac via `wrangler` — che è già autenticato — e quindi **senza aprire
nessuna superficie nuova su Internet**. Parte sempre a vuoto e scrive solo con
`--scrivi`; i due valori che gli servono **li chiede alla tastiera**, con la
parola d'ordine che non compare a schermo, perché passarli dall'ambiente li
lascerebbe nella cronologia della shell in chiaro e per sempre, e nella riga di
comando del processo, che sulla stessa macchina legge chiunque con un `ps`.

Le prove nuove sono undici, dove non ce n'era nessuna:
`tests/segnalazioni.test.ts` (otto) e `tests/rotteDichiarate.test.ts` (tre).
Quest'ultimo confronta le rotte che `wrangler.toml` nomina **fra apici inversi**
con quelle che `worker.ts` serve davvero: rimettendo `/segnalazioni.csv` diventa
rosso con il difetto originale scritto nel messaggio.

> **È la quinta volta che questo progetto paga la stessa specie di guasto** — il
> gestore Rust registrato per due piattaforme su quattro, il file fuori dalla
> lista dei sorgenti, il numero sbagliato dentro un commento, una rotta promessa
> da un file di configurazione, e una dichiarazione presente in un plist su due.
> **Nessuna dà errore, perché nessuna è malformata: sono assenze**, e l'assenza
> non è un errore di sintassi.

---

## Il sito: due gruppi, e una mela

**La scheda iOS non è più spenta.** Fino al 27 agosto portava un «in arrivo», e
il commento che stava lì spiegava perché: un collegamento all'App Store verso una
scheda che non esiste porta a una pagina d'errore, e una pagina d'errore dice
«progetto abbandonato» molto più forte di quanto «in arrivo» dica «non ancora
pronto». Adesso c'è qualcosa dall'altra parte, quindi si preme — e con la scheda
spenta se ne sono andate le tre regole CSS che la disegnavano
(`.pulsante-attesa`, `.scheda-piattaforma.attesa`, `.riga-attesa`), invece di
restare lì per la prossima volta. _Un foglio di stile che descrive uno stato che
l'interfaccia non ha più è la stessa bugia di un commento che rimanda a codice
inesistente: chi legge crede che quello stato esista e va a cercarlo._ `git log`
se lo ricorda.

**Le quattro piattaforme sono diventate due gruppi**, perché sono due storie:
«Questo progetto è nato per» (macOS, iOS) e «Ma è stato poi rilasciato anche per»
(Windows, Android). Prima stavano tutte e quattro in fila e la differenza la
faceva **la grandezza delle schede** — un'informazione che si legge solo se
qualcuno la nota. Detta a parole si legge e basta, e chi arriva da Windows sa
subito che c'è e in che condizioni.

**E macOS e iOS adesso sono grandi uguali.** La principale aveva
`min-width: 200px` contro i 158 dell'altra, e andava bene quando le schede erano
quattro in fila e quella larghezza diceva qual era il download principale. Adesso
sono una coppia — due sistemi della stessa famiglia — e due schede appaiate di
larghezza diversa si leggono come una gerarchia che qui non c'è.
`flex: 1 1 158px` divide la riga in parti uguali a qualunque larghezza; la
differenza di colore resta, e dice qual è il download diretto senza dire che
l'altro conta meno.

> **Una cosa che il sito NON dice ancora.** Il pulsante per macOS non dichiara da
> nessuna parte che serve **macOS 12 e un Mac Apple Silicon**. Fino al 27 agosto
> dichiarava il falso dentro il pacchetto (10.15) e niente sulla pagina; adesso
> il pacchetto dice la verità e la pagina tace. _Tacere è meglio che mentire, ma
> per chi ha un Mac Intel il risultato è lo stesso: scarica, installa, e non si
> apre._ Sta fra i prossimi passi.

### ► IL BADGE UFFICIALE C'È STATO, PER QUALCHE MINUTO ◄

Vale la pena registrarlo come decisione, perché la strada scartata è quella che
le linee guida di Apple prevedono.

**Quello che Apple consente a un terzo è il badge «Scarica su App Store»**,
artwork ufficiale delle sue Marketing Resources, da usare per rimandare alla
propria app. **La mela come icona di sezione non è un uso che Apple consenta**: i
marchi dei sistemi operativi sono di chi li possiede, e i disegni di quella
fascia sono nostri e rappresentano apparecchi.

Il badge è stato messo — variante bianca, come previsto sui fondi scuri, e
localizzato: italiano sulla pagina italiana, inglese su quella inglese — e poi
**tolto su richiesta del proprietario**, in favore della mela nell'occhiello più
la riga di testo «Scarica da App Store». **La scelta è stata sua, informato del
punto qui sopra**, e sta scritta così perché chi la rilegge fra sei mesi deve
sapere che non è stata una svista.

Due cose della mela che sono decisioni tecniche e non gusto:

- **è un tracciato in linea, non il carattere della mela.** Quel carattere vive
  nell'area privata di Unicode e lo disegna solo un dispositivo Apple: su Windows
  e Android — che sono metà del pubblico di questa pagina, e hanno una scheda a
  due centimetri più giù — sarebbe uscito **un rettangolo vuoto**, cioè il modo
  più goffo possibile di parlare di Apple;
- **è in `currentColor`, non nera.** Sul blu scuro di quella fascia una mela nera
  si intuisce solo girando lo schermo verso la finestra, e un simbolo che si deve
  cercare non è un simbolo. Così prende il tono dell'occhiello che la ospita, e
  se un giorno quella fascia diventasse chiara diventerebbe scura da sola. La
  misura è in `em` e non in pixel, per lo stesso motivo.

### I difetti che si vedevano solo guardando la pagina disegnata

Nessuno si vede leggendo il foglio di stile, ed è la terza volta che succede su
questo sito.

- **Le schede erano allineate in basso** (`align-items: flex-end`), che era la
  scelta giusta con quattro schede in fila e la principale più alta di tutte. Da
  quando sono due gruppi da due, la scheda iOS è diventata la più alta e **la
  principale risultava mozza in cima**. Adesso `stretch`: due schede appaiate si
  leggono come una coppia solo se sono alte uguale.
- **Le ultime righe delle due schede erano sfalsate di dieci pixel.** Rimedio:
  `margin-top: auto` sulla riga che dice cosa ottieni premendo, così tutte e due
  si appoggiano al fondo della scheda. Serve **da quando** le schede sono alte
  uguale — prima ognuna era alta quanto il suo contenuto e il fondo coincideva da
  sé.
- **Tre bordi sinistri in trecento pixel.** Tutto comincia a 200 px; la fila dei
  numeri cominciava a **224** e l'etichetta sopra le marche a **248**. Il primo
  perché era invisibile — un contenitore annidato in un altro, e i riempimenti si
  sommavano. Il secondo stava sotto un commento che diceva il contrario:
  «allineata al contenitore», e si ricalcolava larghezza e padding da capo.
- **I nomi dei computer non sfumavano, si tagliavano.** La maschera del nastro
  finiva al 12% della larghezza — 173 px su 1440 — e la colonna del testo
  comincia a 200: la dissolvenza aveva già finito prima di entrare nella parte di
  pagina che si guarda, e «Shearwater» compariva come «rwater» a piena opacità.
- **La griglia che metteva l'avvertimento sopra il suo titolo.** Nella sezione
  della sicurezza il riquadro giallo finiva **prima** del suo titolo: si leggeva
  l'avvertimento, e solo dopo si scopriva che era un avvertimento.

I motivi per esteso stanno nei commenti di `sito/stile.css`, accanto alle regole.

> **Due cose che sembravano difetti e non lo erano.** Il profilo dell'immersione
> che non si disegnava e i numeri fermi erano **artefatti dello screenshot**:
> `--screenshot` fotografa al primo disegno, quindi le animazioni erano al
> fotogramma zero. Con `--virtual-time-budget` la curva si disegna e i numeri
> arrivano dove devono. _Prima di correggere quello che si vede in una foto, si
> controlla che la foto sia stata scattata al momento giusto._

**Come si fotografa il sito.** Chrome su macOS non apre finestre più strette di
500 px: per vedere davvero i 390 si mette il contenuto in un contenitore largo
390 dentro una finestra da 520. E `--screenshot` ignora `window.scrollTo`: per
inquadrare una fascia si sposta il corpo con `position: relative; top: -Ypx`,
così il viewport resta quello vero e le `vh` e le media query non cambiano.

**E il sito si ripubblica solo quando è cambiato.** Una versione nuova non basta:
i pulsanti puntano a `releases/latest/download/...` e seguono la release da soli.
`npm run sito:versiona` dice quante pagine ha toccato, e se dice zero non c'è
niente da caricare — sulla 1.7.0 ha detto zero, e il 27 agosto ha avuto qualcosa
da fare davvero, perché **è il sito** a essere cambiato. _La stessa impronta che
serve a far scadere la cache risponde gratis alla domanda «cosa c'è
pubblicato»._

> **Le sei classi CSS che nessuno usa restano dove sono** (27 agosto 2026,
> decisione del proprietario). Contate: il foglio di stile ne definisce **102**,
> e sei non compaiono in nessuna delle quattro pagine — `.come-link`,
> `.nota-impronte`, `.nota-modulo`, `.scarico-altre`, `.scarico-nota` e
> `table.dati`. **Non c'è nessun difetto visibile**, e questo è il punto: le
> tabelle della pagina della privacy sono impaginate da `.documento table`,
> quindi `table.dati` non serve a nessuno e non manca a nessuno. Sono
> trentacinque righe di foglio di stile morte, non un guasto — e la differenza
> con `.pulsante-attesa`, che invece è stata tolta, è che quella **descriveva uno
> stato dell'interfaccia**: chi la leggeva andava a cercare una scheda spenta che
> non esiste più.

---

## Il sito, il 29 agosto: i motori, il menu, e il buco in fondo

Due giornate di lavoro sul solo `sito/`, commit `4f23d23` e `80b7d1c`. Non
toccano una riga dell'applicazione, ed è il motivo per cui il numero di versione
non si muove: *il sito non è l'app, e confondere le due cose vorrebbe dire
alzare un numero che descrive un binario per un cambiamento che quel binario non
contiene.*

### Il sito era invisibile ai motori e a chi lo condivide

`4f23d23`. Mancava l'igiene di base, e mancava per intero: nessun `robots.txt`,
nessuna `sitemap.xml`, nessun `hreflang` fra le due lingue, e **nessuna anteprima
quando qualcuno incollava l'indirizzo in una chat** — cioè il modo in cui questo
progetto si diffonde davvero. Adesso ci sono tutti, più due immagini d'anteprima
(`immagini/anteprima-it.jpg` e `-en.jpg`), i tag Open Graph e Twitter su tutte le
pagine, `SoftwareApplication` in JSON-LD sulle due home e `Article` sulle due
pagine di legge, e `hreflang` completo con `x-default`.

**Le pagine sono diventate otto**, perché ne sono nate due: `libretto-immersioni.html`
e la sua gemella inglese `en/dive-logbook-law.html`, sulla legge 70/2026 e sul
libretto dell'art. 12 comma 8. Non sono una pagina di prodotto: chi cerca «cosa
deve contenere il libretto delle immersioni» cerca la legge, non un'applicazione,
e la pagina risponde a quella domanda.

**Quello che è stato deliberatamente NON fatto**, ed è la parte che vale la pena
tenere scritta: niente `aggregateRating` e niente `FAQPage`. Il primo dichiarerebbe
a Google un punteggio medio che nessuno ha dato; il secondo delle domande che
nessuno ha posto. *Sono dati strutturati, cioè affermazioni fatte a una macchina,
e valgono la stessa regola di tutte le altre: non si inventano numeri, e non si
inventa nemmeno il fatto che qualcuno abbia chiesto qualcosa.*

La `sitemap.xml` è stata poi verificata dall'altra parte, su Search Console:
**«Riuscita», 8 pagine rilevate.**

### Il menu completo c'era solo sulla home

`80b7d1c`, prima metà. Dalle altre sette pagine non si tornava indietro se non
col tasto del browser, e **nessuna pagina diceva su quale pagina si fosse**. Ora
le voci sono sette dappertutto.

**«Segnala» è un pulsante sulla home e un collegamento altrove**, e la differenza
non è cosmetica: il modulo delle segnalazioni e il centinaio di righe che lo
aprono, lo chiudono e ne mandano il contenuto vivono **solo** sulla home.
Copiarli anche altrove darebbe sei copie della stessa cosa, destinate a divergere
al primo ritocco — si corregge il popup in un posto e negli altri cinque resta
com'era. Il frammento `#segnala` è il messaggio: la home lo riconosce all'arrivo
(`daFrammento()` al caricamento e su `hashchange`) e apre il modulo da sola, e
`replaceState` ripulisce l'indirizzo alla chiusura. Non corrisponde a nessun `id`
nella pagina, ed è voluto: chi ha JavaScript spento atterra in cima alla home,
che è il peggio che gli possa capitare, invece di saltare su un elemento
nascosto.

**Il «sei qui» è `aria-current="page"`**, e sta in un posto diverso a seconda
della pagina: sulle sei pagine interne è la voce corrispondente, con una
sottolineatura di due pixel — non una terza pillola, che avrebbe fatto sembrare
la voce corrente un pulsante diverso dagli altri; **sulle due home è il marchio**,
che è il collegamento alla home. Lì il segno visivo non serve — il marchio è già
l'unica cosa in grassetto della barra, e quella è l'unica pagina con l'apertura,
le schermate e i pulsanti di scarico — ma il segno per chi legge con la voce sì:
sente «MyDiveLog, collegamento, pagina corrente» e sa dov'è. *Il segno visivo
serve dove le pagine si somigliano, ed è lì che c'è.*

Per la quinta volta su questo foglio di stile è saltata fuori la trappola della
specificità: `.voce-segnala` e `.voce-caffe` scritte senza `.navigazione` davanti
perdevano contro le regole generali del menu. Prefissate.

### ► SOTTO IL PIEDE C'ERANO 191 PIXEL DI NERO, E NON ERANO NÉ UN MARGINE NÉ UN PADDING ◄

`80b7d1c`, seconda metà, e nasce da una frase del proprietario: *«sul fondo c'è
troppo spazio vuoto»*.

Il sospetto ovvio era il `padding: 30px 0 50px` del piede. Non era quello. Era
**l'alone decorativo**, `.piede::before`, un elemento in `position: absolute`
messo a `bottom: -30%`.

**Un elemento assoluto che sporge SOTTO allunga l'area scorribile della pagina
anche se non disegna niente di visibile. Uno che sporge SOPRA no.** L'overflow
verso l'alto non è scorribile, quello verso il basso sì: è una asimmetria del
modello di scorrimento del browser che non compare in nessuna regola CSS, perché
non è scritta da nessuna parte del foglio — è come funziona il documento. E
poiché il `-30%` si misura sull'altezza del piede, e il piede della home è alto,
il buco cresceva proprio dove si notava di più.

Misurato con Playwright su otto pagine per due larghezze, prima e dopo:

| | prima | dopo |
|---|---|---|
| home, 1280 px | **110 px** di vuoto | 0 |
| home, 390 px | **191 px** | 0 |
| pagine interne | 35–59 px | 0 |

Sedici casi su sedici a zero, con `scrollHeight` uguale al fondo del piede.
*Non si è dedotto dal foglio di stile: si è misurato il documento disegnato* — che
è la stessa regola già scritta qui per la review del sito, e per la stessa
ragione: **leggendo il CSS questo difetto non si vede**, perché la regola che lo
causa non contiene niente di sbagliato.

### Le guardie: `tests/sitoNavigazione.test.ts`

Trentaquattro prove, tutte **viste rosse** prima di crederle: tolta una voce dal
menu, tolto l'`aria-current`, sdoppiato l'`aria-current`, tolta la voce
«Segnala», rimesso `bottom: -30%`, aggiunta una decorazione nuova a
`bottom: -2rem`.

> **Due mutazioni del primo giro non avevano agganciato niente, e la prova era
> verde per il motivo sbagliato.** Una sostituzione cercava `href="/"` su una
> pagina dove l'indirizzo è `/en/`, l'altra era un `perl` con le graffe non
> chiuse: il file non è mai cambiato, e il verde che ne è uscito non dimostrava
> nulla. Rifatte controllando **prima** che il sorgente fosse davvero diverso, e
> solo dopo guardando il colore. *Una mutazione che non muta è la forma più
> economica di autoinganno: costa un comando e restituisce esattamente la
> risposta che si sperava.*

**I commenti si tolgono prima di contare gli `aria-current`**, e non è pignoleria:
nel sorgente delle due home c'è un commento che **spiega** l'attributo citandolo
per esteso. Contarlo avrebbe fatto passare una pagina che l'attributo vero non ce
l'ha — cioè una guardia verde proprio sul caso che deve prendere.

La guardia sul fondo è di due pezzi: uno inchioda `.piede::before` a `bottom: 0`,
l'altro pretende che **nessuna** regola del piede porti un `bottom` negativo,
perché la prossima decorazione rifarebbe lo stesso buco.

---

## Google Play: il terzo negozio, e la firma che decide tutto

29 agosto 2026. **Il racconto per esteso sta in `play-store.md`**; qui il minimo
per sapere che esiste e qual è la cosa da non sbagliare.

Il nome del pacchetto è **`it.ferrando.mydivelog`**, letto **dentro l'APK
pubblicato** e non copiato da `tauri.conf.json`. Su Play non si cambia più, e
`tests/androidNegozio.test.ts` lo inchioda.

> ### ► LE DUE FIRME, E LE IMMERSIONI DI QUALCUNO ◄
>
> L'APK del sito lo firmiamo noi; l'APK che Play consegna lo firma Google, perché
> Play App Signing è obbligatorio per le app nuove. **Android non aggiorna
> un'applicazione se il certificato cambia**: chi ha installato MyDiveLog dal
> sito non potrebbe aggiornarla da Play, e per passare da un canale all'altro
> dovrebbe **disinstallare** — cioè cancellare l'archivio locale, cioè le sue
> immersioni.
>
> In un logbook non è un fastidio di distribuzione: è la perdita del dato che
> l'applicazione esiste per custodire, in una persona che non ha fatto niente di
> sbagliato e che non riceve nessun avviso. Si evita **caricando su Play la
> nostra chiave** come chiave di firma dell'app, invece di lasciarla generare a
> Google: allora la firma è la stessa sui due canali e l'aggiornamento passa. **È
> una decisione che si prende alla prima release**, e dopo si disfa solo con una
> richiesta a Google.

**La chiave di firma cambiava a ogni build**, generata dal workflow con la
password in chiaro — e per il solo sito andava bene, perché lì è dichiarato che a
garantire l'origine è l'impronta SHA-256 e non la firma. Su Play no: *la prima
consegna registra la chiave di caricamento, e ogni consegna successiva firmata
con una chiave diversa viene rifiutata* — una chiave nuova a ogni build vuol dire
una consegna sola in tutta la vita dell'app. Adesso il workflow ha due modi: con
i tre segreti firma con la chiave del proprietario e costruisce anche l'`.aab`;
senza, ricade nel modo vecchio e nel solo APK, perché **questo repository è
pubblico e chi lo clona senza segreti deve poterlo costruire lo stesso**. Un
passo nuovo **stampa quale dei due è successo**: *una ricaduta silenziosa
darebbe un pacchetto inservibile con la stessa spunta verde di uno buono.*

**L'`.aab` non entra nella release di GitHub**, ed è la regola già scritta per il
`.pkg` del Mac App Store: un pacchetto firmato per un negozio, messo dove la
gente scarica a mano, è un file che non si installa.

> ### ► LA PROVA PIÙ IMPORTANTE DELLE OTTO ERA VERDE PER IL MOTIVO SBAGLIATO ◄
>
> Quella che impedisce all'`.aab` di finire nella release cercava
> `- name: Raccogli` nel workflow intero — e di lavori con un passo che si chiama
> così ce ne sono **due**. Trovava quello di **Windows**, che sta prima, e girava
> su un pezzo di YAML che con Android non c'entra niente. L'ha smascherata la
> mutazione: mettere l'`.aab` fra i file raccolti non la faceva diventare rossa.
> Adesso si ritaglia prima il lavoro giusto, e una prova apposta controlla che il
> ritaglio sia quello giusto.
>
> *È la terza volta in due giorni che una guardia nuova è verde proprio sul caso
> che deve prendere, e la terza volta che a scoprirlo è la mutazione e non la
> rilettura.* Le altre due: il 28 la guardia sui messaggi d'errore, che su
> `DiveDetail` non si accendeva perché la regola era scritta sull'esempio invece
> che sulla proprietà; e il 29 due mutazioni sul sito che non avevano agganciato
> niente, e il cui verde non dimostrava nulla.

**Il livello di API bersaglio, e ci siamo dentro per due giorni.** Dal **31
agosto 2026** le app nuove devono puntare ad **Android 16 (API 36)**. Quel numero
lo genera Tauri e non l'aveva mai guardato nessuno: letto il 29 agosto **dentro
il binario della CLI installata** — `tauri-cli 2.11.4`, la stessa versione che
`package-lock.json` impone al runner — il modello dichiara `compileSdk = 36` e
`targetSdk = 36`. Siamo a posto **per la versione della CLI che ci siamo trovati
addosso**, non per una scelta: e per questo il workflow adesso stampa a ogni
build cosa dichiara di sé il progetto Android generato.

---

## Linux, la quinta piattaforma — e l'unica provata prima di pubblicarla

**31 agosto 2026.** Un `.deb` per amd64, allegato alla `v1.7.1`
(`766d94b6…`), collegato dal sito in un gruppo suo: *«E siccome ci piace il
software libero, l'abbiamo fatto anche per»*.

**Perché Linux è il caso facile.** libdivecomputer lì si compila per la strada
normale: c'è una shell, quindi `./configure` gira e basta — niente della
ginnastica che su Windows è costata la riscrittura con la cassa `cc` per non
mescolare l'ABI di mingw con quella di MSVC. La build intera dura **7 minuti e
46 secondi**, il binario pesa **9,2 MB** e porta dentro ventotto simboli `dc_*`,
`dc_custom_open` compreso.

> ### ► ED È L'UNICA DELLE TRE CHE QUALCUNO HA FATTO PARTIRE ◄
>
> Windows e Android sono entrati dichiarati: «fanno tutto quello che fa il Mac»,
> e nessuno li aveva mai aperti. Il 29 agosto si è scoperto cosa costa — l'APK
> non era firmato, quindi non si installava, e per settimane il sito ha
> consegnato un file inservibile.
>
> **Linux no.** La build è stata fatta e l'applicazione **fatta partire**, dentro
> uno schermo finto: finestra disegnata, click sul menu che navigano davvero (un
> webview che disegna e non risponde è il guasto classico di GTK, e non c'è),
> **archivio SQLite creato** in `~/.config/it.ferrando.mydivelog/mydivelog.db`
> con tutte e quattro le tabelle, e l'interfaccia partita in inglese perché il
> sistema era in inglese.
>
> **Quello che resta non provato è uno solo, e delimitato: il Bluetooth.** Non
> c'era un adattatore. Il codice per BlueZ però è compilato dentro —
> `dbus-tokio` e `bluez-generated` sono passati nella build. *La differenza fra
> «dichiarata» e «provata, meno una cosa» è tutta qui, e vale la pena tenerla
> scritta.*

> ### ► E FACENDOLA GIRARE È SALTATO FUORI UN DIFETTO ◄
>
> Premendo «Check» sugli aggiornamenti l'applicazione rispondeva:
>
> ```
> None of the fallback platforms `["linux-x86_64"]` were found in the response `platforms` object
> ```
>
> Sono **due** cose. La prima: l'aggiornatore di Tauri su Linux funziona con
> l'AppImage, non col `.deb`, quindi quel pulsante non poteva funzionare — ed è
> **lo stesso caso del Mac App Store**, dove *un pulsante «cerca aggiornamenti»
> che non fa niente è peggio di nessun pulsante*. La seconda, che vale su tutte
> le piattaforme: **è il messaggio grezzo di una libreria, in inglese, dato a una
> persona** — la stessa identica specie di `Btleplug error: Permission denied`
> che il primo utente esterno ha letto il 28 agosto. Le guardie
> `nomiInterniSulloSchermo` e `conDettaglio()` non lo prendono perché quel testo
> esce dal plugin dell'aggiornatore, e oggi non si vede su Mac e Windows solo
> perché `latest.json` quelle piattaforme le ha.
>
> Su Linux è chiuso spegnendo l'aggiornatore con i due interruttori insieme,
> come per il Mac App Store: la feature Rust `senza-aggiornamenti` e
> `createUpdaterArtifacts: false` in `tauri.linux.conf.json`. **Il messaggio
> grezzo resta un debito aperto sulle altre piattaforme.**

**Il limite vero, e non è nostro: WebKitGTK.** Il pacchetto dipende da
`libwebkit2gtk-4.1-0`, che c'è da **Ubuntu 24.04** e **Debian 13** in su; su
22.04 esiste la 4.0 e questo `.deb` non si installa. Un pacchetto non copre le
distribuzioni. Il sito lo dice **prima del pulsante**, come già fa per il Mac
Apple Silicon — che è la regola nata dal guasto opposto, quando per settimane ha
offerto un pacchetto macOS a chi aveva un Mac Intel.

### Le guardie, e le tre volte che il ritaglio ha sbagliato

`tests/linuxPacchetto.test.ts`, dieci prove. La più interessante è quella sul
controllo che il workflow fa **dentro** il pacchetto costruito:

> **► CERCARE UN INDIRIZZO NON DICE SE IL CODICE CHE LO USEREBBE C'È. ◄** La
> prima versione di quel controllo cercava
> `releases/latest/download/latest.json` dentro il binario, e ha fermato la
> prima build Linux — **sbagliando**: quella stringa è la *configurazione*
> incorporata, e c'è comunque, con o senza aggiornatore compilato dentro.
>
> I marcatori buoni sono stati misurati **nei due sensi**, compilando lo stesso
> progetto due volte: `tauri_plugin_updater` e «None of the fallback platforms»
> sono **assenti** con la feature `senza-aggiornamenti` e **presenti** senza.
> *Una guardia che non si è vista rossa non è una guardia* — e questa si è vista
> rossa sul binario vero, non su un file di testo.

> **► E IL RITAGLIO DI UN LAVORO DEL WORKFLOW HA SBAGLIATO TRE VOLTE IN DUE
> GIORNI. ◄** Prima cercava il passo nel file intero e trovava quello di
> **Windows**. Poi ritagliava da `\n  android:\n` **fino a fine file**, il che
> è andato bene finché Android era l'ultimo lavoro: il giorno che è entrato
> `linux` in coda, la conta dei passi «Raccogli» è passata da due a tre e la CI
> è diventata rossa. *Un ritaglio che finisce dove finisce il file è giusto per
> caso, e il caso scade.* Adesso finisce alla riga del lavoro successivo, e la
> regola sta in un file solo, `tests/lavoroDelWorkflow.ts`.
>
> **E scrivendo la prova si è imparata una cosa sullo YAML**: il commento che
> introduce un lavoro sta **prima** della sua riga `nome:`, quindi cade nel
> ritaglio del lavoro *precedente*. La prima asserzione cercava una parola che
> in quel commento c'è, ed era **lei** sbagliata, non il ritaglio. Per dire «il
> ritaglio si è fermato dove doveva» si guarda la **riga** del lavoro dopo, che
> è l'unica cosa che non può contenere.

### Gli allegati della release sono nove

Il `.deb` è il nono, aggiunto alla `v1.7.1` il 31 agosto. Le note lo dicono, con
un riquadro che spiega che non c'era quando la versione è uscita: *è lo stesso
codice, compilato per Linux e allegato dopo.* Le quattro impronte pubblicate
prima restano valide; questa è la quinta.

> **► E QUI IL PASSO 7 HA UN PUNTO CIECO, SCOPERTO OGGI. ◄** Il modo con cui si
> risponde a «cosa c'è pubblicato sul sito» è confrontare l'impronta del foglio
> di stile servita con quella sul disco. **Quell'impronta non vede l'HTML.** Il
> 31 agosto sono cambiate solo le pagine — Linux, in due lingue — e non il CSS:
> `npm run sito:versiona` ha detto *pagine aggiornate: 0*, e il confronto delle
> impronte avrebbe risposto «è tutto pubblicato» mentre Linux non c'era ancora.
> *Un'impronta risponde alla domanda per cui è nata — far scadere la cache — e a
> nessun'altra.* Quando cambia solo l'HTML, la risposta si ha guardando la
> pagina servita.

---

## ► IL PIANO DI MIGLIORAMENTO SI TRADUCE: `core/frase.ts` ◄

**Questo chiude un punto che è stato aperto per mesi.** Non era una
dimenticanza, ed è la parte che vale la pena capire.

In questo progetto la chiave del dizionario è **la frase italiana intera**. Va
benissimo per le frasi fisse. Non funziona per una frase che contiene un numero:
la chiave da cercare cambia a ogni immersione, quindi nel dizionario non c'è mai
stata e **non ci sarebbe potuta entrare**. Le novantuno frasi di `coaching.ts` e
`nextDive.ts` non erano state saltate: erano intraducibili per costruzione.

La strada che si prova per prima — spezzare la frase in pezzi e ricucirli intorno
ai numeri — regge per due parole e crolla su un paragrafo, perché l'inglese ha un
altro ordine e una frase composta a pezzi in ordine italiano esce sgrammaticata.

**La soluzione**: la chiave resta la frase intera, con i numeri sostituiti da
segnaposti numerati, e **si traduce prima e si riempie dopo**.

```ts
frase(t, 'Consumo medio {0} L/min su {1} immersioni.', rmv.toFixed(1), n);
```

Chi traduce vede la frase completa e **può spostare i segnaposti**: in inglese
`{1} dives at {0} L/min` è legittimo quanto l'ordine italiano. È `printf` ridotto
all'osso, ed è l'unica forma che permette a una traduzione di riordinare.

| Scelta | Perché |
| --- | --- |
| segnaposti **numerati** e non nominati | un nome si legge meglio ma raddoppia il lavoro di chi traduce, e un nome sbagliato lascia un buco muto. Con gli indici il test può controllare che italiano e inglese usino **gli stessi segnaposti** — con i nomi non si potrebbe senza conoscere il significato |
| un segnaposto senza valore **resta scritto** | `{3}` a schermo è un difetto che si nota e si segnala; uno spazio bianco in mezzo a una frase no |
| se manca la traduzione, esce l'italiano | `t()` ripiega sulla chiave e i numeri entrano lo stesso: una frase non tradotta resta una frase corretta, mai una frase mutilata |

Convertiti per intero **`coaching.ts`** — le sedici regole, il briefing, il
debrief: novantanove chiamate a `frase()` — e **`nextDive.ts`**, dieci. Il piano
adesso **rinasce quando cambia la lingua**: in `state.tsx` serve la `t` del
render e non quella stabile, o resterebbe scritto nella lingua di quando è stato
calcolato.

**Un difetto vero trovato per strada**: la regola `deep-recreational` misurava la
prontezza sul conteggio del **periodo scelto** invece che su tutto lo storico, e
a chi filtrava l'ultimo mese diceva che non era pronto per il profondo.

### La rete che impedisce al buco di riaprirsi

`tests/dizionario.test.ts` legge **tutti** i file `.ts`/`.tsx` di `src/` e
`scripts/` — oggi centotrenta, esclusi solo `core/frase.ts` (che contiene
l'esempio della sua documentazione) e il dizionario stesso — ed estrae ogni frase
passata a `t()`, pretendendo che abbia la sua voce.

**Ne mancavano sedici**: le tredici etichette del libretto di legge, i tre tipi
di autorespiratore, un avviso Shearwater. Nessuno se n'era accorto perché il
ripiego di `t()` è la chiave stessa — _è la proprietà che rende robusto questo
dizionario ed è la stessa che rende invisibili i suoi buchi. L'unico modo di
vederli è contarli._

Due controlli in più:

- **nessuna chiave costruita interpolando un valore** — il difetto che ha tenuto
  novantuno frasi fuori dal dizionario;
- **nessuna coppia di chiavi che differiscono solo per il tipo di apostrofo.**
  Ce n'erano due, ed erano due guasti diversi: una **gemella morta** (il sorgente
  scriveva l'apostrofo tipografico, la voce col dritto non sarebbe stata
  interrogata mai) e due moduli che scrivevano **la stessa frase in due modi** —
  `coaching.ts` col dritto, `nextDive.ts` col tipografico. Il difetto non stava
  nel dizionario, stava nei due moduli. Uniformato il sorgente, l'elenco delle
  deroghe (`GEMELLE_NOTE`) è **vuoto**.

Il dizionario inglese è passato da **1725 a 1969 voci** — 247 nuove, 3 tolte — e
107 di quelle voci contengono almeno un segnaposto.

> **E quelle 247 voci sono tradotte, non solo dichiarate.** Misurato il 26 agosto
> sul dizionario vero, importando `INGLESE` da `src/ui/traduzioni.ts`: su
> **1969** voci quelle con l'inglese **vuoto sono zero**, e quelle in cui
> l'inglese è **identico** all'italiano sono **19** — e sono parole che in
> inglese si scrivono uguale (`File`, `Computer`, `Logbook`, `No`, `Gas`,
> `Gauge`, `Menu`, `OTU`, `Setpoint`, `Rebreather`, `Volume`, i nomi delle
> marche…). Sulle **241** frasi del piano estratte da `coaching.ts` e
> `nextDive.ts`: zero senza voce inglese, zero uguali all'italiano, zero
> segnaposti fuori posto. Il limite che resta è un altro, ed è scritto fra i
> **limiti noti**: nessun madrelingua le ha rilette.

---

## I cinque conti sbagliati, e il metro che li misurava

| Dove | Cosa sbagliava |
| --- | --- |
| `deco.ts` | CNS e OTU sulla miscela della **prima fase** per tutta l'immersione: con un cambio gas, l'8% dello scenario di prova diventa 49.5% |
| `gasPlan.ts` | i litri in decompressione usavano la pressione ambiente in **ATA dove serviva in bar**: a duemila metri di quota 159 bar invece di 122 |
| `metrics.ts` | l'RMV mediava le pressioni **come se ogni tratto durasse uguale**. Ora `avgBar`, media pesata sul tempo |
| `Planner.tsx` | il **tempo di fondo** passato dove il conto voleva il **runtime**, e una `medianBottomMin` che era una mediana di durate intere. _Il nome era la spia_ |
| END | non riceveva la **pressione in superficie** e la dava per uno: in quota sbagliava di quanto sbaglia l'atmosfera |

E sotto tutti, il difetto che li rendeva invisibili: **`tests/fixtures.ts`
generava il consumo delle immersioni sintetiche sugli ATA invece che sui bar
assoluti.** La fixture chiedeva 18 L/min e l'applicazione ne rileggeva 17.71.
Nessuna prova è mai diventata rossa, perché quella che rileggeva il consumo
accettava **da 14.5 a 17.5 su 16 chiesti**. La banda adesso è l'1% — quello che
resta dopo l'arrotondamento all'intero di `endBar` nel file UDDF — su tre
combinazioni diverse, e con l'errore di prima è rossa: verificato.

---

## La sincronizzazione fondeva in una direzione sola

`turso.ts` fondeva i riepiloghi **in ingresso e non in uscita**: quello che avevi
arricchito sul telefono tornava sul portatile, il contrario no. Adesso passano
tutti e due da `fondiRiepiloghi`, che tiene i profili fuori dalla fusione e **non
ricalcola le metriche** — quelle le sa già chi le ha calcolate.

> **Il difetto vecchio saltato fuori per strada, ed è il peggiore dei due.** Lo
> `stripSamples` locale di `turso.ts` **non toglieva `altSamples`**. L'immersione
> risultava sempre incompleta, e ogni sincronizzazione la riscaricava. Per
> sempre — traffico a ogni giro, per un'immersione che c'era già.

Aggiunti a `takeIfEmpty` i campi che mancavano — centro, profondità pianificata,
firma della guida — e `analisi` alla fusione delle bombole. `subacqueo` entra fra
le impostazioni condivise.

**E il nome che si congelava**: `saveSubacqueo` non scriveva `subacqueo:at`, e la
fusione delle impostazioni condivise decide con quella data. Con la data vuota il
confronto cadeva per sempre dalla stessa parte: il nome sul libretto lo
correggevi sul telefono e la sincronizzazione dopo rimetteva quello vecchio,
senza dire niente. _Il vecchio commento MOTIVAVA l'omissione — «cambiano una
volta ogni qualche anno» — che è semmai un'aggravante: chi corregge una volta
sola non torna a controllare se è rimasto._

Una data Shearwater illeggibile produceva un'immersione con `startTime` non
valido che si propagava ovunque: `parseShearwaterDate` adesso restituisce
`undefined` e l'immersione viene scartata con un avviso.

---

## Gli otto difetti d'interfaccia

Tutti trovati **usando l'applicazione**, nessuno da una rilettura.

**Il riquadro della firma si apriva e non si chiudeva.** L'unica uscita era
firmare. La firma della guida è la lettera o) del libretto, l'unica delle tredici
che non è un dato ma un gesto: _l'ultima cosa che può avere una sola via d'uscita
è proprio quella che chiede a qualcuno di impegnarsi._ Il punto delicato non era
aggiungere un bottone, era **distinguere due uscite che si somigliano**:
`onAnnulla` non tocca niente, `onCancella` toglie una firma già raccolta e cambia
il record. Separate nel codice e separate a schermo — «Annulla» accanto alla
conferma, «Togli la firma» in fondo e da sola, perché su un telefono in barca
sono un dito storto di distanza.

**«Sincronizza» disabilitato per sempre.** `SyncPage` salvava il token con
`trim()` e poi confrontava il digitato **senza**. Basta uno spazio in coda — e un
token incollato ce l'ha quasi sempre — perché i due non coincidano mai, senza una
riga a schermo che dicesse perché. Stessa cosa sul nome del subacqueo.

> **La regola, adesso scritta una volta sola in `ui/modificato.ts`: normalizzare
> da un lato solo del confronto è l'errore.** Si fa da tutti e due o da nessuno —
> e **in una funzione**, perché una simmetria scritta una volta non si può
> rompere in un punto solo. Cercati tutti gli altri confronti asimmetrici in
> `src/`: erano quei due.

**Il locale scritto a mano in dieci punti.** Nove chiamate fra `format.ts`,
`Charts.tsx` e `SyncPage.tsx` imponevano `it-IT`. La decima, peggiore, era in
`coaching.ts`: quella data finisce **dentro** frasi che passano dal dizionario, e
usciva una frase inglese con una data italiana in mezzo. Adesso il locale sta in
`core/locale.ts` e **lo registra chi decide la lingua, non un effetto** — un
effetto gira dopo il primo disegno, e chi apre l'applicazione in inglese si
sarebbe tenuto una prima schermata di date italiane. **`en-GB` e non `en-US`**:
giorno prima del mese e orologio a 24 ore, come li mostra il computer subacqueo
da cui quelle immersioni arrivano.

**L'eccezione, resa esplicita:** `logbookPrint.ts` e il foglio del piano restano
in italiano qualunque lingua parli l'interfaccia, perché quel foglio è il
libretto dell'art. 12 comma 8 della legge 70/2026. Il commento adesso lo dice per
primo, così nessuno lo «sistema» — e due prove lo difendono, provate applicando
il rovescio.

**Lo scarico che restava appeso a «Leggo…».** `scarica` non aveva un try/catch, e
nel Bluetooth qualcosa lancia: la schermata restava lì per sempre, con delle
immersioni magari già salvate e nessun modo di saperlo. Adesso l'errore dice due
cose insieme — che si è interrotto **e quante immersioni sono già in archivio**.
_Un messaggio d'errore che tace su cosa è stato salvato costringe chi legge a
riscaricare per sapere._ L'azzeramento del controllore è passato in un `finally`
(prima tutta la scrittura in archivio restava scoperta), e **«Interrompi»
funziona anche durante lo scarico da libdivecomputer**, che un controllore non lo
registra mai: per tutta la sua durata quel pulsante era morto.

**Il confine d'errore che prometteva il falso.** `<ErrorBoundary>` senza `key`
non si rimonta al cambio di scheda: una volta scattato restava scattato, mentre
il suo testo dice a chi legge che le altre schede funzionano. _Chi ci provava
scopriva che non era vero, e da lì in poi non si fida più di nessun messaggio
dell'applicazione._ Nella chiave entra anche l'immersione aperta: senza, da una
scheda d'immersione rotta non si uscirebbe, perché il pulsante «indietro» sta
dentro la parte che non c'è più.

**La sigla che cambiava bombola.** La lista delle bombole usava l'indice come
chiave: togliendone una in mezzo, React riusava lo stato per l'indice sbagliato e
`notaSigla` passava da una bombola all'altra. **Su un dato che dice che gas c'è
dentro non è un fastidio d'interfaccia.** Adesso `Cylinder` ha una chiave sua,
che sopravvive al salvataggio e alla rilettura — o il difetto rientrava dalla
porta di servizio.

---

## I brevetti: si scelgono, non si scrivono

I brevetti hanno lasciato **Attrezzatura** e sono passati nelle **Impostazioni**,
subito sotto la carta che compone il libretto — che si chiama **«Dati per il
LogBook»**. Un brevetto non si revisiona, non scade e non lo porti in acqua: dice
chi sei, e il posto dove serve è il libretto.

E non si scrive più a mano. **Quattordici didattiche, 192 brevetti** (contati sul
catalogo, non a occhio): PADI, SSI, CMAS, FIPSAS, SNSI, ESA, **NADD**, NAUI, SDI,
RAID fra le ricreative — con dentro anche TecRec e XR, che restano brevetti PADI
e SSI — più TDI, IANTD, GUE, PSAI fra le tecniche, e **«Altro»** con nome e campi
liberi. Si sceglie la didattica, poi il corso fra i suoi: arriva il nome
ufficiale e con lui i fatti che quella didattica dichiara.

| File | Cosa contiene |
| --- | --- |
| `src/core/analysis/didattiche.ts` | il catalogo, con la fonte di ogni didattica |
| `src/core/analysis/gear.ts` | il modello: livello, ruolo, profondità, `didatticaId` |
| `src/ui/components/Brevetti.tsx` | le due tendine e i campi liberi |
| `tests/catalogoBrevetti.test.ts` | la tenuta del catalogo, i numeri che tutti sbagliano, e che i conti scritti nei commenti dicano il vero |

> ### ► LA REGOLA CHE VALE PIÙ DI TUTTE: NON SI INVENTANO NUMERI ◄
>
> La profondità è **vuota per metà dei brevetti** — 96 su 192 la dichiarano — e
> non è una svista. Un Enriched Air non parla di profondità: il limite lo dà la
> miscela. Un Rescue non autorizza a scendere più giù di prima. Un Divemaster
> PADI non ha un limite proprio pubblicato. Metterci 40 perché è il tetto
> ricreativo vorrebbe dire scrivere, nel logbook di qualcuno,
> **un'autorizzazione che nessuno gli ha dato**.
>
> Con NADD la proporzione è peggiorata apposta: dei suoi quarantaquattro
> brevetti solo dieci dichiarano metri, e gli altri trentaquattro restano vuoti.
>
> **E il conto vale anche quando è scritto in prosa.** Il commento in testa a
> NADD diceva «dieci su trentacinque» perché era stato scritto quando l'elenco
> era più corto: adesso un test rilegge quel commento e pretende che i due numeri
> corrispondano. _Se un numero conta, va in un `expect`; se non vale la pena
> inchiodarlo, si scrive «alcuni»._

E i numeri che ci sono vengono dagli standard, non dal senso comune. Ognuno ha il
suo test, con scritto perché:

| Fatto | Cosa circola in rete |
| --- | --- |
| **CMAS Two Star = 30 m** | 40 m: è lo standard 2013, sostituito dal BOD 233 del 2024 |
| **CMAS Three Star = 40 m, e NON è una guida** | 56 m e «entry-level leadership». Il BOD 208 del 2023 scrive che «is not qualified to lead divers» |
| **FIPSAS ≠ CMAS**: P1 = 18 (CMAS 20), P3 = **42** (CMAS 40) | che siano la stessa cosa perché sono equipollenti |
| **RAID «Open Water» = 18 m** | «Open Water 20» a 20 m: vecchio nome, resta come alias ma con i metri giusti |
| **GUE Cave 2 = 30 m, come Cave 1** | che sia più profondo. Aggiunge stage e deco, non metri |
| **SNSI Advanced Open Water = 39 m** | 40. È la conversione di 130 piedi, e SNSI la scrive così |
| **NADD Light Deco = 42 m** | 45, che è il titolo di una sezione che copre due corsi. Il corpo del testo dice 42 |

**Tre campi invece di uno, perché sono tre domande.** Il `livello` è il nostro
scalino e serve a confrontare scuole diverse; `profonditaM` è quello che dichiara
quella didattica per quel brevetto; il `ruolo` — soccorso, guida, assistente,
istruttore — non è un gradino di metri. Un istruttore che non ha il Profondo
resta un istruttore senza il Profondo.

**Il Nitrox è uscito dalla classifica delle profondità**, ed era un difetto vero:
la classifica era l'ordine in cui i valori stanno scritti nel tipo, e a chi ha
Nitrox e Profondo — il caso normale — l'app rispondeva «livello più alto
registrato: Nitrox» a una domanda che chiede fin dove sei addestrato a scendere.
Con l'EAN32 la profondità operativa è **più bassa** che in aria, non più alta.

Gradino **«Introduttivo»**: i brevetti da 12 m con obbligo di guida esistono in
**otto didattiche su quattordici** e finivano dentro il primo livello.

**Altre due cose della stessa serata**: sul telefono le tabelle non scorrono più
di lato — ogni riga diventa una scheda con l'etichetta accanto al valore, stesso
markup (`.tabella-adattiva`) — e **aprire qualcosa da modificare porta dove si
scrivono i dati** (`src/ui/scorri.ts`, `usePortaInVista`), perché la scheda si
apriva due schermate più giù e il pulsante sembrava rotto.

---

## I testi: i nomi della didattica, e mai più «SAC»

**I nomi degli obiettivi.** «Passaggio al tecnico» e «Profondo ricreativo»
descrivevano bene la cosa, ma non sono come la chiama nessuno. Adesso sono
**Subacquea Tecnica** e **Avanzato Ricreativo**, i nomi dei percorsi formativi.
**Gli `id` restano quelli** (`tec`, `deep-recreational`): finiscono nelle
impostazioni salvate e nei backup, e rinominarli farebbe ripartire da
«Miglioramento generale» chi aveva scelto altro. _Un'etichetta si cambia, una
chiave d'archivio no._

**La sigla «SAC» non compare più da nessuna parte.** L'app dice **RMV** quando il
valore è riportato alla superficie in L/min, e **consumo in bar/min** quando non
lo è. Aria e miscele si misurano nello stesso modo: la sigla suggeriva di no.

**Via i testi che parlavano solo a noi:** il lago citato per nome, il venerdì in
piscina, «l'Aladin dal Mac», le sigle mai spiegate (MOD, MODS, END, UDDF), il
«calcolato da noi» ripetuto tre volte, il numero di iterazioni del volume
critico, «su finestra di 30 s», «è un bug: segnalalo», «driver scritto a mano».

---

## Windows e Android, e il difetto che ci stava sotto

Nessuna delle due si compila su un Mac, quindi le costruisce GitHub, con un
workflow separato da «Controlli»: quello è la guardia e deve restare verde,
questo fa pacchetti per piattaforme che qui nessuno possiede e ogni tanto sarà
rosso. **Tenerli insieme insegnerebbe a ignorare il rosso.**

_(Per la 1.7.0 è il run `32912619188`: Windows in 5m39s, Android in 6m47s, tutti
e due verdi.)_

> ### ► IL DIFETTO CHE HANNO FATTO EMERGERE, DUE VOLTE ◄
>
> **La prima:** `invoke_handler` era registrato **solo per macOS e iOS**. Su
> qualunque altra piattaforma il costruttore arrivava a `run()` senza nessun
> gestore, e ogni chiamata al motore Rust rispondeva «comando sconosciuto».
> Nessun errore in compilazione, nessuno all'avvio. Si è visto **guardando
> dentro l'APK**, non facendo girare i controlli.
>
> **La seconda, peggiore:** la correzione per Android — il modulo del ritorno
> dall'accesso e il suo comando nel gestore — è stata **scritta, ha fatto passare
> `cargo check`, ed è sparita dal file prima di essere committata**. Il pacchetto
> successivo è uscito senza, e su quell'APK non si poteva entrare. Trovata di
> nuovo a mano, cercando la stringa «Accesso completato» dentro il `.so`
> consegnato.
>
> **Due volte lo stesso guasto trovato a mano è la definizione di un controllo
> mancante.** `tests/gestoriPerPiattaforma.test.ts` adesso legge `lib.rs` e conta
> i comandi registrati per tutte e quattro le piattaforme. Verificato che diventa
> rosso rimettendo il guasto.
>
> **Perché `cargo check` non poteva prenderlo:** tutto quello che manca lì è
> codice CORRETTO. Un gestore con tre comandi invece di quattro compila
> benissimo; un modulo escluso da un `cfg` compila benissimo. Non c'è niente di
> malformato da segnalare — c'è qualcosa di **assente**, e l'assenza non è un
> errore di sintassi.

| | Windows | Android |
| --- | --- | --- |
| Import da file (7 formati) | sì | sì |
| **Bluetooth, tutto il catalogo** | **sì** | **sì** |
| **Accesso con Google e Apple** | **sì** | **sì** |
| Aggiornamento automatico | **sì** | no, e non si può |

**Android ha libdivecomputer con l'NDK.** `build.rs` sapeva incrociare solo verso
Apple; adesso conosce anche l'NDK. Il compilatore è il wrapper
`aarch64-linux-android26-clang` e non il clang nudo, perché è il wrapper a
scegliere la libreria C giusta per quel livello di API — e quella scelta cambia
da un NDK all'altro. `llvm-ar` e `llvm-ranlib` senza prefisso, che dall'NDK 23
sono gli unici che esistono. `-fPIC`, perché su Android l'applicazione è una
libreria condivisa caricata da Java.

**Windows ce l'ha per un'altra strada: senza autotools.** `./configure` è uno
script di shell che chiama make, sed e grep, e sotto MSVC non c'è niente di tutto
questo. La via che sembrava obbligata — MSYS2 e gcc — metterebbe un archivio con
l'ABI di mingw accanto a un binario Rust con quella di MSVC: due runtime C nello
stesso processo, che si legano, partono e cadono dentro una `malloc`. Ma
`configure` fa **tre cose sole** che ci servano: sceglie i file (leggendoli da
`Makefile.am`), scrive `config.h` (le risposte le sappiamo già) e scrive
`version.h` e `revision.h` (quattro numeri). Quindi `build.rs` compila i 114 file
con la cassa `cc`, che su Windows usa `cl.exe`: stesso compilatore, stessa ABI,
stesso runtime del resto del binario.

> **Verificata prima di consegnarla, e non su Windows.** Sul Mac, dove le due
> librerie — quella di `configure` e quella di `cc` — si possono mettere una
> accanto all'altra: **stessi 356 descrittori**, e le stesse **85 immersioni vere
> decodificate campione per campione, 64.706 in tutto, con lo stesso hash**. Su
> Windows restava un'incognita sola, il compilatore.

**La lista dei file si legge, non si trascrive.** Una lista scritta a mano
resterebbe indietro al primo aggiornamento del tarball, e mancherebbe un driver
**senza nessun errore**: la libreria compilerebbe benissimo, solo non
conoscerebbe più quel computer. `tests/sorgentiLibdivecomputer.test.ts` rilegge
lo stesso `Makefile.am` con una seconda implementazione della stessa regola.

**L'accesso su Android costava molto meno di quanto sembrasse.** La strada che
pareva obbligata era quella dell'iPhone — uno schema URL — con un filtro
d'intenti dentro un manifesto generato, uno script per rimetterlo a ogni build, e
per Google la registrazione di un client Android che pretende l'impronta del
certificato di firma (che la nostra chiave usa-e-getta non ha). Il **loopback su
`127.0.0.1` invece su Android c'è**, ed è lo stesso identico codice del desktop.
Il modulo era `#[cfg(desktop)]` per inerzia, non per una ragione.

**L'aggiornamento automatico su Windows, con la chiave che resta sul Mac.** La
condizione diceva `macos` da quando il Mac era l'unico computer su cui girassimo.
La chiave privata sul runner di GitHub non ci va — sarebbe affidare a un segreto
di repository la sola cosa che rende sicuri gli aggiornamenti di tutti, Mac
compresi, e non si potrebbe revocare senza lasciare a piedi ogni installazione
esistente. Quindi **GitHub costruisce e il Mac firma**: `npm run windows:firma`.
Il controllo che dice se è successo è `latest.json` della release, che deve
elencare **due** piattaforme: sulla 1.7.0 `darwin-aarch64` e `windows-x86_64`.

> **E adesso c'è una copia del Mac che l'aggiornatore non ce l'ha per scelta.**
> Quella del Mac App Store: là aggiorna il negozio, e il plugin è tolto alla
> compilazione. È l'unica delle cinque consegne in cui `latest.json` non
> significa niente.

> ### ► QUI C'ERA SCRITTO CHE L'APK ERA FIRMATO CON UNA CHIAVE PUBBLICA. NON ERA FIRMATO AFFATTO. ◄
>
> **29 agosto 2026.** Questa sezione diceva: «la firma dell'APK è pubblica, e si
> dice — la chiave la genera il workflow con una password scritta in chiaro: non
> è un segreto trapelato, è un segreto che non c'è». Il ragionamento era giusto e
> la premessa era falsa. **Misurato sull'APK vero, scaricato dalla release:
> nessuna firma v1** (niente `META-INF/*.RSA`) **e nessun APK Signing Block
> v2/v3.** Il pacchetto non era firmato in nessun modo.
>
> **Android un APK non firmato si rifiuta di installarlo.** Quindi il pulsante
> «Scarica per Android» del sito ha consegnato per settimane, a chiunque lo
> abbia premuto, un file che non si installa.
>
> La causa: il workflow generava il keystore e scriveva `keystore.properties`,
> ma **il `build.gradle.kts` che Tauri genera non contiene nessun
> `signingConfigs`** — quel file non lo leggeva nessuno. In Tauri 2 la firma su
> Android si aggiunge a mano al progetto generato, ed è scritto nella loro
> documentazione e non nel loro template.
>
> **È la sesta volta che questo progetto paga la stessa specie di guasto**: il
> gestore Rust registrato per due piattaforme su quattro, il file fuori dalla
> lista dei sorgenti, il numero sbagliato dentro un commento, la rotta promessa
> da un file di configurazione, la dichiarazione doganale presente in un plist
> su due — e adesso una configurazione di firma che non c'è. *Nessuna dà errore,
> perché nessuna è malformata: sono assenze.* `tauri android build --apk`
> finiva con esito zero, il workflow era verde, l'artefatto c'era e pesava dieci
> megabyte. **Un esito zero dice che il comando non è morto, non che abbia fatto
> quello che doveva.**
>
> E come le altre cinque, l'ha trovata **guardare dentro il file consegnato**, e
> non i controlli: è saltata fuori mentre si preparava la strada per Google
> Play, cercando tutt'altro.
>
> Adesso: `scripts/firma-progetto-android.mjs` aggiunge la configurazione di
> firma al progetto generato subito dopo `tauri android init` — e **rompe** se
> non ci riesce, invece di dichiarare che è andato tutto bene; e un passo del
> workflow **apre il pacchetto costruito e pretende di trovarci dentro una
> firma**, che è il controllo che mancava. Tre prove in
> `tests/androidNegozio.test.ts` difendono le due cose e il loro ordine — un
> controllo della firma messo prima della build passerebbe sempre, perché non
> ci sarebbe niente da guardare.
>
> **Chiuso la sera stessa, sostituendo l'allegato della `v1.7.1`.** L'APK servito
> da `releases/latest/download/` è adesso firmato v2/v3, SHA-256
> `390c174f87e14fa0ea6c1fc6690912afe2a223fc19d9650e99ffc517a2c5e6e1` —
> ricalcolata riscaricando dall'indirizzo pubblico, non dal disco. **E le note
> della release lo dicono**: un file pubblicato non si sostituisce in silenzio,
> perché l'impronta scritta nelle note serve a chi vuole verificare cosa ha
> scaricato, e cambiare il file senza cambiare la riga la trasforma in una bugia
> — chi la controlla conclude di avere in mano un file manomesso. Scelto di
> sostituire invece di alzare a 1.7.2: il codice è identico, e *un numero di
> versione nuovo che non cambia niente di percepibile è una bugia di segno
> opposto.*

**La chiave di firma, adesso.** Con i tre segreti (`ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`) il workflow firma con la
chiave del proprietario e costruisce anche l'`.aab` per Google Play; senza,
ricade nella chiave usa-e-getta e nel solo APK, perché questo repository è
pubblico e chi lo clona deve poterlo costruire lo stesso. Il sito continua a
dichiarare quello che è sempre stato vero e che oggi conta di più: **a garantire
l'origine del file è l'impronta SHA-256 pubblicata accanto**, non la firma.

**E il sito mette i limiti PRIMA del pulsante.** Costa qualche scaricamento in
meno e risparmia la delusione di scoprirli dopo.

---

## L'analisi con Claude non c'è più

Tolta dall'applicazione con la 1.6.2. Le ragioni, in ordine di peso:

1. **Era l'unica funzione di cui nessuno avesse mai verificato l'uscita.** Il
   Bühlmann è validato su 38 immersioni contro Shearwater, i decoder contro
   libdivecomputer campione per campione, i numeri della didattica contro la
   pagina del manuale. Le risposte del modello no. In un logbook subacqueo un
   commento non verificato su un profilo decompressivo è una classe di rischio
   diversa da un difetto d'interfaccia.
2. **Era l'unica cosa che il revisore Apple non poteva provare**: serve la chiave
   API dell'utente. Dopo un rifiuto 2.1 «Information Needed», è il genere di
   funzione che ne genera un altro.
3. **Era l'unica eccezione a una storia di privacy pulita**: «un solo permesso,
   il Bluetooth, non si traccia niente» aveva un asterisco, ed era questo.
4. **Pesava sul primo avvio: 111.5 → 87.6 kB gzip, −21%.** Il codice dell'analisi
   NON era a caricamento pigro come il pianificatore o le traduzioni: stava nel
   pezzo che il telefono compila prima di disegnare qualunque cosa, e lo pagava
   anche chi una chiave API non l'ha mai avuta.

**Cosa resta:** `src/ai/context.ts` e `src/ai/prompts.ts`, che **non entrano più
nel pacchetto** — servono a `npm run dump:ai`, uno strumento da riga di comando.
I loro trenta controlli restano tutti: la proprietà che difendono — _un dato che
l'app non ha non deve comparire nel contesto come numero_ — vale identica adesso
che il contesto lo si legge a mano. _(Anche lì c'era il tempo di fondo passato
dove `similarDives` filtra sulla durata totale: corretto.)_

**La chiave rimasta nel portachiavi si cancella da sola** al primo avvio
(`dimenticaChiaveAi`). Una credenziale che si spende a spese di chi l'ha
generata, conservata da un'applicazione che non la usa più, è una responsabilità
senza contropartita.

---

## Il catalogo dei computer, e l'ordine che conta

libdivecomputer 0.9.0 descrive **356 modelli**, di cui **110 parlano BLE** —
l'unico trasporto praticabile da un telefono — che accorpati per nome commerciale
diventano **105 voci e 20 marche**.

_(`grep -c DC_TRANSPORT_BLE` ne conta 124, ma quattordici di quelle righe sono
codice C. Il conto giusto lo fa `scripts/catalogo-computer.mjs`.)_

**► L'ORDINE OVVIO È ESATTAMENTE QUELLO SBAGLIATO. ◄** Ordinando per numero di
modelli, primo sarebbe **Ratio** — 25 modelli BLE, **l'1.3%** dei subacquei — e
in fondo **Suunto**, 4 modelli e **il 20.3%**. **Shearwater** ne ha 11 e ce l'ha
**uno su due** (51.5%). Da qui l'ordinamento per **diffusione**, con la fonte e
il suo limite dichiarati in `src/core/ble/catalogo.ts`, e un test che lo difende.

**Nessuna scelta finisce nel vuoto.** I driver di casa leggono 22 modelli su 105,
e ogni voce dice cosa succede premendo:

| Esito | Cosa vuol dire |
| --- | --- |
| si scarica | driver scritto in casa, provato con l'apparecchio in mano |
| **via libdivecomputer, mai provato su questo modello** | la libreria c'è e conosce il protocollo — ma qui, con quel modello, non è mai stata eseguita |
| non ancora via Bluetooth | la libreria lo saprebbe leggere, questa copia è compilata senza |
| solo importando il file | Garmin: per sempre |

**Garmin è nel catalogo apposta.** Nell'indagine è il 4.4%, quarta marca, e in
libdivecomputer non compare: i Descent i dati via BLE non li danno a nessuno.
Fino al debug quel ramo era **irraggiungibile** — chi cercava «garmin» riceveva
«nessun modello con questo nome». Ora otto voci `MODELLI_SENZA_BLE` esistono per
essere trovate e ricevere la risposta vera.

---

## libdivecomputer: adesso è accesa

| Pezzo | Stato |
| --- | --- |
| elenco dei modelli, trasporto, scarico, traduzione in Rust, ponte BLE | c'è |
| traduzione nel modello del logbook (`src/core/ble/esterni.ts`) | c'è, 18 controlli |
| il punto di contatto (`src/storage/computerEsterni.ts`) | c'è |
| il selettore che ci porta | c'è, fotografato e misurato |
| **l'accensione nelle build di rilascio** | **fatta**: `default = ["computer-esterni"]` |
| l'attribuzione dentro l'app | c'è: scheda «Riconoscimenti» nella pagina di sincronizzazione, con LGPL-2.1 e i collegamenti |
| **la prova con un computer vero** | **manca, ed è l'unica cosa che manca** |

**Le due cose da difendere**, scritte per esteso nel commento sopra `default` in
`Cargo.toml`: il sorgente resta pubblico, e **il tarball versionato in
`src-tauri/vendor/` resta _la_ fonte di compilazione** — non una copia di comodo.
Finché è così, chiunque abbia il repository ha gli **stessi byte** contro cui è
stato compilato il binario pubblicato, e può ricostruire la libreria da sé.

**Il segnaposto «mai provato su questo modello» resta finché non c'è la prova su
un apparecchio terzo.** In un logbook una lettura sbagliata non dà errore: dà un
profilo plausibile e falso.

### ► LA LGPL, DETTA CON LA PRECISIONE CHE HA E NON DI PIÙ ◄

L'applicazione è MIT; l'unica dipendenza LGPL-2.1 è la libreria vendorizzata.

**Il manutentore di libdivecomputer, interpellato direttamente nell'agosto 2026,
ha detto di non avere obiezioni e di considerare la posizione di MyDiveLog
conforme allo _spirito_ della licenza** — per un'applicazione open source ritiene
accettabile anche il collegamento statico, perché chiunque può ricostruire
l'intera applicazione, libreria compresa, dal sorgente. **Non ha dichiarato che
la lettera della licenza sia soddisfatta**: dice esplicitamente il contrario, e
attribuisce quella parte al lato Apple. **La sola condizione che chiede è che le
modifiche e i miglioramenti alla libreria tornino a monte.**

Va letta così com'è scritta, senza gonfiarla: non è un'esenzione e non è un
parere legale. Ed è il motivo per cui il tarball resta versionato dov'è — passare
a un sottomodulo, o a un download in fase di build, toglierebbe a chi riceve il
binario proprio i byte da cui ricostruirlo.

**E il debito verso monte è un impegno preso, quindi va scritto.** Quello che
abbiamo in mano e non abbiamo ancora proposto:

- **l'Aladin Sport Matrix si annuncia via BLE come «Aladin Sport»**, non «Aladin»
  come lo elenca `descriptor.c`. È il motivo per cui il riconoscimento automatico
  falliva su un apparecchio che la libreria supporta;
- **il campo a offset 24 dell'intestazione Uwatec Smart**, che `descriptor.c`
  marca come sconosciuto, **è la profondità media**: verificato su 85 immersioni
  contro la media pesata sul tempo dei campioni.

Il testo della LGPL-2.1 e l'elenco delle eccezioni stanno in `LICENSES/`;
l'attribuzione file per file, con anche quello che dobbiamo restituire, sta nel
README.

---

## Il debug del 25 agosto: otto difetti a catena verde

**Sei di correttezza, tutti nel percorso libdivecomputer:**

1. **`DECO_NDL` valeva 1, e vale 0.** `parser.h` dice `DC_DECO_NDL = 0`,
   `DC_DECO_SAFETYSTOP = 1`; il commento sopra la costante dichiarava un ordine
   inventato. Conseguenze silenziose: l'NDL non arrivava mai, i secondi di una
   sosta di sicurezza finivano in `ndlS`, e ogni campione in curva riceveva
   `ceiling: 0` — che in `dedupe.ts` regala due punti a quel profilo e gli
   permette di **sostituire** il profilo vero di un driver di casa.
2. **Le pressioni erano indicizzate sulla lista sbagliata**: `pressure.tank` è un
   indice di BOMBOLE, `cylinders` nasceva dalle MISCELE. Un integrato con un gas
   e il trasmettitore sulla bombola 2 faceva scrivere «nessuna pressione bombola:
   consumo non calcolabile» su un'immersione con 130 bar consumati.
3. Profondità media e temperatura minima arrivavano dal Rust e venivano buttate.
4. Ogni rebreather entrava a circuito aperto (`mode` era `'oc'` fisso).
5. Un record senza data diventava il 31 dicembre 1969 ed entrava in archivio.
6. La durata veniva dall'ultimo campione invece che dal massimo.

**Quattro d'interfaccia:** il catalogo e la risposta «non legge ancora»
risorgevano da soli alla ricerca successiva (con l'autoFocus, cioè la tastiera
che sale); il testo mandava «dal Diario», scheda che non esiste; il fuoco cadeva
su `<body>` chiudendo il pannello; la risposta su Garmin era irraggiungibile.

**E un controllo che non partiva più.** `scripts/screenshot.mjs`, il giro
completo dell'interfaccia, moriva riempiendo il primo campo di testo che
trovava: nelle impostazioni i primi due erano nome e brevetto, quindi l'indirizzo
Turso finiva scritto nel nome del subacqueo e il pulsante restava spento. **Un
controllo che non parte non è un controllo che passa.** _(Dalla 1.6.5 il secondo
campo è una tendina, non più un campo di testo.)_

**Il guardiano nuovo:** `tests/costantiLibdivecomputer.test.ts` scompatta il
tarball versionato e confronta ogni costante con l'intestazione C vera — valori
di enum, indici dei campi, le cinque modalità, `DC_GASMIX_UNKNOWN`, l'ordine dei
campi di `dc_tank_t`. Rimettendo `DECO_NDL = 1` diventa rosso: verificato.

**E la sicura in `dedupe.ts`:** un profilo letto da libdivecomputer non
sostituisce mai un profilo di un driver provato sul campo. Nel caso peggiore si
vede un'immersione nuova sbagliata — che si nota — invece di una giusta distrutta
in silenzio.

---

## Decisioni prese

| Decisione | Scelta | Perché |
| --- | --- | --- |
| Piattaforme | desktop macOS → iOS → web | ordine dichiarato dal proprietario |
| Stack | Tauri 2 + React 19 + TypeScript | un codebase per tre piattaforme |
| Logica | tutta in `src/core`, senza dipendenze da piattaforma | evita di riscriverla per iOS e web |
| Storage | SQLite su desktop/iOS, IndexedDB sul web, dietro un'unica interfaccia | scelta automatica da `__TAURI_INTERNALS__` |
| Profili | tabella separata, caricata solo aprendo una scheda | 2000 immersioni = ~700k campioni |
| Grafici | SVG a mano, nessuna libreria | il profilo di profondità nessuna libreria lo fa bene |
| **PDF** | **scritto a mano, uscita ASCII** | su iPhone non esiste una finestra di stampa, e il foglio serve **lì** |
| Deduplica | euristica di Subsurface + impronta del profilo + veto sull'identificativo interno | tre difetti diversi, tre rimedi diversi |
| **L'ora di un computer subacqueo** | **si crede all'ORA A PARETE, non all'UTC che dichiara** | un computer sa che ora segnava, non in che fuso si trovava. Vale anche per libdivecomputer |
| **Il fuso da applicare** | **quello del dispositivo che scarica, alla DATA dell'immersione** | l'ora legale va valutata allora, non oggi |
| **Una frase con dentro un numero** | **`frase(t, '… {0} …', valore)`, mai un template literal** | la chiave del dizionario è la frase intera: con il numero dentro cambia a ogni chiamata e non ci entra mai |
| **La traduzione di una frase con segnaposti** | **si controlla che porti GLI STESSI segnaposti dell'italiano** | una che ne perde uno resta grammaticale e fa sparire un numero in silenzio: è il difetto che non si trova rileggendo |
| **Il locale di date, ore e numeri** | **un registro in `core/locale.ts`, scritto da chi decide la lingua** | non è un dato della chiamata, è una preferenza sola del dispositivo — e passarlo per quaranta firme vuol dire dimenticarlo di nuovo |
| **`en-GB`, non `en-US`** | giorno prima del mese, orologio a 24 ore | è come scrive le date il computer subacqueo da cui quelle immersioni arrivano |
| **Il libretto e il foglio del piano** | **restano in italiano in ogni lingua** | sono il documento dell'art. 12 comma 8: tradurli non li renderebbe più internazionali, li renderebbe non conformi |
| **Un confronto «è cambiato?»** | **si normalizza da tutti e due i lati, in una funzione** | da un lato solo, un token incollato con uno spazio in coda spegne il pulsante per sempre |
| **La chiave di una riga in una lista** | **una chiave sua, salvata col dato** | con l'indice, togliendo una riga in mezzo lo stato passa al vicino — e su una bombola quello stato dice che gas c'è dentro |
| **► Un messaggio d'errore mostrato a una persona ◄** | **non porta MAI il nome di una dipendenza; se il dettaglio tecnico non si può ripulire, non si mostra affatto** (28 agosto 2026) | il primo utente esterno ha letto una riga inglese col nome della libreria BLE dentro un'app italiana. Chi legge non impara niente e non sa cosa fare: sembra soltanto che l'app si sia rotta. La macchina per rispondere bene c'era già, col percorso delle impostazioni tradotto per ogni sistema: mancava chi la accendesse |
| **L'elenco dei nomi da non far uscire a schermo** | **copre i LIVELLI SOTTO L'INTERFACCIA, non le dipendenze di `package.json`** (28 agosto 2026) | la prima versione si è accesa contro di noi su `@garmin/fitsdk` — «garmin» è una marca che nominiamo apposta — e dentro «t**hrust**». Due eccezioni dichiarate col loro motivo: **`libdivecomputer`** (l'attribuzione LGPL resta visibile) e **`SQLite`** (la riga che dice dove stanno i dati) |
| **L'ordine delle marche nel selettore** | **per diffusione, non per numero di modelli** | Ratio: 25 modelli e l'1.3%. Suunto: 4 e il 20.3% |
| **Un modello che non si scarica** | **si mostra lo stesso, e dice perché e come fare invece** | un pulsante spento non dice perché è spento |
| **Driver di casa vs libdivecomputer** | **due esiti distinti, scritti sotto il nome** | in un logbook una lettura sbagliata non dà errore, dà un profilo plausibile e falso |
| **libdivecomputer nei pacchetti** | **accesa, e si corregge quando qualcuno segnala** | la libreria copre 105 modelli contro i 22 dei driver di casa |
| **Come si compila quella libreria** | **`configure` dove c'è una shell, la cassa `cc` dove non c'è** | mescolare l'ABI di mingw con quella di MSVC dà un pacchetto che si installa e crolla |
| **Il ritorno dell'accesso su Android** | **loopback, come sul desktop** | lo schema URL costava un manifesto generato da rattoppare e un certificato stabile che non abbiamo |
| **L'analisi con un modello** | **fuori dall'applicazione** | è l'unica uscita che nessuno ha verificato, e l'unica cosa che il revisore non può provare |
| **Le costanti copiate da un'intestazione C** | **confrontate da un test con l'intestazione vera** | una trascrizione sbagliata di un enum non dà errore: dà un numero plausibile |
| **Un conto scritto dentro un commento** | **inchiodato da un test come qualunque altro numero** | l'elenco cresce, il commento no — e a un commento si crede più che a un dato, perché sembra una spiegazione |
| **Un percorso nominato in un file di configurazione** | **confrontato da un test con le rotte che il servizio serve davvero** (27 agosto 2026) | `wrangler.toml` rimandava a `/segnalazioni.csv`, che non è mai esistita: la configurazione prometteva una maniglia che non c'era, e il cassetto si è riempito per settimane |
| **Una dichiarazione che vale per due piattaforme** | **si controlla che sia in TUTTI i plist, e che dica la stessa cosa** (27 agosto 2026) | `ITSAppUsesNonExemptEncryption` era in `Info.ios.plist` e non in `Info.plist`, e la mancanza si è scoperta solo il giorno del primo caricamento sul Mac App Store. Due risposte diverse alla stessa domanda doganale, per la stessa applicazione, sono una contraddizione agli atti |
| **`minimumSystemVersion` per macOS** | **12.0, e un test non lo lascia scendere finché il binario è solo arm64** (27 agosto 2026) | diceva 10.15 **da sempre**: il `.dmg` del sito prometteva di girare su Mac Intel e su Catalina, dove installa e non si apre. L'ha scoperto Apple rifiutando un caricamento, non un utente e non un test |
| **Il pacchetto per il Mac App Store** | **sandbox accesa e aggiornatore tolto alla COMPILAZIONE**, non nascosto (27 agosto 2026) | una copia del negozio che si aggiorna da sola è motivo di rifiuto, e un pulsante «cerca aggiornamenti» che non fa niente è peggio di nessun pulsante |
| **Le segnalazioni dal sito** | **prima l'archivio del Worker, POI la copia nel foglio** | l'archivio è la verità e il foglio è la copia comoda: un guasto di Google costa una copia mancata, non una segnalazione persa |
| **La risposta di un Apps Script** | **si legge il CORPO, non lo stato** | risponde 200 anche quando rifiuta, perché il rifiuto è testo: fidarsi dello stato è fallire somigliando in tutto al successo |
| **Rileggere le segnalazioni** | **uno script dal Mac che passa da `wrangler`, non una rotta** | una rotta che restituisce i contatti di chi ha scritto è una superficie nuova su Internet da proteggere; `wrangler` è già autenticato |
| **Le quattro piattaforme sul sito** | **due gruppi detti a parole, non quattro schede di grandezza diversa** (27 agosto 2026) | la differenza affidata alla dimensione si legge solo se qualcuno la nota; scritta, chi arriva da Windows sa subito che c'è e in che condizioni |
| **Il marchio Apple sul sito** | **la mela nell'occhiello, non il badge ufficiale** (27 agosto 2026) | **decisione del proprietario, informato che è il contrario di quello che Apple prevede**: il badge «Scarica su App Store» è l'uso consentito a un terzo, la mela come icona di sezione no. È un **tracciato in linea** e non il carattere della mela, che vive nell'area privata di Unicode e su Windows e Android uscirebbe come un rettangolo vuoto |
| **Le schermate della scheda del negozio** | **restano quelle del proprietario, non si rifanno dal simulatore** (27 agosto 2026) | decisione sua: mostrano un archivio vero |
| **Le sei classi CSS che nessuno usa** | **non si toccano** (27 agosto 2026) | decisione sua, e non c'è nessun difetto visibile: sono righe morte, non un guasto — al contrario di `.pulsante-attesa`, che descriveva uno stato dell'interfaccia e per questo è stata tolta |
| **Il sito, a ogni rilascio** | **si ripubblica solo se è cambiato** | i pulsanti puntano a `releases/latest/download/...` e seguono la release da soli |
| Multiutente | un database per persona, accesso facoltativo | l'isolamento è fisico |
| **Condividere un'immersione in sola lettura** | **fuori dal perimetro** (26 agosto 2026) | **decisione del proprietario, e il motivo non è stato messo agli atti.** Qui non ce n'è scritta una, perché inventarne una plausibile sarebbe peggio che dichiarare il vuoto. La descrizione di cosa sarebbe servita — leggere senza modificare e senza vedere il resto — resta in `architettura.md`, dove è nata |
| **Autenticazione** | **Google e Apple, tutti e due** | linea guida 4.8, non negoziabile |
| **Bersaglio iOS** | **solo iPhone** | togliere l'iPad dopo aver pubblicato sfila l'app dagli iPad di chi l'aveva |
| **Numerazione** | **1.x dappertutto** | App Store Connect confronta i numeri pezzo per pezzo |

---

## Cosa c'è

**Import.** Sette parser rilevati dal contenuto, non dall'estensione. Decoder
Uwatec Smart e log nativo Shearwater riscritti da libdivecomputer. gzip/DEFLATE e
lettore SQLite scritti a mano. Deduplica fra fonti. Inserimento a mano, modifica
in blocco, unione a mano di due schede.

**Scarico via Bluetooth: due driver verificati sul campo, più libdivecomputer per
tutti gli altri.** Shearwater (Peregrine) e Scubapro/Uwatec (Aladin Sport Matrix,
117 immersioni in un giro). Scarico incrementale con segnalibro, ripresa a metà,
diario tecnico, byte grezzi. Il selettore dice sempre cosa succede, e
**«Interrompi» funziona per tutta la durata dello scarico**, anche via
libdivecomputer. **E quando la ricerca non parte, adesso dice perché**: il
permesso negato ha un messaggio suo, col percorso delle impostazioni giusto per
il sistema che si sta usando.

**Il libretto dell'art. 12, comma 8 — tutte e tredici le lettere**, con la firma
della guida raccolta col dito e conservata come tratti, **e un modo di uscire dal
riquadro senza firmare**. Nome e brevetto stanno nelle Impostazioni, sotto «Dati
per il LogBook», e il brevetto si sceglie fra quelli registrati lì sotto.

**Il catalogo delle didattiche**: quattordici scuole, 192 brevetti, con la
profondità che ciascuna dichiara — e il silenzio dove non la dichiara.

**La scheda in PDF, anche dall'iPhone**, generata a mano, uscita ASCII.

**La scheda di un'immersione**, col **gas analizzato** per bombola confrontato
con la miscela dichiarata.

**Analisi del profilo.** Bühlmann ZH-L16C con GF validato contro Shearwater;
CNS/OTU per giornata del luogo, **e per la miscela di ogni fase**; i sedici
compartimenti.

**Statistiche e suggerimenti**, con criteri cumulativi e prove numeriche.

**Pianificazione** gas e decompressione, con quota in tutti i conti — **compresi
i litri, che adesso li contano in bar e non in ATA**.

**Archivio**: cestino a trenta giorni, sincronizzazione libSQL **in tutte e due
le direzioni**, backup JSON, riparazione all'avvio.

**Quattro formati d'uscita** più il backup JSON.

**Accesso con Apple e con Google, facoltativo**, con cancellazione dell'account
dentro l'app.

**Due lingue, italiano e inglese, senza più eccezioni nell'interfaccia** — piano
di miglioramento compreso, e tradotto davvero: 1969 voci, nessuna vuota. Restano
volutamente in italiano solo i due fogli stampabili (il libretto di legge e il
foglio del piano) e le note interne che nessuno vede a schermo.

**Il sito** `mydivelog.site`, IT su `/` e EN su `/en/`, **con la scheda iOS che
porta al negozio** in tutte e due le lingue.

**Un modulo di segnalazione che arriva a destinazione.** Scrive nell'archivio del
Worker e da lì una copia finisce nel foglio di Google, con la parola d'ordine che
protegge lo script e un travaso dal Mac per quello che resta indietro.

**► iOS: pubblicata sull'App Store. ◄** Approvata il 26 agosto 2026 al terzo
invio; i due rifiuti precedenti — 2.1 (informazioni) e 2.1(a) (crash su iPad
toccando «Take Photo or Video») — sono chiusi tutti e due. La versione che il
negozio serve è la **1.7.0**, approvata e pubblicata il 28 agosto 2026 alle
16:02:32 UTC; la scheda è in **italiano soltanto**, e questo si misura: la
stessa descrizione italiana torna interrogando la vetrina americana.

**► macOS: pubblicata sul Mac App Store. ◄** Il pacchetto era stato consegnato il
27 agosto alle 21:44, al terzo tentativo; sciolta la «Conformità mancante» e
mandata in revisione, la **1.7.0** è pubblica anche sul Mac — il 28 agosto.

**Come si misura, perché il `lookup` qui non risponde.** La scheda dell'App Store
è **una sola** per iPhone, iPod touch e Mac (`6804439480`), e il campo `version`
che il `lookup` restituisce è quello della versione **iOS**: da lì la
pubblicazione macOS non si vede, né oggi né fra un mese. Quello che si misura è
la voce **Mac** nel blocco «Compatibilità» della scheda, che l'App Store mostra
**solo se esiste una versione macOS pubblicata**:

```
curl -s "https://apps.apple.com/it/app/mydivelog/id6804439480" \
  | grep -o "Richiede macOS[^\"]*"
```

Il 28 agosto risponde «Richiede macOS 12.0 o versioni successive e un Mac con
chip Apple M1 o versioni successive». **L'ora della pubblicazione sul Mac non è
stata misurata**: si sa il giorno, non il momento — e quel che non è stato
misurato qui non si scrive.

---

## Prossimi passi

### Tocca a chi pubblica

1. **~~La 1.7.1 ai due negozi.~~ Fatta, tutti e due.** Su **App Store per
   iPhone** dal **28 agosto alle 21:25:04 UTC**, misurato col `lookup` e
   l'anti-cache; sul **Mac App Store**, dichiarato dal proprietario l'1
   settembre. _Questa voce ha attraversato tre stati in cinque giorni —
   «da sciogliere», «da consegnare», «consegnata» — e nessuno dei tre è stato
   dedotto dal precedente: ognuno è stato misurato, o dichiarato da chi poteva
   saperlo._ **Resta vero il criterio, che non scade con la voce**: il numero nel
   repository, quello che il negozio iOS consegna a un estraneo e quello del Mac
   App Store sono **tre affermazioni diverse**, e oggi dicono tutte e tre `1.7.1`
   solo perché sono state guardate una per una.
2. **~~Ripubblicare il sito.~~ Fatto la sera del 29**, e di nuovo l'1 settembre
   con la scena dell'apertura e le due pagine di aiuto: impronta sul disco e
   impronta servita coincidono su `8b2ca48d`, e `/aiuto` risponde `200`.
3. **La scheda del negozio in inglese**, e adesso vale per **tre** negozi. È una
   localizzazione su App Store Connect, non una build nuova, e non promette più
   niente che l'app non mantenga: l'interfaccia è tradotta per intero, piano di
   miglioramento compreso. **Oggi non c'è**: la vetrina americana serve la
   descrizione italiana, ed è il modo di accorgersi del giorno che cambia.

> _Il 27 agosto da questo elenco sono uscite due voci, e nessuna delle due è
> stata dimenticata. **«Aspettare l'esito della revisione»** è chiusa: l'esito è
> arrivato ed è positivo. **«Le schermate dal simulatore»** è una decisione del
> proprietario, che tiene le sue: sta fra le **decisioni prese**. Un elenco di
> cose da fare da cui le righe spariscono senza motivo diventa, nel giro di un
> mese, un elenco di cui nessuno sa più cosa sia stato deciso e cosa
> dimenticato._
>
> _Il 28 agosto ne sono uscite altre due, e nemmeno queste sono state
> dimenticate: **«la 1.7.0 su App Store Connect per iPhone»** e **«il Mac:
> sciogliere Conformità mancante e mandare in revisione»** sono chiuse tutte e
> due, perché la 1.7.0 è pubblica su tutti e due i negozi — misurata, non
> dedotta. Quello che resta è consegnare la 1.7.1 a entrambi, ed è scritto sopra
> al posto loro._

### Tocca al codice

4. **Provare libdivecomputer con un computer che non sia il Peregrine né
   l'Aladin** — e solo allora togliere il «mai provato su questo modello». Adesso
   vale anche per Android, dove la libreria è dentro.
5. **Restituire a monte le due scoperte**: il nome BLE dell'Aladin Sport Matrix e
   l'offset 24 dell'intestazione Uwatec (profondità media). È la sola condizione
   che il manutentore della libreria ha chiesto, quindi non è una cortesia.
6. **Un riscontro indipendente per VPM-B.**
7. **Dire sul sito che il pacchetto macOS vuole macOS 12 e Apple Silicon.** Il
   pacchetto ha smesso di dichiarare il falso, ma la pagina non dichiara niente,
   e per chi ha un Mac Intel il risultato è lo stesso — scarica, installa, non si
   apre. _È una riga di HTML._
8. **Scarico via USB/seriale**, TestFlight, iPad, **condivisione di
   un'immersione in sola lettura**: fuori. _(L'ultima è entrata in questa riga il
   26 agosto, per decisione del proprietario e senza che il motivo sia stato
   messo agli atti — vedi le **decisioni prese**. Le altre tre stavano già qui.)_

> _Il 28 agosto da questo elenco è uscita **«Un'impronta del profilo anche per il
> log PNF Shearwater»**, ed è uscita perché è **fatta**. `improntaPnf` in
> `src/core/parsers/shearwaterPnf.ts` calcola l'impronta sui soli record di
> campione — non sull'intestazione, che porta l'orologio, né sul riempimento a
> zero, che nelle due strade è di lunghezza diversa — e la scrivono in archivio
> sia il parser di Shearwater Cloud sia lo scarico Bluetooth. Il difetto che
> chiude è misurato in `tests/shearwaterCloud.test.ts`: lo stesso tuffo
> importato da Shearwater Cloud e scaricato via Bluetooth entrava **due volte**,
> perché il database porta l'epoch vero mentre il computer porta l'ora a parete e
> il fuso ce lo mette il telefono che scarica — tre ore di scarto per
> un'immersione fatta a +5 e scaricata a casa a +2, contro una finestra di
> riconoscimento che è metà della durata. Uno sfasamento sistematico non era
> nemmeno deducibile: `inferClockOffsets` vuole almeno due coppie che concordino,
> e con un computer solo non ce n'è nessuna._

### Le insidie di iOS, pagate e scritte in README

Tutte hanno la stessa radice: **`gen/apple/` è generata e non versionata**.

- **`tauri ios init` NON riscrive un file che trova già lì**, e dice comunque
  «Project generated successfully». Gli script `ios:*` cancellano `project.yml`
  prima di rigenerare, e un test lo impone.
- **Il manifesto della privacy** va copiato prima dell'init, o arriva ITMS-91053.
- **`libapp.a` finisce nelle risorse**: 470 MB invece di 6. Lo toglie
  `scripts/pulisci-progetto-ios.mjs`, che toglie anche **l'iPad**.
- **CoreBluetooth va dichiarato** in `bundle.iOS.frameworks`.
- **Le icone vanno quadrate e opache**; **il telefono va registrato a mano** la
  prima volta.
- **`npm run ios:telefono` non arriva in fondo, ma il punto in cui si ferma
  cambia.** Fino alla 1.6.7 si fermava all'esportazione (`Couldn't load
  -exportOptionsPlist`); sulla 1.7.0 l'`.ipa` è stato esportato regolarmente e il
  comando è caduto **dopo**, ricompilando per installare sul telefono, con _The
  developer disk image could not be mounted on this device_ e uscita 70 — perché
  il telefono era bloccato. **In tutti e due i casi l'`.ipa` firmato esiste già**
  in `gen/apple/build/arm64/`: si mette in salvo fuori dal repository e si
  installa a parte con `xcrun devicectl device install app` — che sulla 1.7.0, a
  schermo sbloccato, è andato al primo colpo. _Non se ne concluda che l'export
  adesso funziona sempre: non è cambiato niente di nostro fra le due volte. Si
  guarda il file e la sua data, non l'etichetta._
- **`npm run ios:negozio` invece arriva in fondo**, e il `.ipa` che produce è
  quello firmato per App Store Connect: va copiato FUORI da `gen/apple/`, che la
  build successiva rigenera.
- **Dopo l'installazione si verifica sul telefono, non nel messaggio.**
  `xcrun devicectl device info apps` dice quale versione c'è davvero, e
  `devicectl device process launch` dice se parte: _«App installed» significa che
  i file sono al loro posto, non che l'app si apra._
- **La CSP è l'elenco dei servizi raggiungibili.** Oggi sono due: Turso e il
  servizio di accesso.
- **Su iOS non c'è la stampa**: al suo posto l'esportazione in PDF.
- **Il selettore file senza `accept` fa comparire la fotocamera**, e su iPad
  toccarla ha fatto crashare l'app in revisione.

### Le insidie della pubblicazione su Mac

**Per il `.dmg` del sito:**

- **`bundle_dmg.sh` fallisce se una build precedente ha lasciato un volume
  montato.** Si smonta `/Volumes/dmg.*`, si cancellano il `rw.*.dmg` e la `.sig`
  vecchia, e riparte.
- **L'app non resta aperta dopo l'installazione** se LaunchServices punta a un
  inode cancellato: `lsregister -f` sulla cartella dell'app.
- **`notarytool` può scadere lato client mentre Apple ha già accettato.** Non si
  rimanda: si interroga con `notarytool info <id>`.

**Per il `.pkg` del Mac App Store** — tutte scoperte il 27 agosto, e tutte
**dopo** una compilazione intera:

- **Togliere l'aggiornatore non basta a spegnerlo**: senza
  `createUpdaterArtifacts: false` la build muore con _plugins > updater doesn't
  exist_, perché Tauri cerca la configurazione di un plugin che si è appena
  tolto.
- **`com.apple.application-identifier` e `com.apple.developer.team-identifier`
  mancanti non fanno fallire la firma**: `codesign` scrive quello che gli si dà,
  e il rifiuto arriva al caricamento. Lo script adesso li confronta col profilo
  di provisioning prima di consegnare.
- **La quarantena del browser viaggia dentro il pacchetto.** `xattr -cr` dopo la
  copia e **prima** della firma.
- **`minimumSystemVersion` sotto 12.0 con un binario solo arm64 è un rifiuto
  automatico**, e prima ancora è una bugia detta a chi scarica dal sito.

---

## Limiti noti, misurati e scritti nel codice

- **L'ancora dei gradient factor** è il tetto arrotondato alla griglia.
- **Il Bühlmann è validato su 38 immersioni di UN computer.**
- **Il fuso delle immersioni scaricate è quello del telefono**: non è chiudibile,
  l'informazione nel computer non c'è.
- **Il permesso Bluetooth negato adesso ha un messaggio suo**, col percorso delle
  impostazioni giusto per il sistema in uso: l'errore che lo dice esiste, e lo
  lancia `scan()`. **Restano muti due casi**, e da fuori si somigliano tutti e
  due a «nessun computer qui intorno»: quando il pannello del permesso non è mai
  comparso, e quando il computer è spento, lontano o non in modalità
  collegamento. Fino al 28 agosto qui era scritto che il permesso negato fosse
  indistinguibile: non era vero, e a smentirlo è stato il primo utente esterno.
- **Il PDF usa i font base** e la codifica WinAnsi; il testo va a capo contando i
  caratteri.
- **libdivecomputer non è verificata con un computer vero**, ed è accesa lo
  stesso: la scelta è dichiarata sotto ogni modello che la usa.
- **Il pacchetto macOS gira solo su Apple Silicon e da macOS 12**, e il sito non
  lo dice. Fino al 27 agosto il pacchetto stesso dichiarava 10.15, che era falso:
  adesso dice la verità, ma la pagina di scaricamento tace. Sta fra i prossimi
  passi al numero 8.
- **Windows e Android non li ha provati nessuno**, e il sito lo scrive prima dei
  pulsanti. Adesso fanno tutto quello che fa il Mac; l'unica differenza vera è
  che su Android l'aggiornamento automatico non c'è e non può esserci.
- **Il catalogo dei brevetti è fermo a una data.** Le didattiche cambiano gli
  standard — CMAS l'ha fatto nel 2023-24 e i numeri vecchi girano ancora — e ogni
  voce porta la sua fonte proprio per poterla ricontrollare. Non c'è niente che
  avvisi quando invecchia.
- **~~Una segnalazione resta marcata «da travasare».~~ Travasata l'1
  settembre.** Era la prova del 26 agosto, tenuta indietro **per decisione del
  proprietario**, e questa riga esisteva perché un contatore fermo su un numero
  diverso da zero, senza una spiegazione accanto, in tre mesi diventa un guasto
  da cercare. La decisione è stata ribaltata da chi l'aveva presa. _Da oggi il
  numero che quel comando deve dire è **zero**: se un giorno torna a dire uno,
  quella volta è un guasto sul serio — non c'è più nessuna decisione a
  giustificarlo._
- **► LE TRADUZIONI INGLESI LE HA SCRITTE CHI SCRIVE IL CODICE, E NESSUN
  MADRELINGUA LE HA RILETTE. ◄** Vale per **tutto** il dizionario — **1969
  voci** — non solo per le 247 aggiunte con la 1.7.0, e non è un limite di
  copertura: le voci con l'inglese **vuoto sono zero** e quelle in cui l'inglese
  è **identico all'italiano sono 19**, tutte parole che in inglese si scrivono
  uguale. Il testo inglese c'è ed è inglese vero. Quello che manca è **una
  rilettura da parte di qualcuno che quella lingua la parla da sempre**:
  registro, naturalezza, le sfumature che un non madrelingua non sente. È un
  limite reale e senza scadenza, e sta qui e non fra i prossimi passi perché non
  si chiude scrivendo codice.
  **La difesa che esiste, e che copre il difetto peggiore di tutti:**
  `tests/pianoTradotto.test.ts` pretende che italiano e inglese portino **gli
  stessi segnaposti** — sulle **241** frasi del piano e sulle **107** voci del
  dizionario che ne contengono almeno uno, oggi le discordanze sono **zero**.
  _Una traduzione che perde un `{1}` non dà errore e non sembra rotta: la frase
  resta grammaticalmente sensata e sparisce solo il numero._ «The deepest part
  does not come first on {0} dives» smette di dire su quante immersioni, e
  nessuna rilettura se ne accorge — è precisamente il genere di difetto che si
  trova con una riga di test e non si trova mai leggendo.
- **VPM-B non ha un riscontro indipendente**: siamo dal 5 al 10% più corti di
  V-Planner, dichiarato nell'interfaccia. È il debito tecnico più grosso.

---

## Le lezioni

> ### ► LA LEZIONE DELL'1 SETTEMBRE: QUELLO CHE NESSUNO RIESCE A LEGGERE È SPENTO — E IN UNA SETTIMANA È SUCCESSO TRE VOLTE ◄
>
> Tre guasti diversi, trovati a giorni di distanza, con la stessa forma. Nessuno
> dei tre taceva: **tutti e tre parlavano, e nessuno dei tre si poteva leggere.**
>
> - **Quattordici avvisi di lint, zero errori.** Il numero era stabile da
>   settimane, e proprio per questo era diventato un'etichetta invece che un
>   elenco: «sono i soliti quattordici». Dentro c'era **un orologio fermo** —
>   `Logbook.tsx` calcolava il briefing con un `Date.now()` congelato al primo
>   disegno, e dopo sei ore di applicazione aperta continuava a dire mezz'ora.
>   L'avviso che ci portava era lì da sempre, in mezzo agli altri tredici.
> - **Centinaia di righe di `act(...)`** in uscita da `npm test`. Non erano
>   errori: erano avvertimenti di React ripetuti a ogni render di ogni prova, e
>   sotto ci stavano i messaggi veri. Bastava una riga in `tests/preparazione.ts`
>   — `IS_REACT_ACT_ENVIRONMENT` — per passare da migliaia di righe a 256.
> - **Una pagina HTML intera** riversata nel terminale al posto di un messaggio
>   d'errore. La diagnosi vera erano quattro parole dentro un `<title>`, e sono
>   state l'unica cosa che non si vedeva.
>
> **La lezione non è «leggere con più attenzione».** È il rimedio che verrebbe da
> prescrivere, ed è quello che non funziona: nessuno legge con attenzione
> quattordici righe uguali tutti i giorni, e nessuno scorre novecento righe di
> `<style>` per cercare un titolo. *L'attenzione non è una risorsa che si può
> chiedere a qualcuno di spendere ogni volta.* Il rimedio è **far sì che l'uscita
> si possa leggere**: portare gli avvisi a zero invece di contarli, spegnere il
> rumore invece di scorrerlo, riassumere invece di riversare.
>
> **E c'è un corollario che vale più della lezione.** Tutti e tre questi guasti
> sono stati trovati **mentre si sistemava l'uscita, non mentre si cercava il
> guasto**. L'orologio fermo nessuno lo stava cercando: è saltato fuori leggendo
> i quattordici avvisi perché si era deciso di azzerarli. *Rendere leggibile
> un'uscita non è manutenzione cosmetica da fare quando avanza tempo: è il modo
> più economico che questo progetto abbia trovato di scoprire difetti che nessuno
> sospettava.*

> ### ► E LA STESSA SERA, UN'ISTRUZIONE MAL SCRITTA HA COPIATO UN FILE NEL REPOSITORY SBAGLIATO ◄
>
> Le istruzioni per aggiornare il tap erano scritte come un blocco da incollare:
>
> ```
> cd /percorso/del/tap          # segnaposto, da sostituire
> cp …/homebrew/aggiorna-cask.yml .github/workflows/aggiorna-cask.yml
> git add -A && git commit -m "…" && git push
> ```
>
> Il `cd` è morto sul segnaposto. **Le righe dopo sono partite lo stesso**, perché
> erano righe indipendenti e non una catena: il `cp` ha copiato il flusso del tap
> **dentro `.github/workflows/` di MyDiveLog**. Se il `commit` fosse riuscito,
> GitHub avrebbe cominciato a far girare, ogni sei ore e nel repository sbagliato,
> l'automazione che aggiorna la cask.
>
> **A fermarlo non è stata una guardia: è stato un guasto.** Il `git add` è caduto
> su un `index.lock` rimasto lì da un comando precedente — lo stesso lock che
> tutta la giornata era stato solo un fastidio. *Quando la cosa che ti salva è un
> difetto, non hai una difesa: hai avuto fortuna.*
>
> **E la guardia scritta quella stessa sera non lo avrebbe preso**, e va detto
> perché è il pezzo che insegna: controlla che la stessa azione non compaia a due
> versioni diverse fra i flussi, e lì tutti i `checkout` erano già `@v5`. Erano
> **coerenti**. Il difetto non era una versione discorde: era **un file estraneo**
> — un'altra specie di assenza al contrario, un flusso che c'è dove non dovrebbe
> esserci nulla.
>
> È la seconda volta che questo progetto paga *un'istruzione è un'interfaccia*. La
> prima, il 27 agosto, era il valore di un segreto scritto accanto al comando, che
> si legge come se fosse l'argomento — ed è costata una parola d'ordine da
> rigenerare. Questa è la stessa specie: **la forma del testo suggeriva una cosa
> che il testo non faceva.** Un blocco a righe indipendenti *sembra* una procedura
> che si ferma se un passo fallisce, e non lo è. La forma giusta è una catena
> sola, dove il primo `&&` che fallisce spegne tutto il resto:
>
> ```
> cd /tmp/homebrew-mydivelog && cp … && git add -A && git commit -m "…" && git push
> ```
>
> *(Nella stessa conversazione ne è scappata anche una più piccola e della solita
> famiglia: «se il tap sparisce te lo ritrovi sparito quando serve pubblicare una
> versione». Falso, e dedotto invece che verificato — il tap **si aggiorna da
> solo**, con un workflow che gira dentro di sé, e la copia sul disco serve solo
> nei casi rari in cui quei due file cambiano forma. Bastava rileggere
> `homebrew/LEGGIMI.md`, che lo dice. **Un'affermazione che alza la voce su un
> rischio inesistente non è prudenza: manda a fare un lavoro inutile**, ed è lo
> stesso difetto delle diagnosi scritte a priori — nomina una causa che non ha
> misurato.)*

> ### ► LA LEZIONE DEL 28 AGOSTO: CI SONO DIFETTI CHE NESSUN TEST E NESSUNA RILETTURA POSSONO TROVARE, PERCHÉ PER VEDERLI SERVE QUALCUNO CHE NON SA COSA STA PER FARE ◄
>
> Il primo utente esterno di questa applicazione ha premuto «Cerca il computer»
> con il permesso Bluetooth negato, e ha letto una riga in inglese col nome della
> libreria BLE dentro. In quella riga ci sono due difetti, e nessuno dei due era
> raggiungibile da qui.
>
> **Il primo non si poteva provare.** Per vederlo serve un telefono su cui
> qualcuno abbia detto di no, e su quelli di casa era stato detto di sì una volta
> per sempre. Non è una prova che manca per pigrizia: è una condizione che chi
> sviluppa **non attraversa mai più**, perché quel pannello lo si vede una volta
> sola nella vita di un'installazione. _Tutte le altre lezioni di questo
> documento parlano di guardie da scrivere; questa parla del pezzo di mondo che
> resta fuori da qualunque guardia, e dice che l'unico strumento per arrivarci è
> una persona che non sappia cosa sta per fare._
>
> **Il secondo era una cosa che il codice AFFERMAVA.** Non che quel messaggio
> fosse brutto: che quell'errore **non potesse esistere**. In due commenti stava
> scritto che il permesso negato è indistinguibile da «nessun computer qui
> intorno», e da lì la frase era passata pari pari nei **limiti noti** di questo
> documento. Era una deduzione: `getAdapterState` non lo dice, `checkPermissions`
> non lo dice, quindi non lo dice nessuno. Il terzo posto — `scan()` — non era
> stato interrogato. **E l'affermazione era scritta come se fosse stata
> misurata**, che è esattamente il difetto già registrato qui due volte: _un
> numero scritto in un commento è un'affermazione come tutte le altre_, e _chi
> scrive una frase ha già in testa la ragione per cui la crede vera: rileggendola
> ritrova la ragione, non il fatto._ Stavolta la prosa non stava in un commento
> soltanto: era diventata un **limite dichiarato**, cioè una cosa che nessuno
> avrebbe più provato a smentire, perché era già scritta fra le cose che non si
> possono fare.
>
> **La terza cosa, quella che rende il caso peggiore di com'è già:** la macchina
> per rispondere bene c'era da sempre. `BleUnavailable` ha `denied` e `off`, e i
> loro testi erano già tradotti col percorso delle impostazioni giusto per ogni
> sistema. Il ramo della ricerca fallita metteva `unsupported` fisso e ci
> appendeva il messaggio della libreria. _Non mancava la capacità di dare la
> risposta giusta: mancava chi la chiamasse_ — e a nasconderlo era la stessa
> frase che dichiarava che quella risposta non fosse possibile.
>
> Adesso c'è `src/core/ble/causaGuasto.ts` e c'è
> `tests/permessoBluetooth.test.ts`, nove prove **viste rosse rimettendo il ramo
> di prima**. Ma la guardia arriva dopo: quello che ha aperto la porta non è
> stato un test, è stato un estraneo con un telefono.

> ### ► LA LEZIONE DELLA SERA DEL 27 AGOSTO: UNA RIGA CHE VALE PER DUE POSTI, SCRITTA IN UNO SOLO, NON DÀ ERRORE — DÀ UN'ATTESA ◄
>
> `ITSAppUsesNonExemptEncryption` era in `Info.ios.plist` da mesi, con un test
> che la difendeva. Nel plist di macOS non c'era. Non se n'era accorto nessuno
> per una ragione che sembra una scusa e invece è il punto: **fino a quella sera
> su macOS non si caricava niente su App Store Connect**, e a un `.dmg` la dogana
> non chiede niente. La mancanza è diventata visibile nell'unico momento in cui
> costa — a pacchetto consegnato — e si è manifestata come una build che aspetta,
> non come un errore.
>
> **La lezione gemella, e più cara: un numero scritto a mano che descrive il
> binario sbagliato è una bugia che non fa rumore.** `minimumSystemVersion`
> diceva 10.15 mentre il binario era solo arm64, e il sito lo prometteva a
> chiunque scaricasse. Per settimane. Chi ha un Mac Intel avrebbe visto un
> pacchetto che si installa e non si apre — che è la forma peggiore di guasto,
> perché somiglia a un difetto dell'utente. **Non l'ha scoperto un utente, non un
> test, non una rilettura: l'ha scoperto Apple**, rifiutando un caricamento che
> col sito non c'entrava niente.
>
> Le due insieme dicono la stessa cosa da due lati: _quello che il pacchetto
> DICHIARA di sé non lo verifica nessuno, finché non arriva a un cancello che
> legge le dichiarazioni._ Adesso lo verifica `tests/macNegozio.test.ts`, e le
> sue sei prove sono state **viste rosse una per una**, mutando i file — perché
> una guardia verde al primo colpo non ha ancora dimostrato niente.

> ### Le quattro lezioni del 26 agosto
>
> **La prima: una frase con dentro un numero non è una frase che si è dimenticato
> di tradurre — è una frase che non si poteva tradurre.** Per mesi «il piano di
> miglioramento non è tradotto» è stato in tre punti di questo documento come un
> lavoro da fare. Non era un lavoro da fare: era un pezzo di infrastruttura
> mancante. Chi lo legge come pigrizia lo rimanda per sempre; chi lo legge come
> un impedimento tecnico lo chiude in una sera.
>
> **La seconda: una banda di tolleranza larga non è prudenza, è cecità
> comprata.** La prova sul consumo accettava da 14.5 a 17.5 su 16 chiesti. Con
> quella banda addosso, un errore di unità di misura nelle immersioni di prova è
> rimasto invisibile per tutta la vita del progetto — e ogni altra prova
> costruita su quelle immersioni misurava contro un bersaglio spostato. _La banda
> va stretta a quello che l'aritmetica giustifica, non a quello che fa passare il
> test._
>
> **La terza: una guardia che non può diventare rossa è peggio di nessuna
> guardia.** Il controllo nuovo sulle chiavi costruite interpolando, la prima
> volta, non poteva accendersi: l'estrazione non guardava l'apice inverso, cioè
> esattamente il carattere del difetto che cercava. Se ne è accorto solo chi
> l'ha provata a rovescio. Nessuna guardia si dichiara buona perché è verde: si
> dichiara buona dopo che le si è visto il rosso.
>
> **La quarta: ► ANCHE UN DOCUMENTO APPENA SCRITTO È UN'AFFERMAZIONE DA
> VERIFICARE, E CHI LO SCRIVE È NELLA POSIZIONE PEGGIORE PER ACCORGERSENE. ◄** In
> tre punti era finito scritto che «restano da tradurre in inglese le 247 voci
> nuove». Nessuno aveva aperto il dizionario: la frase era stata **dedotta** da
> «il dizionario è passato da 1725 a 1969 voci», che è un'altra cosa. Le
> traduzioni c'erano tutte, ed erano inglese vero. È la stessa specie di errore
> che questo progetto ha già pagato due volte — _non si crede a un documento che
> dice «manca X»_, _un numero scritto in un commento è un'affermazione come tutte
> le altre_ — commessa stavolta **mentre si scriveva la documentazione**, cioè
> nell'unico punto della catena dove non c'è né un compilatore, né un test, né
> qualcuno a valle che la rilegga. Il rimedio è lo stesso di sempre e costa un
> minuto — **si apre il file e si conta.**
>
> _(È successo di nuovo la sera del 27: era stata scritta la frase «la 1.7.0 è
> sull'App Store dal 27 agosto», dedotta e non verificata. Il `lookup` risponde
> `1.6.3`. Corretta subito, e registrata qui perché **la stessa lezione, imparata
> il giorno prima, non ha impedito di rifare l'errore il giorno dopo**: quello
> che lo ha impedito è stato lanciare il comando.)_

> ### ► «RILASCIATA» E «COMMITTATA» NON SONO LA STESSA COSA, ANCHE QUANDO OGGI COINCIDONO ◄
>
> Il numero di versione dentro `package.json` dice soltanto cosa c'è nel
> repository: non dice che esista una release, né che qualcuno abbia
> quell'applicazione installata, **né che sia quella che il negozio consegna**.
> Il 26 agosto le due cose hanno coinciso solo alla fine — per un paio d'ore la
> 1.7.0 è stata committata, compilata e notarizzata **e ferma lì**, al passo 2 di
> otto, e chiunque avesse letto «la 1.7.0» in un documento avrebbe dato per
> scontato che ci fosse qualcosa da scaricare.
>
> **Quindi la frase in testa a questo documento non va creduta: va verificata**,
> oggi come domani, perché questi documenti invecchiano fra una compilazione e
> l'altra.

---

## Prova su un archivio che non è il suo

`tests/smoke.test.ts` percorre il giro intero su un archivio costruito apposta.

`tests/oraDeiDueComputer.test.ts` usa i **quattro record veri** del 24 agosto
2026 e le due ore a parete dichiarate dal proprietario.

`scripts/schermate-bluetooth.mjs` fotografa e misura **32 schermate** a 390 e
1280 px col Bluetooth finto, controllando il trabocco **contenitore per
contenitore** — e adesso anche che il catalogo non risorga da solo.

`scripts/screenshot.mjs` apre l'app vera in un browser: si DIGITA, non si
riempie; si misura a 390 px sul serio; si contano entrambi i lati; la lingua si
dichiara. **E si sceglie il campo per il suo segnaposto, non per il suo tipo.**

`scripts/confronto-ldc/` mette tre implementazioni dello stesso formato binario
una accanto all'altra: zero divergenze su 85 immersioni.

**I test che leggono il sorgente**, perché quello che manca è codice corretto e
nessun compilatore lo segnala: `gestoriPerPiattaforma` (i comandi Rust per le
quattro piattaforme), `sorgentiLibdivecomputer` (i file dal `Makefile.am`),
`costantiLibdivecomputer` (gli enum contro l'intestazione C),
**`brevettiEschede`** (dove stanno i brevetti, che le tabelle non scorrano, che
le schede si portino in vista), **`dizionario`** (che ogni frase passata a `t()`
abbia la sua voce, in tutto `src/` e `scripts/`), **`rotteDichiarate`** (che ogni
percorso nominato fra apici inversi in `wrangler.toml` sia una rotta che
`worker.ts` serve davvero), **`macNegozio`** (che i due plist Apple diano la
stessa risposta alla dogana, che il minimo di sistema regga il binario, che le
entitlements portino l'identificativo vero) e adesso **`permessoBluetooth`** (che
la ricerca fallita classifichi la causa vera invece di appendere il messaggio
della libreria, e che nessuno dei nomi dei livelli sotto l'interfaccia possa
uscire a schermo). Di tutti è stato verificato che diventano rossi.

**E dal 29 agosto `sitoNavigazione`**, che legge le otto pagine del sito e il
foglio di stile: che il menu abbia sette voci su tutte, che la voce «Segnala» ci
sia nella forma giusta per quella pagina, che ci sia lo scambio di lingua, che
**una sola** cosa porti `aria-current="page"` e che sia quella giusta — la voce
sulle pagine interne, il marchio sulle due home — e che nessuna regola del piede
abbia un `bottom` negativo, che è la forma esatta del buco da 191 pixel. Legge il
sorgente perché lì il difetto **si vede**: una voce che manca, un attributo che
si sdoppia, un offset che torna negativo sono tutte cose scritte nel file, e una
guardia che gira in millisecondi a ogni prova vale più di una che deve aprire un
browser. **Il disegno vero si è misurato a mano**, con Playwright, nel momento in
cui si è corretto.

**E `pianoTradotto`**, che è l'unico a guardare la traduzione e non la chiave:
estrae dal sorgente le 241 frasi del piano, pretende che ognuna abbia la sua voce
inglese, e — la parte che vale di più — che i **segnaposti siano gli stessi**
nelle due lingue. È l'unica rete che c'è sulla qualità di una traduzione, e copre
esattamente il difetto che nessun lettore troverebbe.

**E `catalogoBrevetti`**, che fa tre mestieri: controlla la tenuta del catalogo —
niente doppioni, e **i metri d'accordo col livello**, perché un `base` che
dichiara 40 m è una riga copiata e non ricorretta che nessun compilatore vede —
inchioda uno per uno i numeri che il senso comune sbaglia, col motivo scritto
accanto, e **rilegge i conti scritti nei commenti** (`tests/inLettere.ts` sa
scrivere i numeri in lettere, con le elisioni: «ventuno», «quarantatré»).
Mettendo 40 m al CMAS Two Star si accendono **due** controlli.

> **Una guardia che si accende per niente insegna a non fidarsi di lei.** Il
> controllo sulla carta del libretto ritagliava 4000 caratteri fissi ed è
> diventato rosso appena alla carta è stato aggiunto un commento. Adesso ritaglia
> fino alla parentesi che chiude la funzione. Per la stessa ragione `inLettere`
> conosce le elisioni: una guardia che si accende su una forma che nessuno
> userebbe insegna a spegnerla. **E il 28 agosto è successo di nuovo, due volte
> di fila**: la guardia sui nomi da nascondere si è accesa su `@garmin/fitsdk` e
> dentro «thrust». Aveva ragione il codice, non la guardia — e la regola è
> diventata più stretta e più vera.
>
> **E il gemello: una guardia troppo larga non si accende mai.** La banda di
> tolleranza sul consumo ne è l'esempio, ed è raccontata più sopra.

### La regola di consegna verso il Mac, pagata cara

**Prima si rilegge `src/` dal Mac**, si verifica con `diff -rq`, poi si modifica,
e si consegnano **solo i file toccati**.

**E la regola gemella:** prima di aprire un sorgente per capire perché una
funzione «non c'è», si guarda la data del pacchetto installato — o si smette di
credere al commento in testa al file.
