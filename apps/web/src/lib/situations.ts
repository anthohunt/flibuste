// Les situations du codex (vague 6) : ~50 mini-parties, 2–3 par carte spéciale, 1 par couleur, 4 pour la Tempête.
// Chaque situation déclare son format (`trick` : un pli ; `round` : une manche courte quand la carte s'apprend
// sur plusieurs plis — pouvoirs, Tempête, Butin, Salve), la scène (`spec` → `scenarioState`), le script des
// adversaires, le coup attendu de moi (`mine`, pour le test) et le résultat que le moteur doit donner (`expected`).
// Le commentaire affiché est TOUJOURS calculé par le moteur (`describeTrick` / `describeRound`) ; `lesson` est la
// phrase pédagogique ajoutée, `prompt` ce qu'on te propose de faire.
import type { AbilityChoice, PlayAs, PlayerId } from './types';
import type { ScenarioFormat, ScenarioSpec, Script } from './scenario';

export type MyMove = { bid: number } | { card: string; as?: PlayAs } | { ability: AbilityChoice } | { pass: string } | { keep: string[] };

export interface Situation {
  id: string;
  /** Fiche du codex (`pirateking`, `helm`, `parrot`…). */
  card: string;
  title: string;
  format: ScenarioFormat;
  /** Ce qu'on te propose (affiché au départ). */
  prompt: string;
  /** La phrase pédagogique (affichée avec le commentaire du moteur). */
  lesson: string;
  spec: ScenarioSpec;
  script?: Script;
  /** Le coup attendu de moi, dans l'ordre (le test le joue ; le joueur fait ce qu'il veut). */
  mine: MyMove[];
  expected: {
    /** Format `trick` : le gagnant du pli (null = défaussé). */
    winner?: PlayerId | null;
    /** Format `trick` : qui mène le pli suivant. */
    nextLeader?: PlayerId;
    /** Format `round` : le total de la manche par joueur. */
    score?: Record<PlayerId, number>;
  };
}

export const ME: PlayerId = 'me';
export const SCENARIO_PLAYERS: PlayerId[] = ['me', 'anne', 'bob'];
export const SCENARIO_NAMES: Record<PlayerId, string> = { anne: 'Anne', bob: 'Bob' };

const P = SCENARIO_PLAYERS;
/** Un pli sans pouvoirs : la leçon porte sur la carte, pas sur le pouvoir qui suivrait. */
const NO_POWERS = { pirateAbilities: false };
const EXT = { expansion: { colourCards: true, wild15: true, hexer: true, volley: true, mate: true, stingray: true, davyJones: true, plank: true } };
const STORM = { custom: { storm: true } };

type Play = { player: PlayerId; card: string; as?: PlayAs };
const trick = (leader: PlayerId, ...plays: Play[]) => ({ leader, plays });
const bids = (me: number, anne: number, bob: number) => ({ me, anne, bob });

export const SITUATIONS: readonly Situation[] = [
  // --- Roi des Flibustiers ---------------------------------------------------------------------------------------------
  {
    id: 'flibuste-beats-pirate',
    card: 'pirateking',
    title: 'Le roi bat les pirates',
    format: 'trick',
    prompt: 'Anne a ouvert avec Maren la Timonière, Bob a suivi. Pose le Roi des Flibustiers.',
    lesson: 'Le Roi des Flibustiers bat tous les pirates ; une sirène peut le capturer. Chaque pirate capturé rapporte +30 si ton pari tient.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['pirateking', 'parrot-3'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(1, 0, 0), trick: trick('anne', { player: 'anne', card: 'pirate-helm' }, { player: 'bob', card: 'parrot-9' }) },
    mine: [{ card: 'pirateking' }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
  {
    id: 'flibuste-caught-by-mermaid',
    card: 'pirateking',
    title: 'Pris par la sirène',
    format: 'trick',
    prompt: 'Tu mènes. Ouvre avec le Roi des Flibustiers… et regarde Anne.',
    lesson: 'Une sirène capture le Roi des Flibustiers : +40 pour elle si son pari tient. Les sirènes encore en main menacent donc ton roi.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['pirateking', 'chest-2'], anne: ['mermaid-1', 'parrot-4'], bob: ['chest-5', 'parrot-6'] }, bids: bids(1, 1, 0), trick: trick('me') },
    script: { plays: { anne: ['mermaid-1'], bob: ['chest-5'] } },
    mine: [{ card: 'pirateking' }],
    expected: { winner: 'anne', nextLeader: 'anne' },
  },
  {
    id: 'flibuste-leads',
    card: 'pirateking',
    title: 'Le roi mené ne demande rien',
    format: 'trick',
    prompt: 'Tu mènes avec le Roi des Flibustiers : les autres jouent ce qu’ils veulent.',
    lesson: 'Le Roi des Flibustiers mené n’impose aucune couleur — Anne en profite pour se débarrasser d’un pirate… qui te rapporte +30 si ton pari tient.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['pirateking', 'chest-2'], anne: ['pirate-adjuster', 'parrot-4'], bob: ['escape-1', 'parrot-6'] }, bids: bids(1, 0, 0), trick: trick('me') },
    script: { plays: { anne: ['pirate-adjuster'], bob: ['escape-1'] } },
    mine: [{ card: 'pirateking' }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
  // --- Sirène --------------------------------------------------------------------------------------------------
  {
    id: 'mermaid-catches-king',
    card: 'mermaid',
    title: 'La sirène capture le roi',
    format: 'trick',
    prompt: 'Anne a posé le Roi des Flibustiers. Réponds avec ta sirène.',
    lesson: 'La sirène est la seule carte qui capture le Roi des Flibustiers : +40 si ton pari tient.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['mermaid-1', 'parrot-2'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(1, 1, 0), trick: trick('anne', { player: 'anne', card: 'pirateking' }, { player: 'bob', card: 'parrot-9' }) },
    mine: [{ card: 'mermaid-1' }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
  {
    id: 'mermaid-loses-to-pirate',
    card: 'mermaid',
    title: 'Le pirate bat la sirène',
    format: 'trick',
    prompt: 'Anne a ouvert avec une sirène. Ton pirate la capture.',
    lesson: 'Sans Roi des Flibustiers dans le pli, un pirate bat la sirène : +20 pour lui si son pari tient.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['pirate-gambler', 'parrot-2'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(1, 0, 0), trick: trick('anne', { player: 'anne', card: 'mermaid-1' }, { player: 'bob', card: 'parrot-9' }) },
    mine: [{ card: 'pirate-gambler' }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
  {
    id: 'mermaid-triangle',
    card: 'mermaid',
    title: 'Sirène, pirate et roi',
    format: 'trick',
    prompt: 'Un pirate et le Roi des Flibustiers sont déjà sur la table. Pose ta sirène.',
    lesson: 'Sirène + pirate + Roi des Flibustiers dans le même pli : la sirène gagne. Capturer le roi rapporte +40 si son pari tient ; le pirate n’ajoute aucun bonus.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['mermaid-2', 'chest-3'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(1, 0, 0), trick: trick('anne', { player: 'anne', card: 'pirate-trader' }, { player: 'bob', card: 'pirateking' }) },
    mine: [{ card: 'mermaid-2' }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
  // --- Maren la Timonière ------------------------------------------------------------------------------------------
  {
    id: 'helm-choose-leader',
    card: 'helm',
    title: 'Maren choisit le meneur',
    format: 'round',
    prompt: 'Deux cartes chacun, tu as parié 1. Gagne le premier pli avec Maren, puis choisis qui mène.',
    lesson: 'Maren gagne un pli : tu désignes le meneur du suivant — toi ou un autre.',
    spec: { players: P, me: ME, hands: { me: ['pirate-helm', 'parrot-2'], anne: ['parrot-10'], bob: ['parrot-5'] }, bids: bids(1, 1, 0), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'chest-4' }) },
    script: { plays: { anne: ['parrot-10'], bob: ['parrot-5'] } },
    mine: [{ card: 'pirate-helm' }, { ability: { leader: 'me' } }, { card: 'parrot-2' }],
    expected: { score: { me: 20, anne: 20, bob: 20 } },
  },
  {
    id: 'helm-give-lead',
    card: 'helm',
    title: 'Donne la main pour tenir ton pari',
    format: 'round',
    prompt: 'Tu as parié 1 et Maren va gagner ce pli. Ton 13 noir gagnerait un pli de trop… sauf si Anne mène en noir.',
    lesson: 'Le meneur choisi par Maren change tout : Anne ouvre avec son 14 noir, ton 13 doit suivre et perd — pari tenu.',
    spec: { players: P, me: ME, hands: { me: ['pirate-helm', 'roger-13'], anne: ['roger-14'], bob: ['chest-8'] }, bids: bids(1, 1, 0), trick: trick('anne', { player: 'anne', card: 'chest-3' }, { player: 'bob', card: 'chest-6' }) },
    script: { plays: { anne: ['roger-14'], bob: ['chest-8'] } },
    mine: [{ card: 'pirate-helm' }, { ability: { leader: 'anne' } }, { card: 'roger-13' }],
    expected: { score: { me: 20, anne: 40, bob: 20 } },
  },
  // --- Orsolo le Brocanteur ------------------------------------------------------------------------------------------
  {
    id: 'trader-keep-low',
    card: 'trader',
    title: 'Orsolo pioche, tu tries',
    format: 'round',
    prompt: 'Pari 1. Orsolo gagne ce pli : tu pioches 2 cartes et tu en défausses 2. Garde le petit Albatros, défausse les deux piochées.',
    lesson: 'Orsolo le Brocanteur renouvelle ta main : défausse les cartes qui gagneraient un pli de trop.',
    spec: { seed: 'mix-154', players: P, me: ME, hands: { me: ['pirate-trader', 'parrot-2'], anne: ['parrot-10'], bob: ['parrot-5'] }, bids: bids(1, 1, 0), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'chest-4' }) },
    script: { plays: { anne: ['parrot-10'], bob: ['parrot-5'] } },
    mine: [{ card: 'pirate-trader' }, { keep: ['parrot-2'] }, { card: 'parrot-2' }],
    expected: { score: { me: 20, anne: 20, bob: 20 } },
  },
  {
    id: 'trader-keep-strong',
    card: 'trader',
    title: 'Orsolo pioche un atout',
    format: 'round',
    prompt: 'Pari 2. Orsolo gagne ce pli, tu pioches un 13 noir : garde-le pour le dernier pli, défausse le reste.',
    lesson: 'Avec un pari haut, Orsolo te donne une seconde chance : garde la carte qui gagne, défausse le reste.',
    spec: { seed: 'mix-154', players: P, me: ME, hands: { me: ['pirate-trader', 'parrot-2'], anne: ['parrot-10'], bob: ['parrot-5'] }, bids: bids(2, 1, 0), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'chest-4' }) },
    script: { plays: { anne: ['parrot-10'], bob: ['parrot-5'] } },
    mine: [{ card: 'pirate-trader' }, { keep: ['roger-13'] }, { card: 'roger-13' }],
    expected: { score: { me: 40, anne: -10, bob: 20 } },
  },
  // --- Gaspard l’Ajusteur ------------------------------------------------------------------------------------------
  {
    id: 'adjuster-lower-bid',
    card: 'adjuster',
    title: 'Gaspard baisse ton pari',
    format: 'round',
    prompt: 'Tu as parié 2, trop haut. Gaspard gagne ce pli : ramène ton pari à 1.',
    lesson: 'Gaspard l’Ajusteur ajuste ton pari de ±1 après coup : un pari trop haut redevient tenable.',
    spec: { players: P, me: ME, hands: { me: ['pirate-adjuster', 'parrot-2'], anne: ['parrot-10'], bob: ['parrot-5'] }, bids: bids(2, 1, 0), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'chest-4' }) },
    script: { plays: { anne: ['parrot-10'], bob: ['parrot-5'] } },
    mine: [{ card: 'pirate-adjuster' }, { ability: { delta: -1 } }, { card: 'parrot-2' }],
    expected: { score: { me: 20, anne: 20, bob: 20 } },
  },
  {
    id: 'adjuster-raise-bid',
    card: 'adjuster',
    title: 'Gaspard sauve un pari à 0',
    format: 'round',
    prompt: 'Tu as parié 0 mais tu n’as ni Doublon ni fuite : tu vas prendre ce pli. Prends-le avec Gaspard et monte ton pari à 1.',
    lesson: 'Un pari à 0 cuit se rattrape avec Gaspard : +1, et le pli forcé devient le pli prévu.',
    spec: { players: P, me: ME, hands: { me: ['pirate-adjuster', 'roger-3'], anne: ['roger-12'], bob: ['parrot-5'] }, bids: bids(0, 1, 0), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'chest-4' }) },
    script: { plays: { anne: ['roger-12'], bob: ['parrot-5'] } },
    mine: [{ card: 'pirate-adjuster' }, { ability: { delta: 1 } }, { card: 'roger-3' }],
    expected: { score: { me: 20, anne: 20, bob: 20 } },
  },
  {
    id: 'adjuster-last-trick',
    card: 'adjuster',
    title: 'Gaspard, même au dernier pli',
    format: 'round',
    prompt: 'Dernier pli de la manche, tu as parié 0. Prends-le avec Gaspard et monte ton pari à 1 : Gaspard est le seul pirate dont le pouvoir s’utilise après le dernier pli.',
    lesson: 'Après le dernier pli, Maren, Orsolo, Isidora, Mathilde et Rufus se taisent ; Gaspard, lui, ajuste encore ton pari de ±1 avant le décompte.',
    spec: { players: P, me: ME, hands: { me: ['pirate-adjuster'], anne: [], bob: [] }, bids: bids(0, 0, 0), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'chest-4' }) },
    mine: [{ card: 'pirate-adjuster' }, { ability: { delta: 1 } }],
    expected: { score: { me: 20, anne: 10, bob: 10 } },
  },
  // --- Isidora l’Oracle --------------------------------------------------------------------------------------------
  {
    id: 'oracle-peek',
    card: 'oracle',
    title: 'Isidora regarde le talon',
    format: 'round',
    prompt: 'Isidora gagne ce pli : tu vois le talon, toutes les cartes que personne n’a en main.',
    lesson: 'Isidora te montre les cartes non distribuées : tu sais ce que les autres ne peuvent pas avoir.',
    spec: { players: P, me: ME, hands: { me: ['pirate-oracle', 'parrot-2'], anne: ['parrot-10'], bob: ['parrot-5'] }, bids: bids(1, 1, 0), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'chest-4' }) },
    script: { plays: { anne: ['parrot-10'], bob: ['parrot-5'] } },
    mine: [{ card: 'pirate-oracle' }, { ability: { ack: true } }, { card: 'parrot-2' }],
    expected: { score: { me: 20, anne: 20, bob: 20 } },
  },
  {
    id: 'oracle-safe-14',
    card: 'oracle',
    title: 'Le 14 est sûr',
    format: 'round',
    prompt: 'Pari 2. Isidora gagne : le talon te dit ce qui n’est chez personne — ton 14 Albatros gagnera le dernier pli.',
    lesson: 'Savoir ce qui n’est pas en jeu vaut de l’or : ton 14 de couleur devient une carte sûre, +10 en prime.',
    spec: { players: P, me: ME, hands: { me: ['pirate-oracle', 'parrot-14'], anne: ['parrot-10'], bob: ['parrot-5'] }, bids: bids(2, 1, 0), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'chest-4' }) },
    script: { plays: { anne: ['parrot-10'], bob: ['parrot-5'] } },
    mine: [{ card: 'pirate-oracle' }, { ability: { ack: true } }, { card: 'parrot-14' }],
    expected: { score: { me: 50, anne: -10, bob: 20 } },
  },
  // --- Rufus le Parieur --------------------------------------------------------------------------------------
  {
    id: 'gambler-bet-20',
    card: 'gambler',
    title: 'Rufus mise gros',
    format: 'round',
    prompt: 'Pari 2 et un 12 noir en main : Rufus gagne ce pli, mise 20 sur ta manche.',
    lesson: 'Rufus parie 0, 10 ou 20 en plus : si ton pari tient, la mise s’ajoute ; sinon elle se retire.',
    spec: { players: P, me: ME, hands: { me: ['pirate-gambler', 'roger-12'], anne: ['parrot-10'], bob: ['parrot-5'] }, bids: bids(2, 1, 0), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'chest-4' }) },
    script: { plays: { anne: ['parrot-10'], bob: ['parrot-5'] } },
    mine: [{ card: 'pirate-gambler' }, { ability: { bet: 20 } }, { card: 'roger-12' }],
    expected: { score: { me: 60, anne: -10, bob: 20 } },
  },
  {
    id: 'gambler-bet-10',
    card: 'gambler',
    title: 'Une petite mise sûre',
    format: 'round',
    prompt: 'Pari 1, ce pli est le tien. Mise 10, puis laisse le dernier pli à Anne.',
    lesson: 'Une mise de Rufus se gagne comme le pari : tiens-le, et les 10 sont à toi.',
    spec: { players: P, me: ME, hands: { me: ['pirate-gambler', 'parrot-2'], anne: ['parrot-10'], bob: ['parrot-5'] }, bids: bids(1, 1, 0), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'chest-4' }) },
    script: { plays: { anne: ['parrot-10'], bob: ['parrot-5'] } },
    mine: [{ card: 'pirate-gambler' }, { ability: { bet: 10 } }, { card: 'parrot-2' }],
    expected: { score: { me: 30, anne: 20, bob: 20 } },
  },
  // --- Tigresse ------------------------------------------------------------------------------------------------
  {
    id: 'tigress-as-pirate',
    card: 'tigress',
    title: 'La Tigresse en pirate',
    format: 'trick',
    prompt: 'Anne a ouvert avec une sirène. Joue la Tigresse… en pirate.',
    lesson: 'Déclarée pirate, la Tigresse capture la sirène comme un pirate : +20 si ton pari tient.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['tigress', 'parrot-2'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(1, 0, 0), trick: trick('anne', { player: 'anne', card: 'mermaid-1' }, { player: 'bob', card: 'parrot-9' }) },
    mine: [{ card: 'tigress', as: 'pirate' }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
  {
    id: 'tigress-as-escape',
    card: 'tigress',
    title: 'La Tigresse en fuite',
    format: 'trick',
    prompt: 'Tu as le 13 Albatros mais tu ne veux pas ce pli. La Tigresse en fuite l’esquive.',
    lesson: 'Déclarée fuite, la Tigresse se joue même quand tu as la couleur : le pli va à Bob.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['tigress', 'parrot-13'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(0, 0, 1), trick: trick('anne', { player: 'anne', card: 'parrot-9' }, { player: 'bob', card: 'parrot-12' }) },
    mine: [{ card: 'tigress', as: 'escape' }],
    expected: { winner: 'bob', nextLeader: 'bob' },
  },
  // --- Fuite ---------------------------------------------------------------------------------------------------
  {
    id: 'escape-dodge',
    card: 'escape',
    title: 'Esquiver un pli',
    format: 'trick',
    prompt: 'Tu as parié 0 et le 13 Doublon en main. Sauve-toi avec la Fuite.',
    lesson: 'La Fuite se joue même si tu as la couleur et perd contre les numéros et personnages. Si tout le monde fuit, la première fuite gagne.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['escape-1', 'chest-13'], anne: ['parrot-2'], bob: ['parrot-5'] }, bids: bids(0, 0, 1), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'chest-12' }) },
    mine: [{ card: 'escape-1' }],
    expected: { winner: 'bob', nextLeader: 'bob' },
  },
  {
    id: 'escape-only-escapes',
    card: 'escape',
    title: 'Que des fuites',
    format: 'trick',
    prompt: 'Anne et Bob ont fui. Fuis aussi : quelqu’un gagne quand même.',
    lesson: 'Quand tout le monde fuit, la première fuite posée remporte le pli — Anne ne voulait pas de celui-là.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['escape-3', 'parrot-2'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(0, 0, 0), trick: trick('anne', { player: 'anne', card: 'escape-1' }, { player: 'bob', card: 'escape-2' }) },
    mine: [{ card: 'escape-3' }],
    expected: { winner: 'anne', nextLeader: 'anne' },
  },
  {
    // CT-04 : la fiche disait — un pli libre. Le règles 
    // (« Débuter avec une fuite ») et le moteur (`ledSuit` remonte au premier numéro) disent l'inverse.
    id: 'escape-leads-next-decides',
    card: 'escape',
    title: 'Mener avec une fuite',
    format: 'trick',
    prompt: 'Tu ne veux pas de ce pli et c’est à toi de mener. Ouvre avec la Fuite : c’est Anne qui fixera la couleur.',
    lesson: 'Après des fuites en tête, la première carte qui n’est pas une fuite décide : un numéro fixe sa couleur, un personnage laisse le pli libre. Ici Anne pose du Albatros : Bob doit suivre s’il joue un numéro.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['escape-1', 'chest-13'], anne: ['parrot-9', 'chest-2'], bob: ['parrot-5', 'map-12'] }, bids: bids(0, 1, 0), trick: trick('me') },
    script: { plays: { anne: ['parrot-9'], bob: ['parrot-5'] } },
    mine: [{ card: 'escape-1' }],
    expected: { winner: 'anne', nextLeader: 'anne' },
  },
  // --- Butin ---------------------------------------------------------------------------------------------------
  {
    id: 'loot-alliance',
    card: 'loot',
    title: 'Le Butin scelle une alliance',
    format: 'trick',
    prompt: 'Joue le Butin : il fuit, et t’allie au gagnant du pli.',
    lesson: 'Le Butin vaut une fuite ; celui qui prend le pli devient ton allié : +20 chacun si vos deux paris tiennent.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['loot-1', 'chest-3'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(0, 0, 1), trick: trick('anne', { player: 'anne', card: 'parrot-9' }, { player: 'bob', card: 'parrot-12' }) },
    mine: [{ card: 'loot-1' }],
    expected: { winner: 'bob', nextLeader: 'bob' },
  },
  {
    id: 'loot-payout',
    card: 'loot',
    title: 'L’alliance rapporte',
    format: 'round',
    prompt: 'Pari 0. Pose le Butin sur le pli de Bob, puis perds le dernier pli : vous touchez +20 chacun, Anne rien.',
    lesson: 'Le bonus du Butin tombe seulement si les deux alliés tiennent leur pari — le tien comme le sien.',
    spec: { players: P, me: ME, hands: { me: ['loot-1', 'chest-3'], anne: ['chest-8'], bob: ['chest-9'] }, bids: bids(0, 0, 2), trick: trick('anne', { player: 'anne', card: 'parrot-9' }, { player: 'bob', card: 'parrot-12' }) },
    script: { plays: { bob: ['chest-9'], anne: ['chest-8'] } },
    mine: [{ card: 'loot-1' }, { card: 'chest-3' }],
    expected: { score: { me: 40, anne: 20, bob: 60 } },
  },
  // --- Kraken --------------------------------------------------------------------------------------------------
  {
    id: 'kraken-eats-king',
    card: 'kraken',
    title: 'Le Kraken engloutit le roi',
    format: 'trick',
    prompt: 'Anne a posé le Roi des Flibustiers. Lâche le Kraken.',
    lesson: 'Personne ne gagne un pli au Kraken. Anne, qui l’aurait gagné, mène le suivant — mais sans bonus.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['kraken', 'parrot-2'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(0, 1, 0), trick: trick('anne', { player: 'anne', card: 'pirateking' }, { player: 'bob', card: 'parrot-9' }) },
    mine: [{ card: 'kraken' }],
    expected: { winner: null, nextLeader: 'anne' },
  },
  {
    id: 'kraken-then-whale',
    card: 'kraken',
    title: 'Kraken puis Baleine',
    format: 'trick',
    prompt: 'Le Kraken puis la Baleine sont sur la table. Pose ton 5 noir : c’est le seul numéro.',
    lesson: 'Deux léviathans dans un pli : le dernier posé agit. La Baleine efface le Kraken, et le plus haut numéro gagne.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['roger-5', 'parrot-2'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(1, 0, 0), trick: trick('anne', { player: 'anne', card: 'kraken' }, { player: 'bob', card: 'whale' }) },
    mine: [{ card: 'roger-5' }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
  {
    id: 'kraken-spoils-bonus',
    card: 'kraken',
    title: 'Casser un pari',
    format: 'trick',
    prompt: 'Anne mène avec le 14 noir, +20 en vue. Engloutis le pli.',
    lesson: 'Le Kraken retire le pli à celui qui allait le gagner : Anne perd son pli et son bonus.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['kraken', 'chest-1'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(0, 1, 0), trick: trick('anne', { player: 'anne', card: 'roger-14' }, { player: 'bob', card: 'roger-2' }) },
    mine: [{ card: 'kraken' }],
    expected: { winner: null, nextLeader: 'anne' },
  },
  // --- Baleine blanche -----------------------------------------------------------------------------------------
  {
    id: 'whale-numbers-only',
    card: 'whale',
    title: 'Seuls les numéros comptent',
    format: 'trick',
    prompt: 'Maren et un 12 sont sur la table. Pose la Baleine.',
    lesson: 'Sous la Baleine, les personnages ne valent plus rien : le plus haut numéro gagne, sans couleur ni atout.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['whale', 'chest-3'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(0, 1, 1), trick: trick('anne', { player: 'anne', card: 'pirate-helm' }, { player: 'bob', card: 'parrot-12' }) },
    mine: [{ card: 'whale' }],
    expected: { winner: 'bob', nextLeader: 'bob' },
  },
  {
    id: 'whale-no-number',
    card: 'whale',
    title: 'Baleine sans numéro',
    format: 'trick',
    prompt: 'Que des personnages sur la table. Pose la Baleine : personne ne gagne.',
    lesson: 'Sans numéro dans le pli, la Baleine n’a rien à couronner : le pli est défaussé et tu mènes le suivant.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['whale', 'chest-3'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(0, 1, 1), trick: trick('anne', { player: 'anne', card: 'pirate-helm' }, { player: 'bob', card: 'mermaid-1' }) },
    mine: [{ card: 'whale' }],
    expected: { winner: null, nextLeader: 'me' },
  },
  // --- Mathilde la Sorcière ---------------------------------------------------------------------------------------------
  {
    id: 'hexer-force-card',
    card: 'hexer',
    title: 'Mathilde impose une carte',
    format: 'round',
    prompt: 'Mathilde gagne ce pli : désigne Anne. Une de ses cartes est tirée, elle devra la jouer au prochain pli.',
    lesson: 'Mathilde la Sorcière choisit une carte au hasard chez un adversaire : il la joue au pli suivant, quoi qu’il arrive.',
    spec: { rules: EXT, players: P, me: ME, hands: { me: ['pirate-hexer', 'parrot-2'], anne: ['parrot-10'], bob: ['parrot-5'] }, bids: bids(1, 1, 0), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'chest-4' }) },
    script: { plays: { anne: ['parrot-10'], bob: ['parrot-5'] } },
    mine: [{ card: 'pirate-hexer' }, { ability: { target: 'anne' } }, { card: 'parrot-2' }],
    expected: { score: { me: 20, anne: 20, bob: 20 } },
  },
  {
    id: 'hexer-breaks-zero',
    card: 'hexer',
    title: 'Mathilde casse un pari à 0',
    format: 'round',
    prompt: 'Bob a parié 0 et garde un noir. Mathilde gagne : désigne Bob, son noir sera imposé.',
    lesson: 'La carte imposée par Mathilde se joue même hors couleur : Bob prend un pli qu’il ne voulait pas.',
    spec: { rules: EXT, players: P, me: ME, hands: { me: ['pirate-hexer', 'parrot-2'], anne: ['parrot-10'], bob: ['roger-3'] }, bids: bids(1, 1, 0), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'chest-4' }) },
    script: { plays: { anne: ['parrot-10'], bob: ['roger-3'] } },
    mine: [{ card: 'pirate-hexer' }, { ability: { target: 'bob' } }, { card: 'parrot-2' }],
    expected: { score: { me: 20, anne: -10, bob: -20 } },
  },
  // --- 0 / 14 --------------------------------------------------------------------------------------------------
  {
    id: 'flex14-as-14',
    card: 'flex14',
    title: 'Déclaré 14',
    format: 'trick',
    prompt: 'Anne et Bob ont joué Albatros. Déclare ton 0/14… 14.',
    lesson: 'Déclaré 14, il gagne comme un 14 — mais sans le bonus de +10.',
    spec: { rules: { ...NO_POWERS, ...EXT }, players: P, me: ME, hands: { me: ['parrot-014', 'chest-3'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(1, 0, 0), trick: trick('anne', { player: 'anne', card: 'parrot-9' }, { player: 'bob', card: 'parrot-12' }) },
    mine: [{ card: 'parrot-014', as: 14 }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
  {
    id: 'flex14-as-0',
    card: 'flex14',
    title: 'Déclaré 0',
    format: 'trick',
    prompt: 'Pari 0 : déclare ton 0/14… 0 pour perdre contre les Albatross déjà posés.',
    lesson: 'Déclaré 0, il reste un numéro et doit suivre sa couleur. Il perd ici contre le 12, mais peut gagner contre des fuites ou sous la Raie.',
    spec: { rules: { ...NO_POWERS, ...EXT }, players: P, me: ME, hands: { me: ['parrot-014', 'chest-3'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(0, 0, 1), trick: trick('anne', { player: 'anne', card: 'parrot-9' }, { player: 'bob', card: 'parrot-12' }) },
    mine: [{ card: 'parrot-014', as: 0 }],
    expected: { winner: 'bob', nextLeader: 'bob' },
  },
  // --- 15 joker ------------------------------------------------------------------------------------------------
  {
    id: 'wild15-beats-14',
    card: 'wild15',
    title: 'Le joker bat le 14',
    format: 'trick',
    prompt: 'Anne a posé le 14 Doublon. Ton 15 joker devient un Doublon 15.',
    lesson: 'Dans la couleur demandée, le 15 joker bat même le 14 — et tu captures son bonus de +10 si ton pari tient.',
    spec: { rules: { ...NO_POWERS, ...EXT }, players: P, me: ME, hands: { me: ['wild15', 'parrot-2'], anne: ['parrot-4'], bob: ['parrot-5'] }, bids: bids(1, 0, 0), trick: trick('anne', { player: 'anne', card: 'chest-14' }, { player: 'bob', card: 'chest-3' }) },
    mine: [{ card: 'wild15', as: 'chest' }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
  {
    id: 'wild15-under-black',
    card: 'wild15',
    title: 'Sous le noir, il perd',
    format: 'trick',
    prompt: 'Anne mène en noir. Pose ton 15 joker : il reste un numéro, mais il ne peut pas devenir un atout.',
    lesson: 'Le 15 joker n’existe qu’en jaune, violet ou vert : sous le noir mené, il ne peut pas gagner.',
    spec: { rules: { ...NO_POWERS, ...EXT }, players: P, me: ME, hands: { me: ['wild15', 'chest-2'], anne: ['parrot-4'], bob: ['parrot-5'] }, bids: bids(0, 1, 0), trick: trick('anne', { player: 'anne', card: 'roger-3' }, { player: 'bob', card: 'parrot-9' }) },
    mine: [{ card: 'wild15' }],
    expected: { winner: 'anne', nextLeader: 'anne' },
  },
  // --- Second --------------------------------------------------------------------------------------------------
  {
    id: 'mate-beats-pirate',
    card: 'mate',
    title: 'Le Second bat les pirates',
    format: 'trick',
    prompt: 'Gaspard l’Ajusteur est sur la table. Pose le Second.',
    lesson: 'Le Second bat tout sauf le Roi des Flibustiers et les sirènes — mais capturer un pirate ne rapporte rien.',
    spec: { rules: { ...NO_POWERS, ...EXT }, players: P, me: ME, hands: { me: ['mate', 'chest-2'], anne: ['parrot-4'], bob: ['parrot-5'] }, bids: bids(1, 0, 0), trick: trick('anne', { player: 'anne', card: 'pirate-adjuster' }, { player: 'bob', card: 'parrot-9' }) },
    mine: [{ card: 'mate' }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
  {
    id: 'mate-caught-by-king',
    card: 'mate',
    title: 'Le roi capture le Second',
    format: 'trick',
    prompt: 'Anne a joué le Second. Le Roi des Flibustiers le prend : +30 si ton pari tient.',
    lesson: 'Capturé par le Roi des Flibustiers (ou une sirène), le Second vaut +30 si le pari du gagnant tient.',
    spec: { rules: { ...NO_POWERS, ...EXT }, players: P, me: ME, hands: { me: ['pirateking', 'chest-2'], anne: ['parrot-4'], bob: ['parrot-5'] }, bids: bids(1, 0, 0), trick: trick('anne', { player: 'anne', card: 'mate' }, { player: 'bob', card: 'parrot-9' }) },
    mine: [{ card: 'pirateking' }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
  // --- Dernière salve ------------------------------------------------------------------------------------------
  {
    id: 'volley-two-cards',
    card: 'volley',
    title: 'Deux cartes dans le même pli',
    format: 'trick',
    prompt: 'Pose la Dernière salve, puis rejoue ton 4 noir dans le même pli.',
    lesson: 'La Salve ne gagne jamais. Après que tous les autres ont joué, ta seconde carte peut prendre le pli ; tu sauteras le dernier pli de la manche.',
    spec: { rules: { ...NO_POWERS, ...EXT }, players: P, me: ME, hands: { me: ['volley', 'roger-4', 'chest-2'], anne: ['parrot-4', 'chest-8'], bob: ['parrot-5', 'chest-6'] }, bids: bids(1, 0, 0), trick: trick('anne', { player: 'anne', card: 'parrot-9' }, { player: 'bob', card: 'parrot-12' }) },
    mine: [{ card: 'volley' }, { card: 'roger-4' }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
  {
    id: 'volley-skips-last',
    card: 'volley',
    title: 'Un pli de moins',
    format: 'round',
    prompt: 'Trois cartes, pari 1. La Salve puis ton 4 noir gagnent ce pli ; au dernier pli tu n’auras plus de carte.',
    lesson: 'Après la Salve, tu joues une carte de moins que les autres : tu sautes le dernier pli de la manche.',
    spec: { rules: EXT, players: P, me: ME, hands: { me: ['volley', 'roger-4', 'chest-2'], anne: ['parrot-3', 'chest-8'], bob: ['parrot-5', 'chest-6'] }, bids: bids(1, 1, 1), trick: trick('anne', { player: 'anne', card: 'parrot-9' }, { player: 'bob', card: 'parrot-12' }) },
    script: { plays: { anne: ['chest-8', 'parrot-3'], bob: ['chest-6', 'parrot-5'] } },
    mine: [{ card: 'volley' }, { card: 'roger-4' }, { card: 'chest-2' }],
    expected: { score: { me: 20, anne: 20, bob: 20 } },
  },
  // --- Supplice de la planche ----------------------------------------------------------------------------------
  {
    id: 'plank-removes-pirate',
    card: 'plank',
    title: 'Le pirate passe à la planche',
    format: 'trick',
    prompt: 'Maren allait gagner. Pose le Supplice de la planche.',
    lesson: 'La Planche retire un pirate du pli : il ne gagne pas, ne rapporte rien et ne déclenche pas son pouvoir.',
    spec: { rules: { ...NO_POWERS, ...EXT }, players: P, me: ME, hands: { me: ['plank', 'chest-2'], anne: ['parrot-4'], bob: ['parrot-5'] }, bids: bids(0, 0, 1), trick: trick('anne', { player: 'anne', card: 'pirate-helm' }, { player: 'bob', card: 'parrot-9' }) },
    mine: [{ card: 'plank' }],
    expected: { winner: 'bob', nextLeader: 'bob' },
  },
  {
    id: 'plank-choose-pirate',
    card: 'plank',
    title: 'Deux pirates : tu choisis',
    format: 'trick',
    prompt: 'Maren et Gaspard sont sur la table. La Planche te laisse choisir qui saute : envoie Gaspard.',
    lesson: 'Plusieurs pirates dans le pli : tu choisis lequel est retiré ; le premier pirate restant l’emporte.',
    spec: { rules: { ...NO_POWERS, ...EXT }, players: P, me: ME, hands: { me: ['plank', 'chest-2'], anne: ['parrot-4'], bob: ['parrot-5'] }, bids: bids(0, 1, 0), trick: trick('anne', { player: 'anne', card: 'pirate-helm' }, { player: 'bob', card: 'pirate-adjuster' }) },
    mine: [{ card: 'plank' }, { ability: { pirateCardId: 'pirate-adjuster' } }],
    expected: { winner: 'anne', nextLeader: 'anne' },
  },
  // --- Raie tachetée -------------------------------------------------------------------------------------------
  {
    id: 'stingray-lowest-wins',
    card: 'stingray',
    title: 'Le plus bas gagne',
    format: 'trick',
    prompt: 'Un 9 et un 2 sont sur la table. Pose la Raie : le 2 l’emporte.',
    lesson: 'Sous la Raie tachetée, c’est le plus petit numéro qui gagne — couleur et atout ne comptent plus.',
    spec: { rules: { ...NO_POWERS, ...EXT }, players: P, me: ME, hands: { me: ['stingray', 'chest-14'], anne: ['parrot-4'], bob: ['parrot-5'] }, bids: bids(0, 0, 1), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'parrot-2' }) },
    mine: [{ card: 'stingray' }],
    expected: { winner: 'bob', nextLeader: 'bob' },
  },
  {
    id: 'stingray-no-characters',
    card: 'stingray',
    title: 'Les personnages ne valent plus rien',
    format: 'trick',
    prompt: 'Maren allait prendre le pli. La Raie l’efface : le seul numéro gagne.',
    lesson: 'Comme la Baleine, la Raie annule pirates, sirènes et Roi des Flibustiers : seuls les numéros comptent.',
    spec: { rules: { ...NO_POWERS, ...EXT }, players: P, me: ME, hands: { me: ['stingray', 'chest-3'], anne: ['parrot-4'], bob: ['parrot-5'] }, bids: bids(0, 1, 0), trick: trick('anne', { player: 'anne', card: 'pirate-helm' }, { player: 'bob', card: 'chest-11' }) },
    mine: [{ card: 'stingray' }],
    expected: { winner: 'bob', nextLeader: 'bob' },
  },
  // --- Casier de Davy Jones ------------------------------------------------------------------------------------
  {
    id: 'davy-destroys-kraken',
    card: 'davy',
    title: 'Le Casier détruit le Kraken',
    format: 'trick',
    prompt: 'Anne a lâché le Kraken. Pose le Casier : le pli se joue normalement.',
    lesson: 'Le Casier de Davy Jones détruit les léviathans du pli : le Kraken ne défausse plus rien, et tu marques +20 si ton pari tient.',
    spec: { rules: { ...NO_POWERS, ...EXT }, players: P, me: ME, hands: { me: ['davy', 'chest-2'], anne: ['parrot-4'], bob: ['parrot-5'] }, bids: bids(0, 0, 1), trick: trick('anne', { player: 'anne', card: 'kraken' }, { player: 'bob', card: 'parrot-9' }) },
    mine: [{ card: 'davy' }],
    expected: { winner: 'bob', nextLeader: 'bob' },
  },
  {
    id: 'davy-bonus',
    card: 'davy',
    title: '+20 par léviathan',
    format: 'round',
    prompt: 'Pari 0. Anne ouvre avec la Baleine : détruis-la avec le Casier, puis perds le dernier pli.',
    lesson: 'Chaque léviathan détruit rapporte +20 à celui qui a posé le Casier, si son pari tient.',
    spec: { rules: EXT, players: P, me: ME, hands: { me: ['davy', 'parrot-2'], anne: ['parrot-10'], bob: ['parrot-5'] }, bids: bids(0, 1, 1), trick: trick('anne', { player: 'anne', card: 'whale' }, { player: 'bob', card: 'chest-4' }) },
    script: { plays: { bob: ['parrot-5'], anne: ['parrot-10'] } },
    mine: [{ card: 'davy' }, { card: 'parrot-2' }],
    expected: { score: { me: 40, anne: 20, bob: 20 } },
  },
  // --- La Tempête (carte maison) -------------------------------------------------------------------------------
  {
    id: 'storm-exchange',
    card: 'storm',
    title: 'La Tempête fait passer les cartes',
    format: 'round',
    prompt: 'Joue la Tempête, puis passe ton 2 Albatros à Anne. Tu recevras la carte de Bob quand tout le monde aura passé.',
    lesson: 'Après un pli à la Tempête, chacun donne une carte à son voisin de gauche — en même temps, sans rien voir avant l’échange.',
    spec: { rules: STORM, players: P, me: ME, hands: { me: ['storm', 'parrot-2', 'chest-13'], anne: ['chest-8', 'roger-3'], bob: ['chest-6', 'parrot-4'] }, bids: bids(1, 1, 1), trick: trick('anne', { player: 'anne', card: 'parrot-9' }, { player: 'bob', card: 'parrot-12' }) },
    script: { passes: { anne: ['roger-3'], bob: ['parrot-4'] }, plays: { bob: ['chest-6', 'roger-3'], anne: ['chest-8', 'parrot-2'] } },
    mine: [{ card: 'storm' }, { pass: 'parrot-2' }, { card: 'chest-13' }, { card: 'parrot-4' }],
    expected: { score: { me: 20, anne: -10, bob: -10 } },
  },
  {
    id: 'storm-give-danger',
    card: 'storm',
    title: 'Donne ta carte dangereuse',
    format: 'round',
    prompt: 'Pari 0 avec un 14 noir en main. Joue la Tempête, puis passe le 14 à Anne.',
    lesson: 'La passe sert à te défaire d’une carte qui te ferait gagner un pli : Anne hérite du 14 noir.',
    spec: { rules: STORM, players: P, me: ME, hands: { me: ['storm', 'roger-14', 'parrot-2'], anne: ['chest-8', 'chest-3'], bob: ['chest-6', 'parrot-4'] }, bids: bids(0, 1, 1), trick: trick('anne', { player: 'anne', card: 'parrot-9' }, { player: 'bob', card: 'parrot-12' }) },
    script: { passes: { anne: ['chest-3'], bob: ['parrot-4'] }, plays: { bob: ['chest-6', 'chest-3'], anne: ['chest-8', 'roger-14'] } },
    mine: [{ card: 'storm' }, { pass: 'roger-14' }, { card: 'parrot-2' }, { card: 'parrot-4' }],
    expected: { score: { me: 30, anne: -10, bob: 20 } },
  },
  {
    id: 'storm-single-card',
    card: 'storm',
    title: 'Une seule carte : elle part d’office',
    format: 'round',
    prompt: 'Joue la Tempête. Il te reste une carte : elle est passée sans te demander.',
    lesson: 'Avec une seule carte en main, la passe est automatique — ton 13 file chez Anne, et le 6 de Bob t’arrive.',
    spec: { rules: STORM, players: P, me: ME, hands: { me: ['storm', 'chest-13'], anne: ['chest-8'], bob: ['chest-6'] }, bids: bids(1, 0, 1), trick: trick('anne', { player: 'anne', card: 'parrot-9' }, { player: 'bob', card: 'parrot-12' }) },
    mine: [{ card: 'storm' }, { card: 'chest-6' }],
    expected: { score: { me: -10, anne: -20, bob: 20 } },
  },
  {
    id: 'storm-never-last',
    card: 'storm',
    title: 'Jamais en dernier : à deux cartes, elle part',
    format: 'round',
    prompt: 'Il te reste deux cartes, dont la Tempête : le 14 noir est bloqué, la Tempête doit partir maintenant.',
    lesson: 'La Tempête ne peut jamais être ta dernière carte : dès que tu n’as plus que deux cartes, tu es obligé de la jouer. Une carte imposée par Mathilde reste prioritaire. La Tempête n’est pas distribuée dans une manche à une carte.',
    spec: { rules: STORM, players: P, me: ME, hands: { me: ['storm', 'roger-14'], anne: ['chest-8'], bob: ['chest-6'] }, bids: bids(1, 0, 1), trick: trick('anne', { player: 'anne', card: 'parrot-9' }, { player: 'bob', card: 'parrot-12' }) },
    mine: [{ card: 'storm' }, { card: 'chest-6' }],
    expected: { score: { me: -10, anne: -20, bob: 20 } },
  },
  // --- Les couleurs --------------------------------------------------------------------------------------------
  {
    id: 'parrot-follow-suit',
    card: 'parrot',
    title: 'Suivre la couleur',
    format: 'trick',
    prompt: 'Albatros demandé, tu en as : tu dois suivre. Ton 13 prend le pli.',
    lesson: 'Si tu joues un numéro, tu dois suivre la couleur demandée quand tu l’as. Une carte spéciale reste jouable. Ici le plus haut Albatros gagne.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['parrot-13', 'chest-6'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(1, 0, 0), trick: trick('anne', { player: 'anne', card: 'parrot-9' }, { player: 'bob', card: 'parrot-12' }) },
    mine: [{ card: 'parrot-13' }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
  {
    id: 'chest-other-colour-never-wins',
    card: 'chest',
    title: 'Une autre couleur ordinaire perd',
    format: 'trick',
    prompt: 'Doublon demandé. Bob n’en avait pas et a jeté un 12 Albatros : ton 10 Doublon l’emporte.',
    lesson: 'Sans la couleur demandée, on peut jouer une autre carte. Une autre couleur ordinaire perd ; un atout noir peut gagner.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['chest-10', 'parrot-14'], anne: ['parrot-4'], bob: ['parrot-5'] }, bids: bids(1, 0, 0), trick: trick('anne', { player: 'anne', card: 'chest-9' }, { player: 'bob', card: 'parrot-12' }) },
    mine: [{ card: 'chest-10' }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
  {
    id: 'map-14-bonus',
    card: 'map',
    title: 'Le 14 rapporte +10',
    format: 'trick',
    prompt: 'Compas demandée : ton 2 doit suivre. Bob gagne avec le 14 — et son bonus.',
    lesson: 'Le 14 d’une couleur donne +10 à celui qui le capture, si son pari tient.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['map-2', 'roger-1'], anne: ['parrot-4'], bob: ['parrot-5'] }, bids: bids(0, 0, 1), trick: trick('anne', { player: 'anne', card: 'map-5' }, { player: 'bob', card: 'map-14' }) },
    mine: [{ card: 'map-2' }],
    expected: { winner: 'bob', nextLeader: 'bob' },
  },
  {
    id: 'roger-trumps',
    card: 'roger',
    title: 'Le noir est l’atout',
    format: 'trick',
    prompt: 'Albatros demandé, tu n’en as pas : ton 2 noir bat le 14 Albatros.',
    lesson: 'Le pavillon bat les numéros des trois autres couleurs, même le 14. Son bonus de +10 est acquis si ton pari tient.',
    spec: { rules: NO_POWERS, players: P, me: ME, hands: { me: ['roger-2', 'chest-9'], anne: ['chest-2'], bob: ['chest-5'] }, bids: bids(1, 0, 0), trick: trick('anne', { player: 'anne', card: 'parrot-14' }, { player: 'bob', card: 'parrot-12' }) },
    mine: [{ card: 'roger-2' }],
    expected: { winner: 'me', nextLeader: 'me' },
  },
];

export const SITUATIONS_BY_ID: Readonly<Record<string, Situation>> = Object.fromEntries(SITUATIONS.map((s) => [s.id, s]));

export function situationsFor(cardId: string): Situation[] {
  return SITUATIONS.filter((s) => s.card === cardId);
}

/** La situation suivante : celle de la même carte d'abord, sinon la suivante du codex (boucle). */
export function nextSituation(id: string): Situation | null {
  const i = SITUATIONS.findIndex((s) => s.id === id);
  if (i < 0) return SITUATIONS[0] ?? null;
  return SITUATIONS[(i + 1) % SITUATIONS.length] ?? null;
}
