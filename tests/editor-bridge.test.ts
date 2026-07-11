import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

import { discoverEditorBridges } from "../src/godot/bridge/discovery.js";
import { getEditorStateTool } from "../src/tools/editor-tools.js";
import { createGodotProject, writeText } from "./helpers.js";

test("discoverEditorBridges validates live project-pinned descriptors", async (t) => {
  const projectPath = await createGodotProject(t);
  const canonicalPath = await fs.realpath(projectPath);
  const descriptorPath = path.join(projectPath, ".godot", "godot_mcp_bridge", "instances", "abc.json");
  await writeText(descriptorPath, JSON.stringify({
    schema: "godot-mcp-editor-bridge",
    protocol: 1,
    instance_id: "abc",
    pid: 123,
    project_path: canonicalPath,
    project_name: "Test Project",
    godot_version: "4.3.stable",
    host: "127.0.0.1",
    port: 54321,
    token: "a".repeat(64),
    capabilities: ["editor.state"],
    heartbeat_at_ms: Date.now(),
  }));

  const descriptors = await discoverEditorBridges(projectPath);
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].instance_id, "abc");
  assert.equal(descriptors[0].project_path, canonicalPath);
});

test("get_editor_state degrades cleanly when the optional plugin is absent", async (t) => {
  const projectPath = await createGodotProject(t);
  const result = await getEditorStateTool.execute({ project_path: projectPath }, null) as Record<string, unknown>;
  assert.equal(result.live, false);
  assert.equal(result.available, false);
});
