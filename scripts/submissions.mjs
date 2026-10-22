/**
 * Validate community submissions and public reports.
 * No Node built-ins: the calendar page can import the same checks.
 * The hourly Action reads the admin inbox and applies the result.
 */

import {
  AGE_GROUPS,
  CATEGORIES,
  COMMUNITIES,
  addDays,
  brisbaneYmd,
  cityBeforeState,
  decodeHtml,
  htmlToText,
  inToowoombaRegion,
  isPast,
  makeId,
  normaliseTitle,
  pad,
  tagListing,
} from "./pure.mjs";

export const ADMIN_INBOX = "whatsontoowoomba@agentmail.to";
export const REPORT_THRESHOLD = 1;
export const SUBJECT_MARK = "What's On Toowoomba";
export const DEFAULT_FROM_SUFFIX = "formsubmit.co";
export const MAX_PER_RUN = 40;
export const HANDLED_LIMIT = 2000;

export const FIELD_LIMITS = {
  name: 200,
  email: 200,
  type: 40,
  title: 200,
  date: 20,
  start_time: 8,
  end_time: 8,
  venue: 200,
  suburb_or_address: 200,
  price: 80,
  age_group: 80,
  community: 80,
  category: 80,
  items: 1000,
  source_link: 500,
  message: 2000,
  reason: 500,
  listing_id: 32,
  listing_title: 200,
  hp_field: 200,
  page: 500,
  payload: 20000,
};

const ITEM_KEYS = [
  "id",
  "status",
  "kind",
  "title",
  "start",
  "end",
  "allDay",
  "venue",
  "suburb",
  "address",
  "price",
  "ageGroups",
  "communities",
  "categories",
  "source",
  "sourceUrl",
  "items",
  "summary",
  "messageId",
  "reportCount",
  "reportMessageIds",
  "publishedAt",
];

const PROFANITY = /\b(?:fuck(?:ing|er|ed)?|shit(?:ty)?|bitch(?:es)?|asshole|cunt|dickhead|porn|xxx|viagra|cialis|casino)\b/i;
const URL_SOURCE = "\\b(?:https?:\\/\\/|www\\.)[^\\s<>\"']+";
const SHORTENER = /(?:^|\.)(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy|tiny\.cc|ow\.ly|buff\.ly)$/i;
const REPEAT = /(.)\1{9,}/;

export function reportHelp() {
  if (REPORT_THRESHOLD === 1) {
    return "One report hides this listing on the next automatic check and emails the admin inbox.";
  }
  return `${REPORT_THRESHOLD} reports hide this listing on the next automatic check and email the admin inbox.`;
}

export function hiddenNoticeText(entry) {
  const rule = REPORT_THRESHOLD === 1
    ? "One report is enough, so it is hidden pending review."
    : `${REPORT_THRESHOLD} reports hide a listing pending review.`;
  return [
    `A public report hid this community listing. ${rule}`,
    "",
    `Title: ${entry.title}`,
    `Id: ${entry.id}`,
    `Reports: ${entry.reportCount}`,
    "",
    "The report is the earlier message in this inbox. To show the listing again, set its status to \"published\" in data/submissions.json.",
  ].join("\n");
}

export function classifySubject(subject) {
  const value = String(subject || "").trim();
  if (/^\s*(re|fwd|fw)\s*:/i.test(value)) return { type: "ignore" };
  const flag = value.match(/What's On Toowoomba FLAG:\s*(sub[a-f0-9]{16})/i);
  if (flag) return { type: "flag", id: flag[1].toLowerCase() };
  const hidden = value.match(/What's On Toowoomba HIDDEN:\s*(sub[a-f0-9]{16})/i);
  if (hidden) return { type: "hidden-notice", id: hidden[1].toLowerCase() };
  if (/What's On Toowoomba\s*:/i.test(value)) return { type: "submission" };
  return { type: "ignore" };
}

export function senderAllowed(from, suffix = DEFAULT_FROM_SUFFIX) {
  const host = String(suffix || DEFAULT_FROM_SUFFIX).replace(/^\./, "").toLowerCase();
  return String(from || "").toLowerCase().includes(`@${host}`);
}

export function fieldsFromEmail({ text = "", html = "" } = {}) {
  const safeText = String(text || "").slice(0, 100_000);
  const safeHtml = String(html || "").slice(0, 100_000);
  const fromHtml = parseHtmlTable(safeHtml);
  const base = fromHtml.title ? fromHtml : { ...parseLooseText(safeText), ...fromHtml };
  const payload = tryParsePayload(base.payload);
  if (!payload) return base;
  const merged = { ...payload };
  for (const [key, value] of Object.entries(base)) {
    if (key === "payload") continue;
    if (String(value ?? "").trim() !== "") merged[key] = String(value);
  }
  return merged;
}

export function validateSubmission(fields, now = new Date()) {
  const errors = [];
  if (String(fields?.hp_field || fields?._honey || "").trim()) {
    return { ok: false, errors: ["honeypot"], item: null };
  }
  for (const [key, limit] of Object.entries(FIELD_LIMITS)) {
    if (String(fields?.[key] || "").trim().length > limit) errors.push(`${key} length`);
  }
  const extraLong = Object.entries(fields || {}).some(([key, value]) => (
    !Object.hasOwn(FIELD_LIMITS, key) && String(value || "").length > 2000
  ));
  if (extraLong) errors.push("field length");
  if (errors.length) return { ok: false, errors, item: null };

  const type = String(fields.type || "").trim();
  const kind = kindFor(type);
  if (!kind) errors.push("type");
  const title = oneLine(fields.title);
  const message = oneLine(fields.message);
  const location = oneLine(fields.suburb_or_address);
  const venue = oneLine(fields.venue);
  const items = oneLine(fields.items);
  const price = oneLine(fields.price) || "See listing";
  const email = oneLine(fields.email);
  const date = oneLine(fields.date);
  const startTime = oneLine(fields.start_time);
  const endTime = oneLine(fields.end_time);

  if (title.length < 3 || !/[a-z]/i.test(title)) errors.push("title");
  if (message.length < 3) errors.push("message");
  if (location.length < 3) errors.push("location");
  if (!isEmail(email)) errors.push("email");
  if (!isRealDate(date)) errors.push("date");
  if (kind === "event" || kind === "garage") {
    if (!startTime) errors.push("start_time");
  }
  if (kind === "garage" && (items.length < 3 || !/[a-z]/i.test(items) || isOnlyUrl(items))) {
    errors.push("items");
  }
  if (location && !inToowoombaRegion([venue, location])) errors.push("region");
  if (date && isRealDate(date) && date > addDays(brisbaneYmd(now), 549)) errors.push("too far ahead");

  const clock = buildWhen(date, startTime, endTime);
  if ((kind === "event" || kind === "garage" || startTime || endTime) && !clock) {
    if (!errors.includes("date") && !errors.includes("start_time")) errors.push("start_time");
  }
  if (clock?.error) errors.push(clock.error);

  const link = checkLink(fields.source_link);
  if (!link.ok) errors.push("source_link");

  const scanned = [title, message, items, venue, location, price, oneLine(fields.name)].join("\n");
  if (PROFANITY.test(scanned) || PROFANITY.test(String(fields.payload || ""))) errors.push("profanity");
  if (REPEAT.test(title) || REPEAT.test(message)) errors.push("repeated characters");
  if (/^(?:https?:\/\/|www\.)\S+$/i.test(title)) errors.push("url");
  const freeUrls = urlsIn([title, message, items, venue, location, price].join("\n")).length;
  if (freeUrls > 2) errors.push("url");
  if (fieldsContainShortener(scanned)) errors.push("shortener");

  if (errors.length || !clock || clock.error || !kind) {
    return { ok: false, errors: unique(errors), item: null };
  }
  if (isPast({ start: clock.start, end: clock.end, allDay: clock.allDay }, now)) {
    return { ok: false, errors: ["finished"], item: null };
  }

  const place = placeFrom(venue, location);
  const summary = message;
  const tags = tagListing({
    title,
    venue: place.venue,
    suburb: place.suburb,
    summary,
    items: kind === "garage" ? items : "",
    price,
    kind,
  });
  const age = idFromLabel(AGE_GROUPS, fields.age_group);
  const community = idFromLabel(COMMUNITIES, fields.community);
  const category = idFromLabel(CATEGORIES, fields.category);
  if (age) tags.ageGroups = age === "kids" ? ["kids", "families"] : [age];
  if (community) tags.communities = [community];
  if (category && !tags.categories.includes(category)) tags.categories.push(category);

  return {
    ok: true,
    errors: [],
    item: {
      status: "published",
      kind,
      title,
      start: clock.start,
      end: clock.end,
      allDay: clock.allDay,
      venue: place.venue,
      suburb: place.suburb,
      address: place.address,
      price: price.slice(0, FIELD_LIMITS.price),
      ageGroups: tags.ageGroups,
      communities: tags.communities,
      categories: tags.categories,
      source: "submission",
      sourceUrl: link.url || "share.html",
      items: kind === "garage" ? items : "",
      summary,
    },
  };
}

export function isPublicSubmission(item, now = new Date()) {
  if (!item || typeof item !== "object") return false;
  if (item.status !== "published" && item.status !== "approved") return false;
  if (!String(item.title || "").trim() || !item.start) return false;
  if (isPast(item, now)) return false;
  const kind = item.kind === "garage" || item.kind === "notice" ? item.kind : "event";
  const located = [item.venue, item.suburb, item.address].some((part) => String(part || "").trim());
  if (!located) return false;
  if (kind === "garage" && !String(item.items || "").trim()) return false;
  if ((kind === "event" || kind === "garage") && item.allDay) return false;
  return true;
}

export function submissionKey(item) {
  const day = brisbaneYmd(new Date(item.start));
  const place = normaliseTitle([item.venue, item.address || item.suburb].filter(Boolean).join(" "));
  return [item.kind || "event", normaliseTitle(item.title), day, place].join("|");
}

export function serialiseState(state) {
  return `${JSON.stringify({
    items: (state.items || []).map(publicItem),
    handledMessageIds: state.handledMessageIds || [],
  }, null, 2)}\n`;
}

export function ingestMailbox({
  items = [],
  handledMessageIds = [],
  events = [],
  messages = [],
  now = new Date(),
  fromSuffix = DEFAULT_FROM_SUFFIX,
} = {}) {
  let nextItems = items.map((item) => publicItem({
    ...item,
    reportMessageIds: [...(item.reportMessageIds || [])],
  }));
  let handled = [...handledMessageIds];
  const results = [];
  const newlyHidden = [];
  let expiredCount = 0;
  const kept = [];
  for (const item of nextItems) {
    if (isPast(item, now)) {
      expiredCount += 1;
      continue;
    }
    kept.push(item);
  }
  nextItems = kept;

  for (const message of messages) {
    if (!message?.id) continue;
    if (handled.includes(message.id)) {
      results.push({ messageId: message.id, action: "already-handled", reason: "" });
      continue;
    }
    const outcome = applyMessage({
      message,
      items: nextItems,
      events,
      now,
      fromSuffix,
    });
    results.push({ messageId: message.id, action: outcome.action, reason: outcome.reason || "" });
    if (outcome.item) nextItems.push(outcome.item);
    if (outcome.newlyHidden) newlyHidden.push(outcome.newlyHidden);
    if (outcome.remember) handled = remember(handled, message.id);
  }

  nextItems.sort((a, b) => (
    String(a.start).localeCompare(String(b.start))
    || String(a.title).localeCompare(String(b.title))
    || String(a.id).localeCompare(String(b.id))
  ));
  const state = { items: nextItems.map(publicItem), handledMessageIds: handled };
  return {
    ...state,
    results,
    newlyHidden,
    expiredCount,
    changed: serialiseState({ items, handledMessageIds }) !== serialiseState(state),
  };
}

function applyMessage({ message, items, events, now, fromSuffix }) {
  const classified = classifySubject(message.subject);
  switch (classified.type) {
    case "ignore":
      return { action: "ignored", remember: true };
    case "hidden-notice":
      return { action: "hidden-notice", remember: true };
    case "flag":
      return applyFlag(message, classified.id, items);
    case "submission":
      return applySubmission(message, items, events, now, fromSuffix);
    default: {
      const unexpected = classified.type;
      throw new Error(`Unexpected message type: ${unexpected}`);
    }
  }
}

function applyFlag(message, id, items) {
  if (!senderAllowed(message.from)) {
    return { action: "skipped-sender", reason: String(message.from || ""), remember: false };
  }
  const fields = fieldsFromEmail(message);
  if (String(fields.hp_field || fields._honey || "").trim()) {
    return { action: "flag-rejected", reason: "honeypot", remember: true };
  }
  if (String(fields.reason || "").trim().length > FIELD_LIMITS.reason) {
    return { action: "flag-rejected", reason: "reason length", remember: true };
  }
  const bodyId = String(fields.listing_id || "").trim().toLowerCase();
  if (bodyId !== id) {
    return { action: "flag-rejected", reason: "listing id", remember: true };
  }
  const item = items.find((entry) => entry.id === id);
  if (!item) return { action: "flag-unknown", reason: id, remember: true };
  if ((item.reportMessageIds || []).includes(message.id)) {
    return { action: "flag-recorded", remember: true };
  }
  item.reportMessageIds = [...(item.reportMessageIds || []), message.id];
  item.reportCount = item.reportMessageIds.length;
  const wasHidden = item.status === "hidden";
  if (item.reportCount >= REPORT_THRESHOLD) item.status = "hidden";
  const newlyHidden = !wasHidden && item.status === "hidden"
    ? {
      id: item.id,
      title: item.title,
      reportCount: item.reportCount,
      reason: oneLine(fields.reason).slice(0, FIELD_LIMITS.reason),
    }
    : null;
  return {
    action: newlyHidden ? "flag-hidden" : "flag-recorded",
    newlyHidden,
    remember: true,
  };
}

function applySubmission(message, items, events, now, fromSuffix) {
  if (!senderAllowed(message.from, fromSuffix)) {
    return { action: "skipped-sender", reason: String(message.from || ""), remember: false };
  }
  const tooLong = String(message.text || "").length + String(message.html || "").length > 100_000;
  if (tooLong) return { action: "rejected", reason: "too long", remember: true };
  if (items.some((item) => item.messageId === message.id)) {
    return { action: "already-published", remember: true };
  }
  const fields = fieldsFromEmail(message);
  const validated = validateSubmission(fields, now);
  if (!validated.ok) {
    return { action: "rejected", reason: validated.errors.join(", "), remember: true };
  }
  const id = submissionId(message.id, items);
  const item = publicItem({
    ...validated.item,
    id,
    messageId: message.id,
    reportCount: 0,
    reportMessageIds: [],
    publishedAt: now.toISOString(),
  });
  const key = submissionKey(item);
  if (items.some((existing) => submissionKey(existing) === key)) {
    return { action: "duplicate", reason: key, remember: true };
  }
  if (events.some((existing) => existing?.start && submissionKey(existing) === key)) {
    return { action: "duplicate", reason: "already collected", remember: false };
  }
  return { action: "published", item, remember: true };
}

function submissionId(messageId, items) {
  const base = `sub${makeId([String(messageId)])}`;
  const clash = items.some((item) => item.id === base && item.messageId !== messageId);
  return clash ? `sub${makeId([String(messageId), "2"])}` : base;
}

function publicItem(item) {
  const output = {};
  for (const key of ITEM_KEYS) {
    if (item?.[key] !== undefined) output[key] = item[key];
  }
  if (output.reportMessageIds) output.reportMessageIds = [...output.reportMessageIds];
  return output;
}

function remember(ids, id) {
  if (!id || ids.includes(id)) return ids;
  return [...ids, id].slice(-HANDLED_LIMIT);
}

function kindFor(type) {
  switch (type) {
    case "event":
      return "event";
    case "garage-sale":
      return "garage";
    case "notice":
      return "notice";
    default:
      return "";
  }
}

function buildWhen(date, startTime, endTime) {
  if (!isRealDate(date)) return null;
  if (!startTime && !endTime) {
    return { start: `${date}T00:00:00+10:00`, end: null, allDay: true };
  }
  const start = parseTimeValue(startTime);
  if (!start) return { error: "start_time" };
  const startIso = `${date}T${pad(start.hour)}:${pad(start.minute)}:00+10:00`;
  if (!endTime) return { start: startIso, end: null, allDay: false };
  const end = parseTimeValue(endTime);
  if (!end) return { error: "end_time" };
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  if (endMinutes <= startMinutes) return { error: "end_time" };
  return {
    start: startIso,
    end: `${date}T${pad(end.hour)}:${pad(end.minute)}:00+10:00`,
    allDay: false,
  };
}

function parseTimeValue(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function isRealDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [year, month, day] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

function placeFrom(venue, location) {
  const street = /\d/.test(location) || /\b(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|place|pl|parade|pde|crescent|cres|highway|hwy)\b/i.test(location);
  return {
    venue,
    address: street ? location : "",
    suburb: suburbFrom(location),
  };
}

function suburbFrom(location) {
  const city = cityBeforeState(location);
  const source = city || location;
  const parts = source.split(",").map((part) => part.replace(/\bQLD\b.*$/i, "").trim()).filter(Boolean);
  for (const part of [...parts].reverse()) {
    if (part.length < 48 && inToowoombaRegion([part])) return part;
  }
  return (city || location).replace(/\bQLD\b.*$/i, "").trim();
}

function checkLink(value) {
  const raw = oneLine(value);
  if (!raw) return { ok: true, url: "" };
  if (raw.length > FIELD_LIMITS.source_link) return { ok: false, url: "" };
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, url: "" };
    if (url.username || url.password) return { ok: false, url: "" };
    if (SHORTENER.test(url.hostname)) return { ok: false, url: "" };
    return { ok: true, url: url.toString() };
  } catch {
    return { ok: false, url: "" };
  }
}

function urlsIn(value) {
  return String(value || "").match(new RegExp(URL_SOURCE, "gi")) || [];
}

function fieldsContainShortener(value) {
  return urlsIn(value).some((token) => {
    try {
      const withProtocol = token.startsWith("www.") ? `https://${token}` : token;
      return SHORTENER.test(new URL(withProtocol).hostname);
    } catch {
      return SHORTENER.test(token);
    }
  });
}

function isOnlyUrl(value) {
  return /^(?:https?:\/\/|www\.)\S+$/i.test(String(value || "").trim());
}

function isEmail(value) {
  return value.length <= FIELD_LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function idFromLabel(pairs, label) {
  const wanted = oneLine(label).toLowerCase();
  if (!wanted || wanted === "not sure") return "";
  for (const [id, text] of pairs) {
    if (text.toLowerCase() === wanted) return id;
  }
  return "";
}

function oneLine(value) {
  return htmlToText(String(value || "")).replace(/\s+/g, " ").trim();
}

function parseHtmlTable(html) {
  const fields = {};
  const rows = String(html || "").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => htmlToText(cell[1]));
    if (cells.length < 2 || !cells[0]) continue;
    const key = normaliseKey(cells[0]);
    if (!key) continue;
    fields[key] = cells.slice(1).join(" ").trim();
  }
  return fields;
}

function parseLooseText(text) {
  const fields = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9 _-]{0,40})\s*:\s*(.+)$/);
    if (!match) continue;
    const key = normaliseKey(match[1]);
    if (!key || !Object.hasOwn(FIELD_LIMITS, key)) continue;
    if (!fields[key]) fields[key] = match[2].trim();
  }
  return fields;
}

function tryParsePayload(value) {
  if (!value) return null;
  const decoded = decodeHtml(String(value)).trim();
  if (!decoded.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const fields = {};
    for (const [key, field] of Object.entries(parsed)) {
      const name = normaliseKey(key);
      if (!Object.hasOwn(FIELD_LIMITS, name)) continue;
      if (typeof field === "string" || typeof field === "number" || typeof field === "boolean") {
        fields[name] = String(field);
      }
    }
    return fields;
  } catch {
    return null;
  }
}

function normaliseKey(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function unique(values) {
  return [...new Set(values)];
}
