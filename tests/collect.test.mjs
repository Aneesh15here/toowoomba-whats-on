import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import test from "node:test";
import { fetchPermission, runSource } from "../scripts/collect.mjs";
import {
  parseCouncilPage,
  parseEmpireEvents,
  parseEventbriteEvents,
  parseGarageSales,
  parseMalayaliEvents,
  parseMeetupEvents,
  parseMoshtixEvents,
  parseTimsEvents,
  parseUnisqEvents,
  parseUnisqFeed,
} from "../scripts/parse.mjs";
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

test("new source fixtures report a parsed count through runSource", async () => {
  const cases = [
    ["meetup", "meetup.html", parseMeetupEvents, "https://www.meetup.com/find/au--toowoomba/", "Language Exchange"],
    ["empire", "empire.html", parseEmpireEvents, "https://empiretheatre.com.au/whats-on", "Dolly I Will Always Love You"],
    ["moshtix", "moshtix.html", parseMoshtixEvents, "https://www.moshtix.com.au/v2/search?query=toowoomba", "Jet - The Rumblin' Regional Revue w/ Liquid Zoo"],
    ["unisq", "unisq.html", parseUnisqEvents, "https://www.unisq.edu.au/events", "Toowoomba campus twilight"],
  ];
  for (const [id, file, parse, url, title] of cases) {
    const html = await readFile(new URL(`./fixtures/${file}`, import.meta.url), "utf8");
    const result = parse(html, url);
    const report = await runSource(id, async () => result, [], NOW);
    assert.equal(report.ok, true, id);
    assert.ok(report.parsed > 0, `${id} parsed`);
    assert.ok(report.events.length > 0, `${id} kept`);
    assert.ok(report.events.some((event) => event.title === title), id);
    assert.equal(report.events.every((event) => event.source === id), true, id);
  }
});

test("meetup drops online rows and empire prefers schema.org events", () => {
  const meetup = parseMeetupEvents(
    `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"eventsInLocation":[
      {"title":"Online trivia night","eventUrl":"https://www.meetup.com/example/events/1/","eventType":"ONLINE","isOnline":true,"dateTime":"2026-11-02T18:00:00+10:00"}
    ]}}}</script>`,
    "https://www.meetup.com/find/au--toowoomba/",
  );
  assert.equal(meetup.parsed, 1);
  assert.equal(meetup.events.length, 0);
  const empire = parseEmpireEvents(`
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"TheaterEvent","name":"Schema Gala","startDate":"2026-12-01T19:30:00+10:00","location":{"@type":"Place","name":"Empire Theatre","address":{"addressLocality":"Toowoomba","addressRegion":"QLD"}}}
    </script>
    <time datetime="2026-10-24T00:00:00+10:00">24 Oct</time>
    <h3><a href="/whats-on/card-only">Card only show</a></h3>
  `, "https://empiretheatre.com.au/whats-on");
  assert.equal(empire.events.length, 1);
  assert.equal(empire.events[0].title, "Schema Gala");
  assert.equal(empire.events[0].start, "2026-12-01T19:30:00+10:00");
});

test("eventbrite uses embedded times and json-ld, and drops online or out-of-region rows", () => {
  const pageUrl = "https://www.eventbrite.com.au/d/australia--toowoomba/all-events/";
  const html = `
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"ItemList","itemListElement":[
      {"@type":"ListItem","position":1,"item":{"@type":"Event","name":"Toowoomba market","startDate":"2026-11-07","url":"https://www.eventbrite.com.au/e/toowoomba-market-tickets-1","location":{"@type":"Place","name":"Queens Park","address":{"addressLocality":"Toowoomba","addressRegion":"QLD","postalCode":"4350"}}}},
      {"@type":"ListItem","position":2,"item":{"@type":"Event","name":"Online webinar","startDate":"2026-11-08","eventAttendanceMode":"https://schema.org/OnlineEventAttendanceMode","url":"https://www.eventbrite.com.au/e/online-tickets-2","location":{"@type":"VirtualLocation","url":"https://example.com"}}}
    ]}
    </script>
    <script>window.__SERVER_DATA__ = {"search_data":{"events":{"results":[
      {"id":"1","name":"Toowoomba market","start_date":"2026-11-07","start_time":"09:30","end_date":"2026-11-07","end_time":"12:00","timezone":"Australia/Brisbane","url":"https://www.eventbrite.com.au/e/toowoomba-market-tickets-1","is_online_event":false,"summary":"Stalls","primary_venue":{"name":"Queens Park","address":{"city":"Toowoomba","region":"QLD","postal_code":"4350"}}},
      {"id":"9","name":"Brisbane only","start_date":"2026-11-09","start_time":"18:00","timezone":"Australia/Brisbane","url":"https://www.eventbrite.com.au/e/brisbane-tickets-9","is_online_event":false,"primary_venue":{"name":"The Triffid","address":{"city":"Brisbane","region":"QLD","postal_code":"4000"}}}
    ],"pagination":{"page_count":2}}}};</script>
    <a class="event-card-link" data-event-id="1" data-event-paid-status="free" data-event-category="family-and-education"></a>
  `;
  const result = parseEventbriteEvents(html, pageUrl);
  assert.equal(result.parsed, 2);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, "Toowoomba market");
  assert.equal(result.events[0].start, "2026-11-07T09:30:00+10:00");
  assert.equal(result.events[0].end, "2026-11-07T12:00:00+10:00");
  assert.equal(result.events[0].price, "Free");
  assert.equal(result.events[0].source, "eventbrite");
  assert.equal(result.events[0].categories.includes("education"), true);
  assert.equal(result.pageCount, 2);

  const jsonOnly = parseEventbriteEvents(`
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"ItemList","itemListElement":[
      {"@type":"ListItem","item":{"@type":"Event","name":"Glenvale show","startDate":"2026-11-20","url":"https://www.eventbrite.com.au/e/glenvale-show-tickets-3","location":{"@type":"Place","name":"Toowoomba Showgrounds","address":{"streetAddress":"Glenvale Road","addressLocality":"Glenvale","addressRegion":"QLD","postalCode":"4350"}}}}
    ]}
    </script>
  `, pageUrl);
  assert.equal(jsonOnly.parsed, 1);
  assert.equal(jsonOnly.events[0].start, "2026-11-20T00:00:00+10:00");
  assert.equal(jsonOnly.events[0].allDay, true);
  assert.equal(jsonOnly.events[0].venue, "Toowoomba Showgrounds");

  const xhr = parseEventbriteEvents(JSON.stringify({
    search_data: {
      events: {
        results: [{
          id: "4",
          name: "JSON listing",
          start_date: "2026-12-01",
          start_time: "19:00",
          timezone: "Australia/Brisbane",
          url: "https://www.eventbrite.com.au/e/json-listing-tickets-4",
          is_online_event: false,
          primary_venue: { name: "The Empire", address: { city: "Toowoomba", region: "QLD", postal_code: "4350" } },
        }],
        pagination: { page_count: 3 },
      },
    },
  }), pageUrl);
  assert.equal(xhr.events.length, 1);
  assert.equal(xhr.events[0].start, "2026-12-01T19:00:00+10:00");
  assert.throws(
    () => parseEventbriteEvents('<html><script>window.__SERVER_DATA__ = {"search_data":{}};</script>', pageUrl),
    /no event data/,
  );
});

test("moshtix and unisq keep Toowoomba venues only", () => {
  const moshtix = parseMoshtixEvents(
    `<div class="searchresult"><h2 class="main-event-header"><a href="/v2/event/brisbane-only-show/1"><span>Brisbane Only Show</span></a></h2><h2 class="main-artist-event-header">Sat 7 Nov 2026, 7.00pm | <a href="/v2/venues/the-triffid/1"><span>The Triffid</span></a></h2></div>`,
    "https://www.moshtix.com.au/v2/search?query=toowoomba",
  );
  assert.equal(moshtix.parsed, 1);
  assert.equal(moshtix.events.length, 0);
  const unisq = parseUnisqFeed({
    Events: [
      { Title: "Brisbane open evening", Location: "UniSQ Brisbane, 293 Queen Street", FormattedDateRange: "18 NOV 2026", Time: "5.30 PM - 8.00 PM", Url: "/events/2026/11/brisbane-open-evening" },
      { Title: "Toowoomba campus twilight", Location: "UniSQ Toowoomba, West Street", FormattedDateRange: "12 NOV 2026", Time: "5.30 PM - 8.00 PM", Url: "/events/2026/11/toowoomba-campus-twilight" },
    ],
  }, "https://www.unisq.edu.au/events");
  assert.equal(unisq.parsed, 2);
  assert.equal(unisq.events.length, 1);
  assert.equal(unisq.events[0].start, "2026-11-12T17:30:00+10:00");
  assert.equal(unisq.events[0].end, "2026-11-12T20:00:00+10:00");
});

test("a new source dedupes against an existing listing for the same show", () => {
  const merged = dedupeListings([
    { kind: "event", title: "Language Exchange", start: "2026-10-25T16:00:00+10:00", venue: "New Hope", price: "See listing", source: "eventbrite", sourceUrl: "https://example.com/a" },
    { kind: "event", title: "Language Exchange", start: "2026-10-25T16:00:00+10:00", venue: "New Hope", price: "Free", source: "meetup", sourceUrl: "https://www.meetup.com/e" },
  ]);
  assert.equal(merged.length, 1);
  const sources = new Set([merged[0].source, ...(merged[0].alsoFrom || [])]);
  assert.equal(sources.has("meetup"), true);
  assert.equal(sources.has("eventbrite"), true);
});

test("fetchPermission follows a robots.txt redirect", async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(301, { Location: "/robots-final.txt", "content-type": "text/html" });
      response.end("<html><title>301 Moved Permanently</title></html>");
      return;
    }
    if (request.url === "/robots-final.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nDisallow: /private\nAllow: /\n");
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const origin = `http://127.0.0.1:${port}`;
    const allowed = await fetchPermission(`${origin}/whats-on`);
    const blocked = await fetchPermission(`${origin}/private`);
    assert.equal(allowed.ok, true);
    assert.equal(blocked.ok, false);
    assert.match(blocked.reason, /disallows/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("fetchPermission records the HTTP status when robots.txt is blocked", async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(403, { "content-type": "application/json" });
      response.end('{"response":"block"}');
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const permission = await fetchPermission(`http://127.0.0.1:${port}/v2/search?query=toowoomba`);
    assert.equal(permission.ok, false);
    assert.match(permission.reason, /HTTP 403/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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
