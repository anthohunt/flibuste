import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { MUSIQUE, PRECHARGE, SFX, SLOTS, type Credit } from '../lib/audioManifest';

// Les crédits ne sont plus dans le bundle : ils sont SERVIS, donc le test les lit là où le joueur les
// téléchargera. C'est aussi ce qui vérifie que `build.mjs` a bien écrit le fichier.
const CREDITS = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/audio/credits.json'), 'utf8'),
) as Credit[];

// jsdom n'a pas de Web Audio : sans faux contexte, aucun des garde-fous (garde anti-mitraillette, plafond de
// polyphonie, désaccord, salve, fondus) ne serait observable. Ce faux-là n'imite pas le son — il enregistre ce
// qui a été DEMANDÉ au graphe, c'est-à-dire exactement ce que le moteur promet aux écrans.
class FauxParam {
  value = 1;
  readonly rampes: { v: number; t: number }[] = [];
  setValueAtTime(v: number, _t: number): this {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this.rampes.push({ v, t });
    this.value = v;
    return this;
  }
}

class FauxNoeud {
  readonly gain = new FauxParam();
  cible: FauxNoeud | null = null;
  connect(n: FauxNoeud): FauxNoeud {
    this.cible = n;
    return n;
  }
  disconnect(): void {}
}

class FauxSource extends FauxNoeud {
  buffer: unknown = null;
  readonly playbackRate = new FauxParam();
  onended: (() => void) | null = null;
  demarre: number | null = null;
  arrete: number | null = null;
  start(t = 0): void {
    this.demarre = t;
  }
  stop(t = 0): void {
    this.arrete = t;
  }
}

let vivant: FauxContexte | null = null;

class FauxContexte {
  currentTime = 0;
  state: 'suspended' | 'running' = 'suspended';
  readonly destination = new FauxNoeud();
  readonly sources: FauxSource[] = [];
  readonly medias: HTMLAudioElement[] = [];
  readonly branchements: FauxNoeud[] = [];
  readonly resume = vi.fn(async () => {
    this.state = 'running';
  });
  readonly suspend = vi.fn(async () => {
    this.state = 'suspended';
  });
  constructor() {
    vivant = this;
  }
  createGain(): FauxNoeud {
    return new FauxNoeud();
  }
  createBufferSource(): FauxSource {
    const s = new FauxSource();
    this.sources.push(s);
    return s;
  }
  createMediaElementSource(el: HTMLAudioElement): FauxNoeud {
    const n = new FauxNoeud();
    this.medias.push(el);
    this.branchements.push(n);
    return n;
  }
  async decodeAudioData(_octets: ArrayBuffer): Promise<{ duration: number }> {
    return { duration: 0.2 };
  }
}

const fetchAudio = vi.fn(async (_url: unknown) => ({
  ok: true,
  arrayBuffer: async () => new ArrayBuffer(8),
}));

/**
 * Un `fetch` qu'on RETIENT, et qu'on sert à la demande. C'est le seul moyen d'observer deux choses qu'un
 * fetch résolu tout de suite efface complètement : une FILE (qui est en vol, qui attend son tour) et un
 * tampon qui arrive en retard. Les deux se sont mesurées en 4G lente, pas en jsdom.
 */
function fetchRetenu() {
  const enAttente: (() => void)[] = [];
  const espion = vi.fn(async (_url: unknown) => {
    await new Promise<void>((r) => enAttente.push(r));
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  });
  const servir = (n = enAttente.length) => enAttente.splice(0, n).forEach((r) => r());
  return { espion, servir };
}

/** Un moteur neuf par test : contexte, tampons et gardes sont de portée module. */
async function moteur(avecContexte = true) {
  vi.resetModules();
  vivant = null;
  fetchAudio.mockClear();
  if (avecContexte) vi.stubGlobal('AudioContext', FauxContexte);
  vi.stubGlobal('fetch', fetchAudio);
  return await import('../lib/audio.svelte');
}

/** Laisse passer la chaîne fetch → arrayBuffer → decodeAudioData avant de regarder le graphe. */
const attendre = () => new Promise<void>((r) => setTimeout(r, 0));

function contexte(): FauxContexte {
  expect(vivant).not.toBeNull();
  return vivant!;
}

function visibilite(v: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('manifeste du son', () => {
  const racine = resolve(process.cwd(), '../..');
  const chemin = (dossier: string, nom: string, ext: string) =>
    resolve(racine, `apps/web/public/audio/${dossier}/${nom}.${ext}`);

  it('sert les deux encodages de chaque variante, et retient une variante connue', () => {
    for (const slot of SLOTS) {
      const e = SFX[slot];
      expect(e.variants.length, slot).toBeGreaterThan(0);
      expect(new Set(e.variants).size, slot).toBe(e.variants.length);
      expect(e.variants, slot).toContain(e.chosen);
      for (const v of e.variants)
        for (const ext of ['webm', 'm4a'])
          expect(existsSync(chemin('sfx', `${slot}-${v}`, ext)), `${slot}-${v}.${ext}`).toBe(true);
    }
    for (const v of MUSIQUE.variants)
      for (const ext of ['webm', 'm4a']) expect(existsSync(chemin('music', v, ext)), `${v}.${ext}`).toBe(true);
    expect(MUSIQUE.variants, 'quatre ambiances, dont « feu » sans mélodie').toContain('feu');
  });

  it('n’emploie que les priorités et les fréquences que le code sait lire', () => {
    for (const slot of SLOTS) {
      expect(['P0', 'P1', 'P2'], slot).toContain(SFX[slot].priorite);
      expect(['tres-haute', 'haute', 'moyenne', 'basse', 'rare'], slot).toContain(SFX[slot].frequence);
    }
  });

  // Le budget d'octets du premier geste : c'est ce chiffre qui protège le premier rendu (PERF-01/02/04/20).
  //
  // Il se mesure dans LES DEUX formats, et c'est tout le sujet : ne le mesurer qu'en Opus, c'est le mesurer
  // sur un navigateur qu'Alix n'utilise pas. `ext()` sert du m4a à Safari iOS — son appareil — et l'AAC
  // coûte 30 % de plus à qualité égale (78 093 o contre 101 268). Le plafond des 80 Kio du design vaut donc
  // pour l'Opus ; l'AAC a le sien, écrit ici, sans quoi il pourrait dériver sans que rien ne bronche.
  it('garde le préchargement sous 80 Kio en Opus et 100 en AAC, et le fait suivre la fréquence', () => {
    const octets = { webm: 0, m4a: 0 };
    for (const slot of PRECHARGE) {
      expect(['tres-haute', 'haute'], slot).toContain(SFX[slot].frequence);
      for (const ext of ['webm', 'm4a'] as const)
        octets[ext] += statSync(chemin('sfx', `${slot}-${SFX[slot].chosen}`, ext)).size;
    }
    expect(octets.webm, `${(octets.webm / 1024).toFixed(1)} Kio en Opus`).toBeLessThan(80 * 1024);
    expect(octets.m4a, `${(octets.m4a / 1024).toFixed(1)} Kio en AAC`).toBeLessThan(100 * 1024);
    expect(PRECHARGE.length).toBeLessThan(SLOTS.filter((s) => SFX[s].priorite === 'P0').length);
  });

  // La fatigue auditive ne vient pas de la fréquence seule : elle vient de la répétition RAPPROCHÉE. Un
  // slot fréquent à garde courte part en rafale — un curseur de bot va de 0 à 10, un cran par valeur
  // entière franchie, soit dix tics en une glissade lente. Dix fois la même hauteur, c'est exactement ce
  // que le désaccord existe pour éviter. Les fréquents à garde longue (`pari-pose` 150 ms, `score-ouvre`
  // 300) ne partent qu'une fois par manche : eux n'en ont pas besoin.
  it('désaccorde tout slot fréquent capable de partir en rafale', () => {
    const rafale = SLOTS.filter(
      (s) => (SFX[s].frequence === 'tres-haute' || SFX[s].frequence === 'haute') && SFX[s].throttle <= 100,
    );
    expect(rafale, 'le cran de curseur en fait partie').toContain('cran-de-reglage');
    for (const s of rafale) expect(SFX[s].detune, s).toBe(true);
  });

  it('porte une licence libre pour chaque fichier livré', () => {
    const parFichier = new Map(CREDITS.map((c) => [c.fichier, c]));
    for (const slot of SLOTS)
      for (const v of SFX[slot].variants) {
        const credit = parFichier.get(`${slot}-${v}`);
        expect(credit, `${slot}-${v}`).toBeDefined();
        expect(credit!.licence, `${slot}-${v}`).toMatch(/^CC0|^CC-BY/);
      }
    for (const v of MUSIQUE.variants) expect(parFichier.get(`music/${v}`), v).toBeDefined();
  });
});

describe('avant le premier geste', () => {
  it('n’ouvre aucun contexte à l’import et ne demande aucun octet', async () => {
    const a = await moteur();
    expect(vivant).toBeNull();
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(a.audio.pret).toBe(false);
  });

  it('laisse `play` et la musique sans effet, sans jeter', async () => {
    const a = await moteur();
    expect(() => a.play('carte-posee-moi')).not.toThrow();
    expect(() => a.play('roi-flibustiers', { at: 2, gain: 0.5 })).not.toThrow();
    expect(() => a.music.start()).not.toThrow();
    await attendre();
    expect(vivant).toBeNull();
    expect(fetchAudio).not.toHaveBeenCalled();
  });

  // Le vrai environnement des tests unitaires : jsdom n'a ni AudioContext ni Web Audio.
  it('reste inerte et silencieux sous jsdom, sans Web Audio du tout', async () => {
    const a = await moteur(false);
    expect(() => {
      a.debloquer();
      a.play('carte-posee-moi');
      a.music.start();
      a.music.setVariante('festin');
      a.music.stop();
      a.setReglage('maitre', 0.5);
    }).not.toThrow();
    await attendre();
    expect(a.audio.pret).toBe(false);
    expect(fetchAudio).not.toHaveBeenCalled();
  });
});

describe('déblocage', () => {
  it('reprend le contexte et ne précharge QUE les slots fréquents, une seule fois', async () => {
    const a = await moteur();
    a.debloquer();
    const c = contexte();
    expect(c.resume).toHaveBeenCalled();
    expect(a.audio.pret).toBe(true);

    // Le préchauffage s'étale (voir la file, juste en dessous) : ce qui se vérifie ici, c'est qu'il finit
    // par demander exactement les slots fréquents, et rien d'autre.
    await attendre();
    const demandees = fetchAudio.mock.calls.map((appel) => String(appel[0]));
    expect(new Set(demandees)).toEqual(new Set(PRECHARGE.map((s) => a.urlDe(s))));

    a.debloquer();
    a.debloquer();
    expect(fetchAudio).toHaveBeenCalledTimes(PRECHARGE.length);
  });

  // Ce que ces deux tests protègent tient en une mesure : sur `dist` en 4G lente émulée, les 27 requêtes
  // lâchées d'un bloc faisaient arriver `bouton-presse` — pourtant préchargé — 856 ms après le doigt,
  // quand le `:active` du bouton dure 90 ms. Le joueur n'entendait pas son propre appui.
  it('précharge par paquets de quatre, les sons du premier geste en tête', async () => {
    const a = await moteur();
    const f = fetchRetenu();
    vi.stubGlobal('fetch', f.espion);
    a.debloquer();
    await attendre();

    const partis = f.espion.mock.calls.map((appel) => String(appel[0]));
    expect(partis, 'quatre en vol, pas vingt-sept').toHaveLength(4);
    expect(partis.slice(0, 2)).toEqual([a.urlDe('bouton-presse'), a.urlDe('carte-levee')]);

    f.servir(1);
    await attendre();
    expect(f.espion, 'une arrivée libère une place, une seule').toHaveBeenCalledTimes(5);
  });

  it('fait passer un son attendu devant la file de préchauffage', async () => {
    const a = await moteur();
    const f = fetchRetenu();
    vi.stubGlobal('fetch', f.espion);
    a.debloquer();
    await attendre();
    expect(f.espion).toHaveBeenCalledTimes(4);

    // `roi-flibustiers` est `basse`, donc absent du préchauffage : sa requête part sur-le-champ, par-dessus les
    // quatre en vol. Faire attendre son tour à un son qu'on vient de demander, c'est le jouer trop tard.
    a.play('roi-flibustiers');
    expect(f.espion).toHaveBeenCalledTimes(5);
    expect(String(f.espion.mock.calls.at(-1)![0])).toBe(a.urlDe('roi-flibustiers'));
  });

  it('ne dépense pas un octet quand le son est coupé, et rattrape quand il revient', async () => {
    localStorage.setItem('flibuste.audio', JSON.stringify({ muet: true, maitre: 1, effets: 0.9, musique: 0.55 }));
    const a = await moteur();
    a.debloquer();
    expect(fetchAudio).not.toHaveBeenCalled();
    a.setReglage('muet', false);
    await attendre();
    expect(fetchAudio).toHaveBeenCalledTimes(PRECHARGE.length);
  });

  it('ne retélécharge pas un fichier déjà décodé', async () => {
    const a = await moteur();
    a.debloquer();
    await attendre();
    const avant = fetchAudio.mock.calls.length;
    a.play('carte-posee-moi');
    a.play('carte-posee-autre');
    expect(fetchAudio).toHaveBeenCalledTimes(avant);
    expect(contexte().sources).toHaveLength(2);
  });
});

describe('garde-fous de lecture', () => {
  it('ignore un second déclenchement plus rapproché que la garde du slot', async () => {
    const a = await moteur();
    a.debloquer();
    await attendre();
    const c = contexte();
    expect(SFX['carte-posee-moi'].throttle).toBe(60);

    a.play('carte-posee-moi');
    a.play('carte-posee-moi');
    expect(c.sources).toHaveLength(1);

    c.currentTime = 0.07;
    a.play('carte-posee-moi');
    expect(c.sources).toHaveLength(2);
  });

  // `pari-tenu-inscrit` garde 60 ms et s'égrène par pas de 55 : sans exception, la salve s'annulerait elle-même.
  it('égrène une salve explicite malgré la garde', async () => {
    const a = await moteur();
    a.debloquer();
    await attendre();
    const c = contexte();
    for (let i = 0; i < 4; i++) a.play('pari-tenu-inscrit', { at: i });
    expect(c.sources).toHaveLength(4);
    expect(c.sources[1]!.demarre).toBeCloseTo(0.055, 5);
    expect(c.sources[3]!.demarre).toBeCloseTo(0.165, 5);
  });

  it('garde l’écart d’une salve quand le tampon arrive en retard', async () => {
    // `pari-zero-inscrit` est `moyenne`, donc PAS préchargé : le registre de la première manche d'une
    // session neuve part avec des tampons qui manquent. `quand` est calculé AVANT le fetch, et `demarrer`
    // retombe sur `Math.max(currentTime, quand)` — sans repère commun, chaque retardataire démarrerait
    // donc à son instant d'arrivée, c'est-à-dire tous ensemble, et le registre tomberait d'un bloc.
    const a = await moteur();
    const f = fetchRetenu();
    vi.stubGlobal('fetch', f.espion);
    a.debloquer();
    const c = contexte();
    for (let i = 0; i < 4; i++) a.play('pari-zero-inscrit', { at: i });

    c.currentTime = 0.9; // le fichier a mis 900 ms à venir : seize fois le pas de la salve
    f.servir();
    await attendre();

    expect(c.sources).toHaveLength(4);
    [0.9, 0.955, 1.01, 1.065].forEach((v, i) => expect(c.sources[i]!.demarre).toBeCloseTo(v, 5));
  });

  it('plafonne la polyphonie à 8 voix et coupe la plus ancienne en fondu de 30 ms', async () => {
    const a = await moteur();
    a.debloquer();
    await attendre();
    const c = contexte();
    for (const slot of PRECHARGE.slice(0, 9)) a.play(slot);
    expect(c.sources).toHaveLength(9);

    const doyenne = c.sources[0]!;
    expect(doyenne.arrete).toBeCloseTo(0.03, 5);
    expect(doyenne.cible!.gain.rampes.at(-1)).toEqual({ v: 0, t: 0.03 });
    expect(c.sources[1]!.arrete).toBeNull();
  });

  it('désaccorde les slots marqués, et seulement eux', async () => {
    const a = await moteur();
    a.debloquer();
    await attendre();
    const c = contexte();
    expect(SFX['carte-posee-moi'].detune).toBe(true);
    expect(SFX['pari-pose'].detune).toBe(false);

    vi.spyOn(Math, 'random').mockReturnValue(1);
    a.play('carte-posee-moi');
    expect(c.sources[0]!.playbackRate.value).toBeCloseTo(1.025, 5);

    a.play('pari-pose');
    expect(c.sources[1]!.playbackRate.value).toBe(1);
  });

  it('applique la correction du manifeste en dB et le facteur d’appel en linéaire', async () => {
    const a = await moteur();
    a.debloquer();
    await attendre();
    const c = contexte();
    expect(SFX['carte-posee-autre'].gain).toBe(-4);
    a.play('carte-posee-autre', { gain: 0.5 });
    expect(c.sources[0]!.cible!.gain.value).toBeCloseTo(10 ** (-4 / 20) * 0.5, 5);
  });
});

describe('réglages', () => {
  it('part des valeurs d’usine et les mémorise', async () => {
    const a = await moteur();
    expect(a.audio.settings).toEqual({ muet: false, maitre: 1, effets: 0.9, musique: 0.55 });
    a.setReglage('musique', 0.2);
    expect(JSON.parse(localStorage.getItem('flibuste.audio')!).musique).toBe(0.2);
  });

  it('borne les volumes et retombe sur les valeurs d’usine si le stockage ment', async () => {
    localStorage.setItem('flibuste.audio', '{ceci n’est pas du JSON');
    const a = await moteur();
    expect(a.audio.settings.maitre).toBe(1);
    a.setReglage('maitre', 4);
    a.setReglage('effets', -1);
    expect(a.audio.settings.maitre).toBe(1);
    expect(a.audio.settings.effets).toBe(0);
  });

  it('survit à un stockage qui jette (mode privé, quota)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const a = await moteur();
    expect(() => a.setReglage('maitre', 0.3)).not.toThrow();
    expect(a.audio.settings.maitre).toBe(0.3);
  });

  it('porte les DEUX curseurs au graphe, chacun sur sa voie, et coupe tout en muet', async () => {
    const a = await moteur();
    a.debloquer();
    const c = contexte();
    a.setReglage('effets', 0.4);
    a.play('carte-posee-moi');
    await attendre();

    const busSfx = c.sources[0]!.cible!.cible!;
    expect(busSfx.gain.value).toBe(0.4);
    // Le bus maître ne porte plus de réglage : il vaut 1 et ne sert qu'au fondu du muet. Le joueur n'a que
    // deux curseurs — un par voie — parce qu'un « volume général » au-dessus les ferait mentir.
    expect(busSfx.cible!.gain.value).toBe(1);
    expect(busSfx.cible!.cible).toBe(c.destination);

    a.setReglage('muet', true);
    expect(busSfx.cible!.gain.value).toBe(0);
    const avant = c.sources.length;
    a.play('carte-posee-autre');
    expect(c.sources).toHaveLength(avant);
  });

  it('coupe le maître par une rampe courte, et lâche la boucle sans attendre le fondu', async () => {
    const a = await moteur();
    a.debloquer();
    const c = contexte();
    a.play('carte-posee-moi');
    await attendre();
    const maitre = c.sources[0]!.cible!.cible!.cible!;
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    a.music.start();

    // Un CURSEUR bouge par petits pas : le fondre s'entendrait, chaque pas annulant le précédent.
    a.setReglage('maitre', 0.4);
    expect(maitre.gain.rampes).toEqual([]);
    expect(maitre.gain.value).toBe(0.4);

    // Le MUET, lui, est un saut. Sans rampe, il claque au milieu d'une note tenue de la boucle ; 10 ms ne
    // s'entendent pas comme un délai. Et la boucle s'arrête TOUT DE SUITE : le fondu de 600 ms ne s'entend
    // pas derrière un maître à zéro, il ne faisait que continuer à streamer — 622 ms mesurés.
    c.currentTime = 3;
    a.setReglage('muet', true);
    expect(maitre.gain.rampes.at(-1)).toEqual({ v: 0, t: 3.01 });
    expect(pause).toHaveBeenCalled();

    a.setReglage('muet', false);
    expect(maitre.gain.rampes.at(-1)).toEqual({ v: 0.4, t: 3.01 });
  });
});

describe('musique', () => {
  it('le premier geste allume le lit des MENUS, pas celui de la table', async () => {
    const a = await moteur();
    a.debloquer();
    // Les menus étaient muets ; Alix les veut habités. `debloquer` monte donc sa piste au premier geste —
    // le seul instant qu'un navigateur mobile autorise — et c'est bien la piste des MENUS, pas la taverne.
    expect(a.music.lieu).toBe('menus');
    expect(a.music.joue).toBe(true);
    const c = contexte();
    expect(c.medias).toHaveLength(1);
    expect(c.medias[0]!.src).toContain(`/audio/music/${MUSIQUE.menus}.`);
  });

  it('entrer en partie échange les deux lits, en sortir ramène celui des menus', async () => {
    const a = await moteur();
    a.debloquer();
    const c = contexte();
    a.music.start('table');
    expect(a.music.lieu).toBe('table');
    // Deux éléments : celui des menus s'éteint pendant que la taverne monte — le fondu croisé est gratuit.
    expect(c.medias).toHaveLength(2);
    expect(c.medias.at(-1)!.src).toContain(`/audio/music/${a.music.variante}.`);

    a.music.start('table'); // rappelé sur le même lit : ne doit RIEN faire, sinon la musique se hacherait
    expect(c.medias).toHaveLength(2);

    a.music.start('menus');
    expect(a.music.lieu).toBe('menus');
    expect(c.medias.at(-1)!.src).toContain(`/audio/music/${MUSIQUE.menus}.`);
  });

  it('préserve l’attaque sans fondu d’entrée et sort en 0,6 s', async () => {
    const a = await moteur();
    a.debloquer();
    const c = contexte();
    expect(a.music.joue).toBe(true);
    expect(c.medias).toHaveLength(1);
    expect(c.medias[0]!.loop).toBe(true);

    const fondu = c.branchements[0]!.cible!;
    expect(fondu.gain.value).toBe(1);
    expect(fondu.gain.rampes).toEqual([]);

    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    c.currentTime = 2;
    a.music.stop();
    expect(a.music.joue).toBe(false);
    expect(fondu.gain.rampes.at(-1)).toEqual({ v: 0, t: 2.6 });
    // Tant que le fondu s'entend, l'élément n'est pas lâché : le couper net serait le clic qu'on évite.
    expect(pause).not.toHaveBeenCalled();
  });

  it('ne charge pas la boucle quand le son est coupé AVANT le premier geste, sans perdre l’intention', async () => {
    const a = await moteur();
    // Le muet est posé avant `debloquer` : c'est le cas du joueur qui a coupé le son à sa visite précédente,
    // et il ne doit pas payer les 496 Kio de la boucle qu'il n'entendra pas.
    a.setReglage('muet', true);
    a.debloquer();
    expect(contexte().medias).toHaveLength(0);
    expect(a.music.joue).toBe(true);

    a.setReglage('muet', false);
    expect(contexte().medias).toHaveLength(1);
  });

  it('change d’ambiance et mémorise le choix', async () => {
    const a = await moteur();
    a.debloquer();
    a.music.start('table');
    expect(contexte().medias).toHaveLength(2); // menus éteints, taverne montée
    a.music.setVariante('feu');
    expect(a.music.variante).toBe('feu');
    expect(localStorage.getItem('flibuste.audio.music')).toBe('feu');
    expect(contexte().medias).toHaveLength(3); // l'ancienne s'éteint pendant que la nouvelle monte

    a.music.setVariante('inconnue');
    expect(a.music.variante).toBe('feu');
    expect(contexte().medias).toHaveLength(3);
  });

  it('changer d’ambiance depuis les MENUS ne coupe pas la musique des menus', async () => {
    const a = await moteur();
    a.debloquer();
    expect(a.music.lieu).toBe('menus');
    const avant = contexte().medias.length;
    a.music.setVariante('festin');
    // Le choix est mémorisé pour la table, mais rien ne bouge ici : essayer une musique depuis l'accueil
    // couperait celle de l'accueil, et le joueur entendrait un blanc pour un réglage qui ne le concerne pas.
    expect(a.music.variante).toBe('festin');
    expect(contexte().medias).toHaveLength(avant);
    expect(contexte().medias.at(-1)!.src).toContain(`/audio/music/${MUSIQUE.menus}.`);
  });
});

describe('onglet caché', () => {
  it('suspend le contexte et met la boucle en pause, puis reprend', async () => {
    const a = await moteur();
    a.debloquer();
    const c = contexte();
    a.music.start();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

    visibilite('hidden');
    expect(c.suspend).toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();

    c.resume.mockClear();
    visibilite('visible');
    expect(c.resume).toHaveBeenCalled();
    visibilite('visible');
  });
});

describe('essayage', () => {
  it('sert la variante du manifeste, puis celle qu’on essaie', async () => {
    const a = await moteur();
    const chosen = SFX['carte-posee-moi'].chosen;
    expect(a.variantesDe('carte-posee-moi')).toEqual({ variants: SFX['carte-posee-moi'].variants, chosen });
    expect(a.urlDe('carte-posee-moi')).toBe(`/audio/sfx/carte-posee-moi-${chosen}.m4a`);

    a.choixLocal('carte-posee-moi', 'v3');
    expect(a.variantesDe('carte-posee-moi').chosen).toBe('v3');
    expect(a.urlDe('carte-posee-moi')).toBe('/audio/sfx/carte-posee-moi-v3.m4a');
    expect(a.urlDe('carte-posee-moi', 'v2')).toBe('/audio/sfx/carte-posee-moi-v2.m4a');
    expect(localStorage.getItem('flibuste.audio.carte-posee-moi')).toBe('v3');

    a.choixLocal('carte-posee-moi', null);
    expect(a.variantesDe('carte-posee-moi').chosen).toBe(chosen);
    expect(localStorage.getItem('flibuste.audio.carte-posee-moi')).toBeNull();
  });

  it('sert le WebM quand le navigateur sait lire l’Opus', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
    const a = await moteur();
    expect(a.urlDe('carte-posee-moi')).toMatch(/\.webm$/);
    expect(a.urlMusique('taverne')).toBe('/audio/music/taverne.webm');
  });

  // La barrière qui tient tout le reste : `SlotId` est l'union des clés RÉELLES du manifeste, donc un nom de
  // son inventé par un écran ne compile pas. `@ts-expect-error` est ici l'inverse d'un `@ts-ignore` — il exige
  // l'erreur : le jour où `SlotId` retomberait à `string`, c'est `svelte-check` qui échouerait, pas le joueur.
  it('refuse à la compilation un slot qui n’existe pas', async () => {
    const a = await moteur();
    a.debloquer();
    // @ts-expect-error — « carte-poser » n'est pas un slot du manifeste
    expect(() => a.play('carte-poser')).not.toThrow();
    expect(contexte().sources).toHaveLength(0);
  });

  it('sert les crédits de tout ce qui est livré, hors du bundle', async () => {
    const a = await moteur();
    expect(typeof a.chargerCredits).toBe('function');
    expect(CREDITS.length).toBeGreaterThanOrEqual(SLOTS.length * 3);
    expect(CREDITS[0]).toMatchObject({ fichier: expect.any(String), licence: expect.any(String) });
    // La trace légale ne doit PAS voyager avec le manifeste : c'est ce qui la faisait peser 37 Kio dans le
    // chunk d'entrée, donc dans le précache, pour une liste que presque personne ne déplie.
    const manifeste = JSON.parse(readFileSync(resolve(__dirname, '../../audio/manifest.json'), 'utf8'));
    expect(manifeste).not.toHaveProperty('credits');
  });
});

describe('le lit des menus ne se recharge pas sans raison', () => {
  it('rappeler `start` sur le même lieu ne remonte RIEN', async () => {
    const a = await moteur();
    a.debloquer();
    const c = contexte();
    const avant = c.medias.length;
    // Le bug qu'Alix a entendu : l'effet de la table suivait la VUE, remplacée à chaque carte jouée, donc
    // il se démontait et se remontait des dizaines de fois par manche — et la musique repartait de zéro à
    // chaque fois. Le moteur doit être insensible à ce genre d'appel répété.
    for (let i = 0; i < 20; i++) a.music.start('menus');
    expect(c.medias).toHaveLength(avant);
    a.music.start('table');
    const enPartie = c.medias.length;
    for (let i = 0; i < 20; i++) a.music.start('table');
    expect(c.medias).toHaveLength(enPartie);
  });

  it('précharge la boucle des menus sans la jouer, et une seule fois', async () => {
    const a = await moteur();
    // Aucun geste : rien ne joue, mais le fichier peut descendre — c'est ce qui supprime le silence d'attente.
    a.prechargerMusique();
    a.prechargerMusique();
    a.prechargerMusique();
    expect(fetchAudio).not.toHaveBeenCalled(); // le lecteur utilise le chargement média natif
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(vivant).toBeNull(); // rien n'a été joué : pas de contexte audio ouvert
    a.debloquer();
    expect(contexte().medias).toHaveLength(1);
    expect(contexte().medias[0]!.src).toContain(`${MUSIQUE.menus}.`);
  });

  it('ne précharge rien quand le son est coupé : on ne télécharge pas ce qu’on ne jouera pas', async () => {
    const a = await moteur();
    a.setReglage('muet', true);
    a.prechargerMusique();
    expect(fetchAudio.mock.calls.map((x) => String(x[0])).filter((u) => u.includes('/audio/music/'))).toHaveLength(0);
  });
});

describe('première visite : une tentative refusée ne condamne pas les suivantes', () => {
  it('réessaie le même élément après un refus et garde la piste sans doublon', async () => {
    const a = await moteur();
    const mediaPlay = vi.mocked(HTMLMediaElement.prototype.play);
    mediaPlay.mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'));
    a.essayerMusiqueSansGeste();
    await attendre();
    expect(a.music.bloquee).toBe(true);
    const c = contexte();
    expect(c.medias).toHaveLength(1);
    a.debloquer();
    await attendre();
    expect(mediaPlay).toHaveBeenCalledTimes(2);
    expect(c.medias).toHaveLength(1);
    expect(a.music.bloquee).toBe(false);
  });

  it('ne croit pas une promesse play résolue si le contexte reste suspendu', async () => {
    const a = await moteur();
    a.essayerMusiqueSansGeste();
    await attendre();
    const c = contexte();
    c.state = 'suspended';
    c.resume.mockImplementation(async () => {});
    a.debloquer();
    await attendre();
    expect(a.music.bloquee).toBe(true);
    c.resume.mockImplementation(async () => { c.state = 'running'; });
    a.debloquer();
    await attendre();
    expect(a.music.bloquee).toBe(false);
    expect(c.medias).toHaveLength(1);
  });
});
