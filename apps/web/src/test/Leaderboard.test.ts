// Le tableau d'honneur : ce qui part à la fin d'une partie, et ce qui s'affiche quand on va le regarder.
//
// Quatre choses qu'aucun autre test ne verrait casser :
//  — une partie envoyée DEUX fois (le pire défaut possible : le classement devient faux et personne ne le voit) ;
//  — six clients qui envoient la même partie parce que l'invité s'est cru capitaine ;
//  — la deuxième partie d'une même salle avalée par la clé du serveur, parce que « Rejouer » garde le code ;
//  — un écran qui reste sur « On compte les pièces… » ou qui se vide sur une ligne bancale venue du réseau.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import Leaderboard from '../routes/Leaderboard.svelte';
import GameOver from '../routes/GameOver.svelte';
import Home from '../routes/Home.svelte';
import { chargerClassement, codeDePartie, envoyerPartie, oublierLesEnvois, partieFinie, type Tablee } from '../lib/scores';
import { attach, detach, game, type GameTransport } from '../lib/store.svelte';
import { online } from '../lib/online.svelte';
import type { RoomView } from '../lib/protocol';
import type { PlayerView, RoundScore } from '../lib/types';

// --- fabriques ------------------------------------------------------------------------------------------

const manche = (round: number, player: string, bid: number, tricks: number, total: number): RoundScore => ({
  round,
  player,
  bid,
  effectiveBid: bid,
  tricks,
  made: bid === tricks,
  base: total,
  bonus: 0,
  gambler: 0,
  loot: 0,
  total,
});

function vueFinie(scores: Record<string, number>, roundScores: RoundScore[] = [], phase = 'gameOver'): PlayerView {
  return {
    me: 'p1',
    players: Object.keys(scores),
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
    roundScores,
    lastRoundScores: [],
    legal: [],
    pending: null,
    pendingAbilities: [],
    forcedPlays: {},
    history: [],
    lootAlliances: [],
    rules: { rounds: 5 },
  } as unknown as PlayerView;
}

const tablee = (over: Partial<Tablee> = {}): Tablee => ({
  mode: 'solo',
  nom: (id) => (id === 'p1' ? 'Alix' : id === 'p2' ? 'Camille' : 'Pirate de bois'),
  bot: (id) => id.startsWith('bot'),
  moi: 'uuid-alix',
  ...over,
});

const reponse = (corps: unknown, status = 200): Response => ({ ok: status < 400, status, json: async () => corps }) as unknown as Response;

const entree = (nom: string, meilleur: number, parties = 1, dernier = Date.now()) => ({ nom, meilleur, parties, dernier });

let appels: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  appels = [];
  oublierLesEnvois();
  // La trace « ce que cet appareil a déclaré » vit dans localStorage : sans ce ménage, un envoi réussi d'un
  // test déciderait du surlignage « moi » du suivant.
  localStorage.clear();
  game.identity = { ...game.identity, name: 'Alix' };
});

afterEach(() => {
  detach();
  online.room = null;
  vi.unstubAllGlobals();
});

/** Bouchonne `fetch` en notant chaque appel ; `rendu` décide de la réponse (ou lève, pour couper le réseau). */
function bouchon(rendu: (url: string) => Response) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    appels.push({ url, init });
    try {
      return Promise.resolve(rendu(url));
    } catch (e) {
      return Promise.reject(e as Error);
    }
  });
}

// --- ce qui part ----------------------------------------------------------------------------------------

describe('la partie qui part au tableau', () => {
  it('nomme les joueurs, marque les bots, et remplace le « me » du moteur par l’identité locale', () => {
    const p = partieFinie(vueFinie({ p1: 120, 'bot:1': 40 }), tablee())!;
    expect(p.mode).toBe('solo');
    expect(p.rounds).toBe(5);
    expect(p.joueurs).toEqual([
      { id: 'uuid-alix', nom: 'Alix', total: 120, bot: false },
      { id: 'bot:1', nom: 'Pirate de bois', total: 40, bot: true },
    ]);
  });

  it('ne part pas d’une partie en cours, ni d’une table en ligne sans salle', () => {
    expect(partieFinie(vueFinie({ p1: 10, p2: 20 }, [], 'bidding'), tablee())).toBeNull();
    expect(partieFinie(vueFinie({ p1: 10, p2: 20 }), tablee({ mode: 'online', salle: null }))).toBeNull();
  });

  it('deux parties de la MÊME salle ne portent pas le même code (« Rejouer » garde le code de salle)', () => {
    const t = tablee({ mode: 'online', salle: 'ABCDEF' });
    const premiere = vueFinie({ p1: 120, p2: 90 }, [manche(1, 'p1', 1, 1, 20), manche(1, 'p2', 0, 1, -10)]);
    const seconde = vueFinie({ p1: 120, p2: 90 }, [manche(1, 'p1', 1, 0, -10), manche(1, 'p2', 0, 0, 10)]);
    expect(codeDePartie(premiere, t)).toMatch(/^ABCDEF-[a-z0-9]+$/);
    expect(codeDePartie(seconde, t)).not.toBe(codeDePartie(premiere, t));
    // …et la MÊME partie renvoyée (rechargement de page sur l'écran de fin) garde son code : le filet du serveur
    // peut alors faire son travail au lieu de compter la partie deux fois.
    expect(codeDePartie(vueFinie({ p1: 120, p2: 90 }, [manche(1, 'p1', 1, 1, 20), manche(1, 'p2', 0, 1, -10)]), t)).toBe(codeDePartie(premiere, t));
  });

  it('en ligne le code ne dépend pas de qui envoie ; en solo il dépend de l’appareil', () => {
    const v = vueFinie({ p1: 120, p2: 90 }, [manche(1, 'p1', 1, 1, 20)]);
    const enLigne = (moi: string) => codeDePartie(v, tablee({ mode: 'online', salle: 'ABCDEF', moi }));
    expect(enLigne('uuid-a')).toBe(enLigne('uuid-b'));
    const solo = (moi: string) => codeDePartie(v, tablee({ moi }));
    expect(solo('uuid-a')).not.toBe(solo('uuid-b'));
  });

  it('n’envoie qu’une fois, même appelée deux fois de suite — et rend le même verdict', async () => {
    bouchon(() => reponse({ ok: true }, 201));
    const p = partieFinie(vueFinie({ p1: 120, p2: 90 }), tablee())!;
    expect(await envoyerPartie(p)).toBe('envoyee');
    expect(await envoyerPartie(p)).toBe('envoyee');
    expect(appels).toHaveLength(1);
    expect(appels[0]!.url).toBe('/api/scores');
    expect(JSON.parse(String(appels[0]!.init?.body))).toMatchObject({ mode: 'solo', rounds: 5 });
  });

  it('deux envois lancés en même temps ne font qu’un POST, et apprennent tous deux le verdict', async () => {
    bouchon(() => reponse({ ok: true }, 201));
    const p = partieFinie(vueFinie({ p1: 120, p2: 90 }), tablee())!;
    // Deux montages de l'écran de fin dans la même seconde : le second tombe sur l'envoi EN VOL.
    expect(await Promise.all([envoyerPartie(p), envoyerPartie(p)])).toEqual(['envoyee', 'envoyee']);
    expect(appels).toHaveLength(1);
  });

  it('réseau coupé : l’envoi échoue sans lever, et le droit de réessayer reste ouvert', async () => {
    bouchon(() => {
      throw new Error('offline');
    });
    const p = partieFinie(vueFinie({ p1: 120, p2: 90 }), tablee())!;
    expect(await envoyerPartie(p)).toBe('echouee');
    bouchon(() => reponse({ ok: true }, 201));
    expect(await envoyerPartie(p)).toBe('envoyee');
  });

  it('un corps refusé (400) ne se retente pas, et garde son verdict à chaque appel', async () => {
    bouchon(() => reponse({ error: 'invalid' }, 400));
    const p = partieFinie(vueFinie({ p1: 120, p2: 90 }), tablee())!;
    expect(await envoyerPartie(p)).toBe('refusee');
    // Le second appel ne rappelle pas le serveur — et surtout ne rend pas un verdict tiède qui ferait
    // disparaître « Partie non enregistrée » de l'écran de fin.
    expect(await envoyerPartie(p)).toBe('refusee');
    expect(appels).toHaveLength(1);
  });

  it('un débit atteint (429) et une panne du serveur (5xx) rouvrent le droit de réessayer', async () => {
    const p = partieFinie(vueFinie({ p1: 120, p2: 90 }), tablee())!;
    // 502 de Traefik pendant un redéploiement, 503 d'un serveur qui redémarre, 500 d'une base verrouillée :
    // vingt secondes plus tard, tout est revenu. Sans seconde chance, la partie de la soirée est perdue.
    for (const status of [429, 500, 502, 503, 504]) {
      oublierLesEnvois();
      appels = [];
      bouchon(() => reponse({ error: 'x' }, status));
      expect(await envoyerPartie(p), `HTTP ${status}`).toBe('echouee');
      expect(await envoyerPartie(p), `HTTP ${status}`).toBe('echouee');
      expect(appels, `HTTP ${status} : chaque essai repart vraiment`).toHaveLength(2);
    }
    bouchon(() => reponse({ ok: true }, 201));
    expect(await envoyerPartie(p)).toBe('envoyee');
  });
});

// --- ce qui se lit --------------------------------------------------------------------------------------

describe('la lecture du classement', () => {
  it('demande la vue voulue et écarte les lignes bancales sans vider l’écran', async () => {
    bouchon(() => reponse({ entrees: [entree('Alix', 240, 3), { meilleur: 99 }, { nom: '  ', meilleur: 1 }, entree('Camille', 180)], parties: 7 }));
    const c = await chargerClassement('tout', 5);
    expect(appels[0]!.url).toBe('/api/leaderboard?mode=tout&limite=5');
    expect(c.entrees.map((e) => e.nom)).toEqual(['Alix', 'Camille']);
    expect(c.parties).toBe(7);
  });

  it('un serveur muet ou fâché donne une phrase à afficher, jamais une exception nue', async () => {
    bouchon(() => {
      throw new Error('offline');
    });
    await expect(chargerClassement('online')).rejects.toThrow(/connexion/);
    bouchon(() => reponse({}, 500));
    await expect(chargerClassement('online')).rejects.toThrow(/consultable/);
  });
});

// --- l'écran --------------------------------------------------------------------------------------------

describe('l’écran du tableau d’honneur', () => {
  const certified = (entries: ReturnType<typeof entree>[]) => ({ format: 'classic', players: 5, historical: 0, parties: entries.length ? 2 : 0,
    entrees: entries.map((e, i) => ({ ...e, playerId: `verified-${i}`, gameId: `game-${i}`, conditions: { players: 5, bots: [], rules: { kraken: false, whale: false, loot: false, pirateAbilities: true, rounds: 10 } } })) });
  it('sépare records solo et classement certifié et affiche les conditions au clic', async () => {
    bouchon(() => reponse(certified([entree('Camille', 310), entree('Alix', 220)])));
    render(Leaderboard);
    await waitFor(() => expect(screen.getByText('Camille')).toBeInTheDocument());
    expect(screen.getByTestId('solo-records')).toBeInTheDocument();
    expect(screen.getByTestId('multi-records')).toBeInTheDocument();
    expect(screen.getByTestId('legende')).toHaveTextContent('10 manches');
    const summary = screen.getByLabelText('1er : Camille, 310 points, voir les conditions');
    expect(summary.closest('details')).toHaveTextContent('cartes par manche : 1, 2, 3, 4, 5, 6, 7, 8, 9, 10');
    expect(appels.some((a) => a.url.includes('format=classic&players=5'))).toBe(true);
  });
  it('garde deux homonymes comme deux identités distinctes', async () => {
    bouchon(() => reponse(certified([entree('Alix', 310), entree('Alix', 220)])));
    render(Leaderboard);
    await waitFor(() => expect(screen.getAllByText('Alix')).toHaveLength(2));
    expect(screen.getByTestId('note-pseudo')).toHaveTextContent('restent séparés');
  });
  it('n’attribue pas à cet appareil une ligne par le seul pseudo', async () => {
    bouchon(() => reponse(certified([entree('Alix', 310)])));
    const { container } = render(Leaderboard);
    await waitFor(() => expect(screen.getByText('Alix')).toBeInTheDocument());
    expect(container.querySelector('.moi')).toBeNull();
  });
  it('explique un tableau vide et l’exclusion des déclarations historiques', async () => {
    bouchon(() => reponse(certified([])));
    render(Leaderboard);
    await waitFor(() => expect(screen.getByTestId('vide')).toHaveTextContent('Aucune partie admissible'));
    expect(screen.getByTestId('note-historical')).toHaveTextContent('conservées hors');
  });
  it('la panne réseau laisse les records solo disponibles et propose de réessayer', async () => {
    bouchon(() => { throw new Error('offline'); });
    render(Leaderboard);
    await waitFor(() => expect(screen.getByTestId('echec')).toBeInTheDocument());
    expect(screen.getByTestId('solo-records')).toBeInTheDocument();
    expect(screen.getByTestId('reessayer')).toBeInTheDocument();
    expect(screen.queryByTestId('chargement')).toBeNull();
  });
});

// --- le branchement sur la fin de partie ----------------------------------------------------------------
//
// C'est LE point délicat : qui envoie, et combien de fois. Une partie comptée deux fois fausse le classement
// sans que personne ne s'en aperçoive, et six clients qui envoient la même partie, c'est six fois le risque.

const transport = (): GameTransport => ({ send: () => {}, onView: () => () => {} });

describe('l’écran de fin laisse les scores à leur source', () => {

  const salle = (capitaine: string): RoomView =>
    ({
      code: 'ZZZZZZ',
      host: capitaine,
      status: 'playing',
      rules: { rounds: 5 },
      timerMode: 'none',
      seats: [
        { idx: 0, playerId: game.identity.playerId, name: 'Alix', botLevel: null, connected: true },
        { idx: 1, playerId: 'autre', name: 'Camille', botLevel: null, connected: true },
      ],
      ready: [],
      disconnectedSince: {},
      maxPlayers: 8,
      left: [],
    }) as unknown as RoomView;

  /** Monte l'écran de fin sur une partie terminée, dans le mode voulu. */
  function fin(mode: 'offline' | 'online' | 'scenario', capitaine = game.identity.playerId) {
    if (mode === 'online') online.room = salle(capitaine);
    attach(transport(), mode, {
      names: { p1: 'Alix', p2: 'Camille' },
      room: mode === 'online' ? { code: 'ZZZZZZ', host: capitaine === game.identity.playerId } : null,
    });
    game.view = vueFinie({ p1: 120, p2: 90 }, [manche(1, 'p1', 1, 1, 20)]);
    return render(GameOver);
  }

  const envoyees = () => appels.filter((a) => a.url === '/api/scores').map((a) => JSON.parse(String(a.init?.body)) as { code: string; mode: string });

  it('en solo : le record est local et le tableau est à un bouton', async () => {
    bouchon(() => reponse({ ok: true }, 201));
    fin('offline');
    await tick();
    expect(envoyees()).toEqual([]);
    expect(screen.getByTestId('solo-record-notice')).toBeInTheDocument();
    expect(screen.getByTestId('voir-classement')).toBeInTheDocument();
    expect(screen.queryByTestId('envoi-rate')).toBeNull();
  });

  it('en ligne, ni capitaine ni invité ne déclarent un score', async () => {
    bouchon(() => reponse({ ok: true }, 201));
    const invite = fin('online', 'un-autre-capitaine');
    await tick();
    expect(envoyees()).toEqual([]);
    invite.unmount();

    fin('online');
    await tick();
    expect(envoyees()).toEqual([]);
  });

  it('une situation du codex n’est pas une partie : elle ne part pas', async () => {
    bouchon(() => reponse({ ok: true }, 201));
    fin('scenario');
    await tick();
    expect(envoyees()).toEqual([]);
  });

  it('hors connexion, le podium et le lien vers les records restent disponibles', async () => {
    bouchon(() => {
      throw new Error('offline');
    });
    fin('offline');
    await tick();
    expect(envoyees()).toEqual([]);
    expect(screen.getByTestId('podium')).toBeInTheDocument();
    expect(screen.getByTestId('voir-classement')).toBeInTheDocument();
  });

  it('une nouvelle vue de salle ne déclenche aucune déclaration de score', async () => {
    bouchon(() => reponse({ error: 'invalid' }, 400));
    fin('online');
    online.room = { ...salle(game.identity.playerId), left: ['autre'] };
    await tick();
    expect(envoyees()).toEqual([]);
    expect(screen.getByTestId('podium')).toBeInTheDocument();
  });

  it('un pirate de bois en solo : le résultat reste consultable dans les records locaux', async () => {
    bouchon(() => reponse({ ok: true }, 201));
    // Une partie solo compte TOUJOURS un bot — c'est la première partie de tout le monde, et elle n'ira
    // jamais au tableau. Le dire ici est le seul moment où ça évite de croire à un bug.
    attach(transport(), 'offline', { names: { p1: 'Alix', 'bot:1': 'Barbe-Noire' }, bots: { 'bot:1': 'easy' } });
    game.view = vueFinie({ p1: 120, 'bot:1': 40 }, [manche(1, 'p1', 1, 1, 20)]);
    render(GameOver);
    await waitFor(() => expect(screen.getByTestId('solo-record-notice')).toBeInTheDocument());
    // La règle prime sur l'accident : pas deux lignes, et pas « non enregistrée » (ce serait une panne).
    expect(screen.queryByTestId('envoi-rate')).toBeNull();
    expect(screen.getByTestId('voir-classement')).toBeInTheDocument();
  });
});

// --- les portes du tableau -------------------------------------------------------------------------------
//
// Le tableau n'avait qu'UNE entrée dans toute l'application : le bouton de la fin de partie. « Qui mène ? » est
// pourtant la question qu'on se pose ENTRE deux parties — c'est-à-dire au moment exact où il était inatteignable.

describe('les portes du tableau d’honneur', () => {
  it('l’accueil en a une, assumée, après les deux planches et en dernier', async () => {
    render(Home);
    const porte = screen.getByTestId('classement-open');
    expect(porte.compareDocumentPosition(screen.getByTestId('friends'))).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    // Elle ferme la colonne. Elle était suivie d'un lien « Un bug ? Une idée ? », parti dans l'en-tête permanent :
    // le tableau est la dernière chose qu'on PROPOSE ici, les portes de service ne sont plus des propositions.
    expect(porte.parentElement?.lastElementChild).toBe(porte);
    await fireEvent.click(porte);
    expect(location.hash).toBe('#/classement');
    location.hash = '#/';
  });

  it('le tableau ouvert depuis la fin de partie sait y retourner', async () => {
    bouchon(() => reponse({ entrees: [entree('Alix', 300)], parties: 1 }));
    // Sans cette porte, aller voir sa place depuis le podium coûte le bouton « Rejouer » à qui joue en PWA iOS
    // installée : il n'y a pas de Précédent, et la seule sortie du tableau quitte la table.
    attach(transport(), 'offline', { names: { p1: 'Alix', p2: 'Camille' } });
    game.view = vueFinie({ p1: 120, p2: 90 });
    render(Leaderboard);
    await tick();
    expect(screen.getByTestId('multi-records')).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId('retour-podium'));
    expect(location.hash).toBe('#/over');
    location.hash = '#/';
  });

  it('sans partie finie, le tableau ne propose pas de podium où retourner', async () => {
    bouchon(() => reponse({ entrees: [entree('Alix', 300)], parties: 1 }));
    render(Leaderboard);
    await tick();
    expect(screen.getByTestId('multi-records')).toBeInTheDocument();
    expect(screen.queryByTestId('retour-podium')).toBeNull();
  });
});
