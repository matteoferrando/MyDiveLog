#!/usr/bin/env bash
#
# Il pacchetto per il MAC APP STORE. Non è quello del sito.
#
# ═══════════════════════════════════════════════════════════════════════════
# ► DUE PACCHETTI, E NON SI POSSONO SCAMBIARE. ◄
#
#   pubblica-mac.sh          → .dmg, firma Developer ID, senza sandbox,
#                              con l'aggiornamento automatico. Va sul sito.
#   pubblica-mac-negozio.sh  → .pkg, firma 3rd Party Mac Developer, SANDBOXATO,
#                              senza aggiornamento. Va su App Store Connect.
#
# Le differenze non sono di rifinitura: un pacchetto Developer ID viene
# rifiutato dal caricamento, e uno del negozio non parte se lo si scarica da un
# sito (manca il profilo che lo autorizza su quella macchina).
#
# ► COSA FA IN PIÙ RISPETTO ALL'ALTRO ◄
#
#   1. accende `senza-aggiornamenti` (Rust) e `VITE_SENZA_AGGIORNAMENTI`
#      (interfaccia): il plugin dell'aggiornamento non entra nel binario;
#   2. scambia `tauri.conf.json` con una versione senza la configurazione
#      dell'aggiornatore — perché Tauri incorpora la configurazione NEL binario,
#      e un endpoint di aggiornamento dentro un pacchetto del negozio è una
#      domanda in più a cui rispondere;
#   3. firma con gli entitlement della sandbox;
#   4. infila il profilo di provisioning dentro il pacchetto;
#   5. costruisce il `.pkg` con l'altra firma, quella dell'installer.
#
# ► LO SCAMBIO DELLA CONFIGURAZIONE SI RIMETTE A POSTO SEMPRE. ◄ C'è una
# `trap`: se lo script fallisce, se lo si interrompe con Ctrl-C, se il Mac si
# spegne a metà, `tauri.conf.json` torna quello di prima. Un file di
# configurazione lasciato scambiato è il genere di guasto che si scopre tre
# giorni dopo, pubblicando sul sito un pacchetto senza aggiornamenti.
set -euo pipefail

cd "$(dirname "$0")/.."

CONF=src-tauri/tauri.conf.json
SALVA=src-tauri/.tauri.conf.json.prima-del-negozio
APP=src-tauri/target/release/bundle/macos/MyDiveLog.app
FUORI=src-tauri/target/negozio
PROFILO=${PROFILO_NEGOZIO:-src-tauri/MyDiveLog_Mac_App_Store.provisionprofile}

# ── i certificati, controllati PRIMA di compilare per venti minuti ──────────
FIRMA_APP=$(security find-identity -v -p codesigning \
  | grep "3rd Party Mac Developer Application" | head -1 \
  | sed 's/.*"\(.*\)"/\1/' || true)
FIRMA_PKG=$(security find-identity -v \
  | grep "3rd Party Mac Developer Installer" | head -1 \
  | sed 's/.*"\(.*\)"/\1/' || true)

if [ -z "$FIRMA_APP" ] || [ -z "$FIRMA_PKG" ]; then
  cat <<'AIUTO'
FERMO: mancano i certificati per il negozio.

Sul portachiavi ce ne servono DUE, e sono diversi da quello che firma il .dmg:

  · 3rd Party Mac Developer Application  — firma l'applicazione
  · 3rd Party Mac Developer Installer    — firma il .pkg

Si creano su developer.apple.com → Certificates, IDs & Profiles → Certificates,
scegliendo «Mac App Distribution» e «Mac Installer Distribution». Servono una
richiesta di firma generata da Accesso Portachiavi e, una volta scaricati, un
doppio clic per metterli nel portachiavi.

Poi serve anche il profilo di provisioning (Profiles → Mac App Store), scaricato
e messo in:

  src-tauri/MyDiveLog_Mac_App_Store.provisionprofile

Questi passaggi vanno fatti con l'account dello sviluppatore, quindi li fa lui.
AIUTO
  exit 1
fi

if [ ! -f "$PROFILO" ]; then
  echo "FERMO: manca il profilo di provisioning in $PROFILO"
  echo "Si scarica da developer.apple.com → Profiles → Mac App Store."
  exit 1
fi

echo "Firma applicazione: $FIRMA_APP"
echo "Firma installer:    $FIRMA_PKG"

# ── la configurazione senza aggiornatore ───────────────────────────────────
ripristina() {
  if [ -f "$SALVA" ]; then
    mv -f "$SALVA" "$CONF"
    echo "tauri.conf.json rimesso com'era."
  fi
}
trap ripristina EXIT INT TERM

cp "$CONF" "$SALVA"
python3 - "$CONF" <<'PY'
import io, json, sys
p = sys.argv[1]
c = json.load(io.open(p, encoding='utf8'))
# Via l'aggiornatore: la sua configurazione finisce dentro il binario.
c.get('plugins', {}).pop('updater', None)
mac = c['bundle'].setdefault('macOS', {})
mac['entitlements'] = 'Entitlements.negozio.plist'
# Niente .dmg: al negozio si consegna un .pkg, che si costruisce qui sotto.
c['bundle']['targets'] = ['app']
io.open(p, 'w', encoding='utf8').write(json.dumps(c, indent=2, ensure_ascii=False) + '\n')
print('configurazione del negozio scritta: niente updater, entitlement collegati')
PY

# ── compila ────────────────────────────────────────────────────────────────
VITE_SENZA_AGGIORNAMENTI=1 npx tauri build \
  --features senza-aggiornamenti \
  --bundles app

# ── il profilo dentro il pacchetto, e la firma ─────────────────────────────
cp "$PROFILO" "$APP/Contents/embedded.provisionprofile"

# `--deep` è deliberatamente ASSENTE: Apple lo sconsiglia da anni perché firma
# gli eseguibili annidati con gli entitlement sbagliati. Qui non ce ne sono di
# annidati, e se un giorno ce ne fossero andrebbero firmati uno per uno.
codesign --force --options runtime --timestamp \
  --entitlements src-tauri/Entitlements.negozio.plist \
  --sign "$FIRMA_APP" "$APP"

codesign --verify --strict --verbose=2 "$APP"

echo "── entitlement finiti nel pacchetto ──"
codesign -d --entitlements - --xml "$APP" | plutil -p -

# ── il .pkg ────────────────────────────────────────────────────────────────
mkdir -p "$FUORI"
VERSIONE=$(python3 -c "import json,io;print(json.load(io.open('package.json',encoding='utf8'))['version'])")
PKG="$FUORI/MyDiveLog-$VERSIONE-mac-app-store.pkg"
productbuild --component "$APP" /Applications --sign "$FIRMA_PKG" "$PKG"

echo
echo "Fatto."
echo "  $PKG"
echo
echo "Si carica con Transporter, come l'.ipa dell'iPhone."
