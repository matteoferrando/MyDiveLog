# Segnalare un problema di sicurezza

**Scrivi a m.ferrando@gmail.com. Non aprire una issue pubblica.**

Una issue è visibile a chiunque nel momento in cui la scrivi, compreso a chi
volesse usare quello che hai trovato prima che sia corretto. Una mail no.

Nella segnalazione basta: cosa hai trovato, come si riproduce, e cosa secondo te
si potrebbe ottenere sfruttandolo. Non serve un exploit funzionante e non serve
che tu abbia ragione: una segnalazione sbagliata costa mezz'ora, una taciuta può
costare l'archivio di qualcuno.

Rispondo appena posso. MyDiveLog è un progetto personale, quindi non prometto
tempi che non posso mantenere: prometto che leggo tutto e che ti dico cosa
succede.

## Cosa vale la pena guardare

Le parti dove un difetto farebbe danno davvero:

- **`server/`**, il servizio di accesso: verifica dei token d'identità
  (`identita.ts`), firma delle sessioni (`sessione.ts`), emissione dei token del
  database (`turso.ts`). Il punto che regge tutto è che il token consegnato
  all'app apra **un database e nessun altro**.
- **`src/sync/`**, il giro OAuth: il confronto sullo `state` al ritorno dal
  browser è la sola difesa fra l'archivio di chi usa il computer e un codice
  arrivato da fuori.
- **Il portachiavi** (`src/storage/secrets.ts`) e tutto ciò che decide dove
  finisce una credenziale.

## Cosa NON è una vulnerabilità in questo progetto

Alcune cose sembrano difetti e sono scelte, scritte nel codice con la loro
ragione:

- **Non si può revocare una sessione prima della scadenza.** Il servizio non ha
  uno stato di proposito: nessuna tabella di utenti, nessun elenco di iscritti.
  Il prezzo è dichiarato in `server/worker.ts`.
- **Il `client_secret` del client desktop di Google non è nel repository ma non è
  un segreto forte.** Google stesso lo dichiara non confidenziale per le
  applicazioni installate; sta fra i segreti di Cloudflare perché lì è comunque
  il posto giusto, non perché la sicurezza dipenda da lui. Quella dipende da PKCE.
- **Chi ha accesso fisico al dispositivo sbloccato ha accesso all'archivio.** È
  un file SQLite nella cartella dati dell'app, e deve restare copiabile e
  ispezionabile: è la promessa di non chiudere dentro nessuno.
- **L'app si fida del proprio archivio locale.** Non è un servizio multiutente
  sullo stesso dispositivo.

## Cosa aspettarsi

Nessun programma di ricompense: non c'è un'azienda dietro e non ci sono soldi. Se
vuoi, il tuo nome finisce nel commit che corregge il problema.
