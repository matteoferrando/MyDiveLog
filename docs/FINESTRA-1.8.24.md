# La finestra dell'aggiornamento 1.8.23 → 1.8.24, e perché resta aperta

*Misurata il 16 settembre 2026, dopo aver chiuso il difetto 11.*

## Cosa è cambiato

Il difetto 11 era: **lo stesso tuffo scaricato in due fusi orari diversi
prendeva due identificativi diversi**, e diventava due immersioni su tutti i
dispositivi, per sempre, senza un avviso. La firma usava il minuto dell'istante
UTC, e l'istante UTC dipende dal fuso che il dispositivo applica quando il
computer non ne dichiara uno.

Adesso la firma usa **l'ora a parete** — quella che leggevi sul polso — che è
uguale su tutti i dispositivi.

## La conseguenza, che va detta

**Gli identificativi calcolati da oggi in poi sono diversi da quelli calcolati
ieri**, per le immersioni che portano un fuso (`utcOffsetMinutes`). Quelli già
scritti in archivio non cambiano: cambia solo come si calcola quello di
un'immersione che arriva adesso.

**Misurato:** un'immersione in archivio con la vecchia firma, reimportata con la
nuova, viene riconosciuta da `findBestMatch` per somiglianza e conta come
**duplicato** — l'archivio resta a una sola immersione. La strada dell'import è
coperta.

## La finestra che resta

La sincronizzazione **non** usa la somiglianza: confronta gli identificativi.
Quindi esiste un ordine di operazioni che produce un doppione, una volta sola:

> un dispositivo **nuovo e vuoto**, che scarica **tutto** dal computer subacqueo
> (identificativi nuovi) **prima** della sua prima sincronizzazione con un
> remoto che contiene copie scritte prima dell'aggiornamento (identificativi
> vecchi).

Qualunque altro ordine è coperto:

- il segnalibro, che viaggia anche lui nella sincronizzazione, ferma lo scarico
  prima delle immersioni vecchie: un dispositivo già in uso non le riscarica;
- se il dispositivo sincronizza **prima** di scaricare, le copie del remoto sono
  già in archivio e `mergeImports` le riconosce per somiglianza.

E va confrontata con quello che c'era prima: **lo stesso doppione lo produceva
ogni scarico fatto in un fuso diverso**, cioè il caso normale di chi viaggia per
immergersi. La finestra nuova è una sola volta, su un dispositivo vuoto, in un
solo ordine.

## Cosa la chiuderebbe, quando vorrai

Far passare anche lo scarico della sincronizzazione dalla somiglianza, come fa
già l'import: per ogni immersione che scende e il cui identificativo non trova
riscontro in locale, cercare `findBestMatch` fra le locali e — se la trova —
fondere su quella invece di aggiungerne una nuova.

**Non l'ho fatto stanotte di proposito.** Tocca il cuore della
sincronizzazione, cambia cosa risale sul remoto, e la parte che serve per
completarlo davvero — togliere dal remoto la copia in più — è una cancellazione.
Le cancellazioni le fai tu.
