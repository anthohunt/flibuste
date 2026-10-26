// Erreur métier renvoyée au client : code stable + message français (voir protocol.ts `ErrorCode`).
// Dans son propre module pour que les helpers (profils de bots…) l'utilisent sans importer room.ts.

import type { ErrorCode, IllegalReason } from './protocol';

export class RoomError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly reason?: IllegalReason,
  ) {
    super(message);
    this.name = 'RoomError';
  }
}
