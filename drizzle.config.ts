import { defineConfig } from "drizzle-kit";
import { existsSync, readFileSync } from "fs";

function resolveDatabaseUrl() {
  const localEnvPath = ".env.local";
  if (existsSync(localEnvPath)) {
    const content = readFileSync(localEnvPath, "utf8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      if (!line.startsWith("DATABASE_URL=")) continue;

      const value = line.slice("DATABASE_URL=".length).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
      }
      return value;
    }
  }

  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  return "";
}

const databaseUrl = resolveDatabaseUrl();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
