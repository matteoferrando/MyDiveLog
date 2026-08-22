# Il servizio di accesso

Un Worker Cloudflare, **senza nessuna dipendenza npm**: tutto quello che serve
— firma, verifica, impronte — sta in `crypto.subtle`, che sul Worker c'è.

## Cosa fa, in tre rotte

| Rotta | Riceve | Restituisce |
|---|---|---|
| `POST /accesso` | `{provider, idToken}` di Apple o Google | sessione (settimane), indirizzo del database, chiave (2 ore) |
| `POST /chiave` | sessione | indirizzo e chiave nuova |
| `DELETE /account` | sessione | il database non esiste più |

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
| **Apple** | bundle id | stesso bundle id, ma serve l'entitlement e un profilo |
| **Ritorno dall'accesso** | schema URL dell'app | loopback su `127.0.0.1` |

Google assegna un identificativo per tipo di client: due registrazioni, due
valori, e il token di ciascuna porta il proprio in `aud`. Per questo
`GOOGLE_CLIENT_ID` è un elenco separato da virgola — con un valore solo
l'accesso funzionerebbe su una piattaforma e verrebbe rifiutato sull'altra, con
un 401 che non spiega niente.

Apple invece ne ha uno solo, il bundle id, che vale per entrambe perché le due
applicazioni lo condividono. Il lavoro in più sul Mac non è qui: è
nell'applicazione, che per usare Sign in with Apple ha bisogno
dell'entitlement `com.apple.developer.applesignin` e di un profilo di
provisioning — cose che la build iOS ha già e quella desktop no.

## Preparare i segreti

```bash
cd server
npx wrangler secret put SESSION_KEY       # 32+ byte casuali: openssl rand -base64 48
npx wrangler secret put TURSO_API_TOKEN   # token dell'organizzazione Turso
```

`TURSO_API_TOKEN` crea, legge e cancella **ogni** database
dell'organizzazione: è il segreto più pericoloso del progetto. Non deve mai
comparire in una risposta HTTP, in un messaggio d'errore o in un registro — il
codice è scritto perché non ci finisca.

Poi in `wrangler.toml` vanno riempiti `TURSO_ORG` e `GOOGLE_CLIENT_ID`.

## Pubblicare

```bash
cd server && npx wrangler deploy
```

## Prima di aprirlo a qualcuno che non sei tu

- **Limitare la frequenza delle richieste.** `/accesso` chiama Apple e Google e
  crea database: senza un limite davanti, è una rotta che si può abusare. Su
  Cloudflare si fa con una regola, non con del codice qui dentro.
- **Restringere `ORIGINI_AMMESSE`** a quella dell'applicazione.
- **Aggiungere l'indirizzo del Worker a `connect-src`** nella CSP di
  `tauri.conf.json`: senza, la webview blocca le chiamate e il sintomo è
  «l'accesso non funziona», che è già costato una serata con Turso.
- **Informativa e cancellazione dell'account.** La rotta `DELETE /account` c'è;
  serve il pulsante nell'app e serve la pagina che dice cosa teniamo.
