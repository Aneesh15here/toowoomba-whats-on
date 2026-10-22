import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { payloadFromForm, requirementsFor } from "../js/share.js";
import { main, runPublish } from "../scripts/publish-submissions.mjs";
import { makeId } from "../scripts/pure.mjs";
import {
  ADMIN_INBOX,
  classifySubject,
  fieldsFromEmail,
  hiddenNoticeText,
  ingestMailbox,
  isPublicSubmission,
  REPORT_THRESHOLD,
  reportHelp,
  serialiseState,
  validateSubmission,
} from "../scripts/submissions.mjs";

const NOW = new Date("2026-10-22T01:00:00.000Z");
const FROM = "FormSubmit <submissions@formsubmit.co>";

function table(fields) {
  const rows = Object.entries(fields)
    .map(([key, value]) => `<tr><td>${key}</td><td>${value}</td></tr>`)
    .join("");
  return `<table>${rows}</table>`;
}

function eventFields(overrides = {}) {
  return {
    name: "Sam",
    email: "sam@example.com",
    type: "event",
    title: "Night market",
    date: "2026-11-02",
    start_time: "18:00",
    end_time: "21:00",
    venue: "Queens Park",
    suburb_or_address: "Queens Park, Toowoomba QLD",
    price: "Free",
    age_group: "Families/All ages",
    community: "Multicultural/All",
    category: "Markets",
    items: "",
    source_link: "https://example.com/market",
    message: "Food stalls and live music in the park.",
    hp_field: "",
    ...overrides,
  };
}

function message(id, fields, extras = {}) {
  return {
    id,
    from: extras.from || FROM,
    subject: extras.subject || `What's On Toowoomba: ${fields.type}: ${fields.title}`,
    text: extras.text || "",
    html: extras.html || table(fields),
  };
}

function publish(messages, state = {}, events = []) {
  return ingestMailbox({
    items: state.items || [],
    handledMessageIds: state.handledMessageIds || [],
    events,
    messages,
    now: NOW,
  });
}

test("sample submission is published and one report hides it", () => {
  assert.equal(REPORT_THRESHOLD, 1);
  const submitted = publish([message("msg_sample_1", eventFields())]);
  assert.equal(submitted.results[0].action, "published");
  assert.equal(submitted.items.length, 1);
  const item = submitted.items[0];
  assert.equal(item.status, "published");
  assert.equal(item.kind, "event");
  assert.equal(item.title, "Night market");
  assert.equal(item.start, "2026-11-02T18:00:00+10:00");
  assert.equal(item.end, "2026-11-02T21:00:00+10:00");
  assert.equal(item.allDay, false);
  assert.equal(item.suburb, "Toowoomba");
  assert.equal(item.venue, "Queens Park");
  assert.equal(item.price, "Free");
  assert.equal(item.sourceUrl, "https://example.com/market");
  assert.ok(item.categories.includes("markets"));
  assert.ok(item.categories.includes("free"));
  assert.deepEqual(item.ageGroups, ["families"]);
  assert.equal(item.id, `sub${makeId(["msg_sample_1"])}`);
  assert.equal(isPublicSubmission(item, NOW), true);
  const publishedJson = JSON.stringify(item);
  assert.doesNotMatch(publishedJson, /sam@example\.com/i);
  assert.doesNotMatch(publishedJson, /"Sam"/);

  const flagged = publish([
    message("msg_flag_1", {
      listing_id: item.id,
      listing_title: item.title,
      reason: "The date is wrong",
      hp_field: "",
    }, { subject: `What's On Toowoomba FLAG: ${item.id}` }),
  ], submitted);
  assert.equal(flagged.results[0].action, "flag-hidden");
  assert.equal(flagged.items.length, 1);
  assert.equal(flagged.items[0].status, "hidden");
  assert.equal(flagged.items[0].reportCount, 1);
  assert.equal(isPublicSubmission(flagged.items[0], NOW), false);
  assert.equal(flagged.newlyHidden.length, 1);
  assert.match(hiddenNoticeText(flagged.newlyHidden[0]), /hidden pending review/);
  assert.match(hiddenNoticeText(flagged.newlyHidden[0]), new RegExp(item.id));

  const again = publish([
    message("msg_flag_2", {
      listing_id: item.id,
      listing_title: item.title,
      reason: "Still wrong",
      hp_field: "",
    }, { subject: `What's On Toowoomba FLAG: ${item.id}` }),
  ], flagged);
  assert.equal(again.results[0].action, "flag-recorded");
  assert.equal(again.newlyHidden.length, 0);
  assert.equal(again.items[0].reportCount, 2);
  assert.equal(again.items[0].status, "hidden");
});

test("the hide confirmation is emailed to the admin inbox", async () => {
  const fields = eventFields();
  const sent = [];
  const first = await runPublish({
    client: fakeClient({
      messages: [
        { messageId: "msg_sample_1", subject: `What's On Toowoomba: event: ${fields.title}`, from: FROM },
      ],
      bodies: { msg_sample_1: message("msg_sample_1", fields) },
    }, sent),
    state: { items: [], handledMessageIds: [] },
    now: NOW,
  });
  assert.equal(first.items[0].status, "published");
  assert.equal(sent.length, 0);
  const flag = message("msg_flag_1", {
    listing_id: first.items[0].id,
    listing_title: first.items[0].title,
    reason: "Wrong date",
    hp_field: "",
  }, { subject: `What's On Toowoomba FLAG: ${first.items[0].id}` });
  const second = await runPublish({
    client: fakeClient({
      messages: [{ messageId: "msg_flag_1", subject: flag.subject, from: FROM }],
      bodies: { msg_flag_1: flag },
    }, sent),
    state: first,
    now: NOW,
  });
  assert.equal(second.items[0].status, "hidden");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, `What's On Toowoomba HIDDEN: ${first.items[0].id}`);
  assert.deepEqual(sent[0].to, [ADMIN_INBOX]);
  assert.equal(second.newlyHidden[0].notified, true);
});

test("a failed hide email still hides the listing", async () => {
  const fields = eventFields();
  const sent = [];
  const client = fakeClient({
    messages: [{ messageId: "msg_sample_1", subject: "What's On Toowoomba: event: Night market", from: FROM }],
    bodies: { msg_sample_1: message("msg_sample_1", fields) },
  }, sent);
  const first = await runPublish({ client, state: { items: [], handledMessageIds: [] }, now: NOW });
  const failing = fakeClient({
    messages: [{ messageId: "msg_flag_1", subject: `What's On Toowoomba FLAG: ${first.items[0].id}`, from: FROM }],
    bodies: {
      msg_flag_1: message("msg_flag_1", {
        listing_id: first.items[0].id,
        listing_title: "Night market",
        reason: "Wrong",
        hp_field: "",
      }, { subject: `What's On Toowoomba FLAG: ${first.items[0].id}` }),
    },
  }, sent);
  failing.inboxes.messages.send = async () => {
    throw new Error("mailbox unavailable");
  };
  const second = await runPublish({ client: failing, state: first, now: NOW });
  assert.equal(second.items[0].status, "hidden");
  assert.equal(second.newlyHidden[0].notified, false);
  assert.match(second.newlyHidden[0].notifyError, /unavailable/);
});

test("handled inbox messages are not fetched again", async () => {
  const gets = [];
  const client = {
    inboxes: {
      messages: {
        async list() {
          return {
            messages: [
              { messageId: "msg_done", subject: "What's On Toowoomba: event: Old", from: FROM },
              { messageId: "msg_new", subject: "What's On Toowoomba: event: New", from: FROM },
            ],
          };
        },
        async get(_inbox, id) {
          gets.push(id);
          return {
            messageId: id,
            from: "person@example.com",
            subject: "What's On Toowoomba: event: New",
            text: "",
            html: "",
          };
        },
        async send() {
          return {};
        },
      },
    },
  };
  await runPublish({
    client,
    state: { items: [], handledMessageIds: ["msg_done"] },
    now: NOW,
  });
  assert.deepEqual(gets, ["msg_new"]);
});

test("garage sales need a start time, items, and a Toowoomba location", () => {
  const garage = eventFields({
    type: "garage-sale",
    title: "Saturday clear out",
    date: "2026-11-07",
    start_time: "08:00",
    end_time: "12:00",
    venue: "",
    suburb_or_address: "9 Tame St, South Toowoomba QLD 4350",
    price: "Free",
    category: "Garage sales",
    items: "Furniture, tools, and books.",
    message: "Everything must go by noon.",
    source_link: "",
  });
  const published = publish([message("msg_garage", garage)]);
  assert.equal(published.results[0].action, "published");
  assert.equal(published.items[0].kind, "garage");
  assert.equal(published.items[0].suburb, "South Toowoomba");
  assert.match(published.items[0].address, /Tame St/);
  assert.match(published.items[0].items, /Furniture/);
  assert.equal(published.items[0].start, "2026-11-07T08:00:00+10:00");
  assert.ok(published.items[0].categories.includes("garage"));

  const missingItems = validateSubmission(eventFields({ type: "garage-sale", items: "" }), NOW);
  assert.equal(missingItems.ok, false);
  assert.ok(missingItems.errors.includes("items"));
  const missingStart = validateSubmission(eventFields({ start_time: "" }), NOW);
  assert.ok(missingStart.errors.includes("start_time"));
  const missingPlace = validateSubmission(eventFields({ suburb_or_address: "" }), NOW);
  assert.ok(missingPlace.errors.includes("location"));
  const away = validateSubmission(eventFields({ suburb_or_address: "Kingaroy QLD 4610" }), NOW);
  assert.ok(away.errors.includes("region"));
});

test("a notice can be all day when it has a location and a date", () => {
  const notice = eventFields({
    type: "notice",
    title: "Road closure",
    date: "2026-11-03",
    start_time: "",
    end_time: "",
    venue: "",
    suburb_or_address: "Highfields",
    category: "",
    items: "",
    source_link: "",
    message: "The main street is closed for the morning.",
  });
  const published = publish([message("msg_notice", notice)]);
  assert.equal(published.results[0].action, "published");
  assert.equal(published.items[0].kind, "notice");
  assert.equal(published.items[0].allDay, true);
  assert.equal(published.items[0].suburb, "Highfields");
  assert.equal(isPublicSubmission(published.items[0], NOW), true);
});

test("spam guards reject honeypots, length, links, profanity, shorteners, and finished listings", () => {
  const honeypot = publish([message("msg_honey", eventFields({ hp_field: "https://spam.example" }))]);
  assert.equal(honeypot.results[0].action, "rejected");
  assert.equal(honeypot.results[0].reason, "honeypot");
  assert.equal(honeypot.items.length, 0);
  assert.ok(honeypot.handledMessageIds.includes("msg_honey"));

  const longTitle = publish([message("msg_long", eventFields({ title: "A".repeat(201) }))]);
  assert.match(longTitle.results[0].reason, /title length/);

  const links = publish([message("msg_links", eventFields({
    message: "See https://a.example, https://b.example and https://c.example for the stall map today.",
  }))]);
  assert.match(links.results[0].reason, /url/);

  const profane = publish([message("msg_profane", eventFields({ message: "This fucking market is cancelled." }))]);
  assert.match(profane.results[0].reason, /profanity/);

  const short = publish([message("msg_short", eventFields({ message: "Details are at https://bit.ly/abcd today." }))]);
  assert.match(short.results[0].reason, /shortener/);

  const finished = publish([message("msg_past", eventFields({ date: "2026-10-21" }))]);
  assert.match(finished.results[0].reason, /finished/);

  const direct = publish([message("msg_direct", eventFields(), { from: "spammer@example.net" })]);
  assert.equal(direct.results[0].action, "skipped-sender");
  assert.equal(direct.items.length, 0);
  assert.equal(direct.handledMessageIds.includes("msg_direct"), false);
});

test("duplicates and a hidden listing are not published again", () => {
  const first = publish([message("msg_one", eventFields())]);
  const second = publish([message("msg_two", eventFields())], first);
  assert.equal(second.results[0].action, "duplicate");
  assert.equal(second.items.length, 1);

  const flagged = publish([
    message("msg_flag", {
      listing_id: first.items[0].id,
      listing_title: "Night market",
      reason: "",
      hp_field: "",
    }, { subject: `What's On Toowoomba FLAG: ${first.items[0].id}` }),
  ], first);
  const retry = publish([message("msg_three", eventFields())], flagged);
  assert.equal(retry.results[0].action, "duplicate");
  assert.equal(retry.items[0].status, "hidden");
});

test("a collected listing with the same title and place blocks the submission", () => {
  const result = publish([message("msg_one", eventFields())], {}, [
    {
      kind: "event",
      title: "Night market",
      start: "2026-11-02T18:00:00+10:00",
      venue: "Queens Park",
      suburb: "Toowoomba",
    },
  ]);
  assert.equal(result.results[0].action, "duplicate");
  assert.equal(result.results[0].reason, "already collected");
  assert.equal(result.items.length, 0);
  assert.equal(result.handledMessageIds.includes("msg_one"), false);
});

test("past rows expire and a bad flag does not hide a listing", () => {
  const stale = {
    id: "subaaaaaaaaaaaaaaaa",
    status: "published",
    kind: "event",
    title: "Last week",
    start: "2026-10-01T10:00:00+10:00",
    end: null,
    allDay: false,
    venue: "Hall",
    suburb: "Toowoomba",
    address: "",
    price: "Free",
    ageGroups: ["families"],
    communities: ["multicultural"],
    categories: [],
    source: "submission",
    sourceUrl: "share.html",
    items: "",
    summary: "Already finished.",
    messageId: "msg_old",
    reportCount: 0,
    reportMessageIds: [],
  };
  const expired = publish([], { items: [stale] });
  assert.equal(expired.expiredCount, 1);
  assert.equal(expired.items.length, 0);

  const live = publish([message("msg_sample_1", eventFields())]);
  const poisoned = publish([
    message("msg_bad_flag", {
      listing_id: live.items[0].id,
      listing_title: "Night market",
      reason: "spam",
      hp_field: "filled",
    }, { subject: `What's On Toowoomba FLAG: ${live.items[0].id}` }),
  ], live);
  assert.equal(poisoned.results[0].action, "flag-rejected");
  assert.equal(poisoned.items[0].status, "published");

  const unknown = publish([
    message("msg_missing", {
      listing_id: "sub0123456789abcdef",
      listing_title: "Nope",
      reason: "",
      hp_field: "",
    }, { subject: "What's On Toowoomba FLAG: sub0123456789abcdef" }),
  ]);
  assert.equal(unknown.results[0].action, "flag-unknown");
});

test("email bodies can be an HTML table, loose text, or a JSON payload", () => {
  const html = fieldsFromEmail({ html: table(eventFields()) });
  assert.equal(html.title, "Night market");
  assert.equal(html.email, "sam@example.com");
  const text = fieldsFromEmail({
    text: "type: notice\ntitle: Road closure\ndate: 2026-11-03\nsuburb_or_address: Highfields\nmessage: The main street is closed.\nemail: sam@example.com\n",
  });
  assert.equal(text.type, "notice");
  assert.equal(text.suburb_or_address, "Highfields");
  const payload = JSON.stringify(eventFields({ title: "Payload market" }));
  const fromPayload = fieldsFromEmail({
    html: table({ payload: payload.replaceAll('"', "&quot;") }),
  });
  assert.equal(fromPayload.title, "Payload market");
  const checked = validateSubmission(fromPayload, NOW);
  assert.equal(checked.ok, true);
  assert.equal(checked.item.title, "Payload market");
});

test("subject classification ignores replies and our own hide notices", () => {
  assert.equal(classifySubject("What's On Toowoomba: event: Night market").type, "submission");
  assert.equal(classifySubject("What's On Toowoomba FLAG: sub0123456789abcdef").type, "flag");
  assert.equal(classifySubject("What's On Toowoomba HIDDEN: sub0123456789abcdef").type, "hidden-notice");
  assert.equal(classifySubject("Re: What's On Toowoomba: event: Night market").type, "ignore");
});

test("an all-day event is not shown and an approved timed row still is", () => {
  const base = {
    title: "Story time",
    start: "2026-11-02T10:00:00+10:00",
    allDay: false,
    kind: "event",
    status: "approved",
    venue: "Library",
    suburb: "Toowoomba",
  };
  assert.equal(isPublicSubmission(base, NOW), true);
  assert.equal(isPublicSubmission({ ...base, allDay: true }, NOW), false);
  assert.equal(isPublicSubmission({ ...base, status: "hidden" }, NOW), false);
  assert.equal(isPublicSubmission({ ...base, venue: "", suburb: "", address: "" }, NOW), false);
});

test("share form keeps the intake, honeypot, and type-specific requirements", () => {
  const html = readFileSync(new URL("../share.html", import.meta.url), "utf8");
  assert.match(html, /action="https:\/\/formsubmit\.co\/whatsontoowoomba@agentmail\.to"/);
  assert.match(html, /name="_captcha" value="true"/);
  assert.match(html, /name="_honey"/);
  assert.match(html, /name="hp_field"/);
  assert.match(html, /name="payload"/);
  assert.match(html, /name="suburb_or_address"[^>]*required/);
  assert.match(html, /Suburb or address \(required\)/);
  assert.doesNotMatch(html.match(/name="start_time"[^>]*/)?.[0] || "", /\brequired\b/);
  assert.deepEqual(requirementsFor("garage-sale"), { startTime: true, items: true });
  assert.deepEqual(requirementsFor("event"), { startTime: true, items: false });
  assert.deepEqual(requirementsFor("notice"), { startTime: false, items: false });
  assert.deepEqual(requirementsFor("other"), { startTime: false, items: false });
  const encoded = payloadFromForm({
    elements: {
      namedItem(name) {
        return { value: name === "title" ? "Night market" : "" };
      },
    },
  });
  assert.equal(JSON.parse(encoded).title, "Night market");
  assert.equal(Object.hasOwn(JSON.parse(encoded), "email"), false);
});

test("public pages do not name a person or use a personal email", () => {
  const files = [
    "README.md",
    "index.html",
    "share.html",
    "thanks.html",
    "js/app.js",
    "js/share.js",
    "js/thanks.js",
    "css/styles.css",
    "package.json",
    "data/submissions.json",
    "scripts/collect.mjs",
    "scripts/submissions.mjs",
    "scripts/publish-submissions.mjs",
    "scripts/pure.mjs",
    "scripts/parse.mjs",
    ".github/workflows/collect.yml",
    ".github/workflows/publish.yml",
  ];
  const blob = files
    .map((file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8"))
    .join("\n");
  assert.doesNotMatch(blob, /aneesh/i);
  assert.doesNotMatch(blob, /grokbot/i);
  const emails = blob.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const unexpected = emails.filter((email) => email.toLowerCase() !== "whatsontoowoomba@agentmail.to");
  assert.deepEqual(unexpected, []);
  assert.match(readFileSync(new URL("../index.html", import.meta.url), "utf8"), /Contact admin/);
  assert.match(readFileSync(new URL("../share.html", import.meta.url), "utf8"), /id="contact-admin"/);
  assert.match(readFileSync(new URL("../thanks.html", import.meta.url), "utf8"), /Contact admin/);
  assert.match(reportHelp(), /One report hides this listing/);
});

test("publishing without an API key does not throw", async () => {
  const previous = process.env.AGENTMAIL_API_KEY;
  delete process.env.AGENTMAIL_API_KEY;
  try {
    await main();
  } finally {
    if (previous) process.env.AGENTMAIL_API_KEY = previous;
  }
});

test("a second pass with no new mail leaves the file unchanged", () => {
  const first = publish([message("msg_sample_1", eventFields())]);
  const second = publish([], first);
  assert.equal(second.changed, false);
  assert.equal(serialiseState(first), serialiseState(second));
});

function fakeClient(seed, sent) {
  const client = {
    listed: seed.messages,
    bodies: seed.bodies,
    inboxes: {
      messages: {
        async list() {
          return { messages: client.listed };
        },
        async get(_inbox, id) {
          const body = client.bodies[id];
          return {
            messageId: id,
            from: body?.from || FROM,
            subject: body?.subject || "",
            extractedText: body?.text || "",
            extractedHtml: body?.html || "",
            text: body?.text || "",
            html: body?.html || "",
          };
        },
        async send(_inbox, request) {
          sent.push(request);
          return { messageId: "msg_sent" };
        },
      },
    },
  };
  return client;
}
