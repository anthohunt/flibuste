# Réseaux de neurones (`@flibuste/nn`)

Deux réseaux, entraînés sur des parties d'auto-jeu générées par les bots du dépôt.

| réseau | question | étiquette | pourquoi |
|---|---|---|---|
| `pari` | combien de plis cette main prendra-t-elle ? | les plis **réellement** pris à la fin de la manche | c'est la décision qui coûte le plus de points, et son étiquette est gratuite et objective |
| `coup` | quelle carte poser ? | la carte choisie par un bot Monte-Carlo cher | de l'**imitation** : jouer aussi bien pour un millième du coût — le défaut mesuré sur le serveur (les bots figeaient les tables en calculant sur la boucle d'événements) |

## 1. Générer les données

```bash
node tools/nn/build.mjs                       # bundle le générateur
node tools/nn/dist/generer.mjs --parties 2000 --graine nuit1 --sortie tools/nn/donnees \
     --niveau ruthless --echantillons 400
```

Le parallélisme se fait en **processus**, un par tranche de graines — le générateur est mono-thread et
Monte-Carlo est ce qui coûte :

```bash
for i in $(seq 0 29); do
  node tools/nn/dist/generer.mjs --parties 30000 --parts 30 --part $i --sortie donnees &
done
```

Chaque processus écrit ses propres fichiers (`pari.7.bin`, …) ; l'entraîneur les recolle tout seul.

## 2. Entraîner

```bash
python tools/nn/entrainer.py --donnees tools/nn/donnees --sortie tools/nn/modeles --epoques 12
```

## Ce qu'il ne faut PAS casser

`src/encode.ts` fixe la traduction cartes → nombres. Si l'ordre des cases change entre l'entraînement et
l'usage, le modèle continue de tourner et dit n'importe quoi, **sans aucune erreur**. D'où
`VERSION_ENCODAGE`, écrite dans les données et dans le point de contrôle : à l'usage, on la compare.

## Résultats mesurés

Les deux réseaux entraînés sont dans `modeles/` (`pari.pt`, `coup.pt`) ; `modeles/resultats.json` garde les
chiffres de l'entraînement retenu (exactitude de l'annonce, accord avec le bot Monte-Carlo, top-3).

Ce que ces chiffres disent, et ce qu'ils ne disent pas :

- Le **pari** se trompe d'un demi-pli en moyenne : exploitable, puisque l'annonce est un entier.
- Le **coup** imite le maître une fois sur deux et le met dans son top-3 neuf fois sur dix. Ce n'est PAS
  « il joue aussi bien » : les coups où le maître hésite entre deux cartes équivalentes comptent comme des
  erreurs. La seule mesure qui tranche est un duel à l'arène (`tools/bots`).
- Plus de données n'améliorent pas forcément le modèle : on garde, pour chaque réseau, le point de contrôle
  qui a la meilleure mesure sur son propre critère.
