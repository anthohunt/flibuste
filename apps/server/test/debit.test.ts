// DÉBIT (2026-09-10) — les garde-fous de débit face à trente amis derrière le MÊME wifi.
//
// Le lancement, c'est une trentaine d'amis, beaucoup derrière la même box : une seule adresse publique pour tous
// (en production, TRUST_PROXY=1 et Traefik pose `x-forwarded-for`). Rejoués aux valeurs de production par le banc
// réseau (a7, a7b), trois garde-fous punissaient qui n'avait rien fait :
//  1. un code faux collé dans le groupe (une faute CHACUN) refermait le filet par IP : 0 ami sur 30 entrait ensuite
//     avec le BON code ;
//  2. `createRoom` plafonnait TOUTE l'adresse à 10 tables par minute : le 11e ami ne pouvait plus ouvrir la sienne ;
//  3. un refus dû à l'adresse brûlait le quota personnel : la victime restait refusée en 4G, sur une adresse vierge.
// Chaque bloc rejoue l'un de ces constats, puis vérifie que le garde-fou tient encore contre l'abus qu'il vise
// (une machine qui énumère les codes, un client qui clique frénétiquement).

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { RunningServer } from '../src/server';
import type { ServerConfig } from '../src/config';
import { IP_FAIL_BURST, RateLimiter } from '../src/ratelimit';
import { loadConfig } from '../src/config';
import type { RoomError } from '../src/room';
import { Client, boot, identity, sleep, tmpDataDir } from './helpers';

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

/** Les valeurs de PRODUCTION, écrites en dur : le test ne doit pas dépendre de l'environnement de qui le lance. */
const PROD: Partial<ServerConfig> = { rateLimit: true, rlCreatePerMin: 10, rlCreatePerMinIp: 60, rlJoinFailBaseMs: 500 };
const limiter = (over: Partial<ServerConfig> = {}) => new RateLimiter(loadConfig({ ...PROD, ...over }));
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

const WIFI = '81.250.7.42'; // la box du salon
const QUATRE_G = '77.9.9.9'; // le même téléphone, passé en 4G

describe('1 — le filet par IP compte des codes distincts, et ne retient que les identités qu’il a vues échouer', () => {
  it('trente amis collent le même code faux du groupe, puis le bon : les trente entrent (a7.2)', () => {
    const rl = limiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) rl.joinFailed(`ami-${i}`, WIFI, 'QQQQQQ', t0 + i * 20);
    // Le temps de lire « Pas de table » et de recoller le code corrigé : bien plus que le recul personnel (500 ms).
    for (let i = 0; i < 30; i++) expect(failure(() => rl.checkJoin(`ami-${i}`, WIFI, t0 + 3000))).toBeNull();
  });

  it('cinquante fautes de frappe DIFFÉRENTES, une par personne, dans la même minute : le filet reste ouvert', () => {
    const rl = limiter();
    const t0 = 2_000_000;
    for (let i = 0; i < IP_FAIL_BURST; i++) rl.joinFailed(`ami-${i}`, WIFI, codeNo(i), t0 + i * 20);
    for (let i = 0; i < IP_FAIL_BURST; i++) expect(failure(() => rl.checkJoin(`ami-${i}`, WIFI, t0 + 3000))).toBeNull();
  });

  it('un énumérateur referme le filet sur SES identités ; l’ami qui arrive sur ce wifi entre du premier coup', () => {
    const rl = limiter();
    const t0 = 3_000_000;
    // Une identité neuve et un code différent à chaque essai : le recul personnel ne freine rien, le filet si.
    for (let i = 0; i < IP_FAIL_BURST + 20; i++) rl.joinFailed(`bot-${i}`, WIFI, codeNo(i), t0 + i);
    // Le recul PERSONNEL de bot-0 (500 ms) est passé depuis longtemps : c'est bien le filet qui le retient.
    expect(failure(() => rl.checkJoin('bot-0', WIFI, t0 + 3000))?.code).toBe('rate-limited');
    // Celui qui n'a rien raté ne paie jamais pour les autres, même filet fermé.
    expect(failure(() => rl.checkJoin('ami-qui-arrive', WIFI, t0 + 3000))).toBeNull();
    // Et une minute après la dernière faute, le filet s'est rouvert pour tout le monde.
    expect(failure(() => rl.checkJoin('bot-0', WIFI, t0 + IP_FAIL_BURST + 20 + 61_000))).toBeNull();
  });

  it('une identité qui intercale sa propre table entre deux essais ne contourne pas le filet', () => {
    const rl = limiter();
    const t0 = 4_000_000;
    // Chaque succès efface le recul PERSONNEL (UX-02) : seul le décompte des codes distincts reste pour la freiner.
    for (let i = 0; i < 60; i++) {
      rl.joinFailed('sonde', WIFI, codeNo(i), t0 + i * 1000);
      rl.joinSucceeded('sonde');
    }
    expect(failure(() => rl.checkJoin('sonde', WIFI, t0 + 60_000))?.code).toBe('rate-limited');
    expect(failure(() => rl.checkJoin('ami-qui-arrive', WIFI, t0 + 60_000))).toBeNull();
  });

  it('changer d’identité sur la même connexion ne blanchit pas : le filet retient aussi la socket', () => {
    const rl = limiter();
    const t0 = 4_500_000;
    const socket = {};
    // Une identité neuve par essai, mais toujours la même socket (un `hello` de plus par essai, rien d'autre).
    for (let i = 0; i < IP_FAIL_BURST + 10; i++) rl.joinFailed(`bot-${i}`, WIFI, codeNo(i), t0 + i, socket);
    expect(failure(() => rl.checkJoin('bot-neuf', WIFI, t0 + 3000, socket))?.code).toBe('rate-limited');
    // L'ami, sur SA socket, n'a rien raté : il entre.
    expect(failure(() => rl.checkJoin('ami-qui-arrive', WIFI, t0 + 3000, {}))).toBeNull();
  });

  it('un code qui ne peut désigner aucune table ne nourrit pas le filet (il ne sonde rien)', () => {
    const rl = limiter();
    const t0 = 5_000_000;
    for (let i = 0; i < 3 * IP_FAIL_BURST; i++) rl.joinFailed(`ami-${i}`, WIFI, String(100_000 + i), t0 + i);
    for (let i = 0; i < 3 * IP_FAIL_BURST; i++) expect(failure(() => rl.checkJoin(`ami-${i}`, WIFI, t0 + 3000))).toBeNull();
  });
});

describe('2 — createRoom : un plafond par personne, un autre, calibré sur une soirée, par adresse', () => {
  it('quatorze amis du même wifi ouvrent chacun leur table (a7.3)', () => {
    const rl = limiter();
    const t0 = 6_000_000;
    for (let i = 0; i < 14; i++) expect(failure(() => rl.checkCreate(`ami-${i}`, WIFI, t0 + i * 100))).toBeNull();
    // Et celui qui ARRIVE ensuite sur ce wifi n'a rien perdu : ses dix tables sont là.
    for (let i = 0; i < 10; i++) expect(failure(() => rl.checkCreate('retardataire', WIFI, t0 + 2000 + i))).toBeNull();
  });

  it('une personne reste plafonnée à dix tables par minute, où qu’elle soit', () => {
    const rl = limiter();
    const t0 = 7_000_000;
    for (let i = 0; i < 10; i++) rl.checkCreate('frenetique', WIFI, t0 + i * 100);
    const err = failure(() => rl.checkCreate('frenetique', QUATRE_G, t0 + 2000));
    expect(err?.code).toBe('rate-limited');
    expect(err?.message).toMatch(/réessaie dans 58 s/);
  });

  it('l’adresse a son propre plafond : il faut six cliqueurs frénétiques pour la saturer', () => {
    const rl = limiter();
    const t0 = 8_000_000;
    for (let p = 0; p < 6; p++) for (let i = 0; i < 10; i++) rl.checkCreate(`frenetique-${p}`, WIFI, t0 + p * 10 + i);
    expect(failure(() => rl.checkCreate('septieme', WIFI, t0 + 1000))?.code).toBe('rate-limited');
    // Une autre adresse n'en sait rien.
    expect(failure(() => rl.checkCreate('septieme', QUATRE_G, t0 + 1000))).toBeNull();
  });
});

describe('3 — un refus ne coûte rien au quota de celui qui est refusé', () => {
  it('refusée dix fois derrière un wifi saturé, la victime garde ses dix tables en 4G (a7b)', () => {
    // Plafond d'adresse ramené à celui d'une personne : c'est le décor du constat, où l'adresse sature la première.
    const rl = limiter({ rlCreatePerMinIp: 10 });
    const t0 = 9_000_000;
    for (let i = 0; i < 10; i++) rl.checkCreate(`voisin-${i}`, WIFI, t0 + i);
    for (let i = 0; i < 10; i++) expect(failure(() => rl.checkCreate('victime', WIFI, t0 + 100 + i))?.code).toBe('rate-limited');
    // Même téléphone, adresse vierge : le quota personnel est intact.
    for (let i = 0; i < 10; i++) expect(failure(() => rl.checkCreate('victime', QUATRE_G, t0 + 200 + i))).toBeNull();
    expect(failure(() => rl.checkCreate('victime', QUATRE_G, t0 + 300))?.code).toBe('rate-limited');
  });

  it('et un refus dû au quota personnel ne remplit pas l’adresse des autres', () => {
    const rl = limiter();
    const t0 = 10_000_000;
    for (let i = 0; i < 10; i++) rl.checkCreate('frenetique', WIFI, t0 + i);
    for (let i = 0; i < 100; i++) failure(() => rl.checkCreate('frenetique', WIFI, t0 + 100 + i));
    // 10 tables vraiment ouvertes + 50 = le plafond de l'adresse, pile : les cent refus n'ont rien compté.
    for (let i = 0; i < 50; i++) expect(failure(() => rl.checkCreate(`ami-${i}`, WIFI, t0 + 1000 + i))).toBeNull();
  });
});

describe('en conditions réelles : TRUST_PROXY et `x-forwarded-for`, comme derrière Traefik', () => {
  it('douze tables ouvertes et trente amis assis derrière la même box, après un code faux collé dans le groupe', async () => {
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    // Tous les plafonds de débit aux valeurs de production (seulement `rateLimit`, que les tests coupent d'office).
    const srv = await boot(dataDir, { rateLimit: true, trustProxy: true });
    servers.push(srv);
    const headers = { 'x-forwarded-for': WIFI };
    const ami = async (name: string): Promise<Client> => {
      const c = await new Client(srv.port, identity(name)).connect(headers);
      clients.push(c);
      await c.hello();
      return c;
    };

    const codes: string[] = [];
    for (let i = 0; i < 12; i++) {
      const hote = await ami(`Hote${i}`);
      const room = hote.waitType('room', 3000);
      hote.send({ type: 'createRoom', rules: { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 3 }, timerMode: 'none' });
      codes.push((await room).room.code);
      expect(hote.errors).toHaveLength(0);
    }

    const invites: Client[] = [];
    for (let i = 0; i < 30; i++) {
      const c = await ami(`Ami${i}`);
      const refus = c.waitType('error', 3000);
      c.send({ type: 'joinRoom', code: 'QQQQQQ' }); // la lettre de travers du message du groupe
      expect((await refus).code).toBe('no-room');
      invites.push(c);
    }

    // Le message corrigé arrive dans le groupe ; chacun recolle le bon code (bien après son recul de 500 ms).
    await sleep(700);
    for (const [i, c] of invites.entries()) {
      const code = codes[i % codes.length] as string;
      const assis = c.waitFor((m) => (m.type === 'room' && m.room.code === code) || m.type === 'error', 3000);
      c.send({ type: 'joinRoom', code });
      const m = await assis;
      expect(m.type === 'error' ? m.code : 'assis').toBe('assis');
    }
    expect(invites.flatMap((c) => c.errors.filter((e) => e.code === 'rate-limited'))).toHaveLength(0);
  }, 30_000);

  it('une machine qui change d’identité à chaque essai sur la même socket est retenue ; l’ami de la box entre', async () => {
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    // Le seau par connexion est desserré : c'est le filet qu'on éprouve ici, pas le débit des messages. Et la base
    // du recul est longue : sur UNE socket, le filet se ferme au 51e code (500 ms en production) et ne compte plus
    // rien ensuite — 10 s laissent la marge d'une machine de CI lente entre la fermeture et la vérification.
    const srv = await boot(dataDir, { rateLimit: true, trustProxy: true, rlMsgPerSec: 10_000, rlBurst: 10_000, rlJoinFailBaseMs: 10_000 });
    servers.push(srv);
    const headers = { 'x-forwarded-for': WIFI };
    const connecte = async (name: string): Promise<Client> => {
      const c = await new Client(srv.port, identity(name)).connect(headers);
      clients.push(c);
      await c.hello();
      return c;
    };
    const hote = await connecte('Hote');
    const cree = hote.waitType('room', 3000);
    hote.send({ type: 'createRoom', rules: { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 3 }, timerMode: 'none' });
    const code = (await cree).room.code;

    const sonde = await connecte('Sonde');
    const endosse = (n: string) => {
      const id = identity(n);
      sonde.send({ type: 'hello', playerId: id.playerId, token: id.token, name: id.name });
    };
    for (let i = 0; i < IP_FAIL_BURST + 10; i++) {
      endosse(`Sonde${i}`);
      const r = sonde.waitType('error', 3000);
      sonde.send({ type: 'joinRoom', code: codeNo(i) });
      await r;
    }
    // Une identité de plus sur la même socket, avec le VRAI code : le filet la retient (la socket a raté).
    endosse('SondeNeuve');
    const refus = sonde.waitType('error', 3000);
    sonde.send({ type: 'joinRoom', code });
    expect((await refus).code).toBe('rate-limited');

    // L'ami de la même box, sur sa propre socket, n'a rien raté : il s'assoit.
    const ami = await connecte('Ami');
    const assis = ami.waitFor((m) => (m.type === 'room' && m.room.code === code) || m.type === 'error', 3000);
    ami.send({ type: 'joinRoom', code });
    const m = await assis;
    expect(m.type === 'error' ? m.code : 'assis').toBe('assis');
  }, 30_000);

  it('`resume` ne dit pas si une table existe à qui n’y a pas de siège (oracle sans bridage)', async () => {
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    const srv = await boot(dataDir, { rateLimit: true, trustProxy: true });
    servers.push(srv);
    const hote = await new Client(srv.port, identity('Hote')).connect();
    clients.push(hote);
    await hote.hello();
    const cree = hote.waitType('room', 3000);
    hote.send({ type: 'createRoom', rules: { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 3 }, timerMode: 'none' });
    const code = (await cree).room.code;

    const sonde = await new Client(srv.port, identity('Sonde')).connect();
    clients.push(sonde);
    await sonde.hello();
    const faux = code === 'QQQQQQ' ? 'ZZZZZZ' : 'QQQQQQ';
    const repond = async (c: string) => {
      const r = sonde.waitType('error', 3000);
      sonde.send({ type: 'resume', code: c });
      const e = await r;
      return { code: e.code, msg: e.msg.replace(c, '<code>') };
    };
    // Mesuré avant : « Tu n'as plus de place à la table X » (elle existe) contre « Pas de table X ».
    expect(await repond(code)).toEqual(await repond(faux));

    // Et qui a son siège reprend toujours sa table.
    const reprise = hote.waitType('room', 3000);
    hote.send({ type: 'resume', code });
    expect((await reprise).room.code).toBe(code);
  });
});
