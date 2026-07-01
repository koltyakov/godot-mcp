import * as fs from "fs/promises";
import * as path from "path";

import type { ToolHandler } from "./types.js";
import { destructiveAnnotations, readOnlyAnnotations } from "./types.js";
import { projectSelectorProperties, resolveProjectPath } from "./project-context.js";
import { resolveExistingProjectFilePath } from "./path-utils.js";

// Long-running build/export operations get a generous timeout. Projects with
// large assets or remote-export toolchains can take several minutes.
const BUILD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function normalizeExportOutputPath(projectPath: string, outputPath: string): string {
  if (!outputPath) {
    return "";
  }

  if (outputPath.includes("\0")) {
    throw new Error("output_path contains an invalid null byte");
  }

  if (path.isAbsolute(outputPath) || path.win32.isAbsolute(outputPath)) {
    return outputPath;
  }

  const normalized = path.normalize(outputPath.replace(/\\/g, path.sep));
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`) || path.isAbsolute(normalized)) {
    throw new Error(`output_path escapes project directory: ${outputPath}`);
  }

  return path.join(projectPath, normalized);
}

// Export Project Tool — invokes godot --headless --export-release
export const exportProjectTool: ToolHandler = {
  definition: {
    name: "export_project",
    description:
      "Run a Godot export preset headlessly (godot --headless --export-release). Use list_export_presets to see what's available. The output path is relative to the project unless absolute.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        preset: {
          type: "string",
          description: "Exact name of an export preset defined in export_presets.cfg.",
        },
        output_path: {
          type: "string",
          description: "Output file path. Defaults to the preset's export_path.",
        },
        debug: {
          type: "boolean",
          description: "Use --export-debug instead of --export-release. Default false.",
          default: false,
        },
      },
      required: ["preset"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) throw new Error("Godot is not available");
    const projectPath = await resolveProjectPath(args);
    const preset = args.preset as string;
    const outputPath = normalizeExportOutputPath(
      projectPath,
      typeof args.output_path === "string" ? args.output_path : ""
    );
    const debug = args.debug === true;

    const flag = debug ? "--export-debug" : "--export-release";
    const cmdArgs = ["--headless", "--path", projectPath, flag, preset];
    if (outputPath) {
      cmdArgs.push(outputPath);
    } else {
      // Godot requires the output path even when the preset has one in 4.x.
      cmdArgs.push("");
    }

    const result = await executor.executeRaw(cmdArgs, undefined, BUILD_TIMEOUT_MS);
    if (!result.success) {
      throw new Error(result.error || `Export failed for preset "${preset}"`);
    }
    return {
      success: true,
      preset,
      output_path: outputPath || null,
      debug,
      message: `Exported preset "${preset}"${debug ? " (debug)" : ""}`,
    };
  },
};

// List Export Presets Tool — parses export_presets.cfg without spawning Godot
export const listExportPresetsTool: ToolHandler = {
  definition: {
    name: "list_export_presets",
    description:
      "Parse export_presets.cfg and return each preset's name, platform, and output path. Does not spawn Godot.",
    inputSchema: {
      type: "object",
      properties: { ...projectSelectorProperties },
      required: [],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args) {
    const projectPath = await resolveProjectPath(args);
    const cfgPath = path.join(projectPath, "export_presets.cfg");
    const content = await fs.readFile(cfgPath, "utf-8").catch(() => null);
    if (content === null) {
      return { presets: [], count: 0, message: "No export_presets.cfg found in project." };
    }
    const presets = parseExportPresets(content);
    return { presets, count: presets.length };
  },
};

interface ExportPreset {
  name: string;
  platform: string;
  runnable: boolean;
  export_path: string | null;
}

/**
 * Lightweight ConfigFile-ish parser for export_presets.cfg. Avoids spawning
 * Godot for a pure-read operation. Handles the [preset.N] sections that
 * Godot emits.
 */
function parseExportPresets(content: string): ExportPreset[] {
  const presets: ExportPreset[] = [];
  const sectionRe = /\[preset\.(\d+)\]/g;
  let match: RegExpExecArray | null;
  const sections: Array<{ index: number; body: string }> = [];
  while ((match = sectionRe.exec(content)) !== null) {
    const start = match.index + match[0].length;
    const nextSection = content.indexOf("[", start);
    const body = content.slice(start, nextSection === -1 ? undefined : nextSection);
    sections.push({ index: Number(match[1]), body });
  }
  for (const { body } of sections) {
    const name = readKeyValue(body, "name");
    const platform = readKeyValue(body, "platform");
    const runnable = readKeyValue(body, "runnable");
    const exportPath = readKeyValue(body, "export_file") ?? readKeyValue(body, "export_path");
    if (!name) continue;
    presets.push({
      name,
      platform: platform ?? "unknown",
      runnable: runnable === "true" || runnable === "True",
      export_path: exportPath ?? null,
    });
  }
  return presets;
}

function readKeyValue(body: string, key: string): string | null {
  const re = new RegExp(`^${key}=("([^"]*)"|(.*))$`, "m");
  const m = body.match(re);
  if (!m) return null;
  if (m[2] !== undefined) return m[2];
  return (m[3] ?? "").trim();
}

// Upgrade Project Tool — godot --headless --upgrade
export const upgradeProjectTool: ToolHandler = {
  definition: {
    name: "upgrade_project",
    description:
      "Run `godot --headless --upgrade` to migrate the project to the current engine version, then `--import` to refresh the import cache. Back up the project first; this rewrites files in place.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        skip_import: {
          type: "boolean",
          description: "Skip the --import pass after --upgrade. Default false.",
          default: false,
        },
      },
      required: [],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) throw new Error("Godot is not available");
    const projectPath = await resolveProjectPath(args);
    const skipImport = args.skip_import === true;

    const upgradeResult = await executor.executeRaw(
      ["--headless", "--path", projectPath, "--upgrade"],
      undefined,
      BUILD_TIMEOUT_MS
    );
    if (!upgradeResult.success) {
      throw new Error(upgradeResult.error || "Project upgrade failed");
    }

    let importResult: { success: boolean; output: string; error?: string } | null = null;
    if (!skipImport) {
      importResult = await executor.executeRaw(
        ["--headless", "--path", projectPath, "--import"],
        undefined,
        BUILD_TIMEOUT_MS
      );
      if (!importResult.success) {
        throw new Error(importResult.error || "Post-upgrade import pass failed");
      }
    }

    return {
      success: true,
      message: "Project upgraded" + (skipImport ? "" : " and reimported"),
      import_skipped: skipImport,
    };
  },
};

// Read Project File Tool — generic file read inside the project (handy for
// export_presets.cfg inspection, .import files, etc.). Constrained to the
// project root via path-utils.
export const readProjectFileTool: ToolHandler = {
  definition: {
    name: "read_project_file",
    description:
      "Read an arbitrary text file inside the project (e.g., export_presets.cfg, *.import, project.godot). Validates the path stays inside the project root.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        file_path: {
          type: "string",
          description: "res:// path (or path relative to project) of the file to read.",
        },
      },
      required: ["file_path"],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args) {
    const projectPath = await resolveProjectPath(args);
    const { fsPath, resourcePath } = await resolveExistingProjectFilePath(projectPath, args.file_path as string, {
      fieldName: "file_path",
    });
    const content = await fs.readFile(fsPath, "utf-8");
    return {
      path: resourcePath,
      size: content.length,
      content,
    };
  },
};

export const buildTools = [
  exportProjectTool,
  listExportPresetsTool,
  upgradeProjectTool,
  readProjectFileTool,
];
