import type { ToolDefinition, ToolHandler } from "./types.js";
import type { GodotExecutor } from "../godot/executor.js";

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

  return tool.execute(args, executor);
}

// Re-export types
export type { ToolDefinition, ToolHandler } from "./types.js";
