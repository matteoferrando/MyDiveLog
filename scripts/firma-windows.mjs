/**
 * Firma il pacchetto Windows e lo aggiunge a `latest.json`, DAL MAC.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTO PASSAGGIO ESISTE, E PERCHÉ NON LO FA GITHUB. ◄
 *
 * L'aggiornamento automatico di Tauri poggia su una firma: l'applicazione porta
 * dentro la metà pubblica della chiave e rifiuta qualunque archivio che non sia
 * firmato con la metà privata. È l'unica ragione per cui aggiornarsi da
 * internet è accettabile — chi si mettesse in mezzo fra l'app e GitHub potrebbe
 * al massimo far fallire il controllo, non far installare un programma suo.
 *
 * Il pacchetto Windows però lo costruisce un runner di GitHub, e la chiave
 * privata **sul runner non ci va**. Metterla lì vorrebbe dire affidare a un
 * segreto di repository la sola cosa che rende sicuri gli aggiornamenti di
 * tutti, compresi quelli del Mac. Un segreto di CI lo legge chi ha accesso al
 * repository, lo legge un'azione compromessa, e non si può revocare senza
 * lasciare a piedi ogni installazione esistente.
 *
 * Quindi: GitHub costruisce, il Mac firma. La chiave resta dove è sempre stata,
 * nel portachiavi di chi pubblica, e non attraversa nessuna rete.
 *
 * ► COSA ASPETTA WINDOWS DENTRO L'ARCHIVIO. ◄ Non l'`.exe` nudo: uno `.zip` che
 * contiene l'installatore. Il plugin scarica lo zip, verifica la firma, lo
 * scompatta e lancia quello che trova dentro. Il nome deve finire in
 * `.nsis.zip`, che è come il plugin riconosce «questo è un aggiornamento per
 * Windows fatto con NSIS».
 *
 * ► COSA NON FA. ◄ Non tocca la voce `darwin-aarch64`: quella l'ha scritta
 * `pubblica-mac.sh` e va lasciata esattamente com'è. Questo script AGGIUNGE una
 * riga a un file che esiste già, e si ferma se non lo trova — perché un
 * `latest.json` con dentro solo Windows farebbe smettere di aggiornarsi a ogni
 * Mac installato, che è un danno silenzioso e diffuso.
 *
 * Uso:
 *   node scripts/firma-windows.mjs percorso/a/MyDiveLog-Windows-setup.exe
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const LATEST = 'src-tauri/target/release/bundle/latest.json';
const CHIAVE = join(process.env.HOME, '.tauri/mydivelog.key');
const NOME_ZIP = 'MyDiveLog-Windows-setup.nsis.zip';

function muori(messaggio) {
  console.error(`\nFERMO: ${messaggio}\n`);
  process.exit(1);
}

const setup = process.argv[2];
if (!setup)
  muori(
    'manca il percorso dell’installatore.\n\n  node scripts/firma-windows.mjs <MyDiveLog-Windows-setup.exe>',
  );
if (!existsSync(setup)) muori(`${setup} non c’è.`);

if (!existsSync(LATEST)) {
  muori(
    `${LATEST} non c’è.\n\n` +
      'Va eseguito DOPO `npm run mac:pubblica`: quello scrive la voce del Mac, e\n' +
      'questo aggiunge quella di Windows accanto. Al contrario si otterrebbe un\n' +
      'latest.json con dentro solo Windows, e ogni Mac installato smetterebbe di\n' +
      'vedere gli aggiornamenti senza dire niente a nessuno.',
  );
}

if (!existsSync(CHIAVE)) muori(`la chiave privata non è in ${CHIAVE}.`);

let parola;
try {
  parola = execFileSync('security', ['find-generic-password', '-s', 'mydivelog-aggiornamenti', '-w'], {
    encoding: 'utf8',
  }).trim();
} catch {
  muori(
    'la password della chiave non è nel portachiavi.\n\n' +
      '  security add-generic-password -a "$USER" -s mydivelog-aggiornamenti -w\n\n' +
      '(non scrive niente a schermo: incolla la password e premi invio)',
  );
}

// --- lo zip -----------------------------------------------------------------
//
// Si zippa in una cartella temporanea e con `-j`, che butta via i percorsi:
// dentro l'archivio deve esserci l'installatore e basta, non una catena di
// cartelle del runner di GitHub che qui non significano niente.
const tmp = mkdtempSync(join(tmpdir(), 'mdl-win-'));
const zip = join(tmp, NOME_ZIP);
execFileSync('zip', ['-j', '-q', zip, resolve(setup)]);

// --- la firma ---------------------------------------------------------------
//
// IL CONTENUTO DELLA CHIAVE, NON IL PERCORSO. `tauri signer sign` prova a
// decodificare come base64 quello che riceve e si ferma con «Invalid symbol 46»
// — il punto di `~/.tauri`, letto come se fosse parte di una chiave. È la stessa
// trappola già pagata in `pubblica-mac.sh`, ed è scritta anche là.
execFileSync('npx', ['tauri', 'signer', 'sign', zip], {
  stdio: 'inherit',
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(CHIAVE, 'utf8'),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: parola,
  },
});

const firma = readFileSync(`${zip}.sig`, 'utf8').trim();
if (!firma) muori('la firma è uscita vuota.');

// --- la voce dentro latest.json ---------------------------------------------
const latest = JSON.parse(readFileSync(LATEST, 'utf8'));
if (!latest.platforms?.['darwin-aarch64']) {
  muori('in latest.json non c’è la voce del Mac: qualcosa è andato storto in mac:pubblica.');
}

latest.platforms['windows-x86_64'] = {
  signature: firma,
  url: `https://github.com/matteoferrando/MyDiveLog/releases/download/v${latest.version}/${NOME_ZIP}`,
};
writeFileSync(LATEST, `${JSON.stringify(latest, null, 2)}\n`);

const accanto = join('src-tauri/target/release/bundle', NOME_ZIP);
copyFileSync(zip, accanto);

console.log(`
Fatto.

  ${accanto}
  ${LATEST}   (adesso con dentro anche windows-x86_64)

Vanno allegati TUTTI E DUE alla release, insieme a ${basename(setup)}.
Senza lo zip firmato, chi ha l'applicazione su un PC vedrà l'aggiornamento,
proverà a installarlo e riceverà un errore di rete: la voce in latest.json
punterebbe a un file che non c'è.
`);
