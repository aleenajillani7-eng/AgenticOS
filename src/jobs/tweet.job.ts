// src/jobs/tweet.job.ts
import { schedule, ScheduledTask } from "node-cron";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { generateAndPostTweet } from "../services/twitter.service";
import { TOKENS_FILE_PATH, loadTokens } from "../utils/encryption";

// Path to the schedule configuration file (lives in repo at ./data/schedule.json)
const CONFIG_PATH = join(import.meta.dir, "../../data/schedule.json");

// Store scheduled jobs for later management
const scheduledJobs = new Map<string, ScheduledTask>();

/** Load schedule configuration from JSON file */
function loadConfig(): { config: any; schedule: Record<string, any> } {
  try {
    const data = readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading schedule config:", error);
    return { config: {}, schedule: {} };
  }
}

/** Replace {{placeholders}} inside an instruction string */
function processTemplate(instruction: string, config: any): string {
  return instruction.replace(/\{\{(\w+)\}\}/g, (match, key) => config[key] ?? match);
}

/** Internal guard: only allow scheduling when tokens file exists & decrypts */
async function tokenGuard(): Promise<boolean> {
  try {
    if (!existsSync(TOKENS_FILE_PATH)) {
      console.warn(`[scheduler] Not starting: tokens not found at ${TOKENS_FILE_PATH}`);
      return false;
    }
    await loadTokens(process.env.ENCRYPTION_KEY || "");
    return true;
  } catch (e: any) {
    console.error("[scheduler] Not starting: token decrypt failed ->", e?.message || e);
    return false;
  }
}

/**
 * Schedule tweets based on configuration
 * Sets up cron jobs for each time entry in the schedule
 */
export async function scheduleTweets(): Promise<void> {
  // Stop any existing jobs before creating new ones
  stopAllScheduledTweets();

  // ✅ Hard guard — bail out if tokens aren’t ready
  if (!(await tokenGuard())) {
    return;
  }

  const { config, schedule: scheduleEntries } = loadConfig();

  if (!scheduleEntries || Object.keys(scheduleEntries).length === 0) {
    console.warn("No scheduled tweets found in configuration");
    return;
  }

  console.log(`Setting up ${Object.keys(scheduleEntries).length} scheduled tweets`);

  for (const time in scheduleEntries) {
    const entry = scheduleEntries[time];
    const { type, instruction } = entry;

    // Fill template placeholders
    const processedInstruction = processTemplate(instruction, config);

    const [hour, minute] = time.split(":");
    const timezone = config.timezone || "UTC";

    // Create cron job
    const job = schedule(
      `${minute} ${hour} * * *`,
      async () => {
        try {
          console.log(`Running scheduled tweet for ${timezone} time: ${time} (Type: ${type})`);
          await generateAndPostTweet(processedInstruction);
        } catch (error) {
          console.error(`Error executing scheduled tweet for time ${time}:`, error);
        }
      },
      { timezone }
    );

    // Store the job for later control
    scheduledJobs.set(time, job);
    console.log(`Scheduled ${type} tweet for ${time} ${timezone}`);
  }
}

/** Stop all currently scheduled tweets */
export function stopAllScheduledTweets(): number {
  let stoppedCount = 0;

  for (const [time, job] of scheduledJobs.entries()) {
    job.stop();
    scheduledJobs.delete(time);
    stoppedCount++;
  }

  if (stoppedCount > 0) {
    console.log(`Stopped ${stoppedCount} scheduled tweet jobs`);
  }
  return stoppedCount;
}
