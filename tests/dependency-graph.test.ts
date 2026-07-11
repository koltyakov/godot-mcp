import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

import { buildDependencyReport, findUsages, invalidateDependencyGraph } from "../src/dependency-graph.js";
import { createGodotProject, createTempDir, writeText } from "./helpers.js";

test("buildDependencyReport scans scenes/scripts/resources/shaders and classifies them", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(`${projectPath}/scenes/main.tscn`, `[gd_scene format=3]\n`);
  await writeText(`${projectPath}/scenes/player.tscn`, `[gd_scene format=3]\n`);
  await writeText(`${projectPath}/scripts/player.gd`, `extends Node\n`);
  await writeText(`${projectPath}/resources/health.tres`, `[gd_resource type="Resource"]\n`);
  await writeText(`${projectPath}/shaders/water.gdshader`, `shader_type canvas_item;\n`);
  // Should be ignored:
  await writeText(`${projectPath}/addons/ignored/should_be_ignored.tscn`, `[gd_scene]\n`);
  await writeText(`${projectPath}/.godot/also_ignored.gd`, `extends Node\n`);
  await writeText(`${projectPath}/notes.txt`, `irrelevant\n`);

  const report = await buildDependencyReport({ project_path: projectPath });

  assert.equal(report.counts.scenes, 2);
  assert.equal(report.counts.scripts, 1);
  assert.equal(report.counts.resources, 1);
  assert.equal(report.counts.shaders, 1);
  assert.equal(report.counts.other, 0);

  for (const p of Object.keys(report.nodes)) {
    assert.ok(p.startsWith("res://"), `node ${p} should be a res:// path`);
  }
});

test("buildDependencyReport extracts ext_resource references from scenes and resources", async (t) => {
  const projectPath = await createGodotProject(t);
  // main.tscn depends on player.tscn and player.gd
  await writeText(
    `${projectPath}/scenes/main.tscn`,
    [
      `[gd_scene load_steps=3 format=3]`,
      `[ext_resource type="PackedScene" path="res://scenes/player.tscn" id="1"]`,
      `[ext_resource type="Script" path="res://scripts/player.gd" id="2"]`,
      `[node name="Root" type="Node2D"]`,
    ].join("\n") + "\n"
  );
  await writeText(`${projectPath}/scenes/player.tscn`, `[gd_scene format=3]\n[node name="Player" type="Node2D"]\n`);
  await writeText(`${projectPath}/scripts/player.gd`, `extends Node2D\n`);
  await writeText(
    `${projectPath}/resources/health.tres`,
    `[gd_resource type="Resource"]\n[resource]\nscript = ExtResource("1")\n`
  );

  const report = await buildDependencyReport({ project_path: projectPath });

  const main = report.nodes["res://scenes/main.tscn"];
  assert.ok(main, "main.tscn should be in the graph");
  assert.ok(
    main.dependsOn.includes("res://scenes/player.tscn"),
    `main.tscn depends on player.tscn; got ${JSON.stringify(main.dependsOn)}`
  );
  assert.ok(
    main.dependsOn.includes("res://scripts/player.gd"),
    `main.tscn depends on player.gd; got ${JSON.stringify(main.dependsOn)}`
  );

  // Reverse references should populate referencedBy.
  const player = report.nodes["res://scenes/player.tscn"];
  assert.deepEqual(player.referencedBy, ["res://scenes/main.tscn"]);
  const script = report.nodes["res://scripts/player.gd"];
  assert.deepEqual(script.referencedBy, ["res://scenes/main.tscn"]);
});

test("buildDependencyReport extracts load()/preload() references from scripts and surfaces class_name", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(
    `${projectPath}/scripts/inventory.gd`,
    [
      `class_name Inventory`,
      `extends Node`,
      ``,
      `const DEFAULT_ITEM := preload("res://resources/default_item.tres")`,
      ``,
      `func add(path: String) -> void:`,
      `    var res = load("res://resources/health.tres")`,
      `    var scene = load("res://scenes/item.tscn")`,
    ].join("\n") + "\n"
  );
  await writeText(`${projectPath}/resources/default_item.tres`, `[gd_resource type="Resource"]\n`);
  await writeText(`${projectPath}/resources/health.tres`, `[gd_resource type="Resource"]\n`);
  await writeText(`${projectPath}/scenes/item.tscn`, `[gd_scene format=3]\n`);

  const report = await buildDependencyReport({ project_path: projectPath });

  const inv = report.nodes["res://scripts/inventory.gd"];
  assert.equal(inv.className, "Inventory");
  assert.ok(inv.dependsOn.includes("res://resources/default_item.tres"));
  assert.ok(inv.dependsOn.includes("res://resources/health.tres"));
  assert.ok(inv.dependsOn.includes("res://scenes/item.tscn"));
});

test("orphans list contains assets with no inbound references", async (t) => {
  const projectPath = await createGodotProject(t);
  // a.gd references b.gd; c.gd references nothing and is referenced by nothing.
  await writeText(`${projectPath}/scripts/a.gd`, `extends Node\nvar b = preload("res://scripts/b.gd")\n`);
  await writeText(`${projectPath}/scripts/b.gd`, `extends Node\n`);
  await writeText(`${projectPath}/scripts/c.gd`, `extends Node\n`);

  const report = await buildDependencyReport({ project_path: projectPath });

  // a.gd and c.gd have no inbound refs; b.gd does.
  assert.ok(report.orphans.includes("res://scripts/a.gd"));
  assert.ok(report.orphans.includes("res://scripts/c.gd"));
  assert.ok(!report.orphans.includes("res://scripts/b.gd"));
});

test("findUsages returns the reverse-reference list for a given target", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(
    `${projectPath}/scenes/level1.tscn`,
    `[ext_resource type="PackedScene" path="res://scenes/enemy.tscn" id="1"]\n`
  );
  await writeText(
    `${projectPath}/scenes/level2.tscn`,
    `[ext_resource type="PackedScene" path="res://scenes/enemy.tscn" id="1"]\n`
  );
  await writeText(`${projectPath}/scenes/enemy.tscn`, `[gd_scene]\n`);

  const report = await buildDependencyReport({ project_path: projectPath });
  const usages = findUsages(report, "res://scenes/enemy.tscn");
  assert.equal(usages.exists, true);
  assert.deepEqual(usages.referencedBy.sort(), ["res://scenes/level1.tscn", "res://scenes/level2.tscn"]);
});

test("findUsages normalizes a relative target path to res://", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(
    `${projectPath}/scenes/level.tscn`,
    `[ext_resource type="PackedScene" path="res://scenes/enemy.tscn" id="1"]\n`
  );
  await writeText(`${projectPath}/scenes/enemy.tscn`, `[gd_scene]\n`);

  const report = await buildDependencyReport({ project_path: projectPath });
  const usages = findUsages(report, "scenes/enemy.tscn");
  assert.equal(usages.target, "res://scenes/enemy.tscn");
  assert.deepEqual(usages.referencedBy, ["res://scenes/level.tscn"]);
});

test("buildDependencyReport handles a project with no assets", async (t) => {
  const projectPath = await createGodotProject(t);
  const report = await buildDependencyReport({ project_path: projectPath });
  assert.deepEqual(report.counts, { scenes: 0, scripts: 0, resources: 0, shaders: 0, other: 0 });
  assert.deepEqual(report.orphans, []);
});

test("dependency graph resolves source-relative paths and project entrypoints", async (t) => {
  const projectPath = await createGodotProject(t, `config_version=5

[application]
run/main_scene="res://scenes/main.tscn"
`);
  await writeText(path.join(projectPath, "scenes", "main.tscn"), '[ext_resource type="Script" path="../scripts/player.gd" id="1"]\n');
  await writeText(path.join(projectPath, "scripts", "player.gd"), 'extends Node\nconst Missing = preload("res://missing.tres")\n');

  const report = await buildDependencyReport({ project_path: projectPath });
  assert.deepEqual(report.nodes["res://scenes/main.tscn"].dependsOn, ["res://scripts/player.gd"]);
  assert.ok(report.nodes["res://scenes/main.tscn"].referencedBy.includes("res://project.godot"));
  assert.deepEqual(findUsages(report, "res://missing.tres").referencedBy, ["res://scripts/player.gd"]);
});

test("dependency graph extracts shader includes", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(path.join(projectPath, "shaders", "main.gdshader"), '#include "common.gdshaderinc"\n');
  await writeText(path.join(projectPath, "shaders", "common.gdshaderinc"), "// common\n");

  const report = await buildDependencyReport({ project_path: projectPath });
  assert.deepEqual(report.nodes["res://shaders/main.gdshader"].dependsOn, ["res://shaders/common.gdshaderinc"]);
});

test("dependency parsing cache observes changed file metadata", async (t) => {
  invalidateDependencyGraph();
  const projectPath = await createGodotProject(t);
  const scriptPath = path.join(projectPath, "scripts", "player.gd");
  await writeText(scriptPath, 'extends Node\nconst A = preload("res://a.tres")\n');
  let report = await buildDependencyReport({ project_path: projectPath });
  assert.deepEqual(report.nodes["res://scripts/player.gd"].dependsOn, ["res://a.tres"]);

  await new Promise((resolve) => setTimeout(resolve, 5));
  await writeText(scriptPath, 'extends Node\nconst B = preload("res://longer-name.tres")\n');
  report = await buildDependencyReport({ project_path: projectPath });
  assert.deepEqual(report.nodes["res://scripts/player.gd"].dependsOn, ["res://longer-name.tres"]);
});

test("dependency report exposes explicit completeness warnings", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(path.join(projectPath, "binary.res"), "binary-placeholder");
  await writeText(path.join(projectPath, "script.gd"), 'extends Node\nconst X = preload("uid://abc123")\n');
  await writeText(path.join(projectPath, "addons", "plugin.gd"), "extends EditorPlugin\n");

  const report = await buildDependencyReport({ project_path: projectPath });
  assert.equal(report.complete, false);
  assert.ok(report.warnings.some((warning) => warning.includes("Opaque binary")));
  assert.ok(report.warnings.some((warning) => warning.includes("addons/")));
  assert.deepEqual(report.unresolved, ["uid://abc123"]);
});

test("concurrent dependency requests share one in-flight report", async (t) => {
  invalidateDependencyGraph();
  const projectPath = await createGodotProject(t);
  await writeText(path.join(projectPath, "script.gd"), "extends Node\n");
  const [first, second] = await Promise.all([
    buildDependencyReport({ project_path: projectPath }),
    buildDependencyReport({ project_path: projectPath }),
  ]);
  assert.equal(first, second);
});

test("refresh bypasses metadata-matching dependency cache entries", async (t) => {
  invalidateDependencyGraph();
  const projectPath = await createGodotProject(t);
  const scriptPath = path.join(projectPath, "script.gd");
  await writeText(scriptPath, 'const X = preload("res://a.tres")\n');
  const originalStats = await fs.stat(scriptPath);
  await buildDependencyReport({ project_path: projectPath });

  await writeText(scriptPath, 'const X = preload("res://b.tres")\n');
  await fs.utimes(scriptPath, originalStats.atime, originalStats.mtime);
  const report = await buildDependencyReport({ project_path: projectPath, refresh: true });
  assert.deepEqual(report.nodes["res://script.gd"].dependsOn, ["res://b.tres"]);
});
