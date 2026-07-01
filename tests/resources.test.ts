import assert from "node:assert/strict";
import test from "node:test";

import { __testing } from "../src/resources/index.js";

const { parseGodotUri, encodeResPath, GODOT_SCHEME } = __testing;

test("parseGodotUri recognizes the project summary URI", () => {
  assert.deepEqual(parseGodotUri("godot://project"), { kind: "project" });
});

test("parseGodotUri decodes a percent-encoded scene res:// path", () => {
  const encoded = `godot://scene/${encodeResPath("res://scenes/main.tscn")}`;
  assert.deepEqual(parseGodotUri(encoded), {
    kind: "scene",
    resPath: "res://scenes/main.tscn",
  });
});

test("parseGodotUri decodes a percent-encoded script res:// path", () => {
  const encoded = `godot://script/${encodeResPath("res://scripts/player.gd")}`;
  assert.deepEqual(parseGodotUri(encoded), {
    kind: "script",
    resPath: "res://scripts/player.gd",
  });
});

test("parseGodotUri rejects non-godot schemes", () => {
  assert.equal(parseGodotUri("file:///x.tscn"), null);
  assert.equal(parseGodotUri("https://example.com"), null);
  assert.equal(parseGodotUri("not a url"), null);
});

test("parseGodotUri rejects unknown hosts and missing paths", () => {
  assert.equal(parseGodotUri("godot://entities/something"), null);
  assert.equal(parseGodotUri("godot://scene/"), null);
  assert.equal(parseGodotUri("godot://script/"), null);
});

test("encodeResPath percent-encodes the embedded res:// scheme", () => {
  const encoded = encodeResPath("res://scenes/player.tscn");
  // Must not contain a bare "://" otherwise URI parsing would split on it.
  assert.ok(!encoded.includes(":"));
  assert.ok(!encoded.includes("/"));
  // Round-trips through decodeURIComponent.
  assert.equal(decodeURIComponent(encoded), "res://scenes/player.tscn");
});

test("GODOT_SCHEME includes the trailing colon used by URL.protocol", () => {
  assert.equal(GODOT_SCHEME, "godot:");
});
