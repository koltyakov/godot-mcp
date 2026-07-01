import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface RunningGodotProcess {
  pid: number;
  commandLine: string;
  cwd?: string;
}

export interface OpenGodotProject {
  project_name: string;
  project_path: string;
  process_ids: number[];
}

/**
 * Common Godot installation paths by platform
 */
const GODOT_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Godot.app/Contents/MacOS/Godot",
    "/Applications/Godot_mono.app/Contents/MacOS/Godot",
    `${process.env.HOME}/Applications/Godot.app/Contents/MacOS/Godot`,
    `${process.env.HOME}/Applications/Godot_mono.app/Contents/MacOS/Godot`,
  ],
  win32: [
    "C:\\Program Files\\Godot\\Godot.exe",
    "C:\\Program Files (x86)\\Godot\\Godot.exe",
    `${process.env.LOCALAPPDATA}\\Godot\\Godot.exe`,
    `${process.env.USERPROFILE}\\scoop\\apps\\godot\\current\\godot.exe`,
  ],
  linux: [
    "/usr/bin/godot",
    "/usr/local/bin/godot",
    "/usr/bin/godot4",
    "/usr/local/bin/godot4",
    `${process.env.HOME}/.local/bin/godot`,
    "/snap/bin/godot",
    "/var/lib/flatpak/exports/bin/org.godotengine.Godot",
  ],
};

/**
 * Check if a file exists and is executable
 */
async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to find Godot in PATH
 */
function firstCommandPath(stdout: string): string | undefined {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

async function findInPath(): Promise<string | null> {
  try {
    const command = process.platform === "win32" ? "where godot" : "which godot";
    const { stdout } = await execAsync(command);
    const godotPath = firstCommandPath(stdout);
    if (godotPath && (await isExecutable(godotPath))) {
      return godotPath;
    }
  } catch {
    // Not found in PATH
  }

  // Also try godot4 on Unix systems
  if (process.platform !== "win32") {
    try {
      const { stdout } = await execAsync("which godot4");
      const godotPath = firstCommandPath(stdout);
      if (godotPath && (await isExecutable(godotPath))) {
        return godotPath;
      }
    } catch {
      // Not found
    }
  }

  return null;
}

/**
 * Find Godot executable path
 */
export async function findGodotPath(): Promise<string | null> {
  // Check environment variable first
  const envPath = process.env.GODOT_PATH;
  if (envPath && (await isExecutable(envPath))) {
    return envPath;
  }

  // Try to find in PATH
  const pathResult = await findInPath();
  if (pathResult) {
    return pathResult;
  }

  // Check common installation paths
  const platform = process.platform as keyof typeof GODOT_PATHS;
  const paths = GODOT_PATHS[platform] || [];

  for (const godotPath of paths) {
    if (await isExecutable(godotPath)) {
      return godotPath;
    }
  }

  return null;
}

/**
 * Validate that a path is a valid Godot project
 */
export async function isGodotProject(projectPath: string): Promise<boolean> {
  try {
    const projectFile = path.join(projectPath, "project.godot");
    await fs.access(projectFile, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function tokenizeCommandLine(commandLine: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < commandLine.length; i += 1) {
    const char = commandLine[i];
    const next = commandLine[i + 1];

    if (char === "\\" && next && (next === " " || next === "\t" || next === '"' || next === "'" || next === "\\")) {
      token += next;
      i += 1;
      continue;
    }

    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }

    if (!quote && /\s/.test(char)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }

    token += char;
  }

  if (token) {
    tokens.push(token);
  }

  return tokens;
}

function looksLikeGodotProcess(commandLine: string): boolean {
  const tokens = tokenizeCommandLine(commandLine);
  const executable = tokens[0] ?? "";
  const executableName = path.basename(executable).toLowerCase();
  const normalizedCommand = commandLine.replace(/\\/g, "/").toLowerCase();

  return (
    executableName.includes("godot") ||
    normalizedCommand.includes("/godot.app/contents/macos/godot") ||
    normalizedCommand.includes("org.godotengine.godot")
  );
}

export function parseGodotProjectPathFromCommandLine(commandLine: string): string | null {
  const tokens = tokenizeCommandLine(commandLine);

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token === "--path" || token === "-path") {
      return tokens[i + 1] ?? null;
    }

    if (token.startsWith("--path=")) {
      return token.slice("--path=".length) || null;
    }

    if (token.endsWith("project.godot")) {
      return token.includes("\\") ? path.win32.dirname(token) : path.dirname(token);
    }
  }

  return null;
}

function parseUnixProcessList(output: string): RunningGodotProcess[] {
  return output
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(.+)$/))
    .flatMap((match): RunningGodotProcess[] => {
      if (!match) {
        return [];
      }

      const commandLine = match[2];
      if (!looksLikeGodotProcess(commandLine)) {
        return [];
      }

      return [{ pid: Number(match[1]), commandLine }];
    });
}

async function findProcessCwd(pid: number): Promise<string | undefined> {
  try {
    if (process.platform === "linux") {
      return await fs.readlink(`/proc/${pid}/cwd`);
    }

    if (process.platform === "darwin") {
      const { stdout } = await execAsync(`lsof -a -p ${pid} -d cwd -Fn`);
      return stdout.match(/^n(.+)$/m)?.[1];
    }
  } catch {
    // Process may have exited or cwd may be inaccessible.
  }

  return undefined;
}

async function findRunningGodotProcesses(): Promise<RunningGodotProcess[]> {
  if (process.platform === "win32") {
    try {
      const command =
        "powershell -NoProfile -Command \"Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'Godot' -or $_.CommandLine -match 'Godot' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress\"";
      const { stdout } = await execAsync(command);
      const trimmed = stdout.trim();
      if (!trimmed) {
        return [];
      }

      const parsed = JSON.parse(trimmed) as { ProcessId: number; CommandLine?: string } | Array<{ ProcessId: number; CommandLine?: string }>;
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      return entries.flatMap((entry): RunningGodotProcess[] => {
        if (!entry.CommandLine || !looksLikeGodotProcess(entry.CommandLine)) {
          return [];
        }

        return [{ pid: entry.ProcessId, commandLine: entry.CommandLine }];
      });
    } catch {
      return [];
    }
  }

  try {
    const { stdout } = await execAsync("ps -axo pid=,command=");
    const processes = parseUnixProcessList(stdout);
    return Promise.all(
      processes.map(async (processInfo) => ({
        ...processInfo,
        cwd: await findProcessCwd(processInfo.pid),
      }))
    );
  } catch {
    return [];
  }
}

function parseConfigValue(content: string, section: string, key: string): string | undefined {
  const sectionMatch = content.match(new RegExp(`\\[${section}\\]([\\s\\S]*?)(?:\\n\\[|$)`));
  const sectionContent = sectionMatch?.[1];
  if (!sectionContent) {
    return undefined;
  }

  const line = sectionContent
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${key}=`));
  const rawValue = line?.slice(key.length + 1).trim();
  if (!rawValue) {
    return undefined;
  }

  const value = rawValue.startsWith("&") ? rawValue.slice(1).trim() : rawValue;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }

  return value;
}

async function readProjectName(projectPath: string): Promise<string> {
  try {
    const content = await fs.readFile(path.join(projectPath, "project.godot"), "utf-8");
    return parseConfigValue(content, "application", "config/name") || path.basename(projectPath);
  } catch {
    return path.basename(projectPath);
  }
}

export async function resolveOpenGodotProjectsFromProcesses(processes: RunningGodotProcess[]): Promise<OpenGodotProject[]> {
  const projects = new Map<string, OpenGodotProject>();

  for (const processInfo of processes) {
    const rawProjectPath = parseGodotProjectPathFromCommandLine(processInfo.commandLine) || processInfo.cwd;
    if (!rawProjectPath) {
      continue;
    }

    const absoluteProjectPath = path.resolve(processInfo.cwd ?? process.cwd(), rawProjectPath);
    const projectPath = await fs.realpath(absoluteProjectPath).catch(() => null);
    if (!projectPath || !(await isGodotProject(projectPath))) {
      continue;
    }

    const projectKey = path.normalize(projectPath);
    const existing = projects.get(projectKey);
    if (existing) {
      existing.process_ids.push(processInfo.pid);
      continue;
    }

    projects.set(projectKey, {
      project_name: await readProjectName(projectPath),
      project_path: projectPath,
      process_ids: [processInfo.pid],
    });
  }

  return [...projects.values()].sort((a, b) => a.project_name.localeCompare(b.project_name) || a.project_path.localeCompare(b.project_path));
}

/**
 * Find Godot projects currently opened by running Godot editor processes.
 */
export async function findOpenGodotProjects(): Promise<OpenGodotProject[]> {
  return resolveOpenGodotProjectsFromProcesses(await findRunningGodotProcesses());
}

/**
 * Find all scene files in a Godot project
 */
export async function findSceneFiles(projectPath: string): Promise<string[]> {
  const scenes: string[] = [];

  async function scanDir(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      // Skip hidden directories and addons
      if (entry.name.startsWith(".") || entry.name === "addons") {
        continue;
      }

      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.name.endsWith(".tscn") || entry.name.endsWith(".scn")) {
        // Convert to res:// path
        const relativePath = path.relative(projectPath, fullPath).replace(/\\/g, "/");
        scenes.push(`res://${relativePath}`);
      }
    }
  }

  try {
    await scanDir(projectPath);
  } catch {
    // Ignore errors during scanning
  }

  return scenes;
}

/**
 * Find all script files in a Godot project
 */
export async function findScriptFiles(projectPath: string): Promise<string[]> {
  const scripts: string[] = [];

  async function scanDir(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.name.startsWith(".") || entry.name === "addons") {
        continue;
      }

      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.name.endsWith(".gd")) {
        const relativePath = path.relative(projectPath, fullPath).replace(/\\/g, "/");
        scripts.push(`res://${relativePath}`);
      }
    }
  }

  try {
    await scanDir(projectPath);
  } catch {
    // Ignore errors
  }

  return scripts;
}
