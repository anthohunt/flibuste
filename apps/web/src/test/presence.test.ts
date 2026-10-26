// Absences à la table (#1, #2, #22, #25) : compte à rebours, textes, prochain capitaine, fin de partie.
import { describe, expect, it } from 'vitest';
import { absences, nextCaptain, overStatus, secondsLeft } from '../lib/presence';
import type { RoomView, SeatView } from '../lib/protocol';

const T0 = 1_700_000_000_000;
const seat = (idx: number, playerId: string | null, name: string, patch: Partial<SeatView> = {}): SeatView => ({ idx, playerId, name, botLevel: playerId ? null : 'normal', connected: true, ...patch });
const room = (patch: Partial<RoomView> = {}): RoomView => ({
  code: 'ABCD',
  host: 'alice',
  status: 'playing',
  rules: {} as never,
  timerMode: '30s',
  seats: [seat(0, 'alice', 'Alice'), seat(1, 'bob', 'Bob'), seat(2, 'cid', 'Cid'), seat(3, null, 'Barbe-Noire')],
  ready: [],
  disconnectedSince: {},
  maxPlayers: 8,
  left: [],
  ...patch,
});

describe('secondsLeft', () => {
  it('compte à rebours entier, arrondi au-dessus, jamais négatif, null sans date', () => {
    expect(secondsLeft(T0, T0, 60_000)).toBe(60);
    expect(secondsLeft(T0, T0 + 17_500, 60_000)).toBe(43);
    expect(secondsLeft(T0, T0 + 60_000, 60_000)).toBe(0);
    expect(secondsLeft(T0, T0 + 90_000, 60_000)).toBe(0);
    expect(secondsLeft(null, T0, 60_000)).toBeNull();
  });
});

describe('absences', () => {
  it('rien quand tout le monde est là ; moi et les sièges déjà confiés à un bot ne comptent pas', () => {
    expect(absences(room(), 'bob', T0)).toEqual([]);
    const r = room({ seats: [seat(0, 'alice', 'Alice'), seat(1, 'bob', 'Bob', { connected: false }), seat(2, 'cid', 'Cid', { connected: false, botLevel: 'normal' })], disconnectedSince: { bob: T0, cid: T0 } });
    expect(absences(r, 'bob', T0)).toEqual([]);
    expect(absences(r, 'alice', T0).map((a) => a.id)).toEqual(['bob']);
  });

  it('déconnecté : « remplacement possible dans N s », puis remplaçable à 0 (tous les rythmes, pour tous)', () => {
    const r = room({ timerMode: '30s', seats: [seat(0, 'alice', 'Alice'), seat(1, 'bob', 'Bob', { connected: false })], disconnectedSince: { bob: T0 } });
    const a1 = absences(r, 'alice', T0 + 18_000)[0]!;
    expect(a1.text).toBe('Bob a perdu la connexion · remplacement possible dans 42 s');
    expect(a1.replaceIn).toBe(42);
    expect(a1.replaceable).toBe(false);
    expect(a1.handover).toBeNull();
    const a2 = absences(r, 'alice', T0 + 61_000)[0]!;
    expect(a2.text).toBe('Bob a perdu la connexion');
    expect(a2.replaceable).toBe(true);
    // Un invité (non hôte) voit la même chose.
    const r3 = room({ ...r, seats: [...r.seats, seat(2, 'cid', 'Cid')] });
    expect(absences(r3, 'cid', T0 + 61_000)[0]!.replaceable).toBe(true);
  });

  it('parti explicitement (`left`) : « a quitté la table », remplaçable tout de suite', () => {
    const r = room({ seats: [seat(0, 'alice', 'Alice'), seat(1, 'bob', 'Bob', { connected: false })], left: ['bob'] });
    const a = absences(r, 'alice', T0)[0]!;
    expect(a.left).toBe(true);
    expect(a.text).toBe('Bob a quitté la table');
    expect(a.replaceable).toBe(true);
  });

  it('pas remplaçable hors partie (salon) ; date inconnue → texte sans décompte, pas de bouton', () => {
    const lobby = room({ status: 'lobby', seats: [seat(0, 'alice', 'Alice'), seat(1, 'bob', 'Bob', { connected: false })], disconnectedSince: { bob: T0 - 100_000 } });
    expect(absences(lobby, 'alice', T0)[0]!.replaceable).toBe(false);
    const noDate = room({ seats: [seat(0, 'alice', 'Alice'), seat(1, 'bob', 'Bob', { connected: false })] });
    const a = absences(noDate, 'alice', T0)[0]!;
    expect(a.text).toBe('Bob a perdu la connexion…');
    expect(a.replaceIn).toBeNull();
    expect(a.replaceable).toBe(false);
  });

  it('capitaine déconnecté : « Le capitanat passera à X dans N s » (X = premier humain connecté, « toi » si c’est moi)', () => {
    const r = room({ seats: [seat(0, 'alice', 'Alice', { connected: false }), seat(1, 'bob', 'Bob'), seat(2, 'cid', 'Cid')], disconnectedSince: { alice: T0 } });
    expect(absences(r, 'cid', T0 + 20_000)[0]!.handover).toBe('Le capitanat passera à Bob dans 40 s');
    expect(absences(r, 'bob', T0 + 20_000)[0]!.handover).toBe('Le capitanat passera à toi dans 40 s');
    expect(absences(r, 'cid', T0 + 65_000)[0]!.handover).toBe('Le capitanat passe à Bob');
    // Bob est lui-même déconnecté : Cid hérite.
    const r2 = room({ ...r, seats: [seat(0, 'alice', 'Alice', { connected: false }), seat(1, 'bob', 'Bob', { connected: false }), seat(2, 'cid', 'Cid')], disconnectedSince: { alice: T0, bob: T0 } });
    expect(nextCaptain(r2)?.playerId).toBe('cid');
    expect(absences(r2, 'cid', T0).find((a) => a.isHost)!.handover).toBe('Le capitanat passera à toi dans 60 s');
  });
});

describe('overStatus', () => {
  it('nomme les partis, dit si le capitaine est parti et s’il ne reste personne', () => {
    expect(overStatus(room({ status: 'over' }), 'bob')).toEqual({ leftNames: [], hostLeft: false, othersGone: false });
    expect(overStatus(room({ status: 'over', left: ['alice'] }), 'bob')).toEqual({ leftNames: ['Alice'], hostLeft: true, othersGone: false });
    expect(overStatus(room({ status: 'over', left: ['alice', 'cid'], host: 'bob' }), 'bob')).toEqual({ leftNames: ['Alice', 'Cid'], hostLeft: false, othersGone: true });
    expect(overStatus(null, 'bob').othersGone).toBe(false);
  });
});
