// Builds the site from projects.json: the home page, one page per app at /<id>/, and 404.html.
// Usage: node build.mjs
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";

const SITE = "https://lilpatter.github.io";
const { projects } = JSON.parse(await readFile("projects.json", "utf8"));

// GitHub Pages lets browsers cache files for 10 minutes. A content hash in the URL makes
// every page load the stylesheet and script it was built with, never a stale copy.
const version = async (file) => createHash("sha256").update(await readFile(file)).digest("hex").slice(0, 10);
const CSS = `/styles.css?v=${await version("styles.css")}`;
const JS = `/app.js?v=${await version("app.js")}`;

// Latest GitHub release for apps whose download link points at GitHub Releases.
// Set GITHUB_TOKEN to avoid the unauthenticated rate limit; without network the pages build without it.
async function latestRelease(p) {
  const dl = (p.links || []).find((l) => l.kind === "download");
  const repo = dl?.url.match(/github\.com\/([^/]+\/[^/]+)\/releases/)?.[1];
  if (!repo) return null;
  try {
    const headers = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
    if (!res.ok) return null;
    const r = await res.json();
    const installer = r.assets.find((a) => /setup\.exe$/i.test(a.name)) || r.assets[0];
    const [, version = r.tag_name, build] = r.tag_name.match(/^v?([\d.]+)(?:-build\.(\d+))?/) || [];
    return { version, build, date: r.published_at, size: installer?.size };
  } catch {
    return null;
  }
}
const releases = Object.fromEntries(await Promise.all(projects.map(async (p) => [p.id, await latestRelease(p)])));
const formatSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);
const formatDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const PLATFORM_FAMILY = {
  iOS: "Apple", iPadOS: "Apple", macOS: "Apple", tvOS: "Apple", watchOS: "Apple", visionOS: "Apple",
  Windows: "Windows", Linux: "Linux", Android: "Android", Web: "Web",
};
const STATUS_LABEL = { available: "Available", "in-development": "In Development", beta: "Beta" };

// SF Symbols-style glyphs drawn on a 20×20 grid.
const GLYPH = {
  website: '<path d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm4.9 6.7h-2.3a12 12 0 0 0-1-4.4 5.9 5.9 0 0 1 3.3 4.4ZM10 4.2c.6.8 1.3 2.5 1.5 5H8.5c.2-2.5.9-4.2 1.5-5ZM8.4 4.8a12 12 0 0 0-1 4.4H5.1a5.9 5.9 0 0 1 3.3-4.4ZM5.1 10.8h2.3c.1 1.7.5 3.2 1 4.4a5.9 5.9 0 0 1-3.3-4.4Zm4.9 5c-.6-.8-1.3-2.5-1.5-5h3c-.2 2.5-.9 4.2-1.5 5Zm1.6-.6c.5-1.2.9-2.7 1-4.4h2.3a5.9 5.9 0 0 1-3.3 4.4Z"/>',
  download: '<path d="M10 2.5a1 1 0 0 1 1 1v8.1l2.8-2.8a1 1 0 1 1 1.4 1.4l-4.5 4.5a1 1 0 0 1-1.4 0l-4.5-4.5a1 1 0 0 1 1.4-1.4L9 11.6V3.5a1 1 0 0 1 1-1ZM4 16a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Z"/>',
  source: '<path d="M7.7 5.3a1 1 0 0 1 0 1.4L4.4 10l3.3 3.3a1 1 0 1 1-1.4 1.4l-4-4a1 1 0 0 1 0-1.4l4-4a1 1 0 0 1 1.4 0Zm4.6 0a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 1 1-1.4-1.4l3.3-3.3-3.3-3.3a1 1 0 0 1 0-1.4Z"/>',
  check: '<path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm3.4 5.3a.9.9 0 0 0-1.3.1L9.2 11 7.8 9.6a.9.9 0 1 0-1.3 1.3l2.1 2.1a.9.9 0 0 0 1.3-.1l3.6-4.4a.9.9 0 0 0-.1-1.2Z"/>',
};
const GLYPH_TINT = { website: "var(--blue)", download: "var(--accent, var(--green))", source: "#8e8e93" };

// Text colour for a button filled with the app's accent: whichever of white or near-black reads better.
function labelOn(hex) {
  const [r, g, b] = hex.replace("#", "").match(/../g).map((c) => {
    const v = parseInt(c, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.05 ? "#fff" : "rgba(0, 0, 0, 0.86)";
}
const LINK_TITLE = { website: "Website", download: "Download", source: "Source Code" };
const LINK_DETAIL = { website: "", download: "GitHub Releases", source: "GitHub" };
const GITHUB_MARK =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
const CHEVRON = '<svg class="chevron" viewBox="0 0 8 13" aria-hidden="true"><path d="M1.5 1.5 6.5 6.5 1.5 11.5"/></svg>';
const BACK = '<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2 2 10l8 8"/></svg>';
const SEARCH = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 3a5.5 5.5 0 0 1 4.4 8.8l3.6 3.7a.9.9 0 0 1-1.3 1.3l-3.7-3.6A5.5 5.5 0 1 1 8.5 3Zm0 1.8a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z"/></svg>';

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const families = (p) => [...new Set(p.platforms.map((x) => PLATFORM_FAMILY[x] || x))];
const isOpenSource = (p) => (p.links || []).some((l) => l.kind === "source");
const asset = (path) => "/" + path.replace(/^\//, "");
const icon = (p, size, alt = "") => `<img class="app-icon" src="${esc(asset(p.icon))}" alt="${esc(alt)}" width="${size}" height="${size}">`;
const fact = (label, value, note = "") =>
  `<div class="fact"><div class="fact-label">${esc(label)}</div><div class="fact-value">${esc(value)}</div>${note ? `<div class="fact-note">${esc(note)}</div>` : ""}</div>`;

const appData = JSON.stringify(
  projects.map((p) => ({
    id: p.id, name: p.name, tagline: p.tagline, icon: asset(p.icon), platforms: p.platforms,
    links: (p.links || []).map(({ label, url, kind }) => ({ label, url, kind })),
  }))
).replace(/</g, "\\u003c");

function layout({ title, description, path, image = "/assets/avatar.jpg", wash = image, bar, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE}${path}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${SITE}${image}">
  <meta property="og:url" content="${SITE}${path}">
  <meta name="theme-color" content="#f2f2f7" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="${esc(image)}">
  <link rel="apple-touch-icon" href="${esc(image)}">
  <link rel="stylesheet" href="${CSS}">
  <script src="${JS}" defer></script>
</head>
<body>
  <header class="bar" id="bar">
    <div class="wrap bar-inner">
      ${bar}
    </div>
  </header>
  <main id="top">
    <div class="wash" style="--art:url('${esc(wash)}')" aria-hidden="true"><i></i><i></i><i></i></div>
${body}
  </main>
  <dialog class="palette" id="palette" aria-label="Search">
    <div class="palette-field">
      ${SEARCH}
      <input id="palette-input" type="search" placeholder="Search apps and actions" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palette-results">
      <kbd>esc</kbd>
    </div>
    <ul class="palette-results" id="palette-results" role="listbox"></ul>
  </dialog>
  <script type="application/json" id="apps-data">${appData}</script>
  <footer class="footer">
    <div class="wrap footer-inner">
      <span>Copyright © ${new Date().getFullYear()} PG. All rights reserved.</span>
      <span>Not affiliated with Apple, Valve or NVIDIA.</span>
    </div>
  </footer>
</body>
</html>
`;
}

// Floating controls. Elements marked "reveal" stay hidden at the top of the page and
// appear once the large title scrolls away, so the header isn't repeated.
// Home: a "PG" capsule and the section links.
const homeBar = `<a class="pill glass reveal" href="/" aria-label="PG, home">
        <img src="/assets/avatar.jpg" alt="" width="32" height="32">PG
      </a>
      <nav class="bar-links glass reveal" aria-label="Sections">
        <a href="/#apps">Apps</a>
        <a href="https://github.com/lilpatter">GitHub</a>
        <button class="bar-search" type="button" data-palette aria-label="Search">${SEARCH}</button>
      </nav>`;

// App pages: the back button always shows; the app's name and the links come in on scroll.
const appBar = (p) => `<a class="circle glass" href="/" aria-label="Back to Apps">${BACK}</a>
      <span class="bar-title glass" aria-hidden="true">
        <img class="app-icon" src="${esc(asset(p.icon))}" alt="" width="32" height="32">${esc(p.name)}
      </span>
      <nav class="bar-links glass reveal" aria-label="Sections">
        <a href="/">Apps</a>
        <a href="https://github.com/lilpatter">GitHub</a>
        <button class="bar-search" type="button" data-palette aria-label="Search">${SEARCH}</button>
      </nav>`;

// An app card: the whole card is the link, tinted by a blur of the app's own icon.
function appCard(p, heading = "h3") {
  const soon = p.status === "in-development" ? `<span class="card-badge">Coming Soon</span>` : "";
  return `<li data-families="${esc(families(p).join(" "))}">
          <a class="app-card" href="/${esc(p.id)}/" style="--art:url('${esc(asset(p.icon))}')">
            <span class="card-tint" aria-hidden="true"></span>
            <span class="card-top">${icon(p, 88)}${soon}</span>
            <span class="card-text">
              <${heading} class="card-name">${esc(p.name)}</${heading}>
              <span class="card-tagline">${esc(p.tagline)}</span>
            </span>
            <span class="card-meta">${esc(p.platforms.join(" · "))}</span>
          </a>
        </li>`;
}

// The platform filter only earns its place once there are enough apps to sift through.
const FILTER_FROM = 7;

function homePage() {
  const fams = [...new Set(projects.flatMap(families))];
  const filter =
    fams.length > 1 && projects.length >= FILTER_FROM
      ? `<div class="segmented" id="filter" role="radiogroup" aria-label="Filter by platform">
          <span class="segmented-thumb" style="width:calc((100% - 8px) / ${fams.length + 1})"></span>
          ${["All", ...fams].map((f, i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-family="${esc(f)}">${esc(f)}</button>`).join("\n          ")}
        </div>`
      : "";
  const body = `    <section class="hero wrap" aria-labelledby="page-title">
      <img class="avatar" src="/assets/avatar.jpg" alt="" width="128" height="128">
      <h1 class="hero-title" id="page-title" tabindex="-1">PG</h1>
      <p class="hero-sub">Native apps for Apple platforms and Windows.</p>
      <div class="hero-actions">
        <a class="btn btn-soft" href="https://github.com/lilpatter">${GITHUB_MARK}GitHub</a>
        <button class="btn btn-soft" type="button" data-palette>${SEARCH}Search<kbd class="shortcut" data-shortcut>Ctrl K</kbd></button>
      </div>
    </section>

    <section class="section wrap" id="apps" aria-labelledby="apps-title">
      <div class="section-head">
        <h2 class="title-2" id="apps-title">Apps</h2>
        ${filter}
      </div>
      <ul class="app-grid" id="app-list">
        ${projects.map((p) => appCard(p)).join("\n        ")}
      </ul>
    </section>`;
  return layout({
    title: "PG — Apps",
    description: `Apps by PG: ${projects.map((p) => p.name).join(", ")}.`,
    path: "/",
    bar: homeBar,
    body,
  });
}

function gallery(p) {
  const shots = p.screenshots || [];
  if (!shots.length) return "";
  const devices = [...new Set(shots.map((x) => x.device))];
  const slug = (d) => d.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const tabs =
    devices.length > 1
      ? `<div class="segmented device-tabs" role="tablist" aria-label="Device">
          <span class="segmented-thumb" style="width:calc((100% - 8px) / ${devices.length})"></span>
          ${devices.map((d, i) => `<button type="button" role="tab" id="tab-${slug(d)}" aria-controls="shots-${slug(d)}" aria-selected="${i === 0}" aria-checked="${i === 0}">${esc(d)}</button>`).join("\n          ")}
        </div>`
      : "";
  const rows = devices
    .map(
      (d, i) => `<div class="shot-row" id="shots-${slug(d)}" data-device="${slug(d)}" ${devices.length > 1 ? `role="tabpanel" aria-labelledby="tab-${slug(d)}"` : ""} ${i ? "hidden" : ""} tabindex="0">
          ${shots
            .filter((x) => x.device === d)
            .map((x) => `<figure class="shot"><img src="${esc(asset(x.src))}" alt="${esc(x.alt || "")}" loading="lazy" decoding="async"></figure>`)
            .join("\n          ")}
        </div>`
    )
    .join("\n        ");
  return `      <section class="app-section" aria-labelledby="shots-title">
        <div class="section-head">
          <h2 class="title-2" id="shots-title">Screenshots</h2>
          ${tabs}
        </div>
        ${rows}
      </section>
`;
}

function appPage(p) {
  const links = p.links || [];
  const primary = links[0];
  const fams = families(p);
  const [stackMain, ...stackRest] = (p.stack || "").split(" · ");
  const others = projects.filter((o) => o.id !== p.id);
  const release = releases[p.id];

  const linkRows = links
    .map(
      (l) => `<a class="row has-glyph" href="${esc(l.url)}">
            <span class="glyph" style="--tint:${GLYPH_TINT[l.kind] || "var(--blue)"}"><svg viewBox="0 0 20 20" aria-hidden="true">${GLYPH[l.kind] || GLYPH.website}</svg></span>
            <span class="row-body row-title">${esc(LINK_TITLE[l.kind] || l.label)}</span>
            <span class="row-detail">${esc(LINK_DETAIL[l.kind] ?? "")}</span>
            ${CHEVRON}
          </a>`
    )
    .join("\n          ");
  const features = (p.highlights || [])
    .map(
      (h) => `<li class="feature">
            <svg class="check" viewBox="0 0 20 20" aria-hidden="true">${GLYPH.check}</svg>
            <span>${esc(h)}</span>
          </li>`
    )
    .join("\n          ");

  // Information, like the bottom of an App Store page.
  const info = [
    ["Developer", "PG"],
    [p.platforms.length > 1 ? "Compatibility" : "Platform", p.platforms.join(", ")],
    release && ["Version", release.build ? `${release.version} (build ${release.build})` : release.version],
    release && ["Updated", formatDate(release.date)],
    release?.size && ["Size", formatSize(release.size)],
    p.stack && ["Built With", p.stack],
    ["Source", isOpenSource(p) ? "Open source" : "Closed source"],
    ["Status", STATUS_LABEL[p.status] || p.status],
  ]
    .filter(Boolean)
    .map(([k, v]) => `<div class="row info-row"><span class="row-body">${esc(k)}</span><span class="row-detail">${esc(v)}</span></div>`)
    .join("\n          ");

  const accent = p.accent ? `--accent:${esc(p.accent)}; --on-accent:${labelOn(p.accent)}` : "";
  const body = `    <article class="wrap app-page" aria-labelledby="app-title" style="${accent}">
      <header class="app-hero">
        <div class="tilt" data-tilt>
          <div class="tilt-inner">
            ${icon(p, 128, `${p.name} app icon`)}
            <span class="glare" aria-hidden="true"></span>
          </div>
        </div>
        <div>
          <h1 class="app-name" id="app-title" tabindex="-1">${esc(p.name)}</h1>
          <p class="app-subtitle">${esc(p.tagline)}</p>
          <div class="header-actions">
            ${primary ? `<a class="btn btn-filled" href="${esc(primary.url)}">${esc(primary.label)}</a>` : ""}
            <span class="status" data-status="${esc(p.status)}">${esc(STATUS_LABEL[p.status] || p.status)}</span>
          </div>
        </div>
      </header>

      <div class="facts">
        ${fact(p.platforms.length > 1 ? "Platforms" : "Platform", fams.join(" & "), p.platforms.length > 1 ? p.platforms.join(", ") : "")}
        ${release
          ? fact("Version", release.version, release.build ? `Build ${release.build}` : "") +
            (release.size ? fact("Size", formatSize(release.size), "Installer") : "")
          : fact("Status", STATUS_LABEL[p.status] || p.status) + (p.stack ? fact("Built With", stackMain, stackRest.join(" · ")) : "")}
        ${fact("Source", isOpenSource(p) ? "Open" : "Closed", isOpenSource(p) ? "On GitHub" : "")}
      </div>

${gallery(p)}
      <section class="app-section" aria-labelledby="about-title">
        <h2 class="title-2" id="about-title">About</h2>
        <p class="app-desc">${esc(p.description)}</p>
      </section>

${features ? `      <section class="app-section" aria-labelledby="features-title">
        <h2 class="title-2" id="features-title">Features</h2>
        <ul class="feature-grid">
          ${features}
        </ul>
      </section>
` : ""}
      <section class="app-section" aria-labelledby="info-title">
        <h2 class="title-2" id="info-title">Information</h2>
        <div class="info-columns">
          <div class="list">
          ${info}
          </div>
          ${linkRows ? `<div>
            <div class="list">
            ${linkRows}
            </div>
            ${p.note ? `<p class="group-note">${esc(p.note)}</p>` : ""}
          </div>` : ""}
        </div>
      </section>
    </article>
${others.length ? `
    <section class="section wrap" aria-labelledby="more-title">
      <div class="section-head">
        <h2 class="title-2" id="more-title">More Apps</h2>
        <a class="btn btn-plain" href="/">See All</a>
      </div>
      <ul class="app-grid">
        ${others.map((o) => appCard(o)).join("\n        ")}
      </ul>
    </section>` : ""}`;

  return layout({
    title: `${p.name} — ${p.tagline.replace(/\.$/, "")}`,
    description: p.description,
    path: `/${p.id}/`,
    image: asset(p.icon),
    wash: asset(p.icon),
    bar: appBar(p),
    body,
  });
}

function notFound() {
  return layout({
    title: "Page Not Found — PG",
    description: "This page doesn't exist.",
    path: "/404.html",
    bar: homeBar.replaceAll(" reveal", ""),
    body: `    <section class="wrap empty-state">
      <h1 class="large-title">Page Not Found</h1>
      <p class="header-sub">The page you're looking for doesn't exist or has moved.</p>
      <div class="header-actions"><a class="btn btn-filled" href="/">Go to Apps</a></div>
    </section>`,
  });
}

// Remove folders of apps that were taken out of projects.json.
const ids = new Set(projects.map((p) => p.id));
for (const entry of await readdir(".")) {
  if (ids.has(entry) || entry.startsWith(".") || !(await stat(entry)).isDirectory()) continue;
  const page = `${entry}/index.html`;
  const generated = await readFile(page, "utf8").then((s) => s.includes('class="wrap app-page"'), () => false);
  if (generated) await rm(entry, { recursive: true });
}

await writeFile("index.html", homePage());
await writeFile("404.html", notFound());
for (const p of projects) {
  await mkdir(p.id, { recursive: true });
  await writeFile(`${p.id}/index.html`, appPage(p));
}
const withRelease = Object.entries(releases).filter(([, r]) => r).map(([id, r]) => `${id} ${r.version}`);
console.log(`Release info: ${withRelease.join(", ") || "none (offline or rate limited)"}`);
console.log(`Built home, 404 and ${projects.length} app pages: ${projects.map((p) => "/" + p.id + "/").join(" ")}`);
