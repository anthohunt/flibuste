// Un rapport de joueur devient un ticket GitHub, tout de suite.
//
// Pourquoi ici et pas dans un outil qu'on lance a la main : un rapport qui dort dans une base
// n'existe pas. Tant que quelqu'un devait penser a lancer `tools/reports.mjs`, les remarques
// restaient invisibles pendant des jours.
//
// Trois regles, dans l'ordre d'importance :
//  1. l'ouverture du ticket ne doit JAMAIS faire echouer l'envoi du rapport. Le joueur a fait sa
//     part ; si GitHub est en panne, c'est notre probleme, pas le sien. Le rapport est deja en
//     base, l'outil de lecture le retrouvera.
//  2. sans jeton, la fonction ne fait rien et ne se plaint pas : en developpement, personne n'a
//     de jeton, et ce n'est pas une anomalie.
//  3. aucune image n'est envoyee : elle reste dans la base du serveur (l'API de GitHub ne prend
//     pas de piece jointe par ce chemin), et le ticket dit ou la trouver.

import type { ReportRow } from './db';

const DEPOT = process.env.GITHUB_REPO ?? '';
const JETON = process.env.GITHUB_TOKEN ?? '';

/** Vrai quand le serveur est capable d'ouvrir des tickets (un jeton est configure). */
export const ticketsActifs = (): boolean => JETON.length > 0 && DEPOT.length > 0;

function corpsDuTicket(r: Omit<ReportRow, 'id'>, id: number): string {
  let c: Record<string, unknown> = {};
  try {
    c = r.contexte ? (JSON.parse(r.contexte) as Record<string, unknown>) : {};
  } catch {
    c = {};
  }
  const p = (c.partie ?? {}) as Record<string, unknown>;
  const ligne = (nom: string, v: unknown) => (v === undefined || v === null || v === '' ? '' : `| ${nom} | ${String(v)} |\n`);
  return (
    `${r.texte}\n\n---\n` +
    `Remonté depuis le jeu par **${r.nom}** (rapport #${id}${c.mode ? `, ${String(c.mode)}` : ''}).\n\n` +
    '| | |\n|---|---|\n' +
    ligne('Écran du jeu', c.route) +
    ligne('Taille d’écran', c.ecran) +
    ligne('Phase', p.phase) +
    ligne('Manche', p.manche && `${String(p.manche)} / ${String(p.manches)}, ${String(p.cartes)} cartes`) +
    ligne('Table', p.joueurs && `${String(p.joueurs)} joueurs dont ${String(p.bots)} bots`) +
    ligne('Règles', p.regles) +
    ligne('Version', c.version) +
    (r.image ? `\nUne capture est jointe au rapport : \`node tools/reports.mjs --images <dossier>\`.\n` : '')
  );
}

/**
 * Ouvre le ticket, sans jamais rejeter. Renvoie le numero du ticket, ou null si rien n'a ete fait.
 * L'appelant peut ignorer la promesse : c'est un effet de bord, pas une etape de l'envoi.
 */
export async function ouvrirTicket(r: Omit<ReportRow, 'id'>, id: number): Promise<number | null> {
  if (!ticketsActifs()) return null;
  try {
    const titre = r.texte.split('\n')[0]!.split('.')[0]!.slice(0, 70).trim() || `Remarque de ${r.nom}`;
    const reponse = await fetch(`https://api.github.com/repos/${DEPOT}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `token ${JETON}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: titre, body: corpsDuTicket(r, id), labels: ['remarque', 'remonte-par-un-joueur'] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!reponse.ok) {
      console.error(`ticket non cree (${reponse.status}) pour le rapport #${id}`);
      return null;
    }
    const ticket = (await reponse.json()) as { number?: number };
    return ticket.number ?? null;
  } catch (e) {
    console.error(`ticket non cree pour le rapport #${id} :`, e instanceof Error ? e.message : e);
    return null;
  }
}
