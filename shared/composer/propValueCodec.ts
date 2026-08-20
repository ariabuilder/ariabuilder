/**
 * Prop value encode/decode helpers for the Props inspector.
 * Preserves string / expr / bare / boolean / template-literal kinds on serialize.
 * Spread + shorthand are opaque — never rewrite via the inspector codec.
 */

import type { PropValue } from "./types";

/** Spread / shorthand cannot be safely re-encoded from a text field. */
export function isOpaquePropValue(v: PropValue | undefined): boolean {
  return v?.type === "spread" || v?.type === "shorthand";
}

/** Displayable text for an attribute value; '' means a bare attribute. */
export function decodeAttr(v: PropValue | undefined): string {
  if (v == null || v.type === "bare") return "";
  if (v.type === "expr") return `{${v.value}}`;
  if (v.type === "spread") return `{...${v.value}}`;
  if (v.type === "shorthand") return `{${v.value}}`;
  if (v.type === "template-literal") return `{\`${v.value}\`}`;
  return String(v.value);
}

/**
 * Inverse of decodeAttr for editable kinds.
 * Pass `existing` so template-literal (and opaque) kinds are preserved.
 */
export function encodeAttr(
  text: string,
  existing?: PropValue,
): PropValue {
  if (isOpaquePropValue(existing)) {
    return existing!;
  }
  if (text === "") return { type: "bare" };

  const braced = text.match(/^\{([\s\S]*)\}$/);
  if (braced) {
    const inner = braced[1]!.trim();
    const ticks = inner.match(/^`([\s\S]*)`$/);
    if (ticks || existing?.type === "template-literal") {
      if (ticks) return { type: "template-literal", value: ticks[1]! };
      // Existing template-literal edited without outer braces in the field
      // should not reach here (decode wraps); treat as expr conversion.
      return { type: "expr", value: inner };
    }
    return { type: "expr", value: inner };
  }

  if (existing?.type === "template-literal") {
    return { type: "template-literal", value: text };
  }
  return { type: "string", value: text };
}

/**
 * Commit a typed string field while preserving existing value kind when
 * the current value is an expression or template literal.
 */
export function commitStringValue(
  existing: PropValue | undefined,
  text: string,
): PropValue | undefined {
  if (isOpaquePropValue(existing)) return existing;
  if (text === "") return undefined;
  if (existing?.type === "expr") {
    return { type: "expr", value: text };
  }
  if (existing?.type === "template-literal") {
    return { type: "template-literal", value: text };
  }
  return { type: "string", value: text };
}

/** Boolean field: bare HTML attrs stay bare; otherwise expr true/false. */
export function commitBooleanValue(
  existing: PropValue | undefined,
  checked: boolean,
  preferBare: boolean,
): PropValue | undefined {
  if (preferBare || existing?.type === "bare") {
    return checked ? { type: "bare" } : undefined;
  }
  return { type: "expr", value: checked ? "true" : "false" };
}

export function isBooleanChecked(
  value: PropValue | undefined,
  defaultValue: boolean | undefined,
): boolean {
  if (value == null) return !!defaultValue;
  if (value.type === "bare") return true;
  if (value.type === "expr") {
    return value.value !== "false" && value.value !== "0";
  }
  if (value.type === "string") {
    return value.value !== "false" && value.value !== "0" && value.value !== "";
  }
  return true;
}

export function stringFieldDisplay(
  value: PropValue | undefined,
): { text: string; isExpr: boolean; opaque: boolean } {
  if (!value) return { text: "", isExpr: false, opaque: false };
  if (value.type === "bare") return { text: "", isExpr: false, opaque: false };
  if (value.type === "expr") {
    return { text: value.value, isExpr: true, opaque: false };
  }
  if (value.type === "template-literal") {
    return { text: value.value, isExpr: true, opaque: false };
  }
  if (value.type === "spread" || value.type === "shorthand") {
    return { text: value.value, isExpr: true, opaque: true };
  }
  return { text: String(value.value), isExpr: false, opaque: false };
}
