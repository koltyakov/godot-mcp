import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

import {
  findSceneFiles,
  findScriptFiles,
  invalidateProjectFileCatalog,
  isGodotProject,
  parseGodotProjectPathFromCommandLine,
  resolveOpenGodotProjectsFromProcesses,
} from "../src/godot/finder.js";
import { createGodotProject, createTempDir, writeText } from "./helpers.js";

test("isGodotProject requires a readable project.godot file", async (t) => {
  const dir = await createTempDir(t);

  assert.equal(await isGodotProject(dir), false);

  await writeText(path.join(dir, "project.godot"), "config_version=5\n");

  assert.equal(await isGodotProject(dir), true);
});

test("findSceneFiles returns resource paths and skips hidden/addons directories", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(path.join(projectPath, "scenes", "main.tscn"));
  await writeText(path.join(projectPath, "scenes", "legacy.scn"));
  await writeText(path.join(projectPath, ".hidden", "secret.tscn"));
  await writeText(path.join(projectPath, "addons", "plugin_scene.tscn"));
  await writeText(path.join(projectPath, "scenes", "notes.txt"));

  const scenes = await findSceneFiles(projectPath);

  assert.deepEqual(scenes.sort(), ["res://scenes/legacy.scn", "res://scenes/main.tscn"]);
});

test("findScriptFiles returns GDScript resource paths and skips ignored directories", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(path.join(projectPath, "scripts", "player.gd"));
  await writeText(path.join(projectPath, "scripts", "enemy.gd"));
  await writeText(path.join(projectPath, "scripts", "readme.md"));
  await writeText(path.join(projectPath, ".godot", "generated.gd"));
  await writeText(path.join(projectPath, "addons", "plugin.gd"));

  const scripts = await findScriptFiles(projectPath);

  assert.deepEqual(scripts.sort(), ["res://scripts/enemy.gd", "res://scripts/player.gd"]);
});

test("file search helpers return an empty list when scanning fails", async (t) => {
  const dir = await createTempDir(t);
  const missingPath = path.join(dir, "missing-project");

  assert.deepEqual(await findSceneFiles(missingPath), []);
  assert.deepEqual(await findScriptFiles(missingPath), []);
});

test("project file catalog is shared and can be invalidated after mutations", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(path.join(projectPath, "scenes", "main.tscn"));

  const [scenes, scripts] = await Promise.all([
    findSceneFiles(projectPath),
    findScriptFiles(projectPath),
  ]);
  assert.deepEqual(scenes, ["res://scenes/main.tscn"]);
  assert.deepEqual(scripts, []);

  await writeText(path.join(projectPath, "scripts", "player.gd"));
  assert.deepEqual(await findScriptFiles(projectPath), []);
  invalidateProjectFileCatalog(projectPath);
  assert.deepEqual(await findScriptFiles(projectPath), ["res://scripts/player.gd"]);
});

test("parseGodotProjectPathFromCommandLine handles Godot path arguments", () => {
  assert.equal(
    parseGodotProjectPathFromCommandLine('/Applications/Godot.app/Contents/MacOS/Godot --editor --path "/Users/me/My Game"'),
    "/Users/me/My Game"
  );
  assert.equal(parseGodotProjectPathFromCommandLine("godot4 --path=/tmp/demo"), "/tmp/demo");
  assert.equal(parseGodotProjectPathFromCommandLine("godot C:\\Games\\demo\\project.godot"), "C:\\Games\\demo");
});

test("resolveOpenGodotProjectsFromProcesses returns named open projects", async (t) => {
  const dir = await createTempDir(t);
  const firstProjectPath = path.join(dir, "First Game");
  const secondProjectPath = path.join(dir, "second-game");
  await writeText(
    path.join(firstProjectPath, "project.godot"),
    `config_version=5

[application]

config/name="First Game"
`
  );
  await writeText(
    path.join(secondProjectPath, "project.godot"),
    `config_version=5

[application]

config/name="Second Game"
`
  );

  const projects = await resolveOpenGodotProjectsFromProcesses([
    {
      pid: 100,
      commandLine: `/Applications/Godot.app/Contents/MacOS/Godot --editor --path "${firstProjectPath}"`,
    },
    {
      pid: 101,
      commandLine: "/usr/bin/godot4 --editor",
      cwd: secondProjectPath,
    },
    {
      pid: 102,
      commandLine: `/Applications/Godot.app/Contents/MacOS/Godot --path "${firstProjectPath}"`,
    },
    {
      pid: 103,
      commandLine: `/Applications/Godot.app/Contents/MacOS/Godot --headless --path "${firstProjectPath}" -s res://batch.gd`,
    },
  ]);
  const realFirstProjectPath = await fs.realpath(firstProjectPath);
  const realSecondProjectPath = await fs.realpath(secondProjectPath);

  assert.deepEqual(projects, [
    {
      project_name: "First Game",
      project_path: realFirstProjectPath,
      process_ids: [100, 102],
    },
    {
      project_name: "Second Game",
      project_path: realSecondProjectPath,
      process_ids: [101],
    },
  ]);
});
