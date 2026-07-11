import type { ToolDefinition, ToolHandler } from "./types.js";
import type { GodotExecutor } from "../godot/executor.js";
import { notifyResourcesChanged } from "../notifications.js";
import { invalidateProjectFileCatalog } from "../godot/finder.js";
import { runWithExecutionContext } from "../execution-context.js";
import { MutationScheduler } from "../godot/mutation-scheduler.js";
import { canonicalizeProspectivePath } from "../godot/executor.js";
import * as path from "node:path";
import { resolveProjectPath } from "./project-context.js";
import { normalizeAbsoluteProjectPath, normalizeResourcePath, SCENE_EXTENSIONS } from "./path-utils.js";

import { sceneTools } from "./scene-tools.js";
import { sceneExtTools } from "./scene-ext-tools.js";
import { scriptTools } from "./script-tools.js";
import { animationTools } from "./animation-tools.js";
import { projectTools } from "./project-tools.js";
import { projectConfigTools } from "./project-config-tools.js";
import { buildTools } from "./build-tools.js";
import { dependencyTools } from "./dependency-tools.js";
import { editorTools } from "./editor-tools.js";
import { resourceTools } from "./resource-tools.js";

// Combine all tools
const allTools: ToolHandler[] = [
  ...sceneTools,
  ...sceneExtTools,
  ...scriptTools,
  ...animationTools,
  ...projectTools,
  ...projectConfigTools,
  ...buildTools,
  ...dependencyTools,
  ...editorTools,
  ...resourceTools,
];

// Create a map for quick lookup
const toolMap = new Map<string, ToolHandler>();
const mutationScheduler = new MutationScheduler();
const sceneMutationTools = new Set([
  "create_scene", "add_node", "remove_node", "modify_node", "apply_scene_changes",
  "attach_script", "create_animation", "add_animation_track", "add_node_group",
  "remove_node_group", "set_node_meta", "remove_node_meta", "connect_signal", "disconnect_signal",
]);
for (const tool of allTools) {
  toolMap.set(tool.definition.name, tool);
}

/**
 * Destructive tools and handlers explicitly marked as potential mutators
 * may change project contents. Open-world status alone (for example,
 * launching the editor) does not force clients to rescan resources.
 */
function toolMutatesProject(tool: ToolHandler): boolean {
  const annotations = tool.definition.annotations;
  return Boolean(tool.mayMutateProject || annotations?.destructiveHint);
}

/**
 * Get all tool definitions for the MCP server
 */
export function getAllTools(): ToolDefinition[] {
  return allTools.map((tool) => tool.definition);
}

/**
 * Execute a tool by name
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  executor: GodotExecutor | null,
  options: { signal?: AbortSignal; requestId?: string | number } = {}
): Promise<unknown> {
  const tool = toolMap.get(name);

  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  let executionArgs = args;
  let operation = () => runWithExecutionContext(options, () => tool.execute(executionArgs, executor));
  if (toolMutatesProject(tool)) {
    const projectPath = name === "init_project"
      ? normalizeAbsoluteProjectPath(args.project_path as string)
      : await resolveProjectPath(args);
    executionArgs = { ...args, project_path: projectPath };
    const normalizedScenePath = sceneMutationTools.has(name)
      ? normalizeResourcePath(args.scene_path as string, { fieldName: "scene_path", extensions: SCENE_EXTENSIONS })
      : undefined;
    const scenePath = normalizedScenePath
      ? await canonicalizeProspectivePath(path.resolve(projectPath, normalizedScenePath.slice("res://".length)))
      : undefined;
    const unscheduledOperation = operation;
    operation = () => mutationScheduler.run(
      { projectPath, scenePath },
      options.signal,
      unscheduledOperation
    );
  }

  const result = await operation();

  if (toolMutatesProject(tool)) {
    invalidateProjectFileCatalog();
    await notifyResourcesChanged();
  }

  return result;
}

// Re-export types
export type { ToolDefinition, ToolHandler, ToolAnnotations } from "./types.js";
