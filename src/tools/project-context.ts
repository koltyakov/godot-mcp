import * as path from "path";
import { findOpenGodotProjects, type OpenGodotProject } from "../godot/finder.js";
import { validateGodotProjectPath } from "./path-utils.js";
import { getRegisteredProject, registerProject } from "../project-registry.js";

type OpenProjectProvider = () => Promise<OpenGodotProject[]>;

export const projectSelectorProperties = {
  project_path: {
    type: "string",
    description: "Absolute path to the Godot project directory. Optional when exactly one project is open in Godot.",
  },
  project_name: {
    type: "string",
    description: "Name of an open Godot project to use when multiple projects are open.",
  },
  project_id: {
    type: "string",
    description: "Stable project ID returned by list_open_projects or project-qualified godot:// resources.",
  },
};

function formatOpenProjects(projects: OpenGodotProject[]): string {
  if (projects.length === 0) {
    return "none";
  }

  return projects.map((project) => `${project.project_name} (${project.project_path})`).join(", ");
}

function matchesProjectName(project: OpenGodotProject, requestedName: string, exact: boolean): boolean {
  const name = requestedName.toLowerCase();
  const projectName = project.project_name.toLowerCase();
  const directoryName = path.basename(project.project_path).toLowerCase();

  if (exact) {
    return projectName === name || directoryName === name;
  }

  return projectName.includes(name) || directoryName.includes(name);
}

async function validateOpenProjectSelection(project: OpenGodotProject): Promise<string> {
  return validateGodotProjectPath(project.project_path);
}

export async function resolveProjectPath(
  args: Record<string, unknown>,
  openProjectProvider: OpenProjectProvider = findOpenGodotProjects
): Promise<string> {
  const suppliedSelectors = ["project_id", "project_path", "project_name"].filter((key) => {
    const value = args[key];
    return value !== undefined && value !== null && (typeof value !== "string" || value.trim() !== "");
  });
  if (suppliedSelectors.length > 1) {
    throw new Error(`Provide only one project selector, not: ${suppliedSelectors.join(", ")}`);
  }

  const projectId = args.project_id;
  if (projectId !== undefined && projectId !== null) {
    if (typeof projectId !== "string" || projectId.trim() === "") {
      throw new Error("project_id must be a non-empty string");
    }
    const registered = getRegisteredProject(projectId);
    if (!registered) throw new Error(`Unknown project_id: ${projectId}`);
    return validateGodotProjectPath(registered.project_path);
  }

  const explicitPath = args.project_path;
  if (explicitPath !== undefined && explicitPath !== null) {
    if (typeof explicitPath !== "string" || explicitPath.trim() === "") {
      throw new Error("project_path must be a non-empty string");
    }

    const validated = await validateGodotProjectPath(explicitPath);
    await registerProject(validated);
    return validated;
  }

  const requestedName = typeof args.project_name === "string" ? args.project_name.trim() : "";
  const openProjects = await openProjectProvider();

  if (requestedName) {
    const exactMatches = openProjects.filter((project) => matchesProjectName(project, requestedName, true));
    const matches = exactMatches.length > 0
      ? exactMatches
      : openProjects.filter((project) => matchesProjectName(project, requestedName, false));

    if (matches.length === 1) {
      const validated = await validateOpenProjectSelection(matches[0]);
      await registerProject(validated);
      return validated;
    }

    if (matches.length === 0) {
      throw new Error(`No open Godot project matches "${requestedName}". Open projects: ${formatOpenProjects(openProjects)}`);
    }

    throw new Error(`Multiple open Godot projects match "${requestedName}". Use project_path or a more specific project_name. Matches: ${formatOpenProjects(matches)}`);
  }

  if (openProjects.length === 1) {
    const validated = await validateOpenProjectSelection(openProjects[0]);
    await registerProject(validated);
    return validated;
  }

  if (openProjects.length === 0) {
    throw new Error("No project_path was provided and no open Godot projects were detected. Open a project in Godot or provide project_path.");
  }

  throw new Error(`Multiple open Godot projects detected. Provide project_name or project_path. Open projects: ${formatOpenProjects(openProjects)}`);
}
