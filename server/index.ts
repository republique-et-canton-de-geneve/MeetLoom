import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { loadEnvFile } from "node:process";

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
  console.info(`MeetLoom listening on port ${config.port}`),
);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => {
    process.exitCode = 1;
    server.closeAllConnections();
  }, 10000);
  deadline.unref();
  server.close(() => {
    void runtime.close().finally(() => clearTimeout(deadline));
  });
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
