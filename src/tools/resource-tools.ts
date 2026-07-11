import * as fs from "node:fs/promises";

import type { ToolHandler } from "./types.js";
import { destructiveAnnotations, readOnlyAnnotations } from "./types.js";
import { projectSelectorProperties, resolveProjectPath } from "./project-context.js";
import { getProjectFilePath, normalizeResourcePath, resolveExistingProjectFilePath, RESOURCE_EXTENSIONS } from "./path-utils.js";
import { executeGodotOperation } from "./godot-operation.js";
import { buildDependencyReport, findUsages } from "../dependency-graph.js";

export const listResourcesTool: ToolHandler = {
  definition: {
    name: "list_resources",
    description: "List Godot .tres and .res resource files without spawning Godot.",
    inputSchema: { type: "object", properties: { ...projectSelectorProperties }, required: [] },
    annotations: readOnlyAnnotations,
  },
  async execute(args) {
    const report = await buildDependencyReport(args);
    const resources = Object.values(report.nodes).filter((node) => node.kind === "resource").map((node) => node.path).sort();
    return { project_path: report.projectPath, resources, count: resources.length };
  },
};

export const readResourceTool: ToolHandler = {
  definition: {
    name: "read_resource",
    description: "Read a Godot .tres or .res resource and return its stored properties as JSON-safe values.",
    inputSchema: {
      type: "object",
      properties: { ...projectSelectorProperties, resource_path: { type: "string" } },
      required: ["resource_path"],
    },
    annotations: readOnlyAnnotations,
  },
  async execute(args, executor) {
    const projectPath = await resolveProjectPath(args);
    const resourcePath = normalizeResourcePath(args.resource_path as string, { fieldName: "resource_path", extensions: RESOURCE_EXTENSIONS });
    return executeGodotOperation(executor, projectPath, "read_resource", { resource_path: resourcePath }, "Failed to read resource");
  },
};

export const updateResourceTool: ToolHandler = {
  definition: {
    name: "update_resource",
    description: "Update stored properties on an existing Godot resource.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        resource_path: { type: "string" },
        properties: { type: "object", additionalProperties: true },
      },
      required: ["resource_path", "properties"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    const projectPath = await resolveProjectPath(args);
    const resourcePath = normalizeResourcePath(args.resource_path as string, { fieldName: "resource_path", extensions: RESOURCE_EXTENSIONS });
    const properties = args.properties as Record<string, unknown>;
    if (!properties || Object.keys(properties).length === 0) throw new Error("properties must be a non-empty object");
    return executeGodotOperation(executor, projectPath, "update_resource", { resource_path: resourcePath, properties }, "Failed to update resource");
  },
};

export const deleteResourceTool: ToolHandler = {
  definition: {
    name: "delete_resource",
    description: "Delete a Godot resource. Referenced resources are refused unless force=true.",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
        resource_path: { type: "string" },
        force: { type: "boolean", default: false },
      },
      required: ["resource_path"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args) {
    const projectPath = await resolveProjectPath(args);
    const resourcePath = normalizeResourcePath(args.resource_path as string, { fieldName: "resource_path", extensions: RESOURCE_EXTENSIONS });
    if (args.force !== true) {
      const usages = findUsages(await buildDependencyReport({ project_path: projectPath }), resourcePath);
      if (usages.referencedBy.length > 0) {
        throw new Error(`Resource is referenced by ${usages.referencedBy.join(", ")}; pass force=true to delete it`);
      }
      throw new Error("Static dependency analysis cannot prove this resource is unreferenced (UID, binary, addon, and dynamic references may exist); pass force=true to delete it");
    }
    const requestedPath = getProjectFilePath(projectPath, resourcePath, { fieldName: "resource_path", extensions: RESOURCE_EXTENSIONS });
    const requestedStats = await fs.lstat(requestedPath);
    if (requestedStats.isSymbolicLink()) throw new Error(`resource_path must not be a symbolic link: ${resourcePath}`);
    const resolved = await resolveExistingProjectFilePath(projectPath, resourcePath, { fieldName: "resource_path", extensions: RESOURCE_EXTENSIONS });
    await fs.rm(resolved.fsPath);
    return { success: true, resource_path: resolved.resourcePath, message: `Deleted resource ${resolved.resourcePath}` };
  },
};

export const resourceTools = [listResourcesTool, readResourceTool, updateResourceTool, deleteResourceTool];
