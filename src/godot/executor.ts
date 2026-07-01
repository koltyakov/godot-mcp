import { spawn } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";

import { log } from "../logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 1024 * 1024;

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  data?: unknown;
}

interface BufferedProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  error?: string;
  timedOutAfterMs?: number;
}

export class GodotExecutor {
  private godotPath: string;
  private operationsScriptPath: string;

  constructor(godotPath: string) {
    this.godotPath = godotPath;
    // Path to our bundled GDScript operations handler
    this.operationsScriptPath = path.join(__dirname, "..", "..", "scripts", "godot_operations.gd");
  }

  /**
   * Execute a Godot operation in headless mode
   */
  async execute(
    projectPath: string,
    operation: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number
  ): Promise<ExecutionResult> {
    const args = [
      "--headless",
      "--path", projectPath,
      "-s", this.operationsScriptPath,
      "--", operation, JSON.stringify(params),
    ];

    const startedAt = Date.now();
    await log("debug", "godot-mcp", {
      message: "Spawning headless Godot",
      operation,
      project_path: projectPath,
    });

    const processResult = await this.runBuffered(args, projectPath, timeoutMs);
    const durationMs = Date.now() - startedAt;

    if (processResult.error) {
      await log("error", "godot-mcp", {
        message: "Failed to spawn Godot process",
        operation,
        project_path: projectPath,
        error: processResult.error,
      });
      return { success: false, output: processResult.stdout.trim(), error: processResult.error };
    }

    if (processResult.timedOut) {
      const timeoutMs = processResult.timedOutAfterMs ?? DEFAULT_TIMEOUT_MS;
      await log("error", "godot-mcp", {
        message: "Godot operation timed out",
        operation,
        project_path: projectPath,
        timeout_ms: timeoutMs,
      });
      return {
        success: false,
        output: processResult.stdout.trim(),
        error: `Godot operation timed out after ${timeoutMs}ms`,
      };
    }

    // Parse the output for our JSON result marker.
    const resultMatch = processResult.stdout.match(/\[GODOT_MCP_RESULT\]([\s\S]*?)\[\/GODOT_MCP_RESULT\]/);
    if (resultMatch) {
      try {
        const result = JSON.parse(resultMatch[1].trim());
        const output = typeof result.output === "string"
          ? result.output
          : result.output !== undefined
            ? JSON.stringify(result.output)
            : result.message ?? JSON.stringify(result);
        const executionResult: ExecutionResult = {
          success: result.success ?? true,
          output,
          error: result.error,
        };

        Object.defineProperty(executionResult, "data", {
          value: result,
          enumerable: false,
        });

        if (!executionResult.success) {
          await log("warning", "godot-mcp", {
            message: "Godot operation reported failure",
            operation,
            project_path: projectPath,
            error: result.error,
            duration_ms: durationMs,
          });
        } else {
          await log("debug", "godot-mcp", {
            message: "Godot operation completed",
            operation,
            project_path: projectPath,
            duration_ms: durationMs,
          });
        }

        return executionResult;
      } catch {
        // Fall through to the raw process result for malformed marker output.
        await log("warning", "godot-mcp", {
          message: "Could not parse GODOT_MCP_RESULT marker payload",
          operation,
          project_path: projectPath,
        });
      }
    }

    const stderr = processResult.stderr.trim();
    const truncationNote = processResult.truncated ? "Output truncated while running Godot" : undefined;

    if (processResult.code !== 0) {
      await log("error", "godot-mcp", {
        message: "Godot process exited non-zero",
        operation,
        project_path: projectPath,
        exit_code: processResult.code,
        stderr: stderr.slice(0, 1000) || undefined,
        duration_ms: durationMs,
      });
    }

    return {
      success: processResult.code === 0,
      output: processResult.stdout.trim(),
      error: stderr || truncationNote,
    };
  }

  /**
   * Execute a raw Godot command without the operations script
   */
  async executeRaw(args: string[], cwd?: string, timeoutMs?: number): Promise<ExecutionResult> {
    const processResult = await this.runBuffered(args, cwd, timeoutMs);
    if (processResult.error) {
      return { success: false, output: processResult.stdout.trim(), error: processResult.error };
    }

    if (processResult.timedOut) {
      const timeoutMs = processResult.timedOutAfterMs ?? DEFAULT_TIMEOUT_MS;
      return {
        success: false,
        output: processResult.stdout.trim(),
        error: `Godot command timed out after ${timeoutMs}ms`,
      };
    }

    const stderr = processResult.stderr.trim();
    const truncationNote = processResult.truncated ? "Output truncated while running Godot" : undefined;

    return {
      success: processResult.code === 0,
      output: processResult.stdout.trim(),
      error: stderr || truncationNote,
    };
  }

  /**
   * Launch the Godot editor for a project
   */
  async launchEditor(projectPath: string): Promise<ExecutionResult> {
    return this.runDetached(["--editor", "--path", projectPath], `Launched Godot editor for project at ${projectPath}`);
  }

  /**
   * Run the project
   */
  async runProject(projectPath: string): Promise<ExecutionResult> {
    return this.runDetached(["--path", projectPath], `Running project at ${projectPath}`);
  }

  /**
   * Get Godot version
   */
  async getVersion(): Promise<string> {
    const result = await this.executeRaw(["--version"]);
    return result.output || "unknown";
  }

  getGodotPath(): string {
    return this.godotPath;
  }

  private runBuffered(args: string[], cwd?: string, timeoutMs?: number): Promise<BufferedProcessResult> {
    const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let truncated = false;
      let timeout: NodeJS.Timeout | undefined;

      const appendOutput = (current: string, data: Buffer): string => {
        const combined = current + data.toString();
        if (combined.length <= MAX_OUTPUT_LENGTH) {
          return combined;
        }

        truncated = true;
        return combined.slice(combined.length - MAX_OUTPUT_LENGTH);
      };

      const finish = (result: BufferedProcessResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        resolve(result);
      };

      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn(this.godotPath, args, {
          cwd,
          env: { ...process.env },
        });
      } catch (error) {
        finish({
          code: null,
          stdout,
          stderr,
          timedOut,
          truncated,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      timeout = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");

        setTimeout(() => {
          if (!settled) {
            proc.kill("SIGKILL");
          }
        }, 1_000).unref();
      }, effectiveTimeout);

      proc.stdout?.on("data", (data: Buffer) => {
        stdout = appendOutput(stdout, data);
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr = appendOutput(stderr, data);
      });

      proc.on("close", (code) => {
        finish({ code, stdout, stderr, timedOut, truncated, timedOutAfterMs: timedOut ? effectiveTimeout : undefined });
      });

      proc.on("error", (error) => {
        finish({ code: null, stdout, stderr, timedOut, truncated, error: error.message });
      });
    });
  }

  private runDetached(args: string[], successMessage: string): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      let settled = false;

      const finish = (result: ExecutionResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(result);
      };

      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn(this.godotPath, args, {
          detached: true,
          stdio: "ignore",
        });
      } catch (error) {
        finish({ success: false, output: "", error: error instanceof Error ? error.message : String(error) });
        return;
      }

      proc.once("spawn", () => {
        proc.unref();
        finish({ success: true, output: successMessage });
      });

      proc.once("error", (error) => {
        finish({ success: false, output: "", error: error.message });
      });
    });
  }
}
