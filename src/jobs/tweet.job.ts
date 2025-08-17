// src/jobs/tweet.job.ts
import { schedule, ScheduledTask } from "node-cron";
import { readFileSync } from "fs";
import { join } from "path";
import { generateAndPostTweet } from "../services/twitter.service";

// Path to the schedule configuration file
const CONFIG_PATH = join(import.meta.dir, "../../data/schedule.json");

// Store scheduled jobs for later management
const scheduledJobs = new Map<string, ScheduledTask>();

// Simple duplicate-run guard: remember when a given slot last fired
const lastRunAt = new Map<string, number>();

type ScheduleEntry = {
  type: string;
  instruction: string;
};

function loadConfig(): { config: Record<string, any>; schedule: Record<string, ScheduleEntry> } {
  try {
    const data = readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading schedule config:", error);
    return { config: {}, schedule: {} };
  }
}

function processTemplate(instruction: string, config: Record<string, any>): string {
  return instruction.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return config[key] ?? match;
  });
}

export function scheduleTweets(): void {
  stopAllScheduledTweets();

  const { config, schedule: entries } = loadConfig();
  if (!entries || Object.keys(entries).length === 0) {
    console.warn("No scheduled tweets found in configuration");
    return;
  }

  console.log(`Setting up ${Object.keys(entries).length} scheduled tweets`);

  for (const time of Object.keys(entries)) {
    const entry = entries[time];
    const { type, instruction } = entry;

    const processedInstruction = processTemplate(instruction, config);
    const [hour, minute] = time.split(":");
    const timezone = config.timezone || "UTC";

    const job = schedule(
      `${minute} ${hour} * * *`,
      async () => {
        try {
          // Duplicate guard: if same slot ran < 55s ago (e.g., fast restarts), skip
          const prev = lastRunAt.get(time) || 0;
          const now = Date.now();
          if (now - prev < 55_000) {
            console.warn(`[cron] Skipping duplicate execution for ${time} (ran ${now - prev}ms ago)`);
            return;
          }
          lastRunAt.set(time, now);

          console.log(`Running scheduled tweet for ${timezone} time: ${time} (Type: ${type})`);
          await generateAndPostTweet(processedInstruction);
        } catch (error) {
          // If twitter.service applied a long backoff, it will have waited already.
          // We just log the error and continue; next cron will try again.
          console.error(`Error executing scheduled tweet for time ${time}:`, error);
        }
      },
      { timezone }
    );

    scheduledJobs.set(time, job);
    console.log(`Scheduled ${type} tweet for ${time} ${timezone}`);
  }
}

export function stopAllScheduledTweets(): number {
  let stopped = 0;
  for (const [time, job] of scheduledJobs.entries()) {
    try {
      job.stop();
    } catch {
      // ignore
    }
    scheduledJobs.delete(time);
    stopped++;
  }
  if (stopped > 0) console.log(`Stopped ${stopped} scheduled tweet jobs`);
  return stopped;
}
