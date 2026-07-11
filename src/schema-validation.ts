import type { ToolDefinition } from "./tools/types.js";

type JsonSchemaNode = {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSchemaValue(schema: JsonSchemaNode, value: unknown, path: string): string[] {
  const errors: string[] = [];

  if (schema.enum && !schema.enum.includes(value)) {
    return [`${path} must be one of: ${schema.enum.join(", ")}`];
  }

  if (schema.type) {
    const valid =
      (schema.type === "string" && typeof value === "string") ||
      (schema.type === "number" && typeof value === "number" && Number.isFinite(value)) ||
      (schema.type === "integer" && typeof value === "number" && Number.isInteger(value)) ||
      (schema.type === "boolean" && typeof value === "boolean") ||
      (schema.type === "object" && isRecord(value)) ||
      (schema.type === "array" && Array.isArray(value));

    if (!valid) {
      return [`${path} must be ${schema.type}`];
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} must be at least ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} must be at most ${schema.maximum}`);
    }
  }

  if (schema.properties && isRecord(value)) {
    for (const requiredKey of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) {
        errors.push(`${path}.${requiredKey} is required`);
      }
    }

    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validateSchemaValue(childSchema, value[key], `${path}.${key}`));
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) {
          errors.push(`${path}.${key} is not allowed`);
        }
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

export function validateToolArguments(tool: ToolDefinition | undefined, args: unknown): string[] {
  if (!tool) {
    return [];
  }

  return validateSchemaValue(tool.inputSchema as JsonSchemaNode, args, "arguments");
}
