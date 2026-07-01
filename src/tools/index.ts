import type { ToolDefinition, ToolHandler } from "./types.js";
import type { GodotExecutor } from "../godot/executor.js";
import { notifyResourcesChanged } from "../notifications.js";

import { sceneTools } from "./scene-tools.js";
import { scriptTools } from "./script-tools.js";
import { animationTools } from "./animation-tools.js";
import { projectTools } from "./project-tools.js";

// Combine all tools
const allTools: ToolHandler[] = [
  ...sceneTools,
  ...scriptTools,
  ...animationTools,
  ...projectTools,
];

// Create a map for quick lookup
const toolMap = new Map<string, ToolHandler>();
for (const tool of allTools) {
  toolMap.set(tool.definition.name, tool);
}

/**
 * A tool is considered to mutate project contents when it is annotated
 * destructive (writes files) or open-world (e.g. runs arbitrary code
 * that may touch the project). Read-only tools do not trigger resource
 * list-changed notifications.
 */
function toolMutatesProject(tool: ToolHandler): boolean {
  const annotations = tool.definition.annotations;
  return Boolean(annotations?.destructiveHint || annotations?.openWorldHint);
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
    await notifyResourcesChanged();
  }

  return result;
}

// Re-export types
export type { ToolDefinition, ToolHandler, ToolAnnotations } from "./types.js";
