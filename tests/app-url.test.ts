import test from "node:test";
import assert from "node:assert/strict";
import { appUrl, appPathname } from "../src/app-url.js";
import { dashboardUrl, signInTarget } from "../src/navigation.js";

test("browser paths stay inside the injected mount without duplicating the prefix", (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { querySelector: () => ({ content: "/meetloom" }) },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  });
  assert.equal(appUrl("/api/auth/status"), "/meetloom/api/auth/status");
  assert.equal(
    appUrl("/meetloom/session/one?day=two#block"),
    "/meetloom/session/one?day=two#block",
  );
  assert.equal(appPathname("/meetloom/session/one"), "/session/one");
  assert.equal(appPathname("/meetloom"), "/");
  assert.equal(
    appPathname("/meetloom-other/session/one"),
    "/meetloom-other/session/one",
  );
  assert.equal(dashboardUrl("personal"), "/meetloom/?workspace=personal");
  assert.equal(
    signInTarget(
      "https://tools.example.test/meetloom/?workspace=personal",
      false,
    ),
    "/meetloom/?workspace=personal",
  );
  assert.equal(
    signInTarget("https://tools.example.test/meetloom/join/token", true),
    "/meetloom/?workspace=all",
  );
});
