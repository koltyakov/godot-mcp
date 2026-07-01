import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

import { GodotExecutor } from "../src/godot/executor.js";
import { createTempDir, writeText } from "./helpers.js";

test("executeRaw captures stdout and successful exit status", async () => {
  const executor = new GodotExecutor(process.execPath);

  const result = await executor.executeRaw(["-e", "process.stdout.write('hello')"]);

  assert.deepEqual(result, {
    success: true,
    output: "hello",
    error: undefined,
  });
});

test("executeRaw surfaces stderr when a command fails", async () => {
  const executor = new GodotExecutor(process.execPath);

  const result = await executor.executeRaw([
    "-e",
    "process.stdout.write('partial'); process.stderr.write('boom'); process.exit(2)",
  ]);

  assert.deepEqual(result, {
    success: false,
    output: "partial",
    error: "boom",
  });
});

test("execute parses Godot MCP result markers from process output", async (t) => {
  const dir = await createTempDir(t);
  const fakeGodotPath = path.join(dir, "fake-godot.mjs");
  await writeText(
    fakeGodotPath,
    `#!/usr/bin/env node
process.stdout.write('ignored before\\n');
process.stdout.write('[GODOT_MCP_RESULT]{"success":true,"output":"created scene"}[/GODOT_MCP_RESULT]');
process.stdout.write('\\nignored after');
`
  );
  await fs.chmod(fakeGodotPath, 0o755);

  const executor = new GodotExecutor(fakeGodotPath);
  const result = await executor.execute(dir, "create_scene", { scene_path: "res://main.tscn" });

  assert.deepEqual(result, {
    success: true,
    output: "created scene",
    error: undefined,
  });
});
