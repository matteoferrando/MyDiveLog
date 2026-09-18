# 1.8.29 — le proporzioni contate, e quattro guardie che non guardavano

*Due notti. La prima sulla grafica, la seconda su tutto il resto. Nessuno dei
difetti qui sotto rompeva niente: è esattamente il motivo per cui erano ancora
lì.*

---

## Come sono stati trovati

**Contando.** Centoventi viste — dodici larghezze per dieci schede — più tema
scuro e inglese, su un browser senza testa, sulla build vera. Poi quarantamila
piani di gas e seimila di decompressione generati a caso, il controllo dei tipi
esteso a tutto il progetto, clippy, e un giro di prestazioni fino a diecimila
immersioni.

Le sonde nuove stanno in `audit/`: `proporzioni.mjs` (altezze dei controlli,
code della virgola, bordi delle carte), `acapo.mjs` (chi va a capo lasciando
spazio), `testoSvg.mjs` (testo tagliato dentro i grafici), `console.mjs`
(errori e avvisi a runtime), `inglese.mjs` (le stesse misure con l’altra
lingua), `riassunti.mjs` (i bersagli dei `<details>`).

---

# Parte prima — la grafica

## 1 — L’altezza dei controlli era un risultato, non una misura

A 1280 px, sulle nove schede:

| | prima | ora (mouse) | ora (dito) |
|---|---|---|---|
| pulsante | 35,5 px | **36** | **44** |
| campo di testo | 33,5 px | **36** | **44** |
| menu a tendina | 31 px | **36** | **44** |

Nessuna sbagliata di suo — ognuna usciva dal proprio riempimento e dal proprio
carattere. *Sono numeri che nascono da soli, e nascere da soli non li mette
d’accordo.*

Sul telefono la differenza cambiava di segno: i campi salgono a 16 px di
carattere (l’unico modo di non far ingrandire la pagina a Safari) e arrivavano a
38, i pulsanti restavano a 35,5 — sotto i 44 di iOS, nella stessa schermata dove
la barra in basso era già a 44.

Adesso c’è `--h-controllo`, con `--h-pastiglia` per i pulsantini. Guardia:
`vestitoDeiCampi.test.ts`, che pretende che l’altezza arrivi dal token e vieta
le misure scritte a mano sui selettori generici — ma non su quelli contestuali,
perché le righe dell’elenco dei computer sono 44 anche col mouse per una ragione
scritta.

## 2 — La pastiglia esisteva in tredici copie e in tre misure

«Apri», «×», «12 L», «Mediana»: lo stesso pulsantino scritto a mano tredici
volte con `style={{ fontSize: 12, padding: '3px 8px' }}` — tranne in tre, dove
il riempimento era `3px 7px` o `4px 8px`. Misurate: **26 px in un posto, 28 in
un altro**. Adesso è `.pastiglia`.

## 3 — Cinque classi nel markup non vestivano niente

Lo specchio di `cssSenzaPadrone`, e il più subdolo dei due: *il CSS morto non fa
niente, una classe inventata fa credere che quel pezzo sia stato disegnato.*

- `linklike`, due volte in `Compare.tsx`, sui pulsanti che aprono le immersioni
  confrontate. Il nome dice che dovevano sembrare collegamenti; nel foglio non
  c’era niente, quindi erano due pulsanti grigi con la cornice dentro
  l’intestazione di una tabella. Il componente giusto esisteva già:
  `.cell-link`.
- `btn-small`, tre volte, su tre pulsanti che qualcuno voleva piccoli.

`classiSenzaVestito.test.ts` li distingue dai **ganci** (`voce-altro`,
`proposte-dal-nome`, che non hanno regole e vanno benissimo perché una prova o
uno script li usa come selettore): la differenza non è nel nome, è nel fatto
che qualcuno li nomina — e quel qualcuno si cerca, non si elenca a mano.

## 4 — I litri di gas portavano la coda della virgola mobile

«3982.0000000000005 L di gas». Nessuna prova l’aveva preso **perché il valore
era giusto**: il difetto stava solo nella forma di ciò che veniva disegnato.
Scrivendo la guardia è saltato fuori il gemello: «200 bar × 18,1 L =
3982,0000000000005 L a bordo», altra pagina, stessa moltiplicazione.

`numeriSenzaCoda.test.tsx` legge i nodi di testo uno per uno — non
`textContent`, che incolla i pezzi vicini e inventa code che non esistono — e
cerca quattro cifre dopo il separatore, non tre: in italiano un gruppo di
migliaia è esattamente tre cifre dopo un punto.

## 5 — Una colonna che si allarga, per la seconda volta in tre giorni

Incolonnare `.page-title-row` sul telefono ha rimesso in piedi la trappola
chiusa il 15 settembre su `.filters`: in colonna, `flex-wrap: wrap` vuol dire
che il contenitore può aprire una **seconda colonna**, la cui larghezza la detta
il figlio più largo — non il contenitore — e `align-items: stretch` la impone a
tutti. Misurato a 320 px sulla scheda Suggerimenti: contenitore **280**, figli
**342**.

La lezione era scritta per esteso trenta righe più in basso nello stesso file e
non ha protetto niente. `colonnaCheAllarga.test.ts` cerca la forma e non il
nome, e ne ha trovati tre.

## 6 — E altre sette, tutte misurate

- Il riassunto di un `<details>` era un bersaglio da **18 px**, col mouse e col
  dito: nessuna regola lo vestiva, e nessuna sonda lo contava perché contavano
  `button, a, input, select`.
- Tre caselle del pianificatore erano **16×16** dove tutte le altre erano 18:
  un’eccezione scritta quando la misura di fabbrica era 13, rimasta in piedi
  dopo il passaggio a 18. *Una regola scritta contro un valore che non c’è più
  non difende niente.* Con lei se n’è andata la prova che ne difendeva la
  **posizione** invece della proprietà.
- Il pulsante di Apple aveva `min-height: 44px` scritto a mano accanto a uno da
  35,5: **8,5 px di scarto** in una riga di due pulsanti, misurati.
- La scelta del periodo andava a capo due e due, allineata a destra e sfrangiata
  a sinistra.
- Le coppie di azioni (i due accessi, «Salva credenziali» e «Prova la
  connessione») restavano larghe quanto la propria scritta: 172 e 162 px. Per
  l’accesso non è estetica — la linea guida 4.8 dell’App Store chiede che Sign
  in with Apple sia offerto in modo *equivalente*.
- Sulla scheda Gas dieci carte stavano a 20 px di distanza e quattro a 14,
  perché quelle quattro ereditavano il passo delle tessere.
- Undici spaziature fuori scala (5, 7, 9, 15, 22 px) e una frase che
  ricominciava in minuscolo dopo il punto: «…assetto. su 30 immersioni».

## 7 — Su Android l’applicazione parlava di un’altra piattaforma

«Trascina qui i file, o scegli dal disco». La correzione esisteva da tre
settimane, con scritto accanto il perché — *un invito che non si può accettare
fa sembrare rotta la funzione, non il testo* — ma la condizione era `suIOS()`.

E la strada del permesso Bluetooth era scritta per due piattaforme su tre: il
ramo `else` dava quella di macOS anche a chi ha in mano un Android, dove non
esiste e dove il permesso si chiama **Dispositivi nelle vicinanze**. *Una strada
sbagliata è peggio di nessuna strada: chi la segue conclude che il permesso c’è
già e che rotta è l’applicazione.*

## 8 — In inglese due etichette non ci stavano

Tutte le misure erano state fatte in italiano. Rifatte in inglese: «reserve»
usciva di due pixel dal grafico delle pressioni («riserva» ci stava), e le
percentuali sotto la barra delle fasi stavano un pixel fuori da un riquadro
alto 58 per un contenuto da 58,3.

---

# Parte seconda — il debug a tappeto

## 9 — Tre zone del progetto stavano fuori dal controllo dei tipi

`tsconfig.json` diceva `"include": ["src", "tests"]`. Fuori restavano **nove
programmi in `scripts/`** (fra cui `generate-demo-data.ts`, dentro
`npm run play`), **gli otto file del Worker in `server/`** — scambio del codice
con Apple e Google, sessioni, limite di frequenza, Turso — e `vite.config.ts`.

Il Worker è il codice più delicato del progetto e nessun `tsc` lo aveva mai
guardato: wrangler lo pubblica con esbuild, che traspila senza controllare.
Controllato ora con le opzioni rigide è **pulito**. Negli script invece c’era un
errore vero: `perche-non-unite.ts` filtrava su `d.deletedAt`, un campo che il
modello non ha mai avuto.

`tipiSenzaGuardia.test.ts` legge il disco e il `tsconfig`.

## 10 — `Infinity` usciva dal nucleo e arrivava a schermo

Con la bombola a zero litri: «EAN32 1.719 **Infinity** 220».

Ed è già la prima proprietà di `proprieta.test.ts` — *«nessun NaN e nessun
Infinity in nessun campo, da nessuna parte»* — verde da settimane, perché il
generatore scriveva `tankL: intero(10, 24)`.

> *Una proprietà il cui generatore non può raggiungere il caso che la rompe non
> è mai stata provata.*

| mutazione | esito |
|---|---|
| difetto rimesso + generatore nuovo | **ROSSA** |
| generatore vecchio + codice corretto | verde (niente da vedere) |
| **difetto vecchio + generatore vecchio** | **VERDE** ← com’era |
| tsconfig ristretto | **ROSSA** |

## 11 — La catena di rilascio misurava il pacchetto sbagliato

`bundle.test.ts` misura `dist/` e si salta da sé quando non c’è. La catena non
costruiva: su un albero pulito quelle prove **non giravano affatto**, sulla
macchina di chi pubblica giravano sulla build del rilascio **precedente**.

Provato nei due ordini, sulla stessa macchina:

```
prove prima della build (dist di ieri) ....  5 prove su 6 SALTATE
build prima delle prove .................... 6 su 6, tutte verdi
```

Tre cose: la catena costruisce per prima; la prova si salta anche quando `dist/`
è più vecchia dei sorgenti; una prova nuova legge `RILASCIO.md` e pretende
l’ordine giusto — *un documento che tiene in piedi una prova va controllato come
il codice.*

## 12 — Il dizionario aveva tre voci senza nessuna frase dietro

Due morte davvero. La terza — «lettura della memoria del computer» — la scrive
`ponte_blec.rs` e attraversa il ponte dentro un `DownloadEvent`: cercandola solo
in `src/` risultava morta, e toglierla avrebbe spento la traduzione della barra
di avanzamento di **ogni scarico Bluetooth**. *Una guardia che guarda metà del
progetto propone di cancellare l’altra metà.*

## 13 — Il lato Rust

Zero `unwrap`, zero `expect`, zero `panic!`, zero `unsafe` fuori dal confine
FFI. Ma **clippy non era mai stato lanciato**: diciannove segnalazioni, tre di
codice morto.

`INTERVALLO_MISURATO` — 60 ms, l’intervallo di connessione BLE misurato
sull’Aladin l’11 settembre e sul Puck 4 il 12 — esiste per giustificare i 250 ms
di attesa di un frammento, «quattro intervalli misurati». **Nessuno lo
leggeva.** Adesso è un `const _: () = assert!(...)`: chi riabbassa l’attesa non
compila. E `scarica`/`in_risultato`, che solo le prove chiamano, lo dichiarano
con `#[cfg(test)]`.

Restano otto segnalazioni di stile nella libreria e quattordici nelle prove:
tipi complessi, troppi argomenti, una chiusura inutile, due nomi di prova in
maiuscolo. Nessuna è un difetto di correttezza; toccarle vuol dire toccare
firme al confine FFI.

## 14 — Il debito sulle prestazioni è chiuso con dei numeri

| | 500 | 2 000 | 10 000 |
|---|---|---|---|
| `computeMetrics` di tutte | 53 ms | 125 ms | 597 ms |
| `aggregate` (tutto l’archivio) | 12 ms | 14 ms | 86 ms |
| `aggregate` (finestra 12 mesi) | 4 ms | 11 ms | 76 ms |
| `buildPlan` | 1 ms | 1 ms | 9 ms |
| `mergeImports` di 50 | 16 ms | 52 ms | 304 ms |
| `mergeImports` di 200 doppioni | 6 ms | 7 ms | 11 ms |

Tutto lineare tranne l’unico termine che non può esserlo. I doppioni costano
*meno* del nuovo: la catena di `likelySame` esce al primo anello che combacia.
Riproducibile con `npm run prestazioni`.

## 15 — Sei avvisi di React che non erano rumore

`riquadroFirma.test.tsx` faceva le sue asserzioni **prima** che i profili
arrivassero dalla promessa. *Una prova che guarda uno stato diverso da quello
che guarda la persona è verde per una ragione sua.*

---

## Quello che è risultato pulito, misurato e non dedotto

- **40 000 piani di gas e 6 000 di decompressione** generati a caso fuori scala:
  zero NaN, zero infiniti, zero eccezioni, zero invarianti rotte.
- **Dieci profili degeneri** attraverso `computeMetrics` — vuoto, un campione,
  tempo all’indietro, profondità negative, `NaN` dentro, diecimila metri: niente.
- **Zero errori e zero avvisi in console** su tre configurazioni × tutte le
  schede × chiaro, scuro e inglese, aprendo ogni sezione, la scheda di
  un’immersione, la modifica e il pianificatore tecnico.
- **120 viste su dodici larghezze**: zero elementi fuori dal riquadro, zero testi
  tagliati, zero scorrimenti orizzontali, zero righe con controlli di altezze
  diverse, zero etichette tagliate nei grafici — in tutte e due le lingue.
- **Nessun segreto nei file tracciati**: l’unica chiave privata del repository se
  la genera una prova a ogni esecuzione.
- eslint 0, prettier pulito, nessuna mappa dei sorgenti pubblicata.
- `npm audit`: tre vulnerabilità, tutte in dipendenze di sviluppo.

## Le mutazioni

Undici provate, **undici guardie rosse**. Più la matrice della bombola da zero,
che è l’unica in cui una combinazione resta verde — ed è il punto.

## Quello che resta aperto, e sono decisioni

`noUncheckedIndexedAccess` è spento: accendendolo `tsc` dà **1 657** errori,
concentrati in `vpm.ts`, `metrics.ts` e `deco.ts`. Non sono 1 657 difetti — sono
1 657 punti in cui il tipo non garantisce che un indice esista, e il fuzz dice
che a runtime non si rompe niente. Le otto segnalazioni di clippy. Il cursore
dei gradient factor, ancora quello di fabbrica a 16 px.
