# Cosa dicono i manuali, e cosa ne ha preso l'app

Note prese leggendo per intero quattro documenti didattici: **TDI Advanced Nitrox**
(ed. 2013, 96 pp.), **Advanced Nitrox Student Manual** (stesso testo riorganizzato),
**TDI Decompression Procedures** (ed. 2011, 222 pp.) e un pacchetto di **tabelle
PADI/DSAT** (RDP aria, EANx32, EANx36, esposizione all'ossigeno, EAD).

Servono a due cose: sapere quali numeri dell'app hanno una fonte, e sapere quali
non ce l'hanno. La seconda lista è la più importante, perché è quella che l'app
non deve spacciare per didattica.

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

In ordine di rapporto fra valore e lavoro:

1. **CNS e OTU sulle immersioni vere**, non solo sul piano: accumulo per giornata,
   emivita di 90 minuti fra un'immersione e l'altra per il CNS, somma pura per gli
   OTU. Tutti i dati ci sono già (PPO2 campione per campione, orari di inizio e
   fine). Il valore è per le settimane di immersioni, dove il limite morde davvero.
2. **Velocità sul tratto finale**, dopo la sosta di sicurezza. DAN misura una media
   reale di **60 m/min** su quel tratto (*Advanced Nitrox* p. 38). La metrica attuale
   usa una finestra di 30 secondi, e un tratto 5 m → superficie dura 5 secondi:
   la finestra lo diluisce e lo nasconde. È un difetto diffuso, misurabile con i
   dati che abbiamo, e oggi invisibile.
3. **Soste profonde**: la regola pratica è metà della profondità massima per 1-2
   minuti, poi a metà fra lì e la sosta bassa (*Advanced Nitrox* pp. 75-76; il
   metodo Pyle in cinque passi è in *Deco* p. 70). Verificabile a posteriori sul
   profilo. Da presentare come regola del 2011-2013: la letteratura successiva sulle
   deep stop è controversa.
4. **Sosta di sicurezza 3-5 minuti** (p. 76). L'app oggi considera completata una
   sosta di 150 secondi: è più permissiva del manuale.
5. **Gas switch validati contro la MOD** e campo "gas analizzato" per bombola. È
   l'unica procedura che i manuali impongono senza sfumature: *"No diver should
   breathe any mixture they have not personally confirmed prior to the dive"*
   (*Advanced Nitrox* p. 73). Un logbook è il posto giusto dove registrarla.
6. **Indice di dente di sega** e "la parte profonda viene per prima" (p. 38). Il
   manuale non dà una soglia numerica: da presentare come indice relativo alle
   proprie immersioni, non come pass/fail.
7. **Consumo di squadra**: i manuali impongono di pianificare sull'SCR **più alto**
   del team (*Deco* p. 163, 174). L'app pianifica sul consumo di chi la usa.
8. **Terminologia**: per TDI il valore normalizzato a superficie si chiama **SCR**;
   l'RMV richiede che si dichiari a quale profondità (*Deco* p. 162). L'app chiama
   RMV quello che il manuale chiama SCR.

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
