<script lang="ts">
  // « Comment on joue ? » (D4) : les règles courtes — déroulé d'une manche, qui gagne le pli, les points.
  // Elle ne porte plus QUE ça.
  //
  // LE SON EST PARTI, en entier : les deux curseurs, le muet, l'essayage et les crédits vivent maintenant dans
  // `SettingsSheet`, qu'ouvre l'engrenage de l'en-tête permanent. Ils étaient ici parce que cette feuille était
  // la seule qu'on pouvait ouvrir depuis l'accueil ET depuis la table — donc la seule route vers le volume en
  // pleine partie. L'engrenage est maintenant sur TOUS les écrans, à un geste ; baisser la musique ne demande
  // plus de traverser le déroulé d'une manche, le tableau des points et les bonus. Et surtout : deux jeux de
  // curseurs pour le même volume, c'est deux endroits où chercher, et deux à corriger le jour où l'un ment.
  //
  // CE QUI RESTE, et pourquoi ce n'est pas le même cas :
  //  · le chip « Un bug ? Une idée ? » et le bouton « Codex des cartes » sont des PAGES QUI TOURNENT, pas des
  //    raccourcis. Une feuille ouverte couvre l'en-tête (voile modal) : depuis les règles, l'engrenage et ses
  //    voisins sont hors d'atteinte tant qu'on n'a pas refermé. Ces deux boutons sont la suite naturelle de ce
  //    qu'on vient de lire — « ça ne s'est pas passé comme ça » et « montre-moi les cartes » — et ils ne
  //    pilotent aucun état partagé : les doubler ne fait pas diverger deux affichages, contrairement au volume.
  //  · le report REMPLACE l'aide au lieu de s'empiler dessus — l'idiome de la maison (l'aide passe la main au
  //    codex de la même façon), et Sheet l'entend comme une page qui tourne, pas comme une feuille de plus.
  //
  // Le chip du report est EN TÊTE de la feuille, et c'est le point important : la feuille est un
  // `max-h-[85dvh] overflow-y-auto`, donc en pied il se trouvait à ~1 500 caractères de défilement — sous les
  // règles et même SOUS « Compris », le bouton qui ferme tout. Personne ne cherche un signalement sous le
  // bouton de sortie. En tête, il est à l'écran dès l'ouverture ; il reste discret (un chip aligné à droite,
  // pas une planche) pour ne pas passer devant les règles, qui sont ce que la feuille promet.
  import Sheet from './Sheet.svelte';
  import TutorialIntro from './TutorialIntro.svelte';
  import ReportSheet from './ReportSheet.svelte';
  import Icon from './Icon.svelte';
  import { openCodex } from '../lib/codex.svelte';

  let { oncancel }: { oncancel: () => void } = $props();

  /** L'aide a cédé la place au report. Refermer le report ramène l'aide ; l'envoyer ferme les deux. */
  let report = $state(false);

  function codexFromHelp() {
    oncancel();
    openCodex();
  }
</script>

{#if report}
  <ReportSheet oncancel={() => (report = false)} onsent={oncancel} />
{:else}
  <Sheet title="Comment on joue ?" {oncancel} testid="help-sheet" class="max-h-[85dvh] overflow-y-auto">
    <TutorialIntro onstart={oncancel} />
    <button type="button" class="chip-brass self-end !min-h-11 !px-3" data-testid="help-report" onclick={() => (report = true)}>
      <Icon name="pencil" size={14} />
      <span>Un bug ? Une idée ?</span>
    </button>

    <section class="quick-rules">
      <p class="goal">Le but : marquer le plus de points en prédisant exactement combien de plis tu vas gagner.</p>
      <h3>1. Parie</h3>
      <p>Manche 1 : une carte chacun ; manche 2 : deux cartes… Regarde ta main et annonce combien de plis tu penses remporter.</p>
      <h3>2. Joue tes cartes</h3>
      <p>Un <strong>pli</strong>, c’est un tour où chacun pose une carte. La carte la plus forte remporte ce pli. Suis la couleur demandée si tu l’as ; les cartes spéciales peuvent changer la donne.</p>
      <h3>3. Vise juste</h3>
      <p>Ton pari est exact ? <strong>+20 points par pli.</strong> Sinon, −10 points par pli d’écart. Par exemple : tu annonces 2 et tu gagnes 2 plis → +40 points.</p>
      <p>Le pari zéro est spécial : réussi, il rapporte 10 × le nombre de cartes distribuées ; raté, il coûte autant.</p>
    </section>
    <details class="rule-details">
      <summary>Hiérarchie des cartes et bonus <span aria-hidden="true">⌄</span></summary>
      <div class="rule-details-body">
        <p>Le plus haut numéro de la couleur demandée gagne. Le <strong>Pavillon (noir)</strong> bat les autres couleurs.</p>
        <p data-testid="help-suits">Les quatre couleurs : <strong>Albatros</strong> (vert), <strong>Doublon</strong> (jaune), <strong>Compas</strong> (violet) et <strong>Pavillon</strong> (noir), qui est l’atout.</p>
        <p>Une Fuite, un Butin ou une Tigresse en fuite en tête de pli laisse au joueur suivant le choix de la couleur à suivre.</p>
        <p><strong>Pirate</strong> bat les numéros ; <strong>Roi des Flibustiers</strong> bat les pirates ; <strong>Sirène</strong> bat le Roi des Flibustiers, mais perd contre un pirate. La Tigresse se joue en pirate ou en fuite.</p>
        <p>Bonus, si le pari est réussi : 14 de couleur +10, 14 noir +20, sirène prise par un pirate +20, pirate pris par le Roi des Flibustiers +30, Roi des Flibustiers pris par une sirène +40.</p>
        <p>Les règles particulières de chaque carte se consultent dans le codex.</p>
      </div>
    </details>

    <div class="mt-1 flex flex-wrap justify-center gap-2">
      <button type="button" class="btn-primary gap-2 !py-2" onclick={codexFromHelp} aria-label="Codex des cartes" data-testid="codex-help">
        <Icon name="cards" size={18} />
        <span>Codex des cartes</span>
      </button>
      <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={oncancel} data-autofocus>
        <Icon name="check" size={16} />
        <span>Compris</span>
      </button>
    </div>
  </Sheet>
{/if}

<style>
 .quick-rules{display:flex;flex-direction:column;gap:8px;font-size:16px;line-height:1.4;color:#39291d}.quick-rules h3{font-weight:700;font-size:18px;margin-top:5px}.goal{padding-bottom:10px;border-bottom:1px solid #88613840}.rule-details{border-top:1px solid #88613840;border-bottom:1px solid #88613840}.rule-details summary{min-height:48px;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;font-weight:600;list-style:none}.rule-details summary::-webkit-details-marker{display:none}.rule-details[open] summary span{transform:rotate(180deg)}.rule-details-body{display:grid;gap:10px;padding-bottom:14px;font-size:15px;line-height:1.4}
</style>
