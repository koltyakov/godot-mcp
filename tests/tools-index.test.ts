import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

import { executeTool, getAllTools } from "../src/tools/index.js";
import { createGodotProject, createMockGodotExecutor, createTempDir } from "./helpers.js";

test("getAllTools returns unique tool definitions", () => {
  const tools = getAllTools();
  const names = tools.map((tool) => tool.name);

  assert.ok(names.includes("get_project_info"));
  assert.ok(names.includes("list_open_projects"));
  assert.ok(names.includes("run_godot_script"));
  assert.ok(names.includes("run_project_diagnostics"));
  assert.ok(names.includes("create_scene"));
  assert.ok(names.includes("apply_scene_changes"));
  assert.ok(names.includes("get_editor_state"));
  assert.ok(names.includes("read_editor_scene"));
  assert.ok(names.includes("read_resource"));
  assert.ok(names.includes("update_resource"));
  assert.ok(names.includes("delete_resource"));
  assert.ok(names.includes("control_editor_play"));
  assert.ok(names.includes("get_editor_performance"));
  assert.equal(new Set(names).size, names.length);
});

test("project-targeted tools expose optional project selectors", () => {
  const tools = getAllTools();
  const getProjectInfo = tools.find((tool) => tool.name === "get_project_info");

  assert.ok(getProjectInfo);
  assert.deepEqual(getProjectInfo.inputSchema.required, []);
  assert.ok("project_path" in getProjectInfo.inputSchema.properties);
  assert.ok("project_name" in getProjectInfo.inputSchema.properties);
});

test("executeTool dispatches known tools and rejects unknown tools", async (t) => {
  const projectPath = await createGodotProject(t);
  const executor = createMockGodotExecutor(async (_projectPath, operation) => {
    assert.equal(operation, "get_project_info");
    return {
      success: true,
      output: "",
      data: {
        success: true,
        project_name: "Test Project",
      },
    };
  });

  const result = await executeTool("get_project_info", { project_path: projectPath }, executor);
  assert.equal((result as Record<string, unknown>).project_name, "Test Project");

  await assert.rejects(executeTool("missing_tool", {}, null), /Unknown tool: missing_tool/);
});

test("executeTool rejects scene mutations through project-escaping symlinks", async (t) => {
  const projectPath = await createGodotProject(t);
  const outsidePath = await createTempDir(t);
  await fs.symlink(outsidePath, path.join(projectPath, "linked"));
  let calls = 0;
  const executor = createMockGodotExecutor(async () => {
    calls += 1;
    return { success: true, output: "" };
  });

  await assert.rejects(executeTool("create_scene", {
    project_path: projectPath,
    scene_path: "res://linked/main.tscn",
  }, executor), /escapes project directory/);
  await assert.rejects(executeTool("create_script", {
    project_path: projectPath,
    script_path: "res://linked/player.gd",
  }, executor), /escapes project directory/);
  await assert.rejects(executeTool("create_resource", {
    project_path: projectPath,
    resource_path: "res://linked/data.tres",
    resource_type: "Resource",
  }, executor), /escapes project directory/);
  assert.equal(calls, 0);
});

test("executeTool canonicalizes internal scene aliases without preflight side effects", async (t) => {
  const projectPath = await createGodotProject(t);
  await fs.mkdir(path.join(projectPath, "scenes"));
  await fs.symlink(path.join(projectPath, "scenes"), path.join(projectPath, "alias"));
  let receivedPath = "";
  const executor = createMockGodotExecutor(async (_project, _operation, params) => {
    receivedPath = params.scene_path as string;
    return { success: true, output: "", data: { success: true } };
  });

  await executeTool("create_scene", { project_path: projectPath, scene_path: "res://alias/main.tscn" }, executor);
  assert.equal(receivedPath, "res://scenes/main.tscn");

  await assert.rejects(executeTool("create_scene", {
    project_path: projectPath,
    scene_path: "res://missing/nested/main.tscn",
  }, null), /Godot is not available/);
  await assert.rejects(fs.access(path.join(projectPath, "missing")));
});

test("project selection rejects a symlinked project.godot", async (t) => {
  const projectPath = await createGodotProject(t);
  const outsidePath = await createTempDir(t);
  const outsideProjectFile = path.join(outsidePath, "project.godot");
  await fs.writeFile(outsideProjectFile, "config_version=5\n");
  await fs.rm(path.join(projectPath, "project.godot"));
  await fs.symlink(outsideProjectFile, path.join(projectPath, "project.godot"));

  await assert.rejects(executeTool("get_project_info", { project_path: projectPath }, null), /project.godot must be a regular file/);
});
