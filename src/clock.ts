/**
 * The server's clock as seen from this browser. Run timestamps (block start,
 * scheduled start) come from the server, so a device whose clock is a few
 * seconds or minutes off would otherwise show a wrong countdown. Each API
 * response carries `X-Server-Time`; the offset is taken from the fastest
 * recent exchange, where the network delay blurs it least.
 */
let offset = 0;
let bestRoundTrip = Infinity;
let sampledAt = -Infinity;
/** Older samples give way, so a clock corrected mid-session is followed. */
const SAMPLE_LIFETIME_MS = 60_000;

export function recordServerTime(
  response: Pick<Response, "headers">,
  sentAt: number,
  receivedAt = Date.now(),
) {
  const serverTime = Number(response.headers.get("X-Server-Time"));
  const roundTrip = receivedAt - sentAt;
  if (!Number.isFinite(serverTime) || serverTime <= 0 || roundTrip < 0) return;
  if (roundTrip > bestRoundTrip && receivedAt - sampledAt < SAMPLE_LIFETIME_MS)
    return;
  offset = serverTime - (sentAt + receivedAt) / 2;
  bestRoundTrip = roundTrip;
  sampledAt = receivedAt;
}

/** Milliseconds since the epoch on the server's clock. */
export const serverNow = () => Date.now() + offset;
