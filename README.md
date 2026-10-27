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

1. Put a square icon (256×256 PNG, full-bleed, no rounded corners needed) in `assets/icons/`.
2. Add an entry to `projects.json`:

```json
{
  "id": "my-app",
  "name": "My App",
  "icon": "assets/icons/my-app.png",
  "accent": "#007aff",
  "status": "available",
  "tagline": "One short line.",
  "description": "A sentence or two about what it does.",
  "platforms": ["Windows"],
  "stack": "Tauri 2 · Rust",
  "highlights": ["Up to four short points"],
  "links": [
    { "label": "Download", "url": "https://github.com/lilpatter/my-app/releases/latest", "kind": "download" },
    { "label": "Source", "url": "https://github.com/lilpatter/my-app", "kind": "source" }
  ]
}
```

3. Push. The **Build pages** workflow runs `node build.mjs` and commits the new page, so it's live at `/my-app/` a minute later.
   To preview locally first, run `node build.mjs` and serve the folder.

- `status`: `available`, `in-development` or `beta`.
- `kind`: `website`, `download` or `source` picks the link's icon. The first link is the main button.
- `accent` colours the checkmarks on the app's page and the glow on its GitHub profile tile.
- Leave out the `source` link for closed-source apps.
- The Apple / Windows filter builds itself from `platforms`.
- The GitHub profile's app tiles are generated from this same file once a day.
