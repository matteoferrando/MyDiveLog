/**
 * Scrive `latest.json`, il file che l'applicazione interroga per sapere se
 * esiste una versione nuova.
 *
 * ► COM'È FATTO IL GIRO. ◄ L'app chiede
 * `releases/latest/download/latest.json` — lo stesso indirizzo dal nome stabile
 * che usa il pulsante del sito per il `.dmg` — e dentro trova tre cose: quale
 * versione c'è, dove sta l'archivio, e la FIRMA di quell'archivio. Poi scarica,
 * verifica la firma con la chiave pubblica che ha dentro, e solo allora
 * installa. Senza la firma giusta non installa niente: è quello che rende
 * accettabile un programma che si sostituisce da solo.
 *
 * ► DUE COSE CHE SI DIMENTICANO, e rompono l'aggiornamento in silenzio. ◄
 *
 * 1. La `version` qui dentro dev'essere **maggiore** di quella installata,
 *    confrontata come numero e non come testo. Se si pubblica una release
 *    senza aggiornare il numero in `tauri.conf.json`, chi ha già l'app non
 *    vedrà mai l'aggiornamento e nessuno se ne accorgerà.
 * 2. L'indirizzo dell'archivio punta al TAG di questa versione, non a
 *    `latest`: `latest` è un rimando che cambia, e un archivio scaricato da un
 *    rimando può non essere quello che la firma qui accanto descrive.
 *
 * La firma NON è un segreto: è la prova che l'archivio viene da chi ha la
 * chiave privata, e va letta da chiunque. La chiave privata, quella, non entra
 * mai in questo file né nel repository.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const CONF = 'src-tauri/tauri.conf.json';
const ARCHIVIO = 'src-tauri/target/release/bundle/macos/MyDiveLog.app.tar.gz';
const DESTINAZIONE = 'src-tauri/target/release/bundle/latest.json';
const DEPOSITO = 'https://github.com/matteoferrando/MyDiveLog/releases/download';

/** Le note della versione, se qualcuno le ha scritte in un file. */
function note(percorso) {
  if (!percorso) return '';
  try {
    return readFileSync(percorso, 'utf8').trim();
  } catch {
    return '';
  }
}

const versione = JSON.parse(readFileSync(CONF, 'utf8')).version;
if (!versione) throw new Error(`nessuna versione in ${CONF}`);

let firma;
try {
  firma = readFileSync(`${ARCHIVIO}.sig`, 'utf8').trim();
} catch {
  throw new Error(
    `manca la firma ${ARCHIVIO}.sig — l'archivio dell'aggiornamento si costruisce con \`npm run mac:pubblica\``,
  );
}

/*
 * `darwin-aarch64` e nient'altro: il pacchetto è per Mac Apple Silicon, e
 * dichiarare una piattaforma che non forniamo farebbe scaricare a un Mac Intel
 * un archivio che non può eseguire. Il giorno che si compila anche per x86_64,
 * qui si aggiunge una riga — non prima.
 */
const manifesto = {
  version: versione,
  notes: note(process.argv[2]),
  // Passata da fuori quando serve riproducibilità; altrimenti adesso.
  pub_date: process.env.DATA_PUBBLICAZIONE ?? new Date().toISOString(),
  platforms: {
    'darwin-aarch64': {
      signature: firma,
      url: `${DEPOSITO}/v${versione}/MyDiveLog.app.tar.gz`,
    },
  },
};

writeFileSync(DESTINAZIONE, JSON.stringify(manifesto, null, 2) + '\n');
console.log(`scritto ${DESTINAZIONE} per la versione ${versione}`);
