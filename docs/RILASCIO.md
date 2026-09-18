# Come si fa una versione

*Scritto il 16 settembre 2026, subito dopo aver pubblicato la 1.8.24 — quindi
non è una ricostruzione a memoria: è la sequenza che ha funzionato, con dentro i
tre punti in cui si è rotta.*

Ogni passo ha il suo **controllo di chiusura**. Se non torna, ci si ferma lì: un
passo saltato in questa lista non dà errore, dà un pacchetto sbagliato
consegnato a tutti.

---

## 0. Il numero, nei quattro file

`package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`. Poi un `cargo check` per far salire anche `Cargo.lock`.

> **► CONTROLLO.** `grep -m1 '"version"' package.json && git rev-parse --short HEAD`
>
> *Esiste perché il 7 settembre la catena ha compilato, firmato e notarizzato
> una versione vecchia di tre giorni senza dare un solo errore.*

## 1. La catena verde, tutta

```
npm run build && npx eslint . && npx vitest run && npx prettier --check .
cd src-tauri && cargo test --lib
```

> **► PERCHÉ `npm run build` STA PRIMA, dal 18 settembre 2026.** Fa `tsc --noEmit`
> e poi costruisce, quindi il controllo dei tipi c'è ancora. Ma soprattutto
> mette in `dist/` **la build di adesso**, e `tests/bundle.test.ts` misura
> quella.
>
> *Prima non era così.* Le prove del bilancio del bundle — pezzi separati,
> nessun pezzo oltre la soglia, una pagina pigra per ogni scheda pesante — si
> saltano da sole quando `dist/` non c'è (`describe.skipIf`). Con la catena
> scritta com'era, su un albero pulito `dist/` è ignorato da git e non esiste:
> **quelle prove non giravano affatto**. E quando `dist/` c'era, era la build
> del rilascio PRECEDENTE: la catena dichiarava verde il bilancio di un
> pacchetto che non stava pubblicando. *Una misura fatta sull'oggetto sbagliato
> è peggio di una misura non fatta: la prima chiude la domanda.*

Se lavori su una macchina e pubblichi da un'altra, **si rilancia sulla macchina
che pubblica**: la cartella è un'altra e `node_modules` pure.

## 2. Il push, PRIMA di tutto il resto

```
git push origin main
```

> **► CONTROLLO.** Deve stampare `vecchio..nuovo  main -> main`.
> **«Everything up-to-date» non è una conferma: è un sintomo.** Vuol dire che
> quel repository non ha il lavoro — è successo stamattina, e il lavoro era
> rimasto dentro un fagotto mai innestato. Se lo vedi, fermati e guarda
> `git log --oneline -1` prima di continuare.

Il workflow del passo 3 gira sul codice che sta su GitHub, non su quello che hai
sul disco.

## 3. Mac e GitHub, in parallelo

```
npm run mac:pubblica &
gh workflow run altre-piattaforme.yml -f versione=1.8.24 &
```

`mac:pubblica` compila, firma con il Developer ID, **notarizza e pinza**.
Il workflow costruisce Windows, Android e Linux.

> **► CONTROLLI.** Nel log del Mac: `status: Accepted` e *«The staple and
> validate action worked!»*. Nel log del workflow: `firmati: 1 apk, 1 aab` per
> Android e *«nessuna traccia dell'aggiornatore nel binario»* per Linux.

**Se `bundle_dmg.sh` fallisce**, quasi sempre è Finder: la creazione del `.dmg`
gli parla in AppleScript per sistemare la finestra, e da una sessione senza
permesso di automazione non risponde. Si lancia da un Terminale normale, oppure
si concede l'automazione di Finder a chi lo sta lanciando. *Non si aggira con
`--skip-jenkins`: quello produce un `.dmg` senza sfondo e senza icone
posizionate, cioè una cosa diversa da tutte le versioni precedenti.*

## 4. Gli artefatti, e la firma di Windows

```
gh run download <id> -D /tmp/artefatti
node scripts/firma-windows.mjs /tmp/artefatti/*Windows/MyDiveLog-Windows-setup.exe
```

**GitHub costruisce, il Mac firma**: la chiave privata dell'aggiornatore sul
runner non ci va. Lo script aggiunge `windows-x86_64` a `latest.json` accanto a
`darwin-aarch64`, e si rifiuta di partire se il file non c'è già.

> **► CONTROLLO.** `latest.json` deve avere **due** piattaforme.

## 5. Le due copie del `.dmg`

```
cp .../MyDiveLog_X_aarch64.dmg consegna/MyDiveLog-macOS-arm64.dmg
```

> **► PERCHÉ È UN PASSO E NON UNA RIGA.** Nessuno script la fa, e senza di lei
> il pulsante «Scarica per Mac» del sito **risponde 404 a tutti** nell'istante
> esatto in cui la release nuova diventa `latest`. È il difetto peggiore della
> lista, perché lo introduce la pubblicazione stessa e colpisce chi non ha fatto
> niente.

## 6. Le impronte, calcolate sui file veri

```
shasum -a 256 MyDiveLog-macOS-arm64.dmg MyDiveLog-Windows-setup.exe \
              MyDiveLog-Windows-portatile.exe MyDiveLog-Android-arm64.apk \
              MyDiveLog-Linux-amd64.deb
```

Vanno nelle note della release. **Sui file che allegherai**, non su una
compilazione precedente: due compilazioni non danno lo stesso byte.

Per l'`.apk` e il `.deb` non è un vezzo. L'APK è firmato con una chiave
autofirmata, che non racconta la propria origine a chi non ha già l'impronta;
il `.deb` non è firmato affatto, e lì l'impronta è **l'unica cosa che il
pacchetto abbia da dire su se stesso**.

## 7. La release, intera o niente

```
gh release create vX --title "MyDiveLog X" --notes-file docs/RELEASE-vX.md \
  MyDiveLog-macOS-arm64.dmg MyDiveLog_X_aarch64.dmg MyDiveLog.app.tar.gz \
  latest.json MyDiveLog-Windows-setup.exe MyDiveLog-Windows-portatile.exe \
  MyDiveLog-Windows-setup.nsis.zip MyDiveLog-Android-arm64.apk \
  MyDiveLog-Linux-amd64.deb
```

Impiega più di un minuto e non stampa niente finché non ha finito: il silenzio
non è un errore.

> **► CONTROLLO, E SI CONTA.**
> `gh release view vX --json assets -q '.assets|length'` deve dire **9**.
> *«Li ho allegati tutti» è un ricordo, nove righe è un fatto* — e un allegato
> mancante non produce nessun errore da nessuna parte.

**Finché manca un pezzo non si crea niente.** I pulsanti del sito puntano a
`releases/latest`: nell'istante in cui esiste la release nuova è quella a
rispondere, e un allegato mancante è un 404 pubblico, non un rinvio.

## 8. Il sito, solo se è cambiato

I pulsanti seguono `releases/latest` da soli: per una versione che non tocca il
sito **non c'è niente da fare**. Se invece sono cambiate le immagini della
vetrina o il foglio di stile:

```
npm run sito:versiona        # impronta del CSS nell'indirizzo
npx wrangler pages deploy sito --project-name mydivelog-sito
npm run sito:online          # confronta il pubblicato col disco, pagina per pagina
```

> **► CONTROLLO.** `sito:online` deve chiudere con *«il sito pubblicato è quello
> sul disco»*. **Un 200 non basta**: Cloudflare Pages serve la home con codice
> 200 per una pagina che non esiste, quindi `curl -o /dev/null -w '%{http_code}'`
> risponde 200 anche a `/qualunque-cosa`.

## 9. La verifica finale, sulla cosa consegnata

```
for N in MyDiveLog-macOS-arm64.dmg MyDiveLog-Windows-setup.exe \
         MyDiveLog-Android-arm64.apk MyDiveLog-Linux-amd64.deb; do
  curl -sIL "https://github.com/matteoferrando/MyDiveLog/releases/latest/download/$N" \
    | grep -i '^content-length'
done
```

I byte devono combaciare con quelli della release. E l'App Store si **rilancia**
invece di ricordarlo:

```
curl -s "https://itunes.apple.com/lookup?id=6804439480&country=it&t=$(date +%s)"
```

> *Una riga che nessuno rimisura diventa la fonte da cui si deduce il mondo:*
> in questo progetto è già successo tre volte, sempre con la versione dei
> negozi.

> ► **E QUESTO PASSO HA APPENA PAGATO.** Il 16 settembre 2026, subito dopo aver
> creato la release della 1.8.26: `gh release view` diceva l'allegato
> `uploaded` e con la misura giusta, l'URL diretto
> `releases/download/v1.8.26/MyDiveLog-Linux-amd64.deb` rispondeva **200 con
> 3 826 114 byte** — e `releases/latest/download/…`, che è quello del pulsante
> del sito, rispondeva **500 con 160 KB di pagina d'errore**. Tre tentativi di
> fila, uguali.
>
> Cioè: la release era a posto, l'allegato era a posto, e **il pulsante del
> sito dava errore a chiunque**. Si è risolto da sé in un paio di minuti — è un
> ritardo dell'alias `latest` di GitHub dopo il caricamento — ma l'unico modo
> per saperlo era scaricare **dall'indirizzo che usa il sito**, non da quello
> che nomina la versione.
>
> *Se questo passo lo si fosse saltato, «la release è creata» sarebbe passato
> per «il download funziona».* Se succede di nuovo: aspettare un paio di minuti
> e rimisurare; se resta, togliere e rimettere l'allegato con
> `gh release delete-asset` e `gh release upload`.

---

## I negozi, che restano a mano

**App Store (iPhone).** `npm run ios:negozio` produce l'`.ipa` firmato
*Apple Distribution*, e in coda `scripts/nomina-ipa.mjs` gli dà il nome della
versione — `MyDiveLog-1.8.25.ipa`. Il caricamento lo fa Transporter, e la
versione si crea e si invia su App Store Connect.

> **► PERCHÉ IL NOME, E PERCHÉ IL CONTROLLO CHE VIENE PRIMA.** Xcode esporta
> sempre `MyDiveLog.ipa`, senza numero: **due `.ipa` con lo stesso nome e
> versioni diverse sono indistinguibili nel momento esatto in cui, dentro
> Transporter, bisogna sceglierne uno** — e un pacchetto sbagliato caricato in
> un negozio non si ritira, si pubblica una versione nuova.
>
> Prima di rinominare, lo script confronta il `CFBundleShortVersionString` che
> sta **dentro** il pacchetto con `package.json`, e se non combaciano si ferma
> senza rinominare: è il difetto del 7 settembre in cima a questo documento,
> preso nell'unico punto in cui si può ancora prendere. *Un file che si chiama
> 1.8.25 e dentro dice 1.8.24 è peggio di uno senza numero: il nome sbagliato è
> una bugia, l'assenza del nome è una scomodità.*

**Mac App Store.** `bash scripts/pubblica-mac-negozio.sh` produce
`src-tauri/target/negozio/MyDiveLog-<versione>-mac-app-store.pkg`. **Non è il
`.dmg` e non si possono scambiare**: il `.dmg` è firmato Developer ID, non è
sandboxato e ha l'aggiornatore dentro — caricarlo verrebbe rifiutato; il `.pkg`
è sandboxato, firmato con la chiave dell'installer, e senza il codice
dell'aggiornamento. Si carica con Transporter come l'`.ipa`.

**Google Play.** L'`.aab` esce dal workflow. Il caricamento e la pubblicazione si
fanno sulla Play Console.

**Perché non sono automatizzati:** su questo Mac non esiste nessuna credenziale
che una riga di comando possa usare — nessuna chiave API di App Store Connect,
nessuna voce nel portachiavi che `altool` sappia leggere, nessun service account
di Google Play. Il profilo `mydivelog` nel portachiavi serve a `notarytool` per
notarizzare, e non a caricare build.

*Si possono automatizzare tutti e due*, creando una chiave API su App Store
Connect e un service account su Play. È mezz'ora una volta sola, e da lì in
avanti sono due comandi. Finché non si fa, questi due passi sono a mano e vanno
scritti qui perché nessuno li dia per fatti.

I testi sono pronti e versionati: `docs/appstore-<versione>-it.txt`,
`docs/appstore-<versione>-en.txt`, `docs/play-<versione>-it.txt` (il limite è
500 caratteri), `docs/play-<versione>-en.txt`.

> **► I NEGOZI NON VANNO ALLO STESSO PASSO DEL SITO, ED È UNA SCELTA.** Sul
> sito si pubblica quando c'è qualcosa da pubblicare; nei negozi ogni versione
> costa una revisione, e saltarne una è legittimo — la **1.8.23** e la
> **1.8.24** sono state saltate apposta su Apple. Quello che conviene fare ogni
> volta non è allinearli, è **misurare dove stanno**: `src-tauri/target/negozio/`
> tiene tutti i `.pkg` costruiti e il più alto dice a che versione è fermo il
> Mac App Store. *Saltare una versione è una decisione; non sapere quale sia
> l'ultima caricata è un'altra cosa.*

---

## Dove finiscono i pacchetti

In `../consegna/<versione>/`, e **una sola versione per volta**: quando esce
quella dopo, la cartella di prima si butta. Ogni versione pubblicata è una
release su GitHub con i suoi allegati e le sue impronte, e
`gh release download vX` la ridà identica.
