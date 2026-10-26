// La capture d'écran d'un rapport de bug : la réduire ICI, dans le navigateur, avant qu'elle ne parte.
//
// POURQUOI ON NE L'ENVOIE PAS TELLE QUELLE. Une capture de téléphone moderne fait 2 à 5 Mio en PNG, sur un
// écran de 1 200 px de large — soit dix fois le poids utile pour une image qu'on regardera sur un écran
// d'ordinateur. Alix ouvre le jeu à une trentaine d'amis, souvent en 4G : envoyer 4 Mio depuis une salle
// mal couverte, c'est un rapport qui n'arrive jamais et quelqu'un qui ne réessaie pas.
//
// CE QUE ÇA COÛTE, ET POURQUOI C'EST LE BON PRIX. On perd du détail — jamais celui qui compte : à 1 280 px de
// côté, un texte d'interface reste lisible, une carte reste reconnaissable, une mise en page cassée saute
// toujours aux yeux. C'est un témoignage, pas une pièce à conviction.
//
// LE FORMAT. WebP quand le navigateur sait l'écrire (deux fois plus léger que le JPEG à qualité égale), JPEG
// sinon — et on le VÉRIFIE au lieu de le supposer : `toDataURL` d'un format inconnu ne lève pas d'erreur, il
// rend un PNG en se taisant. Sans ce contrôle, on croirait envoyer 300 Kio de WebP et on enverrait 3 Mio de
// PNG, exactement là où le réseau est le plus fragile.

/** Côté le plus long, en pixels. Au-delà, on ne gagne plus en lisibilité, on ne paie plus que des octets. */
const COTE_MAX = 1280;
/** Cible de poids. Le serveur refuse à 800 Kio ; on vise bien en dessous pour tenir sur un réseau faible. */
const OCTETS_CIBLE = 400 * 1024;
/** Qualités essayées dans l'ordre : on s'arrête à la première qui tient dans la cible. */
const QUALITES = [0.82, 0.7, 0.58, 0.45];

export interface ImagePrete {
  /** `data:image/webp;base64,…` — la forme exacte qu'attend le contrat de `/api/report`. */
  dataUrl: string;
  /** Poids RÉEL des octets décodés, celui que le serveur mesurera. */
  octets: number;
  largeur: number;
  hauteur: number;
  type: string;
}

export type ResultatImage = { ok: true; image: ImagePrete } | { ok: false; message: string };

/** Poids des octets derrière une `data:` URL en base64, sans la décoder. */
export function octetsDe(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bourrage = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - bourrage;
}

/** Le format d'écriture que ce navigateur sait vraiment produire (voir l'en-tête : `toDataURL` ment poliment). */
function formatEcriture(): 'image/webp' | 'image/jpeg' {
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return c.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
  } catch {
    return 'image/jpeg';
  }
}

/** Charge le fichier en image décodée. `createImageBitmap` d'abord : il décode hors du fil principal. */
async function decoder(fichier: File): Promise<{ source: CanvasImageSource; largeur: number; hauteur: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(fichier);
    return { source: bitmap, largeur: bitmap.width, hauteur: bitmap.height };
  }
  const url = URL.createObjectURL(fichier);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const e = new Image();
      e.onload = () => resolve(e);
      e.onerror = () => reject(new Error('image illisible'));
      e.src = url;
    });
    return { source: img, largeur: img.naturalWidth, hauteur: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Prépare une capture pour l'envoi : redimensionnée, réencodée, et bornée en poids.
 *
 * Ne lève jamais : elle rend un message que la feuille affiche telle quelle. Un fichier qui n'est pas une
 * image, un HEIC que le navigateur ne sait pas décoder, un canvas refusé — tout finit en une phrase lisible,
 * jamais en une erreur dans la console que personne ne verra.
 */
export async function preparerImage(fichier: File): Promise<ResultatImage> {
  if (!fichier.type.startsWith('image/')) return { ok: false, message: 'Ce fichier n’est pas une image.' };
  let decode: Awaited<ReturnType<typeof decoder>>;
  try {
    decode = await decoder(fichier);
  } catch {
    // Le cas courant et non fautif : un HEIC d'iPhone, qu'aucun navigateur de bureau ne décode. On le dit.
    return { ok: false, message: 'Ce navigateur ne sait pas ouvrir cette image — essaie une capture d’écran.' };
  }
  const { source, largeur: l0, hauteur: h0 } = decode;
  if (!l0 || !h0) return { ok: false, message: 'Image vide.' };

  const type = formatEcriture();
  let echelle = Math.min(1, COTE_MAX / Math.max(l0, h0));
  // Deux boucles imbriquées, mais bornées : quatre qualités, puis on rétrécit d'un quart et on recommence. Une
  // capture de 4 000 px atteint la cible en une ou deux passes ; la sortie de secours est le dernier essai.
  for (let passe = 0; passe < 3; passe++) {
    const largeur = Math.max(1, Math.round(l0 * echelle));
    const hauteur = Math.max(1, Math.round(h0 * echelle));
    const canvas = document.createElement('canvas');
    canvas.width = largeur;
    canvas.height = hauteur;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, message: 'Ce navigateur ne sait pas préparer l’image.' };
    // Le JPEG n'a pas de transparence : sans ce fond, une capture à coins transparents vire au noir.
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, largeur, hauteur);
    }
    ctx.drawImage(source, 0, 0, largeur, hauteur);
    let dernier: ImagePrete | null = null;
    for (const q of QUALITES) {
      let dataUrl: string;
      try {
        dataUrl = canvas.toDataURL(type, q);
      } catch {
        return { ok: false, message: 'Ce navigateur ne sait pas préparer l’image.' };
      }
      const octets = octetsDe(dataUrl);
      dernier = { dataUrl, octets, largeur, hauteur, type };
      if (octets <= OCTETS_CIBLE) return { ok: true, image: dernier };
    }
    if (passe === 2 && dernier) return { ok: true, image: dernier };
    echelle *= 0.75;
  }
  return { ok: false, message: 'Image trop lourde, même réduite.' };
}
