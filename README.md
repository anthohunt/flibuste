# Flibuste

Jeu de cartes de plis à annonces, sur téléphone (PWA) : seul contre des bots, ou en ligne entre amis avec un code de salle.
Libre et gratuit (Apache 2.0). *Free trick-taking card game with bidding, for mobile browsers: solo against bots or online with a room code.*

• `packages/engine` : moteur de règles pur et déterministe (le même résultat pour la même graine).
• `packages/bots` : trois niveaux de bots (Facile, Normal, Difficile) et un niveau Impitoyable, par recherche Monte-Carlo ; réseaux de neurones facultatifs.
• `apps/server` : serveur WebSocket + SQLite (salles, minuteurs, bots, reprise, scores).
• `apps/web` : client Svelte, installable, avec sons et mode hors ligne.
• `tools/bots` : arène d'auto-jeu pour mesurer des bots ; `tools/nn` : entraînement des réseaux ; `tools/art` : dessin des cartes.
• [`docs/REGLES.md`](docs/REGLES.md) : les règles du jeu, écrites pour ce projet.

> Flibuste est un jeu indépendant : il n'est lié à aucun éditeur de jeu de société. Les noms, textes, cartes et images sont propres au projet.

## Installer et lancer
Il faut Node.js 22 et pnpm (`corepack enable`).

```bash
pnpm install
pnpm test                                   # moteur, bots, serveur, client
pnpm --filter @flibuste/web build           # compile le client dans apps/web/dist
WEB_DIST=apps/web/dist pnpm --filter @flibuste/server start   # http://localhost:8787
```

En développement : `pnpm --filter @flibuste/server dev` (serveur sur le port 8787) et `pnpm --filter @flibuste/web dev` (client sur le port 5173).

Avec Docker : `docker build -t flibuste . && docker run -p 8787:8787 -v flibuste-data:/data flibuste`.

Les réglages (port, dossier de données, adresse publique…) sont décrits dans [`.env.example`](.env.example).

## Tests
• `pnpm test` : tests unitaires et d'intégration (Vitest) de chaque paquet.
• `apps/web/e2e/` : parcours de bout en bout dans un navigateur (Playwright) ; `pnpm --filter @flibuste/web exec playwright install chromium` puis `pnpm --filter @flibuste/web exec playwright test`.

## Licences
• Code : Apache 2.0 (`LICENSE`, `NOTICE`). Textes et documents : CC BY 4.0 (`LICENSE-docs`).
• Polices, sons, images et dépendances : voir [`CREDITS.md`](CREDITS.md).
