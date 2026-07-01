import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

import type { OpenGodotProject } from "../src/godot/finder.js";
import { resolveProjectPath } from "../src/tools/project-context.js";
import { createGodotProject, createTempDir, writeText } from "./helpers.js";

function openProject(project_path: string, project_name: string): OpenGodotProject {
  return { project_path, project_name, process_ids: [1] };
}

test("resolveProjectPath validates an explicit project path", async (t) => {
  const projectPath = await createGodotProject(t);

  assert.equal(await resolveProjectPath({ project_path: projectPath }, async () => []), await fs.realpath(projectPath));
});

test("resolveProjectPath uses the only open project by default", async (t) => {
  const projectPath = await createGodotProject(t);

  assert.equal(await resolveProjectPath({}, async () => [openProject(projectPath, "Only Game")]), await fs.realpath(projectPath));
});

test("resolveProjectPath selects among open projects by name", async (t) => {
  const dir = await createTempDir(t);
  const firstProjectPath = path.join(dir, "first");
  const secondProjectPath = path.join(dir, "second");
  await writeText(path.join(firstProjectPath, "project.godot"), "config_version=5\n");
  await writeText(path.join(secondProjectPath, "project.godot"), "config_version=5\n");

  const openProjects = [openProject(firstProjectPath, "First Game"), openProject(secondProjectPath, "Second Game")];

  assert.equal(await resolveProjectPath({ project_name: "Second Game" }, async () => openProjects), await fs.realpath(secondProjectPath));
  assert.equal(await resolveProjectPath({ project_name: "first" }, async () => openProjects), await fs.realpath(firstProjectPath));
});

test("resolveProjectPath reports ambiguous or missing open project selection", async () => {
  const openProjects = [
    openProject("/projects/demo-one", "Demo"),
    openProject("/projects/demo-two", "Demo Tools"),
  ];

  await assert.rejects(resolveProjectPath({}, async () => openProjects), /Multiple open Godot projects detected/);
  await assert.rejects(resolveProjectPath({ project_name: "Dem" }, async () => openProjects), /Multiple open Godot projects match/);
  await assert.rejects(resolveProjectPath({}, async () => []), /no open Godot projects were detected/);
});
