import path from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { testExclude, testProjects } from "./test-architecture.config.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
      "@electron": path.resolve(root, "./electron"),
      "@shared": path.resolve(root, "./shared"),
      "@tests": path.resolve(root, "./tests"),
    },
  },
  test: {
    environment: "node",
    projects: testProjects.map(({ name, include }) => ({
      extends: true,
      test: {
        name,
        include: [include],
        exclude: testExclude,
      },
    })),
  },
});
