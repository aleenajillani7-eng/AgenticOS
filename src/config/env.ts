import { z } from "zod";

// Define environment schema with Zod
const envSchema = z.object({
  // Server Configuration
  PORT: z.string().default("8000"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Twitter API Credentials
  TWITTER_CLIENT_ID: z.string().min(1, "Twitter Client ID is required"),
  TWITTER_CLIENT_SECRET: z.string().min(1, "Twitter Client Secret is required"),

  // Encryption Settings
  ENCRYPTION_KEY: z
    .string()
    .min(32, "Encryption key should be at least 32 characters long"),
  ENCRYPTION_SALT: z.string().min(1, "Encryption salt is required"),
  ENCRYPTION_IV: z.string().min(1, "Initialization vector is required"),

  // ChainGPT API
  CHAINGPT_API_KEY: z.string().min(1, "ChainGPT API key is required"),

  // Token Set Password
  PASSWORD_AUTH: z.string().min(1, "Token set password is required"),
});

// Parse and validate environment variables
// Bun automatically loads .env file, no need for dotenv
const parseEnv = () => {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map((err) => {
        return `${err.path.join(".")}: ${err.message}`;
      });

      console.error("❌ Invalid environment variables:");
      errorMessages.forEach((message) => console.error(`  - ${message}`));
      process.exit(1);
    }

    throw error;
  }
};

// Export validated environment variables
export const env = parseEnv();

// Type definition for environment variables
export type Env = z.infer<typeof envSchema>;
