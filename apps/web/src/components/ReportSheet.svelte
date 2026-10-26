<script lang="ts">
  // « Une remarque ? » — la plus petite feuille de l'app : un nom déjà rempli, un texte, une capture.
  // envoyer. Rien d'autre. C'est un mot qu'on griffonne au bord de la table pendant une partie, pas un
  // formulaire de support — et tout ce qu'on y ajouterait se paierait en gens qui renoncent avant la fin.
  //
  // Ce qui a demandé de la place, c'est l'ÉCHEC. Un rapport écrit puis avalé parce que le Wi-Fi de la salle a
  // hoqueté, c'est un bug dont on n'entendra jamais parler, et un ami qui ne réessaiera pas. D'où : la feuille
  // ne se ferme PAS sur un échec, elle dit ce qui s'est passé, le texte reste à l'écran — et `report.ts` en
  // range une copie, relue à la prochaine ouverture même si l'onglet a été fermé entre-temps.
  import { tick } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { play } from '../lib/audio.svelte';
  import { alert as liveAlert } from '../lib/live.svelte';
  import { game, showToast } from '../lib/store.svelte';
  import { NOM_MAX, TEXTE_MAX, envoyerRapport, lireBrouillon, type GenreRapport } from '../lib/report';
  import { preparerImage, type ImagePrete } from '../lib/image';

  let {
    oncancel,
    onsent,
  }: {
    oncancel: () => void;
    /** Envoyé pour de bon (défaut : `oncancel`). Sert à la feuille d'aide, qui ne se rouvre pas derrière un rapport parti. */
    onsent?: () => void;
  } = $props();


  /** Un envoi précédent a raté : on repart de son texte plutôt que d'une page blanche. */
  const brouillon = lireBrouillon();

  // Le pseudo est déjà connu : personne ne retape son nom pour signaler un bug. Le modifier ici ne renomme
  // PAS le joueur (aucun `setMyName`) — c'est une signature sur un mot, pas un changement d'identité.
  let nom = $state(brouillon?.nom || game.identity.name || '');
  let texte = $state(brouillon?.texte ?? '');
  // Plus de choix a faire : tout est une remarque. Le champ reste dans le brouillon et dans
  // l'envoi, pour que rien ne casse cote serveur ni dans les rapports deja enregistres.
  const genre: GenreRapport = 'remarque';
  let envoi = $state(false);
  let boutonEnvoi = $state<HTMLButtonElement | null>(null);

  /**
   * LA CAPTURE D'ÉCRAN. Demande d'Alix : « faut pouvoir ajouter une image, notamment un screenshot pour
   * décrire le comportement anormal ». C'est le seul moyen, pour quelqu'un qui n'écrit pas de code, de montrer
   * un affichage cassé — trois mots et une image valent mieux que dix lignes de description approximative.
   *
   * Elle n'est PAS gardée dans le brouillon d'un envoi raté (voir `garderBrouillon`, report.ts) : elle
   * mangerait le quota de stockage que la partie solo utilise. Sur un échec la feuille reste ouverte, donc
   * l'image reste là ; elle n'est perdue que si l'onglet se ferme, et il faut alors la rattacher.
   */
  let image = $state<ImagePrete | null>(null);
  /** Le temps de la réduction : sur une capture de 4 000 px, l'encodage prend une seconde bien réelle. */
  let prepare = $state(false);
  let champFichier = $state<HTMLInputElement | null>(null);

  /** Poids lisible — c'est le seul chiffre qui parle à quelqu'un sur un réseau faible. */
  const poids = $derived(image ? `${Math.round(image.octets / 1024)} Ko` : '');

  async function choisirImage(e: Event) {
    const cible = e.currentTarget as HTMLInputElement;
    const fichier = cible.files?.[0];
    // Le champ est remis à zéro TOUT DE SUITE : sans cela, rechoisir le même fichier après l'avoir retiré ne
    // déclenche aucun `change` (le navigateur voit la même valeur) et le bouton paraît cassé.
    cible.value = '';
    if (!fichier) return;
    prepare = true;
    note = null;
    const r = await preparerImage(fichier);
    prepare = false;
    if (!r.ok) {
      play('geste-sans-effet');
      note = { texte: r.message, rassure: false };
      liveAlert(r.message, `report-image:${Date.now()}`);
      return;
    }
    image = r.image;
    play('panneau-ouvre');
  }

  function retirerImage() {
    image = null;
    play('panneau-ferme');
    champFichier?.focus();
  }

  /** Pourquoi le texte est encore là. `rassure` : ajoute la seule phrase qui compte après un échec. */
  let note = $state<{ texte: string; rassure: boolean } | null>(
    brouillon ? { texte: 'Ton dernier envoi n’était pas passé.', rassure: true } : null,
  );

  const pret = $derived(nom.trim().length > 0 && texte.trim().length > 0 && !envoi && !prepare);
  /**
   * Le décompte n'apparaît qu'à l'approche du mur. Un compteur permanent transforme un mot lâché en devoir
   * noté ; sans lui, en revanche, la frappe s'arrête net à 2 000 sans que rien ne l'explique.
   */
  const reste = $derived(TEXTE_MAX - texte.length);

  async function envoyer() {
    if (!pret) return;
    envoi = true;
    note = null;
    const verdict = await envoyerRapport({ nom, texte, genre, ...(image ? { image: image.dataUrl } : {}) });
    envoi = false;
    if (verdict.ok) {
      showToast('Merci — c’est bien arrivé');
      (onsent ?? oncancel)();
      return;
    }
    // Le geste est parti dans le vide, et c'est ce vide qu'on entend — jamais un son de confirmation, qui
    // ferait croire à l'envoi. Le bouton porte `data-clac="non"` : sans cette ligne, l'échec serait muet.
    play('geste-sans-effet');
    note = { texte: verdict.message, rassure: true };
    // La note écrite ne porte PAS de `role="status"` : une région live montée en même temps que son texte
    // n'est pas lue de façon fiable. On passe par celle de l'app, qui existe déjà et en permanence
    // (`LiveRegion`, App.svelte). La clé horodatée laisse passer deux échecs identiques d'affilée.
    liveAlert(verdict.message, `report:${Date.now()}`);
    // Le bouton était `disabled` pendant l'envoi : le focus est retombé sur le `body`, hors de la feuille.
    // On le lui rend une fois le DOM à jour, sinon la tabulation suivante repart du premier champ.
    await tick();
    boutonEnvoi?.focus();
  }
</script>

<Sheet title="Une remarque ?" {oncancel} testid="report-sheet" class="max-h-[85dvh] overflow-y-auto">
  <p class="hint -mt-2 text-center">Un bug, une idée, un détail qui gêne — tout se dit ici. Deux lignes suffisent&nbsp;: c’est lu, et ça sert.</p>

  <div class="flex flex-col gap-1">
    <label class="hint !not-italic !text-[0.75rem]" for="report-nom">Ton nom</label>
    <input
      id="report-nom"
      class="input-parchment"
      type="text"
      maxlength={NOM_MAX}
      placeholder="Capitaine…"
      autocomplete="nickname"
      bind:value={nom}
      data-testid="report-nom"
    />
  </div>

  <div class="flex flex-col gap-1">
    <div class="flex items-baseline justify-between gap-2">
      <label class="hint !not-italic !text-[0.75rem]" for="report-texte">Ce que tu as remarqué</label>
      {#if reste <= 200}<span class="hint !text-[0.7rem]" data-testid="report-reste">{reste} caractères</span>{/if}
    </div>
    <textarea
      id="report-texte"
      class="input-parchment min-h-28 resize-y"
      rows="4"
      maxlength={TEXTE_MAX}
      placeholder="Ce qui a cloché, ce qui te manque, ce qui t’a gêné…"
      bind:value={texte}
      data-autofocus
      data-testid="report-texte"
    ></textarea>
  </div>

  <!-- LA CAPTURE : un champ de fichier natif, habillé. Natif parce que c'est lui, et lui seul, qui ouvre
       l'appareil photo et la galerie sur un téléphone — `capture` n'est PAS posé à dessein : forcer l'appareil
       photo empêcherait de joindre une capture d'écran, qui est justement le cas qu'Alix a demandé. -->
  <div class="flex flex-col gap-1">
    <span class="hint !not-italic !text-[0.75rem]">Une capture d’écran (facultatif)</span>
    <input
      bind:this={champFichier}
      id="report-image"
      class="sr-only"
      type="file"
      accept="image/*"
      onchange={choisirImage}
      data-testid="report-image-champ"
    />
    {#if image}
      <div class="report-image" data-testid="report-image-apercu">
        <img src={image.dataUrl} alt="Aperçu de la capture jointe" />
        <div class="flex items-center justify-between gap-2">
          <span class="hint !text-[0.7rem]" data-testid="report-image-poids">{image.largeur}×{image.hauteur} · {poids}</span>
          <button type="button" class="chip-brass !min-h-9" onclick={retirerImage} data-clac="non" data-testid="report-image-retirer">
            <Icon name="trash" size={13} />
            <span>Retirer</span>
          </button>
        </div>
      </div>
    {:else}
      <label class="chip-brass !min-h-11 !justify-center cursor-pointer" for="report-image" data-testid="report-image-ajouter">
        <Icon name="image" size={14} />
        <span>{prepare ? 'Préparation…' : 'Ajouter une image'}</span>
      </label>
    {/if}
  </div>

  {#if note}
    <div class="report-note" data-testid="report-note">
      <p class="font-bold">{note.texte}</p>
      {#if note.rassure}<p class="hint !text-[0.8rem]">Ton texte reste ici, rien n’est perdu.</p>{/if}
    </div>
  {/if}

  <button
    type="button"
    class="btn-primary gap-2 !py-2"
    bind:this={boutonEnvoi}
    onclick={envoyer}
    disabled={!pret}
    data-clac="non"
    data-testid="report-envoyer"
  >
    <Icon name="check" size={18} />
    <span>{envoi ? 'Envoi…' : 'Envoyer'}</span>
  </button>
  <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center mx-auto" onclick={oncancel} aria-label="Fermer">
    <Icon name="close" size={16} />
    <span>Fermer</span>
  </button>
</Sheet>

<style>
  /* Assez visible pour arrêter l'œil qui vient de cliquer « Envoyer », assez sobre pour ne pas hurler : ce
     n'est pas une faute du joueur, c'est le réseau. */
  .report-note {
    border-left: 3px solid var(--color-rum-500, #b4442e);
    padding: 0.25rem 0 0.25rem 0.6rem;
    line-height: 1.3;
  }
  /* L'aperçu est BORNÉ EN HAUTEUR : une capture de téléphone est deux fois plus haute que large, et à pleine
     largeur elle repousserait « Envoyer » hors de l'écran — le geste qu'on est justement venu faire. */
  .report-image {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .report-image img {
    max-height: 9rem;
    width: auto;
    max-width: 100%;
    align-self: center;
    border-radius: 0.375rem;
    border: 1px solid rgba(0, 0, 0, 0.35);
    background: rgba(0, 0, 0, 0.15);
  }
</style>
