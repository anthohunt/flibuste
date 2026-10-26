// Données d'exemple pour la vitrine `#/dev` et les tests.
import type { Card, TrickPlay } from './types';

export const SAMPLE_CARDS: Card[] = [
  { id: 'g07', kind: 'number', suit: 'parrot', rank: 7 },
  { id: 'm14', kind: 'number', suit: 'map', rank: 14 },
  { id: 'c02', kind: 'number', suit: 'chest', rank: 2 },
  { id: 'r11', kind: 'number', suit: 'roger', rank: 11 },
  { id: 'r14', kind: 'number', suit: 'roger', rank: 14 },
  { id: 'gx7', kind: 'number', suit: 'parrot', rank: 7, expansion: true },
  { id: 'cx8', kind: 'number', suit: 'chest', rank: 8, expansion: true },
  { id: 'esc1', kind: 'escape' },
  { id: 'pir-helm', kind: 'pirate', pirate: 'helm' },
  { id: 'pir-trader', kind: 'pirate', pirate: 'trader' },
  { id: 'pir-adjuster', kind: 'pirate', pirate: 'adjuster' },
  { id: 'pir-oracle', kind: 'pirate', pirate: 'oracle' },
  { id: 'pir-gambler', kind: 'pirate', pirate: 'gambler' },
  { id: 'tigress', kind: 'tigress' },
  { id: 'sk', kind: 'pirateking' },
  { id: 'mer1', kind: 'mermaid' },
  { id: 'kraken', kind: 'kraken' },
  { id: 'whale', kind: 'whale' },
  { id: 'loot1', kind: 'loot' },
];

export const SAMPLE_HAND: Card[] = [
  { id: 'g03', kind: 'number', suit: 'parrot', rank: 3 },
  { id: 'g12', kind: 'number', suit: 'parrot', rank: 12 },
  { id: 'm05', kind: 'number', suit: 'map', rank: 5 },
  { id: 'c09', kind: 'number', suit: 'chest', rank: 9 },
  { id: 'r14', kind: 'number', suit: 'roger', rank: 14 },
  { id: 'esc2', kind: 'escape' },
  { id: 'pir-gambler', kind: 'pirate', pirate: 'gambler' },
  { id: 'tigress', kind: 'tigress' },
];

/** Albatros demandé : les albatross et les spéciales sont légaux, le reste non. */
export const SAMPLE_LEGAL = new Set(['g03', 'g12', 'esc2', 'pir-gambler', 'tigress']);

export const SAMPLE_PLAYERS = [
  { id: 'p1', name: 'Alix' },
  { id: 'p2', name: 'Camille' },
  { id: 'p3', name: 'Bot Facile' },
  { id: 'p4', name: 'Bot Difficile' },
];

export const SAMPLE_NAMES: Record<string, string> = Object.fromEntries(SAMPLE_PLAYERS.map((p) => [p.id, p.name]));

export const SAMPLE_TRICK: TrickPlay[] = [
  { player: 'p2', card: { id: 'g09', kind: 'number', suit: 'parrot', rank: 9 } },
  { player: 'p3', card: { id: 'tigress', kind: 'tigress' }, as: 'escape' },
  { player: 'p4', card: { id: 'pir-adjuster', kind: 'pirate', pirate: 'adjuster' } },
  { player: 'p1', card: { id: 'sk', kind: 'pirateking' } },
];
