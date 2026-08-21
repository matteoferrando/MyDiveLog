/**
 * Toglie `libapp.a` dalle risorse del progetto Xcode generato.
 *
 * IL DIFETTO, che è di Tauri e non nostro. Il progetto iOS lo genera XcodeGen da
 * un template di `cargo-mobile2`, e fra le sorgenti del bersaglio c'è la cartella
 * `Externals`, dove il comando `tauri ios xcode-script` deposita la libreria
 * statica di Rust: `Externals/arm64/release/libapp.a` e la gemella x86_64.
 * XcodeGen non sa che farsene di un file `.a` fra le sorgenti — non è codice da
 * compilare — e lo mette dove mette tutto ciò che non riconosce: in «Copy Bundle
 * Resources».
 *
 * Le conseguenze sono due, e la seconda è arrivata dopo la prima.
 *
 * 1. L'APP PESA MEZZO GIGA. La libreria viene COPIATA dentro il pacchetto, oltre
 *    a essere linkata dentro l'eseguibile. Misurato su questo progetto:
 *    eseguibile 6,3 MB, `libapp.a` 477 MB, pacchetto installato ~470 MB per
 *    un'applicazione che ne vale dieci. Su un telefono è spazio rubato, e ogni
 *    reinstallazione trasferisce cento megabyte di niente.
 *
 * 2. LA BUILD SI FERMA. Quando in `Externals` ci sono ENTRAMBE le architetture —
 *    e ci finiscono appena si è compilato una volta per il simulatore e una per
 *    il telefono — le due copie hanno lo stesso nome di destinazione, e Xcode si
 *    rifiuta: `Multiple commands produce .../MyDiveLog.app/libapp.a`. È un
 *    errore che compare all'improvviso, senza che si sia toccato niente di
 *    proprio, subito dopo un `tauri ios init`.
 *
 * PERCHÉ QUI E NON NEL TEMPLATE. Si potrebbe prendere in gestione il template
 * XcodeGen di Tauri (`bundle.iOS.template` in `tauri.conf.json`) e marcare
 * `Externals` come `buildPhase: none`, che è la soluzione pulita. Il prezzo è
 * possedere per sempre una copia di un file che Tauri aggiorna a ogni versione,
 * perdendone le correzioni in silenzio. Questo script invece non forka niente:
 * toglie UNA voce da un file generato, subito dopo che è stato generato, e se un
 * giorno Tauri risolve il problema all'origine questo diventa un'operazione a
 * vuoto che si accorge da sé di non avere niente da fare.
 *
 * Il collegamento della libreria NON passa da qui: avviene tramite
 * `LIBRARY_SEARCH_PATHS` e la dipendenza dichiarata nel bersaglio. Togliere la
 * copia fra le risorse non toglie il codice dall'app — l'eseguibile contiene
 * già tutto.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const PROGETTO = 'src-tauri/gen/apple/mydivelog.xcodeproj/project.pbxproj';

let testo;
try {
  testo = readFileSync(PROGETTO, 'utf8');
} catch {
  // Il progetto non c'è ancora: non è un errore, è il caso di chi non ha mai
  // lanciato `tauri ios init`. Uscire in silenzio è giusto, fallire no.
  console.log('progetto iOS assente, niente da pulire');
  process.exit(0);
}

/*
 * Due tagli, e vanno fatti entrambi.
 *
 * Un `.pbxproj` nomina ogni file due volte: una dichiarazione `PBXBuildFile` che
 * lega il file a una fase, e un riferimento a quella dichiarazione dentro
 * l'elenco della fase. Togliere solo l'elenco lascia una dichiarazione orfana,
 * che Xcode segnala; togliere solo la dichiarazione rompe il file.
 */
const prima = testo.length;
const righeTolte = [];

testo = testo
  .split('\n')
  .filter((riga) => {
    if (!/libapp\.a in Resources/.test(riga)) return true;
    righeTolte.push(riga.trim());
    return false;
  })
  .join('\n');

if (righeTolte.length === 0) {
  console.log('libapp.a non è fra le risorse: niente da fare');
  process.exit(0);
}

writeFileSync(PROGETTO, testo);
console.log(
  `tolte ${righeTolte.length} righe che copiavano libapp.a nel pacchetto ` + `(${prima - testo.length} byte)`,
);
