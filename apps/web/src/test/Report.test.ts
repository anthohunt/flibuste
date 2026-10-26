// Le report de bug : la feuille, l'envoi, et le contexte que le code fabrique tout seul.
//
// Trois choses sont vérifiées ici, et ce sont les trois qui décident qu'un rapport EXISTE :
//  1. le pseudo est déjà là (personne ne retape son nom pour signaler un bug) ;
//  2. le contexte part avec le rapport, rempli par le code — sans quoi « ça bugue » n'est pas réparable —
//     et il ne porte RIEN qui identifie quelqu'un au-delà de ce pseudo ;
//  3. un envoi qui rate ne coûte pas le texte écrit : la feuille reste, elle le dit, et le brouillon survit
//     même à la fermeture de l'onglet.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ReportSheet from '../components/ReportSheet.svelte';
import HelpSheet from '../components/HelpSheet.svelte';
import Home from '../routes/Home.svelte';
import Table from '../routes/Table.svelte';
import { preparerImage } from '../lib/image';
vi.mock('../lib/image', async (vrai) => ({ ...(await vrai<typeof import('../lib/image')>()), preparerImage: vi.fn() }));
import { NOM_MAX, TEXTE_MAX, fabriquerContexte, lireBrouillon } from '../lib/report';
import { live, resetLive } from '../lib/live.svelte';
import { attach, detach, game, setMyName, type BotLevelTag, type GameTransport } from '../lib/store.svelte';
import { defaultRules } from '../lib/presets';
import { EMPTY_EXPANSION } from '../lib/rulesMeta';
import { applyVariant } from '../lib/variants';
import type { PlayerId, PlayerView } from '../lib/types';

/** Le client ne lit que `status` et `json()` d'une réponse : le faux n'en promet pas plus. */
const reponse = (status: number, corps: unknown = {}) => ({ status, json: async () => corps }) as Response;

/** Un transport muet : le contexte lit le store, il n'attend rien d'une partie qui vit. */
const transport = (): GameTransport => ({ send: () => {}, onView: () => () => {} });

/**
 * Une vue de partie réduite à ce que le contexte lit : la manche, les sièges, la phase et les règles.
 * Trois sièges, manche 7, règles Classique sur 10 manches — la table ordinaire d'un vendredi soir.
 */
function vue(patch: Partial<PlayerView> = {}): PlayerView {
  const players: PlayerId[] = ['me', 'p1', 'p2'];
  const zero = Object.fromEntries(players.map((p) => [p, 0])) as Record<PlayerId, number>;
  return {
    me: 'me',
    players,
    round: 7,
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
    ...patch,
  };
}

/** Assied une partie : le mode, les bots, la table éventuelle, puis la vue. */
function enPartie(mode: 'offline' | 'online', v: PlayerView, bots: Record<PlayerId, BotLevelTag> = {}, code?: string) {
  attach(transport(), mode, { names: {}, bots, ...(code ? { room: { code, host: false } } : {}) });
  game.view = v;
}

/** Ce qui a été POSTÉ à `/api/report` au n-ième appel. */
function corpsEnvoye(appel = 0): { nom: string; texte: string; genre: string; contexte: Record<string, unknown>; image?: string } {
  const [url, init] = vi.mocked(fetch).mock.calls[appel] as [string, RequestInit];
  expect(url).toBe('/api/report');
  expect(init.method).toBe('POST');
  return JSON.parse(String(init.body)) as ReturnType<typeof corpsEnvoye>;
}

/**
 * Joint une capture à la feuille ouverte, sans passer par un vrai encodeur.
 *
 * On remplace `preparerImage` plutôt que de simuler un canvas : ce que ce fichier doit prouver, c'est que la
 * feuille EMPORTE la capture jusqu'au corps POSTÉ — la réduction elle-même a son propre test
 * (`reportImage.test.ts`), et la mêler ici rendrait l'échec illisible le jour où l'un des deux casse.
 */
async function joindreImage(dataUrl = 'data:image/webp;base64,UklGRg==') {
  vi.mocked(preparerImage).mockResolvedValue({ ok: true, image: { dataUrl, octets: 4, largeur: 800, hauteur: 600, type: 'image/webp' } });
  const champ = screen.getByTestId('report-image-champ');
  await fireEvent.change(champ, { target: { files: [new File([new Uint8Array([1])], 'c.png', { type: 'image/png' })] } });
  await screen.findByTestId('report-image-apercu');
}

/** Remplit la feuille et appuie sur « Envoyer ». */
async function ecrireEtEnvoyer(texte: string) {
  await fireEvent.input(screen.getByTestId('report-texte'), { target: { value: texte } });
  await fireEvent.click(screen.getByTestId('report-envoyer'));
}

beforeEach(() => {
  localStorage.clear();
  setMyName('Alix');
  resetLive(); // la région live dédoublonne : sans oubli, un test hériterait de l'annonce du précédent
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponse(201, { id: 7 })));
});

afterEach(() => {
  detach();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('le contexte, fabriqué par le code', () => {
  it('dit d’où part le rapport, et rien qui identifie quelqu’un', () => {
    const c = fabriquerContexte();
    expect(c.route).toBe('home');
    expect(c.ecran).toMatch(/^\d+×\d+$/);
    expect(c.navigateur.length).toBeGreaterThan(0);
    // Le pseudo est signé sur le rapport ; l'identité technique, elle, ne sort jamais du navigateur. Sans
    // cette ligne, un `{ ...game.identity }` glissé un jour dans le contexte passerait inaperçu.
    const serialise = JSON.stringify(c);
    expect(serialise).not.toContain(game.identity.playerId);
    expect(serialise).not.toContain(game.identity.token);
  });

  it('ajoute la table et le mode quand une partie est en cours', () => {
    game.room = { code: 'ABCDEF', host: true };
    game.mode = 'online';
    const c = fabriquerContexte();
    expect(c.table).toBe('ABCDEF');
    expect(c.mode).toBe('en ligne');
  });

  it('n’invente ni table ni mode hors partie', () => {
    const c = fabriquerContexte();
    expect(c.table).toBeUndefined();
    expect(c.mode).toBeUndefined();
    expect(c.partie).toBeUndefined();
  });
});

// Le bloc `partie` est la différence entre un rapport réparable et un aller-retour par SMS. Devant « la sirène a
// perdu contre le Roi des Flibustiers, ça devrait être l'inverse non ? », c'est lui qui dit si la Baleine blanche était en
// jeu — auquel cas le rapport est EXACT et il n'y a rien à corriger.
describe('le contexte dit la partie en cours', () => {
  it('la manche, les cartes, la phase, les sièges, les bots et les règles', () => {
    enPartie('online', vue(), { p2: 'normal' }, 'ABCDEF');
    expect(fabriquerContexte().partie).toEqual({ manche: 7, manches: 10, cartes: 7, phase: 'jeu', joueurs: 3, bots: 1, regles: 'Classique' });
  });

  it('en solo, où il est la SEULE trace qui existera jamais — pas de code de table, rien côté serveur', () => {
    enPartie('offline', vue({ phase: 'bidding' }), { p1: 'easy', p2: 'hard' });
    const c = fabriquerContexte();
    expect(c.mode).toBe('solo');
    expect(c.table).toBeUndefined();
    expect(c.partie).toMatchObject({ phase: 'paris', bots: 2, joueurs: 3 });
  });

  it('les bots se comptent aussi EN LIGNE : une salle en accepte, ne dit pas', () => {
    enPartie('online', vue(), { p1: 'hard', p2: 'normal' }, 'ABCDEF');
    expect(fabriquerContexte().partie?.bots).toBe(2);
  });

  it('énumère les règles quand elles sont personnalisées — c’est là que se logent les bugs de règle', () => {
    enPartie('offline', vue({ rules: { kraken: true, whale: false, loot: false, pirateAbilities: true, rounds: 10, expansion: { ...EMPTY_EXPANSION, stingray: true } } }));
    const r = fabriquerContexte().partie?.regles ?? '';
    expect(r).toContain('Personnalisée');
    expect(r).toContain('Kraken');
    expect(r).toContain('Raie tachetée');
    // Ce qui est ÉTEINT ne doit pas y figurer : sinon la ligne ne dit plus rien.
    expect(r).not.toContain('Baleine');
  });

  it('nomme la variante des manches, et compte les cartes — « manche 3 » ne les donne plus', () => {
    // Tourbillon : 9 · 9 · 7 · 7 · 5 · 5 · 3 · 3 · 1 · 1. La manche 3 distribue 7 cartes, pas 3.
    enPartie('offline', vue({ round: 3, rules: applyVariant(defaultRules(10), 'tourbillon') }));
    expect(fabriquerContexte().partie).toMatchObject({ manche: 3, manches: 10, cartes: 7, regles: 'Classique · Tourbillon' });
  });

  it('reste très loin du mur de 4 Kio, même règles à fond : un contexte refusé perdrait le rapport entier', () => {
    const toutes = { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 10, deals: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], expansion: { colourCards: true, wild15: true, hexer: true, volley: true, mate: true, stingray: true, davyJones: true, plank: true }, custom: { storm: true } };
    enPartie('online', vue({ rules: toutes }), { p1: 'hard', p2: 'normal' }, 'ABCDEF');
    expect(new TextEncoder().encode(JSON.stringify(fabriquerContexte())).length).toBeLessThan(1024);
  });

  it('ne fait pas sortir un identifiant de siège de la table — des comptes et des noms de règles, rien d’autre', () => {
    enPartie('online', vue(), { p2: 'normal' }, 'ABCDEF');
    const serialise = JSON.stringify(fabriquerContexte());
    expect(serialise).not.toContain(game.identity.playerId);
    expect(serialise).not.toContain(game.identity.token);
    // Les sièges se COMPTENT, ils ne se nomment pas : ni « me », ni « p1 », ni « p2 ».
    for (const siege of ['"me"', '"p1"', '"p2"']) expect(serialise).not.toContain(siege);
  });
});

describe('la feuille', () => {
  it('arrive avec le pseudo déjà rempli, un texte vide, et rien à trier', () => {
    render(ReportSheet, { props: { oncancel: () => {} } });
    expect(screen.getByTestId('report-nom')).toHaveValue('Alix');
    expect(screen.getByTestId('report-texte')).toHaveValue('');
    // Plus de choix « bug » ou « idée » : trier était notre travail, pas celui du joueur.
    expect(screen.queryByTestId('report-genre')).toBeNull();
    // Rien à envoyer tant que rien n'est écrit.
    expect(screen.getByTestId('report-envoyer')).toBeDisabled();
  });

  it('borne les champs sur le contrat (1-40 / 1-2000) au lieu de laisser le serveur refuser', () => {
    render(ReportSheet, { props: { oncancel: () => {} } });
    expect(screen.getByTestId('report-nom')).toHaveAttribute('maxlength', String(NOM_MAX));
    expect(screen.getByTestId('report-texte')).toHaveAttribute('maxlength', String(TEXTE_MAX));
  });

  it('envoie le contrat, avec son contexte, puis se referme', async () => {
    const onsent = vi.fn();
    render(ReportSheet, { props: { oncancel: () => {}, onsent } });
    await ecrireEtEnvoyer('  Le pli reste affiché après la manche.  ');
    await waitFor(() => expect(onsent).toHaveBeenCalled());
    const corps = corpsEnvoye();
    expect(corps.nom).toBe('Alix');
    // Espaces de bord retirés : c'est du texte tapé sur un téléphone.
    expect(corps.texte).toBe('Le pli reste affiché après la manche.');
    expect(corps.genre).toBe('remarque');
    expect(corps.contexte.route).toBe('home');
  });

  it('envoie toujours une remarque, quoi que le joueur écrive', async () => {
    render(ReportSheet, { props: { oncancel: () => {} } });
    await ecrireEtEnvoyer('Un mode 2 joueurs avec un mort.');
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(corpsEnvoye().genre).toBe('remarque');
  });

  it('ne compte les caractères qu’à l’approche du mur', async () => {
    render(ReportSheet, { props: { oncancel: () => {} } });
    expect(screen.queryByTestId('report-reste')).toBeNull();
    await fireEvent.input(screen.getByTestId('report-texte'), { target: { value: 'x'.repeat(TEXTE_MAX - 10) } });
    expect(screen.getByTestId('report-reste')).toHaveTextContent('10 caractères');
  });
});

describe('quand l’envoi rate', () => {
  it('garde le texte à l’écran, ne referme pas, et le dit', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    const oncancel = vi.fn();
    render(ReportSheet, { props: { oncancel } });
    await ecrireEtEnvoyer('Le son double sur le dernier pli.');
    await waitFor(() => expect(screen.getByTestId('report-note')).toBeInTheDocument());
    expect(screen.getByTestId('report-note')).toHaveTextContent('Pas de réseau');
    expect(screen.getByTestId('report-note')).toHaveTextContent('rien n’est perdu');
    // Ce qui compte vraiment : le texte est toujours là, et la feuille aussi.
    expect(screen.getByTestId('report-texte')).toHaveValue('Le son double sur le dernier pli.');
    expect(oncancel).not.toHaveBeenCalled();
    // Et l'échec passe par la région live de l'app — celle qui existe en permanence, pas une région montée
    // avec son propre texte, qu'aucun lecteur d'écran ne lit de façon fiable.
    await waitFor(() => expect(live.alert).toContain('Pas de réseau'));
  });

  it('recopie le message du serveur quand il en donne un — c’est lui qui sait combien de temps attendre', async () => {
    vi.mocked(fetch).mockResolvedValue(reponse(429, { error: 'rate-limited', msg: 'Doucement, moussaillon — trop de messages, réessaie dans 42 s' }));
    render(ReportSheet, { props: { oncancel: () => {} } });
    await ecrireEtEnvoyer('Encore un.');
    await waitFor(() => expect(screen.getByTestId('report-note')).toHaveTextContent('réessaie dans 42 s'));
  });

  it('range un brouillon que la prochaine ouverture retrouve, et qu’un envoi réussi efface', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    const premiere = render(ReportSheet, { props: { oncancel: () => {} } });
    await ecrireEtEnvoyer('Un classement des parties.');
    await waitFor(() => expect(lireBrouillon()).not.toBeNull());
    premiere.unmount();

    // Onglet fermé, feuille rouverte : le texte et le nom sont revenus, et la feuille dit pourquoi.
    vi.mocked(fetch).mockResolvedValue(reponse(201, { id: 8 }));
    render(ReportSheet, { props: { oncancel: () => {} } });
    expect(screen.getByTestId('report-texte')).toHaveValue('Un classement des parties.');
    expect(screen.getByTestId('report-note')).toHaveTextContent('n’était pas passé');

    await fireEvent.click(screen.getByTestId('report-envoyer'));
    await waitFor(() => expect(lireBrouillon()).toBeNull());
  });
});

// Les portes du report. Il y en avait une PAR ÉCRAN, chacune à sa place — un lien pâle en pied d'accueil, deux
// dans le salon en ligne, un chip sous les règles à table — et donc aucune qu'on puisse apprendre. Il en reste
// deux, et elles ne font pas le même métier :
//  · l'en-tête permanent (`AppHeader`, testé par `AppHeader.test.ts`) la porte sur TOUS les écrans, à la même
//    place : c'est elle qui a remplacé celles des écrans ;
//  · la feuille d'aide garde la sienne parce qu'une feuille ouverte COUVRE l'en-tête — depuis les règles,
//    l'engrenage et ses voisins sont hors d'atteinte tant qu'on n'a pas refermé.
describe('les deux portes', () => {
  it('l’accueil n’en a plus : la redessiner ici ferait deux portes pour un geste', () => {
    render(Home);
    // L'accueil portait un lien « Un bug ? Une idée ? » tout en bas, sous les planches. Il ne disait rien de
    // plus que l'en-tête, deux pouces plus haut, et il disparaissait dès qu'on quittait la taverne.
    expect(screen.queryByTestId('report-open')).toBeNull();
    // Ce qui reste sur cet accueil est ce qu'on vient y faire : jouer, apprendre, voir qui mène.
    expect(screen.getByTestId('friends')).toBeInTheDocument();
    expect(screen.getByTestId('classement-open')).toBeInTheDocument();
  });

  it('l’aide présente le tutoriel puis le signalement avant sa fermeture', () => {
    render(HelpSheet, { props: { oncancel: () => {} } });
    const porte = screen.getByTestId('help-report');
    // La feuille est un `max-h-[85dvh] overflow-y-auto` : sous « Compris », la porte se cherchait après toutes
    // les règles — c'est-à-dire SOUS la fin visuelle de la feuille.
    expect(porte.compareDocumentPosition(screen.getByRole('button', { name: 'Compris' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const tutorial = screen.getByTestId('tutorial-start');
    expect(screen.getByTestId('help-sheet')).toContainElement(tutorial);
    expect(tutorial.compareDocumentPosition(porte)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('dans une situation, le « ? » annonce les deux usages de la feuille qu’il ouvre', () => {
    enPartie('offline', vue());
    render(Table, { props: { embedded: true } });
    // « Comment on joue ? » ne nommait que la moitié de ce que le bouton ouvre — et le glyphe « ? » ne dit rien.
    // Ce n'est plus la SEULE porte du report en partie (l'en-tête en a une), mais c'est toujours ce que CETTE
    // feuille contient : le nom doit décrire ce qui s'ouvre, pas ce qui est unique.
    expect(screen.getByTestId('help')).toHaveAccessibleName('Aide et signalement');
  });

  it('la feuille d’aide a la sienne, et le report y prend la place des règles', async () => {
    const oncancel = vi.fn();
    render(HelpSheet, { props: { oncancel } });
    await fireEvent.click(screen.getByTestId('help-report'));
    // Le report REMPLACE l'aide : deux feuilles empilées, ce serait deux voiles et deux pièges de focus.
    expect(screen.getByTestId('report-sheet')).toBeInTheDocument();
    expect(screen.queryByTestId('help-sheet')).toBeNull();

    // Refermer le report ramène l'aide sans la fermer ; l'envoyer ferme les deux.
    await fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.getByTestId('help-sheet')).toBeInTheDocument();
    expect(oncancel).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByTestId('help-report'));
    await ecrireEtEnvoyer('La feuille d’aide se ferme toute seule.');
    await waitFor(() => expect(oncancel).toHaveBeenCalled());
  });
});

describe('la capture d’écran jointe', () => {
  it('part avec le rapport, et seulement si on en a joint une', async () => {
    render(ReportSheet, { oncancel: () => {} });
    await ecrireEtEnvoyer('Le bandeau se superpose aux cartes');
    // Sans capture, la clé est ABSENTE du corps, pas vide : le serveur distingue « pas de capture » de
    // « capture illisible », et une chaîne vide le forcerait à confondre les deux.
    expect('image' in corpsEnvoye()).toBe(false);
  });

  it('montre un aperçu avec ses dimensions et son poids, puis l’emporte dans le corps POSTÉ', async () => {
    render(ReportSheet, { oncancel: () => {} });
    await joindreImage('data:image/webp;base64,ABCD');
    expect(screen.getByTestId('report-image-poids').textContent).toContain('800×600');
    await ecrireEtEnvoyer('Regarde l’écran');
    expect(corpsEnvoye().image).toBe('data:image/webp;base64,ABCD');
  });

  it('se retire, et le rapport repart alors sans elle', async () => {
    render(ReportSheet, { oncancel: () => {} });
    await joindreImage();
    await fireEvent.click(screen.getByTestId('report-image-retirer'));
    expect(screen.queryByTestId('report-image-apercu')).toBeNull();
    await ecrireEtEnvoyer('Finalement non');
    expect('image' in corpsEnvoye()).toBe(false);
  });

  it('dit pourquoi quand la capture est refusée, sans toucher au texte déjà écrit', async () => {
    render(ReportSheet, { oncancel: () => {} });
    await fireEvent.input(screen.getByTestId('report-texte'), { target: { value: 'un texte précieux' } });
    vi.mocked(preparerImage).mockResolvedValue({ ok: false, message: 'Ce fichier n’est pas une image.' });
    await fireEvent.change(screen.getByTestId('report-image-champ'), {
      target: { files: [new File([new Uint8Array([1])], 'notes.pdf', { type: 'application/pdf' })] },
    });
    expect((await screen.findByTestId('report-note')).textContent).toContain('n’est pas une image');
    expect((screen.getByTestId('report-texte') as HTMLTextAreaElement).value).toBe('un texte précieux');
    expect(screen.queryByTestId('report-image-apercu')).toBeNull();
  });

  it('ne range PAS la capture dans le brouillon d’un envoi raté — elle mangerait le stockage de la partie', async () => {
    // 400 et non 500 : un 5xx déclenche le second essai d'`envoyerRapport` (1,2 s d'attente), et ce test-ci
    // ne parle pas du réessai. Les deux rangent le même brouillon.
    vi.mocked(fetch).mockResolvedValue(reponse(400, { error: 'invalid', msg: 'refusé' }));
    render(ReportSheet, { oncancel: () => {} });
    await joindreImage('data:image/webp;base64,' + 'A'.repeat(2000));
    await ecrireEtEnvoyer('ça a raté');
    await screen.findByTestId('report-note');
    const brut = localStorage.getItem('flibuste:rapport-brouillon') ?? '';
    expect(brut).toContain('ça a raté');
    expect(brut).not.toContain('AAAA');
  });
});
