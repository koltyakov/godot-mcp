import assert from "node:assert/strict";
import test from "node:test";

import { FifoSemaphore } from "../src/godot/concurrency.js";

test("FifoSemaphore enforces its limit and preserves queued order", async () => {
  const semaphore = new FifoSemaphore(1);
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = semaphore.run(undefined, async () => {
    events.push("start:a");
    await firstGate;
    events.push("end:a");
  });
  const second = semaphore.run(undefined, async () => {
    events.push("start:b");
    events.push("end:b");
  });
  const third = semaphore.run(undefined, async () => {
    events.push("start:c");
    events.push("end:c");
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(events, ["start:a"]);
  releaseFirst();
  await Promise.all([first, second, third]);
  assert.deepEqual(events, ["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
});

test("FifoSemaphore removes cancelled queued work", async () => {
  const semaphore = new FifoSemaphore(1);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = semaphore.run(undefined, () => gate);
  const controller = new AbortController();
  let executed = false;
  const queued = semaphore.run(controller.signal, async () => {
    executed = true;
  });

  controller.abort();
  await assert.rejects(queued, { name: "AbortError" });
  release();
  await first;
  assert.equal(executed, false);
});
