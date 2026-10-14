// Cross-device sync through a private GitHub Gist.
//
// Each device holds a GitHub token limited to the "gist" scope. The library
// lives in one secret gist file. Syncing pulls the gist, merges it with local
// data record-by-record (newest updatedAt wins, deletions are kept as
// tombstones so they propagate), then pushes the merged result if it differs.

const API = 'https://api.github.com';
const FILE = 'metro-gnome.json';

export class SyncError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function gh(token, path, opts = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      ...opts,
      cache: 'no-store', // GitHub sends max-age=60; we always want fresh data
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new SyncError('Offline — will sync when back online', 0);
  }
  if (res.status === 401) throw new SyncError('GitHub rejected the token (expired or revoked?)', 401);
  if (res.status === 403 || res.status === 404) {
    throw new SyncError('Token lacks gist access, or the gist was deleted', res.status);
  }
  if (!res.ok) throw new SyncError(`GitHub error ${res.status}`, res.status);
  return res.json();
}

// Look through the user's gists for an existing Metro-Gnome file.
export async function findGist(token) {
  for (let page = 1; page <= 10; page++) {
    const gists = await gh(token, `/gists?per_page=100&page=${page}`);
    const hit = gists.find((g) => g.files && g.files[FILE]);
    if (hit) return hit.id;
    if (gists.length < 100) return null;
  }
  return null;
}

export async function createGist(token, payload) {
  const g = await gh(token, '/gists', {
    method: 'POST',
    body: JSON.stringify({
      description: 'Metro-Gnome song library (synced by the app — edit in the app, not here)',
      public: false,
      files: { [FILE]: { content: payload } },
    }),
  });
  return g.id;
}

export async function readGist(token, id) {
  const g = await gh(token, `/gists/${id}`);
  const f = g.files && g.files[FILE];
  if (!f) throw new SyncError(`Gist is missing ${FILE}`, 404);
  let text = f.content;
  if (f.truncated) {
    const res = await fetch(f.raw_url, { cache: 'no-store' });
    text = await res.text();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SyncError('Gist content is not valid JSON', 422);
  }
}

export async function writeGist(token, id, payload) {
  await gh(token, `/gists/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ files: { [FILE]: { content: payload } } }),
  });
}

// --- Merge -----------------------------------------------------------------

function mergeRecords(a = [], b = [], deleted) {
  const byId = new Map();
  for (const r of [...a, ...b]) {
    const cur = byId.get(r.id);
    if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(r.id, r);
  }
  return [...byId.values()].filter((r) => !(deleted[r.id] >= (r.updatedAt || 0)));
}

// Merge two { songs, setlists, deleted } snapshots. Pure function.
export function mergeData(local, remote) {
  const deleted = { ...(remote.deleted || {}) };
  for (const [id, t] of Object.entries(local.deleted || {})) {
    if (!(deleted[id] >= t)) deleted[id] = t;
  }
  const songs = mergeRecords(local.songs, remote.songs, deleted).sort((x, y) => x.createdAt - y.createdAt);
  const ids = new Set(songs.map((s) => s.id));
  const setlists = mergeRecords(local.setlists, remote.setlists, deleted)
    .map((l) => ({ ...l, songIds: (l.songIds || []).filter((id) => ids.has(id)) }))
    .sort((x, y) => y.createdAt - x.createdAt);
  return { songs, setlists, deleted };
}

// Stable serialization used both for upload and change detection.
export function serialize(data) {
  return JSON.stringify(
    { app: 'metro-gnome', version: 1, songs: data.songs, setlists: data.setlists, deleted: data.deleted || {} },
    null,
    1,
  );
}
