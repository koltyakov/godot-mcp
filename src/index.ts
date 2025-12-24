#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { getAllTools, executeTool } from "./tools/index.js";
import { GodotExecutor } from "./godot/executor.js";
import { findGodotPath } from "./godot/finder.js";

// Initialize Godot executor
let godotExecutor: GodotExecutor | null = null;

async function initializeGodot(): Promise<void> {
  const godotPath = await findGodotPath();
  if (godotPath) {
    godotExecutor = new GodotExecutor(godotPath);
  }
}

// Create MCP server
const server = new Server(
  {
    name: "godot-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Set up request handlers
function setupHandlers(): void {
  const tools = getAllTools();
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // Handle call tool request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolArgs = args ?? {};

    // Validate required parameters
    const tool = toolMap.get(name);
    if (tool?.inputSchema.required) {
      const missing = tool.inputSchema.required.filter(
        (param) => toolArgs[param] === undefined || toolArgs[param] === null
      );
      if (missing.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Missing required parameter(s): ${missing.join(", ")}`,
            },
          ],
          isError: true,
        };
      }
    }

    try {
      const result = await executeTool(name, toolArgs, godotExecutor);
      return {
        content: [
          {
            type: "text" as const,
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });
}

// Main entry point
async function main(): Promise<void> {
  await initializeGodot();
  setupHandlers();

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
