#!/usr/bin/env bash
#
# Salva il lavoro: aggiunge tutto, fa un commit e lo manda su GitHub.
#
# Esiste perché il ponte con cui Claude scrive i file su questo Mac non può
# cancellare niente, e git ha bisogno di cancellare il proprio file di lock a
# ogni comando: i commit li deve fare una persona da un terminale vero. Questo
# script è quel terminale ridotto a una riga.
#
#   ./salva.sh "sistemata la tabella delle pressioni"
#
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -eq 0 ]; then
  echo "Uso: ./salva.sh \"messaggio del commit\"" >&2
  exit 1
fi

# I lock e i file temporanei rimasti indietro dalle scritture di Claude.
#
# Il ponte con cui Claude scrive su questo disco non ha il permesso di
# CANCELLARE: git crea `index.lock`, `HEAD.lock` e un file temporaneo per ogni
# oggetto, poi prova a rimuoverli e non ci riesce. Restano lì, e il comando git
# successivo si ferma con «Another git process seems to be running». Non è un
# repository corrotto — sono solo rifiuti — ma vanno tolti prima di ogni cosa.
rm -f .git/*.lock
find .git/refs -name '*.lock' -delete 2>/dev/null || true
rm -f .git/objects/*/tmp_obj_* 2>/dev/null || true

git add -A
if git diff --cached --quiet; then
  echo "Niente da salvare: l'albero è già pulito."
  exit 0
fi

git commit -m "$1"
git push
echo
echo "Fatto. Storia:"
git log --oneline -5
