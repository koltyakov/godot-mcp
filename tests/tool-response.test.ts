import assert from "node:assert/strict";
import test from "node:test";

import { toolErrorResponse, toolSuccessResponse } from "../src/tool-response.js";

test("toolSuccessResponse preserves structured objects and legacy text", () => {
  const response = toolSuccessResponse({ success: true, count: 2 });
  assert.deepEqual(response.structuredContent, { success: true, count: 2 });
  assert.match(response.content[0].text, /"count": 2/);
});

test("toolSuccessResponse wraps primitive results for structuredContent", () => {
  const response = toolSuccessResponse("created");
  assert.deepEqual(response.structuredContent, { result: "created" });
  assert.equal(response.content[0].text, "created");
});

test("toolErrorResponse provides a structured error", () => {
  assert.deepEqual(toolErrorResponse("failed"), {
    content: [{ type: "text", text: "Error: failed" }],
    structuredContent: { error: { message: "failed" } },
    isError: true,
  });
});
