#!/usr/bin/env bash
#
# Costruisce, firma e NOTARIZZA il pacchetto macOS, così che chi lo scarica lo
# apra con un doppio clic invece che con «apri comunque» nascosto nelle
# preferenze di sicurezza.
#
# PERCHÉ SERVE. Fino a ieri l'app esisteva su un Mac solo, compilata sul posto e
# firmata con un certificato di sviluppo — che vale su quel computer e su
# nessun altro. Da un `.dmg` non notarizzato, macOS dice a chi lo apre che
# «l'app è danneggiata o proviene da uno sviluppatore non identificato»: una
# frase che fa cancellare il file, non cercare la scorciatoia.
#
# COSA DEVE ESISTERE PRIMA, e nessuna delle due cose la può creare uno script:
#
#   1. Un certificato «Developer ID Application». Si crea da Xcode: Impostazioni
#      → Account → il proprio ID Apple → Manage Certificates → «+» → Developer
#      ID Application. È diverso da «Apple Development», che serve solo a
#      provare l'app sui propri dispositivi.
#
#   2. Le credenziali per la notarizzazione, salvate nel portachiavi UNA VOLTA:
#
#        xcrun notarytool store-credentials mydivelog \
#          --apple-id LA-TUA-MAIL --team-id IL-TUO-TEAM-ID
#
#      Chiede una password specifica per l'app, che si genera su
#      appleid.apple.com → Accesso e sicurezza → Password per le app. NON è la
#      password del proprio ID Apple, e non va scritta da nessuna parte: la
#      tiene il portachiavi.
#
# Lo script controlla che entrambe ci siano e, se manca qualcosa, lo dice PRIMA
# di compilare per venti minuti.

set -euo pipefail

# NOTA SULLE GRAFFE, che qui non sono pedanteria: il bash di macOS è il 3.2 del
# 2007, e non sa che «»» è un carattere. Scrivendo `$PROFILO»` include quei byte
# NEL NOME della variabile e si ferma con «unbound variable» su una riga che
# sembra innocua. `${PROFILO}»` chiude il nome e toglie il problema.
PROFILO="${PROFILO_NOTARIZZAZIONE:-mydivelog}"
cd "$(dirname "$0")/.."

echo "→ controllo il certificato di distribuzione"
IDENTITA=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)"/\1/' || true)
if [ -z "$IDENTITA" ]; then
  cat >&2 <<'FINE'

FERMO: manca un certificato «Developer ID Application».

Quello installato è «Apple Development», che firma per i propri dispositivi e
non per la distribuzione. Da Xcode: Impostazioni → Account → il tuo ID Apple →
Manage Certificates → «+» → Developer ID Application. Poi rilancia.

FINE
  exit 1
fi
echo "  uso: $IDENTITA"

echo "→ controllo le credenziali di notarizzazione (profilo «${PROFILO}»)"
if ! xcrun notarytool history --keychain-profile "$PROFILO" >/dev/null 2>&1; then
  cat >&2 <<FINE

FERMO: il profilo «${PROFILO}» non è nel portachiavi.

Crealo una volta sola con:

  xcrun notarytool store-credentials $PROFILO --apple-id LA-TUA-MAIL --team-id IL-TUO-TEAM-ID

Serve una password specifica per l'app, da appleid.apple.com → Accesso e
sicurezza → Password per le app.

FINE
  exit 1
fi

# Tauri firma da sé se trova questa variabile: meglio che scrivere l'identità
# dentro `tauri.conf.json`, dove romperebbe la compilazione a chiunque altro.
export APPLE_SIGNING_IDENTITY="$IDENTITA"

echo "→ compilo"
npm run desktop:build

APP="src-tauri/target/release/bundle/macos/MyDiveLog.app"

# --- runtime irrobustito -----------------------------------------------------
#
# TAURI FIRMA, MA SENZA. Il suo bundler applica il certificato e si ferma lì: il
# pacchetto esce con una firma valida e **senza runtime irrobustito**, che è la
# sola cosa che la notarizzazione pretende sempre. Il rifiuto di Apple arriva
# dopo l'invio, cioè dopo aver aspettato — quindi si rifirma qui, prima.
#
# `--options runtime` è il flag; `--timestamp` è l'altro requisito, e serve
# perché la firma resti valida anche dopo la scadenza del certificato.
echo "→ rifirmo con il runtime irrobustito"
codesign --force --deep --options runtime --timestamp --sign "$IDENTITA" "$APP"

echo "→ verifico la firma"
codesign --verify --strict --verbose=2 "$APP"

# LA FIRMA SI LEGGE IN UNA VARIABILE, e non con una pipe dentro un `if`.
#
# `codesign -d ... | grep -q` sembra la cosa ovvia e con `set -o pipefail` è una
# trappola: `grep -q` esce appena trova, chiude la pipe, `codesign` prende un
# SIGPIPE e muore con un codice diverso da zero — e `pipefail` fa fallire tutta
# la catena anche quando il testo cercato c'era. Il primo tentativo si è fermato
# proprio così, dicendo che mancava un flag che era lì.
FIRMA=$(codesign -d --verbose=2 "$APP" 2>&1 || true)
case "$FIRMA" in
  *"(runtime)"*) ;;
  *)
    echo "FERMO: il runtime irrobustito non è stato applicato." >&2
    echo "$FIRMA" >&2
    exit 1
    ;;
esac

# --- il pacchetto ------------------------------------------------------------
#
# COSTRUITO QUI E NON DA TAURI, per una ragione sola: quello di Tauri contiene
# l'applicazione com'era PRIMA della rifirma qui sopra, e dentro un `.dmg`
# compresso non si sostituisce niente. Tanto vale rifarlo, che sono tre comandi:
# una cartella con l'app e il collegamento ad Applications, l'immagine, la firma.
echo "→ costruisco il pacchetto"
VERSIONE=$(node -p "require('./package.json').version")
DMG="src-tauri/target/release/bundle/dmg/MyDiveLog_${VERSIONE}_aarch64.dmg"
SCENA=$(mktemp -d)
cp -R "$APP" "$SCENA/"
# Il collegamento ad Applications: è quello che rende l'installazione un
# trascinamento invece di una spiegazione.
ln -s /Applications "$SCENA/Applications"
rm -f "$DMG"
hdiutil create -volname "MyDiveLog" -srcfolder "$SCENA" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$SCENA"
codesign --force --timestamp --sign "$IDENTITA" "$DMG"

echo "→ mando a notarizzare: $DMG"
# `--wait` resta lì finché Apple non risponde: di solito un paio di minuti, a
# volte molto di più. Senza, lo script finirebbe prima della risposta e
# graffetterebbe un pacchetto non ancora approvato.
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILO" --wait

echo "→ graffetto il risultato al pacchetto"
# La graffetta serve a chi lo apre SENZA rete: senza, macOS deve chiedere ad
# Apple se quel pacchetto è approvato, e offline non può.
xcrun stapler staple "$DMG"

echo "→ prova finale, come la farebbe macOS a chi scarica"
spctl -a -t open --context context:primary-signature -v "$DMG"

echo
echo "Pronto: $DMG"
echo "Da qui si allega a una release su GitHub."
