import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

import {
  getProjectInfoTool,
  initProjectTool,
  listScenesTool,
  runProjectDiagnosticsTool,
} from "../src/tools/project-tools.js";
import { createGodotProject, createMockGodotExecutor, createTempDir, writeText } from "./helpers.js";

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

test("getProjectInfoTool reads project metadata and counts scenes/scripts through Godot", async (t) => {
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
  const realProjectPath = await fs.realpath(projectPath);

  const executor = createMockGodotExecutor(async (receivedProjectPath, operation, params) => {
    assert.equal(receivedProjectPath, realProjectPath);
    assert.equal(operation, "get_project_info");
    assert.deepEqual(params, {});

    return {
      success: true,
      output: "",
      data: {
        success: true,
        project_name: "Demo Project",
        project_path: realProjectPath,
        main_scene: "res://scenes/main.tscn",
        scene_count: 2,
        script_count: 1,
        godot_version: "4.3.stable",
      },
    };
  });

  const result = await getProjectInfoTool.execute({ project_path: projectPath }, executor);

  assert.deepEqual(result, {
    success: true,
    project_name: "Demo Project",
    project_path: realProjectPath,
    main_scene: "res://scenes/main.tscn",
    scene_count: 2,
    script_count: 1,
    godot_version: "4.3.stable",
  });
});

test("listScenesTool lists scenes without spawning Godot", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(path.join(projectPath, "scenes", "main.tscn"));
  const realProjectPath = await fs.realpath(projectPath);

  const executor = createMockGodotExecutor(async () => {
    throw new Error("Godot should not be spawned for scene inventory");
  });

  const result = await listScenesTool.execute({ project_path: projectPath }, executor);

  assert.deepEqual(result, {
    success: true,
    project_path: realProjectPath,
    scenes: ["res://scenes/main.tscn"],
    count: 1,
  });
});

test("runProjectDiagnosticsTool returns parsed runtime diagnostics", async (t) => {
  const projectPath = await createGodotProject(t);
  const realProjectPath = await fs.realpath(projectPath);
  let receivedPath = "";
  let receivedOptions: Record<string, unknown> = {};
  const executor = createMockGodotExecutor(
    async () => ({ success: true, output: "" }),
    {
      runProjectDiagnostics: async (pathValue, options) => {
        receivedPath = pathValue;
        receivedOptions = options;
        return {
          success: true,
          exitCode: 0,
          stdout: "Godot Engine\nSCRIPT ERROR: Invalid access to property 'health'\n  at: Player._ready (res://scripts/player.gd:42)",
          stderr: "",
          timedOut: false,
          truncated: false,
          durationMs: 125,
        };
      },
    }
  );

  const result = await runProjectDiagnosticsTool.execute(
    {
      project_path: projectPath,
      scene_path: "scenes/main.tscn",
      frames: 30,
      fixed_fps: 60,
      timeout_ms: 5000,
    },
    executor
  ) as Record<string, unknown>;

  assert.equal(receivedPath, realProjectPath);
  assert.deepEqual(receivedOptions, {
    scenePath: "res://scenes/main.tscn",
    frames: 30,
    fixedFps: 60,
    debug: true,
    timeoutMs: 5000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.exit_code, 0);
  assert.deepEqual(result.diagnostics, [{
    severity: "error",
    message: "Invalid access to property 'health'",
    file: "res://scripts/player.gd",
    line: 42,
  }]);
});

test("runProjectDiagnosticsTool validates execution bounds", async (t) => {
  const projectPath = await createGodotProject(t);
  const executor = createMockGodotExecutor(async () => ({ success: true, output: "" }));

  await assert.rejects(
    runProjectDiagnosticsTool.execute({ project_path: projectPath, frames: 0 }, executor),
    /frames must be an integer between 1 and 3600/
  );
});
