import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { generateSite } from "../scripts/pages.mjs";
import {
  CONTACT_EMAIL,
  buildSite,
  extractGraph,
  findNode,
  inferSuburb,
  nextOccurrence,
  offersFor,
  replaceMarker,
  validateEventNode,
  validatePlaceNode,
} from "../scripts/seo.mjs";

const NOW = new Date("2026-10-22T10:06:00Z");
const INDEX = `<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- seo:head -->
  <!-- /seo:head -->
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <main>
    <!-- seo:browse -->
    <!-- /seo:browse -->
    <p id="status"><!-- seo:status -->Upcoming<!-- /seo:status --></p>
    <div id="listings"><!-- seo:listings -->
    <!-- /seo:listings --></div>
  </main>
</body>
</html>
`;

const PLACES = [
  {
    id: "toowoomba-parkrun",
    name: "Toowoomba parkrun",
    schemaType: "SportsActivityLocation",
    additionalTypes: ["TouristAttraction"],
    description: "A free weekly 5 kilometre walk and run at Queens Park.",
    venue: "Queens Park",
    streetAddress: "Lindsay Street",
    suburb: "East Toowoomba",
    postcode: "4350",
    free: true,
    categories: ["sport", "free"],
    sameAs: "https://www.parkrun.com.au/toowoomba/",
    recurrence: { frequency: "P1W", byDay: "Saturday", startTime: "07:00" },
  },
  {
    id: "picnic-point",
    name: "Picnic Point",
    schemaType: "TouristAttraction",
    description: "A lookout on the range.",
    streetAddress: "162-202 Tourist Road",
    suburb: "Rangeville",
    postcode: "4350",
    free: true,
    latitude: -27.57862,
    longitude: 151.98786,
    image: {
      src: "/assets/picnic.jpg",
      width: 800,
      height: 450,
      alt: "View from Picnic Point across the Lockyer Valley",
    },
  },
];

function sampleEvent(overrides = {}) {
  return {
    id: "abc123",
    kind: "event",
    title: "Saturday market",
    start: "2026-10-24T09:00:00+10:00",
    end: "2026-10-24T13:00:00+10:00",
    allDay: false,
    venue: "Queens Park",
    suburb: "",
    address: "Queens Park, Lindsay Street, East Toowoomba QLD 4350",
    price: "Free",
    ageGroups: ["families"],
    communities: ["multicultural"],
    categories: ["markets", "free"],
    source: "council",
    sourceUrl: "https://www.tr.qld.gov.au/example",
    summary: "Stalls and coffee.",
    ...overrides,
  };
}

function build(events = [sampleEvent()], places = PLACES) {
  return buildSite({
    events,
    submissions: { items: [] },
    places,
    now: NOW,
    generatedAt: "2026-10-22T10:24:20.874Z",
    indexHtml: INDEX,
  });
}

test("offers keep known prices and skip unknown ones", () => {
  assert.equal(offersFor({ price: "Free", title: "Story time" }).price, "0");
  assert.equal(offersFor({ price: "Free–$270", title: "Class" })["@type"], "AggregateOffer");
  assert.equal(offersFor({ price: "Free–$270", title: "Class" }).lowPrice, "0");
  assert.equal(offersFor({ price: "$10–$70", title: "Show" }).highPrice, "70");
  assert.equal(offersFor({ price: "$25", title: "Show" }).price, "25");
  assert.equal(offersFor({ price: "Paid", title: "Show" }), null);
  assert.equal(offersFor({ price: "See listing", title: "Show" }), null);
  assert.equal(offersFor({ price: "Free", title: "Cancelled picnic" }), null);
});

test("suburb inference prefers the longer place name", () => {
  assert.equal(inferSuburb({ suburb: "", venue: "Cecil Plains Library" }), "Cecil Plains");
  assert.equal(inferSuburb({ suburb: "", address: "9 Tame St, South Toowoomba QLD 4350" }), "South Toowoomba");
  assert.equal(inferSuburb({ suburb: "toowoomba city" }), "Toowoomba City");
});

test("next parkrun is this Saturday morning, Brisbane time", () => {
  const next = nextOccurrence({ byDay: "Saturday", startTime: "07:00" }, NOW);
  assert.equal(next.start, "2026-10-24T07:00:00+10:00");
  const later = nextOccurrence({ byDay: "Saturday", startTime: "07:00" }, new Date("2026-10-23T23:30:00Z"));
  assert.equal(later.start, "2026-10-31T07:00:00+10:00");
});

test("landing pages, event schema, feeds, and sitemap", () => {
  const garage = sampleEvent({
    id: "sale1",
    kind: "garage",
    title: "Hill Street garage sale <script>",
    start: "2026-10-25T08:00:00+10:00",
    end: "2026-10-25T12:00:00+10:00",
    venue: "12 Hill Street",
    suburb: "Toowoomba City",
    address: "12 Hill Street, Toowoomba City QLD 4350",
    price: "$0",
    categories: ["garage"],
    summary: "",
    items: "Books and tools",
    source: "garage",
    sourceUrl: "https://example.com/sale",
  });
  const later = sampleEvent({
    id: "later1",
    title: "November talk",
    start: "2026-11-02T18:00:00+10:00",
    categories: ["education"],
    price: "Paid",
    suburb: "Highfields",
    address: "Highfields Library",
  });
  const built = build([sampleEvent(), garage, later]);
  const weekend = built.files.get("this-weekend/index.html");
  const week = built.files.get("this-week/index.html");
  const sales = built.files.get("garage-sales/index.html");
  const things = built.files.get("things-to-do/index.html");
  const parkrun = built.files.get("things-to-do/toowoomba-parkrun/index.html");
  const eventPage = built.files.get("events/abc123/index.html");
  assert.match(weekend, /Toowoomba events this weekend/);
  assert.match(weekend, /Saturday market/);
  assert.match(weekend, /Toowoomba parkrun/);
  assert.match(weekend, /class="topbar"/);
  assert.match(weekend, /id="theme-toggle"/);
  assert.match(weekend, /wot-theme/);
  assert.doesNotMatch(weekend, /site-header/);
  assert.doesNotMatch(weekend, /November talk/);
  assert.doesNotMatch(week, /November talk/);
  assert.match(built.files.get("events/later1/index.html"), /November talk/);
  assert.match(built.files.get("category/education/index.html"), /November talk/);
  assert.match(sales, /Hill Street garage sale/);
  assert.match(sales, /Books and tools/);
  assert.match(sales, /class="garage-cta"/);
  assert.match(sales, /Know of a garage sale\? Add it yourself\. Pop the address, date and time into the Share something form and it&#39;ll show up here\./);
  assert.match(sales, /<a class="btn" href="\/share\.html">Share something<\/a>/);
  assert.doesNotMatch(built.files.get("category/markets/index.html"), /Know of a garage sale/);
  assert.match(things, /Things to do in Toowoomba/);
  assert.match(things, /class="thing-card"/);
  assert.match(things, /rel="canonical" href="https:\/\/whatsontoowoomba\.au\/things-to-do\.html"/);
  assert.match(things, /loading="lazy"/);
  assert.match(things, /alt="View from Picnic Point across the Lockyer Valley"/);
  assert.match(things, /width="800"/);
  assert.match(parkrun, /lang="en-AU"/);
  assert.match(parkrun, /rel="canonical" href="https:\/\/whatsontoowoomba\.au\/things-to-do\/toowoomba-parkrun\/"/);
  assert.match(parkrun, /SportsActivityLocation/);
  assert.doesNotMatch(parkrun, /Aneesh/);
  assert.match(eventPage, /<script type="application\/ld\+json">/);
  assert.match(eventPage, /Breadcrumb/);
  assert.doesNotMatch(eventPage, /<script>alert/);

  const eventGraph = extractGraph(eventPage);
  const eventNode = findNode(eventGraph, "Event");
  assert.deepEqual(validateEventNode(eventNode), []);
  assert.equal(eventNode.offers.price, "0");
  assert.equal(eventNode.location.address.addressLocality, "East Toowoomba");
  assert.equal(eventNode.eventStatus, "https://schema.org/EventScheduled");

  const parkrunGraph = extractGraph(parkrun);
  assert.deepEqual(validatePlaceNode(findNode(parkrunGraph, "TouristAttraction")), []);
  const parkrunEvent = findNode(parkrunGraph, "Event");
  assert.deepEqual(validateEventNode(parkrunEvent), []);
  assert.equal(parkrunEvent.offers.price, "0");
  assert.equal(parkrunEvent.organizer.name, "parkrun");
  assert.equal(findNode(parkrunGraph, "Organization").email, CONTACT_EMAIL);
  assert.equal(findNode(parkrunGraph, "Organization").name, "What's On Toowoomba");

  const homeGraph = extractGraph(built.indexHtml);
  const website = findNode(homeGraph, "WebSite");
  assert.equal(website.potentialAction["@type"], "SearchAction");
  assert.match(website.potentialAction.target.urlTemplate, /\/search\/\?q=\{search_term_string\}/);
  assert.match(built.indexHtml, /google-site-verification/);
  assert.match(built.indexHtml, /msvalidate\.01/);
  assert.match(built.indexHtml, /geo.region" content="AU-QLD"/);

  const sitemap = built.files.get("sitemap.xml");
  assert.match(sitemap, /<loc>https:\/\/whatsontoowoomba\.au\/events\/abc123\/<\/loc><lastmod>2026-10-22<\/lastmod>/);
  assert.match(sitemap, /\/this-weekend\//);
  assert.doesNotMatch(sitemap, /404\.html/);
  assert.match(built.files.get("robots.txt"), /Sitemap: https:\/\/whatsontoowoomba\.au\/sitemap\.xml/);
  assert.match(built.files.get("feed.xml"), /Saturday market/);
  assert.match(built.files.get("atom.xml"), /<feed /);
  const ics = built.files.get("events.ics");
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /SUMMARY:Saturday market/);
  assert.match(ics, /Toowoomba parkrun/);
  for (const line of ics.split(/\r\n/)) {
    assert.ok(Buffer.byteLength(line) <= 75, line);
  }
  assert.match(built.files.get("404.html"), /noindex/);
  assert.match(built.files.get("suburb/east-toowoomba/index.html"), /What's on in East Toowoomba/);
  assert.match(built.files.get("category/sport/index.html"), /Toowoomba parkrun/);
  assert.equal(built.files.has("category/garage/index.html"), false);
  const paid = extractGraph(built.files.get("events/later1/index.html"));
  assert.equal(findNode(paid, "Event").offers, undefined);
});

test("external images are not hotlinked", () => {
  const built = build([sampleEvent()], [{
    ...PLACES[1],
    image: { src: "https://example.com/pic.jpg", width: 10, height: 10, alt: "Remote photo" },
  }]);
  assert.doesNotMatch(built.files.get("things-to-do/picnic-point/index.html"), /example\.com\/pic/);
});

test("marker replacement ignores dollar signs", () => {
  const html = replaceMarker("<!-- seo:head -->old<!-- /seo:head -->", "head", "price $10 & <em>");
  assert.match(html, /price \$10 & <em>/);
});

test("generateSite writes pages and drops stale event folders", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wot-"));
  await mkdir(path.join(root, "data"), { recursive: true });
  await mkdir(path.join(root, "events", "stale"), { recursive: true });
  await writeFile(path.join(root, "events", "stale", "index.html"), "old");
  await writeFile(path.join(root, "index.html"), INDEX);
  await writeFile(path.join(root, "things-to-do.html"), `<!DOCTYPE html><html lang="en-AU"><head><!-- seo:head --><!-- /seo:head --></head><body><div id="thing-groups"><!-- seo:places --><!-- /seo:places --></div></body></html>`);
  await writeFile(path.join(root, "data", "events.json"), JSON.stringify({
    generatedAt: "2026-10-22T10:24:20.874Z",
    events: [sampleEvent()],
  }));
  await writeFile(path.join(root, "data", "submissions.json"), JSON.stringify({ items: [] }));
  await writeFile(path.join(root, "data", "things-to-do.json"), JSON.stringify({ places: PLACES }));
  const result = await generateSite({ root, now: NOW });
  assert.ok(result.written > 5);
  assert.ok(result.removed >= 1);
  const page = await readFile(path.join(root, "events", "abc123", "index.html"), "utf8");
  assert.match(page, /Saturday market/);
  await assert.rejects(readFile(path.join(root, "events", "stale", "index.html"), "utf8"));
  const occurrences = JSON.parse(await readFile(path.join(root, "data", "occurrences.json"), "utf8"));
  assert.equal(occurrences.events[0].title, "Toowoomba parkrun");
  assert.equal(occurrences.events[0].pagePath, "/things-to-do/toowoomba-parkrun/");
});

test("committed listings all receive a valid event page", async () => {
  const payload = JSON.parse(await readFile(new URL("../data/events.json", import.meta.url), "utf8"));
  const places = JSON.parse(await readFile(new URL("../data/things-to-do.json", import.meta.url), "utf8"));
  const built = buildSite({
    events: payload.events,
    submissions: { items: [] },
    places: places.places,
    now: NOW,
    generatedAt: payload.generatedAt,
    indexHtml: INDEX,
  });
  for (const event of payload.events) {
    const html = built.files.get(`events/${event.id}/index.html`);
    assert.ok(html, event.id);
    const node = findNode(extractGraph(html), "Event");
    assert.deepEqual(validateEventNode(node), [], `${event.title}: ${validateEventNode(node).join(",")}`);
    assert.equal(node.name, event.title);
  }
  const titles = [...built.files.entries()]
    .filter(([rel]) => rel.endsWith(".html"))
    .map(([, html]) => html.match(/<title>(.*?)<\/title>/)?.[1])
    .filter(Boolean);
  const seen = new Set();
  for (const title of titles) {
    assert.equal(seen.has(title), false, title);
    seen.add(title);
  }
  for (const place of places.places) {
    const html = built.files.get(`things-to-do/${place.id}/index.html`);
    const types = ["TouristAttraction", "Place", "SportsActivityLocation", "Museum"];
    const graph = extractGraph(html);
    const node = graph["@graph"].find((entry) => {
      const entryTypes = Array.isArray(entry["@type"]) ? entry["@type"] : [entry["@type"]];
      return entryTypes.some((type) => types.includes(type) && entry["@id"]?.includes("#place"));
    });
    assert.deepEqual(validatePlaceNode(node), [], place.id);
  }
});
