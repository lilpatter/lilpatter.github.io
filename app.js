// Renders the project cards from projects.json. To add a project, add an entry there and its icon under assets/icons.

const PLATFORM_FAMILY = {
  iOS: "Apple", iPadOS: "Apple", macOS: "Apple", tvOS: "Apple", watchOS: "Apple", visionOS: "Apple",
  Windows: "Windows", Linux: "Linux", Android: "Android", Web: "Web",
};
const STATUS_LABEL = { available: "Available", "in-development": "In development", beta: "Beta" };
const ICONS = {
  website: '<path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V10M9 2h5v5M14 2 7.5 8.5"/>',
  download: '<path d="M8 2v8.5M4.5 7 8 10.5 11.5 7M2.5 13.5h11"/>',
  source: '<path d="M5.5 4 1.5 8l4 4M10.5 4l4 4-4 4"/>',
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const families = (p) => [...new Set(p.platforms.map((x) => PLATFORM_FAMILY[x] || x))];

function linkButton(link, i) {
  const icon = ICONS[link.kind] ? `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[link.kind]}</svg>` : "";
  return `<a class="btn${i === 0 ? " btn-primary" : ""}" href="${esc(link.url)}">${icon}${esc(link.label)}</a>`;
}

function card(p) {
  const icon = `<img class="app-icon" src="${esc(p.icon)}" alt="" width="64" height="64" loading="lazy">`;
  const body = `
    <div class="card-head">
      ${icon}
      <div class="card-title">
        <h3>${esc(p.name)}</h3>
        <p class="tagline">${esc(p.tagline)}</p>
      </div>
      <span class="status" data-status="${esc(p.status)}">${esc(STATUS_LABEL[p.status] || p.status)}</span>
    </div>
    <p class="desc">${esc(p.description)}</p>
    ${p.highlights?.length ? `<ul class="highlights">${p.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
    <div class="meta">
      ${p.platforms.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}
      ${p.stack ? `<span class="stack">${esc(p.stack)}</span>` : ""}
    </div>
    ${p.links?.length ? `<div class="actions">${p.links.map(linkButton).join("")}</div>` : ""}
    ${p.note ? `<p class="note">${esc(p.note)}</p>` : ""}`;

  const el = document.createElement("article");
  el.className = "card" + (p.featured ? " featured" : "");
  el.id = p.id;
  el.dataset.families = families(p).join(" ");
  if (p.accent) el.style.setProperty("--accent", p.accent);
  el.setAttribute("aria-label", p.name);
  el.innerHTML = p.featured
    ? `<div class="card-body">${body}</div><div class="featured-art"><img class="app-icon" src="${esc(p.icon)}" alt="${esc(p.name)} app icon" width="180" height="180"></div>`
    : body;
  return el;
}

function renderFilter(projects, grid) {
  const all = [...new Set(projects.flatMap(families))];
  const filter = document.getElementById("filter");
  if (all.length < 2) return filter.remove();
  const options = ["All", ...all];
  filter.innerHTML = options
    .map((f, i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-family="${esc(f)}">${esc(f)}</button>`)
    .join("");
  filter.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    filter.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b === btn)));
    const f = btn.dataset.family;
    grid.querySelectorAll(".card").forEach((c) => {
      c.hidden = f !== "All" && !c.dataset.families.split(" ").includes(f);
    });
  });
}

function renderMeta(projects) {
  const platforms = [...new Set(projects.flatMap((p) => p.platforms))];
  document.getElementById("hero-meta").innerHTML =
    `<b>${projects.length}</b> projects · ${platforms.map(esc).join(" · ")}`;
}

// Decorative contribution-style grid, seeded so it looks the same on every visit.
function renderHeat() {
  const svg = document.getElementById("heat");
  const cols = 27, rows = 7, step = 17.4, size = 14;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let out = "";
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const wave = Math.sin(c / 3.2 + r / 2.1) * 0.5 + 0.5;
      const level = Math.min(4, Math.floor((rand() * 0.65 + wave * 0.55) * 4.2));
      out += `<rect x="${(c * step).toFixed(1)}" y="${(r * step + 4).toFixed(1)}" width="${size}" height="${size}" rx="3" fill="var(--heat-${level})"/>`;
    }
  }
  svg.innerHTML = out;
}

async function main() {
  document.getElementById("year").textContent = new Date().getFullYear();
  renderHeat();
  const grid = document.getElementById("grid");
  try {
    const { projects } = await (await fetch("projects.json", { cache: "no-cache" })).json();
    grid.replaceChildren(...projects.map(card));
    renderFilter(projects, grid);
    renderMeta(projects);
  } catch {
    grid.innerHTML = '<p class="section-sub">Couldn\'t load the projects. Browse them on <a href="https://github.com/lilpatter">GitHub</a>.</p>';
  }
}

main();
