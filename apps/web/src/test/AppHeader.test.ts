// L'EN-TÊTE PERMANENT — les trois portes qui suivent le joueur d'un écran à l'autre.
//
// Ce que ces tests défendent, et pourquoi chacun compte :
//  1. il est VRAIMENT permanent — monté dans `<main>` au-dessus du `{#key screenKey}` qui démonte l'écran à
//     chaque navigation. Dedans, il repartirait en fondu à chaque route ET ses feuilles se refermeraient toutes
//     seules : un rapport de bug commencé dans le salon serait effacé par le lancement de la partie ;
//  2. il ne DOUBLE aucun son — les trois boutons ouvrent une feuille, et c'est la feuille qui sonne. Un clac de
//     planche par-dessus, ce serait deux sons pour un geste, ce que `data-clac="non"` existe pour empêcher ;
//  3. il tient sur un TÉLÉPHONE — trois cibles de 44 px, aucun libellé, une ligne. La table partage sa hauteur
//     au pixel et ne défile pas : un en-tête qui déborde pousse la main hors de l'écran ;
//  4. l'engrenage DIT SON ÉTAT — sans quoi couper le son revient à le perdre : plus rien ne sonne, et rien ne
//     dit que c'est voulu ;
//  5. il ne vole pas le titre de l'écran — `focusHeading` (E3) prend le premier `h1` de `<main>`, et l'en-tête
//     est devant tous les écrans.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le moteur du son est remplacé par un carnet : ces tests ne prouvent rien du graphe audio (`audio.test.ts` s'en
// charge), ils prouvent qu'UN geste ne fait qu'UN bruit. `vi.hoisted` : la fabrique tourne avant les `const`.
const { joues } = vi.hoisted(() => ({ joues: [] as string[] }));
vi.mock('../lib/audio.svelte', async (vrai) => ({
  ...(await vrai<typeof import('../lib/audio.svelte')>()),
  play: (slot: string) => void joues.push(slot),
}));

import AppHeader from '../components/AppHeader.svelte';
import { oublierLesFeuilles } from '../components/Sheet.svelte';
import { audio, setReglage } from '../lib/audio.svelte';
import { closeCodex, codex } from '../lib/codex.svelte';
import { defaultRules } from '../lib/presets';
import { attach, detach, game, setMyName, type BotLevelTag, type GameTransport } from '../lib/store.svelte';
import type { PlayerId, PlayerView } from '../lib/types';
import { route } from '../lib/router.svelte';

/** Un tour de boucle : les sons des feuilles sont résolus en fin de tour (un relais ne fait qu'un son). */
const tour = () => new Promise((r) => setTimeout(r, 0));

/** Un transport muet : rien ici n'attend une partie qui vit, seulement une table OCCUPÉE. */
const transport = (): GameTransport => ({ send: () => {}, onView: () => () => {} });

/** Une vue de partie réduite à ce qui compte ici : il y a une partie, donc on ne peut pas quitter la table. */
function vue(): PlayerView {
  const players: PlayerId[] = ['me', 'p1', 'p2'];
  const zero = Object.fromEntries(players.map((p) => [p, 0])) as Record<PlayerId, number>;
  return {
    me: 'me',
    players,
    round: 3,
    dealer: 'p1',
    phase: 'playing',
    hand: [],
    handCounts: zero,
    bids: Object.fromEntries(players.map((p) => [p, null])) as Record<PlayerId, number | null>,
    tricksWonCount: zero,
    trick: { leader: 'me', plays: [] },
    currentPlayer: 'me',
    scores: zero,
    roundScores: [],
    lastRoundScores: [],
    legal: [],
    pending: null,
    pendingAbilities: [],
    forcedPlays: {},
    history: [],
    lootAlliances: [],
    rules: defaultRules(10),
    passPending: [],
    myPassed: false,
  };
}

/** Assied une partie : à partir de là, l'app est « en partie ». */
function enPartie() {
  const bots: Record<PlayerId, BotLevelTag> = {};
  attach(transport(), 'offline', { names: {}, bots });
  game.view = vue();
}

beforeEach(() => {
  joues.length = 0;
  localStorage.clear();
  setMyName('Alix');
  // Les réglages du son vivent dans le module, pas dans l'instance : sans remise à zéro, un test hériterait
  // du volume (ou du muet) laissé par le précédent.
  setReglage('muet', false);
  setReglage('effets', 0.9);
  setReglage('musique', 0.55);
  closeCodex();
  oublierLesFeuilles();
  route.name = 'home';
});
afterEach(() => {
  detach();
  route.name = 'home';
  location.hash = '#/';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('la navigation pendant une partie en portrait', () => {
  function portraitGame() {
    vi.stubGlobal('matchMedia', vi.fn((media: string) => ({
      media, matches: media.includes('max-width: 600px'), onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    })));
    enPartie();
    route.name = 'table';
    return render(AppHeader);
  }

  it('garde Réglages et Codex visibles, et rassemble les autres actions dans une feuille', async () => {
    portraitGame();
    await tick();
    expect([...screen.getByTestId('app-header').querySelectorAll('button')].map(b => b.dataset.testid))
      .toEqual(['reglages-open', 'codex-open', 'game-menu-open']);
    expect(screen.queryByTestId('help')).toBeNull();
    expect(screen.queryByTestId('report-open')).toBeNull();
    expect(screen.queryByTestId('quit')).toBeNull();
    await fireEvent.click(screen.getByTestId('game-menu-open'));
    expect(screen.getByTestId('game-menu-sheet')).toHaveAttribute('role', 'dialog');
    expect(screen.getByTestId('game-menu-open')).toHaveAttribute('aria-expanded', 'true');
    for (const id of ['help', 'report-open', 'quit']) expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  it.each([
    ['help', 'help-sheet'],
    ['report-open', 'report-sheet'],
  ])('ouvre %s en refermant le menu', async (action, sheet) => {
    portraitGame();
    await tick();
    await fireEvent.click(screen.getByTestId('game-menu-open'));
    await fireEvent.click(screen.getByTestId(action));
    expect(screen.queryByTestId('game-menu-sheet')).toBeNull();
    expect(screen.getByTestId(sheet)).toBeInTheDocument();
    expect(screen.getByTestId('game-menu-open')).toHaveAttribute('aria-expanded', 'false');
  });

  it('demande la confirmation de sortie via le même état que le bouton desktop', async () => {
    portraitGame();
    await tick();
    game.quitPrompt = false;
    await fireEvent.click(screen.getByTestId('game-menu-open'));
    await fireEvent.click(screen.getByTestId('quit'));
    expect(screen.queryByTestId('game-menu-sheet')).toBeNull();
    expect(game.quitPrompt).toBe(true);
    game.quitPrompt = false;
  });

  it('Échap referme le menu et rend le focus à son bouton', async () => {
    portraitGame();
    await tick();
    const button = screen.getByTestId('game-menu-open');
    button.focus();
    await fireEvent.click(button);
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('game-menu-sheet')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('garde les cinq raccourcis directs sur desktop', () => {
    enPartie();
    route.name = 'table';
    render(AppHeader);
    expect([...screen.getByTestId('app-header').querySelectorAll('button')].map(b => b.dataset.testid))
      .toEqual(['reglages-open', 'codex-open', 'report-open', 'help', 'quit']);
  });
});

// ---------------------------------------------------------------------------

describe('les trois portes', () => {
  it('sont là, dans l’ordre annoncé, et chacune se nomme', () => {
    render(AppHeader);
    const boutons = [...screen.getByTestId('app-header').querySelectorAll('.portes button')];
    expect(boutons.map((b) => (b as HTMLElement).dataset.testid)).toEqual(['reglages-open', 'codex-open', 'report-open']);
    expect(boutons[0]).toHaveAccessibleName('Réglages');
    expect(boutons[1]).toHaveAccessibleName('Codex des cartes');
    expect(boutons[2]).toHaveAccessibleName('Un bug ? Une idée ?');
  });

  it('tiennent sur un téléphone : trois cibles de 44 px, aucun libellé, une seule ligne', () => {
    render(AppHeader);
    for (const b of screen.getByTestId('app-header').querySelectorAll('.portes button')) {
      // `.icon-btn` fait 2,75 rem — la cible tactile minimale, celle des boutons de la barre de la table.
      expect(b).toHaveClass('icon-btn');
      // Aucun texte : un libellé ferait une deuxième ligne, et la table n'a pas cette hauteur à donner.
      expect(b.textContent?.trim()).toBe('');
    }
  });

  it('ne volent pas le titre de l’écran : aucun titre ici (E3)', () => {
    render(AppHeader);
    // `focusHeading` prend le PREMIER `h1` de `<main>` à chaque changement d'écran, et l'en-tête est devant
    // tous les écrans : un titre ici prendrait le focus à la place de « Ta salle », « Manche 3 », etc.
    expect(screen.getByTestId('app-header').querySelector('h1, h2, h3')).toBeNull();
  });
});

describe('un geste, un son', () => {
  it('les trois boutons se taisent : c’est la feuille qui a la voix', async () => {
    render(AppHeader);
    for (const b of screen.getByTestId('app-header').querySelectorAll('button')) {
      expect(b).toHaveAttribute('data-clac', 'non');
    }
    joues.length = 0;
    // L'appui PUIS le clic : le clac de planche part au `pointerdown`, l'ouverture au `click`.
    const engrenage = screen.getByTestId('reglages-open');
    await fireEvent.pointerDown(engrenage);
    await fireEvent.click(engrenage);
    await tour();
    expect(joues).toEqual(['panneau-ouvre']);
  });
});

describe('l’engrenage', () => {
  it('dit que le son est coupé sans qu’on ait à ouvrir la feuille', async () => {
    render(AppHeader);
    const engrenage = screen.getByTestId('reglages-open');
    expect(screen.queryByTestId('reglages-muet-pastille')).toBeNull();

    setReglage('muet', true);
    await tick();
    // Deux fois plutôt qu'une : la pastille pour l'œil, le nom accessible pour qui ne la voit pas.
    expect(screen.getByTestId('reglages-muet-pastille')).toBeInTheDocument();
    expect(engrenage).toHaveAccessibleName('Réglages — son coupé');

    setReglage('muet', false);
    await tick();
    expect(screen.queryByTestId('reglages-muet-pastille')).toBeNull();
    expect(engrenage).toHaveAccessibleName('Réglages');
  });

  it('ouvre les DEUX curseurs — les seuls de l’app —, le muet et l’essayage', async () => {
    render(AppHeader);
    await fireEvent.click(screen.getByTestId('reglages-open'));
    const feuille = screen.getByTestId('reglages-sheet');
    // Deux, pas trois : un « volume général » par-dessus les deux autres ne dit rien de plus qu'eux réunis et
    // les fait mentir. L'égalité stricte tient ce choix : un curseur de plus le casse.
    expect(feuille.querySelectorAll('input[type="range"]')).toHaveLength(2);
    expect(screen.queryByTestId('reglages-son-curseur-maitre')).toBeNull();

    await fireEvent.input(screen.getByTestId('reglages-son-curseur-musique'), { target: { value: '30' } });
    expect(audio.settings.musique).toBeCloseTo(0.3, 5);
    expect(screen.getByTestId('reglages-son-valeur-musique')).toHaveTextContent('30 %');

    await fireEvent.input(screen.getByTestId('reglages-son-curseur-effets'), { target: { value: '70' } });
    expect(audio.settings.effets).toBeCloseTo(0.7, 5);
    expect(screen.getByTestId('reglages-son-valeur-effets')).toHaveTextContent('70 %');
    // Les deux voies sont SÉPARÉES : régler l'une ne déplace pas l'autre.
    expect(audio.settings.musique).toBeCloseTo(0.3, 5);

    await fireEvent.click(screen.getByTestId('reglages-son-muet'));
    expect(audio.settings.muet).toBe(true);
  });

  it('ne propose l’essayage des sons QU’HORS partie (à table, il ouvrirait « Quitter la table ? »)', async () => {
    render(AppHeader);
    await fireEvent.click(screen.getByTestId('reglages-open'));
    expect(screen.getByTestId('reglages-son-essayage')).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId('reglages-son-essayage'));
    // Il y va vraiment, et il referme la feuille derrière lui : l'en-tête ne se remonte pas à la navigation,
    // donc personne d'autre ne la fermerait.
    expect(location.hash).toBe('#/son');
    expect(screen.queryByTestId('reglages-sheet')).toBeNull();

    enPartie();
    await fireEvent.click(screen.getByTestId('reglages-open'));
    expect(screen.getByTestId('reglages-sheet')).toBeInTheDocument();
    expect(screen.queryByTestId('reglages-son-essayage')).toBeNull();
  });
});

describe('le codex et le signalement', () => {
  it('le codex s’ouvre depuis n’importe quel écran, plus seulement depuis les deux salons', async () => {
    render(AppHeader);
    expect(codex.open).toBe(false);
    await fireEvent.click(screen.getByTestId('codex-open'));
    expect(codex.open).toBe(true);
  });

  it('le signalement s’ouvre en un geste, sans passer par les règles', async () => {
    render(AppHeader);
    await fireEvent.click(screen.getByTestId('report-open'));
    expect(screen.getByTestId('report-sheet')).toBeInTheDocument();
    // Le pseudo est déjà là : personne ne retape son nom pour signaler un bug.
    expect(screen.getByTestId('report-nom')).toHaveValue('Alix');
  });
});

// ---------------------------------------------------------------------------
// La permanence se lit dans `App.svelte`, pas dans le composant : c'est SA PLACE qui la donne. Un en-tête
// identique posé DANS le `{#key screenKey}` passerait tous les tests ci-dessus et ne serait pas permanent.

describe('permanent, et pas seulement présent', () => {
  const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../App.svelte'), 'utf8');
  /** Sans ses commentaires de balisage : un commentaire QUI PARLE du `{#key}` n'est pas le `{#key}`. */
  const app = source.replace(/<!--[\s\S]*?-->/g, '');

  it('est monté DANS <main>, au-dessus du {#key} qui remonte les écrans', () => {
    const debutMain = app.indexOf('<main');
    const entete = app.indexOf('<AppHeader />');
    const cle = app.indexOf('{#key screenKey}');
    const finMain = app.indexOf('</main>');
    expect(debutMain).toBeGreaterThan(-1);
    expect(cle).toBeGreaterThan(-1);
    // Dans `<main>` : sous l'encoche (`safe-area-inset-top`) et dans la colonne du jeu, pas par-dessus.
    expect(entete).toBeGreaterThan(debutMain);
    expect(entete).toBeLessThan(finMain);
    // Au-dessus du `{#key}` : c'est CE bloc qui démonte l'écran à chaque route. Dedans, l'en-tête repartirait
    // en fondu à chaque navigation et ses feuilles se refermeraient toutes seules.
    expect(entete).toBeLessThan(cle);
  });

  it('descend avec le premier rendu : il est là avant l’écran, pas après un aller-retour', () => {
    expect(source).toMatch(/^\s*import AppHeader from '\.\/components\/AppHeader\.svelte';$/m);
  });
});
