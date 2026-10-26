<script lang="ts">
 import { onDestroy } from 'svelte';
 import { selectMenu, type SelectOption } from '../lib/selectMenu.svelte';
 let {id, label, value, options, onchange, disabled=false, onblocked, testid, class:cls=''}:{id?:string;label:string;value:string;options:SelectOption[];onchange:(value:string)=>void;disabled?:boolean;onblocked?:()=>void;testid?:string;class?:string}=$props();
 const instance=`choice-${Math.random().toString(36).slice(2)}`;
 const owner=$derived(id??instance);
 const expanded=$derived(selectMenu.current?.owner===owner);
 function open(){
  if(disabled){onblocked?.();return;}
  selectMenu.current={owner,label,value,options,choose:next=>{selectMenu.current=null;onchange(next);}};
 }
 onDestroy(()=>{if(selectMenu.current?.owner===owner)selectMenu.current=null;});
</script>
<button type="button" id={id} class="input-parchment themed-select {cls}" aria-label={label} aria-haspopup="dialog" aria-expanded={expanded} aria-disabled={disabled || undefined} data-testid={testid} data-value={value} onclick={open} onkeydown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open();}}}>
 <span>{options.find(o=>o.value===value)?.label??value}</span><span class="arrow" aria-hidden="true">⌄</span>
</button>
<style>
.themed-select{display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;width:100%;min-height:44px;cursor:pointer}.themed-select>span:first-child{min-width:0}.arrow{flex-shrink:0;font-size:23px;line-height:1}.themed-select[aria-disabled=true]{opacity:.65}.themed-select:focus-visible{outline:3px solid #ebca79;outline-offset:3px}
</style>
