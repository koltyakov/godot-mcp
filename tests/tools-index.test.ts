import assert from "node:assert/strict";
import test from "node:test";

import { executeTool, getAllTools } from "../src/tools/index.js";
import { createGodotProject, createMockGodotExecutor } from "./helpers.js";

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
