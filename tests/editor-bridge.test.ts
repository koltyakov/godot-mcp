import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as net from "node:net";
import test from "node:test";

import { discoverEditorBridges } from "../src/godot/bridge/discovery.js";
import { callEditorBridge } from "../src/godot/bridge/client.js";
import type { BridgeDescriptor } from "../src/godot/bridge/discovery.js";
import { getEditorStateTool } from "../src/tools/editor-tools.js";
import { runWithExecutionContext } from "../src/execution-context.js";
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

test("callEditorBridge authenticates before invoking a method", async (t) => {
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf-8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const request = JSON.parse(buffer.slice(0, newline)) as { id: number; method: string };
        buffer = buffer.slice(newline + 1);
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: request.method === "bridge.hello" ? { protocol: 1 } : { fps: 60 } })}\n`);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as net.AddressInfo;
  const descriptor = {
    schema: "godot-mcp-editor-bridge",
    protocol: 1,
    instance_id: "test",
    pid: 1,
    project_path: "/tmp/project",
    project_name: "Test",
    godot_version: "4.3",
    host: "127.0.0.1",
    port: address.port,
    token: "a".repeat(64),
    capabilities: ["editor.performance"],
    heartbeat_at_ms: Date.now(),
  } satisfies BridgeDescriptor;

  assert.deepEqual(await callEditorBridge(descriptor, "editor.get_performance"), { fps: 60 });
});

test("callEditorBridge closes promptly on MCP cancellation", async (t) => {
  const server = net.createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as net.AddressInfo;
  const descriptor = {
    schema: "godot-mcp-editor-bridge",
    protocol: 1,
    instance_id: "test",
    pid: 1,
    project_path: "/tmp/project",
    project_name: "Test",
    godot_version: "4.3",
    host: "127.0.0.1",
    port: address.port,
    token: "a".repeat(64),
    capabilities: [],
    heartbeat_at_ms: Date.now(),
  } satisfies BridgeDescriptor;
  const controller = new AbortController();
  const pending = runWithExecutionContext({ signal: controller.signal }, () => callEditorBridge(descriptor, "bridge.ping", {}, 5000));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
