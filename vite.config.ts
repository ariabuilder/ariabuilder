import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import tailwindcss from "@tailwindcss/vite"
import { paraglideVitePlugin } from "@inlang/paraglide-js"

const root = path.dirname(fileURLToPath(import.meta.url))
const configuredDevUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:1420/"
const configuredPort = Number(new URL(configuredDevUrl).port || 1420)

export default defineConfig({
  define: {
    __ARIA_RENDERER_TOKEN__: JSON.stringify(process.env.VITE_ARIA_RENDERER_TOKEN ?? ""),
  },
  plugins: [
    vue(),
    tailwindcss(),
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      // Keep .d.ts in sync during vite dev/build (CLI uses --emit-ts-declarations).
      emitTsDeclarations: true,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
    },
  },
  base: "./",
  server: {
    host: "127.0.0.1",
    port: configuredPort,
    strictPort: true,
  },
  clearScreen: false,
})
