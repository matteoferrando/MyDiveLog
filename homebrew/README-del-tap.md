# Il tap Homebrew di MyDiveLog

```
brew install --cask matteoferrando/mydivelog/mydivelog
```

Un comando solo: il nome intero aggiunge il tap, dà fiducia a **questa** cask e a
nient'altro, e la installa. Homebrew non carica le cask dei tap che non sono suoi
finché qualcuno non le dichiara fidate, quindi chi aveva installato prima — il
tap, e poi il nome corto — glielo dice una volta sola:

```
brew trust --cask matteoferrando/mydivelog/mydivelog
```

Finché non lo fa, il suo Homebrew ignora la cask; l'app no: si aggiorna da sola.

[MyDiveLog](https://mydivelog.site) è un logbook subacqueo libero: unisce le
immersioni di computer diversi senza doppioni, le analizza, e tiene i campi che
la legge 70/2026 chiede al libretto delle immersioni. Codice, difetti e release
stanno in **[matteoferrando/MyDiveLog](https://github.com/matteoferrando/MyDiveLog)**;
qui c'è solo la cask.

## Prima di installare

- Serve un **Mac Apple Silicon** e **macOS 12**. Sono gli stessi due limiti che
  il sito scrive prima del pulsante, e la cask li dichiara: su un Mac Intel
  `brew` si ferma invece di installare un'applicazione che non si aprirebbe.
- Il pacchetto è **firmato Developer ID e notarizzato**: nessun «apri comunque».
- **L'app si aggiorna da sola**, e la cask lo dichiara con `auto_updates true`.
  Quindi `brew upgrade` normalmente non la tocca: ci pensa l'applicazione.

## Perché un tap e non `homebrew-cask`

Perché le regole di Homebrew chiedono una prova di interesse pubblico che questo
progetto oggi non ha — per una cask proposta dal proprietario del repository
servono **90 fork, 90 watcher o 225 stelle**, e un repository più giovane di
trenta giorni di norma non è ammissibile. Un tap non ha soglie, e la cask è la
stessa: il giorno che i numeri ci sono, si sposta senza riscriverla.

## La cask non si scrive a mano

`Casks/mydivelog.rb` è **generato**. Lo `sha256` viene dall'API di GitHub, cioè è
calcolato sul file che GitHub sta davvero servendo — e chi lo genera può
confrontarlo con il `.dmg` costruito in locale, e si ferma se i due divergono.

Aggiornata a mano, prima o poi una cask porta la versione nuova e l'impronta
della precedente: due righe che si contraddicono, e a scoprirlo è chi prova a
installare.

## Licenza

MIT, come l'applicazione.
