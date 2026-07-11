import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { getAllTools } from "../src/tools/index.js";
import {
  addNodeGroupTool,
  removeNodeGroupTool,
  setNodeMetaTool,
  removeNodeMetaTool,
  connectSignalTool,
  disconnectSignalTool,
} from "../src/tools/scene-ext-tools.js";
import { addAnimationTrackTool } from "../src/tools/animation-tools.js";
import { createGodotProject, createMockGodotExecutor, writeText } from "./helpers.js";
import { sceneTools } from "../src/tools/scene-tools.js";

const newToolNames = [
  "add_node_group",
  "remove_node_group",
  "set_node_meta",
  "remove_node_meta",
  "connect_signal",
  "disconnect_signal",
  "get_class_info",
  "check_script",
  "get_project_settings",
  "set_project_setting",
  "list_autoloads",
  "set_autoload",
  "remove_autoload",
  "list_input_actions",
  "export_project",
  "list_export_presets",
  "upgrade_project",
  "read_project_file",
  "get_dependency_graph",
  "find_usages",
  "list_project_files",
];

test("all new tools are registered and uniquely named", () => {
  const tools = getAllTools();
  const names = tools.map((t) => t.name);
  for (const name of newToolNames) {
    assert.ok(names.includes(name as never), `missing tool: ${name}`);
  }
  assert.equal(new Set(names).size, names.length, "duplicate tool names");
});

test("all scene-ext tools are annotated destructive", () => {
  for (const t of [addNodeGroupTool, removeNodeGroupTool, setNodeMetaTool, removeNodeMetaTool, connectSignalTool, disconnectSignalTool]) {
    assert.equal(t.definition.annotations?.destructiveHint, true, `${t.definition.name} should be destructive`);
  }
});

test("add_node_group / remove_node_group dispatch with the add flag", async (t) => {
  const projectPath = await createGodotProject(t);
  const calls: Array<{ params: Record<string, unknown> }> = [];
  const executor = createMockGodotExecutor(async (_p, _op, params) => {
    calls.push({ params });
    return { success: true, output: "", data: { success: true } };
  });

  await addNodeGroupTool.execute(
    { project_path: projectPath, scene_path: "res://main.tscn", node_path: ".", group: "enemies" },
    executor
  );
  await removeNodeGroupTool.execute(
    { project_path: projectPath, scene_path: "res://main.tscn", node_path: ".", group: "enemies" },
    executor
  );

  assert.equal(calls[0].params.add, true);
  assert.equal(calls[1].params.add, false);
  assert.equal(calls[0].params.group, "enemies");
});

test("set_node_meta dispatches with key and value", async (t) => {
  const projectPath = await createGodotProject(t);
  let received: Record<string, unknown> = {};
  const executor = createMockGodotExecutor(async (_p, _op, params) => {
    received = params;
    return { success: true, output: "", data: { success: true } };
  });
  await setNodeMetaTool.execute(
    { project_path: projectPath, scene_path: "res://main.tscn", node_path: ".", key: "role", value: "boss" },
    executor
  );
  assert.equal(received.key, "role");
  assert.equal(received.value, "boss");
});

test("connect_signal lets Godot apply its CONNECT_PERSIST default", async (t) => {
  const projectPath = await createGodotProject(t);
  let received: Record<string, unknown> = {};
  const executor = createMockGodotExecutor(async (_p, _op, params) => {
    received = params;
    return { success: true, output: "", data: { success: true } };
  });
  await connectSignalTool.execute(
    {
      project_path: projectPath,
      scene_path: "res://ui.tscn",
      source_node_path: "Button",
      signal: "pressed",
      target_node_path: ".",
      method: "_on_pressed",
    },
    executor
  );
  assert.equal("flags" in received, false);
  assert.equal(received.signal, "pressed");
  assert.equal(received.method, "_on_pressed");
});

test("connect_signal honors an explicit flags override", async (t) => {
  const projectPath = await createGodotProject(t);
  let received: Record<string, unknown> = {};
  const executor = createMockGodotExecutor(async (_p, _op, params) => {
    received = params;
    return { success: true, output: "", data: { success: true } };
  });
  await connectSignalTool.execute(
    {
      project_path: projectPath,
      scene_path: "res://ui.tscn",
      source_node_path: "Button",
      signal: "pressed",
      target_node_path: ".",
      method: "_on_pressed",
      flags: 16, // CONNECT_DEFERRED
    },
    executor
  );
  assert.equal(received.flags, 16);
});

test("add_animation_track exposes track_type in its schema and forwards it", async (t) => {
  // schema
  const trackTypeProp = addAnimationTrackTool.definition.inputSchema.properties?.track_type as
    | { enum?: string[] }
    | undefined;
  assert.ok(trackTypeProp?.enum?.includes("method"));
  assert.ok(trackTypeProp?.enum?.includes("audio"));

  // dispatch
  const projectPath = await createGodotProject(t);
  let received: Record<string, unknown> = {};
  const executor = createMockGodotExecutor(async (_p, _op, params) => {
    received = params;
    return { success: true, output: "", data: { success: true } };
  });
  await addAnimationTrackTool.execute(
    {
      project_path: projectPath,
      scene_path: "res://player.tscn",
      animation_player_path: "AnimationPlayer",
      animation_name: "attack",
      target_node_path: ".",
      track_type: "method",
      keyframes: [{ time: 0.5, value: { method: "play_sound", args: ["hit"] } }],
    },
    executor
  );
  assert.equal(received.track_type, "method");
  assert.equal(received.property, "");
});

test("add_node schema documents instance_scene_path for scene composition", () => {
  const addNode = sceneTools.find((t) => t.definition.name === "add_node");
  assert.ok(addNode);
  const props = addNode?.definition.inputSchema.properties ?? {};
  assert.ok("instance_scene_path" in props, "add_node should expose instance_scene_path");
});

test("add_node forwards instance_scene_path when provided", async (t) => {
  const projectPath = await createGodotProject(t);
  await writeText(path.join(projectPath, "scenes", "enemy.tscn"), "[gd_scene format=3]\n");
  let received: Record<string, unknown> = {};
  const executor = createMockGodotExecutor(async (_p, _op, params) => {
    received = params;
    return { success: true, output: "", data: { success: true } };
  });
  const { addNodeTool } = await import("../src/tools/scene-tools.js");
  await addNodeTool.execute(
    {
      project_path: projectPath,
      scene_path: "res://level.tscn",
      node_type: "Node",
      node_name: "Enemy",
      instance_scene_path: "scenes/enemy.tscn",
    },
    executor
  );
  assert.equal(received.instance_scene_path, "res://scenes/enemy.tscn");
  // When omitted, instance_scene_path should NOT be present at all.
  let received2: Record<string, unknown> = {};
  const executor2 = createMockGodotExecutor(async (_p, _op, params) => {
    received2 = params;
    return { success: true, output: "", data: { success: true } };
  });
  await addNodeTool.execute(
    {
      project_path: projectPath,
      scene_path: "res://level.tscn",
      node_type: "Node",
      node_name: "Plain",
    },
    executor2
  );
  assert.ok(!("instance_scene_path" in received2));

  await assert.rejects(
    addNodeTool.execute(
      {
        project_path: projectPath,
        scene_path: "res://level.tscn",
        node_type: "Node",
        node_name: "Bad",
        instance_scene_path: "res://scripts/not-a-scene.gd",
      },
      executor2
    ),
    /instance_scene_path must end with .tscn or .scn/
  );
});

// addNodeTool is imported lazily inside the test that uses it.
