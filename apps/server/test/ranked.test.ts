import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { EXPANSION_ALL, type Rules } from '@flibuste/engine';
import { rankedFormat, type RankedBoard } from '../src/ranked';
import { Client, boot, identity, tmpDataDir } from './helpers';
import type { RunningServer } from '../src/server';

const classic: Rules = { kraken: false, whale: false, loot: false, pirateAbilities: true, rounds: 10 };
const full: Rules = { ...classic, kraken: true, whale: true, loot: true, expansion: EXPANSION_ALL };
const servers: RunningServer[] = [];
const clients: Client[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
async function server() {
  const dir = tmpDataDir(); dirs.push(dir);
  const srv = await boot(dir, { graceMs: 60000, replaceAfterMs: 60000, overTtlMs: 60000, hardWorker: false }); servers.push(srv);
  return srv;
}
async function board(srv: RunningServer, format = 'classic', players = 2): Promise<RankedBoard> {
  const response = await fetch(`http://127.0.0.1:${srv.port}/api/leaderboard?format=${format}&players=${players}`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return await response.json() as RankedBoard;
}
async function play(srv: RunningServer, rules: Rules, assisted = false, withBot = false) {
  const a = await new Client(srv.port, identity('Alix')).connect(); clients.push(a); await a.hello();
  const b = await new Client(srv.port, identity('Camille')).connect(); clients.push(b); await b.hello();
  const made = a.waitType('room'); a.send({ type: 'createRoom', rules, timerMode: 'none' });
  const code = (await made).room.code;
  const joined = b.waitType('room'); b.send({ type: 'joinRoom', code }); await joined;
  if (withBot) {
    const added = a.waitFor((m) => m.type === 'room' && m.room.seats.length === 3);
    a.send({ type: 'addBot', level: 'easy' }); await added;
  }
  if (!assisted) {
    a.autoplay = (m) => m.view.legal[0] ?? null;
    b.autoplay = (m) => m.view.legal[0] ?? null;
  }
  const over = a.waitType('gameOver', 30000);
  a.send({ type: 'start' });
  if (assisted) {
    await a.waitType('view');
    const room = srv.hub.rooms.get(code)!;
    a.autoplay = (m) => m.view.legal[0] ?? null;
    b.autoplay = (m) => m.view.legal[0] ?? null;
    // Exercise the server's actual automated move path, as a timer would, not a client flag.
    const actor = room.state!.players.find((id) => id !== a.id.playerId)!;
    (room as unknown as { playAs(id: string, profile: object): void }).playAs(actor, { force: 1, malice: 0, prudence: 5, bonus: 3, memory: 2, bluff: 4, powers: 2, reaction: 'fast' });
  }
  const final = await over;
  return { code, final, ids: [a.id.playerId, b.id.playerId] };
}

describe('classement multijoueur certifié', () => {
  it('déduit les deux formats et rejette toutes les personnalisations', () => {
    expect(rankedFormat(classic)).toBe('classic');
    expect(rankedFormat(full)).toBe('full');
    for (const change of [{ rounds: 1 }, { deals: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10] }, { pirateAbilitiesOnPlay: true }, { ghost: false }, { custom: { storm: true } }, { cardIds: [] }, { cardIds: ['escape1'] }, { pirateAbilities: false }, { loot: true }]) {
      expect(rankedFormat({ ...classic, ...change }), JSON.stringify(change)).toBe(null);
    }
    expect(rankedFormat({ ...classic, deals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], cardIds: null } as Rules)).toBe('classic');
  });
  it('classe automatiquement une vraie partie WebSocket, avec conditions et sans POST client', async () => {
    const srv = await server();
    expect((await board(srv)).parties).toBe(0);
    const played = await play(srv, classic);
    const result = await board(srv);
    expect(result.parties).toBe(1);
    expect(result.entrees).toHaveLength(2);
    for (const entry of result.entrees) {
      expect(entry.meilleur).toBe(played.final.scores[entry.playerId]);
      expect(entry.conditions.rules.rounds).toBe(10);
      expect(entry.conditions.players).toBe(2);
      expect(entry.parties).toBe(1);
    }
    expect((await board(srv, 'full')).parties).toBe(0);
    expect((await board(srv, 'classic', 3)).parties).toBe(0);
    const room = srv.hub.rooms.get(played.code)!;
    expect(srv.hub.db.completeRankedGame(room.gameId!, room.state!, srv.hub.db.getSeats(played.code))).toBe(false);
    expect((await board(srv)).parties).toBe(1);
    expect(srv.hub.db.sqlite.prepare('SELECT COUNT(*) AS n FROM scores').get()).toEqual({ n: 0 });
  }, 35000);
  it('classe le mode extension séparément', async () => {
    const srv = await server();
    await play(srv, full);
    expect((await board(srv, 'full')).parties).toBe(1);
    expect((await board(srv, 'classic')).parties).toBe(0);
  }, 35000);
  it('exclut une vraie partie courte et ne mélange pas les longueurs', async () => {
    const srv = await server();
    await play(srv, { ...classic, rounds: 1 });
    expect((await board(srv)).parties).toBe(0);
  });
  it('exclut une partie après un coup automatique, même si les humains la terminent', async () => {
    const srv = await server();
    await play(srv, classic, true);
    expect((await board(srv)).parties).toBe(0);
    expect(srv.hub.db.sqlite.prepare('SELECT assisted FROM ranked_games').get()).toEqual({ assisted: 1 });
  }, 35000);
  it('exclut tous les humains d’une vraie table contenant un bot', async () => {
    const srv = await server();
    await play(srv, classic, false, true);
    expect((await board(srv, 'classic', 3)).parties).toBe(0);
  }, 35000);
  it('une déclaration client, même dite vérifiée, ne produit aucun résultat classé', async () => {
    const srv = await server();
    const response = await fetch(`http://127.0.0.1:${srv.port}/api/scores`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'FORGED1', mode: 'online', rounds: 10, verified: true, eligible: true, rules: classic, joueurs: [{ id: 'p1', nom: 'Inventé', total: 900, bot: false }, { id: 'p2', nom: 'Autre', total: 1, bot: false }] }) });
    expect(response.status).toBe(201);
    const result = await board(srv);
    expect(result.parties).toBe(0);
    expect(result.historical).toBe(1);
    expect(result.entrees).toEqual([]);
    expect(srv.hub.db.sqlite.prepare('SELECT COUNT(*) AS n FROM scores').get()).toEqual({ n: 2 });
  });
});
