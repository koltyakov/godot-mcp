import type { ToolHandler } from "./types.js";
import { destructiveAnnotations, readOnlyAnnotations } from "./types.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { findScriptFiles } from "../godot/finder.js";
import { projectSelectorProperties, resolveProjectPath } from "./project-context.js";
import {
  normalizeResourcePath,
  resolveExistingProjectFilePath,
  resolveWritableProjectFilePath,
  SCENE_EXTENSIONS,
  SCRIPT_EXTENSIONS,
} from "./path-utils.js";

async function fileSha256(filePath: string): Promise<string | null> {
  const content = await fs.readFile(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  return content === null ? null : sha256(content);
}

async function replaceFileAtomically(filePath: string, content: string, expectedSha256?: string): Promise<void> {
  const stats = await fs.stat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    const file = await fs.open(temporaryPath, "wx", stats?.mode ?? 0o666);
    try {
      await file.writeFile(content, "utf-8");
      if (stats) {
        await file.chmod(stats.mode & 0o7777);
      }
      await file.sync();
    } finally {
      await file.close();
    }
    if (expectedSha256 !== undefined) {
      const currentSha256 = await fileSha256(filePath);
      if (currentSha256?.toLowerCase() !== expectedSha256.toLowerCase()) {
        throw new Error(`Script changed since it was read (expected ${expectedSha256}, current ${currentSha256 ?? "missing"})`);
      }
    }
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function sha256(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

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
    annotations: destructiveAnnotations,
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

// Read Script Tool
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
    annotations: readOnlyAnnotations,
  },
  async execute(args, _executor) {
    const projectPath = await resolveProjectPath(args);
    const scriptPath = normalizeResourcePath(args.script_path as string, {
      fieldName: "script_path",
      extensions: SCRIPT_EXTENSIONS,
    });

    const resolved = await resolveExistingProjectFilePath(projectPath, scriptPath, {
      fieldName: "script_path",
      extensions: SCRIPT_EXTENSIONS,
    }).catch((error) => {
      throw new Error(`Failed to read script: ${scriptPath} (${error instanceof Error ? error.message : String(error)})`);
    });
    const bytes = await fs.readFile(resolved.fsPath).catch((error) => {
      throw new Error(`Failed to read script: ${scriptPath} (${error instanceof Error ? error.message : String(error)})`);
    });
    const content = bytes.toString("utf-8");
    return {
      success: true,
      script_path: resolved.resourcePath,
      content,
      line_count: content.split("\n").length,
      sha256: sha256(bytes),
    };
  },
};

// Edit Script Tool
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
        expected_sha256: {
          type: "string",
          description: "Optional SHA-256 returned by read_script. The edit checks it again immediately before replacing the file.",
        },
      },
      required: ["script_path", "content"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, _executor) {
    const content = args.content as string;

    const projectPath = await resolveProjectPath(args);
    const scriptPath = normalizeResourcePath(args.script_path as string, {
      fieldName: "script_path",
      extensions: SCRIPT_EXTENSIONS,
    });

    const resolved = await resolveWritableProjectFilePath(projectPath, scriptPath, {
      fieldName: "script_path",
      extensions: SCRIPT_EXTENSIONS,
    }).catch((error) => {
      throw new Error(`Failed to edit script: ${scriptPath} (${error instanceof Error ? error.message : String(error)})`);
    });
    const expectedSha256 = args.expected_sha256;
    if (expectedSha256 !== undefined) {
      if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
        throw new Error("expected_sha256 must be a 64-character hexadecimal SHA-256");
      }
    }
    await replaceFileAtomically(resolved.fsPath, content, expectedSha256 as string | undefined).catch((error) => {
      throw new Error(`Failed to edit script: ${scriptPath} (${error instanceof Error ? error.message : String(error)})`);
    });
    return {
      success: true,
      message: `Updated script at ${resolved.resourcePath}`,
      script_path: resolved.resourcePath,
      sha256: sha256(content),
    };
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
    annotations: readOnlyAnnotations,
  },
  async execute(args, _executor) {
    const projectPath = await resolveProjectPath(args);
    const scripts = await findScriptFiles(projectPath);
    return { success: true, project_path: projectPath, scripts, count: scripts.length };
  },
};

export const scriptTools = [
  createScriptTool,
  attachScriptTool,
  readScriptTool,
  editScriptTool,
  listScriptsTool,
];
