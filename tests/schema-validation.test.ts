import assert from "node:assert/strict";
import test from "node:test";

import { validateSchemaValue } from "../src/schema-validation.js";

test("schema validation accepts integers and enforces numeric bounds", () => {
  const schema = { type: "integer", minimum: 1, maximum: 10 };

  assert.deepEqual(validateSchemaValue(schema, 2, "value"), []);
  assert.deepEqual(validateSchemaValue(schema, 2.5, "value"), ["value must be integer"]);
  assert.deepEqual(validateSchemaValue(schema, 11, "value"), ["value must be at most 10"]);
});

test("required properties can explicitly contain null JSON values", () => {
  const schema = {
    type: "object",
    properties: { value: {} },
    required: ["value"],
  };

  assert.deepEqual(validateSchemaValue(schema, { value: null }, "arguments"), []);
  assert.deepEqual(validateSchemaValue(schema, {}, "arguments"), ["arguments.value is required"]);
  assert.deepEqual(
    validateSchemaValue({ ...schema, properties: { value: { type: "string" } } }, { value: null }, "arguments"),
    ["arguments.value must be string"]
  );
});
