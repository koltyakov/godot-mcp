import type { GodotExecutor } from "../godot/executor.js";

export class GodotOperationError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = "GodotOperationError";
  }
}

export async function executeGodotOperation(
  executor: GodotExecutor | null,
  projectPath: string,
  operation: string,
  params: Record<string, unknown>,
  failureMessage: string
): Promise<unknown> {
  if (!executor) {
    throw new Error("Godot is not available. Please ensure Godot is installed and accessible.");
  }

  const result = await executor.execute(projectPath, operation, params);
  if (!result.success) {
    throw new GodotOperationError(result.error || failureMessage, result.data);
  }

  if (result.data !== undefined) {
    return result.data;
  }

  try {
    return JSON.parse(result.output);
  } catch {
    return result.output;
  }
}
