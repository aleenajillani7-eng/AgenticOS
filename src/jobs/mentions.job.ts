// src/jobs/mentions.job.ts
import { schedule, ScheduledTask } from "node-cron";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { TOKENS_FILE_PATH } from "../utils/encryption";
import { getSelfUserId, fetchMentions, postReply } from "../services/twitter.service";
import { craftTLDRabbitReply } from "../services/persona.service";

type State = {
  sinceId?: string;
  nextAllowedAt?: number; // epoch ms backoff window
  me?: string;            // cached self id
  lastRunAt?: number;     // last manual run ts
};

const STATE_PATH = join(dirname(TOKENS_FILE_PATH), "mentions-state.json");

// Be very gentle at first
const MAX_REPLIES_PER_CYCLE = 1;

// Poll every 5 minutes (reduce background pressure; you can tighten later)
const CRON_EXPR = "*/5 * * * *";

// Manual “Run Now” cooldown to avoid button-spam
const MANUAL_COOLDOWN_MS = 60_000;

// If headers don't provide reset, fallback duration:
const RATE_LIMIT_FALLBACK_MS = 120_000;

let job: ScheduledTask | null = null;

function loadState(): State {
  try {
    if (!existsSync(STATE_PATH)) return {};
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
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
  const headers = err?.response?.headers || {};
  const ra = headers["retry-after"];
  if (ra) return Date.now() + Number(ra) * 1000 + 1500; // small cushion
  const reset = headers["x-rate-limit-reset"];
  if (reset) {
    const wait = Number(reset) * 1000 - Date.now() + 1500;
    if (wait > 0) return Date.now() + wait;
  }
  return Date.now() + RATE_LIMIT_FALLBACK_MS;
}

export async function runMentionsOnce(opts?: { manual?: boolean }): Promise<{
  handled: number;
  lastId?: string;
  skipped?: string;
  nextAllowedAt?: number;
}> {
  const manual = !!opts?.manual;
  const state = loadState();

  // honor persisted backoff
  if (state.nextAllowedAt && Date.now() < state.nextAllowedAt) {
    return {
      handled: 0,
      lastId: state.sinceId,
      skipped: `backoff_active_${state.nextAllowedAt - Date.now()}ms`,
      nextAllowedAt: state.nextAllowedAt,
    };
  }

  // manual cooldown
  if (manual && state.lastRunAt && Date.now() - state.lastRunAt < MANUAL_COOLDOWN_MS) {
    return {
      handled: 0,
      lastId: state.sinceId,
      skipped: `manual_cooldown_${MANUAL_COOLDOWN_MS - (Date.now() - state.lastRunAt)}ms`,
    };
  }

  try {
    // cache self id in state (backup to service cache)
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

    let handled = 0;
    let lastSuccessfulId = state.sinceId;

    for (const m of batch) {
      if (m.author_id === me) {
        lastSuccessfulId = m.id; // advance past self tweets
        continue;
      }

      const reply = craftTLDRabbitReply(m.text);

      try {
        await postReply(reply, m.id);
        handled++;
        lastSuccessfulId = m.id; // advance checkpoint only on success
      } catch (err: any) {
        // Persist backoff & retry same tweet later (do NOT advance sinceId)
        if (err?.response?.status === 429) {
          const next = nextAllowedFromError(err);
          state.nextAllowedAt = next;
          state.lastRunAt = Date.now();
          saveState(state);
          return { handled, lastId: lastSuccessfulId, skipped: "rate_limited", nextAllowedAt: next };
        }
        console.error("[mentions] Failed to reply:", err?.message || err);
        // non-429: do not advance sinceId; retry next cycle
      }
    }

    // after batch succeeds, advance to last successful id
    state.sinceId = lastSuccessfulId;
    state.lastRunAt = Date.now();
    saveState(state);

    return { handled, lastId: lastSuccessfulId };
  } catch (e: any) {
    // If the GET mentions call hit 429 after retries, persist backoff
    if (e?.response?.status === 429) {
      const next = nextAllowedFromError(e);
      const s2 = loadState();
      s2.nextAllowedAt = next;
      s2.lastRunAt = Date.now();
      saveState(s2);
      return { handled: 0, lastId: s2.sinceId, skipped: "rate_limited", nextAllowedAt: next };
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
