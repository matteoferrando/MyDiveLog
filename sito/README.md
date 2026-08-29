# Il sito di MyDiveLog

Otto file HTML, un foglio di stile, un marchio. **Nessuna compilazione, nessuna
dipendenza, nessun passaggio intermedio**: quello che sta in questa cartella è
esattamente quello che finisce in rete, e si apre anche facendo doppio clic su
`index.html`.

La ragione è la stessa per cui l'applicazione non usa librerie dove non servono:
un sito che per essere pubblicato ha bisogno di un generatore, di un file di
configurazione e di ottanta megabyte di `node_modules` è un sito che fra due anni
non si riesce più a modificare.

## Cosa c'è

```
index.html                 descrizione del servizio (italiano)
libretto-immersioni.html   il libretto e la legge 70/2026, per esteso
privacy.html               informativa sulla privacy
termini.html               termini di servizio
en/index.html              le stesse quattro pagine in inglese
en/dive-logbook-law.html
en/privacy.html
en/terms.html
stile.css                  un foglio solo, chiaro e scuro
logo.svg                   lo STESSO marchio dell'applicazione, da src-tauri/icons
immagini/                  schermate della pagina, e le due anteprime social
robots.txt                 apre tutto e indica la mappa
sitemap.xml                gli otto indirizzi canonici, con le lingue
esempio-immersioni.uddf    il file di prova che la home offre da scaricare
segnalazioni.gs            lo script di Apps Script che riceve le segnalazioni,
                           tenuto qui per non perderlo. `wrangler` pubblica la
                           cartella intera, quindi finisce in rete anche lui: è
                           codice già leggibile da chiunque, ma sappilo
```

Le pagine sono a coppie: ogni pagina italiana ha la sua gemella inglese, e le
due si citano a vicenda con `hreflang`. `x-default` punta sempre all'italiana,
perché l'italiano è il testo originale e la legge 70/2026 riguarda l'Italia.

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

- `https://mydivelog.site/privacy`
- `https://mydivelog.site/termini`

Se un giorno cambiano nome, vanno aggiornati **anche nella console di Google**,
altrimenti la verifica si ferma senza dire perché.

## L'igiene tecnica: quando si aggiunge una pagina

Ogni pagina porta nel suo `<head>`, oltre al `canonical`, tre cose che non si
vedono ma che decidono come il sito appare fuori di qui:

- le **tre alternative di lingua** (`it`, `en`, `x-default`), con indirizzi
  assoluti e nella forma corta senza `.html`;
- i **meta Open Graph e Twitter**, che sono ciò che LinkedIn, WhatsApp e Slack
  leggono per costruire l'anteprima. Titolo e descrizione non sono scritti due
  volte: sono gli stessi del `<title>` e della `<meta name="description">`;
- sulle due home un blocco **JSON-LD** `SoftwareApplication`, sulle due pagine
  della legge un `Article`.

Il JSON-LD non dichiara `aggregateRating` e non deve dichiararlo finché non ci
sono recensioni vere: un punteggio inventato è una cosa che Google verifica, e
la punizione non è perdere quel dato — è perdere TUTTI i risultati arricchiti
del sito.

**Aggiungendo una pagina** vanno toccati tre punti, e dimenticarne uno non
rompe niente in modo visibile: il `<head>` della pagina nuova e quello della
sua gemella (che ora ha un'alternativa in più), e `sitemap.xml`. La mappa
elenca gli indirizzi **canonici**, cioè quelli corti: Cloudflare Pages rimanda
`/privacy.html` su `/privacy` con un 308, e una mappa fatta di rimandi fa
lavorare due volte chi la legge.

Nella mappa non ci sono `<priority>` né `<changefreq>`, perché Google li ignora
da anni, e `<lastmod>` c'è solo dove la data la dichiara la pagina stessa: una
data inventata insegna a Google a non fidarsi nemmeno di quelle vere.

## Cosa aggiornare quando l'app cambia

Le due pagine legali descrivono comportamenti veri del programma: dove stanno le
credenziali, quanto dura una chiave, cosa fa «Cancella l'account». Se una di
quelle cose cambia nel codice, **cambia anche qui**, e si aggiorna la data in
cima. Una privacy che descrive un'applicazione che non esiste più è peggio di
nessuna privacy: è una dichiarazione falsa.
