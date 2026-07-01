import { spawn } from "child_process";
import { randomUUID } from "crypto";
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
  pid?: number;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractMarkedResult(stdout: string, resultToken: string): string | null {
  const token = escapeRegExp(resultToken);
  const markerPattern = new RegExp(
    `\\[GODOT_MCP_RESULT:${token}\\]([\\s\\S]*?)\\[/GODOT_MCP_RESULT:${token}\\]`,
    "g"
  );
  let match: RegExpExecArray | null;
  let payload: string | null = null;

  while ((match = markerPattern.exec(stdout)) !== null) {
    payload = match[1];
  }

  return payload;
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
    const resultToken = randomUUID();
    const args = [
      "--headless",
      "--path", projectPath,
      "-s", this.operationsScriptPath,
      "--", operation, JSON.stringify({ ...params, __mcp_result_token: resultToken }),
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

    // Parse the nonce-scoped JSON result marker. This prevents user script
    // stdout from spoofing operation results with a static marker string.
    const resultPayload = extractMarkedResult(processResult.stdout, resultToken);
    if (resultPayload) {
      try {
        const result = JSON.parse(resultPayload.trim());
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
          detached: process.platform !== "win32",
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
        this.killProcess(proc, "SIGTERM");

        setTimeout(() => {
          if (!settled) {
            this.killProcess(proc, "SIGKILL");
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

  private killProcess(proc: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
    if (process.platform !== "win32" && proc.pid) {
      try {
        process.kill(-proc.pid, signal);
        return;
      } catch {
        // Fall back to the direct child if process-group termination fails.
      }
    }

    proc.kill(signal);
  }

  private runDetached(args: string[], successMessage: string): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      let settled = false;
      let earlyExitTimer: NodeJS.Timeout | undefined;

      const finish = (result: ExecutionResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        if (earlyExitTimer) {
          clearTimeout(earlyExitTimer);
        }
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
        earlyExitTimer = setTimeout(() => {
          proc.unref();
          finish({ success: true, output: `${successMessage} (pid ${proc.pid})`, pid: proc.pid });
        }, 750);
      });

      proc.once("exit", (code, signal) => {
        finish({
          success: false,
          output: "",
          error: `Godot process exited immediately${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`,
          pid: proc.pid,
        });
      });

      proc.once("error", (error) => {
        finish({ success: false, output: "", error: error.message, pid: proc.pid });
      });
    });
  }
}
