import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

import type { GodotExecutor } from "../src/godot/executor.js";
import { getProjectInfoTool, initProjectTool, listScenesTool } from "../src/tools/project-tools.js";
import { createGodotProject, createTempDir, writeText } from "./helpers.js";

test("initProjectTool creates a project file and standard directories", async (t) => {
  const dir = await createTempDir(t);
  const projectPath = path.join(dir, "new-game");

  const result = await initProjectTool.execute(
    {
      project_path: projectPath,
      project_name: "Quoted \"Game\"",
      renderer: "mobile",
    },
    null
  );

  assert.deepEqual(result, {
    success: true,
    message: `Created new Godot project "Quoted \"Game\"" at ${projectPath}`,
    project_path: projectPath,
    created_directories: ["scenes", "scripts", "resources", "assets"],
  });

  const projectFile = await fs.readFile(path.join(projectPath, "project.godot"), "utf-8");
  assert.ok(projectFile.includes('config/name="Quoted \\"Game\\""'));
  assert.ok(projectFile.includes('renderer/rendering_method="mobile"'));

  for (const dirName of ["scenes", "scripts", "resources", "assets"]) {
    await assert.doesNotReject(fs.access(path.join(projectPath, dirName, ".gitkeep")));
  }
});

test("initProjectTool rejects unsupported renderers and existing projects", async (t) => {
  const dir = await createTempDir(t);
  await assert.rejects(
    initProjectTool.execute(
      {
        project_path: path.join(dir, "bad-renderer"),
        project_name: "Bad Renderer",
        renderer: "vulkan",
      },
      null
    ),
    /Invalid renderer: vulkan/
  );

  const existingProjectPath = await createGodotProject(t);
  await assert.rejects(
    initProjectTool.execute(
      {
        project_path: existingProjectPath,
        project_name: "Existing",
      },
      null
    ),
    /Project already exists/
  );
});

test("getProjectInfoTool reads project metadata and counts scenes/scripts", async (t) => {
  const projectPath = await createGodotProject(
    t,
    `config_version=5

[application]

config/name="Demo Project"
run/main_scene="res://scenes/main.tscn"
`
  );
  await writeText(path.join(projectPath, "scenes", "main.tscn"));
  await writeText(path.join(projectPath, "scenes", "other.scn"));
  await writeText(path.join(projectPath, "scripts", "player.gd"));
  await writeText(path.join(projectPath, "addons", "ignored.gd"));

  const executor = {
    getVersion: async () => "4.3.stable",
  } as GodotExecutor;

  const result = await getProjectInfoTool.execute({ project_path: projectPath }, executor);
  const realProjectPath = await fs.realpath(projectPath);

  assert.deepEqual(result, {
    project_name: "Demo Project",
    project_path: realProjectPath,
    main_scene: "res://scenes/main.tscn",
    scene_count: 2,
    script_count: 1,
    godot_version: "4.3.stable",
  });
});

test("listScenesTool lists scenes without requiring a Godot executor", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(path.join(projectPath, "scenes", "main.tscn"));

  const result = await listScenesTool.execute({ project_path: projectPath }, null);
  const realProjectPath = await fs.realpath(projectPath);

  assert.deepEqual(result, {
    project_path: realProjectPath,
    scenes: ["res://scenes/main.tscn"],
    count: 1,
  });
});
