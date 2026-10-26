// Chantier 3.C « Premier rendu » — PERF-01 (coquille statique) et PERF-31 (bundle par écran).
// Ces garde-fous tiennent sur les SOURCES : ils défendent les trois propriétés qui font qu'un premier rendu
// arrive en moins d'une seconde sur un réseau lent, et qu'il ne coûte pas un pixel de décalage.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(racine, 'src/App.svelte'), 'utf8');
const main = fs.readFileSync(path.join(racine, 'src/main.ts'), 'utf8');
/** Le bloc `<style>` de la coquille, celui qui doit suffire à la peindre sans aucune ressource. */
const styleCoquille = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';

describe('PERF-01 — la coquille statique', () => {
  it('écrit dans le HTML de quoi lire quelque chose de sensé', () => {
    expect(html).toMatch(/<div id="boot">/);
    expect(html).toContain('On prépare la taverne');
    // L'enseigne : le nom du jeu, en clair, dans le HTML servi.
    expect(html).toMatch(/class="boot-title">Flibuste</);
  });

  it('est hors du flux : sa disparition ne peut décaler aucun élément (CLS)', () => {
    expect(styleCoquille).toMatch(/#boot\s*\{[^}]*position:\s*fixed/);
    expect(styleCoquille).toMatch(/#boot\s*\{[^}]*inset:\s*0/);
  });

  it('fixe corps et interligne : la feuille de style qui arrive après ne la redimensionne pas', () => {
    // Sans ces deux lignes, `app.css` (chargé sans bloquer le rendu) changeait la hauteur de la ligne
    // d'attente de 22 à 23 px : 3 px de recentrage, 0,00006 de CLS. Mesuré, puis supprimé.
    expect(styleCoquille).toMatch(/#boot\s*\{[^}]*font-size:\s*1rem/);
    expect(styleCoquille).toMatch(/#boot\s*\{[^}]*line-height:\s*1\.35/);
  });

  it('ne demande ni police distante ni image : zéro octet, zéro requête, zéro substitution de police', () => {
    expect(styleCoquille).not.toMatch(/@font-face|url\(/);
    expect(styleCoquille).toMatch(/font-family:\s*Georgia/);
    const coquille = /<div id="boot">[\s\S]*?<\/div>\s*<\/div>/.exec(html)?.[0] ?? '';
    expect(coquille).not.toMatch(/<img|background-image|src=/);
  });

  it('respecte « moins de mouvement »', () => {
    expect(styleCoquille).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('est retirée par main.ts, après le montage ET la feuille de style, avec un filet de sécurité', () => {
    expect(main).toContain("document.getElementById('boot')");
    expect(main).toContain('feuilleAppliquee');
    expect(main).toMatch(/prefers-reduced-motion: reduce/);
    // Jamais de page bloquée derrière la coquille : un délai la retire quoi qu'il arrive.
    expect(main).toMatch(/setTimeout\(fin, 4000\)/);
  });
});

describe('PERF-31 — un écran, un morceau de bundle', () => {
  const lourds = ['Lobby', 'OnlineLobby', 'Join', 'Table', 'RoundScore', 'GameOver'];

  it("n'importe plus statiquement les écrans qui ne sont pas l'accueil", () => {
    for (const nom of lourds) expect(app, nom).not.toMatch(new RegExp(`^\\s*import ${nom} from`, 'm'));
    // L'accueil, lui, RESTE statique : le différer coûterait un aller-retour de plus (2 s en Slow 3G).
    expect(app).toMatch(/^\s*import Home from '\.\/routes\/Home\.svelte';$/m);
  });

  it('les charge à la demande, y compris la couche du codex', () => {
    for (const nom of lourds) expect(app, nom).toContain(`import('./routes/${nom}.svelte')`);
    expect(app).toContain("import('./components/CodexLayer.svelte')");
  });

  it('les précharge dès que le fil principal souffle', () => {
    expect(app).toMatch(/requestIdleCallback/);
    expect(app).toMatch(/for \(const cle of Object\.keys\(ECRANS\)\) charger\(cle\);/);
    // …mais jamais avant que la page ne soit chargée : rien ne doit disputer la bande passante à l'écran vu.
    expect(app).toMatch(/readyState === 'complete'/);
  });

  it("affiche une attente plutôt qu'un écran nu le temps du chargement", () => {
    expect(app).toContain("data-testid=\"ecran-attente\"");
    expect(app).toContain('On prépare la taverne');
  });
});
