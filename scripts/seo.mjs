/**
 * Pure builders for crawlable Toowoomba pages, feeds, and structured data.
 * No filesystem access, so tests can render a site from fixtures.
 */

import { countSnippet, outboundEventPath, privacyNoteHtml, stampHtml } from "./analytics.mjs";
import {
  CATEGORIES,
  LOCALITIES,
  SOURCE_LABELS,
  TIMEZONE,
  addDays,
  brisbaneWeekdayIndex,
  brisbaneYmd,
  dateWindow,
  dedupeListings,
  formatWhen,
  isPast,
  pad,
} from "./pure.mjs";

export const SITE = "https://whatsontoowoomba.au";
export const CONTACT_EMAIL = "whatsontoowoomba@agentmail.to";
const OG_IMAGE = `${SITE}/assets/og.png`;
const OG_ALT = "What's On Toowoomba, a calendar of events in Toowoomba, Queensland";
const GEO_LAT = "-27.5598";
const GEO_LNG = "151.9507";

const PLACE_TYPES = new Set(["TouristAttraction", "Place", "SportsActivityLocation", "Museum"]);

const EXTRA_SUBURBS = [
  "toowoomba city",
  "east toowoomba",
  "north toowoomba",
  "south toowoomba",
  "west toowoomba",
];

const SUBURB_PHRASES = [...new Set([...EXTRA_SUBURBS, ...LOCALITIES])]
  .sort((a, b) => b.length - a.length);

const WEEKDAY_INDEX = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function clip(value, max = 160) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const base = space > 80 ? cut.slice(0, space) : cut;
  return `${base.trim()}…`;
}

export function absolute(path) {
  if (!path || path === "/") return `${SITE}/`;
  return `${SITE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function replaceMarker(html, name, content) {
  const start = `<!-- seo:${name} -->`;
  const end = `<!-- /seo:${name} -->`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (!pattern.test(html)) throw new Error(`Missing <!-- seo:${name} --> marker`);
  return html.replace(pattern, () => `${start}\n${content}\n${end}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function displayPlace(phrase) {
  return String(phrase || "")
    .split(" ")
    .filter(Boolean)
    .map((part) => (part.toLowerCase() === "mt" ? "Mt" : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join(" ");
}

export function canonicalSuburb(value) {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/,?\s*(qld|queensland|australia)$/i, "")
    .replace(/\s+\d{4}$/, "")
    .replace(/,\s*$/, "")
    .trim();
  if (!cleaned) return "";
  const key = cleaned.toLowerCase();
  for (const phrase of SUBURB_PHRASES) {
    if (phrase === key) return displayPlace(phrase);
  }
  return cleaned;
}

export function inferSuburb(event) {
  const explicit = canonicalSuburb(event?.suburb);
  if (explicit) return explicit;
  for (const field of [event?.address, event?.venue, event?.title]) {
    const match = matchSuburb(field);
    if (match) return match;
  }
  return "";
}

function matchSuburb(text) {
  const source = String(text || "");
  if (!source) return "";
  for (const phrase of SUBURB_PHRASES) {
    const pattern = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(source)) return displayPlace(phrase);
  }
  return "";
}

export function offersFor(event) {
  const price = String(event?.price || "").trim();
  if (!price || /see listing/i.test(price) || /^paid$/i.test(price)) return null;
  if (eventStatusName(event) !== "EventScheduled") return null;
  const url = event.sourceUrl || undefined;
  const shared = {
    priceCurrency: "AUD",
    availability: "https://schema.org/InStock",
    ...(url ? { url } : {}),
  };
  const range = price.match(/^(?:free|\$?\s*(\d+(?:\.\d{1,2})?))\s*[–—-]\s*\$?\s*(\d+(?:\.\d{1,2})?)$/i);
  if (range) {
    return {
      "@type": "AggregateOffer",
      lowPrice: /^free/i.test(price) ? "0" : range[1],
      highPrice: range[2],
      ...shared,
    };
  }
  if (/^free$/i.test(price) || price === "$0") {
    return { "@type": "Offer", price: "0", ...shared };
  }
  const single = price.match(/^\$(\d+(?:\.\d{1,2})?)$/);
  if (!single) return null;
  return { "@type": "Offer", price: single[1], ...shared };
}

function eventStatusName(event) {
  const text = `${event?.title || ""} ${event?.summary || ""}`;
  if (/\bcancell?ed\b/i.test(text)) return "EventCancelled";
  if (/\bpostponed\b/i.test(text)) return "EventPostponed";
  return "EventScheduled";
}

export function eventStatusUrl(event) {
  return `https://schema.org/${eventStatusName(event)}`;
}

function isOnline(event) {
  return /\b(online|zoom|virtual)\b/i.test(`${event?.venue || ""} ${event?.address || ""} ${event?.title || ""}`);
}

function isKnownFree(price) {
  return /^free\b/i.test(String(price || "").trim()) || String(price || "").trim() === "$0";
}

function postcodeFrom(text) {
  const match = String(text || "").match(/\b(4\d{3})\b/);
  return match ? match[1] : "";
}

function streetLine(event) {
  const address = String(event?.address || "").replace(/,?\s*Australia$/i, "").trim();
  if (!address) return "";
  if (/\d/.test(address) || /\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|parade|highway)\b/i.test(address)) {
    return address;
  }
  return "";
}

function listingPath(event) {
  if (event.pagePath) return event.pagePath;
  return `/events/${event.id}/`;
}

function jsonLdScript(graph) {
  const payload = { "@context": "https://schema.org", "@graph": graph.filter(Boolean) };
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

function organizationNode() {
  return {
    "@type": "Organization",
    "@id": `${SITE}/#organization`,
    name: "What's On Toowoomba",
    url: `${SITE}/`,
    email: CONTACT_EMAIL,
    logo: {
      "@type": "ImageObject",
      url: OG_IMAGE,
      width: 1200,
      height: 630,
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: "Toowoomba",
      addressRegion: "QLD",
      addressCountry: "AU",
    },
    areaServed: {
      "@type": "City",
      name: "Toowoomba",
      containedInPlace: { "@type": "AdministrativeArea", name: "Queensland" },
    },
  };
}

function websiteNode() {
  return {
    "@type": "WebSite",
    "@id": `${SITE}/#website`,
    name: "What's On Toowoomba",
    url: `${SITE}/`,
    inLanguage: "en-AU",
    publisher: { "@id": `${SITE}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE}/search/?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

function breadcrumbNode(crumbs) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absolute(crumb.path),
    })),
  };
}

function eventDescription(event) {
  const where = [event.venue, event.suburb].filter(Boolean).join(", ");
  const when = formatWhen(event.start, event.hideEnd ? null : event.end, event.allDay);
  const lead = where
    ? `${event.title} is listed for ${when} at ${where}.`
    : `${event.title} is listed for ${when} in Toowoomba.`;
  const extra = [
    event.summary,
    event.items ? `For sale: ${event.items}.` : "",
    event.price ? `Price: ${event.price}.` : "",
  ].filter(Boolean).join(" ");
  return clip(`${lead} ${extra}`.replace(/\s+/g, " "), 280);
}

function eventNode(event) {
  const path = listingPath(event);
  const node = {
    "@type": "Event",
    "@id": `${absolute(path)}#event`,
    name: event.title,
    startDate: event.start,
    eventStatus: eventStatusUrl(event),
    eventAttendanceMode: isOnline(event)
      ? "https://schema.org/OnlineEventAttendanceMode"
      : "https://schema.org/OfflineEventAttendanceMode",
    location: eventLocation(event),
    description: eventDescription(event),
    url: absolute(path),
    image: [OG_IMAGE],
    inLanguage: "en-AU",
  };
  if (event.end && !event.hideEnd) node.endDate = event.end;
  const offers = offersFor(event);
  if (offers) node.offers = offers;
  if (isKnownFree(event.price)) node.isAccessibleForFree = true;
  if (event.source === "parkrun" && event.sourceUrl) {
    node.organizer = { "@type": "Organization", name: "parkrun", url: event.sourceUrl };
  }
  return node;
}

function eventLocation(event) {
  if (isOnline(event)) {
    return { "@type": "VirtualLocation", url: event.sourceUrl || absolute(listingPath(event)) };
  }
  const suburb = event.suburb || "Toowoomba";
  const address = {
    "@type": "PostalAddress",
    addressLocality: suburb,
    addressRegion: "QLD",
    addressCountry: "AU",
  };
  const street = streetLine(event);
  if (street) address.streetAddress = street;
  const postcode = postcodeFrom(`${event.address || ""} ${event.venue || ""}`);
  if (postcode) address.postalCode = postcode;
  return {
    "@type": "Place",
    name: event.venue || suburb,
    address,
  };
}

function placeTypes(place) {
  const types = [place.schemaType || "TouristAttraction", ...(place.additionalTypes || [])];
  for (const type of types) {
    if (!PLACE_TYPES.has(type)) throw new Error(`Unknown place type ${type} on ${place.id}`);
  }
  return types.length === 1 ? types[0] : types;
}

function placeNode(place) {
  const path = `/things-to-do/${place.id}/`;
  const address = {
    "@type": "PostalAddress",
    addressLocality: place.suburb || "Toowoomba",
    addressRegion: "QLD",
    addressCountry: "AU",
  };
  if (place.streetAddress) address.streetAddress = place.streetAddress;
  if (place.postcode) address.postalCode = place.postcode;
  const node = {
    "@type": placeTypes(place),
    "@id": `${absolute(path)}#place`,
    name: place.name,
    description: place.description,
    url: absolute(path),
    address,
    isAccessibleForFree: Boolean(place.free),
    publicAccess: true,
  };
  const sameAs = Array.isArray(place.sameAs) ? place.sameAs : place.sameAs ? [place.sameAs] : [];
  if (sameAs.length) node.sameAs = sameAs;
  if (Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) {
    node.geo = {
      "@type": "GeoCoordinates",
      latitude: place.latitude,
      longitude: place.longitude,
    };
  }
  const image = localImage(place.image);
  if (image) node.image = absolute(image.src);
  return node;
}

function localImage(image) {
  if (!image?.src || !image.width || !image.height || !image.alt) return null;
  const src = String(image.src);
  if (/^https?:\/\//i.test(src) && !src.startsWith(`${SITE}/`)) return null;
  const path = src.startsWith("http") ? new URL(src).pathname : src.startsWith("/") ? src : `/${src}`;
  return {
    src: path,
    width: Number(image.width),
    height: Number(image.height),
    alt: String(image.alt),
  };
}

function itemListNode(name, events) {
  return {
    "@type": "ItemList",
    name,
    numberOfItems: events.length,
    itemListElement: events.map((event, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: event.title,
      url: absolute(listingPath(event)),
    })),
  };
}

export function weekdayIndex(name) {
  switch (name) {
    case "Sunday":
      return WEEKDAY_INDEX.Sunday;
    case "Monday":
      return WEEKDAY_INDEX.Monday;
    case "Tuesday":
      return WEEKDAY_INDEX.Tuesday;
    case "Wednesday":
      return WEEKDAY_INDEX.Wednesday;
    case "Thursday":
      return WEEKDAY_INDEX.Thursday;
    case "Friday":
      return WEEKDAY_INDEX.Friday;
    case "Saturday":
      return WEEKDAY_INDEX.Saturday;
    default: {
      const unexpected = name;
      throw new Error(`Unknown weekday: ${String(unexpected)}`);
    }
  }
}

function plusHours(iso, hours) {
  const [date, time] = iso.split("T");
  const [hourText, minute] = time.split(":");
  let hour = Number(hourText) + hours;
  let day = date;
  while (hour >= 24) {
    hour -= 24;
    day = addDays(day, 1);
  }
  return `${day}T${pad(hour)}:${minute.slice(0, 2)}:00+10:00`;
}

export function nextOccurrence(recurrence, now) {
  const index = weekdayIndex(recurrence.byDay);
  const today = brisbaneYmd(now);
  const dow = brisbaneWeekdayIndex(now);
  let delta = (index - dow + 7) % 7;
  const candidate = `${addDays(today, delta)}T${recurrence.startTime}:00+10:00`;
  const graceEnd = plusHours(candidate, 2);
  if (now.getTime() > new Date(graceEnd).getTime()) delta += 7;
  const start = `${addDays(today, delta)}T${recurrence.startTime}:00+10:00`;
  return { start, end: plusHours(start, 2), hideEnd: true };
}

function approvedSubmissions(submissions) {
  const items = Array.isArray(submissions?.items) ? submissions.items : [];
  return items
    .filter((item) => item && item.status === "approved" && item.title && item.start)
    .map((item) => ({
      ...item,
      kind: item.kind === "garage" || item.kind === "notice" ? item.kind : "event",
      source: "submission",
      sourceUrl: item.sourceUrl || `${SITE}/share.html`,
      allDay: Boolean(item.allDay),
      ageGroups: item.ageGroups || ["families"],
      communities: item.communities || ["multicultural"],
      categories: item.categories || (item.kind === "garage" ? ["garage"] : []),
      price: item.price || "See listing",
    }));
}

const TYPE_LABELS = {
  outdoor: "Outdoor events",
  drives: "Scenic drives",
  walks: "Hikes and walks",
  parkruns: "Parkruns",
  parks: "Parks and gardens",
  lookouts: "Lookouts",
  family: "Family and kids",
};

function normalisePlaces(places) {
  return (places || []).map((place) => {
    if (!place?.id || !/^[a-z0-9-]+$/.test(place.id)) throw new Error("Place id must be a lowercase slug");
    const description = String(place.description || place.summary || "").trim();
    const sameAs = place.sameAs || place.url || "";
    if (!place.name || !description) throw new Error(`Place ${place.id} needs a name and description`);
    const suburb = canonicalSuburb(place.suburb);
    const streetAddress = place.streetAddress || "";
    if (!suburb && !streetAddress && !place.area) throw new Error(`Place ${place.id} needs an address`);
    const parkrun = place.type === "parkruns" || place.recurrence?.byDay;
    return {
      ...place,
      description,
      sameAs,
      suburb,
      streetAddress,
      free: place.free === undefined ? true : Boolean(place.free),
      schemaType: place.schemaType || (parkrun ? "SportsActivityLocation" : "TouristAttraction"),
      additionalTypes: place.additionalTypes || (parkrun ? ["TouristAttraction"] : []),
      categories: place.categories || (parkrun ? ["sport", "free"] : []),
      source: place.source || "",
    };
  });
}

function occurrenceListings(places, now) {
  const listings = [];
  for (const place of places) {
    if (!place.recurrence?.byDay || !place.recurrence?.startTime) continue;
    const when = nextOccurrence(place.recurrence, now);
    const street = [place.streetAddress, place.suburb, "QLD", place.postcode].filter(Boolean).join(", ");
    listings.push({
      id: place.id,
      kind: "event",
      title: place.name,
      start: when.start,
      end: when.end,
      hideEnd: true,
      allDay: false,
      venue: place.venue || place.name,
      suburb: place.suburb || "",
      address: street,
      price: place.free ? "Free" : "See listing",
      summary: place.description,
      categories: place.categories || [],
      ageGroups: ["families"],
      communities: ["multicultural"],
      source: "parkrun",
      sourceUrl: Array.isArray(place.sameAs) ? place.sameAs[0] : place.sameAs || "",
      pagePath: `/things-to-do/${place.id}/`,
      placeId: place.id,
    });
  }
  return listings;
}

export function prepareListings({ events, submissions, places, now }) {
  const normalisedPlaces = normalisePlaces(places);
  const collected = dedupeListings([...(events || []), ...approvedSubmissions(submissions)])
    .filter((event) => event.start && !isPast(event, now))
    .map((event) => ({ ...event, suburb: inferSuburb(event) }));
  const occurrences = occurrenceListings(normalisedPlaces, now).filter((event) => !isPast(event, now));
  const sort = (a, b) => String(a.start).localeCompare(String(b.start)) || String(a.title).localeCompare(String(b.title));
  return {
    places: normalisedPlaces,
    calendar: collected.sort(sort),
    occurrences,
    all: [...collected, ...occurrences].sort(sort),
  };
}

function inDateWindow(event, filter, now) {
  if (isPast(event, now)) return false;
  const window = dateWindow(filter, now);
  if (!window) return true;
  const day = brisbaneYmd(new Date(event.start));
  return day >= window.start && day <= window.end;
}

function categoryCopy(id) {
  switch (id) {
    case "music":
      return {
        heading: "Live music in Toowoomba",
        intro: "Concerts, choirs, gigs, and other live music in Toowoomba and nearby towns. Each listing has the date, the venue, and a link back to the public page it came from.",
      };
    case "sport":
      return {
        heading: "Sport in Toowoomba",
        intro: "Sport and fitness sessions on the Toowoomba calendar. Toowoomba parkrun is a free 5 kilometre walk and run at Queens Park every Saturday at 7:00 am. Highfields parkrun starts at the same time at Highfields Sports and Recreation Park, 220 Barracks Road.",
      };
    case "faith":
      return {
        heading: "Church and faith events in Toowoomba",
        intro: "Services, prayer gatherings, and other church and faith events in Toowoomba. Times and venues are taken from the public listing, not written in here.",
      };
    case "markets":
      return {
        heading: "Markets in Toowoomba",
        intro: "Markets in Toowoomba and the surrounding towns, with the day, the suburb, and a link to the organiser's page when we have one.",
      };
    case "arts":
      return {
        heading: "Arts and theatre in Toowoomba",
        intro: "Exhibitions, theatre, workshops, and other arts events in Toowoomba, including shows at venues such as the Empire Theatre when they are on the public calendar.",
      };
    case "education":
      return {
        heading: "Classes and library events in Toowoomba",
        intro: "Workshops, talks, and library sessions in Toowoomba, including First 5 Forever story times at libraries across the region. Sessions that have already finished are left off.",
      };
    case "free":
      return {
        heading: "Free events in Toowoomba",
        intro: "Free events in Toowoomba. A listing is marked free only when the source page says so. If the price is missing, it stays off this page.",
      };
    case "garage":
      return {
        heading: "Toowoomba garage sales",
        intro: "Toowoomba garage sales with the date, the suburb or address, and what is for sale. Sales come from public listing pages that allow automated reads, and from notes sent through Share something. Sales that are only on Facebook or Instagram are not copied across.",
      };
    default: {
      const unexpected = id;
      throw new Error(`Unhandled category: ${String(unexpected)}`);
    }
  }
}

function longDate(ymd) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${ymd}T12:00:00+10:00`));
}

function pageTitle(name) {
  const suffix = " · What's On Toowoomba";
  if (`${name}${suffix}`.length <= 70) return `${name}${suffix}`;
  const room = 70 - suffix.length - 1;
  return `${String(name).slice(0, room).trim()}…${suffix}`;
}

function eventPageTitle(event) {
  const options = {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  };
  if (!event.allDay) {
    options.hour = "numeric";
    options.minute = "2-digit";
  }
  const stamp = new Intl.DateTimeFormat("en-AU", options).format(new Date(event.start));
  const suffix = ` · ${stamp} · What's On Toowoomba`;
  const max = 110;
  if (`${event.title}${suffix}`.length <= max) return `${event.title}${suffix}`;
  const room = Math.max(24, max - suffix.length - 1);
  return `${String(event.title).slice(0, room).trim()}…${suffix}`;
}

function headBlock({ title, description, path, graph, robots = "index,follow", verification = false }) {
  const canonical = absolute(path);
  const lines = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta name="robots" content="${robots}">`,
    `<meta name="geo.region" content="AU-QLD">`,
    `<meta name="geo.placename" content="Toowoomba">`,
    `<meta name="geo.position" content="${GEO_LAT};${GEO_LNG}">`,
    `<meta name="ICBM" content="${GEO_LAT}, ${GEO_LNG}">`,
  ];
  if (verification) {
    lines.push(
      "<!-- Google Search Console: replace the token, or add a DNS TXT record at whatsontoowoomba.au with google-site-verification=TOKEN. Bing Webmaster: replace the token, or add the TXT record Bing shows. -->",
      `<meta name="google-site-verification" content="REPLACE_WITH_GOOGLE_SEARCH_CONSOLE_TOKEN">`,
      `<meta name="msvalidate.01" content="REPLACE_WITH_BING_WEBMASTER_TOKEN">`,
    );
  }
  lines.push(
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="What's On Toowoomba">`,
    `<meta property="og:locale" content="en_AU">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    `<meta property="og:image" content="${OG_IMAGE}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${escapeHtml(OG_ALT)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${OG_IMAGE}">`,
    `<meta name="twitter:image:alt" content="${escapeHtml(OG_ALT)}">`,
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`,
    `<link rel="alternate" type="application/rss+xml" title="What's On Toowoomba RSS" href="${SITE}/feed.xml">`,
    `<link rel="alternate" type="application/atom+xml" title="What's On Toowoomba Atom" href="${SITE}/atom.xml">`,
    `<link rel="alternate" type="text/calendar" title="What's On Toowoomba calendar" href="${SITE}/events.ics">`,
    jsonLdScript(graph),
  );
  return lines.join("\n");
}

const THEME_BOOT = `<script>
    try {
      var savedTheme = localStorage.getItem("wot-theme");
      if (savedTheme === "dark" || savedTheme === "light") document.documentElement.dataset.theme = savedTheme;
    } catch (e) {}
  </script>`;

function renderDocument(options) {
  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#fff6ee">
  ${headBlock(options)}
  <link rel="stylesheet" href="/css/styles.css">
  <link rel="stylesheet" href="/css/seo.css">
  ${THEME_BOOT}
</head>
<body>
${options.body}
  <script type="module" src="/js/theme.js"></script>
  <script type="module" src="/js/analytics.js"></script>
  ${countSnippet()}
</body>
</html>
`;
}

function nav(current) {
  const items = [
    ["/", "Calendar", "Calendar"],
    ["/things-to-do.html", "Things to do", "To do"],
    ["/share.html", "Share something", "Share"],
  ];
  return items.map(([href, wide, short]) => {
    const here = href === current ? ` aria-current="page"` : "";
    const label = wide === short ? wide : `<span class="wide-label">${wide}</span><span class="short-label">${short}</span>`;
    return `<a href="${href}"${here}>${label}</a>`;
  }).join("\n        ");
}

function crumbsHtml(crumbs) {
  const items = crumbs.map((crumb, index) => {
    if (index === crumbs.length - 1) return `<li aria-current="page">${escapeHtml(crumb.name)}</li>`;
    return `<li><a href="${crumb.path}">${escapeHtml(crumb.name)}</a></li>`;
  }).join("");
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items}</ol></nav>`;
}

function layout({ current, crumbs, heading, lede, main }) {
  return `  <a class="skip" href="#content">Skip to content</a>
  <header class="topbar">
    <div class="wrap topbar-row">
      <a class="brand" href="/">What's On <span>Toowoomba</span></a>
      <nav class="nav" aria-label="Sections">
        ${nav(current)}
      </nav>
      <button type="button" class="theme-toggle" id="theme-toggle" aria-pressed="false">Dark</button>
    </div>
  </header>
  <main id="content">
    <section class="things-hero">
      <div class="wrap">
        ${crumbsHtml(crumbs)}
        <p class="eyebrow">Toowoomba, Queensland</p>
        <h1>${escapeHtml(heading)}</h1>
        <div class="lede">${lede}</div>
      </div>
    </section>
    <div class="wrap page-block">
      ${main}
    </div>
  </main>
  <footer class="site-footer">
    <div class="wrap">
      <nav class="feed-links" aria-label="Feeds">
        <a href="/feed.xml">RSS</a>
        <a href="/atom.xml">Atom</a>
        <a href="/events.ics">iCal calendar</a>
        <a href="/search/">Search events</a>
        <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
      </nav>
      <p>Public listings for Toowoomba, Queensland. These pages are rebuilt when the collector runs.</p>
      <p><a href="/credits.html">Photograph credits</a></p>
      ${privacyNoteHtml()}
    </div>
  </footer>`;
}

function renderImage(image) {
  const local = localImage(image);
  if (!local) return "";
  return `<img src="${escapeHtml(local.src)}" alt="${escapeHtml(local.alt)}" width="${local.width}" height="${local.height}" loading="lazy" decoding="async">`;
}

function categoryLabel(id) {
  const match = CATEGORIES.find(([value]) => value === id);
  if (match) return match[1];
  if (id === "general") return "What's on";
  return "Listing";
}

function primaryCategory(event) {
  if (event.kind === "garage") return "garage";
  const categories = event.categories || [];
  return categories.find((id) => id !== "free") || categories[0] || "general";
}

function sourceAnchor(href, label, track = false) {
  const external = /^https?:\/\//i.test(href);
  const extra = external ? ` target="_blank" rel="noopener noreferrer"` : "";
  const hint = external ? `<span class="sr-only"> (opens in a new tab)</span>` : "";
  const outbound = track ? outboundEventPath(href) : "";
  const tracked = outbound ? ` data-track="${escapeHtml(outbound)}" data-track-title="Outbound event link"` : "";
  return `<a class="source-link" href="${escapeHtml(href)}"${extra}${tracked}>${escapeHtml(label)}${hint}</a>`;
}

function renderCard(event) {
  const href = listingPath(event);
  const tone = primaryCategory(event);
  const where = [event.venue, event.suburb].filter(Boolean).filter((part, index, all) => all.indexOf(part) === index).join(" · ");
  const priceClass = isKnownFree(event.price) ? "price free" : "price";
  const summary = event.kind === "garage" && event.items
    ? `<p class="summary">${escapeHtml(event.items)}</p>`
    : event.summary
      ? `<p class="summary">${escapeHtml(clip(event.summary, 220))}</p>`
      : "";
  const sourceHref = event.sourceUrl || "/share.html";
  const sourceLabel = SOURCE_LABELS[event.source] || "Source";
  return `<article class="card">
      <div class="card-media card-media-placeholder" data-tone="${escapeHtml(tone)}" aria-hidden="true"><span class="card-media-label">${escapeHtml(categoryLabel(tone))}</span></div>
      <div class="card-body">
        <h2><a href="${href}">${escapeHtml(event.title)}</a></h2>
        <p class="meta"><time datetime="${escapeHtml(event.start)}">${escapeHtml(formatWhen(event.start, event.hideEnd ? null : event.end, event.allDay))}</time></p>
        ${where ? `<p class="meta">${escapeHtml(where)}</p>` : ""}
        ${summary}
        <div class="card-foot">
          <p class="${priceClass}">${escapeHtml(event.price || "See listing")}</p>
          ${sourceAnchor(sourceHref, sourceLabel, true)}
        </div>
      </div>
    </article>`;
}

function renderListingLine(event) {
  const when = formatWhen(event.start, event.hideEnd ? null : event.end, event.allDay);
  const where = [event.venue, event.suburb].filter(Boolean).filter((part, index, all) => all.indexOf(part) === index).join(" · ");
  const extra = [when, where].filter(Boolean).join(" · ");
  return `<li><a href="${listingPath(event)}">${escapeHtml(event.title)}</a> <span class="meta">${escapeHtml(extra)}</span></li>`;
}

function renderCards(events, emptyHtml) {
  if (!events.length) return emptyHtml;
  return `<div class="listings">${events.map(renderCard).join("\n")}</div>`;
}

function linkGrid(links, label) {
  if (!links.length) return "";
  const anchors = links.map((link) => `<a href="${link.href}">${escapeHtml(link.label)}</a>`).join("\n      ");
  return `<nav class="link-grid" aria-label="${escapeHtml(label)}">\n      ${anchors}\n    </nav>`;
}

function emptyBox(title, copy) {
  return `<div class="empty"><h2>${escapeHtml(title)}</h2><p>${copy}</p><p><a class="btn" href="/share.html">Share something in Toowoomba</a></p></div>`;
}

function relatedList(events) {
  if (!events.length) return "";
  const items = events.map((event) => {
    const when = formatWhen(event.start, event.hideEnd ? null : event.end, event.allDay);
    return `<li><a href="${listingPath(event)}">${escapeHtml(event.title)}</a> <span class="meta">${escapeHtml(when)}</span></li>`;
  }).join("");
  return `<ul class="related">${items}</ul>`;
}

function categoryLinks(currentId) {
  return CATEGORIES.map(([id, label]) => ({
    href: id === "garage" ? "/garage-sales/" : `/category/${id}/`,
    label,
  })).filter((link) => {
    if (currentId === "garage") return link.href !== "/garage-sales/";
    return link.href !== `/category/${currentId}/`;
  });
}

function suburbLinks(suburbs, current) {
  return suburbs
    .filter((name) => name && name !== current)
    .map((name) => ({ href: `/suburb/${slugify(name)}/`, label: name }));
}

function browseBlock(suburbs) {
  const landings = [
    ["/this-weekend/", "Toowoomba events this weekend"],
    ["/this-week/", "Toowoomba events this week"],
    ["/garage-sales/", "Toowoomba garage sales"],
    ["/things-to-do.html", "Things to do in Toowoomba"],
    ["/things-to-do/toowoomba-parkrun/", "Toowoomba parkrun"],
    ["/search/", "Search events"],
  ];
  const categories = CATEGORIES.map(([id, label]) => ({
    href: id === "garage" ? "/garage-sales/" : `/category/${id}/`,
    label,
  }));
  const suburbNav = suburbs.length
    ? `<details><summary>Events by suburb</summary>${linkGrid(suburbs.map((name) => ({ href: `/suburb/${slugify(name)}/`, label: name })), "Suburbs")}</details>`
    : "";
  return `<section class="wrap page-block" aria-labelledby="find-title">
      <h2 id="find-title">Find what's on</h2>
      <p>Looking for what's on in Toowoomba? Start with <a href="/this-weekend/">events this weekend</a>, <a href="/garage-sales/">garage sales</a>, or <a href="/things-to-do.html">things to do</a>, including <a href="/things-to-do/toowoomba-parkrun/">Toowoomba parkrun</a>.</p>
      ${linkGrid(landings.map(([href, label]) => ({ href, label })), "Landing pages")}
      ${linkGrid(categories, "Categories")}
      ${suburbNav}
    </section>`;
}

function homeGraph(events) {
  return [
    organizationNode(),
    websiteNode(),
    itemListNode("Upcoming events in Toowoomba", events.slice(0, 24)),
  ];
}

function pageGraph(crumbs, extra) {
  return [breadcrumbNode(crumbs), organizationNode(), ...extra];
}

function writeLanding(files, { path, title, description, heading, lede, crumbs, events, emptyTitle, emptyCopy, extraGraph = [], current, excludeCategory = "" }) {
  const graph = pageGraph(crumbs, [itemListNode(heading, events), ...extraGraph]);
  const body = layout({
    current,
    crumbs,
    heading,
    lede: `<p>${lede}</p>`,
    main: `${renderCards(events, emptyBox(emptyTitle, emptyCopy))}
    ${linkGrid(categoryLinks(excludeCategory), "Categories")}
    <p><a href="/">Back to the full Toowoomba calendar</a></p>`,
  });
  files.set(`${path.slice(1)}index.html`, renderDocument({
    title,
    description,
    path,
    graph,
    body,
  }));
}

function occurrencesPublic(occurrences) {
  return occurrences.map((event) => ({
    id: event.id,
    kind: event.kind,
    title: event.title,
    start: event.start,
    end: null,
    allDay: false,
    venue: event.venue || "",
    suburb: event.suburb || "",
    address: event.address || "",
    price: event.price || "Free",
    ageGroups: event.ageGroups || [],
    communities: event.communities || [],
    categories: event.categories || [],
    source: event.source,
    sourceUrl: event.sourceUrl,
    summary: event.summary || "",
    pagePath: event.pagePath,
  }));
}

function sitemap(urls, lastmod) {
  const body = urls.map((loc) => `  <url><loc>${escapeXml(absolute(loc))}</loc><lastmod>${lastmod}</lastmod></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function rss(events, generatedAt) {
  const items = events.map((event) => {
    const link = absolute(listingPath(event));
    return `    <item>
      <title>${escapeXml(event.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${escapeXml(new Date(event.start).toUTCString())}</pubDate>
      <description>${escapeXml(eventDescription(event))}</description>
    </item>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>What's On Toowoomba</title>
    <link>${SITE}/</link>
    <description>Upcoming events, garage sales, and community listings in Toowoomba, Queensland.</description>
    <language>en-AU</language>
    <lastBuildDate>${escapeXml(new Date(generatedAt || events[0]?.start || Date.now()).toUTCString())}</lastBuildDate>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

function atom(events, generatedAt) {
  const updated = new Date(generatedAt || events[0]?.start || Date.now()).toISOString();
  const entries = events.map((event) => {
    const link = absolute(listingPath(event));
    return `  <entry>
    <title>${escapeXml(event.title)}</title>
    <link href="${escapeXml(link)}" rel="alternate"/>
    <id>${escapeXml(link)}</id>
    <updated>${escapeXml(new Date(event.start).toISOString())}</updated>
    <summary>${escapeXml(eventDescription(event))}</summary>
  </entry>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-AU">
  <title>What's On Toowoomba</title>
  <link href="${SITE}/atom.xml" rel="self"/>
  <link href="${SITE}/" rel="alternate"/>
  <id>${SITE}/</id>
  <updated>${escapeXml(updated)}</updated>
${entries}
</feed>
`;
}

function icsStamp(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsLocal(iso) {
  const [date, time] = iso.split("T");
  return `${date.replace(/-/g, "")}T${time.slice(0, 8).replace(/:/g, "")}`;
}

function foldIcsLine(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(bytes.length, start + limit);
    if (end < bytes.length) {
      while (end > start && (bytes[end] & 0xc0) === 0x80) end -= 1;
      if (end === start) end = Math.min(bytes.length, start + limit);
    }
    parts.push(Buffer.from(bytes.subarray(start, end)).toString("utf8"));
    start = end;
    limit = 74;
  }
  return parts.join("\r\n ");
}

function icsEscape(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function ics(events, generatedAt) {
  const stamp = icsStamp(generatedAt || events[0]?.start || new Date().toISOString());
  const eventsText = events.map((event) => {
    const uid = event.pagePath
      ? `${event.id}-${event.start.slice(0, 10).replace(/-/g, "")}@whatsontoowoomba.au`
      : `${event.id}@whatsontoowoomba.au`;
    const lines = [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `SUMMARY:${icsEscape(event.title)}`,
      `DESCRIPTION:${icsEscape(eventDescription(event))}`,
      `URL:${absolute(listingPath(event))}`,
      `LOCATION:${icsEscape([event.venue, event.address || event.suburb].filter(Boolean).join(", "))}`,
      `STATUS:${eventStatusName(event) === "EventCancelled" ? "CANCELLED" : "CONFIRMED"}`,
    ];
    if (event.allDay) {
      const day = event.start.slice(0, 10).replace(/-/g, "");
      lines.push(`DTSTART;VALUE=DATE:${day}`);
      const endDay = (event.end && !event.hideEnd ? event.end.slice(0, 10) : addDays(event.start.slice(0, 10), 1)).replace(/-/g, "");
      lines.push(`DTEND;VALUE=DATE:${endDay}`);
    } else {
      lines.push(`DTSTART;TZID=Australia/Brisbane:${icsLocal(event.start)}`);
      if (event.end && !event.hideEnd) lines.push(`DTEND;TZID=Australia/Brisbane:${icsLocal(event.end)}`);
    }
    lines.push("END:VEVENT");
    return lines.map(foldIcsLine).join("\r\n");
  }).join("\r\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//What's On Toowoomba//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:What's On Toowoomba",
    "X-WR-TIMEZONE:Australia/Brisbane",
    "BEGIN:VTIMEZONE",
    "TZID:Australia/Brisbane",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+1000",
    "TZOFFSETTO:+1000",
    "TZNAME:AEST",
    "END:STANDARD",
    "END:VTIMEZONE",
    eventsText,
    "END:VCALENDAR",
    "",
  ].filter((part) => part !== "").join("\r\n");
}

function notFoundPage() {
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Page not found", path: "/404.html" },
  ];
  const body = layout({
    current: "",
    crumbs,
    heading: "Page not found",
    lede: "<p>That address is not on What's On Toowoomba. The calendar, this weekend, garage sales, and things to do are linked below.</p>",
    main: linkGrid([
      { href: "/", label: "What's on in Toowoomba" },
      { href: "/this-weekend/", label: "Toowoomba events this weekend" },
      { href: "/garage-sales/", label: "Toowoomba garage sales" },
      { href: "/things-to-do.html", label: "Things to do in Toowoomba" },
      { href: "/search/", label: "Search events" },
    ], "Popular pages"),
  });
  return renderDocument({
    title: pageTitle("Page not found"),
    description: "This page is not on What's On Toowoomba. Browse events, garage sales, and things to do in Toowoomba, Queensland.",
    path: "/404.html",
    robots: "noindex,follow",
    graph: [organizationNode()],
    body,
  });
}

function searchPage(events) {
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Search", path: "/search/" },
  ];
  const items = events.map((event) => {
    const blob = [event.title, event.venue, event.suburb, event.summary, event.items].filter(Boolean).join(" ").toLowerCase();
    const when = formatWhen(event.start, event.hideEnd ? null : event.end, event.allDay);
    const where = [event.venue, event.suburb].filter(Boolean).join(" · ");
    return `<li data-search="${escapeHtml(blob)}"><a href="${listingPath(event)}">${escapeHtml(event.title)}</a> <span class="meta">${escapeHtml(when)}${where ? ` · ${escapeHtml(where)}` : ""}</span></li>`;
  }).join("\n");
  const body = `${layout({
    current: "/search/",
    crumbs,
    heading: "Search Toowoomba events",
    lede: "<p>Search upcoming events, garage sales, and parkrun by title, venue, or suburb. Every listing is in the HTML of this page.</p>",
    main: `<form class="panel" action="/search/" method="get" role="search">
      <label>Search
        <input id="q" type="search" name="q" maxlength="120" placeholder="Markets, Queens Park, Highfields">
      </label>
      <p class="form-actions"><button class="btn" type="submit">Search</button></p>
    </form>
    <p id="search-status" class="status">${events.length} upcoming listings.</p>
    <ul class="related" id="search-results">${items}</ul>`,
  })}
  <script src="/js/search.js"></script>`;
  return renderDocument({
    title: pageTitle("Search events"),
    description: "Search what's on in Toowoomba by title, venue, or suburb. Results are upcoming events, garage sales, and parkrun.",
    path: "/search/",
    graph: pageGraph(crumbs, [itemListNode("Search Toowoomba events", events.slice(0, 24))]),
    body,
  });
}

function renderPlaceCard(place, next) {
  const when = next ? ` Next session: ${formatWhen(next.start, null, false)}.` : "";
  const tone = place.type || "parks";
  const label = TYPE_LABELS[tone] || "Things to do";
  const sameAs = Array.isArray(place.sameAs) ? place.sameAs[0] : place.sameAs || "";
  const area = place.area || place.suburb || "";
  return `<article class="thing-card" data-tone="${escapeHtml(tone)}">
      ${renderImage(place.image)}
      <p class="chip" data-tone="${escapeHtml(tone)}">${escapeHtml(label)}</p>
      <h3><a href="/things-to-do/${place.id}/">${escapeHtml(place.name)}</a></h3>
      ${area ? `<p class="meta">${escapeHtml(area)}</p>` : ""}
      <p class="summary">${escapeHtml(clip(`${place.description}${when}`, 280))}</p>
      ${sameAs ? sourceAnchor(sameAs, place.source || "Official page") : ""}
    </article>`;
}

function placeAddress(place) {
  const locality = place.suburb || place.area || "";
  return [place.streetAddress, locality, locality ? "QLD" : "", place.postcode].filter(Boolean).join(", ");
}

export function buildSite({ events, submissions, places, now, generatedAt, indexHtml, thingsHtml = "" }) {
  const { places: readyPlaces, calendar, occurrences, all } = prepareListings({ events, submissions, places, now });
  const files = new Map();
  const today = brisbaneYmd(now);
  const weekend = dateWindow("weekend", now);
  const week = dateWindow("week", now);
  const suburbs = [...new Set([
    ...all.map((event) => event.suburb).filter(Boolean),
    ...readyPlaces.map((place) => place.suburb).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b));

  const homeTitle = "What's on in Toowoomba";
  const homeDescription = "What's on in Toowoomba: events this weekend and this week, garage sales, parkrun, and things to do across Toowoomba, Queensland.";
  let nextIndex = indexHtml;
  nextIndex = replaceMarker(nextIndex, "head", headBlock({
    title: homeTitle,
    description: homeDescription,
    path: "/",
    graph: homeGraph(all),
    verification: true,
  }));
  nextIndex = replaceMarker(nextIndex, "status", `${all.length} upcoming listing${all.length === 1 ? "" : "s"} in Toowoomba`);
  nextIndex = replaceMarker(nextIndex, "listings", `<ul class="related">${all.map(renderListingLine).join("\n")}</ul>`);
  nextIndex = replaceMarker(nextIndex, "browse", browseBlock(suburbs));
  nextIndex = stampHtml(nextIndex);

  for (const event of calendar) {
    const crumbs = [
      { name: "Home", path: "/" },
      { name: "What's on", path: "/" },
      { name: event.title, path: listingPath(event) },
    ];
    const primary = (event.categories || []).find((id) => id !== "free") || (event.categories || [])[0];
    if (primary) {
      const copy = categoryCopy(primary);
      crumbs.splice(1, 1, {
        name: copy.heading.replace(/ in Toowoomba$/, ""),
        path: primary === "garage" ? "/garage-sales/" : `/category/${primary}/`,
      });
    }
    const where = [event.venue, event.suburb, event.address].filter(Boolean).filter((part, index, list) => list.indexOf(part) === index);
    const sourceLabel = SOURCE_LABELS[event.source] || "the original listing";
    const relatedPool = all.filter((other) => other.id !== event.id && ((other.suburb && other.suburb === event.suburb) || (primary && (other.categories || []).includes(primary))));
    const related = relatedPool.slice(0, 5);
    const suburbHref = event.suburb && suburbs.includes(event.suburb) ? `/suburb/${slugify(event.suburb)}/` : "";
    const body = layout({
      current: "",
      crumbs,
      heading: event.title,
      lede: `<p>${escapeHtml(eventDescription(event))}</p>`,
      main: `<article class="panel">
      <p class="meta">${escapeHtml(formatWhen(event.start, event.hideEnd ? null : event.end, event.allDay))}</p>
      ${where.length ? `<p class="meta">${escapeHtml(where.join(" · "))}</p>` : ""}
      <p class="${isKnownFree(event.price) ? "price free" : "price"}">${escapeHtml(event.price || "See listing")}</p>
      ${event.summary ? `<p>${escapeHtml(event.summary)}</p>` : ""}
      ${event.items ? `<p>${escapeHtml(event.items)}</p>` : ""}
      <p class="stack-links">${event.sourceUrl ? sourceAnchor(event.sourceUrl, `View the ${sourceLabel} listing`, true) : ""}</p>
    </article>
    ${suburbHref ? `<p><a href="${suburbHref}">More events in ${escapeHtml(event.suburb)}</a></p>` : ""}
    ${primary ? `<p><a href="${primary === "garage" ? "/garage-sales/" : `/category/${primary}/`}">${escapeHtml(categoryCopy(primary).heading)}</a></p>` : ""}
    ${related.length ? `<section><h2>More in Toowoomba</h2>${relatedList(related)}</section>` : ""}`,
    });
    files.set(`events/${event.id}/index.html`, renderDocument({
      title: eventPageTitle(event),
      description: clip(eventDescription(event), 155),
      path: listingPath(event),
      graph: pageGraph(crumbs, [eventNode(event)]),
      body,
    }));
  }

  for (const [id] of CATEGORIES) {
    if (id === "garage") continue;
    const copy = categoryCopy(id);
    const listed = all.filter((event) => event.kind !== "garage" && (event.categories || []).includes(id));
    const crumbs = [
      { name: "Home", path: "/" },
      { name: copy.heading, path: `/category/${id}/` },
    ];
    writeLanding(files, {
      path: `/category/${id}/`,
      title: pageTitle(copy.heading),
      description: clip(`${copy.intro} Toowoomba, Queensland.`, 155),
      heading: copy.heading,
      lede: escapeHtml(copy.intro),
      crumbs,
      events: listed,
      emptyTitle: "Nothing in this category yet",
      emptyCopy: "No upcoming listing is tagged here. The calendar still has other events, and you can send one through the share form.",
      current: `/category/${id}/`,
      excludeCategory: id,
    });
  }

  const garageCopy = categoryCopy("garage");
  const garageEvents = all.filter((event) => event.kind === "garage");
  writeLanding(files, {
    path: "/garage-sales/",
    title: pageTitle("Toowoomba garage sales"),
    description: "Toowoomba garage sales with the date, suburb or address, and items for sale. Add a sale if it is missing from the public listings.",
    heading: garageCopy.heading,
    lede: escapeHtml(garageCopy.intro),
    crumbs: [
      { name: "Home", path: "/" },
      { name: "Garage sales", path: "/garage-sales/" },
    ],
    events: garageEvents,
    emptyTitle: "No garage sales listed",
    emptyCopy: "No upcoming garage sale is on the calendar. Send the date, suburb, and a list of items and it can be added after review.",
    current: "/garage-sales/",
    excludeCategory: "garage",
  });

  for (const suburb of suburbs) {
    const listed = all.filter((event) => event.suburb === suburb);
    const localPlaces = readyPlaces.filter((place) => place.suburb === suburb);
    const placeLinks = localPlaces.map((place) => `<li><a href="/things-to-do/${place.id}/">${escapeHtml(place.name)}</a></li>`).join("");
    const crumbs = [
      { name: "Home", path: "/" },
      { name: suburb, path: `/suburb/${slugify(suburb)}/` },
    ];
    const heading = `What's on in ${suburb}`;
    const intro = `Upcoming events in ${suburb}, in the Toowoomba region, Queensland. Dates and venues come from public listings.`;
    const graph = pageGraph(crumbs, [
      itemListNode(heading, listed),
      ...localPlaces.map(placeNode),
    ]);
    const body = layout({
      current: "",
      crumbs,
      heading,
      lede: `<p>${escapeHtml(intro)}</p>`,
      main: `${localPlaces.length ? `<section><h2>Places</h2><ul class="related">${placeLinks}</ul></section>` : ""}
    ${renderCards(listed, emptyBox("No dated listings in this suburb", "Places in the suburb are above when we have them. Other suburbs are linked below."))}
    ${linkGrid(suburbLinks(suburbs, suburb).slice(0, 12), "Other suburbs")}`,
    });
    files.set(`suburb/${slugify(suburb)}/index.html`, renderDocument({
      title: pageTitle(heading),
      description: clip(intro, 155),
      path: `/suburb/${slugify(suburb)}/`,
      graph,
      body,
    }));
  }

  const weekendEvents = all.filter((event) => inDateWindow(event, "weekend", now));
  const weekEvents = all.filter((event) => inDateWindow(event, "week", now));
  const weekendIntro = `Toowoomba events this weekend, ${longDate(weekend.start)} to ${longDate(weekend.end)}. These are the public listings whose date falls on that Saturday or Sunday, including sport, markets, music, and garage sales when we have them.`;
  const weekIntro = `Toowoomba events this week, ${longDate(week.start)} to ${longDate(week.end)}. The week is Monday to Sunday, Australia/Brisbane time.`;
  writeLanding(files, {
    path: "/this-weekend/",
    title: pageTitle("Toowoomba events this weekend"),
    description: clip(weekendIntro, 155),
    heading: "Toowoomba events this weekend",
    lede: escapeHtml(weekendIntro),
    crumbs: [
      { name: "Home", path: "/" },
      { name: "This weekend", path: "/this-weekend/" },
    ],
    events: weekendEvents,
    emptyTitle: "Nothing listed this weekend",
    emptyCopy: "No public listing falls on this Saturday or Sunday. The full calendar covers later dates, and a missing event can be sent for review.",
    current: "/this-weekend/",
  });
  writeLanding(files, {
    path: "/this-week/",
    title: pageTitle("Toowoomba events this week"),
    description: clip(weekIntro, 155),
    heading: "Toowoomba events this week",
    lede: escapeHtml(weekIntro),
    crumbs: [
      { name: "Home", path: "/" },
      { name: "This week", path: "/this-week/" },
    ],
    events: weekEvents,
    emptyTitle: "Nothing listed this week",
    emptyCopy: "No public listing falls between Monday and Sunday. Later dates are on the calendar.",
    current: "/this-week/",
  });

  const occurrenceByPlace = new Map(occurrences.map((event) => [event.placeId, event]));
  const thingsIntro = "Things to do in Toowoomba, Queensland: walks, parks, lookouts, scenic drives, and Saturday parkrun. Toowoomba parkrun starts at 7:00 am at Queens Park on Lindsay Street, East Toowoomba. Highfields parkrun starts at the same time at Highfields Sports and Recreation Park, 220 Barracks Road. Dated concerts, markets, and classes are on the calendar.";
  const placeCards = readyPlaces.map((place) => renderPlaceCard(place, occurrenceByPlace.get(place.id))).join("\n");
  const placeGrid = readyPlaces.length
    ? `<div class="things-grid">${placeCards}</div>`
    : emptyBox("Places will appear here", "The calendar still lists dated events while place pages are empty.");
  const thingsCrumbs = [
    { name: "Home", path: "/" },
    { name: "Things to do", path: "/things-to-do.html" },
  ];
  const thingsGraph = pageGraph(thingsCrumbs, readyPlaces.map(placeNode));
  const thingsBody = layout({
    current: "/things-to-do.html",
    crumbs: thingsCrumbs,
    heading: "Things to do in Toowoomba",
    lede: `<p>${escapeHtml(thingsIntro)}</p>`,
    main: `${placeGrid}
    <p>For filters, open <a href="/things-to-do.html">the things to do list</a>. For a dated list, see <a href="/this-weekend/">Toowoomba events this weekend</a> and <a href="/category/sport/">sport in Toowoomba</a>.</p>`,
  });
  files.set("things-to-do/index.html", renderDocument({
    title: pageTitle("Things to do in Toowoomba"),
    description: clip(thingsIntro, 155),
    path: "/things-to-do.html",
    graph: thingsGraph,
    body: thingsBody,
  }));
  let nextThings = thingsHtml;
  if (thingsHtml) {
    nextThings = replaceMarker(nextThings, "head", headBlock({
      title: pageTitle("Things to do around Toowoomba"),
      description: clip(thingsIntro, 155),
      path: "/things-to-do.html",
      graph: thingsGraph,
    }));
    nextThings = replaceMarker(nextThings, "places", placeGrid);
    nextThings = stampHtml(nextThings);
  }

  for (const place of readyPlaces) {
    const next = occurrenceByPlace.get(place.id);
    const crumbs = [
      { name: "Home", path: "/" },
      { name: "Things to do", path: "/things-to-do.html" },
      { name: place.name, path: `/things-to-do/${place.id}/` },
    ];
    const sameAs = Array.isArray(place.sameAs) ? place.sameAs : place.sameAs ? [place.sameAs] : [];
    const address = placeAddress(place);
    const nextLine = next ? `<p>Next session: ${escapeHtml(formatWhen(next.start, null, false))}.</p>` : "";
    const graph = pageGraph(crumbs, [placeNode(place), next ? eventNode(next) : null]);
    const body = layout({
      current: "/things-to-do.html",
      crumbs,
      heading: place.name,
      lede: `<p>${escapeHtml(place.description)}</p>`,
      main: `<article class="panel">
      ${renderImage(place.image)}
      <p class="meta">${escapeHtml(address)}</p>
      <p class="${place.free ? "price free" : "price"}">${place.free ? "Free" : "See the venue for admission"}</p>
      ${nextLine}
      ${sameAs[0] ? `<p class="stack-links">${sourceAnchor(sameAs[0], place.source || "Official page")}</p>` : ""}
    </article>
    <p><a href="/things-to-do.html">All things to do in Toowoomba</a></p>`,
    });
    files.set(`things-to-do/${place.id}/index.html`, renderDocument({
      title: pageTitle(place.name),
      description: clip(`${place.description} ${address}.`, 155),
      path: `/things-to-do/${place.id}/`,
      graph,
      body,
    }));
  }

  files.set("search/index.html", searchPage(all));
  files.set("404.html", notFoundPage());
  files.set("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  const urls = [
    "/",
    "/this-weekend/",
    "/this-week/",
    "/garage-sales/",
    "/things-to-do.html",
    ...readyPlaces.map((place) => `/things-to-do/${place.id}/`),
    ...CATEGORIES.filter(([id]) => id !== "garage").map(([id]) => `/category/${id}/`),
    ...suburbs.map((name) => `/suburb/${slugify(name)}/`),
    ...calendar.map((event) => `/events/${event.id}/`),
    "/search/",
    "/share.html",
    "/feed.xml",
    "/atom.xml",
    "/events.ics",
  ];
  files.set("sitemap.xml", sitemap(urls, today));
  const stamp = generatedAt || now.toISOString();
  files.set("feed.xml", rss(all, stamp));
  files.set("atom.xml", atom(all, stamp));
  files.set("events.ics", ics(all, stamp));
  files.set("data/occurrences.json", `${JSON.stringify({ events: occurrencesPublic(occurrences) }, null, 2)}\n`);

  return { files, indexHtml: nextIndex, thingsHtml: nextThings, occurrences, calendar, all, places: readyPlaces };
}

export function extractGraph(html) {
  const match = String(html).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  return JSON.parse(match[1]);
}

export function validateEventNode(node) {
  const errors = [];
  if (node?.["@type"] !== "Event") errors.push("type");
  if (!node?.name) errors.push("name");
  if (!node?.startDate) errors.push("startDate");
  if (!node?.eventStatus) errors.push("eventStatus");
  const location = node?.location;
  if (!location) errors.push("location");
  else if (location["@type"] === "VirtualLocation") {
    if (!location.url) errors.push("virtual url");
  } else {
    if (!location.name) errors.push("location name");
    if (location.address?.["@type"] !== "PostalAddress") errors.push("address");
    if (!location.address?.addressLocality) errors.push("addressLocality");
    if (location.address?.addressCountry !== "AU") errors.push("addressCountry");
    if (location.address?.addressRegion !== "QLD") errors.push("addressRegion");
  }
  if (node?.offers) {
    const offer = node.offers;
    if (!offer.priceCurrency) errors.push("priceCurrency");
    if (offer["@type"] === "AggregateOffer") {
      if (offer.lowPrice == null || offer.highPrice == null) errors.push("aggregate price");
    } else if (offer.price == null) errors.push("price");
  }
  return errors;
}

export function validatePlaceNode(node) {
  const errors = [];
  const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
  if (!types.some((type) => PLACE_TYPES.has(type))) errors.push("type");
  if (!node?.name) errors.push("name");
  if (!node?.address || node.address.addressCountry !== "AU") errors.push("address");
  return errors;
}

export function findNode(graph, type) {
  return (graph?.["@graph"] || []).find((node) => {
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    return types.includes(type);
  });
}
