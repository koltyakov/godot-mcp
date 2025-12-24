import { spawn } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
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
    params: Record<string, unknown> = {}
  ): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const args = [
        "--headless",
        "--path", projectPath,
        "-s", this.operationsScriptPath,
        "--", operation, JSON.stringify(params),
      ];

      let stdout = "";
      let stderr = "";

      const proc = spawn(this.godotPath, args, {
        cwd: projectPath,
        env: { ...process.env },
      });

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        // Parse the output for our JSON result marker
        const resultMatch = stdout.match(/\[GODOT_MCP_RESULT\](.*)\[\/GODOT_MCP_RESULT\]/s);
        
        if (resultMatch) {
          try {
            const result = JSON.parse(resultMatch[1].trim());
            resolve({
              success: result.success ?? true,
              output: result.output ?? result.message ?? JSON.stringify(result),
              error: result.error,
            });
            return;
          } catch {
            // Failed to parse JSON result
          }
        }

        resolve({
          success: code === 0,
          output: stdout.trim(),
          error: stderr.trim() || undefined,
        });
      });

      proc.on("error", (error) => {
        resolve({
          success: false,
          output: "",
          error: error.message,
        });
      });
    });
  }

  /**
   * Execute a raw Godot command without the operations script
   */
  async executeRaw(args: string[], cwd?: string): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";

      const proc = spawn(this.godotPath, args, {
        cwd,
        env: { ...process.env },
      });

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({
          success: code === 0,
          output: stdout.trim(),
          error: stderr.trim() || undefined,
        });
      });

      proc.on("error", (error) => {
        resolve({
          success: false,
          output: "",
          error: error.message,
        });
      });
    });
  }

  /**
   * Launch the Godot editor for a project
   */
  async launchEditor(projectPath: string): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const proc = spawn(this.godotPath, ["--editor", "--path", projectPath], {
        detached: true,
        stdio: "ignore",
      });

      proc.unref();

      resolve({
        success: true,
        output: `Launched Godot editor for project at ${projectPath}`,
      });
    });
  }

  /**
   * Run the project
   */
  async runProject(projectPath: string): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const proc = spawn(this.godotPath, ["--path", projectPath], {
        detached: true,
        stdio: "ignore",
      });

      proc.unref();

      resolve({
        success: true,
        output: `Running project at ${projectPath}`,
      });
    });
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
}
