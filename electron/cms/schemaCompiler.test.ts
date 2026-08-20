import { describe, expect, it } from "vitest";
import { validateCollectionSchema } from "../../shared/cms/schema/compiler";

function schema(fields: import("../../shared/cms/fieldSchema").FieldSchema[]) {
  return { id: "settings", label: "Settings", kind: "config" as const, fields, version: 1 };
}

describe("CMS schema key scope", () => {
  it("allows the same nested key in different object and repeater scopes", () => {
    expect(validateCollectionSchema(schema([
      {
        key: "profile",
        label: "Profile",
        type: "object",
        fields: [{ key: "value", label: "Value", type: "string" }],
      },
      {
        key: "stats",
        label: "Stats",
        type: "repeater",
        fields: [{ key: "value", label: "Value", type: "string" }],
      },
    ]))).toEqual([]);
  });

  it("still rejects duplicate keys among siblings", () => {
    expect(validateCollectionSchema(schema([
      { key: "value", label: "First", type: "string" },
      { key: "value", label: "Second", type: "string" },
    ]))).toContain('value: duplicate field key "value"');
  });
});
