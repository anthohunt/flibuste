import { describe, expect, it } from 'vitest';
import { href, navigate, normalizeHash, parseHash, route, startRouter } from '../lib/router.svelte';

describe('router', () => {
  it('parse les routes connues, avec code et query', () => {
    expect(parseHash('')).toEqual({ name: 'home', params: {} });
    expect(parseHash('#/')).toEqual({ name: 'home', params: {} });
    expect(parseHash('#/lobby/ABCD')).toEqual({ name: 'lobby', params: { code: 'ABCD' } });
    expect(parseHash('#/lobby?mode=solo')).toEqual({ name: 'lobby', params: { mode: 'solo' } });
    expect(parseHash('#/table')).toEqual({ name: 'table', params: {} });
  });

  it('retombe sur home pour une route inconnue', () => {
    expect(parseHash('#/nimporte')).toEqual({ name: 'home', params: {} });
  });

  it('href est l’inverse de parseHash', () => {
    const h = href('lobby', { code: 'WXYZ', mode: 'join' });
    expect(parseHash(h)).toEqual({ name: 'lobby', params: { code: 'WXYZ', mode: 'join' } });
    expect(href('home')).toBe('#/');
  });

  it('normalise les routes inconnues en #/ (et laisse les connues)', () => {
    expect(normalizeHash('#/nope')).toBe('#/');
    expect(normalizeHash('#/room/ABCD')).toBe('#/');
    expect(normalizeHash('#nimporte')).toBe('#/');
    expect(normalizeHash('#/lobby/ABCD')).toBeNull();
    expect(normalizeHash('#/table')).toBeNull();
    expect(normalizeHash('')).toBeNull();
    expect(normalizeHash('#/')).toBeNull();
  });

  it('navigate({ replace: true }) remplace l’entrée d’historique au lieu d’en pousser une', () => {
    const stop = startRouter();
    location.hash = '#/';
    const len = history.length;
    navigate('table', {}, { replace: true });
    expect(location.hash).toBe('#/table');
    expect(route.name).toBe('table');
    expect(history.length).toBe(len);
    navigate('score', {}, { replace: true });
    expect(location.hash).toBe('#/score');
    expect(history.length).toBe(len);
    stop();
  });

  it('une URL fantôme est réécrite en #/ au démarrage du routeur', () => {
    history.replaceState(null, '', '#/room/ABCD');
    const stop = startRouter();
    expect(location.hash).toBe('#/');
    expect(route.name).toBe('home');
    stop();
  });
});
