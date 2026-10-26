// Le manifeste du son, vu par le code. `apps/web/audio/manifest.json` est une DONNÉE : `tools/audio/build.mjs`
// l'écrit depuis le plan de sourcing, en même temps qu'il encode les fichiers. Personne ne le tape à la main.
//
// Pourquoi un import statique plutôt qu'un chargement au vol : `SlotId` est l'union des noms de slots RÉELS,
// dérivée des clés du JSON. `play('carte-poser')` — une faute de frappe — ne compile pas. C'est la seule
// barrière qui empêche les écrans d'inventer des sons qui n'existent pas, et elle ne coûte rien à l'exécution.
//
// Contrepartie : ce qui est dans ce JSON est dans le bundle d'entrée, donc dans le précache. Les crédits en ont
// été SORTIS pour cette raison — 37 Kio de lignes de licence chargés par tous les joueurs pour une page que
// presque personne n'ouvre. Ils vivent maintenant dans `public/audio/credits.json` et se chargent quand on les
// regarde (`chargerCredits`). La trace légale ne se rogne pas ; elle se charge au bon moment.
import manifest from '../../audio/manifest.json';

/** Un nom de slot du manifeste, et rien d'autre : c'est ce type qui verrouille tous les points de branchement. */
export type SlotId = keyof typeof manifest.sfx;

/** Combien le son compte pour le joueur — sert à trancher un doublon, jamais à décider d'un préchargement. */
export type Priorite = 'P0' | 'P1' | 'P2';

/** À quel rythme le son revient dans une partie — c'est CE champ qui décide du préchargement (cf `PRECHARGE`). */
export type Frequence = 'tres-haute' | 'haute' | 'moyenne' | 'basse' | 'rare';

export interface SlotAudio {
  /** Variante servie en production. */
  chosen: string;
  variants: string[];
  /** Chargé dès le premier geste (les fréquents), ou à la première utilisation (tout le reste). */
  precharge: boolean;
  priorite: Priorite;
  frequence: Frequence;
  /** Garde anti-mitraillette, en ms : deux déclenchements plus rapprochés → le second est ignoré. */
  throttle: number;
  /** Rejoué à un `playbackRate` légèrement tiré au sort, contre la fatigue d'un son entendu cent fois. */
  detune: boolean;
  /** Correction de goût en dB, appliquée à la LECTURE : la changer ne demande pas de réencoder. */
  gain: number;
}

export interface MusiqueAudio {
  /** La piste de la TABLE, celle qu'on peut changer dans les réglages. */
  chosen: string;
  variants: string[];
  /**
   * La piste des MENUS — hors partie. Un lit à part, et pas une variante de plus : les menus et la table ne
   * racontent pas la même chose, et l'une ne doit pas se substituer à l'autre au gré d'un réglage. Absente
   * du manifeste, les menus restent muets (c'était l'état d'avant).
   */
  menus?: string;
  gain: number;
}

export interface Credit {
  /** `<slot>-<variante>` pour un effet, `music/<nom>` pour une boucle. */
  fichier: string;
  titre: string;
  auteur: string;
  licence: string;
  source: string;
}

// Le JSON importé élargit ses littéraux (`priorite: string`) : cette assertion est ce qui rend le manifeste
// typé au lieu de le retyper à la main, ligne à ligne, à chaque son ajouté. `build.mjs` en est le garant, et
// `audio.test.ts` vérifie que les valeurs tiennent dans les unions ci-dessus.
export const SFX = manifest.sfx as Record<SlotId, SlotAudio>;
export const MUSIQUE = manifest.music as MusiqueAudio;
let creditsEnCache: Credit[] | null = null;

/**
 * Charge la trace légale, une fois par session. Asynchrone À DESSEIN : ces 46 Kio ne doivent pas voyager avec
 * le bundle. Rend un tableau vide si le fichier manque (mode hors-ligne d'une version antérieure) — une page
 * de crédits vide vaut mieux qu'un écran qui refuse de s'ouvrir.
 */
export async function chargerCredits(): Promise<Credit[]> {
  if (creditsEnCache) return creditsEnCache;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}audio/credits.json`);
    const brut: unknown = r.ok ? await r.json() : null;
    // Le garde-fou n'est pas décoratif : hors ligne, un service worker peut rendre une page d'erreur, et en
    // test un `fetch` bouchonné rend ce qu'il veut. Un `credits.map` sur autre chose qu'un tableau casserait
    // toute la page pour une liste de licences.
    creditsEnCache = Array.isArray(brut) ? (brut as Credit[]) : [];
  } catch {
    creditsEnCache = [];
  }
  return creditsEnCache;
}

export const SLOTS = Object.keys(SFX) as SlotId[];

/**
 * Ce qui part au premier geste. Le champ vient du manifeste, donc de la FRÉQUENCE et non de la priorité :
 * un son rare mais capital (le Kraken, la victoire) paie un aller-retour la première fois et reste en cache
 * ensuite, alors qu'un son entendu cent fois par partie ne peut jamais arriver en retard. Mesuré à la
 * fabrication : les 27 fréquents pèsent 76 Kio, les 47 P0 en auraient coûté 237.
 */
export const PRECHARGE: SlotId[] = SLOTS.filter((s) => SFX[s].precharge);

/** Garde-fou d'exécution : un nom venu d'ailleurs (URL d'essayage, vieux `localStorage`) n'est pas un slot. */
export function estSlot(nom: string): nom is SlotId {
  return Object.hasOwn(SFX, nom);
}
