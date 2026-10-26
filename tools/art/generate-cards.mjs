// Dessine les illustrations de cartes (SVG écrit à la main → WebP) : aucune image tierce, aucun modèle d'image.
// Usage : node tools/art/generate-cards.mjs   (écrit apps/web/public/art/ et apps/web/art/manifest.json)
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import sharp from 'sharp';

const web = join(dirname(fileURLToPath(import.meta.url)), '../../apps/web');
const W = 360, H = 504;
const GOLD = '#e8bf4a';

// [id, couleur haute, couleur basse, dessin central (repère 0..100, centré en 50,50)]
const sw = (c, w = 3) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const CARDS = {
  back: ['#0e2a3a', '#06141c', `<g ${sw(GOLD, 2)}><path d="M50 10 90 50 50 90 10 50Z"/><path d="M50 22 78 50 50 78 22 50Z"/><circle cx="50" cy="50" r="10"/></g><path d="M50 34 56 50 50 66 44 50Z" fill="${GOLD}"/>`],
  parrot: ['#1e5c34', '#0b2a17', `<g ${sw('#a7f3d0', 2)} opacity=".35"><path d="M20 80c20-40 40-40 60-60M30 85c20-40 40-40 60-60"/></g>`],
  map: ['#4a2380', '#1d0c36', `<g ${sw('#e9d5ff', 2)} opacity=".35"><path d="M15 20h70v60H15zM15 40h70M15 60h70M40 20v60M60 20v60"/></g>`],
  chest: ['#7a5a0d', '#2b1e03', `<g ${sw('#fde68a', 2)} opacity=".35"><circle cx="50" cy="50" r="30"/><circle cx="50" cy="50" r="18"/></g>`],
  roger: ['#26262e', '#08080a', `<g ${sw('#f1e7cf', 2)} opacity=".3"><path d="M20 20 80 80M80 20 20 80"/></g>`],
  escape: ['#e2e8f0', '#94a3b8', `<path d="M22 20v62" ${sw('#1e293b', 4)}/><path d="M24 24c14-8 24 8 38 0s14-6 18-4v32c-4-2-10-4-18 4s-24-8-38 0z" fill="#fff" stroke="#1e293b" stroke-width="3"/>`],
  helm: ['#0e7490', '#082f3a', `<g ${sw(GOLD, 4)}><circle cx="50" cy="50" r="22"/><circle cx="50" cy="50" r="6"/><path d="M50 14v72M14 50h72M24 24l52 52M76 24 24 76"/></g>`],
  trader: ['#92400e', '#3b1a04', `<g ${sw(GOLD, 4)}><path d="M22 36h50M62 24l12 12-12 12M78 66H28M38 54 26 66l12 12"/></g><circle cx="50" cy="50" r="6" fill="${GOLD}"/>`],
  adjuster: ['#7f1d1d', '#2e0909', `<g ${sw(GOLD, 6)}><path d="M20 34h28M34 20v28M56 70h28"/></g>`],
  oracle: ['#312e81', '#12103a', `<path d="M10 50C28 22 72 22 90 50 72 78 28 78 10 50Z" fill="#c7d2fe" stroke="${GOLD}" stroke-width="3"/><circle cx="50" cy="50" r="15" fill="#312e81"/><circle cx="50" cy="50" r="6" fill="${GOLD}"/>`],
  gambler: ['#7c2d12', '#2d0f06', `<rect x="22" y="22" width="56" height="56" rx="9" fill="#fff7ed"/><g fill="#7c2d12"><circle cx="38" cy="38" r="5"/><circle cx="62" cy="38" r="5"/><circle cx="50" cy="50" r="5"/><circle cx="38" cy="62" r="5"/><circle cx="62" cy="62" r="5"/></g>`],
  hexer: ['#581c87', '#1e0838', `<path d="M62 18a32 32 0 1 0 0 64 26 26 0 1 1 0-64Z" fill="${GOLD}"/><path d="m74 38 3 8 8 1-6 6 2 8-7-4-7 4 2-8-6-6 8-1z" fill="#fff7ed"/>`],
  pirateking: ['#111827', '#030712', `<path d="M18 72 14 32l22 18 14-26 14 26 22-18-4 40z" fill="${GOLD}" stroke="#7a5a0d" stroke-width="2"/><rect x="18" y="76" width="64" height="8" rx="3" fill="${GOLD}"/><g fill="#dc2626"><circle cx="50" cy="60" r="4"/><circle cx="32" cy="62" r="3"/><circle cx="68" cy="62" r="3"/></g>`],
  tigress: ['#b45309', '#3a1a03', `<g ${sw('#1c0a00', 7)}><path d="M18 30c20 6 44 6 64 0M16 50c22 8 46 8 68 0M20 70c20 6 40 6 60 0"/></g><circle cx="50" cy="50" r="8" fill="${GOLD}"/>`],
  mermaid: ['#0e7490', '#083344', `<path d="M50 14C28 14 16 40 22 66c8 12 20 14 28 8 8 6 20 4 28-8 6-26-6-52-28-52Z" fill="#a5f3fc"/><g ${sw('#0e7490', 3)}><path d="M50 22V72M36 28c-4 14-4 28 0 40M64 28c4 14 4 28 0 40"/></g>`],
  'mermaid-circe': ['#155e75', '#06202a', `<path d="M24 78c-6-24 6-50 26-58 20 8 32 34 26 58-10 6-42 6-52 0Z" fill="#67e8f9"/><g ${sw('#155e75', 3)}><path d="M50 24v54M32 36c2 14 2 24 0 34M68 36c-2 14-2 24 0 34"/></g><circle cx="50" cy="30" r="5" fill="${GOLD}"/>`],
  kraken: ['#312e81', '#0e0c33', `<circle cx="50" cy="38" r="20" fill="#818cf8"/><g ${sw('#818cf8', 7)}><path d="M32 52c-14 12-6 26-18 30M44 56c-6 14 2 22-6 30M56 56c6 14-2 22 6 30M68 52c14 12 6 26 18 30"/></g><circle cx="42" cy="36" r="4" fill="#fff"/><circle cx="58" cy="36" r="4" fill="#fff"/>`],
  whale: ['#1d4ed8', '#0c2461', `<path d="M10 56c10-24 40-30 62-18 6-8 14-10 18-8-2 8-4 12-10 16 2 14-18 26-40 24-14-2-26-8-30-14Z" fill="#eff6ff"/><circle cx="34" cy="50" r="3" fill="#1d4ed8"/><path d="M58 22c-4-8 0-12 4-14M62 22c4-6 10-6 12-4" ${sw('#bfdbfe', 3)}/>`],
  loot: ['#92400e', '#331503', `<circle cx="50" cy="50" r="26" fill="${GOLD}" stroke="#7a5a0d" stroke-width="4"/><circle cx="50" cy="50" r="18" ${sw('#7a5a0d', 2)}/><path d="M50 36v28M42 44h16M42 56h16" ${sw('#7a5a0d', 4)}/>`],
  wild15: ['#065f46', '#022c22', `<path d="m50 12 11 24 26 3-19 18 5 26-23-13-23 13 5-26L13 39l26-3z" fill="${GOLD}"/>`],
  flex14: ['#1e3a8a', '#0a1840', `<g ${sw('#bfdbfe', 4)}><path d="M24 50h52M66 38l12 12-12 12M34 38 22 50l12 12"/></g>`],
  mate: ['#7c2d12', '#2b0f05', `<g ${sw(GOLD, 5)}><circle cx="50" cy="22" r="7"/><path d="M50 29v56M34 42h32M24 62c2 16 14 24 26 24s24-8 26-24"/></g>`],
  volley: ['#3f3f46', '#111113', `<circle cx="42" cy="58" r="22" fill="#18181b" stroke="#a1a1aa" stroke-width="3"/><path d="m60 40 18-18M64 28l16-4M70 46l10 10" ${sw('#fde68a', 5)}/>`],
  plank: ['#44403c', '#14110f', `<path d="M10 40h56l24 14H10z" fill="#a8763e" stroke="#2b1c0b" stroke-width="3"/><path d="M0 76c14-10 26 10 40 0s26 10 40 0 14 4 20-2v30H0z" fill="#0e7490"/>`],
  stingray: ['#164e63', '#06202b', `<path d="M50 16 90 52 50 70 10 52Z" fill="#67e8f9"/><path d="M50 70c0 14 2 18 4 20" ${sw('#67e8f9', 4)}/><g fill="#164e63"><circle cx="40" cy="48" r="3"/><circle cx="60" cy="48" r="3"/><circle cx="50" cy="40" r="3"/></g>`],
  davy: ['#134e4a', '#04201e', `<rect x="26" y="44" width="48" height="38" rx="6" fill="${GOLD}"/><path d="M36 44V32a14 14 0 0 1 28 0v12" ${sw(GOLD, 6)}/><circle cx="50" cy="62" r="5" fill="#134e4a"/>`],
  storm: ['#1e293b', '#070b13', `<path d="M26 44a16 16 0 0 1 8-30 20 20 0 0 1 38 6 14 14 0 0 1 0 28z" fill="#94a3b8"/><path d="m54 46-16 24h12l-6 18 22-28H52l6-14z" fill="${GOLD}"/>`],
};

function svg([top, bottom, body], id) {
  const gid = `g${id.replace(/\W/g, '')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#${gid})"/>
<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="18" fill="none" stroke="${GOLD}" stroke-opacity=".7" stroke-width="3"/>
<g transform="translate(${(W - 280) / 2} ${(H - 280) / 2}) scale(2.8)">${body}</g></svg>`;
}

const out = join(web, 'public/art');
mkdirSync(join(out, 'approved-v2'), { recursive: true });
const manifest = {};
for (const [id, def] of Object.entries(CARDS)) {
  const buf = await sharp(Buffer.from(svg(def, id))).webp({ quality: 82 }).toBuffer();
  const thumb = await sharp(Buffer.from(svg(def, id))).resize(72, 100).webp({ quality: 70 }).toBuffer();
  writeFileSync(join(out, 'approved-v2', `${id}.webp`), buf);
  if (id !== 'mermaid-circe') {
    writeFileSync(join(out, `${id}-v1.webp`), buf);
    writeFileSync(join(out, `${id}-v1-thumb.webp`), thumb);
    manifest[id] = { chosen: 'v1', variants: ['v1'] };
  }
}
manifest.pirateking ??= { chosen: 'v1', variants: ['v1'] };
writeFileSync(join(web, 'art/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${Object.keys(CARDS).length} cartes dessinées`);
