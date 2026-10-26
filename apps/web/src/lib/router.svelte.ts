// Routeur minimal par hash : `#/`, `#/lobby/ABCD`, `#/join/ABCD`, `#/table?x=1`, `#/classement`, `#/dev`,
// `#/art`, `#/son`.
// Les écrans de partie (`table`, `score`, `over`) se posent en `replace` (C7) : Précédent ne remonte jamais dans
// des écrans périmés. Une route inconnue est normalisée en `#/` (l'URL fausse ne reste pas dans la barre).

export type RouteName = 'home' | 'friends' | 'lobby' | 'join' | 'table' | 'score' | 'over' | 'classement' | 'dev' | 'art' | 'son';

export interface Route {
  name: RouteName;
  params: Record<string, string>;
}

// `son` est la seule route d'outillage qui reste connue EN PRODUCTION : l'essayage des sons se fait au casque,
// sur le téléphone, sur l'app déployée — `dev` et `art`, eux, ne servent qu'au poste de travail.
const KNOWN: ReadonlySet<string> = new Set<RouteName>(['home', 'friends', 'lobby', 'join', 'table', 'score', 'over', 'classement', 'dev', 'art', 'son']);

function segmentsOf(hash: string): { segments: string[]; query: string } {
  const raw = hash.replace(/^#\/?/, '');
  const qIndex = raw.indexOf('?');
  const path = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const query = qIndex >= 0 ? raw.slice(qIndex + 1) : '';
  return { segments: path.split('/').filter(Boolean), query };
}

export function parseHash(hash: string): Route {
  const { segments, query } = segmentsOf(hash);
  const name = segments[0] ?? 'home';
  if (!KNOWN.has(name)) return { name: 'home', params: {} };
  const params: Record<string, string> = Object.fromEntries(new URLSearchParams(query));
  if (segments[1]) {
    try {
      params.code = decodeURIComponent(segments[1]);
    } catch {
      params.code = segments[1];
    }
  }
  return { name: name as RouteName, params };
}

/** Hash canonique à substituer à `hash` s'il pointe sur une route inconnue (`#/nope`, `#/room/ABCD`) ; null sinon. */
export function normalizeHash(hash: string): string | null {
  const { segments } = segmentsOf(hash);
  const name = segments[0];
  if (name === undefined) return hash === '' || hash === '#' || hash === '#/' ? null : '#/';
  return KNOWN.has(name) ? null : '#/';
}

export function href(name: RouteName, params: Record<string, string> = {}): string {
  const { code, ...rest } = params;
  let h = name === 'home' ? '#/' : `#/${name}`;
  if (code) h += `/${encodeURIComponent(code)}`;
  const q = new URLSearchParams(rest).toString();
  if (q) h += `?${q}`;
  return h;
}

const initial = parseHash(typeof location !== 'undefined' ? location.hash : '');

export const route = $state<Route>({ name: initial.name, params: initial.params });

function sync() {
  const fixed = normalizeHash(location.hash);
  if (fixed !== null && typeof history !== 'undefined') history.replaceState(history.state, '', fixed);
  const next = parseHash(location.hash);
  route.name = next.name;
  route.params = next.params;
}

export interface NavigateOptions {
  /** Remplace l'entrée d'historique courante au lieu d'en pousser une (écrans de partie). */
  replace?: boolean;
}

export function navigate(name: RouteName, params: Record<string, string> = {}, opts: NavigateOptions = {}) {
  const target = href(name, params);
  if (location.hash === target) {
    sync();
    return;
  }
  if (opts.replace && typeof history !== 'undefined' && typeof history.replaceState === 'function') {
    history.replaceState(history.state, '', target);
    sync();
    return;
  }
  location.hash = target;
}

/** À appeler une fois au montage de l'app ; renvoie la fonction d'arrêt. */
export function startRouter(): () => void {
  sync();
  window.addEventListener('hashchange', sync);
  return () => window.removeEventListener('hashchange', sync);
}
