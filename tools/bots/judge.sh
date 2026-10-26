#!/usr/bin/env bash
# Le juge : quatre epreuves, un verdict. exit 0 si tout passe, 1 sinon.
#
#   bash tools/bots/judge.sh
#
# Variables acceptees : CHAMP (poids juges, defaut weights/champion.json), BASE (legacy), GAMES (200),
# DECISIONS (1000), LADDER_GAMES (80), SLIDER_GAMES (120 : a 40 l'ecart de malice est dans le bruit),
# SEED (judge-AAAAMMJJ), WORKERS, OUT.

set -uo pipefail
cd "$(dirname "$0")"

CHAMP="${CHAMP:-weights/champion.json}"
# Reference du duel : `legacy` = le bot d'avant la mission (poids d'origine ET sans garde-fou).
# `default` = poids d'origine mais AVEC le garde-fou, si on veut isoler l'apport des seuls poids.
BASE="${BASE:-legacy}"
GAMES="${GAMES:-200}"
DECISIONS="${DECISIONS:-1000}"
LADDER_GAMES="${LADDER_GAMES:-80}"
SLIDER_GAMES="${SLIDER_GAMES:-120}"
SEED="${SEED:-judge-$(date +%Y%m%d)}"
OUT="${OUT:-dist/judge}"
WORKERS_ARG=""
if [ -n "${WORKERS:-}" ]; then WORKERS_ARG="--workers $WORKERS"; fi

RESULTS=()
FAILED=0

get() { # get <fichier.json> <chemin.pointe>
  node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));let v=d;for(const k of process.argv[2].split("."))v=v==null?v:v[k];process.stdout.write(String(v));' "$1" "$2"
}
ge() { # ge <a> <b> -> "1" si a >= b
  node -e 'process.stdout.write(Number(process.argv[1])>=Number(process.argv[2])?"1":"0");' "$1" "$2"
}
record() { # record <nom> <PASS|FAIL> <detail>
  RESULTS+=("$2 $1 — $3")
  if [ "$2" != "PASS" ]; then FAILED=1; fi
}

if [ ! -f "$CHAMP" ]; then
  echo "poids introuvables : $CHAMP" >&2
  echo "  (entrainer d'abord, ou pointer CHAMP=... sur un fichier de poids)" >&2
  exit 1
fi

echo "== construction ==" >&2
node build.mjs || exit 1
mkdir -p "$OUT"
echo "== juge $CHAMP, graine $SEED ==" >&2

# --- 1. duel contre les poids d'origine ------------------------------------------------------
echo >&2
if node dist/arena.mjs duel --a "$CHAMP" --b "$BASE" --games "$GAMES" --seed "$SEED" $WORKERS_ARG > "$OUT/duel.json"; then
  SHARE=$(get "$OUT/duel.json" shareA)
  WINS=$(get "$OUT/duel.json" winRateA)
  if [ "$(ge "$SHARE" 0.60)" = "1" ]; then S=PASS; else S=FAIL; fi
  record "duel" "$S" "part des points $SHARE contre $BASE (seuil 0.60), parties gagnees $WINS sur $GAMES parties"
else
  record "duel" "FAIL" "la commande a echoue"
fi

# --- 2. coups betes --------------------------------------------------------------------------
echo >&2
if node dist/arena.mjs stupid --weights "$CHAMP" --decisions "$DECISIONS" --seed "$SEED" $WORKERS_ARG > "$OUT/stupid.json"; then
  TOTAL=$(get "$OUT/stupid.json" total)
  GIFT=$(get "$OUT/stupid.json" byKind.gift)
  TAKE=$(get "$OUT/stupid.json" byKind.uselessTake)
  SKM=$(get "$OUT/stupid.json" byKind.skUnderMermaid)
  if [ "$TOTAL" = "0" ]; then S=PASS; else S=FAIL; fi
  record "coups betes" "$S" "$TOTAL sur $DECISIONS decisions (cadeau $GIFT, prise inutile $TAKE, SK sous sirene $SKM)"
else
  record "coups betes" "FAIL" "la commande a echoue"
fi

# --- 3. echelle des niveaux ------------------------------------------------------------------
echo >&2
if node dist/arena.mjs ladder --weights "$CHAMP" --games "$LADDER_GAMES" --seed "$SEED" $WORKERS_ARG > "$OUT/ladder.json"; then
  ORDERED=$(get "$OUT/ladder.json" ordered)
  if [ "$ORDERED" = "true" ]; then S=PASS; else S=FAIL; fi
  record "echelle" "$S" "facile < normal < difficile < impitoyable : $ORDERED"
else
  record "echelle" "FAIL" "la commande a echoue"
fi

# --- 4. curseurs -----------------------------------------------------------------------------
echo >&2
if node dist/arena.mjs sliders --weights "$CHAMP" --games "$SLIDER_GAMES" --seed "$SEED" $WORKERS_ARG > "$OUT/sliders.json"; then
  MAL=$(get "$OUT/sliders.json" malice.ok)
  FOR=$(get "$OUT/sliders.json" force.ok)
  if [ "$MAL" = "true" ] && [ "$FOR" = "true" ]; then S=PASS; else S=FAIL; fi
  record "curseurs" "$S" "malice $MAL, force $FOR"
else
  record "curseurs" "FAIL" "la commande a echoue"
fi

# --- verdict ---------------------------------------------------------------------------------
echo >&2
echo "================ verdict ================" >&2
for r in "${RESULTS[@]}"; do echo "  $r" >&2; done
if [ "$FAILED" = "0" ]; then
  echo "  => TOUT PASSE" >&2
else
  echo "  => REFUSE" >&2
fi
echo "  detail : $OUT/{duel,stupid,ladder,sliders}.json" >&2
exit "$FAILED"
