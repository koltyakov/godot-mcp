import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

import {
  getClassInfoTool,
  checkScriptTool,
  getProjectSettingsTool,
  setProjectSettingTool,
  listAutoloadsTool,
  setAutoloadTool,
  removeAutoloadTool,
  listInputActionsTool,
} from "../src/tools/project-config-tools.js";
import { exportProjectTool, listExportPresetsTool, readProjectFileTool } from "../src/tools/build-tools.js";
import { createGodotProject, createMockGodotExecutor, createTempDir, writeText } from "./helpers.js";

test("get_class_info dispatches to classdb_info with class and include", async (t) => {
  const projectPath = await createGodotProject(t);
  const executor = createMockGodotExecutor(async (_p, op, params) => {
    assert.equal(op, "classdb_info");
    assert.equal(params.class, "Sprite2D");
    assert.deepEqual(params.include, ["methods", "properties"]);
    return { success: true, output: "", data: { success: true, class: { name: "Sprite2D" } } };
  });
  const result = await getClassInfoTool.execute(
    { project_path: projectPath, class: "Sprite2D", include: ["methods", "properties"] },
    executor
  );
  assert.deepEqual(result, { success: true, class: { name: "Sprite2D" } });
});

test("get_class_info is annotated read-only", () => {
  assert.equal(getClassInfoTool.definition.annotations?.readOnlyHint, true);
});

test("check_script requires source or script_path", async (t) => {
  const projectPath = await createGodotProject(t);
  const executor = createMockGodotExecutor(async () => ({ success: true, output: "", data: {} }));
  await assert.rejects(
    checkScriptTool.execute({ project_path: projectPath }, executor),
    /Provide 'source'.*script_path/
  );
});

test("check_script dispatches with source and script_path", async (t) => {
  const projectPath = await createGodotProject(t);
  const executor = createMockGodotExecutor(async (_p, op, params) => {
    assert.equal(op, "compile_script");
    assert.equal(params.source, "extends Node\n");
    assert.equal(params.script_path, "");
    return { success: true, output: "", data: { success: true, ok: true, errors: [], warnings: [] } };
  });
  const result = await checkScriptTool.execute(
    { project_path: projectPath, source: "extends Node\n" },
    executor
  );
  assert.equal((result as { ok: boolean }).ok, true);
});

test("check_script normalizes script_path when validating an existing file", async (t) => {
  const projectPath = await createGodotProject(t);
  let received: Record<string, unknown> = {};
  const executor = createMockGodotExecutor(async (_p, op, params) => {
    assert.equal(op, "compile_script");
    received = params;
    return { success: true, output: "", data: { success: true, ok: true } };
  });

  await checkScriptTool.execute({ project_path: projectPath, script_path: "scripts/player.gd" }, executor);

  assert.equal(received.script_path, "res://scripts/player.gd");
});

test("get_project_settings, set_project_setting, list_autoloads, set_autoload, remove_autoload dispatch correctly", async (t) => {
  const projectPath = await createGodotProject(t);
  const calls: Array<{ op: string; params: Record<string, unknown> }> = [];
  const executor = createMockGodotExecutor(async (_p, op, params) => {
    calls.push({ op, params });
    return { success: true, output: "", data: { success: true, ok: true } };
  });

  await getProjectSettingsTool.execute({ project_path: projectPath, section: "rendering" }, executor);
  await setProjectSettingTool.execute(
    { project_path: projectPath, section: "application", key: "config/name", value: "Demo" },
    executor
  );
  await listAutoloadsTool.execute({ project_path: projectPath }, executor);
  await setAutoloadTool.execute(
    { project_path: projectPath, name: "Globals", path: "globals.gd" },
    executor
  );
  await removeAutoloadTool.execute({ project_path: projectPath, name: "Globals" }, executor);

  assert.equal(calls[0].op, "get_project_settings");
  assert.equal(calls[0].params.section, "rendering");
  assert.equal(calls[1].op, "set_project_setting");
  assert.equal(calls[1].params.value, "Demo");
  assert.equal(calls[2].op, "list_autoloads");
  assert.equal(calls[3].op, "set_autoload");
  assert.equal(calls[3].params.singleton, true);
  assert.equal(calls[3].params.path, "res://globals.gd");
  assert.equal(calls[4].op, "remove_autoload");
});

test("set_autoload honors singleton=false", async (t) => {
  const projectPath = await createGodotProject(t);
  let received: Record<string, unknown> = {};
  const executor = createMockGodotExecutor(async (_p, _op, params) => {
    received = params;
    return { success: true, output: "", data: { success: true } };
  });
  await setAutoloadTool.execute(
    { project_path: projectPath, name: "Helper", path: "res://helper.gd", singleton: false },
    executor
  );
  assert.equal(received.singleton, false);
});

test("set_autoload rejects unsupported resource paths", async (t) => {
  const projectPath = await createGodotProject(t);
  const executor = createMockGodotExecutor(async () => ({ success: true, output: "", data: { success: true } }));

  await assert.rejects(
    setAutoloadTool.execute(
      { project_path: projectPath, name: "Bad", path: "res://data/config.tres" },
      executor
    ),
    /path must end with .gd or .tscn or .scn/
  );
});

test("list_input_actions dispatches with include_builtin flag", async (t) => {
  const projectPath = await createGodotProject(t);
  let received: Record<string, unknown> = {};
  const executor = createMockGodotExecutor(async (_p, _op, params) => {
    received = params;
    return { success: true, output: "", data: { success: true, actions: [] } };
  });
  await listInputActionsTool.execute({ project_path: projectPath, include_builtin: true }, executor);
  assert.equal(received.include_builtin, true);
});

test("all new project-config tools carry correct annotations", () => {
  assert.equal(getClassInfoTool.definition.annotations?.readOnlyHint, true);
  assert.equal(checkScriptTool.definition.annotations?.readOnlyHint, true);
  assert.equal(getProjectSettingsTool.definition.annotations?.readOnlyHint, true);
  assert.equal(listAutoloadsTool.definition.annotations?.readOnlyHint, true);
  assert.equal(listInputActionsTool.definition.annotations?.readOnlyHint, true);

  assert.equal(setProjectSettingTool.definition.annotations?.destructiveHint, true);
  assert.equal(setAutoloadTool.definition.annotations?.destructiveHint, true);
  assert.equal(removeAutoloadTool.definition.annotations?.destructiveHint, true);
});

test("list_export_presets parses export_presets.cfg without spawning Godot", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(
    path.join(projectPath, "export_presets.cfg"),
    [
      `[preset.0]`,
      ``,
      `name="Windows Desktop"`,
      `platform="Windows Desktop"`,
      `runnable=true`,
      `export_file="builds/win/game.exe"`,
      ``,
      `[preset.1]`,
      ``,
      `name="Web"`,
      `platform="Web"`,
      `runnable=true`,
      `export_file="builds/web/index.html"`,
      ``,
      ``,
    ].join("\n")
  );

  const result = (await listExportPresetsTool.execute({ project_path: projectPath }, null)) as {
    presets: Array<{ name: string; platform: string; runnable: boolean; export_path: string | null }>;
    count: number;
  };

  assert.equal(result.count, 2);
  assert.equal(result.presets[0].name, "Windows Desktop");
  assert.equal(result.presets[0].platform, "Windows Desktop");
  assert.equal(result.presets[0].runnable, true);
  assert.equal(result.presets[0].export_path, "builds/win/game.exe");
  assert.equal(result.presets[1].name, "Web");
});

test("list_export_presets returns empty when no config exists", async (t) => {
  const projectPath = await createGodotProject(t);
  const result = (await listExportPresetsTool.execute({ project_path: projectPath }, null)) as {
    presets: unknown[];
    count: number;
  };
  assert.equal(result.count, 0);
  assert.deepEqual(result.presets, []);
});

test("export_project normalizes relative output paths and rejects traversal", async (t) => {
  const projectPath = await createGodotProject(t);
  const realProjectPath = await fs.realpath(projectPath);
  const executor = createMockGodotExecutor(async () => ({ success: true, output: "" }));
  let receivedArgs: string[] = [];
  executor.executeRaw = async (args) => {
    receivedArgs = args;
    return { success: true, output: "" };
  };

  await exportProjectTool.execute(
    { project_path: projectPath, preset: "Web", output_path: "builds/web/index.html" },
    executor
  );

  assert.equal(receivedArgs[5], path.join(realProjectPath, "builds", "web", "index.html"));

  await assert.rejects(
    exportProjectTool.execute(
      { project_path: projectPath, preset: "Web", output_path: "../outside.html" },
      executor
    ),
    /output_path escapes project directory/
  );
});

test("read_project_file reads a file inside the project and refuses traversal", async (t) => {
  const projectPath = await createGodotProject(t);
  await fs.writeFile(path.join(projectPath, "notes.txt"), "hello\n", "utf-8");

  const ok = (await readProjectFileTool.execute(
    { project_path: projectPath, file_path: "notes.txt" },
    null
  )) as { content: string; size: number };
  assert.equal(ok.content, "hello\n");
  assert.equal(ok.size, 6);

  await assert.rejects(
    readProjectFileTool.execute(
      { project_path: projectPath, file_path: "res://../escape.txt" },
      null
    ),
    /escapes project directory|res:\/\//
  );
});

test("read_project_file refuses symlinks that resolve outside the project", async (t) => {
  const projectPath = await createGodotProject(t);
  const outsideDir = await createTempDir(t);
  const outsideFile = path.join(outsideDir, "secret.txt");
  await fs.writeFile(outsideFile, "secret", "utf-8");
  await fs.symlink(outsideFile, path.join(projectPath, "linked-secret.txt"));

  await assert.rejects(
    readProjectFileTool.execute(
      { project_path: projectPath, file_path: "linked-secret.txt" },
      null
    ),
    /file_path escapes project directory/
  );
});
