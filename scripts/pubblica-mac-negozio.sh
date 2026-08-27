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
# ► DUE NOMI PER LA STESSA COSA, e cercarne uno solo era un errore mio. ◄
#
# Il certificato che firma un'applicazione per il Mac App Store si chiama
# "3rd Party Mac Developer Application" se creato con il tipo storico
# («Mac App Distribution»), e "Apple Distribution" se creato con quello
# unificato, che è il tipo che Xcode genera da solo e che vale per iOS e per
# macOS insieme. Sono tutti e due validi e Apple accetta entrambi.
#
# Cercare solo il primo voleva dire mandare qualcuno a rifare un certificato che
# aveva già, per un nome. Si cercano tutti e due, in quest'ordine: se ci sono
# entrambi vince quello specifico per il Mac, che è il più stretto.
FIRMA_APP=$(security find-identity -v -p codesigning \
  | grep -E "3rd Party Mac Developer Application|Apple Distribution" \
  | sort | head -1 | sed 's/.*"\(.*\)"/\1/' || true)
FIRMA_PKG=$(security find-identity -v \
  | grep "3rd Party Mac Developer Installer" | head -1 \
  | sed 's/.*"\(.*\)"/\1/' || true)

if [ -z "$FIRMA_APP" ] || [ -z "$FIRMA_PKG" ]; then
  cat <<'AIUTO'
FERMO: mancano i certificati per il negozio.

Sul portachiavi ce ne servono DUE, e sono diversi da quello che firma il .dmg:

  · per l'APPLICAZIONE, uno qualsiasi dei due:
      "Apple Distribution"                    (tipo unificato, vale anche per iOS)
      "3rd Party Mac Developer Application"   (tipo storico, solo Mac)
  · per il PACCHETTO:
      "3rd Party Mac Developer Installer"     (tipo «Mac Installer Distribution»)

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
# ► E VIA ANCHE GLI ARTEFATTI DELL'AGGIORNAMENTO, o non si compila proprio. ◄
#
# `createUpdaterArtifacts` chiede al bundler di produrre l'archivio firmato che
# l'aggiornatore scarica. Per farlo va a leggere `plugins.updater` — che qui
# sopra è appena stato tolto — e si ferma con «plugins > updater doesn't exist».
#
# Sono due interruttori per la stessa funzione: uno la spegne nel programma,
# l'altro nel confezionamento, e vanno mossi INSIEME. Toccarne uno solo non dà
# un pacchetto sbagliato: non dà nessun pacchetto, e per fortuna — il modo
# peggiore in cui questo poteva andare era un .pkg che si costruiva e portava
# dentro un archivio di aggiornamento che nel negozio non serve a nessuno.
c['bundle']['createUpdaterArtifacts'] = False
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

# ► VIA GLI ATTRIBUTI ESTESI, E VA FATTO QUI: DOPO IL PROFILO, PRIMA DELLA FIRMA. ◄
#
# Il profilo di provisioning si scarica dal portale con un browser, e macOS marca
# tutto quello che arriva dalla rete con `com.apple.quarantine`. `cp` conserva
# gli attributi estesi, quindi quel marchio entra dritto dentro il pacchetto — e
# App Store Connect lo rifiuta: «The package contains one or more files with the
# com.apple.quarantine extended file attribute».
#
# ► QUANTO COSTA SCOPRIRLO TARDI. ◄ Non è un errore di caricamento: il
# caricamento RIESCE, il file arriva, e il rifiuto compare dopo, durante
# l'elaborazione, come notifica separata. Cioè nel momento in cui uno ha già
# archiviato la cosa come fatta.
#
# `-c` toglie tutti gli attributi, non solo la quarantena: dentro un pacchetto
# firmato non deve viaggiare niente che il sistema abbia appiccicato di suo —
# `kMDItemWhereFroms` dice da quale indirizzo del portale è stato scaricato il
# profilo, e non è un'informazione che vada consegnata ad Apple insieme all'app.
#
# PRIMA DELLA FIRMA, sempre: `xattr` modifica i file, e farlo dopo
# invaliderebbe la firma appena apposta.
xattr -cr "$APP"

# `--deep` è deliberatamente ASSENTE: Apple lo sconsiglia da anni perché firma
# gli eseguibili annidati con gli entitlement sbagliati. Qui non ce ne sono di
# annidati, e se un giorno ce ne fossero andrebbero firmati uno per uno.
codesign --force --options runtime --timestamp \
  --entitlements src-tauri/Entitlements.negozio.plist \
  --sign "$FIRMA_APP" "$APP"

codesign --verify --strict --verbose=2 "$APP"

echo "── entitlement finiti nel pacchetto ──"
codesign -d --entitlements - --xml "$APP" | plutil -p -

# ► IL CONTROLLO CHE MANCAVA, E CHE È COSTATO UNA COMPILAZIONE. ◄
#
# `com.apple.application-identifier` dell'applicazione deve combaciare con
# quello del profilo di provisioning. Se non combacia, la firma riesce lo
# stesso: il guasto compare DOPO, al caricamento, come «Invalid Code Signing
# Entitlements» — a venti minuti di compilazione di distanza, e senza dire quale
# voce sia sbagliata.
#
# Le due voci le mette Xcode da solo. Qui si firma a mano, quindi qui si
# controllano: costa un secondo e prende l'unico errore che questo script
# potrebbe produrre in silenzio.
security cms -D -i "$APP/Contents/embedded.provisionprofile" > /tmp/mdl-profilo.plist
ID_PROFILO=$(plutil -extract 'Entitlements.com\.apple\.application-identifier' raw /tmp/mdl-profilo.plist)
ID_APP=$(codesign -d --entitlements - --xml "$APP" 2>/dev/null \
  | plutil -extract 'com\.apple\.application-identifier' raw - 2>/dev/null || true)
rm -f /tmp/mdl-profilo.plist

if [ "$ID_APP" != "$ID_PROFILO" ]; then
  echo
  echo "FERMO: l'identificativo dell'applicazione non combacia con il profilo."
  echo "  nell'applicazione: ${ID_APP:-(assente)}"
  echo "  nel profilo:       $ID_PROFILO"
  echo
  echo "Va corretto in src-tauri/Entitlements.negozio.plist, chiave"
  echo "com.apple.application-identifier. Il .pkg NON è stato costruito:"
  echo "caricarlo avrebbe dato «Invalid Code Signing Entitlements»."
  exit 1
fi
echo "identificativo: $ID_APP — combacia con il profilo"

# ► E SI CONTROLLA CHE NON NE SIA RIMASTO NESSUNO. ◄
#
# Toglierli e non verificare sarebbe fidarsi: basta che un file venga toccato
# fra il `xattr -cr` e qui — o che un domani qualcuno sposti quella riga — e il
# rifiuto torna, con lo stesso ritardo di prima. Costa un decimo di secondo.
SPORCHI=$(xattr -r "$APP" 2>/dev/null | grep -c "com.apple.quarantine" || true)
if [ "$SPORCHI" != "0" ]; then
  echo
  echo "FERMO: $SPORCHI file portano ancora com.apple.quarantine."
  echo "App Store Connect li rifiuta DOPO il caricamento, in fase di elaborazione."
  xattr -r "$APP" | grep "com.apple.quarantine" | head -5
  exit 1
fi
echo "attributi estesi: nessuna quarantena nel pacchetto"

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
