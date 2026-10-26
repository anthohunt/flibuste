<script lang="ts">
 import { onMount } from 'svelte';
 import { navigate } from '../lib/router.svelte';
 import { game,setMyName } from '../lib/store.svelte';
 import { clearOnlineError,createRoom,joinRoom,online } from '../lib/online.svelte';
 import { ROOM_CODE_LENGTH,ROOM_CODE_RE } from '../lib/protocol';
 import Icon from '../components/Icon.svelte';
 import { clac } from '../components/Sheet.svelte';
 let name=$state(game.identity.name),code=$state(''),nameError=$state(''),lettersHint=$state(false);
 let action=$state<'join'|'create'|null>(null);
 let offline=$state(!navigator.onLine);
 const pending=$derived(!!online.pending);
 onMount(()=>{clearOnlineError();const on=()=>offline=false,off=()=>offline=true;window.addEventListener('online',on);window.addEventListener('offline',off);return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off)}});
 function commit(){if(name.trim().length<2){nameError='Choisis un nom de pirate de 2 caractères au moins.';return false;}nameError='';setMyName(name);return true;}
 function join(){if(pending||offline||!commit())return;if(!ROOM_CODE_RE.test(code)){lettersHint=true;return;}action='join';clearOnlineError();joinRoom(code);}
 function create(){if(pending||offline||!commit())return;action='create';clearOnlineError();createRoom();}
 function input(e:Event){const el=e.currentTarget as HTMLInputElement;const raw=el.value.replace(/\s+/g,'');code=raw.replace(/[^a-z]/gi,'').toUpperCase().slice(0,ROOM_CODE_LENGTH);el.value=code;lettersHint=/[^a-z]/i.test(raw);clearOnlineError();}
</script>
<!-- `use:clac` : « Créer une salle » et « Rejoindre » viennent de l'accueil, où ils sonnaient sous SA surface.
     En devenant un écran à part ils ont laissé le clac de planche derrière eux, et l'appui n'était plus dit par
     rien. La surface est reposée ici, comme sur tous les autres écrans hors table : un geste, un son. Le clac
     se tait tout seul sur un bouton éteint (hors connexion, connexion en cours), et aucun bouton d'ici n'a de
     voix propre à doubler. -->
<section class="friends flex flex-1 flex-col gap-6" data-testid="friends-screen" use:clac>
 <header class="flex items-center gap-3"><button class="icon-btn" onclick={()=>navigate('home')} aria-label="Retour à la taverne"><Icon name="home" size={20}/></button><h1 class="title text-3xl" tabindex="-1">Retrouve ta table</h1></header>
 <label class="flex flex-col gap-2">Nom de pirate<input class="input-parchment" aria-label="Nom de pirate" autocomplete="nickname" maxlength="20" placeholder="Alix le Joyeux" bind:value={name} oninput={()=>{nameError='';if(name.trim().length>=2)setMyName(name)}} aria-invalid={!!nameError}/></label>
 {#if nameError}<p role="alert" class="text-ember-300" data-testid="name-error">{nameError}</p>{/if}
 <form class="panel-wood flex flex-col gap-4" data-testid="join-form" onsubmit={(e)=>{e.preventDefault();join()}}>
  <label class="flex flex-col gap-3">Code d’embarquement<input class="input-parchment invite-code" aria-label="Code d’embarquement" placeholder="ABCDEF" value={code} oninput={input} maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false"/></label>
  <p class="hint">Le code de salle à six lettres partagé par le capitaine.</p>
  {#if lettersHint}<p role="status" data-testid="join-letters">Lettres uniquement — un code fait 6 lettres.</p>{/if}
  <button class="btn-tavern btn-tavern-center" type="submit" disabled={pending||offline} data-testid="join-submit">{online.pending==='join'?'Connexion…':'Rejoindre la salle'}</button>
 </form>
 {#if online.lastError}<p role="alert" class="panel-parchment" data-testid={action==='join'?'join-error':'create-error'} data-code={online.lastError.code}>{online.lastError.msg}</p>{/if}
 {#if offline}<p role="status">Hors connexion — le solo reste disponible.</p>{/if}
 <div class="host-option flex flex-col gap-4"><h2 class="title text-2xl">Tu organises la partie ?</h2><p class="hint">Crée une salle, puis partage son invitation.</p><button class="btn-tavern btn-tavern-lg btn-tavern-center" onclick={create} disabled={pending||offline} data-testid="create">{online.pending==='create'?'Création…':'Créer une salle'}</button></div>
</section>
<style>.friends{padding-top:8px}.invite-code{text-align:center;font-size:28px;letter-spacing:6px;width:100%;min-width:0}.host-option{border-top:1px solid #a5783c66;padding-top:24px;margin-top:8px}</style>
