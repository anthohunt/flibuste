# Règles de Flibuste

Texte écrit pour ce projet (licence CC BY 4.0). Flibuste est un jeu de **plis à annonces** : chaque manche,
on annonce combien de plis on va remporter, puis on joue pour atteindre exactement ce nombre. Cette mécanique
appartient à une famille de jeux connue ; les cartes, les noms et les textes ci-dessous sont propres à Flibuste.
Le moteur (`packages/engine`) fait foi : chaque cas décrit ici est un test de `packages/engine/situations/`.

## Mise en place
• 2 à 8 joueurs (9 avec les cartes de couleur de l'extension). 10 manches : à la manche *n*, chacun reçoit *n* cartes.
• Quatre couleurs de 1 à 14 : **Albatros** (vert), **Compas** (violet), **Doublon** (jaune) et **Pavillon** (noir, qui fait atout).
• Cartes spéciales : Fuite, Pirates, Tigresse, Sirènes, **Roi des Flibustiers**, Kraken, Baleine blanche, Butin.

## Une manche
1. **Annonces** : chacun annonce le nombre de plis qu'il vise (de 0 à *n*).
2. **Plis** : le meneur pose une carte ; les autres jouent à leur tour. Si on a la couleur menée, on doit la fournir
   (les cartes spéciales se jouent toujours). Le pli va à la plus forte carte, et son gagnant mène le suivant.

### Qui gagne un pli
• Le **Roi des Flibustiers** bat les pirates et les numéros, mais une **Sirène** le bat.
• Les **Pirates** battent les numéros et les Sirènes. Plusieurs pirates : le premier posé l'emporte.
• Les **Sirènes** battent les numéros ; si le Roi des Flibustiers et un pirate sont dans le pli, la Sirène gagne.
• Le **Pavillon** (noir) bat les autres couleurs ; sinon, le plus haut numéro de la couleur menée gagne.
• La **Fuite** perd contre tout. Si tout le monde fuit, la première Fuite gagne.
• La **Tigresse** se déclare à la pose : pirate ou fuite. Le **Butin** vaut une fuite et allie son joueur au gagnant du pli.
• Le **Kraken** annule le pli : personne ne le gagne, et celui qui l'aurait gagné mène le suivant.
• La **Baleine blanche** efface les cartes spéciales et les couleurs : seul le plus haut numéro compte.

## Pouvoirs des six pirates
Un pirate qui gagne le pli déclenche son pouvoir (au dernier pli de la manche, seul Gaspard agit encore) :
• **Maren la Timonière** : choisit qui mène le pli suivant.
• **Orsolo le Brocanteur** : pioche deux cartes du talon, puis en défausse deux.
• **Gaspard l'Ajusteur** : modifie son annonce de ±1, ou la garde.
• **Isidora l'Oracle** : regarde les cartes non distribuées.
• **Rufus le Parieur** : mise 0, 10 ou 20 points sur sa manche (gagnés si l'annonce tient, perdus sinon).
• **Mathilde la Sorcière** (extension) : désigne un adversaire ; une carte tirée au hasard dans sa main devra être jouée au pli suivant.

## Points d'une manche
• Annonce tenue (exactement) : **+20 par pli annoncé**. Annonce ratée : **−10 par pli d'écart**.
• Annonce de **0** : **+10 × le nombre de cartes de la manche** si tenue, −10 × ce nombre sinon.
• **Bonus** (seulement si l'annonce est tenue) : chaque 14 gagné +10 (14 noir +20) ; un pirate qui prend une Sirène +20 ;
  le Roi des Flibustiers qui prend un pirate +30 ; une Sirène qui prend le Roi des Flibustiers +40.
• **Butin** : +20 pour chacun des deux joueurs alliés si leurs deux annonces tiennent.
• Le meilleur total après la dernière manche gagne ; les égalités partagent la victoire.

## Extension (facultative)
• Numéros bonus (7 et 8 supplémentaires dans chaque couleur), **0/14** (se déclare 0 ou 14), **15 joker**.
• **Second** : bat tout sauf le Roi des Flibustiers et les Sirènes. **Mathilde la Sorcière** (ci-dessus).
• **Dernière salve** : ne gagne jamais, mais son joueur repose une carte à la fin du pli.
• **Supplice de la planche** : ne gagne jamais ; retire un pirate du pli (il ne gagne pas, ne rapporte rien).
• **Raie tachetée** : la plus basse carte gagne. **Casier de Davy Jones** : détruit les Kraken, Baleine et Raie du pli (+20 chacun).
• À deux joueurs, le 15 joker, la Planche et les 0/14 ne sont pas utilisés.

## Deux joueurs
Un troisième joueur fantôme, le **Vieux Loup**, joue une main automatique : il n'annonce rien et ne marque pas.

## Cartes maison
**La Tempête** vaut une Fuite ; avant le pli suivant, chacun passe une carte à son voisin de gauche.

## Variantes de manches
Le nombre de cartes par manche se choisit parmi plusieurs plans (1 à 10 classique, « Pas d'impair », « Tourbillon »…) :
voir `apps/web/src/lib/variants.ts`.
