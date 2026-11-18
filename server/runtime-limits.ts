// Keep the supported AI timeout and HTTP receive window in the drain budget.
// Node 24 already uses this five-minute request receive timeout by default.
export const REQUEST_RECEIVE_TIMEOUT_MS = 300_000;
export const MAX_AI_TIMEOUT_MS = 300_000;
// Allow response persistence, queued mail and runtime cleanup after HTTP work.
export const SHUTDOWN_TIMEOUT_MS =
  REQUEST_RECEIVE_TIMEOUT_MS + MAX_AI_TIMEOUT_MS + 60_000;
