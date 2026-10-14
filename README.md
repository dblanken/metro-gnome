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
- **Sync across devices** – optional, through a private GitHub Gist (below).
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

## Sync across devices

Settings → **Sync across devices**:

1. Tap **create a token**. That opens GitHub with the `gist` scope already
   picked, which is the only scope the app needs. Choose an expiration.
2. Paste the token and tap **Connect**. The first device creates a secret gist
   named `metro-gnome.json`, and each later device finds that gist on its own.
3. Do the same on each device. You can reuse one token or make one per device,
   which lets you revoke a single device later.

How it syncs:

- It syncs on launch, about 1.5 s after any edit, when the app comes back to
  the foreground, when the device reconnects to the network, and every
  2 minutes while the app is open.
- Each song and set merges on its own, and the newest edit wins. Deletes carry
  over to the other devices too. Two devices editing different songs never
  overwrite each other.
- Which song you're on in a set stays on that device. If another device
  reorders the set mid-gig, you stay on the same song and the click keeps
  going.
- The token is saved only on the device that uses it. It's never sent to the
  gist or included in backups. Its only power is reading and writing your
  gists.

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
