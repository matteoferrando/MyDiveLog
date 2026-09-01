# ► FILE GENERATO — non modificarlo a mano. ◄
# Rigeneralo con: npm run cask
#
# L'impronta qui sotto viene dall'API di GitHub, cioè è calcolata sul file che
# GitHub sta davvero servendo. Scritta a mano, prima o poi resta quella della
# versione precedente: due righe che si contraddicono, e se ne accorge chi prova
# a installare.

cask "mydivelog" do
  version "1.7.1"
  sha256 "14aa0d1691c611c33fcaa9af49d7027c2103ce1c3438d8de5bce00f470eefa2c"

  url "https://github.com/matteoferrando/MyDiveLog/releases/download/v#{version}/MyDiveLog-macOS-arm64.dmg",
      verified: "github.com/matteoferrando/MyDiveLog/"
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

  # ► ATTENZIONE: qui dentro c'è il logbook. ◄ `brew uninstall --zap` cancella
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
