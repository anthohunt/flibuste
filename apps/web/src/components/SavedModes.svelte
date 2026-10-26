<script lang="ts">
  import { onMount } from 'svelte';
  import ThemedSelect from './ThemedSelect.svelte';
  import { customDeckProblem, maxPlayersFor } from '@flibuste/engine';
  import { copyModeRules, deleteSavedMode, loadSavedModes, saveNamedMode, SAVED_MODES_KEY, type SavedMode } from '../lib/savedModes';
  import type { RulesV2 } from '../lib/rulesMeta';

  let { rules, seats = 3, onapply }: { rules: RulesV2; seats?: number; onapply: (rules: RulesV2) => void } = $props();
  let modes = $state<SavedMode[]>([]);
  let selectedId = $state('');
  let name = $state('');
  let message = $state('');
  let failed = $state(false);
  const selected = $derived(modes.find((mode) => mode.id === selectedId));

  function report(error: unknown) { failed = true; message = error instanceof Error ? error.message : 'Le stockage de cet appareil est indisponible.'; }
  function refresh() {
    try { modes = loadSavedModes(); if (selectedId && !modes.some((mode) => mode.id === selectedId)) selectedId = ''; }
    catch (error) { report(error); }
  }
  onMount(() => {
    refresh();
    const changed = (event: StorageEvent) => { if (event.key === SAVED_MODES_KEY || event.key === null) refresh(); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  });

  function choose(id: string) {
    selectedId = id;
    name = modes.find((mode) => mode.id === id)?.name ?? '';
    message = '';
  }
  function save(update: boolean) {
    try {
      const problem = customDeckProblem(rules, Math.max(2, seats));
      if (problem) throw new Error(problem);
      const saved = saveNamedMode(name, rules, update ? selectedId : undefined);
      refresh(); selectedId = saved.id; name = saved.name;
      failed = false; message = `« ${saved.name} » ${update ? 'mis à jour' : 'enregistré'} sur cet appareil.`;
    } catch (error) { report(error); }
  }
  function apply() {
    try {
      // Another tab may have updated it after this selector was opened.
      const current = loadSavedModes().find((mode) => mode.id === selectedId);
      if (!current) throw new Error('Ce mode a été supprimé.');
      const next = copyModeRules(current.rules);
      if (seats > maxPlayersFor(next)) throw new Error(`Ce mode accepte au plus ${maxPlayersFor(next)} joueurs. Ajuste d’abord la tablée.`);
      const problem = customDeckProblem(next, Math.max(2, seats));
      if (problem) throw new Error(problem);
      onapply(next);
      failed = false; message = ''; // In an online room the server still has to acknowledge these settings.
    } catch (error) { report(error); }
  }
  function remove() {
    try {
      deleteSavedMode(selectedId);
      selectedId = ''; name = ''; refresh();
      failed = false; message = 'Mode supprimé de cet appareil.';
    } catch (error) { report(error); }
  }
</script>

<section class="saved-modes" aria-label="Modes enregistrés" data-testid="saved-modes">
  <h3 class="panel-title !text-[0.95rem]">Mes modes de jeu</h3>
  <p class="hint">Règles, manches et cartes conservées sur cet appareil.</p>
  <label for="saved-mode-choice" class="hint !not-italic">Mode enregistré</label>
  <ThemedSelect id="saved-mode-choice" label="Mode enregistré" value={selectedId} options={[{ value: '', label: 'Nouveau mode' }, ...modes.map((mode) => ({ value: mode.id, label: mode.name }))]} onchange={choose} testid="saved-mode-select" />
  {#if selected}
    <div class="saved-actions">
      <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={apply} data-testid="apply-saved-mode">Appliquer ce mode</button>
      <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={remove} data-testid="delete-saved-mode">Supprimer</button>
    </div>
  {/if}
  <label for="saved-mode-name" class="hint !not-italic">Nom du mode</label>
  <input id="saved-mode-name" class="input-parchment" type="text" maxlength="40" placeholder="Ma partie du vendredi" bind:value={name} />
  <div class="saved-actions">
    <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={() => save(false)} disabled={!name.trim()} data-testid="save-new-mode">Enregistrer un nouveau mode</button>
    {#if selected}<button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={() => save(true)} disabled={!name.trim()} data-testid="update-saved-mode">Mettre à jour ce mode</button>{/if}
  </div>
  {#if message}<p role={failed ? 'alert' : 'status'} class="hint" class:storage-error={failed}>{message}</p>{/if}
</section>

<style>
  .saved-modes { display: flex; flex-direction: column; gap: .55rem; border-top: 1px solid #be995e77; padding-top: .8rem; margin-top: .4rem; }
  .saved-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
  .saved-actions button { flex: 1 1 150px; min-height: 44px; white-space: normal; }
  .storage-error { color: #ffdab6; }
</style>
