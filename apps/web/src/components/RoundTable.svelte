<script lang="ts">
  // La table ronde de la taverne, vue légèrement de dessus : rebord de chêne sombre clouté de laiton, feutre
  // vert au centre éclairé par la lanterne, chant de la table visible en bas. Purement décoratif : la
  // géométrie vient de `seats.ts` (même ellipse que les sièges et les cartes).
  import type { TableLayout } from '../lib/seats';
  const tableStudy = import.meta.env.VITE_FLIBUSTE_TABLE_STUDY === 'true';

  let { layout }: { layout: TableLayout } = $props();

  /** Clous patinés espacés irrégulièrement ; géométrie stable entre rendus. */
  const studs = $derived.by(() => {
    const { rx, ry, rim } = layout;
    const r1 = rx - rim / 2;
    const r2 = ry - rim / 2;
    const n = Math.max(16, Math.round((Math.PI * (r1 + r2)) / 26));
    return Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * (i + (i % 3 - 1) * 0.13)) / n;
      return { x: rx + r1 * Math.cos(a), y: ry + r2 * Math.sin(a), radius: 1.9 + (i % 4) * 0.2 };
    }).filter((_, i) => i % 7 !== 3);
  });
</script>

<div class="round-table absolute" style:left="{layout.cx - layout.rx}px" style:top="{layout.cy - layout.ry}px" style:width="{layout.rx * 2}px" style:height="{layout.ry * 2}px" aria-hidden="true" data-testid="round-table">
  {#if tableStudy}
    <img class="absolute inset-0 h-full w-full" src="/ui/table-study-board.webp" alt="" data-testid="blender-table" />
  {:else}
  <div class="rim absolute inset-0 rounded-[50%]"></div>
  <svg class="absolute inset-0 h-full w-full" viewBox="0 0 {layout.rx * 2} {layout.ry * 2}" aria-hidden="true">
    <defs>
      <radialGradient id="stud" cx="40%" cy="35%" r="60%">
        <stop offset="0" stop-color="#fbe7a8" />
        <stop offset="0.45" stop-color="#d3a94a" />
        <stop offset="0.8" stop-color="#6a4a18" />
        <stop offset="1" stop-color="#2a1a08" />
      </radialGradient>
    </defs>
    {#each studs as s, i (i)}
      <circle cx={s.x} cy={s.y} r={s.radius} fill="url(#stud)" stroke="rgba(0,0,0,0.55)" stroke-width="0.6" />
    {/each}
  </svg>
  <div class="felt absolute rounded-[50%]" style:inset="{layout.rim}px"></div>
  {/if}
</div>

<style>
  .round-table {
    /* Chant de la table (on la voit de dessus, un peu de biais) et ombre portée sur le plancher. */
    filter: drop-shadow(0 22px 18px rgba(0, 0, 0, 0.7));
  }
  .rim {
    background:
      radial-gradient(ellipse at 50% 30%, rgba(255, 220, 160, 0.18), transparent 60%),
      linear-gradient(180deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.45)),
      var(--tex-wood) center / 300px repeat;
    border: 2px solid #150a03;
    box-shadow:
      inset 0 2px 0 rgba(255, 228, 175, 0.28),
      inset 0 0 0 4px rgba(0, 0, 0, 0.35),
      0 10px 0 -1px #3a2210,
      0 12px 0 -1px #170c04,
      0 20px 0 -4px #2a180a,
      0 22px 0 -4px #120903;
  }
  .felt {
    background:
      radial-gradient(ellipse at 50% 42%, rgba(120, 200, 140, 0.22), transparent 55%),
      radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0, 0, 0, 0.55) 100%),
      var(--tex-felt) center / 360px repeat;
    box-shadow:
      inset 0 0 0 2px #0b1f14,
      inset 0 0 0 3px rgba(214, 167, 74, 0.55),
      inset 0 6px 14px rgba(0, 0, 0, 0.7),
      inset 0 0 60px rgba(0, 0, 0, 0.45);
  }
</style>
