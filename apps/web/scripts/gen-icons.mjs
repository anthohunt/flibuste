// Exporte l'identité visuelle à partir de art-source/emblem.svg (dessiné pour ce projet, aucun appel à un modèle d'image).
// Lancer depuis la racine : pnpm --filter @flibuste/web gen:icons
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import sharp from 'sharp';
const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, 'public', 'brand');
mkdirSync(out, { recursive: true });
const svg = readFileSync(join(web, 'art-source/emblem.svg'));
const png = (size) => sharp(svg, { density: 300 }).resize(size, size).png().toBuffer();
for (const size of [32, 64, 180, 192, 512]) writeFileSync(join(out, `emblem-v1-${size}.png`), await png(size));
// Version « maskable » : le dessin occupe 70 % du carré, sur fond uni.
const inner = await sharp(svg, { density: 300 }).resize(358, 358).png().toBuffer();
writeFileSync(join(out, 'emblem-v1-maskable.png'), await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0b1b23' } }).composite([{ input: inner, left: 77, top: 77 }]).png().toBuffer());
// Pastille des notifications (monochrome).
writeFileSync(join(out, 'badge-v1.png'), await sharp(svg, { density: 300 }).resize(96, 96).greyscale().png().toBuffer());
// Image de partage 1200x630.
const texte = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#0b1b23"/><rect x="24" y="24" width="1152" height="582" fill="none" stroke="#b3853f" stroke-width="2"/><text x="860" y="270" font-family="Georgia,serif" font-size="82" text-anchor="middle" fill="#f0cf82">Flibuste</text><text x="860" y="325" font-family="Georgia,serif" font-size="26" text-anchor="middle" fill="#f0cf82" letter-spacing="8">ONLINE</text><text x="860" y="412" font-family="Georgia,serif" font-size="23" text-anchor="middle" fill="#e3d3b9">Jeu de cartes pirate</text><text x="860" y="453" font-family="Georgia,serif" font-size="19" text-anchor="middle" fill="#e3d3b9">Jeu libre · Apache 2.0</text></svg>`);
const emb = await png(480);
writeFileSync(join(out, 'share-v1.png'), await sharp(texte).composite([{ input: emb, left: 90, top: 75 }]).png().toBuffer());
// ICO : une image PNG de 32 px.
const p32 = readFileSync(join(out, 'emblem-v1-32.png'));
const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header[6] = header[7] = 32; header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(p32.length, 14); header.writeUInt32LE(22, 18);
writeFileSync(join(out, 'favicon-v1.ico'), Buffer.concat([header, p32]));
for (const [dest, src] of Object.entries({ 'pwa-192x192.png': 'emblem-v1-192.png', 'pwa-512x512.png': 'emblem-v1-512.png', 'apple-touch-icon.png': 'emblem-v1-180.png', 'favicon-64.png': 'emblem-v1-64.png', 'favicon.ico': 'favicon-v1.ico' })) copyFileSync(join(out, src), join(web, 'public', dest));
copyFileSync(join(web, 'art-source/emblem.svg'), join(web, 'public/icon.svg'));
console.log('Identité visuelle exportée depuis art-source/emblem.svg');
