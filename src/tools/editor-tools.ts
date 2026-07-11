import type { ToolHandler } from "./types.js";
import { readOnlyAnnotations } from "./types.js";
import { projectSelectorProperties, resolveProjectPath } from "./project-context.js";
import { normalizeResourcePath, SCENE_EXTENSIONS } from "./path-utils.js";
import { selectEditorBridge } from "../godot/bridge/discovery.js";
import { callEditorBridge } from "../godot/bridge/client.js";
import { executeGodotOperation } from "./godot-operation.js";

const instanceProperty = {
  editor_instance_id: { type: "string", description: "Optional live editor bridge instance ID." },
};

export const getEditorStateTool: ToolHandler = {
  definition: {
    name: "get_editor_state",
    description: "Read live Godot editor state including the active scene, selection, open scenes, and play state when the optional editor bridge is enabled.",
    inputSchema: {
      type: "object",
      properties: { ...projectSelectorProperties, ...instanceProperty },
      required: [],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args) {
    const projectPath = await resolveProjectPath(args);
    const descriptor = await selectEditorBridge(projectPath, args.editor_instance_id as string | undefined);
    if (!descriptor) {
      return {
        live: false,
        available: false,
        project_path: projectPath,
        limitations: ["Enable the Godot MCP Editor Bridge plugin to access unsaved scenes, selection, and play state."],
      };
    }
    try {
      return {
        live: true,
        instance_id: descriptor.instance_id,
        state: await callEditorBridge(descriptor, "editor.get_state"),
      };
    } catch (error) {
      return {
        live: false,
        available: false,
        project_path: projectPath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const readEditorSceneTool: ToolHandler = {
  definition: {
    name: "read_editor_scene",
    description: "Read the active in-memory editor scene, including unsaved changes. Optionally falls back to the saved scene on disk.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        ...instanceProperty,
        scene_path: { type: "string", description: "Optional scene path for matching or disk fallback." },
        fallback_to_disk: { type: "boolean", default: true },
      },
      required: [],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args, executor) {
    const projectPath = await resolveProjectPath(args);
    const scenePath = typeof args.scene_path === "string"
      ? normalizeResourcePath(args.scene_path, { fieldName: "scene_path", extensions: SCENE_EXTENSIONS })
      : undefined;
    const descriptor = await selectEditorBridge(projectPath, args.editor_instance_id as string | undefined);
    if (descriptor) {
      try {
        return {
          live: true,
          source: "editor_memory",
          ...(await callEditorBridge(descriptor, "editor.read_scene", scenePath ? { scene_path: scenePath } : {}) as Record<string, unknown>),
        };
      } catch (error) {
        if (args.fallback_to_disk === false || !scenePath || (error instanceof Error && error.name === "AbortError")) throw error;
      }
    }
    if (args.fallback_to_disk !== false && scenePath) {
      const result = await executeGodotOperation(executor, projectPath, "read_scene", { scene_path: scenePath }, "Failed to read scene");
      return { live: false, source: "disk", unsaved_changes_included: false, result };
    }
    throw new Error("No live editor bridge is available and no scene_path was provided for disk fallback");
  },
};

export const editorTools = [getEditorStateTool, readEditorSceneTool];
