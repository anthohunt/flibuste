<script lang="ts">
  // Avatar rond : initiales sur un fond dérivé du nom, couronne (hôte), crânes (niveau du bot), point de connexion.
  import Icon from './Icon.svelte';
  import type { BotLevelTag } from '../lib/botProfile';
  import { avatarHue } from '../lib/theme';
  import { initialsOf } from '../lib/initials';

  let {
    name,
    size = 'md',
    host = false,
    botLevel = null,
    connected = null,
    me = false,
    active = false,
    dim = false,
    rank,
    ghost = false,
  }: {
    name: string;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    host?: boolean;
    /** Niveau du bot : 1 à 4 crânes ; `'custom'` (Perso) = une plume. */
    botLevel?: BotLevelTag | null;
    /** null : pas de point (hors-ligne / non pertinent). */
    connected?: boolean | null;
    me?: boolean;
    active?: boolean;
    dim?: boolean;
    /** Numéro affiché en médaillon (podium). */
    rank?: number;
    /** Vieux Loup : médaillon gris et fantôme à la place des initiales. */
    ghost?: boolean;
  } = $props();

  const PX = { xs: 24, sm: 36, md: 52, lg: 72 } as const;
  const px = $derived(PX[size]);
  const initials = $derived(initialsOf(name));
  const hue = $derived(avatarHue(name));
  const skulls = $derived(botLevel === 'easy' ? 1 : botLevel === 'normal' ? 2 : botLevel === 'hard' ? 3 : botLevel === 'ruthless' ? 4 : 0);
  const custom = $derived(botLevel === 'custom');
</script>

<span class="avatar relative inline-flex shrink-0 items-center justify-center" style:width="{px}px" style:height="{px}px" class:opacity-50={dim} data-avatar={name} data-ghost={ghost || undefined}>
  <span
    class="medal initials flex h-full w-full items-center justify-center rounded-full text-parchment"
    class:ring-2={me || active}
    class:ring-gold-300={me || active}
    class:animate-pulse-ring={active}
    style:background={ghost ? 'radial-gradient(circle at 32% 28%, #9a9a9a, #4a4a4a 70%, #262626)' : `radial-gradient(circle at 32% 28%, hsl(${hue} 42% 46%), hsl(${hue} 48% 24%) 70%, hsl(${hue} 50% 14%))`}
    style:font-size="{Math.round(px * 0.45)}px"
    aria-hidden="true"
  >
    {#if ghost}
      <Icon name="ghost" size={Math.round(px * 0.6)} class="text-parchment/90" />
    {:else}
      {initials}
    {/if}
  </span>
  {#if host}
    <span class="absolute -top-2 left-1/2 -translate-x-1/2 text-gold-400" title="Hôte"><Icon name="crown" size={Math.max(14, Math.round(px * 0.34))} label="Hôte" /></span>
  {/if}
  {#if rank}
    <span class="coin absolute -top-1 -left-1 !h-5 !min-w-5 !px-1 !text-[0.65rem]">{rank}</span>
  {/if}
  {#if skulls || custom}
    <span class="absolute -bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-px rounded-full border border-brass-600/60 bg-wood-950/95 px-1 py-0.5 text-gold-100" title="Bot" data-skulls={skulls || undefined} data-custom={custom || undefined}>
      {#if custom}
        <Icon name="pencil" size={px < 36 ? 7 : 9} />
      {:else}
        {#each Array(skulls) as _, i (i)}
          <Icon name="skull" size={px < 36 ? 7 : 9} />
        {/each}
      {/if}
    </span>
  {/if}
  {#if connected !== null}
    <span
      class="absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full ring-2 ring-wood-900"
      class:bg-emerald-400={connected}
      class:bg-zinc-500={!connected}
      role="img"
      aria-label={connected ? 'Connecté' : 'Déconnecté'}
    ></span>
  {/if}
</span>

<style>
  /* Vague 8 (#7, audit visuel #46) : les initiales étaient en blackletter — « BN » se lisait « BП », « CJ » « CI ».
     Sans-serif grasse, un peu plus grande (0,45 du diamètre au lieu de 0,38) et espacée. */
  .initials {
    font-family: var(--font-body);
    font-weight: 800;
    font-variant: normal;
    letter-spacing: 0.04em;
    line-height: 1;
  }
  /* Médaillon : cerclé de laiton, initiales gravées. */
  .medal {
    box-shadow:
      inset 0 0 0 2px #b5852f,
      inset 0 0 0 3px #3a2608,
      inset 0 -6px 10px rgba(0, 0, 0, 0.45),
      0 2px 4px rgba(0, 0, 0, 0.6);
    text-shadow:
      0 1px 0 rgba(0, 0, 0, 0.8),
      0 0 6px rgba(255, 200, 100, 0.25);
  }
  @keyframes pulse-ring {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(232, 191, 74, 0.55);
    }
    50% {
      box-shadow: 0 0 0 6px rgba(232, 191, 74, 0);
    }
  }
  .animate-pulse-ring {
    animation: pulse-ring 1.6s ease-out infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .animate-pulse-ring {
      animation: none;
    }
  }
</style>
