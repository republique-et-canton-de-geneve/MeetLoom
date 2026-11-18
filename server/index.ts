import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { loadEnvFile } from "node:process";
import { log } from "./log.js";
import { appVersion } from "./version.js";
import {
  REQUEST_RECEIVE_TIMEOUT_MS,
  SHUTDOWN_TIMEOUT_MS,
} from "./runtime-limits.js";

// Node's native loader preserves values already provided by OpenShift/Compose.
try {
  loadEnvFile(".env");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}

const config = readConfig();
const runtime = await createApp(config.app);
if (
  config.production &&
  !config.app.bootstrapToken &&
  !(await runtime.db.all("SELECT id FROM bootstrap WHERE id = 1")).length
) {
  await runtime.close();
  throw new Error(
    "BOOTSTRAP_TOKEN is required for first-time production initialization.",
  );
}
const server = runtime.app.listen(config.port, config.host, () =>
  log.info(`MeetLoom listening on port ${config.port}`, {
    version: appVersion().version,
  }),
);
server.requestTimeout = REQUEST_RECEIVE_TIMEOUT_MS;
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  deadline.unref();
  server.close(() => {
    void runtime.close().finally(() => clearTimeout(deadline));
  });
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
