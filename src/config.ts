/** Global constants shared across the game. */

export const GAME_NAME = 'S.I.L.K';
export const GAME_FULL_NAME = 'Spider Indexing Links & Knowledge';
export const GAME_URL = 'https://huang-frederic.github.io/S.I.L.K/';
export const REPO_URL = 'https://github.com/Huang-Frederic/S.I.L.K';

/**
 * Sent as `Api-User-Agent` with every Wikipedia request, as recommended by
 * the Wikimedia User-Agent policy (browsers do not let us set User-Agent).
 */
export const API_USER_AGENT = `SILK-Wikirace/0.1 (${GAME_URL}; ${REPO_URL})`;

export const WIKI_REST_BASE = 'https://en.wikipedia.org/api/rest_v1';
export const WIKI_ACTION_API = 'https://en.wikipedia.org/w/api.php';

/** Wikimedia asks API clients to keep at most 3 requests in flight. */
export const MAX_CONCURRENT_REQUESTS = 3;
