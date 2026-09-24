#!/usr/bin/env node
// MeetLoom load test: simulates the traffic of real browsers against a
// running server, with no dependency beyond Node 24.
//
//   - visitors poll a public link every 3 s (PublicAgenda.tsx)
//   - editors poll their session every 3 s (useSession.ts), send a presence
//     heartbeat every 10 s (usePresence.ts) and save the agenda regularly
//     with compare-and-swap retries, like the editor
//
// Each virtual client gets its own X-Forwarded-For address unless
// --shared-ip is given (everyone behind one NAT or proxy, as in a meeting
// room). The server must trust one proxy hop (TRUST_PROXY=1) for addresses
// to be distinct. See loadtest/README.md.
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:3000" },
    "bootstrap-token": { type: "string", default: process.env.BOOTSTRAP_TOKEN },
    email: { type: "string", default: "loadtest-owner@example.test" },
    password: { type: "string", default: "loadtest-password-123" },
    visitors: { type: "string", default: "200" },
    editors: { type: "string", default: "20" },
    sessions: { type: "string", default: "5" },
    duration: { type: "string", default: "60" },
    "save-every": { type: "string", default: "15" },
    "shared-ip": { type: "boolean", default: false },
    json: { type: "string" },
    help: { type: "boolean", default: false },
  },
});
if (args.help) {
  console.log(`Usage: node loadtest/run.mjs [options]
  --url URL              server origin (default http://127.0.0.1:3000)
  --bootstrap-token T    installation key, only for a fresh database
  --visitors N           public-link visitors, split over the sessions (200)
  --editors N            signed-in editors, split over the sessions (20)
  --sessions N           sessions being run at the same time (5)
  --duration S           seconds of steady load (60)
  --save-every S         seconds between saves per editor (15)
  --shared-ip            every client behind one address (meeting-room NAT)
  --json FILE            also write the report as JSON`);
  process.exit(0);
}
const base = args.url.replace(/\/$/, "");
const origin = new URL(base).origin;
const number = (key) => Math.max(0, Number.parseInt(args[key], 10) || 0);
const visitors = number("visitors"),
  editors = number("editors"),
  sessionCount = Math.max(1, number("sessions")),
  duration = number("duration") * 1000,
  saveEvery = number("save-every") * 1000;

const stats = new Map();
const record = (name, status, ms) => {
  const entry = stats.get(name) ?? { count: 0, statuses: {}, latencies: [] };
  entry.count++;
  entry.statuses[status] = (entry.statuses[status] ?? 0) + 1;
  entry.latencies.push(ms);
  stats.set(name, entry);
};
let address = 0;
const nextAddress = () =>
  args["shared-ip"]
    ? "203.0.113.10"
    : `10.${(++address >> 16) & 255}.${(address >> 8) & 255}.${address & 255}`;

function client(ip = nextAddress()) {
  let cookie = "";
  return async (name, path, method = "GET", body, measured = true) => {
    const started = performance.now();
    let status = 0,
      json;
    try {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "X-Forwarded-For": ip,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      status = response.status;
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      json = status === 204 ? undefined : await response.json();
    } catch {
      status = "network";
    }
    if (measured) record(name, status, performance.now() - started);
    return { status, body: json };
  };
}

// ── Setup: one owner, N sessions each with a visitor link and a running timer.
const owner = client("198.51.100.1");
let signedIn = await owner("setup", "/auth/login", "POST", {
  email: args.email,
  password: args.password,
});
if (signedIn.status !== 200) {
  signedIn = await owner("setup", "/auth/setup", "POST", {
    name: "Load test",
    email: args.email,
    password: args.password,
    locale: "fr",
    bootstrapToken: args["bootstrap-token"],
  });
  if (signedIn.status !== 201) {
    console.error(
      "Could not sign in or set up:",
      signedIn.status,
      signedIn.body,
    );
    process.exit(2);
  }
}
const runId = Date.now().toString(36);
const sessions = [];
for (let index = 0; index < sessionCount; index++) {
  const created = await owner("setup", "/sessions", "POST", {
    title: `Load test ${index + 1}`,
    demo: true,
  });
  if (created.status !== 201) {
    console.error("Could not create a session:", created.status, created.body);
    process.exit(2);
  }
  // The demonstration agenda: realistic blocks, descriptions and notes.
  const session = created.body.session;
  const share = await owner("setup", `/sessions/${session.id}/shares`, "POST", {
    label: "Load test",
    allowComments: true,
  });
  await owner("setup", `/sessions/${session.id}/run`, "POST", {
    action: "start",
    version: session.version,
  });
  sessions.push({ id: session.id, token: share.body?.share?.token });
}
if (sessions.some((session) => !session.token)) {
  console.error("Could not create visitor links.");
  process.exit(2);
}

// ── Steady load.
const until = Date.now() + duration;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (ms) => ms * (0.8 + Math.random() * 0.4);
async function visitor(index) {
  const request = client();
  const { token } = sessions[index % sessions.length];
  await sleep(Math.random() * 3000);
  while (Date.now() < until) {
    await request("visitor poll", `/public/${token}`);
    await sleep(jitter(3000));
  }
}
async function editor(index) {
  // Each editor has an account of its own, invited as an editor of one
  // session, with its own address and presence window.
  const request = client();
  const { id } = sessions[index % sessions.length];
  const email = `loadtest-editor-${runId}-${index}@example.test`;
  const signedUp = await request(
    "setup",
    "/auth/signup",
    "POST",
    {
      name: `Editor ${index + 1}`,
      email,
      password: args.password,
      locale: "fr",
    },
    false,
  );
  if (signedUp.status !== 201) {
    record("editor signup", signedUp.status, 0);
    return;
  }
  await owner(
    "setup",
    `/sessions/${id}/members`,
    "POST",
    {
      email,
      role: "editor",
    },
    false,
  );
  const clientId = randomUUID();
  let lastHeartbeat = 0,
    lastSave = Date.now() + Math.random() * saveEvery;
  await sleep(Math.random() * 3000);
  while (Date.now() < until) {
    const loaded = await request("editor poll", `/sessions/${id}`);
    if (Date.now() - lastHeartbeat > 10_000) {
      lastHeartbeat = Date.now();
      await request("presence", `/sessions/${id}/presence`, "POST", {
        clientId,
        editing: true,
      });
    }
    if (
      saveEvery &&
      Date.now() - lastSave > saveEvery &&
      loaded.body?.session
    ) {
      lastSave = Date.now();
      let session = loaded.body.session;
      for (let attempt = 0; attempt < 3; attempt++) {
        session.days[0].blocks[index % session.days[0].blocks.length].title =
          `Edited by ${index} at ${Date.now()}`;
        const saved = await request("save", `/sessions/${id}`, "PUT", {
          session,
          version: session.version,
        });
        if (saved.status !== 409) break;
        const fresh = await request("save reload", `/sessions/${id}`);
        if (!fresh.body?.session) break;
        session = fresh.body.session;
      }
    }
    await sleep(jitter(3000));
  }
}
const started = Date.now();
await Promise.all([
  ...Array.from({ length: visitors }, (_, index) => visitor(index)),
  ...Array.from({ length: editors }, (_, index) => editor(index)),
]);
const seconds = (Date.now() - started) / 1000;

// ── Report.
const percentile = (sorted, p) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
    : 0;
const report = {
  config: {
    base,
    visitors,
    editors,
    sessions: sessionCount,
    seconds,
    sharedIp: args["shared-ip"],
  },
  endpoints: {},
};
let failures = 0,
  total = 0;
for (const [name, entry] of stats) {
  if (name === "setup") continue;
  const sorted = entry.latencies.sort((a, b) => a - b);
  const bad = Object.entries(entry.statuses)
    .filter(([status]) => !["200", "201", "204", "409"].includes(status))
    .reduce((sum, [, count]) => sum + count, 0);
  failures += bad;
  total += entry.count;
  report.endpoints[name] = {
    requests: entry.count,
    perSecond: +(entry.count / seconds).toFixed(1),
    statuses: entry.statuses,
    p50: +percentile(sorted, 0.5).toFixed(1),
    p95: +percentile(sorted, 0.95).toFixed(1),
    p99: +percentile(sorted, 0.99).toFixed(1),
    max: +(sorted.at(-1) ?? 0).toFixed(1),
  };
}
report.total = {
  requests: total,
  perSecond: +(total / seconds).toFixed(1),
  failures,
};
console.log(
  `MeetLoom load test: ${visitors} visitors, ${editors} editors, ${sessionCount} sessions, ${seconds.toFixed(0)} s${args["shared-ip"] ? ", one shared address" : ""}`,
);
console.table(
  Object.fromEntries(
    Object.entries(report.endpoints).map(([name, value]) => [
      name,
      {
        "req/s": value.perSecond,
        "p50 ms": value.p50,
        "p95 ms": value.p95,
        "p99 ms": value.p99,
        statuses: JSON.stringify(value.statuses),
      },
    ]),
  ),
);
console.log(
  `Total ${report.total.requests} requests (${report.total.perSecond}/s), ${failures} failed (anything but 2xx or an expected 409 conflict).`,
);
if (args.json) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(args.json, JSON.stringify(report, null, 2));
}
process.exit(failures ? 1 : 0);
