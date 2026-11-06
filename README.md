**English** · [Français](README.fr.md)

**Anthony Hunt** · [Project page on ingevision.cloud](https://ingevision.cloud/?lang=en&p=flibuste) · [LinkedIn](https://www.linkedin.com/in/anthony-hunt-3948a9196) · [GitHub profile](https://github.com/anthohunt)

# Flibuste

A trick-taking card game with bidding, for phones (PWA): solo against bots, or online with friends using a room code.
Free and open source (Apache 2.0). The game and its rules are in French.

- `packages/engine`: pure, deterministic rules engine (same seed, same result).
- `packages/bots`: three bot levels (Easy, Normal, Hard) and a Ruthless level, using Monte Carlo search; optional neural networks.
- `apps/server`: WebSocket + SQLite server (rooms, timers, bots, resume, scores).
- `apps/web`: Svelte client, installable, with sound and offline mode.
- `tools/bots`: self-play arena to measure bots; `tools/nn`: network training; `tools/art`: card drawing.
- [`docs/REGLES.md`](docs/REGLES.md): the rules of the game, written for this project (in French).

> Flibuste is an independent game: it is not affiliated with any board game publisher. The names, texts, cards and images belong to the project.

## Install and run
You need Node.js 22 and pnpm (`corepack enable`).

```bash
pnpm install
pnpm test                                   # engine, bots, server, client
pnpm --filter @flibuste/web build           # builds the client into apps/web/dist
WEB_DIST=apps/web/dist pnpm --filter @flibuste/server start   # http://localhost:8787
```

For development: `pnpm --filter @flibuste/server dev` (server on port 8787) and `pnpm --filter @flibuste/web dev` (client on port 5173).

With Docker: `docker build -t flibuste . && docker run -p 8787:8787 -v flibuste-data:/data flibuste`.

The settings (port, data folder, public address…) are described in [`.env.example`](.env.example).

## Tests
- `pnpm test`: unit and integration tests (Vitest) for each package.
- `apps/web/e2e/`: end-to-end journeys in a browser (Playwright); `pnpm --filter @flibuste/web exec playwright install chromium` then `pnpm --filter @flibuste/web exec playwright test`.

## Licenses
- Code: Apache 2.0 (`LICENSE`, `NOTICE`). Text and documents: CC BY 4.0 (`LICENSE-docs`).
- Fonts, sounds, images and dependencies: see [`CREDITS.md`](CREDITS.md).
