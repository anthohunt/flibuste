<script lang="ts">
 import Sheet from './Sheet.svelte';
 import { selectMenu } from '../lib/selectMenu.svelte';
 const current=$derived(selectMenu.current);
 function keys(e:KeyboardEvent){
  const list=e.currentTarget as HTMLElement;
  const buttons=[...list.querySelectorAll<HTMLButtonElement>('[role=option]:not(:disabled)')];
  const at=buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next=-1;
  if(e.key==='ArrowDown')next=(at+1)%buttons.length;
  else if(e.key==='ArrowUp')next=at<0?buttons.length-1:(at-1+buttons.length)%buttons.length;
  else if(e.key==='Home')next=0;
  else if(e.key==='End')next=buttons.length-1;
  else if(e.key.length===1 && e.key!==' ')next=buttons.findIndex(b=>b.textContent?.trim().toLocaleLowerCase('fr').startsWith(e.key.toLocaleLowerCase('fr')));
  if(next>=0){e.preventDefault();buttons[next]?.focus();}
 }
</script>
{#if current}
 <Sheet title={current.label} oncancel={()=>selectMenu.current=null} testid="themed-select-menu" class="max-h-[85dvh] overflow-y-auto">
  <div class="choices" role="listbox" tabindex="0" aria-label={current.label} onkeydown={keys}>
   {#each current.options as option (option.value)}
    <button type="button" class="choice" role="option" aria-selected={option.value===current.value} disabled={option.disabled} data-value={option.value} data-autofocus={option.value===current.value || undefined} onclick={()=>current.choose(option.value)}>
     <span>{option.label}</span><span class="choice-mark" aria-hidden="true">{option.value===current.value?'✓':''}</span>
    </button>
   {/each}
  </div>
 </Sheet>
{/if}
<style>
.choices{display:flex;flex-direction:column;gap:5px;padding:1px 0 5px}.choice{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:10px 14px;background:#af794d18;border:1px solid #8b62394d;border-radius:3px 8px 2px 5px;text-align:left;font-size:19px;line-height:1.2;color:#382714}.choice:nth-child(2n){background:#77512713;border-radius:7px 2px 5px 3px}.choice[aria-selected=true]{background:#76502326;border-color:#725024;box-shadow:inset 3px 0 #745226;font-weight:700}.choice:hover{background:#76502333}.choice:focus-visible{outline:3px solid #7a5022;outline-offset:1px}.choice-mark{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;border:1px solid #825a38;flex-shrink:0;font-size:20px}
</style>
