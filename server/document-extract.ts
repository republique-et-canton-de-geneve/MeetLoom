import { Worker } from "node:worker_threads";
import { HttpError } from "./security.js";
import {
  DOCUMENT_MAX_BYTES,
  type ExtractedDocument,
} from "../shared/document-import.js";

let active = 0;
/** Untrusted decompression/XML/PDF work stays off the API thread and has a hard deadline. */
export async function extractDocument(
  name: string,
  bytes: Uint8Array,
  timeoutMs = 15_000,
): Promise<ExtractedDocument> {
  if (bytes.byteLength > DOCUMENT_MAX_BYTES)
    throw new HttpError(413, "IMPORT_FILE_LIMIT", "The document exceeds 5 MB.");
  if (active >= 2)
    throw new HttpError(
      429,
      "IMPORT_BUSY",
      "Document processing is busy. Please try again.",
    );
  active++;
  try {
    return await new Promise<ExtractedDocument>((resolve, reject) => {
      const source = import.meta.url.endsWith(".ts");
      const entry = new URL(
        source ? "./document-worker.ts" : "./document-worker.js",
        import.meta.url,
      );
      const worker = source
        ? new Worker(
            `const {tsImport}=await import('tsx/esm/api');await tsImport(${JSON.stringify(entry.href)},${JSON.stringify(import.meta.url)});`,
            {
              eval: true,
              workerData: { name, bytes },
              resourceLimits: {
                maxOldGenerationSizeMb: 256,
                maxYoungGenerationSizeMb: 32,
              },
            },
          )
        : new Worker(entry, {
            workerData: { name, bytes },
            resourceLimits: {
              maxOldGenerationSizeMb: 256,
              maxYoungGenerationSizeMb: 32,
            },
          });
      let settled = false;
      const finish = (error?: Error, value?: ExtractedDocument) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void worker.terminate();
        error ? reject(error) : resolve(value!);
      };
      const timeout = setTimeout(
        () =>
          finish(
            new HttpError(
              422,
              "IMPORT_TIMEOUT",
              "The document could not be processed within 15 seconds.",
            ),
          ),
        timeoutMs,
      );
      worker.once("error", () =>
        finish(
          new HttpError(
            422,
            "IMPORT_FILE_INVALID",
            "The document cannot be processed.",
          ),
        ),
      );
      worker.once("exit", () => {
        if (!settled)
          finish(
            new HttpError(
              422,
              "IMPORT_FILE_INVALID",
              "The document cannot be processed.",
            ),
          );
      });
      worker.once("message", (result) =>
        result.ok
          ? finish(undefined, result.value)
          : finish(
              new HttpError(
                422,
                result.code,
                "The document cannot be processed.",
              ),
            ),
      );
    });
  } finally {
    active--;
  }
}
