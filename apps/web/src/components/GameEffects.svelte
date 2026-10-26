<script lang="ts">
  // Les effets VISUELS du pli. Ils sonnaient aussi, du temps du petit système synthétisé ; ils ne sonnent plus,
  // et c'est volontaire : la table (`routes/Table.svelte`) sonne déjà chacun de ces événements, mais au bon
  // endroit et avec la bonne nuance — la carte d'un adversaire, le monstre encore en jeu, le Roi des Flibustiers ou la
  // Sirène distingués l'un de l'autre, le pli remporté, la donne. Sonner ici aurait fait deux sons par événement.
  import {untrack} from 'svelte';
  import type {TrickPlay} from '../lib/types';
  let {plays,winner,me}:{plays:TrickPlay[];winner:string|null;me:string}=$props();
  let visual=$state(''),serial=$state(0),last='',previousWinner:string|null=null;
  $effect(()=>{
    const p=plays.at(-1),id=p?.card.id??'';
    if(id&&id!==last){last=id;const k=p!.card.kind;const next=['storm','kraken','whale'].includes(k)?'storm':['mermaid','pirateking','tigress'].includes(k)?'magic':'card';untrack(()=>{visual=next;serial++})}
    if(!id)last='';
  });
  $effect(()=>{if(winner&&winner!==previousWinner&&winner===me)untrack(()=>{visual='win';serial++});previousWinner=winner});
</script>
{#key serial}<div class="game-vfx {visual}" aria-hidden="true"><span class="ripple"></span>{#if visual==='win'||visual==='magic'}{#each Array.from({length:12}) as _,i}<i style:--i={i}></i>{/each}{/if}</div>{/key}
<style>
.game-vfx{position:absolute;inset:12% 4%;pointer-events:none;z-index:5;overflow:hidden;border-radius:50%}.ripple{position:absolute;inset:32%;border:2px solid #e3bd6355;border-radius:50%;opacity:0}.card .ripple{animation:ripple .5s ease-out}.win .ripple,.magic .ripple{border-color:#ffe8a7;animation:ripple 1s ease-out}.storm{animation:storm 1.1s ease-out}.game-vfx i{position:absolute;left:50%;top:50%;width:4px;height:7px;border-radius:50%;background:#ffe6a0;box-shadow:0 0 10px #ffc84a;animation:spark 1s ease-out both;transform:rotate(calc(var(--i)*30deg))}.magic i{background:#8df3ee;box-shadow:0 0 10px #51c8dc}@keyframes ripple{0%{transform:scale(.25);opacity:.65}100%{transform:scale(3);opacity:0}}@keyframes spark{0%{transform:rotate(calc(var(--i)*30deg)) translateY(0);opacity:0}15%{opacity:.8}100%{transform:rotate(calc(var(--i)*30deg)) translateY(-140px);opacity:0}}@keyframes storm{0%{background:transparent}25%{background:#91c7de22;box-shadow:inset 0 0 65px #77c5ee66}100%{background:transparent}}@media(prefers-reduced-motion:reduce){.game-vfx{display:none}}
</style>
