import { Metronome } from './metronome.js';
import { load, save, uid, normalize, exportData, parseBulk } from './store.js';
import { findGist, createGist, readGist, writeGist, mergeData, serialize } from './sync.js';

const state = load();
const $ = (sel) => document.querySelector(sel);

// Temporary tempo change on the Play screen (not saved unless asked).
let tempoOverride = null;
// Song currently auditioned from the Songs list or editor (id or null).
let previewId = null;

const metro = new Metronome({ onBeat: showBeat });
applySettings();

function persist() {
  save(state);
  // Queue a sync only when library data (not just UI position) changed.
  const sig = serialize(state);
  if (sig !== lastDataSig) {
    lastDataSig = sig;
    scheduleSync();
  }
}
let lastDataSig = serialize(state);

// ---------------------------------------------------------------------------
// Helpers

const SORTS = {
  'title-asc': { label: 'Title A–Z', fn: (a, b) => cmp(sortTitle(a.title), sortTitle(b.title)) },
  'title-desc': { label: 'Title Z–A', fn: (a, b) => cmp(sortTitle(b.title), sortTitle(a.title)) },
  'artist-asc': { label: 'Artist', fn: (a, b) => cmp(a.artist || '￿', b.artist || '￿') || cmp(sortTitle(a.title), sortTitle(b.title)) },
  'bpm-asc': { label: 'Tempo (slow → fast)', fn: (a, b) => a.bpm - b.bpm || cmp(sortTitle(a.title), sortTitle(b.title)) },
  'bpm-desc': { label: 'Tempo (fast → slow)', fn: (a, b) => b.bpm - a.bpm || cmp(sortTitle(a.title), sortTitle(b.title)) },
  'sig': { label: 'Time signature', fn: (a, b) => a.unit - b.unit || a.beats - b.beats || cmp(sortTitle(a.title), sortTitle(b.title)) },
  'recent': { label: 'Recently added', fn: (a, b) => b.createdAt - a.createdAt },
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function cmp(a, b) {
  return collator.compare(a, b);
}
// Ignore leading articles when alphabetizing ("The Stand" sorts under S).
function sortTitle(t) {
  return t.replace(/^(the|a|an)\s+/i, '');
}
function fold(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function matches(song, query) {
  if (!query) return true;
  const hay = fold(`${song.title} ${song.artist} ${song.notes} ${song.bpm} ${song.beats}/${song.unit}`);
  return fold(query).split(/\s+/).every((w) => hay.includes(w));
}
function filterSort(query, sortKey) {
  const sort = SORTS[sortKey] || SORTS['title-asc'];
  return state.songs.filter((s) => matches(s, query)).sort(sort.fn);
}
function songById(id) {
  return state.songs.find((s) => s.id === id);
}
function setById(id) {
  return state.setlists.find((l) => l.id === id);
}
function sig(song) {
  return `${song.beats}/${song.unit}`;
}
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
function fillSortSelect(select, value) {
  select.replaceChildren(...Object.entries(SORTS).map(([k, v]) => el('option', { value: k, text: v.label })));
  select.value = value;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  // Popover puts the toast in the top layer so it shows above open dialogs.
  if (t.showPopover) {
    if (t.matches(':popover-open')) t.hidePopover();
    t.showPopover();
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.matches?.(':popover-open') && t.hidePopover(), 250);
  }, 2200);
}

// ---------------------------------------------------------------------------
// Navigation

function showView(view) {
  state.ui.view = view;
  persist();
  for (const v of ['songs', 'sets', 'play']) {
    $(`#view-${v}`).hidden = v !== view;
  }
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  render();
  updateWakeLock();
}

function render() {
  const v = state.ui.view;
  if (v === 'songs') renderSongs();
  else if (v === 'sets') renderSets();
  else renderPlay();
}

document.querySelectorAll('.tabbar button').forEach((b) => {
  b.addEventListener('click', () => showView(b.dataset.view));
});

// ---------------------------------------------------------------------------
// Songs view

const songSearch = $('#song-search');
const songSort = $('#song-sort');
fillSortSelect(songSort, state.ui.songSort);

songSearch.addEventListener('input', renderSongs);
songSort.addEventListener('change', () => {
  state.ui.songSort = songSort.value;
  persist();
  renderSongs();
});
$('#add-song-btn').addEventListener('click', () => openSongDialog(null));

function renderSongs() {
  const q = songSearch.value.trim();
  const songs = filterSort(q, state.ui.songSort);
  $('#song-count').textContent = q ? `${songs.length} of ${state.songs.length}` : `${state.songs.length} songs`;
  const empty = $('#song-empty');
  empty.hidden = songs.length > 0;
  empty.textContent = state.songs.length
    ? 'No songs match your search.'
    : 'Your library is empty. Tap “+ Song”, or use Settings → Bulk add to paste in a list.';
  $('#song-list').replaceChildren(
    ...songs.map((s) =>
      el('li', { class: 'item' + (previewId === s.id ? ' previewing' : '') },
        el('button', { class: 'item-main', onclick: () => openSongDialog(s.id) },
          el('span', { class: 'item-title', text: s.title }),
          el('span', { class: 'item-sub', text: [s.artist, sig(s)].filter(Boolean).join(' · ') }),
        ),
        el('span', { class: 'badge', text: s.bpm }),
        el('button', {
          class: 'icon-btn',
          'aria-label': previewId === s.id ? `Stop ${s.title}` : `Preview ${s.title}`,
          onclick: () => togglePreview(s),
          text: previewId === s.id ? '■' : '▶︎',
        }),
      ),
    ),
  );
}

async function togglePreview(song) {
  if (previewId === song.id && metro.playing) {
    stopClick();
  } else {
    metro.configure({ bpm: song.bpm, beatsPerBar: song.beats, beatUnit: song.unit });
    metro.stop();
    previewId = song.id;
    await metro.start();
  }
  render();
}

function stopClick() {
  metro.stop();
  previewId = null;
  updatePlayButton();
}

// ---------------------------------------------------------------------------
// Song editor dialog

const songDialog = $('#song-dialog');
const songForm = $('#song-form');
const F = songForm.elements;
let editingId = null;

function openSongDialog(id) {
  editingId = id;
  const s = id ? songById(id) : { title: '', artist: '', bpm: 120, beats: 4, unit: 4, notes: '' };
  $('#song-dialog-title').textContent = id ? 'Edit song' : 'New song';
  F.title.value = s.title;
  F.artist.value = s.artist;
  F.bpm.value = s.bpm;
  F.beats.value = s.beats;
  F.unit.value = String(s.unit);
  F.notes.value = s.notes;
  $('#song-delete').hidden = !id;

  const addTo = $('#song-addto');
  addTo.replaceChildren(
    el('option', { value: '', text: state.setlists.length ? 'Choose a set…' : 'No sets yet' }),
    ...state.setlists.map((l) => el('option', { value: l.id, text: l.name })),
  );
  if (state.ui.openSetId && setById(state.ui.openSetId)) addTo.value = state.ui.openSetId;
  $('#song-addto-row').hidden = !state.setlists.length;
  $('#song-preview').textContent = '▶ Preview';
  songDialog.showModal();
  if (!id) F.title.focus();
}

function readSongForm() {
  return {
    title: F.title.value.trim(),
    artist: F.artist.value.trim(),
    bpm: Math.round(Number(F.bpm.value)),
    beats: Math.round(Number(F.beats.value)) || 4,
    unit: Number(F.unit.value) || 4,
    notes: F.notes.value.trim(),
  };
}

// Saves the form; returns the song id, or null if invalid.
function commitSongForm() {
  if (!songForm.reportValidity()) return null;
  const data = readSongForm();
  const now = Date.now();
  if (editingId && songById(editingId)) {
    Object.assign(songById(editingId), data, { updatedAt: now });
  } else {
    const song = { id: uid(), ...data, createdAt: now, updatedAt: now };
    state.songs.push(song);
    editingId = song.id;
  }
  persist();
  return editingId;
}

songForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!commitSongForm()) return;
  closeSongDialog();
});
$('#song-cancel').addEventListener('click', closeSongDialog);
songDialog.addEventListener('cancel', () => {
  if (previewId === 'dialog') stopClick();
});

function closeSongDialog() {
  if (previewId === 'dialog') stopClick();
  songDialog.close();
  render();
}

$('#song-delete').addEventListener('click', () => {
  const s = songById(editingId);
  if (!s) return;
  const used = state.setlists.filter((l) => l.songIds.includes(s.id));
  const msg = used.length
    ? `Delete “${s.title}”? It will also be removed from ${used.length} set list(s).`
    : `Delete “${s.title}”?`;
  if (!confirm(msg)) return;
  const active = activeSet();
  if (active && used.includes(active)) {
    state.ui.currentIndex -= active.songIds.slice(0, state.ui.currentIndex).filter((id) => id === s.id).length;
  }
  const now = Date.now();
  state.songs = state.songs.filter((x) => x.id !== s.id);
  state.deleted[s.id] = now;
  for (const l of used) {
    l.songIds = l.songIds.filter((id) => id !== s.id);
    l.updatedAt = now;
  }
  clampIndex();
  persist();
  closeSongDialog();
});

$('#song-addto-btn').addEventListener('click', () => {
  const setId = $('#song-addto').value;
  const list = setById(setId);
  if (!list) return toast('Choose a set first');
  const id = commitSongForm();
  if (!id) return;
  list.songIds.push(id);
  list.updatedAt = Date.now();
  persist();
  toast(`Added to “${list.name}” (#${list.songIds.length})`);
});

$('#song-preview').addEventListener('click', async () => {
  if (previewId === 'dialog' && metro.playing) {
    stopClick();
    $('#song-preview').textContent = '▶ Preview';
    return;
  }
  const d = readSongForm();
  if (!(d.bpm > 0)) return;
  metro.stop();
  metro.configure({ bpm: d.bpm, beatsPerBar: d.beats, beatUnit: d.unit });
  previewId = 'dialog';
  await metro.start();
  $('#song-preview').textContent = '■ Stop';
});

// Live-update the preview when BPM / beats change.
for (const name of ['bpm', 'beats']) {
  songForm[name].addEventListener('input', () => {
    if (previewId !== 'dialog') return;
    const d = readSongForm();
    if (d.bpm >= 20) metro.configure({ bpm: d.bpm, beatsPerBar: d.beats });
  });
}

// Tap tempo: average of the last few taps, reset after a 2s gap.
let taps = [];
$('#tap-tempo').addEventListener('click', () => {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  if (taps.length > 8) taps.shift();
  if (taps.length >= 2) {
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    F.bpm.value = Math.round(60000 / avg);
    F.bpm.dispatchEvent(new Event('input'));
  }
});

// ---------------------------------------------------------------------------
// Sets view

$('#new-set-btn').addEventListener('click', () => {
  const name = prompt('Name for the new set list:', defaultSetName());
  if (name === null) return;
  const now = Date.now();
  const list = { id: uid(), name: name.trim() || defaultSetName(), songIds: [], createdAt: now, updatedAt: now };
  state.setlists.unshift(list);
  state.ui.openSetId = list.id;
  persist();
  renderSets();
});

function defaultSetName() {
  return new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

$('#set-back').addEventListener('click', () => {
  state.ui.openSetId = null;
  persist();
  renderSets();
});

$('#set-name').addEventListener('change', (e) => {
  const list = setById(state.ui.openSetId);
  if (!list) return;
  list.name = e.target.value.trim() || list.name;
  e.target.value = list.name;
  list.updatedAt = Date.now();
  persist();
});

$('#set-delete').addEventListener('click', () => {
  const list = setById(state.ui.openSetId);
  if (!list || !confirm(`Delete set “${list.name}”? Songs stay in your library.`)) return;
  state.setlists = state.setlists.filter((l) => l.id !== list.id);
  state.deleted[list.id] = Date.now();
  if (state.ui.activeSetId === list.id) {
    state.ui.activeSetId = null;
    state.ui.currentIndex = 0;
  }
  state.ui.openSetId = null;
  persist();
  renderSets();
});

$('#set-play').addEventListener('click', () => {
  const list = setById(state.ui.openSetId);
  if (!list) return;
  if (state.ui.activeSetId !== list.id) {
    stopClick();
    state.ui.activeSetId = list.id;
    state.ui.currentIndex = 0;
    tempoOverride = null;
  }
  showView('play');
});

$('#set-add-songs').addEventListener('click', openPicker);

function renderSets() {
  const open = setById(state.ui.openSetId);
  $('#sets-index').hidden = !!open;
  $('#set-detail').hidden = !open;
  if (open) return renderSetDetail(open);

  $('#set-empty').hidden = state.setlists.length > 0;
  $('#set-list').replaceChildren(
    ...state.setlists.map((l) =>
      el('li', { class: 'item' + (l.id === state.ui.activeSetId ? ' active-set' : '') },
        el('button', {
          class: 'item-main',
          onclick: () => {
            state.ui.openSetId = l.id;
            persist();
            renderSets();
          },
        },
          el('span', { class: 'item-title', text: l.name }),
          el('span', {
            class: 'item-sub',
            text: `${l.songIds.length} song${l.songIds.length === 1 ? '' : 's'}` + (l.id === state.ui.activeSetId ? ' · now playing' : ''),
          }),
        ),
        el('span', { class: 'chev', text: '›' }),
      ),
    ),
  );
}

function renderSetDetail(list) {
  const nameInput = $('#set-name');
  if (document.activeElement !== nameInput) nameInput.value = list.name;
  $('#set-songs-empty').hidden = list.songIds.length > 0;
  const last = list.songIds.length - 1;
  $('#set-songs').replaceChildren(
    ...list.songIds.map((id, i) => {
      const s = songById(id);
      if (!s) return null;
      return el('li', { class: 'item' },
        el('span', { class: 'num', text: i + 1 }),
        el('div', { class: 'item-main static' },
          el('span', { class: 'item-title', text: s.title }),
          el('span', { class: 'item-sub', text: `${s.bpm} BPM · ${sig(s)}` + (s.artist ? ` · ${s.artist}` : '') }),
        ),
        el('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => moveInSet(list, i, -1), text: '↑' }),
        el('button', { class: 'icon-btn', 'aria-label': 'Move down', disabled: i === last, onclick: () => moveInSet(list, i, 1), text: '↓' }),
        el('button', { class: 'icon-btn danger', 'aria-label': 'Remove from set', onclick: () => removeFromSet(list, i), text: '✕' }),
      );
    }),
  );
}

function moveInSet(list, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= list.songIds.length) return;
  [list.songIds[i], list.songIds[j]] = [list.songIds[j], list.songIds[i]];
  // Keep the player on the same song if this set is live.
  if (list.id === state.ui.activeSetId) {
    if (state.ui.currentIndex === i) state.ui.currentIndex = j;
    else if (state.ui.currentIndex === j) state.ui.currentIndex = i;
  }
  list.updatedAt = Date.now();
  persist();
  renderSets();
}

function removeFromSet(list, i) {
  list.songIds.splice(i, 1);
  if (list.id === state.ui.activeSetId && state.ui.currentIndex > i) state.ui.currentIndex--;
  clampIndex();
  list.updatedAt = Date.now();
  persist();
  renderSets();
}

// ---------------------------------------------------------------------------
// Song picker (add songs to the open set)

const picker = $('#picker-dialog');
const pickerSearch = $('#picker-search');
const pickerSort = $('#picker-sort');
fillSortSelect(pickerSort, state.ui.pickerSort);

function openPicker() {
  const list = setById(state.ui.openSetId);
  if (!list) return;
  $('#picker-set-name').textContent = list.name;
  pickerSearch.value = '';
  renderPicker();
  picker.showModal();
}

pickerSearch.addEventListener('input', renderPicker);
pickerSort.addEventListener('change', () => {
  state.ui.pickerSort = pickerSort.value;
  persist();
  renderPicker();
});
$('#picker-hide-added').addEventListener('change', renderPicker);
$('#picker-done').addEventListener('click', () => {
  picker.close();
});
picker.addEventListener('close', renderSets);

function renderPicker() {
  const list = setById(state.ui.openSetId);
  if (!list) return;
  const hide = $('#picker-hide-added').checked;
  const inSet = new Set(list.songIds);
  const songs = filterSort(pickerSearch.value.trim(), state.ui.pickerSort).filter((s) => !(hide && inSet.has(s.id)));
  $('#picker-empty').hidden = songs.length > 0;
  $('#picker-list').replaceChildren(
    ...songs.map((s) => {
      const count = list.songIds.filter((id) => id === s.id).length;
      return el('li', { class: 'item' + (count ? ' in-set' : '') },
        el('div', { class: 'item-main static' },
          el('span', { class: 'item-title', text: s.title }),
          el('span', { class: 'item-sub', text: `${s.bpm} BPM · ${sig(s)}` + (s.artist ? ` · ${s.artist}` : '') }),
        ),
        count ? el('span', { class: 'badge subtle', text: `#${list.songIds.indexOf(s.id) + 1}` }) : null,
        el('button', {
          class: 'btn' + (count ? '' : ' primary'),
          onclick: () => {
            list.songIds.push(s.id);
            list.updatedAt = Date.now();
            persist();
            toast(`Added “${s.title}” as #${list.songIds.length}`);
            renderPicker();
          },
          text: count ? 'Add again' : 'Add',
        }),
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// Play view

const playSetSelect = $('#play-set-select');
playSetSelect.addEventListener('change', () => {
  stopClick();
  state.ui.activeSetId = playSetSelect.value || null;
  state.ui.currentIndex = 0;
  tempoOverride = null;
  persist();
  renderPlay();
});

function activeSet() {
  return setById(state.ui.activeSetId);
}
function activeSongs() {
  const list = activeSet();
  return list ? list.songIds.map(songById).filter(Boolean) : [];
}
function currentSong() {
  return activeSongs()[state.ui.currentIndex] || null;
}
function clampIndex() {
  const n = activeSongs().length;
  state.ui.currentIndex = Math.max(0, Math.min(state.ui.currentIndex, n - 1));
}
function currentBpm() {
  const s = currentSong();
  return tempoOverride ?? (s ? s.bpm : 120);
}

function renderPlay() {
  const list = activeSet();
  playSetSelect.replaceChildren(
    el('option', { value: '', text: state.setlists.length ? 'Choose a set list…' : 'No set lists yet' }),
    ...state.setlists.map((l) => el('option', { value: l.id, text: `${l.name} (${l.songIds.length})` })),
  );
  playSetSelect.value = list ? list.id : '';

  const songs = activeSongs();
  clampIndex();
  const song = songs[state.ui.currentIndex];
  const empty = $('#play-empty');
  $('#player').hidden = !song;
  empty.hidden = !!song;
  $('#play-position').textContent = song ? `${state.ui.currentIndex + 1} / ${songs.length}` : '';
  if (!song) {
    empty.textContent = !list
      ? 'Pick a set list above, or build one on the Sets tab.'
      : 'This set list is empty. Add songs on the Sets tab.';
    return;
  }

  $('#now-title').textContent = song.title;
  $('#now-artist').textContent = song.artist;
  $('#now-bpm').textContent = currentBpm();
  $('#now-bpm').classList.toggle('changed', tempoOverride != null);
  $('#tempo-save').hidden = tempoOverride == null || tempoOverride === song.bpm;
  $('#now-sig').textContent = sig(song);
  $('#now-notes').textContent = song.notes;
  $('#beats').replaceChildren(...Array.from({ length: song.beats }, (_, i) => el('span', { class: i === 0 ? 'dot accent' : 'dot' })));

  $('#prev-btn').disabled = state.ui.currentIndex === 0;
  $('#next-btn').disabled = state.ui.currentIndex >= songs.length - 1;

  const next = songs[state.ui.currentIndex + 1];
  $('#up-next').textContent = next ? `Up next: ${next.title} · ${next.bpm} BPM · ${sig(next)}` : 'Last song in the set';

  $('#play-list').replaceChildren(
    ...songs.map((s, i) =>
      el('li', { class: 'item' + (i === state.ui.currentIndex ? ' current' : '') + (i < state.ui.currentIndex ? ' done' : '') },
        el('span', { class: 'num', text: i + 1 }),
        el('button', { class: 'item-main', onclick: () => goTo(i) },
          el('span', { class: 'item-title', text: s.title }),
          el('span', { class: 'item-sub', text: `${s.bpm} BPM · ${sig(s)}` }),
        ),
      ),
    ),
  );
  updatePlayButton();
}

function updatePlayButton() {
  const btn = $('#play-btn');
  const live = metro.playing && previewId === null;
  btn.textContent = live ? 'Stop' : 'Start';
  btn.classList.toggle('on', live);
}

function syncMetronome() {
  const s = currentSong();
  if (!s) return;
  metro.configure({ bpm: currentBpm(), beatsPerBar: s.beats, beatUnit: s.unit });
}

async function togglePlay() {
  if (!currentSong()) return;
  if (metro.playing && previewId === null) {
    stopClick();
  } else {
    metro.stop();
    previewId = null;
    syncMetronome();
    await metro.start();
  }
  updatePlayButton();
  render();
}

async function goTo(i) {
  const songs = activeSongs();
  if (i < 0 || i >= songs.length || i === state.ui.currentIndex) return;
  const wasLive = metro.playing && previewId === null;
  state.ui.currentIndex = i;
  tempoOverride = null;
  persist();
  if (wasLive) {
    metro.stop();
    if (state.settings.keepPlaying) {
      syncMetronome();
      await metro.start();
    }
  }
  renderPlay();
  // Keep the current song visible in the list.
  document.querySelector('#play-list .current')?.scrollIntoView({ block: 'nearest' });
}

function step(dir) {
  goTo(state.ui.currentIndex + dir);
}

function nudge(delta) {
  const s = currentSong();
  if (!s) return;
  const bpm = Math.max(20, Math.min(400, currentBpm() + delta));
  tempoOverride = bpm === s.bpm ? null : bpm;
  if (previewId === null) metro.configure({ bpm });
  renderPlay();
}

$('#play-btn').addEventListener('click', togglePlay);
$('#prev-btn').addEventListener('click', () => step(-1));
$('#next-btn').addEventListener('click', () => step(1));
$('#tempo-down').addEventListener('click', () => nudge(-1));
$('#tempo-up').addEventListener('click', () => nudge(1));
$('#tempo-save').addEventListener('click', () => {
  const s = currentSong();
  if (!s || tempoOverride == null) return;
  s.bpm = tempoOverride;
  s.updatedAt = Date.now();
  tempoOverride = null;
  persist();
  toast(`Saved ${s.bpm} BPM for “${s.title}”`);
  renderPlay();
});

// Swipe left/right on the song card to change songs.
(() => {
  const card = $('#song-card');
  let x0 = null;
  let y0 = null;
  card.addEventListener('touchstart', (e) => {
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  card.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  });
})();

// Keyboard and Bluetooth page-turner pedals.
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select') || document.querySelector('dialog[open]')) return;
  if (state.ui.view !== 'play') return;
  const k = e.key;
  // Let a focused button handle its own Space/Enter.
  if ((k === ' ' || k === 'Enter') && e.target.closest('button')) return;
  if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown') step(1);
  else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') step(-1);
  else if (k === ' ' || k === 'Enter') togglePlay();
  else return;
  e.preventDefault();
});

function showBeat(beat) {
  const dots = document.querySelectorAll('#beats .dot');
  dots.forEach((d, i) => d.classList.toggle('lit', i === beat));
}

// ---------------------------------------------------------------------------
// Screen wake lock: keep the phone from sleeping (and cutting audio) mid-set.

let wakeLock = null;
async function updateWakeLock() {
  const want = state.settings.wakeLock && state.ui.view === 'play' && document.visibilityState === 'visible';
  if (want && !wakeLock && 'wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch { /* denied or unsupported */ }
  } else if (!want && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    metro.resync();
    updateWakeLock();
    syncNow();
  }
});

// ---------------------------------------------------------------------------
// Cross-device sync (GitHub Gist)

let syncTimer = null;
let syncing = null;     // in-flight promise
let syncAgain = false;  // a change happened while a sync was running
let syncStatus = '';

function syncEnabled() {
  return !!state.sync.token;
}

function scheduleSync(delay = 1500) {
  if (!syncEnabled()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay);
}

async function syncNow() {
  if (!syncEnabled()) return;
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  clearTimeout(syncTimer);
  syncing = (async () => {
    setSyncStatus('Syncing…');
    try {
      const { token } = state.sync;
      if (!state.sync.gistId) {
        state.sync.gistId = (await findGist(token)) || (await createGist(token, serialize(state)));
        save(state);
      }
      const remote = normalize(await readGist(token, state.sync.gistId));
      const merged = mergeData(state, remote);
      applyMerged(merged);
      const out = serialize(merged);
      if (out !== serialize(remote)) await writeGist(token, state.sync.gistId, out);
      state.sync.lastSync = Date.now();
      save(state);
      setSyncStatus(`Synced ${new Date(state.sync.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    } catch (err) {
      if (err.status === 404 && state.sync.gistId) {
        // Gist was deleted on GitHub: forget it and recreate on next sync.
        state.sync.gistId = '';
        save(state);
      }
      setSyncStatus(err.message || 'Sync failed');
      console.warn('Sync failed', err);
    } finally {
      syncing = null;
      if (syncAgain) {
        syncAgain = false;
        scheduleSync(300);
      }
    }
  })();
  return syncing;
}

// Replace local library data with the merged result without losing the
// player's place (the current song stays current even if the set changed).
function applyMerged(merged) {
  const before = serialize(state);
  const curId = currentSong()?.id;
  state.songs = merged.songs;
  state.setlists = merged.setlists;
  state.deleted = merged.deleted;
  lastDataSig = serialize(state);
  if (lastDataSig === before) return;

  if (state.ui.activeSetId && !activeSet()) {
    if (metro.playing && previewId === null) stopClick();
    state.ui.activeSetId = null;
    state.ui.currentIndex = 0;
  } else if (curId) {
    const ids = activeSet().songIds;
    if (ids[state.ui.currentIndex] !== curId && ids.includes(curId)) state.ui.currentIndex = ids.indexOf(curId);
  }
  if (state.ui.openSetId && !setById(state.ui.openSetId)) state.ui.openSetId = null;
  clampIndex();
  save(state);
  // Don't yank an open editor out from under the user; refresh the view behind it.
  render();
}

function setSyncStatus(msg) {
  syncStatus = msg;
  const el = $('#sync-status');
  if (el) el.textContent = msg;
  renderSyncSettings();
}

function renderSyncSettings() {
  const on = syncEnabled();
  $('#sync-off').hidden = on;
  $('#sync-on').hidden = !on;
  $('#sync-status').textContent = on ? syncStatus || 'Connected' : '';
  const link = $('#sync-gist-link');
  link.hidden = !state.sync.gistId;
  if (state.sync.gistId) link.href = `https://gist.github.com/${state.sync.gistId}`;
}

$('#sync-connect').addEventListener('click', async () => {
  const token = $('#sync-token').value.trim();
  if (!token) return toast('Paste a GitHub token first');
  state.sync.token = token;
  state.sync.gistId = '';
  save(state);
  $('#sync-token').value = '';
  renderSyncSettings();
  await syncNow();
  if (state.sync.gistId) toast('Sync connected');
  else {
    state.sync.token = '';
    save(state);
    renderSyncSettings();
    alert(`Couldn't connect: ${syncStatus}`);
  }
});
$('#sync-now').addEventListener('click', () => syncNow());
$('#sync-disconnect').addEventListener('click', () => {
  if (!confirm('Stop syncing this device? Your songs stay here and in the gist.')) return;
  state.sync = { token: '', gistId: '', lastSync: 0 };
  syncStatus = '';
  save(state);
  renderSyncSettings();
});

window.addEventListener('online', () => syncNow());
// Pick up changes from other devices while the app sits open.
setInterval(() => {
  if (document.visibilityState === 'visible') syncNow();
}, 120000);

// ---------------------------------------------------------------------------
// Settings, import/export, bulk add

const settingsDialog = $('#settings-dialog');
$('#settings-btn').addEventListener('click', async () => {
  $('#set-volume').value = state.settings.volume;
  $('#set-accent').checked = state.settings.accent;
  $('#set-keep').checked = state.settings.keepPlaying;
  $('#set-wake').checked = state.settings.wakeLock;
  renderSyncSettings();
  $('#storage-status').textContent = await storageStatus();
  settingsDialog.showModal();
});

$('#set-volume').addEventListener('input', (e) => {
  state.settings.volume = Number(e.target.value);
  applySettings();
  persist();
});
$('#set-accent').addEventListener('change', (e) => {
  state.settings.accent = e.target.checked;
  applySettings();
  persist();
});
$('#set-keep').addEventListener('change', (e) => {
  state.settings.keepPlaying = e.target.checked;
  persist();
});
$('#set-wake').addEventListener('change', (e) => {
  state.settings.wakeLock = e.target.checked;
  persist();
  updateWakeLock();
});

function applySettings() {
  metro.setVolume(state.settings.volume);
  metro.accent = state.settings.accent;
}

async function storageStatus() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let persisted = false;
  try { persisted = await navigator.storage?.persisted?.(); } catch { /* ignore */ }
  const parts = [`${state.songs.length} songs, ${state.setlists.length} set lists saved on this device.`];
  if (!standalone) parts.push('Tip: Share → “Add to Home Screen” so iOS keeps your data and runs it full-screen.');
  else if (!persisted) parts.push('Export a backup now and then.');
  return parts.join(' ');
}

$('#export-btn').addEventListener('click', async () => {
  const json = exportData(state);
  const name = `metro-gnome-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  // iOS: the share sheet lets you save to Files / AirDrop / email.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Metro-Gnome backup' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

$('#import-btn').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const incoming = normalize(JSON.parse(await f.text()));
    const mode = confirm(
      `Backup has ${incoming.songs.length} songs and ${incoming.setlists.length} set lists.\n\n` +
        'OK = merge into your library\nCancel = choose replace instead',
    );
    if (mode) {
      mergeImport(incoming);
    } else if (confirm('Replace EVERYTHING on this device with the backup?')) {
      stopClick();
      // Tombstone everything not in the backup and stamp the backup as newest
      // so the replacement wins on every synced device too.
      const now = Date.now();
      const keep = new Set([...incoming.songs, ...incoming.setlists].map((r) => r.id));
      for (const r of [...state.songs, ...state.setlists]) if (!keep.has(r.id)) state.deleted[r.id] = now;
      for (const r of [...incoming.songs, ...incoming.setlists]) {
        r.updatedAt = now;
        delete state.deleted[r.id];
      }
      state.songs = incoming.songs;
      state.setlists = incoming.setlists;
      state.ui.activeSetId = null;
      state.ui.openSetId = null;
      state.ui.currentIndex = 0;
    } else {
      return;
    }
    persist();
    toast('Import complete');
    render();
    settingsDialog.close();
  } catch (err) {
    alert(`Could not import that file: ${err.message}`);
  }
});

// Merge by id; songs with the same title+artist are treated as the same song.
function mergeImport(incoming) {
  const key = (s) => `${fold(s.title)}|${fold(s.artist)}`;
  const byId = new Map(state.songs.map((s) => [s.id, s]));
  const byKey = new Map(state.songs.map((s) => [key(s), s]));
  const remap = new Map();
  for (const s of incoming.songs) {
    const existing = byId.get(s.id) || byKey.get(key(s));
    if (existing) {
      if ((s.updatedAt || 0) > (existing.updatedAt || 0)) Object.assign(existing, { ...s, id: existing.id });
      remap.set(s.id, existing.id);
    } else {
      state.songs.push(s);
      byId.set(s.id, s);
      byKey.set(key(s), s);
      remap.set(s.id, s.id);
    }
  }
  for (const l of incoming.setlists) {
    const songIds = l.songIds.map((id) => remap.get(id)).filter(Boolean);
    const existing = setById(l.id);
    if (existing) {
      if ((l.updatedAt || 0) > (existing.updatedAt || 0)) Object.assign(existing, { name: l.name, songIds, updatedAt: l.updatedAt });
    } else {
      state.setlists.push({ ...l, songIds });
    }
  }
}

const bulkDialog = $('#bulk-dialog');
$('#bulk-btn').addEventListener('click', () => {
  $('#bulk-errors').textContent = '';
  bulkDialog.showModal();
});
$('#bulk-cancel').addEventListener('click', () => bulkDialog.close());
$('#bulk-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const { songs, errors } = parseBulk($('#bulk-text').value);
  if (errors.length) {
    $('#bulk-errors').textContent = errors.join('\n');
    return;
  }
  const now = Date.now();
  songs.forEach((s, i) => state.songs.push({ id: uid(), notes: '', ...s, createdAt: now + i, updatedAt: now }));
  persist();
  $('#bulk-text').value = '';
  bulkDialog.close();
  settingsDialog.close();
  toast(`Added ${songs.length} song${songs.length === 1 ? '' : 's'}`);
  showView('songs');
});

// Tap the dialog backdrop to close (except the song editor, to avoid losing edits).
for (const d of [picker, settingsDialog]) {
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
}

// ---------------------------------------------------------------------------
// Boot

// Ask the browser not to evict our data under storage pressure.
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
}

showView(state.ui.view || 'songs');
syncNow();
