import type { ToolHandler } from "./types.js";
import { findScriptFiles } from "../godot/finder.js";
import * as fs from "fs/promises";
import { projectSelectorProperties, resolveProjectPath } from "./project-context.js";
import {
  normalizeResourcePath,
  resolveExistingProjectFilePath,
  resolveWritableProjectFilePath,
  SCENE_EXTENSIONS,
  SCRIPT_EXTENSIONS,
} from "./path-utils.js";

// Create Script Tool
export const createScriptTool: ToolHandler = {
  definition: {
    name: "create_script",
    description: "Create a new GDScript file with optional template or custom content",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        script_path: {
          type: "string",
          description: "Path for the new script file (e.g., 'res://scripts/player.gd')",
        },
        extends: {
          type: "string",
          description: "Base class the script extends (e.g., 'CharacterBody2D', 'Node')",
          default: "Node",
        },
        class_name: {
          type: "string",
          description: "Optional class_name for the script (makes it globally accessible)",
        },
        content: {
          type: "string",
          description: "Full script content. If provided, overrides template generation",
        },
        template: {
          type: "string",
          enum: ["default", "empty", "character_2d", "character_3d"],
          description: "Template to use if content is not provided",
          default: "default",
        },
      },
      required: ["script_path"],
    },
  },
  async execute(args, executor) {
    if (!executor) {
      throw new Error("Godot is not available");
    }

    const projectPath = await resolveProjectPath(args);
    const scriptPath = normalizeResourcePath(args.script_path as string, {
      fieldName: "script_path",
      extensions: SCRIPT_EXTENSIONS,
    });
    const extendsType = (args.extends as string) || "Node";
    const className = args.class_name as string | undefined;
    const content = args.content as string | undefined;
    const template = (args.template as string) || "default";

    const result = await executor.execute(projectPath, "create_script", {
      script_path: scriptPath,
      extends: extendsType,
      class_name: className || "",
      content: content || "",
      template,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to create script");
    }

    return result.output;
  },
};

// Attach Script Tool
export const attachScriptTool: ToolHandler = {
  definition: {
    name: "attach_script",
    description: "Attach an existing GDScript to a node in a scene",
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
          description: "Path to the node to attach the script to (use '.' for root)",
          default: ".",
        },
        script_path: {
          type: "string",
          description: "Path to the GDScript file to attach",
        },
      },
      required: ["scene_path", "script_path"],
    },
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
    const nodePath = (args.node_path as string) || ".";
    const scriptPath = normalizeResourcePath(args.script_path as string, {
      fieldName: "script_path",
      extensions: SCRIPT_EXTENSIONS,
    });

    const result = await executor.execute(projectPath, "attach_script", {
      scene_path: scenePath,
      node_path: nodePath,
      script_path: scriptPath,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to attach script");
    }

    return result.output;
  },
};

// Read Script Tool (direct file read, doesn't need Godot)
export const readScriptTool: ToolHandler = {
  definition: {
    name: "read_script",
    description: "Read the contents of a GDScript file",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        script_path: {
          type: "string",
          description: "Path to the script file (e.g., 'res://scripts/player.gd')",
        },
      },
      required: ["script_path"],
    },
  },
  async execute(args, _executor) {
    const projectPath = await resolveProjectPath(args);

    try {
      const { fsPath, resourcePath: scriptPath } = await resolveExistingProjectFilePath(
        projectPath,
        args.script_path as string,
        {
          fieldName: "script_path",
          extensions: SCRIPT_EXTENSIONS,
        }
      );
      const content = await fs.readFile(fsPath, "utf-8");
      return {
        script_path: scriptPath,
        content,
        line_count: content.split("\n").length,
      };
    } catch (error) {
      throw new Error(`Failed to read script: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

// Edit Script Tool (direct file write)
export const editScriptTool: ToolHandler = {
  definition: {
    name: "edit_script",
    description: "Edit an existing GDScript file by replacing its content",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        script_path: {
          type: "string",
          description: "Path to the script file",
        },
        content: {
          type: "string",
          description: "New content for the script file",
        },
      },
      required: ["script_path", "content"],
    },
  },
  async execute(args, _executor) {
    const content = args.content as string;

    const projectPath = await resolveProjectPath(args);
    const { fsPath, resourcePath: scriptPath } = await resolveWritableProjectFilePath(
      projectPath,
      args.script_path as string,
      {
        fieldName: "script_path",
        extensions: SCRIPT_EXTENSIONS,
      }
    );

    try {
      await fs.writeFile(fsPath, content, "utf-8");
      return {
        success: true,
        message: `Updated script at ${scriptPath}`,
        script_path: scriptPath,
      };
    } catch (error) {
      throw new Error(`Failed to edit script: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

// List Scripts Tool
export const listScriptsTool: ToolHandler = {
  definition: {
    name: "list_scripts",
    description: "List all GDScript files in the Godot project",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
      },
      required: [],
    },
  },
  async execute(args, _executor) {
    const projectPath = await resolveProjectPath(args);
    const scripts = await findScriptFiles(projectPath);

    return {
      project_path: projectPath,
      scripts,
      count: scripts.length,
    };
  },
};

export const scriptTools = [
  createScriptTool,
  attachScriptTool,
  readScriptTool,
  editScriptTool,
  listScriptsTool,
];
