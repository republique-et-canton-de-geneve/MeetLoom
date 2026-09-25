export type LogLevel = "info" | "warn" | "error";
export type LogDetails = Record<string, string | number | boolean | null>;
export interface LogEntry {
  at: string;
  level: LogLevel;
  message: string;
  details?: LogDetails;
}

const sinks = new Set<(entry: LogEntry) => void>();

/** Receives every entry written from now on; returns its removal. */
export function addLogSink(sink: (entry: LogEntry) => void) {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

const clean = (details: LogDetails): LogDetails =>
  Object.fromEntries(
    Object.entries(details)
      .slice(0, 20)
      .map(([key, value]) => [
        key.slice(0, 60),
        typeof value === "string" ? value.slice(0, 300) : value,
      ]),
  );

function write(level: LogLevel, message: string, details?: LogDetails) {
  // The standard output stays the source for OpenShift and log collectors.
  const print =
    level === "info"
      ? console.info
      : level === "warn"
        ? console.warn
        : console.error;
  if (details) print(message, details);
  else print(message);
  const entry: LogEntry = {
    at: new Date().toISOString(),
    level,
    message: message.slice(0, 500),
    ...(details ? { details: clean(details) } : {}),
  };
  for (const sink of sinks) {
    try {
      sink(entry);
    } catch {
      // A failing sink never breaks the caller.
    }
  }
}

/**
 * Server log lines. They name what failed and why (codes, routes, counts),
 * never secrets, request bodies or personal answers: administrators read
 * them in the application (server/logs.ts), not only on OpenShift.
 */
export const log = {
  info: (message: string, details?: LogDetails) =>
    write("info", message, details),
  warn: (message: string, details?: LogDetails) =>
    write("warn", message, details),
  error: (message: string, details?: LogDetails) =>
    write("error", message, details),
};
