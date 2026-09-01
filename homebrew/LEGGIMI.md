# Quello che vive nel tap

Il tap è un repository a parte —
[`matteoferrando/homebrew-mydivelog`](https://github.com/matteoferrando/homebrew-mydivelog)
— ma i suoi due file si scrivono **qui**, perché qui c'è il generatore e qui ci
sono le prove che li difendono. Là dentro finiscono copiati.

| File qui | Dove va nel tap |
|---|---|
| `mydivelog.rb` | `Casks/mydivelog.rb` |
| `aggiorna-cask.yml` | `.github/workflows/aggiorna-cask.yml` |

## La cask

Generata da `npm run cask`. Non si modifica a mano: l'impronta viene dall'API di
GitHub, cioè è calcolata sul file che GitHub sta davvero servendo, e con
`--dmg <file>` si pretende che combaci con il pacchetto costruito in locale.

`tests/cask.test.ts` difende quello che si può difendere senza rete.

## Il workflow che la aggiorna da solo

Gira **dentro il tap**, ogni sei ore, e non è un dettaglio di comodità: **così non
serve nessun segreto.** Un'azione che partisse da questo repository e scrivesse
nell'altro avrebbe bisogno di un token con permesso di scrittura su un repository
diverso — una credenziale da creare, custodire e ruotare. Girando nel tap, il
`GITHUB_TOKEN` che GitHub fornisce da sé basta: scrive solo sul proprio
repository, dura il tempo del lavoro, e prima e dopo non esiste.

Cosa fa, in ordine: legge l'ultima release di MyDiveLog, prende il `digest` che
GitHub dichiara per `MyDiveLog-macOS-arm64.dmg`, e **se la versione è già quella
scritta nella cask non fa niente** — un workflow che commette a vuoto ogni sei ore
riempie la cronologia di rumore e insegna a non guardarla. Se invece è cambiata,
riscrive le due righe, **rilegge quello che ha scritto** (una sostituzione che non
aggancia niente non dà errore e lascerebbe la versione nuova con l'impronta
vecchia), fa leggere la cask a `brew audit --cask --online` — che scarica il
pacchetto e ne verifica l'impronta — e solo allora committa.

Se la release non contiene il pacchetto macOS esce senza fare niente, invece di
scrivere una cask che punta al nulla: è già successo con Linux, allegato tre
giorni dopo la release.

Il prezzo, dichiarato: non parte nell'istante in cui esce una release ma al giro
successivo, al massimo sei ore dopo. Chi installa in quelle sei ore prende la
versione precedente — che funziona, e che si aggiorna comunque da sola.

## Installare i due file nel tap

```
cd /percorso/del/tap
cp /percorso/di/mydivelog/homebrew/mydivelog.rb Casks/mydivelog.rb
mkdir -p .github/workflows
cp /percorso/di/mydivelog/homebrew/aggiorna-cask.yml .github/workflows/aggiorna-cask.yml
git add -A && git commit -m "la cask si aggiorna da sola" && git push
```

Dopo il primo push conviene farlo partire a mano una volta — dalla scheda Actions
del tap, «Aggiorna la cask» → «Run workflow» — per vedere con gli occhi che non
faccia niente quando non c'è niente da fare. *Un'automazione che non si è mai
vista girare non è un'automazione: è un file.*
