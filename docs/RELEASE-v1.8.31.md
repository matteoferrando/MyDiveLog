## MyDiveLog 1.8.31 — la schermata dice quello che è arrivato

Una versione piccola, nata da una segnalazione del giorno dopo la 1.8.30.

### Le immersioni arrivate si vedono anche quando lo scarico si interrompe

Un Aqualung i330R aveva portato settantuno immersioni nel logbook prima che il
collegamento cadesse; l’applicazione aveva riprovato da sola, e il tentativo
dopo non si era più collegato. In cima alla schermata c’era scritto «Non è
stata salvata nessuna immersione»: vero per l’ultimo tentativo, falso per lo
scarico. Chi l’ha letto ha creduto di non avere niente, con settantuno
immersioni in archivio.

Adesso, quando un tentativo precedente ha già salvato delle immersioni, la
frase in cima lo dice — *«Il logbook ha ricevuto e salvato 71 immersioni prima
che il collegamento si interrompesse»* — e poi come fare per le altre.

### L’Aqualung i330R è fra i modelli provati

Settantuno immersioni arrivate davvero, da un i330R in uso: sotto il suo nome,
nel selettore, adesso c’è scritto «provato su questo modello».

### Se arrivi dalla 1.8.29

La 1.8.30, uscita ieri, porta il resto: la libreria che legge i computer
aggiornata, dieci modelli Bluetooth nuovi (Perdix 3, Quad 2, Sirius L, Puck Pro
EZ e Ultra, Raffaello, Seac Tablet, OSTC 3, OSTC cR, OSTC Nano), l’i330R che non
si blocca più dopo uno scarico interrotto e chiede da sé il PIN nuovo, le
immersioni lette col modello che il computer dichiara, il ruolo «bailout» col
circuito chiuso. Le sue note stanno nella release
[v1.8.30](https://github.com/matteoferrando/MyDiveLog/releases/tag/v1.8.30).

---

Ogni correzione ha una prova, e ogni prova è stata rimessa alla prova rimettendo
il difetto: **2 977 controlli automatici in 194 file**, più **187** sul motore
nativo. Nessuno saltato.

### Impronte SHA-256

Calcolate sui file allegati a questa release, non su una compilazione
precedente: due compilazioni non danno lo stesso byte.

| Pacchetto | SHA-256 | byte |
|---|---|---|
| `MyDiveLog-macOS-arm64.dmg` | `a518f1066bbd6e9676a8529292065e65a040641299d6a2865644268a1259eab3` | 4.541.351 |
| `MyDiveLog-Windows-setup.exe` | `c5e056321106ad1561e8a82cde39b6d58a78fa1c21022b068542aea67f763959` | 3.269.551 |
| `MyDiveLog-Windows-portatile.exe` | `91cca47808729a555602ff01a306974b8ae9d1fbd95db10c3aeab34dd9129aad` | 7.537.664 |
| `MyDiveLog-Android-arm64.apk` | `a2200aa3854cf98694e656021b0c6d18730f026a377915bfad675d84cb3fc9e3` | 11.148.342 |
| `MyDiveLog-Linux-amd64.deb` | `591b141b1f0d44259c170ad8e67b56c5aea6eab6be74d8bed28dccca5fa08ca4` | 3.834.048 |
