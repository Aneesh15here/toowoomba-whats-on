import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { FEEDBACK_ADDRESS, FEEDBACK_TYPES, feedbackMailto } from "../js/feedback.js";
import { generateSite } from "../scripts/pages.mjs";
import { CONTACT_EMAIL, buildSite } from "../scripts/seo.mjs";

const NOW = new Date("2026-10-22T10:06:00Z");

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

test("feedback mailto draft uses the type, message, and optional email", () => {
  assert.equal(FEEDBACK_ADDRESS, CONTACT_EMAIL);
  assert.deepEqual(FEEDBACK_TYPES, ["suggestion", "problem", "event correction", "other"]);

  const href = feedbackMailto({
    type: "problem",
    message: "The market date is wrong.",
    email: "ada@example.com",
  });
  const url = new URL(href);
  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, FEEDBACK_ADDRESS);
  assert.equal(url.searchParams.get("subject"), "Site feedback: problem");
  assert.equal(url.searchParams.get("body"), "Type: problem\nEmail: ada@example.com\n\nThe market date is wrong.");

  const anon = new URL(feedbackMailto({
    type: "event correction",
    message: "Queens Park starts at 7.",
    email: "  ",
  }));
  assert.equal(anon.searchParams.get("subject"), "Site feedback: event correction");
  assert.equal(anon.searchParams.get("body"), "Type: event correction\n\nQueens Park starts at 7.");

  const unknown = new URL(feedbackMailto({ type: "secret", message: "Hello" }));
  assert.equal(unknown.searchParams.get("subject"), "Site feedback: other");
});

test("the feedback page builds and every footer links to it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wot-feedback-"));
  await mkdir(path.join(root, "data"), { recursive: true });
  await writeFile(path.join(root, "index.html"), INDEX);
  await writeFile(path.join(root, "things-to-do.html"), THINGS);
  await writeFile(path.join(root, "share.html"), `<!DOCTYPE html><html><body><footer class="site-footer"><div class="wrap"><p>Share</p></div></footer></body></html>`);
  await writeFile(path.join(root, "thanks.html"), `<!DOCTYPE html><html><body><footer class="site-footer"><div class="wrap"><p>Thanks</p></div></footer></body></html>`);
  await writeFile(path.join(root, "credits.html"), `<!DOCTYPE html><html><body><footer class="site-footer"><div class="wrap"><p>Credits</p></div></footer></body></html>`);
  await writeFile(path.join(root, "data", "events.json"), JSON.stringify({ generatedAt: "2026-10-22T10:24:20.874Z", events: [sampleEvent()] }));
  await writeFile(path.join(root, "data", "submissions.json"), JSON.stringify({ items: [] }));
  await writeFile(path.join(root, "data", "things-to-do.json"), JSON.stringify({ places: [] }));

  await generateSite({ root, now: NOW });

  const page = await readFile(path.join(root, "feedback", "index.html"), "utf8");
  assert.match(page, /<h1>Send feedback<\/h1>/);
  assert.match(page, /id="feedback-form"/);
  assert.match(page, /action="mailto:whatsontoowoomba@agentmail\.to"/);
  assert.match(page, /\/js\/feedback\.js/);
  assert.match(page, /value="suggestion"/);
  assert.match(page, /value="problem"/);
  assert.match(page, /value="event correction"/);
  assert.match(page, /value="other"/);
  const message = page.match(/<textarea[^>]*name="message"[^>]*>/)[0];
  assert.match(message, /required/);
  const email = page.match(/<input[^>]*name="email"[^>]*>/)[0];
  assert.equal(email.includes("required"), false);
  assert.doesNotMatch(page, /Aneesh/);
  assert.doesNotMatch(page, /formsubmit/i);
  assert.match(page, /href="\/feedback\/"/);

  const pages = [
    "index.html",
    "things-to-do.html",
    "share.html",
    "thanks.html",
    "credits.html",
    "events/abc123/index.html",
    "search/index.html",
    "404.html",
    "feedback/index.html",
  ];
  for (const rel of pages) {
    const html = await readFile(path.join(root, rel), "utf8");
    assert.match(html, /<footer class="site-footer">/, rel);
    assert.match(html, /<a href="\/feedback\/">Send feedback<\/a>/, rel);
  }

  const built = buildSite({
    events: [sampleEvent()],
    submissions: { items: [] },
    places: [],
    now: NOW,
    generatedAt: "2026-10-22T10:24:20.874Z",
    indexHtml: INDEX,
    thingsHtml: THINGS,
  });
  for (const [rel, html] of built.files) {
    if (!rel.endsWith(".html")) continue;
    assert.match(html, /<a href="\/feedback\/">Send feedback<\/a>/, rel);
  }
  assert.match(built.indexHtml, /<a href="\/feedback\/">Send feedback<\/a>/);
  assert.match(built.thingsHtml, /<a href="\/feedback\/">Send feedback<\/a>/);
  assert.match(built.files.get("sitemap.xml"), /<loc>https:\/\/whatsontoowoomba\.au\/feedback\/<\/loc>/);
});
