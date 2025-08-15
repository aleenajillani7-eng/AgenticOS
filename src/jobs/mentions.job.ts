// src/jobs/mentions.job.ts
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { schedule, ScheduledTask } from "node-cron";
import {
  getAccessToken,
  getMeId,
  fetchMentions,
  postTweetReply,
  formatTwoLineReply,
} from "../services/twitter.service";

const STATE_DIR = join(import.meta.dir, "../../data");
const STATE_PATH = join(STATE_DIR, "mentions-state.json");

type MentionsState = {
  lastSeenId?: string;
  nextAllowedAt?: number; // when rate-limit lifts (ms epoch)
};

const state: MentionsState = loadState();
let cronJob: ScheduledTask | null = null;
let running = false;

function loadState(): MentionsState {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    if (!existsSync(STATE_PATH)) return {};
    const raw = readFileSync(STATE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveState() {
  try {
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("[mentions] failed to save state:", e);
  }
}

function ms(ms: number) {
  const s = Math.round(ms / 1000);
  return `${s}s`;
}

/** Generate reply text. Swap with your LLM call if desired. */
function buildReplyText(sourceText: string): string {
  // You can plug your ChainGPT call here to produce the exact 2-liner.
  return formatTwoLineReply(sourceText || "");
}

/** Runs one pass: fetch new mentions and reply to at most 1 */
export async function runMentionsOnce(): Promise<{
  handled: number;
  lastId?: string;
  skipped?: "cooldown" | "rate_limited" | "empty";
  nextAllowedAt?: number;
}> {
  if (running) return { handled: 0, skipped: "cooldown", nextAllowedAt: state.nextAllowedAt };
  running = true;

  try {
    // Respect rate-limit cooldown
    if (state.nextAllowedAt && Date.now() < state.nextAllowedAt) {
      return { handled: 0, skipped: "rate_limited", nextAllowedAt: state.nextAllowedAt };
    }

    const accessToken = await getAccessToken();
    const meId = await getMeId();

    const mentions = await fetchMentions(accessToken, meId, state.lastSeenId, 5);
    if (!mentions.length) return { handled: 0, skipped: "empty", lastId: state.lastSeenId };

    // process newest last so lastSeenId moves forward monotonically
    mentions.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);

    let handled = 0;
    let maxId = state.lastSeenId ? BigInt(state.lastSeenId) : 0n;

    for (const m of mentions) {
      if (handled >= 1) break; // cap per pass to be gentle

      try {
        const text = buildReplyText(m.text || "");
        await postTweetReply(accessToken, text, m.id);
        handled++;
        if (BigInt(m.id) > maxId) maxId = BigInt(m.id);
        console.log(`[mentions] replied to ${m.id}`);
      } catch (e: any) {
        if (e?.rateLimited) {
          state.nextAllowedAt = e.resetAt ?? Date.now() + 15 * 60 * 1000;
          saveState();
          console.warn(`[rate-limit] 429: backing off until ${new Date(state.nextAllowedAt!).toISOString()}`);
          return { handled, skipped: "rate_limited", nextAllowedAt: state.nextAllowedAt };
        }
        console.error("[mentions] reply error:", e?.message || e);
      }
    }

    if (maxId > 0n) {
      state.lastSeenId = maxId.toString();
      saveState();
    }
    return { handled, lastId: state.lastSeenId };
  } finally {
    running = false;
  }
}

/** Cron every 3 minutes (gentle); serializes calls */
export function startMentionsJob() {
  if (cronJob) cronJob.stop();
  cronJob = schedule("*/3 * * * *", async () => {
    const r = await runMentionsOnce();
    const tag = r.skipped ? `skipped:${r.skipped}` : `handled:${r.handled}`;
    console.log(`[mentions] tick -> ${tag}${r.nextAllowedAt ? ` next:${new Date(r.nextAllowedAt).toISOString()}` : ""}`);
  });
  console.log("[mentions] job scheduled: */3 * * * *");
}

export function stopMentionsJob() {
  cronJob?.stop();
  cronJob = null;
  console.log("[mentions] job stopped");
}

/** simple status for dashboard */
export function getMentionsStatus() {
  return {
    running: !!cronJob,
    nextAllowedAt: state.nextAllowedAt ?? null,
    lastSeenId: state.lastSeenId ?? null,
  };
}
