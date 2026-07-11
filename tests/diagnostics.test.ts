import assert from "node:assert/strict";
import test from "node:test";

import { parseGodotDiagnostics } from "../src/godot/diagnostics.js";

test("parseGodotDiagnostics parses locations and associates stack lines", () => {
  const diagnostics = parseGodotDiagnostics([
    "SCRIPT ERROR: Invalid call. Nonexistent function 'jump'.",
    "  at: Player._physics_process (res://scripts/player.gd:17)",
    "res://scripts/enemy.gd:8:3 - Parse Error: Expected expression.",
    "WARNING: res://scenes/main.tscn:4 - Node is orphaned",
  ].join("\n"));

  assert.deepEqual(diagnostics, [
    {
      severity: "error",
      message: "Invalid call. Nonexistent function 'jump'.",
      file: "res://scripts/player.gd",
      line: 17,
    },
    {
      severity: "error",
      message: "Expected expression.",
      file: "res://scripts/enemy.gd",
      line: 8,
      column: 3,
    },
    {
      severity: "warning",
      message: "Node is orphaned",
      file: "res://scenes/main.tscn",
      line: 4,
    },
  ]);
});

test("parseGodotDiagnostics deduplicates repeated engine messages", () => {
  const line = "ERROR: res://scripts/player.gd:2 - Invalid assignment";
  assert.equal(parseGodotDiagnostics(`${line}\n${line}`).length, 1);
});

test("parseGodotDiagnostics associates debugger backtrace frames", () => {
  const diagnostics = parseGodotDiagnostics([
    "ERROR: Save failed",
    "[0] _ready (res://scripts/save_game.gd:9)",
  ].join("\n"));

  assert.deepEqual(diagnostics, [{
    severity: "error",
    message: "Save failed",
    file: "res://scripts/save_game.gd",
    line: 9,
  }]);
});
