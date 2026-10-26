// La capture d'écran jointe à un rapport, côté navigateur : la réduction, l'aperçu, et ce qui part sur le fil.
//
// jsdom n'a ni encodeur d'image ni canvas : `toDataURL` y rend une chaîne vide, et `createImageBitmap`
// n'existe pas. On pose donc un canvas de théâtre — mais un canvas qui MENT COMME LE VRAI : un `toDataURL`
// qui rend du PNG quand on lui demande du WebP, ce qui est exactement le piège que `formatEcriture` doit
// attraper, et un poids qui décroît avec la qualité, ce qui est la seule raison d'être de la boucle.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { octetsDe, preparerImage } from '../lib/image';

interface Theatre {
  /** Le format que ce faux navigateur sait vraiment écrire. */
  sait: 'image/webp' | 'image/jpeg';
  /** Octets rendus pour une qualité donnée — la boucle doit descendre jusqu'à tenir dans la cible. */
  poids: (q: number, cote: number) => number;
  /** Ce que `toDataURL` a reçu, dans l'ordre : c'est la trace qui prouve la stratégie. */
  appels: { type: string; q: number; largeur: number }[];
}

let theatre: Theatre;

function base64De(octets: number): string {
  // 4 caractères de base64 pour 3 octets : on vise le nombre d'octets décodés demandé.
  return 'A'.repeat(Math.ceil(octets / 3) * 4);
}

function poserCanvas(): void {
  vi.spyOn(document, 'createElement').mockImplementation(((nom: string) => {
    const el = Object.create(HTMLElement.prototype) as HTMLCanvasElement & { width: number; height: number };
    if (nom !== 'canvas') return document.createElementNS('http://www.w3.org/1999/xhtml', nom);
    el.width = 0;
    el.height = 0;
    // Le contexte de théâtre n'implémente que les trois membres que `preparerImage` touche : le typer en
    // `CanvasRenderingContext2D` complet demanderait soixante-cinq méthodes mortes. D'où le passage par
    // `unknown`, qui dit exactement cela — « je sais que ce n'en est pas un, et c'est voulu ».
    el.getContext = ((() => ({ drawImage: () => {}, fillRect: () => {}, fillStyle: '' })) as unknown) as HTMLCanvasElement['getContext'];
    el.toDataURL = ((type?: string, q?: number) => {
      // Le mensonge du vrai navigateur : un format inconnu ne lève pas, il rend un PNG en se taisant.
      const rendu = type === theatre.sait ? theatre.sait : 'image/png';
      if (el.width > 1) theatre.appels.push({ type: type ?? '', q: q ?? 0, largeur: el.width });
      return `data:${rendu};base64,${base64De(theatre.poids(q ?? 1, el.width))}`;
    }) as HTMLCanvasElement['toDataURL'];
    return el;
  }) as typeof document.createElement);
}

/** Un fichier dont le décodage rend les dimensions voulues, sans qu'aucun octet ne soit vraiment lu. */
function fichier(largeur: number, hauteur: number, type = 'image/png'): File {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: largeur, height: hauteur, close: () => {} }));
  return new File([new Uint8Array([1, 2, 3])], 'capture.png', { type });
}

beforeEach(() => {
  theatre = { sait: 'image/webp', poids: () => 10 * 1024, appels: [] };
  poserCanvas();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('préparer une capture', () => {
  it('ramène le côté le plus long à 1 280 px, en gardant les proportions', async () => {
    const r = await preparerImage(fichier(3000, 4000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.image.hauteur).toBe(1280);
    expect(r.image.largeur).toBe(960);
  });

  it('ne GRANDIT jamais une petite image', async () => {
    const r = await preparerImage(fichier(320, 200));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.image.largeur).toBe(320);
    expect(r.image.hauteur).toBe(200);
  });

  it('descend en qualité jusqu’à tenir dans la cible, et s’arrête dès qu’elle y tient', async () => {
    // 800 Kio à pleine qualité, divisé par deux à chaque cran : la 3e qualité passe sous les 400 Kio.
    theatre.poids = (q) => (q >= 0.82 ? 800 : q >= 0.7 ? 500 : 300) * 1024;
    const r = await preparerImage(fichier(2000, 1000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.image.octets).toBeLessThanOrEqual(400 * 1024);
    // Trois essais, pas quatre : la boucle ne continue pas après avoir trouvé.
    expect(theatre.appels.map((a) => a.q)).toEqual([0.82, 0.7, 0.58]);
  });

  it('rétrécit l’image quand même la qualité la plus basse ne suffit pas', async () => {
    // Le poids ne dépend QUE de la largeur : aucune qualité ne sauve la première passe.
    theatre.poids = (_q, cote) => cote * 1024;
    const r = await preparerImage(fichier(2000, 2000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const largeurs = [...new Set(theatre.appels.map((a) => a.largeur))];
    expect(largeurs).toEqual([1280, 960, 720]);
    expect(r.image.largeur).toBe(720);
  });

  it('retombe sur le JPEG quand le navigateur ne sait pas écrire le WebP', async () => {
    // Le piège : `toDataURL('image/webp')` rend un PNG sans se plaindre. Croire le format demandé, ce serait
    // envoyer un PNG de plusieurs mégaoctets en croyant envoyer du WebP — sur un réseau de salle des fêtes.
    theatre.sait = 'image/jpeg';
    const r = await preparerImage(fichier(1000, 1000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.image.type).toBe('image/jpeg');
    expect(r.image.dataUrl.startsWith('data:image/jpeg')).toBe(true);
  });

  it('refuse ce qui n’est pas une image, sans jamais lever', async () => {
    const pdf = new File([new Uint8Array([1])], 'notes.pdf', { type: 'application/pdf' });
    const r = await preparerImage(pdf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/pas une image/);
  });

  it('dit ce qui se passe quand le navigateur ne sait pas décoder (le HEIC d’un iPhone)', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
    const heic = new File([new Uint8Array([1])], 'IMG_0001.heic', { type: 'image/heic' });
    const r = await preparerImage(heic);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/ne sait pas ouvrir/);
  });
});

describe('octetsDe', () => {
  it('compte les octets DÉCODÉS, bourrage compris', () => {
    expect(octetsDe(`data:image/webp;base64,${btoa('abc')}`)).toBe(3);
    expect(octetsDe(`data:image/webp;base64,${btoa('ab')}`)).toBe(2);
    expect(octetsDe(`data:image/webp;base64,${btoa('a')}`)).toBe(1);
  });
});
