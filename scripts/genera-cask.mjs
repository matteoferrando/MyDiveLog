/**
 * Rigenera la cask di Homebrew, con l'impronta presa dal file vero.
 *
 *   node scripts/genera-cask.mjs                 # dalla release pubblicata
 *   node scripts/genera-cask.mjs --dmg <file>    # e confrontata col file locale
 *
 * ► PERCHÉ NON SI SCRIVE A MANO. ◄ Una cask dichiara un `sha256`. Se quel numero
 * non è quello del file, `brew install` si ferma con «checksum mismatch» — e la
 * cosa la scopre chi prova a installare, non chi ha pubblicato. Aggiornare una
 * versione a mano vuol dire, prima o poi, cambiare il numero di versione e
 * lasciare l'impronta di quella prima: due righe che si contraddicono, e nessun
 * comando che lo dica.
 *
 * ► DA DOVE VIENE L'IMPRONTA. ◄ Dall'API di GitHub, cioè calcolata da GitHub sul
 * file che sta servendo — non su quello che è stato costruito qui. È una
 * differenza che conta: quello che la gente scarica è il primo, e una cask che
 * descrive il secondo sarebbe giusta rispetto a un file che nessuno riceve.
 *
 * Con `--dmg` si calcola ANCHE l'impronta del file locale e si pretende che
 * combacino. Se divergono qualcosa è andato storto nel caricamento, e questo
 * script si ferma invece di pubblicare una cask che punta a un file diverso da
 * quello provato.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const REPO = 'matteoferrando/MyDiveLog';
const ASSET = 'MyDiveLog-macOS-arm64.dmg';

const argomenti = process.argv.slice(2);
const valore = (nome) => {
  const i = argomenti.indexOf(nome);
  return i >= 0 ? argomenti[i + 1] : undefined;
};

const versione = (
  valore('--versione') ?? JSON.parse(readFileSync(`${RADICE}/package.json`, 'utf8')).version
).replace(/^v/, '');
const tag = `v${versione}`;

/**
 * Il digest pubblicato da GitHub per quell'asset. Non si scarica il file: è
 * GitHub a dichiarare l'impronta di quello che serve, ed è quella che deve
 * finire nella cask.
 */
function impropriaDaGitHub() {
  const grezzo = execFileSync(
    'gh',
    ['api', `repos/${REPO}/releases/tags/${tag}`, '--jq', `.assets[] | select(.name=="${ASSET}") | .digest`],
    { encoding: 'utf8' },
  ).trim();
  if (!grezzo) throw new Error(`la release ${tag} non contiene ${ASSET}`);
  const m = /^sha256:([0-9a-f]{64})$/.exec(grezzo);
  if (!m) throw new Error(`digest inatteso da GitHub: ${grezzo}`);
  return m[1];
}

const impronta = impropriaDaGitHub();

const dmg = valore('--dmg');
if (dmg) {
  const locale = createHash('sha256').update(readFileSync(dmg)).digest('hex');
  if (locale !== impronta) {
    throw new Error(
      `il file locale e quello pubblicato NON sono lo stesso file:\n` +
        `  locale     ${locale}\n  pubblicato ${impronta}\n` +
        `Non si pubblica una cask che punta a un file diverso da quello provato.`,
    );
  }
  console.log(`impronta confermata su due fonti: ${impronta}`);
}

const cask = `# ► FILE GENERATO — non modificarlo a mano. ◄
# Rigeneralo con: npm run cask
#
# L'impronta qui sotto viene dall'API di GitHub, cioè è calcolata sul file che
# GitHub sta davvero servendo. Scritta a mano, prima o poi resta quella della
# versione precedente: due righe che si contraddicono, e se ne accorge chi prova
# a installare.

cask "mydivelog" do
  version "${versione}"
  sha256 "${impronta}"

  url "https://github.com/${REPO}/releases/download/v#{version}/${ASSET}",
      verified: "github.com/${REPO}/"
  name "MyDiveLog"
  desc "Dive logbook that merges the data from several dive computers"
  homepage "https://mydivelog.site/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # L'app si aggiorna da sola con l'updater di Tauri. Dichiararlo non è una
  # formalità: senza, brew e l'applicazione si aggiornerebbero a vicenda e la
  # versione che brew crede installata smetterebbe di essere quella vera.
  auto_updates true

  # Il pacchetto è solo arm64 e vuole macOS 12. Sono gli stessi due limiti che
  # il sito scrive PRIMA del pulsante: su un Mac Intel il .dmg si installa e
  # l'app non si apre, e scoprirlo dopo somiglia a un difetto di chi ha
  # scaricato.
  # Il simbolo nudo e non la stringa: la forma con ">=" e' deprecata, e brew la
  # segnala a ogni comando che legge la cask. In Homebrew un simbolo nudo vuole
  # gia' dire «quella versione o piu' recente». L'ha trovata brew stesso alla
  # prima lettura, non una prova di testo: e' il motivo per cui una cask va
  # fatta leggere a brew prima di pubblicarla.
  depends_on arch: :arm64
  depends_on macos: :monterey

  app "MyDiveLog.app"

  # ► ATTENZIONE: qui dentro c'è il logbook. ◄ \`brew uninstall --zap\` cancella
  # anche l'archivio SQLite con tutte le immersioni. È il significato di zap e
  # va bene che sia così — ma vale la pena che sia scritto, perché un logbook
  # perso non si ricostruisce da un backup che nessuno ha fatto.
  #
  # I primi due percorsi sono stati MISURATI su un Mac con l'app installata; gli
  # altri sono i posti canonici di macOS, che possono non esistere.
  zap trash: [
    "~/Library/Application Support/it.ferrando.mydivelog",
    "~/Library/WebKit/it.ferrando.mydivelog",
    "~/Library/Caches/it.ferrando.mydivelog",
    "~/Library/Preferences/it.ferrando.mydivelog.plist",
    "~/Library/Saved Application State/it.ferrando.mydivelog.savedState",
  ]
end
`;

const destinazione = `${RADICE}homebrew/mydivelog.rb`;
writeFileSync(destinazione, cask);
console.log(`scritta ${destinazione}\n  versione ${versione}, impronta ${impronta.slice(0, 12)}…`);
