// La capture d'écran jointe à un rapport : ce qui est accepté, ce qui est refusé, et ce qui revient en base.
//
// Le test qui compte est celui de la SIGNATURE. Le genre annoncé dans une `data:` URL est écrit par le client
// — donc par n'importe qui : la seule chose qui dise qu'un fichier est une image, ce sont ses premiers octets.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../src/db';
import { LIMITES, parseImage, parseReport } from '../src/server';

/** Un WebP minimal mais VRAI : en-tête RIFF….WEBP, tel qu'un encodeur en produit. */
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8L', 'ascii'),
  Buffer.alloc(14, 0x20),
]);
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(20, 0x11)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20, 0x22)]);

const url = (type: string, octets: Buffer) => `data:${type};base64,${octets.toString('base64')}`;

describe('la capture jointe à un rapport', () => {
  it('accepte les trois formats que le client sait produire', () => {
    for (const [type, octets] of [
      ['image/webp', WEBP],
      ['image/png', PNG],
      ['image/jpeg', JPEG],
    ] as const) {
      const r = parseImage(url(type, octets));
      expect(r.ok, `${type} devrait passer`).toBe(true);
      if (r.ok) {
        expect(r.valeur.imageType).toBe(type);
        expect(r.valeur.image.equals(octets)).toBe(true);
      }
    }
  });

  it('refuse un fichier qui MENT sur son genre — c’est la signature qui tranche', () => {
    // Un exécutable (MZ…) présenté comme un PNG : l'en-tête `data:` dit `image/png`, les octets disent non.
    const menteur = url('image/png', Buffer.concat([Buffer.from('MZ', 'ascii'), Buffer.alloc(30, 0)]));
    const r = parseImage(menteur);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.msg).toMatch(/n’est pas un fichier image\/png/);
  });

  it('refuse un format d’image qu’on ne sert pas', () => {
    const r = parseImage(url('image/svg+xml', Buffer.from('<svg/>')));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.msg).toMatch(/WebP, JPEG ou PNG/);
  });

  it('refuse au-delà de la limite, SANS allouer le tampon complet', () => {
    // Le texte base64 dépasse à lui seul la borne : le refus tombe avant tout décodage.
    const trop = 'A'.repeat(Math.ceil((LIMITES.imageOctets * 4) / 3) + 100);
    const r = parseImage(`data:image/webp;base64,${trop}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.msg).toMatch(/trop volumineuse/);
  });

  it('refuse un base64 corrompu au lieu de stocker une image tronquée', () => {
    // Node décode en IGNORANT les caractères hors alphabet : sans le réencodage de contrôle, ceci passerait
    // et donnerait un fichier illisible le jour où on l'ouvre.
    const propre = WEBP.toString('base64');
    const r = parseImage(`data:image/webp;base64,${propre.slice(0, 8)}${propre.slice(9)}`);
    expect(r.ok).toBe(false);
  });

  it('un rapport SANS capture reste valide — c’est le cas normal', () => {
    const r = parseReport({ nom: 'Alix', genre: 'bug', texte: 'ça coince' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valeur.image).toBeNull();
      expect(r.valeur.imageType).toBeNull();
    }
  });

  it('une capture refusée fait échouer le rapport ENTIER, elle ne s’efface pas en silence', () => {
    const r = parseReport({ nom: 'Alix', genre: 'bug', texte: 'ça coince', image: 'pas-une-data-url' });
    expect(r.ok).toBe(false);
  });
});

describe('la capture, en base', () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-img-'));
    db = new Db(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('revient octet pour octet, et le dépouillement n’en charge que le POIDS', () => {
    const r = parseReport({ nom: 'Alix', genre: 'bug', texte: 'regarde', image: url('image/webp', WEBP) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = db.insertReport(r.valeur);

    const liste = db.listReports(10);
    expect(liste[0]?.imageOctets).toBe(WEBP.length);
    expect(liste[0]?.imageType).toBe('image/webp');
    // La liste ne porte PAS les octets : c'est ce qui garde le dépouillement léger.
    expect(liste[0]?.image).toBeUndefined();

    const lue = db.reportImage(id);
    expect(lue?.image.equals(WEBP)).toBe(true);
    expect(lue?.imageType).toBe('image/webp');
  });

  it('un rapport sans capture rend null, il ne rend pas un tampon vide', () => {
    const r = parseReport({ nom: 'Alix', genre: 'idee', texte: 'et si…' });
    if (!r.ok) throw new Error('rapport refusé');
    const id = db.insertReport(r.valeur);
    expect(db.reportImage(id)).toBeNull();
    expect(db.listReports(10)[0]?.imageOctets).toBeNull();
  });
});
