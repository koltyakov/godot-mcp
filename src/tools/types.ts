import { z } from "zod";
import type { GodotExecutor } from "../godot/executor.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolHandler {
  definition: ToolDefinition;
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
