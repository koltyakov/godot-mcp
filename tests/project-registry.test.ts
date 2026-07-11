import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import test from "node:test";

import { clearProjectRegistry, getRegisteredProject, registerProject } from "../src/project-registry.js";
import { createGodotProject } from "./helpers.js";

test("project registry assigns deterministic IDs to canonical paths", async (t) => {
  clearProjectRegistry();
  const projectPath = await createGodotProject(t);
  const first = await registerProject(projectPath);
  const second = await registerProject(await fs.realpath(projectPath));

  assert.equal(first.project_id, second.project_id);
  assert.equal(first.project_id.length, 24);
  assert.equal(getRegisteredProject(first.project_id)?.project_path, await fs.realpath(projectPath));
});
