import { beforeEach, describe, expect, it } from 'vitest';
import { loadIdentity, resetIdentity, setName } from '../lib/identity';

describe('identity', () => {
  beforeEach(() => {
    localStorage.clear();
    resetIdentity();
  });

  it('génère un playerId UUID et un token de 32 hex, persistés', () => {
    const id = loadIdentity();
    expect(id.playerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(id.token).toMatch(/^[0-9a-f]{32}$/);
    const stored = JSON.parse(localStorage.getItem('flibuste:identity')!);
    expect(stored.playerId).toBe(id.playerId);
    expect(stored.token).toBe(id.token);
  });

  it('conserve playerId/token quand le pseudo change', () => {
    const before = loadIdentity();
    const after = setName('  Barbe Noire  ');
    expect(after.name).toBe('Barbe Noire');
    expect(after.playerId).toBe(before.playerId);
    expect(after.token).toBe(before.token);
  });
});
