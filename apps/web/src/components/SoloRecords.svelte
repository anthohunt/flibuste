<script lang="ts">
  import { botDescription, conditionsLines, soloRecordGroups } from '../lib/solo-records';
  import { recoverFinishedSoloRecord } from '../lib/offline';
  recoverFinishedSoloRecord();
  const groups = soloRecordGroups();
</script>

<section class="panel-parchment flex flex-col gap-3" aria-labelledby="solo-records-title" data-testid="solo-records">
  <h2 id="solo-records-title" class="title text-2xl">Mes records solo</h2>
  <p class="text-sm">Conservés sur cet appareil, sans compte et sans connexion. Chaque record compare uniquement les mêmes règles, manches et adversaires.</p>
  {#if groups.length === 0}
    <p class="text-sm" data-testid="solo-empty">Termine une partie solo pour conserver ton premier record. Les anciennes parties sans conditions enregistrées ne sont pas ajoutées rétroactivement.</p>
  {:else}
    {#each groups as group (group.key)}
      <details class="record" data-testid="solo-record">
        <summary aria-label="{group.best.total} points, {group.best.conditions.rules.rounds} manche{group.best.conditions.rules.rounds > 1 ? 's' : ''}, {group.best.conditions.players} joueurs : voir les conditions">
          <span><strong>{group.best.total} points</strong> · {group.best.conditions.rules.rounds} manche{group.best.conditions.rules.rounds > 1 ? 's' : ''} · {group.best.conditions.players} joueurs</span>
          <span class="text-sm">{group.games} partie{group.games > 1 ? 's' : ''} · Voir les conditions</span>
        </summary>
        <p class="mt-2 text-sm">{group.best.name} · {group.best.recovered ? 'Récupéré le ' : ''}{new Date(group.best.at).toLocaleDateString('fr-FR')}</p>
        {#if group.best.recovered}<p class="mt-1 text-sm">Récupéré depuis la sauvegarde locale terminée. Sa date de jeu n’était pas enregistrée.</p>{/if}
        {#each conditionsLines(group.best.conditions) as line}<p class="mt-1 text-sm">{line}</p>{/each}
        {#if group.best.conditions.bots.some((b) => b && typeof b === 'object')}
          <details class="mt-2 text-sm"><summary>Profils exacts des adversaires</summary>{#each group.best.conditions.bots as bot, i}<p class="mt-1">Adversaire {i + 1} : {botDescription(bot)}</p>{/each}</details>
        {/if}
      </details>
    {/each}
  {/if}
</section>

<style>
  .record { border-top: 1px solid rgb(90 61 29 / .35); padding-top: .65rem; }
  summary { cursor: pointer; min-height: 44px; overflow-wrap: anywhere; }
  summary > span { display: block; }
  summary:focus-visible { outline: 2px solid #614414; outline-offset: 3px; }
</style>
