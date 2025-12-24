import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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
async function findInPath(): Promise<string | null> {
  try {
    const command = process.platform === "win32" ? "where godot" : "which godot";
    const { stdout } = await execAsync(command);
    const godotPath = stdout.trim().split("\n")[0];
    if (await isExecutable(godotPath)) {
      return godotPath;
    }
  } catch {
    // Not found in PATH
  }

  // Also try godot4 on Unix systems
  if (process.platform !== "win32") {
    try {
      const { stdout } = await execAsync("which godot4");
      const godotPath = stdout.trim();
      if (await isExecutable(godotPath)) {
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
