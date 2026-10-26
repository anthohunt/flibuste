// Vague 3.A — présence et honnêteté de la table (FONC-01, UX-02), côté serveur.
//
//  1. Le recul des `joinRoom` ratés est PAR IDENTITÉ. À l'évaluation, un contexte navigateur neuf était refusé
//     pendant 176 s d'affilée derrière une IP déjà punie par d'autres clients : le scénario « quatre amis sur
//     le même Wi-Fi se bloquent mutuellement », constaté pour de vrai. Le filet par IP reste, mais il ne se
//     referme qu'après une rafale (IP_FAIL_BURST) qu'aucune tablée n'atteint.
//  2. Le message de bridage dit COMBIEN DE TEMPS, et il ne se confond pas avec « pas de table à ce code ».
//  3. « Prêt » reprend le siège (`exitAuto`), comme toute autre action : le compteur « prêts / présents » et la
//     règle d'accord (`checkReady`) parlent alors du même ensemble de joueurs.

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { RunningServer } from '../src/server';
import type { ServerConfig } from '../src/config';
import { RateLimiter, IP_FAIL_BURST } from '../src/ratelimit';
import { loadConfig } from '../src/config';
import { RoomError } from '../src/room';
import { Client, boot, identity, randomLegal, sleep, tmpDataDir } from './helpers';

let servers: RunningServer[] = [];
let clients: Client[] = [];
let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await Promise.all(servers.map((s) => s.close()));
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  servers = [];
  clients = [];
  dirs = [];
});

async function server(overrides: Partial<ServerConfig> = {}): Promise<RunningServer> {
  const dataDir = tmpDataDir();
  dirs.push(dataDir);
  const s = await boot(dataDir, overrides);
  servers.push(s);
  return s;
}

async function client(port: number, name: string, id = identity(name), headers: Record<string, string> = {}): Promise<Client> {
  const c = await new Client(port, id).connect(headers);
  clients.push(c);
  await c.hello();
  return c;
}

const limiter = (over: Partial<ServerConfig> = {}) => new RateLimiter(loadConfig({ rateLimit: true, rlJoinFailBaseMs: 500, ...over }));
const failure = (fn: () => void): RoomError | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e as RoomError;
  }
};
/** Le n-ième code de table valide (6 lettres de l'alphabet des codes) : des codes DISTINCTS, comme en énumère une machine. */
const codeNo = (n: number): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0, r = n; i < 6; i++, r = Math.floor(r / alphabet.length)) s += alphabet[r % alphabet.length];
  return s;
};

describe('UX-02 — le recul des `joinRoom` ratés est par identité, pas par IP', () => {
  it('quatre amis derrière la même IP : la faute de l’un ne bloque pas les autres', () => {
    const rl = limiter();
    const t0 = 1_000_000;
    // Anne se trompe trois fois de code (recul : 500, 1000, 2000 ms).
    for (let i = 0; i < 3; i++) rl.joinFailed('anne', '82.64.1.1', 'ZZZZZZ', t0 + i);
    expect(failure(() => rl.checkJoin('anne', '82.64.1.1', t0 + 10))).not.toBeNull();
    // Bob, Cid et Dine partagent la box : leur PREMIÈRE tentative passe.
    for (const who of ['bob', 'cid', 'dine']) expect(failure(() => rl.checkJoin(who, '82.64.1.1', t0 + 10))).toBeNull();
  });

  it('le recul double, puis un code juste l’efface — la faute de frappe ne se traîne pas', () => {
    const rl = limiter();
    const t0 = 2_000_000;
    rl.joinFailed('anne', '1.2.3.4', 'ZZZZZZ', t0);
    expect(failure(() => rl.checkJoin('anne', '1.2.3.4', t0 + 100))?.code).toBe('rate-limited');
    // 500 ms plus tard, c'est passé.
    expect(failure(() => rl.checkJoin('anne', '1.2.3.4', t0 + 600))).toBeNull();
    rl.joinFailed('anne', '1.2.3.4', 'YYYYYY', t0 + 600); // 2e échec : 1000 ms
    expect(failure(() => rl.checkJoin('anne', '1.2.3.4', t0 + 1200))?.code).toBe('rate-limited');
    rl.joinSucceeded('anne');
    expect(failure(() => rl.checkJoin('anne', '1.2.3.4', t0 + 1200))).toBeNull();
  });

  it('le message dit le temps qui reste, et n’est pas celui d’une table introuvable', () => {
    const rl = limiter({ rlJoinFailBaseMs: 8000 });
    const t0 = 3_000_000;
    rl.joinFailed('anne', '1.2.3.4', 'ZZZZZZ', t0);
    const err = failure(() => rl.checkJoin('anne', '1.2.3.4', t0 + 1000));
    expect(err?.code).toBe('rate-limited');
    expect(err?.message).toMatch(/réessaie dans 7 s/);
    expect(err?.message).not.toMatch(/table/i); // « Pas de table ABCDEF » est un autre message, une autre cause
  });

  it('le filet par IP se referme quand une seule machine énumère les codes', () => {
    const rl = limiter();
    const t0 = 4_000_000;
    // Chaque tentative avec une identité neuve et un code DIFFÉRENT (c'est ce qu'est l'énumération) : le recul
    // par identité ne freine rien, le filet par IP oui.
    for (let i = 0; i < IP_FAIL_BURST + 10; i++) rl.joinFailed(`bot-${i}`, '9.9.9.9', codeNo(i), t0 + i);
    // 5 s plus tard, le recul PERSONNEL de bot-0 (500 ms) est passé : seul le filet peut encore le retenir.
    expect(failure(() => rl.checkJoin('bot-0', '9.9.9.9', t0 + 5000))?.code).toBe('rate-limited');
    // DÉBIT (2026-09-10) : le filet ne retient que les identités qu'il a vues échouer — celle qui n'a rien raté
    // entre (voir debit.test.ts, l'ami qui arrive sur le wifi).
    expect(failure(() => rl.checkJoin('bot-neuf', '9.9.9.9', t0 + 5000))).toBeNull();
    // Une autre IP n'a rien payé.
    expect(failure(() => rl.checkJoin('bot-0', '9.9.9.8', t0 + 5000))).toBeNull();
  });

  it('la limite de création dit elle aussi combien de temps attendre', () => {
    const rl = limiter({ rlCreatePerMin: 2 });
    const t0 = 5_000_000;
    rl.checkCreate('anne', '1.2.3.4', t0);
    rl.checkCreate('anne', '1.2.3.4', t0 + 1000);
    const err = failure(() => rl.checkCreate('anne', '1.2.3.4', t0 + 2000));
    expect(err?.code).toBe('rate-limited');
    expect(err?.message).toMatch(/réessaie dans 58 s/);
  });

  it('en conditions réelles : une identité neuve rejoint du premier coup derrière une IP déjà punie', async () => {
    const srv = await server({ rateLimit: true, rlJoinFailBaseMs: 30_000 });
    const headers = { 'x-forwarded-for': '203.0.113.7' };
    const anne = await client(srv.port, 'Anne', undefined, headers);
    const alice = await client(srv.port, 'Alice', undefined, headers);
    // Alice ouvre une vraie table.
    const room = alice.waitType('room');
    alice.send({ type: 'createRoom', rules: { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 3 }, timerMode: 'none' });
    const code = (await room).room.code;

    // Anne se trompe deux fois : c'est ELLE qui est freinée.
    anne.send({ type: 'joinRoom', code: 'ZZZZZZ' });
    await anne.waitFor((m) => m.type === 'error' && m.code === 'no-room', 3000);
    anne.send({ type: 'joinRoom', code: 'YYYYYY' });
    const second = await anne.waitFor((m) => m.type === 'error', 3000);
    expect(second.type === 'error' && second.code).toBe('rate-limited');

    // Bob, même IP, contexte neuf : sa première tentative avec le BON code entre — c'est le constat levé.
    const bob = await client(srv.port, 'Bob', undefined, headers);
    const joined = bob.waitType('room');
    bob.send({ type: 'joinRoom', code });
    expect((await joined).room.seats.some((s) => s.name === 'Bob')).toBe(true);
    expect(bob.errors).toHaveLength(0);
  });
});

describe('FONC-01 — « Prêt » reprend le siège, le compteur et la règle d’accord parlent des mêmes joueurs', () => {
  it('un siège joué par le serveur qui touche « Prêt » sort d’auto ; un siège absent n’est plus attendu', async () => {
    const srv = await server({ timer30sMs: 400, nextRoundAutoMs: 600_000 });
    const rules = { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 2, deals: [1, 2] } as never;
    const alice = await client(srv.port, 'Alice');
    const created = alice.waitType('room');
    alice.send({ type: 'createRoom', rules, timerMode: '30s' });
    const code = (await created).room.code;
    const bob = await client(srv.port, 'Bob');
    const cid = await client(srv.port, 'Cid');
    for (const c of [bob, cid]) {
      const joined = c.waitType('room');
      c.send({ type: 'joinRoom', code });
      await joined;
    }
    const room = srv.hub.rooms.get(code)!;
    alice.send({ type: 'start' });

    // Alice et Bob jouent la manche, mais ne touchent PAS « Manche suivante » (sinon l'accord se fait sans Cid
    // et la manche 2 démarre avant qu'il ait pu toucher « Prêt »). Cid, lui, ne fait rien : son minuteur expire
    // et le serveur joue pour lui.
    const playButNotNext = (v: Parameters<typeof randomLegal>[0]) => {
      const legal = v.view.legal.filter((a) => a.type !== 'nextRound');
      return legal.length ? (legal[0] as ReturnType<typeof randomLegal>) : null;
    };
    alice.autoplay = playButNotNext;
    bob.autoplay = playButNotNext;
    await alice.waitFor((m) => m.type === 'view' && m.view.phase === 'roundEnd', 15_000);
    expect(room.autoSeats.has(cid.id.playerId)).toBe(true);

    // La règle d'accord n'attend que les humains connectés et non auto : Alice et Bob.
    const required = () => room.connectedHumans().filter((p) => !room.autoSeats.has(p) && !room.left.has(p));
    expect(required().map((p) => p).sort()).toEqual([alice.id.playerId, bob.id.playerId].sort());

    // Cid touche « Prêt » : il reprend son siège (la bannière le promet), et redevient attendu.
    cid.send({ type: 'ready' });
    await sleep(120);
    expect(room.autoSeats.has(cid.id.playerId)).toBe(false);
    expect(room.readyPlayers.has(cid.id.playerId)).toBe(true);
    expect(required()).toContain(cid.id.playerId);
    // Cid n'envoie qu'un `ready` : il ne doit rien recevoir en retour qu'une salle à jour.
    expect(cid.errors).toHaveLength(0);
  });
});
