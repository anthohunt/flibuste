// Ce qui voyage entre le producteur et ses workers, et ce qu'une partie enregistree contient.

export interface RecordJob {
  id: number;
  seed: string;
  seats: number;
  samples: number;
  profile: string;
  rules: string;
}

/**
 * Une partie, reduite a ce qui suffit pour la rejouer a l'identique :
 * - `s` la graine, `n` le nombre de sieges, `p` le profil, `r` le jeu de regles, `k` les echantillons ;
 * - `m` le rang du coup choisi dans `view.legal` a chaque decision, dans l'ordre ;
 * - `sc` le score final par siege, `rs` le score de chaque manche par siege.
 * Rejouer = appliquer `m[i]`-ieme coup legal, sans jamais rappeler un bot.
 */
export interface RecordedGame {
  s: string;
  n: number;
  p: string;
  r: string;
  k: number;
  m: number[];
  sc: number[];
  rs: number[][];
}
