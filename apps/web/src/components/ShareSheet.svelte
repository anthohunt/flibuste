<script lang="ts">
  // Partager la table (vague 5) : le lien d'invitation d'abord, en gros et sélectionnable ; un QR code (généré
  // ici, sans CDN) ; le code en lettres espacées pour le dicter, sur une seule ligne (UX-01) ; « Copier le lien » (presse-papiers, puis
  // `execCommand('copy')` — le seul repli sans permission) et « Partager » (`navigator.share`) quand l'appareil sait.
  import { onMount } from 'svelte';
  import { play } from '../lib/audio.svelte';
  import Sheet, { fermetureMuette } from './Sheet.svelte';
  import Icon from './Icon.svelte';

  let {
    url,
    code,
    oncancel,
    oncopied,
  }: {
    url: string;
    code: string;
    oncancel: () => void;
    /** Résultat de « Copier le lien » (true : dans le presse-papiers). */
    oncopied?: (ok: boolean) => void;
  } = $props();

  let input = $state<HTMLInputElement | null>(null);
  let qr = $state<string | null>(null);
  let qrFailed = $state(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const spaced = $derived([...code].join(' '));
  /** Le lien sans son protocole : plus court à l'œil, c'est l'URL complète qui est copiée. */
  const shown = $derived(url.replace(/^https?:\/\//, ''));

  onMount(() => {
    let alive = true;
    void import('qrcode')
      .then((m) => m.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#2a1608', light: '#0000' } }))
      .then((svg) => {
        if (alive) qr = svg;
      })
      .catch(() => {
        if (alive) qrFailed = true;
      });
    return () => {
      alive = false;
    };
  });

  function selectAll() {
    input?.focus();
    input?.select();
  }
  async function copy() {
    selectAll();
    let ok = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      /* repli */
    }
    if (!ok) {
      try {
        ok = typeof document.execCommand === 'function' && document.execCommand('copy');
      } catch {
        ok = false;
      }
    }
    if (ok) {
      // La pièce de cuivre qui tombe dans la paume. Elle remplace le son du toast — qui se tait — ET celui de la
      // feuille qui se referme dans la foulée : un seul geste, un seul son, celui qui dit que c'est fait. L'échec,
      // lui, n'a PAS de tintement : sans cette inversion, le joueur croirait avoir copié.
      play('lien-copie');
      fermetureMuette();
    } else {
      // Ni presse-papiers ni `execCommand` : le lien reste sous les yeux, à sélectionner à la main. Le geste a
      // claqué dans le vide, et c'est ce vide qu'on entend — surtout pas la pièce de cuivre, qui ferait croire
      // que c'est copié. Le bouton porte `data-clac="non"` : sans cette ligne, l'échec est totalement muet.
      play('geste-sans-effet');
    }
    oncopied?.(ok);
  }
  async function share() {
    try {
      await navigator.share({ title: 'Flibuste', text: `Rejoins ma table de Flibuste (code ${code})`, url });
    } catch {
      /* annulé ou refusé : le lien reste sous les yeux */
    }
  }
</script>

<Sheet title="Inviter à la table" {oncancel} testid="share-sheet">
  <p class="hint -mt-2 text-center">Envoie ce lien à tes pirates : il les mène droit à ta table.</p>
  <label class="flex flex-col gap-1">
    <span class="hint !not-italic text-center !text-[0.75rem]">Lien d’invitation</span>
    <input bind:this={input} class="input-parchment w-full text-center text-base font-bold break-all" type="text" readonly value={url} aria-label="Lien d’invitation" title={shown} onfocus={selectAll} onclick={selectAll} data-testid="share-link" />
  </label>
  <div class="flex items-center justify-center gap-4">
    <div class="qr flex h-36 w-36 shrink-0 items-center justify-center rounded-md bg-parchment p-1.5 ring-1 ring-brass-600/60" data-testid="share-qr" data-ready={qr ? 'true' : undefined} role="img" aria-label="QR code du lien d’invitation">
      {#if qr}
        {@html qr}
      {:else if qrFailed}
        <span class="hint text-center !text-[0.7rem]">QR indisponible</span>
      {:else}
        <Icon name="qr" size={40} class="animate-pulse text-ink-muted" />
      {/if}
    </div>
    <div class="flex min-w-0 flex-1 flex-col items-center gap-1">
      <span class="hint !not-italic !text-[0.75rem]">Ou dicte le code</span>
      <span class="code-text share-code !text-ink-900 leading-none" aria-label="Code {spaced}" data-testid="share-code">{spaced}</span>
      <span class="hint !text-[0.7rem]">Code : {code.length} lettres</span>
    </div>
  </div>
  <div class="grid gap-2" class:grid-cols-2={canShare} class:grid-cols-1={!canShare}>
    <button type="button" class="btn-tavern btn-tavern-center" onclick={copy} data-autofocus data-testid="share-copy" data-clac="non" aria-label="Copier le lien">
      <Icon name="link" size={18} />
      <span>Copier le lien</span>
    </button>
    {#if canShare}
      <button type="button" class="btn-tavern btn-tavern-center" onclick={share} data-testid="share-native" aria-label="Partager">
        <Icon name="share" size={18} />
        <span>Partager</span>
      </button>
    {/if}
  </div>
  <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center mx-auto" onclick={oncancel} aria-label="Fermer">
    <Icon name="close" size={16} />
    <span>Fermer</span>
  </button>
</Sheet>

<style>
  /* Le code à dicter tient sur UNE ligne, six lettres comprises (il se coupait en deux à 390 px). */
  .share-code {
    font-size: clamp(1.1rem, 4.6vw, 1.6rem);
    text-shadow: 0 1px 0 rgba(255, 250, 230, 0.6);
  }
  .qr :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
