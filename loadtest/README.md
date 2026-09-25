# Load test

`loadtest/run.mjs` reproduces the traffic of real browsers against a running MeetLoom server, with no dependency beyond Node.js 24:

- **Visitors** poll a public link every 3 seconds, like the visitor page.
- **Editors**, each with their own account, poll their session every 3 seconds, send a presence heartbeat every 10 seconds and save the agenda every 15 seconds with compare-and-swap retries, like the editor.
- Several sessions run at the same time, each with a visitor link and a started timer.

Each virtual client uses its own `X-Forwarded-For` address, or one shared address with `--shared-ip` (a meeting room behind one NAT or proxy). The server must trust one proxy hop (`TRUST_PROXY=1`, as in the OpenShift manifests) for those addresses to count.

## Run it

Use a disposable database: the test creates accounts, sessions and links.

```bash
npm run build
NODE_ENV=production PORT=3300 HOST=127.0.0.1 APP_ORIGIN=http://127.0.0.1:3300 \
  COOKIE_SECURE=false TRUST_PROXY=1 BOOTSTRAP_TOKEN=loadtest-bootstrap \
  DATABASE_URL=postgresql://user:password@127.0.0.1:5432/meetloom_load \
  node dist/server/index.js

# In another terminal
node loadtest/run.mjs --url http://127.0.0.1:3300 --bootstrap-token loadtest-bootstrap \
  --visitors 1000 --editors 100 --sessions 10 --duration 60
node loadtest/run.mjs --url http://127.0.0.1:3300 --visitors 300 --editors 20 --shared-ip
```

`--help` lists every option; `--json FILE` writes the report. The exit code is `0` when every request succeeded (a `409` save conflict followed by a reload is expected behavior, not a failure).

Against a deployed environment, sign-up must be open for the editor accounts, and the per-address budget applies to the machine running the test unless the router forwards the simulated addresses.

## Reference results

September 24, 2026, one application process on a 4-core container that also ran PostgreSQL 16 and the load generator:

| Scenario                                          | Throughput | Visitor poll p50 / p95 / p99 | Editor poll p95 | Save p95 | Failures |
| ------------------------------------------------- | ---------- | ---------------------------- | --------------- | -------- | -------- |
| 300 visitors + 20 editors behind one address      | 103 req/s  | 3 / 5 / 12 ms                | 6 ms            | 18 ms    | 0        |
| 1000 visitors + 100 editors, 10 sessions          | 355 req/s  | 3 / 13 / 95 ms               | 7 ms            | 21 ms    | 0        |
| 1500 visitors + 100 editors, 10 sessions (stress) | 504 req/s  | 4 / 295 / 1020 ms            | 24 ms           | 26 ms    | 0        |

One pod comfortably serves about 1000 people following sessions and 100 editing; the OpenShift manifests run two. Beyond about 450 requests per second a single process saturates: latency grows but no request fails. Before this test, a room of 100 visitors behind one address hit the former 600 requests-per-minute limit per address and half of their requests were refused; see `server/quotas.ts` for the current budgets.
