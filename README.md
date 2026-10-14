# Metro-Gnome

A setlist metronome for iPhone (or any browser). Keep a song library with tempo
and time signature, build set lists, and step through a set with a click track.

- **Library** – search (title, artist, notes, BPM, time signature) and sort
  (A–Z, Z–A, artist, tempo, time signature, recently added). Leading “The/A/An”
  is ignored when alphabetizing.
- **Set lists** – add songs from a searchable/sortable picker, reorder, remove.
- **Play** – big Start/Stop, previous/next (buttons, swipe, arrow keys or a
  Bluetooth page-turner pedal), accented beat 1, beat lights, temporary tempo
  nudge with optional save.
- **Never loses your place** – everything, including which set and song you’re
  on, is saved on every change. If iOS closes the app in the background it
  reopens on the same song.
- **Offline** – works with no signal once installed.
- **Backups** – export/import JSON; bulk-add songs by pasting
  `Title | BPM | 4/4 | Artist` lines.

No build step, no dependencies: plain HTML/CSS/JS.

## Install on iPhone

1. Enable GitHub Pages: repo **Settings → Pages → Deploy from a branch →
   `main` / root**.
2. Open `https://<user>.github.io/metro-gnome/` in **Safari**.
3. Share → **Add to Home Screen**. Launch it from the home-screen icon.

Installing to the home screen matters: it runs full-screen, can’t be
pulled-to-refresh, and iOS doesn’t purge its saved data the way it can for
ordinary Safari tabs.

## iOS notes

- The click plays even with the ring/silent switch on (Safari 16.4+).
- The Play tab keeps the screen awake. If the phone locks, iOS suspends web
  audio — that’s an iOS limit on web apps.
- Tempo is counted in the time signature’s bottom number (6/8 at 96 = 96 eighth
  notes per minute, six clicks per bar).

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Bump `CACHE` in `sw.js` when you change files so installed copies pick up the
new version on their next launch.
