<script lang="ts">
  // Le bouton muet d'un seul geste, gardé de la refonte de l'accueil — même dessin, même place, même CSS.
  // Il pilotait un petit système de sons synthétisés (`lib/sound.svelte.ts`, supprimé au profit du moteur
  // et de ses 207 sons réels) ; il pilote maintenant ce moteur-là, et il coupe VRAIMENT tout, musique comprise.
  //
  // Il double les trois curseurs de la feuille d'aide, et c'est voulu : couper le son en pleine partie ne doit
  // pas demander d'ouvrir un panneau — c'est le geste qu'on fait quand quelqu'un entre dans la pièce.
  //
  // `data-clac="non"` parce qu'il a sa propre voix : le clac de planche par-dessus un bouton qui coupe le son
  // ferait entendre exactement ce qu'on vient de faire taire.
  import { audio, setReglage } from '../lib/audio.svelte';

  let { compact = false }: { compact?: boolean } = $props();
  const actif = $derived(!audio.settings.muet);
</script>

<button type="button" class="sound-toggle" class:compact data-clac="non" data-testid="sound-toggle" aria-label={actif ? 'Couper le son' : 'Activer le son'} aria-pressed={actif} onclick={() => setReglage('muet', actif)} title={actif ? 'Couper le son' : 'Activer le son'}>
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 9h4l5-4v14l-5-4H3z"/>{#if actif}<path d="M16 8q4 4 0 8M19 5q7 7 0 14"/>{:else}<path d="m16 9 6 6m0-6-6 6"/>{/if}</svg>
  {#if !compact}<span>Son : {actif ? 'activé' : 'coupé'}</span>{/if}
</button>
<style>.sound-toggle{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:8px 12px;border:1px solid #997447;border-radius:9px;background:#28180f;color:#f5d99f;font:14px var(--font-body);cursor:pointer}.compact{width:44px;min-width:44px;padding:0}.sound-toggle:focus-visible{outline:3px solid #ffe098;outline-offset:2px}</style>
