import type { ToolHandler } from "./types.js";
import { readOnlyAnnotations } from "./types.js";
import { projectSelectorProperties, resolveProjectPath } from "./project-context.js";
import { buildDependencyReport, findUsages } from "../dependency-graph.js";

// Dependency Graph Tool
export const getDependencyGraphTool: ToolHandler = {
  definition: {
    name: "get_dependency_graph",
    description:
      "Scan the project's scenes/scripts/resources/shaders and return a forward+reverse dependency graph. Pure filesystem scan — does NOT spawn Godot. Use it to answer 'what uses this asset?' or 'is it safe to delete?'",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        include_orphans: {
          type: "boolean",
          description: "Include the orphans list (assets with no inbound references). Default true.",
          default: true,
        },
        refresh: { type: "boolean", description: "Bypass in-flight/cache reuse and refresh file metadata." },
      },
      required: [],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args) {
    const report = await buildDependencyReport(args);
    const includeOrphans = args.include_orphans !== false;
    return {
      project_path: report.projectPath,
      counts: report.counts,
      nodes: report.nodes,
      complete: report.complete,
      warnings: report.warnings,
      unresolved: report.unresolved,
      ...(includeOrphans ? { orphans: report.orphans } : {}),
    };
  },
};

// Find Usages Tool — reverse-lookup of an asset's referencers
export const findUsagesTool: ToolHandler = {
  definition: {
    name: "find_usages",
    description:
      "Find every asset that references a given res:// path (reverse dependency lookup). Runs the same filesystem scan as get_dependency_graph but returns only the inbound references for one target.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        target_path: {
          type: "string",
          description: "res:// path (or path relative to project root) of the asset to look up.",
        },
        refresh: { type: "boolean" },
      },
      required: ["target_path"],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args) {
    const targetPath = args.target_path as string;
    const report = await buildDependencyReport(args);
    return { ...findUsages(report, targetPath), complete: report.complete, warnings: report.warnings, unresolved: report.unresolved };
  },
};

// List Project Files Tool — generic asset inventory (no Godot spawn)
export const listProjectFilesTool: ToolHandler = {
  definition: {
    name: "list_project_files",
    description:
      "List tracked Godot assets in the project by kind (scenes/scripts/resources/shaders). Pure filesystem scan — does not spawn Godot.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        kind: {
          type: "string",
          enum: ["scene", "script", "resource", "shader", "all"],
          description: "Filter by asset kind. Default 'all'.",
          default: "all",
        },
        refresh: { type: "boolean" },
      },
      required: [],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args) {
    const report = await buildDependencyReport(args);
    const kind = (args.kind as string) || "all";
    const paths = Object.values(report.nodes)
      .filter((n) => kind === "all" || n.kind === kind)
      .map((n) => n.path)
      .sort();
    return {
      project_path: report.projectPath,
      kind,
      files: paths,
      count: paths.length,
      complete: report.complete,
      warnings: report.warnings,
      unresolved: report.unresolved,
    };
  },
};

export const dependencyTools = [
  getDependencyGraphTool,
  findUsagesTool,
  listProjectFilesTool,
];

// Re-export so tools/index.ts can wire it without a separate import path.
export { resolveProjectPath };
