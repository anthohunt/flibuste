# Arène d'auto-jeu (`@flibuste/arena`)

Fait jouer les bots contre eux-mêmes pour **mesurer** un jeu de poids : est-il plus fort que celui
d'aujourd'hui, fait-il encore des coups bêtes, les niveaux restent-ils ordonnés, les curseurs
répondent-ils encore. Aucun entraînement ici : l'arène ne fait que juger.

## Construire

```bash
node tools/bots/build.mjs        # -> tools/bots/dist/arena.mjs + worker.mjs
```

Les paquets du monorepo sont du TypeScript source ; esbuild les bundle pour Node 22. À relancer
après toute modification de `packages/bots` ou `packages/engine`. Trois sorties :

| fichier | contenu |
|---|---|
| `dist/arena.mjs` | le CLI |
| `dist/worker.mjs` | le worker (chargé par le CLI, jamais lancé à la main) |
| `dist/weights.mjs` | `DEFAULT_WEIGHTS`, `WEIGHT_BOUNDS`, `weightsOf` — pour la boucle d'entraînement |

```js
const { DEFAULT_WEIGHTS, WEIGHT_BOUNDS, weightsOf } = await import('./tools/bots/dist/weights.mjs');
```

## Commandes

Toutes écrivent **du JSON sur stdout** et un résumé lisible sur stderr, et acceptent `--workers N`
(défaut : `os.cpus().length − 2`).

```bash
node tools/bots/dist/arena.mjs duel    --a weights/champion.json --b default --games 60 --seed essai
node tools/bots/dist/arena.mjs stupid  --weights weights/champion.json --decisions 1000 --seed essai
node tools/bots/dist/arena.mjs ladder  --weights weights/champion.json --games 40 --seed essai
node tools/bots/dist/arena.mjs sliders --weights weights/champion.json --games 40 --seed essai
```

Trois valeurs possibles à la place d'un chemin :

- `default` (ou `none`) — `DEFAULT_WEIGHTS` du paquet, c'est-à-dire **les poids entraînés** (le bot
  déployé), avec le garde-fou anti-coups-bêtes ;
- `legacy` — le bot d'avant la mission : `LEGACY_WEIGHTS` (les constantes réglées à la main) **et**
  garde-fou coupé. C'est la référence du juge, celle qu'un champion doit battre ;
- un fichier JSON de poids **partiels** : les clés absentes prennent la valeur de `DEFAULT_WEIGHTS`,
  une clé inconnue de `WEIGHT_BOUNDS` est ignorée avec un avertissement. Voir `weights/example.json`.

### `duel` — qui joue le mieux

Parties à 4, profil identique des deux côtés (`--profile`, défaut `ruthless`), sièges alternés
`a,b,a,b` puis `b,a,b,a`. Seuls les poids diffèrent.

| champ | sens |
|---|---|
| `meanA` / `meanB` | score final moyen par siège |
| `shareA` | part des points de A : dans chaque partie chaque score est ramené à zéro par le MIN de la partie, puis Σ côté A / Σ total |
| `shareAPerGame` | la même part, moyennée partie par partie (moins sensible aux parties à gros écarts) |
| `winRateA` | le meilleur score de la partie est côté A (ex æquo = 0,5) |

### `stupid` — combien de coups bêtes

Le profil joue contre trois copies de lui-même ; **les décisions des quatre sièges comptent** (ils
tiennent le même bot). Sont examinées les poses (phases `playing` / `volley`) où il existait au
moins deux coups légaux, jusqu'à en avoir `--decisions`. Trois fautes, jugées depuis la seule vue du
bot avec `resolveTrick` (« la carte gagne-t-elle le pli en l'état ») et `trickBonus` (« que donne-t-elle
au gagnant ») :

- `gift` — la carte ne gagne pas le pli et **ajoute du bonus** au gagnant du moment (sirène sous
  pirate +20, pirate ou Second sous Roi des Flibustiers +30, Roi des Flibustiers sous sirène +40, 14 noir +20, 14 de
  couleur +10, 8 d'extension +5), alors qu'une carte légale ne gagnait pas non plus et n'offrait rien ;
- `uselessTake` — le pari est déjà tenu (plis ≥ pari effectif, Gaspard compris), ce n'est pas le
  dernier pli, la carte prend le pli, alors qu'une carte légale ne le prenait pas ;
- `skUnderMermaid` — le Roi des Flibustiers est posé alors qu'une sirène est déjà sur le pli.

`byKindLeading` compte ceux commis **en ouvrant le pli**, où « gagner le pli en l'état » est vrai de
presque toute carte : le reproche y est plus discutable qu'au milieu d'un pli (à la ligne de base :
5 sur 64).

Les tests du détecteur : `cd tools/bots && npx vitest run`.

### `ladder` — les niveaux restent-ils ordonnés

Trois duels facile/normal, normal/difficile, difficile/impitoyable, avec le plafond courant de
`HARD_DEFAULTS.samples` (256), réduit par la force de chaque niveau : 0 / 20 / 82 / 256.
Budget infini ; 6 manches par défaut (`--rounds 10` pour les parties complètes),
`--samples` permet un plafond explicite. `ordered` = les trois duels vont dans le bon sens. Les poids testés sont donnés **aux deux
camps** : la question est « cette cervelle garde-t-elle l'échelle », pas « bat-elle l'ancienne ».

### `calibrate` — donnes appariées et incertitude de l'échelle

```bash
node tools/bots/build-calibration.mjs
node tools/bots/dist/calibrate.mjs --seeds 40 --workers 8 --rounds 10 --out calibration.json
```

Ce contrôle de sortie de version joue 240 parties complètes : trois paires de niveaux, 40 graines
communes, chaque donne rejouée en inversant les sièges `ABAB` / `BABA`. Il conserve les scores
bruts et contrôle la légalité de toutes les actions via `core.playGame`. Le plafond est celui du
bot courant, le budget de temps est désactivé, les poids sont `DEFAULT_WEIGHTS`, sans réseau.
Le JSON est actualisé après chaque partie. Les règles proviennent directement de `applyPreset`
dans l'application ; `--rules full` teste les extensions 2025. Pour confirmer un écart sur des
graines neuves sans rejouer tous les niveaux : `--pair hard-ruthless --start 40 --seeds 40`.
`--profiles overrides.json` accepte des ajustements partiels par niveau, reportés en entier
dans le résultat ; `--resume checkpoint.json` reprend les lignes déjà finies si la politique
et les règles correspondent. Les checkpoints sont remplacés atomiquement.

L'intervalle à 95 % approximatif porte sur l'écart de score moyen **par paire de donnes**, pas
sur des sièges considérés à tort comme indépendants. Un écart positif observé ne garantit pas
un intervalle entièrement positif ; ce dernier est rapporté séparément. Cette mesure compare
la force à calcul constant. La latence et la troncature du calcul doivent être mesurées à part,
sur la machine qui exécutera réellement les bots.

### `sliders` — les curseurs répondent-ils encore

1. **malice** — un impitoyable malice 10 puis malice 0 (mêmes donnes) contre deux victimes
   heuristiques ; `malice.ok` = les victimes marquent moins face à malice 10. Les paris à 0 ratés
   des victimes sont donnés à côté (le critère du design). **40 parties ne suffisent pas** : l'écart
   n'y est que de ~1,6 point contre ~5 à 120 parties. Le juge en prend 120.
2. **force** — force 2 contre force 10, mêmes poids ; `force.ok` = force 10 marque plus. Écart franc
   (~+35 points), stable dès 40 parties.

## Le juge

```bash
bash tools/bots/judge.sh          # CHAMP=weights/champion.json par défaut
```

Quatre épreuves, `exit 0` si tout passe :

| épreuve | seuil |
|---|---|
| `duel` champion contre `legacy`, 200 parties | `shareA ≥ 0.60` |
| `stupid`, 1 000 décisions | 0 coup bête |
| `ladder` | `ordered` |
| `sliders`, 120 parties | `malice.ok` **et** `force.ok` |

Variables : `CHAMP`, `BASE` (défaut `legacy` ; `BASE=default` pour isoler l'apport des seuls poids),
`GAMES`, `DECISIONS`, `LADDER_GAMES`, `SLIDER_GAMES`, `SEED`, `WORKERS`, `OUT`.
Le détail JSON de chaque épreuve reste dans `dist/judge/`.

## Reproductibilité

Mêmes graines ⇒ mêmes chiffres, quel que soit le nombre de workers et la machine : `timeBudgetMs`
vaut `Infinity` partout et le plafond d'échantillons est fixé, donc rien ne dépend de l'horloge. La
graine d'une décision est `<graine de la partie>:<rang de la décision>`, exactement comme
`packages/bots/test/harness.ts`. Une tâche = une partie, et l'agrégation se fait dans le thread
principal dans l'ordre des parties : l'ordonnancement des workers n'entre nulle part.

## Temps mesurés

Sur 32 cœurs, 30 workers, `--samples 16`, profil impitoyable, 10 manches :

| mesure | valeur |
|---|---|
| calcul par partie | ~20 s |
| `duel --games 40` | 33 s |
| `duel --games 60` | 50 s (42 s sur 22 workers, l'equivalent d'une machine a 24 coeurs) |
| `duel --games 200` (le juge) | 1 min 47 |
| `stupid --decisions 1000` (7 parties utiles) | 12 s |
| `ladder --games 40` / `sliders --games 40` (6 manches) | 13 s / 14 s |

Une partie de 6 manches coûte environ dix fois moins qu'une partie de 10 manches : les grosses
manches dominent tout.

## Ce que vaut un chiffre

Mesuré avec les poids d'origine des deux côtés (donc deux bots strictement identiques), la part des
points de A vaut 0,519 sur 200 parties, 0,538 sur 40, 0,489 sur 8 : le bruit est d'environ ±0,02 à
200 parties et ±0,04 à 40. Le seuil du juge (0,60 sur 200 parties) est donc à quatre écarts-types
du hasard — mais un duel de 40 parties ne départage pas deux jeux de poids voisins.
