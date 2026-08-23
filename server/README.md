# Il servizio di accesso

Un Worker Cloudflare, **senza nessuna dipendenza npm**: tutto quello che serve
— firma, verifica, impronte — sta in `crypto.subtle`, che sul Worker c'è.

## Cosa fa, in quattro rotte

| Rotta | Riceve | Restituisce |
|---|---|---|
| `POST /accesso` | il codice di autorizzazione di Apple o Google | sessione (settimane), indirizzo del database, chiave (2 ore) |
| `POST /accesso-apple/ritorno` | la POST di Apple, dal browser | un 303 che rimanda dentro l'applicazione |
| `POST /chiave` | sessione | indirizzo e chiave nuova |
| `DELETE /account` | sessione | il database non esiste più |

La seconda è un'anomalia, e va dichiarata: **non la chiama l'applicazione, la
chiama il browser** di chi sta accedendo. Apple, quando le si chiedono nome ed
email, pretende `response_mode=form_post` e risponde con una POST invece che con
un redirect — e una POST non si può mandare né a `mydivelog://` né a una porta
su `127.0.0.1`. Quindi il Return URL registrato sul portale è questo Worker, che
riceve e rimbalza. Il ragionamento per esteso sta in testa a `appleScambio.ts`.

Le immersioni non passano da qui. Continuano a viaggiare fra l'app e il
database con lo stesso motore di sincronizzazione di sempre: questo servizio
consegna soltanto le chiavi di casa propria.

## Perché un database per utente

L'isolamento non è una clausola `WHERE` che qualcuno può dimenticare: è il
fatto che la chiave consegnata all'app apre **un database e nessun altro**.
Anche se sfugge, anche se l'app viene manomessa, anche se una rotta qui ha un
difetto, il perimetro è l'archivio di una persona sola.

## Non ha uno stato

Non c'è nessuna tabella di utenti. Il nome del database si **ricava**
dall'identità: impronta SHA-256 di `provider:sub`, troncata, con un prefisso.
Quindi non esiste un elenco di iscritti da custodire, niente da salvare, niente
da migrare, e nessun file che colleghi un'email a un archivio.

Il prezzo, dichiarato: non si può revocare una singola sessione prima della
scadenza (si cambia `SESSION_KEY`, e si scollegano tutti), e non si sa quanti
utenti ci siano.

## Le due piattaforme non sono uguali

| | iPhone | Mac |
|---|---|---|
| **Google** | client «iOS» | client «Desktop app» — **un identificativo diverso** |
| **Apple** | Services ID | **lo stesso Services ID** |
| **Ritorno dall'accesso** | schema URL dell'app | loopback su `127.0.0.1` |

Google assegna un identificativo per tipo di client: due registrazioni, due
valori, e il token di ciascuna porta il proprio in `aud`. Per questo
`GOOGLE_CLIENT_ID` è un elenco separato da virgola — con un valore solo
l'accesso funzionerebbe su una piattaforma e verrebbe rifiutato sull'altra, con
un 401 che non spiega niente.

Apple invece è uguale sulle due piattaforme, perché il giro è quello **web**:
si apre il browser di sistema, si torna dal Worker, e nessuna delle due build ha
bisogno dell'entitlement `com.apple.developer.applesignin` né di un profilo
speciale. È la ragione per cui è stato scelto il giro web invece di
`ASAuthorization`: una strada sola invece di due, e riusa tutto quello che già
funzionava per Google.

`APPLE_CLIENT_ID` è comunque un elenco di due, ma per un motivo diverso da
Google: il **bundle id** (`it.ferrando.mydivelog`) è l'identificativo del giro
nativo, il **Services ID** (`it.ferrando.mydivelog.accesso`) quello del giro web,
e il token porta in `aud` quello del giro da cui è nato. Oggi arriva sempre il
secondo; il primo resta elencato perché il giro nativo è la cosa che si aggiunge
un domani, e quel giorno non si deve scoprire questa riga con un 401 in mano.

## Preparare i segreti

```bash
cd server
npx wrangler secret put SESSION_KEY               # 32+ byte casuali: openssl rand -base64 48
npx wrangler secret put TURSO_API_TOKEN           # token dell'organizzazione Turso
npx wrangler secret put GOOGLE_SEGRETO_DESKTOP    # il segreto del client «Desktop app»
```

E la chiave privata di Apple, che è un **file** e si carica da `stdin` invece di
incollarla — un `.p8` incollato a mano perde gli a-capo e diventa una chiave che
non si importa, con un `invalid_client` che non nomina né il file né la riga:

```bash
npx wrangler secret put APPLE_CHIAVE_P8 < ~/Downloads/AuthKey_7MLL5X469B.p8
```

Il `.p8` **Apple lo lascia scaricare una volta sola**: perso, si revoca sul
portale e se ne genera un altro (e allora cambia anche `APPLE_KEY_ID` in
`wrangler.toml`).

E soprattutto: **non c'è nessun `APPLE_CLIENT_SECRET` da caricare, e non ci sarà
mai.** Apple non dà una password: dà quella chiave privata, con cui *tu* firmi un
JWT ES256 che per regolamento vale al massimo sei mesi. Firmarne uno a mano
vorrebbe dire una scadenza da segnare in calendario, e il giorno che il
promemoria viene rimandato l'accesso si spegne per tutti — con un 401 di Apple
che non nomina la scadenza. Il Worker lo firma **al volo, valido cinque minuti**,
a ogni richiesta. Vedi `appleScambio.ts`.

`TURSO_API_TOKEN` crea, legge e cancella **ogni** database
dell'organizzazione: è il segreto più pericoloso del progetto. Non deve mai
comparire in una risposta HTTP, in un messaggio d'errore o in un registro — il
codice è scritto perché non ci finisca.

Poi in `wrangler.toml` vanno riempiti `TURSO_ORG`, `GOOGLE_CLIENT_ID` e i
quattro valori pubblici di Apple (`APPLE_CLIENT_ID`, `APPLE_SERVICES_ID`,
`APPLE_TEAM_ID`, `APPLE_KEY_ID`) più `APPLE_RITORNO`.

## Pubblicare

```bash
cd server && npx wrangler deploy
```

Per vedere i registri dal vivo mentre si prova un accesso — che è l'unico modo
di sapere *perché* Apple ha rifiutato, dato che all'app non arriva nessun
dettaglio:

```bash
cd server && npx wrangler tail
```

### La rotta di zona, che il deploy da solo non basta a far funzionare

`wrangler.toml` dichiara la rotta `mydivelog.site/accesso-apple/*`. Perché
prenda davvero servono due cose che stanno **fuori** da questo file:

1. la zona `mydivelog.site` dev'essere nello stesso account Cloudflare del
   Worker, con un record DNS **proxato** (nuvola arancione) per l'host — un
   record «solo DNS» non fa passare la richiesta da nessun Worker;
2. `mydivelog.site` oggi è servito da **Cloudflare Pages** (vedi
   `sito/README.md`). Una rotta Worker su un percorso della stessa zona ha la
   precedenza sul progetto Pages, ma è il genere di precedenza che va **provata
   una volta** invece che data per buona: dopo il deploy, un
   `curl -i -X POST https://mydivelog.site/accesso-apple/ritorno` deve
   rispondere `400 ritorno non valido` — cioè il Worker — e non il 404 del sito.

Se il 404 arriva lo stesso, la strada alternativa è un **Custom Domain** del
Worker su un sottodominio dedicato (per esempio `accesso.mydivelog.site`),
cambiando di conseguenza `APPLE_RITORNO`, `APPLE_RITORNO_REGISTRATO` in
`src/sync/configurazione.ts` e il Return URL sul portale di Apple: sono tre
stringhe che devono restare identiche.

## Prima di aprirlo a qualcuno che non sei tu

- **Restringere `ORIGINI_AMMESSE`** a quella dell'applicazione. Attenzione a
  una cosa sola: `/accesso-apple/ritorno` è **esente** da quel controllo, e deve
  restarlo. Quella POST la manda il browser per conto della pagina di Apple e
  porta `Origin: https://appleid.apple.com`, che nell'elenco non ci sarà mai;
  senza l'esenzione l'accesso con Apple smetterebbe di tornare, con un 403 che
  nessuno vede.
- **Aggiungere l'indirizzo del Worker a `connect-src`** nella CSP di
  `tauri.conf.json`: senza, la webview blocca le chiamate e il sintomo è
  «l'accesso non funziona», che è già costato una serata con Turso.
- **Informativa e cancellazione dell'account.** La rotta `DELETE /account` c'è;
  serve il pulsante nell'app e serve la pagina che dice cosa teniamo.
