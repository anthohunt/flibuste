<script lang="ts">
  import Sheet from './Sheet.svelte';
  import { RELEASE_NOTES, RELEASE_NOTES_VERSION } from '../lib/releaseNotes';
  let { oncancel }: { oncancel: () => void } = $props();
</script>

<Sheet title="Les nouveautés de la {RELEASE_NOTES_VERSION}" testid="release-notes" class="max-h-[88dvh] overflow-y-auto" {oncancel}>
  <ol class="release-list">
    {#each RELEASE_NOTES as note}
      <li>
        <h3>{note.title}</h3>
        <p>{note.description}</p>
      </li>
    {/each}
  </ol>
</Sheet>

<style>
  .release-list { margin: 0; padding: 0 0 0 1.5rem; color: #35230f; }
  li { padding: 0.75rem 0 0.9rem 0.25rem; border-bottom: 1px solid #76572640; }
  li:first-child { padding-top: 0; }
  li:last-child { border-bottom: 0; }
  li::marker { color: #63471f; font-weight: 700; }
  h3 { margin: 0 0 0.3rem; font-size: 1rem; line-height: 1.35; font-weight: 700; }
  p { margin: 0; font-size: 0.95rem; line-height: 1.5; }
</style>
