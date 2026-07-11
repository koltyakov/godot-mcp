import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { CommandExecutionResult, ExecutionResult, GodotExecutor } from "../src/godot/executor.js";

type TestContextWithCleanup = {
  after: (fn: () => Promise<void> | void) => void;
};

export async function createTempDir(t: TestContextWithCleanup): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "godot-mcp-test-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

export async function writeText(filePath: string, content = ""): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

export async function createGodotProject(
  t: TestContextWithCleanup,
  projectFileContent = `config_version=5

[application]

config/name="Test Project"
`
): Promise<string> {
  const projectPath = await createTempDir(t);
  await writeText(path.join(projectPath, "project.godot"), projectFileContent);
  return projectPath;
}

export function createMockGodotExecutor(
  handler: (projectPath: string, operation: string, params: Record<string, unknown>) => Promise<ExecutionResult> | ExecutionResult,
  options: {
    runProjectDiagnostics?: (
      projectPath: string,
      runOptions: { scenePath?: string; frames: number; fixedFps?: number; debug: boolean; timeoutMs: number }
    ) => Promise<CommandExecutionResult> | CommandExecutionResult;
  } = {}
): GodotExecutor {
  const successfulCommand: CommandExecutionResult = {
    success: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    truncated: false,
    durationMs: 1,
  };
  return {
    execute: handler,
    executeRaw: async () => ({ success: true, output: "" }),
    executeRawDetailed: async () => successfulCommand,
    launchEditor: async () => ({ success: true, output: "" }),
    runProject: async () => ({ success: true, output: "" }),
    runProjectDiagnostics: options.runProjectDiagnostics ?? (async () => successfulCommand),
    getVersion: async () => "4.3.stable",
    getGodotPath: () => "/mock/godot",
  } as unknown as GodotExecutor;
}
