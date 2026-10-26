// Santé de la cascade (E1 / UX-11) : dans `app.css`, une classe ne dicte JAMAIS sa position hors couche.
// Les utilitaires Tailwind (`fixed`, `absolute`, `sticky`, `relative`) vivent dans la couche `utilities` ; une règle
// hors couche les bat quelle que soit sa spécificité. C'est ainsi que `.panel-parchment { position: relative }`
// battait le `.fixed` de l'info-bulle, dessinée hors écran et rendant la page défilable à vide.
// Les déclarations de position des classes sont donc rassemblées dans `@layer components` ; seules les règles de
// pseudo-éléments (`::before`, `::after`), qui ne peuvent porter aucun utilitaire, restent hors couche.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app.css'), 'utf8');
/** Le fichier sans ses commentaires (une valeur `content: "/*"` n'existe pas ici). */
const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Bloc `@layer <nom> { … }` (accolades appariées), et le reste du fichier. */
function splitLayer(css: string, name: string): { layer: string; outside: string } {
  const start = css.indexOf(`@layer ${name} {`);
  if (start < 0) return { layer: '', outside: css };
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return { layer: css.slice(start, i + 1), outside: css.slice(0, start) + css.slice(i + 1) };
  }
  throw new Error('@layer non refermé');
}

/** Sélecteur de la règle qui contient l'index donné (le dernier bloc ouvert avant lui). */
function selectorAt(css: string, index: number): string {
  const before = css.slice(0, index);
  const open = before.lastIndexOf('{');
  return before
    .slice(before.lastIndexOf('}', open) + 1, open)
    .replace(/\s+/g, ' ')
    .trim();
}

describe('app.css — la matière ne dicte pas la position (E1)', () => {
  const { layer, outside } = splitLayer(withoutComments, 'components');

  it('la couche `components` existe et porte la position des surfaces composables', () => {
    expect(layer).not.toBe('');
    for (const cls of ['.panel-parchment', '.panel-wood', '.veil', '.sticky-cta', '.scene', '.btn-tavern', '.info-dot', '.stool']) {
      expect(layer, `${cls} devrait être dans @layer components`).toContain(cls);
    }
    expect(layer).toMatch(/position:\s*relative/);
  });

  it('hors couche, seules les règles de pseudo-éléments déclarent une position', () => {
    const fautes: string[] = [];
    for (const m of outside.matchAll(/(^|[;{\s])position:/g)) {
      const sel = selectorAt(outside, m.index!);
      if (!sel.includes('::')) fautes.push(sel);
    }
    expect(fautes, `règles hors couche qui dictent une position : ${fautes.join(' | ')}`).toEqual([]);
  });

  it('`.panel-parchment` reste une matière : ni position, ni géométrie de page', () => {
    const rule = outside.slice(outside.indexOf('.panel-parchment {'));
    const body = rule.slice(rule.indexOf('{') + 1, rule.indexOf('}'));
    expect(body).not.toMatch(/position:/);
    expect(body).toMatch(/background:/); // c'est bien la matière qui est décrite ici
  });
});
