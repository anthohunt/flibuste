// Profils de bots (vague 6) : préréglages, étiquette déduite du profil (« Perso » dès qu'un curseur bouge),
// conversion défensive de n'importe quelle entrée (niveau nu, ancien niveau, profil, spec), niveau classique.
import { describe, expect, it } from 'vitest';
import { BOT_PRESETS as ENGINE_PRESETS, REACTION_DELAYS_MS, usesMonteCarlo } from '@flibuste/bots';
import { BOT_PRESETS, BOT_LEVELS, isHeavy, legacyLevelOf, levelOf, profileOf, reactionDelay, specOf, specForLevel } from '../lib/botProfile';

describe('botProfile', () => {
  it('quatre préréglages, tous des profils valides', () => {
    expect(BOT_LEVELS).toEqual(['easy', 'normal', 'hard', 'ruthless']);
    for (const l of BOT_LEVELS) expect(levelOf(BOT_PRESETS[l])).toBe(l);
    expect(BOT_PRESETS.ruthless.malice).toBe(5);
    expect(BOT_PRESETS.easy.reaction).toBe('fast');
  });
  it('les niveaux solo et leurs délais restent ceux du moteur partagé avec le serveur', () => {
    for (const level of BOT_LEVELS) {
      expect(profileOf(level), level).toEqual(ENGINE_PRESETS[level]);
      expect(reactionDelay(profileOf(level)), level).toEqual(REACTION_DELAYS_MS[ENGINE_PRESETS[level].reaction]);
    }
  });
  it('tous les niveaux qui simulent quittent le fil UI, Normal compris', () => {
    expect(isHeavy(BOT_PRESETS.normal)).toBe(true);
    expect(isHeavy(BOT_PRESETS.easy)).toBe(false);
    for (let force = 0; force <= 10; force++) {
      const profile = { ...BOT_PRESETS.normal, force };
      expect(isHeavy(profile), `force ${force}`).toBe(usesMonteCarlo(profile));
    }
  });
  it('un curseur qui bouge → « custom » ; revenu au préréglage → le niveau', () => {
    const p = { ...BOT_PRESETS.hard, malice: 6 };
    expect(levelOf(p)).toBe('custom');
    expect(levelOf({ ...p, malice: 3 })).toBe('hard');
    expect(levelOf({ ...BOT_PRESETS.normal, reaction: 'slow' })).toBe('custom');
  });
  it('profileOf accepte un niveau, un profil, une spec, n’importe quoi (défaut Normal)', () => {
    expect(profileOf('ruthless')).toEqual(BOT_PRESETS.ruthless);
    expect(profileOf({ level: 'easy' })).toEqual(BOT_PRESETS.easy);
    expect(profileOf({ level: 'custom', profile: { ...BOT_PRESETS.easy, force: 9 } }).force).toBe(9);
    expect(profileOf(undefined)).toEqual(BOT_PRESETS.normal);
    expect(profileOf('expert')).toEqual(BOT_PRESETS.normal);
    expect(profileOf({ force: 11, malice: 0, prudence: 5, bonus: 3, memory: 2, bluff: 4, powers: 2, reaction: 'fast' })).toEqual(BOT_PRESETS.normal);
    expect(profileOf(BOT_PRESETS.hard)).not.toBe(BOT_PRESETS.hard);
  });
  it('specOf recalcule l’étiquette ; specForLevel copie le préréglage', () => {
    expect(specOf({ level: 'easy', profile: BOT_PRESETS.ruthless })).toEqual({ level: 'ruthless', profile: BOT_PRESETS.ruthless });
    expect(specForLevel('hard').level).toBe('hard');
  });
  it('niveau classique par la Force ; délai de réaction', () => {
    expect(legacyLevelOf(BOT_PRESETS.easy)).toBe('easy');
    expect(legacyLevelOf(BOT_PRESETS.normal)).toBe('normal');
    expect(legacyLevelOf(BOT_PRESETS.ruthless)).toBe('hard');
    expect(isHeavy(BOT_PRESETS.hard)).toBe(true);
    expect(isHeavy({ ...BOT_PRESETS.easy, force: 7 })).toBe(true);
    const [fmin, fmax] = reactionDelay(BOT_PRESETS.easy);
    const [smin] = reactionDelay({ ...BOT_PRESETS.easy, reaction: 'slow' });
    expect(fmin).toBeLessThanOrEqual(fmax);
    expect(smin).toBeGreaterThan(fmax);
    expect(reactionDelay(null)).toEqual(reactionDelay(BOT_PRESETS.normal));
  });
});
