<script lang="ts">
 // Accueil : l'écran d'arrivée. Il ne sonne PAS de lui-même. La cascade d'enseigne qui le signait est partie
 // avec la refonte — plus de planche suspendue, plus de `--rise-delay` à suivre — et `enseigne-oscille` décrit
 // un balancement : le jouer ici ferait entendre un mouvement qui n'a plus lieu. Restent le clac de planche,
 // posé sur la surface (`use:clac`) plutôt que sur chaque bouton, et la reprise, qui a sa propre voix.
 //
 // CE QUI A QUITTÉ CET ÉCRAN, et ne doit pas y revenir : le bouton muet, qui flottait en haut à droite, et le
 // lien « Un bug ? Une idée ? », qui fermait la colonne tout en bas. Chacun était à SA place, différente de
 // celle qu'il avait ailleurs — et il disparaissait dès qu'on quittait la taverne. L'en-tête permanent
 // (`AppHeader`, monté par `App.svelte` au-dessus de tous les écrans) les porte maintenant tous les deux, au
 // même endroit partout ; les redessiner ici ferait deux portes pour un geste. L'accueil ne garde donc que ce
 // qu'on vient y faire : jouer, apprendre les bases, voir qui mène.
 import { navigate } from '../lib/router.svelte';
 import { hasResumableOffline, resumableOfflineSummary, resumeOffline, screenFor, showToast } from '../lib/store.svelte';
 import { resumeSavedRoom, savedRoomInfo } from '../lib/online.svelte';
 import { play } from '../lib/audio.svelte';
 import { clac } from '../components/Sheet.svelte';
 import HelpSheet from '../components/HelpSheet.svelte';
 import Icon from '../components/Icon.svelte';
 import HomeArtwork from '../components/HomeArtwork.svelte';
 let help=$state(false);
 const savedRoom=savedRoomInfo();
 const resumable=hasResumableOffline();
 const summary=resumableOfflineSummary();
 /**
  * La promesse tenue « ta partie n'est pas perdue » : on rouvre la porte sur une partie déjà commencée, sans
  * fanfare — ce n'est pas un départ. Si la reprise ne trouve rien (sauvegarde effacée, quota, autre onglet), le
  * geste a porté dans le vide, et c'est `geste-sans-effet` qui le dit — seul : le bouton porte `data-clac="non"`,
  * sans cette ligne appuyer ne ferait aucun bruit du tout, et le toast reste muet (on ne comble pas le vide deux fois).
  */
 function resume(){
  const partie=resumeOffline();
  // L'ÉCRAN SE DEMANDE À LA PHASE, il ne s'écrit pas en dur — c'est tout le correctif. Une sauvegarde prise en
  // fin de manche revient en phase `roundEnd`, dont l'unique geste (« Manche suivante », `data-testid="next-round"`)
  // ne vit que sur l'écran des scores. Y arriver par `table` déposait le joueur sur une table sans main, sans pari
  // et sans bouton : un écran figé. Et rien ne le rattrapait, pour deux raisons qui se cumulent — à `roundEnd`
  // aucun bot ne joue (`OfflineGame.tick` rend la main à l'humain), donc aucune vue nouvelle ne revient corriger
  // l'écran ; et la seule navigation automatique du store (`applyView`) est gardée par `GAME_ROUTES`, dont
  // l'accueil ne fait pas partie — au moment où l'on appuie ici, elle se tait. La porte EN LIGNE faisait déjà ce
  // calcul (`resumeSavedRoom`, online.svelte.ts) : les deux reprises se lisent désormais pareil.
  if(partie){play('partie-reprise');navigate(screenFor(partie.view().phase));}
  else{play('geste-sans-effet');showToast('Aucune partie à reprendre');}
 }
 /** La salle mémorisée et le solo mènent au même geste — rouvrir une porte : un seul son pour les deux. */
 function resumeRoom(code:string){play('partie-reprise');resumeSavedRoom(code);}
</script>
<section class="welcome" data-testid="home" use:clac>
 <header class="welcome-hero">
  <p class="overline"><span></span> À l’abordage, moussaillon ! <span></span></p>
  <h1 tabindex="-1">Flibuste <span class="online">Online</span></h1>
  <p class="fan-note">Jeu libre <span aria-hidden="true">·</span> Apache 2.0</p>
 </header>
 <div class="welcome-art"><HomeArtwork /></div>
 <div class="welcome-play">
  <p class="invitation">Du bluff, des plis.<br /><em>Et un brin de mutinerie.</em></p>
  {#if savedRoom || resumable}
   <div class="resume-links" data-testid="resume-note">
    {#if savedRoom}<button class="chip-brass" data-testid="resume-room" data-clac="non" onclick={()=>resumeRoom(savedRoom.code)}>Reprendre la salle {savedRoom.code}</button>{/if}
    {#if resumable}<button class="chip-brass" data-testid="resume-solo" data-clac="non" onclick={resume}>Reprendre le solo · manche {summary?.round ?? 1}</button>{/if}
   </div>
  {/if}
  <nav class="welcome-actions" aria-label="Jouer">
   <button class="play-ticket solo-ticket btn-tavern" onclick={()=>navigate('lobby',{mode:'solo'})} data-testid="solo">
    <span class="ticket-icon"><Icon name="swords" size={27}/></span>
    <span class="ticket-copy"><strong>Jouer en solo</strong><small>Défie l’équipage des bots</small></span>
    <Icon name="arrowRight" size={20}/>
   </button>
   <button class="play-ticket friends-ticket btn-tavern" onclick={()=>navigate('friends')} data-testid="friends">
    <span class="ticket-icon"><Icon name="mate" size={27}/></span>
    <span class="ticket-copy"><strong>Jouer avec des amis</strong><small>Invite ton équipage</small></span>
    <Icon name="arrowRight" size={20}/>
   </button>
  </nav>
 </div>
 <nav class="welcome-explore" aria-label="Découvrir le jeu">
  <button class="explore-link" onclick={()=>help=true} data-testid="help">
   <Icon name="cards" size={23}/><span><strong>Première escale ?</strong><small>Règles et tutoriel interactif</small></span><span class="explore-arrow" aria-hidden="true">↗</span>
  </button>
  <button class="explore-link" onclick={()=>navigate('classement')} data-testid="classement-open">
   <Icon name="crown" size={24}/><span><strong>Tableau d’honneur</strong><small>Les légendes de la taverne</small></span><span class="explore-arrow" aria-hidden="true">↗</span>
  </button>
 </nav>
 <div class="welcome-colophon" aria-hidden="true"><span></span><Icon name="skull" size={16}/><span></span></div>
</section>
{#if help}<HelpSheet oncancel={()=>help=false}/>{/if}
<style>

 .welcome{--home-cream:#f4e1b7;--home-gold:#dcb56a;position:relative;isolation:isolate;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);grid-template-areas:'hero art' 'play art' 'explore explore' 'colophon colophon';align-content:center;column-gap:46px;row-gap:24px;width:100%;max-width:1180px;flex:1;margin:0 auto;padding:28px 18px 8px}
 .welcome-hero{grid-area:hero;align-self:end;text-align:center}
 .overline{display:flex;align-items:center;justify-content:center;gap:12px;margin:0 0 18px;font-size:11px;font-weight:600;letter-spacing:.20em;text-transform:uppercase;color:var(--home-gold)}
 .overline span{width:25px;height:1px;background:linear-gradient(90deg,transparent,#c79b55)}.overline span:last-child{transform:rotate(180deg)}
 h1{margin:0;font-family:var(--font-display);font-weight:400;font-size:clamp(68px,7.6vw,104px);line-height:.96;letter-spacing:-.025em;color:#f3d68e;text-shadow:0 2px #8d5625,0 4px #24160f,0 10px 25px #0006}
 .online{display:flex;align-items:center;justify-content:center;gap:16px;font-family:var(--font-body,'Alegreya',serif);font-size:17px;font-weight:600;line-height:1.5;text-transform:uppercase;letter-spacing:.46em;margin-top:16px;padding-left:.46em;color:#eed4a2;text-shadow:0 1px 3px #000}
 .online::before,.online::after{content:'';width:38px;height:1px;background:#cba26080}
 .fan-note{font-size:13px;color:#d1c0a5;letter-spacing:.03em;margin:8px 0 0}.fan-note span{padding:0 6px;color:#dcb56a}
 .welcome-art{grid-area:art;align-self:center;width:100%;height:550px;position:relative}
 .welcome-art::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse,#c2924230,transparent 67%);filter:blur(20px)}
 .welcome-play{grid-area:play;align-self:start;width:100%;max-width:400px;margin:0 auto}
 .invitation{font-size:21px;line-height:1.45;text-align:center;color:#f0dfbf;margin:0 0 24px}.invitation em{font-weight:400;color:#cdbf9f}
 .welcome-actions{display:grid;gap:14px}
 .welcome-actions{position:relative;isolation:isolate}.welcome-actions::before{content:'';position:absolute;inset:-12px -14px;background:linear-gradient(90deg,#130b08e8,#2e1a0edc,#130b08e8),var(--tex-wood) center/500px;border:2px solid #6e4826;border-radius:18px;box-shadow:inset 0 2px 0 #b3834360,inset 0 -4px 0 #090503,0 12px 25px #0008;z-index:-1}
 .play-ticket{position:relative;display:grid;grid-template-columns:38px 1fr 20px;align-items:center;gap:15px;width:100%;min-height:78px;padding:12px 20px;text-align:left;border:2px solid #916231;border-radius:11px;color:#ffe1a2;box-shadow:inset 0 2px 1px #ffe0a15c,inset 0 -5px 2px #140902bb,inset 0 0 0 2px #2c170b,0 5px 0 #100803,0 8px 12px #0009;transition:transform 160ms,box-shadow 160ms,filter 160ms}
 .play-ticket::after{content:'';position:absolute;inset:6px;border:1px solid #cb9b4c65;pointer-events:none;border-radius:6px}
 .solo-ticket{background:linear-gradient(180deg,#b8803b45,#24130835 45%,#170b076b),var(--tex-wood) 12% 42%/1200px}
 .friends-ticket{background:linear-gradient(180deg,#a36c3045,#24130855 45%,#170b077b),var(--tex-wood) 12% 65%/1200px}
 .ticket-icon{display:flex;align-items:center;justify-content:center;width:38px;height:38px;padding:5px;border:2px solid #c79a4c;border-radius:50%;color:#f8d891;background:radial-gradient(ellipse at 35% 20%,#4a7469,#183c37 60%,#102724);box-shadow:inset 0 1px 2px #e1efbc55,0 2px 0 #140c07,0 0 0 2px #33200e}
 .ticket-copy{display:flex;flex-direction:column;gap:2px}.ticket-copy strong{font-family:var(--font-display);font-size:27px;font-weight:400;line-height:1.05}.ticket-copy small{font-family:var(--font-body);font-size:13px;color:#ebd4ae;letter-spacing:0;text-shadow:0 1px 2px #100804}
 .play-ticket:hover{transform:translateY(-2px);filter:brightness(1.16);border-color:#e6b666}.play-ticket:active{transform:translateY(2px);box-shadow:0 1px 0 #362516}
 .resume-links{display:grid;gap:7px;margin:0 0 14px}.resume-links button{font-size:14px}
 .welcome-explore{grid-area:explore;display:grid;grid-template-columns:1fr 1fr;gap:24px;width:100%;max-width:740px;margin:12px auto 0;padding-top:22px;border-top:1px solid #b68d4845}
 .explore-link{border:1px solid #76522d;background:linear-gradient(#54351c55,#1d100c88),var(--tex-wood) 12% 34%/1200px;box-shadow:inset 0 1px #e7bb6955,inset 0 -3px #140a07,0 3px 0 #0d0704;display:flex;align-items:center;gap:14px;color:#d2b77f;text-align:left;padding:8px 14px;min-height:60px;border-radius:4px;transition:background 150ms,color 150ms}.explore-link+ .explore-link{padding-left:14px}.explore-link>span:not(.explore-arrow){display:flex;flex:1;flex-direction:column;gap:2px}.explore-link strong{color:#efddbd;font-weight:500;font-size:18px}.explore-link small{font-size:13px;color:#bcb196}.explore-arrow{font-size:20px}.explore-link:hover{filter:brightness(1.15);color:#f5d79c}
 .welcome-colophon{grid-area:colophon;display:flex;justify-content:center;align-items:center;gap:12px;color:#ba9a62;opacity:.6}.welcome-colophon span{width:44px;height:1px;background:linear-gradient(90deg,transparent,#a0814b)}.welcome-colophon span:last-child{transform:rotate(180deg)}
 @media(min-width:760px){.welcome-hero{animation:paper-arrival 650ms both}.welcome-art{animation:paper-arrival 850ms 70ms both}.welcome-play{animation:paper-arrival 700ms 100ms both}}
 @keyframes paper-arrival{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
 @media(max-width:1050px) and (min-width:760px){.welcome{column-gap:20px;padding-inline:0}.welcome-art{height:420px}.ticket-copy strong{font-size:24px}.play-ticket{padding-inline:15px;gap:10px}}
 @media(max-width:759px){
  .welcome{max-width:420px;grid-template-columns:1fr;grid-template-areas:'hero' 'art' 'play' 'explore' 'colophon';gap:15px;padding:10px 4px 2px;align-content:center}
  .overline{font-size:9px;letter-spacing:.17em;gap:8px;margin-bottom:12px}.overline span{width:20px}
  h1{font-size:64px}.online{font-size:13px;margin-top:9px;gap:12px}.online::before,.online::after{width:25px}.fan-note{font-size:11px;margin-top:5px}
  .welcome-art{height:280px;width:100%;max-width:390px;justify-self:center;margin:-2px 0 2px}
  .welcome-play{max-width:360px}.invitation{font-size:16px;line-height:1.3;margin:0 0 15px}.invitation br{display:none}.invitation em{margin-left:4px}
  .welcome-actions{gap:12px}.play-ticket{min-height:66px;padding:10px 16px;gap:12px;grid-template-columns:35px 1fr 18px}.ticket-copy strong{font-size:25px}.ticket-copy small{font-size:12px}.ticket-icon{width:35px;height:35px;padding:5px}
  .welcome-explore{margin:3px auto 0;padding-top:10px;gap:8px}.explore-link{gap:8px;min-height:53px;padding:5px 5px}.explore-link+ .explore-link{padding-left:5px}.explore-link strong{font-size:14px}.explore-link small{font-size:10px}.explore-arrow{display:none}.welcome-explore :global(svg){width:19px;height:19px}.welcome-colophon{gap:9px;margin-top:-2px}
 }
 @media(max-width:759px) and (max-height:740px){.welcome{gap:12px;padding-top:3px}.welcome-art{height:170px;width:80%}h1{font-size:56px}.overline{margin-bottom:8px}.invitation{display:none}.welcome-colophon{display:none}.play-ticket{min-height:62px}.welcome-explore{margin-top:0}}
 @media(max-width:759px) and (max-height:610px){.welcome{gap:8px}.welcome-art{height:125px;width:82%}h1{font-size:48px}.overline{display:none}.online{margin-top:5px}.play-ticket{min-height:59px}.ticket-copy strong{font-size:23px}}
 @media(min-width:760px) and (max-height:650px){.welcome{padding-top:8px;row-gap:14px}.welcome-art{height:335px}h1{font-size:68px}.invitation{font-size:17px;margin-bottom:15px}.play-ticket{min-height:64px}.welcome-explore{padding-top:12px;margin-top:0}.welcome-colophon{display:none}}
 @media(min-width:760px) and (max-height:450px){.welcome{grid-template-areas:'hero art' 'play art' 'explore explore';padding-top:0;row-gap:10px;column-gap:35px}.welcome-art{height:230px}.overline{display:none}h1{font-size:48px}.online{font-size:12px;margin-top:4px}.fan-note{font-size:11px;margin-top:3px}.invitation{display:none}.play-ticket{min-height:57px;padding-block:7px}.ticket-copy strong{font-size:22px}.welcome-actions{gap:9px}.welcome-explore{max-width:650px;padding-top:7px}.explore-link{min-height:44px;padding-block:2px}.explore-link strong{font-size:15px}.explore-link small{font-size:11px}}
 @media(prefers-reduced-motion:reduce){.welcome-hero,.welcome-art,.welcome-play{animation:none}.play-ticket,.explore-link{transition:none}}
 :global(html[data-motion='reduce']) .welcome-hero,:global(html[data-motion='reduce']) .welcome-art,:global(html[data-motion='reduce']) .welcome-play{animation:none}
 :global(html[data-motion='reduce']) .play-ticket,:global(html[data-motion='reduce']) .explore-link{transition:none}
</style>
