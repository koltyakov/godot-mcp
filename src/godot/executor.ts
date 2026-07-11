import { spawn } from "child_process";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

import { log } from "../logger.js";
import { getExecutionSignal } from "../execution-context.js";
import { FifoSemaphore } from "./concurrency.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 1024 * 1024;
const SCENE_MUTATION_OPERATIONS = new Set([
  "create_scene",
  "add_node",
  "remove_node",
  "modify_node",
  "apply_scene_changes",
  "attach_script",
  "create_animation",
  "add_animation_track",
  "set_node_group",
  "set_node_meta",
  "remove_node_meta",
  "connect_signal",
  "disconnect_signal",
]);

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  data?: unknown;
  pid?: number;
}

export interface CommandExecutionResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
  error?: string;
}

interface BufferedProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  error?: string;
  timedOutAfterMs?: number;
  aborted?: boolean;
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

type OperationResultPayload = Record<string, unknown> & {
  success: boolean;
  message?: string;
  error?: string;
};

function isResultPayload(value: unknown): value is OperationResultPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return typeof result.success === "boolean" &&
    (result.message === undefined || typeof result.message === "string") &&
    (result.error === undefined || typeof result.error === "string");
}

export async function canonicalizeProspectivePath(filePath: string): Promise<string> {
  let existingAncestor = filePath;
  while (true) {
    try {
      const realAncestor = await fs.realpath(existingAncestor);
      return path.resolve(realAncestor, path.relative(existingAncestor, filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return filePath;
      }
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) {
        return filePath;
      }
      existingAncestor = parent;
    }
  }
}

export class GodotExecutor {
  private godotPath: string;
  private operationsScriptPath: string;
  private sceneMutationTails = new Map<string, Promise<void>>();
  private sceneKeyResolutionTail: Promise<void> = Promise.resolve();
  private readonly processLimiter: FifoSemaphore;
  private readonly activeChildren = new Set<ReturnType<typeof spawn>>();
  private disposed = false;

  constructor(godotPath: string, options: { maxConcurrentProcesses?: number } = {}) {
    this.godotPath = godotPath;
    // Path to our bundled GDScript operations handler
    this.operationsScriptPath = path.join(__dirname, "..", "..", "scripts", "godot_operations.gd");
    const configuredLimit = Number(process.env.GODOT_MCP_MAX_PROCESSES);
    const maxConcurrentProcesses = options.maxConcurrentProcesses ??
      (Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 4);
    this.processLimiter = new FifoSemaphore(maxConcurrentProcesses);
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
    const scenePath = params.scene_path;
    if (SCENE_MUTATION_OPERATIONS.has(operation) && typeof scenePath === "string") {
      const previousResolution = this.sceneKeyResolutionTail;
      let releaseResolution!: () => void;
      this.sceneKeyResolutionTail = new Promise<void>((resolve) => {
        releaseResolution = resolve;
      });
      await previousResolution;

      let pendingOperation: Promise<ExecutionResult>;
      try {
        const relativeScenePath = scenePath.startsWith("res://") ? scenePath.slice(6) : scenePath;
        const lexicalScenePath = path.resolve(projectPath, relativeScenePath);
        const canonicalScenePath = await canonicalizeProspectivePath(lexicalScenePath);
        pendingOperation = this.withSceneMutationLock(
          canonicalScenePath,
          () => this.executeOperation(projectPath, operation, params, timeoutMs)
        );
      } finally {
        releaseResolution();
      }
      return pendingOperation!;
    }

    return this.executeOperation(projectPath, operation, params, timeoutMs);
  }

  private async executeOperation(
    projectPath: string,
    operation: string,
    params: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<ExecutionResult> {
    const resultToken = randomUUID();
    const requestDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "godot-mcp-request-"));
    const requestPath = path.join(requestDirectory, "request.json");
    await fs.writeFile(
      requestPath,
      JSON.stringify({ ...params, __mcp_result_token: resultToken }),
      { encoding: "utf-8", mode: 0o600, flag: "wx" }
    );
    const args = [
      "--headless",
      "--path", projectPath,
      "-s", this.operationsScriptPath,
      "--", operation, "--request-file", requestPath,
    ];

    const startedAt = Date.now();
    await log("debug", "godot-mcp", {
      message: "Spawning headless Godot",
      operation,
      project_path: projectPath,
    });

    let processResult: BufferedProcessResult;
    try {
      processResult = await this.runBuffered(args, projectPath, timeoutMs);
    } finally {
      await fs.rm(requestDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
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
    if (resultPayload !== null) {
      try {
        const result: unknown = JSON.parse(resultPayload.trim());
        if (!isResultPayload(result)) {
          throw new Error("Invalid result payload");
        }
        const output = typeof result.output === "string"
          ? result.output
          : result.output !== undefined
            ? JSON.stringify(result.output)
            : result.message ?? JSON.stringify(result) ?? "";
        const processSucceeded = processResult.code === 0;
        const executionResult: ExecutionResult = {
          success: (result.success ?? true) && processSucceeded,
          output,
          error: result.error || (processSucceeded
            ? undefined
            : processResult.stderr.trim() || `Godot process exited with code ${processResult.code}`),
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
        await log("warning", "godot-mcp", {
          message: "Could not parse GODOT_MCP_RESULT marker payload",
          operation,
          project_path: projectPath,
        });
      }
    }

    const stderr = processResult.stderr.trim();
    const markerError = processResult.truncated
      ? "Godot operation output was truncated before a valid result marker was received"
      : resultPayload === null
        ? "Godot operation did not return a valid result marker"
        : "Godot operation returned malformed result JSON";

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
      success: false,
      output: processResult.stdout.trim(),
      error: stderr ? `${markerError}: ${stderr}` : markerError,
    };
  }

  private async withSceneMutationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.sceneMutationTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.sceneMutationTails.set(key, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.sceneMutationTails.get(key) === tail) {
        this.sceneMutationTails.delete(key);
      }
    }
  }

  /**
   * Execute a raw Godot command without the operations script
   */
  async executeRaw(args: string[], cwd?: string, timeoutMs?: number): Promise<ExecutionResult> {
    const result = await this.executeRawDetailed(args, cwd, timeoutMs);
    if (result.timedOut) {
      return {
        success: false,
        output: result.stdout.trim(),
        error: result.error,
      };
    }

    return {
      success: result.success,
      output: result.stdout.trim(),
      error: result.error || result.stderr.trim() || (result.truncated ? "Output truncated while running Godot" : undefined),
    };
  }

  /** Execute a raw command while preserving process metadata and both output streams. */
  async executeRawDetailed(args: string[], cwd?: string, timeoutMs?: number): Promise<CommandExecutionResult> {
    const startedAt = Date.now();
    const processResult = await this.runBuffered(args, cwd, timeoutMs);
    const effectiveTimeout = processResult.timedOutAfterMs ?? timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return {
      success: !processResult.error && !processResult.timedOut && processResult.code === 0,
      exitCode: processResult.code,
      stdout: processResult.stdout,
      stderr: processResult.stderr,
      timedOut: processResult.timedOut,
      truncated: processResult.truncated,
      durationMs: Date.now() - startedAt,
      error: processResult.error || (processResult.timedOut
        ? `Godot command timed out after ${effectiveTimeout}ms`
        : undefined),
    };
  }

  /** Run a project for a bounded number of frames and capture its output. */
  async runProjectDiagnostics(
    projectPath: string,
    options: { scenePath?: string; frames: number; fixedFps?: number; debug: boolean; timeoutMs: number }
  ): Promise<CommandExecutionResult> {
    const args = ["--headless", "--path", projectPath];
    if (options.debug) {
      args.push("--debug");
    }
    if (options.fixedFps !== undefined) {
      args.push("--fixed-fps", String(options.fixedFps));
    }
    args.push("--quit-after", String(options.frames));
    if (options.scenePath) {
      args.push(options.scenePath);
    }

    return this.executeRawDetailed(args, projectPath, options.timeoutMs);
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

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.processLimiter.close();
    for (const child of this.activeChildren) {
      this.killProcess(child, "SIGTERM");
    }
    const deadline = Date.now() + 2_000;
    while (this.activeChildren.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    for (const child of this.activeChildren) {
      this.killProcess(child, "SIGKILL");
    }
  }

  private runBuffered(args: string[], cwd?: string, timeoutMs?: number): Promise<BufferedProcessResult> {
    const signal = getExecutionSignal();
    return this.processLimiter.run(signal, () => this.runBufferedProcess(args, cwd, timeoutMs, signal));
  }

  private runBufferedProcess(
    args: string[],
    cwd: string | undefined,
    timeoutMs: number | undefined,
    signal: AbortSignal | undefined
  ): Promise<BufferedProcessResult> {
    const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let truncated = false;
      let timeout: NodeJS.Timeout | undefined;
      let forceKillTimeout: NodeJS.Timeout | undefined;
      let forceFinishTimeout: NodeJS.Timeout | undefined;
      let aborted = false;
      let abortListener: (() => void) | undefined;

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
        if (forceKillTimeout) {
          clearTimeout(forceKillTimeout);
        }
        if (forceFinishTimeout) {
          clearTimeout(forceFinishTimeout);
        }
        if (signal && abortListener) {
          signal.removeEventListener("abort", abortListener);
        }
        if (proc) {
          this.activeChildren.delete(proc);
        }
        resolve(result);
      };

      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn(this.godotPath, args, {
          cwd,
          detached: process.platform !== "win32",
          env: { ...process.env },
          stdio: ["ignore", "pipe", "pipe"],
        });
        this.activeChildren.add(proc);
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

      abortListener = () => {
        if (settled) {
          return;
        }
        aborted = true;
        this.killProcess(proc, "SIGTERM");
        forceKillTimeout = setTimeout(() => {
          if (!settled) {
            this.killProcess(proc, "SIGKILL");
          }
        }, 1_000).unref();
        forceFinishTimeout = setTimeout(() => {
          finish({ code: null, stdout, stderr, timedOut: false, truncated, aborted: true, error: "Operation cancelled" });
        }, 2_000).unref();
      };
      signal?.addEventListener("abort", abortListener, { once: true });
      if (signal?.aborted) {
        abortListener();
      }

      timeout = setTimeout(() => {
        timedOut = true;
        this.killProcess(proc, "SIGTERM");

        forceKillTimeout = setTimeout(() => {
          if (!settled) {
            this.killProcess(proc, "SIGKILL");
          }
        }, 1_000).unref();

        forceFinishTimeout = setTimeout(() => {
          finish({
            code: null,
            stdout,
            stderr,
            timedOut: true,
            truncated,
            timedOutAfterMs: effectiveTimeout,
          });
        }, 2_000).unref();
      }, effectiveTimeout);

      proc.stdout?.on("data", (data: Buffer) => {
        stdout = appendOutput(stdout, data);
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr = appendOutput(stderr, data);
      });

      proc.on("close", (code) => {
        finish({
          code,
          stdout,
          stderr,
          timedOut,
          truncated,
          timedOutAfterMs: timedOut ? effectiveTimeout : undefined,
          aborted,
          error: aborted ? "Operation cancelled" : undefined,
        });
      });

      proc.on("error", (error) => {
        finish({ code: null, stdout, stderr, timedOut, truncated, error: error.message });
      });
    });
  }

  private killProcess(proc: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
    if (process.platform === "win32" && proc.pid) {
      const args = ["/PID", String(proc.pid), "/T"];
      if (signal === "SIGKILL") args.push("/F");
      const killer = spawn("taskkill", args, { stdio: "ignore", windowsHide: true });
      killer.unref();
      return;
    }
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
