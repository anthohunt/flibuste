<script lang="ts">
  import ThemedSelect from '../components/ThemedSelect.svelte';
  // Salle en ligne, épurée (D1) : code + « Partager », la tablée, « Règles : Classique ▾ », manches, rythme, « Lancer »
  // collé en bas. Invités : lecture seule (« Seul le capitaine règle la table » au tap). « Capitaine : Anne » + son
  // état de connexion (C4, D7). Niveau des pirates de bois au tap (D6). Notifications seulement « Au fil de l'eau »,
  // après un tap explicite (D5). Ré-audit 2026-09-06 : « Retirer » confirme (#4), Précédent ouvre « Quitter le
  // salon ? » (#8), partage sans presse-papiers = feuille avec le lien (#11), « i » sur « Temps par tour » et sur la
  // variante à deux (#19), select ≥ 44 px (#23), pied fixe qui ne cache rien (#24).
  // Vague 5 (2026-09-06) : « Partager » ouvre la feuille d'invitation (lien + QR + code), les manches sont les
  // variantes classiques (`DealsSelect` → `rules.deals`), Vieux Loup s'assoit en troisième à deux (`rules.ghost`).
  // Vague 1 (2026-09-07) : le code de la table se lit ENTIER — « Partager » est passé sous lui, plus aucune plaque
  // ne recouvre la dernière lettre (UX-01) ; l'aperçu des manches connaît le nombre de sièges (FONC-05) ; la
  // restriction officielle à deux est annoncée dans les deux variantes (CT-07) ; la grille des cartes-règles dit
  // où finit le jeu de base et où commence l'extension (CT-23).
  // Vague 3 (2026-09-08) : le salon se souvient (FONC-03). Les règles, le plan, le rythme et les pirates de bois
  // vivent sur le serveur et reviennent seuls après un F5 — mesuré. La SEULE chose que le protocole ne porte pas,
  // c'est le choix « Personnalisée » du capitaine tant qu'aucune carte-règle n'a bougé : on le garde ici.
  //
  // CE QUI A QUITTÉ CET ÉCRAN, et ne doit pas y revenir : il portait à lui seul DEUX portes de service — un lien
  // « Un bug ? Une idée ? » posé deux fois (une pendant l'attente, une sous la tablée) et le codex en tête. Elles
  // rattrapaient un vrai manque : c'était l'un des rares écrans sans aucune issue, et il fallait sortir vers la
  // taverne, donc perdre la salle qu'on essayait justement de signaler. L'en-tête permanent (`AppHeader`) les
  // porte maintenant au-dessus de TOUS les écrans — donc ici aussi, y compris pendant « On approche une
  // chaise… », qui est justement le moment où quelque chose ne se passe pas. Les redessiner ici ferait deux
  // portes pour un geste, à deux places qui changent selon l'écran : ce que l'en-tête existe pour supprimer.
  import { onMount } from 'svelte';
  import { href, navigate } from '../lib/router.svelte';
  import { game, loadLobbyCustom, saveLobbyCustom, showToast } from '../lib/store.svelte';
  import { addBot, askPush, ensureRoom, hostConnected, hostName, isHost, leaveRoom, online, removeSeat, setBot, setRules, startRoom } from '../lib/online.svelte';
  import { roomMaxPlayers, type TimerMode } from '../lib/protocol';
  import { BOT_LEVELS, LEVEL_NAME, isBotLevel, levelOf, type BotLevel } from '../lib/botProfile';
  import { TWO_PLAYER_VARIANT_FR, customDeckProblem } from '@flibuste/engine';
  import { TIMER_META, isRuleOn, toggleRule, type RuleMeta, type RulesV2 } from '../lib/rulesMeta';
  import { GHOST_RULE_FR, TWO_PLAYER_REMOVED_FR, ghostOn, roundsOf } from '../lib/variants';
  import { PRESETS, applyPreset, presetOf, type Preset } from '../lib/presets';
  import { play } from '../lib/audio.svelte';
  import { longpress } from '../lib/tip.svelte';
  import { radiogroup } from '../lib/radiogroup';
  import Icon from '../components/Icon.svelte';
  import RuleToggles, { sonnerBascule } from '../components/RuleToggles.svelte';
  import RuleInfoSheet from '../components/RuleInfoSheet.svelte';
  import QuitDialog from '../components/QuitDialog.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import ShareSheet from '../components/ShareSheet.svelte';
  import Sheet, { clac } from '../components/Sheet.svelte';
  import SpectatorBanner from '../components/SpectatorBanner.svelte';
  import SeatGrid, { type SeatItem } from '../components/SeatGrid.svelte';
  import DealsSelect from '../components/DealsSelect.svelte';
  import SavedModes from '../components/SavedModes.svelte';

  let { code }: { code: string } = $props();

  const room = $derived(online.room?.code === code ? online.room : null);
  const host = $derived(isHost());
  const me = $derived(game.identity.playerId);
  const captain = $derived(hostName(room));
  /** Lien d'invitation : `#/join/CODE?de=Capitaine` — l'invitation dit qui invite. */
  const joinUrl = $derived(`${location.origin}/${href('join', { code, ...(room ? { de: captain } : {}) })}`);
  const captainOnline = $derived(hostConnected(room));

  /** Les règles font foi côté serveur (il valide et renvoie `expansion` ; la clé est omise quand tout est éteint). */
  const rules = $derived<RulesV2>(room ? room.rules : { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 10 });
  /**
   * Sièges : LE SERVEUR LE DIT, et on n'en discute pas. Refaire ici la formule du plafond, c'était se
   * donner un deuxième avis qui pouvait le contredire — mesuré : le salon proposait 9 places là où le
   * serveur répondait « La table est pleine » au 9e. `roomMaxPlayers` replie sur 8 tant qu'aucune
   * `RoomView` n'est arrivée, c'est-à-dire tant qu'il n'y a aucun siège à dessiner.
   */
  const maxSeats = $derived(roomMaxPlayers(room));
  const deckProblem = $derived(room && room.seats.length >= 2 ? customDeckProblem(rules, room.seats.length) : null);
  const canStart = $derived(host && !!room && room.seats.length >= 2 && !deckProblem);
  const rounds = $derived(roundsOf(rules));
  /** À deux : Vieux Loup, le troisième joueur fantôme de la règle standard (ON par défaut). */
  const twoPlayers = $derived(room?.seats.length === 2);
  const ghost = $derived(ghostOn(rules, room?.seats.length ?? 0));
  const botSeats = $derived((room?.seats ?? []).filter((seat) => seat.playerId === null && seat.botLevel));
  // Les profils de la salle sont la source commune : rechargement, invité et nouvel hôte voient
  // tous le même niveau, sans préférence privée qui pourrait écraser le choix du capitaine.
  const commonBotLevel = $derived.by((): BotLevel | null => {
    if (!botSeats.length) return 'normal';
    const levels = botSeats.map((seat) => seat.botProfile ? levelOf(seat.botProfile) : seat.botLevel);
    const first = levels[0];
    return isBotLevel(first) && levels.every((level) => level === first) ? first : null;
  });
  let requestedBotLevel = $state<{ code: string; host: string; level: BotLevel } | null>(null);
  const pendingBotLevel = $derived(host && requestedBotLevel?.code === code && requestedBotLevel.host === room?.host ? requestedBotLevel.level : null);
  const botLevel = $derived(pendingBotLevel ?? commonBotLevel ?? 'mixed');
  $effect(() => {
    if (requestedBotLevel && (!host || requestedBotLevel.code !== code || requestedBotLevel.host !== room?.host || online.conn !== 'open' || commonBotLevel === requestedBotLevel.level || !botSeats.length)) requestedBotLevel = null;
  });
  // Les échos de setBot arrivent siège par siège. Garder le choix pendant cet aller-retour évite
  // qu'un ajout rapide prenne un niveau intermédiaire ; en cas de refus, la salle reprend la main.
  $effect(() => {
    if (!requestedBotLevel) return;
    const timer = setTimeout(() => { requestedBotLevel = null; }, 5000);
    return () => clearTimeout(timer);
  });

  /**
   * FONC-03 — « Personnalisée » est un choix du capitaine, pas une propriété des règles : tant qu'aucune carte-règle
   * n'a bougé, `presetOf` renvoie « Classique » et la grille se refermait au premier F5. Le choix est mémorisé pour
   * la table courante (par son code) et repris à la reprise de la salle.
   */
  const customMemo = $derived(loadLobbyCustom(code));
  /** `null` tant que le capitaine n'a pas touché au sélecteur pendant cette visite : c'est la mémoire qui parle. */
  let customTouche = $state<boolean | null>(null);
  const customOpen = $derived(customTouche ?? customMemo);
  $effect(() => {
    saveLobbyCustom(code, customOpen);
  });
  const preset = $derived<Preset>(customOpen && host ? 'custom' : presetOf(rules));
  const presetHint = $derived(PRESETS.find((p) => p.id === preset)?.hint ?? '');
  const showGrid = $derived(preset === 'custom');

  const seats = $derived<SeatItem[]>(
    (room?.seats ?? []).map((s) => ({
      key: String(s.idx),
      name: s.name,
      host: s.playerId === room?.host,
      botLevel: s.botLevel ? (s.botProfile ? levelOf(s.botProfile) : s.botLevel) : null,
      connected: s.playerId ? s.connected : null,
      me: s.playerId === me,
      removable: host && s.playerId !== me,
      tappable: false,
    })),
  );

  let info = $state<RuleMeta | null>(null);
  let confirmLeave = $state(false);
  /** Feuilles du ré-audit : « Retirer X ? » (#4), partage (#11), « Temps par tour » et variante à deux (#19). */
  let removing = $state<number | null>(null);
  let shareOpen = $state(false);
  let timerInfo = $state(false);
  let twoInfo = $state(false);
  const removingSeat = $derived(removing !== null ? (room?.seats.find((s) => s.idx === removing) ?? null) : null);
  /** Précédent du navigateur (App.guardBack) demande la feuille « Quitter le salon ? » (#8). */
  const leavePrompt = $derived(confirmLeave || online.quitPrompt);

  onMount(() => ensureRoom(code));

  /** « Retirer » : un bot part tout de suite ; un humain, après confirmation (#4). */
  function askRemove(key: string) {
    const idx = Number(key);
    const seat = room?.seats.find((s) => s.idx === idx);
    if (!seat) return;
    if (seat.playerId === null) {
      // On range un mannequin — franc, sans drame. Le siège d'un HUMAIN ne sonne pas ici : la feuille de
      // confirmation s'ouvre d'abord, et c'est le serveur qui dira son départ (`sonnerPresences` →
      // `joueur-parti`), les sièges de bots étant justement exclus de ce calcul (online.svelte.ts:330).
      play('bot-retire');
      removeSeat(seat);
    } else removing = idx;
  }
  function confirmRemove() {
    // Le siège est relu MAINTENANT : entre l'ouverture de la feuille « Retirer X ? » et le « Oui », la
    // table a pu bouger. C'est son identité qui part au serveur, pas la place qu'il occupait alors.
    if (removingSeat) removeSeat(removingSeat);
    removing = null;
  }
  function closeLeave() {
    confirmLeave = false;
    online.quitPrompt = false;
  }

  /**
   * Ce n'est pas une faute de l'invité, c'est un droit qu'il n'a pas : le verrou de laiton, jamais un buzzer.
   * Il couvre d'un coup tout ce qu'un non-capitaine peut toucher ici (les règles, le préréglage, Vieux Loup, le
   * temps par tour, les sièges, les deux curseurs des manches) — sans lui, l'invité qui explore les réglages
   * n'entendait RIEN du tout, ces surfaces ayant déjà leur `data-clac="non"`. Le toast, lui, se tait côté son
   * (`Toast.svelte`) en supposant que le geste a sonné : ici c'est ce `play` qui rend cette supposition vraie.
   * La garde du slot (500 ms) suffit au martèlement, on peut le tapoter dix fois de suite.
   */
  const blocked = () => {
    play('refus-droit');
    showToast('Seul le capitaine règle la table');
  };

  function onrules(next: RulesV2) {
    if (!room || !host) return blocked();
    setRules(next, room.timerMode);
  }
  function pickPreset(value: string) {
    const id = value as Preset;
    if (!room || !host) {
      return blocked();
    }
    // Un préréglage bascule jusqu'à treize cartes d'un coup : un son composé, jamais treize interrupteurs.
    // « Personnalisée » ne change aucune règle, elle déplie la grille — le même geste, en plus court.
    if (id === 'custom') {
      play('plan-de-table', { gain: 0.55 });
      customTouche = true;
      return;
    }
    play('plan-de-table');
    customTouche = false;
    setRules(applyPreset(rules, id), room.timerMode);
  }
  /** Le siège de Vieux Loup EST un interrupteur de règle : même son que la grille. */
  function toggleGhost() {
    if (!room || !host) return blocked();
    play(ghost ? 'regle-eteinte' : 'regle-allumee');
    setRules({ ...rules, ghost: !ghost }, room.timerMode);
  }
  function setTimer(mode: TimerMode) {
    if (!room || !host) return blocked();
    if (room.timerMode === mode) return; // le rythme est déjà celui-là : rien ne change, rien ne sonne
    play('plan-de-table'); // le sablier retourné : c'est le plan de la table qui change, pas un bouton
    setRules({ ...rules }, mode);
  }
  function addDefaultBot() {
    if (!host) return blocked();
    play('bot-assis');
    addBot(pendingBotLevel ?? commonBotLevel ?? 'normal');
  }
  function setBotDifficulty(value: string) {
    if (!room || !host) return blocked();
    if (!isBotLevel(value)) return;
    requestedBotLevel = { code, host: room.host, level: value };
    play('bot-niveau-choisi');
    for (const seat of botSeats) setBot(seat, value);
  }

  /** Partager = la feuille d'invitation : le lien en gros, un QR code, le code à dicter, « Copier » / « Partager ». */
  function share() {
    shareOpen = true;
  }

  /** La cloche de bord, et rien quand le départ n'a pas lieu — un son ne ment jamais sur le départ. Le capitaine
   *  ne doit l'entendre qu'UNE fois : son bouton et la bascule de statut sont le même événement. */
  function start() {
    if (!canStart) {
      showToast(deckProblem ?? 'Il faut au moins 2 joueurs');
      return;
    }
    play('partie-lancee');
    startRoom();
  }
</script>

<section class="flex flex-1 flex-col gap-4" data-room={code} data-testid="lobby-online" use:clac>
  <header class="flex items-center gap-3">
    <button type="button" class="icon-btn" onclick={() => (confirmLeave = true)} aria-label="Quitter la table" data-testid="leave">
      <Icon name="exit" size={22} />
    </button>
    <div class="flex min-w-0 flex-1 flex-col">
      <h1 class="title text-3xl leading-none" tabindex="-1">Ta salle</h1>
      {#if room}
        <span class="hint flex items-center gap-1.5" data-testid="host-line">
          <Icon name="crown" size={13} class="text-gold-300" />
          <span class="truncate">Capitaine : <strong class="not-italic">{host ? 'toi' : captain}</strong></span>
          {#if !captainOnline}
            <span class="rounded bg-rum-600/80 px-1 text-xs font-bold not-italic uppercase tracking-wide text-parchment">déconnecté</span>
          {/if}
        </span>
      {:else}
        <span class="hint">On approche une chaise…</span>
      {/if}
    </div>
    <span class="lantern !h-9 !w-9" class:is-on={online.conn === 'open'} role="status" aria-live="polite" aria-label={online.conn === 'open' ? 'Connecté' : 'Connexion…'} data-conn={online.conn}>
      {#if online.conn === 'open'}
        <Icon name="link" size={16} />
      {:else}
        <Icon name="wifiOff" size={16} />
      {/if}
    </span>
  </header>

  <!-- Le code de la table : un parchemin scellé à la cire, à partager. « Partager » est SOUS le code (UX-01) :
       la plaque du bouton recouvrait la 6e lettre, et le capitaine en dictait cinq. -->
  <div class="panel-parchment flex flex-col gap-2 py-2.5">
    <div class="flex items-center gap-3">
      <span class="wax-seal" aria-hidden="true"><Icon name="skull" size={22} /></span>
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="hint !text-[0.8rem]">Invitation · {host ? 'Tu es l’hôte' : 'Invité'}</span>
        <span class="code-text room-code !text-ink-900 leading-none" data-testid="room-code">{code}</span>
      </div>
    </div>
    <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center w-full" onclick={share} aria-label="Partager le lien" data-testid="share" use:longpress={{ title: 'Inviter', text: 'Le lien d’invitation, un QR code et le code à dicter.' }}>
      <Icon name="share" size={18} />
      <span>Partager l’invitation</span>
    </button>
  </div>

  {#if !room}
    <p class="hint text-center" aria-live="polite">On approche une chaise…</p>
  {:else}
    <div class="panel-wood flex flex-col gap-2">
      <h2 class="panel-title">{room.seats.length} joueur{room.seats.length>1?'s':''} à table</h2>
      <div data-clac={host ? undefined : 'non'}>
        <SeatGrid list {seats} canAdd={host} max={maxSeats} onadd={addDefaultBot} onremove={askRemove} ghost={twoPlayers ? { on: ghost, canToggle: host, ontoggle: toggleGhost, onblocked: blocked } : null} />
      </div>
      {#if botSeats.length}
        <label class="panel-title mt-2" for="online-bot-level">Difficulté des bots</label>
        <ThemedSelect id="online-bot-level" label="Difficulté des bots" testid="online-bot-level" value={botLevel}
          options={[...(botLevel === 'mixed' ? [{ value: 'mixed', label: 'Niveaux différents', disabled: true }] : []), ...BOT_LEVELS.map((level) => ({ value: level, label: LEVEL_NAME[level] }))]}
          onchange={setBotDifficulty} disabled={!host} onblocked={blocked}/>
        {#if botLevel === 'mixed'}<p class="hint text-center">Le capitaine peut choisir un niveau commun.</p>{/if}
      {/if}
      {#if twoPlayers}
        <p class="hint flex items-center justify-center gap-1.5 text-center !text-[0.8rem]" data-testid="two-player-note" data-ghost={ghost}>
          <span>{ghost ? 'À deux, Vieux Loup tient la troisième main (règle standard).' : 'À deux sans Vieux Loup : variante simplifiée.'}</span>
          <button type="button" class="info-dot" onclick={() => (twoInfo = true)} aria-label="Qu’est-ce que Vieux Loup ?" data-testid="two-player-info">i</button>
        </p>
        <!-- CT-07 : la restriction officielle vaut avec ou sans Vieux Loup ; elle ne se disait que dans la variante sans lui. -->
        <p class="two-restriction text-center" data-testid="two-player-restriction">{TWO_PLAYER_REMOVED_FR}</p>
      {/if}
    </div>

    <SpectatorBanner />

    <details class="panel-wood" data-testid="rules-settings"><summary class="panel-title cursor-pointer min-h-11">Règles · {PRESETS.find(p=>p.id===preset)?.name} · {rounds} manches</summary>
    <div class="flex flex-col gap-3" data-readonly={!host || undefined}>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <label class="panel-title !gap-2 shrink-0 after:hidden" for="preset">Règles</label>
        <div class="relative min-w-0 flex-1">
          <ThemedSelect id="preset" label="Préréglage de règles" testid="preset-select" value={preset} options={PRESETS.map(p=>({value:p.id,label:p.name}))} onchange={pickPreset} disabled={!host} onblocked={blocked}/>
          
        </div>
      </div>
      <p class="hint -mt-1 text-center" data-testid="preset-hint">{host ? presetHint : 'Seul le capitaine règle la table'}</p>
      <DealsSelect {rules} seats={room.seats.length} disabled={!host} onchange={onrules} onblocked={blocked} />
      {#if showGrid}
        <!-- CT-23 : le jeu de base, l'extension et les cartes maison sont trois familles, pas un bloc continu. -->
        <div class="rule-groups flex flex-col gap-2" data-two-players={twoPlayers || undefined} data-testid="rule-groups">
          <RuleToggles {rules} seats={room.seats.length} disabled={!host} onchange={onrules} oninfo={(m) => (info = m)} onblocked={blocked} />
          {#if twoPlayers}
            <p class="two-restriction" data-testid="two-player-muted">À deux, le 15 joker et le Supplice de la planche restent au fond du paquet, allumés ou non — et les 0/14 avec eux.</p>
          {/if}
        </div>
      {/if}
      {#if host}<SavedModes {rules} seats={room.seats.length} onapply={(next) => { customTouche = true; onrules(next); }} />{/if}
      <div class="flex flex-col gap-1.5">
        <span class="hint flex items-center gap-1.5" id="timer-label">
          <span>Temps par tour</span>
          <button type="button" class="info-dot" onclick={() => (timerInfo = true)} aria-label="Temps par tour : explications" data-testid="timer-info">i</button>
        </span>
        <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-label="Temps par tour" use:radiogroup>
          {#each TIMER_META as t (t.mode)}
            <button type="button" role="radio" aria-checked={room.timerMode === t.mode} aria-label={t.name} aria-disabled={host ? undefined : 'true'} class="lantern !h-auto !min-h-11 !w-full flex-col !gap-0.5 !py-1.5" class:saturate-50={!host} data-timer={t.mode} data-clac="non" tabindex={room.timerMode === t.mode ? 0 : -1} onclick={() => setTimer(t.mode)} use:longpress={{ title: t.name, text: t.rule }}>
              <Icon name={t.icon} size={18} />
              <span class="text-xs leading-tight font-bold">{t.name}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>

    </details>
    {#if room.timerMode === 'async' && online.push !== 'on' && online.push !== 'unsupported'}
      <div class="flex flex-col items-center gap-1.5" data-testid="push-offer">
        <p class="hint text-center !text-[0.85rem]">Au fil de l’eau : chacun joue quand il peut. On peut te prévenir à ton tour.</p>
        <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={askPush} disabled={online.push === 'busy'} aria-label="Me prévenir quand c’est mon tour">
          <Icon name="bell" size={18} />
          <span>{online.push === 'busy' ? 'Un instant…' : 'Me prévenir à mon tour'}</span>
        </button>
      </div>
    {/if}

    {#if deckProblem}<p role="alert" class="panel-parchment">{deckProblem}</p>{/if}
    <div class="sticky-cta lobby-cta mt-auto">
      {#if host}
        <button type="button" class="btn-tavern btn-tavern-lg w-full" onclick={start} disabled={!canStart} data-testid="launch" data-clac="non">
          <span class="ico"><Icon name="arrowRight" size={22} /></span>
          <span class="lbl"><span>{canStart ? `Lancer avec ces ${room.seats.length} joueurs` : deckProblem ? 'Ajuste le paquet' : 'En attente d’un deuxième joueur'}</span><span class="hint">{canStart ? `${rounds} manche${rounds > 1 ? 's' : ''} · ${room.seats.length}${ghost ? ' + Vieux Loup' : ''} à table` : 'Il faut au moins 2 joueurs'}</span></span>
        </button>
      {:else}
        <p class="hint flex items-center justify-center gap-2 py-4 !text-base" aria-live="polite" data-testid="waiting-host">
          <Icon name="crown" size={18} class="text-gold-300" />
          <span>L’hôte va lancer la partie<span class="animate-pulse">…</span></span>
        </p>
      {/if}
    </div>
  {/if}
</section>

{#if info}
  <!-- Une règle se bascule aussi depuis sa fiche : deux chemins, un seul son (`sonnerBascule`). -->
  <RuleInfoSheet meta={info} on={isRuleOn(rules, info)} canToggle={host} ontoggle={() => { if (!info) return; if (host) sonnerBascule(rules, info, room?.seats.length ?? 0); onrules(toggleRule(rules, info)); }} oncancel={() => (info = null)} />
{/if}

{#if leavePrompt}
  <QuitDialog lobby {code} onstay={closeLeave} onquit={() => { play('table-quittee'); closeLeave(); leaveRoom(); }} />
{/if}
{#if removingSeat}
  <ConfirmDialog title="Retirer {removingSeat.name} de la table ?" text="Il pourra revenir avec le code de la table." confirm="Retirer" icon="trash" danger testid="remove-dialog" onconfirm={confirmRemove} oncancel={() => (removing = null)} />
{/if}
{#if shareOpen}
  <ShareSheet url={joinUrl} {code} oncancel={() => (shareOpen = false)} oncopied={(ok) => { shareOpen = false; showToast(ok ? 'Lien copié' : 'Sélectionne le lien et copie-le'); }} />
{/if}
{#if timerInfo}
  <Sheet title="Temps par tour" oncancel={() => (timerInfo = false)} testid="timer-info-sheet">
    <p class="hint -mt-2 text-center">Ce que fait la table quand un pirate tarde à jouer.</p>
    <ul class="flex flex-col gap-2">
      {#each TIMER_META as t (t.mode)}
        <li class="flex items-start gap-2 text-sm"><Icon name={t.icon} size={18} class="mt-0.5 shrink-0 text-gold-300" /><span><strong>{t.name}</strong> — {t.rule}</span></li>
      {/each}
    </ul>
    <button type="button" class="btn-primary gap-2 py-3" onclick={() => (timerInfo = false)} aria-label="Fermer — Compris" data-autofocus><Icon name="check" size={20} /><span>Compris</span></button>
  </Sheet>
{/if}
{#if twoInfo}
  <Sheet title={ghost ? 'Vieux Loup, règle standard à deux' : 'À deux, sans Vieux Loup'} oncancel={() => (twoInfo = false)} testid="two-player-sheet">
    {#if ghost}
      <p class="text-sm leading-snug">{GHOST_RULE_FR}</p>
      <p class="text-sm leading-snug">{TWO_PLAYER_REMOVED_FR}</p>
      <p class="hint text-center !text-[0.8rem]">Le capitaine peut l’écarter avec l’interrupteur de son siège : on joue alors à deux mains, variante simplifiée.</p>
    {:else}
      <p class="text-sm leading-snug">{TWO_PLAYER_VARIANT_FR}</p>
      <p class="hint text-center !text-[0.8rem]">Vieux Loup est le troisième joueur fantôme de la règle standard à deux : remets-le à table avec l’interrupteur de son siège.</p>
    {/if}
    <button type="button" class="btn-primary gap-2 py-3" onclick={() => (twoInfo = false)} aria-label="Fermer — Compris" data-autofocus><Icon name="check" size={20} /><span>Compris</span></button>
  </Sheet>
{/if}

<style>
  /* UX-01 — le code doit tenir en entier, même en « WWWWWW » sur un écran de 320 px : corps et interlettrage
     bornés, et plus rien au-dessus de la dernière lettre (le bouton est passé sous le code). */
  .room-code {
    font-size: clamp(1.55rem, 7.6vw, 2.3rem);
    letter-spacing: 0.16em;
    text-indent: 0.16em;
    white-space: nowrap;
    text-shadow: 0 1px 0 rgba(255, 250, 230, 0.6);
  }

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
