import {
  AGE_GROUPS,
  CATEGORIES,
  COMMUNITIES,
  DATE_FILTERS,
  SOURCE_LABELS,
  formatWhen,
  matchesFilters,
} from "../scripts/pure.mjs";
import { isPublicSubmission, reportHelp } from "../scripts/submissions.mjs";

const state = {
  tab: "whats-on",
  events: [],
  generatedAt: null,
  sources: [],
};

const filtersForm = document.querySelector("#filters");
const listings = document.querySelector("#listings");
const status = document.querySelector("#status");
const sourceLine = document.querySelector("#source-line");
const categoryField = document.querySelector("#category-field");

fillSelect(document.querySelector("#filter-age"), AGE_GROUPS, "Any age");
fillSelect(document.querySelector("#filter-community"), COMMUNITIES, "Any community");
fillSelect(document.querySelector("#filter-category"), CATEGORIES, "Any category");
fillSelect(document.querySelector("#filter-date"), DATE_FILTERS);

document.querySelector("#tab-whats-on").addEventListener("click", () => setTab("whats-on"));
document.querySelector("#tab-garage").addEventListener("click", () => setTab("garage"));
filtersForm.addEventListener("change", render);

load().catch((error) => {
  status.textContent = "The listings file could not be read.";
  listings.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = error.message;
  listings.append(empty);
});

async function load() {
  const [eventsResponse, submissionsResponse] = await Promise.all([
    fetch("data/events.json"),
    fetch("data/submissions.json"),
  ]);
  if (!eventsResponse.ok) throw new Error("data/events.json is missing.");
  const eventsPayload = await eventsResponse.json();
  const submissionsPayload = submissionsResponse.ok ? await submissionsResponse.json() : { items: [] };
  state.generatedAt = eventsPayload.generatedAt || null;
  state.sources = Array.isArray(eventsPayload.sources) ? eventsPayload.sources : [];
  state.events = [
    ...(Array.isArray(eventsPayload.events) ? eventsPayload.events : []),
    ...communitySubmissions(submissionsPayload),
  ];
  render();
}

function communitySubmissions(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.filter((item) => isPublicSubmission(item)).map((item) => ({
    id: item.id,
    kind: item.kind === "garage" || item.kind === "notice" ? item.kind : "event",
    title: item.title,
    start: item.start,
    end: item.end || null,
    allDay: Boolean(item.allDay),
    venue: item.venue || "",
    suburb: item.suburb || "",
    address: item.address || "",
    price: item.price || "See listing",
    ageGroups: item.ageGroups || ["families"],
    communities: item.communities || ["multicultural"],
    categories: item.categories || [],
    source: "submission",
    sourceUrl: item.sourceUrl || "share.html",
    items: item.items || "",
    summary: item.summary || "",
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
  const visible = state.events.filter((event) => matchesFilters(event, filters));
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
  sourceLine.textContent = sourceSummary();
}

function emptyState() {
  const box = document.createElement("div");
  box.className = "empty";
  const title = document.createElement("h2");
  title.textContent = state.tab === "garage" ? "No garage sales yet" : "Nothing coming up";
  const copy = document.createElement("p");
  copy.textContent = state.events.length
    ? "Try another date or clear a filter. Listings that have already finished stay hidden."
    : "The collector did not return any upcoming listings, and there are no community submissions yet.";
  const link = document.createElement("a");
  link.href = "share.html";
  link.textContent = "Share something happening in Toowoomba";
  box.append(title, copy, link);
  return box;
}

function card(event) {
  const article = document.createElement("article");
  article.className = "card";
  const chips = document.createElement("div");
  chips.className = "chips";
  for (const label of chipLabels(event)) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = label;
    chips.append(chip);
  }
  const title = document.createElement("h2");
  title.textContent = event.title;
  const when = document.createElement("p");
  when.className = "meta";
  when.textContent = formatWhen(event.start, event.end, event.allDay);
  const place = document.createElement("p");
  place.className = "meta";
  place.textContent = placeLine(event);
  article.append(chips, title, when, place);
  if (event.kind === "garage" && event.items) {
    const items = document.createElement("p");
    items.textContent = event.items;
    article.append(items);
  } else if (event.summary) {
    const summary = document.createElement("p");
    summary.textContent = event.summary;
    article.append(summary);
  }
  const price = document.createElement("p");
  price.className = `price${String(event.price).toLowerCase().startsWith("free") ? " free" : ""}`;
  price.textContent = event.price || "See listing";
  const link = document.createElement("a");
  link.className = "source-link";
  link.href = event.sourceUrl || "share.html";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = SOURCE_LABELS[event.source] || "Source";
  article.append(price, link);
  const report = reportControl(event);
  if (report) article.append(report);
  return article;
}

function reportControl(event) {
  if (!/^sub[a-f0-9]{16}$/.test(event.id || "")) return null;
  const details = document.createElement("details");
  details.className = "report";
  const summary = document.createElement("summary");
  summary.textContent = "Report";
  const form = document.createElement("form");
  form.className = "report-form";
  form.method = "POST";
  form.action = "https://formsubmit.co/whatsontoowoomba@agentmail.to";
  form.acceptCharset = "UTF-8";

  const trap = document.createElement("label");
  trap.className = "honey";
  trap.textContent = "Leave this empty";
  trap.setAttribute("aria-hidden", "true");
  const trapInput = document.createElement("input");
  trapInput.type = "text";
  trapInput.name = "hp_field";
  trapInput.tabIndex = -1;
  trapInput.autocomplete = "off";
  trapInput.setAttribute("aria-hidden", "true");
  const formHoney = document.createElement("input");
  formHoney.type = "text";
  formHoney.name = "_honey";
  formHoney.tabIndex = -1;
  formHoney.autocomplete = "off";
  formHoney.setAttribute("aria-hidden", "true");
  trap.append(trapInput, formHoney);

  const reasonLabel = document.createElement("label");
  reasonLabel.textContent = "Reason (optional)";
  const reason = document.createElement("textarea");
  reason.name = "reason";
  reason.maxLength = 500;
  reason.rows = 2;
  reasonLabel.append(reason);

  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent = reportHelp();

  const button = document.createElement("button");
  button.type = "submit";
  button.className = "btn";
  button.textContent = "Report this listing";

  const next = hiddenInput("_next", "");
  form.addEventListener("submit", () => {
    next.value = new URL("thanks.html?reported=1", window.location.href).href;
  });
  form.append(
    trap,
    hiddenInput("listing_id", event.id),
    hiddenInput("listing_title", event.title),
    hiddenInput("_subject", `What's On Toowoomba FLAG: ${event.id}`),
    hiddenInput("_template", "table"),
    hiddenInput("_captcha", "true"),
    next,
    reasonLabel,
    note,
    button,
  );
  details.append(summary, form);
  return details;
}

function hiddenInput(name, value) {
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = name;
  input.value = value;
  return input;
}

function chipLabels(event) {
  const labels = [];
  const ages = AGE_GROUPS.filter(([id]) => (event.ageGroups || []).includes(id) && id !== "families");
  const shownAges = ages.length ? ages : AGE_GROUPS.filter(([id]) => (event.ageGroups || []).includes(id));
  for (const [, label] of shownAges.slice(0, 2)) labels.push(label);
  for (const [id, label] of COMMUNITIES) {
    if (id !== "multicultural" && (event.communities || []).includes(id)) labels.push(label);
  }
  for (const [id, label] of CATEGORIES) {
    if (id !== "free" && (event.categories || []).includes(id)) labels.push(label);
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
