(function filterSearch() {
  const params = new URLSearchParams(window.location.search);
  const query = (params.get("q") || "").trim();
  const input = document.querySelector("#q");
  const status = document.querySelector("#search-status");
  if (input && query) input.value = query;
  if (!query || !status) return;

  const needle = query.toLowerCase();
  let shown = 0;
  for (const item of document.querySelectorAll("[data-search]")) {
    const hit = (item.dataset.search || "").includes(needle);
    item.hidden = !hit;
    if (hit) shown += 1;
  }
  status.textContent = shown
    ? `${shown} listing${shown === 1 ? "" : "s"} match “${query}”.`
    : `No listings match “${query}”.`;
}());
