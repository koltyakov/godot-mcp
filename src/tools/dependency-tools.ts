import type { ToolHandler } from "./types.js";
import { readOnlyAnnotations } from "./types.js";
import { projectSelectorProperties, resolveProjectPath } from "./project-context.js";
import {
  addDependencyWarning,
  buildDependencyReport,
  type DependencyReport,
  type EngineDependencyInspection,
  findUsages,
  mergeEngineInspection,
} from "../dependency-graph.js";
import type { GodotExecutor } from "../godot/executor.js";
import { getExecutionSignal } from "../execution-context.js";
import { executeGodotOperation } from "./godot-operation.js";

type EngineStatus = {
  requested: true;
  status: "used" | "unavailable" | "failed";
  inspected_count: number;
  failed_count: number;
  error?: string;
  failures?: Record<string, string>;
};

const ENGINE_BATCH_SIZE = 100;

async function inspectWithEngine(executor: GodotExecutor, report: DependencyReport): Promise<EngineDependencyInspection> {
  const paths = Object.keys(report.nodes);
  const uids = report.unresolved;
  const batchCount = Math.max(1, Math.ceil(paths.length / ENGINE_BATCH_SIZE), Math.ceil(uids.length / ENGINE_BATCH_SIZE));
  const combined: EngineDependencyInspection = {
    dependencies: {},
    uid_paths: {},
    failures: {},
    inspected_count: 0,
  };
  for (let index = 0; index < batchCount; index += 1) {
    const batchPaths = paths.slice(index * ENGINE_BATCH_SIZE, (index + 1) * ENGINE_BATCH_SIZE);
    const batchUids = uids.slice(index * ENGINE_BATCH_SIZE, (index + 1) * ENGINE_BATCH_SIZE);
    try {
      const inspection = await executeGodotOperation(
        executor,
        report.projectPath,
        "inspect_dependencies",
        { paths: batchPaths, uids: batchUids },
        "Engine dependency inspection failed"
      ) as EngineDependencyInspection;
      Object.assign(combined.dependencies, inspection.dependencies);
      Object.assign(combined.uid_paths, inspection.uid_paths);
      Object.assign(combined.failures, inspection.failures);
      combined.inspected_count += inspection.inspected_count;
    } catch (error) {
      if (getExecutionSignal()?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      for (const source of batchPaths) combined.failures[source] = message;
      if (batchPaths.length === 0) combined.failures[`uid_batch_${index}`] = message;
    }
  }
  return combined;
}

async function enrichWithEngine(
  args: Record<string, unknown>,
  executor: GodotExecutor | null
): Promise<{ report: DependencyReport; engine?: EngineStatus }> {
  const report = await buildDependencyReport(args);
  if (args.engine !== true) return { report };
  if (!executor) {
    return {
      report: addDependencyWarning(report, "Engine dependency inspection was requested but Godot is unavailable"),
      engine: { requested: true, status: "unavailable", inspected_count: 0, failed_count: 0 },
    };
  }

  try {
    const inspection = await inspectWithEngine(executor, report);
    const failedCount = Object.keys(inspection.failures).length;
    const status = inspection.inspected_count > 0 || failedCount === 0 ? "used" : "failed";
    return {
      report: mergeEngineInspection(report, inspection),
      engine: {
        requested: true,
        status,
        inspected_count: inspection.inspected_count,
        failed_count: failedCount,
        ...(failedCount > 0 ? { failures: inspection.failures } : {}),
      },
    };
  } catch (error) {
    if (getExecutionSignal()?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      report: addDependencyWarning(report, `Engine dependency inspection failed: ${message}`),
      engine: { requested: true, status: "failed", inspected_count: 0, failed_count: 0, error: message },
    };
  }
}

// Dependency Graph Tool
export const getDependencyGraphTool: ToolHandler = {
  definition: {
    name: "get_dependency_graph",
    description:
      "Scan scenes/scripts/resources/shaders and return a forward+reverse dependency graph. Set engine=true for best-effort Godot enrichment of binary, UID, and loader-reported dependencies.",
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
        engine: {
          type: "boolean",
          default: false,
          description: "Use headless Godot to enrich the cached filesystem graph. Default false.",
        },
      },
      required: [],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args, executor) {
    const { report, engine } = await enrichWithEngine(args, executor);
    const includeOrphans = args.include_orphans !== false;
    return {
      project_path: report.projectPath,
      counts: report.counts,
      nodes: report.nodes,
      complete: report.complete,
      warnings: report.warnings,
      unresolved: report.unresolved,
      ...(engine ? { engine } : {}),
      ...(includeOrphans ? { orphans: report.orphans } : {}),
    };
  },
};

// Find Usages Tool — reverse-lookup of an asset's referencers
export const findUsagesTool: ToolHandler = {
  definition: {
    name: "find_usages",
    description:
      "Find every asset that references a given res:// path. Set engine=true for best-effort Godot enrichment before the reverse lookup.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        target_path: {
          type: "string",
          description: "res:// path (or path relative to project root) of the asset to look up.",
        },
        refresh: { type: "boolean" },
        engine: {
          type: "boolean",
          default: false,
          description: "Use headless Godot to enrich the cached filesystem graph. Default false.",
        },
      },
      required: ["target_path"],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args, executor) {
    const targetPath = args.target_path as string;
    const { report, engine } = await enrichWithEngine(args, executor);
    return {
      ...findUsages(report, targetPath),
      complete: report.complete,
      warnings: report.warnings,
      unresolved: report.unresolved,
      ...(engine ? { engine } : {}),
    };
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
