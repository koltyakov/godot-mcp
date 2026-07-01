#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  SetLevelRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { getAllTools, executeTool } from "./tools/index.js";
import type { ToolDefinition } from "./tools/index.js";
import { GodotExecutor } from "./godot/executor.js";
import { findGodotPath } from "./godot/finder.js";
import { setupResourceHandlers } from "./resources/index.js";
import { setupPromptHandlers } from "./prompts/index.js";
import { setServerLogger, setMinimumLogLevel, log } from "./logger.js";
import { setResourceListChangedNotifier } from "./notifications.js";

type JsonSchemaNode = {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  additionalProperties?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSchemaValue(schema: JsonSchemaNode, value: unknown, path: string): string[] {
  const errors: string[] = [];

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of: ${schema.enum.join(", ")}`);
    return errors;
  }

  if (schema.type) {
    const valid =
      (schema.type === "string" && typeof value === "string") ||
      (schema.type === "number" && typeof value === "number" && Number.isFinite(value)) ||
      (schema.type === "boolean" && typeof value === "boolean") ||
      (schema.type === "object" && isRecord(value)) ||
      (schema.type === "array" && Array.isArray(value));

    if (!valid) {
      errors.push(`${path} must be ${schema.type}`);
      return errors;
    }
  }

  if (schema.properties && isRecord(value)) {
    for (const requiredKey of schema.required ?? []) {
      if (value[requiredKey] === undefined || value[requiredKey] === null) {
        errors.push(`${path}.${requiredKey} is required`);
      }
    }

    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (value[key] !== undefined && value[key] !== null) {
        errors.push(...validateSchemaValue(childSchema, value[key], `${path}.${key}`));
      }
    }
  }

  if (schema.items && Array.isArray(value)) {
    value.forEach((item, index) => {
      errors.push(...validateSchemaValue(schema.items as JsonSchemaNode, item, `${path}[${index}]`));
    });
  }

  return errors;
}

function validateToolArguments(tool: ToolDefinition | undefined, args: unknown): string[] {
  if (!tool) {
    return [];
  }

  const schema = tool.inputSchema as JsonSchemaNode;
  return validateSchemaValue(schema, args, "arguments");
}

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
      resources: { listChanged: true },
      prompts: {},
      logging: {},
    },
    instructions: [
      "godot-mcp exposes a Godot 4.x project to MCP clients via tools, resources, and prompts.",
      "",
      "Reading project contents:",
      "- Prefer the godot:// resources (project info, scenes, scripts) over the read_* tools; resources are cheaper and stay in sync via resources/list_changed notifications.",
      "- godot://scene/{path} and godot://script/{path} accept percent-encoded res:// paths.",
      "",
      "Writing to a project:",
      "- Always pass res:// paths (or paths relative to the project root) to create_*/edit_* tools. Absolute paths are rejected.",
      "- Mutation tools are annotated destructiveHint=true and emit resources/list_changed on success.",
      "",
      "Project selection:",
      "- If a single Godot project is open in an editor process, it is used by default.",
      "- Otherwise pass project_path (absolute) or project_name (matches an open project).",
      "",
      "Prompts:",
      "- Use new-2d-player / new-3d-player to scaffold player scenes, gdscript-conventions before writing GDScript, and audit-scene to review an existing scene.",
    ].join("\n"),
  }
);

// Route server-side logging through the shared logger so the executor and
// tool handlers can emit diagnostic messages without holding a server ref.
setServerLogger((level, logger, data) =>
  server.sendLoggingMessage({ level, logger, data })
);
setResourceListChangedNotifier(() => server.sendResourceListChanged());

// Allow the client to dial logging verbosity up or down.
server.setRequestHandler(SetLevelRequestSchema, async (request) => {
  setMinimumLogLevel(request.params.level);
  await log("info", "godot-mcp", { message: "Log level changed", level: request.params.level });
  return {};
});

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
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      })),
    };
  });

  // Resource and prompt handlers are registered against the same server.
  setupResourceHandlers(server, godotExecutor);
  setupPromptHandlers(server);

  // Handle call tool request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolArgs = args ?? {};

    // Validate parameters before handlers cast them to concrete types.
    const tool = toolMap.get(name);
    const validationErrors = validateToolArguments(tool, toolArgs);
    if (validationErrors.length > 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Invalid parameter(s): ${validationErrors.join("; ")}`,
          },
        ],
        isError: true,
      };
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

  await log("info", "godot-mcp", {
    message: "godot-mcp server started",
    godot_available: godotExecutor !== null,
    godot_path: godotExecutor?.getGodotPath(),
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
