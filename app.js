// Renders the app list and app pages from projects.json. To add an app, add an entry there and its icon under assets/icons.

const PLATFORM_FAMILY = {
  iOS: "Apple", iPadOS: "Apple", macOS: "Apple", tvOS: "Apple", watchOS: "Apple", visionOS: "Apple",
  Windows: "Windows", Linux: "Linux", Android: "Android", Web: "Web",
};
const STATUS_LABEL = { available: "Available", "in-development": "In Development", beta: "Beta" };
// Short capsule labels, as on the App Store.
const ACTION_LABEL = { download: "Get", website: "Visit" };

// SF Symbols-style glyphs drawn on a 20×20 grid.
const GLYPH = {
  website: '<path d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm4.9 6.7h-2.3a12 12 0 0 0-1-4.4 5.9 5.9 0 0 1 3.3 4.4ZM10 4.2c.6.8 1.3 2.5 1.5 5H8.5c.2-2.5.9-4.2 1.5-5ZM8.4 4.8a12 12 0 0 0-1 4.4H5.1a5.9 5.9 0 0 1 3.3-4.4ZM5.1 10.8h2.3c.1 1.7.5 3.2 1 4.4a5.9 5.9 0 0 1-3.3-4.4Zm4.9 5c-.6-.8-1.3-2.5-1.5-5h3c-.2 2.5-.9 4.2-1.5 5Zm1.6-.6c.5-1.2.9-2.7 1-4.4h2.3a5.9 5.9 0 0 1-3.3 4.4Z"/>',
  download: '<path d="M10 2.5a1 1 0 0 1 1 1v8.1l2.8-2.8a1 1 0 1 1 1.4 1.4l-4.5 4.5a1 1 0 0 1-1.4 0l-4.5-4.5a1 1 0 0 1 1.4-1.4L9 11.6V3.5a1 1 0 0 1 1-1ZM4 16a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Z"/>',
  source: '<path d="M7.7 5.3a1 1 0 0 1 0 1.4L4.4 10l3.3 3.3a1 1 0 1 1-1.4 1.4l-4-4a1 1 0 0 1 0-1.4l4-4a1 1 0 0 1 1.4 0Zm4.6 0a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 1 1-1.4-1.4l3.3-3.3-3.3-3.3a1 1 0 0 1 0-1.4Z"/>',
  check: '<path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm3.4 5.3a.9.9 0 0 0-1.3.1L9.2 11 7.8 9.6a.9.9 0 1 0-1.3 1.3l2.1 2.1a.9.9 0 0 0 1.3-.1l3.6-4.4a.9.9 0 0 0-.1-1.2Z"/>',
};
const GLYPH_TINT = { website: "var(--blue)", download: "var(--green)", source: "#8e8e93" };
const LINK_TITLE = { website: "Website", download: "Download", source: "Source Code" };
const LINK_DETAIL = { website: "", download: "GitHub Releases", source: "GitHub" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const families = (p) => [...new Set(p.platforms.map((x) => PLATFORM_FAMILY[x] || x))];
const isOpenSource = (p) => (p.links || []).some((l) => l.kind === "source");
const chevron = '<svg class="chevron" viewBox="0 0 8 13" aria-hidden="true"><path d="M1.5 1.5 6.5 6.5 1.5 11.5"/></svg>';
const icon = (p, size, alt = "") =>
  `<img class="app-icon" src="${esc(p.icon)}" alt="${esc(alt)}" width="${size}" height="${size}">`;

function fact(label, value, note = "") {
  return `<div class="fact"><div class="fact-label">${esc(label)}</div><div class="fact-value">${esc(value)}</div>${note ? `<div class="fact-note">${esc(note)}</div>` : ""}</div>`;
}

function appRow(p) {
  return `<li data-families="${esc(families(p).join(" "))}">
    <a class="row app-row" href="#${esc(p.id)}">
      ${icon(p, 64)}
      <div class="row-body">
        <div class="row-title">${esc(p.name)}</div>
        <div class="row-sub">${esc(p.tagline)}</div>
        <div class="row-meta">${esc(p.platforms.join(" · "))}</div>
      </div>
      <span class="btn btn-tinted get" aria-hidden="true">View</span>
    </a>
  </li>`;
}

function appPage(p) {
  const links = p.links || [];
  const primary = links[0];
  const primaryBtn = primary
    ? `<a class="btn btn-filled" href="${esc(primary.url)}">${esc(primary.label)}</a>`
    : "";
  const fams = families(p);

  const linkRows = links
    .map(
      (l) => `<a class="row has-glyph" href="${esc(l.url)}">
        <span class="glyph" style="--tint:${GLYPH_TINT[l.kind] || "var(--blue)"}"><svg viewBox="0 0 20 20" aria-hidden="true">${GLYPH[l.kind] || GLYPH.website}</svg></span>
        <span class="row-body row-title">${esc(LINK_TITLE[l.kind] || l.label)}</span>
        <span class="row-detail">${esc(LINK_DETAIL[l.kind] ?? "")}</span>
        ${chevron}
      </a>`
    )
    .join("");

  const highlightRows = (p.highlights || [])
    .map(
      (h) => `<div class="row" style="--inset:52px">
        <svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true" style="flex:none;fill:${esc(p.accent || "var(--blue)")}">${GLYPH.check}</svg>
        <span class="row-body row-title">${esc(h)}</span>
      </div>`
    )
    .join("");

  const el = document.createElement("article");
  el.className = "app-page";
  el.id = p.id;
  el.dataset.families = fams.join(" ");
  el.setAttribute("aria-labelledby", `${p.id}-name`);
  el.innerHTML = `
    <div class="app-hero">
      ${icon(p, 128, `${p.name} app icon`)}
      <div>
        <h3 class="app-name" id="${esc(p.id)}-name">${esc(p.name)}</h3>
        <p class="app-subtitle">${esc(p.tagline)}</p>
        <div class="header-actions">
          ${primaryBtn}
          <span class="status" data-status="${esc(p.status)}">${esc(STATUS_LABEL[p.status] || p.status)}</span>
        </div>
      </div>
    </div>
    <div class="facts">
      ${fact(p.platforms.length > 1 ? "Platforms" : "Platform", fams.join(" & "), p.platforms.length > 1 ? p.platforms.join(", ") : "")}
      ${fact("Status", STATUS_LABEL[p.status] || p.status)}
      ${p.stack ? fact("Built With", p.stack.split(" · ")[0], p.stack.split(" · ").slice(1).join(" · ")) : ""}
      ${fact("Source", isOpenSource(p) ? "Open" : "Closed", isOpenSource(p) ? "On GitHub" : "")}
    </div>
    <p class="app-desc">${esc(p.description)}</p>
    <div class="app-columns">
      ${highlightRows ? `<div><h4 class="group-title">Highlights</h4><div class="list">${highlightRows}</div></div>` : ""}
      ${linkRows ? `<div><h4 class="group-title">Links</h4><div class="list">${linkRows}</div>${p.note ? `<p class="group-note">${esc(p.note)}</p>` : ""}</div>` : ""}
    </div>`;
  return el;
}

function renderFacts(projects) {
  const platforms = [...new Set(projects.flatMap((p) => p.platforms))];
  const fams = [...new Set(projects.flatMap(families))];
  document.getElementById("facts").innerHTML = [
    fact("Apps", projects.length),
    fact("Platforms", platforms.length, fams.join(" & ")),
    fact("Open Source", projects.filter(isOpenSource).length, "On GitHub"),
    fact("Developer", "Since 2023", "github.com/lilpatter"),
  ].join("");
}

function renderFilter(projects) {
  const filter = document.getElementById("filter");
  const fams = [...new Set(projects.flatMap(families))];
  if (fams.length < 2) return filter.remove();
  const options = ["All", ...fams];
  filter.innerHTML =
    `<span class="segmented-thumb" style="width:calc((100% - 4px) / ${options.length})"></span>` +
    options.map((f, i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-family="${esc(f)}">${esc(f)}</button>`).join("");
  const thumb = filter.querySelector(".segmented-thumb");
  filter.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const buttons = [...filter.querySelectorAll("button")];
    buttons.forEach((b) => b.setAttribute("aria-checked", String(b === btn)));
    thumb.style.transform = `translateX(${buttons.indexOf(btn) * 100}%)`;
    const f = btn.dataset.family;
    document.querySelectorAll("#app-list > li, .app-page").forEach((el) => {
      el.hidden = f !== "All" && !el.dataset.families.split(" ").includes(f);
    });
  });
}

function watchBar() {
  const bar = document.getElementById("bar");
  const title = document.getElementById("page-title");
  new IntersectionObserver(([entry]) => bar.classList.toggle("is-scrolled", !entry.isIntersecting), {
    rootMargin: "-52px 0px 0px 0px",
  }).observe(title);
}

async function main() {
  document.getElementById("year").textContent = new Date().getFullYear();
  watchBar();
  const list = document.getElementById("app-list");
  try {
    const { projects } = await (await fetch("projects.json", { cache: "no-cache" })).json();
    list.innerHTML = projects.map(appRow).join("");
    document.getElementById("app-pages").replaceChildren(...projects.map(appPage));
    renderFacts(projects);
    renderFilter(projects);
  } catch {
    list.innerHTML = '<li><div class="row"><div class="row-body footnote">Couldn\'t load the apps. Browse them on <a href="https://github.com/lilpatter">GitHub</a>.</div></div></li>';
  }
}

main();
