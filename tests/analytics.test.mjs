import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  GOATCOUNTER_CODE,
  REPORT_EVENT,
  SHARE_EVENT,
  buildWeeklyReport,
  countSnippet,
  emptyWeeklyReport,
  filterEventPath,
  installTracking,
  outboundEventPath,
  referrerKind,
  statsSignature,
} from "../scripts/analytics.mjs";
import { generateSite } from "../scripts/pages.mjs";
import { buildSite } from "../scripts/seo.mjs";

const NOW = new Date("2026-10-22T10:06:00Z");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SNIPPET = countSnippet();

const INDEX = `<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="/css/styles.css">
  <!-- seo:head -->
  <!-- /seo:head -->
</head>
<body>
  <main>
    <!-- seo:browse -->
    <!-- /seo:browse -->
    <p id="status"><!-- seo:status -->Upcoming<!-- /seo:status --></p>
    <div id="listings"><!-- seo:listings -->
    <!-- /seo:listings --></div>
  </main>
  <footer class="site-footer">
    <div class="wrap">
      <p>Listings</p>
    </div>
  </footer>
</body>
</html>
`;

const THINGS = `<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="/css/styles.css">
  <!-- seo:head -->
  <!-- /seo:head -->
</head>
<body>
  <div id="thing-groups"><!-- seo:places --><!-- /seo:places --></div>
  <footer class="site-footer">
    <div class="wrap">
      <p>Places</p>
    </div>
  </footer>
</body>
</html>
`;

function sampleEvent() {
  return {
    id: "abc123",
    kind: "event",
    title: "Saturday market",
    start: "2026-10-24T09:00:00+10:00",
    end: "2026-10-24T13:00:00+10:00",
    allDay: false,
    venue: "Queens Park",
    suburb: "East Toowoomba",
    address: "Queens Park, East Toowoomba QLD 4350",
    price: "Free",
    ageGroups: ["families"],
    communities: ["multicultural"],
    categories: ["markets", "free"],
    source: "council",
    sourceUrl: "https://www.tr.qld.gov.au/example",
    summary: "Stalls and coffee.",
  };
}

const PLACES = [{
  id: "toowoomba-parkrun",
  name: "Toowoomba parkrun",
  description: "A free weekly 5 kilometre walk and run at Queens Park.",
  venue: "Queens Park",
  streetAddress: "Lindsay Street",
  suburb: "East Toowoomba",
  postcode: "4350",
  free: true,
  categories: ["sport", "free"],
  sameAs: "https://www.parkrun.com.au/toowoomba/",
  recurrence: { frequency: "P1W", byDay: "Saturday", startTime: "07:00" },
}];

function build() {
  return buildSite({
    events: [sampleEvent()],
    submissions: { items: [] },
    places: PLACES,
    now: NOW,
    generatedAt: "2026-10-22T10:24:20.874Z",
    indexHtml: INDEX,
    thingsHtml: THINGS,
  });
}

test("the GoatCounter site code lives in one module", async () => {
  assert.equal(GOATCOUNTER_CODE, "whatsontoowoomba");
  assert.equal(SNIPPET, `<script data-goatcounter="https://whatsontoowoomba.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>`);
  const sources = [
    "scripts/visitor-stats.mjs",
    "scripts/seo.mjs",
    "scripts/pages.mjs",
    "js/analytics.js",
    "js/app.js",
    ".github/workflows/visitor-stats.yml",
  ];
  for (const rel of sources) {
    const text = await readFile(path.join(ROOT, rel), "utf8");
    assert.equal(text.includes("whatsontoowoomba.goatcounter.com"), false, rel);
    assert.equal(text.includes("GOATCOUNTER_CODE ="), false, rel);
  }
  const workflow = await readFile(path.join(ROOT, ".github/workflows/visitor-stats.yml"), "utf8");
  assert.match(workflow, /GOATCOUNTER_TOKEN/);
  assert.match(workflow, /secret not set/);
  assert.match(workflow, /echo "skip=true"/);
  assert.match(workflow, /data\/stats\/weekly\.json/);
});

test("generated pages include the count.js snippet", () => {
  const built = build();
  const htmlFiles = [...built.files.entries()].filter(([rel]) => rel.endsWith(".html"));
  assert.ok(htmlFiles.length > 3);
  for (const [rel, html] of htmlFiles) {
    assert.equal(html.split(SNIPPET).length - 1, 1, rel);
    assert.match(html, /\/js\/analytics\.js/, rel);
    assert.match(html, /class="privacy-note"/, rel);
    assert.match(html, /No cookies and no personal data/, rel);
  }
  const eventPage = built.files.get("events/abc123/index.html");
  assert.match(eventPage, /data-track="outbound-tr\.qld\.gov\.au"/);
  assert.match(eventPage, /data-track-title="Outbound event link"/);
  const placePage = built.files.get("things-to-do/toowoomba-parkrun/index.html");
  assert.doesNotMatch(placePage, /data-track=/);
  assert.equal(built.indexHtml.split(SNIPPET).length - 1, 1);
  assert.match(built.indexHtml, /class="privacy-note"/);
  assert.match(built.thingsHtml, /class="privacy-note"/);
});

test("generateSite writes the snippet into event pages and static pages", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wot-analytics-"));
  await mkdir(path.join(root, "data"), { recursive: true });
  await writeFile(path.join(root, "index.html"), INDEX);
  await writeFile(path.join(root, "things-to-do.html"), THINGS);
  await writeFile(path.join(root, "share.html"), `<!DOCTYPE html><html><body><footer class="site-footer"><div class="wrap"><p>Share</p></div></footer><script type="module" src="js/share.js"></script></body></html>`);
  await writeFile(path.join(root, "data", "events.json"), JSON.stringify({ generatedAt: "2026-10-22T10:24:20.874Z", events: [sampleEvent()] }));
  await writeFile(path.join(root, "data", "submissions.json"), JSON.stringify({ items: [] }));
  await writeFile(path.join(root, "data", "things-to-do.json"), JSON.stringify({ places: PLACES }));
  await generateSite({ root, now: NOW });
  const eventPage = await readFile(path.join(root, "events", "abc123", "index.html"), "utf8");
  const share = await readFile(path.join(root, "share.html"), "utf8");
  const home = await readFile(path.join(root, "index.html"), "utf8");
  for (const html of [eventPage, share, home]) {
    assert.equal(html.split(SNIPPET).length - 1, 1);
    assert.match(html, /analytics\.js/);
    assert.match(html, /class="privacy-note"/);
  }
  assert.match(eventPage, /data-track="outbound-tr\.qld\.gov\.au"/);
  const cname = await readFile(path.join(ROOT, "CNAME"), "utf8");
  assert.equal(cname.trim(), "whatsontoowoomba.au");
});

test("event names cover outbound links, share, report, and thing filters", () => {
  assert.equal(outboundEventPath("https://www.eventbrite.com.au/e/tickets"), "outbound-eventbrite.com.au");
  assert.equal(outboundEventPath("https://whatsontoowoomba.au/events/abc/"), "");
  assert.equal(outboundEventPath("share.html"), "");
  assert.equal(outboundEventPath("mailto:whatsontoowoomba@agentmail.to"), "");
  assert.equal(filterEventPath(""), "things-filter-all");
  assert.equal(filterEventPath("walks"), "things-filter-walks");
  assert.equal(SHARE_EVENT, "share-submit");
  assert.equal(REPORT_EVENT, "report");

  const calls = [];
  const listeners = {};
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    Element: globalThis.Element,
    HTMLFormElement: globalThis.HTMLFormElement,
  };
  class Element {}
  class HTMLFormElement {}
  globalThis.Element = Element;
  globalThis.HTMLFormElement = HTMLFormElement;
  globalThis.window = {
    goatcounter: { count(payload) { calls.push(payload); } },
    addEventListener() {},
    setInterval() { return 0; },
    clearInterval() {},
    setTimeout() { return 0; },
  };
  globalThis.document = {
    readyState: "complete",
    addEventListener(type, fn) { listeners[type] = fn; },
  };
  try {
    installTracking();
    const link = Object.assign(Object.create(Element.prototype), {
      dataset: { track: "outbound-eventbrite.com.au", trackTitle: "Outbound event link" },
      closest(selector) { return selector === "a[data-track]" ? link : null; },
    });
    listeners.click({ target: link });
    const filter = Object.assign(Object.create(Element.prototype), {
      dataset: { type: "walks" },
      closest(selector) {
        if (selector === "a[data-track]") return null;
        if (selector === "#thing-filters [data-type]") return filter;
        return null;
      },
    });
    listeners.click({ target: filter });
    const share = Object.assign(Object.create(HTMLFormElement.prototype), {
      id: "share-form",
      classList: { contains() { return false; } },
    });
    listeners.submit({ target: share });
    const report = Object.assign(Object.create(HTMLFormElement.prototype), {
      id: "",
      dataset: {},
      classList: { contains(name) { return name === "report-form"; } },
    });
    const reportButton = Object.assign(Object.create(Element.prototype), {
      closest(selector) {
        if (selector === "a[data-track]") return null;
        if (selector === ".report button, .report-form button") return reportButton;
        if (selector === "form") return report;
        return null;
      },
    });
    listeners.click({ target: reportButton });
    listeners.submit({ target: report });
  } finally {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.Element = previous.Element;
    globalThis.HTMLFormElement = previous.HTMLFormElement;
  }
  assert.deepEqual(calls.map((call) => call.path), [
    "outbound-eventbrite.com.au",
    "things-filter-walks",
    "share-submit",
    "report",
  ]);
  assert.equal(calls[2].event, true);
  assert.equal(calls[3].title, "Report listing");
});

test("weekly stats keep pages, referrers, search versus direct, events, and week over week totals", () => {
  const hits = [
    { path: "/", title: "Home", count: 40, event: false },
    { path: "/share.html", title: "Share", count: 5, event: false },
    { path: "share-submit", title: "Share form", count: 2, event: true },
    { path: "things-filter-walks", title: "Things to do filter walks", count: 7, event: true },
    { path: "report", title: "Report listing", count: 1, event: "true" },
  ];
  for (let i = 0; i < 25; i += 1) {
    hits.push({ path: `/extra-${i}`, title: `Extra ${i}`, count: i, event: false });
  }
  const report = buildWeeklyReport({
    updated: "2026-10-22T03:17:00.000Z",
    status: "ok",
    range: {
      start: "2026-10-15T03:00:00.000Z",
      end: "2026-10-22T03:00:00.000Z",
      previousStart: "2026-10-08T03:00:00.000Z",
      previousEnd: "2026-10-15T03:00:00.000Z",
    },
    currentTotal: { total: 100, total_events: 15 },
    previousTotal: { total: 80, total_events: 10 },
    hits,
    referrers: [
      { name: "Google", count: 10, ref_scheme: "g" },
      { name: "duckduckgo.com", count: 4, ref_scheme: "h" },
      { name: "", count: 30, ref_scheme: "o" },
      { name: "facebook.com", count: 3, ref_scheme: "h" },
    ],
  });
  assert.equal(report.site, "whatsontoowoomba");
  assert.equal(report.pages.length, 20);
  assert.equal(report.pages[0].path, "/");
  assert.equal(report.pages.some((page) => page.path === "share-submit"), false);
  assert.deepEqual(report.events.map((event) => event.path), ["things-filter-walks", "share-submit", "report"]);
  assert.equal(report.traffic.search, 14);
  assert.equal(report.traffic.direct, 30);
  assert.equal(report.traffic.other, 3);
  assert.equal(report.referrers[0].name, "(direct)");
  assert.deepEqual(report.totals.week, { visits: 100, events: 15, pages: 85 });
  assert.deepEqual(report.totals.previousWeek, { visits: 80, events: 10, pages: 70 });
  assert.deepEqual(report.totals.change, { visits: 20, events: 5, pages: 15 });
  assert.equal(referrerKind({ name: "Bing" }), "search");
  assert.equal(referrerKind({ name: "(direct)" }), "direct");
  const later = { ...report, updated: "2026-10-29T03:17:00.000Z" };
  assert.equal(statsSignature(report), statsSignature(later));
  const empty = emptyWeeklyReport();
  assert.equal(empty.status, "awaiting-token");
  assert.equal(empty.pages.length, 0);
  assert.deepEqual(empty.traffic, { search: 0, direct: 0, other: 0 });
  assert.deepEqual(empty.totals.change, { visits: 0, events: 0, pages: 0 });
});

test("visitor stats does nothing when the token secret is missing", () => {
  const result = spawnSync(process.execPath, ["scripts/visitor-stats.mjs"], {
    cwd: ROOT,
    env: { ...process.env, GOATCOUNTER_TOKEN: "", GITHUB_ENV: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GOATCOUNTER_TOKEN secret not set/);
});
