import assert from "node:assert/strict";
import test from "node:test";
import { parseCouncilPage, parseGarageSales, parseMalayaliEvents, parseTimsEvents } from "../scripts/parse.mjs";
import {
  dedupeListings,
  inToowoombaRegion,
  isPast,
  matchesFilters,
  robotsAllows,
  tagListing,
} from "../scripts/pure.mjs";

const NOW = new Date("2026-10-22T10:06:00Z");

test("library sessions use written dates and roll January to the next year", () => {
  const html = `
    <h1 class="oc-page-title">First 5 Forever and 0-5 year sessions</h1>
    <h2>Read + Play</h2>
    <ul>
      <li>Clifton Library: Thursday 22 October, 5 November, and 14 January, 10am – 10.30am</li>
      <li>Oakey Library: Tuesdays, 10 - 10.30am</li>
    </ul>
  `;
  const events = parseCouncilPage(html, "https://www.tr.qld.gov.au/Places-and-activities/Libraries/Library-programs-and-events/First-5-Forever-and-0-5-year-sessions", NOW);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((event) => event.start), [
    "2026-10-22T10:00:00+10:00",
    "2026-11-05T10:00:00+10:00",
    "2027-01-14T10:00:00+10:00",
  ]);
  assert.equal(events[0].source, "library");
  assert.ok(events[0].ageGroups.includes("kids"));
  assert.equal(events[0].end, "2026-10-22T10:30:00+10:00");
  assert.equal(isPast(events[0], NOW), true);
  assert.equal(isPast(events[1], NOW), false);
});

test("citizenship page keeps the written year and both session times", () => {
  const html = `
    <h1 class="oc-page-title">Australian citizenship ceremony</h1>
    <p>The ceremony will be held at The Annex, located at the rear of City Hall at 541 Ruthven Street Toowoomba City.</p>
    <ul>
      <li>Thursday, 22 October 2026 - 10am and 2pm</li>
      <li>Thursday, 19 November 2026 - 10am and 2pm</li>
    </ul>
  `;
  const events = parseCouncilPage(html, "https://www.tr.qld.gov.au/Places-and-activities/Things-to-see-and-do/Events-and-special-days/Australian-citizenship-ceremony", NOW);
  assert.equal(events.length, 4);
  assert.equal(events[2].start, "2026-11-19T10:00:00+10:00");
  assert.equal(events[3].start, "2026-11-19T14:00:00+10:00");
  assert.match(events[2].venue, /Annex/);
  assert.match(events[2].venue, /Ruthven Street/);
  assert.doesNotMatch(events[2].venue, /,,/);
});

test("Australia Day blocks stay in the year written on the page", () => {
  const html = `
    <h1 class="oc-page-title">Australia Day</h1>
    <p>Below is a list of confirmed 2026 Australia Day events in our Region.</p>
    <div class="oc-wysiwyg-container-panel">
      <h2>Toowoomba City</h2>
      <p><strong>Australia Day 2026 - Toowoomba City</strong></p>
      <p><strong>Date:</strong> Monday 26 January</p>
      <p><strong>Time:</strong> 8am - 11.30am</p>
      <p><strong>Location:</strong> Picnic Point, 162 Tourist Road, Toowoomba</p>
    </div>
  `;
  const events = parseCouncilPage(html, "https://www.tr.qld.gov.au/example", NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Australia Day 2026 - Toowoomba City");
  assert.equal(events[0].start, "2026-01-26T08:00:00+10:00");
  assert.equal(isPast(events[0], NOW), true);
});

test("prayer breakfast uses the date in the sentence", () => {
  const html = `
    <h1 class="oc-page-title">Mayoral Prayer Breakfast 2026</h1>
    <p>The 32nd community fundraiser will be held on Tuesday, May 12 at Rumours International, 323 Ruthven Street, Toowoomba from 6am.</p>
  `;
  const events = parseCouncilPage(html, "https://www.tr.qld.gov.au/example", NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].start, "2026-05-12T06:00:00+10:00");
  assert.match(events[0].venue, /Rumours International/);
  assert.ok(events[0].categories.includes("faith"));
});

test("garage sale parser reads date, suburb, and items", () => {
  const html = `
    <div class="notice-block standard">
      <a href="?suburb=304" class="location-link"><h3 class="location">South Toowoomba, 4350</h3></a>
      <h2 class="listing-header">ALL MUST GO!</h2>
      <div id="garage-sale-place-date">
        <p>9 Tame St, South Toowoomba QLD 4350</p>
        <p>Sat 26 Sep 10:00AM - 05:00PM</p>
      </div>
      <div class="max-height-static"><p>Furniture, tools, and books.</p></div>
      <a href="/buy-sell/garage-sales/all-must-go/6378264/">View</a>
    </div>
  `;
  const events = parseGarageSales(html, "https://www.buysearchsell.com.au/toowoomba/buy-sell/garage-sales/");
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "garage");
  assert.equal(events[0].start, "2026-09-26T10:00:00+10:00");
  assert.equal(events[0].end, "2026-09-26T17:00:00+10:00");
  assert.equal(events[0].suburb, "South Toowoomba");
  assert.match(events[0].items, /Furniture/);
  assert.equal(events[0].categories.includes("garage"), true);
});

test("multicultural parsers read the published cards", () => {
  const tims = `
    <h1 class="eventlist-title"><a href="/events/international-street-fiesta-2025" class="eventlist-title-link">International Street Fiesta 2025</a></h1>
    <time class="event-date" datetime="2025-11-01">Saturday 1 November 2025</time>
    <time class="event-time-localized-start">3:00 pm</time>
    <time class="event-time-localized-end">8:30 pm</time>
    <li class="eventlist-meta-item eventlist-meta-address">Queens Park Toowoomba <a href="http://maps.example">(map)</a></li>
    <div class="eventlist-excerpt"><p>A free family afternoon.</p></div>
  `;
  const fiesta = parseTimsEvents(tims, "https://www.tims.org.au/events");
  assert.equal(fiesta[0].start, "2025-11-01T15:00:00+10:00");
  assert.equal(fiesta[0].price, "Free");
  assert.equal(fiesta[0].venue, "Queens Park Toowoomba");
  const malayali = parseMalayaliEvents(`
    <span>August 22nd Sat 2026</span><h4>Onam 2k26</h4><p>Onam celebration</p>
  `, "https://toowoombamalayali.org/events");
  assert.equal(malayali[0].start, "2026-08-22T00:00:00+10:00");
  assert.ok(malayali[0].communities.includes("indian"));
});

test("keyword tags and region checks", () => {
  const seniors = tagListing({ title: "Toowoomba, QLD - Starts at 60 Meetup", price: "Free" });
  assert.ok(seniors.ageGroups.includes("seniors"));
  assert.ok(seniors.categories.includes("free"));
  const youth = tagListing({ title: "toowoomba queer social ★ 18+ prom night" });
  assert.ok(youth.ageGroups.includes("young-adults"));
  assert.equal(inToowoombaRegion(["Glenvale", "QLD"]), true);
  assert.equal(inToowoombaRegion(["Kingaroy RSL", "Kingaroy QLD 4610"]), false);
  assert.equal(inToowoombaRegion(["Helidon", "QLD"]), false);
  assert.equal(inToowoombaRegion(["Gatton", "QLD", "4343"]), false);
  assert.equal(inToowoombaRegion(["Esk", "QLD", "4312"]), false);
});

test("dedupe keeps one listing per title and day", () => {
  const merged = dedupeListings([
    { kind: "event", title: "Boots, Beats & Good Company", start: "2026-10-25T16:00:00+10:00", venue: "Tonic Lounge", price: "See listing", source: "eventbrite", sourceUrl: "https://example.com/a" },
    { kind: "event", title: "Boots, Beats and Good Company", start: "2026-10-25T16:00:00+10:00", venue: "Tonic Lounge", price: "Paid", source: "humanitix", sourceUrl: "https://example.com/b" },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].price, "Paid");
  assert.equal(merged[0].source, "humanitix");
});

test("date filters use the Brisbane week", () => {
  const event = {
    kind: "event",
    title: "Saturday market",
    start: "2026-10-24T09:00:00+10:00",
    allDay: false,
    ageGroups: ["families"],
    communities: ["multicultural"],
    categories: ["markets"],
  };
  assert.equal(matchesFilters(event, { tab: "whats-on", date: "weekend" }, NOW), true);
  assert.equal(matchesFilters(event, { tab: "whats-on", date: "today" }, NOW), false);
  assert.equal(matchesFilters(event, { tab: "whats-on", date: "month", category: "markets" }, NOW), true);
  assert.equal(matchesFilters(event, { tab: "garage", date: "" }, NOW), false);
});

test("robots rules allow the public listing paths and block the disallowed API", () => {
  const robots = `
    User-agent: *
    Disallow: /api/v3/destination/events/
    Disallow: *?i*
    Allow: /
  `;
  assert.equal(robotsAllows(robots, "/d/australia--toowoomba/all-events/"), true);
  assert.equal(robotsAllows(robots, "/d/australia--toowoomba/all-events/?page=2"), true);
  assert.equal(robotsAllows(robots, "/api/v3/destination/events/?foo=1"), false);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /\n", "/cgi-bin/spydus.exe/EVENTS"), false);
});
