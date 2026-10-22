import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("things to do lists real places with an official link and a known type", async () => {
  const data = JSON.parse(await readFile(new URL("../data/things-to-do.json", import.meta.url), "utf8"));
  const typeIds = new Set(data.types.map((type) => type.id));
  assert.ok(typeIds.has("outdoor"));
  assert.ok(typeIds.has("drives"));
  assert.ok(typeIds.has("walks"));
  assert.ok(typeIds.has("parkruns"));
  assert.ok(typeIds.has("parks"));
  assert.ok(typeIds.has("lookouts"));
  assert.ok(typeIds.has("family"));
  assert.ok(data.places.length >= 10);
  const primaries = new Set();
  for (const place of data.places) {
    assert.equal(typeof place.name, "string");
    assert.ok(place.name.length > 2);
    assert.equal(typeof place.area, "string");
    assert.equal(typeof place.summary, "string");
    assert.match(place.url, /^https:\/\//);
    assert.ok(typeIds.has(place.type));
    assert.ok(place.types.includes(place.type));
    for (const type of place.types) assert.ok(typeIds.has(type));
    assert.equal(typeof place.source, "string");
    primaries.add(place.type);
  }
  for (const id of typeIds) assert.ok(primaries.has(id), `${id} has a place`);
});
