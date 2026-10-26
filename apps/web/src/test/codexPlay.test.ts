// Le codex qui joue (vague 6) : `playSituation` branche la table en mode `scenario`, les adversaires scriptés
// jouent, le moteur tranche et le commentaire arrive ; « Suivante » enchaîne ; une vraie partie l'interdit.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { codex, closeSituation, nextSituation, playSituation } from '../lib/codex.svelte';
import { attach, currentView, detach, game, play, timing, type GameTransport } from '../lib/store.svelte';
import { SITUATIONS_BY_ID } from '../lib/situations';

describe('codex — situations jouées', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    game.identity = { ...game.identity, name: 'Alix' };
  });
  afterEach(() => {
    closeSituation();
    detach();
    vi.useRealTimers();
  });

  it('une situation « un pli » : ma carte, les adversaires scriptés, puis le commentaire du moteur', async () => {
    const sit = SITUATIONS_BY_ID['flibuste-caught-by-mermaid']!;
    expect(playSituation(sit)).toBe(true);
    expect(game.mode).toBe('scenario');
    expect(codex.situation?.id).toBe(sit.id);
    expect(game.view?.me).toBe('me');
    expect(game.names.anne).toBe('Anne');
    expect(game.names.me).toBe('Alix');
    expect(game.view?.currentPlayer).toBe('me');
    expect(play('pirateking')).toBe(true);
    // Anne puis Bob jouent (délai scripté), le pli se résout.
    await vi.advanceTimersByTimeAsync(2000);
    expect(currentView()?.history).toHaveLength(1);
    expect(currentView()?.history[0]?.winner).toBe('anne');
    await vi.advanceTimersByTimeAsync(timing.trickPause + 500);
    expect(codex.result).not.toBeNull();
    expect(codex.result!.comment.join(' ')).toMatch(/Anne/);
    expect(codex.result!.lesson).toBe(sit.lesson);
    // Plus rien ne bouge : la situation est jouée.
    expect(play('chest-2')).toBe(false);
  });

  it('« Suivante » enchaîne sur la situation suivante de la même carte, puis ferme sur la fiche', () => {
    playSituation(SITUATIONS_BY_ID['kraken-eats-king']!);
    expect(nextSituation()).toBe(true);
    expect(codex.situation?.id).toBe('kraken-then-whale');
    expect(codex.result).toBeNull();
    closeSituation();
    expect(codex.situation).toBeNull();
    expect(codex.open).toBe(true);
    expect(codex.focus).toBe('kraken');
    expect(game.mode).toBeNull();
  });

  it('met une vraie partie en pause, puis la reprend à la fermeture', () => {
    const t: GameTransport = { send: () => {}, onView: () => () => {} };
    attach(t, 'offline', { names: { me: 'Moi' } });
    expect(playSituation(SITUATIONS_BY_ID['kraken-eats-king']!)).toBe(true);
    expect(game.mode).toBe('scenario');
    expect(codex.suspended).toBe(true);
    closeSituation();
    // Aucune sauvegarde solo dans ce test : la reprise échoue proprement, mais la pause est bien levée
    // et on ne retombe pas dans le menu Codex (on voulait revenir à la partie).
    expect(codex.suspended).toBe(false);
    expect(codex.situation).toBeNull();
    expect(codex.open).toBe(false);
  });
});
