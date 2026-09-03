/**
 * Rigenera i due pacchetti «di terzi» — la cask di Homebrew per il Mac e il
 * PKGBUILD per Arch/Manjaro — con l'impronta presa dal file vero.
 *
 *   node scripts/genera-cask.mjs                 # dalla release pubblicata
 *   node scripts/genera-cask.mjs --dmg <file>    # e confrontata col .dmg locale
 *   node scripts/genera-cask.mjs --deb <file>    # e/o col .deb locale
 *
 * ► PERCHÉ UN GENERATORE SOLO PER DUE FILE. ◄ Sono lo stesso problema due
 * volte: un file che dichiara una versione e un'impronta, dove le due righe
 * possono contraddirsi senza che nessun comando lo dica. Il PKGBUILD è nato il
 * 3 settembre 2026, scritto a mano per installare la 1.7.1 su Manjaro, e ha
 * funzionato al primo colpo; il giorno stesso è passato qui, perché un file
 * scritto a mano che dichiara un'impronta è esattamente la cosa che questo
 * script esiste per non avere.
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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const REPO = 'matteoferrando/MyDiveLog';
const DMG = 'MyDiveLog-macOS-arm64.dmg';
const DEB = 'MyDiveLog-Linux-amd64.deb';

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
function impropriaDaGitHub(asset) {
  const grezzo = execFileSync(
    'gh',
    ['api', `repos/${REPO}/releases/tags/${tag}`, '--jq', `.assets[] | select(.name=="${asset}") | .digest`],
    { encoding: 'utf8' },
  ).trim();
  if (!grezzo) throw new Error(`la release ${tag} non contiene ${asset}`);
  const m = /^sha256:([0-9a-f]{64})$/.exec(grezzo);
  if (!m) throw new Error(`digest inatteso da GitHub per ${asset}: ${grezzo}`);
  return m[1];
}

/**
 * Se c'è un file locale, la sua impronta DEVE essere quella pubblicata: se
 * divergono qualcosa è andato storto nel caricamento, e si pubblicherebbe un
 * pacchetto che punta a un file diverso da quello provato.
 */
function confermaLocale(percorso, impronta, nome) {
  if (!percorso) return;
  const locale = createHash('sha256').update(readFileSync(percorso)).digest('hex');
  if (locale !== impronta) {
    throw new Error(
      `${nome}: il file locale e quello pubblicato NON sono lo stesso file:\n` +
        `  locale     ${locale}\n  pubblicato ${impronta}\n` +
        `Non si pubblica un pacchetto che punta a un file diverso da quello provato.`,
    );
  }
  console.log(`${nome}: impronta confermata su due fonti: ${impronta}`);
}

const impronta = impropriaDaGitHub(DMG);
confermaLocale(valore('--dmg'), impronta, DMG);
const improntaDeb = impropriaDaGitHub(DEB);
confermaLocale(valore('--deb'), improntaDeb, DEB);

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

  url "https://github.com/${REPO}/releases/download/v#{version}/${DMG}",
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

/*
 * ► IL PKGBUILD PER ARCH E DERIVATE. ◄ Manjaro, EndeavourOS e Arch stessa non
 * hanno dpkg: un .deb non si installa. Ma dentro un .deb c'è solo un tar con
 * l'albero di /usr, e makepkg sa travasarlo in un pacchetto di pacman —
 * installabile e disinstallabile come tutti gli altri. Non si ricompila
 * niente: il binario è lo stesso che scarica chi usa Debian.
 *
 * Provato il 3 settembre 2026 su Manjaro, dal proprietario: si installa, si
 * apre, importa, e lo scarico Bluetooth funziona. È la prima volta che
 * MyDiveLog gira su Linux con un computer subacqueo davanti.
 */
const pkgbuild = `# ► FILE GENERATO — non modificarlo a mano. ◄
# Rigeneralo con: npm run cask
#
# Maintainer: Matteo Ferrando
#
# MyDiveLog per Arch e derivate (Manjaro, EndeavourOS…), impacchettando il .deb
# ufficiale della release. Non si ricompila niente: il binario è lo stesso che
# scarica chi usa Debian. L'impronta qui sotto viene dall'API di GitHub, cioè è
# calcolata sul file che GitHub sta davvero servendo — e makepkg si ferma se il
# file scaricato non è quello.
#
# ► PERCHÉ L'INDIRIZZO PORTA LA VERSIONE E NON «latest». ◄ Con «latest», il
# giorno che esce una versione nuova questo file scaricherebbe un pacchetto
# diverso da quello di cui dichiara l'impronta, e makepkg fallirebbe con un
# messaggio che parla di checksum e non di versioni.
#
# Su Linux l'app NON si aggiorna da sola: l'aggiornatore di Tauri funziona con
# l'AppImage, non col .deb, ed è spento apposta. Per aggiornare: rigenerare
# questo file e rilanciare makepkg -si.

pkgname=mydivelog-bin
pkgver=${versione}
pkgrel=1
pkgdesc="Il meglio dei tuoi computer, in un logbook solo"
arch=('x86_64')
url="https://mydivelog.site"
license=('MIT')

# libwebkit2gtk-4.1-0 e libgtk-3-0 del .deb, coi nomi di Arch. Sono le stesse
# librerie che il binario dichiara (objdump -p | grep NEEDED): libwebkit2gtk-4.1,
# libjavascriptcoregtk-4.1, libsoup-3.0 e le GTK 3.
depends=('webkit2gtk-4.1' 'gtk3')
optdepends=('bluez: scarico via Bluetooth dal computer subacqueo (serve anche bluetooth.service acceso)')
provides=('mydivelog')
conflicts=('mydivelog')
options=('!strip')

source=("MyDiveLog-\${pkgver}-Linux-amd64.deb::https://github.com/${REPO}/releases/download/v\${pkgver}/${DEB}")
# makepkg non sa aprire un .deb da solo (è un archivio ar, non un tar): si
# dichiara di non estrarlo e lo si apre a mano in package().
noextract=("MyDiveLog-\${pkgver}-Linux-amd64.deb")
sha256sums=('${improntaDeb}')

package() {
  # Dentro un .deb ci sono tre file: debian-binary, control.tar.gz e data.tar.gz.
  # Il terzo è l'albero che finisce in /usr — usr/bin/mydivelog, il .desktop e
  # le icone — e si travasa in $pkgdir così com'è. bsdtar c'è su ogni Arch,
  # perché pacman stesso dipende da libarchive.
  bsdtar -xf "\${srcdir}/MyDiveLog-\${pkgver}-Linux-amd64.deb" -C "\${srcdir}" data.tar.gz
  bsdtar -xzf "\${srcdir}/data.tar.gz" -C "\${pkgdir}"
}
`;

mkdirSync(`${RADICE}linux`, { recursive: true });
const destinazioneArch = `${RADICE}linux/PKGBUILD`;
writeFileSync(destinazioneArch, pkgbuild);
console.log(`scritto ${destinazioneArch}\n  versione ${versione}, impronta ${improntaDeb.slice(0, 12)}…`);
