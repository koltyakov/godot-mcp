import type { ToolHandler } from "./types.js";
import type { GodotExecutor } from "../godot/executor.js";
import { isGodotProject, findSceneFiles, findScriptFiles } from "../godot/finder.js";
import * as fs from "fs/promises";
import * as path from "path";

// Get Project Info Tool
export const getProjectInfoTool: ToolHandler = {
  definition: {
    name: "get_project_info",
    description: "Get information about a Godot project including name, main scene, and Godot version",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Absolute path to the Godot project directory",
        },
      },
      required: ["project_path"],
    },
  },
  async execute(args, executor) {
    const projectPath = args.project_path as string;

    if (!(await isGodotProject(projectPath))) {
      throw new Error(`Not a valid Godot project: ${projectPath}`);
    }

    // Read project.godot file directly for basic info even without Godot
    const projectFile = path.join(projectPath, "project.godot");
    const content = await fs.readFile(projectFile, "utf-8");
    
    const getConfigValue = (section: string, key: string): string | undefined => {
      const regex = new RegExp(`\\[${section}\\][\\s\\S]*?${key}\\s*=\\s*"?([^"\\n]+)"?`, "m");
      const match = content.match(regex);
      return match?.[1];
    };

    const projectName = getConfigValue("application", "config/name") || "Unknown";
    const mainScene = getConfigValue("application", "run/main_scene") || "";
    
    // Get scenes and scripts count
    const scenes = await findSceneFiles(projectPath);
    const scripts = await findScriptFiles(projectPath);

    const result: Record<string, unknown> = {
      project_name: projectName,
      project_path: projectPath,
      main_scene: mainScene,
      scene_count: scenes.length,
      script_count: scripts.length,
    };

    // If executor is available, get Godot version
    if (executor) {
      const version = await executor.getVersion();
      result.godot_version = version;
    }

    return result;
  },
};

// List Scenes Tool
export const listScenesTool: ToolHandler = {
  definition: {
    name: "list_scenes",
    description: "List all scene files (.tscn, .scn) in a Godot project",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Absolute path to the Godot project directory",
        },
      },
      required: ["project_path"],
    },
  },
  async execute(args, _executor) {
    const projectPath = args.project_path as string;

    if (!(await isGodotProject(projectPath))) {
      throw new Error(`Not a valid Godot project: ${projectPath}`);
    }

    const scenes = await findSceneFiles(projectPath);

    return {
      project_path: projectPath,
      scenes,
      count: scenes.length,
    };
  },
};

// Launch Editor Tool
export const launchEditorTool: ToolHandler = {
  definition: {
    name: "launch_editor",
    description: "Launch the Godot editor for a project",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Absolute path to the Godot project directory",
        },
      },
      required: ["project_path"],
    },
  },
  async execute(args, executor) {
    const projectPath = args.project_path as string;

    if (!executor) {
      throw new Error("Godot is not available");
    }

    if (!(await isGodotProject(projectPath))) {
      throw new Error(`Not a valid Godot project: ${projectPath}`);
    }

    const result = await executor.launchEditor(projectPath);
    return result.output;
  },
};

// Run Project Tool
export const runProjectTool: ToolHandler = {
  definition: {
    name: "run_project",
    description: "Run a Godot project",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Absolute path to the Godot project directory",
        },
      },
      required: ["project_path"],
    },
  },
  async execute(args, executor) {
    const projectPath = args.project_path as string;

    if (!executor) {
      throw new Error("Godot is not available");
    }

    if (!(await isGodotProject(projectPath))) {
      throw new Error(`Not a valid Godot project: ${projectPath}`);
    }

    const result = await executor.runProject(projectPath);
    return result.output;
  },
};

// Get Godot Version Tool
export const getGodotVersionTool: ToolHandler = {
  definition: {
    name: "get_godot_version",
    description: "Get the version of the Godot engine being used",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  async execute(_args, executor) {
    if (!executor) {
      throw new Error("Godot is not available. Please install Godot and ensure it's in your PATH or set GODOT_PATH environment variable.");
    }

    const version = await executor.getVersion();
    const godotPath = executor.getGodotPath();

    return {
      version,
      path: godotPath,
    };
  },
};

// Create Resource Tool
export const createResourceTool: ToolHandler = {
  definition: {
    name: "create_resource",
    description: "Create a Godot resource file (.tres) like shapes, materials, or other resources",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Absolute path to the Godot project directory",
        },
        resource_path: {
          type: "string",
          description: "Path for the new resource file (e.g., 'res://resources/my_material.tres')",
        },
        resource_type: {
          type: "string",
          description: "Type of resource to create (e.g., 'CircleShape2D', 'StandardMaterial3D', 'BoxMesh')",
        },
        properties: {
          type: "object",
          description: "Properties to set on the resource",
          additionalProperties: true,
        },
      },
      required: ["project_path", "resource_path", "resource_type"],
    },
  },
  async execute(args, executor) {
    const projectPath = args.project_path as string;
    const resourcePath = args.resource_path as string;
    const resourceType = args.resource_type as string;
    const properties = (args.properties as Record<string, unknown>) || {};

    if (!executor) {
      throw new Error("Godot is not available");
    }

    if (!(await isGodotProject(projectPath))) {
      throw new Error(`Not a valid Godot project: ${projectPath}`);
    }

    const result = await executor.execute(projectPath, "create_resource", {
      resource_path: resourcePath,
      resource_type: resourceType,
      properties,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to create resource");
    }

    return result.output;
  },
};

// Initialize Project Tool (creates project.godot)
export const initProjectTool: ToolHandler = {
  definition: {
    name: "init_project",
    description: "Initialize a new Godot project by creating project.godot file",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Absolute path where the project should be created",
        },
        project_name: {
          type: "string",
          description: "Name of the project",
        },
        renderer: {
          type: "string",
          enum: ["forward_plus", "mobile", "gl_compatibility"],
          description: "Rendering method to use",
          default: "forward_plus",
        },
      },
      required: ["project_path", "project_name"],
    },
  },
  async execute(args, _executor) {
    const projectPath = args.project_path as string;
    const projectName = args.project_name as string;
    const renderer = (args.renderer as string) || "forward_plus";

    // Check if project already exists
    const projectFile = path.join(projectPath, "project.godot");
    try {
      await fs.access(projectFile);
      throw new Error(`Project already exists at ${projectPath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    // Create project directory
    await fs.mkdir(projectPath, { recursive: true });

    // Create project.godot
    const projectContent = `; Engine configuration file.
; It's best edited using the editor UI and not directly,
; since the parameters that go here are not all obvious.
;
; Format:
;   [section] ; section goes between []
;   param=value ; assign values to parameters

config_version=5

[application]

config/name="${projectName}"
config/features=PackedStringArray("4.3", "Forward Plus")

[rendering]

renderer/rendering_method="${renderer}"
`;

    await fs.writeFile(projectFile, projectContent, "utf-8");

    // Create standard directories
    const dirs = ["scenes", "scripts", "resources", "assets"];
    for (const dir of dirs) {
      await fs.mkdir(path.join(projectPath, dir), { recursive: true });
      // Create .gdignore placeholder to keep empty dirs
      await fs.writeFile(path.join(projectPath, dir, ".gitkeep"), "", "utf-8");
    }

    return {
      success: true,
      message: `Created new Godot project "${projectName}" at ${projectPath}`,
      project_path: projectPath,
      created_directories: dirs,
    };
  },
};

export const projectTools = [
  getProjectInfoTool,
  listScenesTool,
  launchEditorTool,
  runProjectTool,
  getGodotVersionTool,
  createResourceTool,
  initProjectTool,
];
