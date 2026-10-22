const preview = document.querySelector("[data-things='preview']");
const full = document.querySelector("[data-things='full']");
const chipRow = document.querySelector("[data-things-chips]");
const status = document.querySelector("#thing-status");

if (preview || full) {
  loadThings().catch((error) => {
    const target = full || preview;
    target.replaceChildren();
    const note = document.createElement("p");
    note.textContent = error.message;
    target.append(note);
  });
}

async function loadThings() {
  const response = await fetch("data/things-to-do.json");
  if (!response.ok) throw new Error("data/things-to-do.json is missing.");
  const data = await response.json();
  const types = Array.isArray(data.types) ? data.types : [];
  const places = Array.isArray(data.places) ? data.places : [];
  const labels = new Map(types.map((type) => [type.id, type.label]));
  const known = new Set(labels.keys());
  const usable = places.filter((place) => place && place.name && place.url && known.has(place.type));
  if (chipRow) renderChipLinks(types);
  if (preview) renderPreview(preview, usable, labels);
  if (full) renderFull(full, types, usable, labels);
}

function renderChipLinks(types) {
  chipRow.replaceChildren();
  for (const type of types) {
    const link = document.createElement("a");
    link.href = `things-to-do.html#${type.id}`;
    link.className = "chip chip-link";
    link.dataset.tone = type.id;
    link.textContent = type.label;
    chipRow.append(link);
  }
}

function renderPreview(mount, places, labels) {
  const featured = places.filter((place) => place.featured);
  const shown = (featured.length ? featured : places).slice(0, 4);
  mount.replaceChildren();
  for (const place of shown) mount.append(placeCard(place, labels));
}

function renderFull(mount, types, places, labels) {
  const filters = document.querySelector("#thing-filters");
  let active = typeFromHash(types);

  function draw() {
    mount.replaceChildren();
    const visibleTypes = active ? types.filter((type) => type.id === active) : types;
    let count = 0;
    for (const type of visibleTypes) {
      const matching = places.filter((place) => active ? (place.types || [place.type]).includes(active) : place.type === type.id);
      if (!matching.length) continue;
      count += matching.length;
      const section = document.createElement("section");
      section.className = "things-group";
      const heading = document.createElement("h2");
      heading.id = type.id;
      heading.textContent = type.label;
      const grid = document.createElement("div");
      grid.className = "things-grid";
      for (const place of matching) grid.append(placeCard(place, labels, active || type.id));
      section.append(heading, grid);
      mount.append(section);
    }
    if (status) {
      status.textContent = count
        ? `${count} place${count === 1 ? "" : "s"}`
        : "Nothing is listed for this type yet.";
    }
    syncFilters();
  }

  function syncFilters() {
    if (!filters) return;
    for (const button of filters.querySelectorAll("[data-type]")) {
      button.setAttribute("aria-pressed", String(button.dataset.type === active));
    }
  }

  if (filters) {
    filters.replaceChildren();
    filters.append(filterButton("", "All"));
    for (const type of types) filters.append(filterButton(type.id, type.label));
    filters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-type]");
      if (!button) return;
      active = button.dataset.type;
      const next = active ? `#${active}` : location.pathname;
      history.replaceState(null, "", next);
      draw();
    });
  }

  window.addEventListener("hashchange", () => {
    active = typeFromHash(types);
    draw();
  });
  draw();
}

function filterButton(id, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.type = id;
  button.textContent = label;
  if (id) button.dataset.tone = id;
  return button;
}

function typeFromHash(types) {
  const id = location.hash.replace(/^#/, "");
  return types.some((type) => type.id === id) ? id : "";
}

function placeCard(place, labels, tone) {
  const article = document.createElement("article");
  article.className = "thing-card";
  article.dataset.tone = tone || place.type;
  const chip = document.createElement("p");
  chip.className = "chip";
  chip.dataset.tone = place.type;
  chip.textContent = labels.get(place.type) || "Things to do";
  const title = document.createElement("h3");
  const titleLink = document.createElement("a");
  titleLink.href = `/things-to-do/${place.id}/`;
  titleLink.textContent = place.name;
  title.append(titleLink);
  const area = document.createElement("p");
  area.className = "meta";
  area.textContent = place.area || "";
  const summary = document.createElement("p");
  summary.className = "summary";
  summary.textContent = place.summary || "";
  const link = document.createElement("a");
  link.className = "source-link";
  link.href = place.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = place.source || "Official page";
  const hint = document.createElement("span");
  hint.className = "sr-only";
  hint.textContent = " (opens in a new tab)";
  link.append(hint);
  article.append(chip, title, area, summary, link);
  return article;
}
