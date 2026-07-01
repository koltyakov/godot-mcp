import assert from "node:assert/strict";
import test from "node:test";

import { getAllTools } from "../src/tools/index.js";
import { readOnlyAnnotations, destructiveAnnotations } from "../src/tools/types.js";

test("every tool defines an annotations object", () => {
  const tools = getAllTools();
  assert.ok(tools.length > 0, "expected tools to be registered");

  for (const tool of tools) {
    assert.ok(
      tool.annotations,
      `tool "${tool.name}" is missing annotations`
    );
  }
});

test("read-only tools are annotated readOnlyHint=true and not destructive", () => {
  const tools = getAllTools();
  const readOnlyNames = [
    "read_scene",
    "list_nodes",
    "read_script",
    "list_scripts",
    "get_project_info",
    "list_scenes",
    "get_godot_version",
    "list_open_projects",
  ];

  for (const name of readOnlyNames) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `missing tool ${name}`);
    assert.deepEqual(tool.annotations, readOnlyAnnotations, `${name} should be read-only`);
  }
});

test("destructive tools are annotated destructiveHint=true", () => {
  const tools = getAllTools();
  const destructiveNames = [
    "create_scene",
    "add_node",
    "remove_node",
    "modify_node",
    "create_script",
    "edit_script",
    "attach_script",
    "create_resource",
    "create_animation",
    "add_animation_track",
    "init_project",
  ];

  for (const name of destructiveNames) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `missing tool ${name}`);
    assert.equal(tool.annotations?.destructiveHint, true, `${name} should be destructive`);
  }
});

test("launch_editor and run_project carry openWorldHint", () => {
  const tools = getAllTools();
  for (const name of ["launch_editor", "run_project"] as const) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `missing tool ${name}`);
    assert.equal(tool.annotations?.openWorldHint, true, `${name} should hint open world`);
    assert.equal(tool.annotations?.destructiveHint, undefined, `${name} should not claim destructive`);
  }
});

test("run_godot_script is flagged destructive and open world", () => {
  const tool = getAllTools().find((t) => t.name === "run_godot_script");
  assert.ok(tool);
  assert.equal(tool.annotations?.destructiveHint, true);
  assert.equal(tool.annotations?.openWorldHint, true);
});

test("destructiveAnnotations and readOnlyAnnotations helper objects are mutually exclusive", () => {
  assert.equal(readOnlyAnnotations.readOnlyHint, true);
  assert.equal(readOnlyAnnotations.destructiveHint, undefined);
  assert.equal(destructiveAnnotations.destructiveHint, true);
  assert.equal(destructiveAnnotations.readOnlyHint, undefined);
});
