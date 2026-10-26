<script module lang="ts">
  /**
   * La manche dont le registre a déjà été écrit à l'oreille vit ICI, hors de toute instance : `App.svelte`
   * reconstruit l'écran à chaque changement de route (`{#key screenKey}`), et une mémoire d'instance ferait
   * réécrire TOUT le registre — `score-ouvre` compris — au premier chemin qui rouvre une manche déjà vue (un
   * bouton « revoir la manche », une navigation en ligne rejouée). Même patron, et même testabilité, que
   * `oublierLeSon()` de `Table.svelte`.
   */
  let egrene = 0;

  /** Table sans partie : on oublie la manche écrite, sinon la manche 1 de la suivante resterait muette. */
  export function oublierLeRegistre(): void {
    egrene = 0;
  }
</script>

<script lang="ts">
  // Registre de manche : une ligne par joueur. En solo, « Manche suivante » ; en ligne, « Prêt » + « 2/3 prêts »
  // (C6) — le passage à la manche suivante vient du serveur quand tous les humains connectés sont prêts.
  //
  // Vague 3.A (FONC-01, UX-14) — cet écran ne disait RIEN de l'absence. Mesuré à l'évaluation : cinq secondes
  // après que Charlie a fermé son onglet, la capture était identique octet pour octet (md5 87037e7d…) ; le
  // compteur affichait « 2/3 prêts » à l'instant où la manche démarrait, parce qu'il comptait tout siège ayant
  // un `playerId` au lieu de la règle du serveur (`room.ts` `checkReady` : humains CONNECTÉS et NON auto) ; et
  // un siège repris par un pirate de bois restait présenté comme humain. Trois choses maintenant :
  //   1. chaque ligne du registre porte l'état de son siège (`ScoreRow presence`) ;
  //   2. le compteur compte « prêts / présents », et dit en toutes lettres sans qui la manche partira ;
  //   3. la bannière d'absence et « Remplacer par un bot » — qui ne vivaient qu'à la table — sont ici aussi,
  //      avec une cible de 44 px (UX-14 : elle mesurait 149 × 23 px).
  import { onDestroy, untrack } from 'svelte';
  import { navigate } from '../lib/router.svelte';
  import { game, nameOf, nextRound, quitGame } from '../lib/store.svelte';
  import { humansOf, joinNames, leaveRoom, online, ready, readyList, readyTally, replaceSeat, seatPresence } from '../lib/online.svelte';
  import { absences } from '../lib/presence';
  import { announce } from '../lib/live.svelte';
  import { longpress } from '../lib/tip.svelte';
  import { cardsInRound, roundsOf } from '../lib/variants';
  import { bonusGlyphs, fmtPoints, fmtTotal, sealLegend, SEAL } from '../lib/scoreMeta';
  import { play, type SlotId } from '../lib/audio.svelte';
  import type { RoundScore } from '../lib/types';
  import Icon from '../components/Icon.svelte';
  import ScoreRow from '../components/ScoreRow.svelte';
  import Avatar from '../components/Avatar.svelte';
  import { clac } from '../components/Sheet.svelte';
  import QuitDialog from '../components/QuitDialog.svelte';
  import SpectatorBanner from '../components/SpectatorBanner.svelte';

  const v = $derived(game.view);
  const names = $derived(game.names);
  const rows = $derived.by(() => {
    if (!v) return [];
    return [...v.lastRoundScores].map((r) => ({ ...r, cumul: v.scores[r.player] ?? 0 })).sort((a, b) => b.cumul - a.cumul);
  });
  const mine = $derived(rows.find(r=>r.player===v?.me));
  let ledgerScroll = $state<HTMLDivElement>();
  let visibleRanks = $state('');
  let canScroll = $state(false);
  let hasMoreBelow = $state(false);

  function measureLedger() {
    if (!ledgerScroll) return;
    const viewport = ledgerScroll.getBoundingClientRect();
    const headerHeight = ledgerScroll.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    const visible = [...ledgerScroll.querySelectorAll<HTMLTableRowElement>('.ledger-table tbody tr')]
      .flatMap((row, index) => {
        const rect = row.getBoundingClientRect();
        return rect.top >= viewport.top + headerHeight - 1 && rect.bottom <= viewport.bottom + 1 ? [index + 1] : [];
      });
    visibleRanks = visible.length ? `${visible[0]}–${visible.at(-1)}` : '';
    canScroll = ledgerScroll.scrollHeight > ledgerScroll.clientHeight + 2;
    hasMoreBelow = ledgerScroll.scrollTop + ledgerScroll.clientHeight < ledgerScroll.scrollHeight - 2;
  }

  $effect(() => {
    rows;
    if (!ledgerScroll) return;
    if (typeof ResizeObserver === 'undefined') { measureLedger(); return; }
    const observer = new ResizeObserver(measureLedger);
    observer.observe(ledgerScroll);
    const table = ledgerScroll.querySelector('table');
    if (table) observer.observe(table);
    measureLedger();
    return () => observer.disconnect();
  });

  function showMyRow() {
    if (!ledgerScroll) return;
    const row = ledgerScroll.querySelector<HTMLTableRowElement>('tr.is-me');
    if (!row) return;
    const headerHeight = ledgerScroll.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    ledgerScroll.scrollTo({ top: ledgerScroll.scrollTop + row.getBoundingClientRect().top - ledgerScroll.getBoundingClientRect().top - headerHeight });
    row.focus({ preventScroll: true });
    measureLedger();
  }
  const lastRound = $derived(v ? (v.lastRoundScores[0]?.round ?? v.round) : 0);
  /** « Calico Jack mène de 140 points · 5 manches restantes » — l'état de la partie, en une ligne. */
  const standing = $derived.by(() => {
    if (rows.length < 2) return '';
    const [first, second] = rows;
    const gap = first!.cumul - second!.cumul;
    const left = Math.max(0, rounds - lastRound);
    const head = gap === 0 ? `${nameOf(first!.player, names)} et ${nameOf(second!.player, names)} sont à égalité` : `${nameOf(first!.player, names)} mène de ${gap} point${gap > 1 ? 's' : ''}`;
    return `${head} · ${left === 0 ? 'dernière manche jouée' : `${left} manche${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''}`}`;
  });
  /** UX-07 — la légende des sceaux de CETTE manche : chaque espèce présente, nommée et chiffrée, une fois. */
  const legend = $derived(v ? sealLegend(rows.flatMap((r) => bonusGlyphs(r, v.history))) : []);
  /**
   * UX-06 — la grille manche × joueur : ce que le parchemin vide peut porter d'utile. Elle dit d'où vient le
   * cumul de la colonne « Total », manche après manche ; elle n'apparaît qu'à partir de la deuxième manche.
   */
  const grid = $derived.by(() => {
    if (!v || lastRound < 2) return null;
    const numbers = Array.from({ length: lastRound }, (_, i) => i + 1);
    const byPlayer = new Map<string, Map<number, number>>();
    for (const r of v.roundScores) {
      const m = byPlayer.get(r.player) ?? new Map<number, number>();
      m.set(r.round, r.total);
      byPlayer.set(r.player, m);
    }
    return {
      numbers,
      lines: rows.map((r) => ({ player: r.player, name: nameOf(r.player, names), cumul: r.cumul, cells: numbers.map((n) => byPlayer.get(r.player)?.get(n) ?? null) })),
    };
  });
  const rounds = $derived(v ? roundsOf(v.rules) : 0);
  const isLast = $derived(!!v && lastRound >= rounds);
  const nextCards = $derived(v ? cardsInRound(v.rules, lastRound + 1) : 0);

  let sent = $state(false);
  $effect(() => {
    lastRound;
    sent = false;
  });
  function next() {
    if (nextRound()) sent = true;
  }
  const isOnline = $derived(game.mode === 'online');
  const spectator = $derived(isOnline && online.superseded);

  // En ligne : accord de table.
  const me = $derived(game.identity.playerId);
  /** Le serveur joue pour moi : ici, c'est « Prêt » qui rend la main (#10). */
  const autoMe = $derived(isOnline && (game.autoSeats.includes(me) || (!!v && game.autoSeats.includes(v.me))));
  const humans = $derived(humansOf(online.room));
  const readyIds = $derived(readyList(online.room));
  const iAmReady = $derived(sent || readyIds.includes(me));

  /**
   * FONC-01 — la présence, calculée une fois pour tout l'écran par la règle du serveur. `tally.required` est le
   * dénominateur honnête (« prêts / présents ») ; `tally.missing` sont les sièges dont le serveur n'attend rien.
   */
  const presences = $derived(isOnline ? seatPresence(online.room) : []);
  const tally = $derived(readyTally(online.room));
  const readyCount = $derived(isOnline ? tally.ready : readyIds.length);
  const presenceOf = $derived(new Map(presences.filter((s) => s.chip).map((s) => [s.id, { state: s.state, chip: s.chip as string, text: s.text as string }])));
  /** « La manche partira sans Charlie (déconnecté) » — pourquoi le compteur ne montera jamais plus haut. */
  const withoutText = $derived(
    tally.missing.length === 0
      ? ''
      : `${isLast ? 'Le classement' : `La manche ${lastRound + 1}`} partira sans ${joinNames(tally.missing.map((s) => s.name))} — ${tally.missing.length > 1 ? 'ils ne sont plus à la table' : (tally.missing[0]?.text ?? 'absent')}`,
  );

  // Absences : mêmes textes et même compte à rebours qu'à la table (`presence.ts`), rafraîchis chaque seconde.
  let now = $state(Date.now());
  const gone = $derived(isOnline ? absences(online.room, me, now) : []);
  $effect(() => {
    if (gone.length === 0) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(id);
  });

  // L'oreille apprend ce que l'œil vient de voir : dit une fois par manche et par composition d'absents.
  let saidWithout = '';
  $effect(() => {
    const key = `${lastRound}:${tally.missing.map((s) => s.id).join(',')}`;
    if (!withoutText || saidWithout === key) return;
    saidWithout = key;
    announce(`${withoutText}.`, `without:${key}`);
  });

  function sayReady() {
    if (iAmReady) return;
    if (ready()) sent = true;
  }

  // ---------------------------------------------------------------------------
  // Le registre s'égrène
  // ---------------------------------------------------------------------------

  /** Deux crans de salve entre deux lignes, soit 110 ms : rendues toutes ensemble, huit plumes feraient une bouillie. */
  const PAS_LIGNE = 2;
  /** Le parchemin met 320 ms à se dérouler : quatre crans de silence avant que la première ligne s'écrive. */
  const AVANT_REGISTRE = 4;
  /** La ligne d'un adversaire : la même plume, plus sourde, sans la pièce. La hiérarchie n'est pas négociable. */
  const RETRAIT = 0.55;
  /** Au-delà de trois adversaires écrits ligne à ligne, les suivants se fondent en un seul frottement collectif. */
  const ADVERSAIRES_ECRITS = 3;
  /** Plusieurs sceaux par ligne et plusieurs lignes : trois au plus, sinon la cire couvre la plume. */
  const SCEAUX_PAR_LIGNE = 3;

  /**
   * Le pari à 0 n'est pas une variante d'intensité du pari tenu : c'est une AUTRE règle de points (±10 × cartes
   * distribuées, `scoring.ts:73-77`). À la dixième manche il vaut ±100 — le plus gros nombre du jeu, qui
   * sonnerait comme un +20 s'il partageait le son des autres. Une bourse entière, donc, pas une pièce.
   */
  function slotDeLigne(r: RoundScore): SlotId {
    if (r.effectiveBid === 0) return 'pari-zero-inscrit';
    return r.made ? 'pari-tenu-inscrit' : 'pari-rate-inscrit';
  }

  /** Le cran de salve du moteur (`PAS_SALVE`, 55 ms), rejoué ici en minuterie. */
  const CRAN_MS = 55;
  /** Les crans encore à venir. Ils vivent dans l'INSTANCE : c'est l'écran quitté qui les emporte. */
  const aVenir: ReturnType<typeof setTimeout>[] = [];
  /**
   * `onDestroy` et surtout PAS le `return` de l'effet ci-dessous : cet effet se rejoue à chaque vue reçue (un
   * joueur dit « Prêt », un siège décroche, un curseur bouge) et couperait alors son propre registre en cours
   * d'écriture. Ce qu'on coupe, c'est l'écran qu'on quitte, rien d'autre.
   */
  onDestroy(() => {
    for (const t of aVenir) clearTimeout(t);
    aVenir.length = 0;
  });

  /**
   * POURQUOI une minuterie plutôt que le seul `at` du moteur : `play(..., { at })` programme la voix dans le
   * graphe audio et n'en rend AUCUNE poignée — une fois partie, la salve va au bout, écran quitté ou non.
   * Mesuré sur les cinq manches d'une partie : CHAQUE `donne-manche` de la manche suivante arrivait avec un
   * `pari-*-inscrit` du registre précédent à −50…−88 ms et un autre à +22…+60 ms, plus le clac du bouton —
   * quatre à cinq sons dans 150 ms. L'effet du pli fait exactement l'inverse et le documente (`Table.svelte` :
   * « rien ne sonne dans son dos ») ; le registre était le seul endroit où le principe n'était pas tenu.
   *
   * `at` garde son rôle À L'INTÉRIEUR d'un cran : la ligne et ses sceaux doivent rester collés au sample près,
   * et la garde anti-mitraillette du manifeste (60 ms sur les plumes, 40 sur la cire) les refuserait sans lui.
   * D'où le cran d'avance sur la minuterie et le `at` ≥ 1 de tout le groupe : le rythme absolu est au
   * millième celui d'avant, seule la poignée est neuve.
   */
  function programmer(pas: number, jouer: () => void): void {
    const attente = Math.max(0, pas - 1) * CRAN_MS;
    if (attente === 0) {
      jouer();
      return;
    }
    aVenir.push(setTimeout(jouer, attente));
  }

  $effect(() => {
    const manche = lastRound;
    const vue = v;
    const lignes = rows;
    if (!vue) {
      oublierLeRegistre();
      return;
    }
    if (lignes.length === 0 || egrene === manche) return;
    egrene = manche;
    // `play` lit les réglages du son, qui sont des runes : sans `untrack`, bouger un curseur de volume
    // réécrirait tout le registre.
    untrack(() => {
      play('score-ouvre');
      let pas = AVANT_REGISTRE;
      const ecrire = (r: RoundScore, gain: number) => {
        // Les sceaux se posent SUR la ligne, un cran derrière elle. Un sceau ne se dit qu'ICI et jamais à la
        // prise du pli : les bonus ne sont acquis qu'une fois le pari tenu, le son mentirait sur un gain à venir.
        // Et sur une ligne RATÉE il en reste (le Rufus perdu, `scoring.ts:85`) : cire froide, jamais une récompense.
        const sceaux = bonusGlyphs(r, vue.history).slice(0, SCEAUX_PAR_LIGNE);
        programmer(pas, () => {
          play(slotDeLigne(r), { at: 1, gain });
          sceaux.forEach((g, i) => play('sceau-bonus', { at: 2 + i, gain: gain * (r.made && g.points > 0 ? 1 : 0.5) }));
        });
        pas += PAS_LIGNE;
      };
      const autres = lignes.filter((r) => r.player !== vue.me);
      for (const r of autres.slice(0, ADVERSAIRES_ECRITS)) ecrire(r, RETRAIT);
      const reste = autres.slice(ADVERSAIRES_ECRITS);
      if (reste.length) {
        // Un seul frottement pour tout le reste de la tablée, du côté où penche la majorité : à huit joueurs,
        // huit plumes distinctes ne s'entendent plus comme huit lignes, seulement comme du bruit.
        const rates = reste.filter((r) => !r.made).length;
        const collectif = rates * 2 >= reste.length ? 'pari-rate-inscrit' : 'pari-tenu-inscrit';
        programmer(pas, () => play(collectif, { at: 1, gain: RETRAIT }));
        pas += PAS_LIGNE;
      }
      // Ma ligne en DERNIER, et seule à plein volume : on entend d'abord ce qui m'arrive.
      for (const r of lignes.filter((r) => r.player === vue.me)) ecrire(r, 1);
    });
  });
</script>

{#if !v}
  <section class="flex flex-1 flex-col items-center justify-center gap-4" use:clac>
    <p class="hint !text-base">Aucune partie en cours</p>
    <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={() => navigate('home')} aria-label="Retour à la taverne"><Icon name="home" size={18} /><span>Retour à la taverne</span></button>
  </section>
{:else}
  <!-- `min-h-0` : sans lui, la hauteur minimale de la section est celle de son contenu — le registre étoffé
       (décomposition, légende, grille) poussait « Manche suivante » hors de l'écran en 844 × 390. La section
       peut maintenant rétrécir, et c'est le registre qui défile. -->
  <section class="score-screen flex min-h-0 flex-1 flex-col gap-4" data-testid="score" use:clac>
    <!-- Vague 8 (#4) : 44 % de l'écran restaient vides sous le registre. Le registre est centré dans la place
         disponible, le bouton reste en bas. -->
    <div class="score-column flex min-h-0 flex-1 flex-col gap-3">
    <div class="score-overview">
    <header class="score-head flex flex-col items-center pt-2" use:longpress={{ title: `Manche ${lastRound} / ${rounds}`, text: 'Réussi : +20 par pli (pari 0 : +10 × cartes distribuées). Raté : −10 par pli d’écart. Les bonus ne comptent que si le pari est réussi.', tap: true }}>
      <h1 class="title-gold text-4xl leading-none" data-testid="score-round" tabindex="-1">Manche {lastRound} <span class="text-xl">sur {rounds}</span></h1>
    </header>

    <!-- Le parchemin s'étire : c'était 740 px de papier peint de taverne entre le tableau et le bouton (#4).
         Vague 2.B : il en restait 58 % de nu (UX-06), et les trois en-têtes étaient imprimés sur la brûlure du
         coin (2,24:1 et 2,47:1 mesurés). Ils sont maintenant posés sur leur propre bandeau clair, et la place
         libre porte la légende des sceaux (UX-07) et la grille manche × joueur. -->
    {#if mine}
      <div class="personal-result panel-wood" data-testid="personal-result">
        <div class="personal-heading"><h2>{mine.made ? 'Annonce réussie' : 'Annonce manquée'}</h2><strong class="title-gold">{fmtPoints(mine.total)} <span>points</span></strong></div>
        <p>{mine.effectiveBid} pli{mine.effectiveBid > 1 ? 's' : ''} annoncé{mine.effectiveBid > 1 ? 's' : ''} · {mine.tricks} remporté{mine.tricks > 1 ? 's' : ''} · total {fmtTotal(mine.cumul)}</p>
      </div>
    {/if}
    </div>
    <div class="score-ledger panel-parchment flex min-h-0 flex-1 flex-col py-3">
      <div class="ledger-tools"><h2>Résultats · {rows.length} joueurs</h2>{#if mine}<button type="button" onclick={showMyRow} data-testid="show-my-score" aria-label="Voir ma ligne dans le registre">Ma ligne <span aria-hidden="true">↓</span></button>{/if}</div>
      <div class="ledger-viewport">
        <!-- Une zone qui défile doit s'atteindre au clavier (axe `scrollable-region-focusable`, WCAG 2.1.1) :
             sans `tabindex`, la grille et la légende étaient hors d'atteinte pour qui n'a pas de souris. C'est
             le cas prévu par la règle Svelte (« scrollable region »), d'où l'exception, nommée et bornée. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="ledger-scroll flex flex-col gap-3" bind:this={ledgerScroll} onscroll={measureLedger} tabindex="0" role="group" aria-label="Registre de la manche {lastRound}" data-testid="ledger-scroll">
        <table class="ledger-table" aria-label="Scores par joueur" data-testid="ledger">
          <thead>
            <tr>
              <th scope="col" class="head head-who" data-head="capitaine">Capitaine · pari → plis</th>
              <th scope="col" class="head head-delta" data-head="manche">Manche</th>
              <th scope="col" class="head head-total" data-head="total">Total</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as r (r.player)}
              <ScoreRow score={r} name={nameOf(r.player, names)} total={r.cumul} history={v.history} me={r.player === v.me} presence={presenceOf.get(r.player) ?? null} />
            {/each}
          </tbody>
        </table>

        {#if standing}
          <p class="note-line standing" data-testid="standing">{standing}</p>
        {/if}

        <details class="score-details"><summary>Comprendre les points et revoir les manches</summary>
        <div class="sheet-note" data-testid="score-legend">
          <span class="note-title">Comment on compte</span>
          <ul class="mt-1 flex flex-col gap-0.5">
            <li class="note-line"><b>Pari tenu</b> : +20 par pli — et un pari à 0 tenu vaut +10 × cartes distribuées.</li>
            <li class="note-line"><b>Pari raté</b> : −10 par pli d’écart (à 0 : −10 × cartes distribuées).</li>
            <li class="note-line">Les <b>sceaux</b> ci-dessous ne s’ajoutent qu’à un pari tenu ; le Butin et le Rufus, eux, se règlent à part.</li>
          </ul>
        </div>

        <div class="sheet-note" data-testid="seal-legend">
          <span class="note-title">Les sceaux de la manche</span>
          {#if legend.length}
            <ul class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-label="Légende des sceaux de bonus">
              {#each legend as l (l.kind)}
                <li class="flex items-center gap-1.5">
                  <span class="seal" style:background={SEAL[l.kind].bg} style:color={SEAL[l.kind].fg} aria-hidden="true">
                    {#if SEAL[l.kind].icon}<Icon name={SEAL[l.kind].icon!} size={12} />{:else}<span class="seal-glyph">{SEAL[l.kind].text}</span>{/if}
                    <span class="seal-value">{fmtPoints(Math.round(l.points / l.count))}</span>
                  </span>
                  <span class="note-line">{l.name}{l.count > 1 ? ` ×${l.count}` : ''} · {fmtPoints(l.points)}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="note-line mt-1">Aucun sceau cette manche : les bonus ne comptent que si le pari est tenu.</p>
          {/if}
        </div>

        {#if grid}
          <div class="sheet-note" data-testid="round-grid">
            <span class="note-title">Manche par manche</span>
            <div class="mt-1 overflow-x-auto">
              <table class="grid-table" aria-label="Points de chaque manche, par joueur">
                <thead>
                  <tr>
                    <th scope="col" class="grid-who">Capitaine</th>
                    {#each grid.numbers as n (n)}
                      <th scope="col" class="grid-cell" abbr="Manche {n}">M{n}</th>
                    {/each}
                    <th scope="col" class="grid-cell grid-sum">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {#each grid.lines as l (l.player)}
                    <tr>
                      <th scope="row" class="grid-who">{l.name}</th>
                      {#each l.cells as c, i (i)}
                        <td class="grid-cell" class:is-gain={c !== null && c > 0} class:is-loss={c !== null && c < 0}>{c === null ? '—' : fmtPoints(c)}</td>
                      {/each}
                      <td class="grid-cell grid-sum">{fmtTotal(l.cumul)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
          {/if}
        </details>
        </div>
      </div>
      <p class="ledger-position" data-testid="ledger-position"><span>{visibleRanks ? `Joueurs ${visibleRanks} sur ${rows.length}` : 'Détails de la manche'}</span>{#if canScroll}<span>{hasMoreBelow ? 'Défiler ↓' : 'Fin du registre ↑'}</span>{/if}</p>
    </div>

    </div>

    <div class="score-footer">
    {#if isOnline && online.conn !== 'open'}
      <p class="hint flex items-center justify-center gap-2 text-ember-300" role="status" data-testid="reconnecting"><Icon name="wifiOff" size={18} /><span>Connexion perdue — reconnexion…</span></p>
    {/if}
    {#if isOnline}
      <SpectatorBanner />
    {/if}
    {#if autoMe}
      <div class="flex items-center gap-2 rounded-md bg-ember-500/90 px-3 py-1.5 text-sm font-bold text-wood-950 shadow" role="status" aria-live="off" data-testid="auto-banner">
        <Icon name="bot" size={16} class="shrink-0" />
        <span>Le serveur joue pour toi — touche Prêt pour reprendre la main</span>
      </div>
    {/if}

    <!-- FONC-01 / UX-14 — l'absence se voit ICI aussi, avec le même texte et le même compte à rebours qu'à la
         table, et le remplacement se fait sans y retourner. -->
    {#if gone.length}
      <div class="mx-1 flex flex-col gap-1" role="status" aria-live="off" data-testid="disconnected-banner">
        {#each gone as g (g.id)}
          <div class="flex items-center justify-between gap-2 rounded-md bg-wood-950/85 px-3 py-1.5 text-sm ring-1 ring-rum-600/60" data-absent={g.id} data-left={g.left || undefined} data-replace-in={g.replaceIn ?? undefined}>
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="flex min-w-0 items-center gap-2"><Icon name={g.left ? 'exit' : 'wifiOff'} size={14} class="shrink-0 text-ember-300" /><span class="min-w-0" data-testid="absence-text">{g.text}</span></span>
              {#if g.handover}
                <span class="flex items-center gap-2 text-xs text-parchment-muted"><Icon name="crown" size={12} class="shrink-0 text-gold-300" /><span data-testid="handover-text">{g.handover}</span></span>
              {/if}
            </span>
            {#if g.replaceable && !spectator}
              <!-- Le MÊME geste qu'à la table (`Table.svelte`), donc le même son : le tabouret de bois, et le clac
                   de la surface retiré. Un joueur qui remplace depuis le registre plutôt que depuis la table ne
                   doit pas entendre autre chose. -->
              <button type="button" class="chip-brass shrink-0 !min-h-11 !px-3 !text-[0.8rem]" onclick={() => { play('bot-assis'); replaceSeat(g.seat, 'normal'); }} data-testid="replace-seat" data-seat={g.seat} data-clac="non" aria-label="Remplacer {g.name} par un bot">
                <Icon name="bot" size={14} />
                <span>Remplacer par un bot</span>
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if isOnline}
      <div class="flex flex-col gap-2">
        <div class="flex flex-col items-center gap-1" role="status" aria-live="polite">
          <div class="flex items-center justify-center gap-2">
            <!-- « prêts / PRÉSENTS » : le dénominateur est la règle du serveur, pas le nombre de sièges. Il
                 affichait « 2/3 » à l'instant où la manche démarrait. -->
            <span class="chip-brass is-off !min-h-11 !text-[0.8rem]" data-testid="ready-count" data-required={tally.required} data-humans={humans.length}>{readyCount}/{tally.required} prêt{readyCount > 1 ? 's' : ''}</span>
            <span class="flex items-center -space-x-1" data-testid="ready-avatars">
              {#each readyIds as p (p)}
                <Avatar name={nameOf(p, names)} size="xs" />
              {/each}
            </span>
          </div>
          {#if withoutText}
            <p class="hint !text-[0.78rem] text-ember-300" data-testid="ready-without">{withoutText}</p>
          {/if}
        </div>
        <button type="button" class="btn-tavern btn-tavern-lg" onclick={sayReady} disabled={iAmReady || spectator || online.conn !== 'open'} aria-label={isLast ? 'Prêt pour le classement' : 'Prêt pour la manche suivante'} data-testid="ready">
          {#if iAmReady}
            <span class="ico"><Icon name="check" size={22} /></span>
            <span class="lbl"><span>Prêt !</span><span class="hint">On attend les autres…</span></span>
          {:else}
            <span class="ico"><Icon name={isLast ? 'crown' : 'arrowRight'} size={22} /></span>
            <span class="lbl"><span>Prêt</span><span class="hint">{isLast ? 'Qui sera capitaine de la soirée ?' : `Manche ${lastRound + 1} : ${nextCards} carte${nextCards > 1 ? 's' : ''} chacun`}</span></span>
          {/if}
        </button>
      </div>
    {:else}
      <button type="button" class="btn-tavern btn-tavern-lg" onclick={next} disabled={sent} aria-label={isLast ? 'Voir le classement' : 'Manche suivante'} data-testid="next-round">
        {#if sent}
          <span class="ico"><span class="animate-pulse font-mono">…</span></span>
          <span class="lbl"><span>Un instant…</span></span>
        {:else}
          <span class="ico"><Icon name={isLast ? 'crown' : 'arrowRight'} size={22} /></span>
          <span class="lbl"><span>{isLast ? 'Voir le classement' : 'Manche suivante'}</span><span class="hint">{isLast ? 'Qui sera capitaine de la soirée ?' : `Manche ${lastRound + 1} : ${nextCards} carte${nextCards > 1 ? 's' : ''} chacun`}</span></span>
        {/if}
      </button>
    {/if}
    </div>
  </section>
  {#if game.quitPrompt}
    <QuitDialog online={isOnline} code={game.room?.code ?? null} onstay={() => (game.quitPrompt = false)} onquit={() => { play('table-quittee'); return isOnline ? leaveRoom() : quitGame(); }} />
  {/if}
{/if}

<style>
.score-details summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:700;border-top:1px solid #8b603a55;margin-top:6px;padding-top:8px}.score-details summary::after{content:" +";margin-left:auto}.score-details[open] summary::after{content:" −"}

  .score-screen { gap: 0.75rem; }
  .score-column { gap: 0.6rem; }
  .score-overview { flex: none; display: flex; flex-direction: column; gap: 0.6rem; }
  .score-head { padding-top: 0; }
  .score-head h1 { font-size: 1.85rem; }
  .score-head h1 span { font-size: 1rem; }
  .personal-result { padding: 0.75rem 1rem; flex: none; }
  .personal-heading { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
  .personal-heading h2 { font-weight: 700; font-size: 1rem; }
  .personal-heading strong { flex: none; font-size: 1.75rem; line-height: 1; }
  .personal-heading strong span { font-family: var(--font-body); font-size: 0.75rem; }
  .personal-result p { margin-top: 0.35rem; font-size: 0.8rem; line-height: 1.25; }
  .score-ledger { padding-top: 0.5rem; padding-bottom: 1.1rem; }
  .ledger-tools { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; flex: none; }
  .ledger-tools h2 { font-weight: 700; font-size: 0.95rem; }
  .ledger-tools button { min-height: 44px; display: inline-flex; align-items: center; gap: 0.3rem; padding: 0 0.4rem; color: #503016; text-decoration: underline; text-underline-offset: 3px; font-size: 0.85rem; font-weight: 700; }
  .ledger-tools button:focus-visible { outline: 2px solid #724011; outline-offset: -2px; }
  .ledger-position { display: flex; justify-content: space-between; gap: 0.5rem; flex: none; padding-top: 0.3rem; border-top: 1px solid #8b603a55; color: #503016; font-size: 0.75rem; line-height: 1.3; }
  .score-footer { display: flex; flex: none; flex-direction: column; gap: 0.5rem; }

  /* Un téléphone couché offre de la largeur : le bilan prend toute la hauteur à droite,
     tandis que le résumé et l'action restent accessibles à gauche. */
  @media (max-height: 520px) and (min-width: 560px) {
    .score-screen { display: grid; grid-template-columns: minmax(165px, 0.38fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; gap: 0.5rem 0.75rem; width: calc(100vw - 2rem); margin-left: calc(50% - 50vw + 1rem); }
    .score-column { display: contents; }
    .score-overview { grid-column: 1; grid-row: 1; min-height: 0; overflow-y: auto; gap: 0.35rem; }
    .score-head h1 { font-size: 1.4rem; }
    .score-head h1 span { font-size: 0.9rem; }
    .personal-result { padding: 0.6rem 0.75rem; }
    .personal-heading { flex-wrap: wrap; gap: 0.2rem 0.5rem; }
    .personal-heading h2 { font-size: 0.9rem; }
    .personal-heading strong { font-size: 1.5rem; }
    .personal-result p { font-size: 0.75rem; }
    .score-ledger { grid-column: 2; grid-row: 1 / 3; min-width: 0; padding-inline: 0.65rem; }
    .ledger-tools h2 { font-size: 0.85rem; }
    .ledger-tools button { font-size: 0.75rem; }
    .ledger-position { font-size: 0.68rem; }
    .score-footer { grid-column: 1; grid-row: 2; max-height: 45dvh; overflow-y: auto; }
    .score-footer :global(.btn-tavern) { font-size: 1.1rem; min-height: 52px; padding: 0.5rem 0.6rem; gap: 0.45rem; }
    .score-footer :global(.btn-tavern .ico) { width: 30px; height: 30px; }
    .score-footer :global(.btn-tavern .hint) { font-size: 0.7rem; }
  }

  /*
   * Le registre déborde (8 joueurs, 10 manches) : il défile DANS le parchemin plutôt que de pousser « Manche
   * suivante » hors de l'écran. `min-h-0` ne suffit pas : la hauteur automatique de `main` est calculée sur la
   * contribution intrinsèque de ses descendants, et un contenu haut la fait grandir même à travers un
   * `flex-1`. Le registre est donc posé en absolu dans une lucarne — un élément absolu ne contribue à rien —
   * et c'est la lucarne qui prend la place que le parchemin lui donne (E4, mesuré en 844 × 390 et 640 × 400).
   */
  .ledger-viewport {
    position: relative;
    flex: 1 1 0%;
    min-height: 0;
  }
  .ledger-scroll {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: #80582d #e5cc9e;
  }
  /*
   * Les lignes gardent leur hauteur naturelle, alignees en haut. Avec `flex: 1 1 auto`, le tableau prenait
   * toute la lucarne et le navigateur distribuait le rab entre les lignes : a trois joueurs, 100 px de papier
   * s'ouvraient entre l'en-tete et le premier nom. Le vide se remplit par du contenu (legende, grille, regle
   * de comptage), jamais en etirant des lignes.
   */
  .ledger-table {
    flex: none;
    width: 100%;
    border-collapse: collapse;
  }
  /*
   * UX-06 : les trois en-tetes etaient de l'encre claire (rgb(90,64,40)) posee sur la brulure du coin du
   * parchemin - 2,24:1 pour « Manche », 2,47:1 pour « Total », contre 4,5 exiges. Ils ont maintenant leur propre
   * bandeau opaque, une etiquette collee en haut du registre, qui rend la brulure sans effet sur le texte.
   */
  .head {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 0.25rem 0.4rem;
    background: linear-gradient(180deg, #fbf4e2, #efe2c4);
    color: #33220f;
    font-family: var(--font-body);
    font-size: 0.72rem;
    font-weight: 800;
    font-variant: small-caps;
    letter-spacing: 0.03em;
    text-align: right;
    text-shadow: none;
    box-shadow:
      inset 0 0 0 1px rgba(120, 86, 44, 0.28),
      0 1px 0 rgba(74, 50, 32, 0.5);
  }
  .head-who {
    text-align: left;
    border-radius: 3px 0 0 3px;
  }
  .head-delta {
    width: 3.4rem;
  }
  .head-total {
    width: 3.1rem;
    border-radius: 0 3px 3px 0;
  }
  .standing {
    padding-top: 0.3rem;
    border-top: 1px solid rgba(74, 50, 32, 0.35);
    font-weight: 700;
    font-variant: small-caps;
    letter-spacing: 0.02em;
  }
  /* Note de bas de registre (legende, grille) : le papier vide sert enfin a quelque chose. */
  .sheet-note {
    padding-top: 0.4rem;
    border-top: 1px solid rgba(74, 50, 32, 0.35);
  }
  .note-title {
    color: #33220f;
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 800;
    font-variant: small-caps;
    letter-spacing: 0.04em;
  }
  .note-line {
    color: var(--color-ink-700);
    font-family: var(--font-body);
    font-size: 0.72rem;
    line-height: 1.2;
  }
  .seal {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    height: 1.25rem;
    padding: 0 0.25rem;
    border-radius: 3px;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 1;
    box-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
  }
  .seal-glyph {
    min-width: 0.8rem;
    text-align: center;
  }
  .seal-value {
    padding-left: 0.2rem;
    border-left: 1px solid currentColor;
    font-size: 0.62rem;
    font-weight: 600;
    opacity: 0.75;
  }
  /* Grille manche x joueur : d'ou vient le cumul. Defile horizontalement a 10 manches. */
  .grid-table {
    border-collapse: collapse;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.68rem;
  }
  .grid-table th,
  .grid-table td {
    padding: 0.1rem 0.3rem;
    border-bottom: 1px dotted rgba(74, 50, 32, 0.3);
    color: var(--color-ink-700);
    white-space: nowrap;
  }
  .grid-table tbody tr:last-child th,
  .grid-table tbody tr:last-child td {
    border-bottom: 0;
  }
  .grid-table thead th {
    color: #33220f;
    font-weight: 800;
    border-bottom: 1px solid rgba(74, 50, 32, 0.45);
  }
  .grid-who {
    position: sticky;
    left: 0;
    max-width: 5.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    background: linear-gradient(90deg, rgba(243, 230, 200, 0.96) 85%, rgba(243, 230, 200, 0));
    font-family: var(--font-body);
    font-weight: 700;
    font-variant: small-caps;
    text-align: left;
  }
  .grid-cell {
    text-align: right;
    min-width: 2.1rem;
  }
  .grid-cell.is-gain {
    color: #2f5d2a;
  }
  .grid-cell.is-loss {
    color: #8b1e2b;
  }
  .grid-sum {
    font-weight: 800;
    color: var(--color-ink-900);
  }
  /*
   * UX-14 — « Remplacer par un bot » mesurait 149 × 23 px : sous le minimum de 24 px (WCAG 2.5.8) et loin des
   * 44 px que la maison s'impose partout ailleurs. L'exemplaire de cet écran naît à 44 px (`!min-h-11`) ; la
   * règle globale ci-dessous rattrape celui de la TABLE, dont le fichier (`Table.svelte`) appartient à un autre
   * chantier de cette vague. Elle est guidée par le `data-testid`, donc elle ne touche que ces deux boutons —
   * et elle a vocation à remonter telle quelle dans `app.css` dès que ce fichier se rouvrira.
   */
  :global([data-testid='replace-seat']) {
    min-height: 2.75rem;
  }
</style>
