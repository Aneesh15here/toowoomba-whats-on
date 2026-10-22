import { outboundEventPath } from "../scripts/analytics.mjs";
import {
  AGE_GROUPS,
  CATEGORIES,
  COMMUNITIES,
  DATE_FILTERS,
  SOURCE_LABELS,
  formatWhen,
  matchesFilters,
} from "../scripts/pure.mjs";

const state = {
  tab: "whats-on",
  events: [],
  generatedAt: null,
  sources: [],
};

function listingHref(event) {
  if (event.pagePath) return event.pagePath;
  if (event.id) return `/events/${event.id}/`;
  return "";
}

const filtersForm = document.querySelector("#filters");
const listings = document.querySelector("#listings");
const status = document.querySelector("#status");
const sourceLine = document.querySelector("#source-line");
const categoryField = document.querySelector("#category-field");
const searchInput = document.querySelector("#filter-search");
const weekendSection = document.querySelector("#weekend");
const weekendRow = document.querySelector("#weekend-row");
const garageBanner = document.querySelector("#garage-banner");

fillSelect(document.querySelector("#filter-age"), AGE_GROUPS, "Any age");
fillSelect(document.querySelector("#filter-community"), COMMUNITIES, "Any community");
fillSelect(document.querySelector("#filter-category"), CATEGORIES, "Any category");
fillSelect(document.querySelector("#filter-date"), DATE_FILTERS);

document.querySelector("#tab-whats-on").addEventListener("click", () => setTab("whats-on"));
document.querySelector("#tab-garage").addEventListener("click", () => setTab("garage"));
filtersForm.addEventListener("change", render);
filtersForm.addEventListener("submit", (event) => event.preventDefault());
searchInput?.addEventListener("input", render);

for (const button of document.querySelectorAll("[data-date]")) {
  button.addEventListener("click", () => {
    filtersForm.date.value = button.dataset.date;
    filtersForm.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

load().catch((error) => {
  status.textContent = "The listings file could not be read.";
  listings.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = error.message;
  listings.append(empty);
});

async function load() {
  const [eventsResponse, submissionsResponse, occurrencesResponse] = await Promise.all([
    fetch("data/events.json"),
    fetch("data/submissions.json"),
    fetch("data/occurrences.json"),
  ]);
  if (!eventsResponse.ok) throw new Error("data/events.json is missing.");
  const eventsPayload = await eventsResponse.json();
  const submissionsPayload = submissionsResponse.ok ? await submissionsResponse.json() : { items: [] };
  const occurrencesPayload = occurrencesResponse.ok ? await occurrencesResponse.json() : { events: [] };
  state.generatedAt = eventsPayload.generatedAt || null;
  state.sources = Array.isArray(eventsPayload.sources) ? eventsPayload.sources : [];
  state.events = [
    ...(Array.isArray(eventsPayload.events) ? eventsPayload.events : []),
    ...approvedSubmissions(submissionsPayload),
    ...(Array.isArray(occurrencesPayload.events) ? occurrencesPayload.events : []),
  ].sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.title).localeCompare(String(b.title)));
  render();
}

function approvedSubmissions(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .filter((item) => item && item.status === "approved" && item.title && item.start)
    .map((item) => ({
      ...item,
      kind: item.kind === "garage" || item.kind === "notice" ? item.kind : "event",
      source: "submission",
      sourceUrl: item.sourceUrl || "share.html",
      allDay: Boolean(item.allDay),
      ageGroups: item.ageGroups || ["families"],
      communities: item.communities || ["multicultural"],
      categories: item.categories || [],
      price: item.price || "See listing",
    }));
}

function setTab(tab) {
  state.tab = tab;
  document.querySelector("#tab-whats-on").setAttribute("aria-selected", String(tab === "whats-on"));
  document.querySelector("#tab-garage").setAttribute("aria-selected", String(tab === "garage"));
  categoryField.hidden = tab === "garage";
  render();
}

function render() {
  const filters = {
    tab: state.tab,
    age: filtersForm.age.value,
    community: filtersForm.community.value,
    category: filtersForm.category.value,
    date: filtersForm.date.value,
  };
  const query = (searchInput?.value || "").trim().toLowerCase();
  const visible = state.events.filter((event) => matchesFilters(event, filters) && matchesQuery(event, query));
  const noun = state.tab === "garage" ? "garage sale" : "listing";
  status.textContent = visible.length
    ? `${visible.length} ${noun}${visible.length === 1 ? "" : "s"}`
    : `No ${noun}s match these filters.`;
  listings.replaceChildren();
  if (!visible.length) {
    listings.append(emptyState());
  } else {
    for (const event of visible) listings.append(card(event));
  }
  renderWeekend(filters, query);
  if (garageBanner) garageBanner.hidden = state.tab !== "garage";
  hydratePictures();
  syncDateChips(filters.date);
  sourceLine.textContent = sourceSummary();
}

function renderWeekend(filters, query) {
  if (!weekendSection || !weekendRow) return;
  const events = state.tab === "garage" || filters.date
    ? []
    : state.events.filter((event) => matchesFilters(event, { ...filters, tab: "whats-on", date: "weekend" }) && matchesQuery(event, query));
  weekendSection.hidden = events.length === 0;
  weekendRow.replaceChildren();
  for (const event of events) weekendRow.append(card(event));
}

function hydratePictures() {
  for (const picture of document.querySelectorAll("picture[data-hydrate]")) {
    const mode = picture.dataset.hydrate;
    if (mode === "garage" && state.tab !== "garage") continue;
    if (picture.dataset.hydrated === "true") continue;
    const source = picture.querySelector("source");
    const image = picture.querySelector("img");
    if (source?.dataset.srcset) source.srcset = source.dataset.srcset;
    if (image?.dataset.src) image.src = image.dataset.src;
    picture.dataset.hydrated = "true";
  }
}

function syncDateChips(value) {
  for (const button of document.querySelectorAll("[data-date]")) {
    button.setAttribute("aria-pressed", String(button.dataset.date === value));
  }
}

function matchesQuery(event, query) {
  if (!query) return true;
  const haystack = [event.title, event.venue, event.suburb, event.address, event.summary, event.items]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

function emptyState() {
  const box = document.createElement("div");
  box.className = "empty";
  const title = document.createElement("h2");
  title.textContent = state.tab === "garage" ? "No garage sales yet" : "Nothing coming up";
  const copy = document.createElement("p");
  copy.textContent = state.events.length
    ? "Try another date or clear a filter. Listings that have already finished stay hidden."
    : "The collector did not return any upcoming listings, and there are no approved submissions yet.";
  const link = document.createElement("a");
  link.href = "/share.html";
  link.textContent = "Share something happening in Toowoomba";
  box.append(title, copy, link);
  return box;
}

function card(event) {
  const article = document.createElement("article");
  article.className = "card";
  const body = document.createElement("div");
  body.className = "card-body";
  const chips = document.createElement("div");
  chips.className = "chips";
  for (const item of chipLabels(event)) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.dataset.tone = item.tone;
    chip.textContent = item.label;
    chips.append(chip);
  }
  const title = document.createElement("h2");
  const href = listingHref(event);
  if (href) {
    const titleLink = document.createElement("a");
    titleLink.href = href;
    titleLink.textContent = event.title;
    title.append(titleLink);
  } else {
    title.textContent = event.title;
  }
  const when = document.createElement("p");
  when.className = "meta";
  const time = document.createElement("time");
  time.dateTime = event.start;
  time.textContent = formatWhen(event.start, event.end, event.allDay);
  when.append(time);
  const place = document.createElement("p");
  place.className = "meta";
  place.textContent = placeLine(event);
  body.append(chips, title, when, place);
  if (event.kind === "garage" && event.items) {
    const items = document.createElement("p");
    items.className = "summary";
    items.textContent = event.items;
    body.append(items);
  } else if (event.summary) {
    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = event.summary;
    body.append(summary);
  }
  const foot = document.createElement("div");
  foot.className = "card-foot";
  const price = document.createElement("p");
  price.className = `price${String(event.price).toLowerCase().startsWith("free") ? " free" : ""}`;
  price.textContent = event.price || "See listing";
  const link = document.createElement("a");
  link.className = "source-link";
  const sourceHref = event.sourceUrl || "share.html";
  link.href = sourceHref;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const outbound = outboundEventPath(sourceHref);
  if (outbound) {
    link.dataset.track = outbound;
    link.dataset.trackTitle = "Outbound event link";
  }
  link.textContent = SOURCE_LABELS[event.source] || "Source";
  const hint = document.createElement("span");
  hint.className = "sr-only";
  hint.textContent = " (opens in a new tab)";
  link.append(hint);
  foot.append(price, link);
  body.append(foot);
  article.append(cardMedia(event), body);
  return article;
}

function cardMedia(event) {
  const src = localImage(event);
  if (!src) return placeholder(event);
  const figure = document.createElement("div");
  figure.className = "card-media";
  const image = document.createElement("img");
  image.src = src;
  image.alt = "";
  image.width = 800;
  image.height = 450;
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("error", () => {
    figure.replaceWith(placeholder(event));
  });
  figure.append(image);
  return figure;
}

function localImage(event) {
  const src = typeof event.image === "string" ? event.image : event.imageUrl;
  if (typeof src !== "string") return "";
  if (!src.startsWith("assets/img/") || src.includes("..")) return "";
  return src;
}

function placeholder(event) {
  const figure = document.createElement("div");
  const tone = primaryCategory(event);
  figure.className = "card-media card-media-placeholder";
  figure.dataset.tone = tone;
  figure.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "card-media-label";
  label.textContent = categoryName(tone);
  figure.append(label);
  return figure;
}

function primaryCategory(event) {
  if (event.kind === "garage") return "garage";
  const categories = event.categories || [];
  return categories.find((id) => id !== "free") || categories[0] || "general";
}

function categoryName(id) {
  const match = CATEGORIES.find(([value]) => value === id);
  if (match) return match[1];
  if (id === "general") return "What's on";
  return "Listing";
}

function chipLabels(event) {
  const labels = [];
  const ages = AGE_GROUPS.filter(([id]) => (event.ageGroups || []).includes(id) && id !== "families");
  const shownAges = ages.length ? ages : AGE_GROUPS.filter(([id]) => (event.ageGroups || []).includes(id));
  for (const [, label] of shownAges.slice(0, 2)) labels.push({ tone: "age", label });
  for (const [id, label] of COMMUNITIES) {
    if (id !== "multicultural" && (event.communities || []).includes(id)) labels.push({ tone: "community", label });
  }
  for (const [id, label] of CATEGORIES) {
    if (id !== "free" && (event.categories || []).includes(id)) labels.push({ tone: id, label });
  }
  return labels.slice(0, 4);
}

function placeLine(event) {
  const parts = [event.venue, event.suburb, event.address].filter(Boolean);
  return [...new Set(parts)].join(" · ");
}

function sourceSummary() {
  if (!state.sources.length) return "";
  const bits = state.sources.map((source) => `${source.id} ${source.kept ?? 0}`);
  const when = state.generatedAt
    ? new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Brisbane",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(state.generatedAt))
    : "not yet";
  return `Last collect ${when} Brisbane. Kept by source: ${bits.join(", ")}.`;
}

function fillSelect(select, options, anyLabel) {
  if (anyLabel && options[0]?.[0] !== "") {
    const any = document.createElement("option");
    any.value = "";
    any.textContent = anyLabel;
    select.append(any);
  }
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}
