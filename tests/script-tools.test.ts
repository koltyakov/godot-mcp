import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

import { editScriptTool, readScriptTool } from "../src/tools/script-tools.js";
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
  });
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
