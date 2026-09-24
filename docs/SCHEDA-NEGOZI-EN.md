# La scheda dei negozi in inglese

*Scritta il 22 settembre 2026. Tradotta dalla descrizione italiana che l'App Store
serve oggi (letta dall'API pubblica, non da una copia), con i termini che usa
l'applicazione in inglese: «RMV», «NDL», «into deco», «buoyancy». In inglese
americano, la variante più diffusa: a chi ha un'altra variante d'inglese Apple
mostra «la localizzazione più vicina».*

**Perché serve.** La vetrina americana dell'App Store risponde con la descrizione
italiana: la scheda esiste in una lingua sola. Apple lo dice così: *«If no
localization matches a user's language setting, the next most relevant
localization is used. In other countries or regions, your metadata displays in
the primary language.»* — cioè, senza inglese, l'italiano a tutti.

**Quando.** Con la 1.8.31, che nei negozi va al posto della 1.8.30. La
descrizione e le parole chiave stanno sulla **versione**; nome, sottotitolo e
indirizzo della privacy stanno nelle informazioni dell'app, e conviene
compilarli insieme.

---

## App Store Connect

**App Information → Localizable Information → aggiungi «English (U.S.)»**

| Campo | Testo | Caratteri |
|---|---|---|
| Name | `MyDiveLog` | 9 / 30 |
| Subtitle | `Every computer, one logbook` | 27 / 30 |
| Privacy Policy URL | `https://mydivelog.site/en/privacy` | — |

**Nella versione 1.8.31, localizzazione inglese**

| Campo | Testo | Caratteri |
|---|---|---|
| Promotional Text | nel riquadro qui sotto | 169 / 170 |
| Description | `docs/scheda-appstore-en.txt` | 2264 / 4000 |
| Keywords | nel riquadro qui sotto | 92 / 100 |
| Support URL | `https://mydivelog.site/en/help` | — |
| Marketing URL | `https://mydivelog.site/en/` | — |
| What's New | `docs/appstore-1.8.31-en.txt` | — |

Promotional Text:

```
Two computers, one dive: MyDiveLog merges them into a single entry that keeps the best of each. Import UDDF, Shearwater, Garmin FIT and more, or download over Bluetooth.
```

Keywords — senza nomi di marchi, che la linea guida 2.3.7 non vuole fra le
parole chiave (nella descrizione invece i formati compatibili si nominano,
come già fa quella italiana):

```
scuba,dive log,logbook,diving,dive computer,uddf,decompression,nitrox,trimix,gas planner,rmv
```

**Le schermate.** Una lingua nuova parte con le schermate della lingua principale
(*«screenshots and the properties for the new language default to those of the
primary language, except for the description and keywords»*): quindi la scheda
inglese mostrerebbe l'interfaccia in italiano. **Quelle inglesi sono pronte**,
dall'archivio dimostrativo come quelle di Play: `npm run appstore` le rifà e le
misura, e finiscono in `_transfer/appstore/` — `iphone-en-*.png` (1320×2868)
nel riquadro iPhone 6,9", `mac-en-*.png` (2880×1800) nella scheda del Mac,
nell'ordine dei numeri. Nella stessa cartella ci sono le italiane, se si
vogliono sostituire anche quelle di adesso, che hanno ancora il menu in alto.

---

## Google Play Console

**Store presence → Main store listing → Manage translations → English (United
States) – en-US**

| Campo | Testo | Caratteri |
|---|---|---|
| App name | `MyDiveLog` | 9 / 30 |
| Short description | nel riquadro qui sotto | 69 / 80 |
| Full description | `docs/scheda-play-en.txt` | 2264 / 4000 |

Short description:

```
One logbook for every dive computer: merge, analyze and plan. No ads.
```

La descrizione completa è la stessa dell'App Store con i titoli in minuscolo:
le regole di Play sui metadati guardano male il MAIUSCOLO esteso, e non vale la
pena di scoprire in revisione fin dove arriva «esteso».
