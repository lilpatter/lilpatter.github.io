// Pages are pre-built by build.mjs. This only adds the bar's scroll state and the platform filter.

function watchBar() {
  const bar = document.getElementById("bar");
  const title = document.querySelector("#page-title, #app-title");
  if (!bar || !title) return;
  new IntersectionObserver(([entry]) => bar.classList.toggle("is-scrolled", !entry.isIntersecting), {
    rootMargin: "-52px 0px 0px 0px",
  }).observe(title);
}

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
    document.querySelectorAll("#app-list > li").forEach((li) => {
      li.hidden = f !== "All" && !li.dataset.families.split(" ").includes(f);
    });
  });
}

watchBar();
wireFilter();
