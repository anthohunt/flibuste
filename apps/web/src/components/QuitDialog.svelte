<script lang="ts">
  // « Quitter la table ? » — vraie feuille de confirmation (C8) : « Rester » par défaut, « Quitter » en bois teinté
  // de rhum ; Échap et tap extérieur = Rester. Même feuille pour le bouton Quitter et pour Précédent du navigateur.
  import Sheet, { fermetureMuette } from './Sheet.svelte';
  import Icon from './Icon.svelte';

  let {
    onstay,
    onquit,
    online = false,
    lobby = false,
    code = null,
  }: {
    onstay: () => void;
    onquit: () => void;
    /** Partie en ligne : le siège est joué par le serveur, on peut revenir avec le code. */
    online?: boolean;
    /** Depuis le salon (pas encore de partie). */
    lobby?: boolean;
    code?: string | null;
  } = $props();

  /**
   * Quitter est une action PRISE, et le catalogue n'en veut qu'un son : celui de la porte. Les trois appelants
   * jouent déjà `table-quittee` — la feuille se tait donc au lieu d'ajouter son `panneau-ferme` par-dessus.
   * C'est ici et pas chez eux : trois écrans auraient eu trois occasions de l'oublier, et `ShareSheet` fait
   * exactement le même geste pour le lien copié. Le silence ne vaut que pour ce tour (`Sheet.resoudre`).
   */
  function quitter() {
    fermetureMuette();
    onquit();
  }

  const text = $derived(
    lobby
      ? `Tu quittes la table${code ? ` ${code}` : ''}. Tu pourras y revenir avec son code.`
      : online
        ? `Le serveur jouera à ta place${code ? `, et tu pourras revenir avec le code ${code}` : ''}.`
        : 'Ta partie sera perdue.',
  );
</script>

<!-- `cancelDecides` : ici Échap et le tap hors feuille valent « Rester ». C'est un choix, pas un abandon — la
     feuille se referme, elle n'est pas laissée en plan, et le son doit dire cela. -->
<Sheet title="Quitter la table ?" oncancel={onstay} testid="quit-dialog" center cancelDecides>
  <p class="text-center text-[0.95rem] leading-snug">{text}</p>
  <div class="mt-1 grid grid-cols-2 gap-2">
    <button type="button" class="btn-tavern btn-tavern-center" onclick={onstay} data-autofocus data-testid="quit-stay" aria-label="Rester">
      <Icon name="check" size={18} />
      <span>Rester</span>
    </button>
    <!-- `data-clac="non"` : « Quitter » a sa propre voix (la porte de la taverne, jouée par l'appelant). Sans lui
         un seul appui sonnait TROIS fois — le clac de la surface, la porte, et la feuille qui se referme. -->
    <button type="button" class="btn-tavern btn-tavern-center btn-tavern-danger" onclick={quitter} data-testid="quit-confirm" aria-label="Quitter" data-clac="non">
      <Icon name="exit" size={18} />
      <span>Quitter</span>
    </button>
  </div>
</Sheet>
