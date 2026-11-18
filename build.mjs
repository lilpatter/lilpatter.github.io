// Builds the site from projects.json: the home page, one page per app at /<id>/, and 404.html.
// Usage: node build.mjs
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

const SITE = "https://lilpatter.github.io";
// The publisher: one name everywhere (header, footer, credits, search results), matching the GitHub account.
const PUBLISHER = "PG";
const GITHUB = "https://github.com/lilpatter";
const { projects } = JSON.parse(await readFile("projects.json", "utf8"));

// GitHub Pages lets browsers cache files for 10 minutes. A content hash in the URL makes
// every page load the stylesheet and script it was built with, never a stale copy.
const version = async (file) => createHash("sha256").update(await readFile(file)).digest("hex").slice(0, 10);
const CSS = `/styles.css?v=${await version("styles.css")}`;
const JS = `/app.js?v=${await version("app.js")}`;

// GitHub releases for apps whose download link points at GitHub Releases: the latest one for the
// Version and Size facts, and the rest for the release history.
// Set GITHUB_TOKEN to avoid the unauthenticated rate limit; without network the pages build without it.
const parseTag = (tag) => {
  const [, version = tag, build] = tag.match(/^v?([\d.]+)(?:-build\.(\d+))?/) || [];
  return { version, build };
};

// A release's headline: the first line of its notes, trimmed to a short title. Notes that only say
// "<App> 1.0.0 (build 3) for Windows. Download the setup…" have nothing to tell, so they're skipped.
function releaseTitle(body) {
  const first = String(body || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!first || /Download the setup to install it/i.test(first)) return "";
  let t = first.replace(/^[-*]\s+/, "").replace(/\*\*/g, "").replace(/\.$/, "");
  if (t.length > 80) {
    const colon = t.lastIndexOf(": ", 80);
    const cut = colon > 20 ? colon : t.lastIndexOf(", ", 80);
    t = cut > 20 ? t.slice(0, cut) : t.slice(0, 77).trimEnd() + "…";
  }
  return t;
}

async function githubReleases(p) {
  const dl = (p.links || []).find((l) => l.kind === "download");
  const repo = dl?.url.match(/github\.com\/([^/]+\/[^/]+)\/releases/)?.[1];
  if (!repo) return null;
  try {
    const headers = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=50`, { headers });
    if (!res.ok) return null;
    const list = (await res.json())
      .filter((r) => !r.draft && !r.prerelease)
      .sort((a, b) => b.published_at.localeCompare(a.published_at));
    if (!list.length) return null;
    const r = list[0];
    const installer = r.assets.find((a) => /setup\.exe$/i.test(a.name)) || r.assets[0];
    // Consecutive builds that shipped with the same notes are one entry: keep the newest.
    const history = [];
    for (const x of list) {
      const title = releaseTitle(x.body);
      if (!title || history.at(-1)?.title === title) continue;
      history.push({ ...parseTag(x.tag_name), title, date: x.published_at, url: x.html_url });
    }
    const portable = r.assets.find((a) => a !== installer && /\.exe$/i.test(a.name));
    return {
      ...parseTag(r.tag_name), date: r.published_at, size: installer?.size, history,
      // Straight to the file, so the Download button downloads instead of opening GitHub.
      installer: installer && { name: installer.name, url: installer.browser_download_url },
      portable: portable && { name: portable.name, url: portable.browser_download_url, size: portable.size },
      all: `https://github.com/${repo}/releases`, issues: `https://github.com/${repo}/issues`,
      // Every .exe in the release with GitHub's SHA-256, the installer first, then the portable exe.
      hashes: r.assets
        .filter((a) => /\.exe$/i.test(a.name) && a.digest)
        .sort((a, b) => (b === installer) - (a === installer))
        .map((a) => ({ name: a.name, sha256: a.digest.replace(/^sha256:/, ""), portable: a !== installer })),
    };
  } catch {
    return null;
  }
}
const releases = Object.fromEntries(await Promise.all(projects.map(async (p) => [p.id, await githubReleases(p)])));
const formatSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);
const formatDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// ---- Accent colours, taken from each app's icon ---------------------------------------------
// An 8-bit, non-interlaced RGB or RGBA PNG as { width, height, channels, data } (filters undone).
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let width, height, depth, type, interlace;
  const idat = [];
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at);
    const kind = buf.toString("ascii", at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (kind === "IHDR") [width, height, depth, type, interlace] = [body.readUInt32BE(0), body.readUInt32BE(4), body[8], body[9], body[12]];
    else if (kind === "IDAT") idat.push(body);
    else if (kind === "IEND") break;
    at += 12 + len;
  }
  const channels = { 2: 3, 6: 4 }[type];
  if (depth !== 8 || !channels || interlace) throw new Error(`unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= channels ? data[i - channels] : 0;
      const b = y ? data[i - stride] : 0;
      const c = x >= channels && y ? data[i - stride - channels] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      data[i] = (line[x] + pred) & 255;
    }
  }
  return { width, height, channels, data };
}

const hex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

// The icon's main colour: the hue that most of its vivid pixels share (dark backgrounds, whites and
// greys don't count), averaged, then kept bright and saturated enough to fill a button.
function iconAccent({ width, height, channels, data }) {
  const BINS = 36;
  const bins = Array.from({ length: BINS }, () => [0, 0, 0, 0]);
  for (let i = 0; i < width * height * channels; i += channels) {
    if (channels === 4 && data[i + 3] < 128) continue;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const s = max ? (max - min) / max : 0, v = max / 255;
    if (s < 0.3 || v < 0.3) continue;
    const d = max - min;
    const h = (max === r ? (g - b) / d + 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) % 6 / 6;
    const w = s * s * v;
    const bin = bins[Math.floor(h * BINS) % BINS];
    bin[0] += w; bin[1] += r * w; bin[2] += g * w; bin[3] += b * w;
  }
  const near = (i) => [(i + BINS - 1) % BINS, i, (i + 1) % BINS];
  // Neighbouring bins count too, so a gradient split across two hues still wins.
  const score = (i) => bins[near(i)[0]][0] + 2 * bins[i][0] + bins[near(i)[2]][0];
  const best = bins.reduce((top, _, i) => (score(i) > score(top) ? i : top), 0);
  const [w, r, g, b] = [0, 1, 2, 3].map((j) => near(best).reduce((sum, k) => sum + bins[k][j], 0));
  if (!w) return null;
  // To HSL, clamp, and back.
  const [R, G, B] = [r / w / 255, g / w / 255, b / w / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l0 = (max + min) / 2, d = max - min;
  const h = d ? (max === R ? (G - B) / d + 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4) % 6 / 6 : 0;
  const s = Math.max(d ? d / (1 - Math.abs(2 * l0 - 1)) : 0, 0.65);
  const l = Math.min(Math.max(l0, 0.45), 0.62);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const channel = (t) => {
    t = (t + 1) % 1;
    return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p);
  };
  return hex([channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]);
}

// `accent` in projects.json overrides the icon's colour; otherwise it comes from the icon.
const accents = {};
for (const p of projects) {
  try {
    accents[p.id] = p.accent || iconAccent(decodePng(await readFile(p.icon)));
  } catch (e) {
    console.warn(`No accent for ${p.id}: ${e.message}`);
  }
}

const PLATFORM_FAMILY = {
  iOS: "Apple", iPadOS: "Apple", macOS: "Apple", tvOS: "Apple", watchOS: "Apple", visionOS: "Apple",
  Windows: "Windows", Linux: "Linux", Android: "Android", Web: "Web",
};
// Windows apps here borrow the Mac's look (sidebar, traffic-light buttons), so the site spells out where they run.
const windowsOnly = (p) => families(p).join() === "Windows";
const STATUS_LABEL = { available: "Available", "in-development": "In Development", beta: "Beta" };

// SF Symbols-style glyphs drawn on a 20×20 grid.
const GLYPH = {
  windows: '<path d="M2.5 4.2 8.6 3.4v6.1H2.5Zm7.1-1 7.9-1.1v7.4H9.6ZM2.5 10.5h6.1v6.1l-6.1-.8Zm7.1 0h7.9v7.4l-7.9-1.1Z"/>',
  website: '<path d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm4.9 6.7h-2.3a12 12 0 0 0-1-4.4 5.9 5.9 0 0 1 3.3 4.4ZM10 4.2c.6.8 1.3 2.5 1.5 5H8.5c.2-2.5.9-4.2 1.5-5ZM8.4 4.8a12 12 0 0 0-1 4.4H5.1a5.9 5.9 0 0 1 3.3-4.4ZM5.1 10.8h2.3c.1 1.7.5 3.2 1 4.4a5.9 5.9 0 0 1-3.3-4.4Zm4.9 5c-.6-.8-1.3-2.5-1.5-5h3c-.2 2.5-.9 4.2-1.5 5Zm1.6-.6c.5-1.2.9-2.7 1-4.4h2.3a5.9 5.9 0 0 1-3.3 4.4Z"/>',
  download: '<path d="M10 2.5a1 1 0 0 1 1 1v8.1l2.8-2.8a1 1 0 1 1 1.4 1.4l-4.5 4.5a1 1 0 0 1-1.4 0l-4.5-4.5a1 1 0 0 1 1.4-1.4L9 11.6V3.5a1 1 0 0 1 1-1ZM4 16a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Z"/>',
  source: '<path d="M7.7 5.3a1 1 0 0 1 0 1.4L4.4 10l3.3 3.3a1 1 0 1 1-1.4 1.4l-4-4a1 1 0 0 1 0-1.4l4-4a1 1 0 0 1 1.4 0Zm4.6 0a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 1 1-1.4-1.4l3.3-3.3-3.3-3.3a1 1 0 0 1 0-1.4Z"/>',
  warning: '<path d="M8.6 3.3a1.6 1.6 0 0 1 2.8 0l6.3 11.2a1.6 1.6 0 0 1-1.4 2.4H3.7a1.6 1.6 0 0 1-1.4-2.4Zm1.4 3.9a.9.9 0 0 0-.9.9v3.6a.9.9 0 1 0 1.8 0V8.1a.9.9 0 0 0-.9-.9Zm0 6.4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/>',
  check: '<path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm3.4 5.3a.9.9 0 0 0-1.3.1L9.2 11 7.8 9.6a.9.9 0 1 0-1.3 1.3l2.1 2.1a.9.9 0 0 0 1.3-.1l3.6-4.4a.9.9 0 0 0-.1-1.2Z"/>',
};
GLYPH.support = '<path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 10.9a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm0-7.4c-1.7 0-3 1.1-3.2 2.6a.9.9 0 0 0 1.8.3c.1-.6.7-1.1 1.4-1.1.8 0 1.4.5 1.4 1.2 0 .5-.3.8-.9 1.2-.8.5-1.4 1.1-1.4 2.1a.9.9 0 0 0 1.8 0c0-.3.2-.5.7-.8.8-.5 1.6-1.2 1.6-2.5 0-1.7-1.4-3-3.2-3Z"/>';
const GLYPH_SVG = Object.fromEntries(Object.entries(GLYPH).map(([k, v]) => [k, `<svg viewBox="0 0 20 20" aria-hidden="true">${v}</svg>`]));
const GLYPH_TINT = { website: "var(--blue)", download: "var(--accent, var(--green))", source: "#8e8e93", support: "var(--orange)" };

// True of every app on the site. Change these if that stops being so.
const NO_TELEMETRY = `No analytics, telemetry or crash reports, and nothing is ever sent to ${PUBLISHER}.`;
const UNSIGNED = "The downloads aren’t code-signed yet, so Windows SmartScreen may say “Windows protected your PC” and that the publisher is unknown. Choose More info, then Run anyway. To check a download is the real one, compare its SHA-256 hash with the ones shown here.";

// Text colour for a button filled with the app's accent: whichever of white or near-black reads better.
function labelOn(hex) {
  const [r, g, b] = hex.replace("#", "").match(/../g).map((c) => {
    const v = parseInt(c, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.05 ? "#fff" : "rgba(0, 0, 0, 0.86)";
}
const LINK_TITLE = { website: "Website", download: "Download", source: "Source Code", support: "Report a Problem" };
const LINK_DETAIL = { website: "", download: "GitHub Releases", source: "GitHub", support: "GitHub Issues" };
const GITHUB_MARK =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
const CHEVRON = '<svg class="chevron" viewBox="0 0 8 13" aria-hidden="true"><path d="M1.5 1.5 6.5 6.5 1.5 11.5"/></svg>';
const BACK = '<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2 2 10l8 8"/></svg>';
// Ko-fi's "Support me on Ko-fi" widget, drawn here instead of by its script: the script uses document.write,
// which doesn't run after app.js swaps pages in place, and it loads Google Fonts. The cup is a local copy.
const KOFI = `<a class="btn btn-kofi" href="https://ko-fi.com/O6N02AUO5M" target="_blank" rel="noopener" title="Support me on ko-fi.com"><img src="/assets/kofi-cup.png" alt="" width="22" height="18">Support me on Ko-fi</a>`;
const SEARCH = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 3a5.5 5.5 0 0 1 4.4 8.8l3.6 3.7a.9.9 0 0 1-1.3 1.3l-3.7-3.6A5.5 5.5 0 1 1 8.5 3Zm0 1.8a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z"/></svg>';

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const families = (p) => [...new Set(p.platforms.map((x) => PLATFORM_FAMILY[x] || x))];
const isOpenSource = (p) => (p.links || []).some((l) => l.kind === "source");
const asset = (path) => "/" + path.replace(/^\//, "");
const icon = (p, size, alt = "") => `<img class="app-icon" src="${esc(asset(p.icon))}" alt="${esc(alt)}" width="${size}" height="${size}">`;
// Platform marks for the facts strip: the Windows logo, and the Apple logo (Simple Icons, CC0) for Apple platforms.
const PLATFORM_GLYPH = {
  Windows: ["0 0 20 20", GLYPH.windows],
  Apple: ["0 0 24 24", '<path d="M12.15 6.9c-.95 0-2.42-1.08-3.96-1.04-2.04.03-3.91 1.18-4.96 3.01-2.12 3.68-.55 9.1 1.52 12.09 1.01 1.45 2.21 3.09 3.79 3.04 1.52-.07 2.09-.99 3.94-.99 1.83 0 2.35.99 3.96.95 1.64-.03 2.68-1.48 3.68-2.95 1.16-1.69 1.64-3.33 1.66-3.42-.04-.01-3.18-1.22-3.22-4.86-.03-3.04 2.48-4.49 2.6-4.56-1.43-2.09-3.62-2.32-4.39-2.38-2-.16-3.68 1.09-4.62 1.09Zm3.38-3.07c.84-1.01 1.4-2.43 1.25-3.83-1.21.05-2.66.81-3.53 1.82-.78.9-1.45 2.34-1.27 3.71 1.34.1 2.71-.69 3.55-1.7"/>'],
};
const platformIcon = (fam) =>
  PLATFORM_GLYPH[fam] ? `<svg class="platform-glyph" viewBox="${PLATFORM_GLYPH[fam][0]}" aria-hidden="true">${PLATFORM_GLYPH[fam][1]}</svg>` : "";

const fact = (label, value, note = "", iconHtml = "") =>
  `<div class="fact"><div class="fact-label">${esc(label)}</div><div class="fact-value">${iconHtml}${esc(value)}</div>${note ? `<div class="fact-note">${esc(note)}</div>` : ""}</div>`;

const appData = JSON.stringify(
  projects.map((p) => ({
    id: p.id, name: p.name, tagline: p.tagline, icon: asset(p.icon), platforms: p.platforms,
    links: (p.links || []).map(({ label, url, kind }) => ({ label, url, kind })),
  }))
).replace(/</g, "\\u003c");

// image: the favicon; wash: the tint at the top of the page; social: the 1200×630 link preview,
// drawn by scripts/og.py into assets/og/.
function layout({ title, description, path, image = "/assets/avatar.jpg", wash = image, social = "/assets/og/home.png", jsonld, bar, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE}${path}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${PUBLISHER}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${SITE}${social}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${esc(title)}">
  <meta property="og:url" content="${SITE}${path}">
  <meta name="twitter:card" content="summary_large_image">${jsonld ? `
  <script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}
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
      <span>Copyright © ${new Date().getFullYear()} ${PUBLISHER}. Independent software for Windows. All rights reserved. <a class="footer-link" href="/privacy/">Privacy &amp; Support</a></span>
      <span>Not affiliated with Apple, Valve, NVIDIA, Discord or the other companies named here.</span>
    </div>
  </footer>
</body>
</html>
`;
}

// Floating controls, always visible. Search has no button: Ctrl/⌘ K or / opens it (see app.js).
// Home: the publisher's capsule and the section links.
const homeBar = `<a class="pill glass" href="/" aria-label="${PUBLISHER}, home">
        <img src="/assets/avatar.jpg" alt="" width="32" height="32">${PUBLISHER}
      </a>
      <nav class="bar-links glass" aria-label="Sections">
        <a class="hide-narrow" href="/#apps">Apps</a>
        <a href="/#about">About</a>
        <a href="${GITHUB}">GitHub</a>
      </nav>`;

// App pages: back to the apps, and links to this app's support and GitHub page.
// Only the app's name waits for the large title to scroll away, so it isn't shown twice.
const appBar = (p) => {
  const repo = (p.links || []).find((l) => l.kind === "download")?.url.match(/^https:\/\/github\.com\/[^/]+\/[^/]+/)?.[0];
  return `<a class="circle glass" href="/" aria-label="Back to Apps">${BACK}</a>
      <span class="bar-title glass" aria-hidden="true">
        <img class="app-icon" src="${esc(asset(p.icon))}" alt="" width="32" height="32">${esc(p.name)}
      </span>
      <nav class="bar-links glass" aria-label="Sections">
        <a href="${esc(releases[p.id]?.issues || "/privacy/#support")}">Support</a>
        <a href="${esc(repo || GITHUB)}">GitHub</a>
      </nav>`;
};

// An app tile, like a Home Screen icon: the icon, its name and what it does in one line.
// Where each app runs is said once, above the grid, rather than on every tile.
function appCard(p, heading = "h3") {
  // Only a status that isn't "Available" earns a badge, in the same words as the app page.
  const soon =
    p.status !== "available"
      ? `<span class="tile-badge">${esc(STATUS_LABEL[p.status] || p.status)}</span>`
      : p.badge
        ? `<span class="tile-badge is-warn">${esc(p.badge)}</span>`
        : "";
  return `<li data-families="${esc(families(p).join(" "))}">
          <a class="app-tile" href="/${esc(p.id)}/">
            ${icon(p, 112)}
            <${heading} class="tile-name">${esc(p.name)}</${heading}>
            <span class="tile-tagline">${esc(p.tagline)}</span>${soon}
          </a>
        </li>`;
}

// "category" in projects.json: what kind of app it is, in the words people search with
// ("Steam Account Switcher for Windows"). It's used in the page title and search data, not shown on the page.
// Small numbers read better as words in a sentence.
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const countWord = (n) => WORDS[n] || String(n);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const DEVICE = { iOS: "iPhone", iPadOS: "iPad", macOS: "Mac", tvOS: "Apple TV", watchOS: "Apple Watch", visionOS: "Apple Vision Pro" };
const andList = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

// The screenshot on an app's home card: "cardShot" in projects.json if set, otherwise the first
// wide one (Windows or Mac), since a phone screenshot crops badly into a landscape card.
const WIDE = ["Windows", "Mac", "iPad", "Apple TV"];
const cardShot = (p) => {
  const shots = p.screenshots || [];
  return p.cardShot || (WIDE.map((d) => shots.find((s) => s.device === d)).find(Boolean) || shots[0])?.src;
};

// A home card: the app's screenshot, then its icon, name, what it does, where it runs and whether it's out.
// The icon stays inside the link so it still flies into place on the app page.
// The first row is on screen as the page opens, so only the cards below it load lazily.
function appShowcase(p, i = Infinity) {
  const shot = cardShot(p);
  const accent = accents[p.id] ? ` style="--accent:${esc(accents[p.id])}"` : "";
  const spot = p.spotlight ? " is-spotlight" : "";
  const where = windowsOnly(p) ? "Windows" : p.platforms.map((x) => DEVICE[x] || x).join(", ");
  const status = STATUS_LABEL[p.status] || p.status;
  const art = shot
    ? `<img src="${esc(asset(shot))}" alt=""${i < 3 ? "" : ' loading="lazy"'} decoding="async">`
    : `<span class="card-shot-empty" aria-hidden="true">${icon(p, 96)}</span>`;
  return `<li data-families="${esc(families(p).join(" "))}">
          <a class="app-card${spot}" href="/${esc(p.id)}/"${accent}>
            <span class="card-shot">${art}${p.spotlight ? `<span class="card-flag">${esc(p.spotlight.label || "New")}</span>` : ""}</span>
            <span class="card-body">
              ${shot ? icon(p, 52) : ""}
              <span class="card-text">
                <h3 class="card-name">${esc(p.name)}</h3>
                <span class="card-tagline">${esc(p.tagline)}</span>
                <span class="card-meta">${esc(where)}<span class="card-status${p.status === "available" ? "" : " is-soon"}">${esc(status)}</span>${p.badge ? `<span class="card-badge">${esc(p.badge)}</span>` : ""}</span>
              </span>
            </span>
          </a>
        </li>`;
}

// What every app has in common, kept short: the measurements and how they were taken live on each
// app's page under "Under the Hood", where they support the app instead of crowding the home page.
const PRINCIPLES = [
  ["Focused", "Each app solves one specific problem, such as switching Steam accounts or editing an emulator save, and does it properly."],
  ["Light", "Native apps with no background services you didn’t ask for. Idle in the tray, they use a few megabytes instead of hundreds."],
  ["Private", "No accounts, no ads and no telemetry. Hangar and Parley sign in with a QR code, so your password is never seen or stored."],
  ["Careful", "Keepsake backs up every save before changing it, Verdant only runs drivers signed by NVIDIA, and every update is checked against its SHA-256 hash."],
];


// An app still in development, shown wide under "In the Works": a big screenshot, what it is,
// where it's coming and a plain "In Development" status, so it reads as a preview, not a download.
function appPreview(p) {
  const shot = cardShot(p);
  const accent = accents[p.id] ? ` style="--accent:${esc(accents[p.id])}"` : "";
  return `<li>
          <a class="app-card upcoming-card" href="/${esc(p.id)}/"${accent}>
            <span class="card-shot">${shot ? `<img src="${esc(asset(shot))}" alt="" loading="lazy" decoding="async">` : `<span class="card-shot-empty" aria-hidden="true">${icon(p, 96)}</span>`}</span>
            <span class="card-body">
              ${icon(p, 64)}
              <span class="card-text">
                <h3 class="card-name">${esc(p.name)}</h3>
                <span class="card-status is-soon">${esc(STATUS_LABEL[p.status] || p.status)}</span>
                <span class="card-tagline">${esc(p.tagline)}</span>
                ${p.description ? `<span class="card-desc">${esc(p.description)}</span>` : ""}
                <span class="card-meta">Coming to ${esc(andList(p.platforms.map((x) => DEVICE[x] || x)))}</span>
                <span class="card-more">See ${esc(p.name)} ${CHEVRON}</span>
              </span>
            </span>
          </a>
        </li>`;
}

// The platform filter only earns its place once there are enough apps to sift through.
const FILTER_FROM = 7;

function homePage() {
  // Released apps lead; apps still in development get their own section below, so the first thing
  // a visitor meets is something they can download today.
  const released = projects.filter((p) => p.status !== "in-development");
  const upcoming = projects.filter((p) => p.status === "in-development");
  const fams = [...new Set(released.flatMap(families))];
  const filter =
    fams.length > 1 && released.length >= FILTER_FROM
      ? `<div class="segmented" id="filter" role="radiogroup" aria-label="Filter by platform">
          <span class="segmented-thumb" style="width:calc((100% - 8px) / ${fams.length + 1})"></span>
          ${["All", ...fams].map((f, i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-family="${esc(f)}">${esc(f)}</button>`).join("\n          ")}
        </div>`
      : "";
  const winCount = released.filter(windowsOnly).length;
  const body = `    <section class="hero wrap" aria-labelledby="page-title">
      <img class="avatar" src="/assets/avatar.jpg" alt="" width="128" height="128">
      <p class="hero-eyebrow">${PUBLISHER}</p>
      <h1 class="hero-title" id="page-title" tabindex="-1">Software that respects your&nbsp;PC.</h1>
      <p class="hero-sub">Lightweight Windows apps for gaming, emulation and everyday use. ${capital(countWord(winCount))} focused apps, each doing one job well, from one independent developer.</p>
    </section>

    <section class="section wrap" id="apps" aria-labelledby="apps-title">
      <div class="section-head">
        <h2 class="title-2" id="apps-title">Apps</h2>
        ${filter}
      </div>
      <ul class="app-grid card-grid" id="app-list">
        ${released.map(appShowcase).join("\n        ")}
      </ul>${upcoming.length ? "" : `\n      <p class="section-note grid-note">More apps are on the way.</p>`}
    </section>
${upcoming.length ? `
    <section class="section wrap" id="upcoming" aria-labelledby="upcoming-title">
      <div class="section-head">
        <h2 class="title-2" id="upcoming-title">In the Works</h2>
      </div>
      <ul class="upcoming-list">
        ${upcoming.map(appPreview).join("\n        ")}
      </ul>
      <p class="section-note grid-note">More apps are on the way.</p>
    </section>
` : ""}
    <section class="section wrap" id="principles" aria-labelledby="principles-title">
      <div class="section-head">
        <h2 class="title-2" id="principles-title">What They Share</h2>
      </div>
      <p class="section-lede">Independent software. Focused functionality. Minimal overhead.</p>
      <ul class="feature-grid">
        ${PRINCIPLES.map(
          ([title, text]) => `<li class="feature">
          <svg class="check" viewBox="0 0 20 20" aria-hidden="true">${GLYPH.check}</svg>
          <span><strong class="feature-title">${esc(title)}</strong>${esc(text)}</span>
        </li>`
        ).join("\n        ")}
      </ul>
    </section>

    <section class="section wrap" id="about" aria-labelledby="about-title">
      <div class="section-head">
        <h2 class="title-2" id="about-title">About</h2>
      </div>
      <div class="about-card">
        <p>${PUBLISHER} is one independent developer, known on GitHub as <a href="${GITHUB}">lilpatter</a>, making the apps I want on my own PC. Most replace a heavy official app with something smaller, or do the one thing the official app leaves out.</p>
        <p>The apps are closed source for now. Every download comes from the app’s GitHub Releases page, with its SHA-256 hash on the app’s page here. Found a bug or have an idea? Open an issue on the app’s GitHub page.</p>
        <p>The apps are free. If one saves you some time, you can buy me a coffee on Ko&#8209;fi.</p>
        <div class="hero-actions about-actions">
          <a class="btn btn-soft" href="${GITHUB}">${GITHUB_MARK}GitHub</a>
          ${KOFI}
        </div>
      </div>
    </section>`;
  return layout({
    title: `${PUBLISHER} — Lightweight Windows apps for gaming and emulation`,
    // What the apps do, not just their names: this is the line under the link in search results.
    description:
      `Free, lightweight Windows apps by ${PUBLISHER}: Keepsake (emulator game manager and save editor), Hangar (Steam account switcher), Verdant (NVIDIA driver updates without the NVIDIA App), Prism (per-game colour profiles) and Parley (a light Discord client).`,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: PUBLISHER,
      url: SITE,
      logo: `${SITE}/assets/avatar.jpg`,
      sameAs: [GITHUB],
    },
    path: "/",
    bar: homeBar,
    body,
  });
}

// A risk the visitor should know before downloading, shown right under the Download button:
// "warning": { "title", "text", "link": { "label", "url" } }.
function warning(p) {
  const w = p.warning;
  if (!w) return "";
  return `<div class="callout" role="note">
            <svg viewBox="0 0 20 20" aria-hidden="true">${GLYPH.warning}</svg>
            <div>
              <strong>${esc(w.title)}</strong>
              <p>${esc(w.text)}</p>
              ${w.link ? `<a href="${esc(w.link.url)}">${esc(w.link.label)}</a>` : ""}
            </div>
          </div>`;
}

// What a visitor should know before installing: what the app talks to, what stays on the PC,
// how downloads and updates are checked, and what it needs to run. Built from
// "privacy": { "contacts": [[service, why]], "local": [..] }, "updates" and "requirements".
function trustSection(p, release) {
  const pv = p.privacy;
  if (!pv && !p.requirements && !p.updates) return "";
  const bullets = (xs) => `<ul class="trust-list">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const cards = [];
  if (pv?.contacts?.length) {
    cards.push(`<div class="trust-card">
            <h3 class="trust-title">What it connects to</h3>
            <ul class="trust-list">${pv.contacts.map(([who, why]) => `<li><strong>${esc(who)}</strong>: ${esc(why)}</li>`).join("")}</ul>
          </div>`);
  }
  if (pv) {
    cards.push(`<div class="trust-card">
            <h3 class="trust-title">What stays on your PC</h3>
            ${bullets([...(pv.local || []), NO_TELEMETRY])}
          </div>`);
  }
  if (p.updates || release?.hashes?.length) {
    cards.push(`<div class="trust-card">
            <h3 class="trust-title">Downloads and updates</h3>
            ${bullets([p.updates, UNSIGNED].filter(Boolean))}
            ${(release?.hashes || []).map((h) => `<p class="hash"><span>SHA-256 of ${esc(h.name)}${h.portable ? " (portable, runs without installing)" : " (installer)"}</span><code>${esc(h.sha256)}</code></p>`).join("\n            ")}
          </div>`);
  }
  if (p.requirements?.length) {
    cards.push(`<div class="trust-card">
            <h3 class="trust-title">Requirements</h3>
            ${bullets(p.requirements)}
          </div>`);
  }
  return `
      <section class="app-section" id="privacy" aria-labelledby="privacy-title">
        <h2 class="title-2" id="privacy-title">Privacy &amp; Security</h2>
        <div class="trust-grid">
          ${cards.join("\n          ")}
        </div>
      </section>
`;
}

// A short screen recording above the screenshots: "video": { "src", "poster", "caption" } in projects.json.
// It never plays by itself; the viewer starts it.
function demo(p) {
  const v = p.video;
  if (!v?.src) return "";
  return `<figure class="demo">
          <video src="${esc(asset(v.src))}"${v.poster ? ` poster="${esc(asset(v.poster))}"` : ""} controls muted playsinline preload="none"></video>
          ${v.caption ? `<figcaption>${esc(v.caption)}</figcaption>` : ""}
        </figure>`;
}

// The direct download: the installer file itself, or the app's first link if there's no release.
function downloadHref(p) {
  const dl = (p.links || []).find((l) => l.kind === "download");
  return releases[p.id]?.installer?.url || dl?.url || "";
}

// Feature, screenshot, explanation: "tour": [{ "title", "text", "shot" }], where shot is a screenshot's
// src. Each row says what to notice in the screenshot next to it, alternating sides.
function tour(p) {
  const steps = p.tour || [];
  if (!steps.length) return "";
  const alt = (src) => (p.screenshots || []).find((x) => x.src === src)?.alt || "";
  return `      <section class="app-section" aria-labelledby="tour-title">
        <h2 class="title-2" id="tour-title">${esc(p.tourTitle || `What ${p.name} Does`)}</h2>
        <ol class="tour">
          ${steps
            .map(
              (t) => `<li class="tour-step">
            <figure class="tour-shot"><img src="${esc(asset(t.shot))}" alt="${esc(alt(t.shot))}" loading="lazy" decoding="async"></figure>
            <div class="tour-text">
              <h3 class="tour-title">${esc(t.title)}</h3>
              <p>${esc(t.text)}</p>
            </div>
          </li>`
            )
            .join("\n          ")}
        </ol>
${p.shotsNote ? `        <p class="shots-note">${esc(p.shotsNote)}</p>\n` : ""}      </section>
`;
}

// A table of exactly what's supported: "table": { "title", "intro", "columns": [..], "rows": [[..]], "note" }.
function supportTable(p) {
  const t = p.table;
  if (!t?.rows?.length) return "";
  return `
      <section class="app-section" id="${esc(t.id || "supported")}" aria-labelledby="table-title">
        <h2 class="title-2" id="table-title">${esc(t.title)}</h2>
        ${t.intro ? `<p class="section-lede">${esc(t.intro)}</p>` : ""}
        <div class="table-scroll" tabindex="0">
          <table class="support-table">
            <thead><tr>${t.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>
            <tbody>
              ${t.rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join("")}</tr>`).join("\n              ")}
            </tbody>
          </table>
        </div>
        ${t.note ? `<p class="group-note">${esc(t.note)}</p>` : ""}
      </section>
`;
}

// Answers to what people ask before downloading: "faq": [{ "q", "a" }]. Also given to search engines.
function faqSection(p) {
  if (!p.faq?.length) return "";
  return `
      <section class="app-section" id="faq" aria-labelledby="faq-title">
        <h2 class="title-2" id="faq-title">Questions and Answers</h2>
        <div class="list faq-list">
          ${p.faq
            .map(
              (f) => `<details class="faq">
            <summary>${esc(f.q)}${CHEVRON}</summary>
            <p>${esc(f.a)}</p>
          </details>`
            )
            .join("\n          ")}
        </div>
      </section>
`;
}

function gallery(p) {
  const shots = p.screenshots || [];
  if (!shots.length && !p.video?.src) return "";
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
          <h2 class="title-2" id="shots-title">${shots.length ? "Screenshots" : "See It Work"}</h2>
          ${tabs}
        </div>
        ${demo(p)}
        ${rows}
        ${p.shotsNote ? `<p class="shots-note">${esc(p.shotsNote)}</p>` : windowsOnly(p) ? `<p class="shots-note">Screenshots from Windows 11. The Mac-style sidebar and window buttons are part of ${esc(p.name)}’s design; it runs on Windows only.</p>` : ""}
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

  // Every app hosted on GitHub gets a "Report a Problem" row under its download link.
  const linkRows = [...links, ...(release?.issues ? [{ kind: "support", url: release.issues }] : [])]
    .map(
      (l) => `<a class="row has-glyph" href="${esc(l.url)}">
            <span class="glyph" style="--tint:${GLYPH_TINT[l.kind] || "var(--blue)"}"><svg viewBox="0 0 20 20" aria-hidden="true">${GLYPH[l.kind] || GLYPH.website}</svg></span>
            <span class="row-body row-title">${esc(LINK_TITLE[l.kind] || l.label)}</span>
            <span class="row-detail">${esc(LINK_DETAIL[l.kind] ?? "")}</span>
            ${CHEVRON}
          </a>`
    )
    .join("\n          ");
  // How it works, for people who want more than a feature list: "engineering": [{ "title", "text" }].
  const engineering = (p.engineering || [])
    .map(
      (e) => `<li class="feature">
            <span><strong class="feature-title">${esc(e.title)}</strong>${esc(e.text)}</span>
          </li>`
    )
    .join("\n          ");
  // Projects the app is built on: "credits": [{ "name", "by", "url", "license", "text" }].
  const credits = (p.credits || [])
    .map(
      (c) => `<li><a class="row" href="${esc(c.url)}">
            <span class="row-body">
              <span class="row-title">${esc(c.name)}${c.by ? ` <span class="credit-by">by ${esc(c.by)}</span>` : ""}</span>
              <span class="row-sub">${esc([c.license, c.text].filter(Boolean).join(" · "))}</span>
            </span>
            ${CHEVRON}
          </a></li>`
    )
    .join("\n          ");
  // The newest releases with something to say, newest first; the rest are a click away on GitHub.
  const RELEASES_SHOWN = 6;
  const history = (release?.history || [])
    .slice(0, RELEASES_SHOWN)
    .map(
      (h) => `<li><a class="row" href="${esc(h.url)}">
            <span class="row-body">
              <span class="row-title release-title">${esc(h.title)}</span>
              <span class="row-sub">${esc([h.version, h.build && `Build ${h.build}`, formatDate(h.date)].filter(Boolean).join(" · "))}</span>
            </span>
            ${CHEVRON}
          </a></li>`
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

  // Information, like the bottom of an App Store page. Only what the header and the facts strip
  // don't already say: platform, version, size and status are shown once, up there.
  const info = [
    ["Developer", PUBLISHER],
    release && ["Updated", formatDate(release.date)],
    release && ["Price", "Free"],
    release && p.stack && ["Built With", p.stack],
    ["Source", isOpenSource(p) ? "Open source" : "Closed source"],
  ]
    .filter(Boolean)
    .map(([k, v]) => `<div class="row info-row"><span class="row-body">${esc(k)}</span><span class="row-detail">${esc(v)}</span></div>`)
    .join("\n          ");

  const accent = accents[p.id] ? `--accent:${esc(accents[p.id])}; --on-accent:${labelOn(accents[p.id])}` : "";
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
            ${primary ? `<a class="btn btn-filled" href="${esc(primary.kind === "download" ? downloadHref(p) : primary.url)}">${primary.kind === "download" ? GLYPH_SVG.download : ""}${esc(windowsOnly(p) && primary.kind === "download" ? "Download for Windows" : primary.label)}</a>` : ""}
            ${p.status !== "available" ? `<span class="status" data-status="${esc(p.status)}">${esc(STATUS_LABEL[p.status] || p.status)}</span>` : ""}
          </div>
          ${primary?.kind === "download" && release?.installer ? `<p class="download-meta">${esc([`Version ${release.version}`, release.size && `${formatSize(release.size)} installer`, windowsOnly(p) && "Windows 10 and 11", "Free"].filter(Boolean).join(" · "))}</p>
          <p class="download-links">${[
            release.portable && `<a href="${esc(release.portable.url)}">Portable version</a>`,
            history && `<a href="#history">Release history</a>`,
            `<a href="#privacy">Is it safe?</a>`,
          ].filter(Boolean).join('<span aria-hidden="true"> · </span>')}</p>` : ""}
          ${warning(p)}
        </div>
      </header>

      <div class="facts">
        ${fact(p.platforms.length > 1 ? "Platforms" : "Platform", fams.join(" & "), p.platforms.length > 1 ? p.platforms.join(", ") : windowsOnly(p) ? "10 and 11" : "", fams.map(platformIcon).join(""))}
        ${release
          ? fact("Version", release.version, release.build ? `Build ${release.build}` : "") +
            (release.size ? fact("Size", formatSize(release.size), "Installer") : "")
          : fact("Status", STATUS_LABEL[p.status] || p.status) + (p.stack ? fact("Built With", stackMain, stackRest.join(" · ")) : "")}
      </div>

${p.tour ? (p.video?.src ? gallery({ ...p, screenshots: [] }) : "") : gallery(p)}
      <section class="app-section" aria-labelledby="about-title">
        <h2 class="title-2" id="about-title">About</h2>
        <p class="app-desc">${esc(p.description)}</p>
      </section>
${p.story ? `
      <section class="app-section" aria-labelledby="story-title">
        <h2 class="title-2" id="story-title">Why ${esc(p.name)} Exists</h2>
        ${[].concat(p.story).map((s, i) => `<p class="app-desc${i ? " app-story" : ""}">${esc(s)}</p>`).join("\n        ")}
      </section>
` : ""}
${tour(p)}${features ? `      <section class="app-section" aria-labelledby="features-title">
        <h2 class="title-2" id="features-title">Features</h2>
        <ul class="feature-grid">
          ${features}
        </ul>
      </section>
` : ""}${engineering ? `
      <section class="app-section" aria-labelledby="engineering-title">
        <h2 class="title-2" id="engineering-title">Under the Hood</h2>
        <ul class="feature-grid engineering">
          ${engineering}
        </ul>
      </section>
` : ""}${supportTable(p)}${credits ? `
      <section class="app-section" aria-labelledby="credits-title">
        <h2 class="title-2" id="credits-title">Credits</h2>
        <ul class="list credit-list">
          ${credits}
        </ul>
      </section>
` : ""}${history ? `
      <section class="app-section" id="history" aria-labelledby="history-title">
        <div class="section-head">
          <h2 class="title-2" id="history-title">Release History</h2>
          <a class="btn btn-plain" href="${esc(release.all)}">All Releases</a>
        </div>
        <ol class="list release-list">
          ${history}
        </ol>
      </section>
` : ""}${faqSection(p)}${trustSection(p, release)}
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
    // The category first, since that's what people search for; the name alone says little.
    title: `${p.name} — ${p.category || p.tagline.replace(/\.$/, "")}`,
    description: p.metaDescription || p.description,
    path: `/${p.id}/`,
    image: asset(p.icon),
    wash: asset(p.icon),
    social: `/assets/og/${p.id}.png`,
    // Lets search engines show the app as software: what it runs on, that it's free, its version.
    jsonld: {
      "@context": "https://schema.org",
      "@graph": [{
      "@type": "SoftwareApplication",
      name: p.name,
      alternateName: p.category,
      description: p.metaDescription || p.description,
      url: `${SITE}/${p.id}/`,
      image: `${SITE}${asset(p.icon)}`,
      operatingSystem: windowsOnly(p) ? "Windows 10, Windows 11" : p.platforms.join(", "),
      applicationCategory: "UtilitiesApplication",
      author: { "@type": "Organization", name: PUBLISHER, url: SITE, sameAs: [GITHUB] },
      ...(release && {
        softwareVersion: release.version,
        dateModified: release.date,
        downloadUrl: downloadHref(p),
        fileSize: release.size ? formatSize(release.size) : undefined,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      }),
      }, ...(p.faq?.length ? [{
        "@type": "FAQPage",
        mainEntity: p.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      }] : [])],
    },
    bar: appBar(p),
    body,
  });
}

function notFound() {
  return layout({
    title: `Page Not Found — ${PUBLISHER}`,
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

// /privacy/: the site-wide answer to "what do these apps do with my data, and where do I get help?"
// Built from the same privacy and support data as the app pages, so the two never disagree.
function privacyPage() {
  const shipped = projects.filter((p) => p.privacy);
  const rows = shipped
    .map((p) => {
      const release = releases[p.id];
      return `<li><a class="row has-glyph" href="/${esc(p.id)}/#privacy">
            ${icon(p, 40)}
            <span class="row-body">
              <span class="row-title">${esc(p.name)}</span>
              <span class="row-sub">Connects to ${esc(andList(p.privacy.contacts.map(([who]) => who)))}</span>
            </span>
            ${CHEVRON}
          </a></li>`;
    })
    .join("\n          ");
  const support = shipped
    .filter((p) => releases[p.id]?.issues)
    .map(
      (p) => `<li><a class="row has-glyph" href="${esc(releases[p.id].issues)}">
            ${icon(p, 40)}
            <span class="row-body row-title">${esc(p.name)}</span>
            <span class="row-detail">GitHub Issues</span>
            ${CHEVRON}
          </a></li>`
    )
    .join("\n          ");
  const bar = `<a class="circle glass" href="/" aria-label="Back to Apps">${BACK}</a>
      <nav class="bar-links glass" aria-label="Sections">
        <a href="/">Apps</a>
        <a href="${GITHUB}">GitHub</a>
      </nav>`;
  const body = `    <article class="wrap doc-page" aria-labelledby="page-title">
      <h1 class="large-title" id="page-title" tabindex="-1">Privacy &amp; Support</h1>
      <p class="app-desc">What ${PUBLISHER}’s apps do with your information, how to check a download is genuine, and where to get help. This covers the released apps: ${esc(andList(shipped.map((p) => p.name)))}.</p>

      <section class="app-section" aria-labelledby="short-title">
        <h2 class="title-2" id="short-title">The Short Version</h2>
        <ul class="feature-grid">
          <li class="feature"><svg class="check" viewBox="0 0 20 20" aria-hidden="true">${GLYPH.check}</svg><span><strong class="feature-title">No tracking</strong>${esc(NO_TELEMETRY)}</span></li>
          <li class="feature"><svg class="check" viewBox="0 0 20 20" aria-hidden="true">${GLYPH.check}</svg><span><strong class="feature-title">Only what the app needs</strong>Each app talks to the services it works with, such as Steam, NVIDIA or Discord, and to GitHub for updates. Nothing else.</span></li>
          <li class="feature"><svg class="check" viewBox="0 0 20 20" aria-hidden="true">${GLYPH.check}</svg><span><strong class="feature-title">Secrets stay encrypted</strong>Hangar and Parley sign in with a QR code from your phone, so they never see your password, and the tokens they get back are encrypted with Windows’ own data protection (DPAPI).</span></li>
          <li class="feature"><svg class="check" viewBox="0 0 20 20" aria-hidden="true">${GLYPH.check}</svg><span><strong class="feature-title">This website</strong>No analytics, no cookies and no third-party scripts. It’s hosted on GitHub Pages, which keeps its own server logs under GitHub’s privacy statement.</span></li>
        </ul>
      </section>

      <section class="app-section" aria-labelledby="apps-privacy-title">
        <h2 class="title-2" id="apps-privacy-title">App by App</h2>
        <ul class="list">
          ${rows}
        </ul>
        <p class="group-note">Each app’s page lists exactly what it connects to and why, what stays on your PC, and what it needs to run.</p>
      </section>

      <section class="app-section" id="security" aria-labelledby="security-title">
        <h2 class="title-2" id="security-title">Checking a Download</h2>
        <div class="about-card">
          <p>Every app downloads from its own GitHub Releases page, and updates itself from there too, checking each download against its SHA-256 hash before installing.</p>
          <p>${esc(UNSIGNED)} In PowerShell, run this on the file you downloaded:</p>
          <pre class="code"><code>Get-FileHash .\\Keepsake_1.1.0_x64-setup.exe</code></pre>
          <p>The hash it prints should match the one in the Privacy &amp; Security section of that app’s page, and the one GitHub shows next to the file.</p>
        </div>
      </section>

      <section class="app-section" id="support" aria-labelledby="support-title">
        <h2 class="title-2" id="support-title">Support</h2>
        <ul class="list">
          ${support}
        </ul>
        <p class="group-note">Found a bug or have an idea? Open an issue on that app’s GitHub page. You’ll need a free GitHub account.</p>
      </section>
    </article>`;
  return layout({
    title: `Privacy & Support — ${PUBLISHER}`,
    description: `What ${PUBLISHER}’s apps do with your information, how to check a download, and where to get help.`,
    path: "/privacy/",
    bar,
    body,
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

// Each app's accent, for other sites (the GitHub profile tiles) to use the same colour.
await writeFile("accents.json", JSON.stringify(accents, null, 2) + "\n");
// Each app's current version, for the GitHub profile tiles. Kept from the last build when offline.
const previousVersions = await readFile("versions.json", "utf8").then(JSON.parse, () => ({}));
const versions = Object.fromEntries(projects.map((p) => [p.id, releases[p.id]?.version || previousVersions[p.id]]).filter(([, v]) => v));
await writeFile("versions.json", JSON.stringify(versions, null, 2) + "\n");
await writeFile("index.html", homePage());
await writeFile("404.html", notFound());
await mkdir("privacy", { recursive: true });
await writeFile("privacy/index.html", privacyPage());
// Every page, for search engines (robots.txt points here).
await writeFile(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${["/", ...projects.map((p) => `/${p.id}/`), "/privacy/"].map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join("\n")}
</urlset>
`
);
for (const p of projects) {
  await mkdir(p.id, { recursive: true });
  await writeFile(`${p.id}/index.html`, appPage(p));
}
const withRelease = Object.entries(releases).filter(([, r]) => r).map(([id, r]) => `${id} ${r.version}`);
console.log(`Release info: ${withRelease.join(", ") || "none (offline or rate limited)"}`);
console.log(`Accents: ${Object.entries(accents).map(([id, c]) => `${id} ${c}`).join(", ")}`);
console.log(`Built home, 404, privacy and ${projects.length} app pages: ${projects.map((p) => "/" + p.id + "/").join(" ")}`);
