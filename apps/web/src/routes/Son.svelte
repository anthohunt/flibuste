<script lang="ts">
  // Essayage `#/son` : les 69 interactions sonorisées, groupées par famille, trois variantes chacune. Toucher une
  // variante la JOUE et la retient sur cet appareil ; « Copier » donne la commande qui grave ce choix dans le
  // manifeste, pour tout le monde.
  //
  // Contrairement à `#/art`, réservée au poste de travail, cette page vit EN PRODUCTION : un son ne se juge pas sur
  // le haut-parleur d'un portable de bureau mais sur l'appareil où l'on joue, donc sur le téléphone, donc sur l'app
  // déployée. C'est aussi pour cela que le choix local d'`audio.svelte.ts` est lu en production, et pas seulement
  // en dev comme celui des illustrations.
  //
  // La page est descendue à la navigation et à elle seule (App.svelte) : elle n'est pas dans le préchargement de
  // repos, donc pas un octet ne croise le chemin du premier rendu.
  import { onMount } from 'svelte';
  import { MUSIQUE, SFX, SLOTS, chargerCredits, estSlot, type Credit, type Frequence, type SlotId } from '../lib/audioManifest';
  import { audio, choixLocal, music, play, setReglage, variantesDe } from '../lib/audio.svelte';
  import { radiogroup } from '../lib/radiogroup';
  import { navigate } from '../lib/router.svelte';
  import Icon from '../components/Icon.svelte';
  /**
   * Le catalogue de sourcing est la seule description écrite de ce que CHAQUE son doit être : le libellé du moment
   * qu'il double, et la matière visée. On l'importe par son URL, jamais par son contenu.
   *
   * Mesuré : mis en dur dans le module, ses 142 Kio ressortaient en 136 Kio de JavaScript — et le précache ramasse
   * TOUT le JavaScript produit (`globPatterns` dans `vite.config.ts`), y compris celui d'une route qu'un seul homme
   * ouvrira. Le précache passait de 1 039 à 1 236 Kio, payés par chaque joueur, pour de la documentation. En `?url`,
   * Vite copie le fichier tel quel : il ne grossit aucun morceau de JavaScript, le précache ne prend pas les `.json`,
   * et il ne descend qu'à l'ouverture de cette page. C'est la même logique que le `globIgnores` du lecteur de QR.
   */

  interface Famille {
    nom: string;
    matiere: string;
    slots: string[];
  }
  interface Fiche {
    id: string;
    libelle: string;
    caractere_sonore: string;
  }
  /** Une famille du catalogue, réduite à ce que la page en montre — et dont les slots sont typés. */
  interface Groupe {
    nom: string;
    matiere: string;
    slots: SlotId[];
  }

  /** Ce qui décide du préchargement, donc ce qu'Alix doit avoir sous les yeux : un son très fréquent doit être court. */
  const FREQUENCE: Record<Frequence, string> = {
    'tres-haute': 'très souvent',
    haute: 'souvent',
    moyenne: 'par moments',
    basse: 'rarement',
    rare: 'une fois',
  };

  // Deux voies, deux curseurs — pas de « volume général » par-dessus : il ne dirait rien de plus qu'eux
  // réunis et les ferait mentir (« musique à 100 % » ne veut plus rien dire si le général est à 30).
  type Curseur = 'effets' | 'musique';
  const CURSEURS: { cle: Curseur; nom: string }[] = [
    { cle: 'effets', nom: 'Effets' },
    { cle: 'musique', nom: 'Musique' },
  ];

  // Les crédits ne sont plus dans le bundle (46 Kio pour une page d'outillage) : la page les demande au montage
  // et affiche la licence dès qu'ils arrivent. Tant qu'ils ne sont pas là, la carte du son reste utilisable —
  // c'est le son qu'on vient essayer, pas la ligne de licence.
  let credits = $state<Credit[]>([]);
  $effect(() => {
    void chargerCredits().then((c) => (credits = c));
  });
  const LICENCE = $derived(new Map(credits.map((c) => [c.fichier, c])));

  /**
   * Sans le catalogue — hors ligne, fichier absent, réseau coupé — la page reste ENTIÈREMENT utilisable : tout ce
   * qui sert à essayer (les variantes, la lecture, la commande à copier) vient du manifeste, déjà en mémoire. Le
   * catalogue n'ajoute que les mots. D'où ce repli en une seule famille plutôt qu'une page vide ou un écran d'erreur.
   */
  let groupes = $state<Groupe[]>([{ nom: 'Tous les sons', matiere: '', slots: SLOTS }]);
  let fiches = $state(new Map<string, Fiche>());

  onMount(() => {
    void (async () => {
      try {
        const rep = await fetch(`${import.meta.env.BASE_URL}audio/catalogue.json`);
        if (!rep.ok) return;
        const c = (await rep.json()) as Partial<{ familles: Famille[]; slots: Fiche[] }>;
        if (!Array.isArray(c.familles) || !Array.isArray(c.slots)) return;
        fiches = new Map(c.slots.map((f) => [f.id, f] as const));
        // Un slot du manifeste est toujours dans une famille (`audio.test.ts` le tient), mais un JSON lu au vol n'a
        // pas de type : `estSlot` est ce qui empêche un nom périmé d'entrer dans le rendu.
        groupes = c.familles.map((f) => ({ nom: f.nom, matiere: f.matiere, slots: f.slots.filter(estSlot) }));
      } catch {
        /* le catalogue n'est qu'un commentaire : son absence ne doit pas empêcher d'essayer un son */
      }
    })();
  });

  let version = $state(0);
  let commande = $state<string | null>(null);
  let notice = $state<string | null>(null);

  /**
   * La variante qui sort en ce moment, par slot. `choixLocal` écrit dans une Map et dans `localStorage` : ni l'un
   * ni l'autre n'est réactif, d'où le compteur. Une table recalculée plutôt qu'un `{#key}` sur toute la page :
   * remonter le balisage refermerait les familles dépliées et renverrait Alix en haut de la page à chaque essai.
   */
  const retenues = $derived.by(() => {
    void version;
    const m = new Map<SlotId, string>();
    for (const s of SLOTS) m.set(s, variantesDe(s).chosen ?? SFX[s].chosen);
    return m;
  });
  const essais = $derived([...retenues].filter(([s, v]) => v !== SFX[s].chosen).length);

  function essayer(slot: SlotId, v: string) {
    choixLocal(slot, v);
    version++;
    // `at: 1` contourne la garde anti-mitraillette. C'est la porte que le moteur laisse ouverte pour une salve
    // VOULUE : comparer deux variantes coup sur coup en est une, alors que la garde vise le déclenchement
    // accidentel. Sans elle, un slot gardé à 300 ms avalerait la seconde variante, et l'essai mentirait par silence.
    play(slot, { at: 1 });
  }

  /** `cible` est un slot, ou le mot `music` — `choose.mjs` accepte les deux, l'ambiance n'étant pas un effet. */
  function copier(cible: string, v: string) {
    const cmd = `node tools/audio/choose.mjs ${cible} ${v}`;
    // Presse-papiers absent (http en clair, vieux navigateur) : la commande reste affichée en toutes lettres,
    // sélectionnable à la main. Une copie ratée ne doit pas faire perdre le choix qu'on vient d'entendre.
    navigator.clipboard?.writeText(cmd).catch(() => {});
    commande = cmd;
    notice = null;
  }

  function ambiance(v: string) {
    music.setVariante(v);
    music.start();
    version++;
  }

  function effacer() {
    for (const s of SLOTS) choixLocal(s, null);
    music.setVariante(MUSIQUE.chosen);
    version++;
    commande = null;
    notice = 'Essais effacés — retour au manifeste.';
  }

  const pourcent = (v: number) => Math.round(v * 100);
  function curseur(cle: Curseur, e: Event) {
    setReglage(cle, Number((e.currentTarget as HTMLInputElement).value) / 100);
  }
</script>

<section class="flex flex-1 flex-col gap-4 pb-10">
  <header class="flex items-center justify-between gap-2">
    <button class="btn-secondary px-3 py-2 text-sm" onclick={() => navigate('home')}>← Accueil</button>
    <h1 class="title text-2xl">Sons</h1>
    <button class="btn-secondary px-3 py-2 text-xs" onclick={effacer} data-testid="son-effacer">Effacer essais</button>
  </header>

  <p class="text-xs opacity-70">
    Touche une variante pour l'entendre — elle est retenue sur cet appareil, la page indique celle du manifeste. Pour
    la graver pour tout le monde : <code>node tools/audio/choose.mjs &lt;slot&gt; &lt;v&gt;</code>, que le bouton
    « Copier » met dans le presse-papiers.
  </p>
  {#if !audio.pret}
    <p class="hint" data-testid="son-verrou">Aucun navigateur ne laisse sortir un son avant un vrai geste : le premier appui débloque tout.</p>
  {/if}
  {#if commande || notice}
    <div class="panel text-xs" data-testid="son-notice">
      {#if commande}Copié : <code class="break-all">{commande}</code>{:else}{notice}{/if}
    </div>
  {/if}

  <div class="panel flex flex-col gap-2" data-testid="son-reglages">
    {#each CURSEURS as c (c.cle)}
      <div class="flex flex-col gap-0.5" data-curseur={c.cle}>
        <div class="flex items-baseline justify-between gap-2">
          <label class="text-sm font-bold" for="son-{c.cle}">{c.nom}</label>
          <span class="font-mono text-sm font-bold" data-testid="son-valeur-{c.cle}">{pourcent(audio.settings[c.cle])} %</span>
        </div>
        <input
          id="son-{c.cle}"
          type="range"
          min="0"
          max="100"
          step="1"
          class="slider-brass w-full"
          value={pourcent(audio.settings[c.cle])}
          aria-label={c.nom}
          aria-valuetext="{pourcent(audio.settings[c.cle])} pour cent"
          data-testid="son-curseur-{c.cle}"
          oninput={(e) => curseur(c.cle, e)}
        />
      </div>
    {/each}
    <button
      type="button"
      role="switch"
      aria-checked={audio.settings.muet}
      class="chip-brass self-start !min-h-11 !px-3"
      class:is-off={!audio.settings.muet}
      data-testid="son-muet"
      onclick={() => setReglage('muet', !audio.settings.muet)}
    >
      <Icon name={audio.settings.muet ? 'close' : 'bell'} size={14} />
      <span>Couper le son</span>
    </button>
  </div>

  <article class="panel flex flex-col gap-2" data-testid="son-musique">
    <div class="flex items-baseline justify-between gap-2">
      <h2 class="title text-base">Musique</h2>
      <span class="font-mono text-xs opacity-60">{music.variante}{music.variante === MUSIQUE.chosen ? '' : ' · essai'}</span>
    </div>
    <p class="text-[11px] leading-snug opacity-60">
      Un seul lit sonore, en boucle, normalisé bas pour ne jamais couvrir un effet. Toucher une ambiance la lance en
      fondu ; la précédente s'éteint pendant que celle-ci monte.
    </p>
    <div class="flex flex-wrap items-stretch gap-1.5" role="radiogroup" aria-label="Ambiance musicale" use:radiogroup>
      {#each MUSIQUE.variants as v (v)}
        {@const credit = LICENCE.get(`music/${v}`)}
        <button
          type="button"
          role="radio"
          aria-checked={music.variante === v}
          aria-label="Ambiance {v}{v === MUSIQUE.chosen ? ', retenue au manifeste' : ''}"
          class="variante flex-1 basis-24"
          class:is-on={music.variante === v}
          data-variante={v}
          onclick={() => ambiance(v)}
        >
          <span class="font-mono text-xs font-bold">{v}</span>
          {#if v === MUSIQUE.chosen}<span class="galon">manifeste</span>{/if}
          <span class="text-[9px] leading-tight opacity-70">{credit?.titre ?? '—'}</span>
        </button>
      {/each}
    </div>
    <div class="flex flex-wrap gap-1.5">
      <button type="button" class="btn-secondary px-3 py-1.5 text-xs" onclick={() => music.stop()} data-testid="son-musique-stop">Couper</button>
      <button type="button" class="btn-secondary px-3 py-1.5 text-xs" onclick={() => copier('music', music.variante)} data-testid="son-musique-copier">Copier</button>
    </div>
  </article>

  <!-- Une famille par volet replié : 69 interactions × 3 variantes font 207 boutons, illisibles d'un bloc sur un
       téléphone — et la famille est justement l'unité qu'on compare (« est-ce que tout le bois sonne pareil ? »). -->
  {#each groupes as g (g.nom)}
    <details class="panel" data-famille={g.nom}>
      <summary class="flex cursor-pointer items-baseline justify-between gap-2">
        <h2 class="title text-base">{g.nom}</h2>
        <span class="font-mono text-xs opacity-60">{g.slots.length} sons</span>
      </summary>
      {#if g.matiere}<p class="mt-1 text-[11px] leading-snug opacity-60">{g.matiere}</p>{/if}
      {#each g.slots as id (id)}
        {@const e = SFX[id]}
        {@const fiche = fiches.get(id)}
        {@const retenue = retenues.get(id)}
        <article class="mt-2 flex flex-col gap-1 border-t border-white/10 pt-2" data-slot={id}>
          <h3 class="text-sm leading-snug font-bold">{fiche?.libelle ?? id}</h3>
          <p class="font-mono text-[10px] opacity-60">
            {id} · {FREQUENCE[e.frequence]} · {e.priorite}{retenue === e.chosen ? '' : ' · essai'}
          </p>
          {#if fiche}<p class="text-[11px] leading-snug opacity-60">{fiche.caractere_sonore}</p>{/if}
          <div class="flex items-stretch gap-1.5">
            <div class="flex flex-1 items-stretch gap-1.5" role="radiogroup" aria-label="Variantes de {id}" use:radiogroup>
              {#each e.variants as v (v)}
                {@const credit = LICENCE.get(`${id}-${v}`)}
                <button
                  type="button"
                  role="radio"
                  aria-checked={retenue === v}
                  aria-label="{id}, variante {v}{v === e.chosen ? ', retenue au manifeste' : ''}"
                  class="variante flex-1"
                  class:is-on={retenue === v}
                  data-variante={v}
                  onclick={() => essayer(id, v)}
                >
                  <span class="font-mono text-xs font-bold">{v}</span>
                  {#if v === e.chosen}<span class="galon">manifeste</span>{/if}
                  <span class="text-[9px] leading-tight opacity-70">{credit?.titre ?? '—'}</span>
                </button>
              {/each}
            </div>
            <button type="button" class="btn-secondary shrink-0 px-2 text-[10px]" aria-label="Copier la commande pour {id}" onclick={() => copier(id, retenue ?? e.chosen)}>Copier</button>
          </div>
        </article>
      {/each}
    </details>
  {/each}

  <p class="text-center text-xs opacity-60" data-testid="son-essais">
    {essais} essai(s) local(aux) non gravé(s) au manifeste · tous les sons sont CC0.
  </p>
</section>

<style>
  /* Une variante = une petite planche. L'anneau Tailwind seul se fait manger par les ombres du thème (UX-08) :
     l'état retenu est repeint ici, avec une bordure et un galon qui restent lisibles sans couleur. */
  .variante {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    min-height: 2.75rem;
    padding: 0.35rem 0.25rem;
    border: 1px solid rgba(255, 228, 175, 0.25);
    border-radius: 0.375rem;
    background: rgba(0, 0, 0, 0.25);
    text-align: center;
    opacity: 0.65;
  }
  .variante.is-on {
    border-color: var(--color-gold-300, #e8c56a);
    box-shadow: inset 0 0 0 1px var(--color-gold-400, #d6a74a);
    opacity: 1;
  }
  .galon {
    font-size: 8px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-gold-300, #e8c56a);
  }
</style>
