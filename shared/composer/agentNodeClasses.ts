/**
 * Breakpoint-aware class updates for agent Composer tools.
 * Tailwind/Uno-style tokens (including `md:flex`) live in the Astro `class` string.
 */

import {
  addClassName,
  joinClassNames,
  removeClassName,
  splitClassNames,
} from "./classAttr";
import { FALLBACK_BREAKPOINTS, isLikelyUtilityClass } from "./frameworks";
import type { AstroPropMap, PropValue } from "./types";

export const CLASS_BREAKPOINTS = [
  "base",
  ...Object.keys(FALLBACK_BREAKPOINTS),
] as const;

export type ClassBreakpoint = (typeof CLASS_BREAKPOINTS)[number];

export type AgentClassNamesInput = Partial<Record<ClassBreakpoint, string[]>>;

export type AgentUpdateNodeClassesInput = {
  /** Replace the entire class string when provided alone (legacy). */
  classes?: string[];
  /** Add tokens (may include breakpoint prefixes like md:flex). */
  add?: string[];
  /** Remove exact tokens. */
  remove?: string[];
  /**
   * Breakpoint-keyed utilities. `base` tokens are bare; other keys are
   * prefixed (`md` + `flex` → `md:flex`) unless already prefixed.
   */
  classNames?: AgentClassNamesInput;
};

function flattenClassNames(classNames: AgentClassNamesInput): string[] {
  const tokens: string[] = [];
  for (const [breakpoint, values] of Object.entries(classNames)) {
    if (!Array.isArray(values)) continue;
    for (const raw of values) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      const token = raw.trim();
      if (breakpoint === "base" || token.includes(":")) {
        tokens.push(token);
        continue;
      }
      tokens.push(`${breakpoint}:${token}`);
    }
  }
  return tokens;
}

export function peekAgentNodeClassTokens(props: AstroPropMap | undefined): {
  propName: "class" | "class:list";
  tokens: string[];
  dynamic: boolean;
} {
  return readClassTokens(props ?? {});
}

function readClassTokens(props: AstroPropMap): {
  propName: "class" | "class:list";
  tokens: string[];
  dynamic: boolean;
} {
  if (props["class:list"]) {
    const value = props["class:list"];
    if (value?.type === "string") {
      return {
        propName: "class:list",
        tokens: splitClassNames(value.value),
        dynamic: false,
      };
    }
    return { propName: "class:list", tokens: [], dynamic: true };
  }
  const value = props.class;
  if (!value) return { propName: "class", tokens: [], dynamic: false };
  if (value.type !== "string") {
    return { propName: "class", tokens: [], dynamic: true };
  }
  return {
    propName: "class",
    tokens: splitClassNames(value.value),
    dynamic: false,
  };
}

export function applyAgentNodeClassUpdate(
  props: AstroPropMap,
  input: AgentUpdateNodeClassesInput,
): { ok: true; propName: string; value: PropValue | undefined; tokens: string[] } | { ok: false; reason: string } {
  const current = readClassTokens(props);
  if (current.dynamic) {
    return {
      ok: false,
      reason:
        "This dynamic class expression cannot be edited safely. Convert it to a string class or class:list first.",
    };
  }

  let tokens = [...current.tokens];
  const hasStructured =
    Boolean(input.add?.length) ||
    Boolean(input.remove?.length) ||
    Boolean(input.classNames && Object.keys(input.classNames).length);

  if (Array.isArray(input.classes) && !hasStructured) {
    tokens = [
      ...new Set(
        input.classes
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  } else {
    if (Array.isArray(input.classes) && input.classes.length) {
      tokens = [
        ...new Set(
          input.classes
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ];
    }
    for (const token of flattenClassNames(input.classNames ?? {})) {
      tokens = addClassName(tokens, token);
    }
    for (const raw of input.add ?? []) {
      if (typeof raw === "string" && raw.trim()) tokens = addClassName(tokens, raw.trim());
    }
    for (const raw of input.remove ?? []) {
      if (typeof raw === "string" && raw.trim()) {
        tokens = removeClassName(tokens, raw.trim());
      }
    }
  }

  const value: PropValue | undefined = tokens.length
    ? { type: "string", value: joinClassNames(tokens) }
    : undefined;
  return {
    ok: true,
    propName: current.propName,
    value,
    tokens,
  };
}

export function describeClassAuthoringCapabilities() {
  return {
    responsiveClassNames: true,
    breakpoints: CLASS_BREAKPOINTS,
    utilityDetection: true,
    examples: {
      replace: { classes: ["flex", "items-center", "gap-4"] },
      addRemove: { add: ["md:flex", "lg:gap-8"], remove: ["hidden"] },
      breakpointMap: {
        classNames: { base: ["flex"], md: ["grid", "grid-cols-2"] },
      },
    },
    note: "Breakpoint maps flatten to prefixed utilities (md:grid). Custom managed classes remain plain tokens.",
    isLikelyUtilityClass,
  };
}
