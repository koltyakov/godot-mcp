import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";

export interface RegisteredProject {
  project_id: string;
  project_path: string;
}

const projectsById = new Map<string, RegisteredProject>();
const idsByPath = new Map<string, string>();

export async function registerProject(projectPath: string): Promise<RegisteredProject> {
  const canonicalPath = await fs.realpath(projectPath);
  const existingId = idsByPath.get(canonicalPath);
  if (existingId) return projectsById.get(existingId)!;

  const projectId = createHash("sha256").update(canonicalPath).digest("hex").slice(0, 24);
  const project = { project_id: projectId, project_path: canonicalPath };
  projectsById.set(projectId, project);
  idsByPath.set(canonicalPath, projectId);
  return project;
}

export function getRegisteredProject(projectId: string): RegisteredProject | null {
  return projectsById.get(projectId) ?? null;
}

export function listRegisteredProjects(): RegisteredProject[] {
  return [...projectsById.values()].sort((a, b) => a.project_id.localeCompare(b.project_id));
}

export function clearProjectRegistry(): void {
  projectsById.clear();
  idsByPath.clear();
}
