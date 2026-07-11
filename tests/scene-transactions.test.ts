import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

import { GodotExecutor } from "../src/godot/executor.js";
import { applySceneChangesTool } from "../src/tools/scene-tools.js";
import { createGodotProject, createMockGodotExecutor, createTempDir, writeText } from "./helpers.js";

test("apply_scene_changes normalizes and forwards an ordered transaction", async (t) => {
  const projectPath = await createGodotProject(t);
  const realProjectPath = await fs.realpath(projectPath);
  let received: { projectPath?: string; operation?: string; params?: Record<string, unknown> } = {};
  const executor = createMockGodotExecutor(async (pathValue, operation, params) => {
    received = { projectPath: pathValue, operation, params };
    return {
      success: true,
      output: "",
      data: {
        success: true,
        scene_path: "res://scenes/main.tscn",
        applied_count: 3,
        results: [],
      },
    };
  });

  const result = await applySceneChangesTool.execute({
    project_path: projectPath,
    scene_path: "scenes/main.tscn",
    changes: [
      {
        operation: "add_node",
        parent_path: ".",
        instance_scene_path: "scenes/enemy.tscn",
        node_name: "Enemy",
        properties: { position: { _type: "Vector2", x: 10, y: 20 } },
      },
      { operation: "modify_node", node_path: "Enemy", properties: { visible: false } },
      { operation: "remove_node", node_path: "OldEnemy" },
    ],
  }, executor);

  assert.equal(received.projectPath, realProjectPath);
  assert.equal(received.operation, "apply_scene_changes");
  assert.deepEqual(received.params, {
    scene_path: "res://scenes/main.tscn",
    changes: [
      {
        operation: "add_node",
        parent_path: ".",
        instance_scene_path: "res://scenes/enemy.tscn",
        node_name: "Enemy",
        properties: { position: { _type: "Vector2", x: 10, y: 20 } },
      },
      { operation: "modify_node", node_path: "Enemy", properties: { visible: false } },
      { operation: "remove_node", node_path: "OldEnemy" },
    ],
  });
  assert.equal((result as Record<string, unknown>).applied_count, 3);
});

test("apply_scene_changes rejects invalid transactions before spawning Godot", async (t) => {
  const projectPath = await createGodotProject(t);
  let calls = 0;
  const executor = createMockGodotExecutor(async () => {
    calls += 1;
    return { success: true, output: "" };
  });

  await assert.rejects(
    applySceneChangesTool.execute({ project_path: projectPath, scene_path: "main.tscn", changes: [] }, executor),
    /between 1 and 100/
  );
  await assert.rejects(
    applySceneChangesTool.execute({
      project_path: projectPath,
      scene_path: "main.tscn",
      changes: [{ operation: "add_node", node_name: "Both", node_type: "Node", instance_scene_path: "child.tscn" }],
    }, executor),
    /Exactly one/
  );
  await assert.rejects(
    applySceneChangesTool.execute({
      project_path: projectPath,
      scene_path: "main.tscn",
      changes: [{ operation: "remove_node", node_path: "." }],
    }, executor),
    /cannot remove the scene root/
  );
  assert.equal(calls, 0);
});

test("GodotExecutor serializes mutations targeting the same scene", async (t) => {
  const dir = await createTempDir(t);
  await fs.mkdir(path.join(dir, "scenes"));
  await fs.symlink(path.join(dir, "scenes"), path.join(dir, "scene-alias"));
  const fakeGodotPath = path.join(dir, "fake-godot.mjs");
  const eventPath = path.join(dir, "events.log");
  await writeText(fakeGodotPath, `#!/usr/bin/env node
import fs from "node:fs";
const markerArgs = process.argv.slice(process.argv.indexOf('--') + 1);
const params = JSON.parse(markerArgs[1]);
fs.appendFileSync(params.event_path, 'start:' + params.id + '\\n');
setTimeout(() => {
  fs.appendFileSync(params.event_path, 'end:' + params.id + '\\n');
  process.stdout.write('[GODOT_MCP_RESULT:' + params.__mcp_result_token + ']');
  process.stdout.write('{"success":true,"message":"ok"}');
  process.stdout.write('[/GODOT_MCP_RESULT:' + params.__mcp_result_token + ']');
}, 80);
`);
  await fs.chmod(fakeGodotPath, 0o755);
  const executor = new GodotExecutor(fakeGodotPath);

  await Promise.all([
    executor.execute(dir, "add_node", { scene_path: "res://scenes/main.tscn", event_path: eventPath, id: "a" }),
    executor.execute(dir, "modify_node", { scene_path: "res://scene-alias/main.tscn", event_path: eventPath, id: "b" }),
  ]);

  assert.deepEqual((await fs.readFile(eventPath, "utf-8")).trim().split("\n"), [
    "start:a",
    "end:a",
    "start:b",
    "end:b",
  ]);
});

test("GodotExecutor allows mutations to different scenes concurrently", async (t) => {
  const dir = await createTempDir(t);
  const fakeGodotPath = path.join(dir, "fake-godot.mjs");
  const eventPath = path.join(dir, "events.log");
  await writeText(fakeGodotPath, `#!/usr/bin/env node
import fs from "node:fs";
const markerArgs = process.argv.slice(process.argv.indexOf('--') + 1);
const params = JSON.parse(markerArgs[1]);
fs.appendFileSync(params.event_path, 'start:' + params.id + '\\n');
setTimeout(() => {
  fs.appendFileSync(params.event_path, 'end:' + params.id + '\\n');
  process.stdout.write('[GODOT_MCP_RESULT:' + params.__mcp_result_token + ']');
  process.stdout.write('{"success":true,"message":"ok"}');
  process.stdout.write('[/GODOT_MCP_RESULT:' + params.__mcp_result_token + ']');
}, 100);
`);
  await fs.chmod(fakeGodotPath, 0o755);
  const executor = new GodotExecutor(fakeGodotPath);

  await Promise.all([
    executor.execute(dir, "add_node", { scene_path: "res://a.tscn", event_path: eventPath, id: "a" }),
    executor.execute(dir, "add_node", { scene_path: "res://b.tscn", event_path: eventPath, id: "b" }),
  ]);

  const events = (await fs.readFile(eventPath, "utf-8")).trim().split("\n");
  assert.ok(events.indexOf("start:b") < events.indexOf("end:a"));
  assert.ok(events.indexOf("start:a") < events.indexOf("end:b"));
});
