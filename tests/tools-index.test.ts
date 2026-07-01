import assert from "node:assert/strict";
import test from "node:test";

import { executeTool, getAllTools } from "../src/tools/index.js";
import { createGodotProject } from "./helpers.js";

test("getAllTools returns unique tool definitions", () => {
  const tools = getAllTools();
  const names = tools.map((tool) => tool.name);

  assert.ok(names.includes("get_project_info"));
  assert.ok(names.includes("create_scene"));
  assert.equal(new Set(names).size, names.length);
});

test("executeTool dispatches known tools and rejects unknown tools", async (t) => {
  const projectPath = await createGodotProject(t);

  const result = await executeTool("get_project_info", { project_path: projectPath }, null);
  assert.equal((result as Record<string, unknown>).project_name, "Test Project");

  await assert.rejects(executeTool("missing_tool", {}, null), /Unknown tool: missing_tool/);
});
