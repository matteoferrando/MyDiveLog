# Cosa dicono i manuali, e cosa ne ha preso l'app

Note prese leggendo per intero quattro documenti didattici: **TDI Advanced Nitrox**
(ed. 2013, 96 pp.), **Advanced Nitrox Student Manual** (stesso testo riorganizzato),
**TDI Decompression Procedures** (ed. 2011, 222 pp.) e un pacchetto di **tabelle
PADI/DSAT** (RDP aria, EANx32, EANx36, esposizione all'ossigeno, EAD).

Servono a due cose: sapere quali numeri dell'app hanno una fonte, e sapere quali
non ce l'hanno. La seconda lista è la più importante, perché è quella che l'app
non deve spacciare per didattica.

> **Nota di manutenzione, 25 agosto 2026 — e vale più del resto della nota.**
> Questo documento teneva una lista di **otto** cose «da prendere». Riconfrontata
> voce per voce col codice, **erano già state fatte tutte e otto.** Non due, non
> tre: tutte. Il documento è stato letto e ricopiato come se fosse aggiornato, e
> la lista è servita per mesi solo a far ricominciare lavoro già finito.
>
> Da qui in avanti: una voce si chiude spostandola in «Già preso» **con il punto
> del codice accanto**, e prima di riaprire questa sezione si rilegge il codice,
> non questo file. Una lista di cose da fare che contiene cose fatte è peggio di
> nessuna lista.

## I numeri che l'app ora usa, con la loro fonte

**Esposizione all'ossigeno** (`core/analysis/oxygen.ts`). Tabelle NOAA come le
riportano i manuali: limiti per singola esposizione — 0.6 bar → 720 min, 1.0 → 300,
1.4 → 150, 1.6 → 45 — e limiti sulle 24 ore, che sono più permissivi in alto
(1.6 → 150). CNS% = tempo / limite × 100 (*Advanced Nitrox* p. 33, con l'esempio
40 min a 1.4 bar = 26.7%). Emivita in superficie 90 minuti (p. 33-34). OTU con la
formula `t × (0.5 / (PO2 − 0.5))^−0.833` (p. 35, *Deco* p. 177), verificata contro
la tabella stampata: 1.0 → 1.000, 1.3 → 1.479, 1.6 → 1.928. Dose giornaliera 300 OTU
per giorni multipli, 850 il limite accettato in un giorno solo (p. 37).

Due scelte dichiarate, perché i manuali si contraddicono:

- **Quale colonna per il CNS.** *Decompression Procedures* p. 178 dice di calcolare
  il CNS% con i limiti delle 24 ore; la tabella DSAT stampata sulle tabelle da
  immersione e tutti i computer subacquei usano quelli per singola esposizione. A
  1.6 bar la differenza è un fattore 3.3. L'app usa **singola esposizione**, perché
  è la convenzione con cui il numero verrà confrontato: chi legge 40% sul computer
  si aspetta lo stesso 40% qui.
- **0.7 bar sulle 24 ore.** 570 minuti in *Deco* p. 56 e p. 178, 540 nella card di
  *Advanced Nitrox* p. 32. Tutte le altre righe coincidono. L'app usa 570.

Sotto 0.6 bar i manuali non danno limiti e l'app non conta niente. Fra un gradino e
l'altro si arrotonda al gradino superiore, che è la scelta prudente: i manuali non
dicono come interpolare, quindi non si interpola.

**MOD doppia** (`gasPlan`): 1.4 bar per la fase di lavoro e 1.6 per la
decompressione (*Advanced Nitrox* p. 31, e la review question di p. 53 che ne
chiede esplicitamente due). Prima l'app ne mostrava una sola, quella del limite
impostato.

**Miscela migliore**: `Fg = Pg / P` (p. 49, *Deco* p. 147), **troncata in giù** come
fa il manuale — 1.4 / 4.5 = 0.3111 → 31%, non 32. Arrotondare per eccesso darebbe
una miscela la cui MOD è più bassa della profondità pianificata.

**Narcosi in pressione parziale d'azoto**: la fascia accettata va da **4.0 a 5.21
ata di N₂**, con 4.0 come massimo in ambiente ostruito o in acqua fredda e buia
(pp. 39-40). Il manuale dice testualmente *"There is no set rule"*: l'app mostra il
valore e le due soglie, invece della soglia netta a 30 m di END che aveva prima e
che affermava più di quanto la fonte dica.

**Velocità di risalita**: 9 m/min negli esempi di calcolo (*Advanced Nitrox* p. 36),
10 m/min come tetto (*Deco* p. 134, tabelle Bühlmann p. 94). Discesa 20 m/min
(*Deco* p. 134). Il **6 m/min sopra i 10 metri** che l'app usa come limite non
compare in nessuno dei quattro documenti: è una convenzione nostra e va detto.

## La correzione più netta: la narcosi del nitrox

L'app calcolava l'END considerando narcotico **solo l'azoto**: EAN32 a 35 m dava
31 m. Il manuale dice l'opposto, in un riquadro:

> *"Oxygen is thought to carry with it narcosis properties as well, perhaps even
> slightly greater than that of nitrogen. The easy rule of thumb is to not dive
> nitrox deeper than you would dive with air."* (*Advanced Nitrox* p. 40)

Con quella convenzione, per una miscela senza elio l'END **è** la profondità. La
versione precedente diceva al subacqueo che col nitrox era meno narcotizzato — la
meno prudente delle due letture. Ora `end()` prende `oxygenNarcotic`, che è vero per
difetto; l'EAD, che è una domanda diversa (quanto azoto respiri), resta com'era.

## Già preso

Con il punto del codice accanto a ogni voce. Sono le otto della vecchia lista
«da prendere», tutte verificate nel codice il **25 agosto 2026**.

**Sosta di sicurezza: 3 minuti, non 150 secondi** — `core/model.ts`,
`LIMITS.safetyStopMinS = 180`, con `safetyStopFullS = 300` per il limite alto
della fascia. La soglia precedente di 150 s faceva risultare completa una sosta
che *Advanced Nitrox* p. 76 considera corta: lì la sosta bassa tradizionale è
data da tre a cinque minuti. Il consiglio in `coaching.ts` calcola la soglia da
`LIMITS` invece di ripeterla a mano.

**Terminologia SCR** — `core/model.ts`, sopra `rmvLpm`. Per TDI il valore
normalizzato alla superficie è lo **SCR**; «RMV» esige che si dichiari a quale
profondità (*Deco* p. 162). Il campo **non è stato rinominato**, ed è una scelta,
non una dimenticanza: `rmvLpm` sta dentro il JSON di ogni immersione in archivio,
nei backup e nei file esportati, e rinominarlo renderebbe illeggibile il consumo di
tutto lo storico per una correzione di vocabolario. A schermo l'interfaccia dice
sempre **«consumo di superficie»**, che è corretto e non ha bisogno di sigle.

**Gas analizzato per bombola** — `core/model.ts` (`Cylinder.analisi`, tipo
`AnalisiGas` con `o2`, `he`, `quando`, `chi`) e `core/analisiGas.ts` per il
confronto con la miscela dichiarata. È la procedura che i manuali impongono senza
sfumature: *"No diver should breathe any mixture they have not personally confirmed
prior to the dive"* (*Advanced Nitrox* p. 73).

> Il verso dello scarto è la parte che si sbaglia, e l'ho sbagliata: **più
> ossigeno del dichiarato abbassa la MOD**, quindi analizzare 34% dove la bombola
> dice 32% è il caso pericoloso, non quello tranquillo. Il controllo automatico su
> `descriviScarto()` esiste per questo, e la prima versione l'ha bocciata.

**CNS e OTU sulle immersioni vere, giorno per giorno** — `core/analysis/oxygen.ts`,
`oxygenLoad()`. Per ogni giornata: il **picco** dell'orologio CNS tenendo conto del
dimezzamento ogni 90 minuti negli intervalli di superficie (`cnsAfterSurface`), le
OTU sommate senza recupero, e `daysOverOtu300`. Entra in `aggregate.ts` come
`agg.oxygen`. La giornata si costruisce sul **giorno locale del luogo**
(`giornoLocale`), non sui primi dieci caratteri dell'istante UTC: alle Maldive o ai
Caraibi la mezzanotte UTC attraversa la giornata di immersioni, e quattro
immersioni dello stesso giovedì diventavano due giornate da 160 OTU l'una — sotto
la dose — invece di una da 320, che è sopra.

**Velocità sul tratto finale** — `core/analysis/metrics.ts`, `analyseFinalAscent()`,
che produce `finalAscentRateMpm` e `finalAscentFromM`. È misurata **punto a punto e
non su finestra mobile**, che era esattamente l'obiezione: un tratto 5 m →
superficie dura cinque secondi e una finestra da trenta lo diluisce. La superficie
si considera raggiunta a 0.5 m, perché aspettare lo zero esatto include il tempo in
cui il subacqueo galleggia già. Si vede nella scheda dell'immersione e nel
confronto; `aggregate.ts` conta `fastFinalAscents` rispetto a
`LIMITS.danFinalAscentMpm`, che resta un **termine di paragone** e non un criterio
di violazione — è la media misurata da DAN su un comportamento che il manuale porta
come esempio di ciò che si dovrebbe migliorare.

**Soste profonde** — `metrics.ts` produce `deepStopS` e `deepStopDepthM` sulla
fascia `LIMITS.deepStopBandFraction` (0.4–0.6 della massima) con `deepStopMinS` di
un minuto; `aggregate.ts` tiene `deepStopDives` su `deepStopEligible`.

**Indice di dente di sega** — `sawtoothMPerHour` in `metrics.ts`, presentato
**relativo alle proprie immersioni** e non come pass/fail: `coaching.ts` usa i
percentili dell'archivio (`agg.sawtoothRef`, p50 e p75) invece di una soglia
inventata, perché una soglia numerica il manuale non la dà.

**Consumo di squadra** — `core/analysis/gasPlan.ts`: il piano usa **il più alto dei
due** consumi e lo dichiara in chiaro («la didattica impone di pianificare sul
respiro più alto della squadra, altrimenti è lui a girare prima e il piano non lo
sa»).

## Quello che l'app fa e che i manuali NON coprono

Va scritto, perché la tentazione di attribuire tutto alla didattica è forte:

- **Regola dei terzi**: *Advanced Nitrox* non la nomina mai; *Deco* la nomina una
  volta sola (p. 177) e la confina all'ambiente ostruito, rimandando a un altro
  corso. Nessuna formula, nessun esempio.
- **Riserva fissa in bar**: assente. Il manuale chiede l'opposto — *"predetermined
  departure pressures for different depths"* (*Advanced Nitrox* p. 76), cioè
  pressioni di partenza che dipendono dalla profondità. L'avvertenza che l'app già
  dà quando si sceglie la riserva fissa sotto i 30 m è allineata a quella frase.
- **Rock bottom con la nostra formula**: il principio c'è (*Advanced Nitrox* p. 69:
  gas sufficiente per due in caso di perdita catastrofica), i numeri no. *Deco*
  struttura diversamente: `fondo + 2 × (transito + deco)` (p. 174-175), con un
  ulteriore **×1.5** sul gas nelle bombole di decompressione separate (p. 176).
- **Tabella delle pressioni attese nel tempo**: non esiste in nessuno dei due
  manuali. Quello che insegnano sono il **run time schedule** (azione, profondità,
  stop time, run time, miscela — *Deco* pp. 134-138 e 159) che non ha colonna di
  pressione, e la **turn pressure** (p. 176) che è un numero solo. La colonna dei
  bar dell'app è costruita con le formule del manuale ma è un'aggiunta nostra, e la
  pagina lo dichiara.
- **Gradient factor**: l'unica coppia citata in tutto il materiale è **30/85**
  (*Deco* p. 72). Non esiste nessuna tabella di GF raccomandati per profondità,
  età o temperatura: se servisse, non è in queste fonti.
- **Oscillazione d'assetto quantificata**, percentili sul consumo, GF99: nostri.

## Cosa resta da prendere

**Da questi quattro documenti, niente.** Le otto voci che stavano qui sono tutte
nella sezione «Già preso», con il riferimento al codice.

Quello che resta è di natura diversa e non viene da queste fonti:

- **La letteratura successiva al 2013.** Tutto quanto sta qui viene da testi
  2009-2013. Sulle deep stop in particolare la ricerca posteriore è controversa, e
  l'app presenta la regola come regola *di quei manuali*, con l'anno accanto. Serve
  una lettura nuova, non un'altra estrazione da questi.
- **La verifica indipendente del VPM-B**, che è un impegno preso altrove e non una
  voce di didattica.

Prima di riaprire questa sezione: rileggere il codice, non questo file.

## Cosa NON prendere

Le **tabelle NDL e di decompressione** (USN Rev. 6, Bühlmann, RDP DSAT) sono
riprodotte come scansioni di card plastificate: oltre duemila celle, font piccolo,
JPEG compresso. Trascriverle a mano in dati di sicurezza è un lavoro di ore con un
rischio di errore che non vale niente per un'app che importa profili reali da
computer con i GF impostati. Le uniche cose da portare via da quelle appendici sono
regole testuali, non numeri da tabella: 24 ore prima del volo dopo immersioni con
deco, sosta minima di un minuto a 3 m per ogni immersione con le tabelle Bühlmann,
e il limite del brevetto Advanced Nitrox — 40 m, senza decompressione obbligatoria.

Nota generale: sono testi del 2009-2013. Dove citiamo TDI, citiamo anche l'anno.
