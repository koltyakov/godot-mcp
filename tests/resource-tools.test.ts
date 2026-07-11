import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

import { readResourceTool, updateResourceTool } from "../src/tools/resource-tools.js";
import { createGodotProject, createMockGodotExecutor } from "./helpers.js";

test("read_resource dispatches to Godot with a normalized path", async (t) => {
  const projectPath = await createGodotProject(t);
  await fs.mkdir(path.join(projectPath, "resources"), { recursive: true });
  await fs.writeFile(path.join(projectPath, "resources", "shape.tres"), "[gd_resource type=\"CircleShape2D\" format=3]\n");
  const executor = createMockGodotExecutor(async (_path, operation, params) => {
    assert.equal(operation, "read_resource");
    assert.deepEqual(params, { resource_path: "res://resources/shape.tres" });
    return { success: true, output: "", data: { success: true, resource_type: "CircleShape2D", properties: { radius: 10 } } };
  });
  const result = await readResourceTool.execute({ project_path: projectPath, resource_path: "resources/shape.tres" }, executor);
  assert.equal((result as Record<string, unknown>).resource_type, "CircleShape2D");
});

test("update_resource requires a non-empty property patch", async (t) => {
  const projectPath = await createGodotProject(t);
  const executor = createMockGodotExecutor(async () => ({ success: true, output: "" }));
  await assert.rejects(
    updateResourceTool.execute({ project_path: projectPath, resource_path: "res://shape.tres", properties: {} }, executor),
    /non-empty object/
  );
});

test("resource reads reject symbolic links before invoking Godot", async (t) => {
  const projectPath = await createGodotProject(t);
  const targetPath = path.join(projectPath, "target.tres");
  await fs.writeFile(targetPath, "[gd_resource type=\"Resource\" format=3]\n");
  await fs.symlink(targetPath, path.join(projectPath, "alias.tres"));
  const executor = createMockGodotExecutor(async () => {
    throw new Error("Godot must not run");
  });
  await assert.rejects(
    readResourceTool.execute({ project_path: projectPath, resource_path: "res://alias.tres" }, executor),
    /must not be a symbolic link/
  );
});
