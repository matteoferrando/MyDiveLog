# Il sito di MyDiveLog

Sei file HTML, un foglio di stile, un'immagine. **Nessuna compilazione, nessuna
dipendenza, nessun passaggio intermedio**: quello che sta in questa cartella è
esattamente quello che finisce in rete, e si apre anche facendo doppio clic su
`index.html`.

La ragione è la stessa per cui l'applicazione non usa librerie dove non servono:
un sito che per essere pubblicato ha bisogno di un generatore, di un file di
configurazione e di ottanta megabyte di `node_modules` è un sito che fra due anni
non si riesce più a modificare.

## Cosa c'è

```
index.html      descrizione del servizio (italiano)
privacy.html    informativa sulla privacy
termini.html    termini di servizio
en/index.html   la stessa cosa in inglese
en/privacy.html
en/terms.html
stile.css       un foglio solo, chiaro e scuro
logo.svg        lo STESSO marchio dell'applicazione, copiato da src-tauri/icons
```

`logo.svg` è una copia, e va tenuta allineata a mano se l'icona cambia. Un
collegamento simbolico sembrerebbe più elegante e romperebbe la pubblicazione,
che copia i file.

## Pubblicare su Cloudflare Pages

Dalla cartella del repository:

```sh
npx wrangler pages deploy sito --project-name mydivelog-sito
```

La prima volta il comando crea il progetto. Poi, dal pannello di Cloudflare,
**Custom domains** → `mydivelog.site` e `www.mydivelog.site`: il DNS è già
nell'account, quindi il certificato arriva da solo in pochi minuti.

## Le due pagine che devono restare raggiungibili

Google, per togliere il progetto OAuth dallo stato *Testing*, chiede l'indirizzo
pubblico dell'informativa sulla privacy e dei termini. Apple chiede la stessa
cosa per l'App Store. Sono questi:

- `https://mydivelog.site/privacy.html`
- `https://mydivelog.site/termini.html`

Se un giorno cambiano nome, vanno aggiornati **anche nella console di Google**,
altrimenti la verifica si ferma senza dire perché.

## Cosa aggiornare quando l'app cambia

Le due pagine legali descrivono comportamenti veri del programma: dove stanno le
credenziali, quanto dura una chiave, cosa fa «Cancella l'account». Se una di
quelle cose cambia nel codice, **cambia anche qui**, e si aggiorna la data in
cima. Una privacy che descrive un'applicazione che non esiste più è peggio di
nessuna privacy: è una dichiarazione falsa.
