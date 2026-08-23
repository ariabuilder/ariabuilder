import fs from "node:fs";
import path from "node:path";
import { isLikelyUtilityClass } from "../../shared/composer/frameworks";
import { canonicalDirectory } from "../pathSafety";

export type UtilityUsage = {
  relativePath: string;
  token: string;
};

const SOURCE_EXTENSIONS = new Set([
  ".astro", ".html", ".vue", ".svelte", ".jsx", ".tsx", ".js", ".ts", ".md", ".mdx", ".css",
]);
const SKIP = new Set(["node_modules", ".git", ".astro", ".aria", "dist", ".vercel", ".wrangler"]);

function walk(directory: string, out: string[], limit = 1_500): void {
  if (!fs.existsSync(directory) || out.length >= limit) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (out.length >= limit) return;
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, out, limit);
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(absolute);
    }
  }
}

export function scanUtilityUsage(projectPath: string): UtilityUsage[] {
  const root = canonicalDirectory(projectPath);
  const files: string[] = [];
  walk(path.join(root, "src"), files);
  walk(path.join(root, "styles"), files);
  const usages: UtilityUsage[] = [];
  for (const absolute of files) {
    let content = fs.readFileSync(absolute, "utf8");
    content = content
      .replace(/\/\* aria:utility-manager:tailwind-theme-begin \*\/[\s\S]*?\/\* aria:utility-manager:tailwind-theme-end \*\//g, "")
      .replace(/^.*aria:utility-manager:tailwind.*$/gm, "");
    const values: string[] = [];
    const classPattern = /(?:class|className)\s*=\s*["'`]([^"'`]+)["'`]/g;
    let match: RegExpExecArray | null;
    while ((match = classPattern.exec(content))) values.push(match[1]!);
    const expressionClassPattern = /(?:class:list|class|className|:class|v-bind:class)\s*=\s*\{([\s\S]*?)\}/g;
    while ((match = expressionClassPattern.exec(content))) {
      for (const quoted of match[1]!.matchAll(/["'`]([^"'`]+)["'`]/g)) values.push(quoted[1]!);
    }
    const classHelperPattern = /(?:clsx|classnames|classNames|cn)\s*\(([\s\S]*?)\)/g;
    while ((match = classHelperPattern.exec(content))) {
      for (const quoted of match[1]!.matchAll(/["'`]([^"'`]+)["'`]/g)) values.push(quoted[1]!);
    }
    const svelteClassPattern = /\bclass:([A-Za-z0-9_:/[\].!-]+)/g;
    while ((match = svelteClassPattern.exec(content))) values.push(match[1]!);
    const applyPattern = /@apply\s+([^;{}]+)/g;
    while ((match = applyPattern.exec(content))) values.push(match[1]!);
    const directivePattern = /@(theme|utility|variant|custom-variant|plugin|source|config)\b|\btheme\s*\(/g;
    while ((match = directivePattern.exec(content))) {
      usages.push({
        relativePath: path.relative(root, absolute).split(path.sep).join("/"),
        token: match[0]!,
      });
      if (usages.length >= 100) return usages;
    }
    for (const value of values) {
      for (const token of value.split(/\s+/).map((item) => item.trim()).filter(Boolean)) {
        if (!isLikelyUtilityClass(token)) continue;
        usages.push({
          relativePath: path.relative(root, absolute).split(path.sep).join("/"),
          token,
        });
        if (usages.length >= 100) return usages;
      }
    }
  }
  return usages;
}
