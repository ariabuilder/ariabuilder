export type ComposerUtilityFramework = "tailwind" | "unocss";

export type ComposerFrameworkCapabilities = {
  primary: ComposerUtilityFramework | "none";
  detected: ComposerUtilityFramework[];
  confidence: "none" | "package" | "configured";
  sources: string[];
  breakpoints: Record<string, number>;
  candidates: string[];
  diagnostics: string[];
};

export const FALLBACK_BREAKPOINTS: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
};

const spacing = ["0", "0.5", "1", "1.5", "2", "3", "4", "5", "6", "8", "10", "12", "16", "20", "24"];
const colors = [
  "transparent", "current", "black", "white", "slate-500", "gray-500",
  "red-500", "amber-500", "emerald-500", "sky-500", "blue-500",
  "violet-500", "pink-500",
];

/** Framework-neutral starting catalog, expanded with project evidence at scan time. */
export const COMMON_UTILITY_CANDIDATES = [
  "block", "inline", "inline-block", "flex", "inline-flex", "grid", "hidden",
  "relative", "absolute", "fixed", "sticky", "static", "isolate", "overflow-hidden",
  "overflow-auto", "items-start", "items-center", "items-end", "justify-start",
  "justify-center", "justify-between", "justify-end", "flex-row", "flex-col", "flex-wrap",
  "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4", "w-full", "h-full",
  "min-w-0", "min-h-0", "max-w-full", "mx-auto", "text-left", "text-center",
  "text-right", "font-normal", "font-medium", "font-semibold", "font-bold", "italic",
  "uppercase", "lowercase", "capitalize", "truncate", "whitespace-nowrap", "rounded",
  "rounded-md", "rounded-lg", "border", "shadow-sm", "shadow-md", "opacity-0", "opacity-50",
  "opacity-100", "object-cover", "object-contain", "transition-colors", "transition-transform",
  ...spacing.flatMap((value) => [
    `p-${value}`, `px-${value}`, `py-${value}`, `m-${value}`, `mx-${value}`, `my-${value}`,
    `gap-${value}`, `space-x-${value}`, `space-y-${value}`,
  ]),
  ...colors.flatMap((value) => [`text-${value}`, `bg-${value}`, `border-${value}`]),
];

export function isLikelyUtilityClass(value: string): boolean {
  const token = value.trim();
  if (!token || /\s/.test(token)) return false;
  if (/^(?:hover|focus|focus-visible|active|disabled|group-hover|dark|sm|md|lg|xl|2xl):/.test(token)) return true;
  if (/^-?(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|space-x|space-y|w|h|min-w|min-h|max-w|max-h|inset|top|right|bottom|left|z|grid-cols|col-span|row-span|text|bg|border|rounded|shadow|opacity|font|leading|tracking|translate-x|translate-y|scale|rotate|blur|brightness|contrast|object)-/.test(token)) return true;
  return COMMON_UTILITY_CANDIDATES.includes(token);
}
