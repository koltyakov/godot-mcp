import type { ToolHandler } from "./types.js";
import { destructiveAnnotations, readOnlyAnnotations } from "./types.js";
import { findOpenGodotProjects, findSceneFiles } from "../godot/finder.js";
import { parseGodotDiagnostics } from "../godot/diagnostics.js";
import * as fs from "fs/promises";
import * as path from "path";
import { executeGodotOperation } from "./godot-operation.js";
import { projectSelectorProperties, resolveProjectPath } from "./project-context.js";
import {
  normalizeAbsoluteProjectPath,
  normalizeResourcePath,
  RESOURCE_EXTENSIONS,
  SCENE_EXTENSIONS,
} from "./path-utils.js";

function formatConfigString(value: string): string {
  return JSON.stringify(value);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, name: string): number {
  const result = value === undefined ? fallback : value;
  if (!Number.isInteger(result) || (result as number) < minimum || (result as number) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return result as number;
}

function limitOutput(value: string, maximum: number): { text: string; truncated: boolean } {
  const text = value.trim();
  if (text.length <= maximum) {
    return { text, truncated: false };
  }
  return { text: text.slice(text.length - maximum), truncated: true };
}

// Get Project Info Tool
export const getProjectInfoTool: ToolHandler = {
  definition: {
    name: "get_project_info",
    description: "Get information about a Godot project including name, main scene, and Godot version",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
      },
      required: [],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args, executor) {
    const projectPath = await resolveProjectPath(args);

    return executeGodotOperation(executor, projectPath, "get_project_info", {}, "Failed to get project info");
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
        ...projectSelectorProperties,
      },
      required: [],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args, _executor) {
    const projectPath = await resolveProjectPath(args);
    const scenes = await findSceneFiles(projectPath);
    return { success: true, project_path: projectPath, scenes, count: scenes.length };
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
        ...projectSelectorProperties,
      },
      required: [],
    },
    annotations: { openWorldHint: true },
  },
  async execute(args, executor) {
    if (!executor) {
      throw new Error("Godot is not available");
    }

    const projectPath = await resolveProjectPath(args);

    const result = await executor.launchEditor(projectPath);
    if (!result.success) {
      throw new Error(result.error || "Failed to launch Godot editor");
    }

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
        ...projectSelectorProperties,
      },
      required: [],
    },
    annotations: { openWorldHint: true },
  },
  async execute(args, executor) {
    if (!executor) {
      throw new Error("Godot is not available");
    }

    const projectPath = await resolveProjectPath(args);

    const result = await executor.runProject(projectPath);
    if (!result.success) {
      throw new Error(result.error || "Failed to run Godot project");
    }

    return result.output;
  },
};

// Run Project Diagnostics Tool
export const runProjectDiagnosticsTool: ToolHandler = {
  mayMutateProject: true,
  definition: {
    name: "run_project_diagnostics",
    description:
      "Run a Godot project or scene headlessly for a bounded number of frames and return structured parser, script, runtime, and engine diagnostics with captured output.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        scene_path: {
          type: "string",
          description: "Optional res:// scene path to run instead of the project's main scene.",
        },
        frames: {
          type: "integer",
          description: "Number of frames to run before Godot exits.",
          default: 120,
          minimum: 1,
          maximum: 3600,
        },
        fixed_fps: {
          type: "integer",
          description: "Optional fixed simulation FPS for deterministic diagnostics.",
          minimum: 1,
          maximum: 240,
        },
        debug: {
          type: "boolean",
          description: "Run with Godot debug mode enabled.",
          default: true,
        },
        timeout_ms: {
          type: "integer",
          description: "Hard process timeout in milliseconds.",
          default: 30000,
          minimum: 1000,
          maximum: 120000,
        },
        max_output_chars: {
          type: "integer",
          description: "Maximum characters returned for each output stream. Diagnostics are parsed before this limit is applied.",
          default: 50000,
          minimum: 1000,
          maximum: 1000000,
        },
      },
      required: [],
    },
    annotations: { openWorldHint: true },
  },
  async execute(args, executor) {
    if (!executor) {
      throw new Error("Godot is not available");
    }

    const projectPath = await resolveProjectPath(args);
    const scenePath = args.scene_path === undefined
      ? undefined
      : normalizeResourcePath(args.scene_path as string, {
        fieldName: "scene_path",
        extensions: SCENE_EXTENSIONS,
      });
    const frames = boundedInteger(args.frames, 120, 1, 3600, "frames");
    const fixedFps = args.fixed_fps === undefined
      ? undefined
      : boundedInteger(args.fixed_fps, 60, 1, 240, "fixed_fps");
    const timeoutMs = boundedInteger(args.timeout_ms, 30_000, 1_000, 120_000, "timeout_ms");
    const maxOutputChars = boundedInteger(args.max_output_chars, 50_000, 1_000, 1_000_000, "max_output_chars");
    const debug = args.debug === undefined ? true : args.debug === true;

    const processResult = await executor.runProjectDiagnostics(projectPath, {
      scenePath,
      frames,
      fixedFps,
      debug,
      timeoutMs,
    });
    const diagnostics = parseGodotDiagnostics(`${processResult.stdout}\n${processResult.stderr}`);
    const stdout = limitOutput(processResult.stdout, maxOutputChars);
    const stderr = limitOutput(processResult.stderr, maxOutputChars);
    const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
    const warningCount = diagnostics.length - errorCount;

    return {
      ok: processResult.success && errorCount === 0,
      exit_code: processResult.exitCode,
      timed_out: processResult.timedOut,
      duration_ms: processResult.durationMs,
      scene_path: scenePath ?? null,
      frames,
      fixed_fps: fixedFps ?? null,
      debug,
      summary: { errors: errorCount, warnings: warningCount },
      diagnostics,
      stdout: stdout.text,
      stderr: stderr.text,
      output_truncated: processResult.truncated || stdout.truncated || stderr.truncated,
      ...(processResult.error ? { process_error: processResult.error } : {}),
    };
  },
};

// List Open Projects Tool
export const listOpenProjectsTool: ToolHandler = {
  definition: {
    name: "list_open_projects",
    description: "List Godot projects currently opened by running Godot editor processes",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(_args, _executor) {
    const projects = await findOpenGodotProjects();
    return {
      projects,
      count: projects.length,
      default_project: projects.length === 1 ? projects[0] : null,
    };
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
    annotations: readOnlyAnnotations,
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
        ...projectSelectorProperties,
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
      required: ["resource_path", "resource_type"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) {
      throw new Error("Godot is not available");
    }

    const projectPath = await resolveProjectPath(args);
    const resourcePath = normalizeResourcePath(args.resource_path as string, {
      fieldName: "resource_path",
      extensions: RESOURCE_EXTENSIONS,
    });
    const resourceType = args.resource_type as string;
    const properties = (args.properties as Record<string, unknown>) || {};

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

// Run Godot Script Tool
export const runGodotScriptTool: ToolHandler = {
  definition: {
    name: "run_godot_script",
    description: "Run custom GDScript inside a Godot project and return its result",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        script: {
          type: "string",
          description: "Full GDScript source. Define a method named by method, default run(params: Dictionary).",
        },
        method: {
          type: "string",
          description: "Method to call on the script instance",
          default: "run",
        },
        parameters: {
          type: "object",
          description: "Dictionary passed as the only argument to the method",
          additionalProperties: true,
        },
      },
      required: ["script"],
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  async execute(args, executor) {
    const projectPath = await resolveProjectPath(args);
    const script = args.script as string;
    const method = (args.method as string | undefined) || "run";
    const parameters = (args.parameters as Record<string, unknown> | undefined) || {};

    return executeGodotOperation(
      executor,
      projectPath,
      "run_godot_script",
      { script, method, parameters },
      "Failed to run Godot script"
    );
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
    annotations: destructiveAnnotations,
  },
  async execute(args, _executor) {
    const projectPath = normalizeAbsoluteProjectPath(args.project_path as string);
    const projectName = args.project_name as string;
    const renderer = (args.renderer as string) || "forward_plus";

    if (!["forward_plus", "mobile", "gl_compatibility"].includes(renderer)) {
      throw new Error(`Invalid renderer: ${renderer}`);
    }

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

config/name=${formatConfigString(projectName)}
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
  runProjectDiagnosticsTool,
  listOpenProjectsTool,
  getGodotVersionTool,
  createResourceTool,
  runGodotScriptTool,
  initProjectTool,
];
