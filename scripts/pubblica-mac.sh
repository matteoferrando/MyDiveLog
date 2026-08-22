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

echo "→ controllo le credenziali di notarizzazione (profilo «$PROFILO»)"
if ! xcrun notarytool history --keychain-profile "$PROFILO" >/dev/null 2>&1; then
  cat >&2 <<FINE

FERMO: il profilo «$PROFILO» non è nel portachiavi.

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
DMG=$(ls -t src-tauri/target/release/bundle/dmg/*.dmg | head -1)

echo "→ verifico la firma"
codesign --verify --strict --verbose=2 "$APP"
# Senza «runtime» fra i flag, la notarizzazione viene RIFIUTATA — e il rifiuto
# arriva dopo l'invio, cioè dopo aver aspettato. Meglio accorgersene qui.
if ! codesign -d --verbose=2 "$APP" 2>&1 | grep -q 'flags=.*runtime'; then
  echo "FERMO: il pacchetto non ha il runtime irrobustito, la notarizzazione lo rifiuterebbe." >&2
  exit 1
fi

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
