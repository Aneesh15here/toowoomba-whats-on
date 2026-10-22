/**
 * GoatCounter site code for whatsontoowoomba.au.
 * Change GOATCOUNTER_CODE here and rebuild pages. The count.js snippet,
 * the weekly stats job, and event names all read this module.
 */

export const GOATCOUNTER_CODE = "whatsontoowoomba";
export const GOATCOUNTER_SCRIPT = "https://gc.zgo.at/count.js";
export const SHARE_EVENT = "share-submit";
export const REPORT_EVENT = "report";
export const WEEKLY_TOP = 20;

const SEARCH_ENGINES = new Set([
  "google",
  "bing",
  "duckduckgo",
  "yahoo",
  "yandex",
  "baidu",
  "ecosia",
  "startpage",
  "qwant",
  "brave",
  "brave search",
  "kagi",
  "mojeek",
  "ask",
  "aol",
  "naver",
  "sogou",
  "seznam",
  "dogpile",
  "swisscows",
  "searx",
  "presearch",
  "you.com",
  "perplexity",
]);

const DIRECT_NAMES = new Set(["", "(none)", "(direct)", "direct", "(no data)", "(no referrer)"]);

export function countEndpoint(code = GOATCOUNTER_CODE) {
  return `https://${code}.goatcounter.com/count`;
}

export function countSnippet(code = GOATCOUNTER_CODE) {
  return `<script data-goatcounter="${countEndpoint(code)}" async src="${GOATCOUNTER_SCRIPT}"></script>`;
}

export function privacyNoteHtml() {
  return `<p class="privacy-note">Visitor counts use <a href="https://www.goatcounter.com/">GoatCounter</a>. No cookies and no personal data.</p>`;
}

export function analyticsScriptTag(html) {
  const theme = String(html).match(/<script type="module" src="([^"]*)js\/theme\.js"><\/script>/);
  const src = theme ? `${theme[1]}js/analytics.js` : "/js/analytics.js";
  return `<script type="module" src="${src}"></script>`;
}

export function outboundEventPath(href) {
  let url;
  try {
    url = new URL(String(href), "https://whatsontoowoomba.au");
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "whatsontoowoomba.au" || host.endsWith(".whatsontoowoomba.au")) return "";
  return `outbound-${host.replace(/^www\./, "")}`.slice(0, 120);
}

export function filterEventPath(type) {
  const id = String(type || "").toLowerCase().replace(/[^a-z0-9-]+/g, "").slice(0, 40);
  return `things-filter-${id || "all"}`;
}

function insertBeforeBodyEnd(html, line) {
  if (html.includes("</body>")) return html.replace("</body>", `  ${line}\n</body>`);
  return `${html}\n${line}\n`;
}

function insertPrivacy(html) {
  if (html.includes('class="privacy-note"') || !html.includes("</footer>")) return html;
  const note = privacyNoteHtml();
  if (/([ \t]*)<\/div>\r?\n([ \t]*)<\/footer>/.test(html)) {
    return html.replace(
      /([ \t]*)<\/div>\r?\n([ \t]*)<\/footer>/,
      `$1  ${note}\n$1</div>\n$2</footer>`,
    );
  }
  return html.replace("</footer>", `${note}\n</footer>`);
}

export function stampHtml(html) {
  let next = String(html);
  const tag = analyticsScriptTag(next);
  if (!next.includes("analytics.js")) next = insertBeforeBodyEnd(next, tag);
  else next = next.replace(/<script type="module" src="[^"]*analytics\.js"><\/script>/, tag);
  if (!next.includes("data-goatcounter=")) next = insertBeforeBodyEnd(next, countSnippet());
  return insertPrivacy(next);
}

export function weekWindow(now) {
  const end = new Date(now);
  end.setUTCMinutes(0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  const previousEnd = new Date(start);
  const previousStart = new Date(start);
  previousStart.setUTCDate(previousStart.getUTCDate() - 7);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    previousStart: previousStart.toISOString(),
    previousEnd: previousEnd.toISOString(),
  };
}

function isSearchHost(name) {
  return /(^|\.)google\./.test(name)
    || name.includes("bing.com")
    || name.includes("duckduckgo.")
    || name.includes("search.yahoo.")
    || name.includes("yandex.")
    || name.includes("baidu.")
    || name.includes("ecosia.org")
    || name.includes("startpage.com")
    || name.includes("search.brave.com");
}

export function referrerKind(ref) {
  const name = String(ref?.name ?? ref?.ref ?? "").trim().toLowerCase();
  if (DIRECT_NAMES.has(name)) return "direct";
  if (SEARCH_ENGINES.has(name) || isSearchHost(name)) return "search";
  return "other";
}

function addTraffic(traffic, kind, count) {
  switch (kind) {
    case "search":
      traffic.search += count;
      return;
    case "direct":
      traffic.direct += count;
      return;
    case "other":
      traffic.other += count;
      return;
    default: {
      /** @type {never} */
      const unexpected = kind;
      throw new Error(`Unexpected referrer kind: ${unexpected}`);
    }
  }
}

function isEventHit(hit) {
  return hit?.event === true || hit?.event === 1 || hit?.event === "true";
}

function visitTotals(payload) {
  const visits = Number(payload?.total) || 0;
  const events = Number(payload?.total_events) || 0;
  return {
    visits,
    events,
    pages: Math.max(0, visits - events),
  };
}

function topRows(rows, limit) {
  return [...rows].sort((a, b) => b.count - a.count || String(a.path || a.name).localeCompare(String(b.path || b.name))).slice(0, limit);
}

export function buildWeeklyReport({
  site = GOATCOUNTER_CODE,
  updated = null,
  status = "ok",
  range,
  currentTotal,
  previousTotal,
  hits = [],
  referrers = [],
}) {
  const week = visitTotals(currentTotal);
  const previousWeek = visitTotals(previousTotal);
  const pages = topRows(
    hits.filter((hit) => hit && !isEventHit(hit)).map((hit) => ({
      path: String(hit.path || ""),
      title: String(hit.title || ""),
      count: Number(hit.count) || 0,
    })),
    WEEKLY_TOP,
  );
  const events = topRows(
    hits.filter((hit) => isEventHit(hit)).map((hit) => ({
      path: String(hit.path || ""),
      title: String(hit.title || ""),
      count: Number(hit.count) || 0,
    })),
    WEEKLY_TOP,
  );
  const traffic = { search: 0, direct: 0, other: 0 };
  const listedReferrers = referrers.map((ref) => ({
    name: String(ref?.name ?? ref?.ref ?? "").trim() || "(direct)",
    count: Number(ref?.count) || 0,
    scheme: String(ref?.ref_scheme || ref?.scheme || ""),
    kind: referrerKind(ref),
  }));
  for (const ref of listedReferrers) addTraffic(traffic, ref.kind, ref.count);
  const topReferrers = topRows(listedReferrers, WEEKLY_TOP).map((ref) => ({
    name: ref.name,
    count: ref.count,
    scheme: ref.scheme,
    kind: ref.kind,
  }));
  return {
    updated,
    site,
    status,
    period: {
      start: range?.start || null,
      end: range?.end || null,
      previousStart: range?.previousStart || null,
      previousEnd: range?.previousEnd || null,
    },
    totals: {
      week,
      previousWeek,
      change: {
        visits: week.visits - previousWeek.visits,
        events: week.events - previousWeek.events,
        pages: week.pages - previousWeek.pages,
      },
    },
    pages,
    referrers: topReferrers,
    traffic,
    events,
  };
}

export function emptyWeeklyReport() {
  return buildWeeklyReport({
    updated: null,
    status: "awaiting-token",
    range: { start: null, end: null, previousStart: null, previousEnd: null },
    currentTotal: { total: 0, total_events: 0 },
    previousTotal: { total: 0, total_events: 0 },
    hits: [],
    referrers: [],
  });
}

export function statsSignature(report) {
  const pages = (report.pages || []).map((row) => ({
    path: row.path,
    title: row.title || "",
    count: Number(row.count) || 0,
  }));
  const referrers = (report.referrers || []).map((row) => ({
    name: row.name,
    count: Number(row.count) || 0,
    scheme: row.scheme || "",
    kind: row.kind || "",
  }));
  const events = (report.events || []).map((row) => ({
    path: row.path,
    title: row.title || "",
    count: Number(row.count) || 0,
  }));
  const week = report.totals?.week || {};
  const previousWeek = report.totals?.previousWeek || {};
  const change = report.totals?.change || {};
  return JSON.stringify({
    site: report.site,
    status: report.status,
    period: report.period,
    totals: {
      week: { visits: Number(week.visits) || 0, events: Number(week.events) || 0, pages: Number(week.pages) || 0 },
      previousWeek: {
        visits: Number(previousWeek.visits) || 0,
        events: Number(previousWeek.events) || 0,
        pages: Number(previousWeek.pages) || 0,
      },
      change: {
        visits: Number(change.visits) || 0,
        events: Number(change.events) || 0,
        pages: Number(change.pages) || 0,
      },
    },
    pages,
    referrers,
    traffic: {
      search: Number(report.traffic?.search) || 0,
      direct: Number(report.traffic?.direct) || 0,
      other: Number(report.traffic?.other) || 0,
    },
    events,
  });
}

export function trackEvent(path, title) {
  if (typeof window === "undefined") return;
  const name = String(path || "");
  if (!name || name.startsWith("/")) return;
  const payload = { path: name, title: title || name, event: true };
  const send = () => {
    if (typeof window.goatcounter?.count !== "function") return false;
    window.goatcounter.count(payload);
    return true;
  };
  if (send()) return;
  const retry = () => {
    if (send()) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (send() || Date.now() - started > 4000) window.clearInterval(timer);
    }, 200);
  };
  if (document.readyState === "complete") retry();
  else window.addEventListener("load", retry, { once: true });
}

function eventElement(target) {
  if (target instanceof Element) return target;
  return target?.parentElement || null;
}

function trackReport(form) {
  if (form?.dataset?.reportTracked === "1") return;
  if (form?.dataset) form.dataset.reportTracked = "1";
  trackEvent(REPORT_EVENT, "Report listing");
  if (typeof window !== "undefined") {
    window.setTimeout(() => {
      if (form?.dataset?.reportTracked === "1") delete form.dataset.reportTracked;
    }, 1000);
  }
}

export function installTracking() {
  if (typeof document === "undefined") return;
  const onClick = (event) => {
    const element = eventElement(event.target);
    if (!element) return;
    const link = element.closest("a[data-track]");
    if (link?.dataset.track) {
      trackEvent(link.dataset.track, link.dataset.trackTitle || "Outbound event link");
      return;
    }
    const reportButton = element.closest(".report button, .report-form button");
    if (reportButton) {
      trackReport(reportButton.closest("form"));
      return;
    }
    const filter = element.closest("#thing-filters [data-type]");
    if (!filter) return;
    const type = filter.dataset.type || "";
    trackEvent(filterEventPath(type), type ? `Things to do filter ${type}` : "Things to do filter all");
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", (event) => {
    const element = eventElement(event.target);
    const link = element?.closest("a[data-track]");
    if (link?.dataset.track) trackEvent(link.dataset.track, link.dataset.trackTitle || "Outbound event link");
  }, true);
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === "share-form") trackEvent(SHARE_EVENT, "Share form");
    else if (form.classList.contains("report-form")) trackReport(form);
  }, true);
}
