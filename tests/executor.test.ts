import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

import { GodotExecutor } from "../src/godot/executor.js";
import { runWithExecutionContext } from "../src/execution-context.js";
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
const markerArgs = process.argv.slice(process.argv.indexOf('--') + 1);
const params = JSON.parse((await import('node:fs')).readFileSync(markerArgs[2], 'utf8'));
process.stdout.write('ignored before\\n');
process.stdout.write('[GODOT_MCP_RESULT:spoofed]{"success":true,"output":"spoofed"}[/GODOT_MCP_RESULT:spoofed]');
process.stdout.write('[GODOT_MCP_RESULT:' + params.__mcp_result_token + ']{"success":true,"output":"created scene"}[/GODOT_MCP_RESULT:' + params.__mcp_result_token + ']');
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

test("execute rejects successful processes without a valid result marker", async (t) => {
  const dir = await createTempDir(t);
  const fakeGodotPath = path.join(dir, "fake-godot.mjs");
  await writeText(fakeGodotPath, "#!/usr/bin/env node\nprocess.stdout.write('operation exited early');\n");
  await fs.chmod(fakeGodotPath, 0o755);

  const result = await new GodotExecutor(fakeGodotPath).execute(dir, "create_scene");

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /did not return a valid result marker/);
});

test("execute requires both a successful marker and process exit", async (t) => {
  const dir = await createTempDir(t);
  const fakeGodotPath = path.join(dir, "fake-godot.mjs");
  await writeText(
    fakeGodotPath,
    `#!/usr/bin/env node
const markerArgs = process.argv.slice(process.argv.indexOf('--') + 1);
const params = JSON.parse((await import('node:fs')).readFileSync(markerArgs[2], 'utf8'));
process.stdout.write('[GODOT_MCP_RESULT:' + params.__mcp_result_token + ']');
process.stdout.write('{"success":true,"output":"saved"}');
process.stdout.write('[/GODOT_MCP_RESULT:' + params.__mcp_result_token + ']');
process.exit(2);
`
  );
  await fs.chmod(fakeGodotPath, 0o755);

  const result = await new GodotExecutor(fakeGodotPath).execute(dir, "create_scene");

  assert.equal(result.success, false);
  assert.equal(result.output, "saved");
  assert.match(result.error ?? "", /exited with code 2/);
});

test("execute rejects result markers with an invalid success type", async (t) => {
  const dir = await createTempDir(t);
  const fakeGodotPath = path.join(dir, "fake-godot.mjs");
  await writeText(
    fakeGodotPath,
    `#!/usr/bin/env node
const markerArgs = process.argv.slice(process.argv.indexOf('--') + 1);
const params = JSON.parse((await import('node:fs')).readFileSync(markerArgs[2], 'utf8'));
process.stdout.write('[GODOT_MCP_RESULT:' + params.__mcp_result_token + ']');
process.stdout.write('{"success":"false","output":"not saved"}');
process.stdout.write('[/GODOT_MCP_RESULT:' + params.__mcp_result_token + ']');
`
  );
  await fs.chmod(fakeGodotPath, 0o755);

  const result = await new GodotExecutor(fakeGodotPath).execute(dir, "create_scene");

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /malformed result JSON/);
});

test("runProjectDiagnostics builds a bounded headless command", async (t) => {
  const dir = await createTempDir(t);
  const fakeGodotPath = path.join(dir, "fake-godot.mjs");
  await writeText(
    fakeGodotPath,
    "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n"
  );
  await fs.chmod(fakeGodotPath, 0o755);

  const result = await new GodotExecutor(fakeGodotPath).runProjectDiagnostics(dir, {
    scenePath: "res://scenes/main.tscn",
    frames: 30,
    fixedFps: 60,
    debug: true,
    timeoutMs: 5000,
  });

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(result.stdout), [
    "--headless",
    "--path",
    dir,
    "--debug",
    "--fixed-fps",
    "60",
    "--quit-after",
    "30",
    "res://scenes/main.tscn",
  ]);
});

test("executeRaw reports timeout failures", async () => {
  const executor = new GodotExecutor(process.execPath);

  const result = await executor.executeRaw(["-e", "setTimeout(() => {}, 10_000)"], undefined, 50);

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /timed out after 50ms/);
});

test("executeRaw terminates a running process when its MCP request is cancelled", async () => {
  const executor = new GodotExecutor(process.execPath);
  const controller = new AbortController();
  const pending = runWithExecutionContext({ signal: controller.signal }, () =>
    executor.executeRaw(["-e", "setInterval(() => {}, 1000)"], undefined, 5000)
  );

  setTimeout(() => controller.abort(), 50);
  const result = await pending;
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /cancelled/i);
});

test("execute passes parameters through a temporary request file and removes it", async (t) => {
  const dir = await createTempDir(t);
  const fakeGodotPath = path.join(dir, "fake-godot.mjs");
  const requestLogPath = path.join(dir, "request-path.txt");
  await writeText(fakeGodotPath, `#!/usr/bin/env node
import fs from 'node:fs';
const markerArgs = process.argv.slice(process.argv.indexOf('--') + 1);
const params = JSON.parse(fs.readFileSync(markerArgs[2], 'utf8'));
fs.writeFileSync(${JSON.stringify(requestLogPath)}, markerArgs[2]);
process.stdout.write('[GODOT_MCP_RESULT:' + params.__mcp_result_token + ']');
process.stdout.write('{"success":true,"message":"ok"}');
process.stdout.write('[/GODOT_MCP_RESULT:' + params.__mcp_result_token + ']');
`);
  await fs.chmod(fakeGodotPath, 0o755);

  const result = await new GodotExecutor(fakeGodotPath).execute(dir, "create_scene", {
    scene_path: "res://main.tscn",
    content: "large or secret payload",
  });
  const requestPath = await fs.readFile(requestLogPath, "utf-8");

  assert.equal(result.success, true);
  assert.equal(path.basename(requestPath), "request.json");
  await assert.rejects(fs.access(requestPath));
});

test("launchEditor reports immediate process exits", async (t) => {
  const dir = await createTempDir(t);
  const executor = new GodotExecutor(process.execPath);

  const result = await executor.launchEditor(dir);

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /exited immediately/);
  assert.equal(typeof result.pid, "number");
});
