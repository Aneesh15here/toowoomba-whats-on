/**
 * Write the crawlable pages, feeds, and sitemap from data/events.json.
 * Called at the end of scripts/collect.mjs so the twice-daily Action refreshes them.
 */

import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "./seo.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANAGED_DIRS = ["events", "category", "suburb", "things-to-do", "this-weekend", "this-week", "garage-sales", "search"];

export async function generateSite({ root = ROOT, now = new Date() } = {}) {
  const eventsPayload = JSON.parse(await readFile(path.join(root, "data", "events.json"), "utf8"));
  const submissions = await readJson(path.join(root, "data", "submissions.json"), { items: [] });
  const placesPayload = await readJson(path.join(root, "data", "things-to-do.json"), { places: [] });
  const indexHtml = await readFile(path.join(root, "index.html"), "utf8");
  const thingsHtml = await readFile(path.join(root, "things-to-do.html"), "utf8");
  const built = buildSite({
    events: eventsPayload.events || [],
    submissions,
    places: placesPayload.places || [],
    now,
    generatedAt: eventsPayload.generatedAt || now.toISOString(),
    indexHtml,
    thingsHtml,
  });
  const written = [];
  for (const [rel, content] of built.files) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
    written.push(rel);
  }
  await writeFile(path.join(root, "index.html"), built.indexHtml);
  await writeFile(path.join(root, "things-to-do.html"), built.thingsHtml);
  const removed = await pruneManaged(root, new Set(written));
  return {
    written: written.length + 2,
    removed,
    events: built.calendar.length,
    occurrences: built.occurrences.length,
    places: built.places.length,
  };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function pruneManaged(root, keep) {
  let removed = 0;
  for (const dir of MANAGED_DIRS) {
    removed += await pruneDir(path.join(root, dir), dir, keep);
  }
  return removed;
}

async function pruneDir(abs, rel, keep) {
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of entries) {
    const childRel = `${rel}/${entry.name}`;
    const childAbs = path.join(abs, entry.name);
    if (entry.isDirectory()) {
      removed += await pruneDir(childAbs, childRel, keep);
      const left = await readdir(childAbs);
      if (left.length === 0) {
        await rm(childAbs, { recursive: true });
        removed += 1;
      }
    } else if (!keep.has(childRel)) {
      await rm(childAbs);
      removed += 1;
    }
  }
  return removed;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  generateSite()
    .then((result) => {
      console.log(`pages: wrote ${result.written} files, removed ${result.removed}, events ${result.events}, places ${result.places}, parkrun rows ${result.occurrences}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
