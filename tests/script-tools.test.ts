import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { editScriptTool, readScriptTool } from "../src/tools/script-tools.js";
import { createGodotProject, createMockGodotExecutor } from "./helpers.js";

test("editScriptTool and readScriptTool process scripts through Godot", async (t) => {
  const projectPath = await createGodotProject(t);
  const content = "extends Node\n\nfunc _ready():\n\tpass\n";
  const scripts = new Map<string, string>();
  const executor = createMockGodotExecutor(async (_projectPath, operation, params) => {
    if (operation === "edit_script") {
      assert.deepEqual(params, {
        script_path: "res://scripts/player.gd",
        content,
      });
      scripts.set(params.script_path as string, params.content as string);

      return {
        success: true,
        output: "",
        data: {
          success: true,
          message: "Updated script at res://scripts/player.gd",
          script_path: "res://scripts/player.gd",
        },
      };
    }

    if (operation === "read_script") {
      assert.deepEqual(params, {
        script_path: "res://scripts/player.gd",
      });
      const storedContent = scripts.get(params.script_path as string) ?? "";

      return {
        success: true,
        output: "",
        data: {
          success: true,
          script_path: "res://scripts/player.gd",
          content: storedContent,
          line_count: storedContent.split("\n").length,
        },
      };
    }

    return { success: false, output: "", error: `Unexpected operation: ${operation}` };
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
  const executor = createMockGodotExecutor(async (_projectPath, operation) => {
    assert.equal(operation, "read_script");
    return {
      success: false,
      output: "",
      error: "Failed to read script: res://scripts/missing.gd",
    };
  });

  await assert.rejects(
    readScriptTool.execute(
      {
        project_path: projectPath,
        script_path: "res://scripts/missing.gd",
      },
      executor
    ),
    /Failed to read script:/
  );
});
