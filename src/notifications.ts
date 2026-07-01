type ListChangedFn = () => Promise<void>;

let resourceListChangedFn: ListChangedFn | null = null;

/**
 * Install the callback used to notify MCP clients that the set of
 * Godot resources exposed by this server has changed. Wired up once
 * the MCP `Server` is constructed in `index.ts`.
 */
export function setResourceListChangedNotifier(fn: ListChangedFn | null): void {
  resourceListChangedFn = fn;
}

/**
 * Emit a `notifications/resources/list_changed` notification when a
 * mutation tool changes the on-disk project contents. Silently no-ops
 * when no client is connected.
 */
export async function notifyResourcesChanged(): Promise<void> {
  if (!resourceListChangedFn) {
    return;
  }

  try {
    await resourceListChangedFn();
  } catch {
    // Notifications must never break tool execution.
  }
}
