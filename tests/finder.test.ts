import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { findSceneFiles, findScriptFiles, isGodotProject } from "../src/godot/finder.js";
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
