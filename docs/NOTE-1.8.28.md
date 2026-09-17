# 1.8.28 — l'interfaccia guardata invece che immaginata

*Una frase detta davanti allo schermo — «chiediamo il menu della lingua in due
parti» — e sei difetti trovati misurando la build vera.*

---

## Come sono stati trovati

Non rileggendo il codice: montando `dist` in un browser senza testa e
**misurandolo**. Novantuno schermate, l'inventario dei comandi di ogni pagina
(titoli, pulsanti, tendine, campi, collegamenti), le geometrie a 720, 800, 1024,
1280, 1440 e 1728 px, il contrasto calcolato su ogni nodo di testo in tema
chiaro e scuro, e quaranta passaggi di tabulatore per l'anello di fuoco.

Quello che il setaccio **non** ha trovato conta quanto il resto: nessun comando
senza nome accessibile, nessun campo senza etichetta, nessun id ripetuto,
nessun testo tagliato, nessun contrasto sotto la soglia.

## 1 — I campi avevano il vestito di fabbrica, dalla 1.8.23

`styles.css` vestiva tutti i campi con una regola sola. Il 16 settembre
(`df03688`, la 1.8.23) fra l'ultima riga dell'elenco dei selettori e la parentesi
è stata infilata la regola della freccia del `select`: la virgola dopo
`input[type='password']` si è tirata dentro il selettore nuovo, e da quel momento
l'elenco intero dichiarava **solo** `padding-right: 26px`.

Misurato su Chromium a 1280 px, prima: `select` alto **19 px**, bordo
`2px inset rgb(118,118,118)`, raggio 0, carattere 13,333 px (quello di fabbrica,
non i 13 dell'applicazione). Dopo: **34 px**, bordo `1px solid var(--border-strong)`,
raggio 6, carattere 13 px. A 390 px il bordo era lo stesso: cambiava solo il
carattere, che la regola dei 16 px di iOS teneva grande.

*Una regola che non si applica più non si lamenta: bisogna misurarla.*

## 2 — I bersagli erano a norma solo sul telefono

`@media (pointer: coarse), (max-width: 700px)` con dentro scritto che le due
condizioni valgono «insieme»: sono due modi di descrivere lo stesso schermo. Col
mouse: caselle **13×13**, data-pulsante **58×20**, contro i 24×24 di WCAG 2.2 AA.

Adesso `.cell-link` è 62×28 per tutti e la casella è 18×18 col mouse, 24 col
dito. I 18 stanno in piedi per l'**eccezione di spaziatura**, misurata: 58 px
fra il centro di una casella e quella della riga sotto, 99 px fra la casella e
la data. A 24 px la riga passa da 58 a 64.

## 3 — La lingua in due posti

`CambiaLingua` nella barra e `RigaLingua` in Impostazioni, visibili insieme
sopra i 700 px. Tolto il componente, il suo CSS e il suo riferimento; la prova
del documento (`linguaDelDocumento`) ha cambiato soggetto invece di sparire.

## 4 — Tre sorgenti che `grep` chiamava binari

`Brevetti.tsx` (byte 0x00), `gearStats.ts` (0x00), `dedupe.ts` (0x01): tutti e
tre separatori dentro stringhe, battuti nel sorgente invece che scritti come
escape. `grep -rn` rispondeva «binary file matches» **senza la riga**, `git diff`
«Binary files differ». Il valore a runtime non cambia di un bit — per
`stableId` non poteva cambiare, o ogni immersione in archivio avrebbe cambiato
identificativo.

Trovati **due su tre dalla guardia stessa**, scritta per il primo.

## 5 — Dodici pulsanti chiamati tutti «Apri»

Nelle tabelle di brevetti e attrezzatura il nome accessibile era la sola parola
«Apri». Ora porta il soggetto; il testo visibile resta «Apri». E i due
interruttori di «Prima della prossima immersione» dichiarano `aria-expanded`,
come `CartaApribile` fa da settimane.

## 6 — Due regole di stile senza padrone

`.streaming` (con `@keyframes blink`) e `.ai-meta`: due classi su 126 che nessun
sorgente nomina più.

## E poi, dalla richiesta di un istruttore

**FIAS**, 17 brevetti, con i numeri delle pagine ufficiali. Non è un alias di
FIPSAS: 20 m contro 18 al primo livello autonomo, 40 contro 42 al profondo.

Aggiungendola si è visto un difetto vecchio: la scheda diceva *«Primo livello
(fino a 18 m) · 20 m»* — il tipico dello scalino e il dichiarato della didattica
uno accanto all'altro. Capitava già a CMAS One Star e a FIPSAS 3° Grado. Ora
dove la didattica dichiara, il numero è uno solo.

## Le date

Ventuno punti dicevano «17 settembre 2026» per fatti del **16**: la data era
stata dedotta invece che misurata, mentre l'orologio del Mac e le date dei commit
dicevano 16. Corrette, con una guardia che rifiuta una data di prova sul campo
che non sia ancora arrivata. Altri nove punti sono sfuggiti al primo giro perché
scrivevano «17 settembre» **senza l'anno**, e la ricerca l'anno ce l'aveva
dentro: corretti qui.

## Le guardie nuove

Cinque, e ognuna è stata vista rossa rimettendo il difetto:

| Prova | Cosa tiene |
|---|---|
| `vestitoDeiCampi` | i campi ricevono il vestito dell'applicazione, fuori da ogni media query |
| `sorgentiDiTesto` | nessun byte di controllo nei sorgenti |
| `nomiDeiPulsanti` | due righe diverse, due nomi accessibili diversi |
| `cssSenzaPadrone` | nessuna classe del foglio senza nessuno che la indossi |
| `schedaDelBrevetto` | mai due profondità diverse sulla stessa riga, in tutto il catalogo |

Catena: **2 865 prove in 179 file**, **149** Rust, tipi/lint/formato a zero.

## Cosa resta da guardare con l'applicazione aperta

Il trascinamento della finestra con la barra del titolo trasparente, e il menu
nativo del Mac: nel Rust non ne è dichiarato nessuno. Non si misurano da un
browser senza testa.
