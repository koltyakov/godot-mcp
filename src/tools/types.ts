import { z } from "zod";
import type { GodotExecutor } from "../godot/executor.js";

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations?: ToolAnnotations;
}

export const readOnlyAnnotations: ToolAnnotations = { readOnlyHint: true };
export const destructiveAnnotations: ToolAnnotations = { destructiveHint: true };

export interface ToolHandler {
  definition: ToolDefinition;
  mayMutateProject?: boolean;
  execute: (args: Record<string, unknown>, executor: GodotExecutor | null) => Promise<unknown>;
}

// Zod schemas for validation
export const Vector2Schema = z.object({
  _type: z.literal("Vector2").optional(),
  x: z.number(),
  y: z.number(),
});

export const Vector3Schema = z.object({
  _type: z.literal("Vector3").optional(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const ColorSchema = z.object({
  _type: z.literal("Color").optional(),
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
  a: z.number().min(0).max(1).optional(),
});

export const KeyframeSchema = z.object({
  time: z.number(),
  value: z.unknown(),
});
