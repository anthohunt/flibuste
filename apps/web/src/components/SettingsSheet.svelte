<script lang="ts">
  // La feuille de l'engrenage : le son, et rien d'autre. C'est le seul réglage que le jeu expose, et il est
  // maintenant à UN geste de n'importe quel écran — l'en-tête permanent (`AppHeader`) l'ouvre depuis l'accueil
  // comme depuis la table, sans passer par « Comment on joue ? ».
  //
  // Pourquoi elle EXISTE alors que l'aide portait déjà ces curseurs : l'aide est une feuille de RÈGLES. Y ranger
  // le volume obligeait à traverser le déroulé d'une manche, le tableau des points et les bonus pour baisser la
  // musique — et à table, c'était la seule route. Les curseurs ont donc DÉMÉNAGÉ ici : ils ne doivent vivre qu'à
  // un seul endroit, sans quoi deux écrans finissent par afficher deux valeurs du même volume.
  //
  // Les crédits suivent les curseurs. La trace de licence est obligatoire, elle appartient au son, et elle est
  // le seul contenu de l'ancienne section « Sons » qui n'a pas d'autre foyer.
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { audio, chargerCredits, setReglage } from '../lib/audio.svelte';
  import type { Credit } from '../lib/audioManifest';
  import { navigate } from '../lib/router.svelte';
  import { game } from '../lib/store.svelte';

  let { oncancel }: { oncancel: () => void } = $props();

  // DEUX curseurs, un par voie, et pas trois : un « volume général » par-dessus les deux autres ne dit rien
  // de plus qu'eux réunis, et il les fait mentir — « musique à 100 % » ne veut plus rien dire quand le général
  // est à 30. Le bus maître existe toujours dans le moteur, mais il porte le muet, pas un réglage.
  type Curseur = 'effets' | 'musique';
  const CURSEURS: { cle: Curseur; nom: string }[] = [
    { cle: 'effets', nom: 'Effets' },
    { cle: 'musique', nom: 'Musique' },
  ];
  const pourcent = (v: number) => Math.round(v * 100);
  function curseur(cle: Curseur, e: Event) {
    setReglage(cle, Number((e.currentTarget as HTMLInputElement).value) / 100);
  }

  function essayage() {
    oncancel();
    navigate('son');
  }

  // La trace de licence est obligatoire, mais 211 lignes de fichiers ne se lisent pas : les effets sont regroupés
  // par LOT d'origine (c'est le lot qui porte la licence, pas le fichier), la musique reste nommée piste par piste
  // — quatre lignes, avec l'auteur et la page où on peut la vérifier.
  //
  // Elle se charge à l'OUVERTURE du repli, pas au montage de la feuille : ces 46 Kio voyageraient sinon dans le
  // bundle d'entrée — l'en-tête est monté sur tous les écrans, donc cette feuille l'est aussi — pour une liste
  // que presque personne ne déplie.
  let credits = $state<Credit[]>([]);
  let creditsDemandes = false;
  async function ouvrirCredits() {
    if (creditsDemandes) return;
    creditsDemandes = true;
    credits = await chargerCredits();
  }
  const MUSIQUES = $derived(credits.filter((c) => c.fichier.startsWith('music/')));
  const LOTS = $derived([...new Set(credits.filter((c) => !c.fichier.startsWith('music/')).map((c) => c.source))].sort((a, b) => a.localeCompare(b, 'fr')));
  const LICENCES = $derived([...new Set(credits.map((c) => c.licence))].sort());
</script>

<Sheet title="Réglages" {oncancel} testid="reglages-sheet" class="max-h-[85dvh] overflow-y-auto">
  <p class="hint -mt-2 text-center">Le son ne dit jamais rien que l’écran ne dise déjà : le couper ne fait rien perdre de la partie.</p>

  <section class="flex flex-col gap-1.5" data-testid="reglages-son">
    {#each CURSEURS as c (c.cle)}
      <div class="flex flex-col gap-0.5" data-curseur={c.cle}>
        <div class="flex items-baseline justify-between gap-2">
          <label class="text-sm font-bold" for="reglages-son-{c.cle}">{c.nom}</label>
          <span class="font-mono text-sm font-bold" data-testid="reglages-son-valeur-{c.cle}">{pourcent(audio.settings[c.cle])} %</span>
        </div>
        <input
          id="reglages-son-{c.cle}"
          type="range"
          min="0"
          max="100"
          step="1"
          class="slider-brass w-full"
          value={pourcent(audio.settings[c.cle])}
          aria-label={c.nom}
          aria-valuetext="{pourcent(audio.settings[c.cle])} pour cent"
          data-testid="reglages-son-curseur-{c.cle}"
          oninput={(e) => curseur(c.cle, e)}
        />
      </div>
    {/each}

    <div class="flex flex-wrap items-center gap-2">
      <!-- Pas de clac de planche ici, et ce n'est pas un oubli : le clac part à l'APPUI, donc AVANT que l'état
           ne change. En coupant, il fait entendre exactement ce qu'on vient de faire taire (puis se fait
           trancher par le fondu de 10 ms) ; en rallumant, il part encore muet, donc on ne l'entend pas. Il
           sonne toujours du mauvais côté du geste. C'est le choix qu'avait déjà fait l'ancien bouton d'un
           seul geste (`SoundToggle`), que cette feuille remplace. -->
      <button
        type="button"
        role="switch"
        aria-checked={audio.settings.muet}
        class="chip-brass !min-h-11 !px-3"
        class:is-off={!audio.settings.muet}
        data-clac="non"
        data-testid="reglages-son-muet"
        onclick={() => setReglage('muet', !audio.settings.muet)}
      >
        <Icon name={audio.settings.muet ? 'soundOff' : 'bell'} size={14} />
        <span>Couper le son</span>
      </button>
      <!-- L'essayage est une autre page : y aller depuis la table déclencherait la garde « Quitter la table ? »
           (App.svelte, C7). On ne propose donc le passage que hors partie, plutôt que d'offrir un piège. -->
      {#if !game.view}
        <button type="button" class="chip-brass !min-h-11 !px-3" data-testid="reglages-son-essayage" onclick={essayage}>
          <Icon name="cards" size={14} />
          <span>Essayer les sons</span>
        </button>
      {/if}
    </div>

    <details class="text-[0.8rem]" data-testid="reglages-son-credits" ontoggle={ouvrirCredits}>
      <summary class="cursor-pointer opacity-80">Crédits{LICENCES.length ? ` · ${LICENCES.join(', ')}` : ''}</summary>
      <ul class="mt-1 list-disc pl-5 opacity-70">
        {#each MUSIQUES as c (c.fichier)}
          <li>
            <strong>{c.fichier.slice('music/'.length)}</strong> — <a class="underline" href={c.source} target="_blank" rel="noreferrer">{c.titre}</a>, {c.auteur}, {c.licence}
          </li>
        {/each}
        {#each LOTS as lot (lot)}
          <li>{lot}</li>
        {/each}
      </ul>
    </details>
  </section>

  <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center mx-auto" onclick={oncancel} aria-label="Fermer" data-autofocus>
    <Icon name="check" size={16} />
    <span>Fermer</span>
  </button>
<p class="text-center font-mono text-xs opacity-70" data-testid="settings-version">Version {typeof __VERSION__ === 'string' ? __VERSION__ : 'dev'}</p>
</Sheet>
