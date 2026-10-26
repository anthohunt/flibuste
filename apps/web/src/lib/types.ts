// Types du contrat de jeu : ré-exportés depuis le moteur (`packages/engine`), source unique de vérité.
// Les cartes maison (« La Tempête ») sont déclarées ici en attendant que le moteur les expose : chaque ajout
// est optionnel ou une union, de sorte que le moteur, une fois à jour, les recouvre sans conflit.
import type {
  Card as EngineCard,
  Action as EngineAction,
  Phase as EnginePhase,
  PlayerView as EnginePlayerView,
  Rules as EngineRules,
  Play as EnginePlay,
  Trick as EngineTrick,
  TrickRecord as EngineTrickRecord,
  PlayerId,
} from '@flibuste/engine';

export type {
  Suit,
  NumberCard,
  PirateName,
  PlayerId,
  AbilityChoice,
  PendingAbility,
  RoundScore,
  PlayAs,
  AbilityName,
  ExpansionRules,
} from '@flibuste/engine';
export { isNumber, isSpecial, DEFAULT_RULES, RuleError } from '@flibuste/engine';

/** Cartes maison (hors règle standard), chacune débrayable. */
export interface CustomRules {
  /** La Tempête : chacun passe une carte à son voisin de gauche avant les paris. */
  storm: boolean;
}

/** La Tempête : se joue comme une Fuite. */
export interface StormCard {
  id: 'storm';
  kind: 'storm';
}

export type Card = EngineCard | StormCard;
export type CardKind = Card['kind'];
/** Vague 5 : `deals` = cartes par manche (variantes classiques), `ghost` = Vieux Loup à deux (défaut true). */
export type Rules = EngineRules & { custom?: CustomRules; deals?: number[]; ghost?: boolean };
/** `pass` : la Tempête est en jeu, chacun passe une carte à son voisin de gauche. */
export type Phase = EnginePhase | 'pass';
export type Action = EngineAction | { type: 'pass'; player: PlayerId; cardId: string };

export type Play = Omit<EnginePlay, 'card'> & { card: Card };
export type Trick = Omit<EngineTrick, 'plays'> & { plays: Play[] };
export type TrickRecord = Omit<EngineTrickRecord, 'plays' | 'captured'> & { plays: Play[]; captured: Card[] };

export type PlayerView = Omit<EnginePlayerView, 'phase' | 'legal' | 'rules' | 'hand' | 'trick' | 'history' | 'forcedPlays' | 'deck'> & {
  phase: Phase;
  legal: Action[];
  rules: Rules;
  hand: Card[];
  trick: Trick;
  history: TrickRecord[];
  forcedPlays: Record<PlayerId, Card | null>;
  deck?: Card[];
  /** Tempête : joueurs qui n'ont pas encore passé leur carte. */
  passPending?: PlayerId[];
  /** Tempête : j'ai déjà passé ma carte. */
  myPassed?: boolean;
  /** Vieux Loup (règle standard à deux) : présent quand il est à table, avec le nombre de cartes qu'il lui reste. */
  ghost?: { handCount: number };
};

/** Alias historique : une carte posée dans le pli (avec le choix Tigresse éventuel). */
export type TrickPlay = Play;
