/**
 * Shared date, tagging, and filter helpers.
 * No Node built-ins, so the static site can import this file.
 */

export const TIMEZONE = "Australia/Brisbane";

export const AGE_GROUPS = [
  ["kids", "Kids 0-12"],
  ["teens", "Teens 13-17"],
  ["young-adults", "Young adults 18-30"],
  ["adults", "Adults"],
  ["seniors", "Seniors 60+"],
  ["families", "Families/All ages"],
];

export const COMMUNITIES = [
  ["indian", "Indian"],
  ["filipino", "Filipino"],
  ["african", "African"],
  ["pacific", "Pacific Islander"],
  ["chinese", "Chinese"],
  ["korean", "Korean"],
  ["latin", "Latin American"],
  ["indigenous", "Indigenous/First Nations"],
  ["multicultural", "Multicultural/All"],
];

export const CATEGORIES = [
  ["music", "Music"],
  ["sport", "Sport"],
  ["faith", "Church/faith"],
  ["markets", "Markets"],
  ["arts", "Arts"],
  ["education", "Education"],
  ["free", "Free events"],
  ["garage", "Garage sales"],
];

export const DATE_FILTERS = [
  ["", "All upcoming"],
  ["today", "Today"],
  ["weekend", "This weekend"],
  ["week", "This week"],
  ["month", "This month"],
];

export const SOURCE_LABELS = {
  council: "Toowoomba Regional Council",
  library: "Toowoomba Region Libraries",
  eventbrite: "Eventbrite",
  humanitix: "Humanitix",
  multicultural: "Community group",
  garage: "Garage sale listing",
  submission: "Community submission",
  parkrun: "parkrun",
};

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export const LOCALITIES = [
  "toowoomba",
  "newtown",
  "harristown",
  "wilsonton",
  "rockville",
  "harlaxton",
  "mount lofty",
  "mt lofty",
  "rangeville",
  "centenary heights",
  "middle ridge",
  "kearneys spring",
  "darling heights",
  "glenvale",
  "drayton",
  "highfields",
  "meringandan",
  "kleinton",
  "cabarlah",
  "geham",
  "hampton",
  "crows nest",
  "kingsthorpe",
  "gowrie",
  "oakey",
  "jondaryan",
  "pittsworth",
  "millmerran",
  "clifton",
  "cambooya",
  "greenmount",
  "wyreema",
  "westbrook",
  "wellcamp",
  "charlton",
  "yarraman",
  "cooyar",
  "goombungee",
  "cecil plains",
  "southbrook",
  "hodgson vale",
  "prince henry heights",
  "redwood",
  "withcott",
  "murphys creek",
  "top camp",
  "vale view",
  "bowenville",
  "aubigny",
];

const COMMUNITY_RULES = [
  ["indian", /\b(indian|india|hindi|diwali|holi|onam|malayali|malayalam|vishu|bollywood)\b/i],
  ["filipino", /\b(filipino|filipina|philippines|pinoy|pinay)\b/i],
  ["african", /\b(african|nigeria|nigerian|ghana|ghanaian|ethiopia|ethiopian|sudanese|somali|congolese)\b/i],
  ["pacific", /\b(pacific islander|samoan|tongan|fijian|maori|polynesian|melanesian)\b/i],
  ["chinese", /\b(chinese|china|mandarin|cantonese|lunar new year)\b/i],
  ["korean", /\b(korean|korea|k-pop|kpop)\b/i],
  ["latin", /\b(latin american|latino|latina|hispanic|mexican|brazil(?:ian)?)\b/i],
  ["indigenous", /\b(indigenous|first nations|aboriginal|torres strait|welcome to country)\b/i],
  ["multicultural", /\b(multicultural|harmony day|street fiesta|cultural diversity)\b/i],
];

const CATEGORY_RULES = [
  ["music", /\b(music|concert|band|dj|choir|sing-along|sing along|gig|orchestra|beats|karaoke)\b/i],
  ["sport", /\b(sport|golf|parkrun|fitness|bullride|boxing|football|soccer|cricket|netball|rugby|cycling|swim|motor show|show and shine|car show)\b/i],
  ["faith", /\b(church|faith|prayer|worship|gospel|mass|ministry|christian|mosque|temple|satsang|cathedral)\b/i],
  ["markets", /\bmarkets?\b/i],
  ["arts", /\b(arts?|gallery|exhibition|theatre|theater|floral|ceramic|paint|cupcake|craft|comedy)\b/i],
  ["education", /\b(library|workshops?|classes?|conference|learn|training|literacy|story\s*time|storytime|seminar|lecture|educat)/i],
  ["garage", /\bgarage\s+sales?\b/i],
];

export function monthNumber(name) {
  return MONTHS[String(name || "").toLowerCase()] || null;
}

export function pad(number) {
  return String(number).padStart(2, "0");
}

export function brisbaneYmd(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function brisbaneWeekdayIndex(date) {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

export function addDays(ymd, days) {
  const [year, month, day] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function brisbaneIso(year, month, day, clock) {
  const date = `${year}-${pad(month)}-${pad(day)}`;
  if (!clock) {
    return { iso: `${date}T00:00:00+10:00`, allDay: true };
  }
  return {
    iso: `${date}T${pad(clock.hour)}:${pad(clock.minute)}:00+10:00`,
    allDay: false,
  };
}

export function formatWhen(startIso, endIso, allDay) {
  const start = new Date(startIso);
  const date = new Intl.DateTimeFormat("en-AU", {
    timeZone: TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(start);
  if (allDay) return date;
  const time = new Intl.DateTimeFormat("en-AU", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
  if (!endIso) return `${date}, ${time}`;
  const end = new Date(endIso);
  const endTime = new Intl.DateTimeFormat("en-AU", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(end);
  const sameDay = brisbaneYmd(start) === brisbaneYmd(end);
  if (sameDay) return `${date}, ${time} – ${endTime}`;
  const endDate = new Intl.DateTimeFormat("en-AU", {
    timeZone: TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(end);
  return `${date}, ${time} – ${endDate}, ${endTime}`;
}

export function isPast(event, now = new Date()) {
  if (!event?.start) return true;
  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return true;
  if (event.allDay) {
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return now.getTime() >= end.getTime();
  }
  const boundary = event.end ? new Date(event.end) : start;
  if (Number.isNaN(boundary.getTime())) return now.getTime() > start.getTime();
  return now.getTime() > boundary.getTime();
}

export function inToowoombaRegion(parts) {
  const blob = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (!blob) return false;
  if (/\b(nsw|vic|sa|wa|tas|nt|act)\b/i.test(blob)) return false;
  if (/\btoowoomba\b/i.test(blob)) return true;
  const hit = LOCALITIES.some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(blob));
  if (!hit) return false;
  if (/\bqld\b|queensland|\b43[4-6]\d\b|\b440[0-8]\b/i.test(blob)) return true;
  return blob.length < 48;
}

export function cityBeforeState(address) {
  const match = String(address || "").match(/([A-Za-z][A-Za-z .'-]{1,40}?)\s*,?\s*QLD\b/i);
  return match ? match[1].trim() : "";
}

export function normaliseTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function makeId(parts) {
  let hash = 2166136261;
  const text = parts.join("|");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let extra = 0;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    extra = (extra + text.charCodeAt(i) * (i + 1)) % 0xffffffff;
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}${(extra >>> 0).toString(16).padStart(8, "0")}`;
}

export function tagListing(input) {
  const text = [
    input.title,
    input.venue,
    input.suburb,
    input.summary,
    input.items,
    input.rawCategory,
  ]
    .filter(Boolean)
    .join(" \n ");
  const ageGroups = [];
  if (/\b(kids?|children|child|preschool|playgroup|story\s*time|storytime|0\s*[-–]\s*5|0\s*[-–]\s*12|under\s*12|first 5|babies|baby)\b/i.test(text)) {
    ageGroups.push("kids");
  }
  if (/\b(teens?|13\s*[-–]\s*17|high school)\b/i.test(text)) ageGroups.push("teens");
  if (/\byouth\b/i.test(text) && !/\byouth and community\b/i.test(text)) ageGroups.push("teens");
  if (/\b18\+(?!\w)/i.test(text) || /\b(18\s*[-–]\s*30|young adults?|uni students?|university students?)\b/i.test(text)) {
    ageGroups.push("young-adults");
  }
  if (/\b(adults?|business networking|networking|conference|golf day|in[ -]?service|educators?)\b/i.test(text)) {
    ageGroups.push("adults");
  }
  if (/\b(seniors?|60\+|over 60|starts at 60|retirement|aged care)\b/i.test(text)) {
    ageGroups.push("seniors");
  }
  if (/\b(famil(?:y|ies)|all ages|all-ages)\b/i.test(text) || ageGroups.includes("kids")) {
    ageGroups.push("families");
  }
  if (ageGroups.length === 0) ageGroups.push("families");

  const communities = [];
  for (const [id, rule] of COMMUNITY_RULES) {
    if (rule.test(text)) communities.push(id);
  }
  if (communities.length === 0) communities.push("multicultural");

  const categories = [];
  for (const [id, rule] of CATEGORY_RULES) {
    if (rule.test(text)) categories.push(id);
  }
  if (input.kind === "garage" && !categories.includes("garage")) categories.push("garage");
  if (isFreePrice(input.price) && !categories.includes("free")) categories.push("free");
  if (Array.isArray(input.extraCategories)) {
    for (const id of input.extraCategories) {
      if (!categories.includes(id)) categories.push(id);
    }
  }
  return {
    ageGroups: unique(ageGroups),
    communities: unique(communities),
    categories: unique(categories),
  };
}

export function isFreePrice(price) {
  const value = String(price || "").trim().toLowerCase();
  return value === "free" || value.startsWith("free–") || value.startsWith("free-") || value === "$0";
}

export function dedupeListings(events) {
  const map = new Map();
  for (const event of events) {
    const day = brisbaneYmd(new Date(event.start));
    const time = event.allDay ? "all-day" : String(event.start).slice(11, 16);
    const key = [
      event.kind || "event",
      normaliseTitle(event.title),
      day,
      time,
      normaliseTitle(event.venue || event.address || "").slice(0, 48),
    ].join("|");
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...event, id: event.id || makeId([key]) });
      continue;
    }
    map.set(key, preferListing(existing, event, key));
  }
  return [...map.values()].sort((a, b) => {
    const byStart = String(a.start).localeCompare(String(b.start));
    if (byStart !== 0) return byStart;
    return String(a.title).localeCompare(String(b.title));
  });
}

function preferListing(current, incoming, key) {
  const currentScore = listingScore(current);
  const incomingScore = listingScore(incoming);
  const winner = incomingScore > currentScore ? { ...incoming } : { ...current };
  const loser = winner === incoming || incomingScore > currentScore ? current : incoming;
  winner.id = current.id || makeId([key]);
  if (loser.source && loser.source !== winner.source) {
    const sources = new Set([...(winner.alsoFrom || []), loser.source]);
    sources.delete(winner.source);
    winner.alsoFrom = [...sources];
  }
  if (!winner.summary && loser.summary) winner.summary = loser.summary;
  if ((!winner.items || winner.items.length < (loser.items || "").length) && loser.items) {
    winner.items = loser.items;
  }
  return winner;
}

function listingScore(event) {
  let score = 0;
  if (event.price && event.price !== "See listing") score += 3;
  if (isFreePrice(event.price)) score += 1;
  if (event.end) score += 1;
  if (event.venue) score += 1;
  if (event.summary) score += 1;
  if (event.items) score += 1;
  return score;
}

export function dateWindow(filter, now = new Date()) {
  const today = brisbaneYmd(now);
  const dow = brisbaneWeekdayIndex(now);
  const monday = addDays(today, dow === 0 ? -6 : 1 - dow);
  switch (filter) {
    case "":
    case undefined:
    case null:
      return null;
    case "today":
      return { start: today, end: today };
    case "weekend":
      return { start: addDays(monday, 5), end: addDays(monday, 6) };
    case "week":
      return { start: monday, end: addDays(monday, 6) };
    case "month":
      return { start: `${today.slice(0, 7)}-01`, end: `${today.slice(0, 7)}-31` };
    default: {
      throw new Error(`Unknown date filter: ${filter}`);
    }
  }
}

export function matchesFilters(event, filters, now = new Date()) {
  if (isPast(event, now)) return false;
  if (filters.tab === "garage" && event.kind !== "garage") return false;
  if (filters.tab !== "garage" && event.kind === "garage") return false;
  if (filters.age && !(event.ageGroups || []).includes(filters.age)) return false;
  if (filters.community && !(event.communities || []).includes(filters.community)) return false;
  if (filters.tab !== "garage" && filters.category && !(event.categories || []).includes(filters.category)) {
    return false;
  }
  const window = dateWindow(filters.date, now);
  if (!window) return true;
  const day = brisbaneYmd(new Date(event.start));
  return day >= window.start && day <= window.end;
}

export function robotsAllows(robotsText, pathAndQuery, userAgent = "*") {
  const groups = parseRobots(robotsText);
  const rules = groups.find((group) => group.agents.includes(userAgent.toLowerCase()))
    || groups.find((group) => group.agents.includes("*"));
  if (!rules) return true;
  let winner = null;
  for (const rule of rules.rules) {
    if (!rule.pattern.test(pathAndQuery)) continue;
    if (!winner || rule.length > winner.length || (rule.length === winner.length && rule.allow && !winner.allow)) {
      winner = rule;
    }
  }
  return winner ? winner.allow : true;
}

export function robotsCrawlDelay(robotsText) {
  const match = String(robotsText || "").match(/^\s*crawl-delay\s*:\s*(\d+(?:\.\d+)?)/im);
  if (!match) return 0;
  return Math.min(Number(match[1]) || 0, 10);
}

function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const split = line.split(":");
    const field = split.shift().trim().toLowerCase();
    const value = split.join(":").trim();
    if (field === "user-agent") {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      if (!value) continue;
      current.rules.push({
        allow: field === "allow",
        length: value.length,
        pattern: robotsPattern(value),
      });
    }
  }
  return groups;
}

function robotsPattern(pattern) {
  let source = "^";
  for (const char of pattern) {
    if (char === "*") source += ".*";
    else if (char === "$") source += "$";
    else source += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(source);
}

export function priceLabel(minimum, maximum) {
  const min = Number(minimum);
  const max = Number(maximum);
  if (!Number.isFinite(min) && !Number.isFinite(max)) return "See listing";
  const low = Number.isFinite(min) ? min : max;
  const high = Number.isFinite(max) ? max : min;
  if (low === 0 && high === 0) return "Free";
  if (low === 0) return `Free–$${trimMoney(high)}`;
  if (low === high) return `$${trimMoney(low)}`;
  return `$${trimMoney(low)}–$${trimMoney(high)}`;
}

function trimMoney(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function unique(values) {
  return [...new Set(values)];
}

export function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&rsquo;|&#8217;|&apos;/gi, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/gi, '"')
    .replace(/&ndash;|&#8211;/gi, "–")
    .replace(/&mdash;|&#8212;/gi, "—")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function htmlToText(html) {
  return decodeHtml(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|h1|h2|h3|div|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function parseClock(raw, fallbackMeridiem) {
  const match = String(raw || "")
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour > 23 || minute > 59) return null;
  const meridiem = match[3] || fallbackMeridiem || null;
  if (meridiem) {
    if (hour > 12) return null;
    if (hour === 12) hour = meridiem === "am" ? 0 : 12;
    else if (meridiem === "pm") hour += 12;
  }
  return { hour, minute, mer: meridiem };
}

export function parseTimes(text) {
  const source = String(text || "").replace(/[\u00a0\u202f]/g, " ");
  const both = source.match(
    /(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+and\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
  );
  if (both) {
    return [both[1], both[2]]
      .map((token) => ({ start: parseClock(token), end: null }))
      .filter((slot) => slot.start);
  }
  const range = source.match(
    /(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\s*(?:-|–|—|\bto\b)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)/i,
  );
  if (range && (hasTimeMarker(range[1]) || hasTimeMarker(range[2]))) {
    const end = parseClock(range[2]);
    const start = parseClock(range[1], end?.mer || null);
    if (start && end) return [{ start, end }];
  }
  const single = source.match(/\b(?:from\s+)?(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm))\b/i);
  if (single) {
    const start = parseClock(single[1]);
    if (start) return [{ start, end: null }];
  }
  return [];
}

function hasTimeMarker(token) {
  return /am|pm|[:.][0-5]\d/i.test(token);
}
