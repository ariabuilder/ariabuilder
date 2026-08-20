import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  plainTextToStructuredText,
  type CollectionSupport,
  type FieldSchema,
} from "../../shared/cms";
import type { AriaCollectionDef } from "../../shared/types";
import { readCollections, writeCollections } from "../collections";
import {
  canonicalDirectory,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "../pathSafety";
import { regenerateContentConfig } from "./contentSync";
import { createEntry, updateEntry } from "./services";
import * as store from "./store";

export const BLOG_COLLECTION_NAME = "blog";
export const AUTHORS_COLLECTION_NAME = "authors";
export const TAGS_COLLECTION_NAME = "tags";

export const BLOG_LIST_PAGE_FILE = "src/pages/blog/index.astro";
export const BLOG_TEMPLATE_PAGE_FILE = "src/pages/blog/[slug].astro";

const TAG_FIELDS: FieldSchema[] = [
  {
    key: "description",
    label: "Description",
    type: "text",
    searchable: true,
    showInEntryList: true,
  },
  {
    key: "color",
    label: "Color",
    type: "color",
    required: true,
    showInEntryList: true,
  },
  {
    key: "icon",
    label: "Icon",
    type: "icon",
    required: true,
  },
];

const AUTHOR_FIELDS: FieldSchema[] = [
  {
    key: "role",
    label: "Role",
    type: "string",
    required: true,
    showInEntryList: true,
  },
  {
    key: "bio",
    label: "Bio",
    type: "text",
    required: true,
    searchable: true,
  },
  {
    key: "avatar",
    label: "Avatar",
    type: "image",
  },
  {
    key: "website",
    label: "Website",
    type: "string",
  },
];

function blogFields(authorsId: string, tagsId: string): FieldSchema[] {
  return [
    {
      key: "excerpt",
      label: "Excerpt",
      type: "text",
      required: true,
      searchable: true,
      showInEntryList: true,
    },
    {
      key: "author",
      label: "Author",
      type: "reference",
      targetCollection: authorsId,
      required: true,
      showInEntryList: true,
    },
    {
      key: "category",
      label: "Category",
      type: "select",
      required: true,
      options: ["Engineering", "Product", "Design"],
      showInEntryList: true,
    },
    {
      key: "tags",
      label: "Tags",
      type: "relation",
      targetCollection: tagsId,
      searchable: true,
    },
    {
      key: "publishedDate",
      label: "Published date",
      type: "date",
      required: true,
      showInEntryList: true,
    },
    {
      key: "featured",
      label: "Featured",
      type: "boolean",
      default: false,
      showInEntryList: true,
    },
  ];
}

const BLOG_SUPPORTS: CollectionSupport[] = [
  "body",
  "cover",
  "drafts",
  "revisions",
];

const BLOG_LIST_PAGE_SOURCE = `---
import { getCollection } from "astro:content";

const posts = (await getCollection("blog"))
  .filter((post) => !post.data.draft)
  .sort((a, b) =>
    String(a.data.title).localeCompare(String(b.data.title), undefined, {
      sensitivity: "base",
    }),
  );
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>Blog</title>
  </head>
  <body>
    <main>
      <h1>Blog</h1>
      <ul>
        {
          posts.map((post) => (
            <li>
              <a href={\`/blog/\${post.data.slug ?? post.id}\`}>
                {post.data.title}
              </a>
            </li>
          ))
        }
      </ul>
    </main>
  </body>
</html>
`;

const BLOG_TEMPLATE_PAGE_SOURCE = `---
import { getCollection, render } from "astro:content";

export async function getStaticPaths() {
  const posts = (await getCollection("blog")).filter((post) => !post.data.draft);
  return posts.map((post) => ({
    params: { slug: post.data.slug ?? post.id },
    props: { post },
  }));
}

const { post } = Astro.props;
const { Content } = await render(post);
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>{post.data.title}</title>
  </head>
  <body>
    <main>
      <article>
        <h1>{post.data.title}</h1>
        <Content />
      </article>
    </main>
  </body>
</html>
`;

function findByName(
  collections: readonly AriaCollectionDef[],
  name: string,
): AriaCollectionDef | undefined {
  return collections.find((item) => item.name === name);
}

function entryExistsBySlug(
  projectPath: string,
  collectionId: string,
  slug: string,
): boolean {
  return Boolean(store.findEntryBySlug(projectPath, collectionId, slug));
}

/**
 * Write Astro blog list + entry template pages if missing.
 * Returns project-relative paths for collection wiring.
 */
export function scaffoldBlogPages(projectPath: string): {
  listPageFile: string;
  templatePageFile: string;
} {
  const root = canonicalDirectory(projectPath);

  const listAbs = resolveWithinRoot(
    root,
    path.join(root, BLOG_LIST_PAGE_FILE),
    { allowMissing: true, rejectFinalSymlink: true },
  );
  const templateAbs = resolveWithinRoot(
    root,
    path.join(root, BLOG_TEMPLATE_PAGE_FILE),
    { allowMissing: true, rejectFinalSymlink: true },
  );

  if (!existsSync(listAbs)) {
    mkdirSync(path.dirname(listAbs), { recursive: true });
    writeTextFileAtomic(listAbs, BLOG_LIST_PAGE_SOURCE, { overwrite: false });
  }
  if (!existsSync(templateAbs)) {
    mkdirSync(path.dirname(templateAbs), { recursive: true });
    writeTextFileAtomic(templateAbs, BLOG_TEMPLATE_PAGE_SOURCE, {
      overwrite: false,
    });
  }

  return {
    listPageFile: BLOG_LIST_PAGE_FILE,
    templatePageFile: BLOG_TEMPLATE_PAGE_FILE,
  };
}

/**
 * Seed tags / authors / blog collections with sample entries and page scaffolds.
 * Collections and sample entries are created only when missing (slug-idempotent).
 */
export async function seedBlogCms(
  projectPath: string,
): Promise<{ collections: number; entries: number }> {
  const root = canonicalDirectory(projectPath);
  const state = readCollections(root);
  const collections = [...state.collections];
  let collectionsCreated = 0;
  let entriesCreated = 0;

  let tags = findByName(collections, TAGS_COLLECTION_NAME);
  if (!tags) {
    tags = {
      id: TAGS_COLLECTION_NAME,
      name: TAGS_COLLECTION_NAME,
      label: "Tags",
      kind: "tags",
      icon: "i-lucide:tags",
      urlPattern: "/tags/{slug}",
      listPageFile: null,
      templatePageFile: null,
      supports: ["revisions"],
      scope: "global",
      schema: {
        fields: TAG_FIELDS,
        version: 1,
        icon: "i-lucide:tags",
      },
    };
    collections.push(tags);
    collectionsCreated += 1;
  }

  let authors = findByName(collections, AUTHORS_COLLECTION_NAME);
  if (!authors) {
    authors = {
      id: AUTHORS_COLLECTION_NAME,
      name: AUTHORS_COLLECTION_NAME,
      label: "Authors",
      kind: "data",
      icon: "i-lucide:users",
      urlPattern: null,
      listPageFile: null,
      templatePageFile: null,
      supports: ["cover", "revisions"],
      scope: "global",
      schema: {
        fields: AUTHOR_FIELDS,
        version: 1,
        icon: "i-lucide:users",
      },
    };
    collections.push(authors);
    collectionsCreated += 1;
  }

  const pages = scaffoldBlogPages(root);

  let blog = findByName(collections, BLOG_COLLECTION_NAME);
  if (!blog) {
    blog = {
      id: BLOG_COLLECTION_NAME,
      name: BLOG_COLLECTION_NAME,
      label: "Blog",
      kind: "content",
      icon: "i-lucide:newspaper",
      urlPattern: "/blog/{slug}",
      listPageFile: pages.listPageFile,
      templatePageFile: pages.templatePageFile,
      supports: [...BLOG_SUPPORTS],
      scope: "global",
      schema: {
        fields: blogFields(authors.id, tags.id),
        version: 1,
        icon: "i-lucide:newspaper",
      },
    };
    collections.push(blog);
    collectionsCreated += 1;
  } else {
    // Keep page file refs aligned when scaffolds exist / were just written.
    const idx = collections.findIndex((item) => item.id === blog!.id);
    if (idx >= 0) {
      collections[idx] = {
        ...collections[idx]!,
        listPageFile: collections[idx]!.listPageFile ?? pages.listPageFile,
        templatePageFile:
          collections[idx]!.templatePageFile ?? pages.templatePageFile,
        urlPattern: collections[idx]!.urlPattern ?? "/blog/{slug}",
      };
      blog = collections[idx]!;
    }
  }

  writeCollections(root, { collections });
  regenerateContentConfig(root);

  // --- Sample tags ---
  const tagDefs = [
    {
      slug: "getting-started",
      title: "Getting Started",
      description: "Introductory guides for new Aria projects.",
      color: "#6366f1",
      icon: "i-lucide:sparkles",
    },
    {
      slug: "composer",
      title: "Composer",
      description: "Visual layout and design iteration in the builder.",
      color: "#0ea5e9",
      icon: "i-lucide:palette",
    },
    {
      slug: "cms",
      title: "CMS",
      description: "Collections, entries, and dynamic data bindings.",
      color: "#7c3aed",
      icon: "i-lucide:database",
    },
  ] as const;

  const tagIdsBySlug: Record<string, string> = {};
  for (const tag of tagDefs) {
    const existing = store.findEntryBySlug(root, tags.id, tag.slug);
    if (existing) {
      tagIdsBySlug[tag.slug] = existing.entry.id;
      continue;
    }
    const record = createEntry(root, {
      collectionId: tags.id,
      title: tag.title,
      slug: tag.slug,
      status: "published",
      frontmatter: {
        description: tag.description,
        color: tag.color,
        icon: tag.icon,
      },
    });
    tagIdsBySlug[tag.slug] = record.entry.id;
    entriesCreated += 1;
  }

  // --- Sample author ---
  let authorId: string | null = null;
  {
    const existing = store.findEntryBySlug(root, authors.id, "aria-team");
    if (existing) {
      authorId = existing.entry.id;
    } else {
      const record = createEntry(root, {
        collectionId: authors.id,
        title: "Aria Team",
        slug: "aria-team",
        status: "published",
        frontmatter: {
          role: "Aria Team",
          bio: "Building Aria — a visual site builder with a real CMS.",
          website: "https://aria.builder",
        },
      });
      authorId = record.entry.id;
      entriesCreated += 1;
    }
  }

  // --- Sample blog posts ---
  if (authorId) {
    const posts = [
      {
        slug: "pages-components-and-composer",
        title: "Getting Started with Pages, Components, and Composer",
        excerpt:
          "How pages, reusable components, and Composer fit together in Aria's builder.",
        category: "Design",
        featured: true,
        publishedDate: "2026-07-01",
        tagSlugs: ["getting-started", "composer"] as const,
        body: "Aria organizes site content around pages — each page maps to a route and moves through draft and published states.\n\nComponents are reusable building blocks. Drop them on a page once, then reuse the same structure across the site.\n\nComposer is where you iterate on layout and visual design for spacing, typography, and polish.",
      },
      {
        slug: "cms-and-dynamic-data",
        title: "CMS Collections and Dynamic Data",
        excerpt:
          "Collections, entry templates, and binding CMS fields to page content.",
        category: "Product",
        featured: false,
        publishedDate: "2026-07-02",
        tagSlugs: ["getting-started", "cms"] as const,
        body: "Fresh Aria installs can include blog, authors, and tags collections. Relations between them let you model real editorial structure.\n\nThe blog list page at /blog renders many entries. Each post uses an entry template at /blog/{slug}.\n\nBind title, excerpt, published date, and body fields directly on builder nodes so content updates without re-editing page structure.",
      },
      {
        slug: "ai-engineer-and-mcp",
        title: "AI Engineer and MCP in Aria",
        excerpt:
          "Using AI Engineer and MCP to build and iterate on Aria sites with agent tooling.",
        category: "Engineering",
        featured: false,
        publishedDate: "2026-07-03",
        tagSlugs: ["getting-started"] as const,
        body: "AI Engineer is Aria's agent-assisted building surface. It helps you move faster on pages, CMS content, and deployment tasks.\n\nMCP connects external tools to your project context so agents can read structure, propose edits, and run workflows with the same primitives you use in the admin UI.",
      },
    ] as const;

    for (const post of posts) {
      if (entryExistsBySlug(root, blog.id, post.slug)) continue;
      const tagIds = post.tagSlugs
        .map((slug) => tagIdsBySlug[slug])
        .filter((id): id is string => Boolean(id));

      const record = createEntry(root, {
        collectionId: blog.id,
        title: post.title,
        slug: post.slug,
        status: "published",
        frontmatter: {
          excerpt: post.excerpt,
          author: authorId,
          category: post.category,
          publishedDate: post.publishedDate,
          featured: post.featured,
        },
        body: plainTextToStructuredText(post.body),
      });

      if (tagIds.length > 0) {
        updateEntry(root, {
          collectionId: blog.id,
          id: record.entry.id,
          version: record.entry.version,
          patch: {
            relations: tagIds.map((targetEntryId, position) => ({
              sourceEntryId: record.entry.id,
              fieldKey: "tags",
              targetEntryId,
              position,
            })),
          },
        });
      }
      entriesCreated += 1;
    }
  }

  return { collections: collectionsCreated, entries: entriesCreated };
}
