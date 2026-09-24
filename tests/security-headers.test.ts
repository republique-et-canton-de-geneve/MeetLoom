import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness } from "./support.js";

// Pins the response headers the security review relies on. The E2E suite
// serves the production build through the same server, so it also proves the
// policy lets the application run in a real browser.
test("API and application pages carry a self-only CSP and hardened headers", async (t) => {
  const client = mkdtempSync(join(tmpdir(), "meetloom-client-"));
  writeFileSync(join(client, "index.html"), "<!doctype html><title>x</title>");
  const h = await harness(t, { clientPath: client });
  for (const path of ["/api/health", "/some/spa/route"]) {
    const response = await fetch(`${h.base}${path}`);
    assert.equal(response.status, 200, path);
    const csp = response.headers.get("content-security-policy") ?? "";
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "script-src-attr 'none'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
    ])
      assert.ok(csp.includes(directive), `${path}: ${directive} in ${csp}`);
    assert.equal(csp.includes("https:"), false, `${path}: no external origin`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.match(
      response.headers.get("strict-transport-security") ?? "",
      /max-age=\d+/,
    );
    assert.equal(response.headers.get("x-powered-by"), null);
  }
  assert.equal(
    (await fetch(`${h.base}/api/health`)).headers.get("cache-control"),
    "no-store",
  );
});
