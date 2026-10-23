/**
 * Fetch public Toowoomba listings and write data/events.json.
 * One source failing does not fail the run. Listings are not invented.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCouncilPage,
  parseEmpireEvents,
  parseGarageSales,
  parseMalayaliEvents,
  parseEventbriteEvents,
  parseMeetupEvents,
  parseMoshtixEvents,
  parseTimsEvents,
  parseUnisqEvents,
  parseUnisqFeed,
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
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BROWSER_HEADERS = {
  "user-agent": BROWSER_UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "en-AU,en;q=0.9",
  "upgrade-insecure-requests": "1",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
};
const COUNCIL_FETCH = { headers: BROWSER_HEADERS, retryOn: [403, 409, 429] };

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
const MEETUP_URL = "https://www.meetup.com/find/au--toowoomba/";
const EMPIRE_URL = "https://www.empiretheatre.com.au/whats-on";
const MOSHTIX_URL = "https://www.moshtix.com.au/v2/search?query=toowoomba";
const UNISQ_URL = "https://www.unisq.edu.au/events";

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
    ["meetup", () => collectMeetup()],
    ["empire", () => collectEmpire()],
    ["moshtix", () => collectMoshtix()],
    ["unisq", () => collectUnisq()],
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
  const notes = [
    "Council pages use a browser user-agent and accept headers. HTTP 403 and 409 are retried after a backoff.",
  ];
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
  const pages = await crawlSection(COUNCIL_INDEX, "/Events-and-special-days", notes, [], COUNCIL_FETCH);
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
    "Reads the public Toowoomba destination page as a browser document. schema.org JSON-LD supplies the events, and embedded page data supplies start times. HTTP 405 is retried: Eventbrite returns 405 for a POST of this page, for GET /api/v3/destination/search/, and for some non-browser GETs. The disallowed /api/v3/destination/events/ path is not requested.",
  ];
  const events = [];
  let parsed = 0;
  for (let page = 1; page <= 4; page += 1) {
    const url = page === 1 ? EVENTBRITE_URL : `${EVENTBRITE_URL}?page=${page}`;
    const body = await fetchEventbriteListing(url, notes);
    const result = parseEventbriteEvents(body, url);
    parsed += result.parsed;
    events.push(...result.events);
    if (page >= result.pageCount || result.parsed === 0) break;
  }
  notes.push("Stopped after at most 4 public result pages.");
  return { parsed, events, notes };
}

async function fetchEventbriteListing(url, notes) {
  const document = await fetchText(url, { headers: BROWSER_HEADERS, retryOn: [403, 405, 429] });
  if (document.ok) {
    try {
      parseEventbriteEvents(document.text, url);
      return document.text;
    } catch (error) {
      notes.push(`Eventbrite document was not a listing (${error.message}).`);
    }
  } else {
    notes.push(`Eventbrite document HTTP ${document.status}. Requesting the same public listing as JSON.`);
  }
  const xhr = await fetchText(url, {
    headers: {
      "user-agent": BROWSER_UA,
      accept: "application/json",
      "accept-language": "en-AU,en;q=0.9",
      referer: EVENTBRITE_URL,
      "x-requested-with": "XMLHttpRequest",
    },
    retryOn: [403, 405, 429],
  });
  if (!xhr.ok) throw new Error(`Eventbrite HTTP ${xhr.status}`);
  notes.push("Used the public listing URL's JSON document, not /api/v3/destination/events/.");
  return xhr.text;
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

async function collectMeetup() {
  const response = await fetchText(MEETUP_URL);
  if (!response.ok) throw new Error(`Meetup HTTP ${response.status}`);
  const result = parseMeetupEvents(response.text, response.url || MEETUP_URL);
  return {
    ...result,
    notes: ["Reads the public find page for au--toowoomba. Disallowed query strings are not used."],
  };
}

async function collectEmpire() {
  const response = await fetchText(EMPIRE_URL);
  if (!response.ok) throw new Error(`Empire Theatre HTTP ${response.status}`);
  const result = parseEmpireEvents(response.text, response.url || EMPIRE_URL);
  return {
    ...result,
    notes: ["Uses schema.org Event data when present, otherwise the what's-on cards."],
  };
}

async function collectMoshtix() {
  const response = await fetchText(MOSHTIX_URL);
  if (!response.ok) throw new Error(`Moshtix HTTP ${response.status}`);
  const result = parseMoshtixEvents(response.text, response.url || MOSHTIX_URL);
  return {
    ...result,
    notes: ["Reads the public Toowoomba search and keeps venues in the region."],
  };
}

async function collectUnisq() {
  const page = await fetchText(UNISQ_URL);
  if (!page.ok) throw new Error(`UniSQ HTTP ${page.status}`);
  const fromHtml = parseUnisqEvents(page.text, page.url || UNISQ_URL);
  const notes = ["Reads unisq.edu.au/events and keeps rows whose location includes Toowoomba."];
  let parsed = fromHtml.parsed;
  const events = [...fromHtml.events];
  let feedRows = 0;
  const feed = unisqFeedUrl(page.text, page.url || UNISQ_URL);
  if (feed) {
    let skip = 0;
    for (let pageNo = 0; pageNo < 5; pageNo += 1) {
      const url = new URL(feed);
      url.searchParams.set("skip", String(skip));
      const response = await fetchText(url.href);
      if (!response.ok) {
        notes.push(`UniSQ event feed HTTP ${response.status}`);
        if (!events.length && pageNo === 0) throw new Error(`UniSQ event feed HTTP ${response.status}`);
        break;
      }
      let payload;
      try {
        payload = JSON.parse(response.text);
      } catch {
        notes.push("UniSQ event feed was not JSON.");
        if (!events.length) throw new Error("UniSQ event feed was not JSON");
        break;
      }
      const batch = parseUnisqFeed(payload, page.url || UNISQ_URL);
      parsed += batch.parsed;
      feedRows += batch.parsed;
      events.push(...batch.events);
      if (!payload.HasMoreResults) break;
      skip += 50;
    }
  }
  if (feed && feedRows === 0) {
    notes.push("UniSQ event feed returned no rows for the current date.");
  }
  return { parsed, events, notes };
}

function unisqFeedUrl(html, pageUrl) {
  const target = String(html || "").match(/data-target="(\{[^"}]+\})"/i);
  if (!target) return null;
  const location = String(html || "").match(/<option[^>]*value="(\{[^"}]+\})"[^>]*>\s*Toowoomba\s*<\/option>/i);
  const url = new URL("/USQ/Web/CharlieEvents/FilteredEventPreviews", pageUrl);
  url.searchParams.set("take", "50");
  url.searchParams.set("skip", "0");
  url.searchParams.set("categories", "");
  url.searchParams.set("audiences", "");
  url.searchParams.set("locations", location ? location[1] : "");
  url.searchParams.set("targets", target[1]);
  url.searchParams.set("date", "");
  return url.href;
}

async function crawlSection(indexUrl, pathPart, notes, seeds = [], fetchOptions = {}) {
  const index = await fetchText(indexUrl, fetchOptions);
  if (!index.ok) throw new Error(`${indexUrl} HTTP ${index.status}`);
  const urls = new Set([indexUrl, ...seeds]);
  for (const link of discoverLinks(index.text, pathPart)) urls.add(link);
  const pages = [];
  for (const url of [...urls].slice(0, 16)) {
    try {
      const page = url === indexUrl ? index : await fetchText(url, fetchOptions);
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

async function fetchText(url, options = {}) {
  const permission = await fetchPermission(url);
  if (!permission.ok) throw new SourceSkip(permission.reason);
  const headers = options.headers || {
    "user-agent": UA,
    accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "accept-language": "en-AU,en;q=0.9",
  };
  const retryOn = new Set(options.retryOn || []);
  const host = new URL(url).host;
  let attempt = 0;
  while (attempt < 4) {
    const wait = (nextRequestAt.get(host) || 0) - Date.now();
    if (wait > 0) await sleep(wait);
    nextRequestAt.set(host, Date.now() + Math.max(permission.delay, 1) * 1000);
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
      headers,
    });
    const text = await response.text();
    const result = { ok: response.ok, status: response.status, url: response.url, text };
    if (!retryOn.has(response.status) || attempt >= 2) return result;
    attempt += 1;
    const backoff = 2000 * attempt;
    nextRequestAt.set(host, Date.now() + backoff);
    await sleep(backoff);
  }
  return { ok: false, status: 0, url, text: "" };
}

async function fetchPermission(url) {
  const target = new URL(url);
  if (/(^|\.)facebook\.com$|(^|\.)instagram\.com$|(^|\.)fb\.com$/i.test(target.hostname)) {
    return { ok: false, reason: "Facebook and Instagram are not fetched" };
  }
  let robots = robotsCache.get(target.origin);
  if (robots === undefined) {
    try {
      robots = await readRobots(target.origin);
    } catch (error) {
      robots = error?.status ? { status: error.status } : null;
    }
    robotsCache.set(target.origin, robots);
  }
  if (robots && typeof robots === "object" && robots.status) {
    return { ok: false, reason: `robots.txt for ${target.origin} returned HTTP ${robots.status}` };
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

async function readRobots(origin) {
  let current = `${origin}/robots.txt`;
  const seen = new Set();
  for (let hop = 0; hop < 5; hop += 1) {
    if (seen.has(current)) return null;
    seen.add(current);
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { "user-agent": UA, accept: "text/plain,*/*" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.text();
      if (!location) return null;
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) {
      const status = response.status;
      await response.text();
      const error = new Error(`HTTP ${status}`);
      error.status = status;
      throw error;
    }
    return response.text();
  }
  return null;
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
  const next = comparable(payload);
  let previous = null;
  try {
    previous = comparable(JSON.parse(await readFile(EVENTS_PATH, "utf8")));
  } catch {
    previous = null;
  }
  if (previous === next) return false;
  await writeFile(EVENTS_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  return true;
}

function comparable(payload) {
  return JSON.stringify({
    sources: payload.sources || [],
    events: payload.events || [],
  });
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

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { fetchPermission, runSource };
