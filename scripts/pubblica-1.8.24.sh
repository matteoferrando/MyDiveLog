#!/usr/bin/env bash
#
# LA 1.8.24, DAL MAC. Non si lancia tutto insieme: si legge un passo alla volta.
#
#   bash pubblica-1.8.24.sh 0     # applica il fagotto e controlla il numero
#   bash pubblica-1.8.24.sh 1     # la catena verde
#   ...
#
# Ogni passo si FERMA se il controllo che lo chiude non torna. È il motivo per
# cui esiste: il 7 settembre la catena ha compilato, firmato e notarizzato una
# versione vecchia di tre giorni senza dare un errore.
set -euo pipefail

REPO=~/Documents/Claude/Projects/MyDiveLog/mydivelog
VERSIONE=1.8.24
COMMIT=6e2a2c0
FAGOTTO=${FAGOTTO:-~/Downloads/mydivelog-1.8.24.bundle}
CONSEGNA=${CONSEGNA:-/tmp/consegna-$VERSIONE}

cd "$REPO"

passo0() {
  # ► IL PASSO CHE NON SI SALTA. Senza, tutto il resto compila la versione
  #   sbagliata senza dire niente.
  test -z "$(git status --short)" || { echo "albero sporco: fermati e guarda"; exit 1; }
  git fetch "$FAGOTTO" HEAD
  git merge --ff-only FETCH_HEAD
  grep -m1 '"version"' package.json | grep -q "$VERSIONE" || { echo "il numero non è $VERSIONE"; exit 1; }
  git rev-parse --short HEAD | grep -q "$COMMIT" || { echo "il commit non è $COMMIT"; exit 1; }
  echo "✓ $VERSIONE su $COMMIT"
}

passo1() {
  npx tsc --noEmit && npx eslint . && npx vitest run && npx prettier --check .
  echo "✓ catena verde"
}

passo2() {
  # ► IL PUSH VIENE PRIMA: il workflow gira su quello che sta su GitHub.
  #   Dalla sessione in cloud è negato dal proxy, quindi questo passo è tuo.
  git push origin main
  npm run mac:pubblica &
  gh workflow run altre-piattaforme.yml -f versione="$VERSIONE" &
  wait
  echo "✓ Mac fatto, workflow lanciato"
  echo "  nel log di Android: «Come si è firmato» = chiave del proprietario,"
  echo "  e «Il pacchetto è davvero firmato?» = firmati: 1 apk, 1 aab"
}

passo3() {
  # Gli artefatti di Windows, Android e Linux. L'id del run lo dà `gh run list`.
  local ID=${1:?serve l'id del run: gh run list --workflow=altre-piattaforme.yml}
  mkdir -p "$CONSEGNA"
  gh run download "$ID" -D "$CONSEGNA"
  find "$CONSEGNA" -type f | sort
}

passo4() {
  # ► LA COPIA COL NOME STABILE NON LA FA NESSUNO SCRIPT, e senza di lei il
  #   pulsante «Scarica per Mac» del sito risponde 404 a tutti nell'istante in
  #   cui la release nuova diventa `latest`.
  local DMG
  DMG=$(find src-tauri/target -name "MyDiveLog_${VERSIONE}_aarch64.dmg" | head -1)
  test -n "$DMG" || { echo "il .dmg col numero non c'è: hai lanciato mac:pubblica?"; exit 1; }
  cp "$DMG" "$CONSEGNA/MyDiveLog-macOS-arm64.dmg"
  cp "$DMG" "$CONSEGNA/MyDiveLog_${VERSIONE}_aarch64.dmg"
  echo "✓ le due copie del Mac"
  # Le impronte, da incollare nelle note prima di creare la release.
  ( cd "$CONSEGNA" && shasum -a 256 \
      MyDiveLog-macOS-arm64.dmg MyDiveLog-Windows-setup.exe \
      MyDiveLog-Windows-portatile.exe MyDiveLog-Android-arm64.apk \
      MyDiveLog-Linux-amd64.deb )
}

passo5() {
  # ► LA RELEASE SI PUBBLICA INTERA, O NON SI PUBBLICA. I quattro pulsanti del
  #   sito puntano a releases/latest: un allegato mancante è un 404 pubblico.
  cd "$CONSEGNA"
  local ATTESI=(
    MyDiveLog-macOS-arm64.dmg "MyDiveLog_${VERSIONE}_aarch64.dmg"
    MyDiveLog.app.tar.gz latest.json
    MyDiveLog-Windows-setup.exe MyDiveLog-Windows-portatile.exe
    MyDiveLog-Windows-setup.nsis.zip MyDiveLog-Android-arm64.apk
    MyDiveLog-Linux-amd64.deb
  )
  for f in "${ATTESI[@]}"; do test -f "$f" || { echo "MANCA $f — non creare niente"; exit 1; }; done
  gh release create "v$VERSIONE" --title "MyDiveLog $VERSIONE" \
    --notes-file ~/Downloads/release-v1.8.24.md "${ATTESI[@]}"
  # Contare è il punto: «li ho allegati tutti» è un ricordo, nove righe è un fatto.
  local N
  N=$(gh release view "v$VERSIONE" --json assets -q '.assets|length')
  test "$N" = "9" || { echo "allegati: $N invece di 9"; exit 1; }
  echo "✓ release v$VERSIONE con nove allegati"
}

passo6() {
  # Il sito: solo se le immagini della 1.8.23 non sono mai state pubblicate.
  # I pulsanti puntano a releases/latest e seguono la release nuova da soli.
  npx wrangler pages deploy sito --project-name mydivelog-sito
}

passo7() {
  # ► UN 200 NON DICE «LA PAGINA C'È»: Cloudflare Pages serve la home con 200
  #   quando una pagina non esiste. Si guarda la cosa consegnata.
  for NOME in MyDiveLog-macOS-arm64.dmg MyDiveLog-Windows-setup.exe \
              MyDiveLog-Android-arm64.apk MyDiveLog-Linux-amd64.deb; do
    printf '%-34s ' "$NOME"
    curl -sIL "https://github.com/matteoferrando/MyDiveLog/releases/latest/download/$NOME" \
      | grep -i '^content-length' | tail -1
  done
  echo "e l'App Store, che si rilancia invece di ricordarlo:"
  curl -s "https://itunes.apple.com/lookup?id=6804439480&country=it&t=$(date +%s)" \
    | python3 -c "import sys,json;r=json.load(sys.stdin)['results'][0];print(' ',r['version'],r['currentVersionReleaseDate'])"
}

"passo${1:?dimmi quale passo: 0 1 2 3 4 5 6 7}" "${@:2}"
