import assert from "node:assert/strict";
import test from "node:test";

import { listPromptDefinitions, getPrompt } from "../src/prompts/index.js";

test("listPromptDefinitions exposes the documented prompts", () => {
  const prompts = listPromptDefinitions();
  const names = prompts.map((p) => p.name);

  assert.ok(names.includes("new-2d-player"));
  assert.ok(names.includes("new-3d-player"));
  assert.ok(names.includes("gdscript-conventions"));
  assert.ok(names.includes("audit-scene"));
  assert.equal(new Set(names).size, names.length, "prompt names must be unique");
});

test("getPrompt returns user messages for the 2D scaffold prompt", () => {
  const result = getPrompt("new-2d-player", {
    scene_path: "res://scenes/player.tscn",
    script_path: "res://scripts/player.gd",
  });

  assert.ok(result.messages.length > 0);
  const msg = result.messages[0];
  assert.equal(msg.role, "user");
  if (msg.content.type !== "text") {
    assert.fail("expected text content");
  }
  assert.ok(msg.content.text.includes("res://scenes/player.tscn"));
  assert.ok(msg.content.text.includes("CharacterBody2D"));
});

test("getPrompt throws when a required argument is missing", () => {
  assert.throws(
    () => getPrompt("new-2d-player", { scene_path: "res://scenes/player.tscn" }),
    /Missing required argument "script_path"/
  );
});

test("getPrompt throws for an unknown prompt name", () => {
  assert.throws(() => getPrompt("does-not-exist", {}), /Unknown prompt: does-not-exist/);
});

test("gdscript-conventions requires no arguments and mentions Godot 4 idioms", () => {
  const result = getPrompt("gdscript-conventions", {});
  const text = result.messages[0].content;
  if (text.type !== "text") assert.fail("expected text content");
  assert.ok(text.text.includes("@export"));
  assert.ok(text.text.includes("get_gravity()"));
});

test("audit-scene embeds an encoded godot:// resource link in its instructions", () => {
  const result = getPrompt("audit-scene", { scene_path: "res://scenes/level.tscn" });
  const text = result.messages[0].content;
  if (text.type !== "text") assert.fail("expected text content");
  // The res:// path should appear encoded in the suggested resource URI.
  assert.ok(text.text.includes("godot://scene/"));
  assert.ok(text.text.includes(encodeURIComponent("res://scenes/level.tscn")));
});

test("all listed prompts declare their required arguments consistently", () => {
  for (const prompt of listPromptDefinitions()) {
    if (!prompt.arguments) continue;
    for (const arg of prompt.arguments) {
      if (arg.required) {
        // Calling without that arg must throw.
        assert.throws(
          () => getPrompt(prompt.name, {}),
          /Missing required argument/,
          `prompt ${prompt.name} should reject missing ${arg.name}`
        );
      }
    }
  }
});
