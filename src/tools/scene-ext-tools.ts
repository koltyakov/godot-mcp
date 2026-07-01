import type { ToolHandler } from "./types.js";
import { destructiveAnnotations } from "./types.js";
import { projectSelectorProperties, resolveProjectPath } from "./project-context.js";
import { normalizeResourcePath, SCENE_EXTENSIONS } from "./path-utils.js";

async function resolveScenePath(args: Record<string, unknown>): Promise<{ projectPath: string; scenePath: string }> {
  const projectPath = await resolveProjectPath(args);
  const scenePath = normalizeResourcePath(args.scene_path as string, {
    fieldName: "scene_path",
    extensions: SCENE_EXTENSIONS,
  });
  return { projectPath, scenePath };
}

// Add Node Group Tool
export const addNodeGroupTool: ToolHandler = {
  definition: {
    name: "add_node_group",
    description: "Add a node to a (persistent) Godot group. The group is saved with the scene.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        scene_path: { type: "string", description: "Scene containing the node." },
        node_path: { type: "string", description: "Node path (use '.' for root)." },
        group: { type: "string", description: "Group name to add." },
      },
      required: ["scene_path", "node_path", "group"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) throw new Error("Godot is not available");
    const { projectPath, scenePath } = await resolveScenePath(args);
    const result = await executor.execute(projectPath, "set_node_group", {
      scene_path: scenePath,
      node_path: args.node_path as string,
      group: args.group as string,
      add: true,
    });
    if (!result.success) throw new Error(result.error || "Failed to add group");
    return result.output;
  },
};

// Remove Node Group Tool
export const removeNodeGroupTool: ToolHandler = {
  definition: {
    name: "remove_node_group",
    description: "Remove a node from a group. The change is saved with the scene.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        scene_path: { type: "string" },
        node_path: { type: "string" },
        group: { type: "string" },
      },
      required: ["scene_path", "node_path", "group"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) throw new Error("Godot is not available");
    const { projectPath, scenePath } = await resolveScenePath(args);
    const result = await executor.execute(projectPath, "set_node_group", {
      scene_path: scenePath,
      node_path: args.node_path as string,
      group: args.group as string,
      add: false,
    });
    if (!result.success) throw new Error(result.error || "Failed to remove group");
    return result.output;
  },
};

// Set Node Meta Tool
export const setNodeMetaTool: ToolHandler = {
  definition: {
    name: "set_node_meta",
    description:
      "Set arbitrary metadata on a node (persisted with the scene). Useful for tagging nodes with authoring hints.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        scene_path: { type: "string" },
        node_path: { type: "string" },
        key: { type: "string", description: "Meta key." },
        value: { description: "Meta value (any JSON-serializable type)." },
      },
      required: ["scene_path", "node_path", "key", "value"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) throw new Error("Godot is not available");
    const { projectPath, scenePath } = await resolveScenePath(args);
    const result = await executor.execute(projectPath, "set_node_meta", {
      scene_path: scenePath,
      node_path: args.node_path as string,
      key: args.key as string,
      value: args.value,
    });
    if (!result.success) throw new Error(result.error || "Failed to set meta");
    return result.output;
  },
};

// Remove Node Meta Tool
export const removeNodeMetaTool: ToolHandler = {
  definition: {
    name: "remove_node_meta",
    description: "Remove a metadata key from a node.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        scene_path: { type: "string" },
        node_path: { type: "string" },
        key: { type: "string" },
      },
      required: ["scene_path", "node_path", "key"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) throw new Error("Godot is not available");
    const { projectPath, scenePath } = await resolveScenePath(args);
    const result = await executor.execute(projectPath, "remove_node_meta", {
      scene_path: scenePath,
      node_path: args.node_path as string,
      key: args.key as string,
    });
    if (!result.success) throw new Error(result.error || "Failed to remove meta");
    return result.output;
  },
};

// Connect Signal Tool
export const connectSignalTool: ToolHandler = {
  definition: {
    name: "connect_signal",
    description:
      "Connect a signal on a source node to a method on a target node, persisted with the scene (CONNECT_PERSIST by default). Both nodes must be in the same scene.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        scene_path: { type: "string" },
        source_node_path: { type: "string", description: "Node emitting the signal." },
        signal: { type: "string", description: "Signal name (e.g., 'pressed', 'body_entered')." },
        target_node_path: { type: "string", description: "Node hosting the method." },
        method: { type: "string", description: "Method name on the target to call when the signal fires." },
        flags: {
          type: "integer",
          description: "Optional Object.ConnectFlags bitmask. Defaults to CONNECT_PERSIST (8).",
          default: 8,
        },
      },
      required: ["scene_path", "source_node_path", "signal", "target_node_path", "method"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) throw new Error("Godot is not available");
    const { projectPath, scenePath } = await resolveScenePath(args);
    const result = await executor.execute(projectPath, "connect_signal", {
      scene_path: scenePath,
      source_node_path: args.source_node_path as string,
      signal: args.signal as string,
      target_node_path: args.target_node_path as string,
      method: args.method as string,
      flags: typeof args.flags === "number" ? args.flags : 8,
    });
    if (!result.success) throw new Error(result.error || "Failed to connect signal");
    return result.output;
  },
};

// Disconnect Signal Tool
export const disconnectSignalTool: ToolHandler = {
  definition: {
    name: "disconnect_signal",
    description: "Disconnect a previously-connected signal between two nodes in a scene.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        scene_path: { type: "string" },
        source_node_path: { type: "string" },
        signal: { type: "string" },
        target_node_path: { type: "string" },
        method: { type: "string" },
      },
      required: ["scene_path", "source_node_path", "signal", "target_node_path", "method"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) throw new Error("Godot is not available");
    const { projectPath, scenePath } = await resolveScenePath(args);
    const result = await executor.execute(projectPath, "disconnect_signal", {
      scene_path: scenePath,
      source_node_path: args.source_node_path as string,
      signal: args.signal as string,
      target_node_path: args.target_node_path as string,
      method: args.method as string,
    });
    if (!result.success) throw new Error(result.error || "Failed to disconnect signal");
    return result.output;
  },
};

export const sceneExtTools = [
  addNodeGroupTool,
  removeNodeGroupTool,
  setNodeMetaTool,
  removeNodeMetaTool,
  connectSignalTool,
  disconnectSignalTool,
];
