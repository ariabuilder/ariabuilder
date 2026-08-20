import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedBlogCms } from "./cms/seed";
import { ensureDesignEntry } from "./design";
import {
  canonicalDirectory,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";

const BASE_LAYOUT = `---
interface Props {
  title?: string;
  description?: string;
}

const {
  title = "Aria starter",
  description = "An Astro site built with Aria.",
} = Astro.props;
import "../styles/global.css";
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width" />
    <meta name="description" content={description} />
    <title>{title}</title>
  </head>
  <body>
    <slot />
  </body>
</html>
`;

const NOT_FOUND_PAGE = `---
import BaseLayout from "../layouts/BaseLayout.astro";
---

<BaseLayout title="Page not found">
  <main>
    <h1>Page not found</h1>
    <p>The page you requested does not exist.</p>
    <a href="/">Return home</a>
  </main>
</BaseLayout>
`;

function writeMissing(root: string, relative: string, contents: string): boolean {
  const absolute = resolveWithinRoot(root, path.join(root, relative), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  if (existsSync(absolute)) return false;
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeTextFileAtomic(absolute, contents, { overwrite: false });
  return true;
}

export async function seedAriaStarter(
  projectPath: string,
  onStep?: (step: number, total: number, label: string) => void,
): Promise<{ collections: number; entries: number; files: number }> {
  const root = canonicalDirectory(projectPath);
  const total = 4;
  let files = 0;

  onStep?.(1, total, "Applying site shell and Design defaults");
  ensureDesignEntry(root);
  if (writeMissing(root, "src/layouts/BaseLayout.astro", BASE_LAYOUT)) files += 1;

  onStep?.(2, total, "Creating content collections");
  const seeded = await seedBlogCms(root);

  onStep?.(3, total, "Adding page scaffolds");
  if (writeMissing(root, "src/pages/404.astro", NOT_FOUND_PAGE)) files += 1;

  onStep?.(4, total, "Adding sample content");
  // seedBlogCms is slug-idempotent and owns the shared Blog/Authors/Tags sample set.

  return { ...seeded, files };
}
