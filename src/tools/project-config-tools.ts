import type { ToolHandler } from "./types.js";
import { destructiveAnnotations, readOnlyAnnotations } from "./types.js";
import { projectSelectorProperties, resolveProjectPath } from "./project-context.js";
import { executeGodotOperation } from "./godot-operation.js";
import { normalizeResourcePath, resolveExistingProjectFilePath, SCENE_EXTENSIONS, SCRIPT_EXTENSIONS } from "./path-utils.js";

const AUTOLOAD_EXTENSIONS = [...SCRIPT_EXTENSIONS, ...SCENE_EXTENSIONS] as const;

// ClassDB Info Tool — Godot class introspection (methods, properties, signals, enums, etc.)
export const getClassInfoTool: ToolHandler = {
  definition: {
    name: "get_class_info",
    description:
      "Introspect a Godot class via ClassDB: list its parent, methods, properties, signals, enums, constants, and default property values. Without a class name, returns the list of all known classes. Useful for understanding the Godot API before authoring scripts or scenes.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        class: {
          type: "string",
          description: "Class name to introspect (e.g., 'CharacterBody2D', 'Sprite2D'). Omit to list all classes.",
        },
        include: {
          type: "array",
          items: {
            type: "string",
            enum: ["methods", "properties", "signals", "enums", "constants", "inheritance", "default_values"],
          },
          description:
            "Which facets to include. Defaults to ['methods','properties','signals','enums','constants']. Add 'inheritance' for parent chain and 'default_values' for default property values.",
        },
      },
      required: [],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args, executor) {
    const projectPath = await resolveProjectPath(args);
    const classArg = typeof args.class === "string" ? args.class : "";
    const include = Array.isArray(args.include) ? args.include : undefined;

    return executeGodotOperation(
      executor,
      projectPath,
      "classdb_info",
      {
        class: classArg,
        ...(include ? { include } : {}),
      },
      "Failed to introspect class"
    );
  },
};

// Script Compile-Check Tool — validate GDScript without saving
export const checkScriptTool: ToolHandler = {
  definition: {
    name: "check_script",
    description:
      "Compile-check GDScript source without writing it to disk. Returns errors/warnings with line+column. Pass 'source' to validate inline, or 'script_path' to check an existing file.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        source: {
          type: "string",
          description: "Full GDScript source to validate. Takes precedence over script_path.",
        },
        script_path: {
          type: "string",
          description: "Optional res:// path of an existing script to validate on disk.",
        },
      },
      required: [],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args, executor) {
    const projectPath = await resolveProjectPath(args);
    const source = typeof args.source === "string" ? args.source : "";
    const scriptPath = typeof args.script_path === "string" && args.script_path
      ? normalizeResourcePath(args.script_path, {
        fieldName: "script_path",
        extensions: SCRIPT_EXTENSIONS,
      })
      : "";

    const resolvedScriptPath = scriptPath
      ? (await resolveExistingProjectFilePath(projectPath, scriptPath, {
        fieldName: "script_path",
        extensions: SCRIPT_EXTENSIONS,
      })).resourcePath
      : "";

    if (!source && !scriptPath) {
      throw new Error("Provide 'source' (inline GDScript) or 'script_path' (existing file) to validate.");
    }

    return executeGodotOperation(
      executor,
      projectPath,
      "compile_script",
      { source, script_path: resolvedScriptPath },
      "Failed to compile script"
    );
  },
};

// Project Settings Read Tool
export const getProjectSettingsTool: ToolHandler = {
  definition: {
    name: "get_project_settings",
    description:
      "Read sections/keys from project.godot as authored. Returns a structured object per section. Pass section/key to filter.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        section: {
          type: "string",
          description: "Optional section filter (e.g., 'application', 'rendering', 'input', 'autoload', 'display').",
        },
        key: {
          type: "string",
          description: "Optional key filter within the section.",
        },
      },
      required: [],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args, executor) {
    const projectPath = await resolveProjectPath(args);
    const section = typeof args.section === "string" ? args.section : "";
    const key = typeof args.key === "string" ? args.key : "";

    return executeGodotOperation(
      executor,
      projectPath,
      "get_project_settings",
      { section, key },
      "Failed to read project settings"
    );
  },
};

// Project Setting Write Tool
export const setProjectSettingTool: ToolHandler = {
  definition: {
    name: "set_project_setting",
    description:
      "Write a single setting to project.godot (via ProjectSettings). Rewrites project.godot — callers should read first to confirm intent.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        section: { type: "string", description: "Section (e.g., 'application', 'rendering', 'display')." },
        key: { type: "string", description: "Key within the section (e.g., 'config/name')." },
        value: { description: "Value to set. Strings, numbers, bools, arrays, dicts all OK." },
      },
      required: ["section", "key", "value"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    const projectPath = await resolveProjectPath(args);
    const section = args.section as string;
    const key = args.key as string;
    const value = args.value;

    return executeGodotOperation(
      executor,
      projectPath,
      "set_project_setting",
      { section, key, value },
      "Failed to set project setting"
    );
  },
};

// List Autoloads Tool
export const listAutoloadsTool: ToolHandler = {
  definition: {
    name: "list_autoloads",
    description: "List autoload singletons registered in project.godot (name, res:// path, singleton flag).",
    inputSchema: {
      type: "object",
      properties: { ...projectSelectorProperties },
      required: [],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args, executor) {
    const projectPath = await resolveProjectPath(args);
    return executeGodotOperation(executor, projectPath, "list_autoloads", {}, "Failed to list autoloads");
  },
};

// Set Autoload Tool
export const setAutoloadTool: ToolHandler = {
  definition: {
    name: "set_autoload",
    description:
      "Register or update an autoload singleton in project.godot. Pass singleton=false for a non-singleton autoload (still instantiated at startup but not globally accessible).",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        name: { type: "string", description: "Autoload name (becomes the global identifier when singleton=true)." },
        path: { type: "string", description: "res:// path of the script or scene to autoload (e.g., 'res://globals.gd')." },
        singleton: { type: "boolean", description: "Whether to expose as a global singleton (default true).", default: true },
      },
      required: ["name", "path"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    const projectPath = await resolveProjectPath(args);
    const name = args.name as string;
    const autoloadPath = normalizeResourcePath(args.path as string, {
      fieldName: "path",
      extensions: AUTOLOAD_EXTENSIONS,
    });
    const resolvedAutoload = await resolveExistingProjectFilePath(projectPath, autoloadPath, {
      fieldName: "path",
      extensions: AUTOLOAD_EXTENSIONS,
    });
    const singleton = args.singleton !== undefined ? Boolean(args.singleton) : true;

    return executeGodotOperation(
      executor,
      projectPath,
      "set_autoload",
      { name, path: resolvedAutoload.resourcePath, singleton },
      "Failed to set autoload"
    );
  },
};

// Remove Autoload Tool
export const removeAutoloadTool: ToolHandler = {
  definition: {
    name: "remove_autoload",
    description: "Remove an autoload entry from project.godot by name.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        name: { type: "string", description: "Autoload name to remove." },
      },
      required: ["name"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    const projectPath = await resolveProjectPath(args);
    const name = args.name as string;
    return executeGodotOperation(executor, projectPath, "remove_autoload", { name }, "Failed to remove autoload");
  },
};

// List Input Actions Tool
export const listInputActionsTool: ToolHandler = {
  definition: {
    name: "list_input_actions",
    description:
      "List InputMap actions registered in the project, each with deadzone and bound InputEvents (keys, buttons, joypad). Built-in ui_* actions are filtered out by default.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        include_builtin: {
          type: "boolean",
          description: "Include built-in ui_* actions in the response. Default false.",
          default: false,
        },
      },
      required: [],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args, executor) {
    const projectPath = await resolveProjectPath(args);
    const includeBuiltin = args.include_builtin !== undefined ? Boolean(args.include_builtin) : false;
    return executeGodotOperation(
      executor,
      projectPath,
      "list_input_actions",
      { include_builtin: includeBuiltin },
      "Failed to list input actions"
    );
  },
};

export const projectConfigTools = [
  getClassInfoTool,
  checkScriptTool,
  getProjectSettingsTool,
  setProjectSettingTool,
  listAutoloadsTool,
  setAutoloadTool,
  removeAutoloadTool,
  listInputActionsTool,
];
