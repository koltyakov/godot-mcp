import * as net from "node:net";

import type { BridgeDescriptor } from "./discovery.js";
import { getExecutionSignal } from "../../execution-context.js";

type RpcResponse = { id?: number; result?: unknown; error?: { code?: number; message?: string } };

function requestLine(id: number, method: string, params: Record<string, unknown>): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

export async function callEditorBridge(
  descriptor: BridgeDescriptor,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 5_000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const signal = getExecutionSignal();
    const socket = net.createConnection({ host: descriptor.host, port: descriptor.port });
    let buffer = "";
    let authenticated = false;
    const timeout = setTimeout(() => finish(new Error(`Editor bridge timed out after ${timeoutMs}ms`)), timeoutMs);
    timeout.unref();

    const finish = (error?: Error, value?: unknown): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      error ? reject(error) : resolve(value);
    };
    const onAbort = (): void => {
      const error = new Error("Operation cancelled");
      error.name = "AbortError";
      finish(error);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    socket.setEncoding("utf-8");
    socket.once("error", (error) => finish(error));
    socket.once("connect", () => {
      socket.write(requestLine(1, "bridge.hello", {
        protocol: 1,
        token: descriptor.token,
        client: { name: "godot-mcp", version: "1.0.0" },
      }));
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 4 * 1024 * 1024) {
        finish(new Error("Editor bridge response exceeded 4 MiB"));
        return;
      }
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        let response: RpcResponse;
        try {
          response = JSON.parse(line) as RpcResponse;
        } catch {
          finish(new Error("Editor bridge returned malformed JSON"));
          return;
        }
        if (response.error) {
          finish(new Error(response.error.message ?? "Editor bridge request failed"));
          return;
        }
        if (!authenticated && response.id === 1) {
          authenticated = true;
          socket.write(requestLine(2, method, params));
        } else if (authenticated && response.id === 2) {
          finish(undefined, response.result);
          return;
        }
      }
    });
  });
}
