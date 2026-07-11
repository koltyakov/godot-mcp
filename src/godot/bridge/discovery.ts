import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface BridgeDescriptor {
  schema: "godot-mcp-editor-bridge";
  protocol: 1;
  instance_id: string;
  pid: number;
  project_path: string;
  project_name: string;
  godot_version: string;
  host: "127.0.0.1";
  port: number;
  token: string;
  capabilities: string[];
  heartbeat_at_ms: number;
}

function isDescriptor(value: unknown): value is BridgeDescriptor {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return item.schema === "godot-mcp-editor-bridge" && item.protocol === 1 &&
    typeof item.instance_id === "string" && typeof item.pid === "number" &&
    typeof item.project_path === "string" && typeof item.project_name === "string" &&
    typeof item.godot_version === "string" && item.host === "127.0.0.1" &&
    typeof item.port === "number" && item.port > 0 && item.port <= 65535 &&
    typeof item.token === "string" && /^[a-f0-9]{64}$/.test(item.token) &&
    Array.isArray(item.capabilities) && typeof item.heartbeat_at_ms === "number";
}

export async function discoverEditorBridges(projectPath: string): Promise<BridgeDescriptor[]> {
  const canonicalProjectPath = await fs.realpath(projectPath);
  const instancesPath = path.join(canonicalProjectPath, ".godot", "godot_mcp_bridge", "instances");
  const entries = await fs.readdir(instancesPath, { withFileTypes: true }).catch(() => []);
  const descriptors = await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".json")) return null;
    const descriptorPath = path.join(instancesPath, entry.name);
    const stats = await fs.lstat(descriptorPath).catch(() => null);
    if (!stats?.isFile() || stats.isSymbolicLink()) return null;
    const parsed = await fs.readFile(descriptorPath, "utf-8")
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => null);
    if (!isDescriptor(parsed)) return null;
    const descriptorProjectPath = await fs.realpath(parsed.project_path).catch(() => "");
    if (descriptorProjectPath !== canonicalProjectPath) return null;
    if (Date.now() - parsed.heartbeat_at_ms > 15_000) {
      await fs.rm(descriptorPath, { force: true }).catch(() => undefined);
      return null;
    }
    return { ...parsed, project_path: canonicalProjectPath };
  }));
  return descriptors.filter((item): item is BridgeDescriptor => item !== null)
    .sort((a, b) => a.instance_id.localeCompare(b.instance_id));
}

export async function selectEditorBridge(projectPath: string, instanceId?: string): Promise<BridgeDescriptor | null> {
  const descriptors = await discoverEditorBridges(projectPath);
  if (instanceId) {
    return descriptors.find((item) => item.instance_id === instanceId) ?? null;
  }
  if (descriptors.length > 1) {
    throw new Error(`Multiple live editor instances are available; provide editor_instance_id (${descriptors.map((item) => item.instance_id).join(", ")})`);
  }
  return descriptors[0] ?? null;
}
