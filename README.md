# lilpatter.github.io

PG's apps site, served by GitHub Pages from `main`. The design follows Apple's Human Interface Guidelines.

Every app has its own page at `/<id>/` (for example [/catalyst/](https://lilpatter.github.io/catalyst/)).
The pages are built from `projects.json` by `build.mjs`; don't edit `index.html`, `404.html` or the app folders by hand.

## How it works

- `build.mjs` writes plain HTML for every page, so the site works without JavaScript.
  It also reads each app's latest GitHub release (version, date, installer size); the **Build pages**
  workflow reruns it daily and whenever the site's source changes.
- `app.js` adds the extras: in-place navigation with a skeleton of the next page and the app icon
  flying into place (View Transitions), prefetching on hover, the tilting icon on app pages, and
  search with Ctrl/⌘ K or `/`. With Reduce Motion turned on, movement becomes simple fades.

## Adding an app

1. Put a square icon (256×256 8-bit RGBA PNG, full-bleed, no rounded corners needed) in `assets/icons/`.
2. Add an entry to `projects.json`:

```json
{
  "id": "my-app",
  "name": "My App",
  "icon": "assets/icons/my-app.png",
  "status": "available",
  "tagline": "One short line.",
  "description": "A sentence or two about what it does.",
  "platforms": ["Windows"],
  "stack": "Tauri 2 · Rust",
  "highlights": ["Up to six short points"],
  "links": [
    { "label": "Download", "url": "https://github.com/lilpatter/my-app/releases/latest", "kind": "download" }
  ]
}
```

3. Push. The **Build pages** workflow runs `node build.mjs` and commits the new page, so it's live at `/my-app/` a minute later.
   To preview locally first, run `node build.mjs` and serve the folder.

- `status`: `available`, `in-development` or `beta`.
- `kind`: `website`, `download` or `source` picks the link's icon. The first link is the main button.
- The app's accent colour comes from its icon: `build.mjs` picks the hue most of the icon's vivid pixels share
  and uses it for the Download button, the checkmarks and the glow on its GitHub profile tile (via `accents.json`).
  Change the icon and the colour follows. Add `"accent": "#rrggbb"` only to override it.
- Leave out the `source` link for closed-source apps.
- Optional, for a fuller app page:
  - `story`: a paragraph (or a list of them) under About: the problem the app solves and why you built it.
  - `engineering`: `[{ "title", "text" }]`, shown as **Under the Hood**: how it works, not what it does.
  - `story`: one or two paragraphs, shown as **Why <App> Exists**: the problem the app solves, before what it does.
  - `badge`: a caveat shown next to the status everywhere the app appears, for example `"Unofficial client"`.
  - Memory or speed figures: say what was measured (working set, private memory) and how, in the Under the Hood notes.
  - `video`: `{ "src", "poster", "caption" }`, a short screen recording (MP4) shown above the screenshots. It only plays when clicked.
  - `cardShot`: which screenshot the home page card uses. By default it's the first Windows or Mac one.
- **Link previews** (the 1200×630 image shown when a page is shared) live in `assets/og/`. They aren't redrawn by the
  workflow: after adding an app or changing a name, tagline, icon or screenshot, run `python scripts/og.py`
  (needs Pillow) and commit the images.
- **Release History** builds itself from each app's GitHub releases: the first line of a release's notes is its title,
  and releases that only say "Download the setup to install it…" are left out. Write that first line for visitors.
- The Apple / Windows filter builds itself from `platforms`.
- The GitHub profile's app tiles are generated from this same file once a day.
