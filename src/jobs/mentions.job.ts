// src/jobs/mentions.job.ts
import { schedule, ScheduledTask } from "node-cron";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { TOKENS_FILE_PATH } from "../utils/encryption";
import { getSelfUserId, fetchMentions, postReply } from "../services/twitter.service";
import { craftTLDRabbitReply } from "../services/persona.service";

type State = {
  sinceId?: string;
  nextAllowedAt?: number; // epoch ms: do nothing until now (rate-limit backoff)
  me?: string;            // cached self user id (backup to service cache)
  lastRunAt?: number;     // last manual run ts
};

const STATE_PATH = join(dirname(TOKENS_FILE_PATH), "mentions-state.json");

// Be gentle; you can raise this to 2–3 if you’re not hitting 429s
const MAX_REPLIES_PER_CYCLE = 2;

// Poll every 3 minutes (cron job). Manual runs can happen anytime (with cooldown).
const CRON_EXPR = "*/3 * * * *";

// Manual “Run Now” cooldown (avoid user clicking repeatedly)
const MANUAL_COOLDOWN_MS = 60_000;

// Fallback backoff if Twitter doesn't send Retry-After
const RATE_LIMIT_FALLBACK_MS = 120_000;

let job: ScheduledTask | null = null;

function loadState(): State {
  try {
    if (!existsSync(STATE_PATH)) return {};
    const txt = readFileSync(STATE_PATH, "utf8");
    return JSON.parse(txt) as State;
  } catch {
    return {};
  }
}
function saveState(s: State) {
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(s), "utf8");
  } catch (e) {
    console.error("[mentions] Failed saving state:", e);
  }
}

function nextAllowedFromError(err: any): number {
  const ra = err?.response?.headers?.["retry-after"];
  const ms = ra ? Number(ra) * 1000 : RATE_LIMIT_FALLBACK_MS;
  return Date.now() + ms;
}

export async function runMentionsOnce(opts?: { manual?: boolean }): Promise<{
  handled: number;
  lastId?: string;
  skipped?: string;
  nextAllowedAt?: number;
}> {
  const manual = !!opts?.manual;
  const state = loadState();

  // Respect persisted backoff
  if (state.nextAllowedAt && Date.now() < state.nextAllowedAt) {
    const waitMs = state.nextAllowedAt - Date.now();
    return { handled: 0, lastId: state.sinceId, skipped: `backoff_active_${waitMs}ms`, nextAllowedAt: state.nextAllowedAt };
    }
  // Manual cooldown
  if (manual && state.lastRunAt && Date.now() - state.lastRunAt < MANUAL_COOLDOWN_MS) {
    const waitMs = MANUAL_COOLDOWN_MS - (Date.now() - state.lastRunAt);
    return { handled: 0, lastId: state.sinceId, skipped: `manual_cooldown_${waitMs}ms` };
  }

  try {
    // Cache self id (state-level) to reduce /users/me calls if service cache evicts
    let me = state.me;
    if (!me) {
      me = await getSelfUserId();
      state.me = me;
      saveState(state);
    }

    const mentions = await fetchMentions(me!, state.sinceId);
    if (!mentions.length) {
      state.lastRunAt = Date.now();
      saveState(state);
      return { handled: 0, lastId: state.sinceId };
    }

    // oldest → newest
    mentions.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    const batch = mentions.slice(0, MAX_REPLIES_PER_CYCLE);

    let lastId = state.sinceId;
    let handled = 0;

    for (const m of batch) {
      lastId = m.id;

      // skip our own tweets
      if (m.author_id === me) continue;

      const reply = craftTLDRabbitReply(m.text);

      try {
        await postReply(reply, m.id);
        handled++;
      } catch (err: any) {
        // If 429 while replying, persist a backoff window and stop this cycle
        if (err?.response?.status === 429) {
          const next = nextAllowedFromError(err);
          state.nextAllowedAt = next;
          state.sinceId = lastId; // we advanced reading, but couldn't reply; it's OK to move on
          state.lastRunAt = Date.now();
          saveState(state);
          return { handled, lastId, skipped: "rate_limited", nextAllowedAt: next };
        }
        console.error("[mentions] Failed to reply:", err?.message || err);
      }
    }

    state.sinceId = lastId;
    state.lastRunAt = Date.now();
    saveState(state);

    return { handled, lastId };
  } catch (e: any) {
    // If fetchMentions itself hit 429 after retries, set a backoff so cron doesn't hammer
    if (e?.response?.status === 429) {
      const state2 = loadState();
      state2.nextAllowedAt = nextAllowedFromError(e);
      state2.lastRunAt = Date.now();
      saveState(state2);
      return { handled: 0, lastId: state2.sinceId, skipped: "rate_limited", nextAllowedAt: state2.nextAllowedAt };
    }
    console.error("[mentions] runMentionsOnce error:", e?.message || e);
    return { handled: 0 };
  }
}

export function startMentionsJob(): void {
  if (job) {
    console.log("[mentions] job already running");
    return;
  }
  job = schedule(CRON_EXPR, async () => {
    try {
      const res = await runMentionsOnce();
      if (res.handled) {
        console.log(`[mentions] Replied to ${res.handled} mention(s). sinceId=${res.lastId}`);
      }
    } catch (e) {
      console.error("[mentions] cron cycle error:", e);
    }
  });
  console.log(`[mentions] job scheduled: ${CRON_EXPR}`);
}

export function stopMentionsJob(): void {
  if (job) {
    job.stop();
    job = null;
    console.log("[mentions] job stopped");
  }
}
