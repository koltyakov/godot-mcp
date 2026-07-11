export type GodotDiagnosticSeverity = "error" | "warning";

export interface GodotDiagnostic {
  severity: GodotDiagnosticSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

type Location = Pick<GodotDiagnostic, "file" | "line" | "column">;

function parseLocation(value: string): Location | null {
  const match = value.match(/(res:\/\/.+?):(\d+)(?::(\d+))?(?=[\s)\]-]|$)/);
  if (!match) {
    return null;
  }

  return {
    file: match[1],
    line: Number(match[2]),
    ...(match[3] ? { column: Number(match[3]) } : {}),
  };
}

function diagnosticKey(diagnostic: GodotDiagnostic): string {
  return [
    diagnostic.severity,
    diagnostic.file ?? "",
    diagnostic.line ?? "",
    diagnostic.column ?? "",
    diagnostic.message,
  ].join("|");
}

/** Parse common Godot parser, script, engine, and debugger output formats. */
export function parseGodotDiagnostics(output: string): GodotDiagnostic[] {
  const diagnostics: GodotDiagnostic[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const location = parseLocation(line);
    const direct = line.match(/^(res:\/\/.+?):(\d+)(?::(\d+))?\s*(?:-|:)\s*(?:Parse Error:\s*)?(.*)$/i);
    if (direct) {
      diagnostics.push({
        severity: /warning/i.test(direct[4]) ? "warning" : "error",
        message: direct[4].trim(),
        file: direct[1],
        line: Number(direct[2]),
        ...(direct[3] ? { column: Number(direct[3]) } : {}),
      });
      continue;
    }

    const prefixed = line.match(/^(SCRIPT ERROR|ERROR|WARNING):\s*(.*)$/i);
    const timed = line.match(/^([EW])\s+\S+\s+(.*)$/);
    if (prefixed || timed) {
      const severity: GodotDiagnosticSeverity = prefixed
        ? (/warning/i.test(prefixed[1]) ? "warning" : "error")
        : timed?.[1] === "W" ? "warning" : "error";
      const message = (prefixed?.[2] ?? timed?.[2] ?? line)
        .replace(/^res:\/\/.+?:\d+(?::\d+)?\s*-\s*/, "")
        .trim();
      diagnostics.push({ severity, message, ...(location ?? {}) });
      continue;
    }

    if ((/^at:\s/i.test(line) || /^\[\d+\]\s/.test(line)) && location && diagnostics.length > 0) {
      const previous = diagnostics[diagnostics.length - 1];
      if (!previous.file) {
        Object.assign(previous, location);
      }
    }
  }

  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = diagnosticKey(diagnostic);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
