// Le son de la table : ce qui le déclenche, et surtout ce qui ne le déclenche pas.
//
// Le moteur du son est remplacé ici par un carnet : ces tests ne prouvent rien du graphe audio (`audio.test.ts`
// s'en charge), ils prouvent le BRANCHEMENT — le son part là où l'événement est CONSTATÉ (le geste, la vue, le pli
// figé du store), jamais là où il est dessiné. C'est la seule chose qu'un remontage de composant peut casser sans
// qu'aucun autre test ne bronche : le bandeau du verdict qui remonte rejouerait le pli, et personne ne le verrait.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import ThemedSelectLayer from '../components/ThemedSelectLayer.svelte';
import { oublierLesFeuilles } from '../components/Sheet.svelte';
import { chooseOption } from './themedSelect';
import Table, { oublierLeSon } from '../routes/Table.svelte';
import Timer, { oublierLUrgence } from '../components/Timer.svelte';
import { attach, detach, game, timing, type GameTransport } from '../lib/store.svelte';
import { online } from '../lib/online.svelte';
import type { Action, Card, PlayerId, PlayerView, TrickRecord } from '../lib/types';

// `vi.hoisted` : la fabrique du faux module tourne au premier `import` de la table, donc AVANT l'initialisation
// des `const` de ce fichier — le carnet doit exister plus tôt que lui.
const { joues } = vi.hoisted(() => ({ joues: [] as { slot: string; at?: number }[] }));
vi.mock('../lib/audio.svelte', async (vrai) => ({
  ...(await vrai<typeof import('../lib/audio.svelte')>()),
  play: (slot: string, opts?: { at?: number }) => void joues.push({ slot, at: opts?.at }),
}));

const slots = () => joues.map((j) => j.slot);

const PARROT3: Card = { id: 'parrot-3', kind: 'number', suit: 'parrot', rank: 3 };
const MAP5: Card = { id: 'map-5', kind: 'number', suit: 'map', rank: 5 };
const ESCAPE: Card = { id: 'escape-1', kind: 'escape' };
const WILD15: Card = { id: 'wild15', kind: 'wild15' };
const FLIBUSTE: Card = { id: 'pirateking', kind: 'pirateking' };
const TIGRESS: Card = { id: 'tigress', kind: 'tigress' };
const KRAKEN: Card = { id: 'kraken', kind: 'kraken' };
const WHALE: Card = { id: 'whale', kind: 'whale' };
const LOOT: Card = { id: 'loot-1', kind: 'loot' };

const PLAYERS: PlayerId[] = ['me', 'p1', 'p2'];
const NAMES: Record<PlayerId, string> = { me: 'Alix', p1: 'Barbe-Noire', p2: 'Anne Bonny' };
const zero = () => Object.fromEntries(PLAYERS.map((p) => [p, 0])) as Record<PlayerId, number>;

/** Une vue de table ordinaire : trois joueurs, trois cartes en main, c'est à un adversaire de jouer. */
function vue(patch: Partial<PlayerView> = {}): PlayerView {
  return {
    me: 'me',
    players: PLAYERS,
    round: 3,
    dealer: 'p1',
    phase: 'playing',
    hand: [PARROT3, ESCAPE, MAP5],
    handCounts: { me: 3, p1: 3, p2: 3 },
    bids: { me: 1, p1: 1, p2: 1 },
    tricksWonCount: zero(),
    trick: { leader: 'p1', plays: [] },
    currentPlayer: 'p1',
    scores: zero(),
    roundScores: [],
    lastRoundScores: [],
    legal: [],
    pending: null,
    pendingAbilities: [],
    forcedPlays: {},
    history: [],
    lootAlliances: [],
    rules: { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 5 },
    passPending: [],
    myPassed: false,
    ...patch,
  } as PlayerView;
}

const pli = (patch: Partial<TrickRecord>): TrickRecord => ({ leader: 'p1', plays: [], winner: null, captured: [], kraken: false, whale: false, ...patch }) as TrickRecord;

function transport(): GameTransport & { sent: Action[] } {
  const sent: Action[] = [];
  return { sent, send: (a) => void sent.push(a), onView: () => () => {} };
}

/** Monte la table sur une vue de départ. Le montage ne doit RIEN jouer : c'est la première assertion partout. */
function table(v: PlayerView = vue()) {
  attach(transport(), 'offline', { names: NAMES });
  game.view = v;
  const rendu = render(Table);
  expect(slots(), 'le montage ne rejoue rien').toEqual([]);
  return {
    ...rendu,
    carte: (id: string) => rendu.container.querySelector(`button[data-card-id="${id}"]`) as HTMLElement,
    /** Pose une nouvelle vue, comme le fait `applyView`, et laisse les effets tourner. */
    voir: async (patch: Partial<PlayerView>) => {
      game.view = vue({ ...v, ...patch });
      await tick();
    },
  };
}

/** jsdom n'a pas `PointerEvent` : on greffe les champs de pointeur sur un `MouseEvent`, comme `HandGestures`. */
function doigt(el: Element) {
  const ev = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 400 });
  Object.assign(ev, { pointerId: 1, pointerType: 'touch', isPrimary: true });
  return fireEvent(el, ev);
}

/** Le doigt se relève sans avoir glissé : `Hand.up()` rend alors la main au `click`, qui sélectionne. */
function releve(el: Element) {
  const ev = new MouseEvent('pointerup', { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 400 });
  Object.assign(ev, { pointerId: 1, pointerType: 'touch', isPrimary: true });
  return fireEvent(el, ev);
}

/** Le tap complet d'une carte, tel qu'un doigt le produit : poser, relever, et le clic que le navigateur émet. */
async function tapCarte(el: Element) {
  await doigt(el);
  await releve(el);
  await fireEvent.click(el);
}

beforeEach(() => {
  oublierLesFeuilles();
  joues.length = 0;
  // La mémoire du son vit hors des instances (elle doit survivre au démontage de la table entre deux manches) :
  // un test qui ne l'oublie pas hériterait des clés du précédent. Le chrono a la sienne, pour la même raison.
  oublierLeSon();
  oublierLUrgence();
});
afterEach(() => {
  detach();
  game.shownTrick = null;
  game.verdict = null;
  online.conn = 'closed';
  online.superseded = false;
  vi.useRealTimers();
});

describe('Le son de la table — le geste', () => {
  it('le doigt posé lève la carte et sonne, même sur une carte injouable', async () => {
    const t = table();
    await doigt(t.carte('escape-1'));
    expect(slots()).toEqual(['carte-levee']);
  });

  it('ma carte sonne sous mon doigt puis à la confirmation, et la vue ne la fait pas tomber une seconde fois', async () => {
    // Refonte amont : la carte se joue en DEUX temps — le premier tap SÉLECTIONNE (`Hand` reçoit
    // `confirmSelection`, `Table.selectCard` ne fait que retenir l'identifiant), le bouton « Jouer cette carte »
    // CONFIRME et envoie. Aucun son n'a changé de sens pour autant, et c'est ce que ce test tient : le frottement
    // du carton reste au DOIGT POSÉ (`Hand.down`), la pose reste à l'instant où la carte QUITTE la main, et le
    // temps ajouté entre les deux est muet — le redire là le bégaierait.
    const t = table(vue({ currentPlayer: 'me', legal: [{ type: 'play', player: 'me', cardId: 'parrot-3' }] }));
    await tapCarte(t.carte('parrot-3'));
    expect(slots(), 'sélectionner n’est pas poser : un seul frottement, celui du doigt').toEqual(['carte-levee']);
    await fireEvent.click(t.getByTestId('confirm-card'));
    expect(slots()).toEqual(['carte-levee', 'carte-posee-moi']);
    // La même carte revient par la vue (le serveur confirme) et la main passe au suivant : elle est déjà tombée.
    joues.length = 0;
    await t.voir({ currentPlayer: 'p1', legal: [], trick: { leader: 'p1', plays: [{ player: 'me', card: PARROT3 }] } });
    expect(slots()).toEqual([]);
  });

  it('ma Fuite s’annonce juste avant de tomber, jamais dessus — et jamais à la sélection', async () => {
    // La pose en deux temps (cf. plus haut) déplace le moment de l'envoi, pas celui de l'annonce : ce que la carte
    // DIT en tombant tient toujours à sa pose, un pas de salve devant elle. Le premier tap, lui, ne renonce à
    // rien encore — annoncer la fuite là la dirait d'une carte qu'on peut encore reposer.
    const t = table(vue({ currentPlayer: 'me', legal: [{ type: 'play', player: 'me', cardId: 'escape-1' }] }));
    await fireEvent.click(t.carte('escape-1'));
    expect(slots(), 'rien n’est encore renoncé : la sélection est muette').toEqual([]);
    await fireEvent.click(t.getByTestId('confirm-card'));
    expect(joues).toEqual([
      { slot: 'fuite', at: undefined },
      { slot: 'carte-posee-moi', at: 1 },
    ]);
  });

  it.each([
    { card: { id: 'pirate-helm', kind: 'pirate', pirate: 'helm' } as Card, signature: 'lame-tiree' },
    { card: KRAKEN, signature: 'kraken-pose' },
    { card: WHALE, signature: 'baleine-pose' },
    { card: FLIBUSTE, signature: 'roi-flibustiers' },
    { card: { id: 'mermaid-1', kind: 'mermaid' } as Card, signature: 'sirene-capture' },
  ])('$signature : uniquement à la pose confirmée, jamais sélection/écho/verdict', async ({ card, signature }) => {
    const t = table(vue({ hand: [card], currentPlayer: 'me', legal: [{ type: 'play', player: 'me', cardId: card.id }] }));
    await fireEvent.click(t.carte(card.id));
    expect(slots()).not.toContain(signature);
    await fireEvent.click(t.getByTestId('confirm-card'));
    expect(slots().filter(x => x === signature)).toHaveLength(1);
    const plays = [{ player: 'me' as PlayerId, card }];
    await t.voir({ currentPlayer: 'p1', legal: [], trick: { leader: 'me', plays } });
    game.shownTrick = pli({ leader: 'me', winner: card.kind === 'kraken' ? null : 'me', kraken: card.kind === 'kraken', whale: card.kind === 'whale', plays });
    await tick();
    expect(slots().filter(x => x === signature)).toHaveLength(1);
  });

  it('le pari posé sonne UNE fois, à l’envoi — sur le feutre comme dans la colonne', async () => {
    // Refonte amont : la feuille de pari est redescendue au CENTRE du feutre (`.central-bid`), où elle prend la
    // forme « un chiffre, puis Annoncer » ; la grille de touches, elle, ne sert plus qu'en police agrandie, dans
    // la colonne du bas. Deux emplacements, deux formes — mais un seul chemin, `poserPari`, donc exactement un
    // `pari-pose` par pari ENVOYÉ, et rien tant qu'il ne l'est pas. C'est cette garantie-là que le test tenait,
    // et elle vaut maintenant pour les deux feuilles : le chemin ne doit plus décider de ce qu'on entend.
    const parier = (): PlayerView => vue({ phase: 'bidding', bids: { me: null, p1: 1, p2: 1 }, currentPlayer: null, legal: [{ type: 'bid', player: 'me', value: 2 }] });

    render(ThemedSelectLayer);
    const t = table(parier());
    await chooseOption(t.getByTestId('bid-value'), '2');
    expect(slots(), 'le chiffre choisi n’est pas un pari posé : rien n’est parti').not.toContain('pari-pose');
    await fireEvent.click(t.getByTestId('bid-confirm'));
    expect(slots().filter((slot) => slot === 'pari-pose')).toEqual(['pari-pose']);
    t.unmount();

    // Police agrandie (`strip`) : la feuille remonte dans la colonne et redevient une grille de touches — là, le
    // tap choisit ET envoie d'un seul geste, et cela doit s'entendre exactement pareil.
    joues.length = 0;
    document.documentElement.style.fontSize = '24px';
    try {
      game.view = parier();
      const grille = render(Table);
      await tick();
      expect(slots(), 'le montage ne rejoue rien').toEqual([]);
      const touches = grille.getByTestId('bid-panel');
      await fireEvent.click(within(touches).getByRole('button', { name: '2' }));
      expect(slots().filter((slot) => slot === 'pari-pose')).toEqual(['pari-pose']);
    } finally {
      document.documentElement.style.fontSize = '';
    }
  });

  it('l’appui long sonne AU seuil, le doigt encore posé, pas au relâchement', async () => {
    vi.useFakeTimers();
    const t = table();
    await doigt(t.carte('escape-1'));
    joues.length = 0;
    vi.advanceTimersByTime(599);
    expect(slots(), 'rien avant le seuil').toEqual([]);
    vi.advanceTimersByTime(2);
    expect(slots()).toEqual(['carte-agrandie']);
  });

  it('le même refus, trois fois de suite, ne se dit qu’une fois — puis à nouveau après une seconde', async () => {
    vi.useFakeTimers();
    const t = table(vue({ currentPlayer: 'me', legal: [{ type: 'play', player: 'me', cardId: 'parrot-3' }] }));
    await fireEvent.click(t.carte('escape-1'));
    await fireEvent.click(t.carte('escape-1'));
    expect(slots()).toEqual(['refus-regle']);
    vi.advanceTimersByTime(1200);
    await fireEvent.click(t.carte('escape-1'));
    expect(slots()).toEqual(['refus-regle', 'refus-regle']);
  });
});

describe('Le son de la table — ce que la vue constate', () => {
  it('les cartes des adversaires tombent une par une, décalées', async () => {
    const t = table();
    await t.voir({ trick: { leader: 'p1', plays: [{ player: 'p1', card: MAP5 }, { player: 'p2', card: PARROT3 }] } });
    expect(joues).toEqual([
      { slot: 'carte-posee-autre', at: 0 },
      { slot: 'carte-posee-autre', at: 2 },
    ]);
  });

  it('le 15 joker qui ne peut pas se déclarer prend le son de sa dévaluation, pas celui d’une pose', async () => {
    const t = table();
    await t.voir({ trick: { leader: 'p1', plays: [{ player: 'p1', card: WILD15 }] } });
    expect(slots()).toEqual(['quinze-devalue']);
  });

  it('c’est à moi : la cloche sonne au changement de main, pas parce que la vue a bougé', async () => {
    const t = table();
    await t.voir({ currentPlayer: 'me', legal: [{ type: 'play', player: 'me', cardId: 'parrot-3' }] });
    expect(slots()).toEqual(['mon-tour']);
    joues.length = 0;
    // Une autre vue, la main toujours à moi : rien.
    await t.voir({ currentPlayer: 'me', scores: { me: 20, p1: 0, p2: 0 }, legal: [{ type: 'play', player: 'me', cardId: 'parrot-3' }] });
    expect(slots()).toEqual([]);
  });

  it('les paris se dévoilent une fois, et la cloche du tour attend que les pièces retombent', async () => {
    const t = table(vue({ phase: 'bidding', bids: { me: 1, p1: 1, p2: null }, currentPlayer: null }));
    await t.voir({ phase: 'playing', bids: { me: 1, p1: 1, p2: 2 }, currentPlayer: 'me' });
    expect(joues).toEqual([
      { slot: 'paris-devoiles', at: undefined },
      { slot: 'mon-tour', at: 6 },
    ]);
    // Une Tempête ou un pouvoir repasse en `playing` sans qu'un pari se dévoile : la poignée de pièces ne retombe pas.
    joues.length = 0;
    await t.voir({ phase: 'ability', bids: { me: 1, p1: 1, p2: 2 }, currentPlayer: 'p1' });
    await t.voir({ phase: 'playing', bids: { me: 1, p1: 1, p2: 2 }, currentPlayer: 'p1' });
    expect(slots()).toEqual([]);
  });

  it('la Dernière salve d’un adversaire se dit : le pli est plein et ne se résout pas', async () => {
    const t = table();
    await t.voir({ phase: 'volley', currentPlayer: 'p2' });
    expect(slots()).toEqual(['salve-rouverte']);
  });

  it('la donne est UNE salve par manche : jamais un son par carte', async () => {
    const t = table();
    await t.voir({ round: 4, phase: 'bidding', bids: { me: null, p1: null, p2: null }, currentPlayer: null });
    // La feuille de pari monte dans le même souffle : la cloche du tour attend que le paquet ait fini de claquer.
    expect(joues).toEqual([
      { slot: 'donne-manche', at: undefined },
      { slot: 'mon-tour', at: 6 },
    ]);
  });

  it('la table se démonte à chaque fin de manche : la donne suivante sonne quand même', async () => {
    // L'écran des scores prend la place de la table entre deux manches (`{#key screenKey}` dans `App.svelte`) :
    // la donne de la manche suivante tombe donc sur un MONTAGE. C'est tout l'intérêt d'une mémoire hors instance.
    const t = table();
    t.unmount();
    game.view = vue({ round: 4, phase: 'bidding', bids: { me: null, p1: null, p2: null }, currentPlayer: null });
    render(Table);
    await tick();
    expect(joues).toEqual([
      { slot: 'donne-manche', at: undefined },
      { slot: 'mon-tour', at: 6 },
    ]);
  });

  it('Kraken et Baleine ont chacun leur signature à la pose, sans suspense générique ajouté', async () => {
    const t = table();
    await t.voir({ trick: { leader: 'p1', plays: [{ player: 'p1', card: KRAKEN }] } });
    expect(slots()).toEqual(['kraken-pose', 'carte-posee-autre']);
    joues.length = 0;
    // La seconde espèce se reconnaît aussi, sans répéter le Kraken.
    await t.voir({ trick: { leader: 'p1', plays: [{ player: 'p1', card: KRAKEN }, { player: 'p2', card: WHALE }] } });
    expect(slots()).toEqual(['baleine-pose', 'carte-posee-autre']);
  });

  it('la Tempête sonne à l’ouverture de la phase, une seule fois', async () => {
    const t = table();
    await t.voir({ phase: 'pass', currentPlayer: null });
    await t.voir({ phase: 'pass', currentPlayer: null, myPassed: true });
    expect(slots()).toEqual(['tempete']);
  });
});

describe('Le son de la table — le pli qui se résout', () => {
  it('le Roi des Flibustiers annoncé à la pose ne reparle pas au verdict, la prise attend le vol', async () => {
    vi.useFakeTimers();
    const t = table();
    const plays = [{ player: 'p1' as PlayerId, card: MAP5 }, { player: 'me' as PlayerId, card: FLIBUSTE }];
    await t.voir({ trick: { leader: 'p1', plays } });
    joues.length = 0;
    // Le store fige le pli : les cartes sont déjà tombées, seule la résolution reste à dire.
    game.shownTrick = pli({ winner: 'me', plays });
    await tick();
    expect(slots(), 'déjà annoncé à la pose, pas encore ramassé').toEqual([]);
    vi.advanceTimersByTime(timing.trickPause);
    expect(slots()).toEqual(['pli-gagne-moi']);
  });

  it('le dernier pli solo garde le son de ramassage jusqu’au tap', async () => {
    vi.useFakeTimers();
    const t = table();
    const plays = [{ player: 'p1' as PlayerId, card: MAP5 }, { player: 'me' as PlayerId, card: FLIBUSTE }];
    await t.voir({ trick: { leader: 'p1', plays } });
    joues.length = 0;
    game.shownTrick = pli({ winner: 'me', plays });
    game.waitingSkip = true;
    game.canSkip = true;
    game.verdict = { winner: 'me', mine: true, headline: 'Tu remportes le pli', card: null, detail: null, speech: 'Tu remportes le pli.', removal: null, note: null };
    await tick();
    vi.advanceTimersByTime(15000);
    expect(slots()).toEqual([]);
    await fireEvent.click(t.getByTestId('trick-verdict'));
    expect(slots()).toEqual(['pli-gagne-moi']);
  });

  it('le Kraken mange le pli : aucun son de gain, jamais', async () => {
    vi.useFakeTimers();
    const t = table();
    const plays = [{ player: 'p1' as PlayerId, card: KRAKEN }, { player: 'me' as PlayerId, card: MAP5 }];
    await t.voir({ trick: { leader: 'p1', plays } });
    joues.length = 0;
    game.shownTrick = pli({ winner: null, kraken: true, plays });
    await tick();
    vi.advanceTimersByTime(timing.trickPause);
    expect(slots()).toEqual(['pli-englouti']);
  });

  it('le joueur qui enchaîne coupe la prise : elle ne sonne pas dans son dos', async () => {
    vi.useFakeTimers();
    const t = table();
    const plays = [{ player: 'p1' as PlayerId, card: MAP5 }];
    await t.voir({ trick: { leader: 'p1', plays } });
    joues.length = 0;
    game.shownTrick = pli({ winner: 'p1', plays });
    await tick();
    joues.length = 0;
    game.shownTrick = null; // ce que fait `endTrickPause`, que la pause soit finie ou passée
    await tick();
    vi.advanceTimersByTime(timing.trickPause);
    expect(slots()).toEqual([]);
  });

  it('le Butin scelle une alliance 220 ms après la prise, pour que la causalité s’entende', async () => {
    vi.useFakeTimers();
    const t = table();
    const plays = [{ player: 'p1' as PlayerId, card: MAP5 }, { player: 'p2' as PlayerId, card: LOOT }];
    await t.voir({ trick: { leader: 'p1', plays } });
    joues.length = 0;
    game.shownTrick = pli({ winner: 'p1', plays });
    await tick();
    vi.advanceTimersByTime(timing.trickPause);
    expect(joues).toEqual([
      { slot: 'pli-gagne-autre', at: undefined },
      { slot: 'butin-alliance', at: 4 },
    ]);
  });

  it('un remontage de la table pendant la pause ne rejoue ni le verdict ni la prise', async () => {
    vi.useFakeTimers();
    const rec = pli({ winner: 'me', plays: [{ player: 'me', card: FLIBUSTE }] });
    attach(transport(), 'offline', { names: NAMES });
    game.view = vue();
    game.shownTrick = rec;
    game.verdict = { winner: 'me', mine: true, headline: 'Tu remportes le pli', card: null, detail: null, speech: 'Tu remportes le pli.', removal: null, note: null };
    render(Table);
    await tick();
    vi.advanceTimersByTime(timing.trickPause);
    expect(slots()).toEqual([]);
  });

  it('le bandeau touché alors qu’aucune pause ne court ne sonne pas', async () => {
    const t = table();
    game.verdict = { winner: 'p1', mine: false, headline: 'Barbe-Noire remporte le pli', card: null, detail: null, speech: 'Barbe-Noire remporte le pli.', removal: null, note: null };
    await tick();
    await fireEvent.click(t.getByTestId('trick-verdict'));
    expect(slots()).toEqual([]);
  });
});

describe('Le son de la table — un geste, un son, et chacun à sa place', () => {
  it('la cloche du tour se range DERRIÈRE la carte qui vient de tomber, jamais dedans', async () => {
    // L'agacement n°1, mesuré sur une partie solo entière : douze `mon-tour` sur vingt tombaient à 0 ms d'un
    // `carte-posee-autre`. La cause la plus fréquente de « c'est à moi », c'est la carte du joueur précédent —
    // elle arrive dans la MÊME vue, et les deux effets se vident dans le même flush.
    const t = table();
    await t.voir({ currentPlayer: 'me', trick: { leader: 'p1', plays: [{ player: 'p1', card: MAP5 }] }, legal: [{ type: 'play', player: 'me', cardId: 'parrot-3' }] });
    expect(joues).toEqual([
      { slot: 'carte-posee-autre', at: 0 },
      { slot: 'mon-tour', at: 2 },
    ]);
  });

  it('deux cartes d’un coup : la cloche attend la DERNIÈRE, pas la première', async () => {
    const t = table();
    await t.voir({
      currentPlayer: 'me',
      trick: { leader: 'p1', plays: [{ player: 'p1', card: MAP5 }, { player: 'p2', card: PARROT3 }] },
      legal: [{ type: 'play', player: 'me', cardId: 'escape-1' }],
    });
    expect(joues).toEqual([
      { slot: 'carte-posee-autre', at: 0 },
      { slot: 'carte-posee-autre', at: 2 },
      { slot: 'mon-tour', at: 4 },
    ]);
  });

  it('la main qui me revient sans qu’aucune carte ne tombe garde sa cloche au point de contact', async () => {
    const t = table();
    await t.voir({ currentPlayer: 'me', legal: [{ type: 'play', player: 'me', cardId: 'parrot-3' }] });
    expect(joues).toEqual([{ slot: 'mon-tour', at: undefined }]);
  });

  it('la signature du Roi des Flibustiers précède sa pose même si le verdict arrive dans le même flush', async () => {
    vi.useFakeTimers();
    const t = table();
    const plays = [{ player: 'p1' as PlayerId, card: MAP5 }, { player: 'p2' as PlayerId, card: FLIBUSTE }];
    // Le store fige le pli de façon SYNCHRONE derrière la dernière carte : sans le pas, l'acier et la pose
    // tombaient au même instant et on n'entendait ni l'un ni l'autre.
    game.view = vue({ trick: { leader: 'p1', plays } });
    game.shownTrick = pli({ winner: 'p2', plays });
    await tick();
    expect(joues).toEqual([
      { slot: 'carte-posee-autre', at: 0 },
      { slot: 'roi-flibustiers', at: 2 },
      { slot: 'carte-posee-autre', at: 3 },
    ]);
    void t;
  });

  it('une carte qui s’est déjà annoncée en tombant ne se répète pas au verdict — la mienne comme celle d’un bot', async () => {
    vi.useFakeTimers();
    // Ma Tigresse : l'annonce part avec ma pose (depuis la refonte amont, le second tap — celui qui confirme —
    // et non plus le premier), la révélation dirait le même acier 55 ms plus tard.
    const t = table(vue({ hand: [TIGRESS], currentPlayer: 'me', legal: [{ type: 'play', player: 'me', cardId: 'tigress', as: 'pirate' }] }));
    await fireEvent.click(t.carte('tigress'));
    await fireEvent.click(t.getByTestId('confirm-card'));
    expect(joues).toEqual([
      { slot: 'lame-tiree', at: undefined },
      { slot: 'carte-posee-moi', at: 1 },
    ]);
    joues.length = 0;
    const miennes = [{ player: 'me' as PlayerId, card: TIGRESS, as: 'pirate' as const }];
    game.view = vue({ trick: { leader: 'me', plays: miennes } });
    game.shownTrick = pli({ leader: 'me', winner: 'me', plays: miennes });
    await tick();
    expect(slots(), 'un seul acier, pas deux').toEqual([]);
    // Celle d'un bot passait par un autre chemin (salve, donc hors garde) et sonnait l'acier DEUX fois : c'était
    // le hasard du chemin qui décidait, pas une règle.
    t.unmount();
    oublierLeSon();
    joues.length = 0;
    game.shownTrick = null;
    const siennes = [{ player: 'p1' as PlayerId, card: TIGRESS, as: 'pirate' as const }];
    game.view = vue();
    render(Table);
    await tick();
    game.view = vue({ trick: { leader: 'p1', plays: siennes } });
    await tick();
    expect(joues).toEqual([
      { slot: 'lame-tiree', at: 0 },
      { slot: 'carte-posee-autre', at: 1 },
    ]);
    joues.length = 0;
    game.shownTrick = pli({ winner: 'p1', plays: siennes });
    await tick();
    expect(slots(), 'un seul acier là aussi : les deux chemins disent la même chose').toEqual([]);
  });

  it('la liaison perdue refuse le DROIT d’agir, jamais la règle de la carte', async () => {
    // Ma carte est parfaitement légale : c'est le droit d'agir qui me manque. `refus-regle` faisait entendre
    // « ta carte est illégale » à un joueur qui a simplement perdu le fil.
    attach(transport(), 'online', { names: NAMES });
    online.conn = 'connecting';
    game.view = vue({ currentPlayer: 'me', legal: [{ type: 'play', player: 'me', cardId: 'parrot-3' }] });
    const rendu = render(Table);
    joues.length = 0;
    await fireEvent.click(rendu.container.querySelector('button[data-card-id="parrot-3"]') as HTMLElement);
    expect(slots()).toEqual(['refus-droit']);
  });

  it('la table ouverte dans un autre onglet, pareil : c’est un droit, pas une faute', async () => {
    attach(transport(), 'online', { names: NAMES });
    online.conn = 'open';
    online.superseded = true;
    game.view = vue({ currentPlayer: 'me', legal: [{ type: 'play', player: 'me', cardId: 'parrot-3' }] });
    const rendu = render(Table);
    joues.length = 0;
    await fireEvent.click(rendu.container.querySelector('button[data-card-id="parrot-3"]') as HTMLElement);
    expect(slots()).toEqual(['refus-droit']);
  });

  it('la carte qui ne suit pas la couleur, elle, reste un refus de RÈGLE', async () => {
    const t = table(vue({ currentPlayer: 'me', legal: [{ type: 'play', player: 'me', cardId: 'parrot-3' }] }));
    await fireEvent.click(t.carte('escape-1'));
    expect(slots()).toEqual(['refus-regle']);
  });
});

describe('Le son de la table — mon pari franchi', () => {
  it('le compteur qui REJOINT le pari se dit une fois, et pas sur l’état', async () => {
    const t = table(vue({ bids: { me: 1, p1: 1, p2: 1 } }));
    await t.voir({ tricksWonCount: { me: 1, p1: 0, p2: 0 } });
    expect(slots()).toEqual(['pari-atteint']);
    joues.length = 0;
    // Une vue de plus, le même compteur : le seuil est franchi, il ne se refranchit pas.
    await t.voir({ tricksWonCount: { me: 1, p1: 0, p2: 0 }, scores: { me: 20, p1: 0, p2: 0 } });
    expect(slots()).toEqual([]);
  });

  it('chaque pli AU-DELÀ du pari creuse encore : la coque craque une fois de plus', async () => {
    const t = table(vue({ bids: { me: 1, p1: 1, p2: 1 }, tricksWonCount: { me: 1, p1: 0, p2: 0 } }));
    await t.voir({ tricksWonCount: { me: 2, p1: 0, p2: 0 } });
    expect(slots()).toEqual(['pari-depasse']);
    joues.length = 0;
    await t.voir({ tricksWonCount: { me: 3, p1: 0, p2: 0 } });
    expect(slots()).toEqual(['pari-depasse']);
  });

  it('le pli d’un adversaire ne me dit rien, et un pari de zéro tenu non plus', async () => {
    const t = table(vue({ bids: { me: 0, p1: 1, p2: 1 } }));
    await t.voir({ tricksWonCount: { me: 0, p1: 1, p2: 0 } });
    expect(slots(), 'rien n’a été franchi : mon compteur n’a pas bougé').toEqual([]);
  });

  it('la manche suivante repart de zéro sans rien annoncer', async () => {
    const t = table(vue({ bids: { me: 1, p1: 1, p2: 1 }, tricksWonCount: { me: 2, p1: 0, p2: 0 } }));
    joues.length = 0;
    // Nouvelle manche : le compteur RETOMBE. Sans mémoire de manche, la première vue relirait « 0 pour un pari
    // de 0 » et annoncerait un seuil que personne n'a franchi.
    await t.voir({ round: 4, bids: { me: 0, p1: 0, p2: 0 }, tricksWonCount: zero(), phase: 'playing' });
    expect(slots().filter((s) => s.startsWith('pari-'))).toEqual([]);
  });

  it('la table remontée en pleine manche ne rejoue pas le seuil déjà franchi', async () => {
    const t = table(vue({ bids: { me: 1, p1: 1, p2: 1 } }));
    await t.voir({ tricksWonCount: { me: 1, p1: 0, p2: 0 } });
    expect(slots()).toEqual(['pari-atteint']);
    // L'écran des scores prend la place de la table et la rend : la mémoire vit hors de l'instance, exprès.
    t.unmount();
    joues.length = 0;
    render(Table);
    await tick();
    expect(slots()).toEqual([]);
  });
});

describe('Le son de la table — les dix dernières secondes', () => {
  /** Le chrono ne vit qu'en salle minutée : il compte en temps réel, on le remonte donc à la main. */
  const chrono = (props: { deadline: number; mine?: boolean; frozen?: boolean }) => render(Timer, { props });
  const battre = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    await tick();
  };

  it('la braise sonne AU franchissement du seuil, une seule fois — pas à chaque battement', async () => {
    vi.useFakeTimers();
    chrono({ deadline: Date.now() + 12_000, mine: true });
    await battre(1_000);
    expect(slots(), 'douze secondes : rien encore').toEqual([]);
    await battre(1_500);
    expect(slots()).toEqual(['chrono-urgence']);
    // L'intervalle bat à 100 ms : sonner sur l'ÉTAT `urgent` en ferait des dizaines de gouttes.
    await battre(3_000);
    expect(slots()).toEqual(['chrono-urgence']);
  });

  it('jamais sur l’échéance d’un adversaire : le serveur sert la sienne quand je n’en ai pas', async () => {
    vi.useFakeTimers();
    chrono({ deadline: Date.now() + 12_000, mine: false });
    await battre(4_000);
    expect(slots()).toEqual([]);
  });

  it('la barre de laiton remontée dans les dix secondes ne rejoue pas la braise', async () => {
    vi.useFakeTimers();
    const echeance = Date.now() + 12_000;
    const vue1 = chrono({ deadline: echeance, mine: true });
    await battre(2_500);
    expect(slots()).toEqual(['chrono-urgence']);
    vue1.unmount();
    joues.length = 0;
    chrono({ deadline: echeance, mine: true });
    await battre(1_000);
    expect(slots(), 'l’échéance est la même : elle a déjà été dite').toEqual([]);
  });

  it('une échéance qu’on découvre DÉJÀ dans ses dix secondes ne sonne pas : il n’y a pas de front', async () => {
    vi.useFakeTimers();
    chrono({ deadline: Date.now() + 6_000, mine: true });
    await battre(1_000);
    expect(slots()).toEqual([]);
  });

  it('liaison perdue : la valeur affichée est périmée, la braise ne ment pas au dégel', async () => {
    vi.useFakeTimers();
    const echeance = Date.now() + 12_000;
    const vue1 = chrono({ deadline: echeance, mine: true });
    await battre(1_000);
    await vue1.rerender({ deadline: echeance, mine: true, frozen: true });
    await battre(4_000); // le chrono est figé : l'affichage ne bouge plus, le serveur seul sait où en est le temps
    await vue1.rerender({ deadline: echeance, mine: true, frozen: false });
    await battre(200);
    expect(slots(), 'ce seuil-là, personne ne l’a vu passer').toEqual([]);
  });
});
