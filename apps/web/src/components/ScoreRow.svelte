<script lang="ts">
  // Ligne du registre de manche (sur parchemin) : avatar · nom · « pari → plis » coché ✓ ou barré ✗ à la plume ·
  // sceaux de bonus PORTANT LEUR VALEUR · la règle appliquée et la décomposition du total · delta à l'encre ·
  // total sur une pièce d'or.
  //
  // Vague 2.B (UX-07, A11Y-14). Trois choses ont changé ici :
  //  1. c'est une VRAIE ligne de tableau (`tr` / `th scope=row` / `td`), plus un `li` de liste : « +50 50 » se
  //     lisait sans savoir lequel des deux nombres était le gain de la manche et lequel le cumul ;
  //  2. chaque sceau porte ses points — le 14 noir (+20) et le 14 de couleur (+10) ne se distinguaient que par
  //     la couleur du jeton, et la seule voie vers la valeur (l'appui long) sortait de l'écran ;
  //  3. le total est décomposé sous la ligne (« 2 plis × +20 = +40 · +50 bonus »), au lieu d'être un nombre nu.
  //
  // Vague 3.A — ÉTATS DE PRÉSENCE seulement (FONC-01) : cinq secondes après qu'un joueur avait fermé son onglet,
  // sa ligne du registre était identique à celle des autres — capture identique octet pour octet. Elle porte
  // maintenant une pastille (« déconnecté », « parti », « pirate de bois ») et le dit à l'oreille.
  //
  // La ligne NE SONNE PAS d'elle-même, et c'est la seule chose à savoir ici : les lignes sont rendues toutes
  // ensemble (le `{#each}` de `RoundScore`), et un son au montage les ferait tomber d'un bloc, en bouillie. Le
  // registre s'égrène depuis l'écran, qui seul connaît l'ordre du classement, sait laquelle est la mienne, et
  // peut fondre les adversaires au-delà du troisième.
  import type { RoundScore, TrickRecord } from '../lib/types';
  import { bidExplainFr, bonusGlyphs, fmtPoints, fmtTotal, lostBonusGlyphs, roundSentenceFr, ruleTextFr, scoreParts, SEAL } from '../lib/scoreMeta';
  import { longpress } from '../lib/tip.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  let {
    score,
    name,
    total,
    history = [],
    me = false,
    presence = null,
  }: {
    score: RoundScore;
    name: string;
    /** Cumul après cette manche. */
    total: number;
    history?: readonly TrickRecord[];
    me?: boolean;
    /**
     * FONC-01 — l'état de présence du siège, tel que `online.svelte.ts` le calcule depuis la règle du serveur.
     * `null` en solo (personne ne peut manquer) et pour un joueur présent.
     */
    presence?: { state: string; chip: string; text: string } | null;
  } = $props();

  const glyphs = $derived(bonusGlyphs(score, history));
  /**
   * Audit 2026-09-09 — le pari raté remet les bonus à zéro dans le moteur : la ligne était exacte au point et
   * muette sur l'enjeu. On montre ce qui vient de tomber avec le pari, en gris, HORS du compte (le total ne
   * bouge pas d'un point). Rien à afficher si le pari est tenu, ou s'il n'y avait rien à gagner.
   */
  const lost = $derived(lostBonusGlyphs(score, history));
  const lostTotal = $derived(lost.reduce((sum, g) => sum + g.points, 0));
  const showLost = $derived(!score.made && lostTotal > 0);
  const lostDetail = $derived(lost.map((g) => `${g.name} ${fmtPoints(g.points)}`).join(' · '));
  const bidText = $derived(score.effectiveBid !== score.bid ? `${score.bid}→${score.effectiveBid}` : String(score.effectiveBid));
  /** « 2 plis × +20 = +40 · +50 bonus » : la règle, puis chaque part qui s'y ajoute. */
  const extras = $derived(scoreParts(score).slice(1));
  const detail = $derived(`${ruleTextFr(score)} = ${fmtPoints(score.base)}${extras.map((p) => ` · ${fmtPoints(p.points)} ${p.label}`).join('')}`);
  /** La même chose, énoncée par le moteur, chaque bonus nommé : ce que lit un lecteur d'écran, et l'appui long. */
  const sentence = $derived(roundSentenceFr(score, name, history));
</script>

<tr tabindex="-1" class="ledger" class:is-me={me} class:is-absent={!!presence} data-player={score.player} data-made={score.made} data-presence={presence?.state ?? 'here'}>
  <th scope="row" class="cell-who">
    <div class="flex items-start gap-2">
      <Avatar {name} size="sm" {me} />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="flex min-w-0 items-center gap-1.5">
          <span class="min-w-0 truncate text-[0.95rem] font-bold small-caps text-ink-900">{name}</span>
          {#if me}<span class="my-label">toi</span>{/if}
          {#if presence}
            <!-- La pastille dit l'absence SUR LA LIGNE : c'est là qu'on cherche le joueur, pas dans une bannière
                 à l'autre bout de l'écran. Le texte complet part à l'oreille et à l'appui long. -->
            <span class="absent-chip" data-testid="row-presence" data-state={presence.state} role="img" aria-label={presence.text} use:longpress={{ title: name, text: presence.text, tap: true }}>
              <Icon name={presence.state === 'bot' ? 'bot' : presence.state === 'left' ? 'exit' : 'wifiOff'} size={11} />
              <span>{presence.chip}</span>
            </span>
          {/if}
        </span>
        <div class="flex flex-wrap items-center gap-1">
          <span
            class="quill inline-flex items-center gap-1 font-mono text-xs"
            class:is-made={score.made}
            data-testid="bid-chip"
            role="img"
            aria-label="Pari {bidText}, {score.tricks} plis · pari {score.made ? 'réussi' : 'raté'}"
            use:longpress={{ title: score.made ? 'Pari réussi' : 'Pari raté', text: bidExplainFr(score), tap: true }}
          >
            <span>{bidText}→{score.tricks}</span>
            <span class="mark" aria-hidden="true">{score.made ? '✓' : '✗'}</span>
            <span class="word text-xs font-bold not-italic" aria-hidden="true">{score.made ? 'réussi' : 'raté'}</span>
          </span>
          {#each glyphs as g, i (g.kind + i)}
            <span
              class="seal"
              style:background={SEAL[g.kind].bg}
              style:color={SEAL[g.kind].fg}
              class:saturate-50={g.points < 0}
              data-bonus={g.kind}
              data-points={g.points}
              role="img"
              aria-label="{g.name} {fmtPoints(g.points)}"
              use:longpress={{ title: g.name, text: `${fmtPoints(g.points)} points de bonus`, tap: true }}
            >
              {#if SEAL[g.kind].icon}
                <Icon name={SEAL[g.kind].icon!} size={12} />
              {:else}
                <span class="seal-glyph">{SEAL[g.kind].text}</span>
              {/if}
              <span class="seal-value" aria-hidden="true">{fmtPoints(g.points)}</span>
            </span>
          {/each}
          {#if showLost}
            <span
              class="lost-bonus"
              data-testid="lost-bonus"
              data-points={lostTotal}
              role="img"
              aria-label="Bonus perdus avec le pari : {fmtPoints(lostTotal)} points, non comptés — {lostDetail}"
              use:longpress={{ title: 'Bonus perdus', text: `Le pari raté annule ces bonus : ${lostDetail}. Ils ne comptent pas dans le total.`, tap: true }}
            >
              <span aria-hidden="true">bonus perdus {fmtPoints(lostTotal)}</span>
            </span>
          {/if}
        </div>
        <span class="detail" data-testid="row-detail" aria-label={sentence} role="img" use:longpress={{ title: 'Le compte de la manche', text: sentence, tap: true }}>{detail}</span>
      </div>
    </div>
  </th>
  <td class="cell-delta">
    <span class="font-mono text-lg font-bold" class:text-[#2f5d2a]={score.total > 0} class:text-rum-600={score.total < 0} class:text-ink-700={score.total === 0} data-testid="delta">{fmtPoints(score.total)}</span>
  </td>
  <!-- Vague 8 (#7, audit visuel #27) : une pièce d'or pour « −30 » disait le contraire de ce qu'elle voulait dire.
       Or pour un gain, laiton terni pour zéro, cuivre sombre pour une perte — et le même signe moins qu'à gauche. -->
  <td class="cell-total">
    <span class="coin font-mono" class:is-zero={total === 0} class:is-loss={total < 0} data-testid="total" data-sign={total > 0 ? 'plus' : total < 0 ? 'moins' : 'zero'}>{fmtTotal(total)}</span>
  </td>
</tr>

<style>
  .ledger > * {
    border-bottom: 1px dashed rgba(74, 50, 32, 0.4);
    padding: 0.4rem 0;
    vertical-align: middle;
  }
  .ledger:last-child > * {
    border-bottom: 0;
  }
  .my-label { flex: none; border: 1px solid #856321; border-radius: 3px; padding: 0 0.25rem; color: #503016; font-size: 0.68rem; font-weight: 700; }
  .ledger:focus { outline: 2px solid #856321; outline-offset: -2px; }
  .ledger.is-me > * {
    background: rgba(217, 168, 58, 0.18);
  }
  /* `th` par défaut : gras et centré — ici c'est une cellule d'en-tête de LIGNE, pas un titre. */
  .cell-who {
    font-weight: inherit;
    text-align: left;
    padding-right: 0.35rem;
  }
  .cell-delta {
    width: 3.4rem;
    text-align: right;
    padding-right: 0.35rem;
    white-space: nowrap;
  }
  .cell-total {
    width: 3.1rem;
    text-align: right;
    white-space: nowrap;
  }
  /*
   * Les bonus perdus : à l'encre pâle, barrés, et jamais un sceau — ils ne sont PAS dans le total, et rien ne
   * doit laisser croire qu'ils s'y ajoutent.
   */
  .lost-bonus {
    display: inline-flex;
    align-items: center;
    padding: 0 0.25rem;
    border: 1px dashed rgba(74, 50, 32, 0.5);
    border-radius: 4px;
    /* Assez sombre pour tenir 4,5:1 sur le parchemin (≈ 5,9:1) : « en gris » ne veut pas dire « illisible ». */
    color: rgba(60, 42, 26, 0.78);
    font-family: var(--font-mono, monospace);
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 1.5;
    text-decoration: line-through;
    text-decoration-thickness: 1px;
    white-space: nowrap;
  }

  /* « pari → plis » à la plume : encre verte quand le pari est tenu, rouge sinon. */
  .quill {
    color: #8b1e2b;
    font-weight: 700;
  }
  .quill.is-made {
    color: #2f5d2a;
  }
  .quill .mark {
    font-family: var(--font-display);
    font-size: 1.05rem;
    line-height: 1;
  }
  .quill .word {
    font-family: var(--font-body);
    letter-spacing: 0.02em;
  }
  /* Sceau de bonus : une mini-plaque de cire qui porte SA VALEUR (UX-07). */
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
  /*
   * FONC-01 — la ligne d'un absent. Deux indices, jamais la couleur seule : l'encre pâlit (le joueur ne joue
   * plus) et la pastille nomme l'état. Contraste de la pastille mesuré sur le parchemin : encre #4a2f14 sur
   * #e7d4ad → 7,4:1.
   */
  .ledger.is-absent .cell-who {
    opacity: 0.82;
  }
  .absent-chip {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.15rem;
    height: 1.05rem;
    padding: 0 0.28rem;
    border-radius: 3px;
    border: 1px solid rgba(74, 50, 32, 0.55);
    background: rgba(139, 30, 43, 0.14);
    color: #4a2f14;
    font-family: var(--font-body);
    font-size: 0.6rem;
    font-weight: 800;
    font-variant: small-caps;
    letter-spacing: 0.04em;
    line-height: 1;
    white-space: nowrap;
  }
  .absent-chip[data-state='bot'] {
    background: rgba(196, 132, 32, 0.2);
  }
  /* La règle appliquée et la décomposition, à la plume fine sous la ligne. */
  .detail {
    color: var(--color-ink-500);
    font-family: var(--font-body);
    font-size: 0.7rem;
    line-height: 1.25;
  }
</style>
