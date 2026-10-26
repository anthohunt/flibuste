import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDeck, DEFAULT_RULES, EXPANSION_ALL } from '@flibuste/engine';
import { validateRules } from '../src/room';
import type { RunningServer } from '../src/server';
import { boot, Client, identity, tmpDataDir } from './helpers';

let srv: RunningServer | undefined;
let dir: string | undefined;
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await srv?.close(); srv = undefined;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});
async function client(name: string) {
  const c = await new Client(srv!.port, identity(name)).connect();
  clients.push(c); await c.hello(); return c;
}

describe('custom deck validation and live rooms', () => {
  it('validates identifiers strictly and keeps the old null/absent contract', () => {
    const rules = { ...DEFAULT_RULES, cardIds: ['parrot-1', 'map-1', 'chest-1'] };
    const output = validateRules(rules);
    expect(output.cardIds).toEqual(rules.cardIds);
    rules.cardIds.pop();
    expect(output.cardIds).toHaveLength(3);
    expect(validateRules({ ...DEFAULT_RULES, cardIds: null }).cardIds).toBeUndefined();
    for (const cardIds of [[], ['parrot-1'], ['unknown', 'map-1'], ['parrot-1', 'parrot-1'], 'all', [1, 2]])
      expect(() => validateRules({ ...DEFAULT_RULES, cardIds })).toThrow();
  });

  it('persists and distributes exactly the chosen cards in a real websocket game', async () => {
    dir = tmpDataDir(); srv = await boot(dir, { nextRoundAutoMs: 10000 });
    const a = await client('Alix'), b = await client('Camille'), c = await client('Anne');
    const full = { ...DEFAULT_RULES, rounds: 1, deals: [3], expansion: EXPANSION_ALL };
    const cardIds = buildDeck(full).map((card) => card.id).filter((id) => !['pirateking', 'parrot-x7', 'escape-2', 'loot-1'].includes(id));
    const rules = { ...full, cardIds };
    const created = a.waitType('room'); a.send({ type: 'createRoom', rules, timerMode: 'none' });
    const code = (await created).room.code;
    for (const guest of [b, c]) {
      const joined = guest.waitType('room'); guest.send({ type: 'joinRoom', code });
      expect((await joined).room.rules.cardIds).toEqual(cardIds);
    }
    const resumed = a.waitType('room'); a.send({ type: 'resume', code });
    expect((await resumed).room.rules.cardIds).toEqual(cardIds);
    for (const player of [a, b, c]) {
      const bidsSent = new Set<number>();
      player.autoplay = (message) => {
        const action = message.view.legal[0] ?? null;
        // Other players' bids can arrive before this client's own bid is acknowledged.
        if (action?.type === 'bid') {
          if (bidsSent.has(message.view.round)) return null;
          bidsSent.add(message.view.round);
        }
        return action;
      };
    }
    const finished = [a, b, c].map((player) => player.waitType('gameOver'));
    a.send({ type: 'start' });
    await Promise.all(finished);
    for (const player of [a, b, c]) {
      expect(player.errors).toEqual([]);
      const views = player.received.filter((message) => message.type === 'view');
      expect(views.length).toBeGreaterThan(3);
      for (const message of views) {
        expect(message.view.rules.cardIds).toEqual(cardIds);
        for (const card of message.view.hand) expect(cardIds).toContain(card.id);
      }
    }
    expect(srv.hub.rooms.get(code)?.rules.cardIds).toEqual(cardIds);
  });

  it('refuses undersized updates and rechecks the actual seats when the host starts', async () => {
    dir = tmpDataDir(); srv = await boot(dir);
    const a = await client('Alix'), b = await client('Camille');
    const rules = { ...DEFAULT_RULES, rounds: 1, cardIds: ['parrot-1', 'map-1'] };
    const created = a.waitType('room'); a.send({ type: 'createRoom', rules, timerMode: 'none' });
    const code = (await created).room.code;
    const joined = b.waitType('room'); b.send({ type: 'joinRoom', code }); await joined;
    const refusedStart = a.waitType('error'); a.send({ type: 'start' });
    expect((await refusedStart).msg).toMatch(/Paquet trop petit/);
    expect(srv.hub.rooms.get(code)?.status).toBe('lobby');
    const refusedUpdate = a.waitType('error'); a.send({ type: 'setRules', rules, timerMode: 'none' });
    expect((await refusedUpdate).msg).toMatch(/Vieux Loup/);
    const accepted = a.waitType('room');
    a.send({ type: 'setRules', rules: { ...rules, ghost: false }, timerMode: 'none' });
    expect((await accepted).room.rules.ghost).toBe(false);
    const started = a.waitType('view'); a.send({ type: 'start' });
    expect((await started).view.hand).toHaveLength(1);
  });
});
