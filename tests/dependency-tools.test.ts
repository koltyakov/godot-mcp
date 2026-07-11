import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { findUsagesTool, getDependencyGraphTool } from "../src/tools/dependency-tools.js";
import { createGodotProject, createMockGodotExecutor, writeText } from "./helpers.js";

test("dependency tools keep the filesystem-only default", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(path.join(projectPath, "source.gd"), 'const Target = preload("res://target.tres")\n');
  await writeText(path.join(projectPath, "target.tres"), '[gd_resource type="Resource"]\n');
  let calls = 0;
  const executor = createMockGodotExecutor(async () => {
    calls += 1;
    return { success: true, output: "" };
  });

  const result = await getDependencyGraphTool.execute({ project_path: projectPath }, executor) as Record<string, unknown>;

  assert.equal(calls, 0);
  assert.equal("engine" in result, false);
});

test("engine enrichment dispatches scanned paths and improves reverse usages", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(path.join(projectPath, "binary.res"), "binary-placeholder");
  await writeText(path.join(projectPath, "target.tres"), '[gd_resource type="Resource"]\n');
  let received: { operation?: string; params?: Record<string, unknown> } = {};
  const inspection = {
    success: true,
    dependencies: {
      "res://binary.res": ["res://target.tres"],
      "res://target.tres": [],
    },
    uid_paths: {},
    failures: {},
    inspected_count: 2,
  };
  const executor = createMockGodotExecutor(async (_project, operation, params) => {
    received = { operation, params };
    return { success: true, output: JSON.stringify(inspection), data: inspection };
  });

  const result = await findUsagesTool.execute({
    project_path: projectPath,
    target_path: "res://target.tres",
    engine: true,
  }, executor) as Record<string, unknown>;

  assert.equal(received.operation, "inspect_dependencies");
  assert.deepEqual(received.params, {
    paths: ["res://binary.res", "res://target.tres"],
    uids: [],
  });
  assert.deepEqual(result.referencedBy, ["res://binary.res"]);
  assert.deepEqual(result.engine, {
    requested: true,
    status: "used",
    inspected_count: 2,
    failed_count: 0,
  });
});

test("engine enrichment degrades explicitly when Godot is unavailable", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(path.join(projectPath, "source.gd"), "extends Node\n");

  const result = await getDependencyGraphTool.execute({ project_path: projectPath, engine: true }, null) as Record<string, unknown>;

  assert.equal(result.complete, false);
  assert.deepEqual(result.engine, {
    requested: true,
    status: "unavailable",
    inspected_count: 0,
    failed_count: 0,
  });
  assert.ok((result.warnings as string[]).some((warning) => warning.includes("Godot is unavailable")));
});

test("engine enrichment preserves successful batches when a later batch fails", async (t) => {
  const projectPath = await createGodotProject(t);
  for (let index = 0; index < 101; index += 1) {
    await writeText(path.join(projectPath, `script-${index}.gd`), "extends Node\n");
  }
  let calls = 0;
  const executor = createMockGodotExecutor(async (_project, _operation, params) => {
    calls += 1;
    if (calls === 2) return { success: false, output: "", error: "batch failed" };
    const dependencies = Object.fromEntries((params.paths as string[]).map((source) => [source, []]));
    const data = { success: true, dependencies, uid_paths: {}, failures: {}, inspected_count: Object.keys(dependencies).length };
    return { success: true, output: JSON.stringify(data), data };
  });

  const result = await getDependencyGraphTool.execute({ project_path: projectPath, engine: true }, executor) as Record<string, any>;

  assert.equal(calls, 2);
  assert.equal(result.engine.status, "used");
  assert.equal(result.engine.inspected_count, 100);
  assert.equal(result.engine.failed_count, 1);
  assert.deepEqual(Object.values(result.engine.failures), ["batch failed"]);
});
