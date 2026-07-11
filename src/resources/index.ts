import * as fs from "fs/promises";

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { GodotExecutor } from "../godot/executor.js";
import { findSceneFiles, findScriptFiles } from "../godot/finder.js";
import { executeGodotOperation } from "../tools/godot-operation.js";
import { resolveProjectPath } from "../tools/project-context.js";
import {
  resolveExistingProjectFilePath,
  SCENE_EXTENSIONS,
  SCRIPT_EXTENSIONS,
} from "../tools/path-utils.js";
import { log } from "../logger.js";
import { runWithExecutionContext } from "../execution-context.js";

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

const PROJECT_INFO_URI = "godot://project";
const SCENE_TEMPLATE_URI = "godot://scene/{path}";
const SCRIPT_TEMPLATE_URI = "godot://script/{path}";

type ResourceAudience = "user" | "assistant";

type ParsedGodotUri =
  | { kind: "project" }
  | { kind: "scene"; resPath: string }
  | { kind: "script"; resPath: string }
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
  const rawPath = parsed.pathname.replace(/^\//, "");
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    decodedPath = rawPath;
  }

  switch (host) {
    case "project":
      return { kind: "project" };
    case "scene":
      return decodedPath ? { kind: "scene", resPath: decodedPath } : null;
    case "script":
      return decodedPath ? { kind: "script", resPath: decodedPath } : null;
    default:
      return null;
  }
}

function encodeResPath(resPath: string): string {
  return encodeURIComponent(resPath);
}

// Exported for unit tests.
export const __testing = { parseGodotUri, encodeResPath, GODOT_SCHEME };

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
            "Read the serialized node tree of a Godot scene. Replace {path} with a percent-encoded res:// path (e.g. res%3A%2F%2Fscenes%2Fmain.tscn).",
          mimeType: "application/json",
        },
        {
          uriTemplate: SCRIPT_TEMPLATE_URI,
          name: "GDScript source",
          description:
            "Read the source of a GDScript file. Replace {path} with a percent-encoded res:// path (e.g. res%3A%2F%2Fscripts%2Fplayer.gd).",
          mimeType: "text/x-gdscript",
        },
      ],
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    let projectPath: string;
    try {
      projectPath = await resolveProjectPath({});
    } catch (error) {
      // No single resolvable project. Surface only the project-info pointer so
      // clients still know the server exists; templates remain available too.
      await log("debug", "godot-mcp.resources", {
        message: "ListResources: no default project resolved",
        error: error instanceof Error ? error.message : String(error),
      });
      return { resources: [] };
    }

    const resources: Array<{
      uri: string;
      name: string;
      description: string;
      mimeType: string;
      annotations?: ReturnType<typeof audience>;
    }> = [
      {
        uri: PROJECT_INFO_URI,
        name: "Godot project info",
        description:
          "Active project metadata: name, main scene, engine version, scene/script counts.",
        mimeType: "application/json",
        annotations: audience("assistant", "user"),
      },
    ];

    const [scenes, scripts] = await Promise.all([
      findSceneFiles(projectPath).catch(() => [] as string[]),
      findScriptFiles(projectPath).catch(() => [] as string[]),
    ]);

    for (const scenePath of scenes) {
      resources.push({
        uri: `godot://scene/${encodeResPath(scenePath)}`,
        name: scenePath,
        description: `Scene tree for ${scenePath}`,
        mimeType: "application/json",
        annotations: audience("assistant"),
      });
    }

    for (const scriptPath of scripts) {
      resources.push({
        uri: `godot://script/${encodeResPath(scriptPath)}`,
        name: scriptPath,
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

    let projectPath: string;
    try {
      projectPath = await resolveProjectPath({});
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
        // Validate extension explicitly since the template accepts any string.
        if (!SCENE_EXTENSIONS.some((ext) => parsed.resPath.toLowerCase().endsWith(ext))) {
          return errorResource(
            uri,
            `Scene resource path must end with ${SCENE_EXTENSIONS.join(" or ")}: ${parsed.resPath}`
          );
        }
        const tree = await executeGodotOperation(
          executor,
          projectPath,
          "read_scene",
          { scene_path: parsed.resPath },
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
