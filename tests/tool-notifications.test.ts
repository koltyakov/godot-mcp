import assert from "node:assert/strict";
import test from "node:test";

import { executeTool } from "../src/tools/index.js";
import { setResourceListChangedNotifier, notifyResourcesChanged } from "../src/notifications.js";
import { createGodotProject, createMockGodotExecutor } from "./helpers.js";

test("executeTool emits resources/list_changed for destructive tools", async (t) => {
  const projectPath = await createGodotProject(t);

  let notifyCalls = 0;
  setResourceListChangedNotifier(async () => {
    notifyCalls += 1;
  });

  const executor = createMockGodotExecutor(async () => ({
    success: true,
    output: "",
    data: {
      success: true,
      message: "Created script at res://scripts/x.gd",
      script_path: "res://scripts/x.gd",
    },
  }));

  await executeTool(
    "create_script",
    { project_path: projectPath, script_path: "res://scripts/x.gd", content: "extends Node\n" },
    executor
  );

  assert.equal(notifyCalls, 1, "destructive tool should notify once");

  setResourceListChangedNotifier(null);
});

test("executeTool does NOT notify for read-only tools", async (t) => {
  const projectPath = await createGodotProject(t);

  let notifyCalls = 0;
  setResourceListChangedNotifier(async () => {
    notifyCalls += 1;
  });

  const executor = createMockGodotExecutor(async () => ({
    success: true,
    output: "",
    data: { success: true, project_name: "Test", scripts: [], count: 0, project_path: projectPath },
  }));

  await executeTool("list_scripts", { project_path: projectPath }, executor);

  assert.equal(notifyCalls, 0, "read-only tool must not trigger list_changed");

  setResourceListChangedNotifier(null);
});

test("executeTool does NOT rescan resources for open-world runtime tools", async (t) => {
  const projectPath = await createGodotProject(t);
  let notifyCalls = 0;
  setResourceListChangedNotifier(async () => {
    notifyCalls += 1;
  });
  const executor = createMockGodotExecutor(async () => ({ success: true, output: "" }));

  await executeTool("run_project", { project_path: projectPath }, executor);

  assert.equal(notifyCalls, 0);
  setResourceListChangedNotifier(null);
});

test("executeTool rescans resources after bounded diagnostics", async (t) => {
  const projectPath = await createGodotProject(t);
  let notifyCalls = 0;
  setResourceListChangedNotifier(async () => {
    notifyCalls += 1;
  });
  const executor = createMockGodotExecutor(async () => ({ success: true, output: "" }));

  await executeTool("run_project_diagnostics", { project_path: projectPath }, executor);

  assert.equal(notifyCalls, 1);
  setResourceListChangedNotifier(null);
});

test("executeTool still notifies even if the notifier throws", async (t) => {
  const projectPath = await createGodotProject(t);

  setResourceListChangedNotifier(async () => {
    throw new Error("client disconnected");
  });

  const executor = createMockGodotExecutor(async () => ({
    success: true,
    output: "",
    data: { success: true, message: "ok", script_path: "res://scripts/x.gd" },
  }));

  // Should not reject despite the notifier throwing.
  await executeTool(
    "create_script",
    { project_path: projectPath, script_path: "res://scripts/x.gd", content: "extends Node\n" },
    executor
  );

  setResourceListChangedNotifier(null);
});

test("notifyResourcesChanged is safe to call when no notifier is registered", async () => {
  setResourceListChangedNotifier(null);
  await assert.doesNotReject(notifyResourcesChanged());
});
