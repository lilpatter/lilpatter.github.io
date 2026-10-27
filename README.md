# lilpatter.github.io

PG's projects site, served by GitHub Pages from `main`.

## Adding a project

1. Put a square icon (256×256 PNG, full-bleed, no rounded corners needed) in `assets/icons/`.
2. Add an entry to `projects.json`:

```json
{
  "id": "my-app",
  "name": "My App",
  "icon": "assets/icons/my-app.png",
  "accent": "#4493f8",
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

- `status`: `available`, `in-development` or `beta`.
- `kind`: `website`, `download` or `source` picks the button icon. The first link is the primary button.
- `featured: true` makes the card span the full row with a large icon.
- Leave out the `source` link for closed-source projects.
- The platform filter builds itself from `platforms`.
