# 1.8.31 — la schermata dice quello che è arrivato

*Il 24 settembre 2026, su una segnalazione del 23. La 1.8.30 era uscita su GitHub
e sul sito il mattino stesso, e nei negozi non ancora: nei negozi va questa al
posto di quella, con una revisione sola.*

## 1 — La frase in cima racconta la sessione, non l'ultimo tentativo

**Il fatto.** Da chi aveva un Aqualung i330R in mano, con la 1.8.29 su un
iPhone: *«nonostante i messaggi di errore ha caricato le immersioni»*. Le
schermate: in cima, «Lo scarico si è interrotto. Non è stata salvata nessuna
immersione.» con il dettaglio *«collegamento non riuscito dopo 3 tentativi»*;
sotto, il riquadro «Il computer ha più immersioni di quante ne siano arrivate.
Lo scarico si è interrotto dopo 71 immersioni.»

**La lettura.** Un tentativo aveva portato in archivio settantuno immersioni ed
era caduto; l'applicazione aveva riprovato da sola, e il tentativo dopo non si
era più collegato. La frase in cima si calcolava su `dives.length` del giro
corrente — zero — mentre il riquadro sotto leggeva il punto raggiunto, che si
porta avanti fra i tentativi. *Due parti della stessa schermata con due storie
diverse: la prima la legge chiunque, la seconda quasi nessuno.* Chi l'ha letta
ha creduto di non avere niente, con settantuno immersioni nel logbook.

**Adesso.** `src/core/ble/immersioniGiaSalvate.ts`, una regola pura: quando il
tentativo corrente non porta niente e uno precedente della stessa sessione ha
salvato, la frase in cima dice *«Il logbook ha ricevuto e salvato 71 immersioni
prima che il collegamento si interrompesse. Se il computer ne ha altre,
spegnilo e riaccendilo, avvicinalo e riprova.»*, col dettaglio tecnico fra
parentesi come prima.

**Le salvate, non le arrivate.** Il punto raggiunto contava le arrivate
(`quante`); la frase promette le salvate, e col disco pieno le due cose si
separano. Per questo `PuntoRaggiunto` porta un campo nuovo, `salvateQuante`, il
massimo delle immersioni scritte in archivio da un tentativo.

**Le prove** (`tests/immersioniGiaSalvate.test.ts`): la regola su quattro casi, e
il cablaggio nella schermata. Tre mutazioni, tre rosse: la regola calcolata e
poi non usata, la regola che non nomina mai niente, le arrivate contate come
salvate.

## 2 — L'Aqualung i330R fra i provati

Settantuno immersioni arrivate da un apparecchio vero: l'i330R entra in
`src/core/ble/provati.ts` con la data del 23 settembre, e il selettore scrive
«provato su questo modello» sotto il suo nome. **Un modello, non la famiglia**:
l'i330R Console e l'Apeks DSX, che parlano lo stesso protocollo, restano fuori, e
`provatiSulCampo.test.ts` adesso lo dice per nome.

## Quello che non è verificato, detto

- **Perché il trasferimento si è interrotto dopo 71.** Il diario di quella
  mattina (58 righe) non era allegato: è chiesto.
- **Il ricollegamento dopo un'interruzione**, che non riesce per la terza volta
  (16, 22 e 23 settembre): tre «Timeout during execution of Connect». Sembra che
  l'i330R esca dal Bluetooth quando il collegamento cade; la frase nuova, per
  questo, dice di spegnerlo e riaccenderlo.
