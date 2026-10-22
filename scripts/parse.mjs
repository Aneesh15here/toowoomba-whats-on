/**
 * Parsers for public HTML listings. They only return dates that are written on the page.
 */

import {
  brisbaneIso,
  decodeHtml,
  htmlToText,
  inToowoombaRegion,
  monthNumber,
  parseTimes,
  priceLabel,
  tagListing,
} from "./pure.mjs";

const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const DATE_SOURCE = `\\b(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\\s+)?(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})|(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?)(?:,?\\s+(20\\d{2}))?`;

function dateRegex() {
  return new RegExp(DATE_SOURCE, "gi");
}

export function mainContent(html) {
  const start = String(html || "").search(/class=['"]oc-page-title/i);
  const slice = start >= 0 ? html.slice(start) : String(html || "");
  const end = slice.search(/id=['"]share-page|Was this page helpful/i);
  return end > 0 ? slice.slice(0, end) : slice.slice(0, 30000);
}

export function parseCouncilPage(html, pageUrl, now = new Date()) {
  const content = mainContent(html);
  const pageTitle = titleFrom(content) || titleFrom(html);
  const labeled = parseLabeledPanels(content, pageTitle, pageUrl, now);
  if (labeled.length) return labeled;
  const listed = parseListItems(content, pageTitle, pageUrl, now);
  if (listed.length) return listed;
  const prose = parseProseEvent(htmlToText(content), pageTitle, pageUrl, now);
  return prose ? [prose] : [];
}

export function parseTimsEvents(html, pageUrl) {
  const events = [];
  const chunks = String(html || "").match(/<h1 class="eventlist-title"[\s\S]*?(?=<h1 class="eventlist-title"|$)/gi) || [];
  for (const chunk of chunks) {
    const titleMatch = chunk.match(/class="eventlist-title-link"[^>]*>([\s\S]*?)<\/a>/i);
    const dateMatch = chunk.match(/<time class="event-date"[^>]*datetime="(\d{4}-\d{2}-\d{2})"/i);
    const hrefMatch = chunk.match(/href="(\/events\/[^"]+)"/i);
    if (!titleMatch || !dateMatch) continue;
    const title = htmlToText(titleMatch[1]);
    const startClock = chunk.match(/<time class="event-time-localized-start"[^>]*>([\s\S]*?)<\/time>/i);
    const endClock = chunk.match(/<time class="event-time-localized-end"[^>]*>([\s\S]*?)<\/time>/i);
    const [year, month, day] = dateMatch[1].split("-").map(Number);
    const slots = parseTimes(
      `${startClock ? htmlToText(startClock[1]) : ""} ${endClock ? `- ${htmlToText(endClock[1])}` : ""}`,
    );
    const slot = slots[0];
    const built = brisbaneIso(year, month, day, slot?.start || null);
    const end = slot?.end ? brisbaneIso(year, month, day, slot.end).iso : null;
    const addressItem = chunk.match(/<li[^>]*eventlist-meta-address[^>]*>[\s\S]*?<\/li>/i);
    const addressHtml = addressItem ? addressItem[0].replace(/<a[\s\S]*?<\/a>/i, "") : "";
    const venue = htmlToText(addressHtml) || "Toowoomba";
    const excerpt = chunk.match(/class="eventlist-excerpt"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
    const summary = excerpt ? htmlToText(excerpt[1]).slice(0, 280) : "";
    events.push(finishListing({
      kind: "event",
      title,
      start: built.iso,
      end,
      allDay: built.allDay,
      venue,
      suburb: "Toowoomba",
      address: venue,
      price: /\bfree\b/i.test(summary) ? "Free" : "See listing",
      summary,
      source: "multicultural",
      sourceUrl: hrefMatch ? new URL(decodeHtml(hrefMatch[1]), pageUrl).href : pageUrl,
    }));
  }
  return events.filter((event) => event.title);
}

export function parseMalayaliEvents(html, pageUrl) {
  const events = [];
  const re = /<span>\s*([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?[^<]*)<\/span>[\s\S]*?<h4>([\s\S]*?)<\/h4>[\s\S]*?<p>([\s\S]*?)<\/p>/gi;
  let match = re.exec(String(html || ""));
  while (match) {
    const parsed = parseDatePhrase(match[1]);
    if (parsed) {
      const title = htmlToText(match[2]);
      const summary = htmlToText(match[3]);
      const built = brisbaneIso(parsed.year, parsed.month, parsed.day, null);
      events.push(finishListing({
        kind: "event",
        title,
        start: built.iso,
        end: null,
        allDay: true,
        venue: "Toowoomba Malayali Association",
        suburb: "Middle Ridge",
        address: "1 Scullin St, Middle Ridge, Toowoomba QLD 4350",
        price: "See listing",
        summary,
        source: "multicultural",
        sourceUrl: pageUrl,
      }));
    }
    match = re.exec(html);
  }
  return events;
}

export function parseGarageSales(html, pageUrl) {
  const events = [];
  const blocks = String(html || "").split(/class="notice-block /).slice(1);
  for (const block of blocks) {
    const title = htmlToText((block.match(/<h2 class="listing-header">([\s\S]*?)<\/h2>/i) || [])[1] || "");
    if (!title) continue;
    const suburb = htmlToText((block.match(/class="location-link"[\s\S]*?<h3 class="location">([\s\S]*?)<\/h3>/i) || [])[1] || "");
    const placeChunk = (block.match(/id="garage-sale-place-date"[\s\S]*?<\/div>/i) || [])[0] || "";
    const placeLines = [...placeChunk.matchAll(/<p>([\s\S]*?)<\/p>/gi)].map((item) => htmlToText(item[1]));
    const address = placeLines[0] || suburb;
    const whenLine = placeLines.find((line) => /\b(?:mon|tue|wed|thu|fri|sat|sun)/i.test(line)) || "";
    const when = parseGarageWhen(whenLine);
    if (!when) continue;
    const description = htmlToText(
      (block.match(/<div class="max-height-static">([\s\S]*?)<\/div>/i) || [])[1] || "",
    );
    const href = (block.match(/href="(\/buy-sell\/garage-sales\/[^"]+)"/i) || [])[1];
    events.push(finishListing({
      kind: "garage",
      title,
      start: when.start,
      end: when.end,
      allDay: when.allDay,
      venue: address,
      suburb: suburb.split(",")[0].trim(),
      address,
      price: "See listing",
      items: description.slice(0, 500),
      summary: description.slice(0, 240),
      source: "garage",
      sourceUrl: href ? new URL(href, pageUrl).href : pageUrl,
    }));
  }
  return events;
}

function parseLabeledPanels(content, pageTitle, pageUrl, now) {
  const panels = content.split(/class="oc-wysiwyg-container-panel"/i).slice(1);
  const events = [];
  const pageYear = yearIn(pageTitle) || yearIn(htmlToText(content).slice(0, 500));
  for (const panel of panels) {
    const text = htmlToText(panel);
    if (!/\bdate\s*:/i.test(text)) continue;
    const heading = htmlToText((panel.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || "");
    const lines = text.split("\n").map(cleanLine).filter(Boolean);
    const dateIndex = lines.findIndex((line) => /^date\s*:/i.test(line));
    const title = (dateIndex > 0 ? lines[dateIndex - 1] : "") || heading || pageTitle;
    const dateLine = (text.match(/date\s*:\s*([^\n]+)/i) || [])[1] || "";
    const timeLine = (text.match(/time\s*:\s*([^\n]+)/i) || [])[1] || "";
    const location = cleanLine((text.match(/location\s*:\s*([^\n]+)/i) || [])[1] || "Toowoomba");
    const dates = parseDateList(dateLine, yearIn(title) || pageYear, now);
    const slots = parseTimes(timeLine);
    const price = priceFromText(text);
    for (const date of dates) {
      const used = slots.length ? slots : [{ start: null, end: null }];
      for (const slot of used) {
        const built = brisbaneIso(date.year, date.month, date.day, slot.start);
        events.push(finishListing({
          kind: "event",
          title,
          start: built.iso,
          end: slot.end ? brisbaneIso(date.year, date.month, date.day, slot.end).iso : null,
          allDay: built.allDay,
          venue: location,
          suburb: suburbFrom(location),
          address: location,
          price,
          summary: text.slice(0, 240),
          source: "council",
          sourceUrl: pageUrl,
        }));
      }
    }
  }
  return events;
}

function parseListItems(content, pageTitle, pageUrl, now) {
  const events = [];
  const pageVenue = venueFromText(htmlToText(content));
  const tokenRe = /<h2[^>]*>([\s\S]*?)<\/h2>|<li[^>]*>([\s\S]*?)<\/li>/gi;
  let program = pageTitle;
  let match = tokenRe.exec(content);
  while (match) {
    if (match[1]) {
      program = htmlToText(match[1]) || program;
    } else if (match[2]) {
      const raw = htmlToText(match[2]);
      const found = [...raw.matchAll(dateRegex())];
      if (found.length) {
        const colon = raw.indexOf(":");
        const venue = colon > 0 ? raw.slice(0, colon).replace(/\s+/g, " ").trim() : pageVenue;
        const rest = colon > 0 ? raw.slice(colon + 1) : raw;
        const withoutDates = rest.replace(dateRegex(), " ");
        const slots = parseTimes(withoutDates);
        const dates = sequenceDates(found.map(dateParts), now);
        const explicitVenue = colon > 0;
        const title = explicitVenue ? `${program} — ${venue}` : pageTitle;
        const price = priceFromText(`${program} ${raw}`);
        for (const date of dates) {
          const used = slots.length ? slots : [{ start: null, end: null }];
          for (const slot of used) {
            const built = brisbaneIso(date.year, date.month, date.day, slot.start);
            events.push(finishListing({
              kind: "event",
              title,
              start: built.iso,
              end: slot.end ? brisbaneIso(date.year, date.month, date.day, slot.end).iso : null,
              allDay: built.allDay,
              venue: explicitVenue ? venue : pageVenue,
              suburb: suburbFrom(explicitVenue ? venue : pageVenue),
              address: explicitVenue ? venue : pageVenue,
              price,
              summary: `${pageTitle}. ${program}. ${raw}`.slice(0, 280),
              source: pageUrl.includes("/Libraries/") ? "library" : "council",
              sourceUrl: pageUrl,
              extraCategories: pageUrl.includes("/Libraries/") ? ["education"] : [],
            }));
          }
        }
      }
    }
    match = tokenRe.exec(content);
  }
  return events;
}

function parseProseEvent(text, pageTitle, pageUrl, now) {
  const match = text.match(
    new RegExp(
      `(?:held on|will be held on)\\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\\s+(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})|(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?)(?:,?\\s+(20\\d{2}))?([\\s\\S]{0,180})`,
      "i",
    ),
  );
  if (!match) return null;
  const day = Number(match[1] || match[4]);
  const month = monthNumber(match[2] || match[3]);
  const year = Number(match[5] || yearIn(pageTitle) || brisbaneYear(now));
  if (!day || !month) return null;
  const tail = match[6] || "";
  const venueMatch = tail.match(/\bat\s+(.+?)(?:\s+from\s+|\.)/i);
  const venue = cleanLine(venueMatch ? venueMatch[1] : "Toowoomba");
  const slots = parseTimes(tail);
  const slot = slots[0] || { start: null, end: null };
  const built = brisbaneIso(year, month, day, slot.start);
  return finishListing({
    kind: "event",
    title: pageTitle,
    start: built.iso,
    end: slot.end ? brisbaneIso(year, month, day, slot.end).iso : null,
    allDay: built.allDay,
    venue,
    suburb: suburbFrom(venue),
    address: venue,
    price: priceFromText(text),
    summary: text.slice(0, 240),
    source: "council",
    sourceUrl: pageUrl,
  });
}

function parseGarageWhen(line) {
  const match = String(line || "").match(
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(20\d{2}))?\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM))(?:\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)))?/i,
  );
  if (!match) return null;
  const year = Number(match[3] || new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
  }).format(new Date()));
  const month = monthNumber(match[2]);
  const day = Number(match[1]);
  if (!month) return null;
  const slots = parseTimes(`${match[4]}${match[5] ? ` - ${match[5]}` : ""}`);
  const slot = slots[0] || { start: null, end: null };
  const built = brisbaneIso(year, month, day, slot.start);
  return {
    start: built.iso,
    end: slot.end ? brisbaneIso(year, month, day, slot.end).iso : null,
    allDay: built.allDay,
  };
}

function parseDatePhrase(text) {
  const match = String(text || "").match(new RegExp(`(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+\\w+)?\\s+(20\\d{2})`, "i"));
  if (!match) return null;
  return { month: monthNumber(match[1]), day: Number(match[2]), year: Number(match[3]) };
}

function parseDateList(text, fallbackYear, now) {
  const found = [...String(text || "").matchAll(dateRegex())];
  if (!found.length) return [];
  return sequenceDates(found.map(dateParts), now, fallbackYear);
}

function dateParts(match) {
  const day = Number(match[1] || match[4]);
  const month = monthNumber(match[2] || match[3]);
  const year = match[5] ? Number(match[5]) : null;
  return { day, month, year };
}

function sequenceDates(partials, now, fallbackYear) {
  let year = fallbackYear || brisbaneYear(now);
  let previous = null;
  return partials
    .filter((item) => item.day && item.month)
    .map((item) => {
      let used = item.year || year;
      const index = item.month * 40 + item.day;
      if (!item.year && previous != null && index + 20 < previous) {
        used = year + 1;
        year = used;
      } else if (item.year) {
        year = item.year;
      }
      previous = index;
      return { ...item, year: used };
    });
}

function finishListing(event) {
  const tags = tagListing(event);
  return {
    ...event,
    ageGroups: tags.ageGroups,
    communities: tags.communities,
    categories: tags.categories,
  };
}

function titleFrom(html) {
  const match = String(html || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>|<title>([\s\S]*?)<\/title>/i);
  const raw = htmlToText(match ? match[1] || match[2] : "");
  return raw.replace(/\s+Toowoomba Regional Council\s*$/i, "").trim();
}

function yearIn(text) {
  const match = String(text || "").match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function brisbaneYear(now) {
  return Number(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
  }).format(now));
}

function venueFromText(text) {
  const held = text.match(/held at\s+([^,.]{3,80})/i);
  const street = text.match(/\b(\d+\s+[A-Za-z][A-Za-z ]+? Street(?:,?\s+[A-Za-z ]+)?)/i);
  const parts = [held ? held[1] : "", street ? street[1] : ""].map(cleanLine).filter(Boolean);
  if (parts.length) return [...new Set(parts)].join(", ");
  return "Toowoomba";
}

function suburbFrom(venue) {
  const match = String(venue || "").match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*,?\s*(?:QLD|Toowoomba)?/);
  if (/toowoomba city/i.test(venue)) return "Toowoomba City";
  if (/toowoomba/i.test(venue) && !/toowoomba regional/i.test(venue)) return "Toowoomba";
  return "";
}

function priceFromText(text) {
  if (/\b(free entry|entry is free|admission is free|free event|no cost|free to attend)\b/i.test(text)) {
    return "Free";
  }
  return "See listing";
}

function cleanLine(value) {
  return decodeHtml(String(value || "")).replace(/\s+/g, " ").replace(/^[:\s-]+|[:\s-]+$/g, "").trim();
}

export function parseMeetupEvents(html, pageUrl) {
  const found = meetupEventsFrom(html);
  if (!found) throw new Error("Meetup page had no event data");
  const events = [];
  for (const item of found) {
    const normalised = normaliseMeetup(item, pageUrl);
    if (normalised) events.push(normalised);
  }
  return { parsed: found.length, events };
}

export function parseEmpireEvents(html, pageUrl) {
  const schemaNodes = readJsonLd(html).filter((node) => isSchemaEvent(node["@type"]));
  if (schemaNodes.length) {
    const events = schemaNodes.map((node) => schemaListing(node, pageUrl, "empire")).filter(Boolean);
    return { parsed: schemaNodes.length, events };
  }
  const events = empireCards(html, pageUrl);
  if (!events.length && !/<time\b[^>]*datetime=/i.test(String(html || ""))) {
    throw new Error("Empire page had no event data");
  }
  return { parsed: events.length, events };
}

export function parseMoshtixEvents(html, pageUrl) {
  const blocks = String(html || "").split(/<div class="searchresult\b/i).slice(1);
  if (!blocks.length && !/searchresult|Your search returned/i.test(String(html || ""))) {
    throw new Error("Moshtix page had no event data");
  }
  const events = [];
  for (const block of blocks) {
    const normalised = moshtixBlock(block, pageUrl);
    if (normalised) events.push(normalised);
  }
  return { parsed: blocks.length, events };
}

export function parseUnisqEvents(html, pageUrl) {
  const blocks = [...String(html || "").matchAll(/<a\b[^>]*class="[^"]*c-event-preview[^"]*"[^>]*>[\s\S]*?<\/a>/gi)];
  const seen = blocks
    .map((match) => unisqCard(match[0], pageUrl))
    .filter((item) => item.candidate);
  const events = seen.map((item) => item.event).filter(Boolean);
  return { parsed: seen.length, events };
}

export function parseUnisqFeed(payload, pageUrl) {
  const rows = Array.isArray(payload?.Events) ? payload.Events : [];
  const events = [];
  for (const row of rows) {
    const event = unisqListing({
      title: row?.Title || row?.ShortHeading,
      location: row?.Location,
      whenText: row?.FormattedDateRange,
      timeText: row?.HideHourDetails ? "" : row?.Time,
      href: row?.Url,
      summary: row?.Intro,
      pageUrl,
      hideHours: Boolean(row?.HideHourDetails),
    });
    if (event) events.push(event);
  }
  return { parsed: rows.length, events };
}

function meetupEventsFrom(html) {
  const match = String(html || "").match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }
  let found = null;
  const walk = (node) => {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node.eventsInLocation)) {
      found = node.eventsInLocation;
      return;
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(data);
  return found;
}

function normaliseMeetup(event, pageUrl) {
  if (!event || event.isOnline || String(event.eventType || "").toUpperCase() === "ONLINE") return null;
  if (/cancel/i.test(String(event.status || ""))) return null;
  const venue = event.venue && typeof event.venue === "object" ? event.venue : null;
  const city = String(venue?.city || "").trim();
  const street = String(venue?.address || "").trim();
  const name = String(venue?.name || "").trim();
  if (!inToowoombaRegion([city, street, name, venue?.state])) return null;
  const when = schemaInstant(event.dateTime);
  if (!when || when.allDay) return null;
  const end = event.endTime ? schemaInstant(event.endTime) : null;
  const address = [street, city, venue?.state, venue?.country].filter(Boolean).join(", ");
  const fee = event.feeSettings;
  const amount = fee && (fee.amount ?? fee.fee);
  const price = amount == null || amount === "" ? "See listing" : priceLabel(Number(amount), Number(amount));
  return finishListing({
    kind: "event",
    title: cleanLine(event.title),
    start: when.iso,
    end: end && !end.allDay ? end.iso : null,
    allDay: false,
    venue: name || city || "Toowoomba",
    suburb: city,
    address: address || name,
    price,
    summary: cleanLine(event.group?.name || "").slice(0, 280),
    source: "meetup",
    sourceUrl: absoluteUrl(event.eventUrl, pageUrl),
  });
}

function empireCards(html, pageUrl) {
  const events = [];
  const source = String(html || "");
  const re = /<time\b[^>]*datetime="([^"]+)"[^>]*>[\s\S]{0,4000}?<h3\b[^>]*>[\s\S]*?<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match = re.exec(source);
  while (match) {
    const when = schemaInstant(match[1]);
    const title = htmlToText(match[3]);
    if (when && title) {
      const window = source.slice(match.index, match.index + 4500);
      const summary = htmlToText((window.match(/<p class="[^"]*font-size-xl[^"]*"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || "");
      events.push(finishListing({
        kind: "event",
        title,
        start: when.iso,
        end: null,
        allDay: when.allDay,
        venue: "The Empire",
        suburb: "Toowoomba",
        address: "The Empire, Toowoomba",
        price: /\bfree\b/i.test(summary) ? "Free" : "See listing",
        summary: summary.slice(0, 280),
        source: "empire",
        sourceUrl: absoluteUrl(decodeHtml(match[2]), pageUrl),
      }));
    }
    match = re.exec(source);
  }
  return events;
}

function moshtixBlock(block, pageUrl) {
  const nodes = readJsonLd(block);
  const embedded = nodes.find((node) => node?.startDate) || nodes.find((node) => node?.name && node?.location);
  const title = cleanLine(embedded?.name) || htmlToText((block.match(/class="main-event-header"[\s\S]*?<span>([\s\S]*?)<\/span>/i) || [])[1] || "");
  const header = (block.match(/class="main-artist-event-header"[\s\S]*?<\/h2>/i) || [])[0] || "";
  const headerVenue = htmlToText((header.match(/<a\b[\s\S]*?<span>([\s\S]*?)<\/span>/i) || [])[1] || "");
  const place = schemaPlace(embedded?.location);
  const venue = place.venue || headerVenue;
  const address = place.address || headerVenue;
  if (!title || !inToowoombaRegion([venue, address, place.suburb, place.region, place.postcode, headerVenue])) {
    return null;
  }
  if (/cancel/i.test(String(embedded?.eventStatus || ""))) return null;
  const when = embedded?.startDate
    ? schemaInstant(embedded.startDate)
    : whenFromText(htmlToText(header).split("|")[0]);
  if (!when) return null;
  const end = embedded?.endDate ? schemaInstant(embedded.endDate) : null;
  const href = (block.match(/href="(https?:\/\/[^"]*\/v2\/event\/[^"]+|\/v2\/event\/[^"]+)"/i) || [])[1]
    || embedded?.url;
  const blurb = htmlToText((block.match(/<p[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/i) || [])[1] || "");
  return finishListing({
    kind: "event",
    title,
    start: when.iso,
    end: end && !end.allDay ? end.iso : null,
    allDay: when.allDay,
    venue: venue || "Toowoomba",
    suburb: place.suburb || suburbFrom(address),
    address: address || venue,
    price: priceFromOffers(embedded?.offers),
    summary: blurb.slice(0, 280),
    source: "moshtix",
    sourceUrl: absoluteUrl(href, pageUrl),
    rawCategory: embedded?.typicalAgeRange || "",
  });
}

function unisqCard(block, pageUrl) {
  const title = previewField(block, "c-event-preview__heading");
  const whenText = previewField(block, "c-event-preview__date");
  const location = previewField(block, "c-event-preview__location");
  const timeText = previewField(block, "c-event-preview__time");
  if (!title && !whenText && !location) return { candidate: false, event: null };
  const href = (block.match(/href="([^"]+)"/i) || [])[1];
  return {
    candidate: true,
    event: unisqListing({ title, location, whenText, timeText, href, summary: "", pageUrl, hideHours: false }),
  };
}

function unisqListing({ title, location, whenText, timeText, href, summary, pageUrl, hideHours }) {
  const name = cleanLine(title);
  const place = cleanLine(location);
  if (!name || !/\btoowoomba\b/i.test(place)) return null;
  const dates = datesIn(whenText);
  if (!dates.length) return null;
  const slots = hideHours ? [] : parseTimes(timeText);
  const slot = slots[0] || { start: null, end: null };
  const first = dates[0];
  const last = dates[dates.length - 1];
  const ranged = dates.length > 1;
  const built = brisbaneIso(first.year, first.month, first.day, hideHours ? null : slot.start);
  let end = null;
  let allDay = built.allDay && !ranged;
  if (ranged) {
    const endClock = slot.end || (slot.start ? null : { hour: 23, minute: 59 });
    end = brisbaneIso(last.year, last.month, last.day, endClock || { hour: 23, minute: 59 }).iso;
    allDay = false;
  } else if (slot.end) {
    end = brisbaneIso(first.year, first.month, first.day, slot.end).iso;
    allDay = false;
  }
  return finishListing({
    kind: "event",
    title: name,
    start: built.iso,
    end,
    allDay,
    venue: place,
    suburb: "Toowoomba",
    address: place,
    price: /\bfree\b/i.test(`${name} ${summary}`) ? "Free" : "See listing",
    summary: cleanLine(summary).slice(0, 280),
    source: "unisq",
    sourceUrl: absoluteUrl(href, pageUrl),
  });
}

function schemaListing(node, pageUrl, source) {
  if (/cancel/i.test(String(node.eventStatus || ""))) return null;
  const when = schemaInstant(node.startDate);
  const title = cleanLine(node.name);
  if (!when || !title) return null;
  const place = schemaPlace(node.location);
  const venue = place.venue || (source === "empire" ? "The Empire" : "");
  const address = place.address || (source === "empire" ? "The Empire, Toowoomba" : venue);
  if (place.known && !inToowoombaRegion([venue, address, place.suburb, place.region, place.postcode])) return null;
  if (!place.known && source !== "empire") return null;
  const end = node.endDate ? schemaInstant(node.endDate) : null;
  const summary = htmlToText(node.description || "").slice(0, 280);
  return finishListing({
    kind: "event",
    title,
    start: when.iso,
    end: end && !end.allDay ? end.iso : null,
    allDay: when.allDay,
    venue: venue || "Toowoomba",
    suburb: place.suburb || (source === "empire" ? "Toowoomba" : suburbFrom(address)),
    address: address || venue,
    price: priceFromOffers(node.offers),
    summary,
    source,
    sourceUrl: absoluteUrl(node.url, pageUrl),
  });
}

function readJsonLd(html) {
  const values = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html || "").matchAll(re)) {
    try {
      values.push(JSON.parse(match[1].trim()));
    } catch {
      // A broken block does not hide the rest of the page.
    }
  }
  return values.flatMap(flattenLd);
}

function flattenLd(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(flattenLd);
  if (value["@graph"]) return flattenLd(value["@graph"]);
  return [value];
}

function isSchemaEvent(type) {
  const types = Array.isArray(type) ? type : [type];
  return types.filter(Boolean).some((item) => /Event$/.test(String(item).split("/").pop()));
}

function schemaPlace(location) {
  if (!location) return { known: false, venue: "", address: "", suburb: "", region: "", postcode: "" };
  if (typeof location === "string") {
    const text = cleanLine(location);
    return { known: Boolean(text), venue: text, address: text, suburb: suburbFrom(text), region: "", postcode: "" };
  }
  const address = location.address && typeof location.address === "object" ? location.address : {};
  const street = cleanLine(typeof location.address === "string" ? location.address : address.streetAddress);
  const suburb = cleanLine(address.addressLocality);
  const region = cleanLine(address.addressRegion);
  const postcode = cleanLine(address.postalCode);
  const venue = cleanLine(location.name) || street || suburb;
  const line = [street, suburb, region, postcode].filter(Boolean).join(", ");
  return {
    known: Boolean(venue || line),
    venue,
    address: line || venue,
    suburb,
    region,
    postcode,
  };
}

function schemaInstant(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { iso: `${text}T00:00:00+10:00`, allDay: true };
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/);
  if (!match) return null;
  const [, date, hour, minute, second = "00", zone] = match;
  if (hour === "00" && minute === "00") return { iso: `${date}T00:00:00+10:00`, allDay: true };
  const offset = zone === "Z" ? "+00:00" : zone || "+10:00";
  return { iso: `${date}T${hour}:${minute}:${second}${offset}`, allDay: false };
}

function whenFromText(text) {
  const dates = datesIn(text);
  if (!dates.length) return null;
  const slots = parseTimes(text);
  const slot = slots[0];
  return brisbaneIso(dates[0].year, dates[0].month, dates[0].day, slot?.start || null);
}

function datesIn(text) {
  const source = String(text || "");
  const yearMatch = source.match(/\b(20\d{2})\b/);
  const fallbackYear = yearMatch ? Number(yearMatch[1]) : null;
  const dates = [];
  for (const match of source.matchAll(dateRegex())) {
    const day = Number(match[1] || match[4]);
    const month = monthNumber(match[2] || match[3]);
    const year = match[5] ? Number(match[5]) : fallbackYear;
    if (day && month && year) dates.push({ day, month, year });
  }
  return dates;
}

function priceFromOffers(offers) {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  const amounts = list
    .map((offer) => Number(String(offer?.price ?? "").replace(/[^0-9.]/g, "")))
    .filter((amount) => Number.isFinite(amount));
  if (!amounts.length) return "See listing";
  return priceLabel(Math.min(...amounts), Math.max(...amounts));
}

function previewField(block, className) {
  const match = String(block || "").match(new RegExp(`class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<`, "i"));
  return htmlToText(match ? match[1] : "");
}

function absoluteUrl(href, pageUrl) {
  const value = decodeHtml(String(href || "").trim());
  if (!value) return pageUrl;
  try {
    return new URL(value, pageUrl).href;
  } catch {
    return pageUrl;
  }
}
