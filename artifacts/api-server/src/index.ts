import app from "./app";
import { logger } from "./lib/logger";
import { migrateDatabase } from "@workspace/db/migrate";
import { assertRenderedVideoStorageConfigured } from "./lib/renderedVideoStorage";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    assertRenderedVideoStorageConfigured();
  }
  if (process.env.RUN_DB_MIGRATIONS === "true") {
    await migrateDatabase();
  }

  app.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "Server listening");
  });
}

startServer().catch((err: unknown) => {
  logger.error({ err }, "Server startup failed");
  process.exit(1);
});
