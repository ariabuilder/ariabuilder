import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(path.join(tmpdir(), ".aria-runtime-smoke-"));
const out = path.join(outDir, "runtime.mjs");
// Match the packaged main bundle's module-resolution anchor while keeping the
// generated smoke bundle outside the checkout.
const runtimeBundleUrl = pathToFileURL(path.join(root, "dist-electron", "main.mjs")).href;
const typescriptEntry = fileURLToPath(import.meta.resolve("typescript"));
const externalizeTypeScript = {
  name: "externalize-typescript",
  setup(build) {
    build.onResolve({ filter: /^typescript$/ }, () => ({
      path: pathToFileURL(typescriptEntry).href,
      external: true,
    }));
  },
};
const fixture = mkdtempSync(path.join(tmpdir(), "aria-runtime-"));
const binDir = path.join(fixture, "node_modules", ".bin");
const astroPackageDir = path.join(fixture, "node_modules", "astro");
const astroBinDir = path.join(astroPackageDir, "bin");
mkdirSync(binDir, { recursive: true });
mkdirSync(astroBinDir, { recursive: true });
const astroSettingsDir = path.join(fixture, ".astro");
const astroSettingsPath = path.join(astroSettingsDir, "settings.json");
const malformedAstroSettings = '{"devToolbar":';
mkdirSync(astroSettingsDir, { recursive: true });
writeFileSync(astroSettingsPath, malformedAstroSettings);
writeFileSync(
  path.join(fixture, "package.json"),
  JSON.stringify({ dependencies: { astro: "^5.0.0" } }),
);
const runner = path.join(astroBinDir, "astro-runner.cjs");
writeFileSync(
  path.join(astroPackageDir, "package.json"),
  JSON.stringify({ name: "astro", bin: { astro: "./bin/astro-runner.cjs" } }),
);
writeFileSync(
  runner,
  `const http = require('node:http');
const portIdx = process.argv.indexOf('--port');
const port = portIdx >= 0 ? Number(process.argv[portIdx + 1]) : 0;
const server = http.createServer((_req, res) => { res.end('ok'); });
server.listen(port, '127.0.0.1', () => {
  const addr = server.address();
  const bound = typeof addr === 'object' && addr ? addr.port : port;
  console.log('http://127.0.0.1:' + bound);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`,
);
const fakeAstro = path.join(binDir, process.platform === "win32" ? "astro.cmd" : "astro");
if (process.platform === "win32") {
  writeFileSync(fakeAstro, `@echo off\r\nnode "%~dp0astro-runner.cjs" %*\r\n`);
} else {
  writeFileSync(fakeAstro, `#!/usr/bin/env node\nrequire(${JSON.stringify(runner)});\n`);
  chmodSync(fakeAstro, 0o755);
}

let manager = null;
try {
  await esbuild.build({
    entryPoints: [path.join(root, "electron/astroRuntime.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
    define: { "import.meta.url": JSON.stringify(runtimeBundleUrl) },
    banner: {
      js: `import { createRequire as __ariaCreateRequire } from "node:module";
const require = __ariaCreateRequire(${JSON.stringify(runtimeBundleUrl)});`,
    },
    plugins: [externalizeTypeScript],
  });
  const { AstroRuntimeManager } = await import(pathToFileURL(out).href);
  const updates = [];
  let markStarting;
  const starting = new Promise((resolve) => {
    markStarting = resolve;
  });
  manager = new AstroRuntimeManager((snapshot) => {
    updates.push(snapshot);
    if (snapshot.status === "starting") markStarting();
  });
  const racingStart = manager.start(fixture);
  await starting;
  console.log("smoke-runtime: start/stop race");
  const racingStop = manager.stop(fixture);
  await Promise.all([racingStart, racingStop]);
  const afterRace = manager.get(fixture);
  if (!afterRace || afterRace.status !== "stopped") {
    throw new Error("start/stop race did not settle stopped");
  }
  const live = await manager.start(fixture);
  console.log(`smoke-runtime: start settled (${live.status})`);
  if (live.status !== "live" || !live.previewUrl) {
    throw new Error(
      `runtime did not become live: ${JSON.stringify({ status: live.status, error: live.error, logs: live.logs.slice(-8) })}`,
    );
  }
  const response = await fetch(`${live.previewUrl}/`);
  if (!response.ok) throw new Error(`preview returned ${response.status}`);
  const liveUrl = live.previewUrl;
  console.log("smoke-runtime: stopping owned preview");
  await manager.stop(fixture);
  console.log("smoke-runtime: owned preview stopped");
  const stopped = manager.get(fixture);
  if (!stopped || stopped.status !== "stopped") throw new Error("runtime did not stop");
  let stillResponding = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_000);
    try {
      await fetch(`${liveUrl}/`, { signal: controller.signal });
      stillResponding = true;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Expected: Aria owns this process and must drain it on stop.
  }
  if (stillResponding) throw new Error("runtime process still responded after stop");
  if (existsSync(path.join(fixture, "node_modules", ".aria", "runtime-owner.json"))) {
    throw new Error("runtime ownership metadata remained after stop");
  }
  if (!updates.some((snapshot) => snapshot.status === "starting")) {
    throw new Error("missing starting runtime update");
  }
  if (readFileSync(astroSettingsPath, "utf8") !== malformedAstroSettings) {
    throw new Error("runtime modified the user's .astro/settings.json");
  }
  console.log("smoke-runtime: ok");
} finally {
  if (manager) await manager.stop(fixture).catch(() => undefined);
  rmSync(fixture, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
}
