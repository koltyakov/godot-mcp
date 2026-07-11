import type { ToolDefinition, ToolHandler } from "./types.js";
import type { GodotExecutor } from "../godot/executor.js";
import { notifyResourcesChanged } from "../notifications.js";
import { invalidateProjectFileCatalog } from "../godot/finder.js";

import { sceneTools } from "./scene-tools.js";
import { sceneExtTools } from "./scene-ext-tools.js";
import { scriptTools } from "./script-tools.js";
import { animationTools } from "./animation-tools.js";
import { projectTools } from "./project-tools.js";
import { projectConfigTools } from "./project-config-tools.js";
import { buildTools } from "./build-tools.js";
import { dependencyTools } from "./dependency-tools.js";

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
];

// Create a map for quick lookup
const toolMap = new Map<string, ToolHandler>();
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
  executor: GodotExecutor | null
): Promise<unknown> {
  const tool = toolMap.get(name);

  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const result = await tool.execute(args, executor);

  if (toolMutatesProject(tool)) {
    invalidateProjectFileCatalog();
    await notifyResourcesChanged();
  }

  return result;
}

// Re-export types
export type { ToolDefinition, ToolHandler, ToolAnnotations } from "./types.js";
