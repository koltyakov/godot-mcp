import assert from "node:assert/strict";
import test from "node:test";

import {
  setServerLogger,
  setMinimumLogLevel,
  getMinimumLogLevel,
  log,
} from "../src/logger.js";
import { setResourceListChangedNotifier, notifyResourcesChanged } from "../src/notifications.js";

test("logger emits at or above the configured minimum level", async () => {
  const sent: Array<{ level: string; logger: string; data: unknown }> = [];
  setServerLogger(async (level, logger, data) => {
    sent.push({ level, logger, data });
  });
  setMinimumLogLevel("warning");

  await log("debug", "t", { n: 1 });
  await log("info", "t", { n: 2 });
  await log("warning", "t", { n: 3 });
  await log("error", "t", { n: 4 });

  assert.deepEqual(
    sent.map((s) => s.level),
    ["warning", "error"]
  );

  // Restore defaults so this test doesn't leak into others.
  setServerLogger(null);
  setMinimumLogLevel("debug");
});

test("logger never throws when no client is attached", async () => {
  setServerLogger(null);
  setMinimumLogLevel("debug");
  await assert.doesNotReject(log("info", "t", { x: 1 }));
});

test("logger swallows errors thrown by the sendLog callback", async () => {
  setServerLogger(async () => {
    throw new Error("client gone");
  });
  setMinimumLogLevel("debug");
  await assert.doesNotReject(log("info", "t", { x: 1 }));
  setServerLogger(null);
});

test("getMinimumLogLevel reflects the configured level", () => {
  setMinimumLogLevel("error");
  assert.equal(getMinimumLogLevel(), "error");
  setMinimumLogLevel("debug");
  assert.equal(getMinimumLogLevel(), "debug");
});

test("notifyResourcesChanged invokes the installed notifier exactly once", async () => {
  let calls = 0;
  setResourceListChangedNotifier(async () => {
    calls += 1;
  });

  await notifyResourcesChanged();
  await notifyResourcesChanged();
  assert.equal(calls, 2);

  setResourceListChangedNotifier(null);
});

test("notifyResourcesChanged is a no-op without an installed notifier", async () => {
  setResourceListChangedNotifier(null);
  await assert.doesNotReject(notifyResourcesChanged());
});
