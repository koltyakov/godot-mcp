import * as fs from "fs/promises";
import * as path from "path";

import { resolveProjectPath } from "./tools/project-context.js";
import { validateGodotProjectPath } from "./tools/path-utils.js";

const SCENE_EXT = new Set([".tscn", ".scn"]);
const SCRIPT_EXT = new Set([".gd"]);
const RESOURCE_EXT = new Set([".tres", ".res"]);
const SHADER_EXT = new Set([".gdshader", ".gdshaderinc"]);

const ALL_TRACKED = new Set<string>([...SCENE_EXT, ...SCRIPT_EXT, ...RESOURCE_EXT, ...SHADER_EXT]);

// Regexes for extracting references from Godot text-resource formats.
// .tscn/.tres lines look like:
//   [ext_resource type="Script" path="res://player.gd" id="1"]
//   [sub_resource type="..."]
//   script = ExtResource("1")
//   texture = SubResource("...")
const EXT_RESOURCE_RE = /\[ext_resource[^\]]*path="([^"]+)"/g;
// GDScript load()/preload() calls: load("res://...") or preload("res://...")
const LOAD_RE = /\b(?:load|preload)\s*\(\s*"([^"]+)"/g;
// class_name X  ->  reference by global class name
const CLASS_NAME_RE = /^\s*class_name\s+([A-Za-z_][A-Za-z0-9_]*)/m;
const SHADER_INCLUDE_RE = /^\s*#include\s+"([^"]+)"/gm;
const PROJECT_RESOURCE_RE = /\*?(res:\/\/[^"\s]+)/g;

export interface AssetNode {
  /** res:// path */
  path: string;
  kind: "scene" | "script" | "resource" | "shader" | "other";
  /** Forward references: res:// paths this asset depends on. */
  dependsOn: string[];
  /** Reverse references: res:// paths that depend on this asset. */
  referencedBy: string[];
  /** For scripts with a `class_name`, the global class name. */
  className?: string;
}

export interface DependencyReport {
  projectPath: string;
  /** All tracked asset paths keyed by res:// path. */
  nodes: Record<string, AssetNode>;
  /** Assets with zero inbound references (orphans relative to the scan root). */
  orphans: string[];
  counts: {
    scenes: number;
    scripts: number;
    resources: number;
    shaders: number;
    other: number;
  };
  complete: boolean;
  warnings: string[];
  unresolved: string[];
}

type ParsedDependencies = { refs: string[]; className?: string; unresolved: string[]; warning?: string };
type CachedDependencies = ParsedDependencies & { mtimeMs: number; size: number };
const dependencyFileCache = new Map<string, CachedDependencies>();
const pendingReports = new Map<string, Promise<DependencyReport>>();

export function invalidateDependencyGraph(projectPath?: string): void {
  if (!projectPath) {
    dependencyFileCache.clear();
    pendingReports.clear();
    return;
  }
  const prefix = `${path.resolve(projectPath)}${path.sep}`;
  for (const key of dependencyFileCache.keys()) if (key.startsWith(prefix)) dependencyFileCache.delete(key);
  pendingReports.delete(path.resolve(projectPath));
}

function resPath(projectPath: string, absPath: string): string {
  const rel = path.relative(projectPath, absPath).replace(/\\/g, "/");
  return `res://${rel}`;
}

function kindFor(ext: string): AssetNode["kind"] {
  if (SCENE_EXT.has(ext)) return "scene";
  if (SCRIPT_EXT.has(ext)) return "script";
  if (RESOURCE_EXT.has(ext)) return "resource";
  if (SHADER_EXT.has(ext)) return "shader";
  return "other";
}

async function scanProject(projectPath: string, warnings: string[]): Promise<AssetNode[]> {
  const out: AssetNode[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      warnings.push(`Failed to scan directory ${dir}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        if (entry.name === "addons" || entry.name === ".godot") continue;
        await walk(path.join(dir, entry.name));
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (!ALL_TRACKED.has(ext)) continue;
        out.push({
          path: resPath(projectPath, path.join(dir, entry.name)),
          kind: kindFor(ext),
          dependsOn: [],
          referencedBy: [],
        });
      }
    }
  }

  await walk(projectPath);
  return out;
}

async function readDependencies(
  fsPath: string,
  kind: AssetNode["kind"]
): Promise<ParsedDependencies> {
  const stats = await fs.stat(fsPath).catch(() => null);
  if (!stats) return { refs: [], unresolved: [], warning: `Failed to stat tracked asset: ${fsPath}` };
  const cached = dependencyFileCache.get(fsPath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return { refs: [...cached.refs], className: cached.className, unresolved: [...cached.unresolved], warning: cached.warning };
  }

  let text: string;
  try {
    text = await fs.readFile(fsPath, "utf-8");
  } catch (error) {
    return { refs: [], unresolved: [], warning: `Failed to read tracked asset ${fsPath}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const refs = new Set<string>();
  const unresolved = [...new Set(text.match(/uid:\/\/[A-Za-z0-9]+/g) ?? [])].sort();
  if (kind === "scene" || kind === "resource" || kind === "shader") {
    for (const m of text.matchAll(EXT_RESOURCE_RE)) {
      refs.add(m[1]);
    }
  }
  if (kind === "shader") {
    for (const m of text.matchAll(SHADER_INCLUDE_RE)) refs.add(m[1]);
  }
  if (kind === "script") {
    for (const m of text.matchAll(LOAD_RE)) {
      refs.add(m[1]);
    }
    const classNameMatch = text.match(CLASS_NAME_RE);
    if (classNameMatch) {
      const result = { refs: [...refs], className: classNameMatch[1], unresolved };
      dependencyFileCache.set(fsPath, { ...result, mtimeMs: stats.mtimeMs, size: stats.size });
      return result;
    }
  }
  const result = { refs: [...refs], unresolved };
  dependencyFileCache.set(fsPath, { ...result, mtimeMs: stats.mtimeMs, size: stats.size });
  return result;
}

function localize(projectPath: string, sourcePath: string, refPath: string): string | null {
  if (refPath.startsWith("res://")) return refPath.replace(/\\/g, "/");
  if (refPath.startsWith("uid://")) return null; // UID refs need ClassDB to resolve
  if (path.isAbsolute(refPath)) return null;
  const sourceFsPath = path.join(projectPath, sourcePath.slice("res://".length));
  return resPath(projectPath, path.resolve(path.dirname(sourceFsPath), refPath));
}

export async function buildDependencyReport(
  args: Record<string, unknown>
): Promise<DependencyReport> {
  const projectPath = await resolveProjectPath(args);
  const realProjectPath = await validateGodotProjectPath(projectPath);
  if (args.refresh === true) invalidateDependencyGraph(realProjectPath);
  if (args.refresh !== true) {
    const pending = pendingReports.get(realProjectPath);
    if (pending) return pending;
  }

  const build = buildDependencyReportForProject(realProjectPath);
  pendingReports.set(realProjectPath, build);
  try {
    return await build;
  } finally {
    if (pendingReports.get(realProjectPath) === build) pendingReports.delete(realProjectPath);
  }
}

async function buildDependencyReportForProject(realProjectPath: string): Promise<DependencyReport> {
  const warnings: string[] = [];
  const nodes = await scanProject(realProjectPath, warnings);
  const nodeMap = new Map<string, AssetNode>();
  const unresolved = new Set<string>();
  for (const n of nodes) nodeMap.set(n.path, n);

  // Forward pass: read each file and collect dependencies.
  for (const node of nodes) {
    const fsPath = path.join(realProjectPath, node.path.slice("res://".length));
    const extension = path.extname(fsPath).toLowerCase();
    if (extension === ".scn" || extension === ".res") {
      warnings.push(`Opaque binary resource was not dependency-parsed: ${node.path}`);
      continue;
    }
    const { refs, className, unresolved: fileUnresolved, warning } = await readDependencies(fsPath, node.kind);
    if (warning) warnings.push(warning);
    for (const uid of fileUnresolved) unresolved.add(uid);
    if (className) node.className = className;
    for (const ref of refs) {
      const localized = localize(realProjectPath, node.path, ref);
      if (!localized) continue;
      // Drop self-references.
      if (localized === node.path) continue;
      node.dependsOn.push(localized);
    }
  }

  // Reverse pass: build referencedBy.
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      const target = nodeMap.get(dep);
      if (target) target.referencedBy.push(node.path);
    }
  }

  const projectFile = await fs.readFile(path.join(realProjectPath, "project.godot"), "utf-8").catch(() => "");
  for (const uid of projectFile.match(/uid:\/\/[A-Za-z0-9]+/g) ?? []) unresolved.add(uid);
  for (const match of projectFile.matchAll(PROJECT_RESOURCE_RE)) {
    const target = nodeMap.get(match[1]);
    if (target) target.referencedBy.push("res://project.godot");
  }

  for (const node of nodes) {
    node.dependsOn = [...new Set(node.dependsOn)].sort();
    node.referencedBy = [...new Set(node.referencedBy)].sort();
  }

  // Orphans = no inbound references (excluding scene files referenced as
  // main_scene in project.godot, which is a real but rarely-declared inbound
  // edge). We keep it simple: orphans are nodes with empty referencedBy.
  const orphans = nodes.filter((n) => n.referencedBy.length === 0).map((n) => n.path);

  const counts = { scenes: 0, scripts: 0, resources: 0, shaders: 0, other: 0 };
  for (const n of nodes) {
    if (n.kind === "scene") counts.scenes += 1;
    else if (n.kind === "script") counts.scripts += 1;
    else if (n.kind === "resource") counts.resources += 1;
    else if (n.kind === "shader") counts.shaders += 1;
    else counts.other += 1;
  }

  const nodesRecord: Record<string, AssetNode> = {};
  for (const n of nodes) nodesRecord[n.path] = n;

  if (unresolved.size > 0) warnings.push(`${unresolved.size} uid:// reference(s) require engine-assisted resolution`);
  const addonsPresent = await fs.stat(path.join(realProjectPath, "addons")).then((stats) => stats.isDirectory()).catch(() => false);
  if (addonsPresent) warnings.push("addons/ is excluded from dependency scanning");

  return {
    projectPath: realProjectPath,
    nodes: nodesRecord,
    orphans,
    counts,
    complete: warnings.length === 0,
    warnings: [...new Set(warnings)].sort(),
    unresolved: [...unresolved].sort(),
  };
}

export function findUsages(report: DependencyReport, targetPath: string): {
  target: string;
  referencedBy: string[];
  exists: boolean;
} {
  const normalized = targetPath.startsWith("res://")
    ? targetPath
    : `res://${targetPath.replace(/^\/+/, "")}`;
  const node = report.nodes[normalized];
  const referencedBy = node
    ? node.referencedBy
    : Object.values(report.nodes).filter((candidate) => candidate.dependsOn.includes(normalized)).map((candidate) => candidate.path).sort();
  return {
    target: normalized,
    exists: Boolean(node),
    referencedBy,
  };
}
