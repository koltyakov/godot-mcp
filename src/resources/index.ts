import * as fs from "fs/promises";
import * as path from "node:path";

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { GodotExecutor } from "../godot/executor.js";
import { findOpenGodotProjects, findSceneFiles, findScriptFiles } from "../godot/finder.js";
import { executeGodotOperation } from "../tools/godot-operation.js";
import { resolveProjectPath } from "../tools/project-context.js";
import {
  resolveExistingProjectFilePath,
  SCENE_EXTENSIONS,
  SCRIPT_EXTENSIONS,
} from "../tools/path-utils.js";
import { log } from "../logger.js";
import { runWithExecutionContext } from "../execution-context.js";
import { getRegisteredProject, listRegisteredProjects, registerProject } from "../project-registry.js";

/**
 * Custom URI scheme used for Godot resources. Resolvable targets:
 *   godot://project              - active project summary (JSON)
 *   godot://scene/{resPath}      - serialized scene tree for res://... path
 *   godot://script/{resPath}     - GDScript source for res://... path
 *
 * The {resPath} variable must be percent-encoded by the client (the default
 * for RFC 6570 `{path}` expansion), so that the embedded `://` in a
 * `res://...` value does not corrupt URI parsing.
 */
export const GODOT_SCHEME = "godot:";

const PROJECTS_URI = "godot://projects";
const SCENE_TEMPLATE_URI = "godot://scene/{project_id}/{path}";
const SCRIPT_TEMPLATE_URI = "godot://script/{project_id}/{path}";

type ResourceAudience = "user" | "assistant";

type ParsedGodotUri =
  | { kind: "projects" }
  | { kind: "project"; projectId?: string }
  | { kind: "scene"; projectId?: string; resPath: string }
  | { kind: "script"; projectId?: string; resPath: string }
  | null;

function audience(...a: ResourceAudience[]) {
  return { audience: a };
}

function parseGodotUri(uri: string): ParsedGodotUri {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }

  if (parsed.protocol !== GODOT_SCHEME) {
    return null;
  }

  const host = parsed.hostname;
  // pathname always begins with "/"; decode to recover the res:// value.
  const segments = parsed.pathname.replace(/^\//, "").split("/").filter(Boolean);
  const decode = (value: string): string => {
    try { return decodeURIComponent(value); } catch { return value; }
  };

  switch (host) {
    case "projects":
      return segments.length === 0 ? { kind: "projects" } : null;
    case "project":
      return segments.length <= 1 ? { kind: "project", ...(segments[0] ? { projectId: segments[0] } : {}) } : null;
    case "scene":
      if (segments.length === 1) return { kind: "scene", resPath: decode(segments[0]) };
      return segments.length === 2 ? { kind: "scene", projectId: segments[0], resPath: decode(segments[1]) } : null;
    case "script":
      if (segments.length === 1) return { kind: "script", resPath: decode(segments[0]) };
      return segments.length === 2 ? { kind: "script", projectId: segments[0], resPath: decode(segments[1]) } : null;
    default:
      return null;
  }
}

function encodeResPath(resPath: string): string {
  return encodeURIComponent(resPath);
}

// Exported for unit tests.
export const __testing = { parseGodotUri, encodeResPath, resolveSceneResourcePath, GODOT_SCHEME };

/**
 * Read a script file directly from disk. This avoids a headless Godot
 * spawn for the most common resource read.
 */
async function readScriptText(projectPath: string, resPath: string): Promise<string> {
  const { fsPath } = await resolveExistingProjectFilePath(projectPath, resPath, {
    fieldName: "script_path",
    extensions: SCRIPT_EXTENSIONS,
  });
  return fs.readFile(fsPath, "utf-8");
}

async function resolveSceneResourcePath(projectPath: string, resPath: string): Promise<string> {
  const resolved = await resolveExistingProjectFilePath(projectPath, resPath, {
    fieldName: "scene_path",
    extensions: SCENE_EXTENSIONS,
  });
  return resolved.resourcePath;
}

async function refreshOpenProjectRegistry(): Promise<void> {
  const openProjects = await findOpenGodotProjects().catch(() => []);
  await Promise.all(openProjects.map((project) => registerProject(project.project_path)));
}

async function resolveResourceProject(projectId?: string): Promise<string> {
  if (!projectId) return resolveProjectPath({});
  let registered = getRegisteredProject(projectId);
  if (!registered) {
    await refreshOpenProjectRegistry();
    registered = getRegisteredProject(projectId);
  }
  if (!registered) throw new Error(`Unknown project ID: ${projectId}`);
  return registered.project_path;
}

function jsonTextResource(uri: string, payload: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function textResource(uri: string, mimeType: string, text: string) {
  return {
    contents: [{ uri, mimeType, text }],
  };
}

function errorResource(uri: string, message: string) {
  return {
    contents: [{ uri, mimeType: "text/plain", text: message }],
  };
}

export function setupResourceHandlers(
  server: Server,
  executor: GodotExecutor | null
): void {
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [
        {
          uriTemplate: SCENE_TEMPLATE_URI,
          name: "Godot scene",
          description:
            "Read a serialized scene tree pinned to {project_id}. Replace {path} with a percent-encoded res:// path.",
          mimeType: "application/json",
        },
        {
          uriTemplate: SCRIPT_TEMPLATE_URI,
          name: "GDScript source",
          description:
            "Read GDScript source pinned to {project_id}. Replace {path} with a percent-encoded res:// path.",
          mimeType: "text/x-gdscript",
        },
      ],
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    await refreshOpenProjectRegistry();
    const registeredProjects = listRegisteredProjects();

    const resources: Array<{
      uri: string;
      name: string;
      description: string;
      mimeType: string;
      annotations?: ReturnType<typeof audience>;
    }> = [
      {
        uri: PROJECTS_URI,
        name: "Registered Godot projects",
        description: "Stable IDs and canonical paths for all discovered or explicitly selected projects.",
        mimeType: "application/json",
        annotations: audience("assistant", "user"),
      },
    ];

    for (const project of registeredProjects) {
      resources.push({
        uri: `godot://project/${project.project_id}`,
        name: `${path.basename(project.project_path)} project info`,
        description: `Project metadata for ${project.project_path}`,
        mimeType: "application/json",
        annotations: audience("assistant", "user"),
      });
      const [scenes, scripts] = await Promise.all([
        findSceneFiles(project.project_path).catch(() => [] as string[]),
        findScriptFiles(project.project_path).catch(() => [] as string[]),
      ]);
      for (const scenePath of scenes) resources.push({
        uri: `godot://scene/${project.project_id}/${encodeResPath(scenePath)}`,
        name: `${path.basename(project.project_path)}: ${scenePath}`,
        description: `Scene tree for ${scenePath}`,
        mimeType: "application/json",
        annotations: audience("assistant"),
      });
      for (const scriptPath of scripts) resources.push({
        uri: `godot://script/${project.project_id}/${encodeResPath(scriptPath)}`,
        name: `${path.basename(project.project_path)}: ${scriptPath}`,
        description: `GDScript source for ${scriptPath}`,
        mimeType: "text/x-gdscript",
        annotations: audience("assistant"),
      });
    }

    return { resources };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => runWithExecutionContext({
    signal: extra.signal,
    requestId: extra.requestId,
  }, async () => {
    const uri = request.params.uri;
    const parsed = parseGodotUri(uri);
    if (!parsed) {
      return errorResource(uri, `Unsupported Godot resource URI: ${uri}`);
    }

    if (parsed.kind === "projects") {
      await refreshOpenProjectRegistry();
      return jsonTextResource(uri, { projects: listRegisteredProjects() });
    }

    let projectPath: string;
    try {
      projectPath = await resolveResourceProject(parsed.projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResource(uri, `Cannot resolve a Godot project: ${message}`);
    }

    switch (parsed.kind) {
      case "project": {
        const info = await executeGodotOperation(
          executor,
          projectPath,
          "get_project_info",
          {},
          "Failed to read project info"
        );
        return jsonTextResource(uri, info);
      }
      case "scene": {
        let scenePath: string;
        try {
          scenePath = await resolveSceneResourcePath(projectPath, parsed.resPath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return errorResource(uri, `Failed to read scene: ${message}`);
        }
        const tree = await executeGodotOperation(
          executor,
          projectPath,
          "read_scene",
          { scene_path: scenePath },
          "Failed to read scene"
        );
        return jsonTextResource(uri, tree);
      }
      case "script": {
        if (!SCRIPT_EXTENSIONS.some((ext) => parsed.resPath.toLowerCase().endsWith(ext))) {
          return errorResource(
            uri,
            `Script resource path must end with ${SCRIPT_EXTENSIONS.join(" or ")}: ${parsed.resPath}`
          );
        }
        try {
          const text = await readScriptText(projectPath, parsed.resPath);
          return textResource(uri, "text/x-gdscript", text);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return errorResource(uri, `Failed to read script: ${message}`);
        }
      }
    }
  }));
}
