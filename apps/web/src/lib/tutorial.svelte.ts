import { closeCodex, closeSituation, playSituation } from './codex.svelte';
import { TUTORIAL, tutorialSucceeded } from './tutorial';
const KEY = 'flibuste.tutorial.classic.v1';
function read(): { next: number; complete: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (value && Number.isInteger(value.next)) return { next: Math.max(0, Math.min(TUTORIAL.length - 1, value.next)), complete: value.complete === true };
  } catch { /* progression indisponible : démarrer au début */ }
  return { next: 0, complete: false };
}
const saved = read();
export const tutorial = $state({ active: false, index: saved.next, next: saved.next, complete: saved.complete, passed: false, feedback: '' });
function remember() {
  try { localStorage.setItem(KEY, JSON.stringify({ next: tutorial.next, complete: tutorial.complete })); } catch { /* session seulement */ }
}
function launch() {
  const lesson = TUTORIAL[tutorial.index]!;
  tutorial.passed = false;
  tutorial.feedback = '';
  return playSituation(lesson.situation, done => {
    tutorial.passed = tutorialSucceeded(lesson, done);
    tutorial.feedback = tutorial.passed ? 'Objectif atteint.' : lesson.retry;
    if (tutorial.passed) {
      tutorial.complete = tutorial.index === TUTORIAL.length - 1;
      tutorial.next = Math.min(TUTORIAL.length - 1, tutorial.index + 1);
      remember();
    }
  });
}
export function startTutorial(restart = false) {
  if (restart || tutorial.complete) { tutorial.next = 0; tutorial.complete = false; remember(); }
  tutorial.index = tutorial.next;
  tutorial.active = true;
  if (!launch()) tutorial.active = false;
}
export function replayTutorial() { launch(); }
export function nextTutorial() {
  if (!tutorial.passed) return;
  if (tutorial.index === TUTORIAL.length - 1) { quitTutorial(); return; }
  tutorial.index++;
  launch();
}
export function quitTutorial() {
  tutorial.active = false;
  closeSituation(); // rétablit aussi la vraie partie si le Codex l’avait suspendue
  closeCodex();
}
