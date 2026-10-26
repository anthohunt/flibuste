// CT-03 — l'info-bulle d'une ligne du registre doit énoncer la règle de points RÉELLEMENT appliquée.
// Le pari 0 se compte par carte distribuée (±10 × cartes), pas par pli : `engine/scoring.ts` le fait,
// l'info-bulle disait « +20 par pli », soit 0 point pour un « +50 » affiché.
import { describe, expect, it } from 'vitest';
import { bidExplainFr } from '../lib/scoreMeta';
import type { RoundScore } from '../lib/types';

const score = (p: Partial<RoundScore>): RoundScore => ({
  round: 5,
  player: 'p1',
  bid: 0,
  effectiveBid: 0,
  tricks: 0,
  made: true,
  base: 0,
  bonus: 0,
  gambler: 0,
  loot: 0,
  total: 0,
  ...p,
});

describe('bidExplainFr', () => {
  it('pari 0 réussi : +10 × cartes distribuées, pas « +20 par pli »', () => {
    const t = bidExplainFr(score({ bid: 0, effectiveBid: 0, tricks: 0, made: true, base: 50, total: 50 }));
    expect(t).toBe('Pari 0, 0 pli remporté. Pari 0 réussi : +10 × 5 cartes distribuées = +50.');
    expect(t).not.toContain('+20 par pli');
  });

  it('pari 0 raté : −10 × cartes distribuées, pas « −10 par pli d’écart »', () => {
    const t = bidExplainFr(score({ tricks: 3, made: false, base: -50, total: -50 }));
    expect(t).toBe('Pari 0, 3 plis remportés. Pari 0 raté : −10 × 5 cartes distribuées = −50.');
    expect(t).not.toContain('d’écart');
  });

  it('pari 0 sur une manche d’une carte : le singulier', () => {
    expect(bidExplainFr(score({ base: 10, total: 10 }))).toBe('Pari 0, 0 pli remporté. Pari 0 réussi : +10 × 1 carte distribuée = +10.');
  });

  it('pari tenu non nul : +20 par pli, avec le total de la ligne', () => {
    expect(bidExplainFr(score({ bid: 2, effectiveBid: 2, tricks: 2, made: true, base: 40, total: 40 }))).toBe('Pari 2, 2 plis remportés. Pari tenu : +20 par pli = +40.');
  });

  it('pari raté non nul : l’écart est chiffré', () => {
    expect(bidExplainFr(score({ bid: 2, effectiveBid: 2, tricks: 4, made: false, base: -20, total: -20 }))).toBe('Pari 2, 4 plis remportés. 2 plis d’écart : −10 par pli = −20.');
    expect(bidExplainFr(score({ bid: 3, effectiveBid: 3, tricks: 2, made: false, base: -10, total: -10 }))).toBe('Pari 3, 2 plis remportés. 1 pli d’écart : −10 par pli = −10.');
  });

  it('pari ajusté par Gaspard l’Ajusteur : les deux valeurs sont dites', () => {
    expect(bidExplainFr(score({ bid: 1, effectiveBid: 0, tricks: 0, made: true, base: 30, total: 30 }))).toBe('Pari 1 → 0 (Gaspard ±1), 0 pli remporté. Pari 0 réussi : +10 × 3 cartes distribuées = +30.');
  });
});
