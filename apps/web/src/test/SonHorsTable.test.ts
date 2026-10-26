// Le son des écrans HORS TABLE : l'accueil, les deux salons, le registre de manche, le classement, et toutes
// les feuilles de parchemin.
//
// Comme pour la table, le moteur du son est remplacé par un carnet : ces tests ne prouvent rien du graphe audio
// (`audio.test.ts` s'en charge), ils prouvent le BRANCHEMENT. Trois choses qu'aucun autre test ne verrait casser :
// un son qui ment (la cloche de bord alors que la partie n'est pas partie), un son qui double (le clac de planche
// PLUS la voix propre du bouton), et une salve qui tombe d'un bloc au lieu de s'égrener.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

// `vi.hoisted` : la fabrique du faux module tourne au premier `import` d'un écran, donc AVANT l'initialisation
// des `const` de ce fichier — le carnet doit exister plus tôt qu'eux.
const { joues } = vi.hoisted(() => ({ joues: [] as { slot: string; at?: number; gain?: number; quand: number }[] }));
vi.mock('../lib/audio.svelte', async (vrai) => ({
  ...(await vrai<typeof import('../lib/audio.svelte')>()),
  // `quand` : le carnet horodate l'APPEL. Le registre programme sa salve en minuteries pour pouvoir la couper —
  // sans cette date, un test ne verrait plus si les lignes s'égrènent ou tombent d'un bloc.
  play: (slot: string, opts?: { at?: number; gain?: number }) => void joues.push({ slot, at: opts?.at, gain: opts?.gain, quand: Date.now() }),
  music: { start: () => void joues.push({ slot: 'musique:start', quand: Date.now() }), stop: () => void joues.push({ slot: 'musique:stop', quand: Date.now() }), joue: false, variante: 'taverne', setVariante: () => {} },
}));

import Home from '../routes/Home.svelte';
import Join from '../routes/Join.svelte';
import Friends from '../routes/Friends.svelte';
import Lobby from '../routes/Lobby.svelte';
import GameOver, { oublierLaFanfare } from '../routes/GameOver.svelte';
import RoundScore, { oublierLeRegistre } from '../routes/RoundScore.svelte';
import Sheet, { oublierLesFeuilles } from '../components/Sheet.svelte';
import QuitDialog from '../components/QuitDialog.svelte';
import ShareSheet from '../components/ShareSheet.svelte';
import RuleToggles, { sonnerBascule } from '../components/RuleToggles.svelte';
import RuleInfoSheet from '../components/RuleInfoSheet.svelte';
import OnlineLobby from '../routes/OnlineLobby.svelte';
import { WsClient, type SocketLike } from '../lib/net';
import { _setClient, online } from '../lib/online.svelte';
import ThemedSelectLayer from '../components/ThemedSelectLayer.svelte';
import { chooseOption } from './themedSelect';
import DealsSelect from '../components/DealsSelect.svelte';
import BotLevelSheet from '../components/BotLevelSheet.svelte';
import { play } from '../lib/audio.svelte';
import { clearSavedOffline } from '../lib/offline';
import { attach, defaultSoloConfig, detach, game, saveSoloConfig, setMyName, startSolo, type GameTransport } from '../lib/store.svelte';
import { DEFAULT_RULES, type PlayerView, type RoundScore as Ligne } from '../lib/types';
import { RULE_META, type RulesV2 } from '../lib/rulesMeta';

const slots = () => joues.map((j) => j.slot);
/** Les feuilles décident à la fin du tour (c'est ce délai qui rend le RELAIS audible) : il faut le laisser passer. */
const tour = () => new Promise<void>((r) => setTimeout(r, 0));
/** Le pas de salve du moteur (`PAS_SALVE`), en ms — ce que vaut un cran de `at`. */
const CRAN = 55;
/**
 * L'instant AUDIBLE d'une voix, en ms depuis la première du carnet : le moment où `play` a été appelé, plus les
 * crans qu'il programme dans le graphe. C'est la seule mesure qui a un sens quand une salve est en partie
 * portée par des minuteries et en partie par `at`.
 */
const instant = (j: { at?: number; quand: number }) => j.quand - (joues[0]?.quand ?? 0) + (j.at ?? 0) * CRAN;

const transport = (): GameTransport => ({ send: () => {}, onView: () => () => {} });

beforeEach(() => {
  joues.length = 0;
  localStorage.clear();
  setMyName('Alix');
  game.lastSolo = null; // la configuration d'une revanche survit au `detach` : elle fausserait le test suivant
  // Feuilles, registre et fanfare vivent hors des instances (ils doivent survivre au démontage d'un écran) :
  // sans ces oublis, un test hériterait du tour, de la manche ou du podium du précédent.
  oublierLesFeuilles();
  oublierLeRegistre();
  oublierLaFanfare();
  document.documentElement.dataset.motion = 'full';
  render(ThemedSelectLayer);
});
afterEach(() => {
  detach();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('le clac de planche', () => {
  it('part à l’APPUI, et ne réveille PAS la musique sur l’accueil', async () => {
    render(Home);
    joues.length = 0;
    await fireEvent.pointerDown(screen.getByTestId('help'));
    // Le clac a d'abord démarré la taverne ici, au premier appui de la session : c'était 456 Kio de boucle
    // téléchargés avant qu'aucune partie n'existe, contre le contrat (« chargée à l'entrée en partie »).
    // Les menus sont muets de musique ; la taverne s'allume quand la table s'ouvre (Table.svelte).
    expect(slots()).toEqual(['bouton-presse']);
    joues.length = 0;
    await fireEvent.pointerDown(screen.getByTestId('help'));
    expect(slots()).toEqual(['bouton-presse']);
  });

  it('se tait sur un bouton éteint, et sur un bouton qui a déjà sa propre voix', async () => {
    render(Home);
    joues.length = 0;
    // « Créer une table » est éteint hors connexion : il n'agit pas, il ne sonne pas.
    await fireEvent.pointerDown(screen.getByTestId('solo'));
    expect(slots()).toContain('bouton-presse');

    saveSoloConfig(defaultSoloConfig(3));
    render(Lobby);
    joues.length = 0;
    await fireEvent.pointerDown(screen.getByTestId('launch')); // la cloche de bord, pas un clac
    expect(slots()).toEqual([]);
    await fireEvent.pointerDown(screen.getAllByTestId('back-home')[0]!); // la porte, pas un clac
    expect(slots()).toEqual([]);
  });

  it('ne sonne qu’UNE fois quand une feuille est rendue dans l’écran qui l’ouvre', async () => {
    saveSoloConfig(defaultSoloConfig(3));
    render(Lobby);
    await fireEvent.click(screen.getByTestId('deals-info')); // la feuille des manches vit DANS `DealsSelect`
    await tour();
    joues.length = 0;
    await fireEvent.pointerDown(screen.getByLabelText('Fermer — Compris'));
    expect(slots()).toEqual(['bouton-presse']);
  });
});

// ---------------------------------------------------------------------------

describe('les feuilles de parchemin', () => {
  it('s’ouvre au montage, se referme sur une décision, et n’est qu’écartée par Échap', async () => {
    const vue = render(Sheet, { props: { title: 'Les manches', oncancel: () => {}, children: (() => {}) as never } });
    await tour();
    expect(slots()).toEqual(['panneau-ouvre']);

    joues.length = 0;
    await fireEvent.keyDown(document, { key: 'Escape' });
    vue.unmount();
    await tour();
    expect(slots()).toEqual(['panneau-ecarte']);
  });

  it('le tap sur le voile écarte, un bouton de la feuille referme', async () => {
    const vue = render(Sheet, { props: { title: 'Les manches', testid: 'f', oncancel: () => {}, children: (() => {}) as never } });
    await tour();
    joues.length = 0;
    await fireEvent.click(screen.getByTestId('f-veil'));
    vue.unmount();
    await tour();
    expect(slots()).toEqual(['panneau-ecarte']);

    joues.length = 0;
    const autre = render(Sheet, { props: { title: 'Les manches', oncancel: () => {}, children: (() => {}) as never } });
    await tour();
    joues.length = 0;
    autre.unmount(); // fermée par son bouton : rien n'a annulé
    await tour();
    expect(slots()).toEqual(['panneau-ferme']);
  });

  it('« Rester » est un choix : Échap sur « Quitter la table ? » referme, il n’écarte pas', async () => {
    const vue = render(QuitDialog, { props: { onstay: () => {}, onquit: () => {} } });
    await tour();
    joues.length = 0;
    await fireEvent.keyDown(document, { key: 'Escape' });
    vue.unmount();
    await tour();
    expect(slots()).toEqual(['panneau-ferme']);
  });

  it('« Quitter » ne joue QUE la porte : ni clac de planche, ni feuille qui se referme par-dessus', async () => {
    // Les trois appelants (table, registre, salon en ligne) jouent `table-quittee` : la feuille se tait donc.
    const vue = render(QuitDialog, { props: { onstay: () => {}, onquit: () => play('table-quittee') } });
    await tour();
    joues.length = 0;
    await fireEvent.pointerDown(screen.getByTestId('quit-confirm'));
    await fireEvent.click(screen.getByTestId('quit-confirm'));
    vue.unmount();
    await tour();
    expect(slots()).toEqual(['table-quittee']);
  });

  it('une feuille qui en REMPLACE une autre dans le même tour est une page tournée, pas deux sons', async () => {
    const partante = render(Sheet, { props: { title: 'L’aide', oncancel: () => {}, children: (() => {}) as never } });
    await tour();
    joues.length = 0;
    partante.unmount();
    render(Sheet, { props: { title: 'Le codex', oncancel: () => {}, children: (() => {}) as never } });
    await tour();
    expect(slots()).toEqual(['page-tournee']);
  });

  it('la feuille reste, son contenu change de main : une page tournée, sans ouverture ni fermeture', async () => {
    const vue = render(Sheet, { props: { title: 'Codex des cartes', oncancel: () => {}, children: (() => {}) as never } });
    await tour();
    joues.length = 0;
    await vue.rerender({ title: 'Kraken' });
    await tick();
    await tour();
    expect(slots()).toEqual(['page-tournee']);
  });
});

// ---------------------------------------------------------------------------

describe('les interrupteurs de règles', () => {
  const rules = (over: Partial<RulesV2> = {}): RulesV2 => ({ ...DEFAULT_RULES, ...over }) as RulesV2;

  it('l’allumage et l’extinction ne sonnent PAS pareil — c’est l’état obtenu qu’il faut entendre', async () => {
    const vue = render(RuleToggles, { props: { rules: rules({ kraken: false }), onchange: () => {} } });
    await fireEvent.click(screen.getByRole('switch', { name: 'Kraken' }));
    expect(slots()).toEqual(['regle-allumee']);

    joues.length = 0;
    await vue.rerender({ rules: rules({ kraken: true }), onchange: () => {} });
    await fireEvent.click(screen.getByRole('switch', { name: 'Kraken' }));
    expect(slots()).toEqual(['regle-eteinte']);
  });

  it('l’appui long sur une carte-règle l’agrandit — le même son que dans la main et dans le pli', async () => {
    vi.useFakeTimers();
    render(RuleToggles, { props: { rules: rules(), onchange: () => {} } });
    joues.length = 0;
    await fireEvent.pointerDown(screen.getByRole('switch', { name: 'Kraken' }));
    expect(slots(), 'rien avant le seuil des 600 ms').toEqual([]);
    vi.advanceTimersByTime(700);
    // La fiche s'ouvre et le témoin ne bascule PAS (le clic qui suit est avalé) : un seul son, celui du zoom.
    expect(slots()).toEqual(['carte-agrandie']);
  });

  it('à deux, le témoin du 15 joker prend mais le paquet ne change pas : la mèche crachote', async () => {
    render(RuleToggles, { props: { rules: rules(), seats: 2, onchange: () => {} } });
    await fireEvent.click(screen.getByRole('switch', { name: '15 joker' }));
    expect(slots()).toEqual(['regle-en-sommeil']);

    // À trois, le même interrupteur met bien la carte en jeu.
    joues.length = 0;
    render(RuleToggles, { props: { rules: rules(), seats: 3, onchange: () => {} } });
    await fireEvent.click(screen.getAllByRole('switch', { name: '15 joker' })[1]!);
    expect(slots()).toEqual(['regle-allumee']);
  });
});

// ---------------------------------------------------------------------------

describe('les réglages de la table', () => {
  it('le plan des manches sonne quand il CHANGE, et se tait quand la variante est déjà en place', async () => {
    let courant = { ...DEFAULT_RULES } as RulesV2;
    const props = { rules: courant, seats: 4, onchange: (r: RulesV2) => (courant = r) };
    const vue = render(DealsSelect, { props });
    const select = screen.getByTestId('deals-select');
    const autre = 'pas-d-impair';

    await chooseOption(select, autre);
    expect(slots().filter((slot) => slot === 'plan-de-table')).toEqual(['plan-de-table']);

    // La variante est maintenant CELLE-LÀ (le salon a répercuté le changement) : la rechoisir ne change rien.
    await vue.rerender({ ...props, rules: courant });
    joues.length = 0;
    await chooseOption(select, autre);
    expect(slots()).not.toContain('plan-de-table');
  });

  it('un curseur ne sonne qu’au cran ENTIER franchi, jamais à chaque pixel de glissade', async () => {
    render(BotLevelSheet, { props: { name: 'Barbe', current: 'normal', onpick: () => {}, oncancel: () => {} } });
    await fireEvent.click(screen.getByTestId('bot-custom'));
    const curseur = screen.getByTestId('bot-slider-force') as HTMLInputElement;
    const depart = Number(curseur.value);

    joues.length = 0;
    await fireEvent.input(curseur, { target: { value: String(depart) } }); // même valeur : la glissade n'a rien franchi
    expect(slots()).toEqual([]);
    await fireEvent.input(curseur, { target: { value: String(depart === 10 ? 9 : depart + 1) } });
    expect(slots()).toEqual(['cran-de-reglage']);
  });

  it('le niveau d’un pirate de bois passe AVANT la feuille qui se referme derrière lui', async () => {
    const vue = render(BotLevelSheet, { props: { name: 'Barbe', current: null, onpick: () => {}, oncancel: () => {} } });
    await tour();
    joues.length = 0;
    await fireEvent.click(screen.getByTestId('bot-level-hard'));
    expect(slots()).toEqual(['bot-niveau-choisi']); // le crâne d'abord, seul dans son tour
    vue.unmount();
    await tour();
    expect(slots()).toEqual(['bot-niveau-choisi', 'panneau-ferme']);
  });
});

// ---------------------------------------------------------------------------

describe('le lien d’invitation', () => {
  it('la pièce de cuivre remplace le toast ET la fermeture ; l’échec, lui, n’a aucun tintement', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
    const vue = render(ShareSheet, { props: { url: 'https://x.test/#/join/ABCDEF', code: 'ABCDEF', oncancel: () => {} } });
    await tour();
    joues.length = 0;
    await fireEvent.click(screen.getByTestId('share-copy'));
    await tick();
    vue.unmount();
    await tour();
    expect(slots()).toEqual(['lien-copie']);

    joues.length = 0;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const raté = render(ShareSheet, { props: { url: 'https://x.test/#/join/ABCDEF', code: 'ABCDEF', oncancel: () => {} } });
    await tour();
    joues.length = 0;
    await fireEvent.click(screen.getByTestId('share-copy'));
    await tick();
    // Le geste a claqué dans le vide, et c'est ce vide qu'on entend. Surtout pas la pièce de cuivre : le joueur
    // croirait avoir copié. Le bouton porte `data-clac="non"` — sans cette ligne, l'échec était totalement muet.
    expect(slots()).toEqual(['geste-sans-effet']);
    raté.unmount();
    await tour();
  });
});

// ---------------------------------------------------------------------------

describe('l’accueil et le salon', () => {
  it('l’accueil ne sonne RIEN de lui-même : l’enseigne n’existe plus, son balancement non plus', () => {
    // Ce test gardait `enseigne-oscille` au montage. La refonte de l'accueil a emporté l'enseigne suspendue et
    // sa cascade de planches (`.sign`, `--rise-delay`) : le slot décrit UN BALANCEMENT, et il n'y a plus rien qui
    // se balance. Le retrait du `play` dans `Home.svelte` est donc délibéré (voir son entête) — sonner un
    // mouvement qui n'a pas lieu est précisément la faute que le contrat interdit à ce fichier de laisser passer.
    // Ce qui reste à garder est plus fort que l'ancienne attente : l'accueil est MUET au montage. Aucun son ne
    // peut donc revenir s'y installer par la bande — ni le balancement d'hier, ni la taverne (les menus sont sans
    // musique), ni un son d'ambiance qu'aucun geste du joueur n'aurait demandé.
    render(Home);
    expect(slots()).toEqual([]);

    // Le mouvement réduit ne coupe aucun son (c'est le contrat : l'équivalent audio de `prefers-reduced-motion`
    // n'existe pas, le réglage de l'app est la seule voie). Ce n'est donc pas LUI qui faisait taire l'enseigne,
    // c'était l'immobilité de l'enseigne — et le silence de l'accueil vaut désormais dans les deux modes.
    joues.length = 0;
    document.documentElement.dataset.motion = 'reduce';
    render(Home);
    expect(slots()).toEqual([]);
  });

  it('« Reprendre » qui ne trouve plus rien claque dans le vide, et ce vide s’entend', async () => {
    // Une sauvegarde existe au montage (le bouton n'apparaît qu'à cette condition), puis elle disparaît — un
    // autre onglet, un stockage purgé. C'est le seul chemin par lequel `resumeOffline()` échoue vraiment.
    startSolo(defaultSoloConfig(3));
    detach();
    render(Home);
    clearSavedOffline();
    joues.length = 0;
    await fireEvent.pointerDown(screen.getByTestId('resume-solo'));
    await fireEvent.click(screen.getByTestId('resume-solo'));
    expect(slots()).toEqual(['geste-sans-effet']);
    expect(game.toast).toBe('Aucune partie à reprendre');
  });

  it('la cloche de bord ne sonne QUE si la table part vraiment', async () => {
    saveSoloConfig(defaultSoloConfig(3));
    const salon = render(Lobby);
    joues.length = 0;
    await fireEvent.click(screen.getByTestId('launch'));
    expect(slots()).toEqual(['partie-lancee']);
    salon.unmount();
    detach();

    // Sans pseudo, « Lancer » ne lance rien : le son ne doit pas dire le contraire.
    setMyName('');
    render(Lobby);
    joues.length = 0;
    await fireEvent.click(screen.getByTestId('launch'));
    expect(slots()).not.toContain('partie-lancee');
  });

  it('changer le nombre de joueurs assoit ou retire les bots standards avec le son correspondant', async () => {
    saveSoloConfig(defaultSoloConfig(3));
    render(Lobby);
    joues.length = 0;
    await chooseOption(screen.getByLabelText('Nombre de flibustiers'), '5');
    expect(slots().filter((slot) => slot === 'bot-assis')).toEqual(['bot-assis']);
    expect(slots()).not.toContain('bot-niveau-choisi');
    joues.length = 0;
    await chooseOption(screen.getByLabelText('Nombre de flibustiers'), '4');
    expect(slots().filter((slot) => slot === 'bot-retire')).toEqual(['bot-retire']);
  });

  it('un préréglage ne joue pas treize interrupteurs, mais un seul plan de table', async () => {
    saveSoloConfig(defaultSoloConfig(3));
    render(Lobby);
    joues.length = 0;
    await chooseOption(screen.getByTestId('preset-select'), 'full');
    expect(slots().filter((slot) => slot === 'plan-de-table')).toEqual(['plan-de-table']);
    expect(slots().some((slot) => slot.startsWith('regle-'))).toBe(false);
  });

  it('« Jouer avec des amis » : le clac de planche a suivi les boutons dans leur nouvel écran', async () => {
    // Ici le TEST avait raison et c'est le CODE qui s'est cassé, silencieusement. « Créer une salle » et
    // « Rejoindre » vivaient sur l'accueil, sous SA surface : l'appui sonnait. La refonte les a sortis dans un
    // écran à part (`Friends`, route `friends`) arrivé sans `use:clac` — les deux boutons qui ouvrent tout le
    // parcours en ligne étaient devenus complètement muets, et aucun test ne le voyait puisque cet écran n'existait
    // pas encore quand le son a été écrit. La surface est reposée dans `Friends.svelte` ; ce test l'y tient.
    render(Friends);
    joues.length = 0;
    await fireEvent.pointerDown(screen.getByTestId('create'));
    expect(slots()).toEqual(['bouton-presse']);

    joues.length = 0;
    await fireEvent.pointerDown(screen.getByTestId('join-submit'));
    expect(slots()).toEqual(['bouton-presse']);
  });

  it('l’invitation part sans geste : le clac tient lieu de tampon', () => {
    // Rejoindre ouvre une vraie socket : jsdom n'en a pas, et l'écran n'est pas ce qu'on mesure ici.
    vi.stubGlobal('WebSocket', class {
      close(): void {}
      send(): void {}
    });
    render(Join, { props: { code: 'ABCDEF' } });
    expect(slots()).toContain('bouton-presse');
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------

describe('le registre de manche', () => {
  const ligne = (p: Partial<Ligne> & { player: string }): Ligne => ({ round: 3, bid: 1, effectiveBid: 1, tricks: 1, made: true, base: 20, bonus: 0, gambler: 0, loot: 0, total: 20, ...p });

  function vue(lignes: Ligne[]): PlayerView {
    return {
      me: 'p1',
      players: lignes.map((l) => l.player),
      round: 3,
      dealer: 'p2',
      phase: 'roundEnd',
      hand: [],
      handCounts: {},
      bids: {},
      tricksWonCount: {},
      trick: { leader: 'p1', plays: [] },
      currentPlayer: null,
      scores: Object.fromEntries(lignes.map((l) => [l.player, l.total])),
      roundScores: lignes,
      lastRoundScores: lignes,
      legal: [],
      pending: null,
      pendingAbilities: [],
      forcedPlays: {},
      history: [],
      lootAlliances: [],
      rules: { rounds: 5 },
    } as unknown as PlayerView;
  }

  function registre(lignes: Ligne[]) {
    attach(transport(), 'offline', { names: Object.fromEntries(lignes.map((l) => [l.player, l.player])) });
    game.view = vue(lignes);
    return render(RoundScore);
  }

  /** La salve entière tient sous la seconde : on la laisse aller jusqu'au bout. */
  const salveFinie = () => vi.advanceTimersByTime(2000);

  it('le parchemin se déroule, puis les lignes s’égrènent — la mienne en dernier et seule à plein volume', async () => {
    vi.useFakeTimers();
    registre([
      ligne({ player: 'p2', made: false, tricks: 3, base: -20, total: -20 }),
      ligne({ player: 'p3' }),
      ligne({ player: 'p1', total: 20 }),
    ]);
    await tick();

    expect(joues[0]!.slot).toBe('score-ouvre');
    // Le parchemin met quatre crans à se dérouler : rien ne s'écrit dessus tant qu'il n'est pas déroulé.
    expect(joues.filter((j) => j.slot.startsWith('pari-'))).toHaveLength(0);

    salveFinie();
    // Le registre sonne dans l'ordre où il s'écrit — celui du classement, cumul décroissant : p3, puis p2.
    const lignesJouees = joues.filter((j) => j.slot.startsWith('pari-'));
    expect(lignesJouees.map((j) => j.slot)).toEqual(['pari-tenu-inscrit', 'pari-rate-inscrit', 'pari-tenu-inscrit']);
    // Chacune décalée de deux crans de plus, après les quatre du déroulé : sans cela, trois plumes tomberaient
    // au même instant. C'est l'instant AUDIBLE qu'on mesure, minuterie et `at` confondus.
    expect(lignesJouees.map(instant)).toEqual([4 * CRAN, 6 * CRAN, 8 * CRAN]);
    // La mienne est la dernière, et la seule à plein volume.
    expect(lignesJouees.at(-1)!.gain).toBe(1);
    expect(lignesJouees.slice(0, -1).every((j) => (j.gain ?? 1) < 1)).toBe(true);
  });

  it('un pari à 0 n’est pas un pari tenu plus fort : c’est une autre règle, et une autre matière', async () => {
    vi.useFakeTimers();
    registre([ligne({ player: 'p1', bid: 0, effectiveBid: 0, tricks: 0, made: true, base: 70, total: 70 })]);
    await tick();
    salveFinie();
    expect(slots()).toContain('pari-zero-inscrit');
    expect(slots()).not.toContain('pari-tenu-inscrit');
  });

  it('les sceaux se posent SUR leur ligne, derrière elle, et jamais comme une récompense sur une ligne ratée', async () => {
    vi.useFakeTimers();
    registre([ligne({ player: 'p1', made: false, tricks: 0, base: -10, gambler: -20, total: -30 })]);
    await tick();
    salveFinie();
    const laLigne = joues.find((j) => j.slot === 'pari-rate-inscrit')!;
    const sceaux = joues.filter((j) => j.slot === 'sceau-bonus');
    expect(sceaux).toHaveLength(1);
    expect(instant(sceaux[0]!)).toBeGreaterThan(instant(laLigne));
    expect(sceaux[0]!.gain!).toBeLessThan(1); // cire froide : le Rufus perdu ne se félicite pas
  });

  it('au-delà de trois adversaires, les suivants se fondent en un seul frottement collectif', async () => {
    vi.useFakeTimers();
    registre([
      ligne({ player: 'p2' }),
      ligne({ player: 'p3' }),
      ligne({ player: 'p4' }),
      ligne({ player: 'p5' }),
      ligne({ player: 'p6' }),
      ligne({ player: 'p1' }),
    ]);
    await tick();
    salveFinie();
    // 3 adversaires écrits + 1 frottement pour les deux derniers + la mienne = 5 plumes, pas 6.
    expect(joues.filter((j) => j.slot.startsWith('pari-'))).toHaveLength(5);
  });

  it('n’écrit le registre qu’une fois par manche, même si l’écran se remet à jour', async () => {
    vi.useFakeTimers();
    registre([ligne({ player: 'p1' })]);
    await tick();
    const compte = joues.filter((j) => j.slot === 'score-ouvre').length;
    game.view = { ...game.view!, scores: { p1: 999 } } as PlayerView;
    await tick();
    salveFinie();
    expect(joues.filter((j) => j.slot === 'score-ouvre')).toHaveLength(compte);
  });

  it('quitter l’écran emporte la salve : rien ne sonne dans le dos du joueur', async () => {
    vi.useFakeTimers();
    const vue = registre([
      ligne({ player: 'p2' }),
      ligne({ player: 'p3' }),
      ligne({ player: 'p4' }),
      ligne({ player: 'p1' }),
    ]);
    await tick();
    vi.advanceTimersByTime(4 * CRAN); // deux lignes écrites, deux encore à venir
    const ecrites = joues.filter((j) => j.slot.startsWith('pari-')).length;
    expect(ecrites).toBeGreaterThan(0);
    expect(ecrites).toBeLessThan(4);

    // « Manche suivante » démonte l'écran. La queue du registre ne doit PAS se poser sur la donne d'après :
    // c'est ce qui arrivait à chacune des cinq manches mesurées.
    vue.unmount();
    salveFinie();
    expect(joues.filter((j) => j.slot.startsWith('pari-'))).toHaveLength(ecrites);
  });

  it('un écran reconstruit sur la MÊME manche ne réécrit pas le registre', async () => {
    vi.useFakeTimers();
    const vue = registre([ligne({ player: 'p1' })]);
    await tick();
    salveFinie();
    expect(joues.length).toBeGreaterThan(1);

    // `App.svelte` détruit et reconstruit l'écran à chaque changement de route : la mémoire de la manche écrite
    // vit donc au MODULE. Sans elle, tout le registre — `score-ouvre` compris — se rejouerait.
    vue.unmount();
    joues.length = 0;
    render(RoundScore);
    await tick();
    salveFinie();
    expect(slots()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('le classement', () => {
  /** `phase` est celle du MOTEUR (`gameOver`), pas le nom de la route (`over`) : c'est elle que la fanfare lit. */
  function fin(scores: Record<string, number> = { p1: 90, p2: 20 }, phase = 'gameOver') {
    attach(transport(), 'offline', { names: { p1: 'Alix', p2: 'Barbe' } });
    game.view = {
      me: 'p1',
      players: ['p1', 'p2'],
      round: 5,
      dealer: 'p1',
      phase,
      hand: [],
      handCounts: {},
      bids: {},
      tricksWonCount: {},
      trick: { leader: 'p1', plays: [] },
      currentPlayer: null,
      scores,
      roundScores: [],
      lastRoundScores: [],
      legal: [],
      pending: null,
      pendingAbilities: [],
      forcedPlays: {},
      history: [],
      lootAlliances: [],
      rules: { rounds: 5 },
    } as unknown as PlayerView;
    return render(GameOver);
  }

  it('capitaine de la soirée : la fanfare, et jamais les deux sons à la fois', async () => {
    fin({ p1: 90, p2: 20 });
    await tick();
    expect(slots()).toContain('victoire-moi');
    expect(slots()).not.toContain('defaite-moi');
  });

  it('un autre est capitaine : aussi soigné, et surtout pas muet', async () => {
    fin({ p1: 20, p2: 90 });
    await tick();
    expect(slots()).toContain('defaite-moi');
    expect(slots()).not.toContain('victoire-moi');
  });

  it('ex æquo au premier rang : c’est une victoire, elle se salue comme telle', async () => {
    fin({ p1: 90, p2: 90 });
    await tick();
    expect(slots()).toContain('victoire-moi');
  });

  it('#/over sur une partie EN COURS montre un podium inventé : la fanfare ne le salue pas', async () => {
    fin({ p1: 90, p2: 20 }, 'bidding');
    await tick();
    expect(slots()).not.toContain('victoire-moi');
    expect(slots()).not.toContain('defaite-moi');
  });

  it('l’écran reconstruit sur la MÊME partie ne resalue personne', async () => {
    const vue = fin();
    await tick();
    expect(slots()).toContain('victoire-moi');
    vue.unmount();
    joues.length = 0;
    render(GameOver);
    await tick();
    expect(slots()).toEqual([]);
  });

  it('la revanche solo arme une table : même cloche que « Lancer la partie »', async () => {
    saveSoloConfig(defaultSoloConfig(2));
    fin();
    await tick();
    joues.length = 0;
    await fireEvent.click(screen.getByTestId('replay'));
    expect(slots()).toContain('partie-lancee');
    expect(slots()).not.toContain('table-quittee');
  });

  it('sans configuration à rejouer on retombe au salon : la porte, surtout pas la cloche', async () => {
    fin();
    await tick();
    joues.length = 0;
    await fireEvent.click(screen.getByTestId('replay'));
    expect(slots()).toContain('table-quittee');
    expect(slots()).not.toContain('partie-lancee');
  });

  it('« Rejouer » ne cumule pas le clac de la surface avec la cloche qu’il fait sonner', async () => {
    saveSoloConfig(defaultSoloConfig(2));
    fin();
    await tick();
    joues.length = 0;
    await fireEvent.pointerDown(screen.getByTestId('replay'));
    await fireEvent.click(screen.getByTestId('replay'));
    expect(slots()).toEqual(['partie-lancee']);
  });

  it('« Retour à la taverne » referme la porte, sans clac par-dessus', async () => {
    fin();
    await tick();
    joues.length = 0;
    await fireEvent.pointerDown(screen.getByTestId('home'));
    await fireEvent.click(screen.getByTestId('home'));
    expect(slots()).toEqual(['table-quittee']);
  });
});

describe('le salon en ligne — l’invité qui n’a pas la main', () => {
  /**
   * Un invité n'est pas fautif : il n'a simplement pas le droit de régler la table. Avant, il n'entendait RIEN —
   * les surfaces qu'il touche portent déjà `data-clac="non"` (elles ont leur voix quand on est capitaine), et le
   * toast se tait côté son en supposant que le geste a sonné. Le verrou de laiton rend cette supposition vraie.
   */
  class SocketMuette implements SocketLike {
    readyState = 0;
    onopen: ((ev: unknown) => void) | null = null;
    onclose: ((ev: { code?: number }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    send() {}
    close() {
      this.readyState = 3;
    }
  }

  const CODE = 'ZZZZ';
  /** `capitaine` n'est pas moi : c'est tout ce qui sépare l'invité du capitaine dans cet écran. */
  function salon(capitaine: string) {
    _setClient(new WsClient({ identity: () => game.identity, url: 'ws://test/ws', socketFactory: () => new SocketMuette(), pingIntervalMs: 0 }));
    online.room = {
      code: CODE,
      host: capitaine,
      status: 'lobby',
      rules: { ...DEFAULT_RULES } as never,
      timerMode: 'none',
      seats: [
        { idx: 0, playerId: game.identity.playerId, name: 'Alix', botLevel: null, connected: true },
        { idx: 1, playerId: null, name: 'Pirate de bois', botLevel: 'normal', connected: true },
      ],
      ready: [],
      disconnectedSince: {},
      maxPlayers: 8,
      left: [],
    };
    const rendu = render(OnlineLobby, { props: { code: CODE } });
    joues.length = 0;
    return rendu;
  }
  const toucher = async (el: Element) => {
    await fireEvent.pointerDown(el);
    await fireEvent.click(el);
  };

  afterEach(() => {
    _setClient(null);
    online.room = null;
  });

  it('un réglage touché par un invité répond le verrou — et rien d’autre', async () => {
    const r = salon('capitaine');
    await toucher(r.container.querySelector('[data-timer="30s"]') as Element);
    expect(slots()).toEqual(['refus-droit']);
  });

  it('un siège de bot est informatif pour l’invité : aucun faux réglage ni son de refus', async () => {
    const r = salon('capitaine');
    expect(r.queryByTestId('seat-level')).toBeNull();
    await toucher(r.getByText('Pirate de bois'));
    expect(slots()).toEqual([]);
  });

  it('le siège du bot reste informatif pour le capitaine, sans ouvrir l’ancienne personnalisation', async () => {
    const r = salon(game.identity.playerId);
    expect(r.queryByTestId('seat-level')).toBeNull();
    await toucher(r.getByText('Pirate de bois'));
    expect(screen.queryByTestId('bot-level-normal')).toBeNull();
    expect(slots()).toEqual([]);
  });

});

describe('la fiche d’une règle', () => {
  it('bascule d’une seule voix : le clac de la feuille ne double pas l’interrupteur', async () => {
    // Le même geste que la carte-règle de la grille, sur une autre surface — et le catalogue interdit les deux
    // sons pour un même geste, quelle que soit la surface qui le porte.
    // Le Kraken est allumé dans les règles par défaut : le geste l'ÉTEINT, et c'est l'état obtenu qu'on entend.
    const meta = RULE_META.find((m) => m.key === 'kraken')!;
    render(RuleInfoSheet, { props: { meta, on: true, canToggle: true, ontoggle: () => sonnerBascule(DEFAULT_RULES, meta, 3), oncancel: () => {} } });
    joues.length = 0;
    const bouton = screen.getByTestId('rule-info-toggle');
    await fireEvent.pointerDown(bouton);
    await fireEvent.click(bouton);
    expect(slots()).toEqual(['regle-eteinte']);
  });
});

describe('le salon en ligne — les pirates de bois du capitaine', () => {
  /**
   * Le couple le plus manipulé du salon, et le seul que le serveur ne dira JAMAIS : les sièges de bots sont
   * exclus du calcul de présence (`presents`, online.svelte.ts), donc `joueur-arrive` / `joueur-parti` les
   * ignorent. Sans ces deux lignes dans l'écran, asseoir un pirate de bois n'était dit que par le crâne de son
   * niveau, et en retirer un ne sonnait rien du tout.
   */
  const CODE = 'YYYYYY';
  function salon() {
    // jsdom n'a pas de WebSocket : `addBot` / `removeSeat` en ouvrent une par `getClient()`, elle doit exister.
    vi.stubGlobal(
      'WebSocket',
      class {
        close(): void {}
        send(): void {}
      },
    );
    online.room = {
      code: CODE,
      host: game.identity.playerId,
      status: 'lobby',
      rules: { ...DEFAULT_RULES } as never,
      timerMode: 'none',
      seats: [
        { idx: 0, playerId: game.identity.playerId, name: 'Alix', botLevel: null, connected: true },
        { idx: 1, playerId: null, name: 'Pirate de bois', botLevel: 'normal', connected: true },
      ],
      ready: [],
      disconnectedSince: {},
      maxPlayers: 8,
      left: [],
    };
    return render(OnlineLobby, { props: { code: CODE } });
  }

  afterEach(() => {
    _setClient(null);
    online.room = null;
    vi.unstubAllGlobals();
  });

  it('ajouter un bot standard tire directement un tabouret, comme au salon solo', async () => {
    const r = salon();
    await tick();
    joues.length = 0;
    await fireEvent.click(r.getByTestId('add-bot'));
    expect(slots()).toEqual(['bot-assis']);
    expect(screen.queryByTestId('bot-level-normal')).toBeNull();
  });

  it('en retirer un le range tout de suite — sans confirmation, et sans clac par-dessus', async () => {
    const r = salon();
    await tick();
    joues.length = 0;
    const retirer = r.getAllByTestId('seat-remove')[0]!;
    await fireEvent.pointerDown(retirer);
    await fireEvent.click(retirer);
    expect(slots()).toEqual(['bot-retire']);
  });
});
