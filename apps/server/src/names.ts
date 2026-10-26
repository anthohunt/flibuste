// Codes de salle et noms de pirates pour les sièges bots.

import crypto from 'node:crypto';
import { ROOM_CODE_LENGTH, ROOM_CODE_MIN_LENGTH } from './protocol';

/** Uppercase letters without the ambiguous I and O (digits 0/1 are not used at all). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** A fresh code: `ROOM_CODE_LENGTH` (6) letters, uniformly drawn (24^6 ≈ 191 M codes). */
export function randomRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

/** 4 to 6 letters of the alphabet: 6 for every new room, 4 for the rooms created before 2026-09-06 (until purged). */
export function isValidRoomCode(code: unknown): code is string {
  return (
    typeof code === 'string' &&
    code.length >= ROOM_CODE_MIN_LENGTH &&
    code.length <= ROOM_CODE_LENGTH &&
    [...code].every((c) => CODE_ALPHABET.includes(c))
  );
}

/**
 * Bot names — famous pirates, deliberately distinct from the pirate cards of the game (Maren, Orsolo,
 * Rufus, Gaspard, Isidora, Mathilde…). The web client uses the same list in the same order (solo games).
 */
export const PIRATE_NAMES: readonly string[] = [
  'Barbe-Noire',
  'Anne Bonny',
  'Calico Jack',
  'Mary Read',
  'Ching Shih',
  'Surcouf',
  'Jean Bart',
  'La Buse',
  "Grâce O'Malley",
  'Jambe-de-Bois',
  'Œil-de-Faucon',
  'Barbe-Rousse',
  'Henry Morgan',
  'Capitaine Kidd',
  'Francis Drake',
  'Bartholomew',
];

/** Picks a pirate name not already used in the room (falls back to a numbered one). */
export function pickBotName(used: readonly string[]): string {
  const free = PIRATE_NAMES.filter((n) => !used.includes(n));
  if (free.length === 0) return `Pirate ${used.length + 1}`;
  return free[crypto.randomInt(free.length)] as string;
}
