import type { ToolHandler } from "./types.js";
import type { GodotExecutor } from "../godot/executor.js";
import { isGodotProject } from "../godot/finder.js";

// Create Scene Tool
export const createSceneTool: ToolHandler = {
  definition: {
    name: "create_scene",
    description: "Create a new Godot scene file (.tscn) with a specified root node type",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Absolute path to the Godot project directory (containing project.godot)",
        },
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
      required: ["project_path", "scene_path"],
    },
  },
  async execute(args, executor) {
    const projectPath = args.project_path as string;
    const scenePath = args.scene_path as string;
    const rootType = (args.root_type as string) || "Node2D";
    const rootName = (args.root_name as string) || "Root";

    if (!executor) {
      throw new Error("Godot is not available. Please ensure Godot is installed and accessible.");
    }

    if (!(await isGodotProject(projectPath))) {
      throw new Error(`Not a valid Godot project: ${projectPath}`);
    }

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
        project_path: {
          type: "string",
          description: "Absolute path to the Godot project directory",
        },
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
      required: ["project_path", "scene_path", "node_type", "node_name"],
    },
  },
  async execute(args, executor) {
    const projectPath = args.project_path as string;
    const scenePath = args.scene_path as string;
    const parentPath = (args.parent_path as string) || ".";
    const nodeType = args.node_type as string;
    const nodeName = args.node_name as string;
    const properties = (args.properties as Record<string, unknown>) || {};

    if (!executor) {
      throw new Error("Godot is not available");
    }

    if (!(await isGodotProject(projectPath))) {
      throw new Error(`Not a valid Godot project: ${projectPath}`);
    }

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
        project_path: {
          type: "string",
          description: "Absolute path to the Godot project directory",
        },
        scene_path: {
          type: "string",
          description: "Path to the scene file",
        },
        node_path: {
          type: "string",
          description: "Path to the node to remove (relative to scene root)",
        },
      },
      required: ["project_path", "scene_path", "node_path"],
    },
  },
  async execute(args, executor) {
    const projectPath = args.project_path as string;
    const scenePath = args.scene_path as string;
    const nodePath = args.node_path as string;

    if (!executor) {
      throw new Error("Godot is not available");
    }

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
        project_path: {
          type: "string",
          description: "Absolute path to the Godot project directory",
        },
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
      required: ["project_path", "scene_path", "node_path", "properties"],
    },
  },
  async execute(args, executor) {
    const projectPath = args.project_path as string;
    const scenePath = args.scene_path as string;
    const nodePath = args.node_path as string;
    const properties = args.properties as Record<string, unknown>;

    if (!executor) {
      throw new Error("Godot is not available");
    }

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
        project_path: {
          type: "string",
          description: "Absolute path to the Godot project directory",
        },
        scene_path: {
          type: "string",
          description: "Path to the scene file to read",
        },
      },
      required: ["project_path", "scene_path"],
    },
  },
  async execute(args, executor) {
    const projectPath = args.project_path as string;
    const scenePath = args.scene_path as string;

    if (!executor) {
      throw new Error("Godot is not available");
    }

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
        project_path: {
          type: "string",
          description: "Absolute path to the Godot project directory",
        },
        scene_path: {
          type: "string",
          description: "Path to the scene file",
        },
      },
      required: ["project_path", "scene_path"],
    },
  },
  async execute(args, executor) {
    const projectPath = args.project_path as string;
    const scenePath = args.scene_path as string;

    if (!executor) {
      throw new Error("Godot is not available");
    }

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
