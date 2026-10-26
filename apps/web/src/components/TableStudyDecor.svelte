<script lang="ts">
 import {onMount} from 'svelte';
 let box = $state({x:0,y:0,w:0,h:0});
 onMount(()=>{
  let board:Element|null=null;
  let frame=0;
  const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   const r=board?.getBoundingClientRect();
   if(r)box={x:r.left,y:r.top,w:r.width,h:r.height};
  });};
  const sizes=new ResizeObserver(update);
  const attach=()=>{
   const next=document.querySelector('[data-testid="round-table"]');
   if(next===board)return;
   sizes.disconnect();board=next;
   if(board){sizes.observe(board);if(board.parentElement)sizes.observe(board.parentElement);update();}
  };
  const tree=new MutationObserver(attach);
  tree.observe(document.querySelector('main')??document.body,{childList:true,subtree:true});
  window.addEventListener('resize',update);attach();
  return()=>{tree.disconnect();sizes.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',update);};
 });
</script>
<!-- Decorative layers follow the real board after its responsive transform. -->
<div class="study-decor" aria-hidden="true" data-testid="table-study-decor">
 <div class="corners" style:left="{box.x}px" style:top="{box.y}px" style:width="{box.w}px" style:height="{box.h}px" style:opacity={box.w?1:0}>
  <img class="props treasure" src="/ui/table-study-treasure.webp" alt="" />
  <img class="props corner-lantern" src="/ui/table-study-lantern.webp" alt="" />
  <img class="props rigging" src="/ui/table-study-rigging.webp" alt="" />
  <img class="props navigation" src="/ui/table-study-navigation.webp" alt="" />
 </div>
</div>
<style>
 .study-decor{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;background:radial-gradient(ellipse at 67% 31%,#ef8a293d,transparent 47%),radial-gradient(ellipse at 50% 44%,#21180a22,#100907cc 90%)}
 .corners{position:absolute}
 .props{position:absolute;width:57%;height:auto;filter:drop-shadow(0 10px 12px #000b)}
 .treasure{left:-35%;top:-19%;transform:rotate(-12deg)}
 .corner-lantern{right:-33%;top:-15%;transform:rotate(9deg)}
 .rigging{left:-36%;bottom:-23%;transform:rotate(8deg)}
 .navigation{right:-35%;bottom:-25%;transform:rotate(-10deg)}
 @media(max-width:700px) and (min-height:521px){
  .props{width:46%}
  .treasure{left:-9%;top:-13%}.corner-lantern{right:-9%;top:-11%}
  .rigging{left:-10%;bottom:-12%}.navigation{right:-10%;bottom:-13%}
 }
 @media(max-height:520px){
  .props{width:53%}
  .treasure{left:-44%;top:0%}.corner-lantern{right:-44%;top:0%}
  .rigging{left:-44%;bottom:-7%}.navigation{right:-44%;bottom:-7%}
  :global(body:has(.study-decor) .confirm-card-bar){background:linear-gradient(0deg,#1a0f08ef,#1a0f08a0 80%,transparent);border-radius:8px}
  :global(body:has(.study-decor) .verdict){text-shadow:0 1px 3px #000,0 0 4px #000}
 }
</style>
