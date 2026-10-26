import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '@flibuste/engine';
import { Db } from '../src/db';

describe('Db', () => {
  it('stores players, rooms, seats, games, actions and push subscriptions', () => {
    const db = new Db(':memory:');
    db.upsertPlayer({ id: 'p1', token: 't1', name: 'Alix' });
    expect(db.getPlayer('p1')).toEqual({ id: 'p1', token: 't1', name: 'Alix' });
    expect(db.getPlayer('nope')).toBeUndefined();

    db.saveRoom({ code: 'ABCD', hostId: 'p1', rules: DEFAULT_RULES, timerMode: 'none', status: 'lobby', gameId: null, created: 1, updated: 1 }, [
      { code: 'ABCD', idx: 0, playerId: 'p1', botLevel: null, name: 'Alix', auto: false, hasLeft: false },
      { code: 'ABCD', idx: 1, playerId: null, botLevel: 'easy', name: 'Barbe-Noire', auto: false, hasLeft: false },
    ]);
    expect(db.getRoom('ABCD')?.rules).toEqual(DEFAULT_RULES);
    expect(db.getSeats('ABCD')).toHaveLength(2);
    expect(db.roomCodeExists('ABCD')).toBe(true);
    expect(db.listRooms(['lobby']).map((r) => r.code)).toEqual(['ABCD']);

    db.insertGame({ id: 'g1', code: 'ABCD', seed: 's', players: ['p1', 'bot:ABCD:1'], rules: DEFAULT_RULES, created: 2 });
    db.appendAction('g1', 0, { type: 'bid', player: 'p1', value: 1 });
    db.appendAction('g1', 1, { type: 'bid', player: 'bot:ABCD:1', value: 0 });
    expect(db.getGame('g1')?.players).toEqual(['p1', 'bot:ABCD:1']);
    expect(db.getActions('g1')).toEqual([
      { type: 'bid', player: 'p1', value: 1 },
      { type: 'bid', player: 'bot:ABCD:1', value: 0 },
    ]);

    // saveRoom replaces the seats atomically
    db.saveRoom({ code: 'ABCD', hostId: 'p1', rules: DEFAULT_RULES, timerMode: 'none', status: 'playing', gameId: 'g1', created: 1, updated: 2 }, [
      { code: 'ABCD', idx: 0, playerId: 'p1', botLevel: null, name: 'Alix', auto: false, hasLeft: false },
    ]);
    expect(db.getSeats('ABCD')).toHaveLength(1);
    expect(db.getRoom('ABCD')?.status).toBe('playing');

    db.setPushSub('p1', { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } });
    expect(db.getPushSub('p1')?.endpoint).toBe('https://push.example/x');
    db.deletePushSub('p1');
    expect(db.getPushSub('p1')).toBeUndefined();

    db.deleteRoom('ABCD');
    expect(db.getRoom('ABCD')).toBeUndefined();
    db.close();
  });
});
