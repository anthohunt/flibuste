<script lang="ts">
  // Niveau d'un pirate de bois (vague 6) : quatre grands boutons Facile / Normal / Difficile / Impitoyable (1 à 4
  // crânes, une ligne de caractère), le niveau courant surligné — un tap prépare le choix, Enregistrer le confirme. « Personnaliser »
  // déplie les 8 curseurs (7 sur 0–10 + la réaction en 3 crans) ; le niveau affiché devient « Perso » dès qu'un
  // curseur quitte un préréglage ; « Valider » confirme le profil. Sert aussi à choisir le bot qu'on ajoute.
  // Vague 1 / UX-08 (2026-09-07) : le niveau retenu se VOIT. L'anneau `ring-2 ring-gold-400` était bien posé mais
  // le `box-shadow` de `.btn-tavern` (règle hors `@layer`) l'écrasait : les quatre planches avaient des styles
  // calculés strictement identiques. L'état est repeint ici, en local, avec une spécificité qui gagne.
  import { BOT_SLIDERS, LEVEL_META, LEVEL_NAME, REACTION_META, SLIDER_META, levelOf, profileOf, specForLevel, type BotLevel, type BotProfile, type BotSpec, type Reaction } from '../lib/botProfile';
  import { play } from '../lib/audio.svelte';
  import { longpress } from '../lib/tip.svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';

  let {
    name = 'Nouveau pirate de bois',
    current = null,
    onpick,
    oncancel,
  }: {
    name?: string;
    /** Bot courant : un niveau nu, un profil ou un `BotSpec` ; null pour un nouveau bot. */
    current?: BotSpec | BotProfile | BotLevel | 'custom' | null;
    onpick: (spec: BotSpec) => void;
    oncancel: () => void;
  } = $props();

  // Le bot courant est lu une fois à l'ouverture (la feuille est recréée à chaque ouverture).
  // svelte-ignore state_referenced_locally
  const initial = profileOf(current === 'custom' ? null : current);
  let profile = $state<BotProfile>(initial);
  const level = $derived(levelOf(profile));
  const levelLabel = $derived(LEVEL_NAME[level]);
  /** Les curseurs sont dépliés d'emblée pour un bot déjà personnalisé. */
  // svelte-ignore state_referenced_locally
  let custom = $state(current !== null && levelOf(initial) === 'custom');

  /**
   * Le petit tas de crânes de bois. Depuis que le tap PRÉPARE le choix au lieu de le valider, il n'y a plus de
   * feuille qui se referme derrière lui : le crâne est seul dans son tour, et c'est lui qui dit — par sa hauteur —
   * quelle trempe vient d'être donnée. On peut en essayer quatre de suite : le garde-temps du moteur (150 ms) et
   * le détune évitent la rafale.
   */
  function pickLevel(lv: BotLevel) {
    play('bot-niveau-choisi');
    profile = { ...specForLevel(lv).profile };
  }
  /** `oninput` émet par pixel de glissade : seul un cran ENTIER franchi mérite son tic (cf `DealsSelect`). */
  function setSlider(key: (typeof BOT_SLIDERS)[number], value: number) {
    const v = Math.max(0, Math.min(10, Math.round(value)));
    if (v !== profile[key]) play('cran-de-reglage');
    profile = { ...profile, [key]: v };
  }
  function setReaction(r: Reaction) {
    profile = { ...profile, reaction: r };
  }
  /**
   * Enregistrer, c'est le geste qui compte : le crâne passe le premier, le tabouret de l'appelant (`bot-assis`)
   * 120 ms derrière, la feuille en dernier et douze décibels plus bas. L'ordre d'appel suffit à les ranger.
   */
  function apply() {
    play('bot-niveau-choisi');
    onpick({ level, profile: { ...profile } });
  }
</script>

<Sheet title={name} {oncancel} testid="level-picker" center class="max-h-[90dvh] overflow-y-auto">
  <p class="hint -mt-2 text-center">
    Niveau du pirate de bois · <strong class="not-italic text-ink-900" data-testid="bot-level-current" data-level={level}>{levelLabel}</strong>
  </p>
  <div class="grid grid-cols-2 gap-2" role="group" aria-label="Niveau du bot">
    {#each LEVEL_META as m (m.level)}
      <button
        type="button"
        class="lvl btn-tavern btn-tavern-sm btn-tavern-center flex-col !items-stretch !gap-1 !px-2 py-2.5 text-left"
        class:is-on={level === m.level}
        aria-label={m.name}
        aria-pressed={level === m.level}
        data-level={m.level}
        data-on={level === m.level || undefined}
        data-testid="bot-level-{m.level}"
        data-clac="non"
        data-autofocus={level === m.level || undefined}
        onclick={() => pickLevel(m.level)}
      >
        <span class="flex items-center justify-between gap-1">
          <span class="text-base">{m.name}</span>
          <span class="flex gap-0.5 text-gold-300" aria-hidden="true">
            {#each Array(m.skulls) as _, j (j)}
              <Icon name="skull" size={13} />
            {/each}
          </span>
        </span>
        <span class="bot-character text-[0.72rem] leading-tight font-normal normal-case tracking-normal">{m.character}</span>
        {#if level === m.level}
          <span class="lvl-on" aria-hidden="true"><Icon name="check" size={12} /><span>sélectionné</span></span>
        {/if}
      </button>
    {/each}
  </div>

  <button type="button" class="chip-brass mx-auto !min-h-11 !px-3 !py-1.5 !text-[0.8rem]" class:is-off={!custom} aria-expanded={custom} aria-controls="bot-sliders" data-testid="bot-custom" onclick={() => (custom = !custom)}>
    <Icon name="pencil" size={14} />
    <span>Personnaliser</span>
    <span aria-hidden="true">{custom ? '▴' : '▾'}</span>
  </button>

  {#if custom}
    <div id="bot-sliders" class="flex flex-col gap-2" data-testid="bot-sliders">
      {#each SLIDER_META as sm (sm.key)}
        <div class="flex flex-col gap-0.5" data-slider={sm.key}>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
              <label class="text-sm font-bold" for="bot-slider-{sm.key}">{sm.name}</label>
              <button type="button" class="info-dot" aria-label="{sm.name} : explication" data-testid="bot-slider-info-{sm.key}" use:longpress={{ title: sm.name, text: sm.info, tap: true }}>i</button>
            </div>
            <span class="font-mono text-sm font-bold text-ink-900" data-testid="bot-slider-value-{sm.key}">{profile[sm.key]}</span>
          </div>
          <input
            id="bot-slider-{sm.key}"
            type="range"
            min="0"
            max="10"
            step="1"
            class="slider-brass w-full"
            value={profile[sm.key]}
            aria-label={sm.name}
            aria-valuetext="{profile[sm.key]} sur 10"
            data-testid="bot-slider-{sm.key}"
            oninput={(e) => setSlider(sm.key, Number((e.currentTarget as HTMLInputElement).value))}
          />
        </div>
      {/each}
      <div class="flex flex-col gap-1" data-slider="reaction">
        <span class="flex items-center gap-1.5 text-sm font-bold" id="bot-reaction-label">
          <span>Réaction</span>
          <button type="button" class="info-dot" aria-label="Réaction : explication" data-testid="bot-slider-info-reaction" use:longpress={{ title: 'Réaction', text: 'Le temps qu’il prend avant de jouer — rapide, moyen ou lent.', tap: true }}>i</button>
        </span>
        <div class="grid grid-cols-3 gap-1.5" role="radiogroup" aria-labelledby="bot-reaction-label" data-testid="bot-slider-reaction">
          {#each REACTION_META as r (r.reaction)}
            <button type="button" role="radio" aria-checked={profile.reaction === r.reaction} aria-label={r.name} class="chip-brass !min-h-11 !justify-center !px-2 !py-1 !text-[0.8rem]" class:is-off={profile.reaction !== r.reaction} data-reaction={r.reaction} data-testid="bot-reaction-{r.reaction}" onclick={() => setReaction(r.reaction)} use:longpress={{ title: r.name, text: r.info }}>
              <span>{r.name}</span>
            </button>
          {/each}
        </div>
      </div>

    </div>
  {/if}
  <button type="button" class="btn-primary gap-2 py-3" onclick={apply} data-testid="bot-apply" data-clac="non"><Icon name="check" size={20}/><span>Enregistrer · {levelLabel}</span></button>
  <button type="button" class="chip-brass !min-h-11" onclick={oncancel}>Annuler</button>
</Sheet>

<style>
  /* Le niveau retenu : bordure d'or, liseré intérieur, planche éclairée et un galon « à la table ». Quatre
     propriétés différentes de celles des trois autres planches — l'anneau Tailwind seul se faisait manger par
     le `box-shadow` de `.btn-tavern` (UX-08). */
  .lvl.is-on {
    border-color: var(--color-gold-300, #e8c56a);
    box-shadow:
      inset 0 0 0 2px var(--color-gold-400, #d6a74a),
      inset 0 1px 0 rgba(255, 235, 190, 0.5),
      inset 0 -3px 0 rgba(0, 0, 0, 0.4),
      0 4px 0 #120903,
      0 12px 18px rgba(0, 0, 0, 0.6);
    outline: 2px solid var(--color-gold-400, #d6a74a);
    outline-offset: 2px;
    filter: brightness(1.14) saturate(1.08);
  }
  /* Le galon de l'état retenu : lisible aussi en contraste forcé et sans couleur. */
  .lvl-on {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    margin-top: 0.15rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.45);
    padding: 0.05rem 0.4rem;
    font-family: var(--font-body);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #f6d78d;
  }
  @media (prefers-reduced-motion: no-preference) {
    .lvl {
      transition:
        filter 120ms ease-out,
        box-shadow 120ms ease-out;
    }
  }

  /* La ligne de caractère, lisible sur le bois sombre du bouton. */
  .bot-character {
    color: #e9d8ad;
    opacity: 0.92;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.8);
    font-family: var(--font-body);
  }
</style>
