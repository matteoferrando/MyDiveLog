## MyDiveLog 1.8.28 — l'interfaccia del computer, guardata invece che immaginata

Questa versione non nasce da una segnalazione ma da una frase detta davanti allo
schermo: *«chiediamo il menu della lingua in due parti»*. Bastava guardare. Da lì
è venuto fuori il resto, misurando l'applicazione vera con un browser senza
testa invece di rileggere il codice: novantuno schermate, l'inventario dei
comandi di ogni pagina, le geometrie a sei larghezze diverse e il contrasto di
ogni testo, chiaro e scuro.

### I campi avevano il vestito di fabbrica, e da tre settimane

Ogni casella di testo e ogni menu a tendina — la ricerca del logbook, i filtri,
il modulo della nuova immersione, il pianificatore, le impostazioni — era
disegnato dal motore e non dall'applicazione: bordo grigio incassato, angoli
vivi, e sul computer un'altezza di 19 pixel accanto a pulsanti alti 36.

Colpa nostra, e databile: nella 1.8.23 una regola di stile è stata infilata
dentro l'elenco di un'altra, e una virgola si è portata via le dichiarazioni di
tutti i campi. Il foglio restava valido, nessun errore da nessuna parte. Sul
telefono si notava meno — lì il testo dei campi resta grande per un'altra regola,
e i riquadri di sistema sembrano quasi a posto — ed è il motivo per cui è
passata inosservata per tre settimane.

Adesso i campi hanno il bordo, gli angoli e il fondo del resto
dell'applicazione — anche in tema scuro — e sul computer sono alti 34 pixel
invece di 19.

### I bersagli erano a norma solo sul telefono

Le caselle di spunta del logbook misuravano **13×13 pixel** con il mouse, e la
data che apre l'immersione 58×20: sotto il minimo che le linee guida chiedono,
nella stessa applicazione dove sul telefono erano a posto da settimane. Le
misure stavano dentro una condizione che descriveva solo lo schermo piccolo.

Adesso la data è 62×28 per tutti e la casella cresce a 18 pixel con il mouse e a
24 con il dito, senza rubare righe all'elenco.

### La lingua si cambia in un posto solo

C'erano due comandi per la stessa cosa, visibili insieme sul computer: la coppia
IT/EN nella barra in alto e la riga «Lingua» in Impostazioni. Resta la seconda,
che è dove chiunque va a cercarla — e dove stava già l'unica copia sul telefono.

### FIAS fra le didattiche dei brevetti

Su richiesta di un istruttore: nel catalogo c'era una sola federazione italiana.
Adesso c'è anche la **Federazione Italiana Attività Subacquee**, con 17 brevetti
— dalla linea ARA (Minisub, Junior, Dodicimetri, Base, ARA, ARA Estensione) alle
specializzazioni, alla linea didattica, alla linea tecnica fino al Trimix 90.

I numeri vengono dalle pagine ufficiali della federazione: **non è un alias di
FIPSAS**, perché le due scale non coincidono — il primo livello autonomo
dichiara 20 metri contro 18, il gradino profondo 40 contro 42.

### E la scheda del brevetto non mostra più due profondità

Scegliendo un corso, sotto la tendina si leggeva *«Primo livello (fino a 18 m) ·
20 m»*: il tipico del livello e quello che dichiara la didattica, uno accanto
all'altro. Due fatti veri che insieme sembrano un errore. Adesso, dove la
didattica il suo numero lo dichiara, il numero è uno solo. Capitava anche a CMAS
e a FIPSAS: si è visto solo mettendo davanti agli occhi una didattica nuova.

### Sotto il cofano

Tre file del progetto contenevano un byte di controllo dentro una stringa, e per
questo `grep` e `git diff` li trattavano come binari: erano invisibili a ogni
ricerca e illeggibili in ogni revisione — fra questi il cuore della deduplica.
Il valore che producono non cambia di un bit: cambia come è scritto.

Corrette anche ventuno date sbagliate di un giorno, sparse fra documenti e
commenti, e tolte due regole di stile che vestivano una funzione che non esiste
più.

Ogni correzione ha una prova, e ogni prova è stata rimessa alla prova rimettendo
il difetto: **2 865 controlli automatici in 179 file**, più **149** sul motore
nativo.

### Impronte SHA-256

Calcolate sui file allegati a questa release, non su una compilazione
precedente: due compilazioni non danno lo stesso byte.

| Pacchetto | SHA-256 | byte |
|---|---|---|
| `MyDiveLog-macOS-arm64.dmg` | `4ccef33701196c75bbb396a9bf70d6265ff6ecc2e8c4aecebb3b260eba945e1b` | 4.531.560 |
| `MyDiveLog-Windows-setup.exe` | `81b4285ae7473356dca3fa66abe0f37004fadcb0509ce53a686d01e6ccd402e6` | 3.263.877 |
| `MyDiveLog-Windows-portatile.exe` | `106b3d9263a0c7b5fa0c133907b800700f96afe63418d358ae5498e962efd5e4` | 7.523.840 |
| `MyDiveLog-Android-arm64.apk` | `450e84fd1ff514b3f33aacccd49a86274299d7a929c9b7762d18f2ecece62fc8` | 11.133.366 |
| `MyDiveLog-Linux-amd64.deb` | `3427db8bd787d8dfeed91aabb1d8846c7b862a10bfabdd100e71cf3e1775dddc` | 3.827.384 |
