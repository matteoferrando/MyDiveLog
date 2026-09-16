/**
 * Dà all'`.ipa` il nome della versione, e prima controlla che sia quella giusta.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ ESISTE. ◄ Xcode esporta sempre `MyDiveLog.ipa`, senza numero. Ogni
 * altro pacchetto di questo progetto il numero ce l'ha —
 * `MyDiveLog_1.8.25_aarch64.dmg`, `MyDiveLog-1.8.25-play.aab`,
 * `MyDiveLog-1.8.25-mac-app-store.pkg` — e l'`.ipa` era l'unico che, una volta
 * uscito dalla sua cartella, non sapeva più dire chi fosse.
 *
 * Non è un problema di ordine. Il caricamento su App Store Connect è a mano, si
 * fa con Transporter, e Transporter mostra il nome del file: *due `.ipa` con lo
 * stesso nome e versioni diverse sono indistinguibili nel momento esatto in cui
 * bisogna sceglierne uno.* Un pacchetto sbagliato caricato in un negozio non si
 * ritira: si pubblica una versione nuova.
 *
 * ► E IL CONTROLLO CHE VIENE PRIMA DEL NOME. ◄
 *
 * `docs/RILASCIO.md` apre con un fatto: il 7 settembre 2026 la catena ha
 * compilato, firmato e notarizzato **una versione vecchia di tre giorni senza
 * dare un solo errore**. Il numero in `package.json` era stato alzato, il
 * pacchetto no.
 *
 * Qui il confronto costa una syscall: il numero che sta DENTRO l'`.ipa`
 * (`CFBundleShortVersionString`, cioè quello che Apple leggerà) contro quello
 * di `package.json`. Se non combaciano lo script si ferma e non rinomina
 * niente, perché un file che si chiama `MyDiveLog-1.8.25.ipa` e dentro dice
 * 1.8.24 è peggio di uno senza numero: il nome sbagliato è una bugia, l'assenza
 * del nome è solo una scomodità.
 *
 * *Il numero che decide dev'essere il numero che si mostra.*
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const ESPORTATO = 'src-tauri/gen/apple/build/arm64/MyDiveLog.ipa';

function muori(messaggio) {
  console.error(`\nFERMO: ${messaggio}\n`);
  process.exit(1);
}

if (!existsSync(ESPORTATO)) {
  muori(
    `${ESPORTATO} non c'è.\n\n` +
      'Va eseguito subito dopo `tauri ios build --export-method app-store-connect`,\n' +
      'ed è già in coda a `npm run ios:negozio`: se sei qui a mano, quella build\n' +
      'non è arrivata in fondo.',
  );
}

const atteso = JSON.parse(readFileSync('package.json', 'utf8')).version;

/*
 * Il numero DENTRO il pacchetto, non accanto.
 *
 * `Info.plist` di un `.ipa` è binario, quindi non si legge con una regex: si
 * estrae il solo file che serve in una cartella temporanea e si chiede a
 * PlistBuddy, che i plist binari li capisce.
 */
const tmp = mkdtempSync(join(tmpdir(), 'mdl-ipa-'));
const elenco = execFileSync('unzip', ['-Z1', ESPORTATO], { encoding: 'utf8' });
const plist = elenco.split('\n').find((r) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(r));
if (!plist) muori(`dentro ${basename(ESPORTATO)} non c'è nessun Payload/*.app/Info.plist.`);

execFileSync('unzip', ['-o', '-q', ESPORTATO, plist, '-d', tmp]);
const dentro = execFileSync(
  '/usr/libexec/PlistBuddy',
  ['-c', 'Print :CFBundleShortVersionString', join(tmp, plist)],
  { encoding: 'utf8' },
).trim();

if (dentro !== atteso) {
  muori(
    `il pacchetto dice ${dentro}, package.json dice ${atteso}.\n\n` +
      'È il difetto del 7 settembre 2026: la catena compila, firma e notarizza\n' +
      'una versione vecchia senza dare un solo errore. Il file NON è stato\n' +
      'rinominato — dargli il nome giusto avrebbe solo nascosto lo scarto.\n\n' +
      'Rifai la build dopo aver alzato il numero nei quattro file.',
  );
}

const nuovo = join(dirname(ESPORTATO), `MyDiveLog-${atteso}.ipa`);
renameSync(ESPORTATO, nuovo);

console.log(`
Pronto, e il numero dentro combacia con package.json (${atteso}).

  ${nuovo}

Si carica con Transporter, e da lì si crea la versione su App Store Connect.
`);
