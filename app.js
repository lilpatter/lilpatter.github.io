// Progressive enhancement for the pre-built pages (see build.mjs). Without this file every link
// still works as a normal page load; with it:
//   - links between pages load in place: a skeleton of the next page shows at once, the tapped
//     app icon flies into place (View Transitions), then the content fades up when it arrives
//   - pages are prefetched on hover or touch, so most navigations are instant
//   - the app page's icon tilts toward the pointer with a moving highlight
//   - Ctrl/⌘ K (or /) opens a search for apps and actions

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const APPS = JSON.parse(document.getElementById("apps-data")?.textContent || "[]");
const appById = Object.fromEntries(APPS.map((a) => [a.id, a]));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Bar: controls appear once the page title scrolls away ---------- */

let barObserver;
function watchBar() {
  const bar = document.getElementById("bar");
  const title = document.querySelector("#page-title, #app-title");
  barObserver?.disconnect();
  bar.classList.remove("is-scrolled");
  if (!title) return;
  barObserver = new IntersectionObserver(([entry]) => bar.classList.toggle("is-scrolled", !entry.isIntersecting), {
    rootMargin: "-52px 0px 0px 0px",
  });
  barObserver.observe(title);
}

/* ---------- Background colours ---------- */

// Reads three characteristic colours from an image once (on a 32×32 canvas) and caches them.
// The moving background is drawn from these as plain gradients, which are cheap to animate.
const palettes = new Map();
function paletteFor(src) {
  if (!palettes.has(src)) {
    palettes.set(
      src,
      new Promise((resolve) => {
        const img = new Image();
        img.src = src;
        img
          .decode()
          .then(() => {
            const size = 32;
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, size, size);
            const { data } = ctx.getImageData(0, 0, size, size);
            const buckets = new Map();
            for (let i = 0; i < data.length; i += 4) {
              const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
              if (a < 200) continue;
              const max = Math.max(r, g, b), min = Math.min(r, g, b);
              const light = (max + min) / 510;
              if (light < 0.08 || light > 0.94) continue; // near black or white says little about the image
              const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
              const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
              const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0, sat: 0 };
              e.r += r; e.g += g; e.b += b; e.sat += sat; e.n++;
              buckets.set(key, e);
            }
            const candidates = [...buckets.values()]
              .map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, score: e.n * (0.35 + e.sat / e.n) }))
              .sort((x, y) => y.score - x.score);
            const picked = [];
            for (const c of candidates) {
              if (picked.every((p) => Math.hypot(p.r - c.r, p.g - c.g, p.b - c.b) > 70)) picked.push(c);
              if (picked.length === 3) break;
            }
            while (picked.length && picked.length < 3) picked.push(picked[picked.length - 1]);
            resolve(picked.length ? picked.map((c) => `rgb(${c.r | 0} ${c.g | 0} ${c.b | 0})`) : null);
          })
          .catch(() => resolve(null));
      })
    );
  }
  return palettes.get(src);
}

function applyWash() {
  const wash = document.querySelector("main .wash");
  const art = wash && getComputedStyle(wash).getPropertyValue("--art");
  const src = art?.match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1];
  if (!src) return;
  paletteFor(src).then((colors) => {
    if (!colors || !wash.isConnected) return;
    colors.forEach((c, i) => wash.style.setProperty(`--c${i + 1}`, c));
    wash.classList.add("is-ready");
  });
}

/* ---------- Screenshot device switch ---------- */

function wireDeviceTabs() {
  document.querySelectorAll(".device-tabs").forEach((tabs) => {
    const buttons = [...tabs.querySelectorAll('[role="tab"]')];
    const thumb = tabs.querySelector(".segmented-thumb");
    const select = (btn) => {
      buttons.forEach((b) => {
        const on = b === btn;
        b.setAttribute("aria-selected", String(on));
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
        document.getElementById(b.getAttribute("aria-controls")).hidden = !on;
      });
      thumb.style.transform = `translateX(${buttons.indexOf(btn) * 100}%)`;
    };
    buttons.forEach((b, i) => (b.tabIndex = i ? -1 : 0));
    tabs.addEventListener("click", (e) => {
      const btn = e.target.closest('[role="tab"]');
      if (btn) select(btn);
    });
    tabs.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = buttons.indexOf(document.activeElement);
      const next = buttons[(i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
      next.focus();
      select(next);
    });
  });
}

/* ---------- Platform filter ---------- */

function wireFilter() {
  const filter = document.getElementById("filter");
  if (!filter) return;
  const thumb = filter.querySelector(".segmented-thumb");
  const buttons = [...filter.querySelectorAll("button")];
  filter.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    buttons.forEach((b) => b.setAttribute("aria-checked", String(b === btn)));
    thumb.style.transform = `translateX(${buttons.indexOf(btn) * 100}%)`;
    const f = btn.dataset.family;
    const update = () =>
      document.querySelectorAll("#app-list > li").forEach((li) => {
        li.hidden = f !== "All" && !li.dataset.families.split(" ").includes(f);
      });
    transition(update);
  });
}

/* ---------- Tilting icon ---------- */

function wireTilt() {
  if (reduceMotion.matches) return;
  document.querySelectorAll("[data-tilt]").forEach((el) => {
    const area = el.closest(".app-hero") || el;
    let frame = 0;
    const move = (e) => {
      const r = el.getBoundingClientRect();
      // Pointer position relative to the icon, clamped so far-away movement stays gentle.
      const x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 1.5)));
      const y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height * 1.5)));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.classList.add("is-active");
        el.style.setProperty("--ry", `${x * 16}deg`);
        el.style.setProperty("--rx", `${-y * 16}deg`);
        el.style.setProperty("--gx", `${50 + x * 50}%`);
        el.style.setProperty("--gy", `${50 + y * 50}%`);
      });
    };
    const reset = () => {
      cancelAnimationFrame(frame);
      el.classList.remove("is-active");
      ["--rx", "--ry", "--gx", "--gy"].forEach((p) => el.style.removeProperty(p));
    };
    area.addEventListener("pointermove", move);
    area.addEventListener("pointerleave", reset);
    area.addEventListener("pointercancel", reset);
  });
}

/* ---------- Entry animation ---------- */

function playEntrance() {
  const main = document.querySelector("main");
  const parts = main.querySelectorAll(
    ".hero > *, .section-head, .app-grid > li, .app-hero, .app-page > .facts, .app-desc, .app-columns > div"
  );
  parts.forEach((el, i) => el.style.setProperty("--i", i));
  main.classList.remove("is-entering");
  void main.offsetWidth;
  main.classList.add("is-entering");
  clearTimeout(playEntrance.timer);
  playEntrance.timer = setTimeout(() => main.classList.remove("is-entering"), 1400);
}

function hydrate() {
  applyWash();
  wireDeviceTabs();
  watchBar();
  wireFilter();
  wireTilt();
  updateShortcutHint();
}

/* ---------- Router ---------- */

const pages = new Map();
const isPagePath = (path) => path === "/" || path === "/index.html" || /^\/[a-z0-9-]+\/$/.test(path);
const appIdFor = (path) => path.match(/^\/([a-z0-9-]+)\/$/)?.[1] || null;

function fetchPage(path) {
  if (!pages.has(path)) {
    const request = fetch(path)
      .then((res) => {
        if (!res.ok) throw new Error(res.status);
        return res.text();
      })
      .then((html) => new DOMParser().parseFromString(html, "text/html"));
    request.catch(() => pages.delete(path));
    pages.set(path, request);
  }
  return pages.get(path);
}

function internalUrl(a) {
  if (!a || a.target || a.hasAttribute("download")) return null;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || !isPagePath(url.pathname)) return null;
  return url;
}

// Runs a DOM update inside a View Transition when the browser supports it.
function transition(update, type) {
  // With Reduce Motion on, the CSS turns these into plain fades.
  if (!document.startViewTransition) {
    update();
    return Promise.resolve();
  }
  if (type) document.documentElement.dataset.transition = type;
  const t = document.startViewTransition(update);
  // A transition waits for the next painted frame; if the page isn't painting (a background
  // window, a busy device), skip the animation so navigation never stalls.
  const guard = setTimeout(() => t.skipTransition(), 1000);
  t.ready.catch(() => {}); // A skipped transition rejects "ready"; that's expected.
  return t.finished.catch(() => {}).finally(() => {
    clearTimeout(guard);
    delete document.documentElement.dataset.transition;
  });
}

function skeleton(path) {
  const id = appIdFor(path);
  const app = id && appById[id];
  const bars = (n, cls = "") => Array.from({ length: n }, () => `<span class="sk sk-line ${cls}"></span>`).join("");
  if (id) {
    const icon = app
      ? `<img class="app-icon" src="${esc(app.icon)}" alt="" width="128" height="128">`
      : `<span class="sk sk-icon"></span>`;
    return {
      wash: app?.icon,
      html: `<article class="wrap app-page skeleton" aria-busy="true" aria-label="Loading">
        <div class="app-hero">
          <div class="tilt"><div class="tilt-inner">${icon}</div></div>
          <div class="sk-stack">
            ${app ? `<h1 class="app-name">${esc(app.name)}</h1><p class="app-subtitle">${esc(app.tagline)}</p>` : `<span class="sk sk-title"></span><span class="sk sk-line w60"></span>`}
            <div class="header-actions"><span class="sk sk-pill"></span><span class="sk sk-pill sm"></span></div>
          </div>
        </div>
        <div class="facts">${`<div class="fact"><span class="sk sk-line w40 c"></span><span class="sk sk-line w70 c lg"></span></div>`.repeat(4)}</div>
        <div class="app-section"><span class="sk sk-title sm"></span><div class="sk-para">${bars(2, "w90")}${bars(1, "w60")}</div></div>
        <div class="app-section"><span class="sk sk-title sm"></span>
          <ul class="feature-grid">${`<li class="feature"><span class="sk sk-dot"></span><span class="sk sk-line w70"></span></li>`.repeat(4)}</ul>
        </div>
      </article>`,
    };
  }
  return {
    wash: "/assets/avatar.jpg",
    html: `<section class="hero wrap skeleton" aria-busy="true" aria-label="Loading">
        <span class="sk sk-avatar"></span>
        <span class="sk sk-title c"></span>
        <span class="sk sk-line w40 c"></span>
        <div class="hero-actions"><span class="sk sk-pill"></span><span class="sk sk-pill"></span></div>
      </section>
      <section class="section wrap skeleton">
        <div class="section-head"><span class="sk sk-title sm"></span></div>
        <ul class="app-grid">${`<li><div class="app-tile"><span class="sk sk-app"></span><span class="sk sk-line w50 c"></span></div></li>`.repeat(Math.max(APPS.length, 3))}</ul>
      </section>`,
  };
}

function setWash(src) {
  const wash = document.querySelector("main .wash");
  if (wash && src) wash.style.setProperty("--art", `url('${src}')`);
}

// Names the icon that should fly between pages; names must be unique at any moment.
function markSharedIcon(img) {
  document.querySelectorAll(".app-icon").forEach((i) => (i.style.viewTransitionName = ""));
  document.querySelectorAll(".app-hero .app-icon").forEach((i) => (i.style.viewTransitionName = "none"));
  if (img) img.style.viewTransitionName = "app-icon";
}

let navId = 0;
async function navigate(url, { pop = false, sourceIcon = null } = {}) {
  const id = ++navId;
  const path = url.pathname === "/index.html" ? "/" : url.pathname;
  const samePage = path === (location.pathname === "/index.html" ? "/" : location.pathname);

  // Same page with a hash: just scroll.
  if (samePage && !pop && url.hash) {
    history.pushState({ scroll: 0 }, "", url.href);
    document.querySelector(url.hash)?.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth" });
    return;
  }

  history.replaceState({ ...history.state, scroll: scrollY }, "");
  if (!pop) history.pushState({ scroll: 0 }, "", url.href);

  const loading = fetchPage(path);
  const settled = await Promise.race([loading.then(() => true, () => true), sleep(0).then(() => false)]);
  closePalette();

  // Show the skeleton first: the tapped icon morphs into the skeleton's hero icon.
  markSharedIcon(sourceIcon);
  const main = document.querySelector("main");
  const { html, wash } = skeleton(path);
  await transition(() => {
    main.innerHTML = `<div class="wash" aria-hidden="true"><i></i><i></i><i></i></div>${html}`;
    setWash(wash);
    applyWash();
    // The bar of the page being opened: a back button on app pages, nothing yet on home.
    barObserver?.disconnect();
    document.getElementById("bar").classList.remove("is-scrolled");
    document.querySelector("#bar .bar-inner").innerHTML = appIdFor(path)
      ? `<a class="circle glass" href="/" aria-label="Back to Apps"><svg viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2 2 10l8 8"/></svg></a>`
      : "";
    scrollTo(0, 0);
  }, "to-skeleton");

  let doc;
  try {
    // Keep the skeleton up for a short beat even when the page is cached, so the change reads as one motion.
    [doc] = await Promise.all([loading, sleep(settled ? 160 : 280)]);
  } catch {
    location.href = url.href; // Fall back to a normal page load.
    return;
  }
  if (id !== navId) return; // A newer navigation started meanwhile.

  await transition(() => {
    document.title = doc.title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", doc.querySelector('meta[name="description"]')?.content || "");
    document.querySelector("#bar .bar-inner").innerHTML = doc.querySelector("#bar .bar-inner").innerHTML;
    main.innerHTML = doc.querySelector("main").innerHTML;
    hydrate();
    const target = url.hash && document.querySelector(url.hash);
    if (target) target.scrollIntoView();
    else scrollTo(0, pop ? history.state?.scroll || 0 : 0);
  }, "to-content");
  playEntrance();
  document.querySelector("main h1")?.focus({ preventScroll: true });
}

function wireRouter() {
  if (!("pushState" in history)) return;
  history.scrollRestoration = "manual";

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]");
    const url = internalUrl(a);
    if (!url) return;
    e.preventDefault();
    navigate(url, { sourceIcon: a.querySelector(".app-icon") });
  });

  const prefetch = (e) => {
    const url = internalUrl(e.target.closest?.("a[href]"));
    if (url && url.pathname !== location.pathname) fetchPage(url.pathname);
  };
  document.addEventListener("pointerover", prefetch, { passive: true });
  document.addEventListener("touchstart", prefetch, { passive: true });
  document.addEventListener("focusin", prefetch);

  addEventListener("popstate", () => navigate(new URL(location.href), { pop: true }));
}

/* ---------- Search ---------- */

const palette = document.getElementById("palette");
const paletteInput = document.getElementById("palette-input");
const paletteList = document.getElementById("palette-results");
let paletteItems = [];
let paletteIndex = 0;

function paletteEntries() {
  const entries = APPS.map((a) => ({
    title: a.name,
    sub: a.tagline,
    meta: a.platforms.join(" · "),
    icon: a.icon,
    href: `/${a.id}/`,
    keywords: `${a.name} ${a.tagline} ${a.platforms.join(" ")}`,
  }));
  for (const a of APPS) {
    for (const l of a.links) {
      if (l.kind === "download") entries.push({ title: `Download ${a.name}`, sub: "Latest release on GitHub", icon: a.icon, href: l.url, keywords: `download get install ${a.name}` });
      if (l.kind === "website") entries.push({ title: `${a.name} website`, sub: new URL(l.url).host, icon: a.icon, href: l.url, keywords: `website site ${a.name}` });
    }
  }
  entries.push({ title: "PG on GitHub", sub: "github.com/lilpatter", icon: "/assets/avatar.jpg", round: true, href: "https://github.com/lilpatter", keywords: "github profile source code" });
  return entries;
}

// Every typed character must appear in order; earlier and word-start matches rank higher.
function score(query, text) {
  if (!query) return 1;
  const t = text.toLowerCase();
  let pos = -1, total = 0;
  for (const ch of query.toLowerCase()) {
    if (ch === " ") continue;
    const next = t.indexOf(ch, pos + 1);
    if (next < 0) return 0;
    total += next === pos + 1 ? 3 : next === 0 || t[next - 1] === " " ? 2 : 1;
    pos = next;
  }
  return total / (1 + pos * 0.02);
}

function renderPalette() {
  const q = paletteInput.value.trim();
  // Titles match loosely (letters in order); other text only when every word appears as typed.
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const inKeywords = (e) => (words.every((w) => e.keywords.toLowerCase().includes(w)) ? 1 : 0);
  paletteItems = paletteEntries()
    .map((e) => ({ ...e, s: Math.max(score(q, e.title) * 2, inKeywords(e)) }))
    .filter((e) => e.s > 0)
    .sort((a, b) => b.s - a.s);
  paletteIndex = Math.min(paletteIndex, Math.max(paletteItems.length - 1, 0));
  paletteList.innerHTML = paletteItems.length
    ? paletteItems
        .map(
          (e, i) => `<li role="option" id="pal-${i}" aria-selected="${i === paletteIndex}" data-i="${i}">
            <img class="${e.round ? "round" : "app-icon"}" src="${esc(e.icon)}" alt="" width="36" height="36">
            <span class="pal-text"><span class="pal-title">${esc(e.title)}</span><span class="pal-sub">${esc(e.sub)}</span></span>
            ${e.href.startsWith("/") ? "" : '<span class="pal-ext" aria-hidden="true">↗</span>'}
          </li>`
        )
        .join("")
    : `<li class="pal-empty">No results for “${esc(q)}”</li>`;
  paletteInput.setAttribute("aria-activedescendant", paletteItems.length ? `pal-${paletteIndex}` : "");
}

function openPalette() {
  if (!palette || palette.open) return;
  paletteInput.value = "";
  paletteIndex = 0;
  renderPalette();
  palette.showModal();
  paletteInput.focus();
}

function closePalette() {
  if (palette?.open) palette.close();
}

function choose(i) {
  const item = paletteItems[i];
  if (!item) return;
  closePalette();
  if (item.href.startsWith("/")) navigate(new URL(item.href, location.href));
  else location.href = item.href;
}

function wirePalette() {
  if (!palette) return;
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-palette]")) openPalette();
  });
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
      e.preventDefault();
      palette.open ? closePalette() : openPalette();
    }
  });
  paletteInput.addEventListener("input", () => {
    paletteIndex = 0;
    renderPalette();
  });
  paletteInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = paletteItems.length;
      if (!n) return;
      paletteIndex = (paletteIndex + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      renderPalette();
      document.getElementById(`pal-${paletteIndex}`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(paletteIndex);
    }
  });
  paletteList.addEventListener("click", (e) => {
    const li = e.target.closest("[data-i]");
    if (li) choose(+li.dataset.i);
  });
  paletteList.addEventListener("pointermove", (e) => {
    const li = e.target.closest("[data-i]");
    if (li && +li.dataset.i !== paletteIndex) {
      paletteIndex = +li.dataset.i;
      paletteList.querySelectorAll("[data-i]").forEach((el) => el.setAttribute("aria-selected", String(+el.dataset.i === paletteIndex)));
      paletteInput.setAttribute("aria-activedescendant", `pal-${paletteIndex}`);
    }
  });
  // Clicking the dimmed backdrop closes it.
  palette.addEventListener("click", (e) => {
    if (e.target === palette) closePalette();
  });
}

function updateShortcutHint() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  document.querySelectorAll("[data-shortcut]").forEach((k) => (k.textContent = mac ? "⌘K" : "Ctrl K"));
}

hydrate();
wireRouter();
wirePalette();
playEntrance();
