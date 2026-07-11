import type { ToolHandler } from "./types.js";
import { destructiveAnnotations, readOnlyAnnotations } from "./types.js";
import { projectSelectorProperties, resolveProjectPath } from "./project-context.js";
import { normalizeResourcePath, SCENE_EXTENSIONS } from "./path-utils.js";
import { executeGodotOperation } from "./godot-operation.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateNodeSource(nodeType: unknown, instanceScenePath: unknown, allowNodeTypeFallback = false): void {
  const hasNodeType = typeof nodeType === "string" && nodeType.length > 0;
  const hasInstance = typeof instanceScenePath === "string" && instanceScenePath.length > 0;
  if ((!hasNodeType && !hasInstance) || (hasNodeType && hasInstance && !allowNodeTypeFallback)) {
    throw new Error("Exactly one of node_type or instance_scene_path is required");
  }
}

function normalizeSceneChanges(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error("changes must contain between 1 and 100 operations");
  }

  return value.map((change, index) => {
    if (!isRecord(change)) {
      throw new Error(`changes[${index}] must be an object`);
    }
    const operation = change.operation;
    if (operation === "add_node") {
      if (typeof change.node_name !== "string" || !change.node_name) {
        throw new Error(`changes[${index}].node_name is required for add_node`);
      }
      validateNodeSource(change.node_type, change.instance_scene_path);
      if (change.properties !== undefined && !isRecord(change.properties)) {
        throw new Error(`changes[${index}].properties must be an object`);
      }
      const instanceScenePath = typeof change.instance_scene_path === "string"
        ? normalizeResourcePath(change.instance_scene_path, {
          fieldName: `changes[${index}].instance_scene_path`,
          extensions: SCENE_EXTENSIONS,
        })
        : undefined;
      return {
        operation,
        parent_path: typeof change.parent_path === "string" && change.parent_path ? change.parent_path : ".",
        node_name: change.node_name,
        ...(typeof change.node_type === "string" ? { node_type: change.node_type } : {}),
        ...(instanceScenePath ? { instance_scene_path: instanceScenePath } : {}),
        properties: change.properties ?? {},
      };
    }

    if (operation === "modify_node") {
      if (typeof change.node_path !== "string" || !change.node_path) {
        throw new Error(`changes[${index}].node_path is required for modify_node`);
      }
      if (!isRecord(change.properties) || Object.keys(change.properties).length === 0) {
        throw new Error(`changes[${index}].properties must be a non-empty object for modify_node`);
      }
      return { operation, node_path: change.node_path, properties: change.properties };
    }

    if (operation === "remove_node") {
      if (typeof change.node_path !== "string" || !change.node_path) {
        throw new Error(`changes[${index}].node_path is required for remove_node`);
      }
      if (change.node_path === ".") {
        throw new Error(`changes[${index}] cannot remove the scene root`);
      }
      return { operation, node_path: change.node_path };
    }

    if (operation === "rename_node") {
      if (typeof change.node_path !== "string" || !change.node_path || typeof change.new_name !== "string" || !change.new_name) {
        throw new Error(`changes[${index}] requires node_path and new_name for rename_node`);
      }
      return { operation, node_path: change.node_path, new_name: change.new_name };
    }

    if (operation === "reparent_node") {
      if (typeof change.node_path !== "string" || !change.node_path || typeof change.new_parent_path !== "string" || !change.new_parent_path) {
        throw new Error(`changes[${index}] requires node_path and new_parent_path for reparent_node`);
      }
      return { operation, node_path: change.node_path, new_parent_path: change.new_parent_path };
    }

    throw new Error(`changes[${index}].operation must be add_node, modify_node, remove_node, rename_node, or reparent_node`);
  });
}

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
          description: "Type of node to add (e.g., 'Sprite2D', 'Camera2D', 'CollisionShape2D'). Ignored when instance_scene_path is provided.",
        },
        node_name: {
          type: "string",
          description: "Name for the new node",
        },
        instance_scene_path: {
          type: "string",
          description: "Optional res:// path to a scene (.tscn/.scn) to instantiate as a child instead of node_type. Useful for composing scenes.",
        },
        properties: {
          type: "object",
          description: "Optional properties to set on the node. For Vector2/Vector3/Color use {_type:'Vector2',x,y}. For Resource-typed properties (material, mesh, shape, etc.) use {_type:'Resource', path:'res://foo.tres'}.",
          additionalProperties: true,
        },
      },
      required: ["scene_path", "node_name"],
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
    const instanceScenePath = typeof args.instance_scene_path === "string" && args.instance_scene_path
      ? normalizeResourcePath(args.instance_scene_path, {
        fieldName: "instance_scene_path",
        extensions: SCENE_EXTENSIONS,
      })
      : undefined;
    validateNodeSource(nodeType, instanceScenePath, true);

    const result = await executor.execute(projectPath, "add_node", {
      scene_path: scenePath,
      parent_path: parentPath,
      node_type: nodeType,
      node_name: nodeName,
      properties,
      ...(instanceScenePath ? { instance_scene_path: instanceScenePath } : {}),
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to add node");
    }

    return result.output;
  },
};

// Apply Scene Changes Tool
export const applySceneChangesTool: ToolHandler = {
  definition: {
    name: "apply_scene_changes",
    description:
      "Apply an ordered transaction of node additions, property changes, and removals to one scene. The scene is loaded once and saved once; if any change fails, none are saved.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        scene_path: {
          type: "string",
          description: "Path to the existing scene file.",
        },
        changes: {
          type: "array",
          description:
            "Ordered changes. Supports add_node, modify_node, remove_node, rename_node, and reparent_node.",
          items: {
            type: "object",
            properties: {
              operation: { type: "string", enum: ["add_node", "modify_node", "remove_node", "rename_node", "reparent_node"] },
              parent_path: { type: "string" },
              node_path: { type: "string" },
              node_type: { type: "string" },
              node_name: { type: "string" },
              new_name: { type: "string" },
              new_parent_path: { type: "string" },
              instance_scene_path: { type: "string" },
              properties: { type: "object", additionalProperties: true },
            },
            required: ["operation"],
            additionalProperties: false,
          },
        },
        expected_sha256: {
          type: "string",
          description: "Optional SHA-256 returned by read_scene. It is checked before preparing and immediately before committing changes.",
        },
      },
      required: ["scene_path", "changes"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    const projectPath = await resolveProjectPath(args);
    const scenePath = normalizeResourcePath(args.scene_path as string, {
      fieldName: "scene_path",
      extensions: SCENE_EXTENSIONS,
    });
    const changes = normalizeSceneChanges(args.changes);
    const expectedSha256 = args.expected_sha256;
    if (expectedSha256 !== undefined && (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(expectedSha256))) {
      throw new Error("expected_sha256 must be a 64-character hexadecimal SHA-256");
    }

    return executeGodotOperation(
      executor,
      projectPath,
      "apply_scene_changes",
      { scene_path: scenePath, changes, ...(expectedSha256 ? { expected_sha256: expectedSha256 } : {}) },
      "Failed to apply scene changes"
    );
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

    return executeGodotOperation(
      executor,
      projectPath,
      "read_scene",
      { scene_path: scenePath },
      "Failed to read scene"
    );
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
  applySceneChangesTool,
  readSceneTool,
  listNodesTool,
];
