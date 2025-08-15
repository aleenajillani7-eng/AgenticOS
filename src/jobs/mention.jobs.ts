// src/jobs/mentions.job.ts
import { schedule, ScheduledTask } from "node-cron";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { TOKENS_FILE_PATH } from "../utils/encryption";
import {
  getSelfUserId,
  fetchMentions,
  postReply,
} from "../services/twitter.service";
import { craftTLDRabbitReply } from "../services/persona.service";

type State = { sinceId?: string };

const STATE_PATH = join(dirname(TOKENS_FILE_PATH), "mentions-state.json");
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

    // Reply oldest->newest, skip self-mentions
    mentions.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);

    let lastId = state.sinceId;
    let handled = 0;

    for (const m of mentions) {
      lastId = m.id;
      if (m.author_id === me) continue;

      // Build two-line reply
      const reply = craftTLDRabbitReply(m.text);

      try {
        await postReply(reply, m.id);
        handled++;
      } catch (err) {
        console.error("[mentions] Failed to reply:", err);
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
  job = schedule("*/2 * * * *", async () => {
    try {
      const res = await runMentionsOnce();
      if (res.handled) {
        console.log(`[mentions] Replied to ${res.handled} mention(s). sinceId=${res.lastId}`);
      }
    } catch (e) {
      console.error("[mentions] cron cycle error:", e);
    }
  });
  console.log("[mentions] job scheduled: every 2 minutes");
}

/** Stop the cron (optional) */
export function stopMentionsJob(): void {
  if (job) {
    job.stop();
    job = null;
    console.log("[mentions] job stopped");
  }
}
