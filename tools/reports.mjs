#!/usr/bin/env node
// node tools/reports.mjs [--limite 20] [--genre bug|idee] [--json] [--db <chemin>] [--images <dossier>]
//
// Lit les rapports laissés par les joueurs (POST /api/report), du plus récent au plus ancien. Sans cette
// commande, les rapports tombent dans un trou noir : rien ne sort du serveur, aucun mail, aucun service tiers.
//
// Deux choix qui méritent d'être dits :
//
//  1. `node:sqlite` et non `better-sqlite3`. Le serveur, lui, utilise better-sqlite3 — mais il est déclaré
//     dans `apps/server`, et pnpm ne le rend pas résolvable depuis `tools/` : `node tools/reports.mjs`
//     échouerait sur un ERR_MODULE_NOT_FOUND. Le module SQLite intégré à Node ne demande RIEN à installer,
//     ce qui est exactement ce qu'on veut d'un outil de dépannage qu'on lance un jour de panne.
//  2. Ouverture en LECTURE SEULE. Cet outil se lance sur la base d'un jeu EN COURS, avec des amis dessus.
//     Une inspection ne doit pas pouvoir écrire, même par accident, même par un `PRAGMA` malheureux.

import fs from 'node:fs';
import path from 'node:path';

// `node:sqlite` est encore marque experimental et Node l'annonce sur la sortie d'erreur a chaque lancement.
// Au milieu d'un rapport lu par un humain, c'est du bruit — et le seul bruit qu'on se permet de taire : tout
// autre avertissement passe. Le filtre doit etre pose AVANT le chargement du module, d'ou l'import dynamique
// (en ESM, les imports statiques sont evalues avant la premiere ligne du corps).
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/.test(w.message)) return;
  console.error(w.stack ?? `${w.name}: ${w.message}`);
});
const { DatabaseSync } = await import('node:sqlite');

const args = process.argv.slice(2);
const option = (nom, defaut) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : defaut;
};
const drapeau = (nom) => args.includes(`--${nom}`);
/** Où écrire les captures jointes. Absent : on ne les lit même pas (voir plus bas). */
const dossierImages = option('images', null);

if (drapeau('help') || drapeau('h')) {
  console.log('node tools/reports.mjs [--limite 20] [--genre bug|idee] [--json] [--db <chemin>] [--images <dossier>]');
  console.log('  --images <dossier> : écrit les captures jointes dans ce dossier (report-<id>.<ext>) et affiche leur chemin.');
  process.exit(0);
}

const limite = Math.max(1, Number(option('limite', 20)) || 20);
const genre = option('genre', null);
if (genre !== null && genre !== 'bug' && genre !== 'idee') {
  console.error(`--genre attend "bug" ou "idee" (reçu : ${genre})`);
  process.exit(2);
}

// Même chemin que le serveur : `dataDir` de la config, plus `flibuste.db`.
const fichier = path.resolve(option('db', path.join(process.env.DATA_DIR || './data', 'flibuste.db')));
if (!fs.existsSync(fichier)) {
  console.error(`Pas de base à ${fichier}.`);
  console.error('Indiquer la bonne avec --db <chemin>, ou DATA_DIR=<dossier> si le serveur tourne ailleurs.');
  process.exit(1);
}

let db;
try {
  db = new DatabaseSync(fichier, { readOnly: true });
} catch (err) {
  // Une base en WAL a besoin de son fichier `-shm` : sur une base ouverte par le serveur d'un AUTRE
  // utilisateur, la lecture seule peut être refusée. Le dire plutôt que de laisser une pile d'appels.
  console.error(`Impossible d'ouvrir ${fichier} en lecture seule : ${err.message}`);
  process.exit(1);
}

const existe = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reports'").get();
if (!existe) {
  console.error(`La table "reports" n'existe pas encore dans ${fichier} — le serveur ne l'a jamais démarrée.`);
  process.exit(1);
}

// Le tri porte sur `id`, monotone : gratuit (index de la clé primaire) et il départage deux rapports
// arrivés dans la même milliseconde, ce que `at` ne sait pas faire.
const lignes = db
  // `length(image)` et non `image` : on affiche vingt rapports, on n'en ouvre qu'un. Charger les octets de
  // toutes les captures pour n'en écrire aucune, c'est le genre de gaspillage qui rend un outil pénible sur
  // une base qui a vécu. Les octets ne sont lus qu'à la demande, sous `--images`.
  .prepare(
    `SELECT id, at, genre, nom, texte, contexte, imageType, length(image) AS imageOctets FROM reports${genre ? ' WHERE genre = ?' : ''} ORDER BY id DESC LIMIT ?`,
  )
  .all(...(genre ? [genre, limite] : [limite]));
const total = db.prepare(`SELECT COUNT(*) AS n FROM reports${genre ? ' WHERE genre = ?' : ''}`).get(...(genre ? [genre] : [])).n;
db.close();

const couleur = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (couleur ? `\u001b[${code}m${s}\u001b[0m` : s);
const gras = (s) => c('1', s);
const pale = (s) => c('2', s);

const date = (ms) => new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Le terminal exécute ce qu'on lui écrit. Le serveur retire bien les caractères de contrôle de `nom` et de
 * `texte`, mais il stocke `contexte` TEL QUEL — clés comprises — et c'est délibéré : il ne l'interprète
 * pas. Le rendu, lui, doit s'en protéger, sinon une ligne de `curl` suffit à poser dans un rapport
 * `\u001b[2J` (efface l'écran), `\u001b]0;…\u0007` (réécrit le titre de la fenêtre) ou `\u001b[8m`
 * (texte invisible) — de quoi masquer le contenu d'un rapport, ou cacher un rapport entier au-dessus.
 * C'est exactement ce que `server.ts` annonce (« Échapper au rendu est le bon endroit pour s'en
 * protéger ») ; voici ce rendu. Le mode `--json`, lui, est déjà sûr : `JSON.stringify` rééchappe tout.
 */
const sansControle = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, '·');

/** Une valeur de contexte sur une ligne : les imbriquées repassent en JSON compact, sans les déplier. */
const valeur = (v) => sansControle(typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

// Aucun `process.exit` passe cette ligne : vers un tube (`| jq`, `| less`), Node n'attend pas la fin de
// l'ecriture, et sortir explicitement tronquerait la sortie.
if (drapeau('json')) {
  // Le contexte est rendu tel qu'il a été reçu : un JSON déjà valide qu'on réinjecte, pas une chaîne
  // échappée dans une chaîne — c'est ce qui rend la sortie utilisable par `jq`.
  console.log(JSON.stringify({ total, rapports: lignes.map((r) => ({ ...r, contexte: r.contexte ? JSON.parse(r.contexte) : null })) }, null, 2));
} else if (lignes.length === 0) {
  console.log(pale(`Aucun rapport${genre ? ` de genre « ${genre} »` : ''} dans ${fichier}.`));
} else {
  console.log(pale(`${lignes.length} rapport(s) affiché(s) sur ${total} — ${fichier}`));
  for (const r of lignes) {
    const etiquette = r.genre === 'bug' ? c('31', 'bug ') : c('36', 'idée');
    console.log('');
    // La capture s'annonce sur la ligne d'en-tête : savoir qu'elle existe change la façon dont on lit le
    // texte en dessous (« regarde l'écran » n'a de sens que si on sait qu'il y a un écran à regarder).
    const capture = r.imageOctets ? pale(`  📎 ${Math.round(r.imageOctets / 1024)} Ko`) : '';
    console.log(`${gras(`#${r.id}`)}  ${etiquette}  ${gras(sansControle(r.nom))}  ${pale(date(r.at))}${capture}`);
    // Le texte aussi, alors que le serveur l'a déjà nettoyé : une base se remplit aussi à la main, et un
    // outil de dépannage doit rester lisible sur une ligne que personne n'a écrite par le bon chemin.
    for (const ligne of r.texte.split('\n')) console.log(`  ${sansControle(ligne)}`);
    if (!r.contexte) continue;
    try {
      // Aucune clé n'est attendue : le serveur ne les interprète pas, cet outil non plus. On affiche ce qu'il y
      // a, y compris un champ ajouté par le client la semaine dernière et dont personne ici n'a entendu parler.
      for (const [k, v] of Object.entries(JSON.parse(r.contexte))) console.log(pale(`    ${sansControle(k)} : ${valeur(v)}`));
    } catch {
      console.log(pale(`    contexte illisible : ${sansControle(r.contexte)}`));
    }
  }
}

/**
 * Les captures d'écran, écrites sur le disque à la demande.
 *
 * Elles vivent en BASE et pas en fichiers (voir `ReportRow.image`) : c'est ce qui les fait voyager avec la
 * sauvegarde de `/data` et disparaître avec leur rapport. La contrepartie est qu'on ne peut pas les ouvrir
 * d'un double-clic — d'où cette option, qui les ressort une par une sous un nom qui dit à quel rapport elles
 * appartiennent. Sans `--images`, on n'en lit pas un octet.
 */
if (dossierImages) {
  const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
  const avecImage = lignes.filter((r) => r.imageOctets);
  if (avecImage.length === 0) {
    console.log('');
    console.log(pale('Aucune capture jointe parmi ces rapports.'));
  } else {
    fs.mkdirSync(dossierImages, { recursive: true });
    const lire = db.prepare('SELECT image FROM reports WHERE id = ?');
    console.log('');
    for (const r of avecImage) {
      const ext = EXT[r.imageType] ?? 'bin';
      const cible = path.join(dossierImages, `report-${r.id}.${ext}`);
      const octets = lire.get(r.id)?.image;
      if (!octets) continue;
      fs.writeFileSync(cible, Buffer.from(octets));
      console.log(`  capture #${r.id} → ${cible}`);
    }
  }
}
