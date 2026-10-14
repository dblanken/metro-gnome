// All app data lives in localStorage on the device. Everything is saved on
// every change so the app can be closed or evicted mid-set and come back
// exactly where it left off.

const KEY = 'metrognome:v1';

const DEFAULT_STATE = {
  version: 1,
  songs: [],      // { id, title, artist, bpm, beats, unit, notes, createdAt, updatedAt }
  setlists: [],   // { id, name, songIds: [], createdAt, updatedAt }
  deleted: {},    // { [id]: deletedAt } tombstones so deletions sync
  sync: {
    token: '',            // GitHub token with gist scope (this device only)
    gistId: '',
    lastSync: 0,
  },
  ui: {
    view: 'songs',        // 'songs' | 'sets' | 'play'
    songSort: 'title-asc',
    pickerSort: 'title-asc',
    openSetId: null,      // set being edited on the Sets tab
    activeSetId: null,    // set loaded in the player
    currentIndex: 0,      // position in the active set
  },
  settings: {
    volume: 0.8,
    accent: true,
    keepPlaying: false,   // keep clicking when moving to the next/prev song
    wakeLock: true,
  },
};

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    return normalize(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Save failed', err);
  }
}

// Merge stored/imported data onto defaults so new fields always exist.
export function normalize(data) {
  const base = structuredClone(DEFAULT_STATE);
  if (!data || typeof data !== 'object') return base;
  const songs = Array.isArray(data.songs) ? data.songs.filter(validSong).map(cleanSong) : [];
  const ids = new Set(songs.map((s) => s.id));
  const setlists = Array.isArray(data.setlists)
    ? data.setlists
        .filter((l) => l && typeof l.name === 'string')
        .map((l) => ({
          id: l.id || uid(),
          name: l.name,
          songIds: Array.isArray(l.songIds) ? l.songIds.filter((id) => ids.has(id)) : [],
          createdAt: l.createdAt || Date.now(),
          updatedAt: l.updatedAt || Date.now(),
        }))
    : [];
  return {
    version: 1,
    songs,
    setlists,
    deleted: data.deleted && typeof data.deleted === 'object' ? { ...data.deleted } : {},
    sync: { ...base.sync, ...(data.sync || {}) },
    ui: { ...base.ui, ...(data.ui || {}) },
    settings: { ...base.settings, ...(data.settings || {}) },
  };
}

function validSong(s) {
  return s && typeof s.title === 'string' && Number(s.bpm) > 0;
}

function cleanSong(s) {
  return {
    id: s.id || uid(),
    title: s.title.trim(),
    artist: (s.artist || '').trim(),
    bpm: Math.round(Number(s.bpm)),
    beats: Number(s.beats) || 4,
    unit: Number(s.unit) || 4,
    notes: (s.notes || '').trim(),
    createdAt: s.createdAt || Date.now(),
    updatedAt: s.updatedAt || Date.now(),
  };
}

// Export only the library + setlists (not UI position) for backups.
export function exportData(state) {
  return JSON.stringify(
    { app: 'metro-gnome', version: 1, exportedAt: new Date().toISOString(), songs: state.songs, setlists: state.setlists },
    null,
    2,
  );
}

// Parse quick-add lines like:
//   Song Title | 120 | 4/4 | Artist
//   Song Title, 96, 6/8
// Time signature and artist are optional (defaults to 4/4).
export function parseBulk(text) {
  const out = [];
  const errors = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split(trimmed.includes('|') ? '|' : ',').map((p) => p.trim());
    const [title, bpmStr, sig, ...rest] = parts;
    const bpm = parseInt(bpmStr, 10);
    if (!title || !(bpm > 0)) {
      errors.push(`Line ${i + 1}: need at least "Title | BPM"`);
      return;
    }
    let beats = 4;
    let unit = 4;
    let artist = '';
    if (sig && /^\d+\s*\/\s*\d+$/.test(sig)) {
      [beats, unit] = sig.split('/').map((n) => parseInt(n, 10));
      artist = rest.join(', ');
    } else if (sig) {
      artist = [sig, ...rest].join(', ');
    }
    out.push({ title, bpm, beats, unit, artist });
  });
  return { songs: out, errors };
}
