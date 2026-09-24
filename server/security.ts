import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response } from "express";
import { MemoryStore, rateLimit as expressRateLimit } from "express-rate-limit";

// OWASP's 16 MiB profile uses p=5. Encode the work factors so future upgrades
// can migrate hashes at sign-in without resetting existing users' passwords.
const scrypt = (password: string, salt: string, legacy = false) =>
  new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      64,
      { N: 16384, r: 8, p: legacy ? 1 : 5, maxmem: 32 * 1024 * 1024 },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
  });
export const DUMMY_PASSWORD_HASH = `scrypt:16384:8:5:${"0".repeat(32)}:${"0".repeat(128)}`;
export const token = () => randomBytes(32).toString("base64url");
export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt);
  return `scrypt:16384:8:5:${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.split(":");
  const legacy = parts.length === 3;
  if (
    parts[0] !== "scrypt" ||
    (!legacy &&
      (parts.length !== 6 || parts.slice(1, 4).join(":") !== "16384:8:5"))
  )
    return false;
  const [salt, stored] = parts.slice(-2);
  if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(stored))
    return false;
  const hash = await scrypt(password, salt, legacy);
  const expected = Buffer.from(stored, "hex");
  return expected.length === hash.length && timingSafeEqual(expected, hash);
}
export function constantEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, code: string, message: string): never => {
  throw new HttpError(status, code, message);
};
// Limiters created while an application is assembled register their stores
// with that application, so closing it releases their budgets and timers.
const limiterStores = new AsyncLocalStorage<MemoryStore[]>();
export async function withRateLimitStores<T>(
  assemble: () => Promise<T>,
): Promise<{ result: T; shutdown: () => void }> {
  const stores: MemoryStore[] = [];
  const shutdown = () => {
    for (const store of stores.splice(0)) store.shutdown();
  };
  try {
    return { result: await limiterStores.run(stores, assemble), shutdown };
  } catch (error) {
    shutdown();
    throw error;
  }
}
export function rateLimit(
  max: number,
  interval: number,
  key?: (request: Request, response: Response) => string,
) {
  // Each middleware has its own in-memory budget. Default IP keys also group
  // IPv6 subnets, preventing address rotation from bypassing the limit.
  const store = new MemoryStore();
  limiterStores.getStore()?.push(store);
  return expressRateLimit({
    limit: max,
    windowMs: interval,
    store,
    ...(key ? { keyGenerator: key } : {}),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Too many requests. Try again shortly.",
      code: "RATE_LIMITED",
    },
  });
}
