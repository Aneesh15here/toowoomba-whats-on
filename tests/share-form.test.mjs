import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requirementsFor } from "../js/share.js";

const html = readFileSync(new URL("../share.html", import.meta.url), "utf8");

function openingTag(name) {
  const match = html.match(new RegExp(`<(input|select|textarea)\\b[^>]*\\bname="${name}"[^>]*>`));
  assert.ok(match, `missing control ${name}`);
  return match[0];
}

test("share form keeps the FormSubmit action, captcha, and honeypot", () => {
  assert.match(html, /action="https:\/\/formsubmit\.co\/whatsontoowoomba@agentmail\.to"/);
  assert.match(html, /name="_captcha" value="true"/);
  assert.match(html, /name="_honey"/);
  assert.match(html, /name="_template" value="table"/);
});

test("always-required fields are required in the HTML", () => {
  for (const name of ["email", "type", "title", "date", "suburb_or_address", "message"]) {
    assert.match(openingTag(name), /\brequired\b/, name);
  }
  assert.match(html, /Suburb or address \(required\)/);
  assert.match(html, /id="required-legend"[^>]*>[\s\S]*required/);
});

test("type-specific fields are not required until JavaScript runs", () => {
  assert.doesNotMatch(openingTag("start_time"), /\brequired\b/);
  assert.doesNotMatch(openingTag("items"), /\brequired\b/);
  assert.match(html, /class="garage-only"/);
});

test("garage sales require a start time and items", () => {
  assert.deepEqual(requirementsFor("garage-sale"), { startTime: true, items: true });
});

test("events require a start time", () => {
  assert.deepEqual(requirementsFor("event"), { startTime: true, items: false });
});

test("notices keep only the baseline required fields", () => {
  assert.deepEqual(requirementsFor("notice"), { startTime: false, items: false });
  assert.deepEqual(requirementsFor("other"), { startTime: false, items: false });
});
