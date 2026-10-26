// Codex des cartes (vague 6) : une fiche par carte — nom, rang dans la hiérarchie du pli, explication courte, cas
// particuliers — pour le zoom à l'appui long (`CardZoom`) et le menu Codex (`CodexSheet`). Les situations jouables
// sont dans `situations.ts`. Les noms viennent du moteur (`cardNameFr`) via `cardMeta.ts`.
import type { Card, PirateName, Suit } from './types';
import { ART_NAME, PIRATE_ABILITY, PIRATE_LABEL, SUIT_COLOUR_WORD, SUIT_LABEL, SUIT_THE, artIdFor, cardLabel } from './cardMeta';

/** Étage de la hiérarchie du pli, du plus fort au plus faible ; `none` = la carte change la règle du pli. */
export type Tier = 'pirateking' | 'pirate' | 'mermaid' | 'black' | 'colour' | 'escape' | 'none';

export const TIERS: readonly { tier: Exclude<Tier, 'none'>; name: string }[] = [
  { tier: 'pirateking', name: 'Roi des Flibustiers' },
  { tier: 'pirate', name: 'Pirates' },
  { tier: 'mermaid', name: 'Sirènes' },
  { tier: 'black', name: 'Pavillon (noir)' },
  { tier: 'colour', name: 'Couleurs' },
  { tier: 'escape', name: 'Fuites' },
];

export type CodexGroup = 'special' | 'suit' | 'expansion' | 'custom';

export interface CodexEntry {
  /** Identifiant du codex (= id d'illustration : `helm`, `pirateking`, `parrot`…). */
  id: string;
  name: string;
  group: CodexGroup;
  tier: Tier;
  /** Deux étages quand la carte se déclare (Tigresse : pirate ou fuite). */
  altTier?: Tier;
  /** Explication courte. */
  short: string;
  /** Cas particuliers, une phrase chacun. */
  cases: string[];
  /** Carte-exemple pour l'illustration. */
  sample: Card;
}

const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

const PIRATE_CASES: Record<PirateName, string[]> = {
  helm: ['Le pouvoir se déclenche seulement si Maren gagne le pli.', 'Tu peux te désigner toi-même pour mener.', 'Au dernier pli de la manche, le pouvoir ne sert à rien.'],
  trader: ['Tu pioches deux cartes du talon, puis tu en défausses deux de ta main (les piochées ou d’autres).', 'Sans talon (toutes les cartes distribuées), rien ne se passe.', 'Au dernier pli, le pouvoir ne sert à rien.'],
  adjuster: ['Tu peux monter ou baisser ton pari de 1, ou le garder — même après avoir vu le pli.', 'Un pari 0 remonté à 1 change tout le calcul des points.', 'Se déclenche seulement si Gaspard gagne le pli.'],
  oracle: ['Tu regardes les cartes non distribuées jusqu’à ta prochaine carte jouée.', 'Utile pour savoir si le Roi des Flibustiers ou les sirènes sont encore en main.', 'Sans talon, rien à voir.'],
  gambler: ['Pari 0 : rien ne change. 10 : +10 si ton pari tient, −10 sinon. 20 : ±20.', 'Le pari de Rufus se joue en plus des points de la manche.', 'Se déclenche seulement si Rufus gagne le pli.'],
  hexer: ['Tu choisis un adversaire ; le moteur tire une carte au hasard dans sa main.', 'Il devra la jouer au prochain pli, même si elle ne suit pas la couleur.', 'Si la carte change de main (Tempête), la contrainte suit la carte.'],
};

function pirateEntry(p: PirateName, group: CodexGroup = 'special'): CodexEntry {
  return {
    id: p,
    name: PIRATE_LABEL[p],
    group,
    tier: 'pirate',
    short: `Pirate : bat tous les numéros et les sirènes, perd contre le Roi des Flibustiers. Son pouvoir quand il gagne le pli : ${PIRATE_ABILITY[p].charAt(0).toLowerCase()}${PIRATE_ABILITY[p].slice(1)}.`,
    cases: ['+20 par sirène capturée, si ton pari tient.', 'Plusieurs pirates dans le pli : le premier posé gagne.', ...PIRATE_CASES[p]],
    sample: { id: `pirate-${p}`, kind: 'pirate', pirate: p },
  };
}

/**
 * Fiche d'une couleur. Deux choses que le texte devait dire et ne disait pas :
 * la couleur qu'on VOIT sur la carte — le nom « Doublon » ne dit pas « jaune » (CT-10) —
 * et le nom avec son article, sans le décapitaliser ni l'accorder au masculin (CT-11).
 */
function suitEntry(suit: Suit): CodexEntry {
  const black = suit === 'roger';
  const colour = SUIT_COLOUR_WORD[suit];
  const the = SUIT_THE[suit];
  return {
    id: suit,
    name: SUIT_LABEL[suit],
    group: 'suit',
    tier: black ? 'black' : 'colour',
    short: black
      ? 'Le Pavillon, c’est le noir — l’atout : il bat n’importe quelle couleur, et le plus haut noir gagne. Si tu joues un numéro, tu dois suivre le noir demandé quand tu en as.'
      : `${cap(the)}, c’est le ${colour} : un numéro doit suivre cette couleur demandée si tu l’as. Le plus haut ${colour} gagne entre numéros de cette couleur ; l’atout et les personnages le battent.`,
    cases: black
      ? ['14 noir capturé : +20 de bonus si ton pari tient.', 'Un seul noir dans le pli suffit à battre tous les 14 de couleur.', 'Les personnages battent le noir et restent jouables même si tu as la couleur.']
      : [`Le 14 ${colour} capturé : +10 de bonus si ton pari tient.`, `Tu n’as pas de ${colour} : tout est permis, une autre couleur ordinaire perd, mais le noir peut gagner.`, 'Une spéciale (fuite, pirate…) se joue toujours, même si tu as la couleur.'],
    sample: { id: `${suit}-14`, kind: 'number', suit, rank: 14 },
  };
}

export const CODEX: readonly CodexEntry[] = [
  {
    id: 'pirateking',
    name: ART_NAME.pirateking!,
    group: 'special',
    tier: 'pirateking',
    short: 'Le roi : il bat tous les pirates et tous les numéros — seule une sirène le capture.',
    cases: ['+30 par pirate capturé, si ton pari tient.', 'Une sirène capture le roi, même avec un pirate dans le pli : +40 si son pari tient.', 'Mené, il ne demande aucune couleur : chacun joue ce qu’il veut.'],
    sample: { id: 'pirateking', kind: 'pirateking' },
  },
  {
    id: 'mermaid',
    name: ART_NAME.mermaid!,
    group: 'special',
    tier: 'mermaid',
    short: 'Bat tous les numéros et capture le Roi des Flibustiers (+40), mais perd contre n’importe quel pirate.',
    cases: ['Sirène + pirate + Roi des Flibustiers dans le même pli : la sirène gagne.', 'Deux sirènes : la première posée gagne.', 'Capturée par un pirate : +20 pour lui si son pari tient.'],
    sample: { id: 'mermaid-1', kind: 'mermaid' },
  },
  pirateEntry('helm'),
  pirateEntry('trader'),
  pirateEntry('adjuster'),
  pirateEntry('oracle'),
  pirateEntry('gambler'),
  {
    id: 'tigress',
    name: ART_NAME.tigress!,
    group: 'special',
    tier: 'pirate',
    altTier: 'escape',
    short: 'Se déclare à la pose : pirate (bat numéros et sirènes) ou fuite (perd contre eux).',
    cases: ['En pirate, elle rapporte +20 par sirène si ton pari tient et perd contre le Roi des Flibustiers.', 'En fuite, elle sert à esquiver un pli quand tu as déjà tes plis.', 'Après des fuites en tête, la première carte qui n’est pas une fuite décide : numéro = sa couleur ; personnage = pli libre.', 'Elle n’a pas de pouvoir.'],
    sample: { id: 'tigress', kind: 'tigress' },
  },
  {
    id: 'escape',
    name: ART_NAME.escape!,
    group: 'special',
    tier: 'escape',
    short: 'Perd contre les numéros et personnages ; la première fuite gagne si tout le monde fuit.',
    cases: ['Que des fuites dans le pli : la première posée gagne quand même.', 'Se joue même si tu as la couleur demandée.', 'Après des fuites en tête, la première carte qui n’est pas une fuite décide : numéro = sa couleur ; personnage = pli libre.'],
    sample: { id: 'escape-1', kind: 'escape' },
  },
  {
    id: 'loot',
    name: ART_NAME.loot!,
    group: 'special',
    tier: 'escape',
    short: 'Vaut une fuite et s’allie au gagnant du pli : +20 chacun si vos deux paris tiennent.',
    cases: ['Si l’un des deux rate son pari, aucun bonus pour personne.', 'Que des fuites et le Butin : le premier posé gagne le pli.', 'Après des fuites en tête, la première carte qui n’est pas une fuite décide : numéro = sa couleur ; personnage = pli libre.', 'Pas d’alliance si le pli est défaussé (Kraken).'],
    sample: { id: 'loot-1', kind: 'loot' },
  },
  {
    id: 'kraken',
    name: ART_NAME.kraken!,
    group: 'special',
    tier: 'none',
    short: 'Personne ne gagne le pli : il est défaussé, et celui qui l’aurait gagné mène le suivant.',
    cases: ['Aucun bonus n’est marqué dans un pli au Kraken.', 'Kraken et Baleine dans le même pli : le dernier posé l’emporte, l’autre vaut une fuite.', 'Bon pour faire rater un pari… y compris le tien.'],
    sample: { id: 'kraken', kind: 'kraken' },
  },
  {
    id: 'whale',
    name: ART_NAME.whale!,
    group: 'special',
    tier: 'none',
    short: 'Seuls les numéros comptent : le plus haut gagne, sans atout ni couleur, et les personnages ne valent plus rien.',
    cases: ['Pas de numéro dans le pli : personne ne le gagne.', 'Les bonus des personnages tombent ; ceux des 14 restent.', 'Baleine et Kraken ensemble : le dernier posé agit.'],
    sample: { id: 'whale', kind: 'whale' },
  },
  // Extension
  pirateEntry('hexer', 'expansion'),
  {
    id: 'flex14',
    name: '0 / 14',
    group: 'expansion',
    tier: 'colour',
    short: 'Un numéro qui se déclare 0 ou 14 à la pose, dans sa couleur : en 14 il gagne comme un 14, mais sans bonus.',
    cases: ['Déclaré 14, il gagne comme un 14 mais ne rapporte pas de bonus.', 'Déclaré 0, il reste un numéro : il peut gagner contre des fuites ou sous la Raie.', 'Il suit la couleur comme les autres numéros.'],
    sample: { id: 'parrot-014', kind: 'flex14', suit: 'parrot' },
  },
  {
    id: 'wild15',
    name: ART_NAME.wild15!,
    group: 'expansion',
    tier: 'colour',
    short: 'Un 15 jaune, violet ou vert : au choix s’il mène, sinon dans la couleur demandée — mais sous le noir mené, il perd.',
    cases: ['Il bat le 14 de sa couleur.', 'Un pavillon le bat, comme n’importe quelle couleur.', 'Pas de bonus.'],
    sample: { id: 'wild15', kind: 'wild15' },
  },
  {
    id: 'mate',
    name: ART_NAME.mate!,
    group: 'expansion',
    tier: 'pirate',
    short: 'Bat tout sauf le Roi des Flibustiers et les sirènes, qui le capturent (+30) ; il prend les pouvoirs des pirates.',
    cases: ['Capturé par le Roi des Flibustiers ou une sirène : +30 si leur pari tient.', 'Second et pirates dans le pli : le Second gagne, même posé après.', 'Il ne rapporte jamais les +20 d’une sirène.'],
    sample: { id: 'mate', kind: 'mate' },
  },
  {
    id: 'volley',
    name: ART_NAME.volley!,
    group: 'expansion',
    tier: 'none',
    short: 'Ne gagne jamais ; quand tout le monde a joué, tu reposes une carte dans ce pli, puis tu sautes le dernier pli.',
    cases: ['Ta seconde carte peut gagner le pli.', 'Ta main s’épuise un pli avant celles des autres : tu sautes le dernier pli, sauf si la Salve est jouée au dernier pli.', 'Sans carte à rejouer, la Salve ne fait rien — et elle ne compte pas comme une fuite.', 'Après des fuites en tête, la première carte qui n’est pas une fuite décide : numéro = sa couleur ; personnage = pli libre.'],
    sample: { id: 'volley', kind: 'volley' },
  },
  {
    id: 'plank',
    name: ART_NAME.plank!,
    group: 'expansion',
    tier: 'none',
    short: 'Ne gagne jamais ; à la fin du pli, un pirate est retiré : il ne peut ni gagner ni rapporter de bonus.',
    cases: ['Un seul pirate : il est retiré d’office. Plusieurs : tu choisis.', 'Le Roi des Flibustiers n’est pas un pirate : la Planche ne le retire pas.', 'Le pirate retiré ne déclenche pas son pouvoir.'],
    sample: { id: 'plank', kind: 'plank' },
  },
  {
    id: 'stingray',
    name: ART_NAME.stingray!,
    group: 'expansion',
    tier: 'none',
    short: 'Le numéro le plus bas gagne le pli ; les personnages ne valent plus rien.',
    cases: ['Pas de numéro dans le pli : personne ne le gagne.', 'Les bonus des personnages tombent.', 'Raie et Baleine ensemble : le dernier posé agit.'],
    sample: { id: 'stingray', kind: 'stingray' },
  },
  {
    id: 'davy',
    name: ART_NAME.davy!,
    group: 'expansion',
    tier: 'none',
    short: 'Ne gagne jamais ; détruit les léviathans du pli (Kraken, Baleine, Raie) : +20 par léviathan si ton pari tient.',
    cases: ['Un Kraken détruit ne défausse plus le pli : il se joue normalement.', 'Sans léviathan, le Casier vaut une carte qui ne gagne pas.', 'Le Casier agit même posé avant le léviathan.'],
    sample: { id: 'davy', kind: 'davy' },
  },
  // Carte maison
  {
    id: 'storm',
    name: ART_NAME.storm!,
    group: 'custom',
    tier: 'escape',
    short: 'Vaut une fuite. Avant le pli suivant, chacun passe une carte de son choix à son voisin de gauche — en même temps.',
    cases: ['Les cartes choisies restent secrètes jusqu’à ce que tous les joueurs aient choisi ; elles changent alors de main ensemble.', 'Avec une seule carte en main, elle part d’office.', 'À deux cartes en main, la Tempête doit partir ; une carte imposée par Mathilde reste prioritaire. Pas de Tempête distribuée à une carte.'],
    sample: { id: 'storm', kind: 'storm' },
  },
  // Les couleurs
  suitEntry('parrot'),
  suitEntry('chest'),
  suitEntry('map'),
  suitEntry('roger'),
];

export const CODEX_BY_ID: Readonly<Record<string, CodexEntry>> = Object.fromEntries(CODEX.map((e) => [e.id, e]));

export const GROUP_NAME: Record<CodexGroup, string> = { special: 'Les spéciales', suit: 'Les couleurs', expansion: 'L’extension', custom: 'Cartes maison' };
export const GROUPS: readonly CodexGroup[] = ['special', 'suit', 'expansion', 'custom'];

/** Fiche du codex d'une carte : le pirate (`helm`…), la couleur (`parrot`…), sinon son genre. */
export function codexIdFor(card: Card): string {
  return artIdFor(card);
}

export function codexEntryFor(card: Card): CodexEntry | null {
  return CODEX_BY_ID[codexIdFor(card)] ?? null;
}

/** Fiche « à la volée » pour une carte inconnue du codex (genre ajouté par le moteur) : nom seul. */
export function codexEntryOrDefault(card: Card): CodexEntry {
  return (
    codexEntryFor(card) ?? {
      id: codexIdFor(card),
      name: cardLabel(card),
      group: 'special',
      tier: 'none',
      short: 'Une carte que ce codex ne connaît pas encore.',
      cases: [],
      sample: card,
    }
  );
}

/** Rang lisible : « Bat les pirates, perd contre les sirènes ». */
export function tierName(tier: Tier): string {
  return TIERS.find((t) => t.tier === tier)?.name ?? 'Hors hiérarchie';
}
