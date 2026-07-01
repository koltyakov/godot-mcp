import * as fs from "fs/promises";
import * as path from "path";
import { isGodotProject } from "../godot/finder.js";

export const SCENE_EXTENSIONS = [".tscn", ".scn"] as const;
export const SCRIPT_EXTENSIONS = [".gd"] as const;
export const RESOURCE_EXTENSIONS = [".tres", ".res"] as const;

type ResourcePathOptions = {
  fieldName?: string;
  extensions?: readonly string[];
};

function isPathInside(parentPath: string, targetPath: string): boolean {
  const relativePath = path.relative(parentPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function formatExtensions(extensions: readonly string[]): string {
  return extensions.join(" or ");
}

export function normalizeAbsoluteProjectPath(projectPath: string): string {
  if (!projectPath || !path.isAbsolute(projectPath)) {
    throw new Error("project_path must be an absolute path");
  }

  return path.resolve(projectPath);
}

export async function validateGodotProjectPath(projectPath: string): Promise<string> {
  const absoluteProjectPath = normalizeAbsoluteProjectPath(projectPath);
  const realProjectPath = await fs.realpath(absoluteProjectPath).catch(() => null);

  if (!realProjectPath) {
    throw new Error(`Not a valid Godot project: ${projectPath}`);
  }

  const stats = await fs.stat(realProjectPath);
  if (!stats.isDirectory() || !(await isGodotProject(realProjectPath))) {
    throw new Error(`Not a valid Godot project: ${projectPath}`);
  }

  return realProjectPath;
}

export function normalizeResourcePath(resourcePath: string, options: ResourcePathOptions = {}): string {
  const fieldName = options.fieldName ?? "resource path";

  if (!resourcePath) {
    throw new Error(`${fieldName} is required`);
  }

  if (resourcePath.includes("\0")) {
    throw new Error(`${fieldName} contains an invalid null byte`);
  }

  if (path.isAbsolute(resourcePath) || path.win32.isAbsolute(resourcePath)) {
    throw new Error(`${fieldName} must be relative to the project or use res://`);
  }

  const hasUnsupportedScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(resourcePath) && !resourcePath.startsWith("res://");
  if (hasUnsupportedScheme) {
    throw new Error(`${fieldName} must use res:// or be relative to the project`);
  }

  const rawRelativePath = resourcePath.startsWith("res://")
    ? resourcePath.slice("res://".length)
    : resourcePath;
  const relativePath = rawRelativePath.replace(/\\/g, "/");

  if (!relativePath || relativePath.startsWith("/") || relativePath.includes(":")) {
    throw new Error(`${fieldName} must be relative to the project or use res://`);
  }

  const normalizedPath = path.posix.normalize(relativePath);
  if (normalizedPath === "." || normalizedPath === ".." || normalizedPath.startsWith("../")) {
    throw new Error(`${fieldName} escapes project directory: ${resourcePath}`);
  }

  if (options.extensions && !options.extensions.some((extension) => normalizedPath.toLowerCase().endsWith(extension))) {
    throw new Error(`${fieldName} must end with ${formatExtensions(options.extensions)}`);
  }

  return `res://${normalizedPath}`;
}

export function getProjectFilePath(projectPath: string, resourcePath: string, options: ResourcePathOptions = {}): string {
  const normalizedResourcePath = normalizeResourcePath(resourcePath, options);
  return path.resolve(projectPath, normalizedResourcePath.slice("res://".length));
}

export async function resolveExistingProjectFilePath(
  projectPath: string,
  resourcePath: string,
  options: ResourcePathOptions = {}
): Promise<{ fsPath: string; resourcePath: string }> {
  const normalizedResourcePath = normalizeResourcePath(resourcePath, options);
  const fsPath = path.resolve(projectPath, normalizedResourcePath.slice("res://".length));
  const realPath = await fs.realpath(fsPath);

  if (!isPathInside(projectPath, realPath)) {
    throw new Error(`${options.fieldName ?? "resource path"} escapes project directory: ${resourcePath}`);
  }

  const stats = await fs.stat(realPath);
  if (!stats.isFile()) {
    throw new Error(`${options.fieldName ?? "resource path"} is not a file: ${resourcePath}`);
  }

  return { fsPath: realPath, resourcePath: normalizedResourcePath };
}

export async function resolveWritableProjectFilePath(
  projectPath: string,
  resourcePath: string,
  options: ResourcePathOptions = {}
): Promise<{ fsPath: string; resourcePath: string }> {
  const normalizedResourcePath = normalizeResourcePath(resourcePath, options);
  const fsPath = path.resolve(projectPath, normalizedResourcePath.slice("res://".length));
  const parentPath = path.dirname(fsPath);

  await fs.mkdir(parentPath, { recursive: true });

  const realParentPath = await fs.realpath(parentPath);
  if (!isPathInside(projectPath, realParentPath)) {
    throw new Error(`${options.fieldName ?? "resource path"} escapes project directory: ${resourcePath}`);
  }

  const existingStats = await fs.lstat(fsPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  });

  if (existingStats?.isSymbolicLink()) {
    throw new Error(`${options.fieldName ?? "resource path"} must not be a symbolic link: ${resourcePath}`);
  }

  if (existingStats && !existingStats.isFile()) {
    throw new Error(`${options.fieldName ?? "resource path"} is not a file: ${resourcePath}`);
  }

  return { fsPath, resourcePath: normalizedResourcePath };
}
