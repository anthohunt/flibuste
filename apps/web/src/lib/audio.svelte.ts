import { setMediaIdentity } from './brand';
// Le son du jeu. Une seule porte : `play('carte-posee-moi')`, `music.start()`, `audio.settings`.
//
// DEUX VOIES, pour deux contraintes opposées :
//   — les EFFETS passent par un `AudioBuffer` décodé une fois et rejoué par un `AudioBufferSourceNode` :
//     latence quasi nulle, superposition libre, désaccord possible à la relance. Ce sont des sons de 200 ms,
//     on peut les tenir en mémoire ;
//   — la MUSIQUE passe par un `<audio loop>` branché au graphe (`createMediaElementSource`) : on ne décode pas
//     1,6 Mio pour une boucle, et la boucle native est sans couture. Le passage par le graphe est ce qui permet
//     le fondu et le bus de volume.
//
// Le lecteur des menus se PRÉPARE silencieusement après le premier rendu. Le contexte Web Audio et les
// effets attendent le geste d’entrée : pas de lecture, ni de décodage des effets, avant ce consentement.
//
// Le son DOUBLE l'information, il ne la porte jamais seul : couper le son ne fait rien perdre au joueur.
import { MUSIQUE, PRECHARGE, SFX, chargerCredits, estSlot, type SlotId } from './audioManifest';

/** Où le jeu se tient : dans ses menus, ou à la table. Chacun a son lit sonore, et ils ne se mélangent pas. */
export type Lieu = 'menus' | 'table';

export type { SlotId };
export { chargerCredits };

export interface AudioSettings {
  muet: boolean;
  /**
   * Le volume général a disparu de l'écran : trois curseurs pour deux voies, c'est un curseur qui ne dit rien
   * de plus que les deux autres réunis, et qui les fait mentir (« musique à 100 % » ne veut plus rien dire si
   * le général est à 30). Il reste ici, câblé à 1, parce que le bus maître est ce qui porte le fondu du muet.
   */
  maitre: number;
  effets: number;
  musique: number;
}

/** Le pas d'une salve : une distribution ou un décompte s'égrène au lieu de tomber d'un bloc (design : 40-70 ms). */
const PAS_SALVE = 0.055;
/** Au-delà, une distribution de 10 cartes sature. La plus ancienne voix cède la place. */
const MAX_VOIX = 8;
/** Assez court pour être inaudible, assez long pour ne pas claquer en coupant une voix en plein milieu. */
const COUPE = 0.03;
/** Le muet doit rester instantané pour le joueur : 10 ms ne s'entendent pas comme un délai, mais suffisent
 *  à éviter le clic d'un gain qui saute à zéro au milieu d'une note tenue. */
const COUPE_MUET = 0.01;
/** ±2,5 % de `playbackRate` : le même son cent fois ne s'entend plus comme le même son. */
const DESACCORD = 0.025;
const FONDU_SORTIE = 0.6;

const CLE_REGLAGES = 'flibuste.audio';
/** Une clé par slot, comme `flibuste.art.<id>` — mais lue AUSSI en production (voir `choixDe`). */
const CLE_CHOIX = 'flibuste.audio.';
/** Le choix de musique se range avec les autres : aucun slot ne s'appelle « music ». */
const CLE_MUSIQUE = `${CLE_CHOIX}music`;

// Effets allumés (ils répondent à un geste, le joueur les attend), musique allumée mais en retrait : elle ne
// doit jamais couvrir un effet, d'où le 0,55 contre 1 et la normalisation basse faite à l'encodage (-19 LUFS).
const DEFAUTS: AudioSettings = { muet: false, maitre: 1, effets: 0.9, musique: 0.55 };

function borne(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function volume(v: unknown, defaut: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? borne(v) : defaut;
}

function lireReglages(): AudioSettings {
  try {
    const brut = localStorage.getItem(CLE_REGLAGES);
    if (!brut) return { ...DEFAUTS };
    const o = JSON.parse(brut) as Partial<Record<keyof AudioSettings, unknown>>;
    return {
      muet: typeof o.muet === 'boolean' ? o.muet : DEFAUTS.muet,
      maitre: volume(o.maitre, DEFAUTS.maitre),
      effets: volume(o.effets, DEFAUTS.effets),
      musique: volume(o.musique, DEFAUTS.musique),
    };
  } catch {
    return { ...DEFAUTS }; // mode privé, quota, JSON abîmé : le jeu sonne au réglage d'usine
  }
}

function ecrireReglages(): void {
  try {
    localStorage.setItem(CLE_REGLAGES, JSON.stringify(etat.settings));
  } catch {
    /* stockage indisponible : les réglages valent pour cette session */
  }
}

const etat = $state({ pret: false, settings: lireReglages() });

/**
 * `pret` : le premier geste a eu lieu et le son peut sortir — l'écran des réglages s'en sert pour ne pas
 * promettre un essai qu'il ne peut pas jouer.
 *
 * `settings` est une rune, donc lisible directement dans un composant. En revanche `setReglage` est la SEULE
 * porte pour la modifier : écrire dans `audio.settings` à la main déplacerait le curseur à l'écran sans rien
 * appliquer au graphe ni rien mémoriser.
 */
export const audio: { readonly pret: boolean; settings: AudioSettings } = etat;

// ---------------------------------------------------------------------------
// Le graphe
// ---------------------------------------------------------------------------

type Fabrique = new () => AudioContext;

let ctx: AudioContext | null = null;
let maitre: GainNode | null = null;
let busSfx: GainNode | null = null;
let busMusique: GainNode | null = null;
let debloque = false;
let surveille = false;

function fabrique(): Fabrique | null {
  const g = globalThis as { AudioContext?: Fabrique; webkitAudioContext?: Fabrique };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** Le contexte, créé à la première demande APRÈS le premier geste. Avant, `null` — et tout le module est inerte. */
function contexte(): AudioContext | null {
  if (ctx) return ctx;
  // Le contexte naît au premier geste — ou pendant la tentative de démarrage sans geste, qui est la SEULE
  // autre porte (voir `essayerMusiqueSansGeste`). Un contexte créé hors geste naît « suspendu » et ne coûte
  // rien tant qu'il le reste : ce n'est pas lui qui ferait du bruit, c'est la lecture, et elle sera refusée.
  if (!debloque && !tentativeSansGeste) return null;
  const F = fabrique();
  if (!F) return null; // jsdom, navigateur sans Web Audio : le jeu tourne, il est simplement muet
  try {
    const c = new F();
    maitre = c.createGain();
    busSfx = c.createGain();
    busMusique = c.createGain();
    busSfx.connect(maitre);
    busMusique.connect(maitre);
    maitre.connect(c.destination);
    ctx = c;
    appliquerGains();
    return c;
  } catch {
    return null;
  }
}

function dbVersLineaire(db: number): number {
  return 10 ** (db / 20);
}

// Un curseur bouge par petits pas : poser la valeur d'un coup ne s'entend pas. Un fondu par pas, lui,
// s'entendrait — chaque pas annulerait le précédent en plein milieu. Le MUET, lui, n'est pas un pas mais un
// saut (0,8 → 0 d'un coup) : sur une note tenue de la boucle, une discontinuité pareille claque. D'où
// `rampeMaitre`, réservé à ce basculement-là.
function appliquerGains(rampeMaitre = false): void {
  if (!maitre || !busSfx || !busMusique) return;
  const s = etat.settings;
  const cible = s.muet ? 0 : s.maitre;
  if (rampeMaitre && ctx) {
    try {
      const t = ctx.currentTime;
      maitre.gain.setValueAtTime(maitre.gain.value, t);
      maitre.gain.linearRampToValueAtTime(cible, t + COUPE_MUET);
    } catch {
      maitre.gain.value = cible; // paramètre sans automation (contexte fermé, faux graphe) : le saut reste
    }
  } else maitre.gain.value = cible;
  busSfx.gain.value = s.effets;
  busMusique.gain.value = s.musique * dbVersLineaire(MUSIQUE.gain);
}

function audible(): boolean {
  return !etat.settings.muet && etat.settings.maitre > 0;
}

// ---------------------------------------------------------------------------
// Format et URL
// ---------------------------------------------------------------------------

let extension: 'webm' | 'm4a' | null = null;

/** Safari ne lit pas Opus dans WebM et retombe sur l'AAC ; partout ailleurs, l'Opus est deux fois plus léger. */
function ext(): 'webm' | 'm4a' {
  if (extension) return extension;
  let opus = false;
  try {
    opus = typeof document !== 'undefined' && !!document.createElement('audio').canPlayType('audio/webm; codecs="opus"');
  } catch {
    opus = false;
  }
  extension = opus ? 'webm' : 'm4a';
  return extension;
}

/** Surcharges d'essayage. En mémoire d'abord : sans elle, un mode privé rendrait la page `#/son` inutilisable. */
const essais = new Map<string, string>();

/**
 * Variante effective d'un slot. Contrairement aux illustrations (`#/art`, réservé au dev), l'essayage du son
 * vaut AUSSI en production : Alix essaie les sons sur son téléphone, sur l'app déployée.
 */
function choixDe(slot: SlotId): string {
  const e = SFX[slot];
  const memoire = essais.get(slot);
  if (memoire && e.variants.includes(memoire)) return memoire;
  try {
    const local = localStorage.getItem(CLE_CHOIX + slot);
    if (local && e.variants.includes(local)) return local;
  } catch {
    /* stockage indisponible : on s'en tient au manifeste */
  }
  return e.variants.includes(e.chosen) ? e.chosen : (e.variants[0] ?? e.chosen);
}

export function urlDe(slot: SlotId, variante?: string): string {
  if (!estSlot(slot)) return '';
  return `${import.meta.env.BASE_URL}audio/sfx/${slot}-${variante ?? choixDe(slot)}.${ext()}`;
}

export function urlMusique(variante: string): string {
  return `${import.meta.env.BASE_URL}audio/music/${variante}.${ext()}`;
}

/** Ce que la page d'essayage affiche pour un slot : ses trois variantes, et celle qui sort en ce moment. */
export function variantesDe(slot: SlotId): { variants: string[]; chosen: string | null } {
  if (!estSlot(slot)) return { variants: [], chosen: null };
  return { variants: SFX[slot].variants, chosen: choixDe(slot) };
}

/** Retient un essai (mémorisé, production comprise) ; `null` efface la surcharge et rend la main au manifeste. */
export function choixLocal(slot: SlotId, v: string | null): void {
  if (!estSlot(slot)) return;
  if (v === null) essais.delete(slot);
  else essais.set(slot, v);
  try {
    if (v === null) localStorage.removeItem(CLE_CHOIX + slot);
    else localStorage.setItem(CLE_CHOIX + slot, v);
  } catch {
    /* stockage indisponible : l'essai vaut pour cette session */
  }
}

// ---------------------------------------------------------------------------
// Tampons
// ---------------------------------------------------------------------------

const tampons = new Map<string, AudioBuffer>();
const enVol = new Map<string, Promise<AudioBuffer | null>>();

function charger(url: string): Promise<AudioBuffer | null> {
  const c = contexte();
  if (!c || !url) return Promise.resolve(null);
  const deja = tampons.get(url);
  if (deja) return Promise.resolve(deja);
  const encours = enVol.get(url);
  if (encours) return encours;
  const p = (async () => {
    try {
      const rep = await fetch(url);
      if (!rep.ok) return null;
      const tampon = await c.decodeAudioData(await rep.arrayBuffer());
      tampons.set(url, tampon);
      return tampon;
    } catch {
      // Hors-ligne, fichier absent, décodage refusé : le geste reste muet. Un son n'est jamais une erreur
      // qu'on remonte au joueur — l'information, elle, est à l'écran.
      return null;
    } finally {
      enVol.delete(url);
    }
  })();
  enVol.set(url, p);
  return p;
}

/**
 * Le préchauffage part en FILE, pas d'un bloc. Mesuré sur `dist` en 4G lente émulée (1,6 Mbit/s, 150 ms de
 * latence) : les 27 requêtes lâchées ensemble se partagent la bande passante, et `bouton-presse` — pourtant
 * préchargé, donc censé être là — n'arrivait qu'à 856 ms, alors que le `:active` du bouton dure 90 ms. Le
 * joueur n'entendait pas son propre doigt. Quatre à la fois laissent la place à la requête que `play()`
 * lance en direct : elle double la file au lieu d'attendre derrière vingt-six autres.
 */
const PRECHAUFFAGE_PARALLELE = 4;

/**
 * Ce que le PREMIER geste peut produire lui-même — un appui, une carte soulevée. Ces deux-là sont demandés
 * dans la même milliseconde que `debloquer()` : ils passent devant, sinon l'ordre du manifeste décide au
 * hasard si le joueur entend son geste ou pas.
 */
const AU_PREMIER_GESTE: readonly SlotId[] = ['bouton-presse', 'carte-levee'];

const ORDRE_PRECHAUFFAGE: SlotId[] = [
  ...AU_PREMIER_GESTE.filter((s) => PRECHARGE.includes(s)),
  ...PRECHARGE.filter((s) => !AU_PREMIER_GESTE.includes(s)),
];

const file: string[] = [];
let enPrechauffage = 0;

function pomper(): void {
  while (enPrechauffage < PRECHAUFFAGE_PARALLELE) {
    const url = file.shift();
    if (url === undefined) return;
    // `play()` est peut-être passé devant entre-temps : ce qui est décodé ou déjà en vol ne repart pas.
    if (tampons.has(url) || enVol.has(url)) continue;
    enPrechauffage++;
    void charger(url).then(() => {
      enPrechauffage--;
      pomper();
    });
  }
}

/** Ce qui part au premier geste : les slots fréquents, 76 Kio en Opus (99 en AAC), et rien d'autre. */
function prechauffer(): void {
  if (!debloque || !audible() || etat.settings.effets <= 0) return;
  for (const slot of ORDRE_PRECHAUFFAGE) {
    const url = urlDe(slot);
    if (!url || tampons.has(url) || enVol.has(url) || file.includes(url)) continue;
    file.push(url);
  }
  pomper();
}

/** Préchauffage contextuel : par exemple les signatures rares avant la première carte. */
export function prechargerEffets(slots: readonly SlotId[]): void {
  if (!debloque || !audible() || etat.settings.effets <= 0) return;
  for (const slot of slots) {
    if (!estSlot(slot)) continue;
    const url = urlDe(slot);
    if (!tampons.has(url) && !enVol.has(url) && !file.includes(url)) file.push(url);
  }
  pomper();
}

// ---------------------------------------------------------------------------
// Effets
// ---------------------------------------------------------------------------

interface Voix {
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** Instant de départ programmé, dans l'horloge du contexte. Une voix qui n'a pas encore commencé ne
   *  sature rien : le plafond ne doit jamais la sacrifier (voir `plafonner`). */
  quand: number;
}

const vivantes: Voix[] = [];
/** Dernier départ par slot, dans l'horloge du contexte — la même que celle qui programme les sons. */
const dernier = new Map<SlotId, number>();

/**
 * Une salve part en UNE tâche : `currentTime` n'avance qu'entre deux tâches, donc tous ses pas lisent la
 * même origine, et c'est elle qui les relie sans qu'aucun appelant ait à se déclarer.
 *
 * À quoi ça sert : un slot de salve n'est pas forcément préchargé (`pari-zero-inscrit`, `sceau-bonus` sont
 * `moyenne`), et `quand` est calculé AVANT le fetch. Si le tampon met plus longtemps à arriver que le
 * décalage — 55 ms le pas, contre 856 ms mesurés pour un fichier en 4G lente — `demarrer` retombe sur
 * `Math.max(currentTime, quand)` et tous les retardataires démarrent à leur instant d'arrivée, c'est-à-dire
 * ensemble : le registre de la manche 1 tombe en bloc au lieu de s'égrener.
 */
interface Salve {
  origine: number;
  /** Posé UNE fois, par le premier tampon en retard : les pas suivants gardent alors leur écart entre eux. */
  retard: number;
}

let salveCourante: Salve = { origine: -1, retard: 0 };

function salveDe(c: AudioContext): Salve {
  if (salveCourante.origine !== c.currentTime) salveCourante = { origine: c.currentTime, retard: 0 };
  return salveCourante;
}

/**
 * Le plafond ne compte que ce qui SONNE. Le premier jet comptait les voix créées : une salve étalée sur
 * 900 ms (le registre de fin de manche, une ligne par joueur et un sceau par bonus) poussait treize voix
 * d'un coup, et la neuvième faisait taire la première — programmée 500 ms plus tard, donc arrêtée avant
 * d'avoir commencé. Mesuré dans un vrai Chromium : à six joueurs, dix voix sur dix-huit ne sonnaient pas,
 * et les deux premiers adversaires disparaissaient du registre. Un étalement n'est pas une saturation.
 */
function plafonner(c: AudioContext): void {
  while (vivantes.length > MAX_VOIX) {
    const i = vivantes.findIndex((v) => v.quand <= c.currentTime);
    if (i < 0) return; // rien n'a encore commencé : tout est programmé, personne ne se marche dessus
    const v = vivantes.splice(i, 1)[0]!;
    try {
      const t = c.currentTime;
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0, t + COUPE);
      v.src.stop(t + COUPE);
    } catch {
      /* voix déjà finie */
    }
  }
}

function demarrer(c: AudioContext, slot: SlotId, tampon: AudioBuffer, quand: number, facteur: number): void {
  const e = SFX[slot];
  try {
    const src = c.createBufferSource();
    src.buffer = tampon;
    if (e.detune) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * DESACCORD;
    const gain = c.createGain();
    gain.gain.value = dbVersLineaire(e.gain) * Math.min(4, Math.max(0, facteur));
    src.connect(gain);
    gain.connect(busSfx ?? c.destination);
    const depart = Math.max(c.currentTime, quand);
    const voix: Voix = { src, gain, quand: depart };
    src.onended = () => {
      const i = vivantes.indexOf(voix);
      if (i >= 0) vivantes.splice(i, 1);
    };
    src.start(depart);
    vivantes.push(voix);
    plafonner(c);
  } catch {
    /* contexte fermé entre-temps */
  }
}

/**
 * Joue un slot. Ne jette jamais, ne fait rien tant que le premier geste n'a pas eu lieu.
 *
 * `at` égrène une salve : le pas `n` part `n × 55 ms` plus tard. Il court-circuite la garde anti-mitraillette,
 * et c'est voulu — le pas (55 ms) est plus court que la garde de plusieurs slots de salve (`pari-tenu-inscrit`,
 * 60 ms), qui annuleraient donc leur propre salve. La garde existe pour rattraper un déclenchement ACCIDENTEL
 * (un composant remonté, un effet qui repasse), pas pour brider une salve demandée explicitement.
 *
 * `gain` est un facteur LINÉAIRE (1 = tel quel), pour nuancer un déclenchement précis ; la correction du
 * manifeste, elle, est en dB et s'applique de toute façon.
 */
export function play(slot: SlotId, opts?: { at?: number; gain?: number }): void {
  if (!estSlot(slot)) return;
  const s = etat.settings;
  if (s.muet || s.effets <= 0 || s.maitre <= 0) return;
  const c = contexte();
  if (!c) return;
  const pas = Math.min(MAX_VOIX * 4, Math.max(0, Math.trunc(opts?.at ?? 0)));
  const throttle = SFX[slot].throttle;
  if (pas === 0 && throttle > 0) {
    const precedent = dernier.get(slot);
    if (precedent !== undefined && (c.currentTime - precedent) * 1000 < throttle) return;
    dernier.set(slot, c.currentTime);
  }
  const url = urlDe(slot);
  const salve = salveDe(c);
  const quand = salve.origine + pas * PAS_SALVE;
  const facteur = opts?.gain ?? 1;
  const pret = tampons.get(url);
  if (pret) return demarrer(c, slot, pret, quand, facteur);
  // La requête part TOUT DE SUITE, sans passer par la file de préchauffage : un son qu'on attend passe
  // devant un son qu'on prépare.
  void charger(url).then((t) => {
    if (!t) return;
    // Décale la salve entière du retard du PREMIER arrivant, une seule fois : les suivants gardent ainsi
    // leur pas les uns par rapport aux autres au lieu de s'empiler sur leur instant d'arrivée.
    if (salve.retard === 0) salve.retard = Math.max(0, c.currentTime - salve.origine);
    demarrer(c, slot, t, salve.origine + salve.retard + pas * PAS_SALVE, facteur);
  });
}

// ---------------------------------------------------------------------------
// Musique
// ---------------------------------------------------------------------------

function choixMusique(): string {
  try {
    const local = localStorage.getItem(CLE_MUSIQUE);
    if (local && MUSIQUE.variants.includes(local)) return local;
  } catch {
    /* stockage indisponible : on s'en tient au manifeste */
  }
  return MUSIQUE.chosen;
}

/**
 * `lieu` dit QUEL lit sonore tourne : celui des menus ou celui de la table. Ce n'est pas un réglage mais un
 * CONTEXTE — le joueur ne le choisit pas, l'écran le décide. `variante`, elle, ne concerne que la table :
 * changer de musique dans les réglages ne doit pas changer ce qu'on entend sur l'accueil.
 */
const etatMusique = $state({ joue: false, bloquee: false, variante: choixMusique() });

/**
 * Le lieu vit HORS du réactif, et c'est délibéré : aucun écran ne l'affiche, il ne sert qu'au moteur pour
 * savoir quelle piste monter. Le garder dans `$state` faisait écrire de l'état réactif depuis l'effet de
 * montage de la table — ce que Svelte refuse quand une dérivation est en cours de calcul, et qui faisait
 * tomber un test qui n'avait rien à voir avec la musique.
 */
let lieuCourant: Lieu = 'menus';

/** La piste réellement montée pour le lieu courant. Les menus n'en ont qu'une, la table en a quatre. */
function pisteCourante(): string | null {
  return lieuCourant === 'menus' ? (MUSIQUE.menus ?? null) : etatMusique.variante;
}

let element: HTMLAudioElement | null = null;
let fondu: GainNode | null = null;

/**
 * Lance l'élément et REND sa promesse. Elle compte : un navigateur qui refuse la lecture automatique ne lève
 * pas d'exception, il rend une promesse rejetée — c'est la seule façon de savoir si le son est vraiment parti.
 * L'appelant qui s'en moque passe par `void jouerElement(el)`, comme avant.
 */
function jouerElement(el: HTMLAudioElement): Promise<void> {
  try {
    const p: unknown = el.play();
    return p instanceof Promise ? p.catch((e: unknown) => Promise.reject(e)) : Promise.resolve();
  } catch (e) {
    /* lecture refusée sur-le-champ : le geste suivant réessaiera */
    return Promise.reject(e);
  }
}

/** Lecteur préchargé sans play() ni contexte : le geste réutilise aussi le décodeur déjà préparé. */
let musiquePreparee: HTMLAudioElement | null = null;

function creerLecteur(piste: string): HTMLAudioElement {
  const el = new Audio();
  el.loop = true;
  el.preload = 'auto';
  el.src = urlMusique(piste);
  return el;
}

/** Préparer le vrai lecteur, pas un fetch distinct du téléchargement média (Range/cache différent). */
export function prechargerMusique(): void {
  const piste = MUSIQUE.menus;
  if (!piste || musiquePreparee || element) return;
  const s = etat.settings;
  if (s.muet || s.musique <= 0 || s.maitre <= 0) return;
  try {
    musiquePreparee = creerLecteur(piste);
  } catch {
    musiquePreparee = null; // un geste ultérieur garde le chemin normal
  }
}

/** Lance la boucle à son niveau réglé dès le premier échantillon, pour préserver l’attaque. */
function monterMusique(): void {
  if (element) {
    if (element.paused) reprendreMusique(element);
    return;
  }
  const s = etat.settings;
  if (s.muet || s.musique <= 0 || s.maitre <= 0) return;
  const c = contexte();
  if (!c || !busMusique) return;
  try {
    const piste = pisteCourante();
    if (!piste) return; // les menus sans piste au manifeste : rien à monter, et surtout rien à télécharger
    const el = lieuCourant === 'menus' && musiquePreparee ? musiquePreparee : creerLecteur(piste);
    if (el === musiquePreparee) musiquePreparee = null;
    const g = c.createGain();
    g.gain.value = 1;
    c.createMediaElementSource(el).connect(g);
    g.connect(busMusique);
    g.gain.setValueAtTime(1, c.currentTime);
    element = el;
    fondu = g;
    setMediaIdentity(lieuCourant);
    reprendreMusique(el);
  } catch {
    element = null;
    fondu = null;
  }
}

/** A resolved media promise is not enough: its Web Audio context can still be suspended. */
function reprendreMusique(el: HTMLAudioElement): void {
  etatMusique.bloquee = ctx?.state !== 'running';
  void jouerElement(el).then(() => {
    if (element !== el) return;
    etatMusique.bloquee = ctx?.state !== 'running';
  }, () => {
    if (element === el) etatMusique.bloquee = el.paused || ctx?.state !== 'running';
  });
}

/**
 * Démonte la boucle en 0,6 s. L'élément est lâché AVANT le fondu : un `setVariante` enchaîné monte le suivant
 * pendant que celui-ci s'éteint — c'est un fondu croisé, gratuitement.
 */
function demonterMusique(): void {
  const el = element;
  const g = fondu;
  const c = ctx;
  element = null;
  fondu = null;
  etatMusique.bloquee = false;
  if (!el) return;
  if (c && g) {
    try {
      g.gain.setValueAtTime(g.gain.value, c.currentTime);
      g.gain.linearRampToValueAtTime(0, c.currentTime + FONDU_SORTIE);
    } catch {
      /* graphe déjà démonté */
    }
  }
  const lacher = () => {
    try {
      el.pause();
      el.removeAttribute('src');
    } catch {
      /* élément déjà libéré */
    }
  };
  // Attendre la fin du fondu n'a de sens que si on peut l'entendre. Sur un coup de « muet », le maître est
  // déjà à zéro : l'élément continuait alors de jouer ET de streamer 622 ms — mesuré — après le silence.
  if (audible()) setTimeout(lacher, FONDU_SORTIE * 1000);
  else lacher();
}

/**
 * `joue` dit l'INTENTION, pas l'état du décodeur : l'onglet caché met la boucle en pause sans éteindre le
 * bouton, et le réglage remis à zéro la coupe sans que l'écran change d'avis.
 */
export const music: {
  start(lieu?: Lieu): void;
  stop(): void;
  readonly joue: boolean;
  readonly bloquee: boolean;
  readonly lieu: Lieu;
  readonly variante: string;
  setVariante(nom: string): void;
} = {
  /**
   * Démarre — ou DÉPLACE — le lit sonore. Appelée avec le même lieu deux fois, elle ne fait rien : c'est ce
   * qui permet à un écran de la rappeler à chaque montage sans hacher la musique. Changer de lieu démonte
   * l'ancienne piste et monte la nouvelle, ce qui donne un fondu croisé gratuitement.
   */
  start(lieu: Lieu = 'table') {
    const change = lieu !== lieuCourant;
    lieuCourant = lieu;
    if (!etatMusique.joue) etatMusique.joue = true;
    if (change) demonterMusique();
    monterMusique();
  },
  stop() {
    etatMusique.joue = false;
    demonterMusique();
  },
  get bloquee() { return etatMusique.bloquee; },
  get joue() {
    return etatMusique.joue;
  },
  get lieu() {
    return lieuCourant;
  },
  get variante() {
    return etatMusique.variante;
  },
  setVariante(nom: string) {
    // Ne concerne que le lit de la TABLE. Sur les menus, le changement est mémorisé mais ne s'entend qu'en
    // entrant en partie — sinon essayer une musique depuis l'accueil couperait celle de l'accueil.
    if (!MUSIQUE.variants.includes(nom) || nom === etatMusique.variante) return;
    etatMusique.variante = nom;
    try {
      localStorage.setItem(CLE_MUSIQUE, nom);
    } catch {
      /* stockage indisponible : l'essai vaut pour cette session */
    }
    if (etatMusique.joue && lieuCourant === 'table') {
      demonterMusique();
      monterMusique();
    }
  },
};

// ---------------------------------------------------------------------------
// Déblocage et veille
// ---------------------------------------------------------------------------

/** Un joueur qui range son téléphone n'entend pas la taverne dans sa poche. */
function surveillerVisibilite(): void {
  if (surveille || typeof document === 'undefined') return;
  surveille = true;
  document.addEventListener('visibilitychange', () => {
    const c = ctx;
    if (document.visibilityState === 'hidden') {
      try {
        element?.pause();
      } catch {
        /* élément déjà libéré */
      }
      void c?.suspend?.().catch(() => {});
    } else {
      void c?.resume?.().catch(() => {});
      if (etatMusique.joue && audible() && etat.settings.musique > 0) {
        if (element) void jouerElement(element).catch(() => {});
        else monterMusique();
      }
    }
  });
}

let tentativeSansGeste = false;

/** Try autoplay once. Keep a refused element: the next trusted gesture resumes that same track. */
export function essayerMusiqueSansGeste(): void {
  if (debloque || tentativeSansGeste || !MUSIQUE.menus || !audible() || etat.settings.musique <= 0) return;
  tentativeSansGeste = true;
  const c = contexte();
  if (!c) return;
  surveillerVisibilite();
  void c.resume?.().then(() => {
    etat.pret = c.state === 'running';
    if (element && !element.paused) etatMusique.bloquee = c.state !== 'running';
  }).catch(() => {});
  music.start('menus');
}

/** Retry on trusted activation until BOTH the context and the media are running. */
export function debloquer(): void {
  if (debloque && ctx?.state === 'running' && (!element || !element.paused)) return;
  const premier = !debloque;
  debloque = true;
  const c = contexte();
  if (!c) { debloque = false; return; }
  etat.pret = true;
  // Call resume and play synchronously inside the gesture, never after an await.
  void c.resume?.().then(() => {
    etat.pret = c.state === 'running';
    if (element && !element.paused) etatMusique.bloquee = c.state !== 'running';
  }).catch(() => {});
  surveillerVisibilite();
  if (premier) prechauffer();
  if (premier || etatMusique.joue) music.start(lieuCourant);
}

export function setReglage<K extends keyof AudioSettings>(k: K, v: AudioSettings[K]): void {
  const s = etat.settings;
  if (k === 'muet') s.muet = v === true;
  else if (typeof v === 'number') {
    const n = borne(v);
    if (k === 'maitre') s.maitre = n;
    else if (k === 'effets') s.effets = n;
    else s.musique = n;
  }
  ecrireReglages();
  appliquerGains(k === 'muet');
  // Le silence n'a rien téléchargé : quand le son revient, il faut rattraper ce qu'il n'a pas pris.
  if (audible()) {
    prechauffer();
    if (etatMusique.joue && etat.settings.musique > 0) monterMusique();
    else if (etat.settings.musique <= 0) demonterMusique();
  } else {
    demonterMusique();
  }
}
