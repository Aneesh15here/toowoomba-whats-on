/**
 * Pull FormSubmit mail from the admin inbox and write data/submissions.json.
 * Valid listings are published. One public report hides a listing and
 * sends a confirmation back to the same inbox.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AgentMailClient } from "agentmail";
import {
  ADMIN_INBOX,
  DEFAULT_FROM_SUFFIX,
  hiddenNoticeText,
  ingestMailbox,
  MAX_PER_RUN,
  serialiseState,
  SUBJECT_MARK,
} from "./submissions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUBMISSIONS_PATH = path.join(ROOT, "data", "submissions.json");
const EVENTS_PATH = path.join(ROOT, "data", "events.json");
const LIST_PAGES = 3;

export async function runPublish({
  client,
  inbox = ADMIN_INBOX,
  state,
  events = [],
  now = new Date(),
  fromSuffix = DEFAULT_FROM_SUFFIX,
  maxMessages = MAX_PER_RUN,
}) {
  const listed = await listCandidates(client, inbox);
  const known = new Set(state.handledMessageIds || []);
  const pending = listed
    .filter((item) => item?.messageId && !known.has(item.messageId))
    .reverse()
    .slice(0, maxMessages);
  const messages = [];
  for (const item of pending) {
    const full = await client.inboxes.messages.get(inbox, item.messageId);
    messages.push({
      id: full.messageId,
      from: full.from || item.from || "",
      subject: full.subject || item.subject || "",
      text: full.extractedText || full.text || "",
      html: full.extractedHtml || full.html || "",
    });
  }
  const result = ingestMailbox({
    items: state.items || [],
    handledMessageIds: state.handledMessageIds || [],
    events,
    messages,
    now,
    fromSuffix,
  });
  for (const hidden of result.newlyHidden) {
    try {
      await client.inboxes.messages.send(inbox, {
        to: [inbox],
        subject: `What's On Toowoomba HIDDEN: ${hidden.id}`,
        text: hiddenNoticeText(hidden),
      });
      hidden.notified = true;
    } catch (error) {
      hidden.notified = false;
      hidden.notifyError = error instanceof Error ? error.message : String(error);
    }
  }
  return result;
}

async function listCandidates(client, inbox) {
  const messages = [];
  let pageToken;
  for (let page = 0; page < LIST_PAGES && messages.length < 100; page += 1) {
    const response = await client.inboxes.messages.list(inbox, {
      limit: 50,
      pageToken,
      subject: [SUBJECT_MARK],
    });
    const batch = response.messages || [];
    messages.push(...batch);
    pageToken = response.nextPageToken;
    if (!pageToken || batch.length === 0) break;
  }
  return messages;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function main() {
  if (!process.env.AGENTMAIL_API_KEY) {
    console.log("AGENTMAIL_API_KEY is not set. Submissions stay in the inbox until the secret is added.");
    return;
  }
  const client = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY });
  const submissions = await readJson(SUBMISSIONS_PATH, { items: [], handledMessageIds: [] });
  const eventsPayload = await readJson(EVENTS_PATH, { events: [] });
  const state = {
    items: Array.isArray(submissions.items) ? submissions.items : [],
    handledMessageIds: Array.isArray(submissions.handledMessageIds) ? submissions.handledMessageIds : [],
  };
  const events = Array.isArray(eventsPayload.events) ? eventsPayload.events : [];
  const result = await runPublish({
    client,
    inbox: process.env.ADMIN_INBOX || ADMIN_INBOX,
    state,
    events,
    fromSuffix: process.env.SUBMISSION_FROM_SUFFIX || DEFAULT_FROM_SUFFIX,
  });
  const next = serialiseState(result);
  let previous = "";
  try {
    previous = await readFile(SUBMISSIONS_PATH, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (previous === next) {
    console.log(`submissions.json unchanged with ${result.items.length} row(s)`);
  } else {
    await writeFile(SUBMISSIONS_PATH, next);
    console.log(`submissions.json updated with ${result.items.length} row(s)`);
  }
  if (result.expiredCount) console.log(`expired ${result.expiredCount} past listing(s)`);
  for (const entry of result.results) {
    const reason = entry.reason ? ` (${entry.reason})` : "";
    console.log(`${entry.messageId}: ${entry.action}${reason}`);
  }
  for (const hidden of result.newlyHidden) {
    console.log(hidden.notified
      ? `notified ${ADMIN_INBOX} that ${hidden.id} is hidden`
      : `hide notice for ${hidden.id} failed: ${hidden.notifyError}`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
