// Le catalogue des situations : pour chaque carte, les cas que les règles standard décrivent, écrits
// comme des mini-parties posées (mains, pli en cours, paris), une suite de coups explicites, et le résultat
// que le moteur DOIT produire. L'attendu vient des règles (`docs/REGLES.md`), jamais du code : quand une
// situation échoue, c'est le moteur qu'on corrige, pas la situation, sauf si sa citation était fausse.
// Un fichier par carte (`situations/<carte>.ts`), tous joués par `test/situations.test.ts`.
import type { AbilityChoice, IllegalReason, Phase, PlayAs, PlayerId, Rules } from '../src/types';

/** Une carte est désignée par son identifiant du paquet (`parrot-3`, `pirate-helm`, `flibuste`, `plank`…). */
export type CardId = string;

export interface SituationPlay {
  player: PlayerId;
  card: CardId;
  as?: PlayAs;
  removed?: true;
}

export interface SituationTrick {
  leader: PlayerId;
  plays: SituationPlay[];
}

/** La scène de départ. Même contrat que `scenarioState` du moteur, avec des identifiants de cartes. */
export interface SituationSpec {
  /** Fusionné sur `DEFAULT_RULES` (ni extension ni carte maison sauf mention). */
  rules?: Partial<Rules>;
  players: PlayerId[];
  /** Le joueur pour qui la situation est écrite (obligatoire pour le moteur ; sans effet sur le test). */
  me?: PlayerId;
  /** Mains courantes ; `ghost` autorisé à 2 joueurs. */
  hands: Record<PlayerId, CardId[]>;
  round?: number;
  dealer?: PlayerId;
  /** Absent → phase de paris. Présent → tout le monde a parié (phase de jeu). */
  bids?: Record<PlayerId, number>;
  /** Le pli en cours (incomplet, ou complet en attente de la Dernière salve). */
  trick?: SituationTrick;
  /** Les plis déjà joués dans la manche, dans l'ordre. */
  history?: SituationTrick[];
  phase?: Phase;
  scores?: Record<PlayerId, number>;
  /** Graine du talon (Orsolo le Brocanteur pioche, Isidora regarde, Mathilde tire au sort). */
  seed?: string;
}

/**
 * Un coup joué par un joueur donné. Exactement un des champs `play` / `ability` / `bid` / `pass` /
 * `nextRound`. `illegal` : le moteur doit REFUSER ce coup avec cette raison, et l'état ne change pas.
 */
export interface Step {
  by: PlayerId;
  play?: CardId;
  as?: PlayAs;
  ability?: AbilityChoice;
  bid?: number;
  pass?: CardId;
  nextRound?: true;
  illegal?: IllegalReason;
}

/** Ce que le moteur doit produire une fois tous les coups joués. Chaque champ absent n'est pas vérifié. */
export interface Expectation {
  /** Les cartes jouables par ce joueur À CE MOMENT (ensemble exact, déclarations confondues). */
  legal?: { player: PlayerId; cards: CardId[] };
  /** Ce joueur ne peut PAS jouer cette carte (déclaration éventuelle), pour cette raison. */
  cannot?: { player: PlayerId; card: CardId; as?: PlayAs; reason: IllegalReason };
  phase?: Phase;
  /** Qui doit agir maintenant (null : personne, par exemple en phase de paris ou de passe). */
  toAct?: PlayerId | null;
  /** Le gagnant du DERNIER pli résolu (`null` : pli défaussé). */
  winner?: PlayerId | null;
  /** Le meneur du pli suivant (celui qui va jouer en premier). */
  nextLeader?: PlayerId;
  /** Le pouvoir en attente (`null` : aucun). `drawn` : les cartes piochées par Orsolo le Brocanteur. */
  pending?: { player: PlayerId; pirate: string; drawn?: CardId[]; pirates?: CardId[] } | null;
  /** La file des pouvoirs après le courant (Second capturant plusieurs pirates), dans l'ordre. */
  queue?: { player: PlayerId; pirate: string }[];
  /** Les cartes du dernier pli marquées « écartées » (Planche) ou détruites (Casier, Baleine). */
  removed?: CardId[];
  /** Drapeaux de résolution du dernier pli. */
  flags?: { kraken?: boolean; whale?: boolean; stingray?: boolean };
  /** Bonus rapporté par le dernier pli à son gagnant (0 s'il est défaussé). */
  trickBonus?: number;
  /** Les cartes en main après les coups (ensemble exact, par joueur). */
  hands?: Record<PlayerId, CardId[]>;
  /** Le nombre de plis remportés dans la manche, par joueur. */
  tricksWon?: Record<PlayerId, number>;
  /** Score de la manche (après le dernier pli), par joueur : total, ou détail. */
  score?: Record<PlayerId, number | { base?: number; bonus?: number; gambler?: number; loot?: number; total: number }>;
  /** Les totaux cumulés de la partie après les coups, par joueur. */
  totals?: Record<PlayerId, number>;
  /** Alliances de Butin enregistrées (paires, ordre indifférent). */
  lootAlliances?: [PlayerId, PlayerId][];
  /** Le joueur contraint par Mathilde et la carte imposée (`null` : personne). */
  forced?: Record<PlayerId, CardId>;
  /** Le paquet des règles contient (ou non) ces cartes. */
  deck?: { has?: CardId[]; lacks?: CardId[]; size?: number };
}

export interface Situation {
  /** `<carte>-<slug>`, unique dans tout le catalogue. */
  id: string;
  /** La fiche : `flibuste`, `pirate`, `helm`, `plank`, `parrot`, `number`… (une par fichier). */
  card: string;
  title: string;
  /** La règle, citée. */
  rule: string;
  spec: SituationSpec;
  /** Les coups joués, dans l'ordre, avant de vérifier. */
  steps?: Step[];
  expect: Expectation;
}
