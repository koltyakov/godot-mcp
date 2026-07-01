import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

import { editScriptTool, readScriptTool } from "../src/tools/script-tools.js";
import { createGodotProject } from "./helpers.js";

test("editScriptTool writes scripts inside the project and readScriptTool reads them", async (t) => {
  const projectPath = await createGodotProject(t);
  const content = "extends Node\n\nfunc _ready():\n\tpass\n";

  const editResult = await editScriptTool.execute(
    {
      project_path: projectPath,
      script_path: "res://scripts/player.gd",
      content,
    },
    null
  );

  assert.deepEqual(editResult, {
    success: true,
    message: "Updated script at res://scripts/player.gd",
    script_path: "res://scripts/player.gd",
  });
  assert.equal(await fs.readFile(path.join(projectPath, "scripts", "player.gd"), "utf-8"), content);

  const readResult = await readScriptTool.execute(
    {
      project_path: projectPath,
      script_path: "scripts/player.gd",
    },
    null
  );

  assert.deepEqual(readResult, {
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
