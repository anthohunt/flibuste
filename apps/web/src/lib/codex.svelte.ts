// État global du codex (vague 6) : la carte zoomée (appui long partout), le menu Codex (liste des cartes, fiche
// d'une carte et ses situations), la situation en cours de jeu. Une situation branche un `ScenarioGame` sur le
// store en mode `scenario` (la table existante joue la scène) ; elle est refusée tant qu'une vraie partie occupe
// la table (un `attach` fermerait son transport).
import type { Card, PlayerId } from './types';
import { attach, detach, game, resumeOffline, showToast, tableBusy, timing } from './store.svelte';
import { reattachRoom } from './online.svelte';
import { ScenarioGame, describeRound, describeTrick, scenarioState, type ScenarioDone } from './scenario';
import { ME, SCENARIO_NAMES, nextSituation as nextOf, situationsFor, type Situation } from './situations';
import { codexIdFor } from './codex';

export interface SituationResult {
  /** Le commentaire calculé par le moteur (pli résolu ou scores de la manche). */
  comment: string[];
  /** La phrase pédagogique de la situation. */
  lesson: string;
}

interface CodexState {
  /** Carte en plein écran (appui long). */
  zoom: Card | null;
  /** Le menu Codex est ouvert. */
  open: boolean;
  /** Fiche affichée dans le menu (id du codex), null = la liste. */
  focus: string | null;
  /** Situation en cours de jeu. */
  situation: Situation | null;
  /** Résultat de la situation jouée (null tant qu'elle se joue). */
  result: SituationResult | null;
  /** Une vraie partie attend qu'on revienne (situation ouverte depuis la table). */
  suspended: boolean;
}

export const codex = $state<CodexState>({ zoom: null, open: false, focus: null, situation: null, result: null, suspended: false });

export function zoomCard(card: Card) {
  codex.zoom = card;
}
export function closeZoom() {
  codex.zoom = null;
}

/** Ouvre le menu Codex, sur la fiche `focus` (id du codex ou carte) si donnée. */
export function openCodex(focus?: string | Card | null) {
  codex.focus = focus ? (typeof focus === 'string' ? focus : codexIdFor(focus)) : null;
  codex.open = true;
  codex.zoom = null;
}
export function closeCodex() {
  codex.open = false;
  codex.focus = null;
}
export function showCodexCard(id: string | null) {
  codex.focus = id;
}

let current: ScenarioGame | null = null;
let doneTimer: ReturnType<typeof setTimeout> | null = null;
let afterScenario: ((done: ScenarioDone) => void) | undefined;

/** Noms à la table d'une situation : moi (mon pseudo), Anne, Bob. */
export function scenarioNames(): Record<PlayerId, string> {
  return { [ME]: game.identity.name?.trim() || 'Toi', ...SCENARIO_NAMES };
}

/** Une situation se joue toujours : une partie en cours est mise en pause et reprise à la fermeture. */
export function canPlaySituation(): boolean {
  return true;
}

/** La partie mise en pause par la situation en cours (`null` si la table était libre). */
let paused: 'offline' | 'online' | null = null;

/** Lance (ou relance) une situation : la scène est construite, la table branchée, les adversaires prêts. */
export function playSituation(sit: Situation, after?: (done: ScenarioDone) => void): boolean {
  // Une vraie partie occupe la table : on la met en pause (le solo est sauvegardé, la salle en ligne garde le siège)
  // et on la reprend à la fermeture de la situation.
  if (!paused && tableBusy()) {
    paused = game.mode === 'online' ? 'online' : 'offline';
    codex.suspended = true;
  }
  stopScenario();
  afterScenario = after;
  let state;
  try {
    state = scenarioState(sit.spec);
  } catch (e) {
    showToast(e instanceof Error && e.message ? e.message : 'Cette situation ne peut pas être construite', 'error');
    return false;
  }
  const names = scenarioNames();
  codex.situation = sit;
  codex.result = null;
  const g = new ScenarioGame(state, ME, {
    format: sit.format,
    script: sit.script ?? {},
    ondone: (d) => onDone(sit, d, names, after),
  });
  current = g;
  attach(g, 'scenario', { names, bots: Object.fromEntries(sit.spec.players.filter((p) => p !== ME).map((p) => [p, 'easy'])) });
  // La vue initiale : `attach` ne l'émet pas, le store la reçoit par `onView` ensuite.
  game.view = g.view();
  game.screen = 'table';
  return true;
}

function onDone(sit: Situation, d: ScenarioDone, names: Record<PlayerId, string>, after?: (done: ScenarioDone) => void) {
  const comment: string[] = [];
  if (sit.format === 'trick' && d.trick) comment.push(describeTrick(d.trick, names, d.state.rules));
  else {
    if (d.trick && sit.format === 'round' && d.scores.length === 0) comment.push(describeTrick(d.trick, names, d.state.rules));
    for (const s of d.scores) comment.push(describeRound(s, names));
  }
  // Le pli reste affiché le temps de la pause de fin de pli (le vol vers le gagnant se joue), puis le commentaire.
  const wait = timing.trickPause + 250;
  if (doneTimer) clearTimeout(doneTimer);
  doneTimer = setTimeout(() => {
    doneTimer = null;
    if (codex.situation?.id !== sit.id) return;
    codex.result = { comment, lesson: sit.lesson };
    after?.(d);
  }, wait);
}

function stopScenario() {
  if (doneTimer) clearTimeout(doneTimer);
  doneTimer = null;
  if (current) {
    current = null;
    if (game.mode === 'scenario') detach();
  }
  codex.result = null;
}

export function replaySituation(): boolean {
  const sit = codex.situation;
  return sit ? playSituation(sit, afterScenario) : false;
}

/** La situation suivante (même carte d'abord, puis la suivante du codex). */
export function nextSituation(): boolean {
  const sit = codex.situation;
  if (!sit) return false;
  const same = situationsFor(sit.card);
  const i = same.findIndex((s) => s.id === sit.id);
  const next = (i >= 0 && same[i + 1]) || nextOf(sit.id);
  return next ? playSituation(next) : false;
}

/** Ferme la situation : la table est débranchée, on reprend la partie en pause, sinon retour au menu Codex. */
export function closeSituation() {
  const sit = codex.situation;
  stopScenario();
  codex.situation = null;
  if (resumePaused()) return;
  if (sit) {
    codex.focus = sit.card;
    codex.open = true;
  }
}

/** Reprend la partie mise en pause par une situation. Renvoie `false` s'il n'y en avait pas. */
function resumePaused(): boolean {
  const mode = paused;
  paused = null;
  codex.suspended = false;
  if (!mode) return false;
  codex.open = false;
  codex.focus = null;
  const ok = mode === 'online' ? reattachRoom() : !!resumeOffline();
  if (!ok) showToast('Ta partie n’a pas pu être reprise');
  return true;
}

/** Une vraie partie a pris la table (le capitaine a lancé) : la situation s'efface sans bruit. */
export function dropSituationIfEvicted() {
  if (codex.situation && game.mode !== 'scenario') {
    current = null;
    paused = null;
    codex.suspended = false;
    codex.situation = null;
    codex.result = null;
    codex.open = false;
    if (doneTimer) clearTimeout(doneTimer);
    doneTimer = null;
  }
}
