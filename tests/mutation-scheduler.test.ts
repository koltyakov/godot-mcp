import assert from "node:assert/strict";
import test from "node:test";

import { MutationScheduler } from "../src/godot/mutation-scheduler.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve };
}

test("MutationScheduler runs different scenes concurrently and same scenes serially", async () => {
  const scheduler = new MutationScheduler();
  const gate = deferred();
  const events: string[] = [];
  const first = scheduler.run({ projectPath: "/p", scenePath: "res://a.tscn" }, undefined, async () => {
    events.push("start:a1");
    await gate.promise;
    events.push("end:a1");
  });
  const sameScene = scheduler.run({ projectPath: "/p", scenePath: "res://a.tscn" }, undefined, async () => {
    events.push("start:a2");
  });
  const otherScene = scheduler.run({ projectPath: "/p", scenePath: "res://b.tscn" }, undefined, async () => {
    events.push("start:b");
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(events, ["start:a1"]);
  gate.resolve();
  await Promise.all([first, sameScene, otherScene]);
  assert.deepEqual(events, ["start:a1", "end:a1", "start:a2", "start:b"]);
});

test("MutationScheduler gives queued project mutations an exclusive barrier", async () => {
  const scheduler = new MutationScheduler();
  const sceneGate = deferred();
  const projectGate = deferred();
  const events: string[] = [];
  const scene = scheduler.run({ projectPath: "/p", scenePath: "res://a.tscn" }, undefined, async () => {
    events.push("scene:start");
    await sceneGate.promise;
    events.push("scene:end");
  });
  const project = scheduler.run({ projectPath: "/p" }, undefined, async () => {
    events.push("project:start");
    await projectGate.promise;
    events.push("project:end");
  });
  const laterScene = scheduler.run({ projectPath: "/p", scenePath: "res://b.tscn" }, undefined, async () => {
    events.push("later:start");
  });

  sceneGate.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(events, ["scene:start", "scene:end", "project:start"]);
  projectGate.resolve();
  await Promise.all([scene, project, laterScene]);
  assert.deepEqual(events, ["scene:start", "scene:end", "project:start", "project:end", "later:start"]);
});

test("MutationScheduler removes cancelled queued mutations", async () => {
  const scheduler = new MutationScheduler();
  const gate = deferred();
  const first = scheduler.run({ projectPath: "/p" }, undefined, () => gate.promise);
  const controller = new AbortController();
  let executed = false;
  const queued = scheduler.run({ projectPath: "/p" }, controller.signal, async () => {
    executed = true;
  });
  controller.abort();

  await assert.rejects(queued, { name: "AbortError" });
  gate.resolve();
  await first;
  assert.equal(executed, false);
});
