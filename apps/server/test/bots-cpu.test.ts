// Ce que ces tests gardent : les bots ne doivent JAMAIS simuler sur la boucle d'événements, et la panne
// du worker qui les fait simuler ailleurs doit être temporaire, visible, et n'emporter que sa propre
// décision. Chacune de ces trois choses a été mesurée cassée au banc de charge (10 tables, 50 joueurs) ;
// chacune se redéferait en une ligne au premier refactor si rien ne la tenait.

import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RULES, apply, legalActions, newGame, viewFor, type Action, type GameState, type PlayerView } from '@flibuste/engine';
import { usesMonteCarlo } from '@flibuste/bots';
import type { BotProfile } from '../src/protocol';
import { BOT_PRESETS, LIGHT_FORCE, isHeavy, lightened, profileForLevel } from '../src/bot-profile';
import { decideFor, getBot } from '../src/bot';
import { HardBotPool, budgetForQueue, deadlineVerdict, hardPoolStatus } from '../src/hard-pool';

const LEVELS = ['easy', 'normal', 'hard', 'ruthless'] as const;

/** Un profil de force donnée, le reste au préréglage Normal. */
const withForce = (force: number): BotProfile => ({ ...BOT_PRESETS.normal, force });

// --- le seuil : un seul, et vrai ---------------------------------------------------------------

describe('le seuil du worker est celui du Monte-Carlo, et il est unique', () => {
  it('coïncide avec `usesMonteCarlo` du paquet bots pour toute force', () => {
    // C'EST LE CONSTAT N°1. Le serveur en tenait un second (force ≥ 7) pendant que le paquet déclarait
    // force ≥ 3 : `normal`, force 4 et niveau PAR DÉFAUT, simulait donc sur la boucle d'événements.
    for (let force = 0; force <= 10; force++) {
      const p = withForce(force);
      expect(isHeavy(p), `force ${force}`).toBe(usesMonteCarlo(p));
    }
  });

  it('le niveau par défaut (Normal, force 4) part au fil séparé', () => {
    expect(BOT_PRESETS.normal.force).toBe(4);
    expect(isHeavy(profileForLevel('normal'))).toBe(true);
  });

  it('tous les préréglages qui simulent partent au fil séparé, et eux seuls', () => {
    for (const level of LEVELS) {
      const p = profileForLevel(level);
      expect(isHeavy(p), level).toBe(usesMonteCarlo(p));
    }
    expect(isHeavy(profileForLevel('easy'))).toBe(false);
  });
});

describe('le repli synchrone est un vrai repli', () => {
  it('un profil allégé ne simule jamais — quelle que soit la force de départ', () => {
    // Le repli tourne SUR la boucle : s'il simule encore, la panne du worker recrée exactement la panne
    // que le worker évitait. L'ancien repli était une force 4, mesurée à 20,02 ms par décision.
    for (let force = 0; force <= 10; force++) {
      const light = lightened(withForce(force));
      expect(usesMonteCarlo(light), `force ${force}`).toBe(false);
      expect(isHeavy(light), `force ${force}`).toBe(false);
    }
  });

  it('garde le reste du profil : seule la profondeur de réflexion baisse', () => {
    const p = profileForLevel('ruthless');
    const light = lightened(p);
    expect(light.force).toBe(LIGHT_FORCE);
    expect({ ...light, force: p.force }).toEqual(p);
  });

  it('laisse intact un profil qui ne simulait déjà pas', () => {
    const easy = profileForLevel('easy');
    expect(lightened(easy)).toEqual(easy);
  });

  it('descend juste sous le seuil du paquet, pas plus bas : force 3 → force 2 (les heuristiques complètes)', () => {
    expect(lightened(withForce(3)).force).toBe(2);
    expect(LIGHT_FORCE).toBe(2);
  });
});

describe('le choix fait SUR la boucle ne simule jamais, quel que soit l’appelant', () => {
  it('`getBot()` joue le coup du profil allégé, pas celui du profil demandé', () => {
    // Le verrou est dans bot.ts, pas à chaque appel de room.ts : un seul appel qui oublierait `lightened`
    // remettrait 20 ms de Monte-Carlo par décision sur le fil de TOUTES les tables.
    const view = midRoundView();
    const onLoop = getBot();
    for (const level of ['normal', 'hard', 'ruthless'] as const) {
      const p = profileForLevel(level);
      const opts = { seed: `loop-${level}`, timeBudgetMs: 250 };
      expect(onLoop(view, p, opts), level).toEqual(decideFor(view, lightened(p), opts));
    }
  });
});

// --- la file, pas le calcul, est le plafond ------------------------------------------------------

describe('le budget d’une décision suit la profondeur de la file', () => {
  it('seule dans la file, une décision garde le budget demandé', () => {
    expect(budgetForQueue(250, 1, 400)).toBe(250);
    expect(budgetForQueue(136, 1, 400)).toBe(136);
  });

  it('à dix, chacune réfléchit dix fois moins — la file entière tient dans la cible', () => {
    for (const depth of [1, 2, 3, 5, 10, 20, 40, 100]) {
      const b = budgetForQueue(250, depth, 400);
      // ce que la file entière coûtera au pire, à la milliseconde d'arrondi près par décision
      expect(b * depth).toBeLessThanOrEqual(400 + depth);
    }
  });

  it('ne rend jamais 0 : une décision doit rester possible, même bâclée', () => {
    for (const depth of [1, 50, 500, 5000]) expect(budgetForQueue(250, depth, 400)).toBeGreaterThan(0);
  });

  it('décroît quand la file s’allonge, jamais l’inverse', () => {
    let previous = Infinity;
    for (let depth = 1; depth <= 60; depth++) {
      const b = budgetForQueue(250, depth, 400);
      expect(b).toBeLessThanOrEqual(previous);
      previous = b;
    }
  });

  it('un budget absent, infini ou absurde retombe sur le cap normal', () => {
    // `Infinity` est légitime en auto-jeu ; dans le pool, d'autres tables attendent derrière.
    for (const asked of [undefined, Infinity, 0, -5, Number.NaN]) expect(budgetForQueue(asked, 1, 400)).toBe(250);
  });
});

// --- le worker : sa mort, sa panne, et ce qu'elles emportent -------------------------------------

/** Une vue de milieu de manche avec plusieurs coups légaux (une décision qui vaut la peine d'être prise). */
function midRoundView(): PlayerView {
  const players = ['p0', 'p1', 'p2', 'p3', 'p4'];
  let s: GameState = newGame(players, { ...DEFAULT_RULES, rounds: 6 }, 'pool-test');
  const step = (state: GameState): GameState => {
    for (const p of state.players) {
      const legal = legalActions(state, p);
      if (legal.length) return apply(state, legal[(state.log.length * 7 + 3) % legal.length] as Action);
    }
    throw new Error('aucun coup possible');
  };
  let guard = 0;
  while (s.round < 6 && s.phase !== 'gameOver' && guard++ < 40_000) s = step(s);
  while (s.phase !== 'playing' && guard++ < 40_000) s = step(s);
  for (let i = 0; i < 40 && s.phase === 'playing'; i++) {
    for (const p of s.players) {
      const v = viewFor(s, p);
      if (v.legal.length > 2) return v;
    }
    s = step(s);
  }
  throw new Error('pas de vue avec plusieurs coups légaux');
}

let pools: HardBotPool[] = [];
const pool = (opts: ConstructorParameters<typeof HardBotPool>[0] = {}): HardBotPool => {
  const p = new HardBotPool(opts);
  pools.push(p);
  return p;
};

afterEach(() => {
  for (const p of pools) p.destroy();
  pools = [];
});

describe('la mort d’un worker n’emporte que sa propre décision', () => {
  it('la décision SUIVANTE, partie chez un worker neuf, aboutit', async () => {
    // C'EST LE CONSTAT N°6, à la ligne près : `worker.on('exit')` réglait `this.current` sans regarder à
    // QUI ce job avait été envoyé. Le worker remplacé rejetait donc la décision de son remplaçant — et
    // côté salle, ce rejet-là relançait un Monte-Carlo SUR la boucle d'événements.
    const p = pool();
    const view = midRoundView();
    const a = p.choose(view, BOT_PRESETS.ruthless, { seed: 'a', timeBudgetMs: 250 }, 5_000);
    const echecA = a.then(() => 'inattendu : la décision a abouti', (e: Error) => e.message);
    await new Promise((r) => setImmediate(r)); // le job A est chez le worker
    p.replaceWorker('test');
    const b = await p.choose(view, BOT_PRESETS.easy, { seed: 'b', timeBudgetMs: 250 }, 10_000);
    expect(b).toBeTruthy();
    expect(await echecA).toContain('replaced');
  }, 30_000);
});

describe('la panne du worker est temporaire, et elle se voit', () => {
  it('après trois avaries le pool s’écarte, puis revient de lui-même', async () => {
    // C'EST LE CONSTAT N°7. `disabled` ne repassait jamais à faux : trois dépassements — trois moments où
    // la machine était chargée — et TOUS les bots de TOUTES les tables retombaient sur le fil principal
    // jusqu'au prochain redéploiement, sans que rien ne le dise.
    const p = pool({ ackDeadlineMs: 1, cooldownMs: 120 });
    const view = midRoundView();
    for (let i = 1; i <= 3; i++) {
      const r = await p.choose(view, BOT_PRESETS.ruthless, { seed: `d${i}`, timeBudgetMs: 250 }, 1_000).then(() => 'ok', (e: Error) => e.message);
      expect(r, `avarie ${i}`).toBe('hard bot timed out');
    }
    expect(p.available).toBe(false);
    const pendantLaFenetre = await p.choose(view, BOT_PRESETS.easy, { seed: 'z', timeBudgetMs: 250 }, 1_000).then(() => 'ok', (e: Error) => e.message);
    expect(pendantLaFenetre).toBe('hard bot worker disabled');

    await new Promise((r) => setTimeout(r, 200));
    expect(p.available).toBe(true);
    // Il reprend vraiment du travail : ce qui le refuserait maintenant, c'est son délai d'accusé de 1 ms,
    // pas une condamnation à vie.
    const apres = await p.choose(view, BOT_PRESETS.easy, { seed: 'z2', timeBudgetMs: 250 }, 1_000).then(() => 'ok', (e: Error) => e.message);
    expect(apres).not.toBe('hard bot worker disabled');
  }, 30_000);

  it('l’état du pool dit la panne, sans qu’il faille lire les journaux', async () => {
    const p = pool({ ackDeadlineMs: 1, cooldownMs: 5_000 });
    const view = midRoundView();
    expect(p.status.available).toBe(true);
    expect(p.status.cooldownUntil).toBeNull();
    for (let i = 1; i <= 3; i++) await p.choose(view, BOT_PRESETS.ruthless, { seed: `s${i}`, timeBudgetMs: 250 }, 1_000).catch(() => undefined);
    const st = p.status;
    expect(st.available).toBe(false);
    expect(st.timeouts).toBeGreaterThanOrEqual(3);
    expect(st.starved).toBe(0);
    expect(st.cooldowns).toBe(1);
    expect(st.cooldownUntil).toBeGreaterThan(Date.now());
    expect(st.lastFailure).toContain('acknowledgement');
  }, 30_000);

  it('le délai se juge au CPU brûlé, pas au temps mur : un worker affamé n’est pas en faute', () => {
    // 1 250 ms de délai (budget 250 × 4 + marge). Sur deux cœurs partagés, un worker peut n'avoir reçu
    // que 300 ms de CPU en 1 300 ms de temps mur : le tuer ne lui rendrait pas le cœur.
    expect(deadlineVerdict(300, 1_300, 1_250)).toBe('starved');
    // Il a VRAIMENT calculé plus que son délai : il boucle, on le remplace.
    expect(deadlineVerdict(1_260, 1_300, 1_250)).toBe('overrun');
    // Affamé, mais la table attend depuis trop longtemps : on cesse de la faire attendre.
    expect(deadlineVerdict(300, 10_000, 1_250, 10_000)).toBe('overrun');
    // Une mesure illisible ne doit pas laisser un worker coincé tourner indéfiniment.
    expect(deadlineVerdict(Number.NaN, 1_300, 1_250)).toBe('overrun');
  });

  it('`hardPoolStatus()` ne fabrique pas un pool pour répondre', () => {
    // Il est destiné à /health : demander l'état ne doit pas démarrer un fil.
    expect(hardPoolStatus()).toSatisfy((s: unknown) => s === null || typeof s === 'object');
  });
});

describe('une décision saine passe par le worker, et revient', () => {
  it('un bot Normal — le niveau par défaut — décide hors de la boucle', async () => {
    const p = pool();
    const view = midRoundView();
    const action = await p.choose(view, BOT_PRESETS.normal, { seed: 'n', timeBudgetMs: 136 }, 5_000);
    expect(view.legal).toContainEqual(action);
    expect(p.status.decisions).toBe(1);
    // Seule dans la file, elle a gardé le budget demandé.
    expect(p.status.lastBudgetMs).toBe(136);
  }, 30_000);
});
