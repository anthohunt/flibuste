// UX-03 / UX-04 / A11Y-12 — « dire qui gagne, et pourquoi ».
// `trickVerdict` ne réécrit aucune phrase : elle découpe celle de `describeTrickFr` (moteur) en un titre, la carte
// qui l'emporte et l'explication. Le seul mot ajouté est « Tu » — la nuance que le moteur ne peut pas connaître.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDeck, DEFAULT_RULES, scenarioState } from '@flibuste/engine';
import type { PlayerId, TrickRecord } from '../lib/types';
import { live } from '../lib/live.svelte';
import { act, currentView, defaultSoloConfig, detach, game, skipTrickPause, startOfflineFromState, startSolo, timing, trickVerdict } from '../lib/store.svelte';
import { createBotRunner } from '../lib/botRunner';
import { randomChooseAction } from '../lib/randomBot';

const NAMES: Record<PlayerId, string> = { me: 'Alix', p1: 'Barbe-Noire', p2: 'Anne Bonny', p3: 'Calico Jack' };
const who = (id: PlayerId) => NAMES[id] ?? id;
const rec = (patch: Partial<TrickRecord>): TrickRecord => ({ leader: 'p1', plays: [], winner: null, captured: [], kraken: false, whale: false, ...patch }) as TrickRecord;
const verdictOf = (r: TrickRecord, me: PlayerId = 'me') => trickVerdict(r, who, me, ['me', 'p1', 'p2', 'p3']);

describe('trickVerdict — le verdict d’un pli, en clair', () => {
  it('pli ordinaire : le nom du gagnant, la carte, et rien à expliquer', () => {
    const v = verdictOf(
      rec({
        leader: 'p1',
        winner: 'p1',
        plays: [
          { player: 'p1', card: { id: 'parrot-9', kind: 'number', suit: 'parrot', rank: 9 } },
          { player: 'me', card: { id: 'parrot-3', kind: 'number', suit: 'parrot', rank: 3 } },
          { player: 'p2', card: { id: 'parrot-5', kind: 'number', suit: 'parrot', rank: 5 } },
        ],
      }),
    );
    expect(v.headline).toBe('Barbe-Noire remporte le pli');
    expect(v.card).toBe('avec le 9 vert');
    expect(v.detail).toBeNull();
    expect(v.mine).toBe(false);
    expect(v.speech).toBe('Barbe-Noire remporte le pli avec le 9 vert.');
  });

  it('quand c’est moi : « Tu remportes le pli » — le seul mot que le moteur ne peut pas dire', () => {
    const v = verdictOf(
      rec({
        leader: 'me',
        winner: 'me',
        plays: [
          { player: 'me', card: { id: 'pirateking', kind: 'pirateking' } },
          { player: 'p1', card: { id: 'pirate-adjuster', kind: 'pirate', pirate: 'adjuster' } },
          { player: 'p2', card: { id: 'parrot-3', kind: 'number', suit: 'parrot', rank: 3 } },
        ],
      }),
    );
    expect(v.mine).toBe(true);
    expect(v.headline).toBe('Tu remportes le pli');
    // La capture ET son bonus restent collés à la carte : c'est le texte du moteur, pas une phrase réécrite.
    expect(v.card).toMatch(/^avec le Roi des Flibustiers, qui capture un pirate/);
    expect(v.card).toContain('+30');
    // Vu d'un autre siège, la même donne se dit au nom du gagnant.
    expect(verdictOf(rec({ leader: 'me', winner: 'me', plays: [{ player: 'me', card: { id: 'pirateking', kind: 'pirateking' } }] }), 'p1').headline).toBe('Alix remporte le pli');
  });

  it('Kraken : personne ne gagne, et l’explication du moteur dit qui aurait gagné et qui mène', () => {
    const v = verdictOf(
      rec({
        leader: 'p1',
        winner: null,
        kraken: true,
        plays: [
          { player: 'p1', card: { id: 'kraken', kind: 'kraken' } },
          { player: 'p2', card: { id: 'roger-14', kind: 'number', suit: 'roger', rank: 14 } },
          { player: 'me', card: { id: 'parrot-3', kind: 'number', suit: 'parrot', rank: 3 } },
        ],
      }),
    );
    expect(v.headline).toBe('Personne ne remporte le pli');
    expect(v.card).toBeNull();
    expect(v.detail).toContain('Le Kraken détruit le pli');
    expect(v.detail).toContain('Anne Bonny');
    expect(v.detail).toMatch(/aurait gagné|qui mène/);
  });

  it('Baleine blanche : le titre reste court, la règle appliquée passe dans l’explication (sans « : » orphelin)', () => {
    const v = verdictOf(
      rec({
        leader: 'p1',
        winner: 'p2',
        whale: true,
        plays: [
          { player: 'p1', card: { id: 'whale', kind: 'whale' } },
          { player: 'p2', card: { id: 'parrot-9', kind: 'number', suit: 'parrot', rank: 9 } },
          { player: 'me', card: { id: 'parrot-3', kind: 'number', suit: 'parrot', rank: 3 } },
        ],
      }),
    );
    expect(v.headline).toBe('Anne Bonny remporte le pli');
    expect(v.card).toBe('avec le 9 vert');
    expect(v.detail).toBe('La Baleine blanche balaie les cartes spéciales, le plus haut numéro l’emporte.');
    expect(v.detail!.endsWith(':')).toBe(false);
  });

  it('pouvoir en jeu : le Casier reste dans l’explication, la capture sur la carte', () => {
    const v = verdictOf(
      rec({
        leader: 'p1',
        winner: 'p2',
        plays: [
          { player: 'p1', card: { id: 'davy', kind: 'davy' } },
          { player: 'p2', card: { id: 'mermaid-1', kind: 'mermaid' } },
          { player: 'me', card: { id: 'pirateking', kind: 'pirateking' } },
        ],
      }),
    );
    expect(v.headline).toBe('Anne Bonny remporte le pli');
    expect(v.card).toMatch(/^avec la Sirène, qui capture le Roi des Flibustiers/);
    expect(v.detail).toContain('Casier de Davy Jones');
    // La phrase parlée réunit les trois morceaux, une seule fois chacun.
    expect(v.speech.match(/remporte le pli/g)).toHaveLength(1);
  });

  it('pli sans gagnant possible : le titre le dit quand même en toutes lettres', () => {
    const v = verdictOf(
      rec({
        leader: 'p1',
        winner: null,
        plays: [
          { player: 'p1', card: { id: 'escape-1', kind: 'escape' } },
          { player: 'p2', card: { id: 'escape-2', kind: 'escape' } },
        ],
      }),
    );
    // Une fuite gagne quand il n'y a qu'elle : ce cas-ci a bien un gagnant côté moteur, on vérifie l'autre branche.
    expect(v.headline).toMatch(/remporte le pli/);
  });

  it('Vieux Loup : son pli ne compte pour personne, et le titre porte son nom', () => {
    const v = verdictOf(
      rec({
        leader: 'ghost',
        winner: 'ghost',
        plays: [
          { player: 'ghost', card: { id: 'roger-14', kind: 'number', suit: 'roger', rank: 14 } },
          { player: 'me', card: { id: 'parrot-3', kind: 'number', suit: 'parrot', rank: 3 } },
        ],
      }),
    );
    expect(v.headline).toBe('Vieux Loup remporte le pli');
    expect(v.card).toContain('le 14 noir');
    expect(v.speech).toContain('il ne compte pour personne');
  });

  it('tout verdict contient un mot de victoire : c’est ce que la mesure n° 6 cherche à l’écran', () => {
    const cases: TrickRecord[] = [
      rec({ winner: 'p1', plays: [{ player: 'p1', card: { id: 'parrot-9', kind: 'number', suit: 'parrot', rank: 9 } }] }),
      rec({ winner: null, kraken: true, plays: [{ player: 'p1', card: { id: 'kraken', kind: 'kraken' } }] }),
      rec({ winner: null, whale: true, plays: [{ player: 'p1', card: { id: 'whale', kind: 'whale' } }] }),
      rec({ winner: null, stingray: true, plays: [{ player: 'p1', card: { id: 'stingray', kind: 'stingray' } }] }),
    ];
    for (const r of cases) {
      const v = verdictOf(r);
      expect([v.headline, v.card ?? '', v.detail ?? ''].join(' ')).toMatch(/remport|gagn|l’emporte|l'emporte|vainqueur/i);
    }
  });
});

describe('la pause de fin de pli — le verdict a le temps d’être lu', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const fast = () => ({ botDelay: [0, 0] as [number, number], runner: createBotRunner({ worker: false }), persist: false });

  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    detach();
    localStorage.clear();
    timing.trickPause = 2600;
    timing.trickPauseLast = 3200;
    timing.verdictGap = 350;
    timing.skipGuard = 1200;
  });

  it('le réglage par défaut laisse ≥ 2,5 s pour lire, et davantage sur le dernier pli d’une manche (UX-04)', () => {
    expect(timing.trickPause).toBeGreaterThanOrEqual(2500);
    expect(timing.trickPauseLast).toBeGreaterThanOrEqual(timing.trickPause);
  });

  it('pendant la pause, `game.verdict` nomme le gagnant ; il disparaît avec le pli', async () => {
    timing.trickPause = 200;
    timing.trickPauseLast = 200;
    timing.verdictGap = 20;
    const base = defaultSoloConfig(3);
    startSolo({ ...base, rules: { ...base.rules, rounds: 1 } }, fast(), 'verdict-1');
    const t0 = Date.now();
    while (currentView()?.phase !== 'roundEnd') {
      if (Date.now() - t0 > 3000) throw new Error('timeout');
      const v = currentView()!;
      if (v.legal.length > 0) {
        const a = v.legal[0]!;
        const { act } = await import('../lib/store.svelte');
        act(a);
      } else await sleep(1);
    }
    expect(game.shownTrick).not.toBeNull();
    expect(game.verdict).not.toBeNull();
    expect(game.verdict!.headline).toMatch(/remporte(s)? le pli|Personne ne remporte/);
    expect(game.verdict!.speech.length).toBeGreaterThan(10);
    // Dernier pli d'une manche, en solo : la pause attend le joueur et ne s'éteint pas d'elle-même.
    await sleep(300);
    expect(game.shownTrick).not.toBeNull();
    expect(skipTrickPause()).toBe(true);
    await sleep(5);
    expect(game.shownTrick).toBeNull();
    expect(game.verdict).toBeNull();
  });

  it('le tap sur le bandeau enchaîne tout de suite (et ne fait rien hors pause)', async () => {
    timing.trickPause = 5000;
    timing.trickPauseLast = 5000;
    timing.verdictGap = 20;
    // Le garde-fou de lecture est neutralisé ici : ce test porte sur le raccourci lui-même, pas sur son délai
    // d'armement (testé juste en dessous).
    timing.skipGuard = 0;
    const base = defaultSoloConfig(3);
    startSolo({ ...base, rules: { ...base.rules, rounds: 1 } }, fast(), 'verdict-2');
    expect(skipTrickPause()).toBe(false);
    const t0 = Date.now();
    while (game.shownTrick === null) {
      if (Date.now() - t0 > 3000) throw new Error('timeout');
      const v = currentView()!;
      if (v.legal.length > 0) {
        const { act } = await import('../lib/store.svelte');
        act(v.legal[0]!);
      } else await sleep(1);
    }
    expect(game.verdict).not.toBeNull();
    expect(skipTrickPause()).toBe(true);
    expect(game.shownTrick).toBeNull();
    expect(game.verdict).toBeNull();
    await sleep(20);
    expect(game.view?.phase).toBe('roundEnd');
    expect(skipTrickPause()).toBe(false);
  });

  it('le tap « passer » n’est armé qu’après `timing.skipGuard` : l’explication a le temps d’être lue', async () => {
    // Le bug vécu sur le Supplice de la planche (audit 2026-09-09) : « rien ne s'est passé ». Sur téléphone, le
    // geste naturel — taper pour enchaîner — supprimait la seule explication existante avant qu'elle soit lue.
    timing.trickPause = 5000;
    timing.trickPauseLast = 5000;
    timing.verdictGap = 10;
    timing.skipGuard = 120;
    const base = defaultSoloConfig(3);
    startSolo({ ...base, rules: { ...base.rules, rounds: 1 } }, fast(), 'verdict-garde');
    const t0 = Date.now();
    while (game.shownTrick === null) {
      if (Date.now() - t0 > 3000) throw new Error('timeout');
      const v = currentView()!;
      if (v.legal.length > 0) {
        const { act } = await import('../lib/store.svelte');
        act(v.legal[0]!);
      } else await sleep(1);
    }
    // Trop tôt : le tap est ignoré, le verdict reste à l'écran.
    expect(game.canSkip).toBe(false);
    expect(skipTrickPause()).toBe(false);
    expect(game.verdict).not.toBeNull();
    // Une fois le délai passé, il enchaîne comme avant.
    await sleep(200);
    expect(game.canSkip).toBe(true);
    expect(skipTrickPause()).toBe(true);
    expect(game.verdict).toBeNull();
  });

  it('le garde-fou ne dépasse jamais la pause elle-même (sinon le bandeau ne serait jamais touchable)', async () => {
    timing.trickPause = 60;
    timing.trickPauseLast = 60;
    timing.verdictGap = 5;
    timing.skipGuard = 5000;
    const base = defaultSoloConfig(3);
    startSolo({ ...base, rules: { ...base.rules, rounds: 1 } }, fast(), 'verdict-garde-2');
    const t0 = Date.now();
    while (game.shownTrick === null) {
      if (Date.now() - t0 > 3000) throw new Error('timeout');
      const v = currentView()!;
      if (v.legal.length > 0) {
        const { act } = await import('../lib/store.svelte');
        act(v.legal[0]!);
      } else await sleep(1);
    }
    await sleep(120);
    // Ce que ce test prouve : le garde-fou a été RABOTÉ à la durée de la pause (5 000 ms demandés, 60 ms de
    // pause), sinon le bandeau resterait intouchable. C'est ici que ça se voit, parce que la pause de fin de
    // manche en solo attend désormais le joueur : sans le rabotage, `canSkip` serait encore faux et la partie
    // n'aurait aucun moyen d'avancer.
    expect(game.canSkip).toBe(true);
    expect(game.verdict).not.toBeNull();
    expect(skipTrickPause()).toBe(true);
    await sleep(5);
    expect(game.verdict).toBeNull();
    expect(game.canSkip).toBe(false);
  });

  it('A11Y-12 — « À toi de jouer » n’est plus collé devant le verdict dans la région live', async () => {
    timing.trickPause = 120;
    timing.trickPauseLast = 120;
    timing.verdictGap = 10;
    const base = defaultSoloConfig(3);
    startSolo({ ...base, rules: { ...base.rules, rounds: 3 } }, fast(), 'verdict-live');
    const seen: string[] = [];
    const poll = setInterval(() => {
      if (live.status && live.status !== seen[seen.length - 1]) seen.push(live.status);
    }, 4);
    try {
      let step = 0;
      const t0 = Date.now();
      while (currentView()?.round !== 3) {
        if (Date.now() - t0 > 8000) throw new Error('timeout');
        const v = currentView()!;
        if (v.phase === 'roundEnd') {
          const { act } = await import('../lib/store.svelte');
          act({ type: 'nextRound', player: 'me' });
        } else if (v.legal.length > 0) {
          const { act } = await import('../lib/store.svelte');
          act(randomChooseAction(v, 'easy', { seed: `me:${step++}` }));
        } else await sleep(1);
      }
      await sleep(60);
    } finally {
      clearInterval(poll);
    }
    expect(seen.some((s) => /remporte(s)? le pli|Personne ne remporte/.test(s))).toBe(true);
    // Le défaut mesuré : « À toi de jouer, 6 cartes jouables. Pli remporté par Calico Jack. » en UNE annonce.
    const collapsed = seen.filter((s) => /À toi de jouer/.test(s) && /remport/i.test(s));
    expect(collapsed, `annonces qui mêlent l’appel à jouer et le verdict : ${JSON.stringify(collapsed)}`).toEqual([]);
  });
});

describe('le bilan de fin de manche attend le joueur (rapport #9 d’Alix)', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const fast = () => ({ botDelay: [0, 0] as [number, number], runner: createBotRunner({ worker: false }), persist: false });
  afterEach(() => {
    detach();
    timing.trickPause = 3200;
    timing.trickPauseLast = 6400;
    timing.skipGuard = 1200;
  });

  /** Joue la manche jusqu'au pli qui la termine, et rend la main pendant la pause. */
  async function jusquAuDernierPli(graine: string) {
    const base = defaultSoloConfig(3);
    startSolo({ ...base, rules: { ...base.rules, rounds: 1 } }, fast(), graine);
    const t0 = Date.now();
    while (game.shownTrick === null) {
      if (Date.now() - t0 > 3000) throw new Error('timeout');
      const v = currentView()!;
      if (v.legal.length > 0) {
        const { act } = await import('../lib/store.svelte');
        act(v.legal[0]!);
      } else await sleep(1);
    }
  }

  it('en solo, la pause du dernier pli ne se lève JAMAIS toute seule — c’est le tap qui la lève', async () => {
    timing.trickPause = 40;
    timing.trickPauseLast = 40;
    timing.skipGuard = 5;
    await jusquAuDernierPli('attente-1');
    expect(game.waitingSkip, 'la table doit savoir qu’elle attend un geste').toBe(true);

    // Vingt-cinq fois la durée de la pause : si un minuteur existait, il aurait fini depuis longtemps.
    await sleep(1000);
    expect(game.shownTrick).not.toBeNull();
    expect(game.verdict).not.toBeNull();
    expect(currentView()?.phase).toBe('roundEnd');
    expect(game.view?.phase, 'l’écran ne doit pas avoir basculé sur les scores').not.toBe('roundEnd');

    expect(skipTrickPause()).toBe(true);
    await sleep(5);
    expect(game.shownTrick).toBeNull();
    expect(game.waitingSkip).toBe(false);
    expect(game.view?.phase).toBe('roundEnd');
  });

  /** Huit vrais sièges moteur : Gaspard gagne, et ma carte est la dernière posée. */
  function finirPliGaspard(winner: 'me' | 'bot:1', cards = 1) {
    const players = ['me', ...Array.from({ length: 7 }, (_, i) => `bot:${i + 1}`)];
    const rules = { ...DEFAULT_RULES, pirateAbilities: true, deals: [cards] };
    const deck = buildDeck(rules, players.length);
    const card = (id: string) => deck.find((c) => c.id === id)!;
    const last = card(winner === 'me' ? 'pirate-adjuster' : 'escape-1');
    const state = scenarioState({
      players, me: 'me', rules, round: 1,
      hands: Object.fromEntries(players.map((p, i) => [p, [
        ...(p === 'me' ? [last] : []),
        ...(cards > 1 ? [card(`chest-${i + 1}`)] : []),
      ]])),
      bids: Object.fromEntries(players.map((p) => [p, p === winner ? 1 : 0])),
      trick: { leader: 'bot:1', plays: players.slice(1).map((p, i) => ({
        player: p, card: card(p === winner ? 'pirate-adjuster' : `map-${i + 1}`),
      })) },
    });
    startOfflineFromState(state, 'me', fast());
    expect(act({ type: 'play', player: 'me', cardId: last.id })).toBe(true);
    expect(game.shownTrick?.winner).toBe(winner);
    expect(game.shownTrick?.plays).toHaveLength(8);
    expect(currentView()?.phase).toBe('ability');
    expect(currentView()?.pendingAbilities[0]).toEqual({ player: winner, pirate: 'adjuster' });
  }

  it.each(['me', 'bot:1'] as const)('retient le dernier pli avant Gaspard (%s), même si son pouvoir précède les scores', async (winner) => {
    timing.trickPause = 30;
    timing.trickPauseLast = 40;
    timing.skipGuard = 5;
    finirPliGaspard(winner);
    expect(game.waitingSkip, 'Gaspard ne doit pas transformer le dernier pli en pause automatique').toBe(true);

    await sleep(120);
    expect(game.shownTrick?.plays).toHaveLength(8);
    expect(game.waitingSkip).toBe(true);
    expect(game.screen).toBe('table');
    expect(currentView()?.phase).toBe(winner === 'me' ? 'ability' : 'roundEnd');

    expect(skipTrickPause()).toBe(true);
    expect(game.shownTrick).toBeNull();
    if (winner === 'me') {
      expect(game.view?.phase).toBe('ability');
      expect(act({ type: 'ability', player: 'me', choice: { delta: 0 } })).toBe(true);
    }
    expect(game.view?.phase).toBe('roundEnd');
    expect(game.screen).toBe('score');
    expect(game.shownTrick, 'le pouvoir ne doit pas redonner le même verdict').toBeNull();
    expect(game.view?.history).toHaveLength(1);
  });

  it('garde une pause automatique avant Gaspard quand il reste des cartes à jouer', async () => {
    timing.trickPause = 30;
    timing.trickPauseLast = 40;
    timing.skipGuard = 5;
    finirPliGaspard('me', 2);
    expect(game.waitingSkip).toBe(false);
    await sleep(80);
    expect(game.shownTrick).toBeNull();
    expect(game.view?.phase).toBe('ability');
    expect(act({ type: 'ability', player: 'me', choice: { delta: 0 } })).toBe(true);
    expect(game.view?.phase).toBe('playing');
    expect(game.screen).toBe('table');
  });

  it('mais un pli ORDINAIRE garde son minuteur : seule la fin de manche attend', async () => {
    timing.trickPause = 30;
    timing.trickPauseLast = 30;
    timing.skipGuard = 5;
    const base = defaultSoloConfig(3);
    // Trois manches : les manches 2 et 3 ont plusieurs plis, donc des plis qui ne terminent pas leur manche.
    startSolo({ ...base, rules: { ...base.rules, rounds: 3 } }, fast(), 'attente-2');
    const { act } = await import('../lib/store.svelte');
    // Ce qu'on mesure : pour chaque pause observée, attendait-elle un geste ? Un pli ordinaire ne doit jamais.
    const attentes: { dernier: boolean; attend: boolean }[] = [];
    const t0 = Date.now();
    while (currentView()?.phase !== 'gameOver') {
      if (Date.now() - t0 > 6000) throw new Error('timeout');
      if (game.shownTrick) {
        attentes.push({ dernier: currentView()?.phase === 'roundEnd', attend: game.waitingSkip });
        // On tape TOUJOURS : c'est le seul moyen de traverser les fins de manche, et sur un pli ordinaire
        // cela ne fait qu'aller plus vite — le minuteur aurait fait la même chose tout seul.
        skipTrickPause();
        await sleep(5);
        continue;
      }
      const v = currentView()!;
      if (v.legal.length > 0) act(v.legal[0]!);
      else await sleep(1);
    }
    const ordinaires = attentes.filter((a) => !a.dernier);
    const derniers = attentes.filter((a) => a.dernier);
    expect(ordinaires.length, 'la partie doit contenir des plis ordinaires').toBeGreaterThan(0);
    expect(derniers.length, 'et des fins de manche').toBeGreaterThan(0);
    expect(ordinaires.every((a) => !a.attend), 'aucun pli ordinaire ne doit attendre un geste').toBe(true);
    expect(derniers.every((a) => a.attend), 'toute fin de manche doit en attendre un').toBe(true);
  });

  it('`trickPauseLast = 0` garde son sens : aucune pause de fin de manche du tout', async () => {
    timing.trickPause = 30;
    timing.trickPauseLast = 0;
    timing.skipGuard = 5;
    await jusquAuDernierPli('attente-3');
    // Pas de geste, pas d'attente : au bout de la pause ordinaire, l'écran est déjà passé aux scores.
    expect(game.waitingSkip).toBe(false);
    await sleep(80);
    expect(game.shownTrick).toBeNull();
    expect(game.view?.phase).toBe('roundEnd');
  });
});
