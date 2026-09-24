import { parentPort, workerData } from "node:worker_threads";
import { parseDocument } from "./document-parser.js";
try {
  parentPort?.postMessage({
    ok: true,
    value: await parseDocument(workerData.name, workerData.bytes),
  });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    code:
      error instanceof Error && /^IMPORT_[A-Z_]+$/.test(error.message)
        ? error.message
        : "IMPORT_FILE_INVALID",
  });
}
