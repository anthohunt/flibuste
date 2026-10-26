// « J'ai rejoint une game en cours solo, que j'avais fini le round, et je me suis retrouvé sur un écran figé,
// impossible d'avancer au prochain round. »
//
// Ce fichier attaque le symptôme par la MACHINE À ÉTATS, et il pose la question dans l'ordre où elle se
// décide, en trois marches — parce qu'un écran figé peut venir de trois endroits différents et qu'on ne sait
// lequel accuser tant qu'on n'a pas éliminé les deux autres :
//
//   1. LE MOTEUR — existe-t-il une phase atteignable dont aucune action légale ne fait sortir ? (énumération)
//   2. LE MOTEUR HORS-LIGNE — après un rechargement, la boucle qui fait jouer les bots redémarre-t-elle ?
//      (un écran sans rien à cliquer, c'est la signature d'un bot qui ne joue plus)
//   3. L'ÉCRAN — la reprise dépose-t-elle le joueur là où la phase l'exige ?
//
// Les deux premières marches doivent PASSER : elles disculpent le moteur et les bots. La troisième échoue, et
// c'est elle qui nomme la cause.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `Home.svelte` joue un son à la reprise. Un graphe audio dans jsdom n'a rien à prouver ici, et son absence
// ferait échouer le test pour une raison qui n'est pas la nôtre.
vi.mock('../lib/audio.svelte', async (vrai) => ({
  ...(await vrai<typeof import('../lib/audio.svelte')>()),
  play: () => {},
  music: { start: () => {}, stop: () => {}, joue: false, variante: 'taverne' as const, setVariante: () => {} },
}));

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import {
  EXPANSION_ALL,
  CUSTOM_ALL,
  actorsOf,
  apply,
  legalActions,
  makeRng,
  newGame,
  type Action,
  type GameState,
  type Phase,
  type PlayerId,
  type Rules,
} from '@flibuste/engine';
import Home from '../routes/Home.svelte';
import { OfflineGame, soloSetup, type OfflineSetup } from '../lib/offline';
import { createBotRunner } from '../lib/botRunner';
import { randomChooseAction } from '../lib/randomBot';
import { bootstrap, detach, game, screenFor, timing } from '../lib/store.svelte';
import { route, startRouter } from '../lib/router.svelte';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bots sans délai ni Worker : le test mesure la MÉCANIQUE de reprise, pas le rythme « humain » des bots. */
const fast = () => ({ botDelay: [0, 0] as [number, number], runner: createBotRunner({ worker: false }) });

/** Toutes les cartes allumées : c'est la seule façon d'atteindre `volley`, `ability` et `pass` en énumérant. */
function reglesCompletes(rounds: number): Rules {
  return { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds, expansion: { ...EXPANSION_ALL }, custom: { ...CUSTOM_ALL } };
}

function tableSolo(seed: string, rounds: number): OfflineSetup {
  return soloSetup({
    myName: 'Moi',
    bots: [
      { name: 'A', level: 'easy' },
      { name: 'B', level: 'easy' },
      { name: 'C', level: 'easy' },
    ],
    rules: reglesCompletes(rounds),
    seed,
  });
}

describe('la machine à états : quel état atteignable n’a pas de sortie', () => {
  /**
   * MARCHE 1 — le moteur seul, sans interface, sans bots, sans minuterie.
   *
   * On joue des parties entières en ne prenant QUE des actions que le moteur déclare légales, et à chaque état
   * traversé on exige qu'au moins un acteur puisse en sortir. `gameOver` est la seule sortie absente, et c'est
   * voulu : c'est l'état terminal.
   *
   * Pourquoi l'énumération plutôt qu'un raisonnement : les gardes qui empêchent un pouvoir sans choix possible
   * (Orsolo avec moins de 2 cartes au talon, Mathilde sans cible, Maren sans personne pour mener, la Planche avec un
   * seul pirate) sont dans `triggerAbility`, loin de `legalActions` — seule l'exécution prouve qu'elles tiennent.
   */
  it('aucune phase atteignable n’est un cul-de-sac pour le moteur', () => {
    const vues = new Map<Phase, number>();
    for (let n = 0; n < 40; n++) {
      const seed = `enumeration-${n}`;
      const joueurs: PlayerId[] = ['me', 'bot:1', 'bot:2', 'bot:3'];
      let s: GameState = newGame(joueurs, reglesCompletes(4), seed);
      let coup = 0;
      while (s.phase !== 'gameOver') {
        vues.set(s.phase, (vues.get(s.phase) ?? 0) + 1);
        // La question exacte : quelqu'un peut-il agir ? `actorsOf` dit QUI le moteur attend ; `legalActions`
        // dit s'il a de quoi jouer. Un acteur attendu sans action légale, c'est le gel.
        const acteurs = actorsOf(s);
        const avecSortie = acteurs.filter((p) => legalActions(s, p).length > 0);
        expect(avecSortie.length, `phase « ${s.phase} » (manche ${s.round}, graine ${seed}) : ${acteurs.length} acteur(s) attendu(s), aucun ne peut jouer`).toBeGreaterThan(0);
        // On tire au sort parmi les actions légales, avec la graine du moteur : l'énumération est reproductible,
        // et un échec se rejoue à l'identique.
        const acteur = avecSortie[0] as PlayerId;
        const legales = legalActions(s, acteur);
        const rng = makeRng(`${seed}:${coup}`);
        s = apply(s, legales[Math.floor(rng() * legales.length)] as Action);
        if (++coup > 4000) throw new Error(`partie qui ne finit pas (graine ${seed})`);
      }
      vues.set('gameOver', (vues.get('gameOver') ?? 0) + 1);
    }
    // Le constat ne vaut que si l'énumération a bien VU les phases rares : sans elles, le test dirait « aucun
    // cul-de-sac » en n'ayant visité que `bidding` et `playing`.
    for (const phase of ['bidding', 'playing', 'ability', 'pass', 'volley', 'roundEnd', 'gameOver'] as Phase[]) {
      expect(vues.get(phase) ?? 0, `phase « ${phase} » jamais atteinte : l'énumération ne prouve rien à son sujet`).toBeGreaterThan(0);
    }
  });

  /**
   * MARCHE 2 — l'hypothèse « les bots ne redémarrent pas après un rechargement ».
   *
   * On coupe l'onglet à l'instant précis où c'est à un bot de jouer (moi je n'ai plus aucune action légale),
   * puis on reprend la sauvegarde et on n'y touche plus. Si la boucle des bots ne redémarrait pas, la partie
   * resterait exactement où on l'a laissée : c'est ce que ce test refuse.
   */
  it('reprise alors que c’est à un bot de jouer : la partie avance toute seule', async () => {
    localStorage.clear();
    const g = new OfflineGame(tableSolo('bot-a-jouer', 3), [], fast());
    // On joue MES coups jusqu'au premier instant où, EN PLEIN PLI, la main est à quelqu'un d'autre. Une main
    // vide pendant les annonces ne compte pas : là, tout le monde annonce en même temps et personne n'est
    // « attendu » au sens d'un pli. C'est bien la carte due par un bot qu'on veut voir en travers de la reprise.
    // La sauvegarde est écrite par `send` lui-même : couper juste après, c'est couper sur cet état-là.
    let coup = 0;
    const tDebut = Date.now();
    while (!(g.phase === 'playing' && g.view().legal.length === 0)) {
      if (Date.now() - tDebut > 5000) throw new Error(`jamais arrivé à un tour de bot (phase ${g.phase})`);
      const v = g.view();
      if (v.legal.length > 0) g.send(randomChooseAction(v, 'easy', { seed: `me:${coup++}` }));
      else await sleep(1); // ce n'est pas à moi : on laisse les bots avancer
    }
    const journalAvant = g.log.length;
    const vueAvant = g.view();
    expect(vueAvant.currentPlayer).not.toBe('me');
    g.close(); // l'onglet se ferme, la sauvegarde reste

    const r = OfflineGame.resume(fast());
    expect(r).not.toBeNull();
    const repris = r as OfflineGame;
    expect(repris.log.length, 'le rejeu doit rendre le même journal').toBe(journalAvant);
    // On n'envoie RIEN. Si les bots reprennent la main, le journal grossit tout seul.
    const t0 = Date.now();
    while (repris.log.length === journalAvant && Date.now() - t0 < 2000) await sleep(5);
    expect(repris.log.length, 'après la reprise, le bot attendu n’a jamais joué : la boucle des bots n’a pas redémarré').toBeGreaterThan(journalAvant);
    repris.close();
    localStorage.clear();
  });

  /**
   * MARCHE 3 — l'écran.
   *
   * `roundEnd` est la SEULE phase non terminale dont le moteur hors-ligne refuse délibérément de prendre la
   * sortie : `OfflineGame.tick` s'arrête net (« Manche suivante » appartient à l'humain). Sa sortie unique est
   * donc un geste humain — et ce geste n'existe que sur UN écran, celui des scores (`data-testid="next-round"`,
   * `RoundScore.svelte`). Aucune vue nouvelle n'arrivera après pour rattraper un écran mal choisi : ce qu'on
   * monte à cet instant est ce qu'on regarde jusqu'au bout.
   *
   * L'invariant que ce test défend est donc celui de la machine à états, pas celui d'un bouton :
   * l'écran affiché doit être celui que la phase impose (`screenFor`).
   */
  describe('reprise en fin de manche par le vrai geste de l’accueil', () => {
    let arret: (() => void) | null = null;
    beforeEach(() => {
      localStorage.clear();
      location.hash = '#/';
      // La pause de fin de pli retient la VUE, pas la sauvegarde : on la met à zéro pour que le store ait fini
      // de basculer avant qu'on coupe l'onglet.
      timing.trickPause = 0;
      timing.trickPauseLast = 0;
    });
    afterEach(() => {
      arret?.();
      arret = null;
      detach();
      localStorage.clear();
      location.hash = '#/';
      timing.trickPause = 2600;
      timing.trickPauseLast = 3200;
    });

    it('dépose le joueur sur l’écran que la phase impose', async () => {
      const g = new OfflineGame(tableSolo('fin-de-manche', 3), [], fast());
      let coup = 0;
      const t0 = Date.now();
      while (g.phase !== 'roundEnd') {
        if (Date.now() - t0 > 5000) throw new Error(`timeout en phase ${g.phase}`);
        const v = g.view();
        if (v.legal.length > 0) g.send(randomChooseAction(v, 'easy', { seed: `me:${coup++}` }));
        else await sleep(1);
      }
      g.close(); // l'onglet se ferme sur une manche finie, la sauvegarde reste

      // On revient sur l'accueil et on refait LE geste : « Reprendre le solo ».
      arret = startRouter();
      render(Home);
      await fireEvent.click(await screen.findByTestId('resume-solo'));
      await tick();
      // `location.hash = …` ne prévient les écouteurs de `hashchange` qu'à la tâche suivante (jsdom comme le
      // navigateur) : sans ce tour de boucle, `route` serait en retard pour une raison de minutage et l'échec
      // parlerait de la mauvaise chose.
      await sleep(0);

      const phase = game.view?.phase;
      expect(phase, 'la sauvegarde reprise doit bien être une fin de manche').toBe('roundEnd');
      // Le store, lui, sait où l'on devrait être.
      expect(game.screen).toBe(screenFor('roundEnd'));
      // L'INVARIANT : l'écran monté (celui du hash) est celui que la phase impose. C'est ici que ça casse.
      expect(route.name, `phase « ${phase} » → écran « ${screenFor(phase as Phase)} », mais la reprise a navigué vers « ${route.name} »`).toBe(screenFor(phase as Phase));
    });

    /**
     * Le discriminant, et la raison pour laquelle le correctif ne va PAS dans le store.
     *
     * L'autre porte d'entrée d'une sauvegarde est `bootstrap()` : un vrai F5 sur une URL de partie. Elle
     * guérit toute seule — `applyView` navigue vers l'écran de la phase parce qu'on vient DÉJÀ d'une route de
     * partie. Deux portes, la même sauvegarde, deux issues : ce n'est donc ni la sauvegarde ni la machine à
     * états qui gèle, c'est la porte de l'accueil, qui vise un écran en dur.
     */
    it('mais un vrai F5 sur une URL de partie, lui, corrige l’écran tout seul', async () => {
      const g = new OfflineGame(tableSolo('fin-de-manche-f5', 3), [], fast());
      let coup = 0;
      const t0 = Date.now();
      while (g.phase !== 'roundEnd') {
        if (Date.now() - t0 > 5000) throw new Error(`timeout en phase ${g.phase}`);
        const v = g.view();
        if (v.legal.length > 0) g.send(randomChooseAction(v, 'easy', { seed: `me:${coup++}` }));
        else await sleep(1);
      }
      g.close();
      detach();

      // Le rechargement : l'URL pointe encore sur la table (le dernier écran vu), et `App.svelte` appelle
      // `bootstrap()`, qui reprend la sauvegarde sans passer par l'accueil.
      location.hash = '#/table';
      arret = startRouter();
      bootstrap();
      await sleep(0);
      expect(game.view?.phase).toBe('roundEnd');
      expect(route.name, 'un F5 mène bien à l’écran des scores : la sauvegarde et le store savent où aller').toBe('score');
    });
  });
});
