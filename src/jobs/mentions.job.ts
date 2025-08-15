// src/jobs/mentions.job.ts
import { schedule, ScheduledTask } from "node-cron";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { TOKENS_FILE_PATH } from "../utils/encryption";
import { getSelfUserId, fetchMentions, postReply } from "../services/twitter.service";
import { craftTLDRabbitReply } from "../services/persona.service";

type State = { sinceId?: string };

const STATE_PATH = join(dirname(TOKENS_FILE_PATH), "mentions-state.json");
const MAX_REPLIES_PER_CYCLE = 3;     // cap replies to be gentle
const CRON_EXPR = "*/3 * * * *";     // every 3 minutes

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

/** Run one polling cycle immediately */
export async function runMentionsOnce(): Promise<{ handled: number; lastId?: string }> {
  try {
    const me = await getSelfUserId();
    const state = loadState();

    const mentions = await fetchMentions(me, state.sinceId);
    if (!mentions.length) return { handled: 0, lastId: state.sinceId };

    // sort oldest -> newest and cap how many we handle
    mentions.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    const batch = mentions.slice(0, MAX_REPLIES_PER_CYCLE);

    let lastId = state.sinceId;
    let handled = 0;

    for (const m of batch) {
      lastId = m.id;
      if (m.author_id === me) continue;

      const reply = craftTLDRabbitReply(m.text);

      try {
        await postReply(reply, m.id);
        handled++;
      } catch (err: any) {
        // if rate-limited, break this cycle to avoid storm
        const status = err?.response?.status;
        if (status === 429) {
          console.warn("[mentions] Rate limited while replying; will retry next cycle.");
          break;
        }
        console.error("[mentions] Failed to reply:", err?.message || err);
      }
    }

    saveState({ sinceId: lastId });
    return { handled, lastId };
  } catch (e) {
    console.error("[mentions] runMentionsOnce error:", e);
    return { handled: 0 };
  }
}

/** Start cron that polls mentions periodically */
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

/** Stop the cron (optional) */
export function stopMentionsJob(): void {
  if (job) {
    job.stop();
    job = null;
    console.log("[mentions] job stopped");
  }
}
