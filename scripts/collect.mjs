/**
 * Fetch public Toowoomba listings and write data/events.json.
 * One source failing does not fail the run. Listings are not invented.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCouncilPage,
  parseGarageSales,
  parseMalayaliEvents,
  parseTimsEvents,
} from "./parse.mjs";
import { generateSite } from "./pages.mjs";
import {
  dedupeListings,
  cityBeforeState,
  inToowoombaRegion,
  isPast,
  priceLabel,
  robotsAllows,
  robotsCrawlDelay,
  tagListing,
  TIMEZONE,
} from "./pure.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVENTS_PATH = path.join(ROOT, "data", "events.json");
const UA = "WhatsOnToowoombaCollector/1.0 (+https://github.com/Aneesh15here/toowoomba-whats-on; public events index; respects robots.txt)";

const COUNCIL_INDEX = "https://www.tr.qld.gov.au/Places-and-activities/Things-to-see-and-do/Events-and-special-days";
const LIBRARY_INDEX = "https://www.tr.qld.gov.au/Places-and-activities/Libraries/Library-programs-and-events";
const LIBRARY_PAGES = [
  LIBRARY_INDEX,
  "https://www.tr.qld.gov.au/Places-and-activities/Libraries/Library-programs-and-events/Whats-on-in-our-libraries",
  "https://www.tr.qld.gov.au/Places-and-activities/Libraries/Library-programs-and-events/First-5-Forever-and-0-5-year-sessions",
];
const VISIT_URL = "https://visit.tr.qld.gov.au/searches/none/none/none/events/date/all/none/none/none/false";
const EVENTBRITE_URL = "https://www.eventbrite.com.au/d/australia--toowoomba/all-events/";
const HUMANITIX_URL = "https://humanitix.com/au/search/australia/toowoomba";
const TIMS_URL = "https://www.tims.org.au/events";
const MALAYALI_URL = "https://toowoombamalayali.org/events";
const GARAGE_URL = "https://www.buysearchsell.com.au/toowoomba/buy-sell/garage-sales/";
const GUMTREE_URL = "https://www.gumtree.com.au/s-garage-sale/toowoomba/k0c18397l3005921";

const EVENTBRITE_CATEGORIES = {
  music: ["music"],
  "sports-and-fitness": ["sport"],
  "performing-and-visual-arts": ["arts"],
  spirituality: ["faith"],
  "family-and-education": ["education"],
  "school-activities": ["education"],
  "auto-boat-and-air": ["sport"],
};

const robotsCache = new Map();
const nextRequestAt = new Map();

class SourceSkip extends Error {
  constructor(message) {
    super(message);
    this.skipped = true;
  }
}

async function main() {
  const previous = await readPrevious();
  const now = new Date();
  const jobs = [
    ["council", () => collectCouncil(now)],
    ["library", () => collectLibrary(now)],
    ["eventbrite", () => collectEventbrite(now)],
    ["humanitix", () => collectHumanitix(now)],
    ["multicultural", () => collectMulticultural()],
    ["garage", () => collectGarage()],
  ];
  const reports = [];
  for (const [id, run] of jobs) {
    reports.push(await runSource(id, run, previous, now));
  }
  const events = dedupeListings(reports.flatMap((report) => report.events))
    .filter((event) => event.start && !isPast(event, now))
    .map(publicEvent);
  const payload = {
    generatedAt: now.toISOString(),
    timezone: TIMEZONE,
    sources: reports.map((report) => ({
      id: report.id,
      ok: report.ok,
      parsed: report.parsed,
      kept: report.events.length,
      error: report.error,
      notes: report.notes,
    })),
    events,
  };
  const changed = await writeIfChanged(payload);
  const pages = await generateSite({ now });
  for (const report of reports) {
    const status = report.ok ? "ok" : "failed";
    console.log(
      `${report.id}: ${status}, parsed ${report.parsed}, kept ${report.events.length}${report.error ? `, error: ${report.error}` : ""}`,
    );
    for (const note of report.notes) console.log(`  - ${note}`);
  }
  console.log(`events.json ${changed ? "updated" : "unchanged"} with ${events.length} upcoming listings`);
  console.log(`pages: wrote ${pages.written} files, removed ${pages.removed}, events ${pages.events}, places ${pages.places}`);
}

async function runSource(id, run, previous, now) {
  try {
    const result = await run();
    const events = dedupeListings(result.events).filter((event) => !isPast(event, now));
    return {
      id,
      ok: true,
      parsed: result.parsed,
      events,
      error: null,
      notes: result.notes || [],
    };
  } catch (error) {
    if (error.skipped) {
      return { id, ok: true, parsed: 0, events: [], error: null, notes: [error.message] };
    }
    const kept = previous.filter((event) => event.source === id && !isPast(event, now));
    console.error(`${id} failed: ${error.message}`);
    return {
      id,
      ok: false,
      parsed: 0,
      events: kept,
      error: error.message,
      notes: kept.length ? [`Kept ${kept.length} earlier listing(s) from this source.`] : [],
    };
  }
}

async function collectCouncil(now) {
  const notes = [];
  try {
    const visit = await fetchText(VISIT_URL);
    if (!visit.ok || /blocked/i.test(visit.text.slice(0, 300))) {
      notes.push("visit.tr.qld.gov.au did not return a listings page from this network.");
    } else {
      notes.push("visit.tr.qld.gov.au responded, but this collector reads dated council pages on tr.qld.gov.au.");
    }
  } catch (error) {
    notes.push(`visit.tr.qld.gov.au skipped: ${error.message}`);
  }
  const pages = await crawlSection(COUNCIL_INDEX, "/Events-and-special-days", notes);
  const events = [];
  for (const page of pages) {
    events.push(...parseCouncilPage(page.text, page.url, now).map((event) => ({ ...event, source: "council" })));
  }
  return { parsed: events.length, events, notes };
}

async function collectLibrary(now) {
  const notes = [
    "The Spydus library catalogue disallows robots, so session dates are read from council program pages.",
  ];
  const pages = await crawlSection(LIBRARY_INDEX, "/Library-programs-and-events", notes, LIBRARY_PAGES);
  const events = [];
  for (const page of pages) {
    events.push(...parseCouncilPage(page.text, page.url, now).map((event) => ({ ...event, source: "library" })));
  }
  return { parsed: events.length, events, notes };
}

async function collectEventbrite() {
  const notes = [
    "Reads the public Toowoomba destination page. The disallowed /api/v3/destination/events/ path is not requested.",
  ];
  const events = [];
  let parsed = 0;
  for (let page = 1; page <= 4; page += 1) {
    const url = page === 1 ? EVENTBRITE_URL : `${EVENTBRITE_URL}?page=${page}`;
    const response = await fetchText(url);
    if (!response.ok) throw new Error(`Eventbrite HTTP ${response.status}`);
    const data = readServerData(response.text);
    const results = data?.search_data?.events?.results || [];
    const pageCount = data?.search_data?.events?.pagination?.page_count || page;
    parsed += results.length;
    const cards = eventbriteCards(response.text);
    for (const item of results) {
      const normalised = normaliseEventbrite(item, cards.get(String(item.id)) || {});
      if (normalised) events.push(normalised);
    }
    if (page >= pageCount || results.length === 0) break;
  }
  notes.push("Stopped after at most 4 public result pages.");
  return { parsed, events, notes };
}

async function collectHumanitix() {
  const response = await fetchText(HUMANITIX_URL);
  if (!response.ok) throw new Error(`Humanitix HTTP ${response.status}`);
  const match = response.text.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Humanitix page had no event data");
  const data = JSON.parse(match[1]);
  const initial = data?.props?.pageProps?.initialEvents;
  if (!Array.isArray(initial)) throw new Error("Humanitix page had no initialEvents");
  const events = [];
  for (const item of initial) events.push(...normaliseHumanitix(item));
  return {
    parsed: initial.length,
    events,
    notes: ["Uses the public Australia/Toowoomba search page."],
  };
}

async function collectMulticultural() {
  const notes = [];
  const events = [];
  let parsed = 0;
  const tims = await fetchText(TIMS_URL).catch((error) => {
    notes.push(`TIMS skipped: ${error.message}`);
    return null;
  });
  if (tims?.ok) {
    const found = parseTimsEvents(tims.text, TIMS_URL);
    parsed += found.length;
    events.push(...found);
  } else if (tims) {
    notes.push(`TIMS HTTP ${tims.status}`);
  }
  const malayali = await fetchText(MALAYALI_URL).catch((error) => {
    notes.push(`Toowoomba Malayali Association skipped: ${error.message}`);
    return null;
  });
  if (malayali?.ok) {
    const found = parseMalayaliEvents(malayali.text, MALAYALI_URL);
    parsed += found.length;
    events.push(...found);
  } else if (malayali) {
    notes.push(`Toowoomba Malayali Association HTTP ${malayali.status}`);
  }
  if (!tims?.ok && !malayali?.ok) {
    throw new Error(notes.join(" ") || "Multicultural pages were unavailable");
  }
  return { parsed, events, notes };
}

async function collectGarage() {
  const notes = [
    "Facebook and Instagram are not fetched. List those sales through the share form.",
  ];
  try {
    const gumtree = await fetchText(GUMTREE_URL);
    notes.push(gumtree.ok
      ? "Gumtree responded, but listings are left for the share form unless a stable public feed is allowed."
      : `Gumtree HTTP ${gumtree.status}; not parsed.`);
  } catch (error) {
    notes.push(`Gumtree not used: ${error.message}`);
  }
  const response = await fetchText(GARAGE_URL);
  if (!response.ok) throw new Error(`Garage sale listing HTTP ${response.status}`);
  const events = parseGarageSales(response.text, GARAGE_URL);
  return {
    parsed: events.length,
    events,
    notes,
  };
}

async function crawlSection(indexUrl, pathPart, notes, seeds = []) {
  const index = await fetchText(indexUrl);
  if (!index.ok) throw new Error(`${indexUrl} HTTP ${index.status}`);
  const urls = new Set([indexUrl, ...seeds]);
  for (const link of discoverLinks(index.text, pathPart)) urls.add(link);
  const pages = [];
  for (const url of [...urls].slice(0, 16)) {
    try {
      const page = url === indexUrl ? index : await fetchText(url);
      if (!page.ok) {
        notes.push(`${url} HTTP ${page.status}`);
        continue;
      }
      pages.push({ url, text: page.text });
    } catch (error) {
      if (error.skipped) notes.push(`${url} skipped: ${error.message}`);
      else notes.push(`${url} failed: ${error.message}`);
    }
  }
  return pages;
}

function discoverLinks(html, pathPart) {
  const links = new Set();
  for (const match of String(html).matchAll(/href="(https:\/\/www\.tr\.qld\.gov\.au\/[^"#?]+)"/gi)) {
    if (match[1].includes(pathPart)) links.add(match[1]);
  }
  return links;
}

function normaliseEventbrite(event, card) {
  if (!event || event.is_online_event || event.is_cancelled) return null;
  const venue = event.primary_venue || {};
  const address = venue.address || {};
  const place = [venue.name, address.address_1, address.city, address.region, address.postal_code]
    .filter(Boolean)
    .join(", ");
  const cityFocus = [address.city, address.region, address.postal_code].filter(Boolean).join(" ");
  if (cityFocus) {
    if (!inToowoombaRegion([cityFocus])) return null;
  } else if (!inToowoombaRegion([venue.name, place])) return null;
  const start = zonedIso(event.start_date, event.start_time, event.timezone);
  if (!start) return null;
  const end = event.end_date && event.end_time
    ? zonedIso(event.end_date, event.end_time, event.timezone)
    : null;
  const price = card.status === "free" ? "Free" : card.status === "paid" ? "Paid" : "See listing";
  const listing = {
    kind: "event",
    title: String(event.name || "").trim(),
    start: start.iso,
    end: end?.iso || null,
    allDay: start.allDay,
    venue: venue.name || place || "Toowoomba",
    suburb: address.city || "",
    address: place,
    price,
    summary: String(event.summary || "").slice(0, 280),
    source: "eventbrite",
    sourceUrl: event.url,
    rawCategory: card.category || "",
    extraCategories: EVENTBRITE_CATEGORIES[card.category] || [],
  };
  return { ...listing, ...tagListing(listing) };
}

function normaliseHumanitix(event) {
  if (!event || /^\s*cancelled\b/i.test(event.name || "")) return [];
  const location = event.eventLocation || {};
  if (location.type === "online") return [];
  const venue = location.venueName || "";
  const address = location.address || "";
  if (address) {
    const city = cityBeforeState(address);
    if (!inToowoombaRegion([city || address])) return [];
  } else if (!inToowoombaRegion([event.name, venue])) return [];
  const pricing = event.pricing || {};
  const dates = Array.isArray(event.dates) && event.dates.length ? event.dates : [event.date].filter(Boolean);
  const listings = [];
  for (const date of dates.slice(0, 8)) {
    const start = date?.startDate ? new Date(date.startDate) : null;
    if (!start || Number.isNaN(start.getTime())) continue;
    const end = date?.endDate ? new Date(date.endDate) : null;
    const listing = {
      kind: "event",
      title: String(event.name || "").trim(),
      start: toBrisbaneIso(start),
      end: end && !Number.isNaN(end.getTime()) ? toBrisbaneIso(end) : null,
      allDay: false,
      venue: venue || (address ? address : "To be announced, Toowoomba"),
      suburb: suburbFromAddress(address),
      address: address || venue || "Toowoomba",
      price: priceLabel(pricing.minimumPrice, pricing.maximumPrice),
      summary: "",
      source: "humanitix",
      sourceUrl: event.slug ? `https://events.humanitix.com/${event.slug}` : HUMANITIX_URL,
    };
    listings.push({ ...listing, ...tagListing(listing) });
  }
  return listings;
}

function eventbriteCards(html) {
  const map = new Map();
  for (const tag of String(html).matchAll(/<a\b[^>]*class="[^"]*event-card-link[^"]*"[^>]*>/gi)) {
    const id = tag[0].match(/data-event-id="(\d+)"/);
    if (!id) continue;
    map.set(id[1], {
      status: (tag[0].match(/data-event-paid-status="([^"]+)"/) || [])[1] || "",
      category: (tag[0].match(/data-event-category="([^"]+)"/) || [])[1] || "",
    });
  }
  return map;
}

function readServerData(html) {
  const marker = "window.__SERVER_DATA__ = ";
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("Eventbrite page had no event data");
  const slice = html.slice(start + marker.length);
  return JSON.parse(slice.slice(0, jsonEnd(slice)));
}

function jsonEnd(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("Eventbrite event data was incomplete");
}

function zonedIso(date, time, timeZone) {
  if (!date) return null;
  if (!time) {
    const [year, month, day] = date.split("-").map(Number);
    return { iso: `${date}T00:00:00+10:00`, allDay: true, year, month, day };
  }
  const instant = wallTimeToUtc(date, time, timeZone || TIMEZONE);
  return { iso: toBrisbaneIso(instant), allDay: false };
}

function wallTimeToUtc(date, time, timeZone) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utc = Date.UTC(year, month - 1, day, hour || 0, minute || 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utc));
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  const zoned = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
  return new Date(utc - (zoned - utc));
}

function toBrisbaneIso(date) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${day}T${time}:00+10:00`;
}

function suburbFromAddress(address) {
  const match = String(address || "").match(/,\s*([^,]+?)\s+QLD\b/i);
  return match ? match[1] : "";
}

async function fetchText(url) {
  const permission = await fetchPermission(url);
  if (!permission.ok) throw new SourceSkip(permission.reason);
  const host = new URL(url).host;
  const wait = (nextRequestAt.get(host) || 0) - Date.now();
  if (wait > 0) await sleep(wait);
  nextRequestAt.set(host, Date.now() + Math.max(permission.delay, 1) * 1000);
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(25000),
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "accept-language": "en-AU,en;q=0.9",
    },
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, url: response.url, text };
}

async function fetchPermission(url) {
  const target = new URL(url);
  if (/(^|\.)facebook\.com$|(^|\.)instagram\.com$|(^|\.)fb\.com$/i.test(target.hostname)) {
    return { ok: false, reason: "Facebook and Instagram are not fetched" };
  }
  let robots = robotsCache.get(target.origin);
  if (robots === undefined) {
    try {
      const response = await fetch(`${target.origin}/robots.txt`, {
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
        headers: { "user-agent": UA, accept: "text/plain,*/*" },
      });
      robots = response.ok ? await response.text() : null;
    } catch {
      robots = null;
    }
    robotsCache.set(target.origin, robots);
  }
  if (!robots || !/user-agent\s*:/i.test(robots)) {
    return { ok: false, reason: `robots.txt for ${target.origin} was not readable` };
  }
  const pathAndQuery = `${target.pathname}${target.search}`;
  if (!robotsAllows(robots, pathAndQuery)) {
    return { ok: false, reason: `robots.txt disallows ${pathAndQuery}` };
  }
  return { ok: true, delay: robotsCrawlDelay(robots) };
}

async function readPrevious() {
  try {
    const parsed = JSON.parse(await readFile(EVENTS_PATH, "utf8"));
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

async function writeIfChanged(payload) {
  const nextEvents = JSON.stringify(payload.events);
  let previousEvents = null;
  try {
    const existing = JSON.parse(await readFile(EVENTS_PATH, "utf8"));
    previousEvents = JSON.stringify(existing.events || []);
  } catch {
    previousEvents = null;
  }
  if (previousEvents === nextEvents) return false;
  await writeFile(EVENTS_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  return true;
}

function publicEvent(event) {
  const output = {
    id: event.id,
    kind: event.kind,
    title: event.title,
    start: event.start,
    end: event.end || null,
    allDay: Boolean(event.allDay),
    venue: event.venue || "",
    suburb: event.suburb || "",
    address: event.address || "",
    price: event.price || "See listing",
    ageGroups: event.ageGroups || [],
    communities: event.communities || [],
    categories: event.categories || [],
    source: event.source,
    sourceUrl: event.sourceUrl,
  };
  if (event.summary) output.summary = event.summary;
  if (event.items) output.items = event.items;
  if (event.alsoFrom?.length) output.alsoFrom = event.alsoFrom;
  return output;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
