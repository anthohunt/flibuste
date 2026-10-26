<script lang="ts">
  // Confirmation générique sur `Sheet` (#4 « Retirer Bob de la table ? ») : « Annuler » par défaut, l'action en bois
  // teinté de rhum quand elle est destructive ; Échap, tap extérieur et Précédent annulent.
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from '../lib/icons';

  let {
    title,
    text,
    confirm,
    cancel = 'Annuler',
    icon = 'check',
    danger = false,
    testid = 'confirm-dialog',
    onconfirm,
    oncancel,
  }: {
    title: string;
    text?: string;
    /** Libellé du bouton d'action. */
    confirm: string;
    cancel?: string;
    icon?: IconName;
    danger?: boolean;
    testid?: string;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();
</script>

<Sheet {title} {oncancel} {testid} center>
  {#if text}
    <p class="text-center text-[0.95rem] leading-snug">{text}</p>
  {/if}
  <div class="mt-1 grid grid-cols-2 gap-2">
    <button type="button" class="btn-tavern btn-tavern-center" onclick={oncancel} data-autofocus data-testid="{testid}-cancel" aria-label={cancel}>
      <Icon name="close" size={18} />
      <span>{cancel}</span>
    </button>
    <button type="button" class="btn-tavern btn-tavern-center" class:btn-tavern-danger={danger} onclick={onconfirm} data-testid="{testid}-confirm" aria-label={confirm}>
      <Icon name={icon} size={18} />
      <span>{confirm}</span>
    </button>
  </div>
</Sheet>
