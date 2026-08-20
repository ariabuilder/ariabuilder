import {
  appendClassListToken,
  removeClassListTokens,
  splitClassNames,
  staticClassListTokens,
} from "./classAttr";
import { parseStyleAttr, serializeStyleAttr, setStyleProp } from "./styleAttr";
import type { AstroDocumentModel, AstroPropMap, EditableNode } from "./types";

export const MOTION_EFFECTS = [
  "fade", "slide-up", "slide-down", "slide-left", "slide-right",
  "zoom-in", "zoom-out", "blur", "rotate-in", "flip-up", "flip-down",
  "flip-left", "flip-right", "mask-up", "mask-down", "mask-left", "mask-right",
] as const;
export const MOTION_TRIGGERS = ["reveal", "now", "hover", "click", "scrub"] as const;
export const MOTION_SPEEDS = ["instant", "fast", "normal", "slow", "slower"] as const;
export const MOTION_EASINGS = ["smooth", "spring", "linear", "in", "out", "in-out"] as const;
export const MOTION_DISTANCES = ["sm", "md", "lg", "xl"] as const;
export const MOTION_DELAYS = ["0", "100", "200", "300", "500", "700", "1000"] as const;
export const MOTION_HOVERS = [
  "hover-lift", "hover-grow", "hover-shrink", "hover-rotate", "hover-tilt",
  "hover-glow", "hover-float", "hover-pop", "hover-press", "hover-underline",
  "hover-sweep", "hover-border",
] as const;
export const MOTION_LOOPS = [
  "pulse", "heartbeat", "float", "spin", "ping", "flash", "bounce",
  "shake", "wobble", "jello", "vibrate", "swing", "rubber", "tada",
] as const;
export const PARALLAX_SPEEDS = ["0", "0.25", "0.5", "0.75", "1", "1.25", "1.5", "2"] as const;
export const PARALLAX_DIRECTIONS = ["up", "down", "left", "right"] as const;
export const PARALLAX_EASINGS = ["linear", "ease-in", "ease-out", "ease-in-out", "spring"] as const;
export const PARALLAX_ANCHORS = ["top", "center", "bottom"] as const;
export const PARALLAX_EFFECTS = ["translate", "opacity", "blur", "scale", "rotate"] as const;

export type MotionEffect = (typeof MOTION_EFFECTS)[number];
export type MotionTrigger = (typeof MOTION_TRIGGERS)[number];
export type MotionSpeed = (typeof MOTION_SPEEDS)[number] | number;
export type MotionEasing = (typeof MOTION_EASINGS)[number];
export type MotionDistance = (typeof MOTION_DISTANCES)[number];
export type MotionDelay = (typeof MOTION_DELAYS)[number] | number;
export type MotionHover = (typeof MOTION_HOVERS)[number];
export type MotionLoop = (typeof MOTION_LOOPS)[number];

export type MotionTextConfig = {
  mode: "words" | "chars";
  stagger?: number;
  effects?: MotionEffect[];
};
export type MotionScrubConfig = { from?: string; to?: string; travel?: number };
export type MotionStaggerConfig = { interval: number };
export type MotionMagneticConfig = { strength: number };
export type MotionParallaxEffect = {
  effect: (typeof PARALLAX_EFFECTS)[number];
  from?: string;
  to?: string;
};
export type MotionParallax = {
  enabled: boolean;
  speed: (typeof PARALLAX_SPEEDS)[number];
  direction: (typeof PARALLAX_DIRECTIONS)[number];
  effects: MotionParallaxEffect[];
  travel: number;
  easing?: (typeof PARALLAX_EASINGS)[number];
  anchor: (typeof PARALLAX_ANCHORS)[number];
  startOffset?: string;
  endOffset?: string;
  containerRef?: string;
  pin?: { enabled: boolean; duration?: string; offset?: string };
  layerGroup?: string;
  velocity: boolean;
  disableOnMobile: boolean;
};
export type NodeMotion = {
  enabled: boolean;
  preset?: string;
  effects: MotionEffect[];
  trigger: MotionTrigger;
  speed?: MotionSpeed;
  easing?: MotionEasing;
  distance?: MotionDistance;
  delay?: MotionDelay;
  durationVar?: string;
  delayVar?: string;
  stagger?: MotionStaggerConfig;
  text?: MotionTextConfig;
  hover?: MotionHover[];
  loop?: MotionLoop;
  scrub?: MotionScrubConfig;
  magnetic?: MotionMagneticConfig;
  parallax?: MotionParallax;
};

export const DEFAULT_NODE_MOTION: NodeMotion = {
  enabled: false,
  effects: [],
  trigger: "reveal",
};

export const MOTION_PRESETS: Array<{ id: string; label: string; motion: NodeMotion }> = [
  ["fade-in", "Fade in", ["fade"], "reveal", "normal", "smooth", "md"],
  ["fade-up", "Rise up", ["fade", "slide-up"], "reveal", "normal", "smooth", "md"],
  ["gentle-rise", "Gentle rise", ["fade", "slide-up"], "reveal", "slow", "smooth", "sm"],
  ["slide-left", "Slide left", ["fade", "slide-left"], "reveal", "normal", "smooth", "md"],
  ["fade-down", "Drop in", ["fade", "slide-down"], "reveal", "normal", "smooth", "md"],
  ["slide-right", "Slide right", ["fade", "slide-right"], "reveal", "normal", "smooth", "md"],
  ["on-load", "On load", ["fade", "slide-up"], "now", "fast", "smooth", "sm"],
  ["zoom-in", "Zoom in", ["fade", "zoom-in"], "reveal", "normal", "smooth", "md"],
  ["pop-in", "Pop in", ["fade", "zoom-in"], "reveal", "fast", "spring", "sm"],
  ["blur-in", "Soft reveal", ["fade", "blur"], "reveal", "slow", "smooth", "md"],
  ["tilt-in", "Tilt in", ["fade", "rotate-in"], "reveal", "normal", "spring", "md"],
  ["mask-up", "Mask up", ["mask-up"], "reveal", "normal", "smooth", "md"],
].map(([id, label, effects, trigger, speed, easing, distance]) => ({
  id: id as string,
  label: label as string,
  motion: {
    enabled: true,
    preset: id as string,
    effects: effects as MotionEffect[],
    trigger: trigger as MotionTrigger,
    speed: speed as MotionSpeed,
    easing: easing as MotionEasing,
    distance: distance as MotionDistance,
  },
}));

export const PARALLAX_PRESETS: Array<{ id: string; label: string; parallax: MotionParallax }> = [
  ["gentle-float", "Gentle float", "up", "0.5", ["translate"], 120, "ease-out"],
  ["hero-depth", "Hero depth", "up", "0.25", ["translate", "scale"], 300, "linear"],
  ["fade-through", "Fade through", "up", "1", ["opacity", "translate"], 150, "ease-in-out"],
  ["zoom-reveal", "Zoom reveal", "up", "1", ["scale", "opacity"], 200, "ease-out"],
  ["blur-in", "Blur in", "up", "1", ["blur", "opacity"], 150, "ease-out"],
  ["subtle-rotate", "Subtle rotate", "up", "0.75", ["rotate", "opacity"], 160, "ease-out"],
  ["dramatic-rise", "Dramatic rise", "up", "1.5", ["translate", "opacity"], 250, "spring"],
  ["slide-left", "Slide left", "left", "1", ["translate", "opacity"], 200, "ease-out"],
  ["slide-right", "Slide right", "right", "1", ["translate", "opacity"], 200, "ease-out"],
].map(([id, label, direction, speed, effects, travel, easing]) => ({
  id: id as string,
  label: label as string,
  parallax: {
    enabled: true,
    direction: direction as MotionParallax["direction"],
    speed: speed as MotionParallax["speed"],
    effects: (effects as string[]).map((effect) => ({ effect: effect as MotionParallaxEffect["effect"] })),
    travel: travel as number,
    easing: easing as MotionParallax["easing"],
    anchor: "center",
    velocity: false,
    disableOnMobile: false,
  },
}));

const OWNED_DATA_PREFIXES = ["data-aria-motion-", "data-aria-parallax-"];
export const isMotionClass = (token: string) => token === "aria-motion" || token.startsWith("aria-motion-") || token === "aria-parallax" || token.startsWith("aria-parallax-");
const stringProp = (props: AstroPropMap, name: string) => props[name]?.type === "string" ? props[name].value : undefined;
const numberAttr = (props: AstroPropMap, name: string) => {
  const value = Number(stringProp(props, name));
  return Number.isFinite(value) ? value : undefined;
};
const inList = <T extends readonly string[]>(value: string | undefined, list: T): T[number] | undefined =>
  value && (list as readonly string[]).includes(value) ? value as T[number] : undefined;

function classTokens(props: AstroPropMap): string[] {
  const name = props["class:list"] ? "class:list" : "class";
  const value = props[name];
  if (name === "class:list") return staticClassListTokens(value);
  return value?.type === "string" ? splitClassNames(value.value) : [];
}

export function parseNodeMotion(props: AstroPropMap): NodeMotion {
  const tokens = classTokens(props);
  if (!tokens.includes("aria-motion") && !tokens.includes("aria-parallax")) {
    return { ...DEFAULT_NODE_MOTION, effects: [] };
  }
  const effects = MOTION_EFFECTS.filter((id) => tokens.includes(`aria-motion-${id}`));
  const trigger = MOTION_TRIGGERS.find((id) => tokens.includes(`aria-motion-${id}`)) ?? "reveal";
  const speedToken = MOTION_SPEEDS.find((id) => tokens.includes(`aria-motion-${id}`));
  const numericSpeed = tokens.map((token) => /^aria-motion-(\d+)$/.exec(token)?.[1]).find(Boolean);
  const delayToken = MOTION_DELAYS.find((id) => id !== "0" && tokens.includes(`aria-motion-delay-${id}`));
  const numericDelay = tokens.map((token) => /^aria-motion-delay-(\d+)$/.exec(token)?.[1]).find(Boolean);
  const textMode = tokens.includes("aria-motion-words") ? "words" : tokens.includes("aria-motion-chars") ? "chars" : null;
  const parallaxEnabled = tokens.includes("aria-parallax");
  const parallax: MotionParallax | undefined = parallaxEnabled ? {
    enabled: true,
    speed: inList(stringProp(props, "data-aria-parallax-speed"), PARALLAX_SPEEDS) ?? "1",
    direction: inList(stringProp(props, "data-aria-parallax-direction"), PARALLAX_DIRECTIONS) ?? "up",
    effects: PARALLAX_EFFECTS.filter((effect) => tokens.includes(`aria-parallax-fx-${effect}`)).map((effect) => ({ effect })),
    travel: numberAttr(props, "data-aria-parallax-travel") ?? 200,
    easing: inList(stringProp(props, "data-aria-parallax-easing"), PARALLAX_EASINGS),
    anchor: inList(stringProp(props, "data-aria-parallax-anchor"), PARALLAX_ANCHORS) ?? "center",
    startOffset: stringProp(props, "data-aria-parallax-start"),
    endOffset: stringProp(props, "data-aria-parallax-end"),
    containerRef: stringProp(props, "data-aria-parallax-container"),
    pin: tokens.includes("aria-parallax-pin") ? { enabled: true, duration: stringProp(props, "data-aria-parallax-pin-duration"), offset: stringProp(props, "data-aria-parallax-pin-offset") } : undefined,
    layerGroup: stringProp(props, "data-aria-parallax-group"),
    velocity: tokens.includes("aria-parallax-velocity"),
    disableOnMobile: tokens.includes("aria-parallax-mobile-disable"),
  } : undefined;
  const parsed: NodeMotion = {
    enabled: tokens.includes("aria-motion") || parallaxEnabled,
    effects: [...effects],
    trigger,
    speed: speedToken ?? (numericSpeed ? Number(numericSpeed) : undefined),
    easing: MOTION_EASINGS.find((id) => tokens.includes(`aria-motion-ease-${id}`)),
    distance: MOTION_DISTANCES.find((id) => tokens.includes(`aria-motion-dist-${id}`)),
    delay: delayToken ?? (numericDelay ? Number(numericDelay) : undefined),
    durationVar: stringProp(props, "data-aria-motion-duration-var"),
    delayVar: stringProp(props, "data-aria-motion-delay-var"),
    stagger: tokens.includes("aria-motion-stagger") ? { interval: numberAttr(props, "data-aria-motion-stagger") ?? 90 } : undefined,
    text: textMode ? { mode: textMode, stagger: numberAttr(props, "data-aria-motion-text-stagger"), effects: stringProp(props, "data-aria-motion-effect")?.split(/\s+/).map((token) => token.replace(/^aria-motion-/, "")).filter((token): token is MotionEffect => (MOTION_EFFECTS as readonly string[]).includes(token)) } : undefined,
    hover: MOTION_HOVERS.filter((id) => tokens.includes(`aria-motion-${id}`)),
    loop: MOTION_LOOPS.find((id) => tokens.includes(`aria-motion-${id}`)),
    scrub: trigger === "scrub" ? { travel: numberAttr(props, "data-aria-motion-scrub") ?? 200 } : undefined,
    magnetic: tokens.includes("aria-motion-magnetic") ? { strength: numberAttr(props, "data-aria-motion-strength") ?? 0.35 } : undefined,
    parallax,
  };
  if (!parsed.hover?.length && !parsed.loop && !parsed.text && !parsed.stagger &&
      !parsed.magnetic && !parsed.parallax && !parsed.scrub &&
      !parsed.durationVar && !parsed.delayVar && !parsed.delay) {
    parsed.preset = MOTION_PRESETS.find((preset) =>
      preset.motion.trigger === parsed.trigger &&
      preset.motion.speed === parsed.speed &&
      preset.motion.easing === parsed.easing &&
      preset.motion.distance === parsed.distance &&
      preset.motion.effects.length === parsed.effects.length &&
      preset.motion.effects.every((effect) => parsed.effects.includes(effect))
    )?.id;
  }
  return parsed;
}

export function compileMotionClasses(motion: NodeMotion): string[] {
  if (!motion.enabled) return [];
  const classes = new Set<string>();
  if (motion.effects.length || motion.trigger || motion.text || motion.stagger || motion.magnetic || motion.hover?.length || motion.loop) {
    classes.add("aria-motion");
    motion.effects.forEach((effect) => classes.add(`aria-motion-${effect}`));
    classes.add(`aria-motion-${motion.trigger}`);
    if (motion.speed !== undefined) classes.add(`aria-motion-${motion.speed}`);
    if (motion.easing) classes.add(`aria-motion-ease-${motion.easing}`);
    if (motion.distance) classes.add(`aria-motion-dist-${motion.distance}`);
    if (motion.delay !== undefined && motion.delay !== "0" && motion.delay !== 0) classes.add(`aria-motion-delay-${motion.delay}`);
    motion.hover?.forEach((hover) => classes.add(`aria-motion-${hover}`));
    if (motion.loop) classes.add(`aria-motion-${motion.loop}`);
    if (motion.text) classes.add(`aria-motion-${motion.text.mode}`);
    if (motion.stagger) classes.add("aria-motion-stagger");
    if (motion.magnetic) classes.add("aria-motion-magnetic");
  }
  const p = motion.parallax;
  if (p?.enabled) {
    classes.add("aria-parallax");
    classes.add(`aria-parallax-${p.direction}`);
    classes.add(`aria-parallax-speed-${p.speed.replace(".", "_")}`);
    if (p.easing) classes.add(`aria-parallax-ease-${p.easing}`);
    p.effects.forEach(({ effect }) => classes.add(`aria-parallax-fx-${effect}`));
    if (p.pin?.enabled) classes.add("aria-parallax-pin");
    if (p.velocity) classes.add("aria-parallax-velocity");
    if (p.disableOnMobile) classes.add("aria-parallax-mobile-disable");
  }
  return [...classes];
}

function dataAttributes(motion: NodeMotion): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (motion.stagger) attrs["data-aria-motion-stagger"] = String(motion.stagger.interval);
  if (motion.text?.effects?.length) attrs["data-aria-motion-effect"] = motion.text.effects.map((effect) => `aria-motion-${effect}`).join(" ");
  if (motion.text?.stagger !== undefined) attrs["data-aria-motion-text-stagger"] = String(motion.text.stagger);
  if (motion.scrub?.travel !== undefined) attrs["data-aria-motion-scrub"] = String(motion.scrub.travel);
  if (motion.magnetic) attrs["data-aria-motion-strength"] = String(motion.magnetic.strength);
  if (motion.durationVar) attrs["data-aria-motion-duration-var"] = motion.durationVar;
  if (motion.delayVar) attrs["data-aria-motion-delay-var"] = motion.delayVar;
  const p = motion.parallax;
  if (p?.enabled) {
    Object.assign(attrs, {
      "data-aria-parallax-speed": p.speed,
      "data-aria-parallax-direction": p.direction,
      "data-aria-parallax-travel": String(p.travel),
      "data-aria-parallax-anchor": p.anchor,
    });
    if (p.easing) attrs["data-aria-parallax-easing"] = p.easing;
    if (p.startOffset) attrs["data-aria-parallax-start"] = p.startOffset;
    if (p.endOffset) attrs["data-aria-parallax-end"] = p.endOffset;
    if (p.containerRef) attrs["data-aria-parallax-container"] = p.containerRef;
    if (p.pin?.enabled) {
      attrs["data-aria-parallax-pin"] = "true";
      if (p.pin.duration) attrs["data-aria-parallax-pin-duration"] = p.pin.duration;
      if (p.pin.offset) attrs["data-aria-parallax-pin-offset"] = p.pin.offset;
    }
    if (p.layerGroup) attrs["data-aria-parallax-group"] = p.layerGroup;
    if (p.velocity) attrs["data-aria-parallax-velocity"] = "true";
    if (p.disableOnMobile) attrs["data-aria-parallax-mobile-disable"] = "true";
  }
  return attrs;
}

function propMapForNode(node: EditableNode): AstroPropMap | null {
  return node.kind === "element" || node.kind === "component" || node.kind === "slot" || node.kind === "raw" ? node.props : null;
}

export function applyNodeMotion(node: EditableNode, motion: NodeMotion): { ok: boolean; reason?: string } {
  const props = propMapForNode(node);
  if (!props) return { ok: false, reason: "Motion requires an element, component, slot, or raw element." };
  const className = props["class:list"] ? "class:list" : "class";
  const currentClass = props[className];
  if (className === "class" && currentClass && currentClass.type !== "string") {
    return { ok: false, reason: "This dynamic class expression cannot be edited safely. Convert it to class:list first." };
  }
  const removed = removeClassListTokens(currentClass, isMotionClass);
  if (!removed.safe) return { ok: false, reason: "This dynamic class expression cannot be edited safely. Convert it to class:list first." };
  let nextClass = removed.value;
  if (className === "class") {
    const tokens = nextClass?.type === "string" ? splitClassNames(nextClass.value) : [];
    for (const token of compileMotionClasses(motion)) {
      if (!tokens.includes(token)) tokens.push(token);
    }
    nextClass = tokens.length ? { type: "string", value: tokens.join(" ") } : undefined;
  } else {
    for (const token of compileMotionClasses(motion)) nextClass = appendClassListToken(nextClass, token);
  }
  if (nextClass) props[className] = nextClass;
  else delete props[className];
  for (const key of Object.keys(props)) {
    if (OWNED_DATA_PREFIXES.some((prefix) => key.startsWith(prefix))) delete props[key];
  }
  const style = props.style;
  if (!style || style.type === "string") {
    let map = parseStyleAttr(style?.type === "string" ? style.value : "");
    map = setStyleProp(map, "--aria-motion-duration", motion.enabled && typeof motion.speed === "number" ? `${motion.speed}ms` : "");
    map = setStyleProp(map, "--aria-motion-delay", motion.enabled && typeof motion.delay === "number" ? `${motion.delay}ms` : "");
    const text = serializeStyleAttr(map);
    if (text) props.style = { type: "string", value: text };
    else delete props.style;
  }
  if (!motion.enabled) return { ok: true };
  for (const [name, value] of Object.entries(dataAttributes(motion))) {
    props[name] = { type: "string", value };
  }
  return { ok: true };
}

export function documentHasMotion(model: AstroDocumentModel): boolean {
  const visit = (nodes: readonly EditableNode[]): boolean => nodes.some((node) => {
    const props = propMapForNode(node);
    if (props && classTokens(props).some((token) => token === "aria-motion" || token === "aria-parallax")) return true;
    if (node.kind === "conditional") return visit(node.consequent) || visit(node.alternate ?? []);
    if (node.kind === "element" || node.kind === "component" || node.kind === "fragment" || node.kind === "slot" || node.kind === "map") {
      return Array.isArray(node.children) && visit(node.children);
    }
    return false;
  });
  return visit(model.nodes);
}

export function motionPreviewCss(motion: NodeMotion): string {
  if (!motion.enabled) return "";
  const declarations: string[] = [];
  if (motion.effects.includes("fade")) declarations.push("opacity: 0");
  if (motion.effects.includes("slide-up")) declarations.push("transform: translateY(var(--aria-motion-distance, 32px))");
  if (motion.effects.includes("slide-down")) declarations.push("transform: translateY(calc(var(--aria-motion-distance, 32px) * -1))");
  if (motion.effects.includes("slide-left")) declarations.push("transform: translateX(var(--aria-motion-distance, 32px))");
  if (motion.effects.includes("slide-right")) declarations.push("transform: translateX(calc(var(--aria-motion-distance, 32px) * -1))");
  if (motion.effects.includes("zoom-in")) declarations.push("transform: scale(.92)");
  if (motion.effects.includes("zoom-out")) declarations.push("transform: scale(1.08)");
  if (motion.effects.includes("blur")) declarations.push("filter: blur(8px)");
  if (motion.effects.includes("rotate-in")) declarations.push("transform: rotate(-6deg)");
  if (motion.parallax?.enabled) declarations.push("transform: translateY(-12px)");
  return declarations.join("; ");
}
