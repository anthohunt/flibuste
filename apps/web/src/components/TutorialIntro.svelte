<script lang="ts">
  import { tutorial, startTutorial } from '../lib/tutorial.svelte';
  import { TUTORIAL } from '../lib/tutorial';
  let { onstart }: { onstart: () => void } = $props();
  function begin(restart = false) { onstart(); startTutorial(restart); }
</script>
<section class="tutorial-intro" data-testid="tutorial-intro" aria-label="Tutoriel classique">
  <h3>Tutoriel classique</h3>
  <p>Apprends en jouant : annonce ton pari, pose les cartes et regarde le résultat. {TUTORIAL.length} étapes, à ton rythme.</p>
  <p>Le jeu classique, sans les pouvoirs avancés des pirates. Tu retrouveras ces pouvoirs dans le Codex.</p>
  {#if tutorial.complete}<p>Parcours terminé. Tu peux le refaire.</p>
  {:else if tutorial.next > 0}<p data-testid="tutorial-progress">Reprendre à l’étape {tutorial.next + 1} sur {TUTORIAL.length}. La progression reste sur cet appareil.</p>{/if}
  <div class="actions">
    <button type="button" class="btn-tavern btn-tavern-sm" data-testid="tutorial-start" onclick={() => begin()}>{tutorial.complete ? 'Refaire le tutoriel' : tutorial.next > 0 ? 'Reprendre le tutoriel' : 'Jouer le tutoriel'}</button>
    {#if tutorial.next > 0 && !tutorial.complete}<button type="button" class="chip-brass" data-testid="tutorial-restart" onclick={() => begin(true)}>Recommencer</button>{/if}
  </div>
</section>
<style>
 .tutorial-intro{display:grid;gap:8px;padding:14px;border:1px solid #8d713e;border-radius:6px;background:#d9bb7e2b}.tutorial-intro h3{font-weight:700;font-size:1.1rem}.tutorial-intro p{font-size:.95rem;line-height:1.4}.actions{display:flex;flex-wrap:wrap;gap:8px}.actions button{min-height:44px}
</style>
