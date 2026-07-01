import type { ToolHandler } from "./types.js";
import { destructiveAnnotations, readOnlyAnnotations } from "./types.js";
import { projectSelectorProperties, resolveProjectPath } from "./project-context.js";
import { normalizeResourcePath, SCENE_EXTENSIONS } from "./path-utils.js";

// Create Scene Tool
export const createSceneTool: ToolHandler = {
  definition: {
    name: "create_scene",
    description: "Create a new Godot scene file (.tscn) with a specified root node type",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        scene_path: {
          type: "string",
          description: "Path for the new scene file relative to project root (e.g., 'res://scenes/main.tscn')",
        },
        root_type: {
          type: "string",
          description: "Type of the root node (e.g., 'Node2D', 'Node3D', 'Control')",
          default: "Node2D",
        },
        root_name: {
          type: "string",
          description: "Name of the root node",
          default: "Root",
        },
      },
      required: ["scene_path"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) {
      throw new Error("Godot is not available. Please ensure Godot is installed and accessible.");
    }

    const projectPath = await resolveProjectPath(args);
    const scenePath = normalizeResourcePath(args.scene_path as string, {
      fieldName: "scene_path",
      extensions: SCENE_EXTENSIONS,
    });
    const rootType = (args.root_type as string) || "Node2D";
    const rootName = (args.root_name as string) || "Root";

    const result = await executor.execute(projectPath, "create_scene", {
      scene_path: scenePath,
      root_type: rootType,
      root_name: rootName,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to create scene");
    }

    return result.output;
  },
};

// Add Node Tool
export const addNodeTool: ToolHandler = {
  definition: {
    name: "add_node",
    description: "Add a new node to an existing Godot scene",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        scene_path: {
          type: "string",
          description: "Path to the scene file (e.g., 'res://scenes/main.tscn')",
        },
        parent_path: {
          type: "string",
          description: "Node path of the parent node (use '.' for root node)",
          default: ".",
        },
        node_type: {
          type: "string",
          description: "Type of node to add (e.g., 'Sprite2D', 'Camera2D', 'CollisionShape2D')",
        },
        node_name: {
          type: "string",
          description: "Name for the new node",
        },
        properties: {
          type: "object",
          description: "Optional properties to set on the node",
          additionalProperties: true,
        },
      },
      required: ["scene_path", "node_type", "node_name"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) {
      throw new Error("Godot is not available");
    }

    const projectPath = await resolveProjectPath(args);
    const scenePath = normalizeResourcePath(args.scene_path as string, {
      fieldName: "scene_path",
      extensions: SCENE_EXTENSIONS,
    });
    const parentPath = (args.parent_path as string) || ".";
    const nodeType = args.node_type as string;
    const nodeName = args.node_name as string;
    const properties = (args.properties as Record<string, unknown>) || {};

    const result = await executor.execute(projectPath, "add_node", {
      scene_path: scenePath,
      parent_path: parentPath,
      node_type: nodeType,
      node_name: nodeName,
      properties,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to add node");
    }

    return result.output;
  },
};

// Remove Node Tool
export const removeNodeTool: ToolHandler = {
  definition: {
    name: "remove_node",
    description: "Remove a node from a Godot scene",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        scene_path: {
          type: "string",
          description: "Path to the scene file",
        },
        node_path: {
          type: "string",
          description: "Path to the node to remove (relative to scene root)",
        },
      },
      required: ["scene_path", "node_path"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) {
      throw new Error("Godot is not available");
    }

    const projectPath = await resolveProjectPath(args);
    const scenePath = normalizeResourcePath(args.scene_path as string, {
      fieldName: "scene_path",
      extensions: SCENE_EXTENSIONS,
    });
    const nodePath = args.node_path as string;

    const result = await executor.execute(projectPath, "remove_node", {
      scene_path: scenePath,
      node_path: nodePath,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to remove node");
    }

    return result.output;
  },
};

// Modify Node Tool
export const modifyNodeTool: ToolHandler = {
  definition: {
    name: "modify_node",
    description: "Modify properties of an existing node in a Godot scene",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        scene_path: {
          type: "string",
          description: "Path to the scene file",
        },
        node_path: {
          type: "string",
          description: "Path to the node to modify (use '.' for root)",
        },
        properties: {
          type: "object",
          description: "Properties to set on the node. For Vector2/Vector3/Color, use objects like {_type: 'Vector2', x: 100, y: 200}",
          additionalProperties: true,
        },
      },
      required: ["scene_path", "node_path", "properties"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) {
      throw new Error("Godot is not available");
    }

    const projectPath = await resolveProjectPath(args);
    const scenePath = normalizeResourcePath(args.scene_path as string, {
      fieldName: "scene_path",
      extensions: SCENE_EXTENSIONS,
    });
    const nodePath = args.node_path as string;
    const properties = args.properties as Record<string, unknown>;

    const result = await executor.execute(projectPath, "modify_node", {
      scene_path: scenePath,
      node_path: nodePath,
      properties,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to modify node");
    }

    return result.output;
  },
};

// Read Scene Tool
export const readSceneTool: ToolHandler = {
  definition: {
    name: "read_scene",
    description: "Read and return the structure of a Godot scene as JSON",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        scene_path: {
          type: "string",
          description: "Path to the scene file to read",
        },
      },
      required: ["scene_path"],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args, executor) {
    if (!executor) {
      throw new Error("Godot is not available");
    }

    const projectPath = await resolveProjectPath(args);
    const scenePath = normalizeResourcePath(args.scene_path as string, {
      fieldName: "scene_path",
      extensions: SCENE_EXTENSIONS,
    });

    const result = await executor.execute(projectPath, "read_scene", {
      scene_path: scenePath,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to read scene");
    }

    return result.output;
  },
};

// List Nodes Tool
export const listNodesTool: ToolHandler = {
  definition: {
    name: "list_nodes",
    description: "List all nodes in a Godot scene with their paths and types",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        scene_path: {
          type: "string",
          description: "Path to the scene file",
        },
      },
      required: ["scene_path"],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args, executor) {
    if (!executor) {
      throw new Error("Godot is not available");
    }

    const projectPath = await resolveProjectPath(args);
    const scenePath = normalizeResourcePath(args.scene_path as string, {
      fieldName: "scene_path",
      extensions: SCENE_EXTENSIONS,
    });

    const result = await executor.execute(projectPath, "list_nodes", {
      scene_path: scenePath,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to list nodes");
    }

    return result.output;
  },
};

export const sceneTools = [
  createSceneTool,
  addNodeTool,
  removeNodeTool,
  modifyNodeTool,
  readSceneTool,
  listNodesTool,
];
