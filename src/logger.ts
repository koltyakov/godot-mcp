import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";

type SendLogFn = (level: LoggingLevel, logger: string, data: unknown) => Promise<void>;

const LEVEL_ORDER: Record<LoggingLevel, number> = {
  debug: 10,
  info: 20,
  notice: 30,
  warning: 40,
  error: 50,
  critical: 60,
  alert: 70,
  emergency: 80,
};

let sendLog: SendLogFn | null = null;
let minimumLevel: LoggingLevel = "debug";

export function setServerLogger(fn: SendLogFn | null): void {
  sendLog = fn;
}

export function setMinimumLogLevel(level: LoggingLevel): void {
  minimumLevel = level;
}

export function getMinimumLogLevel(): LoggingLevel {
  return minimumLevel;
}

/**
 * Emit a structured log message to the connected MCP client.
 * Silently no-ops when no client is connected or when the level
 * is below the configured minimum.
 */
export async function log(
  level: LoggingLevel,
  logger: string,
  data: unknown
): Promise<void> {
  if (!sendLog) {
    return;
  }

  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) {
    return;
  }

  try {
    await sendLog(level, logger, data);
  } catch {
    // Logging must never break tool execution.
  }
}
