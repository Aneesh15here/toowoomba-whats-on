/**
 * Pull a week of GoatCounter stats into data/stats/weekly.json.
 * Exits 0 without writing when GOATCOUNTER_TOKEN is missing.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GOATCOUNTER_CODE, buildWeeklyReport, statsSignature, weekWindow } from "./analytics.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "stats", "weekly.json");

function markSkip(skip) {
  if (!process.env.GITHUB_ENV) return;
  appendFileSync(process.env.GITHUB_ENV, `skip=${skip ? "true" : "false"}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getJson(url, token) {
  let status = 0;
  let body = "";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    status = response.status;
    body = await response.text();
    console.log(`Attempt ${attempt}: HTTP status ${status} ${url}`);
    if (status < 400) return JSON.parse(body);
    if (attempt < 5) await sleep(attempt * 10000);
  }
  throw new Error(`GoatCounter request failed with HTTP ${status}`);
}

function apiUrl(code, pathname, params) {
  const url = new URL(`https://${code}.goatcounter.com/api/v0/${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function fetchHits(code, token, start, end) {
  const hits = [];
  const excluded = [];
  for (let page = 0; page < 5; page += 1) {
    const payload = await getJson(apiUrl(code, "stats/hits", {
      start,
      end,
      limit: 100,
      exclude_paths: excluded.join(","),
    }), token);
    const batch = Array.isArray(payload.hits) ? payload.hits : [];
    hits.push(...batch);
    for (const hit of batch) {
      if (hit.path_id != null) excluded.push(hit.path_id);
    }
    if (!payload.more || batch.length === 0) break;
    await sleep(300);
  }
  return hits;
}

async function fetchReferrers(code, token, start, end) {
  const refs = [];
  for (let page = 0; page < 5; page += 1) {
    const payload = await getJson(apiUrl(code, "stats/toprefs", {
      start,
      end,
      limit: 100,
      offset: page * 100,
    }), token);
    const batch = Array.isArray(payload.stats) ? payload.stats : [];
    refs.push(...batch);
    if (!payload.more || batch.length === 0) break;
    await sleep(300);
  }
  return refs;
}

function readPrevious() {
  try {
    return JSON.parse(readFileSync(OUT, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function updateWeeklyStats({ token = process.env.GOATCOUNTER_TOKEN || "", now = new Date(), code = GOATCOUNTER_CODE } = {}) {
  if (!String(token).trim()) {
    console.log("GOATCOUNTER_TOKEN secret not set — skipping (add it in repo Settings → Secrets).");
    markSkip(true);
    return { skipped: true };
  }
  const range = weekWindow(now);
  const currentTotal = await getJson(apiUrl(code, "stats/total", { start: range.start, end: range.end }), token);
  await sleep(300);
  const previousTotal = await getJson(apiUrl(code, "stats/total", { start: range.previousStart, end: range.previousEnd }), token);
  await sleep(300);
  const hits = await fetchHits(code, token, range.start, range.end);
  await sleep(300);
  const referrers = await fetchReferrers(code, token, range.start, range.end);
  const report = buildWeeklyReport({
    site: code,
    updated: now.toISOString(),
    status: "ok",
    range,
    currentTotal,
    previousTotal,
    hits,
    referrers,
  });
  const previous = readPrevious();
  if (previous && statsSignature(previous) === statsSignature(report)) {
    console.log("No material stats change — skipping commit.");
    markSkip(true);
    return { skipped: true, report };
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  markSkip(false);
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
  return { skipped: false, report };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  updateWeeklyStats().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
