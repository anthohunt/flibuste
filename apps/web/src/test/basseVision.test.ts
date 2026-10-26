// Vague 1 — chantier 1.C « Basse vision et dialogues ». Gardes statiques sur `app.css` : les règles qui débloquent
// la police à 200 % (A11Y-01, A11Y-06) et le contraste du « i » sur parchemin (A11Y-08). Elles se vérifient sur le
// texte du fichier — la mesure de rendu, elle, est faite par l'E2E `e2e/basse-vision.spec.ts`.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app.css'), 'utf8');

/** Corps de la première règle dont le sélecteur est exactement `selector`. */
function rule(selector: string): string {
  const re = new RegExp(`(^|[}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
  const m = CSS.match(re);
  expect(m, `règle « ${selector} » absente de app.css`).not.toBeNull();
  return m![2]!;
}

/** Couleur d'un jeton `--color-…` déclaré dans `:root`. */
function token(name: string): [number, number, number] {
  const m = CSS.match(new RegExp(`--color-${name}:\\s*#([0-9a-f]{6})`, 'i'));
  expect(m, `jeton --color-${name} absent`).not.toBeNull();
  const hex = m![1]!;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Luminance relative WCAG. */
function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100;
}

describe('A11Y-01 / A11Y-06 — l’écran de table à 200 % de police', () => {
  it('l’écran défile au lieu de compresser ses parts (la main tombait à 0 px de haut)', () => {
    const screen = rule('.table-screen.strip');
    expect(screen).toMatch(/overflow-y:\s*auto/);
    // Aucune part ne se comprime : c'est la compression qui écrasait `.hand-box` et faisait déborder les cartes
    // par-dessus les touches de pari 6 à 10.
    expect(rule('.table-screen.strip > *')).toMatch(/flex:\s*0 0 auto/);
  });

  it('la barre de laiton laisse sa largeur au titre de manche (il mesurait 0 px)', () => {
    expect(rule('.table-screen.strip > .table-bar')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.table-screen.strip > .table-bar > .bar-title')).toMatch(/flex:\s*1 1 100%/);
    expect(rule('.table-screen.strip > .table-bar > .bar-title > h1')).toMatch(/white-space:\s*normal/);
  });

  it('la plaque d’un siège en rangée suit la largeur de son nom (« Barb / Noir »)', () => {
    expect(rule('.table-zone.strip .seat-plaque')).toMatch(/width:\s*auto/);
    expect(rule('.table-zone.strip .seat-plaque .name')).toMatch(/width:\s*max-content/);
  });

  it('la barre de laiton n’est pas collante : elle recouvrirait les touches de pari amenées sous elle', () => {
    expect(CSS).not.toMatch(/\.table-screen\.strip\s*>\s*\.table-bar\s*\{[^}]*position:\s*sticky/);
  });
});

describe('A11Y-08 — le « i » d’explication sur parchemin', () => {
  /** Parchemin échantillonné au pixel par l'audit, là où le disque est posé. */
  const PARCHMENT: [number, number, number] = [230, 212, 177];

  it('l’or du jeton est illisible sur cette matière (c’est le constat)', () => {
    expect(contrast(token('gold-300'), PARCHMENT)).toBeLessThan(4.5);
    expect(contrast(token('gold-500'), PARCHMENT)).toBeLessThan(3);
  });

  it('sur parchemin, le jeton passe à l’encre : texte ≥ 4,5:1, bordure ≥ 3:1', () => {
    const body = rule('.panel-parchment .info-dot');
    expect(body).toMatch(/color:\s*var\(--color-ink-900\)/);
    expect(body).toMatch(/border-color:\s*var\(--color-ink-700\)/);
    expect(contrast(token('ink-900'), PARCHMENT)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('ink-700'), PARCHMENT)).toBeGreaterThanOrEqual(3);
  });
});
