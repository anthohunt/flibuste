<script lang="ts">
  import ThemedSelect from '../components/ThemedSelect.svelte';
  // Préparation solo : nombre de joueurs, niveau commun des bots, règles et manches.
  import { tick } from 'svelte';
  import { navigate } from '../lib/router.svelte';
  import { botName, defaultSoloConfig, game, hasResumableOffline, loadSoloConfig, resumableOfflineSummary, resumeOffline, saveSoloConfig, screenFor, setMyName, startSolo, type SoloBot, type SoloConfig } from '../lib/store.svelte';
  import { BOT_LEVELS, LEVEL_NAME, isBotLevel, specForLevel, type BotLevel } from '../lib/botProfile';
  import { openCodex } from '../lib/codex.svelte';
  import { clearSavedOffline } from '../lib/offline';
  import { MAX_PLAYERS, maxPlayersFor, customDeckProblem } from '@flibuste/engine';
  import { isRuleOn, toggleRule, type RuleMeta, type RulesV2 } from '../lib/rulesMeta';
  import { GHOST_RULE_FR, TWO_PLAYER_REMOVED_FR, ghostOn, roundsOf } from '../lib/variants';
  import { TWO_PLAYER_VARIANT_FR } from '@flibuste/engine';
  import { PRESETS, applyPreset, presetOf, type Preset } from '../lib/presets';
  import { play } from '../lib/audio.svelte';
  import Icon from '../components/Icon.svelte';
  import Sheet, { clac } from '../components/Sheet.svelte';
  import DealsSelect from '../components/DealsSelect.svelte';
  import SavedModes from '../components/SavedModes.svelte';
  import RuleToggles, { sonnerBascule } from '../components/RuleToggles.svelte';
  import RuleInfoSheet from '../components/RuleInfoSheet.svelte';
  import ResumeGuard from '../components/ResumeGuard.svelte';

  const initial: SoloConfig = loadSoloConfig() ?? defaultSoloConfig(3);
  // Un ancien salon aux niveaux mélangés ou personnalisés repart sur Normal.
  // Un préréglage commun est conservé ; les profils individuels ne sont jamais réintroduits.
  const savedLevel = initial.bots[0]?.level;
  const initialLevel: BotLevel = isBotLevel(savedLevel) && initial.bots.every((b) => b.level === savedLevel) ? savedLevel : 'normal';
  let botLevel = $state<BotLevel>(initialLevel);
  let bots = $state<SoloBot[]>(defaultSoloConfig(Math.max(1, Math.min(initial.bots.length, MAX_PLAYERS - 1))).bots.map((b) => ({ ...b, ...specForLevel(initialLevel) })));
  let rules = $state<RulesV2>({ ...initial.rules });
  /**
   * Combien de sièges : LE MOTEUR le dit. En solo il n'y a pas de serveur pour trancher, donc on
   * interroge celui qui distribue les cartes — c'est le paquet qui décide, et seules les cartes de
   * couleur le grossissent. Réécrire la formule ici en faisait une troisième version qui pouvait dériver
   * de celle du moteur sans que rien ne le signale.
   */
  const maxSeats = $derived(maxPlayersFor(rules));
  const rounds = $derived(roundsOf(rules));
  const deckProblem = $derived(customDeckProblem(rules, bots.length + 1));
  /** À deux (moi + un pirate de bois) : Vieux Loup, ON par défaut. */
  const twoPlayers = $derived(bots.length === 1);
  const ghost = $derived(ghostOn(rules, bots.length + 1));
  let twoInfo = $state(false);
  /**
   * L'extinction des cartes couleur rétrécit la tablée (9 sièges → 8) et éjecte d'office les pirates de bois en
   * trop. Le son dit cette CONSÉQUENCE, décalée de deux crans pour passer DERRIÈRE le `regle-eteinte` qui l'a
   * causée : la causalité doit s'entendre dans cet ordre, pas en accord.
   *
   * `vuLaTablee` : le premier passage n'est qu'un relevé. Un brouillon `localStorage` plus large que les règles
   * qu'il porte se corrige au montage, sans qu'aucun geste ne l'ait demandé — et un son ne commente pas ça.
   */
  let vuLaTablee = false;
  /** Trois prises au plus : au-delà, six mannequins rangés d'affilée ne s'entendent plus comme un rangement. */
  const PRISES_MAX = 3;
  $effect(() => {
    const trop = bots.length - (maxSeats - 1);
    if (trop <= 0) {
      vuLaTablee = true;
      return;
    }
    bots = bots.slice(0, maxSeats - 1);
    if (!vuLaTablee) {
      vuLaTablee = true;
      return;
    }
    for (let i = 0; i < Math.min(trop, PRISES_MAX); i++) play('bot-retire', { at: 2 + i });
  });

  /**
   * Préréglage déduit des règles ; « Personnalisée » ouverte à la demande garde la grille visible.
   * FONC-03 : tant qu'aucune carte-règle n'a bougé, les règles ne disent pas que le capitaine a choisi
   * « Personnalisée » — c'est le brouillon sauvegardé qui s'en souvient.
   */
  let customOpen = $state(initial.custom ?? presetOf(initial.rules) === 'custom');
  const preset = $derived<Preset>(customOpen ? 'custom' : presetOf(rules));
  const presetHint = $derived(PRESETS.find((p) => p.id === preset)?.hint ?? '');
  /**
   * Un préréglage bascule jusqu'à treize cartes-règles d'un coup : les jouer une à une ferait un mur sonore. Un
   * seul son composé, donc — la rangée de témoins qui s'éteint en cascade ou qui s'allume. « Personnalisée »
   * n'applique AUCUNE règle (`rules` reste intact) mais déplie la grille : c'est le même geste en plus court.
   */
  function pickPreset(value: string) {
    const id = value as Preset;
    if (id === 'custom') {
      play('plan-de-table', { gain: 0.55 });
      customOpen = true;
      return;
    }
    play('plan-de-table');
    customOpen = false;
    rules = applyPreset(rules, id);
  }

  let info = $state<RuleMeta | null>(null);
  let guard = $state(false);
  /**
   * Le sélecteur de convives assoit ou range plusieurs pirates de bois d'un SEUL geste.
   * Les tabourets tirés se suffisent du garde-temps de `bot-assis` (200 ms) : un seul s'entend, et c'est bien ce
   * qu'on veut dire — la tablée s'est remplie, pas neuf mannequins nommés un à un. Les mannequins rangés, eux,
   * passent par un `slice` muet : on leur redonne la salve égrenée et plafonnée de l'éjection ci-dessus.
   */
  function setCount(count: number) {
    const cible = count - 1;
    while (bots.length < cible) addBot();
    if (bots.length <= cible) return;
    const trop = bots.length - cible;
    bots = bots.slice(0, cible);
    for (let i = 0; i < Math.min(trop, PRISES_MAX); i++) play('bot-retire', { at: i });
  }

  function backOrClose() {
    play('table-quittee');
    navigate('home');
  }

  // Pseudo manquant (lien direct `#/lobby`, #18) : on le demande ici, comme l'accueil.
  // FONC-28 — le nom est enregistré À LA FRAPPE (dès deux lettres), plus seulement quand on quitte le champ :
  // passer de la saisie au partage sans toucher ailleurs est un geste courant, et le nom se perdait. Le champ,
  // lui, ne disparaît qu'une fois quitté (`askName`) — sinon il s'escamoterait sous les doigts à la 2e lettre.
  let name = $state(game.identity.name);
  let nameInput = $state<HTMLInputElement | null>(null);
  let nameError = $state<string | null>(null);
  const hasName = $derived(game.identity.name.trim().length >= 2);
  /** `silencieux` : la frappe enregistre ce qui est déjà valable, sans reprocher une saisie en cours. */
  function commitName(silencieux = false): boolean {
    if (name.trim().length < 2) {
      if (!silencieux) {
        nameError = 'Ton nom de pirate ? (2 lettres au moins)';
        tick().then(() => nameInput?.focus());
      }
      return false;
    }
    nameError = null;
    setMyName(name);
    return true;
  }
  /** Quitter le champ (ou Entrée) range le parchemin, comme avant — le nom, lui, est déjà enregistré. */
  function closeName() {
    commitName();
  }

  /** Le réglage courant du salon, tel qu'il est affiché — ce qu'on persiste, et ce qu'on lance (FONC-03). */
  function draftConfig(): SoloConfig {
    return {
      bots: bots.map((b) => ({ name: b.name, level: b.level, ...(b.profile ? { profile: { ...b.profile } } : {}) })),
      rules: { ...rules },
      ...(customOpen ? { custom: true } : {}),
    };
  }
  // FONC-03 — le salon se souvient : chaque geste part dans `localStorage`, sans attendre « Lancer la partie ».
  $effect(() => {
    saveSoloConfig(draftConfig());
  });

  /** Le même niveau s'applique aux bots présents et à ceux ajoutés ensuite. */
  function setBotLevel(value: string) {
    if (!isBotLevel(value)) return;
    botLevel = value;
    bots = bots.map((b) => ({ ...b, ...specForLevel(value) }));
    play('bot-niveau-choisi');
  }

  /** Complète la table au niveau choisi. */
  function addBot() {
    const spec = specForLevel(botLevel);
    if (bots.length >= maxSeats - 1) return;
    const used = new Set(bots.map((b) => b.name));
    let i = bots.length;
    while (used.has(botName(i))) i++;
    play('bot-assis');
    bots = [...bots, { name: botName(i), level: spec.level, profile: { ...spec.profile } }];
  }
  /** Le siège de Vieux Loup EST un interrupteur de règle : même son que la grille, pas un tabouret qu'on tire. */
  function toggleGhost() {
    play(ghost ? 'regle-eteinte' : 'regle-allumee');
    rules = { ...rules, ghost: !ghost };
  }

  function launch() {
    if (deckProblem) return;
    if (!commitName()) return;
    if (hasResumableOffline()) {
      guard = true;
      return;
    }
    start();
  }
  /** La cloche de bord ne sonne QUE d'ici : `launch()` sort sans rien lancer quand le nom manque ou qu'une
   *  partie est en cours (le garde-fou), et un son ne doit jamais mentir sur le départ. */
  function start() {
    if (deckProblem) return;
    play('partie-lancee');
    guard = false;
    clearSavedOffline();
    const cfg = draftConfig();
    saveSoloConfig(cfg);
    startSolo(cfg);
    navigate('table');
  }
  function resumeSaved() {
    guard = false;
    const partie = resumeOffline();
    if (!partie) return;
    play('partie-reprise');
    // MÊME RÈGLE QU'À L'ACCUEIL : l'écran se demande à la phase reprise. C'est la SECONDE porte qui mène à une
    // partie sauvegardée (l'autre est le bouton « Reprendre le solo » de l'accueil), et elle tombait dans le même
    // piège — une sauvegarde prise en fin de manche revient en phase `roundEnd`, dont l'unique geste
    // (« Manche suivante ») ne vit que sur l'écran des scores. Écrire `table` en dur déposait le joueur sur une
    // table sans main ni bouton, que rien ne rattrapait ensuite : à `roundEnd` aucun bot ne joue, donc aucune vue
    // nouvelle ne revient, et `applyView` ne navigue pas depuis une route hors partie (garde `GAME_ROUTES`).
    navigate(screenFor(partie.view().phase));
  }
</script>

<section class="flex flex-1 flex-col gap-4" data-testid="lobby-solo" use:clac>
  <header class="flex items-center gap-3">
    <button type="button" class="icon-btn" onclick={backOrClose} aria-label="Retour à la taverne" data-testid="back-home" data-clac="non"><Icon name="home" size={22} /></button>
    <div class="flex min-w-0 flex-1 flex-col">
      <h1 class="title text-3xl leading-none" tabindex="-1">Prépare ton expédition</h1>
      <span class="hint">Sur cet appareil, contre des bots</span>
    </div>
  </header>

    <div class="panel-parchment flex flex-col items-center gap-2 py-3" data-testid="lobby-name">
      <label class="hint !not-italic" for="lobby-name">Nom de pirate</label>
      <input id="lobby-name" bind:this={nameInput} class="input-parchment w-56 text-center text-base" class:!ring-2={!!nameError} class:!ring-rum-500={!!nameError} type="text" maxlength="20" placeholder="Alix le Joyeux" aria-label="Nom de pirate" aria-invalid={nameError ? 'true' : undefined} bind:value={name} oninput={() => { nameError = null; commitName(true); }} autocomplete="nickname" onkeydown={(e) => e.key === 'Enter' && closeName()} onblur={() => name.trim().length >= 2 && closeName()} />
      {#if nameError}
        <p class="rounded-md bg-rum-600/85 px-3 py-1 text-center text-sm font-bold text-parchment shadow" role="alert" data-testid="name-error">{nameError}</p>
      {/if}
    </div>

  <div class="panel-wood flex flex-col gap-4">
   <label class="panel-title" for="players">Nombre de flibustiers</label>
   <ThemedSelect id="players" label="Nombre de flibustiers" value={String(bots.length+1)} options={Array.from({length:maxSeats-1},(_,i)=>{const n=i+2;return{value:String(n),label:`${n} joueurs · toi + ${n-1} bot${n>2?'s':''}`}})} onchange={value=>setCount(Number(value))}/>
   <label class="panel-title" for="solo-bot-level">Difficulté des bots</label>
   <ThemedSelect id="solo-bot-level" label="Difficulté des bots" testid="solo-bot-level" value={botLevel} options={BOT_LEVELS.map((level) => ({ value: level, label: LEVEL_NAME[level] }))} onchange={setBotLevel}/>
   {#if twoPlayers}
    <label class="hint flex min-h-11 items-center gap-2" data-testid="two-player-note" data-ghost={ghost}><input type="checkbox" checked={ghost} onchange={toggleGhost} data-testid="ghost-toggle" />Vieux Loup · troisième main</label>
    <p class="two-restriction" data-testid="two-player-restriction">{TWO_PLAYER_REMOVED_FR}</p>
    <button class="rules-codex" onclick={() => (twoInfo = true)} aria-label="Qu’est-ce que Vieux Loup ?" data-testid="two-player-info">La règle à deux joueurs</button>
   {/if}
  </div>
  <details class="panel-wood rules-panel" data-testid="rules-settings"><summary class="rules-summary"><span>Règles et manches <small>{PRESETS.find(p=>p.id===preset)?.name} · {rounds} manches</small></span><span class="rules-chevron" aria-hidden="true">⌄</span></summary>
  <div class="panel-wood flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <label class="panel-title !gap-2 shrink-0 after:hidden" for="preset">Règles</label>
      <div class="relative min-w-0 flex-1">
        <ThemedSelect id="preset" label="Préréglage de règles" testid="preset-select" value={preset} options={PRESETS.map(p=>({value:p.id,label:p.name}))} onchange={pickPreset}/>
        
      </div>
    </div>
    <p class="hint -mt-1 text-center" data-testid="preset-hint">{presetHint}</p>
    <button class="rules-codex" onclick={()=>openCodex()}>Consulter les cartes <span aria-hidden="true">↗</span></button>
    <DealsSelect {rules} seats={bots.length + 1} onchange={(r) => (rules = r)} />
    {#if preset === 'custom'}
      <!-- CT-23 : le jeu de base, l'extension et les cartes maison sont trois familles, pas un bloc continu. -->
      <div class="rule-groups flex flex-col gap-2" data-two-players={twoPlayers || undefined} data-testid="rule-groups">
        <RuleToggles {rules} seats={bots.length + 1} onchange={(r) => (rules = r)} oninfo={(m) => (info = m)} />
        {#if twoPlayers}
          <p class="two-restriction" data-testid="two-player-muted">À deux, le 15 joker et le Supplice de la planche restent au fond du paquet, allumés ou non — et les 0/14 avec eux.</p>
        {/if}
      </div>
    {/if}
    <SavedModes {rules} seats={bots.length + 1} onapply={(next) => { rules = next; customOpen = true; }} />
  </div>

  </details>
  {#if deckProblem}<p role="alert" class="panel-parchment">{deckProblem}</p>{/if}
  <div class="sticky-cta lobby-cta">
    <button type="button" class="btn-tavern btn-tavern-lg w-full" onclick={launch} disabled={!!deckProblem} data-testid="launch" data-clac="non">
      <span class="ico"><Icon name="arrowRight" size={22} /></span>
      <span class="lbl"><span>Commencer la partie</span><span class="hint">{!hasName ? 'Ton nom de pirate d’abord' : `${rounds} manche${rounds > 1 ? 's' : ''} · ${bots.length + 1}${ghost ? ' + Vieux Loup' : ''} à table`}</span></span>
    </button>
  </div>
</section>

{#if info}
  <!-- Une règle se bascule aussi depuis sa fiche : deux chemins, un seul son (`sonnerBascule`). -->
  <RuleInfoSheet meta={info} on={isRuleOn(rules, info)} canToggle ontoggle={() => { if (!info) return; sonnerBascule(rules, info, bots.length + 1); rules = toggleRule(rules, info); }} oncancel={() => (info = null)} />
{/if}
{#if guard}
  <ResumeGuard summary={resumableOfflineSummary()} onresume={resumeSaved} onrestart={start} oncancel={() => (guard = false)} />
{/if}
{#if twoInfo}
  <Sheet title={ghost ? 'Vieux Loup, règle standard à deux' : 'À deux, sans Vieux Loup'} oncancel={() => (twoInfo = false)} testid="two-player-sheet">
    {#if ghost}
      <p class="text-sm leading-snug">{GHOST_RULE_FR}</p>
      <p class="text-sm leading-snug">{TWO_PLAYER_REMOVED_FR}</p>
      <p class="hint text-center !text-[0.8rem]">L’option Vieux Loup l’écarte : on joue alors à deux mains, variante simplifiée.</p>
    {:else}
      <p class="text-sm leading-snug">{TWO_PLAYER_VARIANT_FR}</p>
      <p class="hint text-center !text-[0.8rem]">Vieux Loup est le troisième joueur fantôme de la règle standard à deux : remets-le à table avec l’option Vieux Loup.</p>
    {/if}
    <button type="button" class="btn-primary gap-2 py-3" onclick={() => (twoInfo = false)} aria-label="Fermer — Compris" data-autofocus><Icon name="check" size={20} /><span>Compris</span></button>
  </Sheet>
{/if}

<style>
  .rules-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;cursor:pointer;color:#f1d28a;font-size:18px;list-style:none}
  .rules-summary::-webkit-details-marker{display:none}.rules-summary small{display:block;font-size:14px;color:#d5c5a7}.rules-chevron{font-size:24px}.rules-panel[open] .rules-chevron{transform:rotate(180deg)}
  .rules-panel[open] .rules-summary{margin-bottom:12px}.rules-codex{align-self:flex-start;min-height:44px;color:#ecd29f;text-decoration:underline;text-underline-offset:4px}
  section:has(.rules-panel[open]) .sticky-cta{position:static}

  /* CT-07 — la restriction officielle à deux, sur le bois du panneau. */
  .two-restriction {
    font-family: var(--font-body);
    font-size: 0.78rem;
    line-height: 1.3;
    color: #ecd9ae;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.7);
  }

  /* CT-07 — à deux, ces deux cartes ne sont pas dans le paquet : l'interrupteur reste, l'illusion part. */
  .rule-groups[data-two-players] :global([data-rule='wild15']),
  .rule-groups[data-two-players] :global([data-rule='plank']) {
    opacity: 0.5;
    filter: grayscale(0.65);
  }
</style>
