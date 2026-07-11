import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";

import { editScriptTool, readScriptTool } from "../src/tools/script-tools.js";
import { executeTool } from "../src/tools/index.js";
import { createGodotProject, createMockGodotExecutor, createTempDir } from "./helpers.js";

test("editScriptTool and readScriptTool use the filesystem without spawning Godot", async (t) => {
  const projectPath = await createGodotProject(t);
  const content = "extends Node\n\nfunc _ready():\n\tpass\n";
  const executor = createMockGodotExecutor(async () => {
    throw new Error("Godot should not be spawned for script filesystem operations");
  });

  const editResult = await editScriptTool.execute(
    {
      project_path: projectPath,
      script_path: "res://scripts/player.gd",
      content,
    },
    executor
  );

  assert.deepEqual(editResult, {
    success: true,
    message: "Updated script at res://scripts/player.gd",
    script_path: "res://scripts/player.gd",
    sha256: createHash("sha256").update(content).digest("hex"),
  });

  const readResult = await readScriptTool.execute(
    {
      project_path: projectPath,
      script_path: "scripts/player.gd",
    },
    executor
  );

  assert.deepEqual(readResult, {
    success: true,
    script_path: "res://scripts/player.gd",
    content,
    line_count: 5,
    sha256: createHash("sha256").update(content).digest("hex"),
  });
});

test("editScriptTool rejects stale expected_sha256 values", async (t) => {
  const projectPath = await createGodotProject(t);
  const scriptPath = path.join(projectPath, "player.gd");
  await fs.writeFile(scriptPath, "extends Node\n");
  await assert.rejects(
    editScriptTool.execute({
      project_path: projectPath,
      script_path: "res://player.gd",
      content: "extends Node2D\n",
      expected_sha256: "0".repeat(64),
    }, null),
    /Script changed since it was read/
  );
  assert.equal(await fs.readFile(scriptPath, "utf-8"), "extends Node\n");
});

test("readScriptTool hashes the exact file bytes", async (t) => {
  const projectPath = await createGodotProject(t);
  const bytes = Buffer.from([0x65, 0x78, 0x74, 0x65, 0x6e, 0x64, 0x73, 0x20, 0xff, 0x0a]);
  await fs.writeFile(path.join(projectPath, "player.gd"), bytes);

  const result = await readScriptTool.execute({
    project_path: projectPath,
    script_path: "res://player.gd",
  }, null) as Record<string, unknown>;

  assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
});

test("executeTool serializes script edits using the same expected hash", async (t) => {
  const projectPath = await createGodotProject(t);
  const scriptPath = path.join(projectPath, "player.gd");
  const initialContent = "extends Node\n";
  await fs.writeFile(scriptPath, initialContent);
  const expectedSha256 = createHash("sha256").update(initialContent).digest("hex");

  const results = await Promise.allSettled([
    executeTool("edit_script", {
      project_path: projectPath,
      script_path: "res://player.gd",
      content: "extends Node2D\n",
      expected_sha256: expectedSha256,
    }, null),
    executeTool("edit_script", {
      project_path: projectPath,
      script_path: "res://player.gd",
      content: "extends Control\n",
      expected_sha256: expectedSha256,
    }, null),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.match(await fs.readFile(scriptPath, "utf-8"), /^extends (Node2D|Control)\n$/);
});

test("script tools reject absolute paths and project traversal", async (t) => {
  const projectPath = await createGodotProject(t);

  await assert.rejects(
    editScriptTool.execute(
      {
        project_path: projectPath,
        script_path: path.join(projectPath, "scripts", "absolute.gd"),
        content: "extends Node\n",
      },
      null
    ),
    /script_path must be relative to the project or use res:\/\//
  );

  await assert.rejects(
    readScriptTool.execute(
      {
        project_path: projectPath,
        script_path: "res://../outside.gd",
      },
      null
    ),
    /script_path escapes project directory/
  );
});

test("readScriptTool reports missing files as read failures", async (t) => {
  const projectPath = await createGodotProject(t);

  await assert.rejects(
    readScriptTool.execute(
      {
        project_path: projectPath,
        script_path: "res://scripts/missing.gd",
      },
      null
    ),
    /Failed to read script:/
  );
});

test("editScriptTool refuses parent symlinks that escape the project", async (t) => {
  const projectPath = await createGodotProject(t);
  const outsidePath = await createTempDir(t);
  await fs.symlink(outsidePath, path.join(projectPath, "linked"));

  await assert.rejects(
    editScriptTool.execute({
      project_path: projectPath,
      script_path: "res://linked/nested/player.gd",
      content: "extends Node\n",
    }, null),
    /escapes project directory/
  );
  await assert.rejects(fs.access(path.join(outsidePath, "nested")));
});

test("editScriptTool preserves existing file permissions", { skip: process.platform === "win32" }, async (t) => {
  const projectPath = await createGodotProject(t);
  const scriptPath = path.join(projectPath, "scripts", "tool.gd");
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.writeFile(scriptPath, "extends Node\n", { mode: 0o764 });
  await fs.chmod(scriptPath, 0o764);

  await editScriptTool.execute({
    project_path: projectPath,
    script_path: "res://scripts/tool.gd",
    content: "extends Node2D\n",
  }, null);

  assert.equal((await fs.stat(scriptPath)).mode & 0o777, 0o764);
});
