<script lang="ts">
  import { onMount } from 'svelte';
  import { entry } from '../lib/entry.svelte';
  import { debloquer, prechargerMusique } from '../lib/audio.svelte';
  import Icon from './Icon.svelte';
  // Préparer la piste dès que cette page est montée ; aucun play() avant le clic.
  onMount(prechargerMusique);
  const CONTACT = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ?? '';
  function enter() {
    entry.accepted = true;
    // Keep playback inside the real click, before any await or route transition.
    debloquer();
  }
</script>

<section class="entry-notice" data-testid="entry-notice">
  <div class="notice-brand" aria-hidden="true">Flibuste <span>Online</span></div>
  <div class="notice-paper">
    <h1 tabindex="-1">Un jeu de plis libre</h1>
    <p>Flibuste est un jeu de cartes de plis à annonces, libre et gratuit (licence Apache 2.0). Les règles sont écrites pour ce projet ; les noms, les cartes et les images lui sont propres.</p>
    <p>Aucun lien avec un éditeur de jeu de société : toute ressemblance de mécanique relève de la famille des jeux de plis, qui n’est la propriété de personne.</p>
    {#if CONTACT}<p class="notice-contact">Contact : <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>{/if}
  </div>
  <button class="btn-tavern btn-tavern-center" data-testid="enter-tavern" onclick={enter}>
    <span>J’ai compris — entrer dans la taverne</span><Icon name="arrowRight" size={20}/>
  </button>
</section>

<style>
 .entry-notice{width:100%;max-width:510px;margin:auto;display:flex;flex-direction:column;gap:20px;padding:24px 0}
 .notice-brand{font-family:var(--font-display);font-size:clamp(40px,8vw,68px);line-height:1;text-align:center;color:#f3d68e;text-shadow:0 3px #512c13}.notice-brand span{display:block;font-family:var(--font-body);font-size:14px;letter-spacing:.35em;text-transform:uppercase;margin-top:12px}
 .notice-paper{background:#ead6ac var(--tex-parchment) center/cover;color:#39291d;border:1px solid #ae874b;border-radius:5px;padding:clamp(20px,5vw,32px);box-shadow:0 5px 0 #362111,0 15px 40px #0006;display:grid;gap:16px;font-size:17px;line-height:1.5}
 h1{font-size:24px;font-weight:700;line-height:1.2}.entry-notice>button{min-height:56px;font-size:20px;line-height:1.25}
 .notice-contact{font-size:.9em}.notice-contact a{display:inline-block;min-height:44px;align-content:center;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}.notice-contact a:focus-visible{outline:2px solid currentColor;outline-offset:3px}
 @media(max-height:500px) and (min-width:650px){.entry-notice{max-width:800px;display:grid;grid-template-columns:1fr 1.5fr;column-gap:28px;row-gap:12px;padding:6px 0;align-items:center}.notice-paper{grid-column:2;grid-row:1/4;font-size:15px;padding:20px;gap:12px}.notice-brand{font-size:44px}h1{font-size:21px}}
</style>
